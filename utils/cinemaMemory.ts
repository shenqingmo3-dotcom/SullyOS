import type { CharacterProfile, TogetherSession, TogetherSessionMessage, UserProfile } from '../types';
import type { McpToolResult } from './mcpClient';
import { TogetherStore } from './togetherStore';
import { MemoryNodeDB } from './memoryPalace/db';
import { currentInteractionMode } from './interactionMode';
import { flushBackendMemorySyncQueue, loadBackendChatConfig } from './backendClient';

const CINEMA_TOOL_NAMES = new Set([
    'cinema_open_room',
    'open_watch_cinema_tick',
    'cinema_read_window',
    'cinema_post_message',
    'cinema_end_room',
]);

const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function findString(value: unknown, keys: Set<string>, depth = 0): string | undefined {
    if (!value || typeof value !== 'object' || depth > 5) return undefined;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (keys.has(key) && typeof child === 'string' && child.trim()) return child.trim();
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
        const found = findString(child, keys, depth + 1);
        if (found) return found;
    }
    return undefined;
}

function findNumber(value: unknown, keys: Set<string>, depth = 0): number | undefined {
    if (!value || typeof value !== 'object' || depth > 5) return undefined;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (keys.has(key) && typeof child === 'number' && Number.isFinite(child)) return child;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
        const found = findNumber(child, keys, depth + 1);
        if (found !== undefined) return found;
    }
    return undefined;
}

function isEndedResult(value: unknown): boolean {
    const endedAt = findString(value, new Set(['endedAt', 'archivedAt']));
    const status = findString(value, new Set(['status', 'state']))?.toLowerCase();
    return Boolean(endedAt || (status && ['ended', 'archived', 'closed', 'complete', 'completed'].includes(status)));
}

interface CinemaMessage {
    id: string;
    senderName: string;
    senderKind?: string;
    content: string;
    mediaTimeMs?: number;
}

function collectRoomMessages(value: unknown, parentKey = '', depth = 0, out: CinemaMessage[] = []): CinemaMessage[] {
    if (!value || typeof value !== 'object' || depth > 7) return out;
    if (Array.isArray(value)) {
        if (/messages?/i.test(parentKey)) {
            for (const entry of value) {
                if (!entry || typeof entry !== 'object') continue;
                const record = entry as Record<string, unknown>;
                const content = typeof record.content === 'string' ? record.content.trim() : '';
                const senderName = typeof record.senderName === 'string' ? record.senderName.trim() : '';
                if (!content || !senderName) continue;
                const rawId = record.id ?? record.messageId ?? `${senderName}:${record.mediaTimeMs ?? ''}:${content}`;
                out.push({
                    id: String(rawId),
                    senderName,
                    senderKind: typeof record.senderKind === 'string' ? record.senderKind : undefined,
                    content,
                    mediaTimeMs: typeof record.mediaTimeMs === 'number' ? record.mediaTimeMs : undefined,
                });
            }
        }
        for (const entry of value) collectRoomMessages(entry, parentKey, depth + 1, out);
        return out;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        collectRoomMessages(child, key, depth + 1, out);
    }
    return out;
}

function elapsedText(startedAt: number, endedAt: number): string {
    const minutes = Math.max(1, Math.round((endedAt - startedAt) / 60_000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)}小时${minutes % 60}分钟` : `${minutes}分钟`;
}

async function findActiveSession(charId: string, roomId?: string): Promise<TogetherSession | undefined> {
    const sessions = await TogetherStore.listSessions(charId);
    return sessions.find(session =>
        session.mediaType === 'movie'
        && !session.endedAt
        && (!roomId || session.cinema?.roomId === roomId)
    );
}

export async function buildActiveCinemaContext(charId: string, characterName: string): Promise<string> {
    const active = await findActiveSession(charId);
    if (!active?.cinema?.roomId) return '';
    const consumerName = active.cinema.consumerName || characterName;
    const cursors = active.cinema.cursors || {};
    return `\n\n## 正在进行的 Open Watch Cinema 共看会话
你已经以“${consumerName}”的固定身份进入影院，不要重新开房，也不要更换名字。
roomId：${active.cinema.roomId}
下一次 open_watch_cinema_tick 必须原样带回这些 cursors：${JSON.stringify(cursors)}
最近播放位置：${active.cinema.lastMediaTimeMs || 0}ms
继续观影时先 tick，只根据其防剧透窗口理解影片；要在影院里回应用户时调用 cinema_post_message。只有用户明确要求结束时才调用 cinema_end_room。`;
}

async function archiveCinemaSession(
    session: TogetherSession,
    character: CharacterProfile,
    user: UserProfile,
    endedAt = Date.now(),
): Promise<void> {
    if (session.endedAt) return;
    const discussion = session.messages
        .slice(-20)
        .map(message => `${message.role === 'user' ? user.name : character.name}：${message.content}`)
        .join('；');
    const playhead = session.cinema?.lastMediaTimeMs || 0;
    const progress = playhead > 0 ? `，看到影片约${Math.round(playhead / 60_000)}分钟处` : '';
    const summary = `${user.name}和${character.name}${session.interactionMode === 'offline' ? '线下' : '线上'}一起看了《${session.itemTitle}》${elapsedText(session.startedAt, endedAt)}${progress}。${discussion ? `期间聊到：${discussion}` : '这次观影没有留下可读取的讨论消息。'}`;
    const completed = { ...session, endedAt, summary };
    await TogetherStore.saveSession(completed);
    await MemoryNodeDB.save({
        id: uid('mem-cinema'),
        charId: character.id,
        content: summary,
        room: 'living_room',
        tags: ['一起看', '共看', session.interactionMode === 'offline' ? '线下' : '线上'],
        importance: 7,
        mood: 'warm',
        embedded: false,
        createdAt: endedAt,
        lastAccessedAt: endedAt,
        accessCount: 0,
        origin: 'system',
    });
    const backendConfig = loadBackendChatConfig();
    if (backendConfig.enabled) {
        await flushBackendMemorySyncQueue({ config: backendConfig, character, user }).catch(() => {});
    }
}

export async function observeCinemaMcpCall(input: {
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
    result: McpToolResult;
    character: CharacterProfile;
    user: UserProfile;
}): Promise<void> {
    const { serverName, toolName, args, result, character, user } = input;
    if (!CINEMA_TOOL_NAMES.has(toolName)) return;
    if (!/open[\s_-]*watch[\s_-]*cinema|影院|cinema/i.test(serverName) && !toolName.includes('cinema')) return;

    const resultRecord = result.data && typeof result.data === 'object' ? result.data as Record<string, any> : {};
    const roomRecord = resultRecord.room && typeof resultRecord.room === 'object' ? resultRecord.room : {};
    const roomId = (typeof args.roomId === 'string' ? args.roomId : undefined)
        || findString(result.data, new Set(['roomId']))
        || (typeof roomRecord.id === 'string' ? roomRecord.id : undefined)
        || (typeof resultRecord.id === 'string' ? resultRecord.id : undefined);
    if (toolName === 'cinema_open_room') {
        if (!result.success || !roomId) return;
        const existing = await findActiveSession(character.id, roomId);
        if (existing) return;
        const title = findString(result.data, new Set(['mediaTitle', 'title', 'name']))
            || (typeof args.mediaId === 'string' ? `影片 ${args.mediaId}` : '未命名影片');
        const session: TogetherSession = {
            id: uid('cinema-session'),
            itemId: `cinema:${roomId}`,
            itemTitle: title,
            mediaType: 'movie',
            charId: character.id,
            startedAt: Date.now(),
            progress: 0,
            interactionMode: currentInteractionMode(character),
            messages: [],
            cinema: {
                roomId,
                mediaId: typeof args.mediaId === 'string' ? args.mediaId : undefined,
                seenMessageIds: [],
            },
        };
        await TogetherStore.saveSession(session);
        return;
    }

    const active = await findActiveSession(character.id, roomId);
    if (!active) return;
    const seen = new Set(active.cinema?.seenMessageIds || []);
    const additions: TogetherSessionMessage[] = [];
    for (const message of collectRoomMessages(result.data)) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        const fromCharacter = message.senderKind === 'ai' || message.senderName === character.name;
        additions.push({
            id: `cinema-message:${message.id}`,
            role: fromCharacter ? 'assistant' : 'user',
            content: message.content,
            createdAt: Date.now(),
        });
    }
    if (toolName === 'cinema_post_message' && result.success && typeof args.content === 'string') {
        const messageId = `posted:${args.mediaTimeMs ?? ''}:${args.content}`;
        if (!seen.has(messageId)) {
            seen.add(messageId);
            additions.push({
                id: `cinema-message:${messageId}`,
                role: 'assistant',
                content: args.content,
                createdAt: Date.now(),
            });
        }
    }
    const mediaTimeMs = (typeof args.mediaTimeMs === 'number' ? args.mediaTimeMs : undefined)
        ?? findNumber(result.data, new Set(['mediaTimeMs', 'playheadMs', 'mediaMs']))
        ?? active.cinema?.lastMediaTimeMs;
    const cursors = result.data && typeof result.data === 'object'
        ? (result.data as any).cursors || (result.data as any).nextCursors || active.cinema?.cursors
        : active.cinema?.cursors;
    const updated: TogetherSession = {
        ...active,
        progress: active.progress,
        messages: [...active.messages, ...additions].slice(-200),
        cinema: {
            ...active.cinema!,
            consumerName: typeof args.consumerName === 'string' ? args.consumerName : active.cinema?.consumerName,
            cursors,
            lastMediaTimeMs: mediaTimeMs,
            seenMessageIds: [...seen].slice(-500),
        },
    };
    await TogetherStore.saveSession(updated);

    const endedByTool = toolName === 'cinema_end_room' && result.success;
    const endedByTick = result.success && isEndedResult(result.data);
    const endedByRoomError = !result.success
        && toolName === 'open_watch_cinema_tick'
        && /ended|archived|room[^\n]*(?:not found|closed)|no active room/i.test(result.error || '');
    if (endedByTool || endedByTick || endedByRoomError) {
        await archiveCinemaSession(updated, character, user);
    }
}
