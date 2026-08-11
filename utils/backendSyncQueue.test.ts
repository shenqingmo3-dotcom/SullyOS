import { beforeEach, describe, expect, it } from 'vitest';
import { DB } from './db';
import {
    enqueueBackendChatMessageDeletes,
    getBackendMemoryChanges,
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
});
