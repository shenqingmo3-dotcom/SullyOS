import type { CoCModuleAnalysis } from '../types';

const MAX_MODULE_CHARS = 800_000;

export async function readCoCModuleFile(file: File): Promise<string> {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
        const pages: string[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
            const page = await document.getPage(pageNumber);
            const content = await page.getTextContent();
            const text = content.items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim();
            if (text) pages.push(`\n【第 ${pageNumber} 页】\n${text}`);
            if (pages.join('').length > MAX_MODULE_CHARS) break;
        }
        return pages.join('\n').slice(0, MAX_MODULE_CHARS).trim();
    }
    if (!/\.(txt|md|markdown|json)$/i.test(lower) && !file.type.startsWith('text/') && file.type !== 'application/json') {
        throw new Error('目前支持 PDF、TXT、Markdown 与 JSON 模组文件');
    }
    return (await file.text()).slice(0, MAX_MODULE_CHARS).trim();
}

export function normalizeCoCModuleAnalysis(value: any, fallbackTitle: string): CoCModuleAnalysis {
    const list = (input: unknown): any[] => Array.isArray(input) ? input : [];
    const text = (input: unknown, fallback = ''): string => typeof input === 'string' && input.trim() ? input.trim() : fallback;
    return {
        title: text(value?.title, fallbackTitle),
        keeperSummary: text(value?.keeperSummary || value?.keeper_summary, '尚未生成完整 KP 摘要'),
        openingHook: text(value?.openingHook || value?.opening_hook, '调查员被卷入了一起异常事件。'),
        acts: list(value?.acts).map((item, index) => ({
            name: text(item?.name, `阶段 ${index + 1}`),
            purpose: text(item?.purpose),
            scenes: list(item?.scenes).map(scene => text(scene)).filter(Boolean),
        })),
        clues: list(value?.clues).map((item, index) => ({
            id: text(item?.id, `clue-${index + 1}`),
            name: text(item?.name, `线索 ${index + 1}`),
            location: text(item?.location),
            revelation: text(item?.revelation),
            required: item?.required !== false,
            fallback: text(item?.fallback, '即使检定失败，KP 也应以代价、延迟或不完整信息交付关键线索。'),
        })),
        checks: list(value?.checks).map((item, index) => ({
            id: text(item?.id, `check-${index + 1}`),
            scene: text(item?.scene),
            skill: text(item?.skill, '侦查'),
            difficulty: ['hard', 'extreme'].includes(item?.difficulty) ? item.difficulty : 'regular',
            purpose: text(item?.purpose),
            success: text(item?.success),
            failure: text(item?.failure),
            clueIds: list(item?.clueIds || item?.clue_ids).map(id => text(id)).filter(Boolean),
        })),
        npcs: list(value?.npcs).map(item => ({
            name: text(item?.name, '未命名 NPC'),
            role: text(item?.role),
            motive: text(item?.motive),
            secret: text(item?.secret),
        })),
        endings: list(value?.endings).map(item => text(item)).filter(Boolean),
        safetyNotes: list(value?.safetyNotes || value?.safety_notes).map(item => text(item)).filter(Boolean),
    };
}

export function moduleAnalysisPrompt(sourceText: string, editionLabel: string, partLabel = '完整模组'): string {
    return `你是守秘人备团助手。请分析下面的 ${partLabel}，使用 ${editionLabel} 规则理解检定，但不要改写作者剧情，也不要向玩家泄露秘密。\n\n${sourceText}\n\n只输出 JSON：{"title":"","keeperSummary":"完整因果与真相","openingHook":"不剧透开场钩子","acts":[{"name":"","purpose":"","scenes":[""]}],"clues":[{"id":"clue-1","name":"","location":"","revelation":"","required":true,"fallback":"检定失败时仍能如何给出关键线索"}],"checks":[{"id":"check-1","scene":"","skill":"侦查","difficulty":"regular|hard|extreme","purpose":"为什么投骰","success":"成功结果","failure":"失败代价","clueIds":["clue-1"]}],"npcs":[{"name":"","role":"","motive":"","secret":""}],"endings":[""],"safetyNotes":["可能需要开团前确认的敏感内容"]}`;
}
