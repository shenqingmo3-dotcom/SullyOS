import { describe, expect, it } from 'vitest';
import { createBlankInvestigator, evaluateCoCRoll, rollPercentile } from './cocRules';

describe('CoC percentile rules', () => {
    it('uses 7e regular, hard, extreme, critical and conditional fumble bands', () => {
        expect(evaluateCoCRoll('7e', 1, 60)).toBe('critical');
        expect(evaluateCoCRoll('7e', 10, 60)).toBe('extreme');
        expect(evaluateCoCRoll('7e', 25, 60)).toBe('hard');
        expect(evaluateCoCRoll('7e', 55, 60)).toBe('regular');
        expect(evaluateCoCRoll('7e', 96, 60)).toBe('failure');
        expect(evaluateCoCRoll('7e', 96, 40)).toBe('fumble');
        expect(evaluateCoCRoll('7e', 100, 60)).toBe('fumble');
    });

    it('keeps 6e special success and 96-100 fumble semantics separate from 7e', () => {
        expect(evaluateCoCRoll('6e', 10, 60)).toBe('special');
        expect(evaluateCoCRoll('6e', 30, 60)).toBe('regular');
        expect(evaluateCoCRoll('6e', 96, 80)).toBe('fumble');
    });

    it('uses extra tens dice for 7e bonus and penalty dice', () => {
        const values = [0.4, 0.7, 0.2];
        const bonus = rollPercentile('7e', 50, 'regular', 1, () => values.shift() ?? 0);
        expect(bonus.candidates).toEqual([74, 24]);
        expect(bonus.roll).toBe(24);
        const penaltyValues = [0.4, 0.7, 0.2];
        const penalty = rollPercentile('7e', 50, 'regular', -1, () => penaltyValues.shift() ?? 0);
        expect(penalty.roll).toBe(74);
    });

    it('derives edition-specific HP and MP when creating investigator sheets', () => {
        expect(createBlankInvestigator('user', 'User', '7e')).toMatchObject({ age: 28, maxHp: 10, maxMp: 12 });
        expect(createBlankInvestigator('user', 'User', '6e')).toMatchObject({ maxHp: 10, maxMp: 12, san: 60 });
    });
});
