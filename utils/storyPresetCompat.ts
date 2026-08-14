import type {
    StoryCompatibilityItem,
    StoryTheaterPreset,
    StoryTheaterPresetDocument,
    StoryTheaterPresetOrderItem,
    StoryTheaterPresetPrompt,
} from '../types';
import { normalizeStoryRegexScripts } from './storyRegex';

export const SILLYTAVERN_COMPAT_BASELINE = '1.18.0/51ad27f' as const;

export type StoryPresetTrigger = 'normal' | 'continue' | 'regenerate';
export interface StoryPresetMessage { role: 'system' | 'user' | 'assistant'; content: string; }

export interface StoryPresetSlots {
    actors: string;
    persona: string;
    scenario: string;
    worldBefore: string;
    worldAfter: string;
    examples?: string;
}

export interface StoryPresetCompileInput {
    document: StoryTheaterPresetDocument;
    slots: StoryPresetSlots;
    history?: StoryPresetMessage[];
    trigger?: StoryPresetTrigger;
    userName: string;
    characterNames: string[];
    variables?: Record<string, string>;
    seed?: string;
    now?: Date;
    lastUserMessage?: string;
    charDescription?: string;
    charPersonality?: string;
    charDepthPrompt?: string;
    continueContent?: string;
}

export interface StoryPresetCompileResult {
    messages: StoryPresetMessage[];
    assistantPrefill?: StoryPresetMessage;
    variables: Record<string, string>;
    seed: string;
    report: StoryCompatibilityItem[];
}

const MARKERS: Record<string, NonNullable<StoryTheaterPresetPrompt['marker']>> = {
    worldInfoBefore: 'world_before',
    charDescription: 'characters',
    charPersonality: 'characters',
    scenario: 'scenario',
    personaDescription: 'user',
    worldInfoAfter: 'world_after',
    dialogueExamples: 'examples',
    chatHistory: 'history',
};

const SUPPORTED_TRIGGERS = new Set<StoryPresetTrigger>(['normal', 'continue', 'regenerate']);
const SUPPORTED_MACROS = new Set([
    'user', 'char', 'group', 'description', 'chardescription', 'personality', 'charpersonality', 'scenario', 'persona', 'personadescription',
    'lastusermessage', 'chardepthprompt', 'date', 'time', 'weekday', 'isodate', 'isotime', 'timestamp', 'uuid', 'trim',
    'set', 'setvar', 'get', 'getvar', 'has', 'hasvar', 'delete', 'delvar', 'add', 'addvar', 'inc', 'incvar', 'dec', 'decvar',
    'if', '#if', 'else', '/if', 'random', 'pick', 'comment',
]);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asRecord = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asString = (value: unknown): string => typeof value === 'string' ? value : '';
const finiteNumber = (value: unknown, fallback: number): number => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: unknown, min: number, max: number, fallback: number): number => Math.min(max, Math.max(min, finiteNumber(value, fallback)));
const normalizeRole = (value: unknown): StoryPresetMessage['role'] => value === 'assistant' || value === 2 ? 'assistant' : value === 'user' || value === 1 ? 'user' : 'system';
const copyJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const promptIdentifier = (value: Record<string, unknown>, index: number): string => (
    String(value.identifier || value.id || `prompt_${index + 1}`)
);

const normalizeTriggers = (value: unknown): string[] => asArray(value)
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean);

const chooseOrderBlock = (value: Record<string, unknown>): Record<string, unknown> | undefined => {
    const valid = asArray(value.prompt_order).map(asRecord).filter(block => Array.isArray(block.order) && block.order.length > 0);
    return valid.find(block => String(block.character_id) === '100001') || valid[0];
};

const reportItem = (
    resourceId: string,
    name: string,
    fieldPath: string,
    level: StoryCompatibilityItem['level'],
    reason: string,
    enabled: boolean,
    executes: boolean,
): StoryCompatibilityItem => ({ resourceId, name, fieldPath, level, reason, enabled, executes });

const extensionReport = (extensions: Record<string, unknown>): StoryCompatibilityItem[] => {
    const output: StoryCompatibilityItem[] = [];
    const regexScripts = asArray(extensions.regex_scripts).map(asRecord);
    regexScripts.forEach((script, index) => {
        const id = String(script.id || script.scriptName || `regex_${index + 1}`);
        const name = String(script.scriptName || script.name || id);
        const enabled = script.disabled !== true;
        const placements = asArray(script.placement).map(Number);
        const executable = placements.some(value => [1, 2, 5, 6].includes(value)) && Boolean(asString(script.findRegex));
        output.push(reportItem(id, name, `extensions.regex_scripts[${index}]`, executable ? '完整支持' : '部分支持', executable ? '由独立 Regex Worker 按原位置、显示/请求范围和深度执行。' : '脚本已保留；Slash Command、旧 MD Display 或空匹配式没有对应的剧情执行入口。', enabled, enabled && executable));
    });
    Object.entries(extensions).forEach(([key, value]) => {
        if (key === 'regex_scripts') return;
        const enabled = isRecord(value) ? value.enabled !== false && value.disabled !== true : true;
        output.push(reportItem(`extension:${key}`, key, `extensions.${key}`, '已保存但不执行', '扩展元数据可无损导出；Tavern Helper、工具箱脚本和任意 JavaScript 不执行。', enabled, false));
    });
    return output;
};

export const normalizeSillyTavernPresetDocument = (
    input: Record<string, unknown>,
    fallbackName: string,
): StoryTheaterPresetDocument => {
    const sourcePrompts = asArray(input.prompts).map(asRecord);
    if (sourcePrompts.length === 0) throw new Error('酒馆预设中没有提示词条目');
    const orderBlock = chooseOrderBlock(input);
    if (!orderBlock) throw new Error('酒馆预设没有有效的 prompt_order');

    const bodyById = new Map<string, StoryTheaterPresetPrompt>();
    const bodyInputIndex = new Map<string, number>();
    const compatibility: StoryCompatibilityItem[] = [];
    sourcePrompts.forEach((source, index) => {
        const id = promptIdentifier(source, index);
        if (bodyById.has(id)) {
            compatibility.push(reportItem(id, String(source.name || id), `prompts[${index}].identifier`, '输入无效', 'identifier 重复；运行时只使用首次出现的 prompt 本体。', source.enabled !== false, false));
            return;
        }
        const triggers = normalizeTriggers(source.injection_trigger);
        bodyInputIndex.set(id, index);
        bodyById.set(id, {
            id,
            name: String(source.name || id || `提示词 ${index + 1}`),
            enabled: source.enabled !== false,
            role: normalizeRole(source.role),
            content: asString(source.content),
            ...(MARKERS[id] ? { marker: MARKERS[id] } : {}),
            injectionPosition: Number(source.injection_position) === 1 ? 1 : 0,
            injectionDepth: Math.max(0, Math.floor(finiteNumber(source.injection_depth, 0))),
            injectionOrder: finiteNumber(source.injection_order, 100),
            ...(triggers.length > 0 ? { injectionTriggers: triggers } : {}),
        });
    });

    const order: StoryTheaterPresetOrderItem[] = [];
    asArray(orderBlock.order).forEach((rawItem, sourceIndex) => {
        const item = asRecord(rawItem);
        const identifier = String(item.identifier || item.id || '').trim();
        if (!identifier) {
            compatibility.push(reportItem(`order:${sourceIndex}`, `顺序项 ${sourceIndex + 1}`, `prompt_order.order[${sourceIndex}]`, '输入无效', '顺序项缺少 identifier，已保留在原始 JSON 但不执行。', item.enabled !== false, false));
            return;
        }
        order.push({ identifier, enabled: item.enabled !== false, sourceIndex });
        if (!bodyById.has(identifier)) {
            compatibility.push(reportItem(identifier, identifier, `prompt_order.order[${sourceIndex}]`, '输入无效', '顺序项找不到对应 prompt 本体，保留但不执行。', item.enabled !== false, false));
        }
    });

    const referencedIds = new Set(order.map(item => item.identifier));
    const unreferencedPromptIds = [...bodyById.keys()].filter(id => !referencedIds.has(id));
    const orderedBodyIds: string[] = [];
    order.forEach(item => {
        if (bodyById.has(item.identifier) && !orderedBodyIds.includes(item.identifier)) orderedBodyIds.push(item.identifier);
    });
    const promptIds = [...orderedBodyIds, ...unreferencedPromptIds];

    promptIds.forEach(id => {
        const prompt = bodyById.get(id)!;
        const refs = order.filter(item => item.identifier === id);
        const enabled = refs.some(item => item.enabled);
        const normalTrigger = (prompt.injectionTriggers || []).length === 0 || (prompt.injectionTriggers || []).includes('normal');
        const unsupportedTriggers = (prompt.injectionTriggers || []).filter(trigger => !SUPPORTED_TRIGGERS.has(trigger as StoryPresetTrigger));
        const fieldPath = `prompts[${bodyInputIndex.get(id) ?? 0}]`;
        if (refs.length === 0) {
            compatibility.push(reportItem(id, prompt.name, fieldPath, '已保存但不执行', 'prompt 未被所选 order 引用；不会自动追加到执行队尾。', prompt.enabled, false));
        } else if (unsupportedTriggers.length > 0) {
            const hasSupported = (prompt.injectionTriggers || []).some(trigger => SUPPORTED_TRIGGERS.has(trigger as StoryPresetTrigger));
            compatibility.push(reportItem(id, prompt.name, fieldPath, hasSupported ? '部分支持' : '已保存但不执行', `无 SharkOS 入口的 trigger：${unsupportedTriggers.join('、')}。`, enabled, hasSupported && enabled && normalTrigger));
        } else {
            const triggerReason = (prompt.injectionTriggers || []).length > 0 ? `仅在 ${prompt.injectionTriggers!.join(' / ')} 请求执行。` : '';
            compatibility.push(reportItem(id, prompt.name, fieldPath, '完整支持', refs.length > 1 ? `按原 order 保留 ${refs.length} 次引用。${triggerReason}` : `按原 order、role、位置和启用状态执行。${triggerReason}`, enabled, enabled && normalTrigger));
        }
        const unknownMacros = new Set<string>();
        for (const match of prompt.content.matchAll(/\{\{\s*([#/]?[\w-]+)/g)) {
            const command = match[1].toLowerCase();
            if (!SUPPORTED_MACROS.has(command)) unknownMacros.add(command);
        }
        unknownMacros.forEach(command => compatibility.push(reportItem(
            `macro:${command}:${id}`,
            `未知宏 {{${command}}}`,
            `${fieldPath}.content`,
            '部分支持',
            '宏原文会保留在 prompt 中，不替换为空，也不猜测扩展语义。',
            enabled,
            false,
        )));
    });

    const extensions = asRecord(input.extensions);
    compatibility.push(...extensionReport(extensions));

    return {
        schema: 'sullyos.story-preset',
        version: 1,
        name: String(input.name || input.preset_name || fallbackName || '酒馆预设'),
        description: String(input.description || '由 SillyTavern Chat Completion 预设适配'),
        generation: {
            temperature: clamp(input.temperature, 0, 2, 0.9),
            topP: clamp(input.top_p, 0, 1, 1),
            frequencyPenalty: clamp(input.frequency_penalty, -2, 2, 0),
            presencePenalty: clamp(input.presence_penalty, -2, 2, 0),
            maxTokens: Math.round(clamp(input.openai_max_tokens ?? input.max_tokens, 256, 32000, 8000)),
        },
        prompts: promptIds.map(id => {
            const prompt = bodyById.get(id)!;
            const refs = order.filter(item => item.identifier === id);
            return refs.length > 0 ? { ...prompt, enabled: refs.some(item => item.enabled) } : prompt;
        }),
        regexScripts: normalizeStoryRegexScripts(extensions.regex_scripts),
        assistantPrefill: asString(input.assistant_prefill || input.assistantPrefill),
        source: {
            kind: 'sillytavern-chat-completion',
            baseline: SILLYTAVERN_COMPAT_BASELINE,
            orderCharacterId: orderBlock.character_id as string | number | undefined,
            order,
            unreferencedPromptIds,
            raw: copyJson(input),
            continueNudge: asString(input.continue_nudge_prompt) || undefined,
            continuePrefill: input.continue_prefill === true ? 'last-assistant' : asString(input.continue_prefill) || undefined,
            continuePostfix: asString(input.continue_postfix) || undefined,
        },
        compatibility,
    };
};

export const getStoryPresetExecutionPrompts = (document: StoryTheaterPresetDocument): Array<{
    prompt: StoryTheaterPresetPrompt;
    enabled: boolean;
    orderIndex: number;
}> => {
    if (!document.source) return document.prompts.map((prompt, orderIndex) => ({ prompt, enabled: prompt.enabled, orderIndex }));
    const byId = new Map(document.prompts.map(prompt => [prompt.id, prompt]));
    return document.source.order.flatMap((item, orderIndex) => {
        const prompt = byId.get(item.identifier);
        return prompt ? [{ prompt, enabled: item.enabled, orderIndex }] : [];
    });
};

export const isStoryPresetPromptEnabled = (document: StoryTheaterPresetDocument, promptId: string): boolean => (
    document.source
        ? document.source.order.some(item => item.identifier === promptId && item.enabled)
        : document.prompts.find(prompt => prompt.id === promptId)?.enabled === true
);

export const setStoryPresetPromptEnabled = (
    document: StoryTheaterPresetDocument,
    promptId: string,
    enabled: boolean,
): StoryTheaterPresetDocument => {
    const order = document.source?.order.map(item => item.identifier === promptId ? { ...item, enabled } : item);
    const executes = document.source ? Boolean(order?.some(item => item.identifier === promptId && item.enabled)) : enabled;
    return {
        ...document,
        prompts: document.prompts.map(prompt => prompt.id === promptId ? { ...prompt, enabled } : prompt),
        ...(document.source ? { source: { ...document.source, order: order! } } : {}),
        ...(document.compatibility ? { compatibility: document.compatibility.map(item => item.resourceId === promptId && item.fieldPath.startsWith('prompts[')
            ? { ...item, enabled: document.source ? executes : enabled, executes: executes && (item.level === '完整支持' || item.level === '部分支持') }
            : item) } : {}),
    };
};

export const serializeStoryPreset = (preset: StoryTheaterPreset): string => {
    const { document } = preset;
    if (!document.source) return JSON.stringify(document, null, 2);
    const raw = copyJson(document.source.raw);
    const rawPrompts = asArray(raw.prompts).map(asRecord);
    const byId = new Map(document.prompts.map(prompt => [prompt.id, prompt]));
    raw.prompts = rawPrompts.map((item, index) => {
        const prompt = byId.get(promptIdentifier(item, index));
        if (!prompt) return item;
        return {
            ...item,
            name: prompt.name,
            role: prompt.role,
            content: prompt.content,
            enabled: prompt.enabled,
            injection_position: prompt.injectionPosition ?? 0,
            injection_depth: prompt.injectionDepth ?? 0,
            injection_order: prompt.injectionOrder ?? 100,
            injection_trigger: prompt.injectionTriggers || [],
        };
    });
    const blocks = asArray(raw.prompt_order).map(asRecord);
    const targetIndex = blocks.findIndex(block => String(block.character_id) === String(document.source?.orderCharacterId));
    const nextOrder = document.source.order.map(item => ({ identifier: item.identifier, enabled: item.enabled }));
    if (targetIndex >= 0) blocks[targetIndex] = { ...blocks[targetIndex], order: nextOrder };
    else blocks.push({ character_id: document.source.orderCharacterId ?? 100001, order: nextOrder });
    raw.prompt_order = blocks;
    raw.temperature = document.generation.temperature;
    raw.top_p = document.generation.topP;
    raw.frequency_penalty = document.generation.frequencyPenalty;
    raw.presence_penalty = document.generation.presencePenalty;
    raw.openai_max_tokens = document.generation.maxTokens;
    raw.assistant_prefill = document.assistantPrefill || '';
    const rawExtensions = asRecord(raw.extensions);
    const originalRegex = asArray(rawExtensions.regex_scripts).map(asRecord);
    raw.extensions = {
        ...rawExtensions,
        regex_scripts: (document.regexScripts || []).map((script, index) => ({
            ...(originalRegex[script.sourceIndex] || originalRegex[index] || {}),
            id: script.id,
            scriptName: script.name,
            findRegex: script.findRegex,
            replaceString: script.replaceString,
            trimStrings: script.trimStrings,
            placement: script.placement,
            disabled: script.disabled,
            markdownOnly: script.markdownOnly,
            promptOnly: script.promptOnly,
            runOnEdit: script.runOnEdit,
            substituteRegex: script.substituteRegex,
            minDepth: script.minDepth ?? null,
            maxDepth: script.maxDepth ?? null,
        })),
    };
    return JSON.stringify(raw, null, 2);
};

const hashText = (value: string): number => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const seededRandom = (seed: string): (() => number) => {
    let state = hashText(seed) || 0x6d2b79f5;
    return () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
};

const splitMacro = (raw: string): string[] => {
    const text = raw.trim();
    if (text.includes('::')) return text.split('::').map(part => part.trim());
    const legacy = /^([\w#/-]+):(.*)$/.exec(text);
    if (legacy) return [legacy[1], ...legacy[2].split(':').map(part => part.trim())];
    const [name, ...rest] = text.split(/\s+/);
    return [name, rest.join(' ')].filter(Boolean);
};

const truthy = (value: string): boolean => !['', '0', 'false', 'null', 'undefined', 'no'].includes(value.trim().toLowerCase());

const deterministicUuid = (seed: string, counter: number): string => {
    const hex = [0, 1, 2, 3].map(index => hashText(`${seed}:${counter}:${index}`).toString(16).padStart(8, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const applyStoryMacros = (
    source: string,
    context: StoryPresetCompileInput,
    variables: Record<string, string>,
    random: () => number,
    report: StoryCompatibilityItem[],
    uuidCounter: { value: number },
): string => {
    const participantNames = context.characterNames.filter(Boolean);
    const now = context.now || new Date();
    const unknown = new Set<string>();
    const valueFor = (name: string): string => variables[name] ?? name;
    const conditionMatches = (expression: string): boolean => {
        const comparison = /^(.+?)\s*(==|!=)\s*(.+)$/.exec(expression.trim());
        if (comparison) {
            const left = valueFor(comparison[1].trim());
            const right = valueFor(comparison[3].trim()).replace(/^['"]|['"]$/g, '');
            return comparison[2] === '==' ? left === right : left !== right;
        }
        return truthy(valueFor(expression.trim()));
    };

    let output = String(source || '');
    const blockPattern = /\{\{#if\s+([^{}]+)\}\}((?:(?!\{\{#if\s).)*?)\{\{\/if\}\}/s;
    for (let pass = 0; pass < 20 && blockPattern.test(output); pass += 1) {
        blockPattern.lastIndex = 0;
        output = output.replace(blockPattern, (_whole, condition: string, body: string) => {
            const [yes, no = ''] = body.split(/\{\{else\}\}/, 2);
            return conditionMatches(condition) ? yes : no;
        });
    }

    const replaceOne = (whole: string, raw: string): string => {
        const parts = splitMacro(raw);
        const command = (parts.shift() || '').toLowerCase();
        const args = parts;
        if (!command) return whole;
        if (command.startsWith('//') || command === 'comment') return '';
        const simple: Record<string, string> = {
            user: context.userName || '你',
            char: participantNames.join('、') || '角色',
            group: participantNames.join('、') || '角色',
            description: context.charDescription || context.slots.actors,
            chardescription: context.charDescription || context.slots.actors,
            personality: context.charPersonality || '',
            charpersonality: context.charPersonality || '',
            scenario: context.slots.scenario,
            persona: context.slots.persona,
            personadescription: context.slots.persona,
            lastusermessage: context.lastUserMessage || '',
            date: now.toLocaleDateString(),
            time: now.toLocaleTimeString(),
            weekday: now.toLocaleDateString(undefined, { weekday: 'long' }),
            isodate: now.toISOString().slice(0, 10),
            isotime: now.toISOString().slice(11, 19),
            timestamp: String(Math.floor(now.getTime() / 1000)),
        };
        if (command === 'chardepthprompt' && context.charDepthPrompt !== undefined) return context.charDepthPrompt;
        if (command in simple) return simple[command];
        if (command === 'trim') return '';
        if (command === 'uuid') return deterministicUuid(context.seed || 'story', uuidCounter.value++);
        if (command === 'set' || command === 'setvar') { variables[args[0] || ''] = args.slice(1).join('::'); return ''; }
        if (command === 'get' || command === 'getvar') return variables[args[0] || ''] || '';
        if (command === 'has' || command === 'hasvar') return String(Object.prototype.hasOwnProperty.call(variables, args[0] || ''));
        if (command === 'delete' || command === 'delvar') { delete variables[args[0] || '']; return ''; }
        if (command === 'add' || command === 'addvar') {
            const key = args[0] || '';
            const addend = args.slice(1).join('::');
            const currentNumber = Number(variables[key]);
            const addendNumber = Number(addend);
            variables[key] = Number.isFinite(currentNumber) && Number.isFinite(addendNumber) ? String(currentNumber + addendNumber) : `${variables[key] || ''}${addend}`;
            return '';
        }
        if (command === 'inc' || command === 'incvar' || command === 'dec' || command === 'decvar') {
            const key = args[0] || '';
            const current = Number(variables[key]);
            variables[key] = String((Number.isFinite(current) ? current : 0) + (command.startsWith('dec') ? -1 : 1));
            return '';
        }
        if (command === 'if') return conditionMatches(args[0] || '') ? (args[1] || '') : (args[2] || '');
        if (command === 'random' || command === 'pick') {
            if (command === 'random' && args.length === 2 && args.every(value => Number.isFinite(Number(value)))) {
                const min = Math.ceil(Math.min(Number(args[0]), Number(args[1])));
                const max = Math.floor(Math.max(Number(args[0]), Number(args[1])));
                return String(Math.floor(random() * (max - min + 1)) + min);
            }
            return args.length > 0 ? args[Math.floor(random() * args.length)] : '';
        }
        unknown.add(command);
        return whole;
    };

    for (let pass = 0; pass < 30; pass += 1) {
        const next = output.replace(/\{\{([^{}]+)\}\}/g, replaceOne);
        if (next === output) break;
        output = next;
    }
    unknown.forEach(command => report.push(reportItem(`macro:${command}`, command, 'prompt.content', '部分支持', '未知或扩展宏保持原文，没有替换为空。', true, false)));
    return output.trim();
};

const markerText = (marker: StoryTheaterPresetPrompt['marker'], slots: StoryPresetSlots): string => {
    switch (marker) {
        case 'characters': return slots.actors;
        case 'world_before': return slots.worldBefore;
        case 'user': return slots.persona;
        case 'world_after': return slots.worldAfter;
        case 'scenario': return slots.scenario;
        case 'examples': return slots.examples || '';
        default: return '';
    }
};

const appliesToTrigger = (prompt: StoryTheaterPresetPrompt, trigger: StoryPresetTrigger): boolean => {
    const triggers = prompt.injectionTriggers || [];
    return triggers.length === 0 || triggers.includes(trigger);
};

const insertInChat = (
    history: StoryPresetMessage[],
    prompts: Array<{ message: StoryPresetMessage; depth: number; order: number; promptOrder: number }>,
): StoryPresetMessage[] => {
    const atBoundary = new Map<number, typeof prompts>();
    prompts.forEach(item => {
        const boundary = Math.max(0, history.length - Math.max(0, item.depth));
        const items = atBoundary.get(boundary) || [];
        items.push(item);
        atBoundary.set(boundary, items);
    });
    const output: StoryPresetMessage[] = [];
    for (let boundary = 0; boundary <= history.length; boundary += 1) {
        const items = (atBoundary.get(boundary) || []).sort((a, b) => a.order - b.order || a.promptOrder - b.promptOrder);
        output.push(...items.map(item => item.message));
        if (boundary < history.length) output.push(history[boundary]);
    }
    return output;
};

export const compileStoryPresetDocument = (input: StoryPresetCompileInput): StoryPresetCompileResult => {
    const trigger = input.trigger || 'normal';
    const seed = input.seed || `${input.document.name}:${input.now?.getTime() || Date.now()}`;
    const context = { ...input, seed };
    const variables = { ...(input.variables || {}) };
    const random = seededRandom(seed);
    const report: StoryCompatibilityItem[] = [];
    const uuidCounter = { value: 0 };
    const relative: Array<StoryPresetMessage | { history: true }> = [];
    const inChat: Array<{ message: StoryPresetMessage; depth: number; order: number; promptOrder: number }> = [];
    const injectedMarkers = new Set<string>();

    const executionPrompts = getStoryPresetExecutionPrompts(input.document);
    if (!input.document.source) {
        const worldBeforeIndex = executionPrompts.findIndex(item => item.enabled && item.prompt.marker === 'world_before');
        const characterIndex = executionPrompts.findIndex(item => item.enabled && item.prompt.marker === 'characters');
        if (worldBeforeIndex > characterIndex && characterIndex >= 0) {
            const [worldBefore] = executionPrompts.splice(worldBeforeIndex, 1);
            executionPrompts.splice(characterIndex, 0, worldBefore);
        }
    }
    executionPrompts.forEach(({ prompt, enabled, orderIndex }) => {
        if (!enabled || !appliesToTrigger(prompt, trigger)) return;
        if (prompt.marker === 'history') {
            if (!injectedMarkers.has('history')) relative.push({ history: true });
            injectedMarkers.add('history');
            return;
        }
        let raw = prompt.content;
        if (prompt.marker) {
            if (injectedMarkers.has(prompt.marker)) return;
            injectedMarkers.add(prompt.marker);
            raw = markerText(prompt.marker, input.slots);
        }
        const content = applyStoryMacros(raw, context, variables, random, report, uuidCounter);
        if (!content) return;
        const message: StoryPresetMessage = { role: prompt.role, content };
        if (prompt.injectionPosition === 1) {
            inChat.push({ message, depth: prompt.injectionDepth || 0, order: prompt.injectionOrder ?? 100, promptOrder: orderIndex });
        } else {
            relative.push(message);
        }
    });

    if (!input.document.source && input.slots.worldBefore.trim() && !injectedMarkers.has('world_before')) {
        relative.unshift({ role: 'system', content: applyStoryMacros(input.slots.worldBefore, context, variables, random, report, uuidCounter) });
    }
    const history = insertInChat(input.history || [], inChat);
    const messages = relative.flatMap(item => 'history' in item ? history : [item]);
    if (trigger === 'continue' && input.document.source?.continueNudge) {
        const nudge = applyStoryMacros(input.document.source.continueNudge, context, variables, random, report, uuidCounter);
        if (nudge) messages.push({ role: 'system', content: nudge });
    }

    let prefill = input.document.assistantPrefill || '';
    if (trigger === 'continue' && input.document.source?.continuePrefill === 'last-assistant') prefill = input.continueContent || prefill;
    if (trigger === 'continue' && input.document.source?.continuePostfix) prefill += input.document.source.continuePostfix;
    const expandedPrefill = applyStoryMacros(prefill, context, variables, random, report, uuidCounter);
    return {
        messages,
        ...(expandedPrefill ? { assistantPrefill: { role: 'assistant', content: expandedPrefill } as const } : {}),
        variables,
        seed,
        report,
    };
};

export const replaceStoryParticipantMacros = (text: string, userName: string, characterNames: string[]): string => (
    applyStoryMacros(text, {
        document: { schema: 'sullyos.story-preset', version: 1, name: '', generation: { temperature: 1, topP: 1, frequencyPenalty: 0, presencePenalty: 0, maxTokens: 1 }, prompts: [] },
        slots: { actors: '', persona: '', scenario: '', worldBefore: '', worldAfter: '' },
        userName,
        characterNames,
        seed: 'participant-macros',
    }, {}, seededRandom('participant-macros'), [], { value: 0 })
);
