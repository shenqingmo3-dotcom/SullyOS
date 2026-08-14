import type { StoryRegexScript } from '../types';

export const STORY_REGEX_PLACEMENT = {
    markdown: 0,
    userInput: 1,
    aiOutput: 2,
    slashCommand: 3,
    worldInfo: 5,
    reasoning: 6,
} as const;

export interface StoryRegexContext {
    placement: number;
    isMarkdown?: boolean;
    isPrompt?: boolean;
    isEdit?: boolean;
    depth?: number;
    variables?: Record<string, string>;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const numberOrUndefined = (value: unknown): number | undefined => value === null || value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value);

export const normalizeStoryRegexScripts = (value: unknown): StoryRegexScript[] => {
    const root = record(value);
    const source = Array.isArray(value)
        ? value
        : array(root.regex_scripts).length > 0
            ? array(root.regex_scripts)
            : array(record(root.extensions).regex_scripts);
    return source.map((item, sourceIndex) => {
        const raw = record(item);
        const id = String(raw.id || raw.scriptName || raw.name || `regex_${sourceIndex + 1}`);
        return {
            id,
            name: String(raw.scriptName || raw.name || id),
            findRegex: typeof raw.findRegex === 'string' ? raw.findRegex : '',
            replaceString: typeof raw.replaceString === 'string' ? raw.replaceString : '',
            trimStrings: array(raw.trimStrings).map(String),
            placement: array(raw.placement).map(Number).filter(Number.isFinite),
            disabled: raw.disabled === true,
            markdownOnly: raw.markdownOnly === true,
            promptOnly: raw.promptOnly === true,
            runOnEdit: raw.runOnEdit === true,
            substituteRegex: raw.substituteRegex === 1 || raw.substituteRegex === 2 ? raw.substituteRegex : 0,
            ...(numberOrUndefined(raw.minDepth) !== undefined ? { minDepth: numberOrUndefined(raw.minDepth) } : {}),
            ...(numberOrUndefined(raw.maxDepth) !== undefined ? { maxDepth: numberOrUndefined(raw.maxDepth) } : {}),
            sourceIndex,
        };
    });
};

export const parseStoryRegexFile = (text: string): StoryRegexScript[] => {
    const scripts = normalizeStoryRegexScripts(JSON.parse(text));
    if (scripts.length === 0) throw new Error('文件中没有 Regex 脚本');
    return scripts;
};

export const storyRegexShouldRun = (script: StoryRegexScript, context: StoryRegexContext): boolean => {
    if (script.disabled || !script.findRegex || !script.placement.includes(context.placement)) return false;
    const surfaceMatches = (script.markdownOnly && context.isMarkdown)
        || (script.promptOnly && context.isPrompt)
        || (!script.markdownOnly && !script.promptOnly && !context.isMarkdown && !context.isPrompt);
    if (!surfaceMatches || (context.isEdit && !script.runOnEdit)) return false;
    if (typeof context.depth === 'number') {
        if (script.minDepth !== undefined && script.minDepth >= -1 && context.depth < script.minDepth) return false;
        if (script.maxDepth !== undefined && script.maxDepth >= 0 && context.depth > script.maxDepth) return false;
    }
    return true;
};

const substitute = (value: string, variables: Record<string, string> = {}, escaped = false): string => value.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (whole, key: string) => {
    const resolved = variables[key.toLowerCase()] ?? variables[key];
    if (resolved === undefined) return whole;
    return escaped ? resolved.replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/g, '\\$&') : resolved;
});

interface WorkerReply { requestId: number; output?: string; error?: string }

/** 所有 Regex 只走这一条 Worker 路径；超时脚本会被跳过，不在主线程补跑。 */
export const runStoryRegex = async (
    input: string,
    scripts: StoryRegexScript[] | undefined,
    context: StoryRegexContext,
    timeoutMs = 300,
): Promise<string> => {
    const runnable = (scripts || []).filter(script => storyRegexShouldRun(script, context));
    if (!input || runnable.length === 0 || typeof Worker === 'undefined') return input;
    let worker = new Worker(new URL('./storyRegexWorker.ts', import.meta.url), { type: 'module' });
    let output = input;
    try {
        for (let index = 0; index < runnable.length; index += 1) {
            const script = runnable[index];
            const prepared = {
                ...script,
                findRegex: substitute(script.findRegex, context.variables, script.substituteRegex === 2),
                replaceString: substitute(script.replaceString, context.variables),
                trimStrings: script.trimStrings.map(item => substitute(item, context.variables)),
            };
            const requestId = index + 1;
            const result = await new Promise<WorkerReply | null>(resolve => {
                const timer = window.setTimeout(() => resolve(null), timeoutMs);
                worker.onmessage = (event: MessageEvent<WorkerReply>) => {
                    if (event.data.requestId !== requestId) return;
                    window.clearTimeout(timer);
                    resolve(event.data);
                };
                worker.onerror = () => {
                    window.clearTimeout(timer);
                    resolve(null);
                };
                worker.postMessage({ requestId, input: output, script: prepared });
            });
            if (!result) {
                worker.terminate();
                worker = new Worker(new URL('./storyRegexWorker.ts', import.meta.url), { type: 'module' });
                continue;
            }
            if (!result.error && typeof result.output === 'string') output = result.output;
        }
        return output;
    } finally {
        worker.terminate();
    }
};

export const runStoryRegexOnMessages = async <T extends { role: string; content: string }>(
    messages: T[],
    scripts: StoryRegexScript[] | undefined,
    variables: Record<string, string>,
): Promise<T[]> => Promise.all(messages.map(async (message, index) => ({
    ...message,
    content: await runStoryRegex(message.content, scripts, {
        placement: message.role === 'assistant' ? STORY_REGEX_PLACEMENT.aiOutput : message.role === 'user' ? STORY_REGEX_PLACEMENT.userInput : -1,
        isPrompt: true,
        depth: messages.length - index - 1,
        variables,
    }),
})));
