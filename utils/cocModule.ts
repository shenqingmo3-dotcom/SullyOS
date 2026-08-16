import JSZip from 'jszip';
import type {
    CoCCharacterRequirement,
    CoCModuleAnalysis,
    CoCModuleProgress,
    CoCPlayMode,
    CoCStoryTone,
} from '../types';
import { extractPdfText, isPdfFile } from './pdfText';

export const MAX_MODULE_CHARS = 800_000;

export interface CoCModuleReadResult {
    text: string;
    truncated: boolean;
}

const limitModuleText = (value: string): CoCModuleReadResult => {
    const text = value.trim();
    return { text: text.slice(0, MAX_MODULE_CHARS), truncated: text.length > MAX_MODULE_CHARS };
};

const decodeXmlText = (value: string): string => value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));

export const docxXmlToText = (source: string): string => {
    if (!/<(?:\w+:)?document\b/i.test(source) || !/<\/(?:\w+:)?document>/i.test(source)) {
        throw new Error('DOCX 主文档 XML 已损坏');
    }
    const paragraphs: string[] = [];
    for (const match of source.matchAll(/<(?:\w+:)?p\b[^>]*>([\s\S]*?)<\/(?:\w+:)?p>/gi)) {
        const text = Array.from(match[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?(tab|br|cr)\b[^>]*\/?\s*>/gi))
            .map(item => item[1] != null ? decodeXmlText(item[1]) : item[2].toLowerCase() === 'tab' ? '\t' : '\n')
            .join('')
            .trim();
        if (text) paragraphs.push(text);
    }
    return paragraphs.join('\n\n');
};

const readDocxText = async (file: File): Promise<string> => {
    let archive: JSZip;
    try {
        archive = await JSZip.loadAsync(await file.arrayBuffer());
    } catch {
        throw new Error('DOCX 文件已损坏或不是有效的 Office 文档');
    }
    const documentFile = archive.file('word/document.xml');
    if (!documentFile) throw new Error('DOCX 缺少 word/document.xml，无法读取正文');

    return docxXmlToText(await documentFile.async('string'));
};

export async function readCoCModuleFile(file: File): Promise<CoCModuleReadResult> {
    const lower = file.name.toLowerCase();
    if (isPdfFile(file)) {
        const result = await extractPdfText(await file.arrayBuffer());
        if (!result.text.trim()) throw new Error('PDF 没有可读取文字；扫描版 PDF 请先做 OCR');
        return limitModuleText(result.text);
    }
    if (lower.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const text = await readDocxText(file);
        if (!text.trim()) throw new Error('DOCX 主文档正文为空；图片中的文字暂不支持 OCR');
        return limitModuleText(text);
    }
    if (!/\.(txt|md|markdown|json)$/i.test(lower) && !file.type.startsWith('text/') && file.type !== 'application/json') {
        throw new Error('目前支持 PDF、DOCX、TXT、Markdown 与 JSON 模组文件');
    }
    const result = limitModuleText(await file.text());
    if (!result.text) throw new Error('模组文件正文为空');
    return result;
}

const asList = (input: unknown): unknown[] => Array.isArray(input) ? input : [];
const asText = (input: unknown, fallback = ''): string => typeof input === 'string' && input.trim() ? input.trim() : fallback;
const asTextList = (input: unknown): string[] => asList(input).map(item => asText(item)).filter(Boolean);
const uniqueText = (input: unknown): string[] => Array.from(new Set(asTextList(input)));

const normalizeRequirementValue = (value: unknown): CoCCharacterRequirement['value'] => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        if (value.every(item => typeof item === 'number')) return value;
        return value.map(item => String(item));
    }
    return String(value ?? '');
};

const assertUniqueIds = (label: string, items: Array<{ id: string }>) => {
    const seen = new Set<string>();
    for (const item of items) {
        if (seen.has(item.id)) throw new Error(`${label}存在重复 ID：${item.id}`);
        seen.add(item.id);
    }
};

const assertReferences = (label: string, ids: string[], available: Set<string>) => {
    const missing = ids.find(id => !available.has(id));
    if (missing) throw new Error(`${label}引用了不存在的 ID：${missing}`);
};

export function normalizeCoCModuleAnalysis(value: any, fallbackTitle: string, strictReferences = true): CoCModuleAnalysis {
    const clues = asList(value?.clues).map((item: any, index) => ({
        id: asText(item?.id, `clue-${index + 1}`),
        name: asText(item?.name, `线索 ${index + 1}`),
        location: asText(item?.location),
        revelation: asText(item?.revelation),
        required: item?.required !== false,
        fallback: asText(item?.fallback, '即使检定失败，KP 也应以代价、延迟或不完整信息交付关键线索。'),
    }));
    const checks = asList(value?.checks).map((item: any, index) => ({
        id: asText(item?.id, `check-${index + 1}`),
        scene: asText(item?.scene),
        skill: asText(item?.skill, '侦查'),
        difficulty: (['hard', 'extreme'].includes(item?.difficulty) ? item.difficulty : 'regular') as 'regular' | 'hard' | 'extreme',
        purpose: asText(item?.purpose),
        success: asText(item?.success),
        failure: asText(item?.failure),
        clueIds: uniqueText(item?.clueIds || item?.clue_ids),
    }));
    const characterRequirements = asList(value?.characterRequirements || value?.character_requirements).map((item: any, index) => ({
        id: asText(item?.id, `requirement-${index + 1}`),
        target: (['kpc', 'both'].includes(item?.target) ? item.target : 'pc') as 'pc' | 'kpc' | 'both',
        level: item?.level === 'recommended' ? 'recommended' as const : 'required' as const,
        kind: asText(item?.kind, 'background'),
        value: normalizeRequirementValue(item?.value),
        sourceLabel: asText(item?.sourceLabel || item?.source_label, '模组说明'),
        manual: item?.manual === true,
    }));
    const nodes = asList(value?.nodes).map((item: any, index) => ({
        id: asText(item?.id, `node-${index + 1}`),
        name: asText(item?.name, `调查节点 ${index + 1}`),
        summary: asText(item?.summary),
        entrances: uniqueText(item?.entrances),
        clueIds: uniqueText(item?.clueIds || item?.clue_ids),
        revelationIds: uniqueText(item?.revelationIds || item?.revelation_ids),
        nextNodeIds: uniqueText(item?.nextNodeIds || item?.next_node_ids),
    }));
    const revelations = asList(value?.revelations).map((item: any, index) => ({
        id: asText(item?.id, `revelation-${index + 1}`),
        statement: asText(item?.statement || item?.revelation),
        required: item?.required !== false,
        clueIds: uniqueText(item?.clueIds || item?.clue_ids),
        nodeIds: uniqueText(item?.nodeIds || item?.node_ids),
    }));
    const threats = asList(value?.threats).map((item: any, index) => ({
        id: asText(item?.id, `threat-${index + 1}`),
        name: asText(item?.name, `威胁 ${index + 1}`),
        trigger: asText(item?.trigger),
        stages: uniqueText(item?.stages),
        nodeIds: uniqueText(item?.nodeIds || item?.node_ids),
    }));

    assertUniqueIds('线索', clues);
    assertUniqueIds('检定', checks);
    assertUniqueIds('角色约束', characterRequirements);
    assertUniqueIds('调查节点', nodes);
    assertUniqueIds('关键结论', revelations);
    assertUniqueIds('威胁', threats);
    const clueIds = new Set(clues.map(item => item.id));
    const nodeIds = new Set(nodes.map(item => item.id));
    const revelationIds = new Set(revelations.map(item => item.id));
    if (strictReferences) {
        checks.forEach(item => assertReferences(`检定 ${item.id}`, item.clueIds, clueIds));
        nodes.forEach(item => {
            assertReferences(`节点 ${item.id} 的线索`, item.clueIds, clueIds);
            assertReferences(`节点 ${item.id} 的结论`, item.revelationIds, revelationIds);
            assertReferences(`节点 ${item.id} 的后继`, item.nextNodeIds, nodeIds);
        });
        revelations.forEach(item => {
            assertReferences(`结论 ${item.id} 的线索`, item.clueIds, clueIds);
            assertReferences(`结论 ${item.id} 的节点`, item.nodeIds, nodeIds);
        });
        threats.forEach(item => assertReferences(`威胁 ${item.id} 的节点`, item.nodeIds, nodeIds));
    }

    const playMode = value?.recommendedPlayMode || value?.recommended_play_mode;
    const tones = uniqueText(value?.recommendedStoryTones || value?.recommended_story_tones)
        .filter((tone): tone is CoCStoryTone => tone === 'pink' || tone === 'tea');
    return {
        title: asText(value?.title, fallbackTitle),
        keeperSummary: asText(value?.keeperSummary || value?.keeper_summary, '尚未生成完整 KP 摘要'),
        openingHook: asText(value?.openingHook || value?.opening_hook, '调查员被卷入了一起异常事件。'),
        acts: asList(value?.acts).map((item: any, index) => ({
            name: asText(item?.name, `阶段 ${index + 1}`),
            purpose: asText(item?.purpose),
            scenes: asTextList(item?.scenes),
        })),
        clues,
        checks,
        npcs: asList(value?.npcs).map((item: any) => ({
            name: asText(item?.name, '未命名 NPC'),
            role: asText(item?.role),
            motive: asText(item?.motive),
            secret: asText(item?.secret),
        })),
        endings: asTextList(value?.endings),
        safetyNotes: asTextList(value?.safetyNotes || value?.safety_notes),
        recommendedPlayMode: (['solo', 'pc_kpc', 'duo_pc', 'party'].includes(playMode) ? playMode : undefined) as CoCPlayMode | undefined,
        recommendedStoryTones: tones,
        characterRequirements,
        nodes,
        revelations,
        threats,
        improvBoundaries: {
            fixedFacts: uniqueText(value?.improvBoundaries?.fixedFacts || value?.improv_boundaries?.fixed_facts),
            flexibleDetails: uniqueText(value?.improvBoundaries?.flexibleDetails || value?.improv_boundaries?.flexible_details),
        },
    };
}

export function validateCoCModuleChunk(value: any, expectedPart: number): void {
    if (!value || typeof value !== 'object') throw new Error(`第 ${expectedPart} 块没有返回 JSON 对象`);
    if (Number(value.partIndex ?? value.part_index) !== expectedPart) throw new Error(`第 ${expectedPart} 块序号缺失或错误`);
    for (const field of ['clues', 'checks', 'npcs', 'endings']) {
        if (!Array.isArray(value[field])) throw new Error(`第 ${expectedPart} 块缺少 ${field} 数组`);
    }
}

export function createInitialModuleProgress(analysis?: CoCModuleAnalysis): CoCModuleProgress {
    return {
        currentNodeId: analysis?.nodes[0]?.id,
        establishedRevelationIds: [],
        threatSteps: Object.fromEntries((analysis?.threats || []).map(threat => [threat.id, 0])),
        stalledInvestigationTurns: 0,
    };
}

export function updateCoCModuleProgress(
    analysis: CoCModuleAnalysis | undefined,
    previous: CoCModuleProgress | undefined,
    result: any,
    previousClueIds: string[],
    nextClueIds: string[],
): CoCModuleProgress {
    const base = previous || createInitialModuleProgress(analysis);
    if (!analysis) return base;
    const nodeIds = new Set(analysis.nodes.map(node => node.id));
    const revelationIds = new Set(analysis.revelations.map(item => item.id));
    const nextNode = asText(result?.current_node_id || result?.currentNodeId);
    const currentNodeId = nextNode && nodeIds.has(nextNode) ? nextNode : base.currentNodeId;
    const establishedRevelationIds = Array.from(new Set([
        ...base.establishedRevelationIds,
        ...asTextList(result?.established_revelation_ids || result?.establishedRevelationIds).filter(id => revelationIds.has(id)),
    ]));
    const threatSteps = { ...base.threatSteps };
    const requestedThreatSteps = result?.threat_steps || result?.threatSteps;
    if (requestedThreatSteps && typeof requestedThreatSteps === 'object') {
        for (const threat of analysis.threats) {
            const raw = Number(requestedThreatSteps[threat.id]);
            if (Number.isFinite(raw)) threatSteps[threat.id] = Math.max(0, Math.min(Math.max(0, threat.stages.length - 1), Math.floor(raw)));
        }
    }
    const progressed = nextClueIds.some(id => !previousClueIds.includes(id))
        || establishedRevelationIds.length > base.establishedRevelationIds.length
        || currentNodeId !== base.currentNodeId
        || Object.keys(threatSteps).some(id => threatSteps[id] !== base.threatSteps[id]);
    const turnKind = result?.turn_kind || result?.turnKind;
    return {
        currentNodeId,
        establishedRevelationIds,
        threatSteps,
        stalledInvestigationTurns: turnKind === 'investigation'
            ? (progressed ? 0 : base.stalledInvestigationTurns + 1)
            : base.stalledInvestigationTurns,
    };
}

export function buildKeeperModulePacket(
    analysis: CoCModuleAnalysis | undefined,
    progress: CoCModuleProgress | undefined,
    maxChars = 24_000,
): string {
    if (!analysis) return '原创局，没有导入模组。';
    const state = progress || createInitialModuleProgress(analysis);
    const currentNode = analysis.nodes.find(node => node.id === state.currentNodeId) || analysis.nodes[0];
    const connectedIds = new Set(currentNode?.nextNodeIds || []);
    const activeNodes = analysis.nodes.filter(node => node.id === currentNode?.id || connectedIds.has(node.id));
    const unresolved = analysis.revelations.filter(item => item.required && !state.establishedRevelationIds.includes(item.id));
    const packet = {
        globalTruth: analysis.keeperSummary,
        fixedFacts: analysis.improvBoundaries.fixedFacts,
        flexibleDetails: analysis.improvBoundaries.flexibleDetails,
        currentNode,
        connectedEntrances: activeNodes.filter(node => node.id !== currentNode?.id).map(node => ({ id: node.id, name: node.name, entrances: node.entrances })),
        unresolvedRequiredRevelations: unresolved,
        activeThreats: analysis.threats.map(threat => ({
            id: threat.id,
            name: threat.name,
            trigger: threat.trigger,
            step: state.threatSteps[threat.id] || 0,
            stage: threat.stages[state.threatSteps[threat.id] || 0] || '',
        })),
        relevantClues: analysis.clues.filter(clue => activeNodes.some(node => node.clueIds.includes(clue.id)) || unresolved.some(item => item.clueIds.includes(clue.id))),
        endings: analysis.endings,
    };
    let serialized = JSON.stringify(packet);
    if (serialized.length <= maxChars) return serialized;
    const compact = { ...packet, relevantClues: packet.relevantClues.filter(clue => clue.required), endings: [] as string[] };
    serialized = JSON.stringify(compact);
    if (serialized.length <= maxChars) return serialized;
    return JSON.stringify({
        globalTruth: packet.globalTruth,
        fixedFacts: packet.fixedFacts,
        currentNode: packet.currentNode,
        unresolvedRequiredRevelations: packet.unresolvedRequiredRevelations,
        activeThreats: packet.activeThreats,
    });
}

export function moduleAnalysisPrompt(sourceText: string, editionLabel: string, partLabel = '完整模组', partIndex = 1): string {
    return `你是守秘人备团助手。请分析下面的 ${partLabel}，使用 ${editionLabel} 规则理解检定，但不要改写作者剧情，也不要向玩家泄露秘密。角色要求必须区分 required/recommended；无法转成数字、NdM、四则运算、括号、age或属性引用的车卡公式标记 manual=true。粉红/茶番只是风格建议，不能代替人数结构。\n\n${sourceText}\n\n只输出 JSON：{"partIndex":${partIndex},"title":"","keeperSummary":"完整因果与真相","openingHook":"不剧透开场钩子","recommendedPlayMode":"solo|pc_kpc|duo_pc|party","recommendedStoryTones":["pink|tea"],"characterRequirements":[{"id":"req-1","target":"pc|kpc|both","level":"required|recommended","kind":"new_card|age_range|era|occupation|relationship|play_mode|attribute_formula|background","value":"或数组","sourceLabel":"原文位置","manual":false}],"acts":[{"name":"","purpose":"","scenes":[""]}],"clues":[{"id":"clue-1","name":"","location":"","revelation":"","required":true,"fallback":"检定失败时仍能如何给出关键线索"}],"checks":[{"id":"check-1","scene":"","skill":"侦查","difficulty":"regular|hard|extreme","purpose":"为什么投骰","success":"成功结果","failure":"失败代价","clueIds":["clue-1"]}],"nodes":[{"id":"node-1","name":"","summary":"","entrances":[""],"clueIds":["clue-1"],"revelationIds":["rev-1"],"nextNodeIds":[]}],"revelations":[{"id":"rev-1","statement":"玩家可明确建立的结论","required":true,"clueIds":["clue-1"],"nodeIds":["node-1"]}],"threats":[{"id":"threat-1","name":"","trigger":"","stages":["初始","推进后"],"nodeIds":["node-1"]}],"improvBoundaries":{"fixedFacts":["不可改写的真相/NPC动机/结局条件"],"flexibleDetails":["可合理衍生的场景/NPC反应"]},"npcs":[{"name":"","role":"","motive":"","secret":""}],"endings":[""],"safetyNotes":["可能需要开团前确认的敏感内容"]}`;
}
