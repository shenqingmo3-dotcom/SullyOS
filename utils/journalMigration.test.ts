import { describe, expect, it } from 'vitest';
import type { DiaryEntry } from '../types';
import { splitLegacyExchangeDiary } from './journalMigration';

function legacyDiary(): DiaryEntry {
    return {
        id: 'legacy-diary',
        charId: 'character-1',
        date: '2026-08-11',
        userPage: { text: '用户的一天', paperStyle: 'grid', stickers: [] },
        charPage: { text: '角色的一天', paperStyle: 'plain', stickers: [] },
        timestamp: 100,
        isArchived: false,
    };
}

describe('splitLegacyExchangeDiary', () => {
    it('splits an old two-page diary into two independent entries', () => {
        const split = splitLegacyExchangeDiary(legacyDiary());
        expect(split).toHaveLength(2);
        expect(split[0]).toMatchObject({ primaryAuthor: 'user', charPage: undefined });
        expect(split[1]).toMatchObject({
            id: 'legacy-diary-character',
            primaryAuthor: 'character',
            userPage: { text: '' },
            charPage: { text: '角色的一天' },
        });
    });

    it('does not split an independent diary again', () => {
        const independent = { ...legacyDiary(), primaryAuthor: 'user' as const, charPage: undefined };
        expect(splitLegacyExchangeDiary(independent)).toEqual([independent]);
    });
});
