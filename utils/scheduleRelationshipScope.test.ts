import { describe, expect, it } from 'vitest';
import { getCharacterAnniversaries } from './scheduleRelationshipScope';

describe('schedule relationship scope', () => {
    it('keeps each character anniversary archive independent', () => {
        const anniversaries = [
            { id: 'a', title: '和 Sully 相遇', date: '2026-01-01', charId: 'sully' },
            { id: 'b', title: '和 Mira 旅行', date: '2026-02-02', charId: 'mira' },
        ];

        expect(getCharacterAnniversaries(anniversaries, 'mira')).toEqual([anniversaries[1]]);
        expect(getCharacterAnniversaries(anniversaries, '')).toEqual([]);
    });
});
