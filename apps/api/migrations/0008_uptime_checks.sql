CREATE TABLE IF NOT EXISTS uptime_checks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('up', 'down')),
  http_status INTEGER,
  latency_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_uptime_checks_created_at ON uptime_checks(created_at);
CREATE INDEX IF NOT EXISTS idx_uptime_checks_status ON uptime_checks(status);
