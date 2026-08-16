import { describe, expect, it } from 'vitest';
import type { DailySchedule } from '../types';
import { applyFutureScheduleChanges, extractScheduleChangeDirectives } from './scheduleChange';

const schedule: DailySchedule = {
    id: 'char-1_2026-08-15',
    charId: 'char-1',
    date: '2026-08-15',
    generatedAt: new Date(2026, 7, 15, 8).getTime(),
    slots: [
        { startTime: '08:00', activity: '起床', location: '家' },
        { startTime: '14:00', activity: '写稿', description: '完成第三章' },
        { startTime: '18:30', activity: '健身', location: '健身房' },
        { startTime: '22:00', activity: '看电影' },
    ],
    flowNarrative: { afternoon: '晚上还得去健身。' },
};

const at = (hour: number, minute = 0) => new Date(2026, 7, 15, hour, minute);

describe('extractScheduleChangeDirectives', () => {
    it('识别正式格式并从正文隐藏', () => {
        const result = extractScheduleChangeDirectives('今晚不练啦。\n[[ACTION:CHANGE_SCHEDULE | 18:30 | 去超市]]');
        expect(result.cleanedText).toBe('今晚不练啦。');
        expect(result.directives).toEqual([{ startTime: '18:30', activity: '去超市' }]);
    });

    it.each([
        '【【修改日程：18:30：去超市】】',
        '[[change schedue：（18：30）：去超市】',
        'ACTION:CHANGE_SCHEDULE | 18点30分 | 去超市',
    ])('容忍括号、全角标点、中文时间和常见拼写：%s', raw => {
        expect(extractScheduleChangeDirectives(raw).directives)
            .toEqual([{ startTime: '18:30', activity: '去超市' }]);
    });
});

describe('applyFutureScheduleChanges', () => {
    it('只修改未来已有时段，并移除围绕旧计划生成的冲突字段', () => {
        const result = applyFutureScheduleChanges(schedule, [{ startTime: '18:30', activity: '去超市' }], null, at(14, 5));
        expect(result.changes).toEqual([{ startTime: '18:30', before: '健身', after: '去超市' }]);
        expect(result.schedule.slots[2]).toEqual({ startTime: '18:30', activity: '去超市' });
        expect(result.schedule.flowNarrative).toBeUndefined();
        expect(schedule.slots[2].activity).toBe('健身');
    });

    it('拒绝过去、当前和不存在的时段', () => {
        const result = applyFutureScheduleChanges(schedule, [
            { startTime: '08:00', activity: '睡懒觉' },
            { startTime: '14:00', activity: '摸鱼' },
            { startTime: '19:00', activity: '散步' },
        ], null, at(14));
        expect(result.changes).toEqual([]);
        expect(result.rejectedCount).toBe(3);
    });
});
