CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  provider TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'UNKNOWN',
  price TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDC',
  network TEXT,
  pay_to TEXT,
  tags TEXT,
  input_schema TEXT,
  output_example TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  is_crossfin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_calls (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id),
  agent_id TEXT REFERENCES agents(id),
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error')),
  response_time_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_services_provider ON services(provider);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
CREATE INDEX IF NOT EXISTS idx_services_is_crossfin ON services(is_crossfin);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_service_calls_service ON service_calls(service_id);
CREATE INDEX IF NOT EXISTS idx_service_calls_agent ON service_calls(agent_id);
CREATE INDEX IF NOT EXISTS idx_service_calls_created ON service_calls(created_at);
