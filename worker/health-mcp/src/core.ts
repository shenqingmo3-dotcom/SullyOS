export const ALLOWED_TYPES = new Set([
    'heart_rate',
    'heart_rate_variability',
    'resting_heart_rate',
    'sleep_analysis',
    'respiratory_rate',
    'blood_oxygen_saturation',
    'step_count',
    'flights_climbed',
    'walking_running_distance',
    'active_energy_burned',
    'apple_exercise_time',
    'apple_sleeping_wrist_temperature',
]);

export const CUMULATIVE_TYPES = new Set([
    'step_count',
    'flights_climbed',
    'walking_running_distance',
    'active_energy_burned',
    'apple_exercise_time',
]);

export interface NormalizedSample {
    type: string;
    value: number | null;
    unit: string;
    at: number;
    source: string;
    extra?: Record<string, unknown>;
}

export interface DailyMetricRow {
    date: string;
    type: string;
    sample_count: number;
    sum_value: number | null;
    avg_value: number | null;
    min_value: number | null;
    max_value: number | null;
    latest_value: number | null;
    latest_at: number | null;
}

export interface SleepDailyRow {
    date: string;
    start_at: number | null;
    end_at: number | null;
    total_hours: number | null;
    deep_hours: number | null;
    core_hours: number | null;
    rem_hours: number | null;
    awake_hours: number | null;
    segments_json?: string | null;
    avg_heart_rate?: number | null;
    lowest_heart_rate?: number | null;
    hrv?: number | null;
    respiratory_rate?: number | null;
    wrist_temperature?: number | null;
    source?: string | null;
}

const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;

const finiteNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};


export const parseTimestamp = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 10_000_000_000 ? Math.round(value) : Math.round(value * 1000);
    }
    const text = String(value ?? '').trim();
    if (!text) return null;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
};

export function normalizeHealthPayload(body: unknown): NormalizedSample[] {
    const root = asObject(body);
    if (!root) return [];
    const samples: NormalizedSample[] = [];

    if (Array.isArray(root.samples)) {
        const source = String(root.source || 'app').slice(0, 40);
        for (const raw of root.samples) {
            const sample = asObject(raw);
            if (!sample) continue;
            const type = String(sample.type || '').trim().toLowerCase();
            const at = parseTimestamp(sample.at);
            const extra = asObject(sample.extra);
            const value = finiteNumber(sample.value);
            if (!type || at === null || (value === null && !extra)) continue;
            samples.push({
                type,
                value,
                unit: String(sample.unit || '').slice(0, 20),
                at,
                source,
                ...(extra ? { extra } : {}),
            });
        }
        return samples;
    }

    const data = asObject(root.data);
    const metrics = data && Array.isArray(data.metrics) ? data.metrics : null;
    if (!metrics) return [];
    for (const rawMetric of metrics) {
        const metric = asObject(rawMetric);
        if (!metric) continue;
        const type = String(metric.name || '').trim().toLowerCase();
        const unit = String(metric.units || '').slice(0, 20);
        const rows = Array.isArray(metric.data) ? metric.data : [];
        for (const rawRow of rows) {
            const row = asObject(rawRow);
            if (!row) continue;
            const at = parseTimestamp(row.date);
            if (!type || at === null) continue;
            const value = finiteNumber(row.qty ?? row.Avg ?? row.avg);
            if (value !== null) {
                samples.push({ type, value, unit, at, source: 'auto_export' });
                continue;
            }
            const extra = Object.fromEntries(
                Object.entries(row).filter(([key]) => key !== 'date'),
            );
            if (Object.keys(extra).length > 0) {
                samples.push({
                    type,
                    value: null,
                    unit,
                    at,
                    source: 'auto_export',
                    extra,
                });
            }
        }
    }
    return samples;
}


const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

export function localDateKey(timestamp: number, timeZone: string): string {
    let formatter = dateFormatterCache.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        dateFormatterCache.set(timeZone, formatter);
    }
    const parts = Object.fromEntries(
        formatter.formatToParts(new Date(timestamp))
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const rounded = (value: number | null | undefined, digits = 1): number | null => {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};

const average = (values: Array<number | null | undefined>): number | null => {
    const valid = values.filter((value): value is number =>
        value !== null && value !== undefined && Number.isFinite(value));
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};

const dateKeys = (days: number, now: number, timeZone: string): string[] => {
    const keys: string[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
        const key = localDateKey(now - i * 86_400_000, timeZone);
        if (!keys.includes(key)) keys.push(key);
    }
    return keys;
};

export function buildHealthTrends(
    requestedDays: unknown,
    metrics: DailyMetricRow[],
    sleeps: SleepDailyRow[],
    now: number,
    timeZone: string,
) {
    const days = clampInt(requestedDays, 7, 3, 30);
    const keys = dateKeys(days, now, timeZone);
    const metricMap = new Map(metrics.map(row => [`${row.date}:${row.type}`, row]));
    const sleepMap = new Map(sleeps.map(row => [row.date, row]));

    const daily = keys.map(date => {
        const sleep = sleepMap.get(date);
        const metric = (type: string) => metricMap.get(`${date}:${type}`);
        return {
            date,
            sleep_hours: rounded(sleep?.total_hours),
            deep_hours: rounded(sleep?.deep_hours),
            rem_hours: rounded(sleep?.rem_hours),
            resting_heart_rate: rounded(metric('resting_heart_rate')?.avg_value),
            heart_rate_variability: rounded(metric('heart_rate_variability')?.avg_value),
            steps: rounded(metric('step_count')?.sum_value, 0),
            active_energy_kcal: rounded(metric('active_energy_burned')?.sum_value, 0),
            exercise_minutes: rounded(metric('apple_exercise_time')?.sum_value, 0),
        };
    });

    const averages = {
        sleep_hours: rounded(average(daily.map(day => day.sleep_hours))),
        resting_heart_rate: rounded(average(daily.map(day => day.resting_heart_rate))),
        heart_rate_variability: rounded(average(daily.map(day => day.heart_rate_variability))),
        steps: rounded(average(daily.map(day => day.steps)), 0),
        active_energy_kcal: rounded(average(daily.map(day => day.active_energy_kcal)), 0),
        exercise_minutes: rounded(average(daily.map(day => day.exercise_minutes)), 0),
    };

    const recent = daily.slice(-Math.min(3, daily.length));
    const baseline = daily.slice(0, Math.max(0, daily.length - recent.length));
    const delta = (
        getter: (day: typeof daily[number]) => number | null,
        digits = 1,
    ) => {
        const recentAvg = average(recent.map(getter));
        const baselineAvg = average(baseline.map(getter));
        return recentAvg === null || baselineAvg === null
            ? null
            : rounded(recentAvg - baselineAvg, digits);
    };

    const baselineSleep = average(baseline.map(day => day.sleep_hours));
    let consecutiveBelowBaseline = 0;
    if (baselineSleep !== null) {
        for (let i = daily.length - 1; i >= 0; i -= 1) {
            const value = daily[i].sleep_hours;
            if (value === null || value >= baselineSleep - 0.5) break;
            consecutiveBelowBaseline += 1;
        }
    }

    return {
        period: {
            days,
            from: keys[0],
            to: keys[keys.length - 1],
            time_zone: timeZone,
        },
        averages,
        recent_3d_vs_previous: {
            sleep_hours_delta: delta(day => day.sleep_hours),
            resting_heart_rate_delta: delta(day => day.resting_heart_rate),
            heart_rate_variability_delta: delta(day => day.heart_rate_variability),
            steps_delta: delta(day => day.steps, 0),
        },
        consecutive_sleep_below_personal_baseline_days: consecutiveBelowBaseline,
        daily,
        note: '趋势是个人记录的客观比较，不是睡眠评分或医疗诊断。',
    };
}
