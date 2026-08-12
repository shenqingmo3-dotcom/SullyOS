import { describe, expect, it } from 'vitest';
import { formatRecentEventContent } from '../src/contextBuilder.js';

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
});
