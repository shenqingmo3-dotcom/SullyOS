import { describe, expect, it } from 'vitest';
import { normalizeOfflineBubbleFormatting } from './offlineBubbleFormat';

describe('normalizeOfflineBubbleFormatting', () => {
    it('splits inline narration and dialogue into separate bubble lines', () => {
        expect(normalizeOfflineBubbleFormatting(
            '> 她走到你身边。“今天累不累？” > 她低头看着你。',
        )).toBe([
            '> 她走到你身边。',
            '“今天累不累？”',
            '> 她低头看着你。',
        ].join('\n'));
    });

    it('keeps already separated narration and dialogue unchanged', () => {
        const content = '> 她笑了笑。\n“我没事，只是有点困。”';
        expect(normalizeOfflineBubbleFormatting(content)).toBe(content);
    });

    it('splits dialogue that incorrectly starts with a closing Chinese quote', () => {
        expect(normalizeOfflineBubbleFormatting(
            '> 他原地跳了一下。  ”看看我。',
        )).toBe([
            '> 他原地跳了一下。',
            '”看看我。',
        ].join('\n'));
    });

    it('splits paired ASCII-quoted dialogue from narration', () => {
        expect(normalizeOfflineBubbleFormatting(
            '> 他抬起头。 "Look at me." > 他笑了。',
        )).toBe([
            '> 他抬起头。',
            '"Look at me."',
            '> 他笑了。',
        ].join('\n'));
    });

    it('does not guess whether unmarked prose is narration or dialogue', () => {
        const content = '她看了看窗外，今天的雨似乎不会停。';
        expect(normalizeOfflineBubbleFormatting(content)).toBe(content);
    });

    it('does not split unmatched quotation marks', () => {
        const content = '“这句话还没有结束';
        expect(normalizeOfflineBubbleFormatting(content)).toBe(content);
    });
});
