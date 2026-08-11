import { beforeEach, describe, expect, it } from 'vitest';
import { AnticipationDB, MemoryNodeDB } from './db';
import { getBackendMemoryChanges } from '../backendSyncQueue';
import { openDB } from '../db';

describe('memory palace deletion sync', () => {
    beforeEach(async () => {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['anticipations', 'memory_nodes', 'backend_sync_queue'], 'readwrite');
            tx.objectStore('anticipations').clear();
            tx.objectStore('memory_nodes').clear();
            tx.objectStore('backend_sync_queue').clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    });

    it('queues a backend deletion when an anticipation is removed locally', async () => {
        await AnticipationDB.save({
            id: 'anticipation-delete-1',
            charId: 'char-delete-1',
            content: '周末一起看海',
            status: 'active',
            createdAt: Date.now(),
        });

        await AnticipationDB.delete('anticipation-delete-1');

        expect(await AnticipationDB.getById('anticipation-delete-1')).toBeUndefined();
        expect(await getBackendMemoryChanges('char-delete-1')).toEqual([
            expect.objectContaining({
                entityType: 'anticipation',
                entityId: 'anticipation-delete-1',
                operation: 'delete',
            }),
        ]);
    });

    it('queues access-count changes so heartbeat sees current memory heat', async () => {
        await MemoryNodeDB.save({
            id: 'memory-touch-1',
            charId: 'char-touch-1',
            content: '一起看海的回忆',
            room: 'living_room',
            tags: ['海边'],
            importance: 6,
            mood: 'warm',
            embedded: false,
            createdAt: 1,
            lastAccessedAt: 1,
            accessCount: 0,
        });
        await MemoryNodeDB.touchAccess('memory-touch-1');

        expect(await getBackendMemoryChanges('char-touch-1')).toEqual([
            expect.objectContaining({
                entityType: 'memory_node',
                entityId: 'memory-touch-1',
                operation: 'upsert',
                payload: expect.objectContaining({ accessCount: 1 }),
            }),
        ]);
    });
});
