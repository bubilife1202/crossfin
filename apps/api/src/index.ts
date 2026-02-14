import { Hono, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'

import { paymentMiddleware, x402ResourceServer } from '@x402/hono'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { HTTPFacilitatorClient } from '@x402/core/server'

type Bindings = {
  DB: D1Database
  FACILITATOR_URL: string
  X402_NETWORK: string
  PAYMENT_RECEIVER_ADDRESS: string
}

type Variables = {
  agentId: string
}

type Env = { Bindings: Bindings; Variables: Variables }

type Caip2 = `${string}:${string}`

function requireCaip2(value: string): Caip2 {
  const trimmed = value.trim()
  if (!trimmed || !trimmed.includes(':')) {
    throw new HTTPException(500, { message: 'Invalid X402_NETWORK (expected CAIP-2 like eip155:84532)' })
  }
  return trimmed as Caip2
}

const app = new Hono<Env>()

app.use('*', cors({
  origin: ['http://localhost:5173', 'https://crossfin.pages.dev', 'https://crossfin.dev', 'https://www.crossfin.dev'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Agent-Key', 'PAYMENT-SIGNATURE'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
}))

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/', (c) => c.json({ name: 'crossfin-api', version: '0.0.0', status: 'ok' }))
app.get('/api/health', (c) => c.json({ name: 'crossfin-api', version: '0.0.0', status: 'ok' }))

app.use(
  '/api/premium/*',
  async (c, next) => {
    const network = requireCaip2(c.env.X402_NETWORK)
    const facilitatorClient = new HTTPFacilitatorClient({ url: c.env.FACILITATOR_URL })
    const resourceServer = new x402ResourceServer(facilitatorClient).register(
      network,
      new ExactEvmScheme(),
    )

    const middleware = paymentMiddleware(
      {
        'GET /api/premium/report': {
          accepts: {
            scheme: 'exact',
            price: '$0.001',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'CrossFin premium report (x402)',
          mimeType: 'application/json',
        },
        'GET /api/premium/enterprise': {
          accepts: {
            scheme: 'exact',
            price: '$20.00',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'CrossFin enterprise receipt (x402)',
          mimeType: 'application/json',
        },
        'GET /api/premium/arbitrage/kimchi': {
          accepts: {
            scheme: 'exact',
            price: '$0.05',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Real-time Kimchi Premium Index — price spread between Korean exchanges (Bithumb) and global exchanges (Binance) for top crypto pairs. Unique Korean market data unavailable anywhere else in x402 ecosystem.',
          mimeType: 'application/json',
        },
        'GET /api/premium/arbitrage/opportunities': {
          accepts: {
            scheme: 'exact',
            price: '$0.10',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Pre-calculated profitable arbitrage routes between Korean and global crypto exchanges. Includes estimated profit after fees, volume, and execution risk score.',
          mimeType: 'application/json',
        },
        'GET /api/premium/bithumb/orderbook': {
          accepts: {
            scheme: 'exact',
            price: '$0.02',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Live Bithumb (Korean exchange) orderbook depth for any trading pair. Raw bid/ask data from a market typically inaccessible to non-Korean users.',
          mimeType: 'application/json',
        },
        'GET /api/premium/market/korea': {
          accepts: {
            scheme: 'exact',
            price: '$0.03',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Korean crypto market sentiment — top movers, volume leaders, 24h gainers/losers on Bithumb. Unique Korean market intelligence for trading agents.',
          mimeType: 'application/json',
        },
      },
      resourceServer,
    )

    return middleware(c, next)
  },
)

const agentAuth: MiddlewareHandler<Env> = async (c, next) => {
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

// === Korean Arbitrage Data Helpers ===

const TRACKED_PAIRS: Record<string, string> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', XRP: 'XRPUSDT',
  SOL: 'SOLUSDT', DOGE: 'DOGEUSDT', ADA: 'ADAUSDT',
  DOT: 'DOTUSDT', LINK: 'LINKUSDT', AVAX: 'AVAXUSDT',
  EOS: 'EOSUSDT', TRX: 'TRXUSDT', MATIC: 'MATICUSDT',
}

const BITHUMB_FEES_PCT = 0.25 // Bithumb maker/taker fee
const BINANCE_FEES_PCT = 0.10 // Binance spot fee

async function fetchKrwRate(): Promise<number> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD')
    const data = await res.json() as { rates?: Record<string, number> }
    return data.rates?.KRW ?? 1450
  } catch {
    return 1450
  }
}

async function fetchBithumbAll(): Promise<Record<string, Record<string, string>>> {
  const res = await fetch('https://api.bithumb.com/public/ticker/ALL_KRW')
  const data = await res.json() as { status: string; data: Record<string, unknown> }
  if (data.status !== '0000') throw new HTTPException(502, { message: 'Bithumb API unavailable' })
  return data.data as Record<string, Record<string, string>>
}

async function fetchGlobalPrices(): Promise<Record<string, number>> {
  const coins = Object.keys(TRACKED_PAIRS).join(',')
  const res = await fetch(
    `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${coins}&tsyms=USD`,
  )
  if (!res.ok) throw new HTTPException(502, { message: 'Price feed unavailable' })
  const data = await res.json() as Record<string, { USD?: number }>
  const prices: Record<string, number> = {}
  for (const [coin, binanceSymbol] of Object.entries(TRACKED_PAIRS)) {
    if (data[coin]?.USD) prices[binanceSymbol] = data[coin].USD
  }
  return prices
}

async function fetchBithumbOrderbook(pair: string): Promise<{ bids: unknown[]; asks: unknown[] }> {
  const res = await fetch(`https://api.bithumb.com/public/orderbook/${pair}_KRW`)
  const data = await res.json() as { status: string; data: { bids: unknown[]; asks: unknown[] } }
  if (data.status !== '0000') throw new HTTPException(400, { message: `Invalid pair: ${pair}` })
  return data.data
}

function calcPremiums(
  bithumbData: Record<string, Record<string, string>>,
  binancePrices: Record<string, number>,
  krwRate: number,
) {
  const premiums = []
  for (const [coin, binanceSymbol] of Object.entries(TRACKED_PAIRS)) {
    const bithumb = bithumbData[coin]
    const binancePrice = binancePrices[binanceSymbol]
    if (!bithumb?.closing_price || !binancePrice) continue

    const bithumbKrw = parseFloat(bithumb.closing_price)
    const bithumbUsd = bithumbKrw / krwRate
    const premiumPct = ((bithumbUsd - binancePrice) / binancePrice) * 100
    const volume24hKrw = parseFloat(bithumb.acc_trade_value_24H || '0')
    const change24hPct = parseFloat(bithumb.fluctate_rate_24H || '0')

    premiums.push({
      coin,
      bithumbKrw,
      bithumbUsd: Math.round(bithumbUsd * 100) / 100,
      binanceUsd: binancePrice,
      premiumPct: Math.round(premiumPct * 100) / 100,
      volume24hKrw,
      volume24hUsd: Math.round(volume24hKrw / krwRate),
      change24hPct,
    })
  }
  return premiums.sort((a, b) => Math.abs(b.premiumPct) - Math.abs(a.premiumPct))
}

// === Kimchi Premium (paid $0.05) ===

app.get('/api/premium/arbitrage/kimchi', async (c) => {
  const [bithumbData, binancePrices, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchGlobalPrices(),
    fetchKrwRate(),
  ])

  const premiums = calcPremiums(bithumbData, binancePrices, krwRate)
  const avg = premiums.length > 0
    ? Math.round(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length * 100) / 100
    : 0

  return c.json({
    paid: true,
    service: 'crossfin-kimchi-premium',
    krwUsdRate: krwRate,
    pairsTracked: premiums.length,
    avgPremiumPct: avg,
    topPremium: premiums[0] ?? null,
    premiums,
    at: new Date().toISOString(),
  })
})

// === Arbitrage Opportunities (paid $0.10) ===

app.get('/api/premium/arbitrage/opportunities', async (c) => {
  const [bithumbData, binancePrices, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchGlobalPrices(),
    fetchKrwRate(),
  ])

  const premiums = calcPremiums(bithumbData, binancePrices, krwRate)
  const totalFeesPct = BITHUMB_FEES_PCT + BINANCE_FEES_PCT

  const opportunities = premiums
    .map((p) => {
      const netProfitPct = Math.abs(p.premiumPct) - totalFeesPct
      const direction = p.premiumPct > 0 ? 'buy-global-sell-korea' : 'buy-korea-sell-global'
      const riskScore = p.volume24hUsd < 100000 ? 'high' : p.volume24hUsd < 1000000 ? 'medium' : 'low'
      const profitPer10kUsd = Math.round(netProfitPct * 100) // cents per $10,000 traded

      return {
        coin: p.coin,
        direction,
        grossPremiumPct: p.premiumPct,
        estimatedFeesPct: totalFeesPct,
        netProfitPct: Math.round(netProfitPct * 100) / 100,
        profitPer10kUsd,
        volume24hUsd: p.volume24hUsd,
        riskScore,
        profitable: netProfitPct > 0,
        bithumbKrw: p.bithumbKrw,
        binanceUsd: p.binanceUsd,
      }
    })
    .sort((a, b) => b.netProfitPct - a.netProfitPct)

  const profitable = opportunities.filter((o) => o.profitable)

  return c.json({
    paid: true,
    service: 'crossfin-arbitrage-opportunities',
    krwUsdRate: krwRate,
    totalOpportunities: opportunities.length,
    profitableCount: profitable.length,
    estimatedFeesNote: `Bithumb ${BITHUMB_FEES_PCT}% + Binance ${BINANCE_FEES_PCT}% = ${totalFeesPct}% total`,
    bestOpportunity: profitable[0] ?? null,
    opportunities,
    at: new Date().toISOString(),
  })
})

// === Bithumb Orderbook (paid $0.02) ===

app.get('/api/premium/bithumb/orderbook', async (c) => {
  const pair = (c.req.query('pair') ?? 'BTC').toUpperCase()
  const [orderbook, krwRate] = await Promise.all([
    fetchBithumbOrderbook(pair),
    fetchKrwRate(),
  ])

  const bids = (orderbook.bids as Array<{ price: string; quantity: string }>).slice(0, 30)
  const asks = (orderbook.asks as Array<{ price: string; quantity: string }>).slice(0, 30)

  const bestBid = bids[0] ? parseFloat(bids[0].price) : 0
  const bestAsk = asks[0] ? parseFloat(asks[0].price) : 0
  const spreadKrw = bestAsk - bestBid
  const spreadPct = bestBid > 0 ? Math.round((spreadKrw / bestBid) * 10000) / 100 : 0

  return c.json({
    paid: true,
    service: 'crossfin-bithumb-orderbook',
    pair: `${pair}/KRW`,
    exchange: 'Bithumb',
    bestBidKrw: bestBid,
    bestAskKrw: bestAsk,
    spreadKrw,
    spreadPct,
    bestBidUsd: Math.round(bestBid / krwRate * 100) / 100,
    bestAskUsd: Math.round(bestAsk / krwRate * 100) / 100,
    depth: { bids, asks },
    at: new Date().toISOString(),
  })
})

// === Korea Market Sentiment (paid $0.03) ===

app.get('/api/premium/market/korea', async (c) => {
  const [bithumbData, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchKrwRate(),
  ])

  const coins: Array<{
    coin: string; priceKrw: number; priceUsd: number;
    change24hPct: number; volume24hKrw: number; volume24hUsd: number;
  }> = []

  for (const [coin, data] of Object.entries(bithumbData)) {
    if (coin === 'date' || typeof data !== 'object' || !data) continue
    const d = data as Record<string, string>
    if (!d.closing_price) continue

    const priceKrw = parseFloat(d.closing_price)
    const volume24hKrw = parseFloat(d.acc_trade_value_24H || '0')
    coins.push({
      coin,
      priceKrw,
      priceUsd: Math.round(priceKrw / krwRate * 100) / 100,
      change24hPct: parseFloat(d.fluctate_rate_24H || '0'),
      volume24hKrw,
      volume24hUsd: Math.round(volume24hKrw / krwRate),
    })
  }

  const topGainers = [...coins].sort((a, b) => b.change24hPct - a.change24hPct).slice(0, 10)
  const topLosers = [...coins].sort((a, b) => a.change24hPct - b.change24hPct).slice(0, 10)
  const topVolume = [...coins].sort((a, b) => b.volume24hUsd - a.volume24hUsd).slice(0, 10)
  const totalVolumeUsd = coins.reduce((s, c) => s + c.volume24hUsd, 0)
  const avgChange = coins.length > 0
    ? Math.round(coins.reduce((s, c) => s + c.change24hPct, 0) / coins.length * 100) / 100
    : 0

  return c.json({
    paid: true,
    service: 'crossfin-korea-sentiment',
    exchange: 'Bithumb',
    totalCoins: coins.length,
    totalVolume24hUsd: totalVolumeUsd,
    avgChange24hPct: avgChange,
    marketMood: avgChange > 1 ? 'bullish' : avgChange < -1 ? 'bearish' : 'neutral',
    topGainers,
    topLosers,
    topVolume,
    krwUsdRate: krwRate,
    at: new Date().toISOString(),
  })
})

// === Free Demo — delayed kimchi premium (no paywall) ===

app.get('/api/arbitrage/demo', async (c) => {
  const [bithumbData, binancePrices, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchGlobalPrices(),
    fetchKrwRate(),
  ])

  const premiums = calcPremiums(bithumbData, binancePrices, krwRate)
  // Demo: only show top 3, hide detailed numbers
  const preview = premiums.slice(0, 3).map((p) => ({
    coin: p.coin,
    premiumPct: p.premiumPct,
    direction: p.premiumPct > 0 ? 'Korea premium' : 'Korea discount',
  }))

  return c.json({
    demo: true,
    note: 'Free preview — limited to top 3 pairs. Pay $0.05 USDC via x402 for full real-time data on all pairs.',
    paidEndpoint: '/api/premium/arbitrage/kimchi',
    pairsShown: preview.length,
    totalPairsAvailable: premiums.length,
    preview,
    avgPremiumPct: premiums.length > 0
      ? Math.round(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length * 100) / 100
      : 0,
    at: new Date().toISOString(),
  })
})

// === Existing Premium Endpoints ===

app.get('/api/premium/report', async (c) => {
  const results = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'active'"),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM wallets'),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM transactions'),
  ])

  const agents = results[0]
  const wallets = results[1]
  const txns = results[2]

  const blocked = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM audit_logs WHERE result = 'blocked'"
  ).first<{ count: number }>()

  const { results: recentTransactions } = await c.env.DB.prepare(
    'SELECT id, rail, amount_cents, currency, memo, status, created_at FROM transactions ORDER BY created_at DESC LIMIT 10'
  ).all()

  return c.json({
    paid: true,
    network: requireCaip2(c.env.X402_NETWORK),
    stats: {
      agents: (agents?.results?.[0] as { count: number } | undefined)?.count ?? 0,
      wallets: (wallets?.results?.[0] as { count: number } | undefined)?.count ?? 0,
      transactions: (txns?.results?.[0] as { count: number } | undefined)?.count ?? 0,
      blocked: blocked?.count ?? 0,
    },
    recentTransactions,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/enterprise', async (c) => {
  const now = new Date().toISOString()
  return c.json({
    paid: true,
    tier: 'enterprise',
    priceUsd: 20,
    network: requireCaip2(c.env.X402_NETWORK),
    receiptId: crypto.randomUUID(),
    at: now,
  })
})

const api = new Hono<Env>()
api.use('*', agentAuth)

api.get('/me', async (c) => {
  const agentId = c.get('agentId')
  const agent = await c.env.DB.prepare(
    'SELECT id, name, status, created_at FROM agents WHERE id = ?'
  ).bind(agentId).first()
  return c.json({ data: agent })
})

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

api.get('/audit', async (c) => {
  const agentId = c.get('agentId')
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50')))
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM audit_logs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(agentId, limit).all()
  return c.json({ data: results })
})

app.get('/api/stats', async (c) => {
  const results = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'active'"),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM wallets'),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM transactions'),
  ])

  const agents = results[0]
  const wallets = results[1]
  const txns = results[2]

  const blocked = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM audit_logs WHERE result = 'blocked'"
  ).first<{ count: number }>()

  return c.json({
    agents: (agents?.results?.[0] as { count: number } | undefined)?.count ?? 0,
    wallets: (wallets?.results?.[0] as { count: number } | undefined)?.count ?? 0,
    transactions: (txns?.results?.[0] as { count: number } | undefined)?.count ?? 0,
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
