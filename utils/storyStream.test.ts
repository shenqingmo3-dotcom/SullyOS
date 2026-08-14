import { describe, expect, it } from 'vitest';
import { appendStoryContinuation, finalStoryStreamStatus, readStoryCompletion } from './storyStream';

describe('剧情单楼层流式状态', () => {
    it('读取正文、可展示 reasoning、finish reason 与 usage', () => {
        expect(readStoryCompletion({ choices: [{ message: { content: [{ text: '正文' }], reasoning_content: '推演' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })).toEqual({
            content: '正文', reasoning: '推演', finishReason: 'length', usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        });
        expect(finalStoryStreamStatus('length')).toBe('length');
        expect(finalStoryStreamStatus('stop')).toBe('complete');
    });

    it('续写追加同一正文，并避免供应商回传整段时重复', () => {
        expect(appendStoryContinuation('第一段', '第二段')).toBe('第一段\n\n第二段');
        expect(appendStoryContinuation('第一段', '第一段\n第二段')).toBe('第一段\n第二段');
    });
});
