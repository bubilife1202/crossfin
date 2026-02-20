export async function audit(
  db: D1Database,
  agentId: string | null,
  action: string,
  resource: string,
  resourceId: string | null,
  result: 'success' | 'blocked' | 'error',
  detail?: string,
) {
  await db.prepare(
    'INSERT INTO audit_logs (id, agent_id, action, resource, resource_id, detail, result) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), agentId, action, resource, resourceId, detail ?? null, result).run()
}

let premiumPaymentsTableReady: Promise<void> | null = null

export async function ensurePremiumPaymentsTable(db: D1Database): Promise<void> {
  if (!premiumPaymentsTableReady) {
    premiumPaymentsTableReady = db.batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS premium_payments (
           id TEXT PRIMARY KEY,
           payer TEXT NOT NULL,
           tx_hash TEXT NOT NULL,
           network TEXT NOT NULL,
           endpoint TEXT NOT NULL,
           amount TEXT NOT NULL,
           asset TEXT NOT NULL,
           scheme TEXT NOT NULL,
           created_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_premium_payments_payer ON premium_payments(payer)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_premium_payments_created ON premium_payments(created_at)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_premium_payments_endpoint ON premium_payments(endpoint, created_at)'),
    ]).then(() => undefined).catch((err) => {
      premiumPaymentsTableReady = null
      throw err
    })
  }

  await premiumPaymentsTableReady
}
