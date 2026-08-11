import { beforeEach, describe, expect, it } from 'vitest';
import type { DiaryEntry } from '../types';
import { DB } from './db';
import { buildDiaryCardPayload, deleteDiaryCardMessages, upsertDiaryCardMessage } from './journalCards';

const character = { name: '测试角色', avatar: '' };

function makeDiary(): DiaryEntry {
    return {
        id: 'manual-diary-local-1',
        charId: 'character-1',
        date: '2026-08-09',
        title: '窗边',
        primaryAuthor: 'character',
        userPage: { text: '', paperStyle: 'grid', stickers: [] },
        charPage: { text: '杯沿还留着一点温度。', paperStyle: 'plain', stickers: [] },
        comments: [],
        timestamp: Date.now(),
        isArchived: false,
        backendDiaryId: '11111111-1111-4111-8111-111111111111',
        origin: 'imported',
    };
}

describe('diary chat-card idempotency', () => {
    beforeEach(async () => {
        await DB.deleteDB();
    });

    it('creates exactly one card when journal sync and event polling race', async () => {
        const diary = makeDiary();
        const [fromJournal, fromEvent] = await Promise.all([
            upsertDiaryCardMessage(diary, character, '我', 'journal'),
            upsertDiaryCardMessage(diary, character, '我', 'backend-journal'),
        ]);

        expect(fromJournal.chatCardMessageId).toBe(fromEvent.chatCardMessageId);
        const messages = await DB.getMessagesByCharId(diary.charId, true);
        expect(messages).toHaveLength(1);
        expect(messages[0]?.metadata?.scoreCard?.backendDiaryId).toBe(diary.backendDiaryId);
    });

    it('repairs duplicate diary cards left by older versions', async () => {
        const diary = makeDiary();
        const card = buildDiaryCardPayload(diary, character, '我');
        const first = await DB.saveMessage({
            charId: diary.charId,
            role: 'system',
            type: 'score_card',
            content: JSON.stringify(card),
            metadata: { scoreCard: card, source: 'journal' },
        });
        await DB.saveMessage({
            charId: diary.charId,
            role: 'system',
            type: 'score_card',
            content: JSON.stringify(card),
            metadata: { scoreCard: card, source: 'backend-journal' },
        });

        const repaired = await upsertDiaryCardMessage(diary, character, '我');
        const messages = await DB.getMessagesByCharId(diary.charId, true);
        expect(repaired.chatCardMessageId).toBe(first);
        expect(messages).toHaveLength(1);
        expect(messages[0]?.id).toBe(first);
    });

    it('deletes every card belonging to a diary, including duplicates', async () => {
        const diary = makeDiary();
        const card = buildDiaryCardPayload(diary, character, '我');
        for (let index = 0; index < 2; index += 1) {
            await DB.saveMessage({
                charId: diary.charId,
                role: 'system',
                type: 'score_card',
                content: JSON.stringify(card),
                metadata: { scoreCard: card },
            });
        }
        await expect(deleteDiaryCardMessages(diary)).resolves.toHaveLength(2);
        await expect(DB.getMessagesByCharId(diary.charId, true)).resolves.toHaveLength(0);
    });
});
