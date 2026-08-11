-- SullyOS Apple Health MCP · Cloudflare D1 schema
-- Worker 会自动 CREATE IF NOT EXISTS；也可以手动执行：
--   pnpm exec wrangler d1 execute sullyos-health --file schema.sql

CREATE TABLE IF NOT EXISTS health_samples (
  type          TEXT    NOT NULL,
  at            INTEGER NOT NULL,
  local_date    TEXT    NOT NULL,
  value         REAL,
  unit          TEXT    NOT NULL DEFAULT '',
  source        TEXT    NOT NULL DEFAULT 'unknown',
  extra_json    TEXT,
  received_at   INTEGER NOT NULL,
  PRIMARY KEY (type, at)
);
CREATE INDEX IF NOT EXISTS idx_health_samples_type_at
  ON health_samples(type, at DESC);
CREATE INDEX IF NOT EXISTS idx_health_samples_date_type
  ON health_samples(local_date, type);

CREATE TABLE IF NOT EXISTS health_daily (
  date          TEXT    NOT NULL,
  type          TEXT    NOT NULL,
  sample_count  INTEGER NOT NULL,
  sum_value     REAL,
  avg_value     REAL,
  min_value     REAL,
  max_value     REAL,
  latest_value  REAL,
  latest_at     INTEGER,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (date, type)
);
CREATE INDEX IF NOT EXISTS idx_health_daily_type_date
  ON health_daily(type, date DESC);

CREATE TABLE IF NOT EXISTS sleep_daily (
  date              TEXT PRIMARY KEY,
  start_at          INTEGER,
  end_at            INTEGER,
  total_hours       REAL,
  deep_hours        REAL,
  core_hours        REAL,
  rem_hours         REAL,
  awake_hours       REAL,
  segments_json     TEXT,
  avg_heart_rate    REAL,
  lowest_heart_rate REAL,
  hrv               REAL,
  respiratory_rate  REAL,
  wrist_temperature REAL,
  source            TEXT,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sleep_daily_date
  ON sleep_daily(date DESC);
