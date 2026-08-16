import type {
    CoCModuleAnalysis,
    CoCDifficulty,
    CoCEdition,
    CoCInvestigatorSheet,
    CoCSuccessLevel,
} from '../types';

export type CoCInvestigatorRole = 'pc' | 'kpc';

export interface CoCRollResult {
    edition: CoCEdition;
    roll: number;
    candidates: number[];
    target: number;
    difficulty: CoCDifficulty;
    modifier: -2 | -1 | 0 | 1 | 2;
    successLevel: CoCSuccessLevel;
    success: boolean;
}

export const COC_CORE_SKILLS: Record<string, number> = {
    侦查: 25,
    聆听: 20,
    图书馆使用: 20,
    心理学: 10,
    说服: 10,
    话术: 5,
    恐吓: 15,
    魅惑: 15,
    潜行: 20,
    急救: 30,
    医学: 1,
    神秘学: 5,
    克苏鲁神话: 0,
    闪避: 20,
    斗殴: 25,
    手枪: 20,
};

const clampPercent = (value: number): number => Math.max(0, Math.min(100, Math.round(value || 0)));
const d10 = (random: () => number): number => Math.floor(random() * 10);

export function rollPercentile(
    edition: CoCEdition,
    target: number,
    difficulty: CoCDifficulty = 'regular',
    modifier: -2 | -1 | 0 | 1 | 2 = 0,
    random: () => number = Math.random,
): CoCRollResult {
    const units = d10(random);
    const tensCount = edition === '7e' ? 1 + Math.abs(modifier) : 1;
    const tens = Array.from({ length: tensCount }, () => d10(random));
    const candidates = tens.map(value => {
        const combined = value * 10 + units;
        return combined === 0 ? 100 : combined;
    });
    const roll = modifier > 0 ? Math.min(...candidates) : modifier < 0 ? Math.max(...candidates) : candidates[0];
    const normalizedTarget = clampPercent(target);
    const level = evaluateCoCRoll(edition, roll, normalizedTarget);
    const rank: Record<CoCSuccessLevel, number> = {
        fumble: -1,
        failure: 0,
        regular: 1,
        special: 2,
        hard: 2,
        extreme: 3,
        critical: 4,
    };
    const requiredRank = edition === '6e' || difficulty === 'regular' ? 1 : difficulty === 'hard' ? 2 : 3;
    return {
        edition,
        roll,
        candidates,
        target: normalizedTarget,
        difficulty,
        modifier,
        successLevel: level,
        success: rank[level] >= requiredRank,
    };
}

export function evaluateCoCRoll(edition: CoCEdition, roll: number, target: number): CoCSuccessLevel {
    const value = Math.max(1, Math.min(100, Math.round(roll)));
    const skill = clampPercent(target);
    if (value === 1) return 'critical';
    if (edition === '7e') {
        const fumbleAt = skill < 50 ? 96 : 100;
        if (value >= fumbleAt) return 'fumble';
        if (value > skill) return 'failure';
        if (value <= Math.floor(skill / 5)) return 'extreme';
        if (value <= Math.floor(skill / 2)) return 'hard';
        return 'regular';
    }
    if (value >= 96) return 'fumble';
    if (value > skill) return 'failure';
    if (value <= Math.max(1, Math.floor(skill / 5))) return 'special';
    return 'regular';
}

export function cocSuccessLabel(level: CoCSuccessLevel): string {
    return ({
        critical: '大成功',
        extreme: '极难成功',
        hard: '困难成功',
        special: '特殊成功',
        regular: '成功',
        failure: '失败',
        fumble: '大失败',
    } as const)[level];
}

export function createBlankInvestigator(ownerId: string, name: string, edition: CoCEdition): CoCInvestigatorSheet {
    const characteristics = edition === '7e'
        ? { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 60, POW: 60, EDU: 60 }
        : { STR: 10, CON: 10, SIZ: 10, DEX: 10, APP: 10, INT: 12, POW: 12, EDU: 12 };
    const maxHp = edition === '7e'
        ? Math.floor((characteristics.CON + characteristics.SIZ) / 10)
        : Math.ceil((characteristics.CON + characteristics.SIZ) / 2);
    return {
        id: `investigator-${ownerId}`,
        ownerId,
        name,
        occupation: '调查员',
        age: 28,
        era: '1920s',
        characteristics,
        hp: maxHp,
        maxHp,
        mp: edition === '7e' ? Math.floor(characteristics.POW / 5) : characteristics.POW,
        maxMp: edition === '7e' ? Math.floor(characteristics.POW / 5) : characteristics.POW,
        san: edition === '7e' ? characteristics.POW : characteristics.POW * 5,
        luck: edition === '7e' ? 50 : characteristics.POW * 5,
        skills: { ...COC_CORE_SKILLS },
        inventory: [],
        backstory: '',
    };
}

export function evaluateCoCFormula(
    expression: string,
    variables: Record<string, number>,
    random: () => number = Math.random,
): number {
    const compact = expression.replace(/\s+/g, '');
    const tokens = compact.match(/\d*[dD]\d+|\d+(?:\.\d+)?|[A-Za-z_]+|[()+\-*/]/g) || [];
    if (!compact || tokens.join('').toLowerCase() !== compact.toLowerCase()) throw new Error(`无法识别公式：${expression}`);
    let index = 0;
    const valueOf = (token: string): number => {
        if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token);
        const dice = token.match(/^(\d*)[dD](\d+)$/);
        if (dice) {
            const count = Number(dice[1] || 1);
            const faces = Number(dice[2]);
            if (count < 1 || count > 20 || faces < 2 || faces > 1000) throw new Error(`骰子公式超出范围：${token}`);
            return Array.from({ length: count }, () => Math.floor(random() * faces) + 1).reduce((sum, value) => sum + value, 0);
        }
        const key = token.toUpperCase();
        const value = variables[key] ?? variables[token];
        if (!Number.isFinite(value)) throw new Error(`公式引用了未知变量：${token}`);
        return value;
    };
    const primary = (): number => {
        const token = tokens[index++];
        if (token === '+' || token === '-') return (token === '-' ? -1 : 1) * primary();
        if (token === '(') {
            const result = addition();
            if (tokens[index++] !== ')') throw new Error(`公式缺少右括号：${expression}`);
            return result;
        }
        if (!token) throw new Error(`公式不完整：${expression}`);
        return valueOf(token);
    };
    const multiplication = (): number => {
        let result = primary();
        while (tokens[index] === '*' || tokens[index] === '/') {
            const operator = tokens[index++];
            const right = primary();
            if (operator === '/' && right === 0) throw new Error('公式不能除以零');
            result = operator === '*' ? result * right : result / right;
        }
        return result;
    };
    const addition = (): number => {
        let result = multiplication();
        while (tokens[index] === '+' || tokens[index] === '-') {
            const operator = tokens[index++];
            const right = multiplication();
            result = operator === '+' ? result + right : result - right;
        }
        return result;
    };
    const result = addition();
    if (index !== tokens.length || !Number.isFinite(result)) throw new Error(`公式无法完整求值：${expression}`);
    return Math.round(result);
}

export function moduleRequirementsForRole(analysis: CoCModuleAnalysis | undefined, role: CoCInvestigatorRole) {
    return (analysis?.characterRequirements || []).filter(requirement => requirement.target === role || requirement.target === 'both');
}

export function applyModuleRequirementsToInvestigator(
    sheet: CoCInvestigatorSheet,
    edition: CoCEdition,
    analysis: CoCModuleAnalysis | undefined,
    role: CoCInvestigatorRole,
    random: () => number = Math.random,
): CoCInvestigatorSheet {
    const requirements = moduleRequirementsForRole(analysis, role).filter(item => item.level === 'required' && !item.manual);
    let next: CoCInvestigatorSheet = { ...sheet, characteristics: { ...sheet.characteristics } };
    for (const requirement of requirements) {
        if (requirement.kind === 'age_range') {
            const ages = (Array.isArray(requirement.value)
                ? requirement.value.map(Number)
                : String(requirement.value).match(/\d+/g)?.map(Number) || [])
                .filter(Number.isFinite);
            if (ages.length) next.age = Math.min(...ages);
        } else if (requirement.kind === 'era' && typeof requirement.value === 'string') {
            next.era = requirement.value;
        } else if (requirement.kind === 'occupation' && typeof requirement.value === 'string') {
            next.occupation = requirement.value;
        } else if ((requirement.kind === 'background' || requirement.kind === 'relationship') && typeof requirement.value === 'string') {
            next.backstory = [next.backstory, requirement.value].filter(Boolean).join('；');
        } else if (requirement.kind === 'attribute_formula' && typeof requirement.value === 'string') {
            const match = requirement.value.match(/^([A-Za-z]+)\s*=\s*(.+)$/);
            const key = match?.[1].toUpperCase() as keyof CoCInvestigatorSheet['characteristics'];
            if (match && key in next.characteristics) {
                const variables = { ...next.characteristics, AGE: next.age || 0, age: next.age || 0 };
                next.characteristics[key] = evaluateCoCFormula(match[2], variables, random);
            }
        }
    }
    return normalizeInvestigator(next, edition);
}

export function normalizeInvestigator(sheet: CoCInvestigatorSheet, edition: CoCEdition): CoCInvestigatorSheet {
    const characteristics = Object.fromEntries(Object.entries(sheet.characteristics).map(([key, value]) => [
        key,
        edition === '7e' ? clampPercent(value) : Math.max(1, Math.min(30, Math.round(value || 0))),
    ])) as CoCInvestigatorSheet['characteristics'];
    const maxHp = edition === '7e'
        ? Math.max(1, Math.floor((characteristics.CON + characteristics.SIZ) / 10))
        : Math.max(1, Math.ceil((characteristics.CON + characteristics.SIZ) / 2));
    const maxMp = edition === '7e' ? Math.floor(characteristics.POW / 5) : characteristics.POW;
    return {
        ...sheet,
        characteristics,
        maxHp,
        hp: Math.max(0, Math.min(maxHp, Math.round(sheet.hp ?? maxHp))),
        maxMp,
        mp: Math.max(0, Math.min(maxMp, Math.round(sheet.mp ?? maxMp))),
        san: clampPercent(sheet.san),
        luck: clampPercent(sheet.luck),
        skills: Object.fromEntries(Object.entries(sheet.skills || {}).map(([key, value]) => [key, clampPercent(value)])),
    };
}

export function formatInvestigatorForKeeper(sheet: CoCInvestigatorSheet): string {
    const characteristics = Object.entries(sheet.characteristics).map(([key, value]) => `${key} ${value}`).join(' / ');
    const skills = Object.entries(sheet.skills).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([name, value]) => `${name} ${value}`).join('、');
    return `【${sheet.name}】${sheet.occupation}；${characteristics}；HP ${sheet.hp}/${sheet.maxHp}；MP ${sheet.mp}/${sheet.maxMp}；SAN ${sheet.san}；Luck ${sheet.luck}；主要技能：${skills || '未填写'}；随身物品：${sheet.inventory.join('、') || '无'}；背景：${sheet.backstory || '未填写'}`;
}

export function cocRulePrompt(edition: CoCEdition): string {
    if (edition === '7e') return `规则版本：Call of Cthulhu 第 7 版。所有技能与属性检定使用 1D100，结果不高于目标值为常规成功，不高于二分之一为困难成功，不高于五分之一为极难成功；01 为大成功。技能低于 50 时 96-100 为大失败，技能至少 50 时仅 100 为大失败。优势或劣势使用奖励骰/惩罚骰替换十位骰；失败后只有在叙事上可合理加码时才允许孤注一掷，并必须先说明失败后果。SAN 检定按成功损失/失败损失分别结算。关键线索不能因一次失败永久断线。`;
    return `规则版本：Call of Cthulhu 第 6 版。所有技能与属性检定使用 1D100，结果不高于目标值为成功；01 为大成功，成功结果不高于技能五分之一可作为特殊成功，96-100 为大失败。第 6 版不使用第 7 版的困难/极难等级、奖励骰/惩罚骰或孤注一掷规则。属性值按第 6 版量级解释；SAN 检定按成功损失/失败损失分别结算。关键线索不能因一次失败永久断线。`;
}
