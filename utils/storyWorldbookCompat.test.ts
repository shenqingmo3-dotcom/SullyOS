import { describe, expect, it } from 'vitest';
import type { StoryWorldbookDocument } from '../types';
import {
    injectStoryWorldbookDepthEntries,
    parseStoryWorldbook,
    runStoryWorldbooks,
    serializeStoryWorldbook,
    setStoryWorldbookEntryEnabled,
} from './storyWorldbookCompat';

const topLevelFixture = () => ({
    _wm: 'keep-me',
    entries: {
        0: {
            uid: 7,
            comment: '月港',
            content: '月港的潮汐会发光。',
            key: ['月港'],
            keysecondary: [],
            constant: false,
            selective: false,
            selectiveLogic: 0,
            order: 120,
            position: 4,
            depth: 1,
            role: 2,
            disable: true,
            probability: 75,
            useProbability: true,
            future_field: { untouched: true },
        },
    },
});

const runtimeBook = (): StoryWorldbookDocument => parseStoryWorldbook(JSON.stringify({
    recursive: true,
    token_budget: 100,
    entries: {
        0: { uid: 0, comment: '起点', content: '暗号：蓝鲸', constant: true, order: 300, position: 0, disable: false },
        1: { uid: 1, comment: '递归', content: '递归命中', key: ['蓝鲸'], order: 250, position: 4, depth: 1, role: 2, disable: false },
        2: { uid: 2, comment: '组甲', content: '组甲', constant: true, group: '潮汐', groupWeight: 1, order: 200, position: 1, disable: false },
        3: { uid: 3, comment: '组乙', content: '组乙', constant: true, group: '潮汐', groupWeight: 3, order: 190, position: 1, disable: false },
        4: { uid: 4, comment: '延迟', content: '第二轮出现', constant: true, delay: 2, order: 180, position: 1, disable: false },
        5: { uid: 5, comment: '黏着', content: '短暂保持', key: ['火花'], sticky: 1, cooldown: 1, order: 170, position: 1, disable: false },
        6: { uid: 6, comment: '超预算', content: '很长'.repeat(300), constant: true, order: 10, position: 1, disable: false },
        7: { uid: 7, comment: '正则键', content: '正则命中', key: ['/火(花|苗)/u'], order: 160, position: 1, disable: false },
    },
}), 'runtime.json', 10);

describe('story worldbook import', () => {
    it('normalizes top-level World Info and preserves unknown data on export', () => {
        const document = parseStoryWorldbook(JSON.stringify(topLevelFixture()), '月港.json', 1);
        expect(document).toMatchObject({
            name: '月港',
            sourceKind: 'sillytavern-world-info',
            sourcePath: 'entries',
            baseline: '1.18.0/51ad27f',
        });
        expect(document.entries[0]).toMatchObject({
            uid: 7,
            disabled: true,
            keys: ['月港'],
            position: 4,
            depth: 1,
            role: 2,
        });

        const enabled = setStoryWorldbookEntryEnabled(document, document.entries[0].id, true);
        const exported = JSON.parse(serializeStoryWorldbook(enabled));
        expect(exported._wm).toBe('keep-me');
        expect(exported.entries['0'].disable).toBe(false);
        expect(exported.entries['0'].future_field).toEqual({ untouched: true });
    });

    it('normalizes both Character Card v2/v3 locations and maps extensions losslessly', () => {
        const characterBook = {
            name: '卡内设定',
            scan_depth: 6,
            token_budget: 777,
            recursive_scanning: true,
            entries: [{
                id: 3,
                keys: ['灯塔'],
                secondary_keys: ['夜晚'],
                comment: '灯塔守则',
                content: '灯塔只在夜晚开放。',
                constant: false,
                selective: true,
                insertion_order: 55,
                enabled: false,
                position: 'before_char',
                extensions: { position: 4, depth: 2, role: 1, group: '地点', custom: 'keep' },
            }],
        };
        for (const raw of [{ character_book: characterBook }, { data: { character_book: characterBook } }]) {
            const document = parseStoryWorldbook(JSON.stringify(raw), 'card.json', 2);
            expect(document.sourceKind).toBe('character-card-v2-v3');
            expect(document.settings).toMatchObject({ scanDepth: 6, tokenBudget: 777, recursive: true });
            expect(document.entries[0]).toMatchObject({ disabled: true, keys: ['灯塔'], secondaryKeys: ['夜晚'], position: 4, depth: 2, role: 1, group: '地点' });
            const exported = JSON.parse(serializeStoryWorldbook(document));
            const book = raw.character_book ? exported.character_book : exported.data.character_book;
            expect(book.entries[0].extensions.custom).toBe('keep');
        }

        const standalone = parseStoryWorldbook(JSON.stringify(characterBook), 'standalone-lorebook.json', 4);
        expect(standalone).toMatchObject({ sourceKind: 'character-card-v2-v3', sourcePath: 'entries' });
        expect(standalone.entries[0]).toMatchObject({ keys: ['灯塔'], disabled: true, position: 4 });
    });

    it('keeps an all-disabled 41-entry book complete while executing zero entries', () => {
        const entries = Object.fromEntries(Array.from({ length: 41 }, (_, index) => [index, {
            uid: index,
            comment: `条目 ${index}`,
            content: `正文 ${index}`,
            constant: true,
            disable: true,
            position: index % 7,
        }]));
        const document = parseStoryWorldbook(JSON.stringify({ entries, _build: 'keep' }), '四十一条.json', 3);
        const result = runStoryWorldbooks({ documents: [document], messages: [{ content: '正文' }], seed: 'disabled', trigger: 'normal', userName: '用户', characterNames: ['角色'] });
        expect(document.entries).toHaveLength(41);
        expect(result.activatedEntryIds).toEqual([]);
        expect(result.report.filter(item => item.status === 'disabled')).toHaveLength(41);
        expect(JSON.parse(serializeStoryWorldbook(document))._build).toBe('keep');
    });
});

describe('story worldbook runtime', () => {
    it('runs recursion, groups, budget and timed effects deterministically across turns', () => {
        const document = runtimeBook();
        const base = { documents: [document], seed: 'same-seed', trigger: 'normal' as const, userName: '小雨', characterNames: ['阿澈'] };
        const first = runStoryWorldbooks({ ...base, messages: [{ role: 'user', content: '看见火花' }] });
        const secondPreview = runStoryWorldbooks({ ...base, messages: [{ role: 'user', content: '海面平静' }], state: first.state });
        const secondSend = runStoryWorldbooks({ ...base, messages: [{ role: 'user', content: '海面平静' }], state: first.state });
        const third = runStoryWorldbooks({ ...base, messages: [{ role: 'user', content: '海面平静' }], state: secondSend.state });

        expect(first.worldBefore).toContain('暗号：蓝鲸');
        expect(first.depthEntries.map(entry => entry.content)).toContain('递归命中');
        expect(first.report.filter(item => item.status === 'activated' && ['组甲', '组乙'].includes(item.name))).toHaveLength(1);
        expect(first.report.find(item => item.name === '延迟')?.status).toBe('delay');
        expect(first.report.find(item => item.name === '超预算')?.status).toBe('budget');
        expect(first.report.find(item => item.name === '正则键')?.status).toBe('activated');
        expect(secondPreview).toEqual(secondSend);
        expect(secondSend.report.find(item => item.name === '黏着')).toMatchObject({ status: 'activated', reason: '由 sticky 状态继续生效。' });
        expect(secondSend.report.find(item => item.name === '延迟')?.status).toBe('activated');
        expect(third.report.find(item => item.name === '黏着')?.status).toBe('cooldown');
    });

    it('injects @depth entries with their original roles and stable order', () => {
        const messages = [
            { role: 'system' as const, content: '系统' },
            { role: 'user' as const, content: '旧消息' },
            { role: 'assistant' as const, content: '新消息' },
        ];
        const injected = injectStoryWorldbookDepthEntries(messages, [
            { entryId: 'b', content: '后', depth: 1, role: 2, order: 20, sourceIndex: 1 },
            { entryId: 'a', content: '前', depth: 1, role: 1, order: 10, sourceIndex: 0 },
        ]);
        expect(injected.map(item => `${item.role}:${item.content}`)).toEqual([
            'system:系统',
            'user:旧消息',
            'user:前',
            'assistant:后',
            'assistant:新消息',
        ]);
    });
});
