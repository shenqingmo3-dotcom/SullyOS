import React, { useEffect, useRef, useState } from 'react';
import {
    ArrowLeft, BookOpenText, ChatCircleDots, Clock,
    PaperPlaneRight, StopCircle, Trash, UploadSimple,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import type { CharacterProfile, TogetherLibraryItem, TogetherSession, TogetherSessionMessage } from '../types';
import { DB } from '../utils/db';
import { TogetherStore } from '../utils/togetherStore';
import { buildChatRequestPayload } from '../utils/chatRequestPayload';
import { safeResponseJson, extractContent } from '../utils/safeApi';
import { currentInteractionMode, extractInteractionModeDirective } from '../utils/interactionMode';
import { MemoryNodeDB } from '../utils/memoryPalace/db';
import { flushBackendMemorySyncQueue, loadBackendChatConfig } from '../utils/backendClient';

const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function readTxt(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const utf8 = new TextDecoder('utf-8').decode(buffer);
    const broken = (utf8.match(/�/g) || []).length;
    if (broken <= Math.max(2, utf8.length * 0.002)) return utf8;
    try { return new TextDecoder('gb18030').decode(buffer); } catch { return utf8; }
}

function elapsedText(startedAt: number, endedAt = Date.now()): string {
    const minutes = Math.max(1, Math.round((endedAt - startedAt) / 60_000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
}

const TogetherApp: React.FC = () => {
    const {
        closeApp, characters, activeCharacterId, setActiveCharacterId, updateCharacter,
        userProfile, groups, apiConfig, realtimeConfig, addToast,
    } = useOS();
    const [items, setItems] = useState<TogetherLibraryItem[]>([]);
    const [activeItem, setActiveItem] = useState<TogetherLibraryItem | null>(null);
    const [session, setSession] = useState<TogetherSession | null>(null);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [ending, setEnding] = useState(false);
    const textPaneRef = useRef<HTMLDivElement>(null);
    const sessionRef = useRef<TogetherSession | null>(null);

    const char = characters.find(item => item.id === (session?.charId || activeCharacterId)) || characters[0];
    useEffect(() => { sessionRef.current = session; }, [session]);
    useEffect(() => { void TogetherStore.listItems().then(all => setItems(all.filter(item => item.type === 'novel'))); }, []);

    const sortedMessages = session?.messages || [];
    const progressLabel = `${Math.round((session?.progress || 0) * 100)}%`;

    const saveSession = async (next: TogetherSession) => {
        setSession(next);
        sessionRef.current = next;
        await TogetherStore.saveSession(next);
    };

    const openItem = async (item: TogetherLibraryItem) => {
        if (!char) return;
        const next: TogetherSession = {
            id: uid('together-session'),
            itemId: item.id,
            itemTitle: item.title,
            mediaType: item.type,
            charId: activeCharacterId || char.id,
            startedAt: Date.now(),
            progress: item.lastPosition || 0,
            interactionMode: currentInteractionMode(char),
            messages: [],
        };
        setActiveItem(item);
        await saveSession(next);
    };

    const importNovel = async (file: File) => {
        const text = (await readTxt(file)).trim();
        if (!text) { addToast('TXT 里没有可读文字', 'error'); return; }
        const now = Date.now();
        const item: TogetherLibraryItem = {
            id: uid('together-novel'), type: 'novel', title: file.name.replace(/\.txt$/i, ''),
            text, fileName: file.name, createdAt: now, updatedAt: now, lastPosition: 0,
        };
        await TogetherStore.saveItem(item);
        setItems(prev => [item, ...prev]);
        addToast('小说已加入“一起看”', 'success');
    };

    const deleteItem = async (item: TogetherLibraryItem) => {
        await TogetherStore.deleteItem(item.id);
        setItems(prev => prev.filter(current => current.id !== item.id));
    };

    const modelReply = async (activeChar: CharacterProfile, userText: string, activeSession: TogetherSession): Promise<string> => {
        const history = await DB.getRecentMessagesByCharId(activeChar.id, Math.min(activeChar.contextLimit || 500, 300));
        const text = activeItem?.text || '';
        const center = Math.round(text.length * activeSession.progress);
        const excerpt = text ? text.slice(Math.max(0, center - 1200), Math.min(text.length, center + 1800)) : '';
        const discussion = activeSession.messages.slice(-12).map(m => `${m.role === 'user' ? userProfile.name : activeChar.name}: ${m.content}`).join('\n');
        const payload = await buildChatRequestPayload({
            char: activeChar, userProfile, groups, emojis: [], categories: [],
            historyMsgs: history, recentMsgsHint: history.slice(-80), contextLimit: Math.min(activeChar.contextLimit || 500, 300),
            realtimeConfig,
            recallQueryHint: `一起看 ${activeSession.itemTitle} ${userText}`,
        });
        const task = `\n\n[一起看·页内讨论]\n你正在和${userProfile.name}一起读小说《${activeSession.itemTitle}》，当前进度${Math.round(activeSession.progress * 100)}%。\n${excerpt ? `眼前片段：\n${excerpt}\n` : ''}${discussion ? `本次页内讨论：\n${discussion}\n` : ''}${userProfile.name}刚刚说：${userText}\n直接以角色本人身份自然回应这一句。围绕眼前内容交流，不做剧情总结，不写助手式分析，不复述人设；语气、立场和亲疏感必须来自角色面具。控制在1—4句。`;
        const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey || 'sk-none'}` },
            body: JSON.stringify({ model: apiConfig.model, messages: [...payload.fullMessages, { role: 'user', content: task }], temperature: 0.9, stream: false }),
        });
        const data = await safeResponseJson(response);
        if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
        const extracted = extractInteractionModeDirective(extractContent(data).trim());
        if (extracted.directive) {
            updateCharacter(activeChar.id, {
                interactionMode: extracted.directive.mode,
                interactionScene: {
                    ...(activeChar.interactionScene || {}),
                    location: extracted.directive.location || activeChar.interactionScene?.location,
                    distance: extracted.directive.distance || activeChar.interactionScene?.distance,
                    changedAt: Date.now(), changedBy: 'assistant',
                },
            });
        }
        return extracted.content.trim();
    };

    const sendDiscussion = async () => {
        const activeSession = sessionRef.current;
        if (!activeSession || !char || !draft.trim() || sending) return;
        const userMessage: TogetherSessionMessage = { id: uid('together-msg'), role: 'user', content: draft.trim(), createdAt: Date.now(), progress: activeSession.progress };
        const withUser = { ...activeSession, messages: [...activeSession.messages, userMessage] };
        setDraft(''); setSending(true);
        await saveSession(withUser);
        try {
            const content = await modelReply(char, userMessage.content, withUser);
            if (!content) throw new Error('模型没有返回正文');
            await saveSession({
                ...withUser,
                messages: [...withUser.messages, { id: uid('together-msg'), role: 'assistant', content, createdAt: Date.now(), progress: withUser.progress }],
            });
        } catch (error: any) {
            addToast(`讨论失败：${error?.message || 'unknown error'}`, 'error');
        } finally { setSending(false); }
    };

    const endSession = async () => {
        const activeSession = sessionRef.current;
        if (!activeSession || !activeItem || !char || ending) return;
        setEnding(true);
        const endedAt = Date.now();
        const discussion = activeSession.messages.map(m => `${m.role === 'user' ? userProfile.name : char.name}: ${m.content}`).join('\n');
        let summary = `${userProfile.name}和${char.name}${activeSession.interactionMode === 'offline' ? '线下' : '线上'}一起读了《${activeSession.itemTitle}》${elapsedText(activeSession.startedAt, endedAt)}，进度到${Math.round(activeSession.progress * 100)}%。`;
        if (discussion) {
            try {
                const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey || 'sk-none'}` },
                    body: JSON.stringify({
                        model: apiConfig.model, temperature: 0.25, stream: false,
                        messages: [{ role: 'user', content: `把以下一起观看记录压缩成2—4句可长期保存的第三人称事实记忆。保留双方对作品的具体看法、分歧或喜欢的点，不虚构，不写空泛感想。\n作品：${activeSession.itemTitle}\n用时：${elapsedText(activeSession.startedAt, endedAt)}\n进度：${Math.round(activeSession.progress * 100)}%\n讨论：\n${discussion}` }],
                    }),
                });
                const data = await safeResponseJson(response);
                if (response.ok && extractContent(data).trim()) summary += ` ${extractContent(data).trim()}`;
            } catch { /* deterministic summary remains valid */ }
        }
        const completed: TogetherSession = { ...activeSession, endedAt, summary };
        await TogetherStore.saveSession(completed);
        const updatedItem = { ...activeItem, lastPosition: activeSession.progress, updatedAt: endedAt };
        await TogetherStore.saveItem(updatedItem);
        await MemoryNodeDB.save({
            id: uid('mem-together'), charId: char.id, content: summary, room: 'living_room',
            tags: ['一起看', '共读', activeSession.interactionMode === 'offline' ? '线下' : '线上'],
            importance: 7, mood: 'warm', embedded: false, createdAt: endedAt, lastAccessedAt: endedAt,
            accessCount: 0, origin: 'system',
        });
        const backendConfig = loadBackendChatConfig();
        if (backendConfig.enabled) {
            await flushBackendMemorySyncQueue({ config: backendConfig, character: char, user: userProfile }).catch(() => {});
        }
        setItems(prev => prev.map(item => item.id === updatedItem.id ? updatedItem : item));
        setSession(null); setActiveItem(null); setEnding(false);
        addToast('这段“一起看”已同时写入前端与后端记忆', 'success');
    };

    const onNovelScroll = () => {
        const pane = textPaneRef.current;
        const activeSession = sessionRef.current;
        if (!pane || !activeSession) return;
        const max = Math.max(1, pane.scrollHeight - pane.clientHeight);
        const progress = Math.min(1, Math.max(0, pane.scrollTop / max));
        const next = { ...activeSession, progress };
        setSession(next); sessionRef.current = next;
    };

    if (!activeItem || !session) {
        return <div className="h-full overflow-y-auto bg-[#f6f2ea] text-stone-800">
            <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-stone-200 bg-[#f6f2ea]/95 px-4 py-3 backdrop-blur">
                <button onClick={closeApp} className="rounded-full p-2 hover:bg-stone-200"><ArrowLeft size={22} /></button>
                <div><h1 className="text-lg font-bold">一起看</h1><p className="text-xs text-stone-500">共读、共看，聊过的会留下记忆</p></div>
            </header>
            <main className="space-y-5 p-4">
                <label className="block text-xs font-semibold text-stone-500">和谁一起</label>
                <select value={activeCharacterId} onChange={e => setActiveCharacterId(e.target.value)} className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3">
                    {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div>
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-violet-600 px-3 py-4 font-semibold text-white shadow-sm">
                        <UploadSimple size={20} />导入 TXT<input type="file" accept=".txt,text/plain" className="hidden" onChange={e => e.target.files?.[0] && void importNovel(e.target.files[0])} />
                    </label>
                </div>
                <section className="space-y-3">
                    {items.length === 0 && <div className="rounded-3xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-400">先导入一本小说。</div>}
                    {items.map(item => <article key={item.id} className="flex items-center gap-3 rounded-3xl bg-white p-4 shadow-sm">
                        <div className="rounded-2xl bg-violet-100 p-3 text-violet-700"><BookOpenText size={25} /></div>
                        <button className="min-w-0 flex-1 text-left" onClick={() => void openItem(item)}><div className="truncate font-semibold">{item.title}</div><div className="text-xs text-stone-400">上次进度 {Math.round((item.lastPosition || 0) * 100)}%</div></button>
                        <button onClick={() => void deleteItem(item)} className="p-2 text-stone-400"><Trash size={18} /></button>
                    </article>)}
                </section>
            </main>
        </div>;
    }

    return <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,3fr)_minmax(220px,2fr)] bg-stone-950 text-white">
        <header className="flex items-center gap-3 border-b border-white/10 px-3 py-2">
            <button onClick={() => void endSession()} className="rounded-full p-2 hover:bg-white/10"><ArrowLeft size={21} /></button>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{activeItem.title}</div><div className="flex gap-3 text-[11px] text-white/50"><span>{progressLabel}</span><span className="flex items-center gap-1"><Clock size={12} />{elapsedText(session.startedAt)}</span><span>{session.interactionMode === 'offline' ? '线下' : '线上'}</span></div></div>
            <button onClick={() => void endSession()} disabled={ending} className="flex items-center gap-1 rounded-full bg-rose-500/20 px-3 py-2 text-xs text-rose-200"><StopCircle size={16} />{ending ? '归档中' : '结束'}</button>
        </header>
        <section className="min-h-0 bg-stone-900">
            <div ref={textPaneRef} onScroll={onNovelScroll} className="h-full overflow-y-auto whitespace-pre-wrap px-5 py-6 font-serif text-[16px] leading-8 text-stone-100">{activeItem.text}</div>
        </section>
        <section className="flex min-h-0 flex-col border-t border-white/10 bg-[#17151d]">
            <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-violet-300"><ChatCircleDots size={16} />和 {char?.name || '角色'} 边看边聊</div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-2">
                {sortedMessages.length === 0 && <p className="py-6 text-center text-xs text-white/35">看到想说的地方，直接聊。</p>}
                {sortedMessages.map(message => <div key={message.id} className={`max-w-[86%] rounded-2xl px-3 py-2 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-violet-600' : 'bg-white/10'}`}>{message.content}</div>)}
                {sending && <div className="w-fit rounded-2xl bg-white/10 px-3 py-2 text-sm text-white/45">正在看你说的这句…</div>}
            </div>
            <div className="flex gap-2 border-t border-white/10 p-3">
                <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendDiscussion(); } }} placeholder="对这一段说点什么…" className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2 text-sm outline-none placeholder:text-white/30" />
                <button onClick={() => void sendDiscussion()} disabled={sending || !draft.trim()} className="rounded-full bg-violet-600 p-3 disabled:opacity-40"><PaperPlaneRight size={18} weight="fill" /></button>
            </div>
        </section>
    </div>;
};

export default TogetherApp;
