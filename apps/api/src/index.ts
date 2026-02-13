import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'

type Bindings = {
  DB: D1Database
}

type Variables = {
  agentId: string
}

type Env = { Bindings: Bindings; Variables: Variables }

const app = new Hono<Env>()

app.use('*', cors({
  origin: ['http://localhost:5173', 'https://crossfin.pages.dev'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Agent-Key'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}))

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/', (c) => c.json({ name: 'crossfin-api', version: '0.0.0', status: 'ok' }))

// ── Agent auth middleware (for /api/* routes) ──

function agentAuth() {
  return async (c: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) => {
    const apiKey = c.req.header('X-Agent-Key')
    if (!apiKey) throw new HTTPException(401, { message: 'Missing X-Agent-Key header' })

    const agent = await c.env.DB.prepare(
      'SELECT id, status FROM agents WHERE api_key = ?'
    ).bind(apiKey).first<{ id: string; status: string }>()

    if (!agent) throw new HTTPException(401, { message: 'Invalid API key' })
    if (agent.status !== 'active') throw new HTTPException(403, { message: 'Agent suspended' })

    c.set('agentId', agent.id)
    await next()
  }
}

// ── Public: register agent ──

app.post('/api/agents', async (c) => {
  const body = await c.req.json<{ name: string }>()
  if (!body.name?.trim()) throw new HTTPException(400, { message: 'name is required' })

  const id = crypto.randomUUID()
  const apiKey = `cf_${crypto.randomUUID().replace(/-/g, '')}`

  await c.env.DB.prepare(
    'INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?)'
  ).bind(id, body.name.trim(), apiKey).run()

  await audit(c.env.DB, id, 'agent.create', 'agents', id, 'success')

  return c.json({ id, name: body.name.trim(), apiKey }, 201)
})

// ── Protected routes ──

const api = new Hono<Env>()
api.use('*', agentAuth())

api.get('/me', async (c) => {
  const agentId = c.get('agentId')
  const agent = await c.env.DB.prepare(
    'SELECT id, name, status, created_at FROM agents WHERE id = ?'
  ).bind(agentId).first()
  return c.json({ data: agent })
})

// ── Wallets ──

api.post('/wallets', async (c) => {
  const agentId = c.get('agentId')
  const body = await c.req.json<{ label: string; initialBalanceCents?: number }>()
  if (!body.label?.trim()) throw new HTTPException(400, { message: 'label is required' })

  const id = crypto.randomUUID()
  const balance = Math.max(0, Math.round(body.initialBalanceCents ?? 0))

  await c.env.DB.prepare(
    'INSERT INTO wallets (id, agent_id, label, balance_cents) VALUES (?, ?, ?, ?)'
  ).bind(id, agentId, body.label.trim(), balance).run()

  if (balance > 0) {
    const txId = crypto.randomUUID()
    await c.env.DB.prepare(
      "INSERT INTO transactions (id, to_wallet_id, amount_cents, rail, memo, status) VALUES (?, ?, ?, 'manual', 'Initial deposit', 'completed')"
    ).bind(txId, id, balance).run()
  }

  await audit(c.env.DB, agentId, 'wallet.create', 'wallets', id, 'success')
  return c.json({ id, label: body.label.trim(), balanceCents: balance }, 201)
})

api.get('/wallets', async (c) => {
  const agentId = c.get('agentId')
  const { results } = await c.env.DB.prepare(
    'SELECT id, label, balance_cents, currency, created_at FROM wallets WHERE agent_id = ?'
  ).bind(agentId).all()
  return c.json({ data: results })
})

api.get('/wallets/:id/balance', async (c) => {
  const agentId = c.get('agentId')
  const walletId = c.req.param('id')
  const wallet = await c.env.DB.prepare(
    'SELECT id, balance_cents, currency FROM wallets WHERE id = ? AND agent_id = ?'
  ).bind(walletId, agentId).first()
  if (!wallet) throw new HTTPException(404, { message: 'Wallet not found' })
  return c.json({ data: wallet })
})

// ── Transfers (with circuit breaker) ──

api.post('/transfers', async (c) => {
  const agentId = c.get('agentId')
  const body = await c.req.json<{
    fromWalletId: string
    toWalletId: string
    amountCents: number
    rail?: string
    memo?: string
  }>()

  if (!body.fromWalletId || !body.toWalletId) {
    throw new HTTPException(400, { message: 'fromWalletId and toWalletId required' })
  }
  const amount = Math.round(body.amountCents ?? 0)
  if (amount <= 0) throw new HTTPException(400, { message: 'amountCents must be positive' })

  if (body.fromWalletId === body.toWalletId) {
    throw new HTTPException(400, { message: 'Cannot transfer to same wallet' })
  }

  const from = await c.env.DB.prepare(
    'SELECT id, balance_cents FROM wallets WHERE id = ? AND agent_id = ?'
  ).bind(body.fromWalletId, agentId).first<{ id: string; balance_cents: number }>()
  if (!from) throw new HTTPException(404, { message: 'Source wallet not found' })

  const to = await c.env.DB.prepare(
    'SELECT id FROM wallets WHERE id = ?'
  ).bind(body.toWalletId).first()
  if (!to) throw new HTTPException(404, { message: 'Destination wallet not found' })

  // ── CIRCUIT BREAKER: check daily budget ──
  const budget = await c.env.DB.prepare(
    'SELECT daily_limit_cents, monthly_limit_cents FROM budgets WHERE agent_id = ?'
  ).bind(agentId).first<{ daily_limit_cents: number | null; monthly_limit_cents: number | null }>()

  if (budget) {
    const spentToday = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions WHERE from_wallet_id IN (SELECT id FROM wallets WHERE agent_id = ?) AND status = 'completed' AND created_at >= date('now')"
    ).bind(agentId).first<{ total: number }>()

    if (budget.daily_limit_cents !== null && spentToday && (spentToday.total + amount) > budget.daily_limit_cents) {
      await audit(c.env.DB, agentId, 'transfer.blocked', 'transactions', null, 'blocked', `Daily budget exceeded: spent ${spentToday.total} + ${amount} > limit ${budget.daily_limit_cents}`)
      throw new HTTPException(429, { message: `CIRCUIT_BREAKER: Daily budget exceeded. Spent: ${spentToday.total}, Limit: ${budget.daily_limit_cents}` })
    }

    if (budget.monthly_limit_cents !== null) {
      const spentMonth = await c.env.DB.prepare(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions WHERE from_wallet_id IN (SELECT id FROM wallets WHERE agent_id = ?) AND status = 'completed' AND created_at >= date('now', 'start of month')"
      ).bind(agentId).first<{ total: number }>()

      if (spentMonth && (spentMonth.total + amount) > budget.monthly_limit_cents) {
        await audit(c.env.DB, agentId, 'transfer.blocked', 'transactions', null, 'blocked', `Monthly budget exceeded: spent ${spentMonth.total} + ${amount} > limit ${budget.monthly_limit_cents}`)
        throw new HTTPException(429, { message: `CIRCUIT_BREAKER: Monthly budget exceeded. Spent: ${spentMonth.total}, Limit: ${budget.monthly_limit_cents}` })
      }
    }
  }

  if (from.balance_cents < amount) {
    await audit(c.env.DB, agentId, 'transfer.blocked', 'transactions', null, 'blocked', 'Insufficient balance')
    throw new HTTPException(400, { message: 'Insufficient balance' })
  }

  const txId = crypto.randomUUID()
  const rail = body.rail ?? 'internal'

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents - ?, updated_at = datetime("now") WHERE id = ?').bind(amount, body.fromWalletId),
    c.env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = datetime("now") WHERE id = ?').bind(amount, body.toWalletId),
    c.env.DB.prepare(
      "INSERT INTO transactions (id, from_wallet_id, to_wallet_id, amount_cents, rail, memo, status) VALUES (?, ?, ?, ?, ?, ?, 'completed')"
    ).bind(txId, body.fromWalletId, body.toWalletId, amount, rail, body.memo ?? ''),
  ])

  await audit(c.env.DB, agentId, 'transfer.execute', 'transactions', txId, 'success')

  return c.json({
    transactionId: txId,
    amountCents: amount,
    rail,
    status: 'completed',
  }, 201)
})

// ── Transactions ──

api.get('/transactions', async (c) => {
  const agentId = c.get('agentId')
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50')))
  const walletId = c.req.query('walletId')

  let query: string
  let params: unknown[]

  if (walletId) {
    query = 'SELECT t.* FROM transactions t JOIN wallets w ON (t.from_wallet_id = w.id OR t.to_wallet_id = w.id) WHERE w.agent_id = ? AND (t.from_wallet_id = ? OR t.to_wallet_id = ?) ORDER BY t.created_at DESC LIMIT ?'
    params = [agentId, walletId, walletId, limit]
  } else {
    query = 'SELECT t.* FROM transactions t LEFT JOIN wallets w1 ON t.from_wallet_id = w1.id LEFT JOIN wallets w2 ON t.to_wallet_id = w2.id WHERE w1.agent_id = ? OR w2.agent_id = ? ORDER BY t.created_at DESC LIMIT ?'
    params = [agentId, agentId, limit]
  }

  const stmt = c.env.DB.prepare(query)
  const { results } = await stmt.bind(...params).all()
  return c.json({ data: results })
})

// ── Budgets ──

api.post('/budgets', async (c) => {
  const agentId = c.get('agentId')
  const body = await c.req.json<{ dailyLimitCents?: number | null; monthlyLimitCents?: number | null }>()

  const daily = body.dailyLimitCents === null ? null : (body.dailyLimitCents ? Math.round(body.dailyLimitCents) : null)
  const monthly = body.monthlyLimitCents === null ? null : (body.monthlyLimitCents ? Math.round(body.monthlyLimitCents) : null)

  await c.env.DB.prepare(
    `INSERT INTO budgets (id, agent_id, daily_limit_cents, monthly_limit_cents)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET daily_limit_cents = excluded.daily_limit_cents, monthly_limit_cents = excluded.monthly_limit_cents, updated_at = datetime('now')`
  ).bind(crypto.randomUUID(), agentId, daily, monthly).run()

  await audit(c.env.DB, agentId, 'budget.set', 'budgets', agentId, 'success')

  return c.json({ dailyLimitCents: daily, monthlyLimitCents: monthly })
})

api.get('/budgets', async (c) => {
  const agentId = c.get('agentId')
  const budget = await c.env.DB.prepare(
    'SELECT daily_limit_cents, monthly_limit_cents FROM budgets WHERE agent_id = ?'
  ).bind(agentId).first()
  return c.json({ data: budget ?? { daily_limit_cents: null, monthly_limit_cents: null } })
})

// ── Audit logs ──

api.get('/audit', async (c) => {
  const agentId = c.get('agentId')
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50')))
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM audit_logs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(agentId, limit).all()
  return c.json({ data: results })
})

// ── Public stats (for dashboard) ──

app.get('/api/stats', async (c) => {
  const [agents, wallets, txns] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'active'"),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM wallets'),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM transactions'),
  ])

  const blocked = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM audit_logs WHERE result = 'blocked'"
  ).first<{ count: number }>()

  return c.json({
    agents: (agents.results[0] as { count: number })?.count ?? 0,
    wallets: (wallets.results[0] as { count: number })?.count ?? 0,
    transactions: (txns.results[0] as { count: number })?.count ?? 0,
    blocked: blocked?.count ?? 0,
  })
})

app.route('/api', api)

async function audit(
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

export default app
