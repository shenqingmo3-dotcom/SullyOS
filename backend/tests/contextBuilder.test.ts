import { describe, expect, it } from 'vitest';
import { formatInteractionState, formatRecentEventContent } from '../src/contextBuilder.js';

describe('heartbeat recent-event context', () => {
  const occurredAt = new Date('2026-08-12T20:16:10.000Z');

  it('shows the local event time to heartbeat decisions', () => {
    const content = formatRecentEventContent({
      content: '她已经睡着了。', occurredAt, purpose: 'heartbeat', timezone: 'Pacific/Auckland',
    });
    expect(content).toContain('[记录时间：');
    expect(content).toContain('2026');
    expect(content).toContain('08:16');
    expect(content).toContain('她已经睡着了。');
  });

  it('keeps ordinary chat history free of heartbeat-only time labels', () => {
    expect(formatRecentEventContent({
      content: '[线上聊天] 早上好。', occurredAt, purpose: 'chat', timezone: 'Pacific/Auckland',
    })).toBe('早上好。');
  });

  it('does not carry live offline positioning into a background heartbeat', () => {
    const metadata = {
      interactionMode: 'offline', interactionScene: { location: '卧室', distance: '拥抱中' },
    };
    const heartbeat = formatInteractionState(metadata, 'heartbeat');
    expect(heartbeat).toContain('实时对话之外');
    expect(heartbeat).toContain('不代表你和用户此刻仍保持');
    expect(heartbeat).not.toContain('线下见面：你和用户处在同一个现实场景');

    const chat = formatInteractionState(metadata, 'chat');
    expect(chat).toContain('线下见面：你和用户处在同一个现实场景');
    expect(chat).toContain('地点：卧室');
  });
});
