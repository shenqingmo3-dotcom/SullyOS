import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FullBackupData, TogetherLibraryItem, TogetherSession } from '../types';
import { DB, openDB } from './db';
import { TogetherStore } from './togetherStore';

const item: TogetherLibraryItem = {
    id: 'book-1',
    type: 'novel',
    title: '海边的书',
    text: '第一段',
    createdAt: 1,
    updatedAt: 1,
};

const session: TogetherSession = {
    id: 'session-1',
    itemId: item.id,
    itemTitle: item.title,
    charId: 'char-1',
    mediaType: 'novel',
    startedAt: 1,
    interactionMode: 'online',
    progress: 0,
    messages: [],
    annotations: [],
};

describe('second-edition backup store coverage', () => {
    beforeEach(async () => {
        const db = await openDB();
        for (const name of ['together_items', 'together_sessions', 'backend_sync_queue', 'backend_events']) {
            const tx = db.transaction(name, 'readwrite');
            tx.objectStore(name).clear();
            await new Promise<void>((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
        }
    });

    it('restores together sessions, pending sync work and backend event mirrors', async () => {
        const data: FullBackupData = {
            timestamp: 1,
            version: 3,
            togetherItems: [item],
            togetherSessions: [session],
            backendSyncQueue: [{
                key: 'char-1:chat_message:7', charId: 'char-1', entityType: 'chat_message',
                entityId: '7', operation: 'delete', updatedAt: 3,
            }],
            backendEvents: [{
                id: 'event-1', sequenceId: 1, conversationId: 'conversation-1', charId: 'char-1',
                actorType: 'assistant', eventType: 'platform_share', content: '分享', metadata: {},
                occurredAt: '2026-08-12T00:00:00.000Z', createdAt: '2026-08-12T00:00:01.000Z', receivedAt: 4,
            }],
        };

        await DB.importFullData(data);

        expect(await TogetherStore.listItems()).toEqual([item]);
        expect(await TogetherStore.listSessions('char-1')).toEqual([session]);
        const db = await openDB();
        for (const [name, key] of [
            ['backend_sync_queue', 'char-1:chat_message:7'],
            ['backend_events', 'event-1'],
        ] as const) {
            const value = await new Promise<unknown>((resolve, reject) => {
                const request = db.transaction(name, 'readonly').objectStore(name).get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            expect(value).toBeTruthy();
        }

        const exported = await DB.exportFullData();
        expect(exported.togetherItems).toEqual([item]);
        expect(exported.togetherSessions).toEqual([session]);
        expect(exported.backendSyncQueue).toHaveLength(1);
        expect(exported.backendEvents).toHaveLength(1);
    });
});
