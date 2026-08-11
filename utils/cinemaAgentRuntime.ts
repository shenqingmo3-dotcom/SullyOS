import type { APIConfig, CharacterProfile, GroupProfile, RealtimeConfig, TogetherSession, UserProfile } from '../types';
import { DB } from './db';
import { TogetherStore } from './togetherStore';
import { callMcpTool, getEnabledMcpServers } from './mcpClient';
import { observeCinemaMcpCall } from './cinemaMemory';
import { buildChatRequestPayload } from './chatRequestPayload';
import { extractContent, safeResponseJson } from './safeApi';

const LOOP_MS = 15_000;
const IDLE_MS = 5_000;

function hasFreshMaterial(value: unknown, key = '', depth = 0): boolean {
    if (!value || typeof value !== 'object' || depth > 7) return false;
    if (Array.isArray(value)) {
        if (value.length > 0 && /messages?|dialogue|observations?|storyboards?|motionEvents?/i.test(key)) return true;
        return value.some(item => hasFreshMaterial(item, key, depth + 1));
    }
    return Object.entries(value as Record<string, unknown>)
        .some(([childKey, child]) => hasFreshMaterial(child, childKey, depth + 1));
}

function findMediaTimeMs(value: unknown, depth = 0): number | undefined {
    if (!value || typeof value !== 'object' || depth > 6) return undefined;
    for (const key of ['mediaTimeMs', 'playheadMs', 'mediaMs']) {
        const child = (value as Record<string, unknown>)[key];
        if (typeof child === 'number' && Number.isFinite(child)) return child;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
        const found = findMediaTimeMs(child, depth + 1);
        if (found !== undefined) return found;
    }
    return undefined;
}

function parseDecision(raw: string): { speak: boolean; content: string } {
    const block = raw.match(/\{[\s\S]*\}/)?.[0] || '';
    try {
        const parsed = JSON.parse(block);
        return {
            speak: parsed?.speak === true && typeof parsed?.content === 'string' && parsed.content.trim().length > 0,
            content: typeof parsed?.content === 'string' ? parsed.content.trim().slice(0, 800) : '',
        };
    } catch {
        return { speak: false, content: '' };
    }
}

async function activeCinemaSessions(): Promise<TogetherSession[]> {
    return (await TogetherStore.listSessions()).filter(session => session.mediaType === 'movie' && !session.endedAt && !!session.cinema?.roomId);
}

export function startCinemaAgentRuntime(input: {
    characters: CharacterProfile[];
    user: UserProfile;
    groups: GroupProfile[];
    apiConfig: APIConfig;
    realtimeConfig: RealtimeConfig;
}): () => void {
    let stopped = false;
    let timer: number | undefined;

    const schedule = (delay: number) => {
        if (stopped) return;
        timer = window.setTimeout(() => { void run(); }, delay);
    };

    const run = async () => {
        if (stopped) return;
        try {
            const sessions = await activeCinemaSessions();
            if (sessions.length === 0) { schedule(IDLE_MS); return; }
            for (const session of sessions) {
                if (stopped) return;
                const character = input.characters.find(item => item.id === session.charId);
                if (!character || !session.cinema) continue;
                const server = getEnabledMcpServers(character.id).find(item =>
                    item.tools?.some(tool => tool.name === 'open_watch_cinema_tick')
                    && item.tools?.some(tool => tool.name === 'cinema_post_message')
                );
                if (!server) continue;
                const tickArgs = {
                    roomId: session.cinema.roomId,
                    consumerName: session.cinema.consumerName || character.name,
                    cursors: session.cinema.cursors || {},
                };
                const tick = await callMcpTool(server, 'open_watch_cinema_tick', tickArgs);
                if (stopped) return;
                await observeCinemaMcpCall({
                    serverName: server.name,
                    toolName: 'open_watch_cinema_tick',
                    args: tickArgs,
                    result: tick,
                    character,
                    user: input.user,
                });
                if (!tick.success || !hasFreshMaterial(tick.data)) continue;
                if (!input.apiConfig.baseUrl || !input.apiConfig.model) continue;

                const history = await DB.getRecentMessagesByCharId(character.id, Math.min(character.contextLimit || 500, 300));
                const [emojis, categories] = await Promise.all([DB.getEmojis(), DB.getEmojiCategories()]);
                const payload = await buildChatRequestPayload({
                    char: character,
                    userProfile: input.user,
                    groups: input.groups,
                    emojis,
                    categories,
                    historyMsgs: history,
                    recentMsgsHint: history.slice(-100),
                    contextLimit: Math.min(character.contextLimit || 500, 300),
                    realtimeConfig: input.realtimeConfig,
                    recallQueryHint: `一起看电影 ${session.itemTitle}`,
                });
                if (stopped) return;
                const tickText = JSON.stringify(tick.data).slice(0, 24_000);
                const response = await fetch(`${input.apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${input.apiConfig.apiKey || 'sk-none'}`,
                    },
                    body: JSON.stringify({
                        model: input.apiConfig.model,
                        temperature: input.apiConfig.temperature ?? 0.85,
                        stream: false,
                        messages: [...payload.fullMessages, {
                            role: 'user',
                            content: `[影院后台观影回合]\n下面是刚刚通过 open_watch_cinema_tick 得到的真实增量：\n${tickText}\n\n判断你此刻是否真的会在影院里说一句话。用户直接对你说话、出现你很想分享的具体反应、或需要回应时可以说；普通镜头推进就安静观看，不要机械解说，也不要剧透 tick 以外内容。只返回 JSON：{"speak":true或false,"content":"要发进影院的一句话；不说则为空"}`,
                        }],
                    }),
                });
                const data = await safeResponseJson(response);
                if (stopped) return;
                if (!response.ok) continue;
                const decision = parseDecision(extractContent(data).trim());
                if (!decision.speak) continue;
                const latest = (await activeCinemaSessions()).find(item => item.id === session.id);
                if (!latest?.cinema) continue;
                const postArgs = {
                    roomId: latest.cinema.roomId,
                    content: decision.content,
                    mediaTimeMs: findMediaTimeMs(tick.data) ?? latest.cinema.lastMediaTimeMs ?? 0,
                    senderName: latest.cinema.consumerName || character.name,
                };
                const posted = await callMcpTool(server, 'cinema_post_message', postArgs);
                if (stopped) return;
                await observeCinemaMcpCall({
                    serverName: server.name,
                    toolName: 'cinema_post_message',
                    args: postArgs,
                    result: posted,
                    character,
                    user: input.user,
                });
            }
        } catch (error) {
            console.warn('[CinemaRuntime] 后台观影轮询失败:', error);
        }
        schedule(LOOP_MS);
    };

    schedule(1_000);
    return () => {
        stopped = true;
        if (timer !== undefined) window.clearTimeout(timer);
    };
}
