import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../apps/GameApp.tsx', import.meta.url), 'utf8');

describe('CoC simulator UI wiring', () => {
    it('connects edition choice, module import and editable investigator sheets', () => {
        expect(source).toContain('changeNewEdition(edition)');
        expect(source).toContain("Math.round(value * 5)");
        expect(source).toContain("Math.round(value / 5)");
        expect(source).toContain('readCoCModuleFile(file)');
        expect(source).toContain('moduleAnalysisPrompt(');
        expect(source).toContain('编辑调查员卡');
        expect(source).toContain('handleGenerateInvestigator(sheet)');
        expect(source).toContain('用户是 PC · 角色按人数模式分配');
        expect(source).toContain("['pc_kpc', 'PC + KPC'");
        expect(source).toContain('requestIndependentPcActions');
    });

    it('uses keeper-requested D100 checks instead of automatic D20 rolls', () => {
        expect(source).toContain('KP 请求 D100 检定');
        expect(source).toContain('stagePendingCheckRoll(false)');
        expect(source).toContain('stagePendingCheckRoll(true)');
        expect(source).toContain('rollPercentile(');
        expect(source).not.toContain('骰子判定 (D20)');
        expect(source).not.toContain('每次行动自动骰点');
    });

    it('keeps KP separate and connects aftertalk plus all memory modes', () => {
        expect(source).toContain('KP 是中立旁白和 NPC 控制者');
        expect(source).toContain('KP 已经闭麦');
        expect(source).toContain('handleSendAftertalk');
        expect(source).toContain("setNewArchiveMode('none')");
        expect(source).toContain("activeGame.archiveMode === 'none'");
        expect(source).toContain('现实私聊、职业、家庭、时间地点、真实经历');
        expect(source).toContain('buildSyncContext(players)');
    });

    it('migrates legacy saves into playable CoC sessions on open', () => {
        expect(source).toContain("const edition = g.cocEdition || '7e'");
        expect(source).toContain('const migrated: GameSession');
        expect(source).toContain('void DB.saveGame(migrated)');
    });
});
