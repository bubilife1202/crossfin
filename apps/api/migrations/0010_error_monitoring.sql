CREATE TABLE IF NOT EXISTS error_events (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  status_code INTEGER,
  error_message TEXT,
  source TEXT,  -- 'api_handler', 'external_fetch', 'db_query'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_error_events_created ON error_events(created_at);
CREATE INDEX IF NOT EXISTS idx_error_events_endpoint ON error_events(endpoint);

CREATE TABLE IF NOT EXISTS endpoint_health (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  window_start TEXT NOT NULL,
  total_calls INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_endpoint_health_endpoint ON endpoint_health(endpoint);
CREATE INDEX IF NOT EXISTS idx_endpoint_health_window ON endpoint_health(window_start);
