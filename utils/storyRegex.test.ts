import { describe, expect, it } from 'vitest';
import { normalizeStoryRegexScripts, parseStoryRegexFile, STORY_REGEX_PLACEMENT, storyRegexShouldRun } from './storyRegex';

describe('SillyTavern Regex 兼容', () => {
    const raw = { extensions: { regex_scripts: [{
        id: 'r1', scriptName: '隐藏草稿', findRegex: '/<draft>.*?<\\/draft>/gs', replaceString: '',
        placement: [2], promptOnly: true, markdownOnly: false, disabled: false, minDepth: 1, maxDepth: 4,
    }] } };

    it('把预设与独立文件归一成同一种结构', () => {
        const fromPreset = normalizeStoryRegexScripts(raw);
        const fromFile = parseStoryRegexFile(JSON.stringify(raw.extensions.regex_scripts));
        expect(fromPreset).toEqual(fromFile);
        expect(fromPreset[0]).toMatchObject({ name: '隐藏草稿', placement: [2], minDepth: 1, maxDepth: 4 });
    });

    it('遵循酒馆的 prompt/markdown OR 语义和深度范围', () => {
        const script = normalizeStoryRegexScripts(raw)[0];
        expect(storyRegexShouldRun(script, { placement: STORY_REGEX_PLACEMENT.aiOutput, isPrompt: true, depth: 2 })).toBe(true);
        expect(storyRegexShouldRun(script, { placement: STORY_REGEX_PLACEMENT.aiOutput, isMarkdown: true, depth: 2 })).toBe(false);
        expect(storyRegexShouldRun(script, { placement: STORY_REGEX_PLACEMENT.aiOutput, isPrompt: true, depth: 0 })).toBe(false);
    });
});
