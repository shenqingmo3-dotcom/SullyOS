import type { CharacterProfile, InteractionMode } from '../types';

export interface InteractionModeDirective {
    mode: InteractionMode;
    location?: string;
    distance?: string;
}

const MODE_DIRECTIVE_RE = /\[\[INTERACTION_MODE\s*:\s*(online|offline)(?:\s*\|\s*location\s*=\s*([^|\]\n]+))?(?:\s*\|\s*distance\s*=\s*([^\]\n]+))?\s*\]\]/gi;

export function currentInteractionMode(char: Pick<CharacterProfile, 'interactionMode'>): InteractionMode {
    return char.interactionMode === 'offline' ? 'offline' : 'online';
}

export function extractInteractionModeDirective(content: string): {
    content: string;
    directive: InteractionModeDirective | null;
} {
    let directive: InteractionModeDirective | null = null;
    const cleaned = (content || '').replace(MODE_DIRECTIVE_RE, (_match, mode, location, distance) => {
        directive = {
            mode: mode === 'offline' ? 'offline' : 'online',
            ...(location?.trim() ? { location: location.trim() } : {}),
            ...(distance?.trim() ? { distance: distance.trim() } : {}),
        };
        return '';
    }).replace(/\n{3,}/g, '\n\n').trim();
    return { content: cleaned, directive };
}

export function inferExplicitUserMode(content: string): InteractionMode | null {
    const text = (content || '').trim();
    if (/(?:【|\[)?(?:转线下|线下模式|offline mode|in-person mode)(?:】|\])?/i.test(text)) return 'offline';
    if (/(?:【|\[)?(?:转线上|线上模式|online mode|back to chat|texting)(?:】|\])?/i.test(text)) return 'online';
    return null;
}

export function buildInteractionModePrompt(char: CharacterProfile, userName: string): string {
    const mode = currentInteractionMode(char);
    const location = char.interactionScene?.location?.trim();
    const distance = char.interactionScene?.distance?.trim();
    const currentScene = mode === 'offline'
        ? `当前是线下相处。${location ? `地点：${location}。` : ''}${distance ? `距离：${distance}。` : '距离未更新时沿用前文已经建立的距离。'}`
        : `当前是线上聊天。你和 ${userName} 不在同一个现实场景。`;

    return `
### 线上 / 线下互动状态（当前有效）
${currentScene}

状态持续有效，直到用户或你明确改变它。社交平台、网页和 MCP 等工具在两种状态下都可照常使用，工具使用本身不会切换状态。

**线上聊天规则**：只写真实手机聊天会发出的对话；短而自然；用第一人称说自己、直接称呼 ${userName}；不写动作、神态、环境、身体反应或内心活动，不用括号冒充动作。

**线下相处规则**：普通输入视为当面说出口的话。回复采用一个连续、合并的场景叙述块，再接一个自然的对白块；叙述中用第三人称指代自己，不写直接内心独白。持续追踪地点和双方距离，移动要有过程，距离不够时不能突然触碰，也不能瞬移。不要把同一瞬间拆成许多短动作块。

用户可以直接切换；当对话已经清楚建立“见到了、来到同一地点、一起离开”或“分别后继续发消息”等事实时，你也可以主动切换。只有证据明确时才切换，不要猜。切换时在回复最前面输出一行隐藏控制标记，系统会自动吞掉，绝对不要解释模式变化：
- 线上：[[INTERACTION_MODE:online]]
- 线下：[[INTERACTION_MODE:offline|location=实际地点|distance=当前距离]]
标记之后立刻按照新状态正常回应。`;
}
