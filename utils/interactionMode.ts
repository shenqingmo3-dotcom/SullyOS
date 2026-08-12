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

export function buildOfflineSceneRules(): string {
    return `### 线下场景写作规则
用户和角色正处于同一个现实场景，用户的普通文字视为当面说出口的话。

格式要求（必须遵守）：
1. 每次回复都要有动作和说话。动作叙述使用第三人称，以角色名、他/她或 ta 指代角色；对白里可以正常使用“我”。
2. 动作叙述必须以 "> " 开头，并独占一行；这一行就是一个动作气泡。
3. 说出口的话必须用中文引号“……”包住，并独占一行；这一行就是一个对白气泡。
4. 动作和对白绝不能写在同一行或同一个气泡里。通常先发一个完整动作气泡，再发一个完整对白气泡；发生明显场景转折时才再次交替。

写作方式：
- 动作气泡写完整的场景节拍，同一时刻的内容合并成一个连贯段落，包括连续动作、神态、观察、身体反应、环境和氛围；不要拆成一串短动作。
- 不直接写内心想法或心理分析，用目光、表情、姿态、语气和实际行为表现情绪。
- 延续已经建立的地点和双方距离。跨越空间时写出移动过程，距离不够时不能突然触碰、拥抱或亲吻，也不能瞬移。
- 对白是自然说出口的话，可以比线上聊天更长、更有情绪和层次。

无论回复长短，动作气泡与对白气泡始终分开。`;
}

export function buildInteractionModePrompt(char: CharacterProfile, userName: string): string {
    const mode = currentInteractionMode(char);
    const location = char.interactionScene?.location?.trim();
    const distance = char.interactionScene?.distance?.trim();
    const currentScene = mode === 'offline'
        ? `当前是线下相处。${location ? `地点：${location}。` : ''}${distance ? `距离：${distance}。` : '距离未更新时沿用前文已经建立的距离。'}`
        : `当前是线上聊天。你和 ${userName} 不在同一个现实场景。`;

    const format = mode === 'online'
        ? `线上沿用 SullyOS 原版聊天规则：只输出真实手机聊天文本，简短自然；禁止动作、表情、环境、身体反应、内心独白、第三人称旁白、时间戳、姓名前缀和任何括号动作。`
        : buildOfflineSceneRules();
    return `
### 当前互动状态（唯一有效）
${currentScene}

${format}
社交平台、网页和 MCP 等工具在两种状态下都可照常使用，工具调用不会改变状态；当前状态持续有效。只有用户明确切换或证据清楚地建立“来到同一地点/分别后继续发消息”时才改变状态，不要猜。切换时在回复最前输出隐藏控制标记，系统会自动吞掉：
- 线上：[[INTERACTION_MODE:online]]
- 线下：[[INTERACTION_MODE:offline|location=实际地点|distance=当前距离]]
标记后立刻按新状态回应。`;
}
