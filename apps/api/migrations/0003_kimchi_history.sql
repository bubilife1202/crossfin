CREATE TABLE IF NOT EXISTS kimchi_snapshots (
  id TEXT PRIMARY KEY,
  coin TEXT NOT NULL,
  bithumb_krw REAL,
  binance_usd REAL,
  premium_pct REAL,
  krw_usd_rate REAL,
  volume_24h_usd REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kimchi_snapshots_coin ON kimchi_snapshots(coin);
CREATE INDEX IF NOT EXISTS idx_kimchi_snapshots_created_at ON kimchi_snapshots(created_at);
