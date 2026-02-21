import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../types'
import { requireAdmin, isRecord } from '../types'
import type { RoutingExchange } from '../constants'
import { ROUTING_EXCHANGES } from '../constants'
import { ensureFeeTables, invalidateFeeCaches, fetchWithTimeout } from '../lib/fetchers'
import { audit, ensurePremiumPaymentsTable } from '../lib/helpers'

const admin = new Hono<Env>()

// PUT /fees — Update exchange trading/withdrawal fees (admin-only)
admin.put('/fees', async (c) => {
  requireAdmin(c)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' })
  }

  if (!isRecord(body)) {
    throw new HTTPException(400, { message: 'JSON object body is required' })
  }

  const exchange = typeof body.exchange === 'string' ? body.exchange.trim().toLowerCase() : ''
  if (!ROUTING_EXCHANGES.includes(exchange as RoutingExchange)) {
    throw new HTTPException(400, { message: `exchange must be one of: ${ROUTING_EXCHANGES.join(', ')}` })
  }

  const hasTradingFee = body.tradingFee !== undefined
  const hasWithdrawalFee = body.withdrawalFee !== undefined
  if (!hasTradingFee && !hasWithdrawalFee) {
    throw new HTTPException(400, { message: 'Provide tradingFee or withdrawalFee' })
  }

  await ensureFeeTables(c.env.DB)

  let updatedTradingFee: number | null = null
  let updatedWithdrawalFee: { coin: string; fee: number } | null = null

  if (hasTradingFee) {
    const tradingFee = Number(body.tradingFee)
    if (!Number.isFinite(tradingFee) || tradingFee < 0) {
      throw new HTTPException(400, { message: 'tradingFee must be a non-negative number' })
    }

    await c.env.DB.prepare(
      `INSERT INTO exchange_trading_fees (exchange, fee_pct, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(exchange) DO UPDATE SET fee_pct = excluded.fee_pct, updated_at = datetime('now')`
    ).bind(exchange, tradingFee).run()
    updatedTradingFee = tradingFee
  }

  if (hasWithdrawalFee) {
    const coin = typeof body.coin === 'string' ? body.coin.trim().toUpperCase() : ''
    if (!coin) {
      throw new HTTPException(400, { message: 'coin is required when updating withdrawalFee' })
    }

    const withdrawalFee = Number(body.withdrawalFee)
    if (!Number.isFinite(withdrawalFee) || withdrawalFee < 0) {
      throw new HTTPException(400, { message: 'withdrawalFee must be a non-negative number' })
    }

    await c.env.DB.prepare(
      `INSERT INTO exchange_withdrawal_fees (exchange, coin, fee, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(exchange, coin) DO UPDATE SET fee = excluded.fee, updated_at = datetime('now')`
    ).bind(exchange, coin, withdrawalFee).run()

    updatedWithdrawalFee = { coin, fee: withdrawalFee }
  }

  invalidateFeeCaches()

  await audit(
    c.env.DB,
    null,
    'admin.fees.update',
    'exchange_fees',
    exchange,
    'success',
    `tradingFee=${updatedTradingFee ?? 'unchanged'} withdrawal=${updatedWithdrawalFee ? `${updatedWithdrawalFee.coin}:${updatedWithdrawalFee.fee}` : 'unchanged'}`,
  )

  return c.json({
    ok: true,
    exchange,
    tradingFee: updatedTradingFee,
    withdrawalFee: updatedWithdrawalFee,
    at: new Date().toISOString(),
  })
})

// GET /payments — List x402 premium payment records (admin-only)
admin.get('/payments', async (c) => {
  requireAdmin(c)
  await ensurePremiumPaymentsTable(c.env.DB)

  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200)
  const offset = Math.max(Number(c.req.query('offset')) || 0, 0)
  const payer = c.req.query('payer')?.trim()
  const endpoint = c.req.query('endpoint')?.trim()

  let sql = 'SELECT * FROM premium_payments'
  const conditions: string[] = []
  const params: string[] = []

  if (payer) {
    conditions.push('payer = ?')
    params.push(payer)
  }
  if (endpoint) {
    conditions.push('endpoint = ?')
    params.push(endpoint)
  }
  if (conditions.length) {
    sql += ` WHERE ${conditions.join(' AND ')}`
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'

  const stmt = c.env.DB.prepare(sql)
  const { results } = await stmt.bind(...params, limit, offset).all()

  const countSql = conditions.length
    ? `SELECT COUNT(*) as total FROM premium_payments WHERE ${conditions.join(' AND ')}`
    : 'SELECT COUNT(*) as total FROM premium_payments'
  const countStmt = c.env.DB.prepare(countSql)
  const row = conditions.length
    ? await countStmt.bind(...params).first<{ total: number }>()
    : await countStmt.first<{ total: number }>()

  return c.json({ payments: results, total: row?.total ?? 0, limit, offset })
})

// POST /telegram/setup-webhook — Register Telegram webhook using stored secrets (admin-only)
admin.post('/telegram/setup-webhook', async (c) => {
  requireAdmin(c)

  const botToken = (c.env.TELEGRAM_BOT_TOKEN ?? '').trim()
  const webhookSecret = (c.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim()
  if (!botToken || !webhookSecret) {
    throw new HTTPException(500, { message: 'TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET not configured' })
  }

  const webhookUrl = 'https://crossfin.dev/api/telegram/webhook'

  const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ['message'],
    }),
  }, 10000)

  const result = await response.json()
  return c.json({ ok: true, webhook_url: webhookUrl, telegram_response: result })
})

// GET /telegram/webhook-info — Check current Telegram webhook status (admin-only)
admin.get('/telegram/webhook-info', async (c) => {
  requireAdmin(c)

  const botToken = (c.env.TELEGRAM_BOT_TOKEN ?? '').trim()
  if (!botToken) {
    throw new HTTPException(500, { message: 'TELEGRAM_BOT_TOKEN not configured' })
  }

  const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/getWebhookInfo`, undefined, 10000)
  const result = await response.json()
  return c.json(result)
})

// POST /telegram/test-typing — Send a test typing indicator to TELEGRAM_ADMIN_CHAT_ID (admin-only)
admin.post('/telegram/test-typing', async (c) => {
  requireAdmin(c)

  const botToken = (c.env.TELEGRAM_BOT_TOKEN ?? '').trim()
  const adminChatId = (c.env.TELEGRAM_ADMIN_CHAT_ID ?? '').trim()
  if (!botToken) {
    throw new HTTPException(500, { message: 'TELEGRAM_BOT_TOKEN not configured' })
  }
  if (!adminChatId) {
    throw new HTTPException(500, { message: 'TELEGRAM_ADMIN_CHAT_ID not configured' })
  }

  const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: adminChatId, action: 'typing' }),
  }, 10000)

  const result = await response.json()
  return c.json({ ok: response.ok, status: response.status, chat_id: adminChatId, telegram_response: result })
})

export default admin
