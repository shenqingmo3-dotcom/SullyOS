import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildInteractionModePrompt, currentInteractionMode, extractInteractionModeDirective, inferExplicitUserMode } from './interactionMode';

describe('interactionMode', () => {
    it('默认线上，并能识别用户明确切换', () => {
        expect(currentInteractionMode({} as any)).toBe('online');
        expect(inferExplicitUserMode('我们转线下吧')).toBe('offline');
        expect(inferExplicitUserMode('回到线上模式')).toBe('online');
        expect(inferExplicitUserMode('今天吃什么')).toBeNull();
    });

    it('吞掉 AI 控制标记并保留地点和距离', () => {
        const parsed = extractInteractionModeDirective('[[INTERACTION_MODE:offline|location=食堂|distance=隔着一张桌子]]\n坐这里。');
        expect(parsed.content).toBe('坐这里。');
        expect(parsed.directive).toEqual({ mode: 'offline', location: '食堂', distance: '隔着一张桌子' });
    });

    it('线下提示允许平台工具，但不会因打开聊天页自动回线上', () => {
        const prompt = buildInteractionModePrompt({
            interactionMode: 'offline',
            interactionScene: { location: '食堂', distance: '面对面' },
        } as any, '用户');
        expect(prompt).toContain('当前是线下相处');
        expect(prompt).toContain('社交平台、网页和 MCP 等工具在两种状态下都可照常使用');
        expect(prompt).toContain('状态持续有效');
        expect(prompt).toContain('必须以 "> " 开头');
        expect(prompt).toContain('中文引号“……”');
    });

    it('聊天主提示词不再用本体规则强制回到线上', () => {
        const source = readFileSync(new URL('./chatPrompts.ts', import.meta.url), 'utf8');
        expect(source).toContain('同一互动平台行为规范');
        expect(source).toContain('线下输出格式');
        expect(source).toContain('线上输出格式');
        expect(source).toContain('follow the original SullyOS mobile-chat rules');
        expect(source).toContain('[text message]');
        expect(source).not.toContain('当前，你都是已经处于线上聊天状态了');
    });
});
