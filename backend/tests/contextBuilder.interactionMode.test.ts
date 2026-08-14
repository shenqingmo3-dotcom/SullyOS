import { describe, expect, it } from 'vitest';
import { formatInteractionState } from '../src/contextBuilder.js';

describe('formatInteractionState 线下显式气泡边界', () => {
  const metadata = {
    interactionMode: 'offline',
    interactionScene: { location: '客厅', distance: '面对面' },
  };

  it('普通聊天要求动作和对白用真实换行分开，并允许动作内拟声词引号', () => {
    const prompt = formatInteractionState(metadata, 'chat');

    expect(prompt).toContain('气泡边界只由你实际输出的换行决定');
    expect(prompt).toContain('带引号的拟声词或模仿语');
    expect(prompt).toContain('> 她抬手学着门响，“咔哒”了一声，又笑起来。');
    expect(prompt).toContain('第一行整体是动作气泡，第二行才是对白气泡');
  });

  it('heartbeat 要求 messages 数组一项一个气泡，不按动作内引号拆分', () => {
    const prompt = formatInteractionState(metadata, 'heartbeat');

    expect(prompt).toContain('每个数组元素就是一个完整气泡');
    expect(prompt).toContain('两者不能放在同一个元素');
    expect(prompt).toContain('它们仍属于整个动作气泡，不能另拆成对白');
  });

  it('线上提示不注入线下拟声词和气泡规则', () => {
    const prompt = formatInteractionState({ interactionMode: 'online' }, 'chat');

    expect(prompt).not.toContain('带引号的拟声词或模仿语');
    expect(prompt).not.toContain('每个数组元素就是一个完整气泡');
  });
});
