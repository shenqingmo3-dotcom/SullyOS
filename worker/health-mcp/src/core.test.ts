import { describe, expect, it } from 'vitest';
import {
    buildHealthTrends,
    localDateKey,
    normalizeHealthPayload,
    type DailyMetricRow,
    type SleepDailyRow,
} from './core';

describe('normalizeHealthPayload', () => {
    it('normalizes Collar Watch samples and preserves structured sleep data', () => {
        const rows = normalizeHealthPayload({
            source: 'watch',
            samples: [
                {
                    type: 'heart_rate',
                    value: 78,
                    unit: 'count/min',
                    at: '2026-07-27T08:30:00+12:00',
                },
                {
                    type: 'sleep_analysis',
                    value: null,
                    unit: '',
                    at: '2026-07-27T07:00:00+12:00',
                    extra: {
                        sleepStart: '2026-07-26T23:30:00+12:00',
                        sleepEnd: '2026-07-27T07:00:00+12:00',
                        totalSleep: 7.1,
                        deep: 1.2,
                        core: 4.2,
                        rem: 1.7,
                    },
                },
            ],
        });

        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            type: 'heart_rate',
            value: 78,
            source: 'watch',
        });
        expect(rows[1].extra).toMatchObject({ totalSleep: 7.1, deep: 1.2 });
    });

    it('normalizes Health Auto Export REST metrics', () => {
        const rows = normalizeHealthPayload({
            data: {
                metrics: [
                    {
                        name: 'heart_rate_variability',
                        units: 'ms',
                        data: [{ date: '2026-07-27T08:00:00Z', qty: 52 }],
                    },
                    {
                        name: 'sleep_analysis',
                        units: 'hr',
                        data: [{
                            date: '2026-07-27T07:00:00Z',
                            totalSleep: 6.5,
                            deep: 0.9,
                        }],
                    },
                ],
            },
        });

        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            type: 'heart_rate_variability',
            value: 52,
            source: 'auto_export',
        });
        expect(rows[1]).toMatchObject({
            type: 'sleep_analysis',
            value: null,
            source: 'auto_export',
        });
        expect(rows[1].extra).toMatchObject({ totalSleep: 6.5 });
    });
});

describe('timezone and health trends', () => {
    it('uses an IANA timezone for the local health date', () => {
        expect(localDateKey(
            Date.parse('2026-07-26T12:30:00Z'),
            'Pacific/Auckland',
        )).toBe('2026-07-27');
    });

    it('builds objective recent-vs-baseline changes', () => {
        const now = Date.parse('2026-07-27T00:00:00Z');
        const sleeps: SleepDailyRow[] = [
            ['2026-07-21', 8],
            ['2026-07-22', 8],
            ['2026-07-23', 8],
            ['2026-07-24', 8],
            ['2026-07-25', 6],
            ['2026-07-26', 6],
            ['2026-07-27', 6],
        ].map(([date, hours]) => ({
            date: String(date),
            total_hours: Number(hours),
            start_at: null,
            end_at: null,
            deep_hours: null,
            core_hours: null,
            rem_hours: null,
            awake_hours: null,
        }));
        const metrics: DailyMetricRow[] = [
            ['2026-07-21', 60],
            ['2026-07-22', 60],
            ['2026-07-23', 60],
            ['2026-07-24', 60],
            ['2026-07-25', 67],
            ['2026-07-26', 67],
            ['2026-07-27', 67],
        ].map(([date, value]) => ({
            date: String(date),
            type: 'resting_heart_rate',
            sample_count: 1,
            sum_value: Number(value),
            avg_value: Number(value),
            min_value: Number(value),
            max_value: Number(value),
            latest_value: Number(value),
            latest_at: null,
        }));

        const result = buildHealthTrends(7, metrics, sleeps, now, 'Pacific/Auckland');

        expect(result.averages.sleep_hours).toBe(7.1);
        expect(result.recent_3d_vs_previous.sleep_hours_delta).toBe(-2);
        expect(result.recent_3d_vs_previous.resting_heart_rate_delta).toBe(7);
        expect(result.consecutive_sleep_below_personal_baseline_days).toBe(3);
        expect(result.note).toContain('不是睡眠评分');
    });
});
