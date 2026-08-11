import { describe, expect, it } from 'vitest';
import { availableCapabilities, normalizeAutonomyPolicy } from '../src/capabilities.js';
import { buildHeartbeatDecisionPrompt, decideHeartbeat, evaluateHeartbeatGates } from '../src/heartbeat.js';

describe('decideHeartbeat', () => {
  it('does not create content before an AI decision provider is configured', () => {
    expect(decideHeartbeat(false)).toEqual({
      action: 'none',
      reasonSummary: 'AI 决策器尚未接入；本轮只完成低成本状态检查。',
    });
  });

  it('creates one visible message in explicit demo mode', () => {
    const decision = decideHeartbeat(true);

    expect(decision.action).toBe('message');
    expect(decision.content).toContain('本地测试消息');
  });

  it('does not expose placeholder web, phone, XHS or MCP adapters to the model', () => {
    const policy = normalizeAutonomyPolicy({
      allowedCapabilityIds: ['memory.reflect', 'web.read', 'xhs.read', 'phone.read', 'mcp.read'],
    });

    expect(availableCapabilities(policy).map((item) => item.id)).toEqual(['memory.reflect']);
    const prompt = buildHeartbeatDecisionPrompt({
      agentName: '测试角色',
      intervalMinutes: 5,
      policy,
    });
    expect(prompt).toContain('当前没有已接通的外部探索适配器');
    expect(prompt).toContain('本轮不可选择 explore');
  });

  it('keeps autonomous diaries independent and routes reactions through sticky comments', () => {
    const prompt = buildHeartbeatDecisionPrompt({
      agentName: '测试角色',
      intervalMinutes: 5,
      policy: normalizeAutonomyPolicy({}),
      diaryCandidates: [{
        id: '11111111-1111-4111-8111-111111111111',
        authorType: 'user',
        diaryDate: '2026-08-09',
        title: '今天',
        content: '用户自己的日记。',
        comments: [],
      }],
    });
    expect(prompt).toContain('属于自己的完整日记');
    expect(prompt).toContain('严禁因为读到用户的日记就写一篇对应日记');
    expect(prompt).toContain('只能选择 comment 或 none');
    expect(prompt).toContain('不要按时间顺序汇报完整的一天');
    expect(prompt).toContain('角色私下写给自己的日记');
    expect(prompt).toContain('平淡的一天也可以写');
    expect(prompt).toContain('今天发生了很多事');
    expect(prompt).toContain('只是一张排除表');
    expect(prompt).toContain('不得复用其标题、核心事件、显眼数字');
  });

  it('turns off the diary action after the character has written today', () => {
    const prompt = buildHeartbeatDecisionPrompt({
      agentName: '测试角色', intervalMinutes: 5,
      policy: normalizeAutonomyPolicy({}), diaryAvailable: false,
    });
    expect(prompt).toContain('今天已经写过一篇角色日记');
    expect(prompt).toContain('零碎念头直接用 message');
  });

  it('requires the character to ask before requesting a phone screenshot', () => {
    const prompt = buildHeartbeatDecisionPrompt({
      agentName: '测试角色', intervalMinutes: 5,
      policy: normalizeAutonomyPolicy({ allowedCapabilityIds: ['phone.read'] }),
      connectedCapabilityIds: new Set(['phone.read']),
    });
    expect(prompt).toContain('必须在 content 写一句符合你本人语气');
    expect(prompt).toContain('截图回来后会作为用户图片消息进入聊天');
  });

  it('checks idle threshold before spending a model call', () => {
    const now = new Date('2026-08-09T12:00:00.000Z');
    const result = evaluateHeartbeatGates({
      policy: normalizeAutonomyPolicy({ idleThresholdMinutes: 30, probabilityLevel: 'high' }),
      timezone: 'UTC',
      lastUserActivityAt: new Date('2026-08-09T11:50:00.000Z'),
      lastAgentActivityAt: null,
      lastAutonomousActivityAt: null,
      now,
      random: () => 0,
    });
    expect(result.passed).toBe(false);
    expect(result.reasonSummary).toContain('空闲阈值');
  });

  it('supports activity windows that cross midnight', () => {
    const policy = normalizeAutonomyPolicy({
      idleThresholdMinutes: 0,
      cooldownMinutes: 0,
      probabilityLevel: 'high',
      activityWindow: { enabled: true, start: '22:00', end: '07:00' },
    });
    expect(evaluateHeartbeatGates({
      policy,
      timezone: 'UTC',
      lastUserActivityAt: null,
      lastAgentActivityAt: null,
      lastAutonomousActivityAt: null,
      now: new Date('2026-08-09T23:00:00.000Z'),
      random: () => 0,
    }).passed).toBe(true);
    expect(evaluateHeartbeatGates({
      policy,
      timezone: 'UTC',
      lastUserActivityAt: null,
      lastAgentActivityAt: null,
      lastAutonomousActivityAt: null,
      now: new Date('2026-08-09T12:00:00.000Z'),
      random: () => 0,
    }).reasonSummary).toContain('允许活动时段');
  });

  it('uses autonomous activity cooldown and the configured probability slot', () => {
    const now = new Date('2026-08-09T12:00:00.000Z');
    const policy = normalizeAutonomyPolicy({
      idleThresholdMinutes: 0,
      cooldownMinutes: 60,
      probabilityLevel: 'low',
    });
    expect(evaluateHeartbeatGates({
      policy,
      timezone: 'UTC',
      lastUserActivityAt: null,
      lastAgentActivityAt: null,
      lastAutonomousActivityAt: new Date('2026-08-09T11:30:00.000Z'),
      now,
      random: () => 0,
    }).reasonSummary).toContain('冷却中');
    expect(evaluateHeartbeatGates({
      policy,
      timezone: 'UTC',
      lastUserActivityAt: null,
      lastAgentActivityAt: null,
      lastAutonomousActivityAt: new Date('2026-08-09T10:30:00.000Z'),
      now,
      random: () => 0.15,
    }).reasonSummary).toContain('概率档位');
  });
});
