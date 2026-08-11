import { beforeEach, describe, expect, it } from 'vitest';
import type { BackendConversationEventRecord } from '../types';
import { DB } from './db';

const makeEvent = (): BackendConversationEventRecord => ({
  id: 'event-proactive-1',
  sequenceId: 123,
  conversationId: 'conversation-1',
  charId: 'character-1',
  charName: 'Tester',
  actorType: 'assistant',
  eventType: 'proactive_message',
  content: '我来主动找你啦。',
  metadata: {},
  occurredAt: '2026-08-09T08:00:00.000Z',
  createdAt: '2026-08-09T08:00:00.000Z',
  receivedAt: Date.now(),
});

describe('backend event backflow storage', () => {
  beforeEach(async () => {
    await DB.deleteDB();
  });

  it('stores an event and its proactive chat bubble exactly once', async () => {
    const event = makeEvent();
    const message = {
      charId: event.charId,
      role: 'assistant' as const,
      type: 'text' as const,
      content: event.content!,
      timestamp: Date.parse(event.occurredAt),
      metadata: { backendEventId: event.id },
    };

    await expect(DB.saveBackendEvent(event, message)).resolves.toMatchObject({ created: true });
    await expect(DB.saveBackendEvent(event, message)).resolves.toEqual({ created: false, messageId: undefined });

    const messages = await DB.getMessagesByCharId(event.charId, true);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.metadata?.backendEventId).toBe(event.id);

    const events = await DB.getBackendEventsByCharId(event.charId);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('proactive_message');
  });

  it('merges a backend diary comment exactly once', async () => {
    await DB.saveDiary({
      id: 'diary-local-1',
      charId: 'character-1',
      date: '2026-08-09',
      userPage: { text: '今天去散步。', paperStyle: 'grid', stickers: [] },
      timestamp: Date.now(),
      isArchived: false,
      primaryAuthor: 'user',
      backendDiaryId: '11111111-1111-4111-8111-111111111111',
      comments: [],
    });
    const comment = {
      id: 'comment-1',
      author: 'character' as const,
      content: '我看见你拍的那片云了。',
      createdAt: Date.now(),
      backendCommentId: 'backend-comment-1',
    };

    await expect(DB.mergeDiaryComment(
      'character-1',
      '11111111-1111-4111-8111-111111111111',
      comment,
    )).resolves.toMatchObject({ changed: true });
    await expect(DB.mergeDiaryComment(
      'character-1',
      '11111111-1111-4111-8111-111111111111',
      comment,
    )).resolves.toMatchObject({ changed: false });

    const diary = await DB.getDiaryByBackendId('character-1', '11111111-1111-4111-8111-111111111111');
    expect(diary?.comments).toHaveLength(1);
  });
});
