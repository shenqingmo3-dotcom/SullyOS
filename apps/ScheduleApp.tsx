import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft,
    ArrowRight,
    CalendarBlank,
    Clock,
    Heart,
    MapPin,
    Plus,
    Repeat,
    Sparkle,
    X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Anniversary, DailySchedule, Task } from '../types';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

type CalendarEvent = {
    id: string;
    owner: 'user' | 'character';
    title: string;
    startTime: string;
    endTime?: string;
    location?: string;
    note?: string;
    repeat?: boolean;
    adjusted?: boolean;
    avatar?: string;
    task?: Task;
};

const pad = (value: number) => String(value).padStart(2, '0');
const toDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromDateKey = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
};
const sameMonth = (date: Date, month: Date) => date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
const mondayDayIndex = (date: Date) => (date.getDay() + 6) % 7;
const minuteOf = (time = '09:00') => {
    const [hour, minute] = time.split(':').map(Number);
    return (hour || 0) * 60 + (minute || 0);
};

const ScheduleApp: React.FC = () => {
    const {
        closeApp,
        characters,
        activeCharacterId,
        userProfile,
        addToast,
    } = useOS();

    const todayKey = toDateKey(new Date());
    const [selectedDate, setSelectedDate] = useState(todayKey);
    const [visibleMonth, setVisibleMonth] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });
    const [selectedCharId, setSelectedCharId] = useState(activeCharacterId || characters[0]?.id || '');
    const [tasks, setTasks] = useState<Task[]>([]);
    const [anniversaries, setAnniversaries] = useState<Anniversary[]>([]);
    const [dailySchedules, setDailySchedules] = useState<DailySchedule[]>([]);
    const [activeView, setActiveView] = useState<'calendar' | 'anniversary'>('calendar');
    const [composer, setComposer] = useState<'schedule' | 'anniversary' | null>(null);

    const [title, setTitle] = useState('');
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('10:00');
    const [location, setLocation] = useState('');
    const [note, setNote] = useState('');
    const [repeatWeekly, setRepeatWeekly] = useState(false);
    const [anniversaryDate, setAnniversaryDate] = useState(selectedDate);

    const selectedCharacter = characters.find(character => character.id === selectedCharId) || characters[0];

    const loadData = async () => {
        const [storedTasks, storedAnniversaries, storedSchedules] = await Promise.all([
            DB.getAllTasks(),
            DB.getAllAnniversaries(),
            DB.getAllDailySchedules(),
        ]);
        setTasks(storedTasks);
        setAnniversaries(storedAnniversaries);
        setDailySchedules(storedSchedules);
    };

    useEffect(() => {
        void loadData();
    }, []);

    useEffect(() => {
        if (!selectedCharId && characters[0]?.id) setSelectedCharId(characters[0].id);
    }, [characters, selectedCharId]);

    const monthDays = useMemo(() => {
        const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
        const start = new Date(first);
        start.setDate(first.getDate() - mondayDayIndex(first));
        return Array.from({ length: 42 }, (_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);
            return date;
        });
    }, [visibleMonth]);

    const userEventsForDate = (dateKey: string): CalendarEvent[] => {
        const date = fromDateKey(dateKey);
        const dayIndex = date.getDay();
        const stored = tasks.filter(task => {
            if (task.isCompleted || task.excludedDates?.includes(dateKey)) return false;
            if (task.repeatWeekly) return (task.repeatDays || []).includes(dayIndex);
            const taskDate = task.scheduleDate || task.deadline?.slice(0, 10);
            return taskDate === dateKey;
        }).map(task => ({
            id: task.id,
            owner: 'user' as const,
            title: task.title,
            startTime: task.startTime || '09:00',
            endTime: task.endTime,
            location: task.location,
            note: task.note,
            repeat: task.repeatWeekly,
            avatar: userProfile.avatar,
            task,
        }));

        const legacy = (userProfile.weeklySchedule || [])
            .filter(entry => entry.daysOfWeek.includes(dayIndex))
            .map(entry => ({
                id: `legacy-${entry.id}`,
                owner: 'user' as const,
                title: entry.title,
                startTime: entry.startTime,
                endTime: entry.endTime,
                location: entry.location,
                note: entry.note,
                repeat: true,
                avatar: userProfile.avatar,
            }));

        return [...stored, ...legacy];
    };

    const characterScheduleForDate = (dateKey: string) => dailySchedules.find(schedule => (
        schedule.charId === selectedCharacter?.id && schedule.date === dateKey
    ));

    const characterEventsForDate = (dateKey: string): CalendarEvent[] => {
        const schedule = characterScheduleForDate(dateKey);
        if (!schedule || !selectedCharacter) return [];
        return schedule.slots.map((slot, index) => ({
            id: `${schedule.id}-${index}`,
            owner: 'character' as const,
            title: slot.activity,
            startTime: slot.startTime,
            endTime: schedule.slots[index + 1]?.startTime,
            location: slot.location,
            note: slot.description,
            adjusted: Boolean((slot as any).adjusted || (schedule as any).adjustedAt),
            avatar: selectedCharacter.avatar,
        }));
    };

    const selectedEvents = useMemo(() => (
        [...userEventsForDate(selectedDate), ...characterEventsForDate(selectedDate)]
            .sort((left, right) => minuteOf(left.startTime) - minuteOf(right.startTime))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ), [selectedDate, tasks, dailySchedules, selectedCharId, userProfile.weeklySchedule]);

    const shiftMonth = (delta: number) => {
        setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1));
    };

    const selectDay = (date: Date) => {
        setSelectedDate(toDateKey(date));
        if (!sameMonth(date, visibleMonth)) setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    };

    const resetComposer = () => {
        setTitle('');
        setStartTime('09:00');
        setEndTime('10:00');
        setLocation('');
        setNote('');
        setRepeatWeekly(false);
        setAnniversaryDate(selectedDate);
        setComposer(null);
    };

    const saveSchedule = async () => {
        if (!title.trim()) return;
        const dayIndex = fromDateKey(selectedDate).getDay();
        const task: Task = {
            id: `schedule-${Date.now()}`,
            title: title.trim(),
            supervisorId: selectedCharacter?.id || '',
            tone: 'gentle',
            isCompleted: false,
            createdAt: Date.now(),
            scheduleDate: selectedDate,
            startTime,
            endTime,
            repeatWeekly,
            repeatDays: repeatWeekly ? [dayIndex] : undefined,
            location: location.trim() || undefined,
            note: note.trim() || undefined,
        };
        await DB.saveTask(task);
        setTasks(current => [...current, task]);
        addToast(repeatWeekly ? '已加入每周日程' : '已加入今日日程', 'success');
        resetComposer();
    };

    const saveAnniversary = async () => {
        if (!title.trim() || !anniversaryDate) return;
        const anniversary: Anniversary = {
            id: `anniversary-${Date.now()}`,
            title: title.trim(),
            date: anniversaryDate,
            charId: selectedCharacter?.id || '',
            countMode: 'auto',
        };
        await DB.saveAnniversary(anniversary);
        setAnniversaries(current => [...current, anniversary]);
        addToast('纪念日已经收好', 'success');
        resetComposer();
    };

    const deleteUserEvent = async (event: CalendarEvent) => {
        if (!event.task) return;
        if (event.task.repeatWeekly) {
            const next = { ...event.task, excludedDates: [...(event.task.excludedDates || []), selectedDate] };
            await DB.saveTask(next);
            setTasks(current => current.map(task => task.id === next.id ? next : task));
            addToast('只取消了这一天，之后仍会每周重复', 'success');
            return;
        }
        await DB.deleteTask(event.task.id);
        setTasks(current => current.filter(task => task.id !== event.task?.id));
    };

    const selectedDateObject = fromDateKey(selectedDate);
    const monthTitle = `${visibleMonth.getFullYear()} · ${MONTH_NAMES[visibleMonth.getMonth()]}`;
    const selectedDateTitle = `${selectedDateObject.getMonth() + 1}月${selectedDateObject.getDate()}日`;

    return (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f7f3e9] text-[#34342f]">
            <div className="pointer-events-none absolute inset-0 opacity-[0.28] [background-image:linear-gradient(rgba(83,132,118,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(83,132,118,0.08)_1px,transparent_1px)] [background-size:22px_22px]" />

            <header className="relative z-20 flex items-center justify-between px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
                <button onClick={closeApp} className="grid h-11 w-11 place-items-center rounded-full border border-[#d8d2c1] bg-[#fffdf7]/90 text-[#45453e] shadow-[0_4px_16px_rgba(74,65,42,0.08)] active:scale-95" aria-label="关闭">
                    <ArrowLeft size={20} weight="bold" />
                </button>
                <div className="text-center">
                    <p className="font-serif text-[11px] tracking-[0.28em] text-[#947a35]">TIME NOTES</p>
                    <h1 className="mt-0.5 text-[17px] font-semibold tracking-[0.18em]">日程与纪念</h1>
                </div>
                <button onClick={() => setComposer(activeView === 'calendar' ? 'schedule' : 'anniversary')} className="grid h-11 w-11 place-items-center rounded-full bg-[#c9bd99] text-[#504a3c] shadow-[0_7px_18px_rgba(105,94,66,0.18)] active:scale-95" aria-label="添加">
                    <Plus size={21} weight="bold" />
                </button>
            </header>

            <nav className="relative z-20 mx-5 mb-3 grid grid-cols-2 rounded-full border border-[#ded8c8] bg-[#fffdf8]/80 p-1 shadow-[0_5px_20px_rgba(89,77,45,0.06)]">
                <button onClick={() => setActiveView('calendar')} className={`h-9 rounded-full text-[13px] font-semibold tracking-wider transition ${activeView === 'calendar' ? 'bg-[#80bbaa] text-white shadow-sm' : 'text-[#77746b]'}`}>日程</button>
                <button onClick={() => setActiveView('anniversary')} className={`h-9 rounded-full text-[13px] font-semibold tracking-wider transition ${activeView === 'anniversary' ? 'bg-[#c9bd99] text-[#504a3c] shadow-sm' : 'text-[#77746b]'}`}>纪念日</button>
            </nav>

            <main className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
                {activeView === 'calendar' ? (
                    <>
                        <section className="relative overflow-hidden rounded-[26px] border border-[#d9d3c3] bg-[#fffdf8] px-3 pb-4 pt-3 shadow-[0_12px_35px_rgba(80,69,39,0.10)]">
                            <div className="absolute -right-5 top-5 h-16 w-28 rotate-[8deg] bg-[#dcefe8]/55" />
                            <span aria-hidden="true" className="pointer-events-none absolute right-4 top-4 rotate-[9deg] text-[19px] opacity-75 drop-shadow-sm">🌿</span>
                            <span aria-hidden="true" className="pointer-events-none absolute bottom-11 left-2 -rotate-[10deg] text-[14px] opacity-60">🦈</span>
                            <div className="relative flex items-center justify-between px-2 pb-3">
                                <button onClick={() => shiftMonth(-1)} className="grid h-9 w-9 place-items-center rounded-full text-[#706e65] hover:bg-[#edf5f1]"><ArrowLeft size={17} weight="bold" /></button>
                                <div className="text-center">
                                    <h2 className="font-serif text-[25px] font-semibold tracking-[0.04em] text-[#3f463f]">{monthTitle}</h2>
                                    <p className="mt-0.5 text-[9px] uppercase tracking-[0.26em] text-[#9a927f]">tap a day to open it</p>
                                </div>
                                <button onClick={() => shiftMonth(1)} className="grid h-9 w-9 place-items-center rounded-full text-[#706e65] hover:bg-[#f6edcf]"><ArrowRight size={17} weight="bold" /></button>
                            </div>

                            <div className="grid grid-cols-7 border-y border-[#ded8ca] py-2 text-center text-[10px] font-semibold text-[#898477]">
                                {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
                            </div>
                            <div className="grid grid-cols-7">
                                {monthDays.map(date => {
                                    const dateKey = toDateKey(date);
                                    const isSelected = dateKey === selectedDate;
                                    const isToday = dateKey === todayKey;
                                    const hasUser = userEventsForDate(dateKey).length > 0;
                                    const hasCharacter = Boolean(characterScheduleForDate(dateKey)?.slots.length);
                                    return (
                                        <button key={dateKey} onClick={() => selectDay(date)} className={`relative flex min-h-[54px] flex-col items-center border-b border-r border-[#ebe6da] pt-2 transition last:border-r-0 ${sameMonth(date, visibleMonth) ? 'text-[#393b36]' : 'text-[#c1bdae]'} ${isSelected ? 'bg-[#f1ecdf]/90' : 'hover:bg-[#edf5f1]/65'}`}>
                                            <span className={`grid h-7 w-7 place-items-center rounded-full text-[13px] font-semibold ${isToday ? 'ring-1 ring-[#78b6a5]' : ''} ${isSelected ? 'bg-[#9f9270] text-white ring-0' : ''}`}>{date.getDate()}</span>
                                            <span className="mt-1 flex h-2 items-center gap-1">
                                                {hasUser && <i className="h-1.5 w-4 rounded-full bg-[#78b6a5]" />}
                                                {hasCharacter && <i className="h-1.5 w-4 rounded-full bg-[#c9bd99]" />}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="flex items-center justify-between px-2 pt-3 text-[10px] font-medium text-[#7d796e]">
                                <div className="flex items-center gap-4">
                                    <span className="flex items-center gap-1.5"><i className="h-1.5 w-5 rounded-full bg-[#78b6a5]" />你</span>
                                    <span className="flex items-center gap-1.5"><i className="h-1.5 w-5 rounded-full bg-[#c9bd99]" />{selectedCharacter?.name || '角色'}</span>
                                </div>
                                <button onClick={() => selectDay(new Date())} className="rounded-full border border-[#d9d3c3] px-3 py-1.5 font-semibold">今天</button>
                            </div>
                        </section>

                        {characters.length > 1 && (
                            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                                {characters.map(character => (
                                    <button key={character.id} onClick={() => setSelectedCharId(character.id)} className={`flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${character.id === selectedCharacter?.id ? 'border-[#c9bd99] bg-[#f1ecdf] text-[#655c46]' : 'border-[#dcd6c7] bg-white/70 text-[#77746b]'}`}>
                                        <img src={character.avatar} alt="" className="h-6 w-6 rounded-full object-cover" />
                                        {character.name}
                                    </button>
                                ))}
                            </div>
                        )}

                        <section className="relative mt-5 rounded-[26px] border border-[#d8d2c3] bg-[#fffdf9] px-4 pb-5 pt-5 shadow-[0_12px_32px_rgba(80,69,39,0.08)]">
                            <div className="absolute left-1/2 top-0 h-5 w-24 -translate-x-1/2 -translate-y-2 rotate-[-2deg] bg-[#e8d49b]/55 shadow-sm" />
                            <span aria-hidden="true" className="pointer-events-none absolute right-4 top-4 rotate-[7deg] text-[17px] opacity-70">🧇</span>
                            <div className="flex items-end justify-between border-b border-[#ddd8ca] pb-3">
                                <div>
                                    <p className="font-serif text-[24px] font-semibold">{selectedDateTitle}</p>
                                    <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-[#8e897d]">{selectedDateObject.toLocaleDateString('zh-CN', { weekday: 'long' })}</p>
                                </div>
                                <button onClick={() => setComposer('schedule')} className="flex h-9 items-center gap-1.5 rounded-full bg-[#dff1eb] px-3 text-[11px] font-semibold text-[#477e70]"><Plus size={14} weight="bold" />我的安排</button>
                            </div>

                            {selectedEvents.length ? (
                                <div className="relative mt-4 space-y-3 before:absolute before:bottom-3 before:left-[45px] before:top-3 before:w-px before:bg-[#d8d4c9]">
                                    {selectedEvents.map(event => (
                                        <article key={event.id} className="relative grid grid-cols-[36px_1fr] gap-4">
                                            <time className="pt-4 text-right font-mono text-[10px] text-[#8a867b]">{event.startTime}</time>
                                            <div className={`relative rounded-[18px] border px-4 py-3 shadow-[0_5px_15px_rgba(75,67,44,0.06)] ${event.owner === 'character' ? 'border-[#ddd4bb] bg-[#f3efe3]' : 'border-[#b9dcd2] bg-[#e2f3ed]'}`}>
                                                <span className={`absolute -left-[21px] top-[18px] h-2.5 w-2.5 rounded-full border-2 border-[#fffdf9] ${event.owner === 'character' ? 'bg-[#b7aa85]' : 'bg-[#78b6a5]'}`} />
                                                <div className="flex items-start gap-3">
                                                    {event.avatar ? <img src={event.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full border-2 border-white/80 object-cover shadow-sm" /> : <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs ${event.owner === 'character' ? 'bg-[#c9bd99] text-[#504a3c]' : 'bg-[#78b6a5] text-white'}`}>{event.owner === 'character' ? '角' : '你'}</div>}
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <h3 className="truncate text-[14px] font-semibold text-[#393b36]">{event.title}</h3>
                                                            {event.adjusted && <span className="shrink-0 rounded-full bg-white/55 px-1.5 py-0.5 text-[8px] font-semibold text-[#94772c]">已调整</span>}
                                                            {event.repeat && <Repeat size={12} className="shrink-0 text-[#4d8b7b]" />}
                                                        </div>
                                                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#77746a]">
                                                            <span className="flex items-center gap-1"><Clock size={11} />{event.startTime}{event.endTime ? `-${event.endTime}` : ''}</span>
                                                            {event.location && <span className="flex items-center gap-1"><MapPin size={11} />{event.location}</span>}
                                                        </div>
                                                        {event.note && <p className="mt-2 text-[11px] leading-5 text-[#66645d]">{event.note}</p>}
                                                    </div>
                                                    {event.owner === 'user' && event.task && <button onClick={() => void deleteUserEvent(event)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#7d796e] hover:bg-white/50" aria-label="取消这项日程"><X size={13} /></button>}
                                                </div>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex min-h-[180px] flex-col items-center justify-center text-center">
                                    <CalendarBlank size={30} weight="thin" className="text-[#9dbfb5]" />
                                    <p className="mt-3 font-serif text-[16px] text-[#585a54]">这一天还留着空白</p>
                                    <p className="mt-1 text-[10px] leading-5 text-[#999487]">可以写下你的安排；角色的日程生成后<br />也会自然地出现在这里。</p>
                                </div>
                            )}
                        </section>
                    </>
                ) : (
                    <section className="relative min-h-full overflow-hidden rounded-[28px] border border-[#dad3c3] bg-[#fffdf8] p-5 shadow-[0_12px_35px_rgba(80,69,39,0.10)]">
                        <div className="absolute -right-7 -top-6 h-28 w-28 rounded-full border-[18px] border-[#dcefe8]/70" />
                        <div className="relative border-b border-[#ddd6c6] pb-5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#78a99c]">our little archive</p>
                            <h2 className="mt-2 font-serif text-[30px] font-semibold leading-tight">值得记住的日子</h2>
                            <p className="mt-2 max-w-[260px] text-[11px] leading-5 text-[#827e73]">未来的期待会倒数，已经发生的故事会继续累计。</p>
                        </div>

                        <div className="relative mt-5 space-y-4">
                            {anniversaries.length ? anniversaries
                                .slice()
                                .sort((a, b) => a.date.localeCompare(b.date))
                                .map((anniversary, index) => {
                                    const dayDifference = Math.round((fromDateKey(anniversary.date).getTime() - fromDateKey(todayKey).getTime()) / 86400000);
                                    const isFuture = anniversary.countMode === 'countdown' || (anniversary.countMode !== 'countup' && dayDifference >= 0);
                                    const character = characters.find(item => item.id === anniversary.charId) || selectedCharacter;
                                    return (
                                        <article key={anniversary.id} className={`relative overflow-hidden rounded-[22px] border p-4 shadow-[0_7px_18px_rgba(76,65,36,0.08)] ${index % 2 === 0 ? 'rotate-[-0.4deg] border-[#ddd4bb] bg-[#f3efe3]' : 'rotate-[0.35deg] border-[#badbd1] bg-[#e2f3ed]'}`}>
                                            <span className="absolute right-4 top-0 h-6 w-16 -translate-y-2 rotate-[4deg] bg-white/45" />
                                            <span aria-hidden="true" className="absolute bottom-2 right-3 rotate-[8deg] text-[16px] opacity-55">{['💌', '🌱', '🦊', '🧁', '🌄'][index % 5]}</span>
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    {character?.avatar ? <img src={character.avatar} alt="" className="h-11 w-11 rounded-full border-2 border-white/80 object-cover shadow-sm" /> : <div className="grid h-11 w-11 place-items-center rounded-full bg-[#c9bd99] text-[#504a3c]"><Heart size={20} weight="fill" /></div>}
                                                    <div className="min-w-0">
                                                        <p className="truncate text-[15px] font-semibold">{anniversary.title}</p>
                                                        <p className="mt-1 font-mono text-[9px] tracking-wider text-[#777267]">{anniversary.date}</p>
                                                    </div>
                                                </div>
                                                <div className="shrink-0 text-right">
                                                    <strong className="font-serif text-[28px] font-semibold leading-none">{Math.abs(dayDifference)}</strong>
                                                    <p className="mt-1 text-[9px] font-semibold tracking-wider text-[#817a69]">{isFuture ? '天后' : '天了'}</p>
                                                </div>
                                            </div>
                                            {anniversary.aiThought && <p className="mt-4 border-t border-black/5 pt-3 text-[11px] italic leading-5 text-[#656259]">“{anniversary.aiThought}”</p>}
                                        </article>
                                    );
                                }) : (
                                    <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                                        <Heart size={34} weight="thin" className="text-[#a99d7c]" />
                                        <p className="mt-4 font-serif text-[18px]">第一张纪念卡还在等你</p>
                                        <p className="mt-2 text-[10px] leading-5 text-[#928d80]">可以记相遇、生日、约定，<br />或任何想一起等待的日子。</p>
                                        <button onClick={() => setComposer('anniversary')} className="mt-5 rounded-full bg-[#c9bd99] px-5 py-2.5 text-[11px] font-semibold text-[#504a3c] shadow-[0_7px_17px_rgba(105,94,66,0.18)]">写下一个日子</button>
                                    </div>
                                )}
                        </div>
                    </section>
                )}
            </main>

            {composer && (
                <div className="absolute inset-0 z-50 flex items-end bg-[#403c32]/35" onClick={resetComposer}>
                    <section className="w-full rounded-t-[30px] border-t border-white/80 bg-[#fffdf8] px-5 pb-[calc(1.2rem+env(safe-area-inset-bottom))] pt-4 shadow-[0_-18px_50px_rgba(66,57,35,0.16)]" onClick={event => event.stopPropagation()}>
                        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#d5d0c2]" />
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#7ca99d]">{composer === 'schedule' ? 'my schedule' : 'our memory'}</p>
                                <h2 className="mt-1 font-serif text-[23px] font-semibold">{composer === 'schedule' ? '添加我的日程' : '添加纪念日'}</h2>
                            </div>
                            <button onClick={resetComposer} className="grid h-9 w-9 place-items-center rounded-full bg-[#f0ece2] text-[#777268]"><X size={16} /></button>
                        </div>

                        <div className="mt-5 space-y-3">
                            <label className="block rounded-[18px] border border-[#dcd6c7] bg-white px-4 py-3">
                                <span className="block text-[9px] font-semibold uppercase tracking-wider text-[#938d7f]">写点什么</span>
                                <input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder={composer === 'schedule' ? '例如：下午的专业课' : '例如：我们第一次见面'} className="mt-1.5 w-full bg-transparent text-[15px] font-medium outline-none placeholder:text-[#bbb5a8]" />
                            </label>

                            {composer === 'schedule' ? (
                                <>
                                    <div className="grid grid-cols-2 gap-3">
                                        <label className="rounded-[18px] border border-[#badbd1] bg-[#e9f6f1] px-4 py-3">
                                            <span className="block text-[9px] font-semibold text-[#5e8e81]">开始</span>
                                            <input type="time" value={startTime} onChange={event => setStartTime(event.target.value)} className="mt-1 w-full bg-transparent text-[14px] font-semibold outline-none" />
                                        </label>
                                        <label className="rounded-[18px] border border-[#badbd1] bg-[#e9f6f1] px-4 py-3">
                                            <span className="block text-[9px] font-semibold text-[#5e8e81]">结束</span>
                                            <input type="time" value={endTime} onChange={event => setEndTime(event.target.value)} className="mt-1 w-full bg-transparent text-[14px] font-semibold outline-none" />
                                        </label>
                                    </div>
                                    <button onClick={() => setRepeatWeekly(value => !value)} className={`flex w-full items-center justify-between rounded-[18px] border px-4 py-3 text-left ${repeatWeekly ? 'border-[#8fc5b7] bg-[#e2f3ed]' : 'border-[#ddd7c8] bg-white'}`}>
                                        <span className="flex items-center gap-3 text-[13px] font-semibold"><Repeat size={17} className="text-[#6aa797]" />每周这一天重复</span>
                                        <span className={`h-5 w-9 rounded-full p-0.5 transition ${repeatWeekly ? 'bg-[#78b6a5]' : 'bg-[#d9d4c8]'}`}><i className={`block h-4 w-4 rounded-full bg-white shadow-sm transition ${repeatWeekly ? 'translate-x-4' : ''}`} /></span>
                                    </button>
                                    <input value={location} onChange={event => setLocation(event.target.value)} placeholder="地点（可不填）" className="w-full rounded-[18px] border border-[#ddd7c8] bg-white px-4 py-3 text-[13px] outline-none" />
                                    <input value={note} onChange={event => setNote(event.target.value)} placeholder="备注（可不填）" className="w-full rounded-[18px] border border-[#ddd7c8] bg-white px-4 py-3 text-[13px] outline-none" />
                                </>
                            ) : (
                                <label className="block rounded-[18px] border border-[#ddd4bb] bg-[#f3efe3] px-4 py-3">
                                    <span className="block text-[9px] font-semibold text-[#6f654d]">日期</span>
                                    <input type="date" value={anniversaryDate} onChange={event => setAnniversaryDate(event.target.value)} className="mt-1 w-full bg-transparent text-[14px] font-semibold outline-none" />
                                </label>
                            )}
                        </div>

                        <button onClick={() => void (composer === 'schedule' ? saveSchedule() : saveAnniversary())} disabled={!title.trim()} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#c9bd99] text-[13px] font-semibold text-[#504a3c] shadow-[0_8px_20px_rgba(105,94,66,0.18)] disabled:opacity-40">
                            {composer === 'schedule' ? <CalendarBlank size={17} weight="bold" /> : <Sparkle size={17} weight="fill" />}
                            保存
                        </button>
                    </section>
                </div>
            )}
        </div>
    );
};

export default ScheduleApp;
