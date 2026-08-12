import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import {
    acknowledgeBackendMemoryChanges,
    enqueueBackendChatMessageDeletes,
    enqueueBackendMemoryChange,
    getBackendMemoryChanges,
    getBackendMemoryChangesByKeys,
} from './backendSyncQueue';

describe('backend deletion queue', () => {
    beforeEach(async () => {
        await DB.deleteDB();
    });

    it('keeps local message ids and backend event ids as distinct tombstones', async () => {
        await enqueueBackendChatMessageDeletes('character-1', [
            { id: 10 },
            { id: 11, metadata: { backendEventId: '11111111-1111-4111-8111-111111111111' } },
        ]);
        const changes = await getBackendMemoryChanges('character-1');
        expect(changes).toHaveLength(2);
        expect(changes).toEqual(expect.arrayContaining([
            expect.objectContaining({ entityType: 'chat_message', entityId: '10', operation: 'delete' }),
            expect.objectContaining({
                entityType: 'backend_event',
                entityId: '11111111-1111-4111-8111-111111111111',
                operation: 'delete',
            }),
        ]));
    });

    it('atomically queues tombstones for private messages deleted through the shared DB API', async () => {
        const localId = await DB.saveMessage({
            charId: 'character-1', role: 'user', type: 'text', content: 'private local message',
        });
        const backendId = await DB.saveMessage({
            charId: 'character-1', role: 'assistant', type: 'text', content: 'backend reply',
            metadata: { backendEventId: '22222222-2222-4222-8222-222222222222' },
        });
        const groupId = await DB.saveMessage({
            charId: 'character-1', groupId: 'group-1', role: 'assistant', type: 'text', content: 'group message',
        });

        await DB.deleteMessages([localId, backendId, groupId]);

        expect(await getBackendMemoryChanges('character-1')).toEqual(expect.arrayContaining([
            expect.objectContaining({ entityType: 'chat_message', entityId: String(localId), operation: 'delete' }),
            expect.objectContaining({
                entityType: 'backend_event',
                entityId: '22222222-2222-4222-8222-222222222222',
                operation: 'delete',
            }),
        ]));
        expect(await getBackendMemoryChanges('character-1')).toHaveLength(2);
    });

    it('does not acknowledge a newer write that reused the same queue key', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(100);
        await enqueueBackendMemoryChange({
            charId: 'character-1', entityType: 'memory_node', entityId: 'memory-1',
            operation: 'upsert', payload: { content: 'old' },
        });
        const [sent] = await getBackendMemoryChanges('character-1');

        vi.mocked(Date.now).mockReturnValue(200);
        await enqueueBackendMemoryChange({
            charId: 'character-1', entityType: 'memory_node', entityId: 'memory-1',
            operation: 'upsert', payload: { content: 'new' },
        });
        await acknowledgeBackendMemoryChanges([sent!]);

        expect(await getBackendMemoryChanges('character-1')).toEqual([
            expect.objectContaining({ updatedAt: 200, payload: { content: 'new' } }),
        ]);
        vi.restoreAllMocks();
    });

    it('can read a newly queued deletion even when older work fills the normal batch', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(100);
        for (let index = 0; index < 205; index += 1) {
            await enqueueBackendMemoryChange({
                charId: 'character-1', entityType: 'memory_node', entityId: `old-${index}`,
                operation: 'upsert', payload: { content: 'older queued work' },
            });
        }
        vi.mocked(Date.now).mockReturnValue(200);
        await enqueueBackendChatMessageDeletes('character-1', [{ id: 999 }]);

        const regular = await getBackendMemoryChanges('character-1', 200);
        expect(regular.some(change => change.entityId === '999')).toBe(false);
        const priority = await getBackendMemoryChangesByKeys(
            'character-1',
            ['character-1:chat_message:999'],
        );
        expect(priority).toEqual([
            expect.objectContaining({ entityType: 'chat_message', entityId: '999', operation: 'delete' }),
        ]);
        vi.restoreAllMocks();
    });
});
