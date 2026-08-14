import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/db.js', () => ({ pool: { query: db.query } }));

import { buildAgentContextMessages } from '../src/contextBuilder.js';

const now = new Date('2026-08-14T08:00:00.000Z');
const sampleText = `[Mode A]\n{{char}}在线上和{{user}}交谈。\n\n[Mode B]\n动作里的“咔哒”仍是正文。`;

let mountedWorldbooks: Array<Record<string, unknown>> = [];

function target() {
  return {
    agent_id: 'agent-1',
    conversation_id: 'conversation-1',
    name: '小冰',
    description: '角色备注',
    system_prompt: '核心人设',
    worldview: null,
    writer_persona: null,
    legacy_memories: null,
    refined_memories: null,
    user_name: '旧兼容名',
    user_bio: '旧兼容简介',
    metadata: {
      mountedWorldbooks,
      userSnapshot: { name: '小鱼', bio: '新简介', npcNetwork: [] },
      interactionMode: 'online',
    },
    timezone: 'Pacific/Auckland',
  };
}

describe('heartbeat SharkOS worldbook integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mountedWorldbooks = [
      {
        id: 'constant', title: '线上转线下', category: '互动模式', content: sampleText,
        constant: true, position: 1,
      },
      {
        id: 'recent-keyword', title: '近期关键词', content: '近期命中内容',
        constant: false, key: ['海边'], position: 1,
      },
      {
        id: 'expired-keyword', title: '过期关键词', content: '过期历史不得激活',
        constant: false, key: ['旧暗号'], position: 1,
      },
      {
        id: 'depth', title: '指定深度', content: '指定深度内容',
        constant: false, key: ['下雨'], position: 4, depth: 0, role: 1,
      },
      {
        id: 'disabled', title: '已禁用', content: '禁用内容不得出现',
        constant: true, position: 1, disable: true,
      },
    ];
    db.query.mockReset();
    db.query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes('FROM characters a')) return { rows: [target()] };
      if (text.includes('FROM conversation_events')) {
        return {
          rows: [
            {
              actor_type: 'user', content: '海边下雨', event_type: 'user_message',
              occurred_at: new Date(now.getTime() - 60 * 60 * 1_000),
            },
            {
              actor_type: 'assistant', content: '近期回应', event_type: 'assistant_message',
              occurred_at: new Date(now.getTime() - 2 * 60 * 60 * 1_000),
            },
            {
              actor_type: 'user', content: '旧暗号', event_type: 'user_message',
              occurred_at: new Date(now.getTime() - 7 * 60 * 60 * 1_000),
            },
          ],
        };
      }
      if (text.includes('FROM memory_room_plates')) return { rows: [] };
      if (text.includes('FROM memory_items')) return { rows: [] };
      if (text.includes('FROM memory_anticipations')) return { rows: [] };
      throw new Error(`Unexpected query: ${text}`);
    });
  });

  it('builds heartbeat from the saved complete text, filtered history and per-character user snapshot', async () => {
    const context = await buildAgentContextMessages({ characterId: 'char-1', purpose: 'heartbeat' });
    const system = context?.messages[0]?.content ?? '';
    const allContent = context?.messages.map((message) => message.content).join('\n') ?? '';

    expect(system).toContain(sampleText.replace('{{char}}', '小冰').replace('{{user}}', '小鱼'));
    expect(system).toContain('名字：小鱼');
    expect(system).toContain('新简介');
    expect(system).toContain('近期命中内容');
    expect(system).not.toContain('过期历史不得激活');
    expect(system).not.toContain('禁用内容不得出现');
    expect(allContent).toContain('指定深度内容');
    expect(context?.diagnostics.worldbookEntryCount).toBe(3);
  });

  it('stops injecting old text after disabling or unmounting the saved entry', async () => {
    mountedWorldbooks = mountedWorldbooks.map((book) => ({ ...book, disable: true }));
    const disabled = await buildAgentContextMessages({ characterId: 'char-1', purpose: 'heartbeat' });
    expect(disabled?.messages.map((message) => message.content).join('\n')).not.toContain('[Mode A]');
    expect(disabled?.diagnostics.worldbookEntryCount).toBe(0);

    mountedWorldbooks = [];
    const unmounted = await buildAgentContextMessages({ characterId: 'char-1', purpose: 'heartbeat' });
    expect(unmounted?.messages.map((message) => message.content).join('\n')).not.toContain('[Mode A]');
    expect(unmounted?.diagnostics.worldbookEntryCount).toBe(0);
  });
});
