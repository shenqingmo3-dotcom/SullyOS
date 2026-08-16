import { describe, expect, it } from 'vitest';
import type { Anniversary, Task, UserProfile } from '../types';
import { buildSharedCalendarContext, formatSharedCalendarContext, getUserScheduleForDate } from './sharedCalendarContext';

const user = {
    name: '派派', avatar: '', bio: '',
    weeklySchedule: [{ id: 'legacy', title: '晚课', startTime: '20:00', daysOfWeek: [4] }],
} as UserProfile;

const tasks: Task[] = [
    { id: 'one', title: '复诊', supervisorId: 'a', tone: 'gentle', isCompleted: false, createdAt: 1, scheduleDate: '2026-08-20', startTime: '10:00' },
    { id: 'done', title: '已完成', supervisorId: 'a', tone: 'gentle', isCompleted: true, createdAt: 1, scheduleDate: '2026-08-20', startTime: '11:00' },
    { id: 'repeat', title: '瑜伽', supervisorId: 'a', tone: 'gentle', isCompleted: false, createdAt: 1, repeatWeekly: true, repeatDays: [4], startTime: '18:00' },
    { id: 'skip', title: '跳过本周', supervisorId: 'a', tone: 'gentle', isCompleted: false, createdAt: 1, repeatWeekly: true, repeatDays: [4], excludedDates: ['2026-08-20'], startTime: '19:00' },
];

const anniversaries: Anniversary[] = [
    { id: 'a', title: '和 A 相遇', date: '2026-08-22', charId: 'a' },
    { id: 'b', title: '和 B 相遇', date: '2026-08-23', charId: 'b' },
];

describe('sharedCalendarContext', () => {
    it('日程 App 和 prompt 共用重复、排除与完成状态语义', () => {
        expect(getUserScheduleForDate(user, tasks, '2026-08-20', 4).map(item => item.title))
            .toEqual(['复诊', '瑜伽', '晚课']);
    });

    it('只带当前角色纪念日，并在关闭角色日程时仍可独立格式化', () => {
        const context = buildSharedCalendarContext(user, tasks, anniversaries, 'a', new Date(2026, 7, 20, 9));
        expect(context.relationshipAnniversaries.map(item => item.title)).toEqual(['和 A 相遇']);
        const prompt = formatSharedCalendarContext(context, user.name);
        expect(prompt).toContain('派派今天的日程');
        expect(prompt).toContain('和 A 相遇');
        expect(prompt).not.toContain('和 B 相遇');
    });
});
