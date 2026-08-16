import { describe, expect, it } from 'vitest';
import { buildKeeperModulePacket, docxXmlToText, formatCoCRequirementValue, normalizeCoCModuleAnalysis, updateCoCModuleProgress, validateCoCModuleChunk } from './cocModule';

describe('CoC module analysis normalization', () => {
    it('keeps clue and check links while filling safe fallbacks', () => {
        const result = normalizeCoCModuleAnalysis({
            title: '雾港',
            clues: [{ id: 'clue-map', name: '潮湿地图', required: true }],
            checks: [{ id: 'check-map', skill: '侦查', difficulty: 'hard', clueIds: ['clue-map'] }],
        }, '导入模组');
        expect(result.clues[0]).toMatchObject({ id: 'clue-map', required: true });
        expect(result.clues[0].fallback).toContain('关键线索');
        expect(result.checks[0]).toMatchObject({ difficulty: 'hard', clueIds: ['clue-map'] });
    });

    it('rejects duplicate IDs and dangling references instead of saving a partial map', () => {
        expect(() => normalizeCoCModuleAnalysis({
            clues: [{ id: 'same' }, { id: 'same' }],
        }, '坏模组')).toThrow('重复 ID');
        expect(() => normalizeCoCModuleAnalysis({
            clues: [],
            checks: [{ id: 'check-1', clueIds: ['missing'] }],
        }, '坏模组')).toThrow('不存在的 ID');
        expect(() => validateCoCModuleChunk({ partIndex: 2, clues: [], checks: [], npcs: [], endings: [] }, 1)).toThrow('序号');
    });

    it('normalizes object-shaped formulas and removes exact duplicate requirements', () => {
        const result = normalizeCoCModuleAnalysis({
            characterRequirements: [
                { id: 'str-a', target: 'pc', kind: 'attribute_formula', value: { attribute: 'STR', formula: '3D6*5' }, sourceLabel: '车卡规则' },
                { id: 'str-b', target: 'pc', kind: 'attribute_formula', value: { attribute: 'STR', formula: '3D6*5' }, sourceLabel: '车卡规则' },
                { id: 'edu', target: 'pc', kind: 'attribute_formula', value: { EDU: 'age' }, sourceLabel: '车卡规则' },
            ],
        }, '测试模组');

        expect(result.characterRequirements.map(item => item.value)).toEqual(['STR=3D6*5', 'EDU=age']);
        expect(formatCoCRequirementValue({ attribute: 'POW', formula: '2D6+6' }, 'attribute_formula')).toBe('POW=2D6+6');
    });

    it('extracts DOCX paragraphs and table cells in document order', () => {
        const xml = `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>第一段&amp;</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格文字</w:t><w:tab/><w:t>后半</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
        expect(docxXmlToText(xml)).toBe('第一段&\n\n表格文字\t后半');
        expect(() => docxXmlToText('<broken>')).toThrow('XML 已损坏');
    });

    it('builds a bounded keeper packet and only counts stalled investigation turns', () => {
        const analysis = normalizeCoCModuleAnalysis({
            keeperSummary: '真相',
            clues: [{ id: 'clue-1', required: true }],
            nodes: [{ id: 'node-1', clueIds: ['clue-1'], revelationIds: ['rev-1'], nextNodeIds: [] }],
            revelations: [{ id: 'rev-1', statement: '门后有人', required: true, clueIds: ['clue-1'], nodeIds: ['node-1'] }],
            threats: [{ id: 'threat-1', stages: ['潜伏', '出现'], nodeIds: ['node-1'] }],
            improvBoundaries: { fixedFacts: ['凶手不变'], flexibleDetails: ['天气可变'] },
        }, '测试模组');
        expect(buildKeeperModulePacket(analysis, undefined)).toContain('unresolvedRequiredRevelations');
        const stalled = updateCoCModuleProgress(analysis, undefined, { turn_kind: 'investigation' }, [], []);
        expect(stalled.stalledInvestigationTurns).toBe(1);
        const roleplay = updateCoCModuleProgress(analysis, stalled, { turn_kind: 'roleplay' }, [], []);
        expect(roleplay.stalledInvestigationTurns).toBe(1);
        const progressed = updateCoCModuleProgress(analysis, roleplay, { turn_kind: 'investigation', established_revelation_ids: ['rev-1'], threat_steps: { 'threat-1': 99 } }, [], ['clue-1']);
        expect(progressed).toMatchObject({ establishedRevelationIds: ['rev-1'], stalledInvestigationTurns: 0, threatSteps: { 'threat-1': 1 } });
    });
});
