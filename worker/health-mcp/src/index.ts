import {
    ALLOWED_TYPES,
    CUMULATIVE_TYPES,
    buildHealthTrends,
    clampInt,
    localDateKey,
    normalizeHealthPayload,
    parseTimestamp,
    type DailyMetricRow,
    type NormalizedSample,
    type SleepDailyRow,
} from './core';

export interface Env {
    DB: D1Database;
    HEALTH_INGEST_TOKEN?: string;
    MCP_ACCESS_TOKEN?: string;
    HEALTH_TIME_ZONE?: string;
    HEALTH_RAW_RETENTION_DAYS?: string;
    HEALTH_DAILY_RETENTION_DAYS?: string;
    MCP_ALLOW_ORIGIN?: string;
}

interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    exec(query: string): Promise<unknown>;
}

interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    run<T = unknown>(): Promise<D1Result<T>>;
    first<T = unknown>(column?: string): Promise<T | null>;
    all<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Result<T = unknown> {
    results?: T[];
    success?: boolean;
    meta?: { changes?: number };
}

interface LatestSampleRow {
    type: string;
    at: number;
    value: number | null;
    unit: string;
    source: string;
}

const SERVER_NAME = 'sullyos-health-mcp-cloudflare';
const SERVER_VERSION = '0.1.0';
const MCP_PROTOCOL_VERSION = '2024-11-05';
const MAX_INGEST_BYTES = 10_000_000;
const MAX_MCP_BYTES = 1_000_000;
const NUMERIC_DETAIL_TYPES = new Set([
    'heart_rate',
    'heart_rate_variability',
    'respiratory_rate',
]);

const SCHEMA_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS health_samples (type TEXT NOT NULL, at INTEGER NOT NULL, local_date TEXT NOT NULL, value REAL, unit TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'unknown', extra_json TEXT, received_at INTEGER NOT NULL, PRIMARY KEY (type, at));`,
    `CREATE INDEX IF NOT EXISTS idx_health_samples_type_at ON health_samples(type, at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_health_samples_date_type ON health_samples(local_date, type);`,
    `CREATE TABLE IF NOT EXISTS health_daily (date TEXT NOT NULL, type TEXT NOT NULL, sample_count INTEGER NOT NULL, sum_value REAL, avg_value REAL, min_value REAL, max_value REAL, latest_value REAL, latest_at INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (date, type));`,
    `CREATE INDEX IF NOT EXISTS idx_health_daily_type_date ON health_daily(type, date DESC);`,
    `CREATE TABLE IF NOT EXISTS sleep_daily (date TEXT PRIMARY KEY, start_at INTEGER, end_at INTEGER, total_hours REAL, deep_hours REAL, core_hours REAL, rem_hours REAL, awake_hours REAL, segments_json TEXT, avg_heart_rate REAL, lowest_heart_rate REAL, hrv REAL, respiratory_rate REAL, wrist_temperature REAL, source TEXT, updated_at INTEGER NOT NULL);`,
    `CREATE INDEX IF NOT EXISTS idx_sleep_daily_date ON sleep_daily(date DESC);`,
] as const;

let schemaReady = false;

async function ensureSchema(db: D1Database): Promise<void> {
    if (schemaReady) return;
    for (const statement of SCHEMA_STATEMENTS) {
        await db.exec(statement);
    }
    schemaReady = true;
}

const timeZone = (env: Env) => env.HEALTH_TIME_ZONE?.trim() || 'UTC';
const nowIso = () => new Date().toISOString();
const round = (value: number | null | undefined, digits = 1): number | null => {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};
const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
    try {
        return raw ? JSON.parse(raw) as T : fallback;
    } catch {
        return fallback;
    }
};

function corsHeaders(env: Env): Record<string, string> {
    return {
        'Access-Control-Allow-Origin': env.MCP_ALLOW_ORIGIN?.trim() || '*',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Health-Token',
        'Access-Control-Max-Age': '86400',
    };
}

function json(env: Env, value: unknown, status = 200, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...corsHeaders(env),
            ...extra,
        },
    });
}

const empty = (env: Env, status: number) =>
    new Response(null, { status, headers: corsHeaders(env) });

function hasSecret(actual: string | null, expected: string | undefined): boolean {
    return Boolean(expected && expected.length >= 24 && actual && actual === expected);
}

function bearerToken(request: Request): string | null {
    const header = request.headers.get('Authorization') || '';
    return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
}

async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > maxBytes) throw new HttpError(413, '请求体过大');
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
        throw new HttpError(413, '请求体过大');
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new HttpError(400, 'JSON 格式无效');
    }
}

class HttpError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
    }
}

function chunks<T>(rows: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
    return out;
}

async function refreshDailyMetric(
    db: D1Database,
    date: string,
    type: string,
    timestamp: number,
): Promise<void> {
    const watchOnly = CUMULATIVE_TYPES.has(type)
        ? await db.prepare(
            `SELECT COUNT(*) AS n FROM health_samples
             WHERE local_date = ? AND type = ? AND source = 'watch'`,
        ).bind(date, type).first<{ n: number }>()
        : null;
    const sourceFilter = CUMULATIVE_TYPES.has(type) && Number(watchOnly?.n || 0) > 0
        ? ` AND source = 'watch'`
        : '';
    const aggregate = await db.prepare(
        `SELECT COUNT(value) AS sample_count, SUM(value) AS sum_value,
                AVG(value) AS avg_value, MIN(value) AS min_value,
                MAX(value) AS max_value, MAX(at) AS latest_at
         FROM health_samples
         WHERE local_date = ? AND type = ? AND value IS NOT NULL${sourceFilter}`,
    ).bind(date, type).first<DailyMetricRow>();
    if (!aggregate || Number(aggregate.sample_count || 0) === 0) {
        await db.prepare(`DELETE FROM health_daily WHERE date = ? AND type = ?`)
            .bind(date, type).run();
        return;
    }
    const latest = await db.prepare(
        `SELECT value FROM health_samples
         WHERE local_date = ? AND type = ? AND value IS NOT NULL${sourceFilter}
         ORDER BY at DESC LIMIT 1`,
    ).bind(date, type).first<{ value: number }>();
    await db.prepare(
        `INSERT INTO health_daily
         (date,type,sample_count,sum_value,avg_value,min_value,max_value,latest_value,latest_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(date,type) DO UPDATE SET
           sample_count=excluded.sample_count, sum_value=excluded.sum_value,
           avg_value=excluded.avg_value, min_value=excluded.min_value,
           max_value=excluded.max_value, latest_value=excluded.latest_value,
           latest_at=excluded.latest_at, updated_at=excluded.updated_at`,
    ).bind(
        date,
        type,
        Number(aggregate.sample_count || 0),
        aggregate.sum_value,
        aggregate.avg_value,
        aggregate.min_value,
        aggregate.max_value,
        latest?.value ?? null,
        aggregate.latest_at,
        timestamp,
    ).run();
}

async function aggregateBetween(
    db: D1Database,
    type: string,
    start: number,
    end: number,
): Promise<{ count: number; avg: number | null; min: number | null; max: number | null }> {
    const row = await db.prepare(
        `SELECT COUNT(value) AS count, AVG(value) AS avg,
                MIN(value) AS min, MAX(value) AS max
         FROM health_samples
         WHERE type = ? AND at >= ? AND at <= ? AND value IS NOT NULL`,
    ).bind(type, start, end).first<{
        count: number;
        avg: number | null;
        min: number | null;
        max: number | null;
    }>();
    return {
        count: Number(row?.count || 0),
        avg: row?.avg ?? null,
        min: row?.min ?? null,
        max: row?.max ?? null,
    };
}

const extraNumber = (extra: Record<string, unknown>, key: string): number | null => {
    const n = Number(extra[key]);
    return Number.isFinite(n) ? n : null;
};

async function upsertSleepDaily(
    db: D1Database,
    sample: NormalizedSample,
    tz: string,
    receivedAt: number,
): Promise<void> {
    const extra = sample.extra;
    if (!extra) return;
    const start = parseTimestamp(extra.sleepStart) ?? sample.at;
    const end = parseTimestamp(extra.sleepEnd) ?? sample.at;
    const date = localDateKey(start, tz);
    const heart = await aggregateBetween(db, 'heart_rate', start, end);
    const hrv = await aggregateBetween(db, 'heart_rate_variability', start, end);
    const respiratory = await aggregateBetween(db, 'respiratory_rate', start, end);
    const wrist = await db.prepare(
        `SELECT value FROM health_samples
         WHERE type = 'apple_sleeping_wrist_temperature'
           AND at >= ? AND at <= ? AND value IS NOT NULL
         ORDER BY at DESC LIMIT 1`,
    ).bind(start, end).first<{ value: number }>();
    const segments = Array.isArray(extra.segments) ? extra.segments : [];

    await db.prepare(
        `INSERT INTO sleep_daily
         (date,start_at,end_at,total_hours,deep_hours,core_hours,rem_hours,awake_hours,
          segments_json,avg_heart_rate,lowest_heart_rate,hrv,respiratory_rate,
          wrist_temperature,source,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(date) DO UPDATE SET
           start_at=excluded.start_at, end_at=excluded.end_at,
           total_hours=excluded.total_hours, deep_hours=excluded.deep_hours,
           core_hours=excluded.core_hours, rem_hours=excluded.rem_hours,
           awake_hours=excluded.awake_hours, segments_json=excluded.segments_json,
           avg_heart_rate=excluded.avg_heart_rate,
           lowest_heart_rate=excluded.lowest_heart_rate, hrv=excluded.hrv,
           respiratory_rate=excluded.respiratory_rate,
           wrist_temperature=excluded.wrist_temperature,
           source=excluded.source, updated_at=excluded.updated_at`,
    ).bind(
        date,
        start,
        end,
        extraNumber(extra, 'totalSleep'),
        extraNumber(extra, 'deep'),
        extraNumber(extra, 'core'),
        extraNumber(extra, 'rem'),
        extraNumber(extra, 'awake'),
        JSON.stringify(segments),
        heart.avg,
        heart.min,
        hrv.avg,
        respiratory.avg,
        wrist?.value ?? null,
        sample.source,
        receivedAt,
    ).run();
}

async function ingestHealth(env: Env, body: unknown) {
    const normalized = normalizeHealthPayload(body);
    const accepted = normalized.filter(sample => ALLOWED_TYPES.has(sample.type));
    const receivedAt = Date.now();
    const tz = timeZone(env);
    let stored = 0;
    const affected = new Set<string>();

    for (const group of chunks(accepted, 50)) {
        const statements = group.map(sample => env.DB.prepare(
            `INSERT OR IGNORE INTO health_samples
             (type,at,local_date,value,unit,source,extra_json,received_at)
             VALUES (?,?,?,?,?,?,?,?)`,
        ).bind(
            sample.type,
            sample.at,
            localDateKey(sample.at, tz),
            sample.value,
            sample.unit,
            sample.source,
            sample.extra ? JSON.stringify(sample.extra) : null,
            receivedAt,
        ));
        const results = await env.DB.batch(statements);
        results.forEach((result, index) => {
            if (Number(result.meta?.changes || 0) > 0) {
                stored += 1;
                const sample = group[index];
                if (sample.value !== null) {
                    affected.add(`${localDateKey(sample.at, tz)}\u0000${sample.type}`);
                }
            }
        });
    }

    for (const key of affected) {
        const [date, type] = key.split('\u0000');
        await refreshDailyMetric(env.DB, date, type, receivedAt);
    }
    for (const sample of accepted.filter(row => row.type === 'sleep_analysis' && row.extra)) {
        await upsertSleepDaily(env.DB, sample, tz, receivedAt);
    }

    return {
        ok: true,
        received: normalized.length,
        accepted: accepted.length,
        stored,
        deduplicated: accepted.length - stored,
    };
}

function sampleView(row: LatestSampleRow) {
    return {
        value: round(row.value),
        unit: row.unit,
        measured_at: new Date(row.at).toISOString(),
        age_minutes: Math.max(0, Math.floor((Date.now() - row.at) / 60_000)),
        source: row.source,
    };
}

function sleepView(row: SleepDailyRow | null) {
    if (!row) return null;
    return {
        date: row.date,
        fell_asleep: row.start_at ? new Date(row.start_at).toISOString() : null,
        woke: row.end_at ? new Date(row.end_at).toISOString() : null,
        total_hours: round(row.total_hours),
        stages_hours: {
            deep: round(row.deep_hours),
            core: round(row.core_hours),
            rem: round(row.rem_hours),
            awake: round(row.awake_hours),
        },
        sleep_period_vitals: {
            avg_heart_rate: round(row.avg_heart_rate),
            lowest_heart_rate: round(row.lowest_heart_rate),
            heart_rate_variability: round(row.hrv),
            respiratory_rate: round(row.respiratory_rate),
            wrist_temperature: round(row.wrist_temperature),
        },
        stage_timeline: parseJson<unknown[]>(row.segments_json, []),
        source: row.source || null,
    };
}

async function healthNow(env: Env) {
    const latestRows = await env.DB.prepare(
        `SELECT type,at,value,unit,source FROM (
           SELECT type,at,value,unit,source,
                  ROW_NUMBER() OVER (PARTITION BY type ORDER BY at DESC) AS rn
           FROM health_samples
           WHERE value IS NOT NULL AND type IN
             ('heart_rate','resting_heart_rate','heart_rate_variability',
              'respiratory_rate','apple_sleeping_wrist_temperature',
              'blood_oxygen_saturation')
         ) WHERE rn = 1`,
    ).all<LatestSampleRow>();
    const latest = new Map((latestRows.results || []).map(row => [row.type, row]));
    const today = localDateKey(Date.now(), timeZone(env));
    const activityRows = await env.DB.prepare(
        `SELECT * FROM health_daily WHERE date = ? AND type IN
         ('step_count','flights_climbed','walking_running_distance',
          'active_energy_burned','apple_exercise_time')`,
    ).bind(today).all<DailyMetricRow>();
    const activity = new Map((activityRows.results || []).map(row => [row.type, row]));
    const sleep = await env.DB.prepare(
        `SELECT * FROM sleep_daily ORDER BY date DESC LIMIT 1`,
    ).first<SleepDailyRow>();
    const sleepAvg = await env.DB.prepare(
        `SELECT AVG(total_hours) AS avg FROM
         (SELECT total_hours FROM sleep_daily
          WHERE total_hours IS NOT NULL ORDER BY date DESC LIMIT 7)`,
    ).first<{ avg: number | null }>();
    const wristBaseline = await env.DB.prepare(
        `SELECT AVG(avg_value) AS avg FROM
         (SELECT avg_value FROM health_daily
          WHERE type = 'apple_sleeping_wrist_temperature'
            AND avg_value IS NOT NULL ORDER BY date DESC LIMIT 30)`,
    ).first<{ avg: number | null }>();
    const output: Record<string, unknown> = {
        generated_at: nowIso(),
        time_zone: timeZone(env),
    };
    for (const key of [
        'heart_rate',
        'resting_heart_rate',
        'heart_rate_variability',
        'respiratory_rate',
        'blood_oxygen_saturation',
    ]) {
        const row = latest.get(key);
        if (row) output[key] = sampleView(row);
    }
    if (sleep) {
        const view = sleepView(sleep) as Record<string, unknown>;
        view.last_7day_avg_hours = round(sleepAvg?.avg);
        if (
            sleep.wrist_temperature !== null
            && sleep.wrist_temperature !== undefined
            && wristBaseline?.avg !== null
            && wristBaseline?.avg !== undefined
        ) {
            view.wrist_temperature_vs_30day_baseline = round(
                sleep.wrist_temperature - wristBaseline.avg,
            );
        }
        output.sleep = view;
    }
    const total = (type: string, digits = 0) => round(activity.get(type)?.sum_value, digits);
    const activityToday = {
        date: today,
        steps: total('step_count'),
        flights_climbed: total('flights_climbed'),
        walking_running_distance_km: (() => {
            const miles = activity.get('walking_running_distance')?.sum_value;
            return miles === null || miles === undefined ? null : round(miles * 1.609344);
        })(),
        active_energy_kcal: total('active_energy_burned'),
        exercise_minutes: total('apple_exercise_time'),
    };
    if (Object.values(activityToday).some(value => value !== null && value !== today)) {
        output.activity_today = activityToday;
    }
    if (Object.keys(output).length <= 2) {
        output.status = 'connected, waiting for first samples';
    }
    output.note = '健康记录仅供日常参考，不是医疗诊断。';
    return output;
}

async function numericDetail(env: Env, metric: string, args: Record<string, unknown>) {
    const end = parseTimestamp(args.end) ?? Date.now();
    const requestedStart = parseTimestamp(args.start) ?? end - 2 * 3_600_000;
    const start = Math.max(requestedStart, end - 2 * 3_600_000);
    const aggregate = await aggregateBetween(env.DB, metric, start, end);
    const rows = await env.DB.prepare(
        `SELECT at,value,unit,source FROM health_samples
         WHERE type = ? AND at >= ? AND at <= ? AND value IS NOT NULL
         ORDER BY at ASC LIMIT 500`,
    ).bind(metric, start, end).all<{
        at: number;
        value: number;
        unit: string;
        source: string;
    }>();
    return {
        ok: true,
        metric,
        window: {
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            capped_at_hours: 2,
        },
        sample_count: aggregate.count,
        min: round(aggregate.min),
        max: round(aggregate.max),
        avg: round(aggregate.avg),
        samples: (rows.results || []).map(row => ({
            at: new Date(row.at).toISOString(),
            value: round(row.value),
            unit: row.unit,
            source: row.source,
        })),
        samples_truncated: aggregate.count > 500,
    };
}

async function healthDetail(env: Env, argumentsValue: unknown) {
    const args = argumentsValue && typeof argumentsValue === 'object'
        ? argumentsValue as Record<string, unknown>
        : {};
    const aliases: Record<string, string> = {
        hr: 'heart_rate',
        hrv: 'heart_rate_variability',
        respiratory: 'respiratory_rate',
        breath: 'respiratory_rate',
    };
    const requested = String(args.metric || 'heart_rate').trim().toLowerCase();
    const metric = aliases[requested] || requested;
    if (metric === 'sleep' || metric === 'sleep_analysis') {
        const date = String(args.date || '').trim();
        const row = date
            ? await env.DB.prepare(`SELECT * FROM sleep_daily WHERE date = ?`)
                .bind(date).first<SleepDailyRow>()
            : await env.DB.prepare(`SELECT * FROM sleep_daily ORDER BY date DESC LIMIT 1`)
                .first<SleepDailyRow>();
        if (!row) {
            const dates = await env.DB.prepare(
                `SELECT date FROM sleep_daily ORDER BY date DESC LIMIT 30`,
            ).all<{ date: string }>();
            return {
                ok: true,
                note: date ? `没有 ${date} 的睡眠记录` : '尚无睡眠记录',
                available_dates: (dates.results || []).map(item => item.date),
            };
        }
        const avg = await env.DB.prepare(
            `SELECT AVG(total_hours) AS avg FROM
             (SELECT total_hours FROM sleep_daily
              WHERE date <= ? AND total_hours IS NOT NULL ORDER BY date DESC LIMIT 7)`,
        ).bind(row.date).first<{ avg: number | null }>();
        return {
            ok: true,
            sleep: sleepView(row),
            last_7day_avg_hours: round(avg?.avg),
        };
    }
    if (!NUMERIC_DETAIL_TYPES.has(metric)) {
        throw new HttpError(
            400,
            `未知指标 ${metric}；可用 heart_rate / heart_rate_variability / respiratory_rate / sleep`,
        );
    }
    return numericDetail(env, metric, args);
}

async function healthTrends(env: Env, argumentsValue: unknown) {
    const args = argumentsValue && typeof argumentsValue === 'object'
        ? argumentsValue as Record<string, unknown>
        : {};
    const days = clampInt(args.days, 7, 3, 30);
    const now = Date.now();
    const oldestDate = localDateKey(now - (days + 2) * 86_400_000, timeZone(env));
    const types = [
        'resting_heart_rate',
        'heart_rate_variability',
        'step_count',
        'active_energy_burned',
        'apple_exercise_time',
    ];
    const placeholders = types.map(() => '?').join(',');
    const metrics = await env.DB.prepare(
        `SELECT * FROM health_daily WHERE date >= ? AND type IN (${placeholders})
         ORDER BY date ASC`,
    ).bind(oldestDate, ...types).all<DailyMetricRow>();
    const sleeps = await env.DB.prepare(
        `SELECT * FROM sleep_daily WHERE date >= ? ORDER BY date ASC`,
    ).bind(oldestDate).all<SleepDailyRow>();
    return buildHealthTrends(
        days,
        metrics.results || [],
        sleeps.results || [],
        now,
        timeZone(env),
    );
}

export const MCP_TOOLS = [
    {
        name: 'health_now',
        description: '读取当前健康状态的紧凑快照，包括心率、静息心率、HRV、呼吸、最近睡眠、今日活动和数据新鲜度。通常先调用它；数据仅供日常参考，不能用于诊断。',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: 'health_detail',
        description: '查询单项健康详情。心率、HRV、呼吸可查最长两小时的样本及 min/max/avg；睡眠可按日期查看阶段时间轴与睡眠期生命体征。',
        inputSchema: {
            type: 'object',
            properties: {
                metric: {
                    type: 'string',
                    enum: ['heart_rate', 'heart_rate_variability', 'respiratory_rate', 'sleep'],
                    default: 'heart_rate',
                },
                start: { type: 'string', description: 'ISO 8601 起始时间；数值指标可用。' },
                end: { type: 'string', description: 'ISO 8601 结束时间；数值指标可用。' },
                date: { type: 'string', description: '睡眠日期，YYYY-MM-DD。' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'health_trends',
        description: '比较最近 7、14 或 30 天的睡眠、静息心率、HRV、步数、能量和锻炼趋势，并给出最近三天相对个人前段基线的客观差值。不是睡眠评分或医疗诊断。',
        inputSchema: {
            type: 'object',
            properties: {
                days: {
                    type: 'integer',
                    enum: [7, 14, 30],
                    default: 7,
                },
            },
            additionalProperties: false,
        },
    },
] as const;

function toolResult(value: unknown, isError = false) {
    return {
        content: [{ type: 'text', text: JSON.stringify(value) }],
        ...(isError ? { isError: true } : {}),
    };
}

async function callTool(env: Env, name: string, argumentsValue: unknown) {
    switch (name) {
        case 'health_now':
            return toolResult(await healthNow(env));
        case 'health_detail':
            return toolResult(await healthDetail(env, argumentsValue));
        case 'health_trends':
            return toolResult(await healthTrends(env, argumentsValue));
        default:
            return toolResult({ ok: false, error: `未知工具：${name}` }, true);
    }
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
    if (!hasSecret(bearerToken(request), env.MCP_ACCESS_TOKEN)) {
        return json(env, {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32001, message: 'Bearer Token 无效' },
        }, 401);
    }
    const rpc = await readJsonBody(request, MAX_MCP_BYTES);
    if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc)) {
        throw new HttpError(400, 'JSON-RPC 请求必须是对象');
    }
    const message = rpc as Record<string, unknown>;
    const id = message.id;
    if (id === null || id === undefined) return empty(env, 202);
    const method = String(message.method || '');
    let result: unknown;
    if (method === 'initialize') {
        result = {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        };
    } else if (method === 'ping') {
        result = {};
    } else if (method === 'tools/list') {
        result = { tools: MCP_TOOLS };
    } else if (method === 'tools/call') {
        const params = message.params && typeof message.params === 'object'
            ? message.params as Record<string, unknown>
            : {};
        result = await callTool(
            env,
            String(params.name || ''),
            params.arguments || {},
        );
    } else {
        return json(env, {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
    return json(env, { jsonrpc: '2.0', id, result });
}

async function cleanup(env: Env): Promise<void> {
    const now = Date.now();
    const rawDays = clampInt(env.HEALTH_RAW_RETENTION_DAYS, 35, 2, 365);
    const dailyDays = clampInt(env.HEALTH_DAILY_RETENTION_DAYS, 120, 30, 730);
    const dailyCutoff = localDateKey(now - dailyDays * 86_400_000, timeZone(env));
    await env.DB.batch([
        env.DB.prepare(`DELETE FROM health_samples WHERE at < ?`)
            .bind(now - rawDays * 86_400_000),
        env.DB.prepare(`DELETE FROM health_daily WHERE date < ?`).bind(dailyCutoff),
        env.DB.prepare(`DELETE FROM sleep_daily WHERE date < ?`).bind(dailyCutoff),
    ]);
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return empty(env, 204);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'GET' && path === '/healthz') {
        return json(env, {
            ok: true,
            service: SERVER_NAME,
            version: SERVER_VERSION,
            storage: 'cloudflare-d1',
        });
    }
    if (request.method === 'GET' && path === '/') {
        return json(env, {
            ok: true,
            service: SERVER_NAME,
            endpoints: ['/api/health', '/mcp', '/healthz'],
        });
    }
    if (request.method === 'DELETE' && path === '/mcp') return empty(env, 204);

    await ensureSchema(env.DB);

    if (request.method === 'POST' && path === '/api/health') {
        if (!hasSecret(request.headers.get('X-Health-Token'), env.HEALTH_INGEST_TOKEN)) {
            throw new HttpError(401, 'X-Health-Token 无效');
        }
        return json(env, await ingestHealth(env, await readJsonBody(request, MAX_INGEST_BYTES)));
    }
    if (request.method === 'POST' && path === '/mcp') {
        return handleMcp(request, env);
    }
    throw new HttpError(404, 'Not found');
}

export const createHealthWorker = () => ({
    async fetch(request: Request, env: Env): Promise<Response> {
        try {
            if (
                !env.HEALTH_INGEST_TOKEN
                || env.HEALTH_INGEST_TOKEN.length < 24
                || !env.MCP_ACCESS_TOKEN
                || env.MCP_ACCESS_TOKEN.length < 24
            ) {
                return json(env, {
                    ok: false,
                    error: 'Worker 未配置两把至少 24 字符的独立密钥',
                }, 503);
            }
            return await handleRequest(request, env);
        } catch (error) {
            if (error instanceof HttpError) {
                return json(env, { ok: false, error: error.message }, error.status);
            }
            const message = error instanceof Error ? error.message : 'server error';
            return json(env, { ok: false, error: message }, 500);
        }
    },
    async scheduled(_controller: unknown, env: Env): Promise<void> {
        await ensureSchema(env.DB);
        await cleanup(env);
    },
});

export default createHealthWorker();
