export type StoryStreamStatus = 'streaming' | 'complete' | 'stopped' | 'interrupted' | 'length';

export interface StoryCompletionResult {
    content: string;
    reasoning: string;
    finishReason?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

const textParts = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(part => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const item = part as Record<string, unknown>;
        return textParts(item.text ?? item.content ?? item.value);
    }).join('');
    if (value && typeof value === 'object') {
        const item = value as Record<string, unknown>;
        return textParts(item.text ?? item.content ?? item.value);
    }
    return '';
};

export const readStoryCompletion = (data: any): StoryCompletionResult => {
    const choice = data?.choices?.[0] || {};
    const message = choice.message || {};
    const usage = data?.usage || {};
    return {
        content: textParts(message.content),
        reasoning: textParts(message.reasoning_content ?? message.reasoning ?? message.thinking),
        finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined,
        usage: {
            ...(Number.isFinite(Number(usage.prompt_tokens)) ? { promptTokens: Number(usage.prompt_tokens) } : {}),
            ...(Number.isFinite(Number(usage.completion_tokens)) ? { completionTokens: Number(usage.completion_tokens) } : {}),
            ...(Number.isFinite(Number(usage.total_tokens)) ? { totalTokens: Number(usage.total_tokens) } : {}),
        },
    };
};

export const appendStoryContinuation = (base: string, addition: string): string => {
    if (!addition) return base;
    if (!base) return addition;
    if (addition.startsWith(base)) return addition;
    return `${base}${base.endsWith('\n') || addition.startsWith('\n') ? '' : '\n\n'}${addition}`;
};

export const finalStoryStreamStatus = (finishReason?: string): StoryStreamStatus => finishReason === 'length' ? 'length' : 'complete';
