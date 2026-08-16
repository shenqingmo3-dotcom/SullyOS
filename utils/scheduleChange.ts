import type { CharacterProfile, DailySchedule, ScheduleSlot } from '../types';
import { DB } from './db';
import { getDailyScheduleForChar } from './dailySchedule';
import { getScheduleWallClock } from './scheduleTime';

export const SCHEDULE_CHANGE_EVENT = 'schedule-change-applied';

export interface ScheduleChangeDirective {
    startTime: string;
    activity: string;
}

export interface AppliedScheduleChange {
    startTime: string;
    before: string;
    after: string;
}

export interface ScheduleChangeEventDetail {
    charId: string;
    date: string;
    changes: AppliedScheduleChange[];
    schedule: DailySchedule;
    eventId: string;
}

export interface ExtractedScheduleChanges {
    cleanedText: string;
    directives: ScheduleChangeDirective[];
    malformedCount: number;
}

export interface AppliedScheduleChangeResult extends ExtractedScheduleChanges {
    schedule: DailySchedule | null;
    changes: AppliedScheduleChange[];
    rejectedCount: number;
}

const KEYWORD_RE = /^\s*(?:ACTION\s*[:：]\s*CHANGE_SCHEDULE|change[\s_-]*(?:schedule|schedue)|modify[\s_-]*schedule|修改(?:未来)?日程|更改(?:未来)?日程|改日程)(?=\s|[:：|=→>\-（(]|\d|$)/iu;

const parseDirectiveBody = (input: string): { recognized: boolean; directive?: ScheduleChangeDirective | null } => {
    const body = input.replace(/^[\s【\[]+|[\s】\]]+$/gu, '').trim();
    const keyword = body.match(KEYWORD_RE);
    if (!keyword) return { recognized: false };
    const rest = body.slice(keyword[0].length).replace(/^\s*[:：|=→>\-]+\s*/u, '');
    const time = rest.match(/[（(]?\s*(\d{1,2})\s*(?:[:：点时])\s*(\d{1,2})?\s*(?:分)?\s*[）)]?/u);
    if (!time || time.index == null) return { recognized: true, directive: null };
    const hour = Number(time[1]);
    const minute = time[2] == null || time[2] === '' ? 0 : Number(time[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return { recognized: true, directive: null };
    }
    const activity = rest.slice(time.index + time[0].length)
        .replace(/^\s*(?:[:：|=→>\-]+)\s*/u, '')
        .replace(/[】\]]+\s*$/gu, '')
        .trim();
    if (!activity) return { recognized: true, directive: null };
    return {
        recognized: true,
        directive: {
            startTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
            activity: activity.slice(0, 120),
        },
    };
};

export const extractScheduleChangeDirectives = (text: string): ExtractedScheduleChanges => {
    const directives: ScheduleChangeDirective[] = [];
    let malformedCount = 0;
    const consumeBody = (body: string, original: string): string => {
        const parsed = parseDirectiveBody(body);
        if (!parsed.recognized) return original;
        if (parsed.directive) directives.push(parsed.directive);
        else malformedCount += 1;
        return '';
    };
    let cleanedText = (text || '').replace(
        /(?:【{1,2}|\[{1,2})([^【】\[\]\r\n]{1,360})(?:】{1,2}|\]{1,2})/gu,
        (whole, body) => consumeBody(body ?? '', whole),
    );
    cleanedText = cleanedText.replace(
        /(?:【【?|\[\[?)?\s*(?:ACTION\s*[:：]\s*CHANGE_SCHEDULE|change[\s_-]*(?:schedule|schedue)|modify[\s_-]*schedule|修改(?:未来)?日程|更改(?:未来)?日程|改日程)\s*[:：|]?[^\r\n]{0,360}/giu,
        whole => consumeBody(whole, whole),
    );
    return {
        cleanedText: cleanedText.replace(/[ \t]+\r?\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim(),
        directives,
        malformedCount,
    };
};

const minutesOf = (time: string): number | null => {
    const matched = /^(\d{1,2}):(\d{2})$/u.exec(time.trim());
    if (!matched) return null;
    const hour = Number(matched[1]);
    const minute = Number(matched[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
};

export const applyFutureScheduleChanges = (
    schedule: DailySchedule,
    directives: ScheduleChangeDirective[],
    char?: Pick<CharacterProfile, 'customTimezoneEnabled' | 'customTimezone'> | null,
    at: Date = new Date(),
): { schedule: DailySchedule; changes: AppliedScheduleChange[]; rejectedCount: number } => {
    const wallNow = getScheduleWallClock(char, at);
    const currentMinutes = wallNow.getHours() * 60 + wallNow.getMinutes();
    const slots: ScheduleSlot[] = schedule.slots.map(slot => ({ ...slot }));
    const changeByTime = new Map<string, AppliedScheduleChange>();
    let rejectedCount = 0;
    for (const directive of directives) {
        const slotIndex = slots.findIndex(slot => slot.startTime === directive.startTime);
        const targetMinutes = minutesOf(directive.startTime);
        if (slotIndex < 0 || targetMinutes == null || targetMinutes <= currentMinutes) {
            rejectedCount += 1;
            continue;
        }
        const slot = slots[slotIndex];
        if (slot.activity.trim() === directive.activity.trim()) continue;
        const originalBefore = changeByTime.get(directive.startTime)?.before ?? slot.activity;
        slots[slotIndex] = {
            startTime: slot.startTime,
            activity: directive.activity.trim(),
            ...(slot.emoji ? { emoji: slot.emoji } : {}),
        };
        changeByTime.set(directive.startTime, {
            startTime: directive.startTime,
            before: originalBefore,
            after: directive.activity.trim(),
        });
    }
    const changes = [...changeByTime.values()];
    if (changes.length === 0) return { schedule, changes, rejectedCount };
    return { schedule: { ...schedule, slots, flowNarrative: undefined }, changes, rejectedCount };
};

export const applyAssistantScheduleChanges = async (
    text: string,
    char: Pick<CharacterProfile, 'id' | 'customTimezoneEnabled' | 'customTimezone'>,
    at: Date = new Date(),
): Promise<AppliedScheduleChangeResult> => {
    const extracted = extractScheduleChangeDirectives(text);
    if (extracted.directives.length === 0) {
        return { ...extracted, schedule: null, changes: [], rejectedCount: 0 };
    }
    const schedule = await getDailyScheduleForChar(char, at);
    if (!schedule) {
        return { ...extracted, schedule: null, changes: [], rejectedCount: extracted.directives.length };
    }
    const applied = applyFutureScheduleChanges(schedule, extracted.directives, char, at);
    if (applied.changes.length > 0) await DB.saveDailySchedule(applied.schedule);
    return { ...extracted, ...applied };
};

export const announceScheduleChanges = (
    charId: string,
    schedule: DailySchedule,
    changes: AppliedScheduleChange[],
): void => {
    if (changes.length === 0 || typeof window === 'undefined') return;
    const detail: ScheduleChangeEventDetail = {
        charId,
        date: schedule.date,
        changes,
        schedule,
        eventId: `${charId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    window.dispatchEvent(new CustomEvent<ScheduleChangeEventDetail>(SCHEDULE_CHANGE_EVENT, { detail }));
};
