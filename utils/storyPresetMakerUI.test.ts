import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import StoryPresetMaker from '../components/date/story/StoryPresetMaker';
import { normalizeSillyTavernPresetDocument } from './storyPresetCompat';

it('在制作器顶部显示 order、未引用项和四级兼容报告', () => {
    const document = normalizeSillyTavernPresetDocument({
        prompts: [
            { identifier: 'main', name: '主提示', role: 'system', content: '正文' },
            { identifier: 'orphan', name: '未引用', role: 'system', content: '不执行' },
        ],
        prompt_order: [{ character_id: 100001, order: [
            { identifier: 'main', enabled: true },
            { identifier: 'missing', enabled: true },
        ] }],
        extensions: { regex_scripts: [{ id: 'regex-1', scriptName: '显示正则', disabled: false }] },
    }, '测试预设');
    const html = renderToStaticMarkup(React.createElement(StoryPresetMaker, {
        preset: { id: 'preset', name: document.name, format: 'sillytavern-chat-completion', document, createdAt: 1, updatedAt: 1 },
        onBack: () => undefined,
        onSave: () => undefined,
        onOpenCopy: () => undefined,
    }));

    expect(html).toContain('SillyTavern 1.18.0/51ad27f');
    expect(html).toContain('2 个顺序项');
    expect(html).toContain('1 个未引用 prompt');
    expect(html).toContain('完整支持');
    expect(html).toContain('已保存但不执行');
    expect(html).toContain('输入无效');
    expect(html).toContain('查看全部 4 项');
});
