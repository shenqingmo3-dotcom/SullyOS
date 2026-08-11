import { describe, expect, it } from 'vitest';
import { formatNpcNetworkContext, relevantNpcNetwork } from './npcNetwork';

const entries: any[] = [{
    id: 'npc-1', name: '阿青', persona: '同班同学', userRelation: '室友', userAffinity: 120,
    characterRelations: [
        { charId: 'char-a', relation: '朋友', affinity: 75 },
        { charId: 'char-b', relation: '不熟', affinity: -10 },
    ],
}];

describe('npcNetwork', () => {
    it('只向选中的角色注入对应关系并约束好感范围', () => {
        expect(relevantNpcNetwork(entries, 'char-a')).toEqual([expect.objectContaining({
            name: '阿青', userAffinity: 100, characterRelation: '朋友', characterAffinity: 75,
        })]);
        expect(relevantNpcNetwork(entries, 'char-c')).toEqual([]);
    });

    it('关系上下文明确影响聊天、日程和自主活动但不强行提及', () => {
        const context = formatNpcNetworkContext(entries, 'char-b');
        expect(context).toContain('NPC 关系网');
        expect(context).toContain('和用户是“室友”（好感 100/100）');
        expect(context).toContain('和你是“不熟”（好感 0/100）');
        expect(context).toContain('对话、日程安排和自主活动');
    });
});
