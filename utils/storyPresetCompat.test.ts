import { describe, expect, it } from 'vitest';
import type { StoryTheaterPreset } from '../types';
import {
    compileStoryPresetDocument,
    getStoryPresetExecutionPrompts,
    normalizeSillyTavernPresetDocument,
    serializeStoryPreset,
    setStoryPresetPromptEnabled,
    SILLYTAVERN_COMPAT_BASELINE,
} from './storyPresetCompat';

const makePreset = (value: Record<string, unknown>): StoryTheaterPreset => ({
    id: 'fixture',
    name: 'Fixture',
    format: 'sillytavern-chat-completion',
    document: normalizeSillyTavernPresetDocument(value, 'Fixture'),
    createdAt: 1,
    updatedAt: 1,
});

describe('SillyTavern 预设规范化', () => {
    it('以 100001 order 为唯一执行真源，并把未引用 prompt 与 Regex 完整保留', () => {
        const prompts = Array.from({ length: 377 }, (_, index) => ({
            identifier: index === 376 ? 'enhanceDefinitions' : `p${index}`,
            name: `提示 ${index}`,
            enabled: true,
            role: index % 17 === 0 ? 'assistant' : 'system',
            content: index === 376 ? 'UNREFERENCED_SHOULD_NOT_RUN' : `正文 ${index}`,
            injection_position: 0,
            injection_trigger: [],
            custom_prompt_field: `keep-${index}`,
        }));
        const order = prompts.slice(0, 359).map((prompt, index) => ({ identifier: prompt.identifier, enabled: index !== 10 }));
        const preset = makePreset({
            name: '小冰块形状脱敏夹具',
            prompts,
            prompt_order: [
                { character_id: 5, order: [{ identifier: 'enhanceDefinitions', enabled: true }] },
                { character_id: 100001, order },
            ],
            extensions: {
                regex_scripts: Array.from({ length: 24 }, (_, index) => ({ id: `r${index}`, scriptName: `Regex ${index}`, disabled: index % 2 === 0, custom_regex_field: index })),
                tavern_helper: { enabled: false, script: 'doNotRun()' },
            },
            unknown_root_field: { retained: true },
        });

        expect(preset.document.source?.baseline).toBe(SILLYTAVERN_COMPAT_BASELINE);
        expect(preset.document.source?.orderCharacterId).toBe(100001);
        expect(preset.document.prompts).toHaveLength(377);
        expect(preset.document.source?.order).toHaveLength(359);
        expect(preset.document.source?.unreferencedPromptIds).toHaveLength(18);
        expect(preset.document.source?.unreferencedPromptIds).toContain('enhanceDefinitions');
        expect(getStoryPresetExecutionPrompts(preset.document)).toHaveLength(359);
        expect(getStoryPresetExecutionPrompts(preset.document)[10].enabled).toBe(false);
        expect(preset.document.compatibility?.filter(item => item.fieldPath.startsWith('extensions.regex_scripts['))).toHaveLength(24);

        const compiled = compileStoryPresetDocument({
            document: preset.document,
            slots: { actors: '', persona: '', scenario: '', worldBefore: '', worldAfter: '' },
            userName: '用户',
            characterNames: ['角色'],
            seed: 'fixture',
        });
        expect(compiled.messages.map(message => message.content).join('\n')).not.toContain('UNREFERENCED_SHOULD_NOT_RUN');

        const exported = JSON.parse(serializeStoryPreset(preset));
        expect(exported.unknown_root_field).toEqual({ retained: true });
        expect(exported.extensions.regex_scripts).toHaveLength(24);
        expect(exported.prompts[0].custom_prompt_field).toBe('keep-0');
        expect(exported.prompt_order[1].order).toHaveLength(359);
    });

    it('保留重复引用，未知引用明确报告但不猜测执行', () => {
        const preset = makePreset({
            prompts: [{ identifier: 'known', name: '已知', role: 'system', content: 'K {{system_init}}' }],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'known', enabled: true },
                { identifier: 'missing', enabled: true },
                { identifier: 'known', enabled: false },
            ] }],
        });
        expect(preset.document.source?.order.map(item => item.identifier)).toEqual(['known', 'missing', 'known']);
        expect(getStoryPresetExecutionPrompts(preset.document)).toHaveLength(2);
        expect(preset.document.compatibility).toEqual(expect.arrayContaining([
            expect.objectContaining({ resourceId: 'missing', level: '输入无效', executes: false }),
            expect.objectContaining({ resourceId: 'known', reason: expect.stringContaining('2 次引用') }),
            expect.objectContaining({ resourceId: 'macro:system_init:known', level: '部分支持', executes: false }),
        ]));
    });

    it('编辑开关同时更新 order 真源，prompt 本体只保留兼容显示值', () => {
        const preset = makePreset({
            prompts: [{ identifier: 'a', role: 'system', content: 'A', enabled: true }],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'a', enabled: false }] }],
        });
        const enabled = setStoryPresetPromptEnabled(preset.document, 'a', true);
        expect(enabled.prompts[0].enabled).toBe(true);
        expect(enabled.source?.order[0].enabled).toBe(true);
    });
});

describe('唯一 Prompt Builder 与宏', () => {
    const document = normalizeSillyTavernPresetDocument({
        assistant_prefill: 'PREFILL {{getvar::tone}}',
        prompts: [
            { identifier: 'set', role: 'system', content: '{{setvar::tone::deep}}{{setvar::count::1}}' },
            { identifier: 'oldest', role: 'system', content: 'OLDEST {{incvar::count}}{{getvar::count}}', injection_position: 1, injection_depth: 99, injection_order: 5 },
            { identifier: 'before-latest-b', role: 'assistant', content: 'B', injection_position: 1, injection_depth: 1, injection_order: 20 },
            { identifier: 'before-latest-a', role: 'user', content: 'A', injection_position: 1, injection_depth: 1, injection_order: 10 },
            { identifier: 'after-latest', role: 'system', content: 'AFTER', injection_position: 1, injection_depth: 0 },
            { identifier: 'chatHistory', role: 'system', content: '' },
            { identifier: 'macros', role: 'system', content: '{{#if tone == deep}}DEEP{{else}}SHALLOW{{/if}} {{addvar::count::3}}{{getvar::count}} {{pick::潮::汐}} {{uuid}} {{unknownMacro}} {{charDepthPrompt}}' },
            { identifier: 'regen', role: 'assistant', content: 'REGENERATE_ONLY', injection_trigger: ['regenerate'] },
        ],
        prompt_order: [{ character_id: 100001, order: ['set', 'oldest', 'before-latest-b', 'before-latest-a', 'after-latest', 'chatHistory', 'macros', 'regen'].map(identifier => ({ identifier, enabled: true })) }],
    }, '宏夹具');

    const compile = (trigger: 'normal' | 'regenerate' = 'normal') => compileStoryPresetDocument({
        document,
        slots: { actors: 'ACTORS', persona: 'PERSONA', scenario: 'SCENE', worldBefore: '', worldAfter: '' },
        history: [{ role: 'user', content: 'H1' }, { role: 'assistant', content: 'H2' }],
        trigger,
        userName: '条条',
        characterNames: ['Sully'],
        variables: {},
        seed: 'same-seed',
        now: new Date('2026-08-14T09:30:00.000Z'),
        lastUserMessage: 'H1',
    });

    it('按 depth、order、role 插入历史，并跨 prompt 共享变量', () => {
        const result = compile();
        expect(result.messages.map(message => `${message.role}:${message.content}`)).toEqual([
            'system:OLDEST 2',
            'user:H1',
            'user:A',
            'assistant:B',
            'assistant:H2',
            'system:AFTER',
            expect.stringMatching(/^system:DEEP 5 (潮|汐) [0-9a-f-]+ \{\{unknownMacro\}\} \{\{charDepthPrompt\}\}$/),
        ]);
        expect(result.variables).toEqual({ tone: 'deep', count: '5' });
        expect(result.assistantPrefill).toEqual({ role: 'assistant', content: 'PREFILL deep' });
        expect(result.report).toEqual(expect.arrayContaining([
            expect.objectContaining({ resourceId: 'macro:unknownmacro', level: '部分支持' }),
            expect.objectContaining({ resourceId: 'macro:chardepthprompt', level: '部分支持' }),
        ]));
    });

    it('相同 seed 得到相同 pick/uuid，Regenerate 只增加对应 trigger 条目', () => {
        expect(compile()).toEqual(compile());
        const regenerated = compile('regenerate');
        expect(regenerated.messages.at(-1)).toEqual({ role: 'assistant', content: 'REGENERATE_ONLY' });
    });
});
