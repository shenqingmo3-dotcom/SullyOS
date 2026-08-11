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
        expect(prompt).toContain('小红书、X、网页和 MCP 等工具在两种状态下都可照常使用');
        expect(prompt).toContain('状态持续有效');
    });
});
