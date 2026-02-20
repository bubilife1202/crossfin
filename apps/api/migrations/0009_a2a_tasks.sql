-- A2A (Agent-to-Agent) protocol task storage
CREATE TABLE IF NOT EXISTS a2a_tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'working' CHECK (status IN ('working','completed','failed','canceled')),
  skill TEXT,
  message TEXT NOT NULL,
  result TEXT,  -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_a2a_tasks_status ON a2a_tasks(status);
