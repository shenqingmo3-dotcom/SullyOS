import React, { useEffect, useMemo, useState } from 'react';
import {
  getBackendXSession,
  getBackendTools,
  testBackendTool,
  updateBackendXSession,
  updateBackendTool,
  type BackendChatConfig,
  type BackendToolConnection,
  type BackendToolConnectionId,
} from '../../utils/backendClient';
import PhoneShortcutSetup from './PhoneShortcutSetup';

const TOOL_META: Record<BackendToolConnectionId, { name: string; hint: string; defaultMode: string }> = {
  'x.read': { name: '黑 X', hint: '持久登录 Chrome；浏览、分享与平台内动作统一配置', defaultMode: 'mcp' },
  'xhs.read': { name: '小红书', hint: '现有 Cookie/MCP 服务的 HTTP 地址', defaultMode: 'mcp' },
  'mcp.read': { name: '通用 MCP', hint: '支持 Streamable HTTP 的 MCP 地址', defaultMode: 'mcp' },
  'phone.read': { name: 'iPhone 屏幕查看', hint: '邮件触发快捷指令；每次请求十分钟内有效', defaultMode: 'phone' },
};

const BACKEND_ONLY_TOOL_IDS: BackendToolConnectionId[] = ['x.read', 'phone.read'];

const EMPTY_CONNECTIONS = BACKEND_ONLY_TOOL_IDS.map((id): BackendToolConnection => ({
  id, label: TOOL_META[id].name, enabled: false, endpoint: '', settings: { mode: TOOL_META[id].defaultMode },
  secretKeys: [], lastHealthStatus: 'unknown', lastHealthError: null, lastHealthAt: null,
}));

const BackendToolSettings: React.FC<{
  config: BackendChatConfig;
  characters: Array<{ id: string; name: string }>;
  onStatus: (message: string) => void;
  onSaved?: () => void | Promise<void>;
}> = ({ config, characters, onStatus, onSaved }) => {
  const [connections, setConnections] = useState(EMPTY_CONNECTIONS);
  const [expanded, setExpanded] = useState<BackendToolConnectionId | null>(null);
  const [busyId, setBusyId] = useState<BackendToolConnectionId | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [deviceToken, setDeviceToken] = useState('');
  const [xAuthToken, setXAuthToken] = useState('');
  const [xCt0, setXCt0] = useState('');
  const [xLoggedIn, setXLoggedIn] = useState<boolean | null>(null);

  const canConnect = Boolean(config.baseUrl.trim() && config.token.trim());
  useEffect(() => {
    if (!canConnect) return;
    void getBackendTools(config).then((result) => {
      const byId = new Map(result.connections.map((item) => [item.id, item]));
      setConnections(EMPTY_CONNECTIONS.map((fallback) => byId.get(fallback.id) || fallback));
    }).catch(() => { /* 后端未更新时保持占位，不影响普通聊天 */ });
  }, [canConnect, config.baseUrl, config.token]);

  const byId = useMemo(() => new Map(connections.map((item) => [item.id, item])), [connections]);
  const patchConnection = (id: BackendToolConnectionId, patch: Partial<BackendToolConnection>) => {
    setConnections((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };
  const patchSetting = (id: BackendToolConnectionId, key: string, value: unknown) => {
    const current = byId.get(id);
    if (current) patchConnection(id, { settings: { ...current.settings, [key]: value } });
  };

  const refreshXSession = async () => {
    setBusyId('x.read');
    try {
      const status = await getBackendXSession(config);
      setXLoggedIn(status.loggedIn);
      if (status.selfHandle) patchSetting('x.read', 'selfHandle', status.selfHandle);
      onStatus(status.loggedIn ? '✅ X 当前登录有效' : '❌ X 当前未登录或登录已失效');
    } catch (error) {
      setXLoggedIn(false);
      onStatus(`❌ X 状态读取失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusyId(null);
    }
  };

  const injectXSession = async () => {
    if (!xAuthToken.trim()) {
      onStatus('❌ 请先粘贴 X 的 auth_token');
      return;
    }
    setBusyId('x.read');
    try {
      const status = await updateBackendXSession(config, { authToken: xAuthToken.trim(), ct0: xCt0.trim() });
      setXLoggedIn(status.loggedIn);
      if (status.selfHandle) patchSetting('x.read', 'selfHandle', status.selfHandle);
      setXAuthToken('');
      setXCt0('');
      onStatus(status.loggedIn ? '✅ X Cookie 已注入，登录状态有效' : '❌ Cookie 已注入，但 X 仍未识别为登录状态');
    } catch (error) {
      onStatus(`❌ X Cookie 注入失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusyId(null);
    }
  };

  const importLocalXhs = () => {
    try {
      const stored = JSON.parse(localStorage.getItem('os_realtime_config') || '{}');
      const local = stored?.xhsMcpConfig;
      if (!local?.serverUrl || !local?.cookie) throw new Error('前端没有找到已保存的小红书 Lite 地址或 Cookie');
      patchConnection('xhs.read', {
        enabled: true,
        endpoint: String(local.serverUrl),
        settings: { ...(byId.get('xhs.read')?.settings || {}), mode: 'xhs-lite' },
      });
      setSecrets((current) => ({ ...current, 'xhs.read:cookie': String(local.cookie) }));
      setExpanded('xhs.read');
      onStatus('✅ 已读取前端的小红书配置；请确认后点“保存”，Cookie 才会加密写入你自己的 VPS');
    } catch (error) {
      onStatus(`❌ ${error instanceof Error ? error.message : '无法读取前端小红书配置'}`);
    }
  };

  const save = async (id: BackendToolConnectionId) => {
    const connection = byId.get(id);
    if (!connection) return;
    setBusyId(id);
    try {
      const secretPayload: Record<string, string> = {};
      if (id === 'phone.read') {
        if (secrets.smtpPassword) secretPayload.smtpPassword = secrets.smtpPassword;
      } else if (id === 'xhs.read' && connection.settings.mode === 'xhs-lite') {
        if (secrets['xhs.read:cookie']) secretPayload.cookie = secrets['xhs.read:cookie'];
      } else if (secrets[`${id}:token`]) secretPayload.bearerToken = secrets[`${id}:token`];
      const result = await updateBackendTool(config, id, {
        label: connection.label || TOOL_META[id].name,
        enabled: connection.enabled,
        endpoint: connection.endpoint,
        settings: connection.settings,
        secrets: secretPayload,
      });
      patchConnection(id, result.connection);
      if (result.generatedDeviceToken) setDeviceToken(result.generatedDeviceToken);
      setSecrets((current) => ({ ...current, smtpPassword: '', [`${id}:token`]: '', ...(id === 'xhs.read' ? { 'xhs.read:cookie': '' } : {}) }));
      await onSaved?.();
      onStatus(`✅ ${TOOL_META[id].name} 设置已保存`);
    } catch (error) {
      onStatus(`❌ ${TOOL_META[id].name} 保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusyId(null);
    }
  };

  const test = async (id: BackendToolConnectionId) => {
    setBusyId(id);
    try {
      const result = await testBackendTool(config, id);
      patchConnection(id, result.connection);
      onStatus(`✅ ${TOOL_META[id].name}：${result.message}`);
    } catch (error) {
      onStatus(`❌ ${TOOL_META[id].name} 测试失败：${error instanceof Error ? error.message : '未知错误'}`);
      void getBackendTools(config).then((result) => {
        const current = result.connections.find((item) => item.id === id);
        if (current) patchConnection(id, current);
      }).catch(() => {});
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-cyan-200/70 bg-white/60 p-3 space-y-3">
      <div>
        <p className="text-xs font-bold text-slate-600">自主工具连接</p>
        <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">这里只保留本体没有的入口。小红书在「实时感知」原页面配置，通用 MCP 在「MCP 工具服务器」原页面配置；保存时会同步给 VPS 自主活动。</p>
      </div>
      {connections.map((connection) => {
        const meta = TOOL_META[connection.id];
        const isPhone = connection.id === 'phone.read';
        const isOpen = expanded === connection.id;
        return (
          <div key={connection.id} className="rounded-xl border border-slate-200 bg-white/70 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button type="button" onClick={() => setExpanded(isOpen ? null : connection.id)} className="min-w-0 flex-1 text-left">
                <span className="block text-xs font-semibold text-slate-600">{meta.name}</span>
                <span className="block text-[9px] text-slate-400 truncate">{connection.enabled ? '已启用' : '未启用'} · {meta.hint}</span>
              </button>
              <button type="button" onClick={() => patchConnection(connection.id, { enabled: !connection.enabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full ${connection.enabled ? 'bg-cyan-500' : 'bg-slate-200'}`}>
                <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${connection.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {isOpen && (
              <div className="border-t border-slate-100 px-3 py-3 space-y-2">
                {connection.id === 'x.read' && <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-violet-700">X 登录状态</p>
                    <span className={`text-[10px] font-bold ${xLoggedIn === true ? 'text-emerald-600' : xLoggedIn === false ? 'text-rose-500' : 'text-slate-400'}`}>
                      {xLoggedIn === true ? '✅ 登录有效' : xLoggedIn === false ? '❌ 需要补登录' : '尚未检查'}
                    </span>
                  </div>
                  <button type="button" disabled={busyId === 'x.read'} onClick={() => void refreshXSession()}
                    className="w-full rounded-lg bg-white py-2 text-[10px] font-bold text-violet-700 border border-violet-200 disabled:opacity-40">检查当前状态</button>
                  <p className="text-[10px] font-bold text-slate-600 pt-1">粘贴 Cookie（稳定补登录）</p>
                  <input type="password" value={xAuthToken} onChange={(event) => setXAuthToken(event.target.value)} placeholder="auth_token"
                    className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-[10px] font-mono" />
                  <input type="password" value={xCt0} onChange={(event) => setXCt0(event.target.value)} placeholder="ct0（可留空）"
                    className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-[10px] font-mono" />
                  <button type="button" disabled={busyId === 'x.read'} onClick={() => void injectXSession()}
                    className="w-full rounded-lg bg-violet-600 py-2 text-[10px] font-bold text-white disabled:opacity-40">注入 Cookie</button>
                  <button type="button" onClick={() => window.open(`${config.baseUrl.replace(/\/+$/, '')}/x-login/vnc.html?autoconnect=1&resize=scale&path=x-login/websockify`, '_blank', 'noopener,noreferrer')}
                    className="w-full rounded-lg border border-violet-300 bg-white py-2 text-[10px] font-bold text-violet-700">打开远程桌面手动登录</button>
                  <input value={String(connection.settings.selfHandle || '')}
                    onChange={(event) => patchSetting('x.read', 'selfHandle', event.target.value.replace(/^@/, '').trim())}
                    placeholder="自己的 X 用户名（不带 @，用于查看自己的主页）"
                    className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-[10px]" />
                  <p className="rounded-lg border border-violet-100 bg-white/80 p-2 text-[10px] leading-relaxed text-slate-500">
                    角色会按自己的人设决定评价、点赞、转推或把帖子分享到聊天；不会为了刷动作而机械互动。
                  </p>
                  <p className="text-[9px] leading-relaxed text-slate-400">不保存 X 密码。Cookie 直接注入 VPS 的持久 Chrome；远程桌面另有独立访问密码。</p>
                </div>}
                {connection.id === 'xhs.read' && <button type="button" onClick={importLocalXhs}
                  className="w-full rounded-lg border border-rose-200 bg-rose-50 py-2 text-[10px] font-bold text-rose-600">
                  导入前端已保存的小红书 Lite 配置
                </button>}
                {connection.id === 'xhs.read' && <select value={String(connection.settings.mode || 'mcp')}
                  onChange={(event) => patchSetting(connection.id, 'mode', event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px]">
                  <option value="xhs-lite">Cookie Lite（免电脑）</option>
                  <option value="mcp">独立 MCP 服务</option>
                </select>}
                {!isPhone && <input value={connection.endpoint} onChange={(event) => patchConnection(connection.id, { endpoint: event.target.value })}
                  placeholder={connection.id === 'x.read' ? 'http://host.docker.internal:43710/mcp' : 'https://example.com/mcp'}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px]" />}
                {!isPhone && !(connection.id === 'xhs.read' && connection.settings.mode === 'xhs-lite') && <input type="password" value={secrets[`${connection.id}:token`] || ''}
                  onChange={(event) => setSecrets((current) => ({ ...current, [`${connection.id}:token`]: event.target.value }))}
                  placeholder={connection.secretKeys.includes('bearerToken') ? '访问令牌（已保存，留空不改）' : '访问令牌（没有可留空）'}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px]" />}
                {connection.id === 'xhs.read' && connection.settings.mode === 'xhs-lite' && <>
                  <textarea value={secrets['xhs.read:cookie'] || ''}
                    onChange={(event) => setSecrets((current) => ({ ...current, 'xhs.read:cookie': event.target.value }))}
                    placeholder={connection.secretKeys.includes('cookie') ? 'Cookie 已加密保存；留空不改' : '小红书 Cookie'} rows={2}
                    className="w-full resize-y rounded-lg border border-rose-200 bg-white px-3 py-2 text-[10px] font-mono" />
                  <p className="text-[9px] leading-relaxed text-amber-600">只有点“保存”后才会上传，并使用后端加密密钥存入你自己的 VPS；浏览、分享和点赞权限跟随小红书原设置页。</p>
                </>}
                {isPhone && (
                  <div className="grid grid-cols-2 gap-2">
                    <input value={String(connection.settings.smtpHost || '')} onChange={(event) => patchSetting(connection.id, 'smtpHost', event.target.value)} placeholder="SMTP 主机" className="rounded-lg border border-slate-200 px-2 py-2 text-[10px]" />
                    <input inputMode="numeric" value={String(connection.settings.smtpPort || '465')} onChange={(event) => patchSetting(connection.id, 'smtpPort', Number(event.target.value) || 465)} placeholder="465" className="rounded-lg border border-slate-200 px-2 py-2 text-[10px]" />
                    <input value={String(connection.settings.smtpUser || '')} onChange={(event) => patchSetting(connection.id, 'smtpUser', event.target.value)} placeholder="发件邮箱账号" className="rounded-lg border border-slate-200 px-2 py-2 text-[10px]" />
                    <input type="password" value={secrets.smtpPassword || ''} onChange={(event) => setSecrets((current) => ({ ...current, smtpPassword: event.target.value }))} placeholder={connection.secretKeys.includes('smtpPassword') ? '邮箱授权码（已保存）' : '邮箱授权码'} className="rounded-lg border border-slate-200 px-2 py-2 text-[10px]" />
                    <input value={String(connection.settings.recipientEmail || '')} onChange={(event) => patchSetting(connection.id, 'recipientEmail', event.target.value)} placeholder="iCloud 收件邮箱" className="col-span-2 rounded-lg border border-slate-200 px-2 py-2 text-[10px]" />
                  </div>
                )}
                {isPhone && <PhoneShortcutSetup
                  config={config}
                  characters={characters}
                  initialToken={deviceToken}
                  onStatus={onStatus}
                />}
                {connection.lastHealthAt && <p className={`text-[9px] ${connection.lastHealthStatus === 'healthy' ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {connection.lastHealthStatus === 'healthy' ? '连接正常' : `连接异常：${connection.lastHealthError || '未知错误'}`} · {new Date(connection.lastHealthAt).toLocaleString()}
                </p>}
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={!canConnect || busyId === connection.id} onClick={() => void save(connection.id)}
                    className="rounded-lg bg-slate-700 py-2 text-[10px] font-bold text-white disabled:opacity-40">{busyId === connection.id ? '处理中…' : '保存'}</button>
                  <button type="button" disabled={!canConnect || busyId === connection.id} onClick={() => void test(connection.id)}
                    className="rounded-lg border border-cyan-300 bg-cyan-50 py-2 text-[10px] font-bold text-cyan-700 disabled:opacity-40">测试连接</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default BackendToolSettings;
