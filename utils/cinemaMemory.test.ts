import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB } from './db';
import { observeCinemaMcpCall } from './cinemaMemory';
import { TogetherStore } from './togetherStore';
import { MemoryNodeDB } from './memoryPalace/db';

const character: any = { id: 'char-cinema', name: 'Sully', interactionMode: 'online' };
const user: any = { name: '用户', avatar: '', bio: '' };

describe('cinema MCP memory bridge', () => {
    beforeEach(async () => {
        localStorage.clear();
        await DB.deleteDB();
    });

    afterEach(async () => {
        await DB.deleteDB();
    });

    it('保存房间游标和讨论，并在结束时立即写入记忆宫殿', async () => {
        await observeCinemaMcpCall({
            serverName: 'Open Watch Cinema',
            toolName: 'cinema_open_room',
            args: { mediaId: '123456789012345678901234' },
            result: { success: true, data: { room: { id: 'room-1' }, mediaTitle: '测试电影' } },
            character,
            user,
        });

        await observeCinemaMcpCall({
            serverName: 'Open Watch Cinema',
            toolName: 'open_watch_cinema_tick',
            args: { roomId: 'room-1', consumerName: 'Sully', cursors: {} },
            result: {
                success: true,
                data: {
                    status: 'active',
                    cursors: { mediaMs: 600_000, messageId: 2, observationSequence: 3 },
                    messages: [{ id: 2, senderName: '用户', senderKind: 'human', content: '我喜欢这一段', mediaTimeMs: 600_000 }],
                },
            },
            character,
            user,
        });

        const active = (await TogetherStore.listSessions(character.id))[0];
        expect(active.cinema).toMatchObject({ roomId: 'room-1', consumerName: 'Sully', lastMediaTimeMs: 600_000 });
        expect(active.messages.map(message => message.content)).toContain('我喜欢这一段');

        await observeCinemaMcpCall({
            serverName: 'Open Watch Cinema',
            toolName: 'cinema_end_room',
            args: { roomId: 'room-1', mediaTimeMs: 600_000 },
            result: { success: true, data: { status: 'ended' } },
            character,
            user,
        });

        const completed = (await TogetherStore.listSessions(character.id))[0];
        expect(completed.endedAt).toBeTypeOf('number');
        expect(completed.summary).toContain('测试电影');
        expect(completed.summary).toContain('我喜欢这一段');
        const memories = await MemoryNodeDB.getByCharId(character.id);
        expect(memories).toHaveLength(1);
        expect(memories[0].tags).toEqual(expect.arrayContaining(['一起看', '共看', '线上']));
    });
});
