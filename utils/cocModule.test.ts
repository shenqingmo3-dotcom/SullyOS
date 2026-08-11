import { describe, expect, it } from 'vitest';
import { normalizeCoCModuleAnalysis } from './cocModule';

describe('CoC module analysis normalization', () => {
    it('keeps clue and check links while filling safe fallbacks', () => {
        const result = normalizeCoCModuleAnalysis({
            title: '雾港',
            clues: [{ id: 'clue-map', name: '潮湿地图', required: true }],
            checks: [{ id: 'check-map', skill: '侦查', difficulty: 'hard', clueIds: ['clue-map'] }],
        }, '导入模组');
        expect(result.clues[0]).toMatchObject({ id: 'clue-map', required: true });
        expect(result.clues[0].fallback).toContain('关键线索');
        expect(result.checks[0]).toMatchObject({ difficulty: 'hard', clueIds: ['clue-map'] });
    });
});
