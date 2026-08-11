import { beforeEach, describe, expect, it } from 'vitest';
import { getBackendMemoryChanges } from '../backendSyncQueue';
import { openDB } from '../db';
import { MemoryLinkDB, MemoryNodeDB, MemoryVectorDB } from './db';
import { deleteGroupMemoriesByGroupId } from './groupPipeline';
import type { MemoryNode } from './types';

const charId = 'group-delete-char';
const groupId = 'group-delete-target';

const node = (id: string): MemoryNode => ({
    id,
    charId,
    content: id,
    room: 'living_room',
    tags: ['group'],
    importance: 5,
    mood: 'calm',
    embedded: true,
    createdAt: 1,
    lastAccessedAt: 1,
    accessCount: 0,
    groupId,
    groupName: '测试群',
});

describe('group memory deletion closure', () => {
    beforeEach(async () => {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['memory_nodes', 'memory_vectors', 'memory_links', 'backend_sync_queue'], 'readwrite');
            for (const store of ['memory_nodes', 'memory_vectors', 'memory_links', 'backend_sync_queue']) {
                tx.objectStore(store).clear();
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    });

    it('removes nodes, vectors and relation links and queues every backend deletion', async () => {
        await MemoryNodeDB.saveMany([node('group-node-a'), node('group-node-b')]);
        await MemoryVectorDB.saveMany([
            { memoryId: 'group-node-a', charId, vector: new Float32Array([1, 0]), dimensions: 2 },
            { memoryId: 'group-node-b', charId, vector: new Float32Array([0, 1]), dimensions: 2 },
        ]);
        await MemoryLinkDB.save({
            id: 'group-link',
            sourceId: 'group-node-a',
            targetId: 'group-node-b',
            type: 'temporal',
            strength: 0.8,
        });

        expect(await deleteGroupMemoriesByGroupId(groupId)).toEqual({ deleted: 2 });
        expect(await MemoryNodeDB.getByCharId(charId)).toEqual([]);
        expect(await MemoryVectorDB.getAllByCharId(charId)).toEqual([]);
        expect(await MemoryLinkDB.getAll()).toEqual([]);

        const deletions = (await getBackendMemoryChanges(charId)).filter(change => change.operation === 'delete');
        expect(deletions.map(change => `${change.entityType}:${change.entityId}`).sort()).toEqual([
            'memory_link:group-link',
            'memory_node:group-node-a',
            'memory_node:group-node-b',
            'memory_vector:group-node-a',
            'memory_vector:group-node-b',
        ]);
    });
});
