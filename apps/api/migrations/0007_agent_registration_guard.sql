CREATE TABLE IF NOT EXISTS agent_registration_attempts (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  ip_hint TEXT NOT NULL,
  name TEXT,
  success INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1)),
  reason TEXT NOT NULL,
  agent_id TEXT REFERENCES agents(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_registration_attempts_ip_created
  ON agent_registration_attempts(ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_registration_attempts_success_created
  ON agent_registration_attempts(success, created_at DESC);
