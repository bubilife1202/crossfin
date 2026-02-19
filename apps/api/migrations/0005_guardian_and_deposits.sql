CREATE TABLE IF NOT EXISTS guardian_rules (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id),
  type TEXT NOT NULL CHECK (type IN ('SPEND_CAP', 'FAIL_STREAK', 'CIRCUIT_BREAKER', 'KILL_SWITCH')),
  params TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guardian_rules_agent_active ON guardian_rules(agent_id, active);
CREATE INDEX IF NOT EXISTS idx_guardian_rules_type_active ON guardian_rules(type, active);

CREATE TABLE IF NOT EXISTS autonomous_actions (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id),
  action_type TEXT NOT NULL,
  service_id TEXT REFERENCES services(id),
  decision TEXT NOT NULL CHECK (decision IN ('EXECUTE', 'WAIT', 'SKIP', 'BLOCK')),
  confidence REAL,
  cost_usd REAL NOT NULL DEFAULT 0,
  rule_applied TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_autonomous_actions_agent_created ON autonomous_actions(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_actions_decision_created ON autonomous_actions(decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_actions_service_created ON autonomous_actions(service_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_spend (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  amount_usd REAL NOT NULL CHECK (amount_usd >= 0),
  service_id TEXT REFERENCES services(id),
  tx_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_spend_agent_created ON agent_spend(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_spend_service_created ON agent_spend(service_id, created_at DESC);

CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  tx_hash TEXT NOT NULL UNIQUE,
  amount_usd REAL NOT NULL CHECK (amount_usd > 0),
  from_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'rejected')),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deposits_agent_created ON deposits(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposits_tx_hash ON deposits(tx_hash);
