CREATE TABLE IF NOT EXISTS acp_quotes (
  id TEXT PRIMARY KEY,
  from_exchange TEXT NOT NULL,
  from_currency TEXT NOT NULL,
  to_exchange TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  strategy TEXT NOT NULL CHECK (strategy IN ('cheapest', 'fastest', 'balanced')),
  optimal_route_json TEXT,
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  meta_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'quoted' CHECK (status IN ('quoted', 'executed', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_acp_quotes_created ON acp_quotes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acp_quotes_expires ON acp_quotes(expires_at);

CREATE TABLE IF NOT EXISTS acp_executions (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES acp_quotes(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'expired')),
  simulated INTEGER NOT NULL DEFAULT 1,
  route_json TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_acp_executions_quote_created ON acp_executions(quote_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acp_executions_status_created ON acp_executions(status, created_at DESC);
