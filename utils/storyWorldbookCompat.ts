import type {
    StoryApiMessage,
} from './storyTheater';
import type {
    StoryCompatibilityItem,
    StoryWorldbookDocument,
    StoryWorldbookEntry,
    StoryWorldbookRuntimeState,
    WorldbookSelectiveLogic,
} from '../types';

export const STORY_WORLDBOOK_BASELINE = '1.18.0/51ad27f' as const;

export type StoryWorldbookTrigger = 'normal' | 'continue' | 'regenerate';

export interface StoryWorldbookScanMessage {
    role?: string;
    content: unknown;
}

export interface StoryWorldbookRunInput {
    documents: StoryWorldbookDocument[];
    messages: StoryWorldbookScanMessage[];
    state?: StoryWorldbookRuntimeState;
    seed: string;
    trigger: StoryWorldbookTrigger;
    userName: string;
    characterNames: string[];
    personaDescription?: string;
    characterDescription?: string;
    characterPersonality?: string;
    characterDepthPrompt?: string;
    scenario?: string;
    creatorNotes?: string;
    maxContextTokens?: number;
}

export interface StoryWorldbookRunItem {
    entryId: string;
    documentId: string;
    name: string;
    status: 'activated' | 'disabled' | 'trigger' | 'delay' | 'cooldown' | 'no_match' | 'group' | 'probability' | 'budget' | 'unsupported_position';
    reason: string;
    matchedKeys: string[];
    position: StoryWorldbookEntry['position'];
    depth: number;
    role: StoryWorldbookEntry['role'];
    executes: boolean;
}

export interface StoryWorldbookDepthEntry {
    entryId: string;
    content: string;
    depth: number;
    role: StoryWorldbookEntry['role'];
    order: number;
    sourceIndex: number;
}

export interface StoryWorldbookRunResult {
    worldBefore: string;
    worldAfter: string;
    depthEntries: StoryWorldbookDepthEntry[];
    activatedEntryIds: string[];
    report: StoryWorldbookRunItem[];
    state: StoryWorldbookRuntimeState;
    usedTokens: number;
    budgetTokens: number;
}

const isRecord = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const numberValue = (value: unknown, fallback: number, min = -Infinity, max = Infinity): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const integerValue = (value: unknown, fallback: number, min = 0, max = 1_000_000): number => (
    Math.floor(numberValue(value, fallback, min, max))
);

const boolValue = (value: unknown, fallback = false): boolean => typeof value === 'boolean' ? value : fallback;

const nullableBool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;

const stringArray = (value: unknown): string[] => Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : [];

const sourceName = (fileName: string): string => fileName.replace(/\.json$/i, '').trim() || '酒馆世界书';

const makeDocumentId = (now: number): string => (
    globalThis.crypto?.randomUUID?.() || `story-wi-${now}-${Math.random().toString(36).slice(2, 9)}`
);

const resolveSource = (root: Record<string, any>): {
    sourceKind: StoryWorldbookDocument['sourceKind'];
    sourcePath: StoryWorldbookDocument['sourcePath'];
    book: Record<string, any>;
    entries: unknown;
} => {
    if (isRecord(root.data?.character_book) && Array.isArray(root.data.character_book.entries)) {
        return { sourceKind: 'character-card-v2-v3', sourcePath: 'data.character_book', book: root.data.character_book, entries: root.data.character_book.entries };
    }
    if (isRecord(root.character_book) && Array.isArray(root.character_book.entries)) {
        return { sourceKind: 'character-card-v2-v3', sourcePath: 'character_book', book: root.character_book, entries: root.character_book.entries };
    }
    if (Array.isArray(root.entries) && root.entries.some(entry => isRecord(entry) && ('keys' in entry || 'insertion_order' in entry || 'enabled' in entry))) {
        return { sourceKind: 'character-card-v2-v3', sourcePath: 'entries', book: root, entries: root.entries };
    }
    if (Array.isArray(root.entries) || isRecord(root.entries)) {
        return { sourceKind: 'sillytavern-world-info', sourcePath: 'entries', book: root, entries: root.entries };
    }
    throw new Error('不是受支持的酒馆世界书：缺少 entries 或 character_book.entries');
};

const compatibilityItem = (
    entry: StoryWorldbookEntry,
    fieldPath: string,
    level: StoryCompatibilityItem['level'],
    reason: string,
    executes: boolean,
): StoryCompatibilityItem => ({
    resourceId: entry.id,
    name: entry.name,
    fieldPath,
    level,
    reason,
    enabled: !entry.disabled,
    executes,
});

const normalizeEntry = (
    value: unknown,
    sourceKey: string,
    sourceIndex: number,
    documentId: string,
    characterBook: boolean,
    sourcePath: StoryWorldbookDocument['sourcePath'],
): { entry?: StoryWorldbookEntry; compatibility: StoryCompatibilityItem[] } => {
    const fieldPath = `${sourcePath}${sourcePath === 'entries' ? '' : '.entries'}.${sourceKey}`;
    if (!isRecord(value) || typeof value.content !== 'string') {
        return {
            compatibility: [{
                resourceId: `${documentId}:${sourceKey}`,
                name: `条目 ${sourceIndex + 1}`,
                fieldPath: `${fieldPath}.content`,
                level: '输入无效',
                reason: '条目不是对象或缺少字符串 content；原始数据仍保留，但不会执行。',
                enabled: false,
                executes: false,
            }],
        };
    }

    const extensions = characterBook && isRecord(value.extensions) ? value.extensions : {};
    const read = (camel: string, snake = camel): unknown => characterBook
        ? extensions[snake]
        : value[camel];
    const uid = value.uid ?? value.id ?? sourceKey;
    const position = integerValue(characterBook
        ? (extensions.position ?? (value.position === 'before_char' ? 0 : 1))
        : value.position, 0, 0, 7) as StoryWorldbookEntry['position'];
    const rawDelayRecursion = read('delayUntilRecursion', 'delay_until_recursion');
    const entry: StoryWorldbookEntry = {
        id: `${documentId}:${String(uid)}`,
        uid,
        name: String(value.comment || value.name || `条目 ${sourceIndex + 1}`),
        content: value.content,
        keys: stringArray(characterBook ? value.keys : value.key),
        secondaryKeys: stringArray(characterBook ? value.secondary_keys : value.keysecondary),
        constant: boolValue(value.constant),
        selective: boolValue(value.selective),
        selectiveLogic: integerValue(characterBook ? (extensions.selectiveLogic ?? value.selectiveLogic) : value.selectiveLogic, 0, 0, 3) as WorldbookSelectiveLogic,
        order: numberValue(characterBook ? value.insertion_order : value.order, 100),
        position,
        disabled: characterBook ? value.enabled === false : value.disable === true,
        probability: numberValue(read('probability'), 100, 0, 100),
        useProbability: boolValue(characterBook ? (extensions.useProbability ?? extensions.use_probability) : value.useProbability, true),
        depth: integerValue(read('depth'), 4, 0, 999),
        role: integerValue(read('role'), 0, 0, 2) as StoryWorldbookEntry['role'],
        scanDepth: read('scanDepth', 'scan_depth') == null ? null : integerValue(read('scanDepth', 'scan_depth'), 2, 0, 1000),
        caseSensitive: nullableBool(read('caseSensitive', 'case_sensitive')),
        matchWholeWords: nullableBool(read('matchWholeWords', 'match_whole_words')),
        excludeRecursion: boolValue(read('excludeRecursion', 'exclude_recursion')),
        preventRecursion: boolValue(read('preventRecursion', 'prevent_recursion')),
        delayUntilRecursion: typeof rawDelayRecursion === 'number'
            ? integerValue(rawDelayRecursion, 1, 1, 1000)
            : boolValue(rawDelayRecursion),
        group: String(read('group') || ''),
        groupOverride: boolValue(read('groupOverride', 'group_override')),
        groupWeight: numberValue(read('groupWeight', 'group_weight'), 100, 0),
        useGroupScoring: nullableBool(read('useGroupScoring', 'use_group_scoring')),
        sticky: integerValue(read('sticky'), 0, 0, 1000),
        cooldown: integerValue(read('cooldown'), 0, 0, 1000),
        delay: integerValue(read('delay'), 0, 0, 1000),
        ignoreBudget: boolValue(read('ignoreBudget', 'ignore_budget')),
        triggers: stringArray(read('triggers')),
        matchPersonaDescription: boolValue(read('matchPersonaDescription', 'match_persona_description')),
        matchCharacterDescription: boolValue(read('matchCharacterDescription', 'match_character_description')),
        matchCharacterPersonality: boolValue(read('matchCharacterPersonality', 'match_character_personality')),
        matchCharacterDepthPrompt: boolValue(read('matchCharacterDepthPrompt', 'match_character_depth_prompt')),
        matchScenario: boolValue(read('matchScenario', 'match_scenario')),
        matchCreatorNotes: boolValue(read('matchCreatorNotes', 'match_creator_notes')),
        sourceIndex,
        sourceKey,
    };

    const compatibility: StoryCompatibilityItem[] = [compatibilityItem(
        entry,
        fieldPath,
        position === 7 ? '已保存但不执行' : '完整支持',
        position === 7 ? 'Outlet 没有 SharkOS 剧情入口，字段会无损保留。' : '条目、开关、激活条件和注入位置可执行。',
        !entry.disabled && position !== 7,
    )];
    const rawVectorized = characterBook ? extensions.vectorized : value.vectorized;
    const rawOutlet = characterBook ? extensions.outlet_name : value.outletName;
    const rawAutomation = characterBook ? extensions.automation_id : value.automationId;
    const rawCharacterFilter = characterBook ? extensions.character_filter : value.characterFilter;
    if (rawVectorized === true) compatibility.push(compatibilityItem(entry, `${fieldPath}.vectorized`, '已保存但不执行', 'Vector Storage 不属于本阶段。', false));
    if (String(rawOutlet || '').trim()) compatibility.push(compatibilityItem(entry, `${fieldPath}.outletName`, '已保存但不执行', 'Outlet 没有当前剧情入口。', false));
    if (String(rawAutomation || '').trim()) compatibility.push(compatibilityItem(entry, `${fieldPath}.automationId`, '已保存但不执行', 'Automation/Quick Reply 不执行。', false));
    if (isRecord(rawCharacterFilter) && (stringArray(rawCharacterFilter.names).length || stringArray(rawCharacterFilter.tags).length)) {
        compatibility.push(compatibilityItem(entry, `${fieldPath}.characterFilter`, '已保存但不执行', '酒馆文件名与标签过滤没有 SharkOS 对等来源。', false));
    }
    if (entry.ignoreBudget) compatibility.push(compatibilityItem(entry, `${fieldPath}.ignoreBudget`, '部分支持', '字段保留；本阶段所有条目仍受同一世界书预算约束。', true));
    const unsupportedTriggers = entry.triggers.filter(trigger => !['normal', 'continue', 'regenerate'].includes(trigger));
    if (unsupportedTriggers.length) compatibility.push(compatibilityItem(entry, `${fieldPath}.triggers`, '部分支持', `不执行无对应入口的触发类型：${unsupportedTriggers.join('、')}`, true));
    return { entry, compatibility };
};

export const parseStoryWorldbook = (
    rawText: string,
    fileName: string,
    now = Date.now(),
): StoryWorldbookDocument => {
    const root = JSON.parse(rawText);
    if (!isRecord(root)) throw new Error('世界书 JSON 顶层必须是对象');
    const source = resolveSource(root);
    const documentId = makeDocumentId(now);
    const values = Array.isArray(source.entries)
        ? source.entries.map((value, index) => [String(index), value] as const)
        : Object.entries(source.entries as Record<string, unknown>);
    const normalized = values.map(([key, value], index) => normalizeEntry(value, key, index, documentId, source.sourceKind === 'character-card-v2-v3', source.sourcePath));
    const entries = normalized.flatMap(item => item.entry ? [item.entry] : []);
    if (entries.length === 0) throw new Error('世界书里没有可导入的有效条目');
    const settingsSource = source.book;
    const tokenBudget = numberValue(settingsSource.token_budget ?? settingsSource.tokenBudget, 0, 0);
    const settings: StoryWorldbookDocument['settings'] = {
        scanDepth: integerValue(settingsSource.scan_depth ?? settingsSource.scanDepth, 2, 0, 1000),
        recursive: boolValue(settingsSource.recursive_scanning ?? settingsSource.recursive, false),
        maxRecursionSteps: integerValue(settingsSource.max_recursion_steps ?? settingsSource.maxRecursionSteps, 0, 0, 1000),
        ...(tokenBudget > 0 ? { tokenBudget } : {}),
        budgetPercent: numberValue(settingsSource.budget_percent ?? settingsSource.budgetPercent, 25, 0, 100),
        caseSensitive: boolValue(settingsSource.case_sensitive ?? settingsSource.caseSensitive, false),
        matchWholeWords: boolValue(settingsSource.match_whole_words ?? settingsSource.matchWholeWords, false),
        useGroupScoring: boolValue(settingsSource.use_group_scoring ?? settingsSource.useGroupScoring, false),
    };
    const compatibility = normalized.flatMap(item => item.compatibility);
    const minimumActivations = numberValue(settingsSource.min_activations ?? settingsSource.minimumActivations, 0, 0);
    if (minimumActivations > 0) compatibility.push({
        resourceId: documentId,
        name: sourceName(fileName),
        fieldPath: source.sourcePath === 'entries' ? 'min_activations' : `${source.sourcePath}.min_activations`,
        level: '已保存但不执行',
        reason: 'Minimum Activations 不属于本阶段；条目仍按 scan depth、递归和预算运行。',
        enabled: true,
        executes: false,
    });
    return {
        id: documentId,
        name: String(source.book.name || sourceName(fileName)),
        sourceFileName: fileName,
        baseline: STORY_WORLDBOOK_BASELINE,
        sourceKind: source.sourceKind,
        sourcePath: source.sourcePath,
        settings,
        entries,
        compatibility,
        raw: cloneJson(root),
        createdAt: now,
        updatedAt: now,
    };
};

const setKnownEntryFields = (target: Record<string, any>, entry: StoryWorldbookEntry, characterBook: boolean): void => {
    if (characterBook) {
        target.id = entry.uid;
        target.keys = [...entry.keys];
        target.secondary_keys = [...entry.secondaryKeys];
        target.comment = entry.name;
        target.content = entry.content;
        target.constant = entry.constant;
        target.selective = entry.selective;
        target.insertion_order = entry.order;
        target.enabled = !entry.disabled;
        const extensions = isRecord(target.extensions) ? target.extensions : {};
        Object.assign(extensions, {
            position: entry.position,
            depth: entry.depth,
            role: entry.role,
            probability: entry.probability,
            useProbability: entry.useProbability,
            selectiveLogic: entry.selectiveLogic,
            scan_depth: entry.scanDepth,
            case_sensitive: entry.caseSensitive,
            match_whole_words: entry.matchWholeWords,
            exclude_recursion: entry.excludeRecursion,
            prevent_recursion: entry.preventRecursion,
            delay_until_recursion: entry.delayUntilRecursion,
            group: entry.group,
            group_override: entry.groupOverride,
            group_weight: entry.groupWeight,
            use_group_scoring: entry.useGroupScoring,
            sticky: entry.sticky,
            cooldown: entry.cooldown,
            delay: entry.delay,
            ignore_budget: entry.ignoreBudget,
            triggers: [...entry.triggers],
        });
        target.extensions = extensions;
        return;
    }
    Object.assign(target, {
        uid: entry.uid,
        comment: entry.name,
        content: entry.content,
        key: [...entry.keys],
        keysecondary: [...entry.secondaryKeys],
        constant: entry.constant,
        selective: entry.selective,
        selectiveLogic: entry.selectiveLogic,
        order: entry.order,
        position: entry.position,
        disable: entry.disabled,
        probability: entry.probability,
        useProbability: entry.useProbability,
        depth: entry.depth,
        role: entry.position === 4 ? entry.role : target.role,
        scanDepth: entry.scanDepth,
        caseSensitive: entry.caseSensitive,
        matchWholeWords: entry.matchWholeWords,
        excludeRecursion: entry.excludeRecursion,
        preventRecursion: entry.preventRecursion,
        delayUntilRecursion: entry.delayUntilRecursion,
        group: entry.group,
        groupOverride: entry.groupOverride,
        groupWeight: entry.groupWeight,
        useGroupScoring: entry.useGroupScoring,
        sticky: entry.sticky,
        cooldown: entry.cooldown,
        delay: entry.delay,
        ignoreBudget: entry.ignoreBudget,
        triggers: [...entry.triggers],
    });
};

export const serializeStoryWorldbook = (document: StoryWorldbookDocument): string => {
    const root = cloneJson(document.raw);
    const source = resolveSource(root);
    const sourceEntries = source.entries;
    for (const entry of document.entries) {
        const target = Array.isArray(sourceEntries)
            ? sourceEntries[entry.sourceIndex]
            : (sourceEntries as Record<string, unknown>)[entry.sourceKey];
        if (isRecord(target)) setKnownEntryFields(target, entry, document.sourceKind === 'character-card-v2-v3');
    }
    return JSON.stringify(root, null, 2);
};

export const setStoryWorldbookEntryEnabled = (
    document: StoryWorldbookDocument,
    entryId: string,
    enabled: boolean,
): StoryWorldbookDocument => ({
    ...document,
    entries: document.entries.map(entry => entry.id === entryId ? { ...entry, disabled: !enabled } : entry),
    compatibility: document.compatibility.map(item => item.resourceId === entryId ? { ...item, enabled, executes: enabled && item.level !== '已保存但不执行' && item.level !== '输入无效' } : item),
    updatedAt: Date.now(),
});

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

const messageText = (message: StoryWorldbookScanMessage): string => {
    if (typeof message.content === 'string') return message.content;
    if (!Array.isArray(message.content)) return '';
    return message.content.map(part => typeof part === 'string' ? part : String((part as any)?.text || '')).filter(Boolean).join('\n');
};

const expandMacros = (text: string, input: StoryWorldbookRunInput): string => {
    const values: Record<string, string> = {
        user: input.userName,
        char: input.characterNames.join('、'),
        group: input.characterNames.join('、'),
        charDepthPrompt: input.characterDepthPrompt || '',
    };
    return text.replace(/{{\s*([A-Za-z][\w]*)\s*}}/g, (whole, key: string) => Object.hasOwn(values, key) ? values[key] : whole);
};

const parseKeyRegex = (value: string): RegExp | null => {
    if (!value.startsWith('/')) return null;
    const lastSlash = value.lastIndexOf('/');
    if (lastSlash <= 0) return null;
    try { return new RegExp(value.slice(1, lastSlash), value.slice(lastSlash + 1)); }
    catch { return null; }
};

const keyMatches = (text: string, key: string, caseSensitive: boolean, wholeWords: boolean): boolean => {
    const regex = parseKeyRegex(key);
    if (regex) {
        regex.lastIndex = 0;
        return regex.test(text);
    }
    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    const needle = caseSensitive ? key : key.toLocaleLowerCase();
    if (!wholeWords || /\s/.test(needle)) return haystack.includes(needle);
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, caseSensitive ? 'u' : 'iu').test(text);
};

interface RuntimeEntry {
    document: StoryWorldbookDocument;
    entry: StoryWorldbookEntry;
}

interface Candidate extends RuntimeEntry {
    matchedKeys: string[];
    score: number;
    sticky: boolean;
}

const entryKey = (item: RuntimeEntry): string => `${item.document.id}:${item.entry.uid}`;

const reportItem = (item: RuntimeEntry, status: StoryWorldbookRunItem['status'], reason: string, matchedKeys: string[] = [], executes = false): StoryWorldbookRunItem => ({
    entryId: item.entry.id,
    documentId: item.document.id,
    name: item.entry.name,
    status,
    reason,
    matchedKeys,
    position: item.entry.position,
    depth: item.entry.depth,
    role: item.entry.role,
    executes,
});

const scanText = (item: RuntimeEntry, input: StoryWorldbookRunInput, recursionText: string[]): string => {
    const entry = item.entry;
    const depth = entry.scanDepth ?? item.document.settings.scanDepth;
    const parts = depth > 0 ? input.messages.slice(-depth).map(messageText).filter(Boolean) : [];
    if (entry.matchPersonaDescription && input.personaDescription) parts.push(input.personaDescription);
    if (entry.matchCharacterDescription && input.characterDescription) parts.push(input.characterDescription);
    if (entry.matchCharacterPersonality && input.characterPersonality) parts.push(input.characterPersonality);
    if (entry.matchCharacterDepthPrompt && input.characterDepthPrompt) parts.push(input.characterDepthPrompt);
    if (entry.matchScenario && input.scenario) parts.push(input.scenario);
    if (entry.matchCreatorNotes && input.creatorNotes) parts.push(input.creatorNotes);
    parts.push(...recursionText);
    return parts.join('\n');
};

const activationMatch = (item: RuntimeEntry, input: StoryWorldbookRunInput, recursionText: string[]): { active: boolean; matchedKeys: string[]; score: number } => {
    const { entry, document } = item;
    if (entry.constant) return { active: true, matchedKeys: [], score: 0 };
    const text = scanText(item, input, recursionText);
    const caseSensitive = entry.caseSensitive ?? document.settings.caseSensitive;
    const wholeWords = entry.matchWholeWords ?? document.settings.matchWholeWords;
    const keys = entry.keys.map(key => expandMacros(key, input)).filter(Boolean);
    const secondary = entry.secondaryKeys.map(key => expandMacros(key, input)).filter(Boolean);
    const matchedKeys = keys.filter(key => keyMatches(text, key, caseSensitive, wholeWords));
    if (!matchedKeys.length) return { active: false, matchedKeys: [], score: 0 };
    if (!entry.selective || secondary.length === 0) return { active: true, matchedKeys, score: matchedKeys.length };
    const matchedSecondary = secondary.filter(key => keyMatches(text, key, caseSensitive, wholeWords));
    const passes = entry.selectiveLogic === 1
        ? matchedSecondary.length < secondary.length
        : entry.selectiveLogic === 2
            ? matchedSecondary.length === 0
            : entry.selectiveLogic === 3
                ? matchedSecondary.length === secondary.length
                : matchedSecondary.length > 0;
    const positiveSecondaryScore = entry.selectiveLogic === 0 || entry.selectiveLogic === 3 ? matchedSecondary.length : 0;
    return { active: passes, matchedKeys: [...matchedKeys, ...matchedSecondary], score: matchedKeys.length + positiveSecondaryScore };
};

const chooseWeighted = (items: Candidate[], random: () => number): Candidate => {
    const total = items.reduce((sum, item) => sum + Math.max(0, item.entry.groupWeight), 0);
    if (total <= 0) return items[0];
    let roll = random() * total;
    for (const item of items) {
        roll -= Math.max(0, item.entry.groupWeight);
        if (roll <= 0) return item;
    }
    return items[items.length - 1];
};

const applyGroups = (candidates: Candidate[], random: () => number, rejected: StoryWorldbookRunItem[]): Candidate[] => {
    const active = new Set(candidates);
    const groups = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
        for (const group of candidate.entry.group.split(/,\s*/).map(value => value.trim()).filter(Boolean)) {
            groups.set(group, [...(groups.get(group) || []), candidate]);
        }
    }
    for (const [groupName, members] of groups) {
        const available = members.filter(item => active.has(item));
        if (available.length <= 1) continue;
        const sticky = available.filter(item => item.sticky);
        let pool = sticky.length ? sticky : available;
        const useScoring = pool.some(item => item.entry.useGroupScoring ?? item.document.settings.useGroupScoring);
        if (useScoring) {
            const highest = Math.max(...pool.map(item => item.score));
            pool = pool.filter(item => item.score === highest);
        }
        const prioritized = pool.filter(item => item.entry.groupOverride).sort((a, b) => b.entry.order - a.entry.order || a.entry.sourceIndex - b.entry.sourceIndex);
        const winner = prioritized[0] || chooseWeighted(pool, random);
        for (const item of available) {
            if (item === winner) continue;
            active.delete(item);
            rejected.push(reportItem(item, 'group', `包含组“${groupName}”由“${winner.entry.name}”胜出。`, item.matchedKeys));
        }
    }
    return candidates.filter(item => active.has(item));
};

const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

const emptyRuntimeState = (): StoryWorldbookRuntimeState => ({ turn: 0, stickyUntil: {}, cooldownUntil: {} });

export const runStoryWorldbooks = (input: StoryWorldbookRunInput): StoryWorldbookRunResult => {
    const previous = input.state || emptyRuntimeState();
    if (input.documents.length === 0) return {
        worldBefore: '',
        worldAfter: '',
        depthEntries: [],
        activatedEntryIds: [],
        report: [],
        state: previous,
        usedTokens: 0,
        budgetTokens: 0,
    };
    const turn = previous.turn + 1;
    const state: StoryWorldbookRuntimeState = {
        turn,
        stickyUntil: { ...previous.stickyUntil },
        cooldownUntil: { ...previous.cooldownUntil },
    };
    const random = seededRandom(input.seed);
    const all: RuntimeEntry[] = input.documents.flatMap(document => document.entries.map(entry => ({ document, entry })));
    const maxContext = Math.max(1, integerValue(input.maxContextTokens, 8192, 1));
    const documentBudgets = input.documents.map(document => document.settings.tokenBudget ?? Math.floor(maxContext * document.settings.budgetPercent / 100));
    const budgetTokens = documentBudgets.length ? Math.max(0, Math.min(...documentBudgets)) : 0;
    const selected: Candidate[] = [];
    const selectedKeys = new Set<string>();
    const rejectedKeys = new Set<string>();
    const report: StoryWorldbookRunItem[] = [];
    const recursionText: string[] = [];
    let usedTokens = 0;
    let recursionLevel = 0;
    const recursionEnabled = input.documents.some(document => document.settings.recursive);
    const configuredLimits = input.documents.map(document => document.settings.maxRecursionSteps).filter(value => value > 0);
    const maxRecursionSteps = configuredLimits.length ? Math.min(...configuredLimits) : all.length + 1;

    while (true) {
        const candidates: Candidate[] = [];
        for (const item of all) {
            const key = entryKey(item);
            if (selectedKeys.has(key) || rejectedKeys.has(key)) continue;
            const { entry } = item;
            if (entry.disabled) {
                if (recursionLevel === 0) report.push(reportItem(item, 'disabled', '条目已关闭，完整保留但本轮不执行。'));
                rejectedKeys.add(key);
                continue;
            }
            if (entry.position === 7) {
                report.push(reportItem(item, 'unsupported_position', 'Outlet 没有当前剧情入口。'));
                rejectedKeys.add(key);
                continue;
            }
            if (entry.triggers.length && !entry.triggers.includes(input.trigger)) {
                report.push(reportItem(item, 'trigger', `当前是 ${input.trigger}，不在条目的触发类型中。`));
                rejectedKeys.add(key);
                continue;
            }
            const sticky = (state.stickyUntil[key] || 0) >= turn;
            if (!sticky && entry.delay > 0 && turn < entry.delay) {
                report.push(reportItem(item, 'delay', `第 ${turn} 轮尚未达到 delay ${entry.delay}。`));
                rejectedKeys.add(key);
                continue;
            }
            if (!sticky && (state.cooldownUntil[key] || 0) >= turn) {
                report.push(reportItem(item, 'cooldown', `冷却持续到第 ${state.cooldownUntil[key]} 轮。`));
                rejectedKeys.add(key);
                continue;
            }
            if (!sticky && recursionLevel === 0 && entry.delayUntilRecursion) continue;
            if (!sticky && recursionLevel > 0 && entry.excludeRecursion) continue;
            const delayLevel = typeof entry.delayUntilRecursion === 'number' ? entry.delayUntilRecursion : entry.delayUntilRecursion ? 1 : 0;
            if (!sticky && recursionLevel > 0 && delayLevel > recursionLevel) continue;
            const match = sticky ? { active: true, matchedKeys: [] as string[], score: 0 } : activationMatch(item, input, recursionText);
            if (!match.active) continue;
            candidates.push({ ...item, ...match, sticky });
        }

        const groupRejected: StoryWorldbookRunItem[] = [];
        const grouped = applyGroups(candidates, random, groupRejected);
        report.push(...groupRejected);
        groupRejected.forEach(item => {
            const rejected = all.find(candidate => candidate.entry.id === item.entryId);
            if (rejected) rejectedKeys.add(entryKey(rejected));
        });
        let acceptedThisPass = 0;
        const ordered = grouped.sort((a, b) => Number(b.sticky) - Number(a.sticky) || Number(b.entry.constant) - Number(a.entry.constant) || b.entry.order - a.entry.order || a.entry.sourceIndex - b.entry.sourceIndex);
        for (const candidate of ordered) {
            const key = entryKey(candidate);
            if (!candidate.sticky && candidate.entry.useProbability && candidate.entry.probability < 100 && random() * 100 > candidate.entry.probability) {
                report.push(reportItem(candidate, 'probability', `未通过 ${candidate.entry.probability}% 概率判定。`, candidate.matchedKeys));
                rejectedKeys.add(key);
                continue;
            }
            const content = expandMacros(candidate.entry.content, input).trim();
            const tokens = estimateTokens(content);
            if (!content || usedTokens + tokens > budgetTokens) {
                report.push(reportItem(candidate, 'budget', `整条需要约 ${tokens} token，剩余预算 ${Math.max(0, budgetTokens - usedTokens)}；正文未截断。`, candidate.matchedKeys));
                rejectedKeys.add(key);
                continue;
            }
            usedTokens += tokens;
            selected.push(candidate);
            selectedKeys.add(key);
            acceptedThisPass += 1;
            report.push(reportItem(candidate, 'activated', candidate.sticky ? '由 sticky 状态继续生效。' : '激活并进入本轮注入。', candidate.matchedKeys, true));
            if (!candidate.sticky) {
                const stickyUntil = candidate.entry.sticky > 0 ? turn + candidate.entry.sticky : turn;
                if (candidate.entry.sticky > 0) state.stickyUntil[key] = stickyUntil;
                if (candidate.entry.cooldown > 0) state.cooldownUntil[key] = stickyUntil + candidate.entry.cooldown;
            }
            if (!candidate.entry.preventRecursion) recursionText.push(content);
        }
        if (!recursionEnabled || acceptedThisPass === 0 || recursionLevel + 1 >= maxRecursionSteps) break;
        recursionLevel += 1;
    }

    for (const item of all) {
        const key = entryKey(item);
        if (!selectedKeys.has(key) && !rejectedKeys.has(key)) {
            report.push(reportItem(item, 'no_match', item.entry.delayUntilRecursion ? '递归扫描中未命中。' : '主键或副键条件未命中。'));
        }
    }

    for (const key of Object.keys(state.stickyUntil)) if (state.stickyUntil[key] < turn) delete state.stickyUntil[key];
    for (const key of Object.keys(state.cooldownUntil)) if (state.cooldownUntil[key] < turn) delete state.cooldownUntil[key];
    const injected = selected
        .map(candidate => ({ candidate, content: expandMacros(candidate.entry.content, input).trim() }))
        .sort((a, b) => a.candidate.entry.order - b.candidate.entry.order || a.candidate.entry.sourceIndex - b.candidate.entry.sourceIndex);
    const joinPositions = (positions: StoryWorldbookEntry['position'][]): string => injected
        .filter(item => positions.includes(item.candidate.entry.position))
        .map(item => item.content)
        .filter(Boolean)
        .join('\n');
    const depthEntries = injected
        .filter(item => item.candidate.entry.position === 4)
        .map(item => ({
            entryId: item.candidate.entry.id,
            content: item.content,
            depth: item.candidate.entry.depth,
            role: item.candidate.entry.role,
            order: item.candidate.entry.order,
            sourceIndex: item.candidate.entry.sourceIndex,
        }));
    return {
        worldBefore: joinPositions([0]),
        worldAfter: joinPositions([1, 2, 3, 5, 6]),
        depthEntries,
        activatedEntryIds: selected.map(item => item.entry.id),
        report,
        state,
        usedTokens,
        budgetTokens,
    };
};

export const injectStoryWorldbookDepthEntries = (
    messages: StoryApiMessage[],
    entries: StoryWorldbookDepthEntry[],
): StoryApiMessage[] => {
    if (!entries.length) return [...messages];
    const buckets = new Map<number, StoryWorldbookDepthEntry[]>();
    for (const entry of entries) {
        const index = Math.max(0, messages.length - Math.max(0, Math.floor(entry.depth)));
        buckets.set(index, [...(buckets.get(index) || []), entry]);
    }
    const output: StoryApiMessage[] = [];
    for (let index = 0; index <= messages.length; index += 1) {
        const bucket = (buckets.get(index) || []).sort((a, b) => a.order - b.order || a.sourceIndex - b.sourceIndex);
        for (const entry of bucket) output.push({
            role: entry.role === 1 ? 'user' : entry.role === 2 ? 'assistant' : 'system',
            content: entry.content,
        });
        if (index < messages.length) output.push(messages[index]);
    }
    return output;
};

export const downloadStoryWorldbook = (document: StoryWorldbookDocument): void => {
    const blob = new Blob([serializeStoryWorldbook(document)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = globalThis.document.createElement('a');
    anchor.href = url;
    anchor.download = document.sourceFileName || `${document.name}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
};
