import type { Anniversary, Task, UserProfile } from '../types';
import { getCharacterAnniversaries } from './scheduleRelationshipScope';

export interface UserScheduleFact {
    id: string;
    title: string;
    startTime: string;
    endTime?: string;
    location?: string;
    note?: string;
}

export interface RelationshipAnniversaryFact {
    id: string;
    title: string;
    date: string;
    note?: string;
    dayDifference: number;
    direction: 'countdown' | 'countup';
}

export interface SharedCalendarContext {
    date: string;
    userSchedule: UserScheduleFact[];
    relationshipAnniversaries: RelationshipAnniversaryFact[];
}

const pad = (value: number): string => String(value).padStart(2, '0');
export const calendarDateKey = (date: Date): string => (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
);

const dateFromKey = (key: string): Date | null => {
    const matched = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(key);
    if (!matched) return null;
    const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
    return Number.isNaN(date.getTime()) ? null : date;
};

/** 日程 App、角色日程生成器与聊天注入共用的用户日程展开口径。 */
export function getUserScheduleForDate(
    user: UserProfile,
    tasks: Task[],
    dateKey: string,
    dayOfWeek: number,
): UserScheduleFact[] {
    const activeTasks: UserScheduleFact[] = tasks.filter(task => {
        if (task.isCompleted || task.excludedDates?.includes(dateKey)) return false;
        if (task.repeatWeekly) return (task.repeatDays || []).includes(dayOfWeek);
        return (task.scheduleDate || task.deadline?.slice(0, 10)) === dateKey;
    }).map(task => ({
        id: task.id,
        title: task.title,
        startTime: task.startTime || task.deadline?.slice(11, 16) || '时间未定',
        endTime: task.endTime,
        location: task.location,
        note: task.note,
    }));
    const legacyEntries: UserScheduleFact[] = (user.weeklySchedule || [])
        .filter(entry => entry.daysOfWeek.includes(dayOfWeek))
        .map(entry => ({
            id: `legacy-${entry.id}`,
            title: entry.title,
            startTime: entry.startTime,
            endTime: entry.endTime,
            location: entry.location,
            note: entry.note,
        }));
    return [...activeTasks, ...legacyEntries]
        .filter((entry, index, all) => all.findIndex(candidate => (
            candidate.title === entry.title
            && candidate.startTime === entry.startTime
            && candidate.endTime === entry.endTime
        )) === index)
        .sort((left, right) => left.startTime.localeCompare(right.startTime));
}

export function formatUserScheduleForDate(
    user: UserProfile,
    tasks: Task[],
    dateKey: string,
    dayOfWeek: number,
): string {
    const entries = getUserScheduleForDate(user, tasks, dateKey, dayOfWeek);
    if (entries.length === 0) return '';
    return `\n## 用户今天的日程（共同生活的现实约束）\n${entries.map(entry => (
        `- ${entry.startTime}${entry.endTime ? `-${entry.endTime}` : ''} ${entry.title}${entry.location ? `，地点：${entry.location}` : ''}${entry.note ? `（${entry.note}）` : ''}`
    )).join('\n')}\n角色不必围着用户行动，但约见、陪伴、等下课等共同安排必须尊重这些时间；最近对话明确改变计划时，只调整受影响时段及之后必要的安排。\n`;
}

export function buildSharedCalendarContext(
    user: UserProfile,
    tasks: Task[],
    anniversaries: Anniversary[],
    charId: string,
    at: Date = new Date(),
): SharedCalendarContext {
    const date = calendarDateKey(at);
    const today = dateFromKey(date)!;
    const relationshipAnniversaries = getCharacterAnniversaries(anniversaries, charId).flatMap((anniversary) => {
        const anniversaryDate = dateFromKey(anniversary.date);
        if (!anniversaryDate) return [];
        const dayDifference = Math.round((anniversaryDate.getTime() - today.getTime()) / 86_400_000);
        const direction = anniversary.countMode === 'countdown'
            || (anniversary.countMode !== 'countup' && dayDifference >= 0)
            ? 'countdown' as const
            : 'countup' as const;
        return [{
            id: anniversary.id,
            title: anniversary.title,
            date: anniversary.date,
            note: anniversary.note,
            dayDifference,
            direction,
        }];
    });
    return {
        date,
        userSchedule: getUserScheduleForDate(user, tasks, date, at.getDay()),
        relationshipAnniversaries,
    };
}

export function formatSharedCalendarContext(context: SharedCalendarContext, userName: string): string {
    const sections: string[] = [];
    if (context.userSchedule.length > 0) {
        sections.push(`## ${userName}今天的日程\n${context.userSchedule.map(entry => (
            `- ${entry.startTime}${entry.endTime ? `-${entry.endTime}` : ''} ${entry.title}${entry.location ? `（${entry.location}）` : ''}${entry.note ? `：${entry.note}` : ''}`
        )).join('\n')}\n这些是真实时间约束；自然关心即可，不要把聊天变成机械报时。`);
    }
    if (context.relationshipAnniversaries.length > 0) {
        sections.push(`## 你与${userName}的纪念日\n${context.relationshipAnniversaries.map(item => {
            const distance = Math.abs(item.dayDifference);
            const status = item.dayDifference === 0
                ? '就是今天'
                : item.direction === 'countdown' ? `${distance} 天后` : `已经 ${distance} 天`;
            return `- ${item.title}（${item.date}，${status}）${item.note ? `：${item.note}` : ''}`;
        }).join('\n')}\n只把这些当作你们共同经历与期待的一部分，不要每轮强行提起。`);
    }
    return sections.join('\n\n');
}
