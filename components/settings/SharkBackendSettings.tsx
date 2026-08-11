import React, { useEffect, useState } from 'react';
import { useOS } from '../../context/OSContext';
import {
    addBackendModelProfile,
    deleteBackendModelProfile,
    enableBackendPush,
    exchangeBackendPairingCode,
    getBackendAgents,
    getBackendModelPool,
    loadBackendChatConfig,
    saveBackendChatConfig,
    syncBackendCharacterFully,
    syncBackendMemoryPalaceFully,
    testBackendConnection,
    testBackendPush,
    updateBackendAgentAutonomy,
    updateBackendModelRouting,
    type BackendAgentAutonomy,
    type BackendAgentsResult,
    type BackendChatConfig,
    type BackendModelPool,
} from '../../utils/backendClient';
import { acknowledgeBackendMemoryChangesThrough } from '../../utils/backendSyncQueue';
import { DB } from '../../utils/db';
import {
    AnticipationDB,
    DigestReportDB,
    EventBoxDB,
    MemoryBatchDB,
    MemoryLinkDB,
    MemoryNodeDB,
    MemoryVectorDB,
    RoomPlateDB,
    TopicBoxDB,
} from '../../utils/memoryPalace/db';
import BackendToolSettings from './BackendToolSettings';

const panelStatusClass = (text: string) => {
    if (text.startsWith('✅')) return 'border-emerald-100 bg-emerald-50 text-emerald-700';
    if (text.startsWith('⚠️')) return 'border-amber-100 bg-amber-50 text-amber-700';
    if (text.startsWith('❌')) return 'border-red-100 bg-red-50 text-red-600';
    return 'border-sky-100 bg-sky-50 text-sky-700';
};

const newSnapshotId = () => typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const SharkBackendSettings: React.FC = () => {
    const { characters, userProfile, addToast } = useOS();
    const [open, setOpen] = useState(false);
    const [config, setConfig] = useState<BackendChatConfig>(loadBackendChatConfig);
    const [pairingCode, setPairingCode] = useState('');
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [agents, setAgents] = useState<BackendAgentsResult | null>(null);
    const [agentBusyId, setAgentBusyId] = useState<string | null>(null);
    const [modelPool, setModelPool] = useState<BackendModelPool | null>(null);
    const [newModel, setNewModel] = useState({ label: '', baseUrl: '', apiKey: '', model: '' });

    const persistConfig = () => {
        const saved = saveBackendChatConfig({ ...config, enabled: true, serverContextEnabled: false });
        setConfig(saved);
        return saved;
    };

    const refreshRemoteState = async (candidate: BackendChatConfig) => {
        const [nextAgents, nextPool] = await Promise.all([
            getBackendAgents(candidate),
            getBackendModelPool(candidate),
        ]);
        setAgents(nextAgents);
        setModelPool(nextPool);
    };

    useEffect(() => {
        if (!open || !config.token.trim()) return;
        void refreshRemoteState(config).catch(() => undefined);
    }, [open]);

    const connect = async () => {
        setBusy('connect');
        try {
            const candidate = persistConfig();
            const result = await testBackendConnection(candidate);
            if (!result.ok) throw new Error(result.message || '连接失败');
            setStatus(`✅ VPS 已连接${result.modelConfigured ? `，当前模型 ${result.model || '已配置'}` : '，模型池尚未配置'}`);
            await refreshRemoteState(candidate);
        } catch (error) {
            setStatus(`❌ 连接失败：${error instanceof Error ? error.message : '未知错误'}`);
        } finally {
            setBusy(null);
        }
    };

    const pair = async () => {
        if (!pairingCode.trim()) return;
        setBusy('pair');
        try {
            const paired = await exchangeBackendPairingCode(config.baseUrl, pairingCode);
            setConfig(paired);
            setPairingCode('');
            setStatus('✅ 手机已与 VPS 配对');
            await refreshRemoteState(paired);
        } catch (error) {
            setStatus(`❌ 配对失败：${error instanceof Error ? error.message : '未知错误'}`);
        } finally {
            setBusy(null);
        }
    };

    const addModel = async () => {
        if (!newModel.baseUrl.trim() || !newModel.apiKey.trim() || !newModel.model.trim()) return;
        setBusy('model');
        try {
            const candidate = persistConfig();
            await addBackendModelProfile(candidate, {
                label: newModel.label.trim() || newModel.model.trim(),
                baseUrl: newModel.baseUrl,
                apiKey: newModel.apiKey,
                model: newModel.model,
            });
            setNewModel({ label: '', baseUrl: '', apiKey: '', model: '' });
            setModelPool(await getBackendModelPool(candidate));
            setStatus('✅ 已加入后端模型池');
        } catch (error) {
            setStatus(`❌ 保存模型失败：${error instanceof Error ? error.message : '未知错误'}`);
        } finally {
            setBusy(null);
        }
    };

    const syncAll = async () => {
        setBusy('sync');
        setStatus('正在读取这台手机中的完整数据…');
        try {
            const candidate = persistConfig();
            const storedCharacters = await DB.getAllCharacters();
            const allLinks = await MemoryLinkDB.getAll();
            const totals = { messages: 0, memories: 0, links: 0, vectors: 0 };
            const mismatches: string[] = [];

            for (let index = 0; index < storedCharacters.length; index += 1) {
                const character = storedCharacters[index];
                const snapshotStartedAt = Date.now();
                setStatus(`正在同步 ${index + 1}/${storedCharacters.length}：${character.name}`);
                const [messages, memories, vectors, eventBoxes, roomPlates, digestReports, anticipations, batches, topicBoxes] = await Promise.all([
                    DB.getMessagesByCharId(character.id, true),
                    MemoryNodeDB.getByCharId(character.id),
                    MemoryVectorDB.getAllByCharId(character.id),
                    EventBoxDB.getByCharId(character.id),
                    RoomPlateDB.getByCharId(character.id),
                    DigestReportDB.getByCharId(character.id),
                    AnticipationDB.getByCharId(character.id),
                    MemoryBatchDB.getByCharId(character.id),
                    TopicBoxDB.getByCharId(character.id),
                ]);
                const nodeIds = new Set(memories.map(memory => memory.id));
                const links = allLinks.filter(link => nodeIds.has(link.sourceId) && nodeIds.has(link.targetId));
                const snapshotId = newSnapshotId();
                const contextResult = await syncBackendCharacterFully({
                    config: candidate,
                    character,
                    user: userProfile,
                    messages,
                    memories,
                    snapshotId,
                    onProgress: (done, total) => setStatus(`正在同步 ${character.name}：聊天与节点 ${done}/${total}`),
                });
                const palaceResult = await syncBackendMemoryPalaceFully({
                    config: candidate,
                    characterId: character.id,
                    eventBoxes,
                    roomPlates,
                    links,
                    anticipations,
                    digestReports,
                    vectors,
                    batches,
                    topicBoxes,
                    snapshotId,
                    onProgress: (done, total) => setStatus(`正在同步 ${character.name}：记忆宫殿 ${done}/${total}`),
                });
                await acknowledgeBackendMemoryChangesThrough(character.id, snapshotStartedAt);
                const expected: Record<string, number> = {
                    nodes: memories.length,
                    event_boxes: eventBoxes.length,
                    room_plates: roomPlates.length,
                    links: links.length,
                    anticipations: anticipations.length,
                    digest_reports: digestReports.length,
                    vectors: vectors.length,
                    batches: batches.length,
                    topic_boxes: topicBoxes.length,
                };
                for (const [key, count] of Object.entries(expected)) {
                    if (palaceResult.backendCounts[key] !== count) {
                        mismatches.push(`${character.name}.${key}：手机 ${count} / 后端 ${palaceResult.backendCounts[key] ?? '未知'}`);
                    }
                }
                totals.messages += contextResult.messages;
                totals.memories += contextResult.memories;
                totals.links += palaceResult.links;
                totals.vectors += palaceResult.vectors;
            }

            setStatus(mismatches.length
                ? `⚠️ 同步完成，但数量核对仍有差异：${mismatches.slice(0, 3).join('；')}`
                : `✅ 完整同步并核对通过：${storedCharacters.length} 个角色、${totals.messages} 条聊天、${totals.memories} 个节点、${totals.links} 条关联、${totals.vectors} 条向量。`);
            await refreshRemoteState(candidate);
        } catch (error) {
            setStatus(`❌ 完整同步失败：${error instanceof Error ? error.message : '未知错误'}`);
        } finally {
            setBusy(null);
        }
    };

    const toggleAgent = async (agent: BackendAgentAutonomy) => {
        setAgentBusyId(agent.characterId);
        try {
            const updated = await updateBackendAgentAutonomy(persistConfig(), agent.characterId, {
                enabled: !agent.enabled,
                intervalMinutes: agent.intervalMinutes,
                policy: agent.policy,
            });
            setAgents(current => current ? {
                ...current,
                agents: current.agents.map(item => item.characterId === updated.characterId ? updated : item),
            } : current);
            addToast(`${updated.name} heartbeat 已${updated.enabled ? '开启' : '关闭'}`, 'success');
        } catch (error) {
            setStatus(`❌ heartbeat 更新失败：${error instanceof Error ? error.message : '未知错误'}`);
        } finally {
            setAgentBusyId(null);
        }
    };

    const setupPush = async () => {
        setBusy('push');
        try {
            const candidate = persistConfig();
            await enableBackendPush(candidate);
            const result = await testBackendPush(candidate);
            setStatus(`✅ 手机推送已连接；测试投递 ${result.delivered}/${result.attempted}`);
        } catch (error) {
            setStatus(`❌ 推送设置失败：${error instanceof Error ? error.message : '未知错误'}`);
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className="rounded-3xl border border-emerald-100 bg-white/85 p-5 shadow-sm">
            <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center gap-3 text-left">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-lg">☁️</span>
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold tracking-wide text-slate-700">SharkOS 自主后端</span>
                    <span className="block text-[10px] text-slate-400">完整同步 · heartbeat · 推送 · 工具</span>
                </span>
                <span className="text-[10px] font-bold text-emerald-700">{config.enabled && config.token ? '已配置' : '未配置'} · {open ? '收起' : '展开'}</span>
            </button>

            {open && <div className="mt-4 space-y-3 border-t border-emerald-100 pt-4">
                <label className="block text-[10px] font-bold text-slate-500">后端地址
                    <input value={config.baseUrl} onChange={event => setConfig(current => ({ ...current, baseUrl: event.target.value }))} placeholder="https://goldenbite.icu" className="mt-1 w-full rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs text-slate-700" />
                </label>
                <label className="block text-[10px] font-bold text-slate-500">APP Token
                    <input type="password" value={config.token} onChange={event => setConfig(current => ({ ...current, token: event.target.value }))} className="mt-1 w-full rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs text-slate-700" />
                </label>
                {!config.token.trim() && <div className="flex gap-2 rounded-xl bg-sky-50 p-2">
                    <input value={pairingCode} onChange={event => setPairingCode(event.target.value)} placeholder="一次性配对码" className="min-w-0 flex-1 rounded-lg border border-sky-100 bg-white px-2 py-2 text-xs" />
                    <button disabled={busy !== null || !pairingCode.trim()} onClick={() => void pair()} className="rounded-lg bg-sky-600 px-3 text-xs font-bold text-white disabled:opacity-50">{busy === 'pair' ? '配对中' : '配对'}</button>
                </div>}
                <div className="grid grid-cols-2 gap-2">
                    <button disabled={busy !== null} onClick={() => void connect()} className="rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white disabled:opacity-50">{busy === 'connect' ? '连接中…' : '保存并测试'}</button>
                    <button disabled={busy !== null || !config.token.trim()} onClick={() => void setupPush()} className="rounded-xl border border-emerald-200 bg-white py-2.5 text-xs font-bold text-emerald-700 disabled:opacity-50">{busy === 'push' ? '设置中…' : '连接并测试推送'}</button>
                </div>

                {modelPool && <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-700">后端模型池</span><span className="text-[9px] text-slate-400">{modelPool.routing.mode === 'auto' ? '自动故障转移' : '固定模型'}</span></div>
                    {modelPool.profiles.map(profile => <div key={profile.id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2">
                        <button className="min-w-0 flex-1 text-left" onClick={async () => {
                            await updateBackendModelRouting(persistConfig(), { mode: 'fixed', activeProfileId: profile.id });
                            setModelPool(await getBackendModelPool(persistConfig()));
                        }}>
                            <span className="block truncate text-[10px] font-bold text-slate-700">{profile.label} · {profile.model}</span>
                            <span className="block text-[9px] text-slate-400">{modelPool.routing.activeProfileId === profile.id ? '当前固定' : profile.healthStatus}</span>
                        </button>
                        {!profile.readOnly && <button onClick={async () => { await deleteBackendModelProfile(persistConfig(), profile.id); setModelPool(await getBackendModelPool(persistConfig())); }} className="text-[10px] text-red-400">删除</button>}
                    </div>)}
                    <button onClick={async () => { await updateBackendModelRouting(persistConfig(), { mode: 'auto', activeProfileId: null }); setModelPool(await getBackendModelPool(persistConfig())); }} className="w-full rounded-lg border border-slate-200 bg-white py-2 text-[10px] font-bold text-slate-600">使用自动故障转移</button>
                    <div className="grid grid-cols-2 gap-2">
                        <input value={newModel.label} onChange={event => setNewModel(value => ({ ...value, label: event.target.value }))} placeholder="名称" className="rounded-lg border border-slate-200 px-2 py-2 text-[10px]" />
                        <input value={newModel.model} onChange={event => setNewModel(value => ({ ...value, model: event.target.value }))} placeholder="模型名" className="rounded-lg border border-slate-200 px-2 py-2 text-[10px]" />
                        <input value={newModel.baseUrl} onChange={event => setNewModel(value => ({ ...value, baseUrl: event.target.value }))} placeholder="API 地址" className="rounded-lg border border-slate-200 px-2 py-2 text-[10px]" />
                        <input type="password" value={newModel.apiKey} onChange={event => setNewModel(value => ({ ...value, apiKey: event.target.value }))} placeholder="API Key" className="rounded-lg border border-slate-200 px-2 py-2 text-[10px]" />
                    </div>
                    <button disabled={busy !== null || !newModel.baseUrl || !newModel.apiKey || !newModel.model} onClick={() => void addModel()} className="w-full rounded-lg bg-slate-700 py-2 text-[10px] font-bold text-white disabled:opacity-40">{busy === 'model' ? '保存中…' : '加入模型池'}</button>
                </div>}

                <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-3 text-[10px] leading-relaxed text-amber-800">完整同步以当前手机为权威快照：相同 ID 更新而不是新增；最终 reconcile 会移除后端中手机已不存在的旧迁移副本。请先导入最完整的手机备份。</div>
                <button disabled={busy !== null || !config.token.trim()} onClick={() => void syncAll()} className="w-full rounded-2xl bg-sky-600 py-3 text-sm font-bold text-white disabled:opacity-50">{busy === 'sync' ? '正在完整同步…' : '完整同步角色、聊天与记忆宫殿'}</button>
                {status && <div className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${panelStatusClass(status)}`}>{status}</div>}

                {agents?.agents?.length ? <div className="space-y-2 rounded-2xl bg-violet-50/60 p-3">
                    <div className="text-xs font-bold text-violet-700">角色 heartbeat</div>
                    {agents.agents.map(agent => <div key={agent.characterId} className="flex items-center gap-3 rounded-xl bg-white/80 px-3 py-2">
                        <div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-slate-700">{agent.name}</div><div className="text-[9px] text-slate-400">每 {agent.intervalMinutes} 分钟检查 · {agent.nextWakeAt ? new Date(agent.nextWakeAt).toLocaleString() : '等待调度'}</div></div>
                        <button disabled={agentBusyId === agent.characterId} onClick={() => void toggleAgent(agent)} className={`rounded-full px-3 py-1.5 text-[10px] font-bold ${agent.enabled ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{agent.enabled ? '已开启' : '已关闭'}</button>
                    </div>)}
                </div> : null}

                {config.token.trim() && <BackendToolSettings config={config} characters={characters.map(character => ({ id: character.id, name: character.name }))} onStatus={setStatus} onSaved={() => refreshRemoteState(config)} />}
            </div>}
        </section>
    );
};

export default SharkBackendSettings;
