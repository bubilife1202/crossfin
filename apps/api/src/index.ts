import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod/v4'

import { paymentMiddleware, x402ResourceServer } from '@x402/hono'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions/bazaar'
import {
  CROSSFIN_API_VERSION,
  CROSSFIN_MCP_TOOLS,
  CROSSFIN_PAID_ENDPOINTS,
  CROSSFIN_PAID_PRICING,
  withSampleQuery,
} from './catalog'

type Bindings = {
  DB: D1Database
  FACILITATOR_URL: string
  X402_NETWORK: string
  PAYMENT_RECEIVER_ADDRESS: string
  CROSSFIN_ADMIN_TOKEN?: string
  CROSSFIN_GUARDIAN_ENABLED?: string
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

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  const maxLength = Math.max(aBytes.length, bBytes.length)

  let diff = aBytes.length === bBytes.length ? 0 : 1
  for (let i = 0; i < maxLength; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0)
  }

  return diff === 0
}

function isEnabledFlag(value: string | undefined): boolean {
  const raw = (value ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function requireGuardianEnabled(c: Context<Env>): void {
  if (!isEnabledFlag(c.env.CROSSFIN_GUARDIAN_ENABLED)) {
    throw new HTTPException(404, { message: 'Not found' })
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(new Uint8Array(digest))
}

const app = new Hono<Env>()

const PUBLIC_RATE_LIMIT_WINDOW_MS = 60_000
const PUBLIC_RATE_LIMIT_PER_WINDOW = 120
const PUBLIC_RATE_LIMIT_MAX_BUCKETS = 20_000
const HOST_RESOLUTION_CACHE_TTL_MS = 5 * 60_000
const HOST_RESOLUTION_CACHE_MAX_SIZE = 20_000

type RateLimitBucket = {
  count: number
  windowStartedAt: number
}

const publicRateLimitBuckets = new Map<string, RateLimitBucket>()
const hostResolutionCache = new Map<string, number>()

const FUNNEL_EVENT_NAMES = [
  'mcp_quickstart_view',
  'mcp_command_copy',
  'mcp_config_view',
  'mcp_config_copy',
  'mcp_guide_open',
  'mcp_install_verify',
] as const

type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number]

const FUNNEL_EVENT_NAME_SET = new Set<string>(FUNNEL_EVENT_NAMES)
const MAX_FUNNEL_SOURCE_LENGTH = 64
const MAX_FUNNEL_METADATA_LENGTH = 2000
const MAX_FUNNEL_USER_AGENT_LENGTH = 180

function trimTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

function getPublicRateLimitRouteKey(path: string): string | null {
  const normalized = trimTrailingSlash(path)

  if (
    normalized === '/api/health' ||
    normalized === '/api/docs/guide' ||
    normalized === '/api/openapi.json' ||
    normalized === '/api/arbitrage/demo' ||
    normalized === '/api/analytics/overview' ||
    normalized === '/api/analytics/funnel/overview' ||
    normalized === '/api/analytics/funnel/events' ||
    normalized === '/api/onchain/usdc-transfers' ||
    normalized === '/api/survival/status' ||
    normalized === '/api/stats' ||
    normalized === '/api/registry' ||
    normalized === '/api/registry/search' ||
    normalized === '/api/registry/categories' ||
    normalized === '/api/registry/stats' ||
    normalized === '/api/agents/register' ||
    normalized === '/api/deposits' ||
    normalized === '/api/guardian/status' ||
    normalized === '/api/guardian/rules' ||
    normalized === '/api/route/exchanges' ||
    normalized === '/api/route/fees' ||
    normalized === '/api/route/pairs' ||
    normalized === '/api/route/status' ||
    normalized === '/api/acp/status'
  ) {
    return normalized
  }

  if (normalized.startsWith('/api/registry/')) return '/api/registry/:id'
  if (normalized.startsWith('/api/analytics/services/')) return '/api/analytics/services/:serviceId'
  return null
}

function getClientRateLimitKey(c: Context<Env>): string {
  const cfIp = (c.req.header('CF-Connecting-IP') ?? '').trim()
  if (cfIp) return cfIp

  const forwardedFor = (c.req.header('X-Forwarded-For') ?? '').trim()
  if (!forwardedFor) return 'unknown'

  return forwardedFor.split(',')[0]?.trim() || 'unknown'
}

function pruneRateLimitBuckets(now: number): void {
  if (publicRateLimitBuckets.size < PUBLIC_RATE_LIMIT_MAX_BUCKETS) return

  for (const [key, bucket] of publicRateLimitBuckets.entries()) {
    if (now - bucket.windowStartedAt >= PUBLIC_RATE_LIMIT_WINDOW_MS) {
      publicRateLimitBuckets.delete(key)
    }
  }
}

function pruneHostResolutionCache(now: number): void {
  if (hostResolutionCache.size < HOST_RESOLUTION_CACHE_MAX_SIZE) return

  for (const [hostname, checkedAt] of hostResolutionCache.entries()) {
    if (now - checkedAt >= HOST_RESOLUTION_CACHE_TTL_MS) {
      hostResolutionCache.delete(hostname)
    }
  }

  if (hostResolutionCache.size >= HOST_RESOLUTION_CACHE_MAX_SIZE) {
    const oldest = hostResolutionCache.keys().next().value
    if (typeof oldest === 'string') hostResolutionCache.delete(oldest)
  }
}

const publicRateLimit: MiddlewareHandler<Env> = async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    await next()
    return
  }

  const routeKey = getPublicRateLimitRouteKey(c.req.path)
  if (!routeKey) {
    await next()
    return
  }

  const now = Date.now()
  pruneRateLimitBuckets(now)

  const clientKey = getClientRateLimitKey(c)
  const bucketKey = `${clientKey}:${routeKey}`
  const existing = publicRateLimitBuckets.get(bucketKey)

  if (!existing || now - existing.windowStartedAt >= PUBLIC_RATE_LIMIT_WINDOW_MS) {
    publicRateLimitBuckets.set(bucketKey, { count: 1, windowStartedAt: now })
    await next()
    return
  }

  if (existing.count >= PUBLIC_RATE_LIMIT_PER_WINDOW) {
    throw new HTTPException(429, { message: 'Rate limited' })
  }

  existing.count += 1
  await next()
}

app.use('*', cors({
  origin: ['http://localhost:5173', 'https://crossfin.pages.dev', 'https://crossfin.dev', 'https://www.crossfin.dev', 'https://live.crossfin.dev', 'https://crossfin-live.pages.dev'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Agent-Key', 'X-CrossFin-Admin-Token', 'PAYMENT-SIGNATURE'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
}))

app.use('/api/*', publicRateLimit)

function requireAdmin(c: Context<Env>): void {
  const expected = (c.env.CROSSFIN_ADMIN_TOKEN ?? '').trim()

  if (!expected) {
    throw new HTTPException(404, { message: 'Not found' })
  }

  const headerToken = (c.req.header('X-CrossFin-Admin-Token') ?? '').trim()
  const auth = (c.req.header('Authorization') ?? '').trim()
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''

  const provided = headerToken || bearer
  if (!provided || !timingSafeEqual(provided, expected)) {
    throw new HTTPException(401, { message: 'Unauthorized' })
  }
}

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/', (c) => c.json({ name: 'crossfin-api', version: CROSSFIN_API_VERSION, status: 'ok' }))
app.get('/api/health', (c) => c.json({ name: 'crossfin-api', version: CROSSFIN_API_VERSION, status: 'ok' }))

app.get('/api/docs/guide', (c) => {
  return c.json({
    name: 'CrossFin Agent Guide',
    version: CROSSFIN_API_VERSION,
    overview: {
      what: 'CrossFin is a service gateway for AI agents. Discover, compare, and call x402/REST services through a single API.',
      services: 'Use GET /api/registry/stats for the current active service counts.',
      payment: 'CrossFin services use x402 protocol — pay per API call with USDC on Base mainnet. No API key, no subscription.',
      free: 'Registry search, categories, stats, and the arbitrage demo are all free.',
    },
    quickStart: {
      step1: {
        title: 'Search for services',
        endpoint: 'GET /api/registry/search?q=crypto',
        description: 'Search by keyword. Returns matching services with endpoint, price, and payment metadata.',
        example: 'curl https://crossfin.dev/api/registry/search?q=korea',
      },
      step2: {
        title: 'Get service details',
        endpoint: 'GET /api/registry/{id}',
        description: 'Get full details for a specific service including endpoint URL, pricing, inputSchema/outputExample, and (for CrossFin services) a guide field.',
        example: 'curl https://crossfin.dev/api/registry/crossfin_kimchi_premium',
      },
      step3: {
        title: 'Call the service',
        description:
          'Call the service endpoint directly. For x402 services, the first request returns HTTP 402 with payment details. Sign the payment and resend.',
        freeExample: 'curl https://crossfin.dev/api/arbitrage/demo',
        paidExample: 'Requires x402 client library — see x402Payment section below.',
      },
    },
    freeEndpoints: [
      { path: '/api/health', description: 'Health check' },
      { path: '/api/registry/search?q=', description: 'Search services by keyword' },
      { path: '/api/registry', description: 'List all services (filterable by category)' },
      { path: '/api/registry/categories', description: 'List categories with counts' },
      { path: '/api/registry/stats', description: 'Total service counts' },
      { path: '/api/registry/{id}', description: 'Service details by ID' },
      { path: '/api/arbitrage/demo', description: 'Free kimchi premium preview (top 3 pairs)' },
      { path: '/api/analytics/overview', description: 'Gateway usage analytics' },
      { path: '/api/analytics/funnel/overview', description: 'Web onboarding conversion funnel analytics' },
      { path: '/api/analytics/funnel/events', description: 'Track web onboarding events (POST)' },
      { path: '/api/stats', description: 'Public-safe summary (sensitive counts redacted)' },
      { path: '/api/openapi.json', description: 'OpenAPI 3.1 specification' },
      { path: '/api/docs/guide', description: 'This guide' },
      { path: '/api/route/exchanges', description: 'List supported exchanges with trading fees and supported coins' },
      { path: '/api/route/fees', description: 'Fee comparison table — trading + withdrawal fees for all exchanges' },
      { path: '/api/route/fees?coin=KAIA', description: 'Fee comparison for a specific coin' },
      { path: '/api/route/pairs', description: 'All supported trading pairs with live Binance prices' },
      { path: '/api/route/status', description: 'Exchange API health check (online/offline per exchange)' },
      { path: '/api/acp/status', description: 'ACP protocol capabilities and supported exchanges' },
      { path: 'POST /api/acp/quote', description: 'Request a free routing quote (ACP-compatible, preview-only)' },
      { path: 'POST /api/acp/execute', description: 'Execute a route (simulation mode)' },
    ],
    notes: [
      'Proxy endpoints (/api/proxy/:serviceId) require X-Agent-Key to prevent abuse.',
      'Korean exchanges (Upbit, Bithumb, Coinone, GoPax) trade in KRW. Binance trades in USDT/USDC.',
      'Routing engine supports bidirectional transfers: Korea→Global and Global→Korea.',
    ],
    crossfinServices: {
      _note: '35 paid endpoints organized by category. All paid via x402 with USDC on Base mainnet.',
      crypto_arbitrage: [
        { id: 'crossfin_kimchi_premium', endpoint: '/api/premium/arbitrage/kimchi', price: '$0.05', description: 'Real-time Kimchi Premium Index — price spread between Korean (Bithumb) and global (Binance) exchanges for 11 crypto pairs including KAIA.' },
        { id: 'crossfin_kimchi_premium_history', endpoint: '/api/premium/arbitrage/kimchi/history', price: '$0.05', description: 'Hourly snapshots of kimchi premium data from D1 database, up to 7 days lookback. Query by coin and time range.' },
        { id: 'crossfin_arbitrage_opportunities', endpoint: '/api/premium/arbitrage/opportunities', price: '$0.10', description: 'AI-ready arbitrage decisions: EXECUTE/WAIT/SKIP with slippage, premium trends, transfer time risk, and confidence scores.' },
        { id: 'crossfin_cross_exchange', endpoint: '/api/premium/market/cross-exchange', price: '$0.08', description: 'Compare prices across 4 Korean exchanges with ARBITRAGE/HOLD/MONITOR signals and best buy/sell routing.' },
        { id: 'crossfin_5exchange', endpoint: '/api/premium/crypto/korea/5exchange?coin=BTC', price: '$0.08', description: 'Compare crypto prices across 4 Korean exchanges (Upbit, Bithumb, Coinone, GoPax) for any coin.' },
      ],
      exchange_data: [
        { id: 'crossfin_bithumb_orderbook', endpoint: '/api/premium/bithumb/orderbook?pair=BTC', price: '$0.02', description: 'Live 30-level orderbook depth from Bithumb for any KRW trading pair.' },
        { id: 'crossfin_bithumb_volume', endpoint: '/api/premium/bithumb/volume-analysis', price: '$0.03', description: '24h volume distribution, concentration, and unusual volume detection across Bithumb.' },
        { id: 'crossfin_upbit_ticker', endpoint: '/api/premium/market/upbit/ticker?market=KRW-BTC', price: '$0.02', description: 'Upbit spot ticker data for any KRW market pair.' },
        { id: 'crossfin_upbit_orderbook', endpoint: '/api/premium/market/upbit/orderbook?market=KRW-BTC', price: '$0.02', description: 'Upbit orderbook snapshot for any KRW market pair.' },
        { id: 'crossfin_upbit_signals', endpoint: '/api/premium/market/upbit/signals', price: '$0.05', description: 'Trading signals for major KRW markets on Upbit — momentum, relative volume, volatility, and combined bullish/bearish/neutral call.' },
        { id: 'crossfin_upbit_candles', endpoint: '/api/premium/crypto/korea/upbit-candles?coin=BTC&type=days', price: '$0.02', description: 'Upbit OHLCV candle data (1m, 5m, 15m, 1h, 4h, daily, weekly, monthly). Up to 200 candles.' },
        { id: 'crossfin_coinone_ticker', endpoint: '/api/premium/market/coinone/ticker?currency=BTC', price: '$0.02', description: 'Coinone spot ticker data for any KRW pair.' },
        { id: 'crossfin_exchange_status', endpoint: '/api/premium/crypto/korea/exchange-status', price: '$0.03', description: 'Bithumb deposit/withdrawal status for all coins — check before transferring.' },
      ],
      market_sentiment: [
        { id: 'crossfin_korea_sentiment', endpoint: '/api/premium/market/korea', price: '$0.03', description: 'Korean crypto market sentiment — top gainers, losers, volume leaders, and overall market mood (bullish/bearish/neutral).' },
        { id: 'crossfin_korea_headlines', endpoint: '/api/premium/news/korea/headlines', price: '$0.03', description: 'Korean crypto/finance news headlines via Google News RSS feed.' },
      ],
      fx_rates: [
        { id: 'crossfin_usdkrw', endpoint: '/api/premium/market/fx/usdkrw', price: '$0.01', description: 'USD/KRW exchange rate for converting Korean exchange prices.' },
        { id: 'crossfin_fx_rate', endpoint: '/api/premium/crypto/korea/fx-rate', price: '$0.01', description: 'Real-time KRW/USD exchange rate from Upbit CRIX with 52-week high/low context.' },
      ],
      korean_stocks: [
        { id: 'crossfin_korea_indices', endpoint: '/api/premium/market/korea/indices', price: '$0.03', description: 'KOSPI & KOSDAQ real-time index (price, change, direction, market status).' },
        { id: 'crossfin_korea_indices_history', endpoint: '/api/premium/market/korea/indices/history', price: '$0.05', description: 'KOSPI/KOSDAQ daily OHLC history up to 60 trading days.' },
        { id: 'crossfin_korea_stocks_momentum', endpoint: '/api/premium/market/korea/stocks/momentum', price: '$0.05', description: 'Korean stock momentum — top market cap, gainers, losers.' },
        { id: 'crossfin_korea_investor_flow', endpoint: '/api/premium/market/korea/investor-flow?stock=005930', price: '$0.05', description: 'Stock investor flow — 10-day foreign/institutional/individual net buying for any stock.' },
        { id: 'crossfin_korea_index_flow', endpoint: '/api/premium/market/korea/index-flow?index=KOSPI', price: '$0.03', description: 'KOSPI/KOSDAQ investor flow — foreign/institutional/individual net buying (billion KRW).' },
        { id: 'crossfin_korea_stock_detail', endpoint: '/api/premium/market/korea/stock-detail?stock=005930', price: '$0.05', description: 'Comprehensive stock analysis — PER, PBR, consensus target, industry peers.' },
        { id: 'crossfin_korea_stock_news', endpoint: '/api/premium/market/korea/stock-news?stock=005930', price: '$0.03', description: 'Stock-specific news from Naver Finance.' },
        { id: 'crossfin_korea_themes', endpoint: '/api/premium/market/korea/themes', price: '$0.05', description: 'Korean stock market themes/sectors with performance.' },
        { id: 'crossfin_korea_disclosure', endpoint: '/api/premium/market/korea/disclosure?stock=005930', price: '$0.03', description: 'Corporate disclosure filings (DART).' },
        { id: 'crossfin_korea_etf', endpoint: '/api/premium/market/korea/etf', price: '$0.03', description: 'Korean ETF list with NAV, price, 3-month returns (1,070+ ETFs).' },
      ],
      global_markets: [
        { id: 'crossfin_global_indices_chart', endpoint: '/api/premium/market/global/indices-chart?index=.DJI', price: '$0.02', description: 'Global index chart — Dow (.DJI), NASDAQ (.IXIC), Hang Seng (.HSI), Nikkei (.N225).' },
      ],
      bundle_apis: [
        { id: 'crossfin_morning_brief', endpoint: '/api/premium/morning/brief', price: '$0.20', description: 'Morning Brief — kimchi premium + FX + KOSPI/KOSDAQ + stock momentum + headlines in one call. Best value for daily market overview.' },
        { id: 'crossfin_crypto_snapshot', endpoint: '/api/premium/crypto/snapshot', price: '$0.15', description: 'Crypto Snapshot — 5-exchange BTC prices + kimchi premium + Bithumb volume + FX rate in one call.' },
        { id: 'crossfin_kimchi_stats', endpoint: '/api/premium/kimchi/stats', price: '$0.15', description: 'Kimchi Stats — current spreads + 24h trend + arbitrage signal + cross-exchange spread in one call.' },
        { id: 'crossfin_stock_brief', endpoint: '/api/premium/market/korea/stock-brief?stock=005930', price: '$0.10', description: 'Stock Brief — fundamentals + news + investor flow + disclosures for any Korean stock in one call.' },
      ],
      routing_engine: [
        { id: 'crossfin_route_find', endpoint: '/api/premium/route/find?from=bithumb:KRW&to=binance:USDC&amount=1000000', price: '$0.10', description: 'Find optimal crypto transfer route across 5 exchanges (Bithumb, Upbit, Coinone, GoPax, Binance). Compares 11 bridge coins, estimates fees and slippage. Bidirectional: Korea→Global and Global→Korea.' },
      ],
    },
    routingEngine: {
      overview: 'CrossFin Routing Engine finds the cheapest, fastest, or balanced crypto transfer route across 5 exchanges. It compares 11 bridge coins, models trading fees, withdrawal fees, slippage, and transfer times.',
      supportedExchanges: [
        { id: 'bithumb', country: 'South Korea', tradingFee: '0.25%', note: 'Lowest withdrawal fee policy' },
        { id: 'upbit', country: 'South Korea', tradingFee: '0.25%', note: 'Largest Korean exchange by volume' },
        { id: 'coinone', country: 'South Korea', tradingFee: '0.20%', note: 'Supports KAIA' },
        { id: 'gopax', country: 'South Korea', tradingFee: '0.20%', note: 'Supports KAIA, no DOT' },
        { id: 'binance', country: 'Global', tradingFee: '0.10%', note: 'Global exchange, trades in USDT/USDC' },
      ],
      bridgeCoins: ['XRP', 'SOL', 'TRX', 'KAIA', 'ETH', 'BTC', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK'],
      bridgeCoinNotes: {
        fastest: 'XRP (~30s), SOL (~1m), TRX (~1m), KAIA (~1m)',
        cheapest: 'XRP, TRX, KAIA (very low withdrawal fees)',
        KAIA: 'Kaia (formerly Klaytn). 1-second blocks with instant PBFT finality. Available on Binance, Bithumb, Coinone, GoPax. NOT on Upbit.',
        notOnAllExchanges: 'DOT not on GoPax. KAIA not on Upbit. Check /api/route/exchanges for per-exchange coin support.',
      },
      strategies: [
        { id: 'cheapest', description: 'Minimize total fees (trading + withdrawal + slippage). Default.' },
        { id: 'fastest', description: 'Minimize transfer time. Prefers XRP, SOL, TRX, KAIA.' },
        { id: 'balanced', description: 'Weighted combination of cost and speed.' },
      ],
      directions: {
        koreaToGlobal: { example: 'from=bithumb:KRW&to=binance:USDC&amount=1000000', description: 'Transfer KRW from Korean exchange to USDC on Binance. Common for taking profits from kimchi premium.' },
        globalToKorea: { example: 'from=binance:USDC&to=bithumb:KRW&amount=1000', description: 'Transfer USDC from Binance to KRW on Korean exchange. Profitable when kimchi premium is positive (buy cheap globally, sell expensive in Korea).' },
      },
      responseIncludes: ['Optimal route with step-by-step execution plan', 'Up to 10 alternative routes ranked by strategy', 'Fee breakdown (trading + withdrawal)', 'Estimated output amount and net profit/loss %', 'Transfer time estimate per bridge coin', 'User-friendly summary with recommendation (GOOD_DEAL/PROCEED/EXPENSIVE/VERY_EXPENSIVE)', 'Live exchange rates used for calculation'],
      freeEndpoints: [
        { path: '/api/route/exchanges', description: 'List all 5 exchanges with supported coins and fees' },
        { path: '/api/route/fees', description: 'Full fee comparison table (add ?coin=KAIA to filter)' },
        { path: '/api/route/pairs', description: 'All trading pairs with live Binance prices' },
        { path: '/api/route/status', description: 'Exchange API health check' },
      ],
      paidEndpoint: { path: '/api/premium/route/find', price: '$0.10', description: 'Full route analysis with step-by-step execution plan' },
      examples: {
        cheapestKoreaToGlobal: 'curl "https://crossfin.dev/api/premium/route/find?from=bithumb:KRW&to=binance:USDC&amount=1000000&strategy=cheapest"',
        fastestGlobalToKorea: 'curl "https://crossfin.dev/api/premium/route/find?from=binance:USDC&to=coinone:KRW&amount=500&strategy=fastest"',
        freeExchanges: 'curl https://crossfin.dev/api/route/exchanges',
        freeFees: 'curl "https://crossfin.dev/api/route/fees?coin=KAIA"',
      },
    },
    acpProtocol: {
      overview: 'Agentic Commerce Protocol (ACP) — standardized quote/execute flow for agent-to-agent commerce. CrossFin ACP lets agents request routing quotes and simulate execution without x402 payment.',
      endpoints: [
        { method: 'POST', path: '/api/acp/quote', price: 'Free', description: 'Request a routing quote. Returns preview of optimal route (no step-by-step details). For full analysis, upgrade to /api/premium/route/find ($0.10).' },
        { method: 'POST', path: '/api/acp/execute', price: 'Free', description: 'Execute a route (simulation mode). Actual execution requires exchange API credentials (coming soon).' },
        { method: 'GET', path: '/api/acp/status', price: 'Free', description: 'ACP protocol capabilities, supported exchanges, bridge coins, and execution mode.' },
      ],
      quoteRequestExample: {
        method: 'POST',
        url: 'https://crossfin.dev/api/acp/quote',
        body: { from_exchange: 'bithumb', from_currency: 'KRW', to_exchange: 'binance', to_currency: 'USDC', amount: 1000000, strategy: 'cheapest' },
      },
      compatibleWith: ['locus', 'x402', 'openai-acp'],
      executionMode: 'simulation',
      liveExecution: 'coming_soon — requires exchange API key integration',
    },
    useCases: [
      {
        name: 'Daily Market Brief Agent',
        description: 'Agent that sends a daily summary of Korean markets to a Slack/Discord channel.',
        flow: '1. Call /api/premium/morning/brief ($0.20) for full market overview. 2. Parse kimchi premium, KOSPI, FX rate, headlines. 3. Format and post to channel.',
        cost: '$0.20/day',
      },
      {
        name: 'Kimchi Premium Monitor',
        description: 'Agent that monitors kimchi premium and alerts when arbitrage opportunity appears.',
        flow: '1. Poll /api/premium/arbitrage/opportunities ($0.10) every 15 minutes. 2. When signal=EXECUTE, call /api/premium/route/find ($0.10) for optimal route. 3. Alert user with route details.',
        cost: '~$10/day (polling every 15m)',
      },
      {
        name: 'Korean Stock Researcher',
        description: 'Agent that researches a Korean stock for investment analysis.',
        flow: '1. Call /api/premium/market/korea/stock-brief?stock=005930 ($0.10) for Samsung. 2. Get fundamentals, news, investor flow, disclosures in one call. 3. Combine with /api/premium/market/korea/themes ($0.05) for sector context.',
        cost: '$0.15 per stock',
      },
      {
        name: 'Cross-Exchange Arbitrage Bot',
        description: 'Agent that finds the best exchange to buy/sell crypto across Korean exchanges.',
        flow: '1. Call /api/premium/crypto/korea/5exchange?coin=BTC ($0.08) to compare prices. 2. If spread > threshold, call /api/premium/route/find ($0.10) for transfer route. 3. Execute trade manually or via API.',
        cost: '$0.18 per check',
      },
    ],
    x402Payment: {
      protocol: 'x402 (HTTP 402 Payment Required)',
      network: 'Base mainnet (eip155:8453)',
      currency: 'USDC',
      facilitator: 'Coinbase x402 facilitator',
      flow: [
        '1. Send GET request to paid endpoint',
        '2. Receive HTTP 402 with PAYMENT-REQUIRED header containing payment details (base64 JSON)',
        '3. Parse payment details (amount, recipient, network)',
        '4. Sign USDC transfer with your wallet',
        '5. Resend request with PAYMENT-SIGNATURE header',
        '6. Receive paid response (HTTP 200)',
      ],
      libraries: {
        javascript: '@x402/fetch (wrapFetchWithPayment)',
        python: 'x402 (pip install x402)',
      },
      walletRequirement: 'You need a wallet with USDC on Base mainnet. Minimum $0.01 for cheapest endpoint.',
      codeExamples: {
        curl: "# Free endpoint (no payment)\ncurl https://crossfin.dev/api/arbitrage/demo\n\n# Inspect PAYMENT-REQUIRED header (paid endpoint)\ncurl -s -D - https://crossfin.dev/api/premium/arbitrage/kimchi -o /dev/null",
        javascript: "import { x402Client, wrapFetchWithPayment } from '@x402/fetch';\nimport { registerExactEvmScheme } from '@x402/evm/exact/client';\nimport { privateKeyToAccount } from 'viem/accounts';\n\nconst signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);\nconst client = new x402Client();\nregisterExactEvmScheme(client, { signer });\n\nconst paidFetch = wrapFetchWithPayment(fetch, client);\nconst res = await paidFetch('https://crossfin.dev/api/premium/arbitrage/kimchi', { method: 'GET' });\nconsole.log(await res.json());",
        python: "import os\nfrom eth_account import Account\nfrom x402 import x402ClientSync\nfrom x402.http.clients import x402_requests\nfrom x402.mechanisms.evm import EthAccountSigner\nfrom x402.mechanisms.evm.exact.register import register_exact_evm_client\n\nclient = x402ClientSync()\naccount = Account.from_key(os.environ['EVM_PRIVATE_KEY'])\nregister_exact_evm_client(client, EthAccountSigner(account))\n\nwith x402_requests(client) as session:\n    r = session.get('https://crossfin.dev/api/premium/arbitrage/kimchi')\n    print(r.json())",
      },
    },
    mcpServer: {
      description: 'CrossFin MCP server for Claude Desktop and other MCP clients.',
      npmPackage: 'crossfin-mcp',
      install: 'npx -y crossfin-mcp',
      globalInstall: 'npm i -g crossfin-mcp && crossfin-mcp',
      localBuild: 'cd apps/mcp-server && npm install && npm run build',
      notes: [
        'MCP servers are typically launched by the client (Claude Desktop, Cursor, etc). You usually do not run the stdio server directly in a terminal.',
        'Set EVM_PRIVATE_KEY to enable paid calls; leave it unset if you only want free browsing/search tools.',
      ],
      tools: [
        { name: 'search_services', description: 'Search the service registry by keyword' },
        { name: 'list_services', description: 'List services with optional category filter' },
        { name: 'get_service', description: 'Get details for a specific service' },
        { name: 'list_categories', description: 'List all categories with counts' },
        { name: 'get_kimchi_premium', description: 'Free kimchi premium preview' },
        { name: 'get_analytics', description: 'Gateway usage analytics' },
        { name: 'get_guide', description: 'Get the full CrossFin agent guide' },
        { name: 'create_wallet', description: 'Create a wallet in local ledger' },
        { name: 'get_balance', description: 'Check wallet balance' },
        { name: 'transfer', description: 'Transfer funds between wallets' },
        { name: 'list_transactions', description: 'List recent transactions' },
        { name: 'set_budget', description: 'Set daily spend limit' },
        { name: 'call_paid_service', description: 'Call a paid API with automatic x402 USDC payment (returns data + txHash + basescan link)' },
        { name: 'find_optimal_route', description: 'Find optimal crypto transfer route across 5 exchanges using 11 bridge coins (routing engine)' },
        { name: 'list_exchange_fees', description: 'List supported exchange fees — trading and withdrawal fees for all exchanges (routing engine)' },
        { name: 'compare_exchange_prices', description: 'Compare live exchange prices for routing across 5 exchanges (routing engine)' },
      ],
      claudeDesktopConfig: {
        mcpServers: {
          crossfin: {
            command: 'npx',
            args: ['-y', 'crossfin-mcp'],
            env: {
              CROSSFIN_API_URL: 'https://crossfin.dev',
              EVM_PRIVATE_KEY: '0x...',
            },
          },
        },
      },
      claudeDesktopConfigLocalBuild: {
        mcpServers: {
          crossfin: {
            command: 'node',
            args: ['/path/to/crossfin/apps/mcp-server/dist/index.js'],
            env: {
              CROSSFIN_API_URL: 'https://crossfin.dev',
              EVM_PRIVATE_KEY: '0x...',
            },
          },
        },
      },
    },
    links: {
      website: 'https://crossfin.dev',
      liveDemo: 'https://live.crossfin.dev',
      github: 'https://github.com/bubilife1202/crossfin',
      openapi: 'https://crossfin.dev/api/openapi.json',
    },
  })
})

app.get('/.well-known/crossfin.json', (c) => {
  const origin = new URL(c.req.url).origin
  return c.json({
    name: 'CrossFin',
    version: CROSSFIN_API_VERSION,
    description: 'Agent-first directory and gateway for x402 services and Korean market data.',
    urls: {
      website: 'https://crossfin.dev',
      origin,
      openapi: `${origin}/api/openapi.json`,
      guide: `${origin}/api/docs/guide`,
      registry: `${origin}/api/registry`,
      registrySearch: `${origin}/api/registry/search?q=`,
    },
    payment: {
      protocol: 'x402',
      network: 'eip155:8453',
      currency: 'USDC',
      note: 'Paid endpoints respond with HTTP 402 and a PAYMENT-REQUIRED header (base64 JSON).',
    },
    mcp: {
      name: 'crossfin',
      package: 'crossfin-mcp',
      run: 'npx -y crossfin-mcp',
      repo: 'https://github.com/bubilife1202/crossfin/tree/main/apps/mcp-server',
      env: { CROSSFIN_API_URL: origin },
      tools: CROSSFIN_MCP_TOOLS,
    },
    updatedAt: new Date().toISOString(),
  })
})

// === OpenAPI Spec ===

app.get('/api/openapi.json', (c) => {
  return c.json({
    openapi: '3.1.0',
    info: {
      title: 'CrossFin — x402 Agent Services Gateway (Korea)',
      version: CROSSFIN_API_VERSION,
      description: 'Service registry + pay-per-request APIs for AI agents. Discover x402 services and access Korean market data. Payments via x402 protocol with USDC on Base mainnet.',
      contact: { url: 'https://crossfin.dev' },
      'x-logo': { url: 'https://crossfin.dev/logos/crossfin.png' },
    },
    servers: [{ url: 'https://crossfin.dev', description: 'Production' }],
    paths: {
      '/api/health': {
        get: {
          operationId: 'healthCheck',
          summary: 'Health check',
          tags: ['Free'],
          responses: { '200': { description: 'API status', content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, version: { type: 'string' }, status: { type: 'string' } } } } } } },
        },
      },
      '/api/docs/guide': {
        get: {
          operationId: 'agentGuide',
          summary: 'CrossFin agent onboarding guide',
          description: 'Structured JSON guide for AI agents: how to search services, pricing, x402 payment flow, and MCP usage.',
          tags: ['Free'],
          responses: {
            '200': {
              description: 'Agent guide (JSON)',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/.well-known/crossfin.json': {
        get: {
          operationId: 'crossfinWellKnown',
          summary: 'CrossFin discovery metadata',
          description: 'Well-known discovery endpoint for agents to find CrossFin registry + OpenAPI + guide links.',
          tags: ['Free'],
          responses: {
            '200': {
              description: 'Discovery metadata (JSON)',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/api/arbitrage/demo': {
        get: {
          operationId: 'arbitrageDemo',
          summary: 'Free Kimchi Premium preview (top 3 pairs)',
          description: 'Free preview of the Kimchi Premium index. Shows top 3 pairs by premium percentage. No payment required.',
          tags: ['Free'],
          responses: {
            '200': {
              description: 'Preview of kimchi premium data',
              content: { 'application/json': { schema: { type: 'object', properties: {
                demo: { type: 'boolean' },
                note: { type: 'string' },
                paidEndpoint: { type: 'string' },
                pairsShown: { type: 'integer' },
                totalPairsAvailable: { type: 'integer' },
                krwUsdRate: { type: 'number' },
                preview: { type: 'array', items: { type: 'object', properties: {
                  coin: { type: 'string' },
                  premiumPct: { type: 'number' },
                  direction: { type: 'string' },
                  decision: { type: 'object', properties: { action: { type: 'string' }, confidence: { type: 'number' }, reason: { type: 'string' } } },
                } } },
                avgPremiumPct: { type: 'number' },
                executeCandidates: { type: 'integer' },
                marketCondition: { type: 'string' },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
          },
        },
      },
      '/api/onchain/usdc-transfers': {
        get: {
          operationId: 'usdcTransfers',
          summary: 'Recent on-chain USDC transfers to CrossFin wallet (Base)',
          description: 'Returns recent USDC Transfer events to the CrossFin payment receiver on Base mainnet. Used by live.crossfin.dev to render the on-chain payment feed.',
          tags: ['Free'],
          parameters: [
            { name: 'limit', in: 'query', description: 'Max transfers to return (1..20). Default 10.', schema: { type: 'integer', default: 10, maximum: 20 } },
          ],
          responses: {
            '200': {
              description: 'USDC transfers',
              content: { 'application/json': { schema: { type: 'object', properties: {
                wallet: { type: 'string' },
                contract: { type: 'string' },
                token: { type: 'object', properties: { symbol: { type: 'string' }, decimals: { type: 'integer' } } },
                transfers: { type: 'array', items: { type: 'object', properties: {
                  hash: { type: 'string' },
                  from: { type: 'string' },
                  to: { type: 'string' },
                  value: { type: 'string' },
                  tokenDecimal: { type: 'string' },
                  timeStamp: { type: 'string' },
                } } },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
          },
        },
      },
      '/api/premium/arbitrage/kimchi': {
        get: {
          operationId: 'kimchiPremium',
          summary: 'Full Kimchi Premium Index — $0.05 USDC',
          description: 'Real-time price spread between Korean exchange (Bithumb) and global exchanges for 10+ crypto pairs. Includes premium percentage, volume, 24h change for each pair. Payment: $0.05 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Full kimchi premium data for all tracked pairs',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                krwUsdRate: { type: 'number' },
                pairsTracked: { type: 'integer' },
                avgPremiumPct: { type: 'number' },
                topPremium: { type: 'object' },
                premiums: { type: 'array', items: { type: 'object', properties: {
                  coin: { type: 'string' }, bithumbKrw: { type: 'number' }, bithumbUsd: { type: 'number' },
                  binanceUsd: { type: 'number' }, premiumPct: { type: 'number' },
                  volume24hKrw: { type: 'number' }, volume24hUsd: { type: 'number' }, change24hPct: { type: 'number' },
                } } },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.05 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/arbitrage/kimchi/history': {
        get: {
          operationId: 'kimchiPremiumHistory',
          summary: 'Kimchi Premium History (hourly) — $0.05 USDC',
          description: 'Historical hourly snapshots of the Kimchi Premium data captured by CrossFin cron. Query by coin and time range. Payment: $0.05 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [
            { name: 'coin', in: 'query', description: 'Optional coin filter (e.g. BTC, ETH). Default: all', schema: { type: 'string' } },
            { name: 'hours', in: 'query', description: 'Lookback window in hours (default: 24, max: 168)', schema: { type: 'integer', default: 24, maximum: 168 } },
          ],
          responses: {
            '200': {
              description: 'Hourly kimchi premium snapshots',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                coin: { type: ['string', 'null'] },
                hours: { type: 'integer' },
                groupedBy: { type: 'string' },
                range: { type: 'object' },
                snapshots: { type: 'array', items: { type: 'object' } },
                count: { type: 'integer' },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.05 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/arbitrage/opportunities': {
        get: {
          operationId: 'arbitrageOpportunities',
          summary: 'Arbitrage Decision Service — $0.10 USDC',
          description: 'AI-ready arbitrage decision service for Korean vs global crypto exchanges. Returns actionable recommendations (EXECUTE/WAIT/SKIP) with slippage estimates, premium trends, transfer time risk, and confidence scores. Includes direction, estimated profit after fees (Bithumb 0.25% + Binance 0.10%), and market condition assessment. Payment: $0.10 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Arbitrage opportunities with decision layer',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                krwUsdRate: { type: 'number' },
                totalOpportunities: { type: 'integer' },
                profitableCount: { type: 'integer' },
                executeCandidates: { type: 'integer' },
                marketCondition: { type: 'string', enum: ['favorable', 'neutral', 'unfavorable'] },
                estimatedFeesNote: { type: 'string' },
                bestOpportunity: { type: 'object' },
                opportunities: { type: 'array', items: { type: 'object', properties: {
                  coin: { type: 'string' }, direction: { type: 'string' }, grossPremiumPct: { type: 'number' },
                  estimatedFeesPct: { type: 'number' }, netProfitPct: { type: 'number' },
                  profitPer10kUsd: { type: 'number' }, volume24hUsd: { type: 'number' },
                  riskScore: { type: 'string' }, profitable: { type: 'boolean' },
                  slippageEstimatePct: { type: 'number' }, transferTimeMin: { type: 'number' },
                  premiumTrend: { type: 'string', enum: ['rising', 'falling', 'stable'] },
                  action: { type: 'string', enum: ['EXECUTE', 'WAIT', 'SKIP'] },
                  confidence: { type: 'number' }, reason: { type: 'string' },
                } } },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.10 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/bithumb/orderbook': {
        get: {
          operationId: 'bithumbOrderbook',
          summary: 'Live Bithumb Orderbook — $0.02 USDC',
          description: 'Live orderbook depth from Bithumb (Korean exchange) for any trading pair. Top 30 bids and asks with spread calculation. Raw data from a market typically inaccessible to non-Korean users. Payment: $0.02 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [{ name: 'pair', in: 'query', description: 'Trading pair symbol (e.g. BTC, ETH, XRP)', schema: { type: 'string', default: 'BTC' } }],
          responses: {
            '200': {
              description: 'Orderbook depth data',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                pair: { type: 'string' },
                exchange: { type: 'string' },
                bestBidKrw: { type: 'number' }, bestAskKrw: { type: 'number' },
                spreadKrw: { type: 'number' }, spreadPct: { type: 'number' },
                bestBidUsd: { type: 'number' }, bestAskUsd: { type: 'number' },
                depth: { type: 'object', properties: {
                  bids: { type: 'array', items: { type: 'object', properties: { price: { type: 'string' }, quantity: { type: 'string' } } } },
                  asks: { type: 'array', items: { type: 'object', properties: { price: { type: 'string' }, quantity: { type: 'string' } } } },
                } },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.02 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/bithumb/volume-analysis': {
        get: {
          operationId: 'bithumbVolumeAnalysis',
          summary: 'Bithumb 24h Volume Analysis — $0.03 USDC',
          description: 'Bithumb-wide 24h volume analysis: total market volume, top coins by volume, volume concentration (top 5), volume-weighted change, and unusual volume detection. Payment: $0.03 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Volume analysis snapshot',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                totalVolume24hKrw: { type: 'number' },
                totalVolume24hUsd: { type: 'number' },
                totalCoins: { type: 'integer' },
                volumeConcentration: { type: 'object', properties: { top5Pct: { type: 'number' }, top5Coins: { type: 'array', items: { type: 'object' } } } },
                volumeWeightedChangePct: { type: 'number' },
                unusualVolume: { type: 'array', items: { type: 'object' } },
                topByVolume: { type: 'array', items: { type: 'object' } },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.03 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/korea': {
        get: {
          operationId: 'koreaMarketSentiment',
          summary: 'Korean Market Sentiment — $0.03 USDC',
          description: 'Korean crypto market sentiment from Bithumb. Top gainers, losers, volume leaders, total market volume, and overall market mood (bullish/bearish/neutral). Payment: $0.03 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Korean market sentiment data',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                exchange: { type: 'string' },
                totalCoins: { type: 'integer' },
                totalVolume24hUsd: { type: 'number' },
                avgChange24hPct: { type: 'number' },
                marketMood: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
                topGainers: { type: 'array', items: { type: 'object' } },
                topLosers: { type: 'array', items: { type: 'object' } },
                topVolume: { type: 'array', items: { type: 'object' } },
                krwUsdRate: { type: 'number' },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.03 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/fx/usdkrw': {
        get: {
          operationId: 'usdKrwRate',
          summary: 'USD/KRW Exchange Rate — $0.01 USDC',
          description: 'USD to KRW exchange rate used to convert Korean exchange prices into USD. Payment: $0.01 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': { description: 'FX rate', content: { 'application/json': { schema: { type: 'object' } } } },
            '402': { description: 'Payment required — $0.01 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/upbit/ticker': {
        get: {
          operationId: 'upbitTicker',
          summary: 'Upbit Ticker (KRW market) — $0.02 USDC',
          description: 'Upbit spot ticker for a given KRW market symbol (e.g., KRW-BTC). Payment: $0.02 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [{ name: 'market', in: 'query', description: 'Upbit market symbol (e.g. KRW-BTC)', schema: { type: 'string', default: 'KRW-BTC' } }],
          responses: {
            '200': { description: 'Ticker snapshot', content: { 'application/json': { schema: { type: 'object' } } } },
            '402': { description: 'Payment required — $0.02 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/upbit/orderbook': {
        get: {
          operationId: 'upbitOrderbook',
          summary: 'Upbit Orderbook (KRW market) — $0.02 USDC',
          description: 'Upbit orderbook snapshot for a given KRW market symbol (e.g., KRW-BTC). Payment: $0.02 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [{ name: 'market', in: 'query', description: 'Upbit market symbol (e.g. KRW-BTC)', schema: { type: 'string', default: 'KRW-BTC' } }],
          responses: {
            '200': { description: 'Orderbook snapshot', content: { 'application/json': { schema: { type: 'object' } } } },
            '402': { description: 'Payment required — $0.02 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/upbit/signals': {
        get: {
          operationId: 'upbitSignals',
          summary: 'Upbit Trading Signals (Momentum + Volume) — $0.05 USDC',
          description: 'Trading signals for major KRW markets on Upbit (KRW-BTC, KRW-ETH, KRW-XRP, KRW-SOL, KRW-DOGE, KRW-ADA). Includes momentum buckets, relative volume signals, volatility, and a combined bullish/bearish/neutral call. Payment: $0.05 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Signals snapshot',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                signals: { type: 'array', items: { type: 'object', properties: {
                  market: { type: 'string' },
                  priceKrw: { type: 'number' },
                  change24hPct: { type: 'number' },
                  volume24hKrw: { type: 'number' },
                  volatilityPct: { type: 'number' },
                  volumeSignal: { type: 'string', enum: ['high', 'normal', 'low'] },
                  momentum: { type: 'string', enum: ['strong-up', 'up', 'neutral', 'down', 'strong-down'] },
                  signal: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                } } },
                marketSummary: { type: 'object', properties: {
                  bullishCount: { type: 'integer' },
                  bearishCount: { type: 'integer' },
                  neutralCount: { type: 'integer' },
                  overallSentiment: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
                } },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.05 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/coinone/ticker': {
        get: {
          operationId: 'coinoneTicker',
          summary: 'Coinone Ticker (KRW market) — $0.02 USDC',
          description: 'Coinone spot ticker for a given currency symbol (e.g., BTC). Payment: $0.02 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [{ name: 'currency', in: 'query', description: 'Asset symbol (e.g. BTC, ETH)', schema: { type: 'string', default: 'BTC' } }],
          responses: {
            '200': { description: 'Ticker snapshot', content: { 'application/json': { schema: { type: 'object' } } } },
            '402': { description: 'Payment required — $0.02 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/cross-exchange': {
        get: {
          operationId: 'crossExchangeComparison',
          summary: 'Cross-Exchange Decision Service (Bithumb vs Upbit vs Coinone vs Binance)',
          description: 'Compare crypto prices across 4 exchanges with actionable recommendations. Returns per-coin best buy/sell exchange, spread analysis, and action signals (ARBITRAGE/HOLD/MONITOR). Shows kimchi premium per exchange and domestic arbitrage opportunities.',
          parameters: [{ name: 'coins', in: 'query', schema: { type: 'string' }, description: 'Comma-separated coins (default: BTC,ETH,XRP,DOGE,ADA,SOL)' }],
          tags: ['Premium — $0.08 USDC'],
          responses: {
            '200': { description: 'Cross-exchange comparison with decision signals', content: { 'application/json': { schema: { type: 'object', properties: {
              paid: { type: 'boolean' }, service: { type: 'string' },
              coinsCompared: { type: 'integer' }, krwUsdRate: { type: 'number' },
              arbitrageCandidateCount: { type: 'integer' },
              coins: { type: 'array', items: { type: 'object', properties: {
                coin: { type: 'string' }, bestBuyExchange: { type: 'string' }, bestSellExchange: { type: 'string' },
                spreadPct: { type: 'number' }, action: { type: 'string', enum: ['ARBITRAGE', 'HOLD', 'MONITOR'] },
              } } },
              at: { type: 'string', format: 'date-time' },
            } } } } },
            '402': { description: 'Payment required — $0.08 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/morning/brief': {
        get: {
          operationId: 'morningBrief',
          summary: 'Morning Brief bundle — $0.20 USDC',
          description: 'One-call daily market summary combining kimchi premium, USD/KRW FX rate, KOSPI/KOSDAQ indices, stock momentum, and Korean headlines. Payment: $0.20 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Morning brief bundle response',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      paid: { type: 'boolean' },
                      service: { type: 'string' },
                      kimchiPremium: { type: 'object', properties: {
                        avgPremiumPct: { type: 'number' },
                        topPair: { type: 'string' },
                        pairsTracked: { type: 'integer' },
                        premiums: { type: 'array', items: { type: 'object' } },
                      }, required: ['avgPremiumPct', 'topPair', 'pairsTracked', 'premiums'] },
                      fxRate: { type: 'object', properties: { usdKrw: { type: 'number' }, source: { type: 'string' } }, required: ['usdKrw', 'source'] },
                      indices: { type: 'object', properties: {
                        kospi: { type: 'object', properties: { price: { type: 'number' }, changePct: { type: 'number' }, volume: { type: 'number' }, status: { type: 'string' } }, required: ['price', 'changePct', 'volume', 'status'] },
                        kosdaq: { type: 'object', properties: { price: { type: 'number' }, changePct: { type: 'number' }, volume: { type: 'number' }, status: { type: 'string' } }, required: ['price', 'changePct', 'volume', 'status'] },
                      }, required: ['kospi', 'kosdaq'] },
                      momentum: { type: 'object', properties: {
                        topGainers: { type: 'array', items: { type: 'object' } },
                        topLosers: { type: 'array', items: { type: 'object' } },
                        market: { type: 'string' },
                      }, required: ['topGainers', 'topLosers', 'market'] },
                      headlines: { type: 'array', items: { type: 'object' } },
                      at: { type: 'string', format: 'date-time' },
                    },
                    required: ['paid', 'service', 'kimchiPremium', 'fxRate', 'indices', 'momentum', 'headlines', 'at'],
                  },
                },
              },
            },
            '402': { description: 'Payment required — $0.20 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/crypto/snapshot': {
        get: {
          operationId: 'cryptoSnapshot',
          summary: 'Crypto Snapshot bundle — $0.15 USDC',
          description: 'One-call crypto market overview combining 4-exchange BTC price comparison (Upbit/Bithumb/Coinone/GoPax), kimchi premium, Bithumb volume analysis, and USD/KRW FX rate. Payment: $0.15 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Crypto snapshot bundle response',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      paid: { type: 'boolean' },
                      service: { type: 'string' },
                      kimchiPremium: { type: 'object', properties: {
                        avgPremiumPct: { type: 'number' },
                        topPair: { type: 'string' },
                        pairsTracked: { type: 'integer' },
                        premiums: { type: 'array', items: { type: 'object' } },
                      }, required: ['avgPremiumPct', 'topPair', 'pairsTracked', 'premiums'] },
                      fxRate: { type: 'object', properties: { usdKrw: { type: 'number' } }, required: ['usdKrw'] },
                      exchanges: { type: 'object', properties: {
                        upbit: { type: ['object', 'null'], properties: { krw: { type: 'number' }, usd: { type: 'number' } }, required: ['krw', 'usd'] },
                        bithumb: { type: ['object', 'null'], properties: { krw: { type: 'number' }, usd: { type: 'number' } }, required: ['krw', 'usd'] },
                        coinone: { type: ['object', 'null'], properties: { krw: { type: 'number' }, usd: { type: 'number' } }, required: ['krw', 'usd'] },
                        gopax: { type: ['object', 'null'], properties: { krw: { type: 'number' }, usd: { type: 'number' } }, required: ['krw', 'usd'] },
                        spread: { type: 'object', properties: { minUsd: { type: 'number' }, maxUsd: { type: 'number' }, spreadPct: { type: 'number' } }, required: ['minUsd', 'maxUsd', 'spreadPct'] },
                      }, required: ['upbit', 'bithumb', 'coinone', 'gopax', 'spread'] },
                      volumeAnalysis: { type: 'object', properties: {
                        totalVolume24hKrw: { type: 'number' },
                        totalVolume24hUsd: { type: 'number' },
                        topByVolume: { type: 'array', items: { type: 'object' } },
                      }, required: ['totalVolume24hKrw', 'totalVolume24hUsd', 'topByVolume'] },
                      at: { type: 'string', format: 'date-time' },
                    },
                    required: ['paid', 'service', 'kimchiPremium', 'fxRate', 'exchanges', 'volumeAnalysis', 'at'],
                  },
                },
              },
            },
            '402': { description: 'Payment required — $0.15 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/kimchi/stats': {
        get: {
          operationId: 'kimchiStats',
          summary: 'Kimchi Stats bundle — $0.15 USDC',
          description: 'Comprehensive kimchi premium analysis combining current premiums, 24h trend from D1 snapshots, top arbitrage signal (EXECUTE/WAIT/SKIP), and cross-exchange BTC spread across Korean exchanges. Payment: $0.15 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Kimchi stats bundle response',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      paid: { type: 'boolean' },
                      service: { type: 'string' },
                      current: { type: 'object', properties: {
                        avgPremiumPct: { type: 'number' },
                        topPair: { type: 'object', properties: { coin: { type: 'string' }, premiumPct: { type: 'number' } }, required: ['coin', 'premiumPct'] },
                        bottomPair: { type: 'object', properties: { coin: { type: 'string' }, premiumPct: { type: 'number' } }, required: ['coin', 'premiumPct'] },
                        pairsTracked: { type: 'integer' },
                        premiums: { type: 'array', items: { type: 'object' } },
                      }, required: ['avgPremiumPct', 'topPair', 'bottomPair', 'pairsTracked', 'premiums'] },
                      trend: { type: 'object', properties: {
                        direction: { type: 'string', enum: ['rising', 'falling', 'stable'] },
                        current24hAvg: { type: 'number' },
                        previous24hAvg: { type: 'number' },
                        changePct: { type: 'number' },
                      }, required: ['direction', 'current24hAvg', 'previous24hAvg', 'changePct'] },
                      bestOpportunity: { type: 'object', properties: {
                        coin: { type: 'string' },
                        premiumPct: { type: 'number' },
                        action: { type: 'string', enum: ['EXECUTE', 'WAIT', 'SKIP'] },
                        confidence: { type: 'number' },
                        reason: { type: 'string' },
                      }, required: ['coin', 'premiumPct', 'action', 'confidence', 'reason'] },
                      crossExchangeSpread: { type: 'object', properties: {
                        coin: { type: 'string' },
                        upbitKrw: { type: ['number', 'null'] },
                        bithumbKrw: { type: ['number', 'null'] },
                        coinoneKrw: { type: ['number', 'null'] },
                        spreadPct: { type: 'number' },
                        bestBuy: { type: 'string' },
                        bestSell: { type: 'string' },
                      }, required: ['coin', 'upbitKrw', 'bithumbKrw', 'coinoneKrw', 'spreadPct', 'bestBuy', 'bestSell'] },
                      fxRate: { type: 'object', properties: { usdKrw: { type: 'number' } }, required: ['usdKrw'] },
                      at: { type: 'string', format: 'date-time' },
                    },
                    required: ['paid', 'service', 'current', 'trend', 'bestOpportunity', 'crossExchangeSpread', 'fxRate', 'at'],
                  },
                },
              },
            },
            '402': { description: 'Payment required — $0.15 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/korea/stock-brief': {
        get: {
          operationId: 'stockBrief',
          summary: 'Stock Brief bundle — $0.10 USDC',
          description: 'One-call comprehensive Korean stock analysis combining stock detail (PER/PBR/consensus/peers), recent news, investor flow (foreign/institutional/individual), and disclosure filings. Payment: $0.10 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [
            { name: 'stock', in: 'query', required: true, description: 'Korean stock code (6-digit number, e.g., 005930 for Samsung Electronics)', schema: { type: 'string', default: '005930' } },
          ],
          responses: {
            '200': {
              description: 'Stock brief bundle response',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                stock: { type: 'string' },
                name: { type: ['string', 'null'] },
                detail: { type: ['object', 'null'] },
                news: { type: 'array', items: { type: 'object' } },
                investorFlow: { type: ['object', 'null'] },
                disclosures: { type: 'array', items: { type: 'object' } },
                at: { type: 'string', format: 'date-time' },
              }, required: ['paid', 'service', 'stock', 'detail', 'news', 'investorFlow', 'disclosures', 'at'] } } },
            },
            '402': { description: 'Payment required — $0.10 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/news/korea/headlines': {
        get: {
          operationId: 'koreaHeadlines',
          summary: 'Korean Headlines (RSS) — $0.03 USDC',
          description: 'Top headlines feed for market context (Google News RSS). Payment: $0.03 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [{ name: 'limit', in: 'query', description: 'Max items (1-20)', schema: { type: 'integer', default: 10 } }],
          responses: {
            '200': { description: 'Headlines list', content: { 'application/json': { schema: { type: 'object' } } } },
            '402': { description: 'Payment required — $0.03 USDC on Base mainnet' },
          },
        },
      },

      '/api/premium/route/find': {
        get: {
          operationId: 'routeFindOptimal',
          summary: 'Optimal Route Finder — $0.10 USDC',
          description: 'Paid routing engine endpoint. Finds the optimal crypto transfer route across supported exchanges using bridge coin comparison, slippage estimates, and fee modeling. Payment: $0.10 USDC on Base via x402.',
          tags: ['Routing', 'Paid — x402'],
          parameters: [
            { name: 'from', in: 'query', required: true, description: 'Source (exchange:currency), e.g. bithumb:KRW', schema: { type: 'string' } },
            { name: 'to', in: 'query', required: true, description: 'Destination (exchange:currency), e.g. binance:USDC', schema: { type: 'string' } },
            { name: 'amount', in: 'query', required: true, description: 'Amount in source currency', schema: { type: 'number' } },
            { name: 'strategy', in: 'query', required: false, description: 'Routing strategy (default: cheapest)', schema: { type: 'string', default: 'cheapest' } },
          ],
          responses: {
            '200': { description: 'Optimal route', content: { 'application/json': { schema: { type: 'object' } } } },
            '400': { description: 'Invalid query parameters' },
            '402': { description: 'Payment required — $0.10 USDC on Base mainnet' },
          },
        },
      },

      '/api/route/exchanges': {
        get: {
          operationId: 'routeExchanges',
          summary: 'List supported exchanges',
          description: 'Free routing engine endpoint. Lists supported exchanges, fee profiles, and supported coins.',
          tags: ['Routing'],
          responses: {
            '200': { description: 'Supported exchanges', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },
      '/api/route/fees': {
        get: {
          operationId: 'routeFees',
          summary: 'Fee comparison table',
          description: 'Free routing engine endpoint. Returns a fee comparison table including trading + withdrawal fees.',
          tags: ['Routing'],
          parameters: [{ name: 'coin', in: 'query', required: false, description: 'Optional coin filter (e.g. BTC, ETH)', schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Fee comparison table', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },
      '/api/route/pairs': {
        get: {
          operationId: 'routePairs',
          summary: 'Supported pairs with live prices',
          description: 'Free routing engine endpoint. Lists supported trading pairs with live prices used by the routing engine.',
          tags: ['Routing'],
          responses: {
            '200': { description: 'Supported pairs', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },
      '/api/route/status': {
        get: {
          operationId: 'routeStatus',
          summary: 'Exchange API health check',
          description: 'Free routing engine endpoint. Exchange API health check (online/offline).',
          tags: ['Routing'],
          responses: {
            '200': { description: 'Exchange status', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },

      '/api/acp/quote': {
        post: {
          operationId: 'acpQuote',
          summary: 'Request routing quote (ACP-compatible)',
          description: 'ACP endpoint. Requests a routing quote compatible with OpenAI + Stripe style agent commerce flows.',
          tags: ['ACP'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    from_exchange: { type: 'string' },
                    from_currency: { type: 'string' },
                    to_exchange: { type: 'string' },
                    to_currency: { type: 'string' },
                    amount: { type: 'number' },
                    strategy: { type: 'string', default: 'cheapest' },
                  },
                  required: ['from_exchange', 'from_currency', 'to_exchange', 'to_currency', 'amount'],
                },
              },
            },
          },
          responses: {
            '200': { description: 'Routing quote', content: { 'application/json': { schema: { type: 'object' } } } },
            '400': { description: 'Invalid request body' },
          },
        },
      },
      '/api/acp/execute': {
        post: {
          operationId: 'acpExecute',
          summary: 'Execute route (simulation)',
          description: 'ACP endpoint. Executes a previously quoted route in simulation mode.',
          tags: ['ACP'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    quote_id: { type: 'string' },
                  },
                  required: ['quote_id'],
                },
              },
            },
          },
          responses: {
            '200': { description: 'Execution result (simulation)', content: { 'application/json': { schema: { type: 'object' } } } },
            '400': { description: 'Invalid request body' },
          },
        },
      },
      '/api/acp/status': {
        get: {
          operationId: 'acpStatus',
          summary: 'ACP protocol status',
          description: 'ACP endpoint. Returns protocol status and capabilities.',
          tags: ['ACP'],
          responses: {
            '200': { description: 'ACP status', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },

      '/api/registry': {
        get: {
          operationId: 'registryList',
          summary: 'Service registry list (free)',
          tags: ['Free'],
          parameters: [
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'provider', in: 'query', schema: { type: 'string' } },
            { name: 'isCrossfin', in: 'query', schema: { type: 'string', enum: ['true', 'false', '1', '0'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': { description: 'Registry list', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
        post: {
          operationId: 'registryCreate',
          summary: 'Register a service (requires X-Agent-Key)',
          tags: ['Free'],
          parameters: [{ name: 'X-Agent-Key', in: 'header', required: true, schema: { type: 'string' } }],
          responses: {
            '201': { description: 'Created', content: { 'application/json': { schema: { type: 'object' } } } },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/registry/search': {
        get: {
          operationId: 'registrySearch',
          summary: 'Search services (free)',
          tags: ['Free'],
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': { description: 'Search results', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },
      '/api/registry/categories': {
        get: {
          operationId: 'registryCategories',
          summary: 'List categories (free)',
          tags: ['Free'],
          responses: { '200': { description: 'Categories', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
      '/api/registry/stats': {
        get: {
          operationId: 'registryStats',
          summary: 'Registry stats (free)',
          tags: ['Free'],
          responses: { '200': { description: 'Stats', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
      '/api/registry/{id}': {
        get: {
          operationId: 'registryGet',
          summary: 'Registry service detail (free)',
          tags: ['Free'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Service detail', content: { 'application/json': { schema: { type: 'object' } } } }, '404': { description: 'Not found' } },
        },
      },

      '/api/proxy/{serviceId}': {
        get: {
          operationId: 'proxyGet',
          summary: 'Proxy GET to a registered service (requires X-Agent-Key)',
          description: 'Looks up the service by id in the registry and forwards the request to its endpoint, passing through query params. Logs the call to service_calls. Requires X-Agent-Key to prevent public abuse.',
          tags: ['Free'],
          parameters: [
            { name: 'serviceId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'X-Agent-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Upstream response (passthrough)',
              headers: {
                'X-CrossFin-Proxy': { schema: { type: 'string', enum: ['true'] } },
                'X-CrossFin-Fee': { schema: { type: 'string', enum: ['5%'] } },
              },
              content: { '*/*': { schema: {} } },
            },
            '404': { description: 'Service not found' },
            '405': { description: 'Method not allowed' },
            '429': { description: 'Rate limited' },
            '502': { description: 'Upstream request failed' },
          },
        },
        post: {
          operationId: 'proxyPost',
          summary: 'Proxy POST to a registered service (requires X-Agent-Key)',
          description: 'Looks up the service by id in the registry and forwards the request to its endpoint, passing through query params and request body. Logs the call to service_calls. Requires X-Agent-Key to prevent public abuse.',
          tags: ['Free'],
          parameters: [
            { name: 'serviceId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'X-Agent-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          requestBody: { required: false, content: { '*/*': { schema: {} } } },
          responses: {
            '200': {
              description: 'Upstream response (passthrough)',
              headers: {
                'X-CrossFin-Proxy': { schema: { type: 'string', enum: ['true'] } },
                'X-CrossFin-Fee': { schema: { type: 'string', enum: ['5%'] } },
              },
              content: { '*/*': { schema: {} } },
            },
            '404': { description: 'Service not found' },
            '405': { description: 'Method not allowed' },
            '413': { description: 'Payload too large' },
            '429': { description: 'Rate limited' },
            '502': { description: 'Upstream request failed' },
          },
        },
      },

      '/api/analytics/overview': {
        get: {
          operationId: 'analyticsOverview',
          summary: 'Analytics overview (free)',
          tags: ['Free'],
          responses: { '200': { description: 'Overview stats', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },

      '/api/analytics/services/{serviceId}': {
        get: {
          operationId: 'analyticsService',
          summary: 'Analytics per service (free)',
          tags: ['Free'],
          parameters: [{ name: 'serviceId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Service stats', content: { 'application/json': { schema: { type: 'object' } } } },
            '404': { description: 'Service not found' },
          },
        },
      },

      '/api/analytics/funnel/overview': {
        get: {
          operationId: 'analyticsFunnelOverview',
          summary: 'Web conversion funnel overview (free)',
          tags: ['Free'],
          responses: { '200': { description: 'Funnel stats', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },

      '/api/analytics/funnel/events': {
        post: {
          operationId: 'analyticsFunnelTrack',
          summary: 'Track web conversion event (free)',
          tags: ['Free'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    eventName: { type: 'string', enum: [...FUNNEL_EVENT_NAMES] },
                    source: { type: 'string' },
                    metadata: { type: 'object' },
                  },
                  required: ['eventName'],
                },
              },
            },
          },
          responses: {
            '202': { description: 'Accepted' },
            '400': { description: 'Invalid request body' },
            '429': { description: 'Rate limited' },
          },
        },
      },
    },
    'x-x402': {
      network: 'eip155:8453',
      networkName: 'Base',
      asset: 'USDC',
      payTo: '0xe4E79Ce6a1377C58f0Bb99D023908858A4DB5779',
      facilitator: 'https://facilitator.payai.network',
      pricing: CROSSFIN_PAID_PRICING,
    },
  })
})

app.use(
  '/api/premium/*',
  async (c, next) => {
    const network = requireCaip2(c.env.X402_NETWORK)
    const facilitatorClient = new HTTPFacilitatorClient({ url: c.env.FACILITATOR_URL })
    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register(network, new ExactEvmScheme())
      .registerExtension(bazaarResourceServerExtension)

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
          description: 'CrossFin premium report — lightweight health/status check for agents verifying the x402 payment flow.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-premium-report', message: 'Payment verified', paidAt: '2026-02-16T00:00:00.000Z' },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, message: { type: 'string' } }, required: ['paid', 'service'] },
              },
            }),
          },
        },
        'GET /api/premium/enterprise': {
          accepts: {
            scheme: 'exact',
            price: '$20.00',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'CrossFin enterprise receipt — full settlement proof for institutional agents. High-value endpoint for compliance and audit trails.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-enterprise', receipt: { amount: '$20.00', network: 'eip155:8453', settledAt: '2026-02-16T00:00:00.000Z' } },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, receipt: { type: 'object' } }, required: ['paid', 'service', 'receipt'] },
              },
            }),
          },
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
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-kimchi-premium', krwUsdRate: 1450, pairsTracked: 10, avgPremiumPct: 2.15, premiums: [{ coin: 'BTC', bithumbKrw: 145000000, bithumbUsd: 100000, binanceUsd: 97850, premiumPct: 2.2, volume24hUsd: 5000000 }] },
                schema: { properties: { paid: { type: 'boolean' }, pairsTracked: { type: 'number' }, avgPremiumPct: { type: 'number' }, premiums: { type: 'array' } }, required: ['paid', 'pairsTracked', 'avgPremiumPct', 'premiums'] },
              },
            }),
          },
        },
        'GET /api/premium/arbitrage/kimchi/history': {
          accepts: {
            scheme: 'exact',
            price: '$0.05',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Historical Kimchi Premium snapshots grouped by hour (from CrossFin cron). Query by coin and lookback hours.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { hours: 24, coin: 'BTC' },
              inputSchema: {
                properties: {
                  hours: { type: 'number', description: 'Lookback window in hours (1-168)' },
                  coin: { type: 'string', description: 'Optional coin filter (e.g., BTC, ETH)' },
                },
              },
              output: {
                example: { paid: true, service: 'crossfin-kimchi-premium-history', hours: 24, groupedBy: 'hour', snapshots: [{ coin: 'BTC', premiumPct: 2.2, hour: '2026-02-15T03:00:00Z' }], count: 1 },
                schema: { properties: { paid: { type: 'boolean' }, hours: { type: 'number' }, groupedBy: { type: 'string' }, snapshots: { type: 'array' }, count: { type: 'number' } }, required: ['paid', 'hours', 'groupedBy', 'snapshots', 'count'] },
              },
            }),
          },
        },
        'GET /api/premium/arbitrage/opportunities': {
          accepts: {
            scheme: 'exact',
            price: '$0.10',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'AI-ready arbitrage decision service. Returns EXECUTE/WAIT/SKIP recommendations with slippage estimates, premium trends, transfer time risk, and confidence scores for Korean vs global exchange arbitrage.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-arbitrage-opportunities', totalOpportunities: 10, profitableCount: 3, executeCandidates: 2, marketCondition: 'favorable', bestOpportunity: { coin: 'BTC', direction: 'buy-global-sell-korea', netProfitPct: 1.85, action: 'EXECUTE', confidence: 0.87 }, opportunities: [] },
                schema: { properties: { paid: { type: 'boolean' }, totalOpportunities: { type: 'number' }, profitableCount: { type: 'number' }, executeCandidates: { type: 'number' }, marketCondition: { type: 'string' }, opportunities: { type: 'array' } }, required: ['paid', 'totalOpportunities', 'profitableCount', 'executeCandidates', 'marketCondition', 'opportunities'] },
              },
            }),
          },
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
          extensions: {
            ...declareDiscoveryExtension({
              input: { pair: 'BTC' },
              inputSchema: { properties: { pair: { type: 'string', description: 'Trading pair symbol (BTC, ETH, XRP, etc.)' } } },
              output: {
                example: { paid: true, service: 'crossfin-bithumb-orderbook', pair: 'BTC/KRW', exchange: 'Bithumb', bestBidKrw: 144900000, bestAskKrw: 145000000, spreadPct: 0.07, depth: { bids: [], asks: [] } },
                schema: { properties: { paid: { type: 'boolean' }, pair: { type: 'string' }, bestBidKrw: { type: 'number' }, bestAskKrw: { type: 'number' }, spreadPct: { type: 'number' } }, required: ['paid', 'pair', 'bestBidKrw', 'bestAskKrw'] },
              },
            }),
          },
        },
        'GET /api/premium/bithumb/volume-analysis': {
          accepts: {
            scheme: 'exact',
            price: '$0.03',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Bithumb 24h volume analysis: total market volume, volume concentration, volume-weighted change, and unusual volume detection (2x+ average).',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-bithumb-volume', totalVolume24hKrw: 1234567890, totalVolume24hUsd: 850000, totalCoins: 200, volumeConcentration: { top5Pct: 62.5, top5Coins: [{ coin: 'BTC', volume24hKrw: 400000000, volumeSharePct: 32.4 }] }, volumeWeightedChangePct: 0.75, unusualVolume: [], topByVolume: [], at: '2026-02-15T00:00:00.000Z' },
                schema: {
                  properties: {
                    paid: { type: 'boolean' },
                    service: { type: 'string' },
                    totalVolume24hKrw: { type: 'number' },
                    totalVolume24hUsd: { type: 'number' },
                    totalCoins: { type: 'number' },
                    volumeConcentration: { type: 'object' },
                    volumeWeightedChangePct: { type: 'number' },
                    unusualVolume: { type: 'array' },
                    topByVolume: { type: 'array' },
                    at: { type: 'string' },
                  },
                  required: ['paid', 'service', 'totalVolume24hKrw', 'totalVolume24hUsd', 'totalCoins', 'volumeConcentration', 'volumeWeightedChangePct', 'unusualVolume', 'topByVolume', 'at'],
                },
              },
            }),
          },
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
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-korea-sentiment', exchange: 'Bithumb', totalCoins: 200, totalVolume24hUsd: 500000000, marketMood: 'neutral', topGainers: [], topLosers: [], topVolume: [] },
                schema: { properties: { paid: { type: 'boolean' }, totalCoins: { type: 'number' }, totalVolume24hUsd: { type: 'number' }, marketMood: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] } }, required: ['paid', 'totalCoins', 'marketMood'] },
              },
            }),
          },
        },
        'GET /api/premium/market/fx/usdkrw': {
          accepts: {
            scheme: 'exact',
            price: '$0.01',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Real-time USD/KRW exchange rate from Korean FX markets. Essential for converting Korean Won prices to USD for arbitrage calculations.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-fx-usdkrw', rate: 1450.25, source: 'exchangerate-api', at: '2026-02-16T00:00:00.000Z' },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, rate: { type: 'number' }, source: { type: 'string' } }, required: ['paid', 'rate'] },
              },
            }),
          },
        },
        'GET /api/premium/market/upbit/ticker': {
          accepts: {
            scheme: 'exact',
            price: '$0.02',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Upbit spot ticker (KRW market).',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { market: 'KRW-BTC' },
              inputSchema: { properties: { market: { type: 'string', description: 'Upbit market symbol (e.g., KRW-BTC, KRW-ETH)' } } },
              output: {
                example: { paid: true, service: 'crossfin-upbit-ticker', market: 'KRW-BTC', tradePriceKrw: 100000000, tradePriceUsd: 68900, change24hPct: 1.25 },
                schema: { properties: { paid: { type: 'boolean' }, market: { type: 'string' }, tradePriceKrw: { type: 'number' }, tradePriceUsd: { type: 'number' } }, required: ['paid', 'market', 'tradePriceKrw'] },
              },
            }),
          },
        },
        'GET /api/premium/market/upbit/orderbook': {
          accepts: {
            scheme: 'exact',
            price: '$0.02',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Upbit orderbook snapshot (KRW market).',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { market: 'KRW-BTC' },
              inputSchema: { properties: { market: { type: 'string', description: 'Upbit market symbol (e.g., KRW-BTC, KRW-ETH)' } } },
              output: {
                example: { paid: true, service: 'crossfin-upbit-orderbook', market: 'KRW-BTC', bestBidKrw: 99990000, bestAskKrw: 100000000, spreadPct: 0.01 },
                schema: { properties: { paid: { type: 'boolean' }, market: { type: 'string' }, bestBidKrw: { type: 'number' }, bestAskKrw: { type: 'number' }, spreadPct: { type: 'number' } }, required: ['paid', 'market', 'bestBidKrw', 'bestAskKrw'] },
              },
            }),
          },
        },
        'GET /api/premium/market/upbit/signals': {
          accepts: {
            scheme: 'exact',
            price: '$0.05',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Upbit trading signals with momentum, relative volume signal, and volatility for KRW-BTC, KRW-ETH, KRW-XRP, KRW-SOL, KRW-DOGE, KRW-ADA.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-upbit-signals', signals: [{ market: 'KRW-BTC', priceKrw: 100000000, change24hPct: 1.25, volume24hKrw: 5000000000, volatilityPct: 2.1, volumeSignal: 'high', momentum: 'up', signal: 'bullish', confidence: 'medium' }], marketSummary: { bullishCount: 2, bearishCount: 1, neutralCount: 3, overallSentiment: 'neutral' }, at: '2026-02-15T00:00:00.000Z' },
                schema: {
                  properties: {
                    paid: { type: 'boolean' },
                    service: { type: 'string' },
                    signals: { type: 'array' },
                    marketSummary: { type: 'object' },
                    at: { type: 'string' },
                  },
                  required: ['paid', 'service', 'signals', 'marketSummary', 'at'],
                },
              },
            }),
          },
        },
        'GET /api/premium/market/coinone/ticker': {
          accepts: {
            scheme: 'exact',
            price: '$0.02',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Coinone spot ticker (KRW market).',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { currency: 'BTC' },
              inputSchema: { properties: { currency: { type: 'string', description: 'Asset symbol (e.g., BTC, ETH, XRP)' } } },
              output: {
                example: { paid: true, service: 'crossfin-coinone-ticker', currency: 'BTC', lastKrw: 100000000, lastUsd: 68900 },
                schema: { properties: { paid: { type: 'boolean' }, currency: { type: 'string' }, lastKrw: { type: 'number' }, lastUsd: { type: 'number' } }, required: ['paid', 'currency', 'lastKrw'] },
              },
            }),
          },
        },
        'GET /api/premium/market/cross-exchange': {
          accepts: {
            scheme: 'exact',
            price: '$0.08',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Cross-exchange decision service. Compares prices across Bithumb, Upbit, Coinone, and Binance with ARBITRAGE/HOLD/MONITOR signals, best buy/sell exchange per coin, and spread analysis.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-cross-exchange', coinsAnalyzed: 10, signals: [{ coin: 'BTC', action: 'ARBITRAGE', bestBuy: 'Binance', bestSell: 'Bithumb', spreadPct: 2.1, confidence: 0.85 }], overallCondition: 'favorable' },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, coinsAnalyzed: { type: 'number' }, signals: { type: 'array' }, overallCondition: { type: 'string' } }, required: ['paid', 'coinsAnalyzed', 'signals'] },
              },
            }),
          },
        },
        'GET /api/premium/market/korea/indices': {
          accepts: {
            scheme: 'exact',
            price: '$0.03',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Real-time KOSPI and KOSDAQ Korean stock market indices. Includes price, change, direction, and market status. Data from Naver Finance — unavailable via standard global APIs.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-korea-indices', kospi: { code: 'KOSPI', price: 2650.25, change: 15.3, changePct: 0.58, direction: 'RISING', marketStatus: 'CLOSE' }, kosdaq: { code: 'KOSDAQ', price: 870.15, change: -3.2, changePct: -0.37, direction: 'FALLING', marketStatus: 'CLOSE' }, source: 'naver-finance' },
                schema: { properties: { paid: { type: 'boolean' }, kospi: { type: 'object' }, kosdaq: { type: 'object' }, source: { type: 'string' } }, required: ['paid', 'kospi', 'kosdaq'] },
              },
            }),
          },
        },
        'GET /api/premium/market/korea/indices/history': {
          accepts: {
            scheme: 'exact',
            price: '$0.05',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Historical KOSPI or KOSDAQ daily OHLC data (up to 60 trading days). Open, high, low, close, change, direction per day.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { index: 'KOSPI', days: 20 },
              inputSchema: {
                properties: {
                  index: { type: 'string', description: 'KOSPI or KOSDAQ' },
                  days: { type: 'number', description: 'Number of trading days (1-60, default 20)' },
                },
              },
              output: {
                example: { paid: true, service: 'crossfin-korea-indices-history', index: 'KOSPI', days: 20, history: [{ date: '2026-02-14', open: 2640.5, high: 2665.3, low: 2635.1, close: 2650.25, change: 15.3, changePct: 0.58 }], source: 'naver-finance' },
                schema: { properties: { paid: { type: 'boolean' }, index: { type: 'string' }, days: { type: 'number' }, history: { type: 'array' } }, required: ['paid', 'index', 'days', 'history'] },
              },
            }),
          },
        },
        'GET /api/premium/market/korea/stocks/momentum': {
          accepts: {
            scheme: 'exact',
            price: '$0.05',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Korean stock market momentum — top 10 by market cap (Samsung, SK Hynix, etc.), top 5 gainers, top 5 losers on KOSPI or KOSDAQ. Real-time rankings from Naver Finance.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { market: 'KOSPI' },
              inputSchema: { properties: { market: { type: 'string', description: 'KOSPI or KOSDAQ' } } },
              output: {
                example: { paid: true, service: 'crossfin-korea-stocks-momentum', market: 'KOSPI', topMarketCap: [{ code: '005930', name: 'Samsung Electronics', price: 72000, changePct: 1.5, direction: 'RISING' }], topGainers: [], topLosers: [], source: 'naver-finance' },
                schema: { properties: { paid: { type: 'boolean' }, market: { type: 'string' }, topMarketCap: { type: 'array' }, topGainers: { type: 'array' }, topLosers: { type: 'array' } }, required: ['paid', 'market', 'topMarketCap', 'topGainers', 'topLosers'] },
              },
            }),
          },
        },
        'GET /api/premium/market/korea/investor-flow': {
          accepts: { scheme: 'exact', price: '$0.05', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Korean stock investor flow — 10-day history of foreign, institutional, and individual net buying for any KOSPI/KOSDAQ stock. Data unavailable outside Bloomberg Terminal ($24K/yr).',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { stock: '005930' },
              inputSchema: { properties: { stock: { type: 'string', description: '6-digit Korean stock code (e.g., 005930 for Samsung Electronics)' } } },
              output: {
                example: { paid: true, service: 'crossfin-korea-investor-flow', stock: '005930', days: 10, flow: [{ date: '20260213', foreignNetBuy: '-4,715,928', foreignHoldRatio: '51.44%', institutionNetBuy: '+556,164', individualNetBuy: '+3,099,928', closePrice: '181,200' }] },
                schema: { properties: { paid: { type: 'boolean' }, stock: { type: 'string' }, days: { type: 'number' }, flow: { type: 'array' } }, required: ['paid', 'stock', 'days', 'flow'] },
              },
            }),
          },
        },
        'GET /api/premium/market/korea/index-flow': {
          accepts: { scheme: 'exact', price: '$0.03', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'KOSPI/KOSDAQ index-level investor flow — foreign, institutional, individual net buying in billions of KRW for today.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { index: 'KOSPI' },
              inputSchema: { properties: { index: { type: 'string', description: 'KOSPI, KOSDAQ, or KPI200' } } },
              output: {
                example: { paid: true, service: 'crossfin-korea-index-flow', index: 'KOSPI', date: '20260213', foreignNetBuyBillionKrw: '-9,220', institutionNetBuyBillionKrw: '+831', individualNetBuyBillionKrw: '+7,141' },
                schema: { properties: { paid: { type: 'boolean' }, index: { type: 'string' }, foreignNetBuyBillionKrw: { type: 'string' }, institutionNetBuyBillionKrw: { type: 'string' }, individualNetBuyBillionKrw: { type: 'string' } }, required: ['paid', 'index'] },
              },
            }),
          },
        },
        'GET /api/premium/crypto/korea/5exchange': {
          accepts: { scheme: 'exact', price: '$0.08', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Compare crypto prices across 4 Korean exchanges (Upbit, Bithumb, Coinone, GoPax) for any coin. Shows inter-exchange spread for arbitrage.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { coin: 'BTC' },
              inputSchema: { properties: { coin: { type: 'string', description: 'Crypto symbol (BTC, ETH, XRP, etc.)' } } },
              output: {
                example: { paid: true, service: 'crossfin-crypto-5exchange', coin: 'BTC', exchangeCount: 4, exchanges: [{ exchange: 'Upbit', priceKrw: 102130000, volume24h: 1579 }], spread: { minPriceKrw: 102072000, maxPriceKrw: 102890000, spreadPct: 0.8 } },
                schema: { properties: { paid: { type: 'boolean' }, coin: { type: 'string' }, exchangeCount: { type: 'number' }, exchanges: { type: 'array' }, spread: { type: 'object' } }, required: ['paid', 'coin', 'exchanges', 'spread'] },
              },
            }),
          },
        },
        'GET /api/premium/crypto/korea/exchange-status': {
          accepts: { scheme: 'exact', price: '$0.03', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Bithumb deposit/withdrawal status for ALL 600+ coins. Disabled deposits/withdrawals signal exchange risk, regulatory action, or chain issues. Unique risk monitoring data.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-crypto-exchange-status', exchange: 'Bithumb', totalCoins: 668, disabledCount: 230, coins: [{ symbol: 'BTC', withdrawalEnabled: true, depositEnabled: true }] },
                schema: { properties: { paid: { type: 'boolean' }, exchange: { type: 'string' }, totalCoins: { type: 'number' }, disabledCount: { type: 'number' }, coins: { type: 'array' } }, required: ['paid', 'totalCoins', 'disabledCount', 'coins'] },
              },
            }),
          },
        },
        'GET /api/premium/market/korea/stock-detail': {
          accepts: { scheme: 'exact', price: '$0.05', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Comprehensive Korean stock analysis — PER, PBR, EPS, dividend yield, 52-week range, market cap, analyst consensus target price, and same-industry peer comparison.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { stock: '005930' },
              inputSchema: { properties: { stock: { type: 'string', description: '6-digit Korean stock code' } } },
              output: {
                example: { paid: true, service: 'crossfin-korea-stock-detail', stock: '005930', name: 'Samsung Electronics', metrics: { 'PER': '37.62배', 'PBR': '2.99배', '배당수익률': '0.92%' }, consensus: { targetPrice: '216,417', recommendation: '4.00' }, industryPeers: [{ code: '000660', name: 'SK Hynix' }] },
                schema: { properties: { paid: { type: 'boolean' }, stock: { type: 'string' }, name: { type: 'string' }, metrics: { type: 'object' }, consensus: { type: 'object' }, industryPeers: { type: 'array' } }, required: ['paid', 'stock', 'metrics'] },
              },
            }),
          },
        },
        'GET /api/premium/market/korea/stock-news': {
          accepts: { scheme: 'exact', price: '$0.03', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Korean stock-specific news feed from Naver Finance with article title, body, publisher, and timestamp.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { stock: '005930' },
              inputSchema: { properties: { stock: { type: 'string', description: '6-digit Korean stock code (e.g., 005930 for Samsung Electronics)' } } },
              output: {
                example: { paid: true, service: 'crossfin-korea-stock-news', stock: '005930', total: 1284, items: [{ id: 9912345, title: 'Samsung Electronics rises on AI memory demand', body: 'Analysts cited stronger-than-expected server DRAM orders...', publisher: 'Yonhap', datetime: '2026-02-16 09:15:00' }], source: 'naver-finance', at: '2026-02-16T00:00:00.000Z' },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, stock: { type: 'string' }, total: { type: 'number' }, items: { type: 'array' }, source: { type: 'string' }, at: { type: 'string' } }, required: ['paid', 'service', 'stock', 'total', 'items', 'source', 'at'] },
              },
            }),
          },
        },
        'GET /api/premium/market/korea/stock-brief': {
          accepts: { scheme: 'exact', price: '$0.10', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Stock Brief — one-call comprehensive Korean stock analysis combining fundamentals (PER/PBR/consensus), recent news, investor flow (foreign/institutional), and disclosure filings. Replaces 4 individual API calls.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { stock: '005930' },
              inputSchema: { properties: { stock: { type: 'string', description: 'Korean stock code (e.g., 005930 for Samsung Electronics)' } } },
              output: {
                example: {
                  paid: true,
                  service: 'crossfin-stock-brief',
                  stock: '005930',
                  name: 'Samsung Electronics',
                  detail: { stock: '005930', name: 'Samsung Electronics', metrics: { PER: '12.5\uBC30', PBR: '1.3\uBC30' }, consensus: { targetPrice: '216,417', recommendation: '4.00' } },
                  news: [],
                  investorFlow: { stock: '005930', days: 10, flow: [{ date: '20260213', foreignNetBuy: '-4,715,928' }] },
                  disclosures: [],
                  at: '2026-02-17T00:00:00.000Z',
                },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, stock: { type: 'string' }, name: { type: ['string', 'null'] }, detail: { type: ['object', 'null'] }, news: { type: 'array' }, investorFlow: { type: ['object', 'null'] }, disclosures: { type: 'array' }, at: { type: 'string', format: 'date-time' } }, required: ['paid', 'service', 'stock', 'detail', 'news', 'investorFlow', 'disclosures', 'at'] },
              },
            }),
          },
        },
        'GET /api/premium/market/korea/themes': {
          accepts: { scheme: 'exact', price: '$0.05', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Korean market theme groups with performance and breadth statistics from Naver Finance.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-korea-themes', themes: [{ no: 371, name: 'AI Semiconductor', totalCount: 24, changeRate: 2.13, riseCount: 16, fallCount: 8 }], source: 'naver-finance', at: '2026-02-16T00:00:00.000Z' },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, themes: { type: 'array' }, source: { type: 'string' }, at: { type: 'string' } }, required: ['paid', 'service', 'themes', 'source', 'at'] },
              },
            }),
          },
        },
        'GET /api/premium/market/korea/disclosure': {
          accepts: { scheme: 'exact', price: '$0.03', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Recent stock disclosures for a Korean listed company from Naver Finance.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { stock: '005930' },
              inputSchema: { properties: { stock: { type: 'string', description: '6-digit Korean stock code (e.g., 005930 for Samsung Electronics)' } } },
              output: {
                example: { paid: true, service: 'crossfin-korea-disclosure', stock: '005930', items: [{ title: 'Report on major management matters', datetime: '2026-02-14 17:48:00' }], source: 'naver-finance', at: '2026-02-16T00:00:00.000Z' },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, stock: { type: 'string' }, items: { type: 'array' }, source: { type: 'string' }, at: { type: 'string' } }, required: ['paid', 'service', 'stock', 'items', 'source', 'at'] },
              },
            }),
          },
        },
        'GET /api/premium/crypto/korea/fx-rate': {
          accepts: { scheme: 'exact', price: '$0.01', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Real-time KRW/USD forex quote from Upbit CRIX, including base price and daily change.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-korea-fx-rate', pair: 'KRW/USD', basePrice: 1332.5, change: 'RISE', changePrice: 4.1, openingPrice: 1328.4, high52w: 1451.0, low52w: 1248.7, source: 'upbit-crix', at: '2026-02-16T00:00:00.000Z' },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, pair: { type: 'string' }, basePrice: { type: 'number' }, change: { type: 'string' }, changePrice: { type: 'number' }, openingPrice: { type: 'number' }, high52w: { type: 'number' }, low52w: { type: 'number' }, source: { type: 'string' }, at: { type: 'string' } }, required: ['paid', 'service', 'pair', 'basePrice', 'change', 'changePrice', 'openingPrice', 'high52w', 'low52w', 'source', 'at'] },
              },
            }),
          },
        },
        'GET /api/premium/market/korea/etf': {
          accepts: { scheme: 'exact', price: '$0.03', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Top Korean ETF list with price, NAV, return, and market cap from Naver Finance.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-korea-etf', totalCount: 1070, items: [{ name: 'KODEX 200', code: '069500', price: 81860, changeVal: -115, changeRate: -0.14, nav: 81847, volume: 15969201, threeMonthReturn: 38.73, marketCap: 160691 }], source: 'naver-finance', at: '2026-02-16T00:00:00.000Z' },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, totalCount: { type: 'number' }, items: { type: 'array' }, source: { type: 'string' }, at: { type: 'string' } }, required: ['paid', 'service', 'totalCount', 'items', 'source', 'at'] },
              },
            }),
          },
        },
        'GET /api/premium/crypto/korea/upbit-candles': {
          accepts: { scheme: 'exact', price: '$0.02', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Upbit OHLCV candle data for any KRW-listed crypto. Supports minutes (1/3/5/10/15/30/60/240), daily, weekly, monthly intervals. Up to 200 candles per request.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { coin: 'BTC', type: 'days', count: '30' },
              inputSchema: { properties: { coin: { type: 'string', description: 'Coin symbol (e.g., BTC, ETH, XRP)' }, type: { type: 'string', description: 'Candle type: minutes/1, minutes/5, minutes/15, minutes/60, minutes/240, days, weeks, months' }, count: { type: 'string', description: 'Number of candles (max 200)' } } },
              output: {
                example: { paid: true, service: 'crossfin-upbit-candles', market: 'KRW-BTC', type: 'days', count: 30, candles: [{ date: '2026-02-16T00:00:00', open: 102158000, high: 103120000, low: 100795000, close: 102776000, volume: 694.1 }] },
                schema: { properties: { paid: { type: 'boolean' }, market: { type: 'string' }, type: { type: 'string' }, count: { type: 'number' }, candles: { type: 'array' } }, required: ['paid', 'market', 'type', 'candles'] },
              },
            }),
          },
        },
        'GET /api/premium/market/global/indices-chart': {
          accepts: { scheme: 'exact', price: '$0.02', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Global stock index OHLCV chart data — Dow Jones (.DJI), NASDAQ (.IXIC), Hang Seng (.HSI), Nikkei (.N225) and more. Monthly aggregated history.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { index: '.DJI', period: 'month' },
              inputSchema: { properties: { index: { type: 'string', description: 'Naver index code: .DJI (Dow), .IXIC (NASDAQ), .HSI (Hang Seng), .N225 (Nikkei)' }, period: { type: 'string', description: 'month (monthly aggregation)' } } },
              output: {
                example: { paid: true, service: 'crossfin-global-indices-chart', index: '.DJI', period: 'month', candles: [{ date: '20260201', open: 48777.77, high: 50512.79, low: 48673.58, close: 49500.93, volume: 6697887 }] },
                schema: { properties: { paid: { type: 'boolean' }, index: { type: 'string' }, period: { type: 'string' }, candles: { type: 'array' } }, required: ['paid', 'index', 'candles'] },
              },
            }),
          },
        },
        'GET /api/premium/news/korea/headlines': {
          accepts: {
            scheme: 'exact',
            price: '$0.03',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Korean news headlines translated/summarized from Google News Korea RSS. Market-moving news, crypto regulation updates, and economic announcements from Korean media.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-korea-headlines', headlines: [{ title: 'Bitcoin surges past 100M KRW on Bithumb', source: 'MaeKyung', publishedAt: '2026-02-16T00:00:00.000Z', url: 'https://...' }], count: 10, at: '2026-02-16T00:00:00.000Z' },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, headlines: { type: 'array' }, count: { type: 'number' } }, required: ['paid', 'headlines', 'count'] },
              },
            }),
          },
        },
        'GET /api/premium/morning/brief': {
          accepts: { scheme: 'exact', price: '$0.20', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Morning Brief — one-call daily market summary combining kimchi premium, FX rate, KOSPI/KOSDAQ indices, stock momentum, and Korean headlines. Replaces 5+ individual API calls.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-morning-brief', kimchiPremium: { avgPremiumPct: 2.15, topPair: 'BTC', pairsTracked: 10 }, fxRate: { usdKrw: 1450 }, indices: { kospi: { price: 2650, changePct: 0.5 }, kosdaq: { price: 850, changePct: -0.3 } }, momentum: { topGainers: [], topLosers: [] }, headlines: [], at: '2026-02-17T00:00:00.000Z' },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, kimchiPremium: { type: 'object' }, fxRate: { type: 'object' }, indices: { type: 'object' }, momentum: { type: 'object' }, headlines: { type: 'array' } }, required: ['paid', 'service', 'kimchiPremium', 'fxRate', 'indices'] },
              },
            }),
          },
        },
        'GET /api/premium/crypto/snapshot': {
          accepts: { scheme: 'exact', price: '$0.15', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Crypto Snapshot — one-call crypto market overview combining 4-exchange price comparison (Upbit/Bithumb/Coinone/GoPax), kimchi premium, Bithumb volume analysis, and FX rate. Replaces 4+ individual API calls.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-crypto-snapshot', kimchiPremium: { avgPremiumPct: 2.15, pairsTracked: 10 }, fxRate: { usdKrw: 1450 }, exchanges: { upbit: {}, bithumb: {}, coinone: {}, gopax: {} }, volumeAnalysis: { totalVolume24hUsd: 5000000 }, at: '2026-02-17T00:00:00.000Z' },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, kimchiPremium: { type: 'object' }, fxRate: { type: 'object' }, exchanges: { type: 'object' }, volumeAnalysis: { type: 'object' } }, required: ['paid', 'service', 'kimchiPremium', 'fxRate'] },
              },
            }),
          },
        },
        'GET /api/premium/kimchi/stats': {
          accepts: { scheme: 'exact', price: '$0.15', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Kimchi Stats — comprehensive kimchi premium analysis combining current premiums, 24h trend, top arbitrage opportunity with EXECUTE/WAIT/SKIP signal, and cross-exchange spread. One call replaces 3+ individual endpoints.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-kimchi-stats', current: { avgPremiumPct: 2.15, pairsTracked: 10 }, trend: { direction: 'rising', change24hPct: 0.3 }, bestOpportunity: { coin: 'BTC', action: 'WAIT', confidence: 0.6 }, crossExchangeSpread: { spreadPct: 0.18 }, at: '2026-02-17T00:00:00.000Z' },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, current: { type: 'object' }, trend: { type: 'object' }, bestOpportunity: { type: 'object' }, crossExchangeSpread: { type: 'object' } }, required: ['paid', 'service', 'current'] },
              },
            }),
          },
        },
        'GET /api/premium/route/find': {
          accepts: { scheme: 'exact', price: '$0.10', network, payTo: c.env.PAYMENT_RECEIVER_ADDRESS, maxTimeoutSeconds: 300 },
          description: 'Optimal Route Finder — finds the cheapest/fastest crypto transfer route across 5 exchanges (Bithumb, Upbit, Coinone, GoPax, Binance). Compares bridge coins, fees, and transfer times.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { from: 'bithumb:KRW', to: 'binance:USDC', amount: 1000000, strategy: 'cheapest' },
              inputSchema: { properties: { from: { type: 'string', description: 'Source exchange:currency (e.g., bithumb:KRW)' }, to: { type: 'string', description: 'Destination exchange:currency (e.g., binance:USDC)' }, amount: { type: 'number', description: 'Amount in source currency' }, strategy: { type: 'string', description: 'cheapest | fastest | balanced' } } },
              output: {
                example: { paid: true, service: 'crossfin-route-finder', request: { from: 'bithumb:KRW', to: 'binance:USDC', amount: 1000000, strategy: 'cheapest' }, optimal: { bridgeCoin: 'XRP', totalCostPct: 0.45, totalTimeMinutes: 5, steps: [] }, alternatives: [], meta: { routesEvaluated: 12 } },
                schema: { properties: { paid: { type: 'boolean' }, service: { type: 'string' }, optimal: { type: 'object' }, alternatives: { type: 'array' }, meta: { type: 'object' } }, required: ['paid', 'service', 'optimal'] },
              },
            }),
          },
        },
      },
      resourceServer,
    )

    return middleware(c, next)
  },
)

const agentAuth: MiddlewareHandler<Env> = async (c, next) => {
  const apiKey = (c.req.header('X-Agent-Key') ?? '').trim()
  if (!apiKey) throw new HTTPException(401, { message: 'Missing X-Agent-Key header' })

  const apiKeyHash = await sha256Hex(apiKey)
  let agent = await c.env.DB.prepare(
    'SELECT id, status FROM agents WHERE api_key = ?'
  ).bind(apiKeyHash).first<{ id: string; status: string }>()

  let usedLegacyPlaintextKey = false
  if (!agent) {
    agent = await c.env.DB.prepare(
      'SELECT id, status FROM agents WHERE api_key = ?'
    ).bind(apiKey).first<{ id: string; status: string }>()
    usedLegacyPlaintextKey = agent !== null
  }

  if (!agent) throw new HTTPException(401, { message: 'Invalid API key' })
  if (agent.status !== 'active') throw new HTTPException(403, { message: 'Agent suspended' })

  if (usedLegacyPlaintextKey) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        'UPDATE agents SET api_key = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind(apiKeyHash, agent.id).run().catch((error) => {
        console.error('Failed to migrate legacy agent API key', error)
      })
    )
  }

  c.set('agentId', agent.id)
  await next()
}

app.post('/api/agents', async (c) => {
  requireAdmin(c)

  const body = await c.req.json<{ name: string }>()
  if (!body.name?.trim()) throw new HTTPException(400, { message: 'name is required' })

  const id = crypto.randomUUID()
  const apiKey = `cf_${crypto.randomUUID().replace(/-/g, '')}`
  const apiKeyHash = await sha256Hex(apiKey)

  await c.env.DB.prepare(
    'INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?)'
  ).bind(id, body.name.trim(), apiKeyHash).run()

  await audit(c.env.DB, id, 'agent.create', 'agents', id, 'success')

  return c.json({ id, name: body.name.trim(), apiKey }, 201)
})

type ServiceStatus = 'active' | 'disabled'

type RegistryService = {
  id: string
  name: string
  description: string | null
  provider: string
  category: string
  endpoint: string
  method: string
  price: string
  currency: string
  network: string | null
  payTo: string | null
  tags: string[]
  inputSchema: unknown | null
  outputExample: unknown | null
  status: ServiceStatus
  isCrossfin: boolean
  createdAt: string
  updatedAt: string
}

type ServiceSeed = Omit<RegistryService, 'isCrossfin' | 'createdAt' | 'updatedAt' | 'tags' | 'inputSchema' | 'outputExample'> & {
  tags?: string[]
  inputSchema?: unknown
  outputExample?: unknown
  isCrossfin?: boolean
}

type ServiceGuide = {
  whatItDoes: string
  whenToUse: string[]
  howToCall: string[]
  exampleCurl: string
  notes?: string[]
  relatedServiceIds?: string[]
}

type RegistryServiceResponse = RegistryService & { guide?: ServiceGuide }

type CrossfinRuntimeDocs = {
  guide: ServiceGuide
  inputSchema: unknown
  outputExample: unknown
}

const CROSSFIN_RUNTIME_DOCS: Record<string, CrossfinRuntimeDocs> = {
  crossfin_kimchi_premium: {
    guide: {
      whatItDoes: 'Real-time Kimchi Premium index: price spread between Korean exchange (Bithumb) and global exchange (Binance) across 10+ pairs.',
      whenToUse: [
        'Detect Korea-vs-global mispricing (kimchi premium) in real time',
        'Build Korea market sentiment signals or arbitrage monitors',
        'Use as an input feature for trading/risk models',
      ],
      howToCall: [
        'Send GET request to the endpoint',
        'Handle HTTP 402 (x402 payment required) and pay with USDC on Base',
        'Retry with PAYMENT-SIGNATURE header to receive data',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/arbitrage/kimchi -o /dev/null',
      notes: ['Cheapest way to preview is GET /api/arbitrage/demo (free, top 3 pairs).'],
      relatedServiceIds: ['crossfin_arbitrage_opportunities', 'crossfin_cross_exchange', 'crossfin_usdkrw'],
    },
    inputSchema: {
      type: 'http',
      method: 'GET',
      query: {},
    },
    outputExample: {
      paid: true,
      service: 'crossfin-kimchi-premium',
      krwUsdRate: 1450,
      pairsTracked: 12,
      avgPremiumPct: 2.15,
      topPremium: { coin: 'XRP', premiumPct: 4.12 },
      premiums: [
        {
          coin: 'BTC',
          bithumbKrw: 145000000,
          bithumbUsd: 100000,
          binanceUsd: 97850,
          premiumPct: 2.2,
          volume24hUsd: 5000000,
          change24hPct: 1.1,
        },
      ],
      at: '2026-02-15T00:00:00.000Z',
    },
  },
  crossfin_kimchi_premium_history: {
    guide: {
      whatItDoes: 'Hourly historical snapshots of kimchi premium captured by CrossFin cron (up to 7 days lookback).',
      whenToUse: [
        'Backtest kimchi premium strategies',
        'Compute moving averages/volatility of premium',
        'Compare premium regimes across coins',
      ],
      howToCall: [
        'Send GET request with optional coin/hours query params',
        'Pay via x402 if HTTP 402 is returned',
        'Use the returned snapshots array for analysis',
      ],
      exampleCurl: 'curl -s -D - "https://crossfin.dev/api/premium/arbitrage/kimchi/history?hours=24" -o /dev/null',
      notes: ['hours defaults to 24, max 168. coin is optional (e.g. BTC, ETH).'],
      relatedServiceIds: ['crossfin_kimchi_premium'],
    },
    inputSchema: {
      type: 'http',
      method: 'GET',
      query: {
        coin: { type: 'string', required: false, example: 'BTC', description: 'Optional coin filter (BTC, ETH, XRP...)' },
        hours: { type: 'integer', required: false, example: 24, description: 'Lookback window in hours (max 168)' },
      },
    },
    outputExample: {
      paid: true,
      service: 'crossfin-kimchi-history',
      coin: 'BTC',
      hours: 24,
      groupedBy: 'hour',
      snapshots: [{ at: '2026-02-15T00:00:00.000Z', avgPremiumPct: 2.1 }],
      count: 24,
      at: '2026-02-15T00:00:00.000Z',
    },
  },
  crossfin_arbitrage_opportunities: {
    guide: {
      whatItDoes: 'AI-ready arbitrage decision service. Analyzes Korean vs global exchange prices, estimates slippage from live orderbooks, checks premium trends, and returns actionable EXECUTE/WAIT/SKIP recommendations with confidence scores.',
      whenToUse: [
        'Get instant EXECUTE/WAIT/SKIP decisions for kimchi premium arbitrage',
        'Build autonomous trading agents that act on confidence scores',
        'Monitor market conditions (favorable/neutral/unfavorable) for timing entry',
        'Estimate real execution costs including slippage and transfer time risk',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Check marketCondition for overall assessment',
        'Filter opportunities[] where action === "EXECUTE" for immediate candidates',
        'Use confidence score to size positions (higher confidence = larger allocation)',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/arbitrage/opportunities -o /dev/null',
      relatedServiceIds: ['crossfin_kimchi_premium', 'crossfin_cross_exchange'],
    },
    inputSchema: { type: 'http', method: 'GET', query: {} },
    outputExample: {
      paid: true,
      service: 'crossfin-arbitrage-opportunities',
      totalOpportunities: 24,
      profitableCount: 8,
      executeCandidates: 3,
      marketCondition: 'favorable',
      bestOpportunity: {
        coin: 'XRP', netProfitPct: 1.2, direction: 'buy-global-sell-korea',
        slippageEstimatePct: 0.15, transferTimeMin: 0.5, premiumTrend: 'rising',
        action: 'EXECUTE', confidence: 0.87, reason: 'Adjusted profit 1.05% exceeds risk 0.12% with strong margin',
      },
      opportunities: [{
        coin: 'XRP', netProfitPct: 1.2, grossPremiumPct: 2.3, estimatedFeesPct: 1.1, riskScore: 'low',
        slippageEstimatePct: 0.15, transferTimeMin: 0.5, premiumTrend: 'rising',
        action: 'EXECUTE', confidence: 0.87, reason: 'Adjusted profit 1.05% exceeds risk 0.12% with strong margin',
      }],
      at: '2026-02-16T00:00:00.000Z',
    },
  },
  crossfin_bithumb_orderbook: {
    guide: {
      whatItDoes: 'Live 30-level orderbook depth from Bithumb (KRW market), including spread metrics and USD conversions.',
      whenToUse: [
        'Estimate slippage and liquidity for a KRW pair on Bithumb',
        'Compute cross-exchange execution costs',
        'Drive market-making/hedging strategies',
      ],
      howToCall: [
        'Send GET with pair= (e.g. BTC, ETH)',
        'Pay via x402 if HTTP 402 is returned',
        'Use depth.bids/asks for execution models',
      ],
      exampleCurl: 'curl -s -D - "https://crossfin.dev/api/premium/bithumb/orderbook?pair=BTC" -o /dev/null',
      notes: ['pair is KRW market symbol (BTC, ETH, XRP...).'],
      relatedServiceIds: ['crossfin_kimchi_premium', 'crossfin_cross_exchange'],
    },
    inputSchema: {
      type: 'http',
      method: 'GET',
      query: { pair: { type: 'string', required: true, example: 'BTC', description: 'KRW trading pair symbol' } },
    },
    outputExample: {
      paid: true,
      service: 'crossfin-bithumb-orderbook',
      pair: 'BTC',
      exchange: 'bithumb',
      bestBidKrw: 145000000,
      bestAskKrw: 145100000,
      spreadKrw: 100000,
      spreadPct: 0.07,
      depth: { bids: [{ price: '145000000', quantity: '0.12' }], asks: [{ price: '145100000', quantity: '0.10' }] },
      at: '2026-02-15T00:00:00.000Z',
    },
  },
  crossfin_bithumb_volume: {
    guide: {
      whatItDoes: 'Bithumb-wide 24h volume analysis: top coins, volume concentration, unusual volume detection, and USD conversions.',
      whenToUse: [
        'Detect attention rotation in Korean markets',
        'Spot unusually active coins for momentum scans',
        'Estimate market-wide liquidity on Bithumb',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Use unusualVolume/topByVolume for signals',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/bithumb/volume-analysis -o /dev/null',
      relatedServiceIds: ['crossfin_korea_sentiment', 'crossfin_upbit_signals'],
    },
    inputSchema: { type: 'http', method: 'GET', query: {} },
    outputExample: {
      paid: true,
      service: 'crossfin-bithumb-volume-analysis',
      totalVolume24hUsd: 123456789,
      totalCoins: 200,
      volumeConcentration: { top5Pct: 42.1, top5Coins: [{ coin: 'BTC', pct: 12.3 }] },
      unusualVolume: [{ coin: 'XRP', score: 2.1 }],
      topByVolume: [{ coin: 'BTC', volume24hUsd: 50000000 }],
      at: '2026-02-15T00:00:00.000Z',
    },
  },
  crossfin_korea_sentiment: {
    guide: {
      whatItDoes: 'Korean market sentiment snapshot from Bithumb: top gainers/losers, volume leaders, and a mood indicator.',
      whenToUse: [
        'Quickly gauge market mood (bullish/bearish/neutral) in Korea',
        'Generate watchlists for movers and liquidity',
        'Augment global crypto sentiment with Korea-specific view',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Use movers and volume leaders to build alerts',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/market/korea -o /dev/null',
      relatedServiceIds: ['crossfin_bithumb_volume', 'crossfin_kimchi_premium'],
    },
    inputSchema: { type: 'http', method: 'GET', query: {} },
    outputExample: {
      paid: true,
      service: 'crossfin-korea-market',
      mood: 'neutral',
      gainers: [{ coin: 'XRP', change24hPct: 8.1 }],
      losers: [{ coin: 'ADA', change24hPct: -6.2 }],
      volumeLeaders: [{ coin: 'BTC', volume24hUsd: 50000000 }],
      at: '2026-02-15T00:00:00.000Z',
    },
  },
  crossfin_usdkrw: {
    guide: {
      whatItDoes: 'USD/KRW exchange rate used across CrossFin for converting KRW-denominated exchange prices into USD.',
      whenToUse: [
        'Convert KRW price feeds into USD',
        'Compute premiums in USD terms',
        'Normalize Korean exchange metrics with global markets',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Use usdKrw value in downstream calculations',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/market/fx/usdkrw -o /dev/null',
      relatedServiceIds: ['crossfin_kimchi_premium', 'crossfin_cross_exchange'],
    },
    inputSchema: { type: 'http', method: 'GET', query: {} },
    outputExample: { paid: true, service: 'crossfin-usdkrw', usdKrw: 1375.23, at: '2026-02-15T00:00:00.000Z' },
  },
  crossfin_upbit_ticker: {
    guide: {
      whatItDoes: 'Upbit spot ticker for a KRW market symbol (e.g. KRW-BTC).',
      whenToUse: [
        'Fetch Upbit last trade price and 24h change for KRW markets',
        'Compare Upbit vs Bithumb vs global exchanges',
        'Drive KRW market alerts',
      ],
      howToCall: [
        'Send GET with market= (e.g. KRW-BTC)',
        'Pay via x402 if HTTP 402 is returned',
        'Read price/change/volume fields',
      ],
      exampleCurl: 'curl -s -D - "https://crossfin.dev/api/premium/market/upbit/ticker?market=KRW-BTC" -o /dev/null',
      relatedServiceIds: ['crossfin_cross_exchange', 'crossfin_usdkrw'],
    },
    inputSchema: {
      type: 'http',
      method: 'GET',
      query: { market: { type: 'string', required: true, example: 'KRW-BTC', description: 'Upbit market symbol' } },
    },
    outputExample: { paid: true, service: 'crossfin-upbit-ticker', market: 'KRW-BTC', tradePriceKrw: 123456789, change24hPct: 1.2, at: '2026-02-15T00:00:00.000Z' },
  },
  crossfin_upbit_orderbook: {
    guide: {
      whatItDoes: 'Upbit orderbook snapshot for a KRW market symbol (e.g. KRW-BTC).',
      whenToUse: [
        'Estimate Upbit liquidity and spread',
        'Compare depth vs Bithumb',
        'Compute execution-aware signals',
      ],
      howToCall: [
        'Send GET with market= (e.g. KRW-BTC)',
        'Pay via x402 if HTTP 402 is returned',
        'Use units[] for depth calculations',
      ],
      exampleCurl: 'curl -s -D - "https://crossfin.dev/api/premium/market/upbit/orderbook?market=KRW-BTC" -o /dev/null',
      relatedServiceIds: ['crossfin_upbit_ticker', 'crossfin_bithumb_orderbook'],
    },
    inputSchema: {
      type: 'http',
      method: 'GET',
      query: { market: { type: 'string', required: true, example: 'KRW-BTC', description: 'Upbit market symbol' } },
    },
    outputExample: { paid: true, service: 'crossfin-upbit-orderbook', market: 'KRW-BTC', units: [{ bidPrice: 123, bidSize: 0.5, askPrice: 124, askSize: 0.4 }], at: '2026-02-15T00:00:00.000Z' },
  },
  crossfin_upbit_signals: {
    guide: {
      whatItDoes: 'Trading signals for major Upbit KRW markets using momentum, volatility, and relative volume features.',
      whenToUse: [
        'Run a lightweight momentum/volatility scan for KRW markets',
        'Rank markets for potential breakout or mean reversion',
        'Drive alerting and watchlist generation',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Use signals[] for per-market features and combined call',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/market/upbit/signals -o /dev/null',
      relatedServiceIds: ['crossfin_upbit_ticker', 'crossfin_bithumb_volume'],
    },
    inputSchema: { type: 'http', method: 'GET', query: {} },
    outputExample: { paid: true, service: 'crossfin-upbit-signals', signals: [{ market: 'KRW-BTC', momentum: 'neutral', volume: 'high', volatility: 'medium', call: 'neutral' }], at: '2026-02-15T00:00:00.000Z' },
  },
  crossfin_coinone_ticker: {
    guide: {
      whatItDoes: 'Coinone spot ticker for a given currency symbol (e.g. BTC).',
      whenToUse: [
        'Fetch Coinone KRW market price for a coin',
        'Triangulate Korea pricing across exchanges',
        'Build exchange comparison dashboards',
      ],
      howToCall: [
        'Send GET with currency= (e.g. BTC)',
        'Pay via x402 if HTTP 402 is returned',
        'Read price and volume fields',
      ],
      exampleCurl: 'curl -s -D - "https://crossfin.dev/api/premium/market/coinone/ticker?currency=BTC" -o /dev/null',
      relatedServiceIds: ['crossfin_cross_exchange', 'crossfin_usdkrw'],
    },
    inputSchema: { type: 'http', method: 'GET', query: { currency: { type: 'string', required: true, example: 'BTC', description: 'Coinone currency symbol' } } },
    outputExample: { paid: true, service: 'crossfin-coinone-ticker', currency: 'BTC', lastKrw: 123456789, change24hPct: 0.8, at: '2026-02-15T00:00:00.000Z' },
  },
  crossfin_cross_exchange: {
    guide: {
      whatItDoes: 'Cross-exchange decision service. Compares crypto prices across Bithumb, Upbit, Coinone, and Binance with actionable signals. Returns best buy/sell exchange per coin and ARBITRAGE/HOLD/MONITOR recommendations.',
      whenToUse: [
        'Find the cheapest exchange to buy and most expensive to sell',
        'Get instant ARBITRAGE/HOLD/MONITOR signals for domestic exchange spreads',
        'Compare KRW prices vs global USD prices across all 4 exchanges',
        'Build cross-exchange arbitrage bots using action signals',
      ],
      howToCall: [
        'Send GET request (optional ?coins=BTC,ETH,XRP)',
        'Pay via x402 if HTTP 402 is returned',
        'Check arbitrageCandidateCount in summary for quick assessment',
        'Filter coins[] where action === "ARBITRAGE" for immediate opportunities',
        'Use bestBuyExchange and bestSellExchange for execution routing',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/market/cross-exchange -o /dev/null',
      relatedServiceIds: ['crossfin_kimchi_premium', 'crossfin_usdkrw', 'crossfin_arbitrage_opportunities'],
    },
    inputSchema: { type: 'http', method: 'GET', query: { coins: 'Comma-separated coins (default: BTC,ETH,XRP,DOGE,ADA,SOL)' } },
    outputExample: {
      paid: true, service: 'crossfin-cross-exchange', coinsCompared: 6, krwUsdRate: 1450,
      arbitrageCandidateCount: 2,
      coins: [{
        coin: 'BTC', bestBuyExchange: 'coinone', bestSellExchange: 'bithumb', spreadPct: 0.65,
        action: 'ARBITRAGE', kimchiPremium: { average: 2.1 },
      }],
      summary: { avgKimchiPremium: 2.1, arbitrageCandidateCount: 2, bestDomesticArbitrage: { coin: 'BTC', buy: 'coinone', sell: 'bithumb', spreadPct: 0.65, action: 'ARBITRAGE' } },
      at: '2026-02-16T00:00:00.000Z',
    },
  },
  crossfin_korea_headlines: {
    guide: {
      whatItDoes: 'Korean headlines feed (Google News RSS) for market context. Returns a list of recent headlines with publishers and links.',
      whenToUse: [
        'Add Korea news context to trading/analysis agents',
        'Run keyword monitoring and summarization pipelines',
        'Correlate market moves with headline bursts',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Use items[] as input to summarizers or alerting',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/news/korea/headlines -o /dev/null',
      notes: ['This endpoint parses RSS and may occasionally omit fields if the feed changes.'],
      relatedServiceIds: ['crossfin_kimchi_premium'],
    },
    inputSchema: { type: 'http', method: 'GET', query: { limit: { type: 'integer', required: false, example: 20, description: 'Max items (1..50). Default 20.' } } },
    outputExample: { paid: true, service: 'crossfin-korea-headlines', items: [{ title: 'Korean market headline', publisher: 'Example', link: 'https://news.google.com/...', publishedAt: '2026-02-15T00:00:00.000Z' }], at: '2026-02-15T00:00:00.000Z' },
  },
}

function applyCrossfinDocs(service: RegistryService): RegistryServiceResponse {
  if (!service.isCrossfin) return service
  const docs = CROSSFIN_RUNTIME_DOCS[service.id]
  if (!docs) return service
  return {
    ...service,
    guide: docs.guide,
    inputSchema: docs.inputSchema,
    outputExample: docs.outputExample,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonArrayOfStrings(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function parseJsonObject(value: string | null): unknown | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed
  } catch {
    return null
  }
}

function normalizeMethod(method: string | undefined): string {
  const raw = (method ?? '').trim().toUpperCase()
  if (!raw) return 'UNKNOWN'
  if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(raw)) return raw
  return 'UNKNOWN'
}

function isIpv4Address(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4) return false
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return false
    const n = Number(part)
    if (!Number.isInteger(n) || n < 0 || n > 255) return false
  }
  return true
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isIpv4Address(hostname)) return false
  const parts = hostname.split('.')
  if (parts.length !== 4) return false
  const a = Number(parts[0])
  const b = Number(parts[1])
  const c = Number(parts[2])
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 0 && c === 0) return true
  if (a === 192 && b === 0 && c === 2) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && c === 100) return true
  if (a === 203 && b === 0 && c === 113) return true
  if (a >= 224) return true
  return false
}

function normalizeIpLiteral(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase()
  const unbracketed = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed
  const zoneIdIndex = unbracketed.indexOf('%')
  return zoneIdIndex === -1 ? unbracketed : unbracketed.slice(0, zoneIdIndex)
}

function isIpv6Address(hostname: string): boolean {
  return normalizeIpLiteral(hostname).includes(':')
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = normalizeIpLiteral(hostname)
  if (!normalized.includes(':')) return false
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true
  }
  if (normalized.startsWith('ff')) return true
  if (normalized.startsWith('2001:db8')) return true

  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped && typeof mapped[1] === 'string' && isPrivateIpv4(mapped[1])) return true

  return false
}

function requireRegistryProvider(value: string | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw) throw new HTTPException(400, { message: 'provider is required' })
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(raw)) {
    throw new HTTPException(400, { message: 'provider is invalid' })
  }
  return raw
}

function requireRegistryCategory(value: string | undefined): string {
  const raw = (value ?? 'other').trim().toLowerCase()
  if (!raw) return 'other'
  if (!/^[a-z0-9][a-z0-9:_-]{0,47}$/.test(raw)) {
    throw new HTTPException(400, { message: 'category is invalid' })
  }
  return raw
}

function assertPublicHostname(url: URL): void {
  const hostname = url.hostname.trim().toLowerCase()
  if (!hostname) throw new HTTPException(400, { message: 'endpoint hostname is required' })

  if (url.protocol !== 'https:') {
    throw new HTTPException(400, { message: 'endpoint must start with https://' })
  }
  if (url.username || url.password) {
    throw new HTTPException(400, { message: 'endpoint must not contain credentials' })
  }
  if (url.port && url.port !== '443') {
    throw new HTTPException(400, { message: 'endpoint must use default HTTPS port' })
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new HTTPException(400, { message: 'endpoint hostname is not allowed' })
  }
  if (hostname === 'metadata.google.internal') {
    throw new HTTPException(400, { message: 'endpoint hostname is not allowed' })
  }

  if (isIpv6Address(hostname)) {
    throw new HTTPException(400, { message: 'endpoint must not be an IP address' })
  }
  if (isPrivateIpv4(hostname)) {
    throw new HTTPException(400, { message: 'endpoint must not be a private IP address' })
  }
  if (hostname === '169.254.169.254' || hostname === '0.0.0.0') {
    throw new HTTPException(400, { message: 'endpoint hostname is not allowed' })
  }
}

async function resolveDnsAnswers(hostname: string, recordType: 'A' | 'AAAA'): Promise<string[]> {
  const dnsUrl = new URL('https://cloudflare-dns.com/dns-query')
  dnsUrl.searchParams.set('name', hostname)
  dnsUrl.searchParams.set('type', recordType)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 4_000)
  try {
    const res = await fetch(dnsUrl.toString(), {
      headers: { accept: 'application/dns-json' },
      signal: controller.signal,
    })
    if (!res.ok) return []

    const payload: unknown = await res.json()
    if (!isRecord(payload) || !Array.isArray(payload.Answer)) return []

    const out: string[] = []
    for (const answer of payload.Answer) {
      if (!isRecord(answer) || typeof answer.data !== 'string') continue
      const type = Number(answer.type ?? 0)
      if (type !== 1 && type !== 28) continue
      out.push(answer.data.trim().toLowerCase())
    }

    return out
  } finally {
    clearTimeout(timeoutId)
  }
}

async function assertHostnameResolvesToPublicIp(hostnameRaw: string): Promise<void> {
  const hostname = hostnameRaw.trim().toLowerCase()
  if (!hostname) throw new HTTPException(400, { message: 'endpoint hostname is required' })

  const now = Date.now()
  const cachedAt = hostResolutionCache.get(hostname)
  if (cachedAt && now - cachedAt < HOST_RESOLUTION_CACHE_TTL_MS) return

  pruneHostResolutionCache(now)

  let addresses: string[] = []
  try {
    const [v4, v6] = await Promise.all([
      resolveDnsAnswers(hostname, 'A'),
      resolveDnsAnswers(hostname, 'AAAA'),
    ])
    addresses = [...v4, ...v6]
  } catch {
    throw new HTTPException(400, { message: 'endpoint hostname DNS verification failed' })
  }

  if (addresses.length === 0) {
    throw new HTTPException(400, { message: 'endpoint hostname is not resolvable' })
  }

  for (const address of addresses) {
    if (isIpv4Address(address) && isPrivateIpv4(address)) {
      throw new HTTPException(400, { message: 'endpoint resolves to a private IP address' })
    }
    if (isIpv6Address(address) && isPrivateIpv6(address)) {
      throw new HTTPException(400, { message: 'endpoint resolves to a private IP address' })
    }
  }

  hostResolutionCache.set(hostname, now)
}

function requireHttpsUrl(value: string): string {
  const raw = value.trim()
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new HTTPException(400, { message: 'endpoint must be a valid URL' })
  }
  if (url.protocol !== 'https:') throw new HTTPException(400, { message: 'endpoint must start with https://' })
  return url.toString()
}

async function requirePublicHttpsUrl(value: string): Promise<string> {
  const raw = requireHttpsUrl(value)
  const url = new URL(raw)
  assertPublicHostname(url)
  await assertHostnameResolvesToPublicIp(url.hostname)
  return url.toString()
}

const PROXY_ALLOWED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-encoding',
  'cache-control',
  'etag',
  'last-modified',
  'vary',
  'payment-required',
  'payment-response',
] as const

function buildProxyResponseHeaders(upstreamHeaders: Headers): Headers {
  const outHeaders = new Headers()

  for (const headerName of PROXY_ALLOWED_RESPONSE_HEADERS) {
    const value = upstreamHeaders.get(headerName)
    if (value) outHeaders.set(headerName, value)
  }

  outHeaders.set('X-Content-Type-Options', 'nosniff')
  outHeaders.set('X-CrossFin-Proxy', 'true')
  outHeaders.set('X-CrossFin-Fee', '5%')
  return outHeaders
}

function mapServiceRow(row: Record<string, unknown>): RegistryService {
  const tags = parseJsonArrayOfStrings(typeof row.tags === 'string' ? row.tags : null)
  const statusRaw = typeof row.status === 'string' ? row.status : 'active'

  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    description: row.description === null || row.description === undefined ? null : String(row.description),
    provider: String(row.provider ?? ''),
    category: String(row.category ?? ''),
    endpoint: String(row.endpoint ?? ''),
    method: String(row.method ?? 'UNKNOWN'),
    price: String(row.price ?? ''),
    currency: String(row.currency ?? 'USDC'),
    network: row.network === null || row.network === undefined ? null : String(row.network),
    payTo: row.pay_to === null || row.pay_to === undefined ? null : String(row.pay_to),
    tags,
    inputSchema: parseJsonObject(typeof row.input_schema === 'string' ? row.input_schema : null),
    outputExample: parseJsonObject(typeof row.output_example === 'string' ? row.output_example : null),
    status: statusRaw === 'disabled' ? 'disabled' : 'active',
    isCrossfin: Number(row.is_crossfin ?? 0) === 1,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

async function fetchX402EngineSeeds(): Promise<ServiceSeed[]> {
  const url = 'https://x402-gateway-production.up.railway.app/.well-known/x402.json'
  const res = await fetch(url, { headers: { 'User-Agent': 'crossfin-registry-seed/1.0' } })
  if (!res.ok) return []

  const json: unknown = await res.json()
  if (!isRecord(json)) return []

  const networks = isRecord(json.networks) ? json.networks : null
  const base = networks && isRecord(networks.base) ? networks.base : null
  const network = base && typeof base.caip2 === 'string' ? base.caip2 : 'eip155:8453'
  const currency = base && typeof base.stablecoin === 'string' ? base.stablecoin : 'USDC'

  const categories = isRecord(json.categories) ? json.categories : null
  if (!categories) return []

  const seeds: ServiceSeed[] = []
  for (const [cat, value] of Object.entries(categories)) {
    if (!Array.isArray(value)) continue
    for (const item of value) {
      if (!isRecord(item)) continue
      const id = typeof item.id === 'string' ? item.id : ''
      const name = typeof item.name === 'string' ? item.name : ''
      const price = typeof item.price === 'string' ? item.price : ''
      const endpoint = typeof item.endpoint === 'string' ? item.endpoint : ''
      if (!id || !name || !price || !endpoint) continue

      const rawCat = String(cat)
      const isKnownDead =
        rawCat === 'compute' ||
        id.startsWith('image') ||
        id.startsWith('code') ||
        id.startsWith('audio') ||
        id.startsWith('llm') ||
        id.startsWith('wallet') ||
        id.startsWith('tx-') ||
        id === 'token-prices' ||
        id === 'ipfs-pin'
      const status: ServiceStatus = isKnownDead ? 'disabled' : 'active'

      seeds.push({
        id: `x402engine_${id}`,
        name,
        description: null,
        provider: 'x402engine',
        category: `x402engine:${rawCat}`,
        endpoint,
        method: 'UNKNOWN',
        price,
        currency,
        network,
        payTo: null,
        status,
        tags: ['x402', 'external', 'x402engine', rawCat],
      })
    }
  }

  return seeds
}

async function fetchEinsteinAiSeeds(): Promise<ServiceSeed[]> {
  const url = 'https://emc2ai.io/.well-known/x402.json'
  const res = await fetch(url, { headers: { 'User-Agent': 'crossfin-registry-seed/1.0' } })
  if (!res.ok) return []

  const json: unknown = await res.json()
  if (!isRecord(json)) return []

  const endpoints = isRecord(json.endpoints) ? json.endpoints : null
  const baseUrlRaw = endpoints && typeof endpoints.base === 'string' ? endpoints.base.trim() : ''
  if (!baseUrlRaw) return []

  let origin = 'https://emc2ai.io'
  try {
    origin = new URL(baseUrlRaw).origin
  } catch {
    origin = 'https://emc2ai.io'
  }

  const services = Array.isArray(json.services) ? json.services : []

  function toIdPart(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+/, '')
      .replace(/_+$/, '')
      .slice(0, 120)
  }

  function titleFromPath(path: string): string {
    const parts = path.split('/').filter(Boolean)
    const tail = parts.slice(-2).join(' ')
    const friendly = (tail || parts.slice(-1)[0] || path).replace(/-/g, ' ').trim()
    return friendly ? `Einstein AI ${friendly}` : 'Einstein AI Service'
  }

  const seeds: ServiceSeed[] = []
  for (const item of services) {
    if (!isRecord(item)) continue
    const path = typeof item.path === 'string' ? item.path.trim() : ''
    const method = typeof item.method === 'string' ? item.method.trim() : 'UNKNOWN'
    const description = typeof item.description === 'string' ? item.description.trim() : null
    const cat = typeof item.category === 'string' ? item.category.trim() : 'other'

    const pricing = isRecord(item.pricing) ? item.pricing : null
    const asset = pricing && typeof pricing.asset === 'string' ? pricing.asset.trim() : 'USDC'
    const amount = pricing && typeof pricing.amount === 'string' ? pricing.amount.trim() : ''
    const network = pricing && typeof pricing.network === 'string' ? pricing.network.trim() : 'eip155:8453'

    if (!path) continue

    const endpoint = path.startsWith('http')
      ? path
      : path.startsWith('/')
          ? `${origin}${path}`
          : `${baseUrlRaw.replace(/\/$/, '')}/${path}`

    const tags = Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === 'string') : []
    const idPart = toIdPart(path)
    const id = idPart ? `einstein_${idPart}` : `einstein_${crypto.randomUUID()}`
    const name = titleFromPath(path)
    const price = amount ? `$${amount}` : '$0.01+'

    seeds.push({
      id,
      name,
      description,
      provider: 'einstein-ai',
      category: `einstein:${cat || 'other'}`,
      endpoint,
      method,
      price,
      currency: asset || 'USDC',
      network: network || null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'einstein', ...tags],
    })
  }

  return seeds
}

const REGISTRY_SEED_CHECK_TTL_MS = 60_000
let registrySeedCheckedUntil = 0
let registrySeedInFlight: Promise<void> | null = null

async function ensureRegistrySeeded(
  db: D1Database,
  receiverAddress: string,
  input?: { force?: boolean }
): Promise<void> {
  const now = Date.now()
  const force = input?.force === true

  if (!force) {
    if (now < registrySeedCheckedUntil) return
    if (registrySeedInFlight) {
      await registrySeedInFlight
      return
    }
  }

  const run = async (): Promise<void> => {
    let row: { count: number | string } | null
    try {
      row = await db.prepare('SELECT COUNT(*) as count FROM services').first<{ count: number | string }>()
    } catch {
      throw new HTTPException(500, { message: 'DB schema not migrated (services table missing)' })
    }

    const crossfinSeedSpecs = CROSSFIN_PAID_ENDPOINTS.map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      endpoint: `https://crossfin.dev${withSampleQuery(entry.path, entry.sampleQuery)}`,
      price: entry.price,
      tags: entry.tags,
    }))

    const expectedCrossfinSeedCount = crossfinSeedSpecs.length
    const count = row ? Number(row.count) : 0
    if (!force && Number.isFinite(count) && count > 0) {
      const crossfinRow = await db
        .prepare('SELECT COUNT(*) as count FROM services WHERE is_crossfin = 1')
        .first<{ count: number | string }>()
      const crossfinCount = crossfinRow ? Number(crossfinRow.count) : 0
      if (Number.isFinite(crossfinCount) && crossfinCount >= expectedCrossfinSeedCount) {
        registrySeedCheckedUntil = Date.now() + REGISTRY_SEED_CHECK_TTL_MS
        return
      }
    }

    const crossfinSeeds: ServiceSeed[] = crossfinSeedSpecs.map((seed) => ({
      ...seed,
      provider: 'crossfin',
      method: 'GET',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
    }))

    const externalSeeds: ServiceSeed[] = [
    {
      id: 'invy_wallet_holdings',
      name: 'invy.bot Wallet Holdings Lookup',
      description: 'Wallet holdings lookup across chains (x402).',
      provider: 'invy.bot',
      category: 'wallet-intel',
      endpoint: 'https://invy.bot/{address}',
      method: 'UNKNOWN',
      price: '$0.01+',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'wallet'],
    },
    {
      id: 'minifetch_metadata',
      name: 'Minifetch Metadata Extraction',
      description: 'Extract metadata and links from web pages (x402).',
      provider: 'minifetch',
      category: 'web',
      endpoint: 'https://minifetch.com',
      method: 'UNKNOWN',
      price: '$0.002+',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'web'],
    },
    {
      id: 'pinata_x402',
      name: 'Pinata x402 IPFS',
      description: 'Account-free IPFS uploads via x402.',
      provider: 'pinata',
      category: 'storage',
      endpoint: 'https://402.pinata.cloud',
      method: 'UNKNOWN',
      price: '$0.001+',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'ipfs'],
    },
    {
      id: 'auor_oreo',
      name: 'auor.io (Oreo) Research Toolkit',
      description: 'Multi-API research toolkit (x402).',
      provider: 'auor.io',
      category: 'tools',
      endpoint: 'https://auor.io',
      method: 'UNKNOWN',
      price: '$0.04+',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'tools'],
    },

    {
      id: 'firecrawl_scrape',
      name: 'Firecrawl Scrape URL',
      description: 'Scrape a single URL into LLM-ready data (markdown/json, screenshots).',
      provider: 'firecrawl',
      category: 'web',
      endpoint: 'https://api.firecrawl.dev/v2/scrape',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'web', 'scraping'],
    },
    {
      id: 'firecrawl_crawl',
      name: 'Firecrawl Crawl Site',
      description: 'Crawl a site and extract content + metadata across pages.',
      provider: 'firecrawl',
      category: 'web',
      endpoint: 'https://api.firecrawl.dev/v2/crawl',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'web', 'crawl'],
    },
    {
      id: 'firecrawl_search',
      name: 'Firecrawl Web Search + Scrape',
      description: 'Search the web and return full-page content for results.',
      provider: 'firecrawl',
      category: 'web',
      endpoint: 'https://api.firecrawl.dev/v2/search',
      method: 'POST',
      price: '$0.02',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'web', 'search'],
    },
    {
      id: 'firecrawl_extract',
      name: 'Firecrawl Extract Structured Data',
      description: 'Extract structured data from webpages using natural-language instructions.',
      provider: 'firecrawl',
      category: 'ai-ml',
      endpoint: 'https://api.firecrawl.dev/v2/extract',
      method: 'POST',
      price: '$0.03',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'ai', 'extraction'],
    },
    {
      id: 'firecrawl_map',
      name: 'Firecrawl Map Site URLs',
      description: 'Discover a list of URLs for a website quickly and reliably.',
      provider: 'firecrawl',
      category: 'web',
      endpoint: 'https://api.firecrawl.dev/v2/map',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'web', 'site-map'],
    },

    {
      id: 'asterpay_market_price',
      name: 'AsterPay Market Price',
      description: 'Current crypto price + 24h change, market cap, and volume (x402).',
      provider: 'asterpay',
      category: 'defi',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/market/price/{symbol}',
      method: 'GET',
      price: '$0.001',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'market-data'],
    },
    {
      id: 'asterpay_market_ohlcv',
      name: 'AsterPay Market OHLCV',
      description: 'OHLCV candle data (1-90 days) for crypto assets (x402).',
      provider: 'asterpay',
      category: 'defi',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/market/ohlcv/{symbol}',
      method: 'GET',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'ohlcv'],
    },
    {
      id: 'asterpay_market_trending',
      name: 'AsterPay Trending Coins',
      description: 'Trending crypto assets with rank and 24h change (x402).',
      provider: 'asterpay',
      category: 'defi',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/market/trending',
      method: 'GET',
      price: '$0.002',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'trending'],
    },
    {
      id: 'asterpay_ai_summarize',
      name: 'AsterPay Text Summarization',
      description: 'AI-powered summarization of arbitrary text (x402).',
      provider: 'asterpay',
      category: 'ai-ml',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/ai/summarize',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'summarization'],
    },
    {
      id: 'asterpay_ai_sentiment',
      name: 'AsterPay Sentiment Analysis',
      description: 'Sentiment analysis on any text (x402).',
      provider: 'asterpay',
      category: 'ai-ml',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/ai/sentiment',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'nlp'],
    },
    {
      id: 'asterpay_ai_translate',
      name: 'AsterPay Translation',
      description: 'Translate text between languages (x402).',
      provider: 'asterpay',
      category: 'ai-ml',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/ai/translate',
      method: 'POST',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'translation'],
    },
    {
      id: 'asterpay_ai_code_review',
      name: 'AsterPay Code Review',
      description: 'Automated code review with suggestions (x402).',
      provider: 'asterpay',
      category: 'ai-ml',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/ai/code-review',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'codegen'],
    },
    {
      id: 'asterpay_crypto_wallet_score',
      name: 'AsterPay Wallet Reputation Score',
      description: 'On-chain wallet reputation scoring (x402).',
      provider: 'asterpay',
      category: 'analytics',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/crypto/wallet-score/{address}',
      method: 'GET',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'wallet'],
    },
    {
      id: 'asterpay_crypto_token_analysis',
      name: 'AsterPay Token Analysis',
      description: 'Deep token analysis with holders, activity, and risk (x402).',
      provider: 'asterpay',
      category: 'defi',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/crypto/token-analysis/{address}',
      method: 'GET',
      price: '$0.10',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'token'],
    },
    {
      id: 'asterpay_crypto_whale_alerts',
      name: 'AsterPay Whale Alerts',
      description: 'Real-time large transaction alerts (x402).',
      provider: 'asterpay',
      category: 'analytics',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/crypto/whale-alerts',
      method: 'GET',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'alerts'],
    },
    {
      id: 'asterpay_util_qr_code',
      name: 'AsterPay QR Code Generator',
      description: 'Generate QR codes from arbitrary data (x402).',
      provider: 'asterpay',
      category: 'utility',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/util/qr-code',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'qr'],
    },
    {
      id: 'asterpay_util_screenshot',
      name: 'AsterPay Screenshot Capture',
      description: 'Capture a screenshot of any URL (x402).',
      provider: 'asterpay',
      category: 'utility',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/util/screenshot',
      method: 'POST',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'screenshot'],
    },
    {
      id: 'asterpay_util_pdf_generate',
      name: 'AsterPay PDF Generator',
      description: 'Generate PDF documents from HTML/data (x402).',
      provider: 'asterpay',
      category: 'utility',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/util/pdf-generate',
      method: 'POST',
      price: '$0.03',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'pdf'],
    },
    {
      id: 'asterpay_settlement_estimate',
      name: 'AsterPay Settlement Estimate',
      description: 'Estimate USDC -> EUR settlement via SEPA Instant (free).',
      provider: 'asterpay',
      category: 'analytics',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/settlement/estimate',
      method: 'GET',
      price: '$0.00',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['external', 'asterpay', 'settlement'],
    },
    {
      id: 'asterpay_settlement_quote',
      name: 'AsterPay Settlement Quote',
      description: 'Get a settlement quote with fees and delivery time (free).',
      provider: 'asterpay',
      category: 'analytics',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/settlement/quote',
      method: 'GET',
      price: '$0.00',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['external', 'asterpay', 'settlement'],
    },
    {
      id: 'asterpay_x402_supported',
      name: 'AsterPay Supported Networks',
      description: 'List supported payment schemes and networks (free).',
      provider: 'asterpay',
      category: 'utility',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v2/x402/supported',
      method: 'GET',
      price: '$0.00',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'asterpay', 'x402'],
    },

    {
      id: 'snackmoney_x_pay',
      name: 'Snack Money Pay to X (Twitter)',
      description: 'Send USDC tips/payments to an X user via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/x/pay',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'social', 'x'],
    },
    {
      id: 'snackmoney_x_batch_pay',
      name: 'Snack Money Batch Pay to X',
      description: 'Batch send USDC to multiple X users via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/x/batch-pay',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'batch', 'x'],
    },
    {
      id: 'snackmoney_farcaster_pay',
      name: 'Snack Money Pay to Farcaster',
      description: 'Send USDC tips/payments to a Farcaster user via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/farcaster/pay',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'social', 'farcaster'],
    },
    {
      id: 'snackmoney_farcaster_batch_pay',
      name: 'Snack Money Batch Pay to Farcaster',
      description: 'Batch send USDC to multiple Farcaster users via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/farcaster/batch-pay',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'batch', 'farcaster'],
    },
    {
      id: 'snackmoney_github_pay',
      name: 'Snack Money Pay to GitHub',
      description: 'Send USDC payments to a GitHub user via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/github/pay',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'github'],
    },
    {
      id: 'snackmoney_github_batch_pay',
      name: 'Snack Money Batch Pay to GitHub',
      description: 'Batch send USDC to multiple GitHub users via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/github/batch-pay',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'batch', 'github'],
    },
    {
      id: 'snackmoney_email_pay',
      name: 'Snack Money Pay via Email',
      description: 'Send USDC payments to a user identified by email via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/email/pay',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'email'],
    },
    {
      id: 'snackmoney_email_batch_pay',
      name: 'Snack Money Batch Pay via Email',
      description: 'Batch send USDC to users identified by email via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/email/batch-pay',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'batch', 'email'],
    },
    {
      id: 'snackmoney_web_pay',
      name: 'Snack Money Pay via Domain/URL',
      description: 'Send USDC to a recipient identified by domain/URL via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/web/pay',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'web'],
    },
    {
      id: 'snackmoney_web_batch_pay',
      name: 'Snack Money Batch Pay via Domain/URL',
      description: 'Batch send USDC to recipients identified by domain/URL via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/web/batch-pay',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'batch', 'web'],
    },
    {
      id: 'snackmoney_payments_validate',
      name: 'Snack Money Validate Payment',
      description: 'Validate x402 payment status and details.',
      provider: 'snack.money',
      category: 'security',
      endpoint: 'https://api.snack.money/payments/validate',
      method: 'GET',
      price: '$0.001',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'validation'],
    },

    {
      id: 'ouchanip_email_validation',
      name: 'ouchanip Email Validation',
      description: 'Validate email format, deliverability, and disposable status (x402).',
      provider: 'ouchanip',
      category: 'security',
      endpoint: 'https://email-validation-api-x402-689670267582.us-central1.run.app/validate',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'email', 'validation'],
    },
    {
      id: 'ouchanip_qr_code',
      name: 'ouchanip QR Code Generator',
      description: 'Generate QR code PNG images from URLs (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://qr-code-api-x402-689670267582.us-central1.run.app/generate',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'qr', 'images'],
    },
    {
      id: 'ouchanip_pdf_invoice',
      name: 'ouchanip PDF Invoice Generator',
      description: 'Generate PDF invoices from structured JSON data (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://pdf-invoice-api-x402-689670267582.us-central1.run.app/generate',
      method: 'POST',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'pdf', 'invoices'],
    },
    {
      id: 'ouchanip_ogp_image',
      name: 'ouchanip OGP Image Generator',
      description: 'Generate OGP images (1200x630 PNG) for links/posts (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://ogp-image-api-x402-689670267582.us-central1.run.app/generate',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'images', 'ogp'],
    },
    {
      id: 'ouchanip_markdown_to_pdf',
      name: 'ouchanip Markdown to PDF',
      description: 'Convert Markdown into clean, styled PDF documents (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://md-to-pdf-api-x402-689670267582.us-central1.run.app/convert',
      method: 'POST',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'pdf', 'markdown'],
    },
    {
      id: 'ouchanip_image_resize',
      name: 'ouchanip Image Resize',
      description: 'Resize images to specified dimensions (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://image-resize-api-x402-689670267582.us-central1.run.app/resize',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'images'],
    },
    {
      id: 'ouchanip_url_metadata',
      name: 'ouchanip URL Metadata Extractor',
      description: 'Extract title/description/preview image metadata from a URL (x402).',
      provider: 'ouchanip',
      category: 'web',
      endpoint: 'https://url-metadata-api-x402-689670267582.us-central1.run.app/extract',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'web', 'metadata'],
    },
    {
      id: 'ouchanip_csv_json',
      name: 'ouchanip CSV/JSON Converter',
      description: 'Convert between CSV and JSON payloads (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://csv-json-api-x402-689670267582.us-central1.run.app/convert',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'conversion'],
    },
    {
      id: 'ouchanip_text_diff',
      name: 'ouchanip Text Diff',
      description: 'Compute diffs between two texts (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://diff-api-x402-689670267582.us-central1.run.app/diff',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'diff'],
    },
    {
      id: 'ouchanip_dns_lookup',
      name: 'ouchanip DNS Lookup',
      description: 'DNS lookup for a domain (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://dns-lookup-api-x402-689670267582.us-central1.run.app/lookup',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'dns'],
    },

    {
      id: 'openmeteo_forecast',
      name: 'Open-Meteo Weather Forecast',
      description: 'Free weather forecasts (hourly/daily) without API keys.',
      provider: 'open-meteo',
      category: 'data',
      endpoint: 'https://api.open-meteo.com/v1/forecast',
      method: 'GET',
      price: '$0.001',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'weather'],
    },
    {
      id: 'openweather_current',
      name: 'OpenWeather Current Weather',
      description: 'Current weather data (API key required).',
      provider: 'openweather',
      category: 'data',
      endpoint: 'https://api.openweathermap.org/data/2.5/weather',
      method: 'GET',
      price: '$0.005',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'weather'],
    },
    {
      id: 'coingecko_simple_price',
      name: 'CoinGecko Simple Price',
      description: 'Token price lookups by id and vs-currency.',
      provider: 'coingecko',
      category: 'defi',
      endpoint: 'https://api.coingecko.com/api/v3/simple/price',
      method: 'GET',
      price: '$0.002',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'prices', 'crypto'],
    },
    {
      id: 'defillama_prices',
      name: 'DeFiLlama Prices',
      description: 'Token prices for multiple assets (DeFiLlama).',
      provider: 'defillama',
      category: 'defi',
      endpoint: 'https://coins.llama.fi/prices/current/{coins}',
      method: 'GET',
      price: '$0.002',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'defi', 'prices'],
    },
    {
      id: 'cloudflare_radar_domains',
      name: 'Cloudflare Radar Domain Rank',
      description: 'Domain popularity and ranking insights (Cloudflare Radar).',
      provider: 'cloudflare',
      category: 'analytics',
      endpoint: 'https://api.cloudflare.com/client/v4/radar/ranking/domains',
      method: 'GET',
      price: '$0.01',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'analytics', 'dns'],
    },
    {
      id: 'ipinfo_geo',
      name: 'ipinfo.io IP Geolocation',
      description: 'IP geolocation and ASN/org lookup (token optional).',
      provider: 'ipinfo',
      category: 'data',
      endpoint: 'https://ipinfo.io/{ip}/json',
      method: 'GET',
      price: '$0.005',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'geo', 'ip'],
    },
    {
      id: 'google_dns_resolve',
      name: 'Google DNS over HTTPS',
      description: 'DNS over HTTPS resolution endpoint.',
      provider: 'google',
      category: 'utility',
      endpoint: 'https://dns.google/resolve',
      method: 'GET',
      price: '$0.001',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'dns'],
    },
    {
      id: 'tinyurl_shorten',
      name: 'TinyURL URL Shortener',
      description: 'Simple URL shortening via querystring API.',
      provider: 'tinyurl',
      category: 'utility',
      endpoint: 'https://tinyurl.com/api-create.php',
      method: 'GET',
      price: '$0.001',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'shortener'],
    },
    {
      id: 'qrserver_qr_generate',
      name: 'QRServer QR Code Generator',
      description: 'Generate QR codes (PNG) via query parameters.',
      provider: 'qrserver',
      category: 'utility',
      endpoint: 'https://api.qrserver.com/v1/create-qr-code/',
      method: 'GET',
      price: '$0.001',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'qr'],
    },
    {
      id: 'pdfshift_html_to_pdf',
      name: 'PDFShift HTML to PDF',
      description: 'Convert HTML pages to PDF (API key required).',
      provider: 'pdfshift',
      category: 'utility',
      endpoint: 'https://api.pdfshift.io/v3/convert/pdf',
      method: 'POST',
      price: '$0.02',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'pdf'],
    },
  ]

    const x402engineSeeds = await fetchX402EngineSeeds()
    const einsteinSeeds = await fetchEinsteinAiSeeds()

    const disabledSeedProviders = new Set(['ouchanip', 'snack.money', 'firecrawl'])
    const normalizedExternalSeeds = externalSeeds.map((seed) => {
      if (!disabledSeedProviders.has(seed.provider)) return seed
      return { ...seed, status: 'disabled' }
    })

    const allSeeds = [...crossfinSeeds, ...normalizedExternalSeeds, ...x402engineSeeds, ...einsteinSeeds]
    const sanitizedSeeds: ServiceSeed[] = []

    for (const seed of allSeeds) {
      try {
        const endpoint = requireHttpsUrl(seed.endpoint)
        const url = new URL(endpoint)
        assertPublicHostname(url)
        const status: ServiceStatus = seed.status === 'disabled' ? 'disabled' : 'active'
        sanitizedSeeds.push({ ...seed, endpoint, status })
      } catch {
        console.warn('Skipping registry seed with invalid endpoint', seed.id)
      }
    }

    const statements = sanitizedSeeds.map((seed) => {
      const tags = seed.tags ? JSON.stringify(seed.tags) : null
      const inputSchema = seed.inputSchema ? JSON.stringify(seed.inputSchema) : null
      const outputExample = seed.outputExample ? JSON.stringify(seed.outputExample) : null
      const isCrossfin = seed.isCrossfin ? 1 : 0

      return db.prepare(
        `INSERT OR IGNORE INTO services
          (id, name, description, provider, category, endpoint, method, price, currency, network, pay_to, tags, input_schema, output_example, status, is_crossfin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        seed.id,
        seed.name,
        seed.description,
        seed.provider,
        seed.category,
        seed.endpoint,
        normalizeMethod(seed.method),
        seed.price,
        seed.currency,
        seed.network,
        seed.payTo,
        tags,
        inputSchema,
        outputExample,
        seed.status,
        isCrossfin,
      )
    })

    if (statements.length > 0) {
      await db.batch(statements)
    }
    registrySeedCheckedUntil = Date.now() + REGISTRY_SEED_CHECK_TTL_MS
  }

  if (force) {
    await run()
    return
  }

  registrySeedInFlight = run()
  try {
    await registrySeedInFlight
  } finally {
    registrySeedInFlight = null
  }
}

app.get('/api/registry', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const category = (c.req.query('category') ?? '').trim()
  const provider = (c.req.query('provider') ?? '').trim()
  const isCrossfin = (c.req.query('isCrossfin') ?? '').trim()
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? '100')))
  const offset = Math.max(0, Number(c.req.query('offset') ?? '0'))

  const where: string[] = ["status = 'active'"]
  const params: unknown[] = []

  if (category) {
    where.push('category = ?')
    params.push(category)
  }

  if (provider) {
    where.push('provider = ?')
    params.push(provider)
  }

  if (isCrossfin) {
    const flag = isCrossfin === 'true' || isCrossfin === '1' ? 1 : 0
    where.push('is_crossfin = ?')
    params.push(flag)
  }

  const whereSql = where.join(' AND ')

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM services WHERE ${whereSql}`
  ).bind(...params).first<{ count: number | string }>()

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM services WHERE ${whereSql}
     ORDER BY is_crossfin DESC, created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all<Record<string, unknown>>()

  return c.json({
    data: (results ?? []).map((row) => applyCrossfinDocs(mapServiceRow(row))),
    total: countRow ? Number(countRow.count) : 0,
    limit,
    offset,
    at: new Date().toISOString(),
  })
})

app.get('/api/registry/search', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const qRaw = (c.req.query('q') ?? '').trim()
  if (!qRaw) throw new HTTPException(400, { message: 'q is required' })

  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50')))
  const offset = Math.max(0, Number(c.req.query('offset') ?? '0'))
  const q = `%${qRaw.replace(/[\\%_]/g, (match) => `\\${match}`)}%`

  const whereSql = "status = 'active' AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR provider LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR endpoint LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')"
  const params = [q, q, q, q, q, q]

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM services WHERE ${whereSql}`
  ).bind(...params).first<{ count: number | string }>()

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM services WHERE ${whereSql}
     ORDER BY is_crossfin DESC, created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all<Record<string, unknown>>()

  return c.json({
    q: qRaw,
    data: (results ?? []).map((row) => applyCrossfinDocs(mapServiceRow(row))),
    total: countRow ? Number(countRow.count) : 0,
    limit,
    offset,
    at: new Date().toISOString(),
  })
})

app.get('/api/registry/categories', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const { results } = await c.env.DB.prepare(
    "SELECT category, COUNT(*) as count FROM services WHERE status = 'active' GROUP BY category ORDER BY count DESC"
  ).all<{ category: string; count: number }>()

  return c.json({
    data: (results ?? []).map((r) => ({ category: r.category, count: Number(r.count) })),
    at: new Date().toISOString(),
  })
})

app.get('/api/registry/stats', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const results = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active'"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active' AND is_crossfin = 1"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active' AND is_crossfin = 0"),
  ])

  const total = results[0]?.results?.[0] as { count?: number | string } | undefined
  const crossfin = results[1]?.results?.[0] as { count?: number | string } | undefined
  const external = results[2]?.results?.[0] as { count?: number | string } | undefined

  return c.json({
    services: {
      total: Number(total?.count ?? 0),
      crossfin: Number(crossfin?.count ?? 0),
      external: Number(external?.count ?? 0),
    },
    at: new Date().toISOString(),
  })
})

app.get('/api/registry/sync', async (c) => {
  requireAdmin(c)

  const confirm = (c.req.query('confirm') ?? '').trim().toLowerCase()
  if (confirm !== 'yes') {
    throw new HTTPException(400, { message: 'Add ?confirm=yes to sync new registry seeds (insert-only)' })
  }

  const before = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM services'),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active'"),
  ])

  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS, { force: true })

  const after = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM services'),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active'"),
  ])

  const beforeTotal = Number(((before[0]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
  const beforeActive = Number(((before[1]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
  const afterTotal = Number(((after[0]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
  const afterActive = Number(((after[1]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))

  await audit(
    c.env.DB,
    null,
    'admin.registry.sync',
    'services',
    null,
    'success',
    `before_total=${beforeTotal} before_active=${beforeActive} after_total=${afterTotal} after_active=${afterActive}`,
  )

  return c.json({
    ok: true,
    services: {
      before: { total: beforeTotal, active: beforeActive },
      after: { total: afterTotal, active: afterActive },
      added: { total: Math.max(0, afterTotal - beforeTotal), active: Math.max(0, afterActive - beforeActive) },
    },
    at: new Date().toISOString(),
  })
})

app.get('/api/registry/reseed', async (c) => {
  requireAdmin(c)

  const confirm = (c.req.query('confirm') ?? '').trim().toLowerCase()
  if (confirm !== 'yes') {
    throw new HTTPException(400, { message: 'Add ?confirm=yes to reseed the registry' })
  }

  await c.env.DB.prepare('DELETE FROM services').run()
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const row = await c.env.DB.prepare('SELECT COUNT(*) as count FROM services').first<{ count: number | string }>()
  const count = row ? Number(row.count) : 0

  await audit(
    c.env.DB,
    null,
    'admin.registry.reseed',
    'services',
    null,
    'success',
    `services_total=${count}`,
  )

  return c.json({
    ok: true,
    services: { total: count },
    at: new Date().toISOString(),
  })
})

app.get('/api/registry/:id', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const id = c.req.param('id')
  const row = await c.env.DB.prepare(
    'SELECT * FROM services WHERE id = ?'
  ).bind(id).first<Record<string, unknown>>()

  if (!row) throw new HTTPException(404, { message: 'Service not found' })

  return c.json({ data: applyCrossfinDocs(mapServiceRow(row)) })
})

app.post('/api/registry', agentAuth, async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const agentId = c.get('agentId')
  const body = await c.req.json<{
    name?: string
    description?: string | null
    provider?: string
    category?: string
    endpoint?: string
    method?: string
    price?: string
    currency?: string
    network?: string | null
    payTo?: string | null
    tags?: unknown
    inputSchema?: unknown
    outputExample?: unknown
  }>()

  const name = body.name?.trim() ?? ''
  const provider = requireRegistryProvider(body.provider)
  const category = requireRegistryCategory(body.category)
  const endpoint = body.endpoint ? await requirePublicHttpsUrl(body.endpoint) : ''
  const price = body.price?.trim() ?? ''
  const currency = (body.currency?.trim() ?? 'USDC') || 'USDC'

  if (!name) throw new HTTPException(400, { message: 'name is required' })
  if (!endpoint) throw new HTTPException(400, { message: 'endpoint is required' })
  if (!price) throw new HTTPException(400, { message: 'price is required' })

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === 'string').slice(0, 20)
    : []

  const id = crypto.randomUUID()
  const method = normalizeMethod(body.method)
  const status: ServiceStatus = 'active'

  await c.env.DB.prepare(
    `INSERT INTO services
      (id, name, description, provider, category, endpoint, method, price, currency, network, pay_to, tags, input_schema, output_example, status, is_crossfin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).bind(
    id,
    name,
    body.description ?? null,
    provider,
    category,
    endpoint,
    method,
    price,
    currency,
    body.network ?? null,
    body.payTo ?? null,
    tags.length ? JSON.stringify(tags) : null,
    body.inputSchema ? JSON.stringify(body.inputSchema) : null,
    body.outputExample ? JSON.stringify(body.outputExample) : null,
    status,
  ).run()

  await audit(c.env.DB, agentId, 'service.create', 'services', id, 'success')

  const created = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(id).first<Record<string, unknown>>()
  return c.json({ data: created ? applyCrossfinDocs(mapServiceRow(created)) : { id } }, 201)
})

async function proxyToService(c: Context<Env>, method: 'GET' | 'POST'): Promise<Response> {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const agentId = c.get('agentId')
  if (!agentId) throw new HTTPException(401, { message: 'Missing X-Agent-Key header' })

  const serviceId = c.req.param('serviceId')
  const row = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(serviceId).first<Record<string, unknown>>()
  if (!row) throw new HTTPException(404, { message: 'Service not found' })

  const service = mapServiceRow(row)

  if (service.method !== 'UNKNOWN' && service.method !== method) {
    throw new HTTPException(405, { message: `Method not allowed (expected ${service.method})` })
  }

  const PROXY_MAX_BODY_BYTES = 512 * 1024
  const PROXY_RATE_LIMIT_PER_MINUTE_PER_SERVICE = 60
  const PROXY_RATE_LIMIT_PER_MINUTE_PER_AGENT = 240
  const PROXY_UPSTREAM_TIMEOUT_MS = 10_000

  const [serviceWindowRow, agentWindowRow] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM service_calls WHERE agent_id = ? AND service_id = ? AND created_at >= datetime('now', '-60 seconds')"
    ).bind(agentId, service.id),
    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM service_calls WHERE agent_id = ? AND created_at >= datetime('now', '-60 seconds')"
    ).bind(agentId),
  ])

  const countService = Number(((serviceWindowRow?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
  const countAgent = Number(((agentWindowRow?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
  if (countService >= PROXY_RATE_LIMIT_PER_MINUTE_PER_SERVICE || countAgent >= PROXY_RATE_LIMIT_PER_MINUTE_PER_AGENT) {
    throw new HTTPException(429, { message: 'Rate limited' })
  }

  let upstreamUrl: URL
  try {
    upstreamUrl = new URL(service.endpoint)
  } catch {
    throw new HTTPException(500, { message: 'Service endpoint is not a valid URL' })
  }

  try {
    assertPublicHostname(upstreamUrl)
    await assertHostnameResolvesToPublicIp(upstreamUrl.hostname)
  } catch {
    throw new HTTPException(502, { message: 'Service endpoint blocked' })
  }

  const incomingUrl = new URL(c.req.url)
  for (const [key, value] of incomingUrl.searchParams.entries()) {
    upstreamUrl.searchParams.append(key, value)
  }

  const start = Date.now()
  const callId = crypto.randomUUID()

  try {
    const headers: Record<string, string> = {}
    const accept = c.req.header('accept')
    if (accept) headers.accept = accept

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROXY_UPSTREAM_TIMEOUT_MS)
    const init: RequestInit = { method, headers, redirect: 'manual', signal: controller.signal }
    if (method === 'POST') {
      const contentLength = Number(c.req.header('content-length') ?? '0')
      if (contentLength > PROXY_MAX_BODY_BYTES) {
        throw new HTTPException(413, { message: 'Payload too large' })
      }
      const contentType = c.req.header('content-type')
      if (contentType) headers['content-type'] = contentType
      const body = await c.req.arrayBuffer()
      if (body.byteLength > PROXY_MAX_BODY_BYTES) {
        throw new HTTPException(413, { message: 'Payload too large' })
      }
      init.body = body
    }

    let upstreamRes: Response
    try {
      upstreamRes = await fetch(upstreamUrl.toString(), init)
    } finally {
      clearTimeout(timeoutId)
    }
    const responseTimeMs = Date.now() - start
    const isRedirectResponse = upstreamRes.status >= 300 && upstreamRes.status < 400
    const status = upstreamRes.ok && !isRedirectResponse ? 'success' : 'error'

    try {
      await c.env.DB.prepare(
        'INSERT INTO service_calls (id, service_id, agent_id, status, response_time_ms) VALUES (?, ?, ?, ?, ?)' 
      ).bind(callId, service.id, agentId, status, responseTimeMs).run()
    } catch (err) {
      console.error('Failed to log service call', err)
    }

    if (isRedirectResponse) {
      return c.json({ error: 'Upstream redirects are not allowed' }, 502)
    }

    const outHeaders = buildProxyResponseHeaders(upstreamRes.headers)
    return new Response(upstreamRes.body, { status: upstreamRes.status, headers: outHeaders })
  } catch (err) {
    if (err instanceof HTTPException) throw err

    const responseTimeMs = Date.now() - start

    try {
      await c.env.DB.prepare(
        'INSERT INTO service_calls (id, service_id, agent_id, status, response_time_ms) VALUES (?, ?, ?, ?, ?)' 
      ).bind(callId, service.id, agentId, 'error', responseTimeMs).run()
    } catch (logErr) {
      console.error('Failed to log service call', logErr)
    }

    if (err instanceof Error && err.name === 'AbortError') {
      return c.json({ error: 'Upstream request timed out' }, 504)
    }

    console.error('Proxy upstream request failed', err)
    return c.json({ error: 'Upstream request failed' }, 502)
  }
}

app.get('/api/proxy/:serviceId', agentAuth, async (c) => proxyToService(c, 'GET'))

app.post('/api/proxy/:serviceId', agentAuth, async (c) => proxyToService(c, 'POST'))

function parseFunnelEventName(value: unknown): FunnelEventName {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!FUNNEL_EVENT_NAME_SET.has(raw)) {
    throw new HTTPException(400, { message: `eventName must be one of: ${FUNNEL_EVENT_NAMES.join(', ')}` })
  }
  return raw as FunnelEventName
}

function normalizeFunnelSource(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const sanitized = raw.replace(/[^a-z0-9._:/-]/g, '')
  if (!sanitized) return 'web'
  return sanitized.slice(0, MAX_FUNNEL_SOURCE_LENGTH)
}

function normalizeFunnelMetadata(value: unknown): string | null {
  if (value === null || value === undefined) return null

  let serialized = ''
  try {
    serialized = JSON.stringify(value)
  } catch {
    return null
  }

  if (!serialized || serialized === '{}' || serialized === '[]') return null
  if (serialized.length <= MAX_FUNNEL_METADATA_LENGTH) return serialized

  const fallback = JSON.stringify({ truncated: true, originalLength: serialized.length })
  return fallback.length <= MAX_FUNNEL_METADATA_LENGTH ? fallback : null
}

async function ensureFunnelEventsTable(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS funnel_events (
         id TEXT PRIMARY KEY,
         event_name TEXT NOT NULL,
         source TEXT NOT NULL DEFAULT 'web',
         metadata TEXT,
         ip_hash TEXT,
         user_agent TEXT,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    ),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_funnel_events_event_created ON funnel_events(event_name, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_funnel_events_source_created ON funnel_events(source, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_funnel_events_ip_created ON funnel_events(ip_hash, created_at)'),
  ])
}

async function hashClientKey(c: Context<Env>): Promise<string> {
  const clientKey = getClientRateLimitKey(c)
  return sha256Hex(clientKey)
}

app.post('/api/analytics/funnel/events', async (c) => {
  const contentLengthRaw = c.req.header('Content-Length')
  if (contentLengthRaw) {
    const contentLength = Number(contentLengthRaw)
    if (Number.isFinite(contentLength) && contentLength > 4096) {
      throw new HTTPException(413, { message: 'Payload too large' })
    }
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' })
  }

  const payload = (body && typeof body === 'object' && !Array.isArray(body)) ? body as Record<string, unknown> : null
  if (!payload) throw new HTTPException(400, { message: 'JSON object body is required' })

  const eventName = parseFunnelEventName(payload.eventName)
  const source = normalizeFunnelSource(payload.source)
  const metadata = normalizeFunnelMetadata(payload.metadata)
  const userAgent = (c.req.header('User-Agent') ?? '').slice(0, MAX_FUNNEL_USER_AGENT_LENGTH)
  const ipHash = await hashClientKey(c)

  await ensureFunnelEventsTable(c.env.DB)
  await c.env.DB.prepare(
    'INSERT INTO funnel_events (id, event_name, source, metadata, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(`funnel_${crypto.randomUUID()}`, eventName, source, metadata, ipHash, userAgent).run()

  return c.json({ ok: true, eventName, source, at: new Date().toISOString() }, 202)
})

app.get('/api/analytics/funnel/overview', async (c) => {
  await ensureFunnelEventsTable(c.env.DB)

  const [byEventRes, bySourceRes, uniqueRes] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT event_name as eventName, COUNT(*) as count
       FROM funnel_events
       WHERE created_at >= datetime('now', '-7 day')
       GROUP BY event_name`
    ),
    c.env.DB.prepare(
      `SELECT source, COUNT(*) as count
       FROM funnel_events
       WHERE created_at >= datetime('now', '-7 day')
       GROUP BY source
       ORDER BY count DESC
       LIMIT 8`
    ),
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT ip_hash) as count
       FROM funnel_events
       WHERE created_at >= datetime('now', '-7 day')`
    ),
  ])

  const counts: Record<FunnelEventName, number> = {
    mcp_quickstart_view: 0,
    mcp_command_copy: 0,
    mcp_config_view: 0,
    mcp_config_copy: 0,
    mcp_guide_open: 0,
    mcp_install_verify: 0,
  }

  for (const row of (byEventRes?.results ?? []) as Array<{ eventName?: string; count?: number | string }>) {
    const eventName = typeof row.eventName === 'string' ? row.eventName : ''
    if (!FUNNEL_EVENT_NAME_SET.has(eventName)) continue
    counts[eventName as FunnelEventName] = Number(row.count ?? 0)
  }

  const quickstartViews = counts.mcp_quickstart_view
  const commandCopies = counts.mcp_command_copy
  const configViews = counts.mcp_config_view
  const configCopies = counts.mcp_config_copy
  const guideOpens = counts.mcp_guide_open
  const installVerifies = counts.mcp_install_verify

  const conversion = quickstartViews > 0
    ? {
        commandCopyPct: Math.round((commandCopies / quickstartViews) * 1000) / 10,
        configViewPct: Math.round((configViews / quickstartViews) * 1000) / 10,
        configCopyPct: Math.round((configCopies / quickstartViews) * 1000) / 10,
        guideOpenPct: Math.round((guideOpens / quickstartViews) * 1000) / 10,
        installVerifyPct: Math.round((installVerifies / quickstartViews) * 1000) / 10,
      }
    : {
        commandCopyPct: 0,
        configViewPct: 0,
        configCopyPct: 0,
        guideOpenPct: 0,
        installVerifyPct: 0,
      }

  const uniqueVisitors = Number((uniqueRes?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)

  return c.json({
    window: { days: 7 },
    counts,
    conversion,
    uniqueVisitors,
    topSources: (bySourceRes?.results ?? []).map((row) => ({
      source: String((row as { source?: string }).source ?? ''),
      count: Number((row as { count?: number | string }).count ?? 0),
    })),
    at: new Date().toISOString(),
  })
})

app.get('/api/analytics/overview', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const [callsCountRes, servicesCountRes, crossfinCountRes] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM service_calls'),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active'"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active' AND is_crossfin = 1"),
  ])

  const totalCalls = Number((callsCountRes?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
  const totalServices = Number((servicesCountRes?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
  const crossfinServices = Number((crossfinCountRes?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)

  const top = await c.env.DB.prepare(
    `SELECT s.id as serviceId, s.name as serviceName, COUNT(sc.id) as calls
     FROM services s
     LEFT JOIN service_calls sc ON sc.service_id = s.id
     WHERE s.status = 'active'
     GROUP BY s.id
     ORDER BY calls DESC
     LIMIT 10`
  ).all<{ serviceId: string; serviceName: string; calls: number | string }>()

  const recent = await c.env.DB.prepare(
    `SELECT sc.service_id as serviceId, s.name as serviceName, sc.status as status, sc.response_time_ms as responseTimeMs, sc.created_at as createdAt
     FROM service_calls sc
     JOIN services s ON s.id = sc.service_id
     ORDER BY datetime(sc.created_at) DESC
     LIMIT 20`
  ).all<{ serviceId: string; serviceName: string; status: string; responseTimeMs: number | string | null; createdAt: string }>()

  return c.json({
    totalCalls,
    totalServices,
    crossfinServices,
    topServices: (top.results ?? []).map((r) => ({
      serviceId: String(r.serviceId ?? ''),
      serviceName: String(r.serviceName ?? ''),
      calls: Number(r.calls ?? 0),
    })),
    recentCalls: (recent.results ?? []).map((r) => ({
      serviceId: String(r.serviceId ?? ''),
      serviceName: String(r.serviceName ?? ''),
      status: String(r.status ?? 'unknown'),
      responseTimeMs: r.responseTimeMs === null || r.responseTimeMs === undefined ? null : Number(r.responseTimeMs),
      createdAt: String(r.createdAt ?? ''),
    })),
    at: new Date().toISOString(),
  })
})

app.get('/api/analytics/services/:serviceId', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const serviceId = c.req.param('serviceId')
  const row = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(serviceId).first<Record<string, unknown>>()
  if (!row) throw new HTTPException(404, { message: 'Service not found' })

  const statsRow = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as totalCalls,
       SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successCalls,
       AVG(response_time_ms) as avgResponseTimeMs,
       SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) as callsLast24h,
       SUM(CASE WHEN created_at >= datetime('now', '-7 day') THEN 1 ELSE 0 END) as callsLast7d
     FROM service_calls
     WHERE service_id = ?`
  ).bind(serviceId).first<{
    totalCalls: number | string
    successCalls: number | string | null
    avgResponseTimeMs: number | string | null
    callsLast24h: number | string | null
    callsLast7d: number | string | null
  }>()

  const totalCalls = Number(statsRow?.totalCalls ?? 0)
  const successCalls = Number(statsRow?.successCalls ?? 0)
  const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 1000) / 10 : 0
  const avgResponseTimeMs = statsRow?.avgResponseTimeMs === null || statsRow?.avgResponseTimeMs === undefined
    ? null
    : Math.round(Number(statsRow.avgResponseTimeMs))

  return c.json({
    service: applyCrossfinDocs(mapServiceRow(row)),
    stats: {
      totalCalls,
      successRate,
      avgResponseTimeMs,
      callsLast24h: Number(statsRow?.callsLast24h ?? 0),
      callsLast7d: Number(statsRow?.callsLast7d ?? 0),
    },
    at: new Date().toISOString(),
  })
})

// === Korean Arbitrage Data Helpers ===

const TRACKED_PAIRS: Record<string, string> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', XRP: 'XRPUSDT',
  SOL: 'SOLUSDT', DOGE: 'DOGEUSDT', ADA: 'ADAUSDT',
  DOT: 'DOTUSDT', LINK: 'LINKUSDT', AVAX: 'AVAXUSDT',
  TRX: 'TRXUSDT', KAIA: 'KAIAUSDT',
}

const DEFAULT_CROSS_EXCHANGE_COINS = ['BTC', 'ETH', 'XRP', 'DOGE', 'ADA', 'SOL'] as const

const BITHUMB_FEES_PCT = 0.25 // Bithumb maker/taker fee
const BINANCE_FEES_PCT = 0.10 // Binance spot fee

// --- Routing Engine: Exchange trading fees (%) ---
const EXCHANGE_FEES: Record<string, number> = {
  bithumb: 0.25, upbit: 0.25, coinone: 0.20,
  gopax: 0.20, binance: 0.10,
}

// --- Routing Engine: Withdrawal fees per exchange per coin (fixed amount in coin units) ---
const WITHDRAWAL_FEES: Record<string, Record<string, number>> = {
  bithumb: { BTC: 0.0005, ETH: 0.005, XRP: 1.0, SOL: 0.01, DOGE: 5.0, ADA: 1.0, DOT: 0.1, LINK: 0.5, AVAX: 0.01, TRX: 1.0, KAIA: 0.005 },
  upbit: { BTC: 0.0005, ETH: 0.01, XRP: 1.0, SOL: 0.01, DOGE: 5.0, ADA: 1.0, DOT: 0.1, LINK: 0.5, AVAX: 0.01, TRX: 1.0 },
  coinone: { BTC: 0.0005, ETH: 0.01, XRP: 1.0, SOL: 0.01, DOGE: 5.0, ADA: 1.0, DOT: 0.1, LINK: 0.5, AVAX: 0.01, TRX: 1.0, KAIA: 0.86 },
  gopax: { BTC: 0.0005, ETH: 0.01, XRP: 1.0, SOL: 0.01, DOGE: 5.0, ADA: 1.0, TRX: 1.0, LINK: 0.5, AVAX: 0.01, KAIA: 1.0 },
  binance: { BTC: 0.0002, ETH: 0.0016, XRP: 0.25, SOL: 0.01, DOGE: 5.0, ADA: 1.0, DOT: 0.1, LINK: 0.3, AVAX: 0.01, TRX: 1.0, USDT: 1.0, USDC: 1.0, KAIA: 0.005 },
}

function getWithdrawalFee(exchange: string, coin: string): number {
  return WITHDRAWAL_FEES[exchange.toLowerCase()]?.[coin.toUpperCase()] ?? 0
}

// --- Routing Engine: Supported exchanges ---
const ROUTING_EXCHANGES = ['bithumb', 'upbit', 'coinone', 'gopax', 'binance'] as const
type RoutingExchange = typeof ROUTING_EXCHANGES[number]

// --- Routing Engine: Bridge coins for cross-exchange transfers ---
const BRIDGE_COINS = ['XRP', 'SOL', 'TRX', 'KAIA', 'ETH', 'BTC', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK'] as const

// --- Decision Layer: Transfer times (minutes) per coin ---
const TRANSFER_TIME_MIN: Record<string, number> = {
  BTC: 20, ETH: 5, XRP: 0.5, SOL: 1, DOGE: 10, ADA: 5,
  DOT: 5, LINK: 5, AVAX: 2, TRX: 1, KAIA: 1,
}
const DEFAULT_TRANSFER_TIME_MIN = 10

function getTransferTime(coin: string): number {
  return TRANSFER_TIME_MIN[coin.toUpperCase()] ?? DEFAULT_TRANSFER_TIME_MIN
}

// Estimate slippage from orderbook depth for a given trade size in KRW
function estimateSlippage(
  asks: Array<{ price: string; quantity: string }>,
  tradeAmountKrw: number,
): number {
  if (!asks.length || tradeAmountKrw <= 0) return 0
  const firstAsk = asks[0]
  if (!firstAsk) return 0
  const bestAsk = parseFloat(firstAsk.price)
  if (!bestAsk || !Number.isFinite(bestAsk)) return 0

  let remaining = tradeAmountKrw
  let totalCost = 0
  let totalQty = 0

  for (const level of asks) {
    const price = parseFloat(level.price)
    const qty = parseFloat(level.quantity)
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) continue

    const levelValue = price * qty
    if (remaining <= levelValue) {
      const fillQty = remaining / price
      totalCost += fillQty * price
      totalQty += fillQty
      remaining = 0
      break
    } else {
      totalCost += qty * price
      totalQty += qty
      remaining -= levelValue
    }
  }

  if (totalQty === 0) return 2.0 // default high slippage if no depth
  const avgPrice = totalCost / totalQty
  return Math.round(((avgPrice - bestAsk) / bestAsk) * 10000) / 100 // percentage
}

// Get premium trend from kimchi_snapshots (last N hours)
async function getPremiumTrend(
  db: D1Database,
  coin: string,
  hours: number = 6,
): Promise<{ trend: 'rising' | 'falling' | 'stable'; volatilityPct: number }> {
  try {
    const rangeArg = `-${hours} hours`
    const sql = `
      SELECT premium_pct AS premiumPct, created_at AS createdAt
      FROM kimchi_snapshots
      WHERE datetime(created_at) >= datetime('now', ?)
        AND coin = ?
      ORDER BY datetime(created_at) ASC
    `
    const res = await db.prepare(sql).bind(rangeArg, coin).all<{ premiumPct: number; createdAt: string }>()
    const rows = res.results ?? []

    if (rows.length < 2) return { trend: 'stable' as const, volatilityPct: 0 }

    const firstRow = rows[0]!
    const lastRow = rows[rows.length - 1]!
    const first = firstRow.premiumPct
    const last = lastRow.premiumPct
    const diff = last - first

    const values = rows.map((r) => r.premiumPct)
    const mean = values.reduce((s, v) => s + v, 0) / values.length
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
    const volatilityPct = Math.round(Math.sqrt(variance) * 100) / 100

    const trend: 'rising' | 'falling' | 'stable' =
      diff > 0.3 ? 'rising' : diff < -0.3 ? 'falling' : 'stable'

    return { trend, volatilityPct }
  } catch {
    return { trend: 'stable', volatilityPct: 0 }
  }
}

// Compute action recommendation
function computeAction(
  netProfitPct: number,
  slippageEstimatePct: number,
  transferTimeMin: number,
  volatilityPct: number,
): { action: 'EXECUTE' | 'WAIT' | 'SKIP'; confidence: number; reason: string } {
  const adjustedProfit = netProfitPct - slippageEstimatePct
  // Estimate premium risk during transfer: volatility * sqrt(transferTime/60)
  const premiumRisk = volatilityPct * Math.sqrt(transferTimeMin / 60)
  const score = adjustedProfit - premiumRisk

  if (score > 1.0) {
    const confidence = Math.min(0.95, 0.8 + (score - 1.0) * 0.05)
    return {
      action: 'EXECUTE',
      confidence: Math.round(confidence * 100) / 100,
      reason: `Adjusted profit ${round2(adjustedProfit)}% exceeds risk ${round2(premiumRisk)}% with strong margin`,
    }
  } else if (score > 0) {
    const confidence = 0.5 + (score / 1.0) * 0.3
    return {
      action: 'WAIT',
      confidence: Math.round(confidence * 100) / 100,
      reason: `Marginal profit ${round2(adjustedProfit)}% after risk ${round2(premiumRisk)}% — monitor for better entry`,
    }
  } else {
    const confidence = Math.max(0.1, 0.5 + score * 0.2)
    return {
      action: 'SKIP',
      confidence: Math.round(confidence * 100) / 100,
      reason: `Negative expected return: adjusted profit ${round2(adjustedProfit)}% minus risk ${round2(premiumRisk)}%`,
    }
  }
}

// ============================================================
// ROUTING ENGINE — Asia Agent Financial Router
// Finds the cheapest/fastest path to move money across exchanges
// ============================================================

interface RouteStep {
  type: 'buy' | 'sell' | 'transfer'
  from: { exchange: string; currency: string }
  to: { exchange: string; currency: string }
  estimatedCost: {
    feePct: number
    feeAbsolute: number
    slippagePct: number
    timeMinutes: number
  }
  priceUsed?: number
  amountIn: number
  amountOut: number
}

interface Route {
  id: string
  steps: RouteStep[]
  totalCostPct: number
  totalTimeMinutes: number
  estimatedInput: number
  estimatedOutput: number
  bridgeCoin: (typeof BRIDGE_COINS)[number]
  action: 'EXECUTE' | 'WAIT' | 'SKIP'
  confidence: number
  reason: string
  summary: {
    input: string
    output: string
    outputWithoutFees: string
    totalFee: string
    time: string
    route: string
    recommendation: 'GOOD_DEAL' | 'PROCEED' | 'EXPENSIVE' | 'VERY_EXPENSIVE'
  }
}

interface RouteMeta {
  exchangeRates: { KRW_USD: number }
  pricesUsed: Record<string, Record<string, number>>
  routesEvaluated: number
  bridgeCoinsTotal: number
  evaluatedCoins: Array<(typeof BRIDGE_COINS)[number]>
  skippedCoins?: Array<(typeof BRIDGE_COINS)[number]>
  analysisTimestamp: string
  disclaimer: string
}

type RoutingStrategy = 'cheapest' | 'fastest' | 'balanced'

// Fetch price for a coin on a Korean exchange in KRW
async function fetchKoreanExchangePrice(
  exchange: string,
  coin: string,
  bithumbAll?: Record<string, Record<string, string>>,
  skipOrderbook = false,
): Promise<{ priceKrw: number; asks: Array<{ price: string; quantity: string }> } | null> {
  try {
    const coinUpper = coin.toUpperCase()
    if (exchange === 'bithumb') {
      const data = bithumbAll ?? await fetchBithumbAll()
      const entry = data[coinUpper]
      if (!entry?.closing_price) return null
      // Fetch orderbook for slippage (skip during batch routing to avoid stalled HTTP responses)
      let asks: Array<{ price: string; quantity: string }> = []
      if (!skipOrderbook) {
        try {
          const obRes = await fetch(`https://api.bithumb.com/public/orderbook/${coinUpper}_KRW?count=30`)
          if (obRes.ok) {
            const obData = await obRes.json() as { data?: { asks?: Array<{ price: string; quantity: string }> } }
            asks = obData?.data?.asks ?? []
          } else {
            await obRes.body?.cancel()
          }
        } catch { /* ignore */ }
      }
      return { priceKrw: parseFloat(entry.closing_price), asks }
    }
    if (exchange === 'upbit') {
      const market = `KRW-${coinUpper}`
      const ticker = await fetchUpbitTicker(market)
      const tradePrice = ticker?.trade_price
      if (typeof tradePrice !== 'number' || !Number.isFinite(tradePrice)) return null
      let asks: Array<{ price: string; quantity: string }> = []
      try {
        const ob = await fetchUpbitOrderbook(market)
        const units = ob?.orderbook_units
        if (Array.isArray(units)) {
          asks = units.map((u: unknown) => {
            const rec = u as Record<string, unknown>
            return { price: String(rec.ask_price ?? 0), quantity: String(rec.ask_size ?? 0) }
          })
        }
      } catch { /* ignore */ }
      return { priceKrw: tradePrice, asks }
    }
    if (exchange === 'coinone') {
      const ticker = await fetchCoinoneTicker(coinUpper)
      const lastPrice = ticker?.last
      if (typeof lastPrice !== 'string' || !lastPrice) return null
      return { priceKrw: parseFloat(lastPrice as string), asks: [] }
    }
    if (exchange === 'gopax') {
      try {
        const res = await fetch(`https://api.gopax.co.kr/trading-pairs/${coinUpper}-KRW/ticker`)
        if (!res.ok) { await res.body?.cancel(); return null }
        const data = await res.json() as { price?: number; close?: number }
        const gopaxPrice = data.price ?? data.close
        if (!gopaxPrice) return null
        return { priceKrw: gopaxPrice, asks: [] }
      } catch { return null }
    }
    return null
  } catch {
    return null
  }
}

// Fetch Binance price for a coin in USDT/USDC
async function fetchBinancePrice(coin: string): Promise<number | null> {
  try {
    const symbol = TRACKED_PAIRS[coin.toUpperCase()]
    if (!symbol) return null
    const globalPrices = await fetchGlobalPrices()
    return globalPrices[symbol] ?? null
  } catch {
    return null
  }
}

// Core routing: enumerate paths and calculate costs
async function findOptimalRoute(
  fromExchange: string,
  fromCurrency: string,
  toExchange: string,
  toCurrency: string,
  amount: number,
  strategy: RoutingStrategy,
  db: D1Database,
): Promise<{ optimal: Route | null; alternatives: Route[]; meta: RouteMeta }> {
  const fromEx = fromExchange.toLowerCase()
  const toEx = toExchange.toLowerCase()
  const fromCur = fromCurrency.toUpperCase()
  const toCur = toCurrency.toUpperCase()

  const [krwRateResult, bithumbAllResult, globalPricesResult] = await Promise.allSettled([
    fetchKrwRate(),
    fetchBithumbAll(),
    fetchGlobalPrices(db),
  ])
  const krwRate = krwRateResult.status === 'fulfilled' ? krwRateResult.value : 1450
  const bithumbAll = bithumbAllResult.status === 'fulfilled' ? bithumbAllResult.value : {}
  const globalPrices: Record<string, number> = globalPricesResult.status === 'fulfilled' ? globalPricesResult.value : {}

  const pricesUsed: Record<string, Record<string, number>> = {}
  const routes: Route[] = []

  // Determine if this is a KRW → foreign currency route (most common)
  const isKrwToForeign = fromCur === 'KRW' && (toCur === 'USDC' || toCur === 'USDT' || toCur === 'USD')
  // Or KRW exchange to KRW exchange (domestic)
  const isDomestic = fromEx !== 'binance' && toEx !== 'binance'

  // For each bridge coin, calculate the full path cost
  for (const bridgeCoin of BRIDGE_COINS) {
    const isGlobalToKorea = fromEx === 'binance' && toEx !== 'binance'
    const isKoreaToGlobal = fromEx !== 'binance' && toEx === 'binance'

    // Check if bridge coin is supported on both exchanges
    const fromFee = EXCHANGE_FEES[fromEx]
    const toFee = EXCHANGE_FEES[toEx]
    const withdrawFee = getWithdrawalFee(fromEx, bridgeCoin)
    if (fromFee === undefined || toFee === undefined) continue

    const fromFeePct = fromFee
    const toFeePct = toFee

    // Check withdrawal support
    const fromWithdrawals = WITHDRAWAL_FEES[fromEx]
    if (!fromWithdrawals?.[bridgeCoin] && fromWithdrawals !== undefined) continue

    try {
      const isUsdLike = (cur: string): boolean => cur === 'USDC' || cur === 'USDT' || cur === 'USD'
      const capitalizeExchange = (ex: string): string => ex ? ex.charAt(0).toUpperCase() + ex.slice(1) : ex

      let buyFeePct: number
      let buySlippagePct: number
      let buyPriceUsed: number
      let coinsBought: number
      let coinsAfterWithdraw: number
      let sellPriceUsed: number
      let finalOutput: number
      let finalOutputKrw: number | null = null
      let transferTime: number
      let outputValueUsdForCost: number

      if (isGlobalToKorea) {
        const binanceSymbol = TRACKED_PAIRS[bridgeCoin]
        const binancePrice = binanceSymbol ? (globalPrices[binanceSymbol] ?? null) : null
        if (!binancePrice) continue

        buyFeePct = fromFeePct
        buySlippagePct = 0.10
        buyPriceUsed = binancePrice

        const effectiveBuyPriceUsd = binancePrice * (1 + (buySlippagePct / 100))
        const amountAfterBuyFee = amount * (1 - buyFeePct / 100)
        coinsBought = amountAfterBuyFee / effectiveBuyPriceUsd

        const withdrawFeeFromBinance = getWithdrawalFee('binance', bridgeCoin)
        coinsAfterWithdraw = coinsBought - withdrawFeeFromBinance
        if (coinsAfterWithdraw <= 0) continue
        transferTime = getTransferTime(bridgeCoin)

        const destPrice = await fetchKoreanExchangePrice(
          toEx, bridgeCoin, toEx === 'bithumb' ? bithumbAll : undefined, true,
        )
        if (!destPrice || destPrice.priceKrw <= 0) continue

        sellPriceUsed = destPrice.priceKrw
        finalOutputKrw = coinsAfterWithdraw * destPrice.priceKrw * (1 - toFeePct / 100)

        finalOutput = finalOutputKrw
        if (isUsdLike(toCur)) finalOutput = finalOutputKrw / krwRate

        outputValueUsdForCost = isUsdLike(toCur) ? finalOutput : (finalOutputKrw / krwRate)

        pricesUsed[bridgeCoin] = {
          binance_usd: buyPriceUsed,
          [`${toEx}_krw`]: sellPriceUsed,
        }
      } else if (isKoreaToGlobal || isDomestic) {
        const sourcePrice = await fetchKoreanExchangePrice(
          fromEx, bridgeCoin, fromEx === 'bithumb' ? bithumbAll : undefined, true,
        )
        if (!sourcePrice || sourcePrice.priceKrw <= 0) continue

        buyFeePct = fromFeePct
        buySlippagePct = sourcePrice.asks.length > 0
          ? estimateSlippage(sourcePrice.asks, amount)
          : 0.15 // default estimate
        buyPriceUsed = sourcePrice.priceKrw
        const effectiveBuyPrice = sourcePrice.priceKrw * (1 + (buySlippagePct / 100))
        const amountAfterBuyFee = amount * (1 - buyFeePct / 100)
        coinsBought = amountAfterBuyFee / effectiveBuyPrice

        coinsAfterWithdraw = coinsBought - withdrawFee
        if (coinsAfterWithdraw <= 0) continue
        transferTime = getTransferTime(bridgeCoin)

        if (toEx === 'binance') {
          const binanceSymbol = TRACKED_PAIRS[bridgeCoin]
          const binancePrice = binanceSymbol ? (globalPrices[binanceSymbol] ?? null) : null
          if (!binancePrice) continue
          sellPriceUsed = binancePrice
          finalOutput = coinsAfterWithdraw * binancePrice * (1 - toFeePct / 100)
        } else {
          const destPrice = await fetchKoreanExchangePrice(toEx, bridgeCoin, undefined, true)
          if (!destPrice || destPrice.priceKrw <= 0) continue
          sellPriceUsed = destPrice.priceKrw
          finalOutput = coinsAfterWithdraw * destPrice.priceKrw * (1 - toFeePct / 100)
          if (isUsdLike(toCur)) {
            finalOutput = finalOutput / krwRate
          }
        }

        outputValueUsdForCost = finalOutput

        pricesUsed[bridgeCoin] = {
          [`${fromEx}_krw`]: buyPriceUsed,
          ...(toEx === 'binance' ? { binance_usd: sellPriceUsed } : { [`${toEx}_krw`]: sellPriceUsed }),
        }
      } else {
        continue
      }

      const inputValueUsd = fromCur === 'KRW' ? amount / krwRate : amount
      const totalCostPct = ((inputValueUsd - outputValueUsdForCost) / inputValueUsd) * 100
      const totalTimeMinutes = transferTime + 1 // +1 min for trade execution

      // Get volatility for risk assessment
      const { volatilityPct } = await getPremiumTrend(db, bridgeCoin, 6)
      const { action, confidence, reason } = computeAction(
        -totalCostPct, // negative because it's a cost not profit
        buySlippagePct,
        transferTime,
        volatilityPct,
      )

      const estimatedOutput = Math.round(finalOutput * 100) / 100
      const inputValueUsdRounded = Math.round(inputValueUsd * 100) / 100
      const totalCostPctRounded = Math.round(totalCostPct * 100) / 100
      const totalTimeMinutesRounded = Math.round(totalTimeMinutes * 10) / 10

      const formatInput = (): string => {
        if (fromCur === 'KRW') return `₩${amount.toLocaleString()}`
        if (isUsdLike(fromCur)) return `$${amount.toLocaleString()} ${fromCur}`
        return `${amount} ${fromCur}`
      }

      const formatOutput = (value: number): string => {
        if (isUsdLike(toCur)) return `$${value.toLocaleString()} ${toCur}`
        if (toCur === 'KRW') return `₩${value.toLocaleString()} KRW`
        return `${value} ${toCur}`
      }

      const totalFee = (() => {
        if (toCur === 'KRW') {
          const outputKrw = finalOutputKrw ?? finalOutput
          const feeAmountKrw = Math.abs((inputValueUsd * krwRate) - outputKrw)
          return `₩${feeAmountKrw.toLocaleString()} (${totalCostPctRounded}%)`
        }
        const feeAmountUsd = Math.abs(inputValueUsd - outputValueUsdForCost)
        return `$${feeAmountUsd.toFixed(2)} (${totalCostPctRounded}%)`
      })()

      const recommendation: Route['summary']['recommendation'] = totalCostPct < 1
        ? 'GOOD_DEAL'
        : totalCostPct < 3
          ? 'PROCEED'
          : totalCostPct < 5
            ? 'EXPENSIVE'
            : 'VERY_EXPENSIVE'

      const route: Route = {
        id: `${fromEx}-${bridgeCoin}-${toEx}`,
        summary: {
          input: formatInput(),
          output: formatOutput(estimatedOutput),
          outputWithoutFees: toCur === 'KRW'
            ? formatOutput(Math.round(inputValueUsdRounded * krwRate * 100) / 100)
            : formatOutput(inputValueUsdRounded),
          totalFee,
          time: `~${totalTimeMinutesRounded} minutes`,
          route: `Buy ${bridgeCoin} on ${capitalizeExchange(fromEx)} → Transfer to ${capitalizeExchange(toEx)} → Sell for ${toCur}`,
          recommendation,
        },
        steps: [
          {
            type: 'buy',
            from: { exchange: fromEx, currency: fromCur },
            to: { exchange: fromEx, currency: bridgeCoin },
            estimatedCost: { feePct: buyFeePct, feeAbsolute: 0, slippagePct: buySlippagePct, timeMinutes: 0.5 },
            priceUsed: buyPriceUsed,
            amountIn: amount,
            amountOut: coinsBought,
          },
          {
            type: 'transfer',
            from: { exchange: fromEx, currency: bridgeCoin },
            to: { exchange: toEx, currency: bridgeCoin },
            estimatedCost: { feePct: 0, feeAbsolute: withdrawFee, slippagePct: 0, timeMinutes: transferTime },
            amountIn: coinsBought,
            amountOut: coinsAfterWithdraw,
          },
          {
            type: 'sell',
            from: { exchange: toEx, currency: bridgeCoin },
            to: { exchange: toEx, currency: toCur },
            estimatedCost: { feePct: toFeePct, feeAbsolute: 0, slippagePct: 0, timeMinutes: 0.5 },
            priceUsed: sellPriceUsed,
            amountIn: coinsAfterWithdraw,
            amountOut: finalOutput,
          },
        ],
        totalCostPct: totalCostPctRounded,
        totalTimeMinutes: totalTimeMinutesRounded,
        estimatedInput: amount,
        estimatedOutput,
        bridgeCoin,
        action: totalCostPct < 2 ? action : 'SKIP',
        confidence: Math.round(confidence * 100) / 100,
        reason: totalCostPct < 2 ? reason : `High total cost ${round2(totalCostPct)}% — consider waiting for better rates`,
      }

      routes.push(route)
    } catch (routeErr) {
      console.warn(`[routing] skip ${bridgeCoin}: ${routeErr instanceof Error ? routeErr.message : String(routeErr)}`)
      continue
    }
  }

  // Sort by strategy
  const sorted = [...routes]
  if (strategy === 'cheapest') {
    sorted.sort((a, b) => a.totalCostPct - b.totalCostPct)
  } else if (strategy === 'fastest') {
    sorted.sort((a, b) => a.totalTimeMinutes - b.totalTimeMinutes)
  } else {
    // balanced: weighted score (70% cost + 30% time)
    sorted.sort((a, b) => {
      const scoreA = a.totalCostPct * 0.7 + (a.totalTimeMinutes / 30) * 0.3
      const scoreB = b.totalCostPct * 0.7 + (b.totalTimeMinutes / 30) * 0.3
      return scoreA - scoreB
    })
  }

  const optimal = sorted[0] ?? null
  const alternatives = sorted.slice(1, 5) // top 4 alternatives
  const evaluatedCoins = routes.map(r => r.bridgeCoin)
  const skippedCoins = BRIDGE_COINS.filter(c => !evaluatedCoins.includes(c))

  return {
    optimal,
    alternatives,
    meta: {
      exchangeRates: { KRW_USD: krwRate },
      pricesUsed,
      routesEvaluated: routes.length,
      bridgeCoinsTotal: BRIDGE_COINS.length,
      evaluatedCoins,
      skippedCoins: skippedCoins.length > 0 ? skippedCoins : undefined,
      analysisTimestamp: new Date().toISOString(),
      disclaimer: 'Estimates based on current orderbook depth and market prices. Actual costs may vary due to price movements during execution.',
    },
  }
}

// ============================================================
// END ROUTING ENGINE CORE
// ============================================================

async function fetchKrwRate(): Promise<number> {
  // FX does not change fast enough to justify fetching on every request.
  // Cache in memory to avoid hammering the upstream API (especially from live dashboards).
  const KRW_RATE_SUCCESS_TTL_MS = 5 * 60_000
  const KRW_RATE_FAILURE_TTL_MS = 60_000

  type CachedRate = { value: number; expiresAt: number }
  const globalAny = globalThis as unknown as {
    __crossfinKrwRateCache?: CachedRate
    __crossfinKrwRateInFlight?: Promise<number> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinKrwRateCache
  if (cached && now < cached.expiresAt) return cached.value
  if (globalAny.__crossfinKrwRateInFlight) return globalAny.__crossfinKrwRateInFlight

  const fallback = cached?.value ?? 1450

  const promise = (async () => {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD')
      if (!res.ok) throw new Error(`FX rate fetch failed (${res.status})`)
      const data = await res.json() as { rates?: Record<string, number> }
      const rate = data.rates?.KRW
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 500 || rate > 5000) {
        throw new Error('FX rate fetch returned invalid KRW rate')
      }

      globalAny.__crossfinKrwRateCache = { value: rate, expiresAt: now + KRW_RATE_SUCCESS_TTL_MS }
      return rate
    } catch {
      globalAny.__crossfinKrwRateCache = { value: fallback, expiresAt: now + KRW_RATE_FAILURE_TTL_MS }
      return fallback
    } finally {
      globalAny.__crossfinKrwRateInFlight = null
    }
  })()

  globalAny.__crossfinKrwRateInFlight = promise
  return promise
}

async function fetchBithumbAll(): Promise<Record<string, Record<string, string>>> {
  // Cache to avoid hammering Bithumb on high-traffic dashboards.
  const BITHUMB_ALL_SUCCESS_TTL_MS = 10_000
  const BITHUMB_ALL_FAILURE_TTL_MS = 2_000

  type CachedBithumbAll = { value: Record<string, Record<string, string>>; expiresAt: number }
  const globalAny = globalThis as unknown as {
    __crossfinBithumbAllCache?: CachedBithumbAll
    __crossfinBithumbAllInFlight?: Promise<Record<string, Record<string, string>>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinBithumbAllCache
  if (cached && now < cached.expiresAt) return cached.value
  if (globalAny.__crossfinBithumbAllInFlight) return globalAny.__crossfinBithumbAllInFlight

  const fallback = cached?.value ?? {}

  const promise = (async () => {
    try {
      const res = await fetch('https://api.bithumb.com/public/ticker/ALL_KRW')
      if (!res.ok) throw new Error(`Bithumb API unavailable (${res.status})`)
      const data: unknown = await res.json()
      if (!isRecord(data) || typeof data.status !== 'string' || !isRecord(data.data)) {
        throw new Error('Bithumb API invalid response')
      }
      if (data.status !== '0000') throw new Error('Bithumb API unavailable')

      const parsed = data.data as Record<string, Record<string, string>>
      if (!isRecord(parsed.BTC) && !isRecord(parsed.ETH)) {
        throw new Error('Bithumb API returned no tickers')
      }

      globalAny.__crossfinBithumbAllCache = { value: parsed, expiresAt: now + BITHUMB_ALL_SUCCESS_TTL_MS }
      return parsed
    } catch {
      globalAny.__crossfinBithumbAllCache = { value: fallback, expiresAt: now + BITHUMB_ALL_FAILURE_TTL_MS }
      if (Object.keys(fallback).length > 0) return fallback
      throw new HTTPException(502, { message: 'Bithumb API unavailable' })
    } finally {
      globalAny.__crossfinBithumbAllInFlight = null
    }
  })()

  globalAny.__crossfinBithumbAllInFlight = promise
  return promise
}

async function fetchGlobalPrices(db?: D1Database): Promise<Record<string, number>> {
  // Cache to avoid rate-limits on upstream price providers.
  const GLOBAL_PRICES_SUCCESS_TTL_MS = 30_000
  const GLOBAL_PRICES_FAILURE_TTL_MS = 5_000

  type CachedGlobalPrices = { value: Record<string, number>; expiresAt: number; source: string }
  const globalAny = globalThis as unknown as {
    __crossfinGlobalPricesCache?: CachedGlobalPrices
    __crossfinGlobalPricesInFlight?: Promise<Record<string, number>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinGlobalPricesCache
  if (cached && now < cached.expiresAt && Object.keys(cached.value).length > 0) return cached.value
  if (globalAny.__crossfinGlobalPricesInFlight) return globalAny.__crossfinGlobalPricesInFlight

  const fallback = cached?.value ?? {}

  const promise = (async () => {
    const symbols = Array.from(new Set(Object.values(TRACKED_PAIRS)))

    const isValidPrices = (prices: Record<string, number>): boolean => {
      const btcSymbol = TRACKED_PAIRS.BTC
      if (!btcSymbol) return false
      const btc = prices[btcSymbol]
      if (typeof btc !== 'number' || !Number.isFinite(btc) || btc <= 1000) return false
      // We can operate with partial coverage (demo + some paid endpoints),
      // so only require at least one sane price.
      return Object.keys(prices).length >= 1
    }

    // 1) Binance (USDT ~= USD) batch endpoint.
    // We try binance.vision first because Cloudflare Workers egress can be geo-blocked on api.binance.com.
    {
      const query = encodeURIComponent(JSON.stringify(symbols))
      const BINANCE_BASE_URLS = [
        'https://data-api.binance.vision',
        'https://api.binance.com',
        'https://api1.binance.com',
        'https://api2.binance.com',
        'https://api3.binance.com',
      ]

      for (const baseUrl of BINANCE_BASE_URLS) {
        try {
          const url = `${baseUrl}/api/v3/ticker/price?symbols=${query}`
          const res = await fetch(url)
          if (!res.ok) throw new Error(`Binance price feed unavailable (${res.status})`)
          const data: unknown = await res.json()
          if (!Array.isArray(data)) throw new Error('Binance price feed invalid response')

          const prices: Record<string, number> = {}
          for (const row of data) {
            if (!isRecord(row)) continue
            const symbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : ''
            const priceRaw = typeof row.price === 'string' ? row.price.trim() : ''
            const price = Number(priceRaw)
            if (!symbol || !Number.isFinite(price) || price <= 0) continue
            prices[symbol] = price
          }

          if (isValidPrices(prices)) {
            const hostname = new URL(baseUrl).hostname
            globalAny.__crossfinGlobalPricesCache = { value: prices, expiresAt: now + GLOBAL_PRICES_SUCCESS_TTL_MS, source: `binance:${hostname}` }
            return prices
          }
        } catch {
          // Try next base URL
        }
      }
    }

    // 2) CryptoCompare fallback (no key) — detect 200/ERROR payloads
    try {
      const coins = Object.keys(TRACKED_PAIRS).join(',')
      const res = await fetch(
        `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${coins}&tsyms=USD`,
      )
      if (!res.ok) throw new Error(`CryptoCompare price feed unavailable (${res.status})`)

      const data: unknown = await res.json()
      if (!isRecord(data)) throw new Error('CryptoCompare price feed invalid response')

      const responseField = typeof data.Response === 'string' ? data.Response.toLowerCase() : ''
      if (responseField === 'error') throw new Error('CryptoCompare price feed returned error payload')

      const prices: Record<string, number> = {}
      for (const [coin, binanceSymbol] of Object.entries(TRACKED_PAIRS)) {
        const row = data[coin]
        if (!isRecord(row)) continue
        const price = row.USD
        if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue
        prices[binanceSymbol] = price
      }

      if (isValidPrices(prices)) {
        globalAny.__crossfinGlobalPricesCache = { value: prices, expiresAt: now + GLOBAL_PRICES_SUCCESS_TTL_MS, source: 'cryptocompare' }
        return prices
      }
    } catch {
      // Continue to fallback
    }

    // 3) CoinGecko fallback (simple price)
    try {
      const COINGECKO_IDS: Record<string, string> = {
        BTC: 'bitcoin',
        ETH: 'ethereum',
        XRP: 'ripple',
        KAIA: 'kaia',
        SOL: 'solana',
        DOGE: 'dogecoin',
        ADA: 'cardano',
        DOT: 'polkadot',
        LINK: 'chainlink',
        AVAX: 'avalanche-2',
        TRX: 'tron',
      }

      const ids = Array.from(new Set(Object.values(COINGECKO_IDS))).join(',')
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`CoinGecko price feed unavailable (${res.status})`)
      const data: unknown = await res.json()
      if (!isRecord(data)) throw new Error('CoinGecko price feed invalid response')

      const prices: Record<string, number> = {}
      for (const [coin, binanceSymbol] of Object.entries(TRACKED_PAIRS)) {
        const id = COINGECKO_IDS[coin]
        if (!id) continue
        const row = data[id]
        if (!isRecord(row)) continue
        const price = row.usd
        if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue
        prices[binanceSymbol] = price
      }

      if (isValidPrices(prices)) {
        globalAny.__crossfinGlobalPricesCache = { value: prices, expiresAt: now + GLOBAL_PRICES_SUCCESS_TTL_MS, source: 'coingecko' }
        return prices
      }
    } catch {
      // Continue to fallback
    }

    // 4) D1 snapshot fallback (last persisted kimchi_snapshots).
    // This keeps paid endpoints and routing usable even when upstream feeds rate-limit or block Workers egress.
    if (db) {
      try {
        type SnapshotRow = { coin: string; binanceUsd: number | string; createdAt: string }
        const sql = `
          WITH ranked AS (
            SELECT
              coin,
              binance_usd AS binanceUsd,
              created_at AS createdAt,
              ROW_NUMBER() OVER (PARTITION BY coin ORDER BY datetime(created_at) DESC) AS rn
            FROM kimchi_snapshots
            WHERE created_at >= datetime('now', '-7 day')
              AND binance_usd IS NOT NULL
          )
          SELECT coin, binanceUsd, createdAt
          FROM ranked
          WHERE rn = 1
        `

        const res = await db.prepare(sql).all<SnapshotRow>()
        const rows = res.results ?? []

        const prices: Record<string, number> = {}
        for (const row of rows) {
          const coin = String(row.coin ?? '').trim().toUpperCase()
          const symbol = TRACKED_PAIRS[coin]
          if (!symbol) continue
          const price = Number(row.binanceUsd ?? NaN)
          if (!Number.isFinite(price) || price <= 0) continue
          prices[symbol] = price
        }

        if (isValidPrices(prices)) {
          globalAny.__crossfinGlobalPricesCache = { value: prices, expiresAt: now + GLOBAL_PRICES_SUCCESS_TTL_MS, source: 'snapshot:d1' }
          return prices
        }
      } catch {
        // Continue to cached fallback
      }
    }

    globalAny.__crossfinGlobalPricesCache = { value: fallback, expiresAt: now + GLOBAL_PRICES_FAILURE_TTL_MS, source: cached?.source ?? 'cached' }
    if (isRecord(fallback) && Object.keys(fallback).length > 0) return fallback
    throw new HTTPException(502, { message: 'Price feed unavailable' })
  })()

  const gapFill = promise.then(async (prices) => {
    const missing = Object.entries(TRACKED_PAIRS).filter(([, sym]) => !(sym in prices))
    if (missing.length === 0) return prices

    const BINANCE_INDIVIDUAL_URLS = [
      'https://data-api.binance.vision',
      'https://api.binance.com',
      'https://api1.binance.com',
    ]

    await Promise.allSettled(missing.map(async ([, symbol]) => {
      for (const baseUrl of BINANCE_INDIVIDUAL_URLS) {
        try {
          const res = await fetch(`${baseUrl}/api/v3/ticker/price?symbol=${symbol}`)
          if (!res.ok) { await res.body?.cancel(); continue }
          const data = await res.json() as { symbol?: string; price?: string }
          const price = Number(data.price ?? NaN)
          if (Number.isFinite(price) && price > 0) {
            prices[symbol] = price
            return
          }
        } catch { continue }
      }
    }))

    if (globalAny.__crossfinGlobalPricesCache) {
      globalAny.__crossfinGlobalPricesCache.value = prices
    }
    return prices
  })

  globalAny.__crossfinGlobalPricesInFlight = gapFill
  return gapFill.finally(() => {
    globalAny.__crossfinGlobalPricesInFlight = null
  })
}

async function fetchBithumbOrderbook(pair: string): Promise<{ bids: unknown[]; asks: unknown[] }> {
  const res = await fetch(`https://api.bithumb.com/public/orderbook/${pair}_KRW`)
  const data = await res.json() as { status: string; data: { bids: unknown[]; asks: unknown[] } }
  if (data.status !== '0000') throw new HTTPException(400, { message: `Invalid pair: ${pair}` })
  return data.data
}

function requireSymbol(value: string, label: string): string {
  const raw = value.trim().toUpperCase()
  if (!raw) throw new HTTPException(400, { message: `${label} is required` })
  if (!/^[A-Z0-9]{2,16}$/.test(raw)) throw new HTTPException(400, { message: `${label} is invalid` })
  return raw
}

function requireUpbitMarket(value: string): string {
  const raw = value.trim().toUpperCase()
  if (!raw) throw new HTTPException(400, { message: 'market is required' })
  if (!/^[A-Z]{3,4}-[A-Z0-9]{2,16}$/.test(raw)) throw new HTTPException(400, { message: 'market is invalid (expected like KRW-BTC)' })
  return raw
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function parseCoinsQueryParam(raw: string | undefined): string[] {
  const allowed = new Set(Object.keys(TRACKED_PAIRS))
  const source = raw
    ? raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [...DEFAULT_CROSS_EXCHANGE_COINS]

  const filtered: string[] = []
  for (const coin of source) {
    if (!allowed.has(coin)) continue
    if (filtered.includes(coin)) continue
    filtered.push(coin)
  }

  return filtered.length > 0 ? filtered : [...DEFAULT_CROSS_EXCHANGE_COINS]
}

type DomesticExchangeId = 'bithumb' | 'upbit' | 'coinone'

type DomesticExchangeData = {
  priceKrw: number
  priceUsd: number
  volume24hKrw: number
  volume24hUsd: number
  change24hPct: number
}

type BinanceExchangeData = {
  priceUsd: number
}

type CrossExchangeExchanges = {
  bithumb: DomesticExchangeData | null
  upbit: DomesticExchangeData | null
  coinone: DomesticExchangeData | null
  binance: BinanceExchangeData | null
}

type CrossExchangeKimchiPremium = {
  bithumb: number | null
  upbit: number | null
  coinone: number | null
  average: number | null
}

type CrossExchangeDomesticArbitrage = {
  lowestExchange: DomesticExchangeId
  lowestPriceKrw: number
  highestExchange: DomesticExchangeId
  highestPriceKrw: number
  spreadKrw: number
  spreadPct: number
} | null

async function fetchUpbitTicker(market: string) {
  const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(market)}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Upbit API unavailable' })
  const data: unknown = await res.json()
  if (!Array.isArray(data) || data.length === 0 || !isRecord(data[0])) {
    throw new HTTPException(502, { message: 'Upbit API invalid response' })
  }
  return data[0]
}

async function fetchUpbitOrderbook(market: string) {
  const res = await fetch(`https://api.upbit.com/v1/orderbook?markets=${encodeURIComponent(market)}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Upbit API unavailable' })
  const data: unknown = await res.json()
  if (!Array.isArray(data) || data.length === 0 || !isRecord(data[0])) {
    throw new HTTPException(502, { message: 'Upbit API invalid response' })
  }
  return data[0]
}

async function fetchCoinoneTicker(currency: string) {
  const res = await fetch(`https://api.coinone.co.kr/public/v2/ticker_new/KRW/${encodeURIComponent(currency)}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Coinone API unavailable' })
  const data: unknown = await res.json()
  if (!isRecord(data) || data.result !== 'success' || !Array.isArray(data.tickers) || data.tickers.length === 0) {
    throw new HTTPException(502, { message: 'Coinone API invalid response' })
  }
  const first = data.tickers[0]
  if (!isRecord(first)) throw new HTTPException(502, { message: 'Coinone API invalid response' })
  return first
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

function extractXmlTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)
  const m = re.exec(xml)
  if (!m || typeof m[1] !== 'string') return null
  return stripCdata(m[1]).trim()
}

function parseIsoDate(value: string): string {
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d.toISOString() : value
}

function splitPublisherFromTitle(title: string): { title: string; publisher: string | null } {
  const idx = title.lastIndexOf(' - ')
  if (idx === -1) return { title, publisher: null }
  const head = title.slice(0, idx).trim()
  const pub = title.slice(idx + 3).trim()
  if (!head || !pub) return { title, publisher: null }
  return { title: head, publisher: pub }
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
    fetchGlobalPrices(c.env.DB),
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

app.get('/api/premium/arbitrage/kimchi/history', async (c) => {
  const coinRaw = c.req.query('coin')
  const coin = coinRaw ? requireSymbol(coinRaw, 'coin') : null

  const hoursRaw = c.req.query('hours')
  const hoursValue = hoursRaw ? Number(hoursRaw) : 24
  if (!Number.isFinite(hoursValue) || !Number.isInteger(hoursValue)) {
    throw new HTTPException(400, { message: 'hours must be an integer' })
  }

  const hours = Math.min(168, Math.max(1, hoursValue))

  const rangeArg = `-${hours} hours`
  const sql = `
    WITH ranked AS (
      SELECT
        id,
        coin,
        bithumb_krw AS bithumbKrw,
        binance_usd AS binanceUsd,
        premium_pct AS premiumPct,
        krw_usd_rate AS krwUsdRate,
        volume_24h_usd AS volume24hUsd,
        created_at AS createdAt,
        strftime('%Y-%m-%dT%H:00:00Z', created_at) AS hour,
        ROW_NUMBER() OVER (
          PARTITION BY coin, strftime('%Y-%m-%d %H', created_at)
          ORDER BY datetime(created_at) DESC
        ) AS rn
      FROM kimchi_snapshots
      WHERE datetime(created_at) >= datetime('now', ?)
        AND (? IS NULL OR coin = ?)
    )
    SELECT id, coin, bithumbKrw, binanceUsd, premiumPct, krwUsdRate, volume24hUsd, createdAt, hour
    FROM ranked
    WHERE rn = 1
    ORDER BY datetime(createdAt) DESC
  `

  let results: Array<Record<string, unknown>> = []
  try {
    const res = await c.env.DB.prepare(sql).bind(rangeArg, coin, coin).all<Record<string, unknown>>()
    results = res.results ?? []
  } catch (err) {
    console.error(err)
    throw new HTTPException(500, { message: 'DB schema not migrated (kimchi_snapshots table missing)' })
  }

  const snapshots = results.map((r) => ({
    id: String(r.id ?? ''),
    coin: String(r.coin ?? ''),
    bithumbKrw: r.bithumbKrw === null || r.bithumbKrw === undefined ? null : Number(r.bithumbKrw),
    binanceUsd: r.binanceUsd === null || r.binanceUsd === undefined ? null : Number(r.binanceUsd),
    premiumPct: r.premiumPct === null || r.premiumPct === undefined ? null : Number(r.premiumPct),
    krwUsdRate: r.krwUsdRate === null || r.krwUsdRate === undefined ? null : Number(r.krwUsdRate),
    volume24hUsd: r.volume24hUsd === null || r.volume24hUsd === undefined ? null : Number(r.volume24hUsd),
    createdAt: String(r.createdAt ?? ''),
    hour: String(r.hour ?? ''),
  }))

  const now = Date.now()
  return c.json({
    paid: true,
    service: 'crossfin-kimchi-premium-history',
    coin,
    hours,
    groupedBy: 'hour',
    range: {
      from: new Date(now - hours * 60 * 60 * 1000).toISOString(),
      to: new Date(now).toISOString(),
    },
    snapshots,
    count: snapshots.length,
    at: new Date().toISOString(),
  })
})

// === Arbitrage Opportunities (paid $0.10) ===

app.get('/api/premium/arbitrage/opportunities', async (c) => {
  const [bithumbData, binancePrices, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchGlobalPrices(c.env.DB),
    fetchKrwRate(),
  ])

  const premiums = calcPremiums(bithumbData, binancePrices, krwRate)
  const totalFeesPct = BITHUMB_FEES_PCT + BINANCE_FEES_PCT

  // Fetch orderbooks and premium trends in parallel for decision layer
  const orderbookPromises = premiums.map((p) =>
    fetchBithumbOrderbook(p.coin).catch(() => ({ bids: [], asks: [] })),
  )
  const trendPromises = premiums.map((p) =>
    getPremiumTrend(c.env.DB, p.coin, 6),
  )
  const [orderbooks, trends] = await Promise.all([
    Promise.all(orderbookPromises),
    Promise.all(trendPromises),
  ])

  const TRADE_SIZE_KRW = 15_000_000 // ~$10,000 reference trade

  const opportunities = premiums
    .map((p, i) => {
      const netProfitPct = Math.abs(p.premiumPct) - totalFeesPct
      const direction = p.premiumPct > 0 ? 'buy-global-sell-korea' : 'buy-korea-sell-global'
      const riskScore = p.volume24hUsd < 100000 ? 'high' : p.volume24hUsd < 1000000 ? 'medium' : 'low'
      const profitPer10kUsd = Math.round(netProfitPct * 100) // cents per $10,000 traded

      // Decision layer
      const ob = orderbooks[i] ?? { bids: [], asks: [] }
      const asks = (ob.asks as Array<{ price: string; quantity: string }>).slice(0, 10)
      const slippageEstimatePct = estimateSlippage(asks, TRADE_SIZE_KRW)
      const transferTimeMin = getTransferTime(p.coin)
      const trendData = trends[i] ?? { trend: 'stable' as const, volatilityPct: 0 }
      const { trend: premiumTrend, volatilityPct } = trendData
      const { action, confidence, reason } = computeAction(
        netProfitPct, slippageEstimatePct, transferTimeMin, volatilityPct,
      )

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
        // Decision layer fields
        slippageEstimatePct: round2(slippageEstimatePct),
        transferTimeMin,
        premiumTrend,
        action,
        confidence,
        reason,
      }
    })
    .sort((a, b) => b.netProfitPct - a.netProfitPct)

  const profitable = opportunities.filter((o) => o.profitable)
  const executeCandidates = opportunities.filter((o) => o.action === 'EXECUTE').length
  const marketCondition: 'favorable' | 'neutral' | 'unfavorable' =
    executeCandidates >= 3 ? 'favorable' : executeCandidates >= 1 ? 'neutral' : 'unfavorable'

  return c.json({
    paid: true,
    service: 'crossfin-arbitrage-opportunities',
    krwUsdRate: krwRate,
    totalOpportunities: opportunities.length,
    profitableCount: profitable.length,
    executeCandidates,
    marketCondition,
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

app.get('/api/premium/bithumb/volume-analysis', async (c) => {
  const [bithumbData, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchKrwRate(),
  ])

  const coins: Array<{ coin: string; volume24hKrw: number; change24hPct: number }> = []
  for (const [coin, data] of Object.entries(bithumbData)) {
    if (coin === 'date' || typeof data !== 'object' || !data) continue
    const d = data as Record<string, string>
    if (!d.closing_price) continue

    const volume24hKrw = parseFloat(d.acc_trade_value_24H || '0')
    if (!Number.isFinite(volume24hKrw) || volume24hKrw <= 0) continue

    const change24hPct = parseFloat(d.fluctate_rate_24H || '0')
    coins.push({
      coin,
      volume24hKrw,
      change24hPct: Number.isFinite(change24hPct) ? change24hPct : 0,
    })
  }

  const totalVolume24hKrw = coins.reduce((s, c) => s + c.volume24hKrw, 0)
  const totalCoins = coins.length
  const avgVolume24hKrw = totalCoins > 0 ? totalVolume24hKrw / totalCoins : 0

  const volumeWeightedChangePct = totalVolume24hKrw > 0
    ? round2(coins.reduce((s, c) => s + (c.change24hPct * c.volume24hKrw), 0) / totalVolume24hKrw)
    : 0

  const sortedByVolume = [...coins].sort((a, b) => b.volume24hKrw - a.volume24hKrw)
  const withShare = (row: { coin: string; volume24hKrw: number; change24hPct: number }) => {
    const sharePct = totalVolume24hKrw > 0 ? (row.volume24hKrw / totalVolume24hKrw) * 100 : 0
    return {
      coin: row.coin,
      volume24hKrw: row.volume24hKrw,
      volume24hUsd: round2(row.volume24hKrw / krwRate),
      change24hPct: round2(row.change24hPct),
      volumeSharePct: round2(sharePct),
    }
  }

  const top5 = sortedByVolume.slice(0, 5)
  const top5Volume = top5.reduce((s, c) => s + c.volume24hKrw, 0)
  const top5Pct = totalVolume24hKrw > 0 ? round2((top5Volume / totalVolume24hKrw) * 100) : 0

  const unusualVolume = avgVolume24hKrw > 0
    ? sortedByVolume
        .filter((c) => c.volume24hKrw > avgVolume24hKrw * 2)
        .slice(0, 50)
        .map((c) => ({
          ...withShare(c),
          multipleOfAvg: round2(c.volume24hKrw / avgVolume24hKrw),
        }))
    : []

  return c.json({
    paid: true,
    service: 'crossfin-bithumb-volume',
    totalVolume24hKrw: round2(totalVolume24hKrw),
    totalVolume24hUsd: round2(totalVolume24hKrw / krwRate),
    totalCoins,
    volumeConcentration: {
      top5Pct,
      top5Coins: top5.map((c) => withShare(c)),
    },
    volumeWeightedChangePct,
    unusualVolume,
    topByVolume: sortedByVolume.slice(0, 15).map((c) => withShare(c)),
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

app.get('/api/premium/market/fx/usdkrw', async (c) => {
  const krwRate = await fetchKrwRate()
  return c.json({
    paid: true,
    service: 'crossfin-usdkrw',
    usdKrw: krwRate,
    source: 'open.er-api.com',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/upbit/ticker', async (c) => {
  const market = requireUpbitMarket(c.req.query('market') ?? 'KRW-BTC')
  const [ticker, krwRate] = await Promise.all([
    fetchUpbitTicker(market),
    fetchKrwRate(),
  ])

  const tradePriceKrw = typeof ticker.trade_price === 'number' ? ticker.trade_price : Number(ticker.trade_price ?? 0)
  const changeRate = typeof ticker.signed_change_rate === 'number' ? ticker.signed_change_rate : Number(ticker.signed_change_rate ?? 0)
  const highPriceKrw = typeof ticker.high_price === 'number' ? ticker.high_price : Number(ticker.high_price ?? 0)
  const lowPriceKrw = typeof ticker.low_price === 'number' ? ticker.low_price : Number(ticker.low_price ?? 0)
  const volume24hKrw = typeof ticker.acc_trade_price_24h === 'number' ? ticker.acc_trade_price_24h : Number(ticker.acc_trade_price_24h ?? 0)

  return c.json({
    paid: true,
    service: 'crossfin-upbit-ticker',
    market,
    tradePriceKrw,
    tradePriceUsd: Math.round(tradePriceKrw / krwRate * 100) / 100,
    change24hPct: Math.round(changeRate * 10000) / 100,
    highPriceKrw,
    lowPriceKrw,
    volume24hKrw,
    volume24hUsd: Math.round(volume24hKrw / krwRate),
    krwUsdRate: krwRate,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/upbit/orderbook', async (c) => {
  const market = requireUpbitMarket(c.req.query('market') ?? 'KRW-BTC')
  const [orderbook, krwRate] = await Promise.all([
    fetchUpbitOrderbook(market),
    fetchKrwRate(),
  ])

  const unitsRaw = orderbook.orderbook_units
  const units = Array.isArray(unitsRaw)
    ? unitsRaw
        .filter((u): u is Record<string, unknown> => isRecord(u))
        .slice(0, 20)
        .map((u) => ({
          bidPrice: Number(u.bid_price ?? 0),
          bidSize: Number(u.bid_size ?? 0),
          askPrice: Number(u.ask_price ?? 0),
          askSize: Number(u.ask_size ?? 0),
        }))
    : []

  const bestBidKrw = units[0]?.bidPrice ?? 0
  const bestAskKrw = units[0]?.askPrice ?? 0
  const spreadKrw = bestAskKrw - bestBidKrw
  const spreadPct = bestBidKrw > 0 ? Math.round((spreadKrw / bestBidKrw) * 10000) / 100 : 0

  return c.json({
    paid: true,
    service: 'crossfin-upbit-orderbook',
    market,
    bestBidKrw,
    bestAskKrw,
    spreadKrw,
    spreadPct,
    bestBidUsd: Math.round(bestBidKrw / krwRate * 100) / 100,
    bestAskUsd: Math.round(bestAskKrw / krwRate * 100) / 100,
    units,
    krwUsdRate: krwRate,
    at: new Date().toISOString(),
  })
})

type UpbitVolumeSignal = 'high' | 'normal' | 'low'
type UpbitMomentum = 'strong-up' | 'up' | 'neutral' | 'down' | 'strong-down'
type UpbitTradingSignal = 'bullish' | 'bearish' | 'neutral'
type UpbitSignalConfidence = 'high' | 'medium' | 'low'

function upbitMomentumBucket(change24hPct: number): UpbitMomentum {
  if (change24hPct >= 4) return 'strong-up'
  if (change24hPct >= 1) return 'up'
  if (change24hPct <= -4) return 'strong-down'
  if (change24hPct <= -1) return 'down'
  return 'neutral'
}

function upbitVolumeBucket(volume24hKrw: number, avgVolume24hKrw: number): UpbitVolumeSignal {
  if (!(avgVolume24hKrw > 0)) return 'normal'
  if (volume24hKrw >= avgVolume24hKrw * 1.5) return 'high'
  if (volume24hKrw <= avgVolume24hKrw * 0.5) return 'low'
  return 'normal'
}

function upbitSignalFrom(
  change24hPct: number,
  momentum: UpbitMomentum,
  volumeSignal: UpbitVolumeSignal,
  volatilityPct: number,
): { signal: UpbitTradingSignal; confidence: UpbitSignalConfidence } {
  let signal: UpbitTradingSignal = 'neutral'
  if ((momentum === 'up' || momentum === 'strong-up') && change24hPct > 1 && volumeSignal !== 'low') {
    signal = 'bullish'
  } else if ((momentum === 'down' || momentum === 'strong-down') && change24hPct < -1 && volumeSignal !== 'low') {
    signal = 'bearish'
  }

  const absChange = Math.abs(change24hPct)
  let confidence: UpbitSignalConfidence = 'low'
  if (signal !== 'neutral') {
    if (absChange >= 4 && volumeSignal === 'high' && volatilityPct <= 10) confidence = 'high'
    else if (absChange >= 2 && volumeSignal !== 'low' && volatilityPct <= 15) confidence = 'medium'
  }
  return { signal, confidence }
}

app.get('/api/premium/market/upbit/signals', async (c) => {
  const markets = ['KRW-BTC', 'KRW-ETH', 'KRW-XRP', 'KRW-SOL', 'KRW-DOGE', 'KRW-ADA'] as const

  const tickers = await Promise.all(
    markets.map(async (market) => ({ market, ticker: await fetchUpbitTicker(market) })),
  )

  const base = tickers.map(({ market, ticker }) => {
    const tradePriceKrw = typeof ticker.trade_price === 'number' ? ticker.trade_price : Number(ticker.trade_price ?? 0)
    const changeRate = typeof ticker.signed_change_rate === 'number' ? ticker.signed_change_rate : Number(ticker.signed_change_rate ?? 0)
    const highPriceKrw = typeof ticker.high_price === 'number' ? ticker.high_price : Number(ticker.high_price ?? 0)
    const lowPriceKrw = typeof ticker.low_price === 'number' ? ticker.low_price : Number(ticker.low_price ?? 0)
    const volume24hKrw = typeof ticker.acc_trade_price_24h === 'number' ? ticker.acc_trade_price_24h : Number(ticker.acc_trade_price_24h ?? 0)

    const change24hPct = round2((Number.isFinite(changeRate) ? changeRate : 0) * 100)
    const price = Number.isFinite(tradePriceKrw) ? tradePriceKrw : 0
    const hi = Number.isFinite(highPriceKrw) ? highPriceKrw : 0
    const lo = Number.isFinite(lowPriceKrw) ? lowPriceKrw : 0
    const vol = Number.isFinite(volume24hKrw) ? volume24hKrw : 0
    const volatilityPct = price > 0 ? round2(((Math.max(hi, lo) - Math.min(hi, lo)) / price) * 100) : 0

    return {
      market,
      priceKrw: round2(price),
      change24hPct,
      volume24hKrw: round2(vol),
      volatilityPct,
    }
  })

  const avgVolume24hKrw = base.length > 0 ? base.reduce((s, r) => s + r.volume24hKrw, 0) / base.length : 0

  const signals = base.map((row) => {
    const volumeSignal = upbitVolumeBucket(row.volume24hKrw, avgVolume24hKrw)
    const momentum = upbitMomentumBucket(row.change24hPct)
    const derived = upbitSignalFrom(row.change24hPct, momentum, volumeSignal, row.volatilityPct)
    return {
      market: row.market,
      priceKrw: row.priceKrw,
      change24hPct: row.change24hPct,
      volume24hKrw: row.volume24hKrw,
      volatilityPct: row.volatilityPct,
      volumeSignal,
      momentum,
      signal: derived.signal,
      confidence: derived.confidence,
    }
  })

  const bullishCount = signals.filter((s) => s.signal === 'bullish').length
  const bearishCount = signals.filter((s) => s.signal === 'bearish').length
  const neutralCount = signals.length - bullishCount - bearishCount

  const overallSentiment: UpbitTradingSignal = bullishCount >= bearishCount + 2
    ? 'bullish'
    : bearishCount >= bullishCount + 2
      ? 'bearish'
      : 'neutral'

  return c.json({
    paid: true,
    service: 'crossfin-upbit-signals',
    signals,
    marketSummary: {
      bullishCount,
      bearishCount,
      neutralCount,
      overallSentiment,
    },
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/coinone/ticker', async (c) => {
  const currency = requireSymbol(c.req.query('currency') ?? 'BTC', 'currency')
  const [ticker, krwRate] = await Promise.all([
    fetchCoinoneTicker(currency),
    fetchKrwRate(),
  ])

  const lastKrw = Number(ticker.last ?? 0)
  const highKrw = Number(ticker.high ?? 0)
  const lowKrw = Number(ticker.low ?? 0)
  const firstKrw = Number(ticker.first ?? 0)
  const volume24hKrw = Number(ticker.quote_volume ?? 0)

  return c.json({
    paid: true,
    service: 'crossfin-coinone-ticker',
    currency,
    lastKrw,
    lastUsd: Math.round(lastKrw / krwRate * 100) / 100,
    highKrw,
    lowKrw,
    firstKrw,
    volume24hKrw,
    volume24hUsd: Math.round(volume24hKrw / krwRate),
    krwUsdRate: krwRate,
    at: new Date().toISOString(),
  })
})

// ── KOSPI / KOSDAQ Korean Stock Market Index ──────────────────────────
app.get('/api/premium/market/korea/indices', async (c) => {
  const [kospiRes, kosdaqRes] = await Promise.all([
    fetch('https://m.stock.naver.com/api/index/KOSPI/basic'),
    fetch('https://m.stock.naver.com/api/index/KOSDAQ/basic'),
  ])

  if (!kospiRes.ok || !kosdaqRes.ok) {
    throw new HTTPException(502, { message: 'Korean stock market data unavailable' })
  }

  const [kospiRaw, kosdaqRaw] = await Promise.all([kospiRes.json(), kosdaqRes.json()]) as [any, any]

  const parseIndex = (raw: any) => ({
    name: raw.stockName ?? raw.itemCode,
    code: raw.itemCode,
    price: parseFloat((raw.closePrice ?? '0').replace(/,/g, '')),
    change: parseFloat((raw.compareToPreviousClosePrice ?? '0').replace(/,/g, '')),
    changePct: parseFloat(raw.fluctuationsRatio ?? '0'),
    direction: raw.compareToPreviousPrice?.name ?? 'UNCHANGED',
    marketStatus: raw.marketStatus ?? 'UNKNOWN',
    tradedAt: raw.localTradedAt ?? null,
  })

  return c.json({
    paid: true,
    service: 'crossfin-korea-indices',
    kospi: parseIndex(kospiRaw),
    kosdaq: parseIndex(kosdaqRaw),
    source: 'naver-finance',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/korea/indices/history', async (c) => {
  const days = Math.min(60, Math.max(1, Number(c.req.query('days') ?? '20')))
  const index = (c.req.query('index') ?? 'KOSPI').toUpperCase()
  if (index !== 'KOSPI' && index !== 'KOSDAQ') {
    throw new HTTPException(400, { message: 'index must be KOSPI or KOSDAQ' })
  }

  const res = await fetch(`https://m.stock.naver.com/api/index/${index}/price?pageSize=${days}`)
  if (!res.ok) {
    throw new HTTPException(502, { message: `${index} historical data unavailable` })
  }

  const rawData = await res.json() as any[]

  const history = rawData.map((item: any) => ({
    date: item.localTradedAt,
    open: parseFloat((item.openPrice ?? '0').replace(/,/g, '')),
    high: parseFloat((item.highPrice ?? '0').replace(/,/g, '')),
    low: parseFloat((item.lowPrice ?? '0').replace(/,/g, '')),
    close: parseFloat((item.closePrice ?? '0').replace(/,/g, '')),
    change: parseFloat((item.compareToPreviousClosePrice ?? '0').replace(/,/g, '')),
    changePct: parseFloat(item.fluctuationsRatio ?? '0'),
    direction: item.compareToPreviousPrice?.name ?? 'UNCHANGED',
  }))

  return c.json({
    paid: true,
    service: 'crossfin-korea-indices-history',
    index,
    days: history.length,
    history,
    source: 'naver-finance',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/korea/stocks/momentum', async (c) => {
  const market = (c.req.query('market') ?? 'KOSPI').toUpperCase()
  if (market !== 'KOSPI' && market !== 'KOSDAQ') {
    throw new HTTPException(400, { message: 'market must be KOSPI or KOSDAQ' })
  }

  const baseUrl = 'https://m.stock.naver.com/api/stocks'
  const [capRes, upRes, downRes] = await Promise.all([
    fetch(`${baseUrl}/marketValue/${market}?page=1&pageSize=10`),
    fetch(`${baseUrl}/up/${market}?page=1&pageSize=5`),
    fetch(`${baseUrl}/down/${market}?page=1&pageSize=5`),
  ])

  if (!capRes.ok || !upRes.ok || !downRes.ok) {
    throw new HTTPException(502, { message: 'Korean stock ranking data unavailable' })
  }

  const [capData, upData, downData] = await Promise.all([capRes.json(), upRes.json(), downRes.json()]) as [any, any, any]

  const parseStock = (s: any) => ({
    code: s.itemCode,
    name: s.stockName,
    price: parseFloat((s.closePrice ?? '0').replace(/,/g, '')),
    change: parseFloat((s.compareToPreviousClosePrice ?? '0').replace(/,/g, '')),
    changePct: parseFloat(s.fluctuationsRatio ?? '0'),
    direction: s.compareToPreviousPrice?.name ?? 'UNCHANGED',
    volume: parseFloat((s.accumulatedTradingVolume ?? '0').replace(/,/g, '')),
    marketCap: s.marketValueHangeul ?? null,
  })

  return c.json({
    paid: true,
    service: 'crossfin-korea-stocks-momentum',
    market,
    topMarketCap: (capData.stocks ?? []).map(parseStock),
    topGainers: (upData.stocks ?? []).map(parseStock),
    topLosers: (downData.stocks ?? []).map(parseStock),
    source: 'naver-finance',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/korea/investor-flow', async (c) => {
  const stock = (c.req.query('stock') ?? '005930').trim()
  if (!/^\d{6}$/.test(stock)) throw new HTTPException(400, { message: 'stock must be 6-digit code (e.g., 005930)' })

  const res = await fetch(`https://m.stock.naver.com/api/stock/${stock}/trend`)
  if (!res.ok) throw new HTTPException(502, { message: 'Investor flow data unavailable' })
  const rawData = await res.json() as any[]

  const flow = rawData.map((d: any) => ({
    date: d.bizdate,
    foreignNetBuy: d.foreignerPureBuyQuant,
    foreignHoldRatio: d.foreignerHoldRatio,
    institutionNetBuy: d.organPureBuyQuant,
    individualNetBuy: d.individualPureBuyQuant,
    closePrice: d.closePrice,
    direction: d.compareToPreviousPrice?.name ?? 'UNCHANGED',
    volume: d.accumulatedTradingVolume,
  }))

  return c.json({
    paid: true,
    service: 'crossfin-korea-investor-flow',
    stock,
    days: flow.length,
    flow,
    source: 'naver-finance',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/korea/index-flow', async (c) => {
  const index = (c.req.query('index') ?? 'KOSPI').toUpperCase()
  if (index !== 'KOSPI' && index !== 'KOSDAQ' && index !== 'KPI200') {
    throw new HTTPException(400, { message: 'index must be KOSPI, KOSDAQ, or KPI200' })
  }

  const res = await fetch(`https://m.stock.naver.com/api/index/${index}/trend`)
  if (!res.ok) throw new HTTPException(502, { message: 'Index investor flow data unavailable' })
  const raw = await res.json() as any

  return c.json({
    paid: true,
    service: 'crossfin-korea-index-flow',
    index,
    date: raw.bizdate,
    foreignNetBuyBillionKrw: raw.foreignValue,
    institutionNetBuyBillionKrw: raw.institutionalValue,
    individualNetBuyBillionKrw: raw.personalValue,
    source: 'naver-finance',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/crypto/korea/5exchange', async (c) => {
  const coin = (c.req.query('coin') ?? 'BTC').toUpperCase()

  const [upbitRes, bithumbRes, coinoneRes, gopaxRes] = await Promise.allSettled([
    fetch(`https://api.upbit.com/v1/ticker?markets=KRW-${coin}`).then(r => r.json()),
    fetch(`https://api.bithumb.com/public/ticker/${coin}_KRW`).then(r => r.json()),
    fetch(`https://api.coinone.co.kr/ticker?currency=${coin.toLowerCase()}`).then(r => r.json()),
    fetch(`https://api.gopax.co.kr/trading-pairs/${coin}-KRW/ticker`).then(r => r.json()),
  ])

  const exchanges: any[] = []
  if (upbitRes.status === 'fulfilled' && Array.isArray(upbitRes.value) && upbitRes.value[0]) {
    const d = upbitRes.value[0]
    exchanges.push({ exchange: 'Upbit', priceKrw: d.trade_price, volume24h: d.acc_trade_volume_24h, change24hPct: d.signed_change_rate ? d.signed_change_rate * 100 : null })
  }
  if (bithumbRes.status === 'fulfilled' && (bithumbRes.value as any)?.data?.closing_price) {
    const d = (bithumbRes.value as any).data
    exchanges.push({ exchange: 'Bithumb', priceKrw: Number(d.closing_price), volume24h: Number(d.units_traded_24H || 0), change24hPct: Number(d.fluctate_rate_24H || 0) })
  }
  if (coinoneRes.status === 'fulfilled' && (coinoneRes.value as any)?.last) {
    const d = coinoneRes.value as any
    exchanges.push({ exchange: 'Coinone', priceKrw: Number(d.last), volume24h: Number(d.volume || 0), change24hPct: null })
  }
  if (gopaxRes.status === 'fulfilled' && (gopaxRes.value as any)?.price) {
    const d = gopaxRes.value as any
    exchanges.push({ exchange: 'GoPax', priceKrw: d.price, volume24h: d.volume || 0, change24hPct: null })
  }

  const prices = exchanges.map(e => e.priceKrw).filter(p => p > 0)
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0
  const spreadPct = minPrice > 0 ? Math.round((maxPrice - minPrice) / minPrice * 10000) / 100 : 0

  return c.json({
    paid: true,
    service: 'crossfin-crypto-5exchange',
    coin,
    exchangeCount: exchanges.length,
    exchanges,
    spread: { minPriceKrw: minPrice, maxPriceKrw: maxPrice, spreadPct },
    source: 'upbit+bithumb+coinone+gopax',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/crypto/korea/exchange-status', async (c) => {
  const res = await fetch('https://api.bithumb.com/public/assetsstatus/ALL')
  if (!res.ok) throw new HTTPException(502, { message: 'Exchange status data unavailable' })
  const raw: unknown = await res.json()
  const data = isRecord(raw) && isRecord(raw.data) ? raw.data : {}

  const coins: Array<{ symbol: string; withdrawalEnabled: boolean; depositEnabled: boolean }> = []
  let disabledCount = 0
  for (const [symbol, status] of Object.entries(data)) {
    const s = isRecord(status) ? status : {}
    const withdrawalOk = s.withdrawal_status === 1
    const depositOk = s.deposit_status === 1
    if (!withdrawalOk || !depositOk) disabledCount++
    coins.push({ symbol, withdrawalEnabled: withdrawalOk, depositEnabled: depositOk })
  }

  coins.sort((a, b) => {
    const aDisabled = !a.withdrawalEnabled || !a.depositEnabled ? 0 : 1
    const bDisabled = !b.withdrawalEnabled || !b.depositEnabled ? 0 : 1
    return aDisabled - bDisabled
  })

  return c.json({
    paid: true,
    service: 'crossfin-crypto-exchange-status',
    exchange: 'Bithumb',
    totalCoins: coins.length,
    disabledCount,
    coins,
    source: 'bithumb-public-api',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/korea/stock-detail', async (c) => {
  const stock = (c.req.query('stock') ?? '005930').trim()
  if (!/^\d{6}$/.test(stock)) throw new HTTPException(400, { message: 'stock must be 6-digit code' })

  const res = await fetch(`https://m.stock.naver.com/api/stock/${stock}/integration`)
  if (!res.ok) throw new HTTPException(502, { message: 'Stock detail data unavailable' })
  const raw = await res.json() as any

  const infos: Record<string, string> = {}
  for (const item of (raw.totalInfos ?? [])) {
    infos[item.key] = item.value
  }

  const consensus = raw.consensusInfo ?? null
  const industryPeers = (raw.industryCompareInfo ?? []).map((s: any) => ({
    code: s.itemCode,
    name: s.stockName,
    price: s.closePrice,
    changePct: s.fluctuationsRatio,
    direction: s.compareToPreviousPrice?.name ?? 'UNCHANGED',
  }))

  return c.json({
    paid: true,
    service: 'crossfin-korea-stock-detail',
    stock,
    name: raw.stockName,
    metrics: infos,
    consensus: consensus ? {
      targetPrice: consensus.priceTargetMean,
      recommendation: consensus.recommMean,
      date: consensus.createDate,
    } : null,
    industryPeers,
    source: 'naver-finance',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/korea/stock-news', async (c) => {
  const stock = (c.req.query('stock') ?? '005930').trim()
  const page = Math.max(1, Number(c.req.query('page') ?? '1') || 1)
  const pageSize = Math.min(20, Math.max(1, Number(c.req.query('pageSize') ?? '10') || 10))
  if (!/^\d{6}$/.test(stock)) throw new HTTPException(400, { message: 'stock must be 6-digit code' })

  const res = await fetch(`https://m.stock.naver.com/api/news/stock/${stock}?page=${page}&pageSize=${pageSize}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Stock news data unavailable' })
  const rawArr = await res.json() as any[]
  const raw = Array.isArray(rawArr) && rawArr.length > 0 ? rawArr[0] : { total: 0, items: [] }

  return c.json({
    paid: true,
    service: 'crossfin-korea-stock-news',
    stock,
    total: raw.total ?? 0,
    items: (raw.items ?? []).map((i: any) => ({
      id: i.id,
      title: i.title,
      body: i.body,
      publisher: i.officeName,
      datetime: i.datetime,
    })),
    source: 'naver-finance',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/korea/themes', async (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? '1') || 1)
  const pageSize = Math.min(50, Math.max(1, Number(c.req.query('pageSize') ?? '20') || 20))

  const res = await fetch(`https://m.stock.naver.com/api/stocks/theme?page=${page}&pageSize=${pageSize}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Theme data unavailable' })
  const raw = await res.json() as any

  return c.json({
    paid: true,
    service: 'crossfin-korea-themes',
    themes: (raw.groups ?? []).map((g: any) => ({
      no: g.no,
      name: g.name,
      totalCount: g.totalCount,
      changeRate: g.changeRate,
      riseCount: g.riseCount,
      fallCount: g.fallCount,
    })),
    source: 'naver-finance',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/korea/disclosure', async (c) => {
  const stock = (c.req.query('stock') ?? '005930').trim()
  const page = Math.max(1, Number(c.req.query('page') ?? '1') || 1)
  const pageSize = Math.min(20, Math.max(1, Number(c.req.query('pageSize') ?? '10') || 10))
  if (!/^\d{6}$/.test(stock)) throw new HTTPException(400, { message: 'stock must be 6-digit code' })

  const res = await fetch(`https://m.stock.naver.com/api/stock/${stock}/disclosure?page=${page}&pageSize=${pageSize}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Disclosure data unavailable' })
  const raw = await res.json() as any[]

  return c.json({
    paid: true,
    service: 'crossfin-korea-disclosure',
    stock,
    items: raw.map((d: any) => ({
      title: d.title,
      datetime: d.datetime,
    })),
    source: 'naver-finance',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/korea/stock-brief', async (c) => {
  const stock = (c.req.query('stock') ?? '').trim()
  if (!stock) throw new HTTPException(400, { message: 'stock is required' })
  if (!/^\d{6}$/.test(stock)) throw new HTTPException(400, { message: 'stock must be 6-digit code (e.g., 005930)' })

  const at = new Date().toISOString()

  const detailTask = (async () => {
    const res = await fetch(`https://m.stock.naver.com/api/stock/${stock}/integration`)
    if (!res.ok) throw new Error(`Stock detail data unavailable (${res.status})`)
    const raw: unknown = await res.json()
    if (!isRecord(raw)) throw new Error('Stock detail invalid response')

    const infos: Record<string, string> = {}
    const totalInfos = Array.isArray(raw.totalInfos) ? raw.totalInfos : []
    for (const item of totalInfos) {
      if (!isRecord(item)) continue
      const key = typeof item.key === 'string' ? item.key : String(item.key ?? '')
      const value = typeof item.value === 'string' ? item.value : String(item.value ?? '')
      if (!key) continue
      infos[key] = value
    }

    const consensus = isRecord(raw.consensusInfo) ? raw.consensusInfo : null

    const industryRaw = Array.isArray(raw.industryCompareInfo) ? raw.industryCompareInfo : []
    const industryPeers = industryRaw
      .map((s): { code: string; name: string; price: unknown; changePct: unknown; direction: string } | null => {
        if (!isRecord(s)) return null
        const direction = isRecord(s.compareToPreviousPrice) && typeof s.compareToPreviousPrice.name === 'string'
          ? s.compareToPreviousPrice.name
          : 'UNCHANGED'

        return {
          code: typeof s.itemCode === 'string' ? s.itemCode : String(s.itemCode ?? ''),
          name: typeof s.stockName === 'string' ? s.stockName : String(s.stockName ?? ''),
          price: s.closePrice,
          changePct: s.fluctuationsRatio,
          direction,
        }
      })
      .filter((v): v is { code: string; name: string; price: unknown; changePct: unknown; direction: string } => v !== null)

    return {
      stock,
      name: typeof raw.stockName === 'string' ? raw.stockName : String(raw.stockName ?? ''),
      metrics: infos,
      consensus: consensus ? {
        targetPrice: typeof consensus.priceTargetMean === 'string' ? consensus.priceTargetMean : String(consensus.priceTargetMean ?? ''),
        recommendation: typeof consensus.recommMean === 'string' ? consensus.recommMean : String(consensus.recommMean ?? ''),
        date: typeof consensus.createDate === 'string' ? consensus.createDate : String(consensus.createDate ?? ''),
      } : null,
      industryPeers,
      source: 'naver-finance',
    }
  })()

  const newsTask = (async () => {
    const page = 1
    const pageSize = 5
    const res = await fetch(`https://m.stock.naver.com/api/news/stock/${stock}?page=${page}&pageSize=${pageSize}`)
    if (!res.ok) throw new Error(`Stock news data unavailable (${res.status})`)
    const rawArr: unknown = await res.json()
    const raw0 = Array.isArray(rawArr) && rawArr.length > 0 ? rawArr[0] : null
    const raw = isRecord(raw0) ? raw0 : { items: [] as unknown[] }
    const itemsRaw = Array.isArray(raw.items) ? raw.items : []

    return itemsRaw.map((i) => {
      if (!isRecord(i)) return { id: null, title: '', body: '', publisher: null, datetime: '' }
      return {
        id: typeof i.id === 'number' ? i.id : typeof i.id === 'string' ? Number(i.id) : null,
        title: typeof i.title === 'string' ? i.title : String(i.title ?? ''),
        body: typeof i.body === 'string' ? i.body : String(i.body ?? ''),
        publisher: typeof i.officeName === 'string' ? i.officeName : null,
        datetime: typeof i.datetime === 'string' ? i.datetime : String(i.datetime ?? ''),
      }
    }).slice(0, 5)
  })()

  const investorFlowTask = (async () => {
    const res = await fetch(`https://m.stock.naver.com/api/stock/${stock}/trend`)
    if (!res.ok) throw new Error(`Investor flow data unavailable (${res.status})`)
    const rawData: unknown = await res.json()
    const rows = Array.isArray(rawData) ? rawData : []

    const flow = rows.map((d) => {
      if (!isRecord(d)) {
        return {
          date: '',
          foreignNetBuy: null,
          foreignHoldRatio: null,
          institutionNetBuy: null,
          individualNetBuy: null,
          closePrice: null,
          direction: 'UNCHANGED',
          volume: null,
        }
      }

      const direction = isRecord(d.compareToPreviousPrice) && typeof d.compareToPreviousPrice.name === 'string'
        ? d.compareToPreviousPrice.name
        : 'UNCHANGED'

      return {
        date: typeof d.bizdate === 'string' ? d.bizdate : String(d.bizdate ?? ''),
        foreignNetBuy: d.foreignerPureBuyQuant ?? null,
        foreignHoldRatio: d.foreignerHoldRatio ?? null,
        institutionNetBuy: d.organPureBuyQuant ?? null,
        individualNetBuy: d.individualPureBuyQuant ?? null,
        closePrice: d.closePrice ?? null,
        direction,
        volume: d.accumulatedTradingVolume ?? null,
      }
    })

    return {
      stock,
      days: flow.length,
      flow,
      source: 'naver-finance',
    }
  })()

  const disclosureTask = (async () => {
    const page = 1
    const pageSize = 5
    const res = await fetch(`https://m.stock.naver.com/api/stock/${stock}/disclosure?page=${page}&pageSize=${pageSize}`)
    if (!res.ok) throw new Error(`Disclosure data unavailable (${res.status})`)
    const raw: unknown = await res.json()
    const itemsRaw = Array.isArray(raw) ? raw : []

    return itemsRaw.map((d) => {
      if (!isRecord(d)) return { title: '', datetime: '' }
      return {
        title: typeof d.title === 'string' ? d.title : String(d.title ?? ''),
        datetime: typeof d.datetime === 'string' ? d.datetime : String(d.datetime ?? ''),
      }
    }).slice(0, 5)
  })()

  const [detailSet, newsSet, investorFlowSet, disclosureSet] = await Promise.allSettled([
    detailTask,
    newsTask,
    investorFlowTask,
    disclosureTask,
  ] as const)

  const detail = detailSet.status === 'fulfilled' ? detailSet.value : null
  const news = newsSet.status === 'fulfilled' ? newsSet.value : []
  const investorFlow = investorFlowSet.status === 'fulfilled' ? investorFlowSet.value : null
  const disclosures = disclosureSet.status === 'fulfilled' ? disclosureSet.value : []

  return c.json({
    paid: true,
    service: 'crossfin-stock-brief',
    stock,
    name: detail?.name ?? null,
    detail,
    news,
    investorFlow,
    disclosures,
    at,
  })
})

app.get('/api/premium/crypto/korea/fx-rate', async (c) => {
  const res = await fetch('https://crix-api-cdn.upbit.com/v1/forex/recent?codes=FRX.KRWUSD')
  if (!res.ok) throw new HTTPException(502, { message: 'FX rate data unavailable' })
  const data = await res.json() as any[]
  const quote = data[0]

  return c.json({
    paid: true,
    service: 'crossfin-korea-fx-rate',
    pair: 'KRW/USD',
    basePrice: quote.basePrice,
    change: quote.change,
    changePrice: quote.changePrice,
    openingPrice: quote.openingPrice,
    high52w: quote.high52wPrice,
    low52w: quote.low52wPrice,
    source: 'upbit-crix',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/korea/etf', async (c) => {
  const res = await fetch('https://finance.naver.com/api/sise/etfItemList.nhn')
  if (!res.ok) throw new HTTPException(502, { message: 'ETF data unavailable' })
  const buf = await res.arrayBuffer()
  const text = new TextDecoder('euc-kr').decode(buf)
  const raw = JSON.parse(text) as any

  return c.json({
    paid: true,
    service: 'crossfin-korea-etf',
    totalCount: raw.result.etfItemList.length,
    items: raw.result.etfItemList.slice(0, 50).map((e: any) => ({
      name: e.itemname,
      code: e.itemcode,
      price: e.nowVal,
      changeVal: e.changeVal,
      changeRate: e.changeRate,
      nav: e.nav,
      volume: e.quant,
      threeMonthReturn: e.threeMonthEarnRate,
      marketCap: e.marketSum,
    })),
    source: 'naver-finance',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/crypto/korea/upbit-candles', async (c) => {
  const coin = (c.req.query('coin') ?? 'BTC').toUpperCase().trim()
  const type = (c.req.query('type') ?? 'days').trim()
  const count = Math.min(200, Math.max(1, Number(c.req.query('count') ?? '30')))

  const validTypes = ['minutes/1', 'minutes/3', 'minutes/5', 'minutes/10', 'minutes/15', 'minutes/30', 'minutes/60', 'minutes/240', 'days', 'weeks', 'months']
  if (!validTypes.includes(type)) throw new HTTPException(400, { message: `type must be one of: ${validTypes.join(', ')}` })

  const market = `KRW-${coin}`
  const res = await fetch(`https://api.upbit.com/v1/candles/${type}?market=${market}&count=${count}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Upbit candle data unavailable' })
  const raw = await res.json() as any[]

  return c.json({
    paid: true,
    service: 'crossfin-upbit-candles',
    market,
    type,
    count: raw.length,
    candles: raw.map((r: any) => ({
      date: r.candle_date_time_kst,
      open: r.opening_price,
      high: r.high_price,
      low: r.low_price,
      close: r.trade_price,
      volume: r.candle_acc_trade_volume,
      tradeAmount: r.candle_acc_trade_price,
    })),
    source: 'upbit',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/global/indices-chart', async (c) => {
  const index = (c.req.query('index') ?? '.DJI').trim()
  const period = (c.req.query('period') ?? 'month').trim()

  if (!['month'].includes(period)) throw new HTTPException(400, { message: 'period must be: month' })

  const res = await fetch(`https://api.stock.naver.com/chart/foreign/index/${encodeURIComponent(index)}/${period}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Global index chart data unavailable' })
  const raw = await res.json() as any

  if (Array.isArray(raw) && raw.length === 0) throw new HTTPException(404, { message: `No data for index ${index}. Available: .DJI, .IXIC, .HSI, .N225` })
  const data = Array.isArray(raw) ? raw : []

  return c.json({
    paid: true,
    service: 'crossfin-global-indices-chart',
    index,
    period,
    count: data.length,
    candles: data.map((r: any) => ({
      date: r.localDate,
      open: r.openPrice,
      high: r.highPrice,
      low: r.lowPrice,
      close: r.closePrice,
      volume: r.accumulatedTradingVolume,
    })),
    source: 'naver-finance',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/news/korea/headlines', async (c) => {
  const limit = Math.min(20, Math.max(1, Number(c.req.query('limit') ?? '10')))
  const feedUrl = 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko'

  const res = await fetch(feedUrl, { headers: { 'User-Agent': 'crossfin-news/1.0' } })
  if (!res.ok) throw new HTTPException(502, { message: 'News feed unavailable' })
  const xml = await res.text()

  const items: Array<{ title: string; publisher: string | null; link: string; publishedAt: string }> = []
  const re = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null
  while (items.length < limit) {
    match = re.exec(xml)
    if (!match) break
    const block = match[1] ?? ''
    const rawTitle = extractXmlTag(block, 'title')
    const link = extractXmlTag(block, 'link')
    const pubDate = extractXmlTag(block, 'pubDate')
    if (!rawTitle || !link || !pubDate) continue
    const { title, publisher } = splitPublisherFromTitle(rawTitle)
    items.push({ title, publisher, link, publishedAt: parseIsoDate(pubDate) })
  }

  return c.json({
    paid: true,
    service: 'crossfin-korea-headlines',
    feed: 'google-news-rss',
    url: feedUrl,
    items,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/crypto/snapshot', async (c) => {
  const at = new Date().toISOString()
  const coin = 'BTC'

  const bithumbPromise = fetchBithumbAll()
  const globalPricesPromise = fetchGlobalPrices(c.env.DB)
  const krwRatePromise = fetchKrwRate()

  type KimchiPremiumRow = ReturnType<typeof calcPremiums>[number]
  type ExchangePrice = { krw: number; usd: number }
  type VolumeTopRow = {
    coin: string
    volume24hKrw: number
    volume24hUsd: number
    change24hPct: number
    volumeSharePct: number
  }

  const exchangesTask = (async () => {
    const fetchJson = async (url: string): Promise<unknown> => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Request failed: ${url}`)
      return res.json() as Promise<unknown>
    }

    const [upbitSet, bithumbSet, coinoneSet, gopaxSet] = await Promise.allSettled([
      fetchJson(`https://api.upbit.com/v1/ticker?markets=KRW-${coin}`),
      fetchJson(`https://api.bithumb.com/public/ticker/${coin}_KRW`),
      fetchJson(`https://api.coinone.co.kr/ticker?currency=${coin.toLowerCase()}`),
      fetchJson(`https://api.gopax.co.kr/trading-pairs/${coin}-KRW/ticker`),
    ] as const)

    const toPositiveNumber = (v: unknown): number | null => {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
      return Number.isFinite(n) && n > 0 ? n : null
    }

    let upbitKrw: number | null = null
    if (upbitSet.status === 'fulfilled') {
      const raw = upbitSet.value
      if (Array.isArray(raw) && raw.length > 0 && isRecord(raw[0])) {
        upbitKrw = toPositiveNumber(raw[0].trade_price)
      }
    }

    let bithumbKrw: number | null = null
    if (bithumbSet.status === 'fulfilled') {
      const raw = bithumbSet.value
      if (isRecord(raw) && isRecord(raw.data)) {
        bithumbKrw = toPositiveNumber(raw.data.closing_price)
      }
    }

    let coinoneKrw: number | null = null
    if (coinoneSet.status === 'fulfilled') {
      const raw = coinoneSet.value
      if (isRecord(raw)) {
        coinoneKrw = toPositiveNumber(raw.last)
      }
    }

    let gopaxKrw: number | null = null
    if (gopaxSet.status === 'fulfilled') {
      const raw = gopaxSet.value
      if (isRecord(raw)) {
        gopaxKrw = toPositiveNumber(raw.price)
      }
    }

    return {
      upbitKrw,
      bithumbKrw,
      coinoneKrw,
      gopaxKrw,
    }
  })()

  const [bithumbSet, globalSet, krwSet, exchangesSet] = await Promise.allSettled([
    bithumbPromise,
    globalPricesPromise,
    krwRatePromise,
    exchangesTask,
  ] as const)

  const usdKrw = krwSet.status === 'fulfilled' ? krwSet.value : 1450

  const kimchiPremium = (() => {
    if (bithumbSet.status !== 'fulfilled' || globalSet.status !== 'fulfilled') {
      return { avgPremiumPct: 0, topPair: '', pairsTracked: 0, premiums: [] as KimchiPremiumRow[] }
    }

    const premiums = calcPremiums(bithumbSet.value, globalSet.value, usdKrw)
    const avg = premiums.length > 0
      ? round2(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length)
      : 0

    return {
      avgPremiumPct: avg,
      topPair: premiums[0]?.coin ?? '',
      pairsTracked: premiums.length,
      premiums: premiums.slice(0, 5),
    }
  })()

  const volumeAnalysis = (() => {
    if (bithumbSet.status !== 'fulfilled') {
      return { totalVolume24hKrw: 0, totalVolume24hUsd: 0, topByVolume: [] as VolumeTopRow[] }
    }

    const bithumbData = bithumbSet.value
    const coins: Array<{ coin: string; volume24hKrw: number; change24hPct: number }> = []

    for (const [symbol, data] of Object.entries(bithumbData)) {
      if (symbol === 'date' || typeof data !== 'object' || !data) continue
      const d = data as Record<string, string>

      const volume24hKrw = parseFloat(d.acc_trade_value_24H || '0')
      if (!Number.isFinite(volume24hKrw) || volume24hKrw <= 0) continue

      const change24hPct = parseFloat(d.fluctate_rate_24H || '0')
      coins.push({
        coin: symbol,
        volume24hKrw,
        change24hPct: Number.isFinite(change24hPct) ? change24hPct : 0,
      })
    }

    const totalVolume24hKrw = coins.reduce((s, row) => s + row.volume24hKrw, 0)
    const sorted = [...coins].sort((a, b) => b.volume24hKrw - a.volume24hKrw)

    const withShare = (row: { coin: string; volume24hKrw: number; change24hPct: number }): VolumeTopRow => {
      const sharePct = totalVolume24hKrw > 0 ? (row.volume24hKrw / totalVolume24hKrw) * 100 : 0
      return {
        coin: row.coin,
        volume24hKrw: round2(row.volume24hKrw),
        volume24hUsd: round2(row.volume24hKrw / usdKrw),
        change24hPct: round2(row.change24hPct),
        volumeSharePct: round2(sharePct),
      }
    }

    return {
      totalVolume24hKrw: round2(totalVolume24hKrw),
      totalVolume24hUsd: round2(totalVolume24hKrw / usdKrw),
      topByVolume: sorted.slice(0, 5).map((row) => withShare(row)),
    }
  })()

  const exchanges = (() => {
    if (exchangesSet.status !== 'fulfilled') {
      return {
        upbit: null as ExchangePrice | null,
        bithumb: null as ExchangePrice | null,
        coinone: null as ExchangePrice | null,
        gopax: null as ExchangePrice | null,
        spread: { minUsd: 0, maxUsd: 0, spreadPct: 0 },
      }
    }

    const toExchangePrice = (krw: number | null): ExchangePrice | null => {
      if (krw === null) return null
      return { krw, usd: round2(krw / usdKrw) }
    }

    const out = {
      upbit: toExchangePrice(exchangesSet.value.upbitKrw),
      bithumb: toExchangePrice(exchangesSet.value.bithumbKrw),
      coinone: toExchangePrice(exchangesSet.value.coinoneKrw),
      gopax: toExchangePrice(exchangesSet.value.gopaxKrw),
    }

    const usdValues = [out.upbit, out.bithumb, out.coinone, out.gopax]
      .map((p) => p?.usd)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)

    const minUsd = usdValues.length > 0 ? Math.min(...usdValues) : 0
    const maxUsd = usdValues.length > 0 ? Math.max(...usdValues) : 0
    const spreadPct = minUsd > 0 ? round2(((maxUsd - minUsd) / minUsd) * 100) : 0

    return {
      ...out,
      spread: { minUsd: round2(minUsd), maxUsd: round2(maxUsd), spreadPct },
    }
  })()

  return c.json({
    paid: true,
    service: 'crossfin-crypto-snapshot',
    kimchiPremium,
    fxRate: {
      usdKrw: round2(usdKrw),
    },
    exchanges,
    volumeAnalysis,
    at,
  })
})

app.get('/api/premium/kimchi/stats', async (c) => {
  const at = new Date().toISOString()

  type KimchiPremiumRow = ReturnType<typeof calcPremiums>[number]

  const currentTask = (async () => {
    const bithumbPromise = fetchBithumbAll()
    const globalPricesPromise = fetchGlobalPrices(c.env.DB)
    const krwRatePromise = fetchKrwRate()

    const [bithumbSet, globalSet, krwSet] = await Promise.allSettled([
      bithumbPromise,
      globalPricesPromise,
      krwRatePromise,
    ] as const)

    const usdKrw = krwSet.status === 'fulfilled' ? krwSet.value : 1450

    const premiums: KimchiPremiumRow[] =
      bithumbSet.status === 'fulfilled' && globalSet.status === 'fulfilled'
        ? calcPremiums(bithumbSet.value, globalSet.value, usdKrw)
        : []

    const avgPremiumPct = premiums.length > 0
      ? round2(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length)
      : 0

    const byPct = [...premiums].sort((a, b) => b.premiumPct - a.premiumPct)
    const top = byPct[0] ?? null
    const bottom = byPct.length > 0 ? byPct[byPct.length - 1] ?? null : null

    return {
      usdKrw,
      premiums,
      avgPremiumPct,
      topPair: top ? { coin: top.coin, premiumPct: top.premiumPct } : { coin: '', premiumPct: 0 },
      bottomPair: bottom ? { coin: bottom.coin, premiumPct: bottom.premiumPct } : { coin: '', premiumPct: 0 },
      pairsTracked: premiums.length,
    }
  })()

  const trendTask = (async () => {
    try {
      const currentSql = "SELECT AVG(premium_pct) as avg FROM kimchi_snapshots WHERE datetime(created_at) >= datetime('now', '-24 hours')"
      const prevSql = "SELECT AVG(premium_pct) as avg FROM kimchi_snapshots WHERE datetime(created_at) >= datetime('now', '-48 hours') AND datetime(created_at) < datetime('now', '-24 hours')"

      const [curRow, prevRow] = await Promise.all([
        c.env.DB.prepare(currentSql).first<{ avg: number | string | null }>(),
        c.env.DB.prepare(prevSql).first<{ avg: number | string | null }>(),
      ])

      const current24hAvg = round2(Number(curRow?.avg ?? 0))
      const previous24hAvg = round2(Number(prevRow?.avg ?? 0))
      const changePct = round2(current24hAvg - previous24hAvg)

      const direction: 'rising' | 'falling' | 'stable' =
        changePct > 0.3 ? 'rising' : changePct < -0.3 ? 'falling' : 'stable'

      return { direction, current24hAvg, previous24hAvg, changePct }
    } catch {
      return { direction: 'stable' as const, current24hAvg: 0, previous24hAvg: 0, changePct: 0 }
    }
  })()

  const bestOpportunityTask = (async () => {
    try {
      const current = await currentTask
      const premiums = current.premiums
      if (premiums.length === 0) {
        return { coin: '', premiumPct: 0, action: 'SKIP' as const, confidence: 0.1, reason: 'No premium data available' }
      }

      const topPremium = premiums.reduce((best, p) => (p.premiumPct > best.premiumPct ? p : best), premiums[0]!)
      const coin = topPremium.coin
      const premiumPct = topPremium.premiumPct

      const [orderbookSet, trendSet] = await Promise.allSettled([
        fetchBithumbOrderbook(coin),
        getPremiumTrend(c.env.DB, coin, 6),
      ] as const)

      const ob = orderbookSet.status === 'fulfilled' ? orderbookSet.value : { bids: [], asks: [] }
      const asks = (ob.asks as Array<{ price: string; quantity: string }>).slice(0, 10)

      const totalFeesPct = BITHUMB_FEES_PCT + BINANCE_FEES_PCT
      const netProfitPct = Math.abs(premiumPct) - totalFeesPct
      const TRADE_SIZE_KRW = 15_000_000
      const slippageEstimatePct = estimateSlippage(asks, TRADE_SIZE_KRW)
      const transferTimeMin = getTransferTime(coin)
      const volatilityPct = trendSet.status === 'fulfilled' ? trendSet.value.volatilityPct : 0

      const { action, confidence, reason } = computeAction(
        netProfitPct,
        slippageEstimatePct,
        transferTimeMin,
        volatilityPct,
      )

      return { coin, premiumPct, action, confidence, reason }
    } catch {
      return { coin: '', premiumPct: 0, action: 'SKIP' as const, confidence: 0.1, reason: 'Failed to compute opportunity' }
    }
  })()

  const crossExchangeSpreadTask = (async () => {
    type ExchangeId = 'upbit' | 'bithumb' | 'coinone'
    const coin = 'BTC' as const

    const [upbitSet, coinoneSet, currentSet] = await Promise.allSettled([
      fetchUpbitTicker('KRW-BTC'),
      fetchCoinoneTicker('BTC'),
      currentTask,
    ] as const)

    const upbitKrw = upbitSet.status === 'fulfilled'
      ? (typeof upbitSet.value.trade_price === 'number' ? upbitSet.value.trade_price : Number(upbitSet.value.trade_price ?? NaN))
      : null

    const coinoneKrw = coinoneSet.status === 'fulfilled'
      ? Number(coinoneSet.value.last ?? NaN)
      : null

    let bithumbKrw: number | null = null
    if (currentSet.status === 'fulfilled') {
      const btcRow = currentSet.value.premiums.find((p) => p.coin === 'BTC')
      bithumbKrw = btcRow ? btcRow.bithumbKrw : null
    }

    const exchanges: Array<{ exchange: ExchangeId; priceKrw: number }> = []
    if (typeof upbitKrw === 'number' && Number.isFinite(upbitKrw) && upbitKrw > 0) exchanges.push({ exchange: 'upbit', priceKrw: upbitKrw })
    if (typeof bithumbKrw === 'number' && Number.isFinite(bithumbKrw) && bithumbKrw > 0) exchanges.push({ exchange: 'bithumb', priceKrw: bithumbKrw })
    if (typeof coinoneKrw === 'number' && Number.isFinite(coinoneKrw) && coinoneKrw > 0) exchanges.push({ exchange: 'coinone', priceKrw: coinoneKrw })

    let spreadPct = 0
    let bestBuy: string = ''
    let bestSell: string = ''
    if (exchanges.length >= 2) {
      exchanges.sort((a, b) => a.priceKrw - b.priceKrw)
      const low = exchanges[0]!
      const high = exchanges[exchanges.length - 1]!
      spreadPct = low.priceKrw > 0 ? round2(((high.priceKrw - low.priceKrw) / low.priceKrw) * 100) : 0
      bestBuy = low.exchange
      bestSell = high.exchange
    }

    const safeUpbit = typeof upbitKrw === 'number' && Number.isFinite(upbitKrw) && upbitKrw > 0 ? upbitKrw : null
    const safeCoinone = typeof coinoneKrw === 'number' && Number.isFinite(coinoneKrw) && coinoneKrw > 0 ? coinoneKrw : null
    const safeBithumb = typeof bithumbKrw === 'number' && Number.isFinite(bithumbKrw) && bithumbKrw > 0 ? bithumbKrw : null

    return {
      coin,
      upbitKrw: safeUpbit,
      bithumbKrw: safeBithumb,
      coinoneKrw: safeCoinone,
      spreadPct,
      bestBuy,
      bestSell,
    }
  })()

  const [currentSet, trendSet, opportunitySet, spreadSet] = await Promise.allSettled([
    currentTask,
    trendTask,
    bestOpportunityTask,
    crossExchangeSpreadTask,
  ] as const)

  const current = currentSet.status === 'fulfilled'
    ? currentSet.value
    : { usdKrw: 1450, premiums: [] as KimchiPremiumRow[], avgPremiumPct: 0, topPair: { coin: '', premiumPct: 0 }, bottomPair: { coin: '', premiumPct: 0 }, pairsTracked: 0 }

  const trend = trendSet.status === 'fulfilled'
    ? trendSet.value
    : { direction: 'stable' as const, current24hAvg: 0, previous24hAvg: 0, changePct: 0 }

  const bestOpportunity = opportunitySet.status === 'fulfilled'
    ? opportunitySet.value
    : { coin: '', premiumPct: 0, action: 'SKIP' as const, confidence: 0.1, reason: 'Failed to compute opportunity' }

  const crossExchangeSpread = spreadSet.status === 'fulfilled'
    ? spreadSet.value
    : { coin: 'BTC' as const, upbitKrw: null as number | null, bithumbKrw: null as number | null, coinoneKrw: null as number | null, spreadPct: 0, bestBuy: '', bestSell: '' }

  return c.json({
    paid: true,
    service: 'crossfin-kimchi-stats',
    current: {
      avgPremiumPct: current.avgPremiumPct,
      topPair: current.topPair,
      bottomPair: current.bottomPair,
      pairsTracked: current.pairsTracked,
      premiums: current.premiums,
    },
    trend,
    bestOpportunity,
    crossExchangeSpread,
    fxRate: {
      usdKrw: round2(current.usdKrw),
    },
    at,
  })
})

app.get('/api/premium/morning/brief', async (c) => {
  const at = new Date().toISOString()
  const market = 'KOSPI'

  const krwRatePromise = fetchKrwRate()

  type KimchiPremiumRow = ReturnType<typeof calcPremiums>[number]
  type HeadlinesItem = { title: string; publisher: string | null; link: string; publishedAt: string }
  type MomentumStock = {
    code: string
    name: string
    price: number
    changePct: number
    direction: string
    volume: number
  }

  const kimchiTask = (async () => {
    const [bithumbData, binancePrices, krwRate] = await Promise.all([
      fetchBithumbAll(),
      fetchGlobalPrices(c.env.DB),
      krwRatePromise,
    ])

    const premiums = calcPremiums(bithumbData, binancePrices, krwRate)
    const avg = premiums.length > 0
      ? Math.round(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length * 100) / 100
      : 0

    return {
      avgPremiumPct: avg,
      topPair: premiums[0]?.coin ?? '',
      pairsTracked: premiums.length,
      premiums: premiums.slice(0, 5),
    }
  })()

  const indicesTask = (async () => {
    const [kospiRes, kosdaqRes] = await Promise.all([
      fetch('https://m.stock.naver.com/api/index/KOSPI/basic'),
      fetch('https://m.stock.naver.com/api/index/KOSDAQ/basic'),
    ])

    if (!kospiRes.ok || !kosdaqRes.ok) {
      throw new HTTPException(502, { message: 'Korean stock market data unavailable' })
    }

    const [kospiRaw, kosdaqRaw] = await Promise.all([kospiRes.json(), kosdaqRes.json()]) as [unknown, unknown]

    const parseIndex = (raw: unknown) => {
      if (!isRecord(raw)) {
        return { price: 0, changePct: 0, volume: 0, status: 'UNKNOWN' }
      }

      const price = parseFloat(String(raw.closePrice ?? '0').replace(/,/g, ''))
      const changePct = parseFloat(String(raw.fluctuationsRatio ?? '0').replace(/,/g, ''))
      const volume = parseFloat(String(raw.accumulatedTradingVolume ?? raw.accumulatedTradingPrice ?? '0').replace(/,/g, ''))
      const status = typeof raw.marketStatus === 'string' ? raw.marketStatus : 'UNKNOWN'

      return {
        price: Number.isFinite(price) ? price : 0,
        changePct: Number.isFinite(changePct) ? changePct : 0,
        volume: Number.isFinite(volume) ? volume : 0,
        status,
      }
    }

    return {
      kospi: parseIndex(kospiRaw),
      kosdaq: parseIndex(kosdaqRaw),
    }
  })()

  const momentumTask = (async () => {
    const baseUrl = 'https://m.stock.naver.com/api/stocks'
    const [upRes, downRes] = await Promise.all([
      fetch(`${baseUrl}/up/${market}?page=1&pageSize=5`),
      fetch(`${baseUrl}/down/${market}?page=1&pageSize=5`),
    ])

    if (!upRes.ok || !downRes.ok) {
      throw new HTTPException(502, { message: 'Korean stock ranking data unavailable' })
    }

    const [upDataRaw, downDataRaw] = await Promise.all([upRes.json(), downRes.json()]) as [unknown, unknown]
    const upStocksRaw = isRecord(upDataRaw) && Array.isArray(upDataRaw.stocks) ? upDataRaw.stocks : []
    const downStocksRaw = isRecord(downDataRaw) && Array.isArray(downDataRaw.stocks) ? downDataRaw.stocks : []

    const parseStock = (s: unknown): MomentumStock | null => {
      if (!isRecord(s)) return null

      const code = typeof s.itemCode === 'string' ? s.itemCode : String(s.itemCode ?? '')
      const name = typeof s.stockName === 'string' ? s.stockName : String(s.stockName ?? '')
      const price = parseFloat(String(s.closePrice ?? '0').replace(/,/g, ''))
      const changePct = parseFloat(String(s.fluctuationsRatio ?? '0').replace(/,/g, ''))
      const direction = isRecord(s.compareToPreviousPrice) && typeof s.compareToPreviousPrice.name === 'string'
        ? s.compareToPreviousPrice.name
        : 'UNCHANGED'
      const volume = parseFloat(String(s.accumulatedTradingVolume ?? '0').replace(/,/g, ''))

      return {
        code,
        name,
        price: Number.isFinite(price) ? price : 0,
        changePct: Number.isFinite(changePct) ? changePct : 0,
        direction,
        volume: Number.isFinite(volume) ? volume : 0,
      }
    }

    const topGainers = upStocksRaw.map(parseStock).filter((v): v is MomentumStock => v !== null).slice(0, 5)
    const topLosers = downStocksRaw.map(parseStock).filter((v): v is MomentumStock => v !== null).slice(0, 5)

    return { market, topGainers, topLosers }
  })()

  const headlinesTask = (async () => {
    const feedUrl = 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko'
    const res = await fetch(feedUrl, { headers: { 'User-Agent': 'crossfin-news/1.0' } })
    if (!res.ok) throw new HTTPException(502, { message: 'News feed unavailable' })
    const xml = await res.text()

    const limit = 5
    const items: HeadlinesItem[] = []
    const re = /<item>([\s\S]*?)<\/item>/g
    let match: RegExpExecArray | null
    while (items.length < limit) {
      match = re.exec(xml)
      if (!match) break
      const block = match[1] ?? ''
      const rawTitle = extractXmlTag(block, 'title')
      const link = extractXmlTag(block, 'link')
      const pubDate = extractXmlTag(block, 'pubDate')
      if (!rawTitle || !link || !pubDate) continue
      const { title, publisher } = splitPublisherFromTitle(rawTitle)
      items.push({ title, publisher, link, publishedAt: parseIsoDate(pubDate) })
    }

    return items
  })()

  const [krwSet, kimchiSet, indicesSet, momentumSet, headlinesSet] = await Promise.allSettled([
    krwRatePromise,
    kimchiTask,
    indicesTask,
    momentumTask,
    headlinesTask,
  ] as const)

  const usdKrw = krwSet.status === 'fulfilled' ? krwSet.value : 1450

  const kimchiPremium = kimchiSet.status === 'fulfilled'
    ? kimchiSet.value
    : { avgPremiumPct: 0, topPair: '', pairsTracked: 0, premiums: [] as KimchiPremiumRow[] }

  const indices = indicesSet.status === 'fulfilled'
    ? indicesSet.value
    : {
      kospi: { price: 0, changePct: 0, volume: 0, status: 'UNKNOWN' },
      kosdaq: { price: 0, changePct: 0, volume: 0, status: 'UNKNOWN' },
    }

  const momentum = momentumSet.status === 'fulfilled'
    ? momentumSet.value
    : { market, topGainers: [] as MomentumStock[], topLosers: [] as MomentumStock[] }

  const headlines = headlinesSet.status === 'fulfilled' ? headlinesSet.value : []

  return c.json({
    paid: true,
    service: 'crossfin-morning-brief',
    kimchiPremium,
    fxRate: {
      usdKrw: round2(usdKrw),
      source: 'open.er-api.com',
    },
    indices,
    momentum,
    headlines,
    at,
  })
})

app.get('/api/premium/market/cross-exchange', async (c) => {
  const coins = parseCoinsQueryParam(c.req.query('coins'))

  const [bithumbSet, binanceSet, krwSet] = await Promise.allSettled([
    fetchBithumbAll(),
    fetchGlobalPrices(c.env.DB),
    fetchKrwRate(),
  ])

  const bithumbData: Record<string, Record<string, string>> = bithumbSet.status === 'fulfilled' ? bithumbSet.value : {}
  const binancePrices: Record<string, number> = binanceSet.status === 'fulfilled' ? binanceSet.value : {}
  const krwRate = krwSet.status === 'fulfilled' ? krwSet.value : 1450

  const rows = await Promise.all(
    coins.map(async (coin) => {
      const binanceSymbol = TRACKED_PAIRS[coin]
      const binancePriceRaw = binanceSymbol ? binancePrices[binanceSymbol] : undefined
      const binance: BinanceExchangeData | null = typeof binancePriceRaw === 'number' && Number.isFinite(binancePriceRaw)
        ? { priceUsd: round2(binancePriceRaw) }
        : null

      const bithumbRaw = bithumbData[coin]
      const bithumbKrw = bithumbRaw?.closing_price ? parseFloat(bithumbRaw.closing_price) : 0
      const bithumbVolumeKrw = bithumbRaw?.acc_trade_value_24H ? parseFloat(bithumbRaw.acc_trade_value_24H) : 0
      const bithumbChangePct = bithumbRaw?.fluctate_rate_24H ? parseFloat(bithumbRaw.fluctate_rate_24H) : 0
      const bithumb: DomesticExchangeData | null = Number.isFinite(bithumbKrw) && bithumbKrw > 0
        ? {
          priceKrw: bithumbKrw,
          priceUsd: round2(bithumbKrw / krwRate),
          volume24hKrw: Number.isFinite(bithumbVolumeKrw) ? bithumbVolumeKrw : 0,
          volume24hUsd: round2((Number.isFinite(bithumbVolumeKrw) ? bithumbVolumeKrw : 0) / krwRate),
          change24hPct: round2(Number.isFinite(bithumbChangePct) ? bithumbChangePct : 0),
        }
        : null

      const market = `KRW-${coin}`
      const [upbitRes, coinoneRes] = await Promise.allSettled([
        fetchUpbitTicker(market),
        fetchCoinoneTicker(coin),
      ])

      let upbit: DomesticExchangeData | null = null
      if (upbitRes.status === 'fulfilled') {
        const ticker = upbitRes.value
        const tradePriceKrw = typeof ticker.trade_price === 'number' ? ticker.trade_price : Number(ticker.trade_price ?? 0)
        const changeRate = typeof ticker.signed_change_rate === 'number' ? ticker.signed_change_rate : Number(ticker.signed_change_rate ?? 0)
        const volume24hKrw = typeof ticker.acc_trade_price_24h === 'number' ? ticker.acc_trade_price_24h : Number(ticker.acc_trade_price_24h ?? 0)

        if (Number.isFinite(tradePriceKrw) && tradePriceKrw > 0) {
          const volumeKrw = Number.isFinite(volume24hKrw) ? volume24hKrw : 0
          const changePct = Number.isFinite(changeRate) ? changeRate * 100 : 0
          upbit = {
            priceKrw: tradePriceKrw,
            priceUsd: round2(tradePriceKrw / krwRate),
            volume24hKrw: volumeKrw,
            volume24hUsd: round2(volumeKrw / krwRate),
            change24hPct: round2(changePct),
          }
        }
      }

      let coinone: DomesticExchangeData | null = null
      if (coinoneRes.status === 'fulfilled') {
        const ticker = coinoneRes.value
        const lastKrw = Number(ticker.last ?? 0)
        const firstKrw = Number(ticker.first ?? 0)
        const volume24hKrw = Number(ticker.quote_volume ?? 0)

        if (Number.isFinite(lastKrw) && lastKrw > 0) {
          const open = Number.isFinite(firstKrw) ? firstKrw : 0
          const changePct = open > 0 ? ((lastKrw - open) / open) * 100 : 0
          const volumeKrw = Number.isFinite(volume24hKrw) ? volume24hKrw : 0
          coinone = {
            priceKrw: lastKrw,
            priceUsd: round2(lastKrw / krwRate),
            volume24hKrw: volumeKrw,
            volume24hUsd: round2(volumeKrw / krwRate),
            change24hPct: round2(changePct),
          }
        }
      }

      const exchanges: CrossExchangeExchanges = { bithumb, upbit, coinone, binance }

      const kimchiPremium: CrossExchangeKimchiPremium = { bithumb: null, upbit: null, coinone: null, average: null }
      if (binance?.priceUsd && binance.priceUsd > 0) {
        const premiums: number[] = []
        const compute = (ex: DomesticExchangeData | null): number | null => {
          if (!ex) return null
          const pct = ((ex.priceUsd - binance.priceUsd) / binance.priceUsd) * 100
          const rounded = round2(pct)
          premiums.push(rounded)
          return rounded
        }
        kimchiPremium.bithumb = compute(bithumb)
        kimchiPremium.upbit = compute(upbit)
        kimchiPremium.coinone = compute(coinone)
        kimchiPremium.average = premiums.length > 0 ? round2(premiums.reduce((s, p) => s + p, 0) / premiums.length) : null
      }

      const domesticPrices: Array<{ exchange: DomesticExchangeId; priceKrw: number }> = []
      if (bithumb?.priceKrw) domesticPrices.push({ exchange: 'bithumb', priceKrw: bithumb.priceKrw })
      if (upbit?.priceKrw) domesticPrices.push({ exchange: 'upbit', priceKrw: upbit.priceKrw })
      if (coinone?.priceKrw) domesticPrices.push({ exchange: 'coinone', priceKrw: coinone.priceKrw })

      let domesticArbitrage: CrossExchangeDomesticArbitrage = null
      if (domesticPrices.length >= 2) {
        domesticPrices.sort((a, b) => a.priceKrw - b.priceKrw)
        const low = domesticPrices[0]
        const high = domesticPrices[domesticPrices.length - 1]
        if (low !== undefined && high !== undefined) {
          const spreadKrw = high.priceKrw - low.priceKrw
          const spreadPct = low.priceKrw > 0 ? round2((spreadKrw / low.priceKrw) * 100) : 0
          domesticArbitrage = {
            lowestExchange: low.exchange,
            lowestPriceKrw: low.priceKrw,
            highestExchange: high.exchange,
            highestPriceKrw: high.priceKrw,
            spreadKrw,
            spreadPct,
          }
        }
      }

      // Decision layer for domestic arbitrage
      let action: 'ARBITRAGE' | 'HOLD' | 'MONITOR' = 'HOLD'
      if (domesticArbitrage && domesticArbitrage.spreadPct > 0.5) {
        action = 'ARBITRAGE'
      } else if (domesticArbitrage && domesticArbitrage.spreadPct > 0.2) {
        action = 'MONITOR'
      }

      return {
        coin,
        exchanges,
        kimchiPremium,
        domesticArbitrage,
        bestBuyExchange: domesticArbitrage?.lowestExchange ?? null,
        bestSellExchange: domesticArbitrage?.highestExchange ?? null,
        spreadPct: domesticArbitrage?.spreadPct ?? 0,
        action,
      }
    }),
  )

  const avgPremiums = rows
    .map((r) => r.kimchiPremium.average)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const avgKimchiPremium = avgPremiums.length > 0
    ? round2(avgPremiums.reduce((s, p) => s + p, 0) / avgPremiums.length)
    : 0

  const arbitrageCandidates = rows
    .filter((r) => r.domesticArbitrage !== null)
    .map((r) => ({
      coin: r.coin,
      buy: r.domesticArbitrage!.lowestExchange,
      sell: r.domesticArbitrage!.highestExchange,
      spreadPct: r.domesticArbitrage!.spreadPct,
      action: r.action,
    }))
    .sort((a, b) => b.spreadPct - a.spreadPct)

  const arbitrageCandidateCount = rows.filter((r) => r.action === 'ARBITRAGE').length

  return c.json({
    paid: true,
    service: 'crossfin-cross-exchange',
    coinsCompared: coins.length,
    krwUsdRate: round2(krwRate),
    arbitrageCandidateCount,
    coins: rows,
    summary: {
      avgKimchiPremium,
      arbitrageCandidateCount,
      bestDomesticArbitrage: arbitrageCandidates[0] ?? null,
    },
    at: new Date().toISOString(),
  })
})

// === Free Demo — delayed kimchi premium (no paywall) ===

app.get('/api/arbitrage/demo', async (c) => {
  const buildPreview = (rows: Array<{ coin: string; premiumPct: number }>) =>
    rows.slice(0, 3).map((p) => {
      const netProfitPct = Math.abs(p.premiumPct) - BITHUMB_FEES_PCT - 0.1
      const transferTime = getTransferTime(p.coin)
      const slippage = 0.15
      const volatility = Math.abs(p.premiumPct) * 0.3
      const decision = computeAction(netProfitPct, slippage, transferTime, volatility)
      return {
        coin: p.coin,
        premiumPct: p.premiumPct,
        direction: p.premiumPct >= 0 ? 'Korea premium' : 'Korea discount',
        decision: { action: decision.action, confidence: decision.confidence, reason: decision.reason },
      }
    })

  try {
    const [bithumbData, binancePrices, krwRate] = await Promise.all([
      fetchBithumbAll(),
      fetchGlobalPrices(c.env.DB),
      fetchKrwRate(),
    ])

    const premiums = calcPremiums(bithumbData, binancePrices, krwRate)
    if (premiums.length === 0) throw new Error('No premiums available')

    const preview = buildPreview(premiums)
    const avgPremium = Math.round(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length * 100) / 100
    const executeCandidates = preview.filter((p) => p.decision.action === 'EXECUTE').length

    return c.json({
      demo: true,
      dataSource: 'live',
      note: 'Free preview — top 3 pairs with AI decision layer. Pay $0.10 USDC for full analysis.',
      paidEndpoint: '/api/premium/arbitrage/opportunities',
      krwUsdRate: krwRate,
      pairsShown: preview.length,
      totalPairsAvailable: premiums.length,
      preview,
      avgPremiumPct: avgPremium,
      executeCandidates,
      marketCondition: executeCandidates >= 2 ? 'favorable' : executeCandidates === 1 ? 'neutral' : 'unfavorable',
      at: new Date().toISOString(),
    })
  } catch {
    // Fallback: use last persisted snapshot if upstream price feeds are rate-limited.
    type SnapshotRow = { coin: string; premiumPct: number | string; krwUsdRate: number | string; createdAt: string }
    let rows: SnapshotRow[] = []

    try {
      const sql = `
        WITH ranked AS (
          SELECT
            coin,
            premium_pct AS premiumPct,
            krw_usd_rate AS krwUsdRate,
            created_at AS createdAt,
            ROW_NUMBER() OVER (PARTITION BY coin ORDER BY datetime(created_at) DESC) AS rn
          FROM kimchi_snapshots
          WHERE created_at >= datetime('now', '-7 day')
        )
        SELECT coin, premiumPct, krwUsdRate, createdAt
        FROM ranked
        WHERE rn = 1
      `

      const res = await c.env.DB.prepare(sql).all<SnapshotRow>()
      rows = res.results ?? []
    } catch (err) {
      console.error('snapshot fallback failed', err)
      rows = []
    }

    const premiums = rows
      .map((r) => ({
        coin: String(r.coin ?? ''),
        premiumPct: Number(r.premiumPct ?? NaN),
        krwUsdRate: Number(r.krwUsdRate ?? NaN),
        createdAt: String(r.createdAt ?? ''),
      }))
      .filter((r) => r.coin && Number.isFinite(r.premiumPct))
      .sort((a, b) => Math.abs(b.premiumPct) - Math.abs(a.premiumPct))

    const avgPremium = premiums.length > 0
      ? Math.round(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length * 100) / 100
      : 0

    const krwUsdRate = premiums.find((p) => Number.isFinite(p.krwUsdRate))?.krwUsdRate ?? 1450
    const preview = buildPreview(premiums)
    const executeCandidates = preview.filter((p) => p.decision.action === 'EXECUTE').length
    const snapshotAt = premiums[0]?.createdAt ?? null

    if (preview.length === 0) {
      // Final fallback: stable demo output to keep live dashboard non-empty.
      const fallbackPremiums = [
        { coin: 'BTC', premiumPct: 0.0 },
        { coin: 'ETH', premiumPct: 0.0 },
        { coin: 'XRP', premiumPct: 0.0 },
      ]
      const fallbackPreview = buildPreview(fallbackPremiums)
      return c.json({
        demo: true,
        dataSource: 'fallback',
        note: 'Demo fallback — live price feeds are temporarily unavailable.',
        paidEndpoint: '/api/premium/arbitrage/opportunities',
        krwUsdRate,
        pairsShown: fallbackPreview.length,
        totalPairsAvailable: fallbackPremiums.length,
        preview: fallbackPreview,
        avgPremiumPct: 0,
        executeCandidates: 0,
        marketCondition: 'unfavorable',
        at: new Date().toISOString(),
      })
    }

    return c.json({
      demo: true,
      dataSource: 'snapshot',
      note: 'Snapshot preview — live price feeds are rate-limited. Pay $0.10 USDC for full analysis.',
      paidEndpoint: '/api/premium/arbitrage/opportunities',
      krwUsdRate,
      pairsShown: preview.length,
      totalPairsAvailable: premiums.length,
      preview,
      avgPremiumPct: avgPremium,
      executeCandidates,
      marketCondition: executeCandidates >= 2 ? 'favorable' : executeCandidates === 1 ? 'neutral' : 'unfavorable',
      snapshotAt,
      at: new Date().toISOString(),
    })
  }
})

// === On-chain USDC transfers (Base mainnet) ===

const BASE_RPC_URLS = [
  'https://mainnet.base.org',
  'https://base.llamarpc.com',
  'https://base-rpc.publicnode.com',
] as const
const BASE_RPC_TIMEOUT_MS = 4_000
const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const USDC_DECIMALS = 6

function toTopicAddress(address: string): string {
  const normalized = address.trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new HTTPException(500, { message: 'Invalid PAYMENT_RECEIVER_ADDRESS (expected 0x + 40 hex chars)' })
  }
  return `0x${normalized.slice(2).padStart(64, '0')}`
}

function topicToAddress(topic: string): string {
  const raw = topic.trim().toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(raw)) return ''
  return `0x${raw.slice(-40)}`
}

async function baseRpc<T>(method: string, params: unknown[]): Promise<T> {
  for (const url of BASE_RPC_URLS) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), BASE_RPC_TIMEOUT_MS)

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`Base RPC unavailable (${res.status})`)
        const data: unknown = await res.json()
        if (!isRecord(data)) throw new Error('Base RPC invalid response')
        if (data.error) throw new Error('Base RPC error')
        if (!('result' in data)) throw new Error('Base RPC missing result')
        return data.result as T
      } finally {
        clearTimeout(timeoutId)
      }
    } catch {
      // Try next RPC URL
    }
  }

  throw new HTTPException(502, { message: 'Base RPC unavailable' })
}

type RpcLog = {
  address?: string
  topics?: string[]
  data?: string
  blockNumber?: string
  transactionHash?: string
  logIndex?: string
}

type UsdcTransfer = {
  hash: string
  from: string
  to: string
  value: string
  tokenDecimal: string
  timeStamp: string
}

async function fetchRecentUsdcTransfers(walletAddress: string, limit: number): Promise<UsdcTransfer[]> {
  const latestHex = await baseRpc<string>('eth_blockNumber', [])
  const latest = typeof latestHex === 'string' ? parseInt(latestHex, 16) : NaN
  if (!Number.isFinite(latest) || latest <= 0) throw new HTTPException(502, { message: 'Base RPC unavailable' })

  const toTopic = toTopicAddress(walletAddress)
  // Public RPC endpoints often limit eth_getLogs ranges; keep ranges conservative.
  const ranges = [8_000, 40_000]

  let logs: RpcLog[] = []
  for (const span of ranges) {
    const fromBlock = Math.max(0, latest - span)
    const filter = {
      address: BASE_USDC_ADDRESS,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${latest.toString(16)}`,
      topics: [ERC20_TRANSFER_TOPIC, null, toTopic],
    }
    const out = await baseRpc<RpcLog[]>('eth_getLogs', [filter])
    logs = Array.isArray(out) ? out : []
    if (logs.length >= limit) break
  }

  const sorted = logs
    .filter((l) => Boolean(l && typeof l.transactionHash === 'string' && typeof l.blockNumber === 'string'))
    .sort((a, b) => {
      const aBlock = Number.parseInt(a.blockNumber ?? '0x0', 16) || 0
      const bBlock = Number.parseInt(b.blockNumber ?? '0x0', 16) || 0
      if (aBlock !== bBlock) return bBlock - aBlock
      const aIdx = Number.parseInt(a.logIndex ?? '0x0', 16) || 0
      const bIdx = Number.parseInt(b.logIndex ?? '0x0', 16) || 0
      return bIdx - aIdx
    })
    .slice(0, limit)

  const blockNums = Array.from(
    new Set(sorted.map((l) => parseInt(l.blockNumber ?? '0x0', 16)).filter((n) => Number.isFinite(n) && n >= 0)),
  )
  const blockTs = new Map<number, string>()
  await Promise.all(blockNums.map(async (n) => {
    const block = await baseRpc<unknown>('eth_getBlockByNumber', [`0x${n.toString(16)}`, false])
    if (!isRecord(block) || typeof block.timestamp !== 'string') return
    const ts = parseInt(block.timestamp, 16)
    if (!Number.isFinite(ts) || ts <= 0) return
    blockTs.set(n, String(ts))
  }))

  const transfers: UsdcTransfer[] = []
  for (const log of sorted) {
    const topics = Array.isArray(log.topics) ? log.topics : []
    const from = typeof topics[1] === 'string' ? topicToAddress(topics[1]) : ''
    const to = typeof topics[2] === 'string' ? topicToAddress(topics[2]) : ''
    const hash = typeof log.transactionHash === 'string' ? log.transactionHash : ''
    const data = typeof log.data === 'string' ? log.data : ''
    const blockNumber = typeof log.blockNumber === 'string' ? parseInt(log.blockNumber, 16) : NaN

    if (!hash || !from || !to || !data.startsWith('0x') || data.length < 3) continue

    let valueAtomic = 0n
    try {
      valueAtomic = BigInt(data)
    } catch {
      continue
    }

    const timeStamp = Number.isFinite(blockNumber) ? (blockTs.get(blockNumber) ?? '') : ''
    if (!timeStamp) continue

    transfers.push({
      hash,
      from,
      to,
      value: valueAtomic.toString(),
      tokenDecimal: String(USDC_DECIMALS),
      timeStamp,
    })
  }

  return transfers
}

app.get('/api/onchain/usdc-transfers', async (c) => {
  const limit = Math.min(20, Math.max(1, Number(c.req.query('limit') ?? '10') || 10))
  const wallet = c.env.PAYMENT_RECEIVER_ADDRESS

  const CACHE_TTL_MS = 20_000
  type Cached = { transfers: UsdcTransfer[]; expiresAt: number }
  const globalAny = globalThis as unknown as {
    __crossfinUsdcTransfersCache?: Cached
    __crossfinUsdcTransfersInFlight?: Promise<void> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinUsdcTransfersCache
  const fresh = Boolean(cached && now < cached.expiresAt)

  // Never block the live dashboard on slow RPC calls. Refresh the cache in the background.
  if (!fresh && !globalAny.__crossfinUsdcTransfersInFlight) {
    const refreshPromise = fetchRecentUsdcTransfers(wallet, 20)
      .then((transfers) => {
        globalAny.__crossfinUsdcTransfersCache = { transfers, expiresAt: Date.now() + CACHE_TTL_MS }
      })
      .catch((err) => {
        console.error('usdc-transfers fetch failed', err)
        const fallback = cached?.transfers ?? []
        globalAny.__crossfinUsdcTransfersCache = { transfers: fallback, expiresAt: Date.now() + CACHE_TTL_MS }
      })
      .finally(() => {
        globalAny.__crossfinUsdcTransfersInFlight = null
      })

    globalAny.__crossfinUsdcTransfersInFlight = refreshPromise
    c.executionCtx.waitUntil(refreshPromise)
  }

  return c.json({
    wallet,
    contract: BASE_USDC_ADDRESS,
    token: { symbol: 'USDC', decimals: USDC_DECIMALS },
    transfers: (cached?.transfers ?? []).slice(0, limit),
    fresh,
    at: new Date().toISOString(),
  })
})

app.get('/api/cron/snapshot-kimchi', async (c) => {
  requireAdmin(c)

  const [bithumbData, binancePrices, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchGlobalPrices(c.env.DB),
    fetchKrwRate(),
  ])

  const premiums = calcPremiums(bithumbData, binancePrices, krwRate)

  const insertSql = 'INSERT INTO kimchi_snapshots (id, coin, bithumb_krw, binance_usd, premium_pct, krw_usd_rate, volume_24h_usd) VALUES (?, ?, ?, ?, ?, ?, ?)'
  const statements = premiums.map((p) => c.env.DB.prepare(insertSql).bind(
    crypto.randomUUID(),
    p.coin,
    p.bithumbKrw,
    p.binanceUsd,
    p.premiumPct,
    krwRate,
    p.volume24hUsd,
  ))

  if (statements.length > 0) {
    try {
      await c.env.DB.batch(statements)
    } catch (err) {
      console.error(err)
      throw new HTTPException(500, { message: 'DB schema not migrated (kimchi_snapshots table missing)' })
    }
  }

  await audit(
    c.env.DB,
    null,
    'admin.cron.snapshot_kimchi',
    'kimchi_snapshots',
    null,
    'success',
    `snapshots=${statements.length}`,
  )

  return c.json({ ok: true, snapshots: statements.length })
})

// === Guardian Rules CRUD ===

app.get('/api/guardian/rules', async (c) => {
  requireGuardianEnabled(c)
  const agentId = c.req.query('agent_id')
  let query = "SELECT * FROM guardian_rules WHERE active = 1"
  const binds: string[] = []
  if (agentId) {
    query += " AND (agent_id IS NULL OR agent_id = ?)"
    binds.push(agentId)
  }
  query += " ORDER BY type, created_at DESC"
  const stmt = binds.length ? c.env.DB.prepare(query).bind(...binds) : c.env.DB.prepare(query)
  const { results } = await stmt.all()
  return c.json({
    rules: (results ?? []).map((r: any) => ({
      ...r,
      params: JSON.parse(r.params || '{}'),
    })),
    at: new Date().toISOString(),
  })
})

app.post('/api/guardian/rules', async (c) => {
  requireGuardianEnabled(c)
  requireAdmin(c)
  const body = await c.req.json<{
    agent_id?: string | null
    type: string
    params?: Record<string, unknown>
  }>()

  const validTypes = ['SPEND_CAP', 'FAIL_STREAK', 'CIRCUIT_BREAKER', 'KILL_SWITCH']
  if (!validTypes.includes(body.type)) {
    throw new HTTPException(400, { message: `type must be one of: ${validTypes.join(', ')}` })
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    'INSERT INTO guardian_rules (id, agent_id, type, params) VALUES (?, ?, ?, ?)'
  ).bind(id, body.agent_id ?? null, body.type, JSON.stringify(body.params ?? {})).run()

  await audit(c.env.DB, null, 'guardian.rule.create', 'guardian_rules', id, 'success', `type=${body.type}`)
  return c.json({ id, type: body.type, params: body.params ?? {} }, 201)
})

app.delete('/api/guardian/rules/:id', async (c) => {
  requireGuardianEnabled(c)
  requireAdmin(c)
  const ruleId = c.req.param('id')
  await c.env.DB.prepare(
    'UPDATE guardian_rules SET active = 0, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(ruleId).run()
  await audit(c.env.DB, null, 'guardian.rule.deactivate', 'guardian_rules', ruleId, 'success')
  return c.json({ ok: true, deactivated: ruleId })
})

// === Guardian Status (public, for live dashboard) ===

app.get('/api/guardian/status', async (c) => {
  requireGuardianEnabled(c)
  const [rules, recentActions, spendToday] = await Promise.all([
    c.env.DB.prepare("SELECT id, agent_id, type, params, created_at FROM guardian_rules WHERE active = 1 ORDER BY created_at DESC LIMIT 20").all(),
    c.env.DB.prepare("SELECT id, agent_id, action_type, decision, confidence, cost_usd, rule_applied, details, created_at FROM autonomous_actions ORDER BY created_at DESC LIMIT 30").all(),
    c.env.DB.prepare("SELECT agent_id, SUM(amount_usd) as total FROM agent_spend WHERE created_at >= datetime('now', '-1 day') GROUP BY agent_id").all(),
  ])

  const blockedCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM autonomous_actions WHERE decision = 'BLOCK' AND created_at >= datetime('now', '-1 day')"
  ).first<{ cnt: number }>()

  return c.json({
    guardian: {
      activeRules: (rules.results ?? []).length,
      rules: (rules.results ?? []).map((r: any) => ({
        id: r.id,
        agentId: r.agent_id,
        type: r.type,
        params: JSON.parse(r.params || '{}'),
        createdAt: r.created_at,
      })),
      blockedToday: blockedCount?.cnt ?? 0,
      agentSpendToday: (spendToday.results ?? []).map((s: any) => ({
        agentId: s.agent_id,
        totalUsd: s.total,
      })),
    },
    recentActions: (recentActions.results ?? []).map((a: any) => ({
      id: a.id,
      agentId: a.agent_id,
      actionType: a.action_type,
      decision: a.decision,
      confidence: a.confidence,
      costUsd: a.cost_usd,
      ruleApplied: a.rule_applied,
      details: JSON.parse(a.details || '{}'),
      createdAt: a.created_at,
    })),
    at: new Date().toISOString(),
  })
})

// === Autonomous Actions Log ===

app.get('/api/agents/:agentId/actions', async (c) => {
  requireGuardianEnabled(c)
  const agentId = c.req.param('agentId')
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200)

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM autonomous_actions WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(agentId, limit).all()

  return c.json({
    agentId,
    actions: (results ?? []).map((a: any) => ({
      ...a,
      details: JSON.parse(a.details || '{}'),
    })),
    at: new Date().toISOString(),
  })
})

// === Deposit Verification ===

const CROSSFIN_WALLET = '0xe4E79Ce6a1377C58f0Bb99D023908858A4DB5779'
const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

app.post('/api/deposits', async (c) => {
  requireGuardianEnabled(c)
  const body = await c.req.json<{
    tx_hash: string
    agent_id?: string
  }>()

  if (!body.tx_hash?.trim()) {
    throw new HTTPException(400, { message: 'tx_hash is required' })
  }

  const txHash = body.tx_hash.trim().toLowerCase()

  // Check for duplicate
  const existing = await c.env.DB.prepare(
    'SELECT id, status FROM deposits WHERE tx_hash = ?'
  ).bind(txHash).first()
  if (existing) {
    return c.json({ id: existing.id, status: existing.status, message: 'Deposit already processed' })
  }

  // Verify on Basescan
  const basescanUrl = `https://api.basescan.org/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}`
  const receipt: unknown = await fetch(basescanUrl).then((r) => r.json()).catch(() => null)
  const receiptResult = isRecord(receipt) && isRecord(receipt.result) ? receipt.result : null

  if (!receiptResult?.status || receiptResult.status !== '0x1') {
    throw new HTTPException(400, { message: 'Transaction not found or not confirmed on Base mainnet' })
  }

  // Parse USDC transfer amount from logs
  let amountUsd = 0
  let fromAddress = ''
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' // Transfer event

  const receiptLogs = Array.isArray(receiptResult.logs) ? receiptResult.logs : []
  for (const log of receiptLogs) {
    if (
      log.address?.toLowerCase() === USDC_BASE_ADDRESS.toLowerCase() &&
      log.topics?.[0] === transferTopic &&
      topicToAddress(log.topics?.[2] ?? '') === CROSSFIN_WALLET.toLowerCase()
    ) {
      const parsed = Number.parseInt(log.data, 16)
      if (!Number.isFinite(parsed) || parsed <= 0) continue
      amountUsd = parsed / 1e6 // USDC has 6 decimals
      fromAddress = topicToAddress(log.topics[1] ?? '')
      break
    }
  }

  if (amountUsd <= 0) {
    throw new HTTPException(400, { message: 'No USDC transfer to CrossFin wallet found in transaction' })
  }

  const depositId = crypto.randomUUID()
  await c.env.DB.prepare(
    "INSERT INTO deposits (id, agent_id, tx_hash, amount_usd, from_address, status, verified_at) VALUES (?, ?, ?, ?, ?, 'verified', datetime('now'))"
  ).bind(depositId, body.agent_id ?? null, txHash, amountUsd, fromAddress).run()

  // Credit agent wallet if agent_id provided
  if (body.agent_id) {
    const wallet = await c.env.DB.prepare(
      'SELECT id, balance_cents FROM wallets WHERE agent_id = ? LIMIT 1'
    ).bind(body.agent_id).first<{ id: string; balance_cents: number }>()

    if (wallet) {
      const creditCents = Math.round(amountUsd * 100)
      await c.env.DB.prepare(
        'UPDATE wallets SET balance_cents = balance_cents + ? WHERE id = ?'
      ).bind(creditCents, wallet.id).run()

      await c.env.DB.prepare(
        "INSERT INTO transactions (id, to_wallet_id, amount_cents, rail, memo, status) VALUES (?, ?, ?, 'usdc_base', ?, 'completed')"
      ).bind(crypto.randomUUID(), wallet.id, creditCents, `Deposit via ${txHash.slice(0, 10)}...`).run()
    }
  }

  await logAutonomousAction(c.env.DB, body.agent_id ?? null, 'DEPOSIT_VERIFY', null, 'EXECUTE', 1.0, amountUsd, null, {
    txHash,
    amountUsd,
    fromAddress,
    basescan: `https://basescan.org/tx/${txHash}`,
  })

  await audit(c.env.DB, body.agent_id ?? null, 'deposit.verify', 'deposits', depositId, 'success', `$${amountUsd.toFixed(2)} USDC from ${fromAddress.slice(0, 10)}...`)

  return c.json({
    id: depositId,
    status: 'verified',
    amountUsd,
    fromAddress,
    txHash,
    basescan: `https://basescan.org/tx/${txHash}`,
    credited: !!body.agent_id,
  }, 201)
})

app.get('/api/deposits', async (c) => {
  requireGuardianEnabled(c)
  const agentId = c.req.query('agent_id')
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)
  let query = 'SELECT * FROM deposits'
  const binds: (string | number)[] = []
  if (agentId) {
    query += ' WHERE agent_id = ?'
    binds.push(agentId)
  }
  query += ' ORDER BY created_at DESC LIMIT ?'
  binds.push(limit)
  const stmt = binds.length === 1 ? c.env.DB.prepare(query).bind(binds[0]) : c.env.DB.prepare(query).bind(...binds)
  const { results } = await stmt.all()
  return c.json({
    deposits: (results ?? []).map((d: any) => ({
      ...d,
      basescan: `https://basescan.org/tx/${d.tx_hash}`,
    })),
    at: new Date().toISOString(),
  })
})

// === Agent Self-Registration ===

app.post('/api/agents/register', async (c) => {
  const body = await c.req.json<{
    name: string
    evm_address?: string
  }>()

  if (!body.name?.trim()) {
    throw new HTTPException(400, { message: 'name is required' })
  }

  const id = crypto.randomUUID()
  const rawApiKey = `cf_${crypto.randomUUID().replace(/-/g, '')}`
  const keyHash = await sha256Hex(rawApiKey)

  await c.env.DB.prepare(
    "INSERT INTO agents (id, name, api_key, status) VALUES (?, ?, ?, 'active')"
  ).bind(id, body.name.trim(), keyHash).run()

  // Create default wallet
  const walletId = crypto.randomUUID()
  await c.env.DB.prepare(
    'INSERT INTO wallets (id, agent_id, label, balance_cents) VALUES (?, ?, ?, 0)'
  ).bind(walletId, id, 'Default Wallet').run()

  // Set default Guardian rules
  const defaultRules = [
    { type: 'SPEND_CAP', params: { dailyLimitUsd: 10.0 } },
    { type: 'FAIL_STREAK', params: { maxConsecutiveFails: 10 } },
    { type: 'CIRCUIT_BREAKER', params: { failRatePct: 60, windowMinutes: 30 } },
  ]
  let guardianApplied = false
  if (isEnabledFlag(c.env.CROSSFIN_GUARDIAN_ENABLED)) {
    try {
      for (const rule of defaultRules) {
        await c.env.DB.prepare(
          'INSERT INTO guardian_rules (id, agent_id, type, params) VALUES (?, ?, ?, ?)'
        ).bind(crypto.randomUUID(), id, rule.type, JSON.stringify(rule.params)).run()
      }
      guardianApplied = true
    } catch (err) {
      console.error('Failed to apply default guardian rules', err)
    }
  }

  await audit(c.env.DB, id, 'agent.self_register', 'agents', id, 'success')

  return c.json({
    id,
    name: body.name.trim(),
    apiKey: rawApiKey,
    walletId,
    guardianRules: guardianApplied ? defaultRules.map((r) => r.type) : [],
    note: guardianApplied
      ? 'Save your API key — it cannot be retrieved later. Default Guardian rules have been applied.'
      : 'Save your API key — it cannot be retrieved later.',
  }, 201)
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
    'SELECT rail, status, COUNT(*) as count FROM transactions GROUP BY rail, status ORDER BY count DESC LIMIT 10'
  ).all<{ rail: string; status: string; count: number | string }>()

  return c.json({
    paid: true,
    network: requireCaip2(c.env.X402_NETWORK),
    stats: {
      agents: (agents?.results?.[0] as { count: number } | undefined)?.count ?? 0,
      wallets: (wallets?.results?.[0] as { count: number } | undefined)?.count ?? 0,
      transactions: (txns?.results?.[0] as { count: number } | undefined)?.count ?? 0,
      blocked: blocked?.count ?? 0,
    },
    recentTransactions: (recentTransactions ?? []).map((row) => ({
      rail: String(row.rail ?? ''),
      status: String(row.status ?? ''),
      count: Number(row.count ?? 0),
    })),
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

api.get('/survival/status', async (c) => {
  const now = new Date()
  const day = now.toISOString().slice(0, 10)
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString()

  const [totalCalls, todayCalls, weekCalls] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM service_calls').first<{ cnt: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM service_calls WHERE created_at >= ?').bind(day).first<{ cnt: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM service_calls WHERE created_at >= ?').bind(weekAgo).first<{ cnt: number }>(),
  ])

  const activeServices = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM services WHERE status = 'active'"
  ).first<{ cnt: number }>()

  const callsToday = todayCalls?.cnt ?? 0
  const callsWeek = weekCalls?.cnt ?? 0
  const alive = true

  return c.json({
    alive,
    state: alive ? 'ALIVE' : 'STOPPED',
    version: CROSSFIN_API_VERSION,
    metrics: {
      totalCalls: totalCalls?.cnt ?? 0,
      callsToday,
      callsThisWeek: callsWeek,
      activeServices: activeServices?.cnt ?? 0,
    },
    at: now.toISOString(),
  })
})

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
    'SELECT id FROM wallets WHERE id = ? AND agent_id = ?'
  ).bind(body.fromWalletId, agentId).first<{ id: string }>()
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

  const txId = crypto.randomUUID()
  const rail = body.rail ?? 'internal'

  const debit = await c.env.DB.prepare(
    'UPDATE wallets SET balance_cents = balance_cents - ?, updated_at = datetime("now") WHERE id = ? AND agent_id = ? AND balance_cents >= ?'
  ).bind(amount, body.fromWalletId, agentId, amount).run()

  const debitChanges = Number(debit.meta.changes ?? 0)
  if (debitChanges === 0) {
    await audit(c.env.DB, agentId, 'transfer.blocked', 'transactions', null, 'blocked', 'Insufficient balance')
    throw new HTTPException(400, { message: 'Insufficient balance' })
  }

  try {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = datetime("now") WHERE id = ?').bind(amount, body.toWalletId),
      c.env.DB.prepare(
        "INSERT INTO transactions (id, from_wallet_id, to_wallet_id, amount_cents, rail, memo, status) VALUES (?, ?, ?, ?, ?, ?, 'completed')"
      ).bind(txId, body.fromWalletId, body.toWalletId, amount, rail, body.memo ?? ''),
    ])
  } catch (error) {
    try {
      await c.env.DB.prepare(
        'UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = datetime("now") WHERE id = ? AND agent_id = ?'
      ).bind(amount, body.fromWalletId, agentId).run()
    } catch (rollbackError) {
      console.error('Transfer rollback failed', rollbackError)
    }
    console.error('Transfer finalization failed', error)
    throw new HTTPException(500, { message: 'Transfer failed' })
  }

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

  const agents = Number((results[0]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
  const wallets = Number((results[1]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
  const transactions = Number((results[2]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)

  const blocked = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM audit_logs WHERE result = 'blocked'"
  ).first<{ count: number | string }>()

  const bucket = (value: number): number => {
    if (!Number.isFinite(value) || value <= 0) return 0
    if (value < 10) return 10
    if (value < 100) return Math.ceil(value / 10) * 10
    return Math.ceil(value / 100) * 100
  }

  return c.json({
    agents: bucket(agents),
    wallets: bucket(wallets),
    transactions: bucket(transactions),
    blocked: bucket(Number(blocked?.count ?? 0)),
    note: 'Public counters are rounded for privacy',
    at: new Date().toISOString(),
  })
})

// ============================================================
// ROUTING ENGINE — API Endpoints (MUST be before app.route('/api', api) to avoid agentAuth)
// ============================================================

// GET /api/premium/route/find — Main routing endpoint (paid via x402, $0.10)
app.get('/api/premium/route/find', async (c) => {
  const fromRaw = c.req.query('from') // e.g., "bithumb:KRW"
  const toRaw = c.req.query('to') // e.g., "binance:USDC"
  const amountRaw = c.req.query('amount')
  const strategyRaw = c.req.query('strategy') ?? 'cheapest'

  if (!fromRaw || !toRaw || !amountRaw) {
    throw new HTTPException(400, { message: 'Required: from (exchange:currency), to (exchange:currency), amount. Example: /api/premium/route/find?from=bithumb:KRW&to=binance:USDC&amount=1000000' })
  }

  const [fromExchange, fromCurrency] = fromRaw.split(':')
  const [toExchange, toCurrency] = toRaw.split(':')
  if (!fromExchange || !fromCurrency || !toExchange || !toCurrency) {
    throw new HTTPException(400, { message: 'Format: exchange:currency (e.g., bithumb:KRW, binance:USDC)' })
  }

  const fromEx = fromExchange.toLowerCase()
  const toEx = toExchange.toLowerCase()
  const supported = ROUTING_EXCHANGES.join(', ')
  if (!ROUTING_EXCHANGES.includes(fromEx as RoutingExchange)) {
    throw new HTTPException(400, { message: `Unsupported from exchange: ${fromEx}. Supported: ${supported}` })
  }
  if (!ROUTING_EXCHANGES.includes(toEx as RoutingExchange)) {
    throw new HTTPException(400, { message: `Unsupported to exchange: ${toEx}. Supported: ${supported}` })
  }

  const amount = Number(amountRaw)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HTTPException(400, { message: 'amount must be a positive number' })
  }

  const strategy = (['cheapest', 'fastest', 'balanced'].includes(strategyRaw) ? strategyRaw : 'cheapest') as RoutingStrategy

  const { optimal, alternatives, meta } = await findOptimalRoute(
    fromEx, fromCurrency, toEx, toCurrency, amount, strategy, c.env.DB,
  )

  return c.json({
    paid: true,
    service: 'crossfin-route-finder',
    summary: optimal?.summary ?? null,
    request: { from: fromRaw, to: toRaw, amount, strategy },
    optimal,
    alternatives,
    meta,
  })
})

// GET /api/route/exchanges — List supported exchanges (free)
app.get('/api/route/exchanges', (c) => {
  const exchanges = ROUTING_EXCHANGES.map((ex) => ({
    id: ex,
    name: ex.charAt(0).toUpperCase() + ex.slice(1),
    country: ex === 'binance' ? 'Global' : 'South Korea',
    tradingFeePct: EXCHANGE_FEES[ex],
    supportedCoins: Object.keys(WITHDRAWAL_FEES[ex] ?? {}),
    type: ex === 'binance' ? 'global' : 'korean',
  }))
  return c.json({ service: 'crossfin-route-exchanges', exchanges, at: new Date().toISOString() })
})

// GET /api/route/fees — Fee comparison table (free)
app.get('/api/route/fees', (c) => {
  const coinRaw = c.req.query('coin')
  const coin = coinRaw ? coinRaw.toUpperCase() : null

  const fees = ROUTING_EXCHANGES.map((ex) => {
    const withdrawals = coin
      ? { [coin]: getWithdrawalFee(ex, coin) }
      : WITHDRAWAL_FEES[ex] ?? {}
    return {
      exchange: ex,
      tradingFeePct: EXCHANGE_FEES[ex],
      withdrawalFees: withdrawals,
      transferTimes: coin
        ? { [coin]: getTransferTime(coin) }
        : Object.fromEntries(Object.keys(WITHDRAWAL_FEES[ex] ?? {}).map((c) => [c, getTransferTime(c)])),
    }
  })

  return c.json({ service: 'crossfin-route-fees', coin: coin ?? 'all', fees, at: new Date().toISOString() })
})

// GET /api/route/pairs — Supported pairs with live prices (free)
app.get('/api/route/pairs', async (c) => {
  const [bithumbResult, globalResult, krwResult] = await Promise.allSettled([
    fetchBithumbAll(), fetchGlobalPrices(c.env.DB), fetchKrwRate(),
  ])
  const bithumbAll = bithumbResult.status === 'fulfilled' ? bithumbResult.value : {}
  const globalPrices: Record<string, number> = globalResult.status === 'fulfilled' ? globalResult.value : {}
  const krwRate = krwResult.status === 'fulfilled' ? krwResult.value : 1450

  const pairs = Object.entries(TRACKED_PAIRS).map(([coin, binanceSymbol]) => {
    const bithumb = bithumbAll[coin]
    const binancePrice = globalPrices[binanceSymbol]
    return {
      coin,
      binanceSymbol,
      bithumbKrw: bithumb?.closing_price ? parseFloat(bithumb.closing_price) : null,
      binanceUsd: binancePrice ?? null,
      transferTimeMin: getTransferTime(coin),
      bridgeSupported: BRIDGE_COINS.includes(coin as typeof BRIDGE_COINS[number]),
    }
  })

  return c.json({ service: 'crossfin-route-pairs', krwUsdRate: krwRate, pairs, at: new Date().toISOString() })
})

// GET /api/route/status — Exchange API health check (free)
app.get('/api/route/status', async (c) => {
  const btcSymbol = TRACKED_PAIRS.BTC ?? 'BTCUSDT'
  const checks = await Promise.allSettled([
    fetch('https://api.bithumb.com/public/ticker/BTC_KRW').then((r) => r.ok),
    fetch('https://api.upbit.com/v1/ticker?markets=KRW-BTC').then((r) => r.ok),
    fetch('https://api.coinone.co.kr/public/v2/ticker_new/KRW/BTC').then((r) => r.ok),
    fetch('https://api.gopax.co.kr/trading-pairs/BTC-KRW/ticker').then((r) => r.ok),
    fetchGlobalPrices(c.env.DB).then((prices) => {
      const btc = prices[btcSymbol]
      return typeof btc === 'number' && Number.isFinite(btc) && btc > 1000
    }),
  ])

  const names = ['bithumb', 'upbit', 'coinone', 'gopax', 'binance']
  const statuses = names.map((name, i) => ({
    exchange: name,
    status: checks[i]?.status === 'fulfilled' && (checks[i] as PromiseFulfilledResult<boolean>).value ? 'online' : 'offline',
  }))

  const allOnline = statuses.every((s) => s.status === 'online')
  return c.json({ service: 'crossfin-route-status', healthy: allOnline, exchanges: statuses, at: new Date().toISOString() })
})

// ============================================================
// ACP (Agentic Commerce Protocol) — Compatibility Layer (MUST be before app.route('/api', api))
// ============================================================

// POST /api/acp/quote — Request a routing quote (ACP-compatible, free)
app.post('/api/acp/quote', async (c) => {
  let body: Record<string, unknown>
  try {
    body = await c.req.json() as Record<string, unknown>
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' })
  }

  const fromExchange = String(body.from_exchange ?? 'bithumb')
  const fromCurrency = String(body.from_currency ?? 'KRW')
  const toExchange = String(body.to_exchange ?? 'binance')
  const toCurrency = String(body.to_currency ?? 'USDC')
  const amount = Number(body.amount ?? 0)
  const strategy = String(body.strategy ?? 'cheapest') as RoutingStrategy

  if (amount <= 0) throw new HTTPException(400, { message: 'amount must be positive' })

  const { optimal, alternatives, meta } = await findOptimalRoute(
    fromExchange, fromCurrency, toExchange, toCurrency, amount, strategy, c.env.DB,
  )

  // Strip optimal route to preview (no steps, limited fields)
  const optimalPreview = optimal ? {
    bridgeCoin: optimal.bridgeCoin,
    totalCostPct: optimal.totalCostPct,
    totalTimeMinutes: optimal.totalTimeMinutes,
    estimatedInput: optimal.estimatedInput,
    estimatedOutput: optimal.estimatedOutput,
    action: optimal.action,
    confidence: optimal.confidence,
    reason: optimal.reason,
    summary: optimal.summary ?? null,
  } : null

  // Strip alternatives to preview (max 2, no steps)
  const altPreviews = alternatives.slice(0, 2).map(r => ({
    bridgeCoin: r.bridgeCoin,
    totalCostPct: r.totalCostPct,
    totalTimeMinutes: r.totalTimeMinutes,
    estimatedOutput: r.estimatedOutput,
  }))

  // Strip meta (remove pricesUsed)
  const metaPreview = {
    exchangeRates: meta.exchangeRates,
    routesEvaluated: meta.routesEvaluated,
    bridgeCoinsTotal: meta.bridgeCoinsTotal,
    skippedCoins: meta.skippedCoins,
    analysisTimestamp: meta.analysisTimestamp,
    disclaimer: meta.disclaimer,
  }

  return c.json({
    protocol: 'acp',
    version: '1.0',
    type: 'quote',
    provider: 'crossfin',
    quote_id: `cfq_${crypto.randomUUID().slice(0, 8)}`,
    status: 'quoted',
    summary: optimal?.summary ?? null,
    request: { from_exchange: fromExchange, from_currency: fromCurrency, to_exchange: toExchange, to_currency: toCurrency, amount, strategy },
    optimal_route: optimalPreview,
    alternatives: altPreviews,
    meta: metaPreview,
    upgrade: {
      endpoint: '/api/premium/route/find',
      price: '$0.10 USDC',
      includes: 'Full step-by-step execution route, all alternatives, detailed price data',
      example: `/api/premium/route/find?from=${fromExchange}:${fromCurrency}&to=${toExchange}:${toCurrency}&amount=${amount}&strategy=${strategy}`,
    },
    expires_at: new Date(Date.now() + 60_000).toISOString(), // 60s quote validity
    actions: {
      execute: { method: 'POST', url: '/api/acp/execute', note: 'Execution simulation — actual execution requires exchange API keys (coming soon)' },
    },
  })
})

// POST /api/acp/execute — Execute a route (simulation mode, free)
app.post('/api/acp/execute', async (c) => {
  let body: Record<string, unknown>
  try {
    body = await c.req.json() as Record<string, unknown>
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' })
  }

  const quoteId = String(body.quote_id ?? '')
  if (!quoteId) throw new HTTPException(400, { message: 'quote_id is required' })

  return c.json({
    protocol: 'acp',
    version: '1.0',
    type: 'execution',
    provider: 'crossfin',
    quote_id: quoteId,
    execution_id: `cfx_${crypto.randomUUID().slice(0, 8)}`,
    status: 'simulated',
    message: 'Route execution is in simulation mode. Actual execution requires exchange API credentials. Contact team@crossfin.dev to enable live execution.',
    simulated: true,
    next_steps: [
      'Connect exchange API keys for live execution',
      'Set spending limits and policies (Locus-compatible)',
      'Enable automated route execution for your agents',
    ],
  })
})

// GET /api/acp/status — ACP protocol status (free)
app.get('/api/acp/status', (c) => {
  return c.json({
    protocol: 'acp',
    version: '1.0',
    provider: 'crossfin',
    capabilities: ['quote', 'simulate'],
    supported_exchanges: [...ROUTING_EXCHANGES],
    supported_currencies: { source: ['KRW'], destination: ['USDC', 'USDT', 'KRW'] },
    bridge_coins: [...BRIDGE_COINS],
    execution_mode: 'simulation',
    live_execution: 'coming_soon',
    compatible_with: ['locus', 'x402', 'openai-acp'],
    at: new Date().toISOString(),
  })
})

// ============================================================
// END ROUTING + ACP (registered before app.route to bypass agentAuth)
// ============================================================

// ============================================================
// MCP Streamable HTTP Endpoint (registered before app.route to bypass agentAuth)
// ============================================================

app.all('/api/mcp', async (c) => {
  const origin = c.req.header('origin') ?? '*'
  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, mcp-session-id, Last-Event-ID, mcp-protocol-version',
      'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
    }})
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  const server = new McpServer({ name: 'crossfin', version: CROSSFIN_API_VERSION })
  const BASE = new URL(c.req.url).origin

  async function proxy(path: string): Promise<{ content: Array<{ type: 'text'; text: string }>, isError?: boolean }> {
    try {
      const res = await fetch(`${BASE}${path}`)
      if (!res.ok) throw new Error(`API ${res.status}`)
      return { content: [{ type: 'text', text: await res.text() }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }
    }
  }

  const LOCAL_ONLY = { content: [{ type: 'text' as const, text: 'This tool requires local installation. Run: npx crossfin-mcp (set EVM_PRIVATE_KEY for paid tools). See: https://crossfin.dev/api/docs/guide' }] }

  server.registerTool('get_kimchi_premium', { description: 'Free preview of Kimchi Premium — real-time price spread between Korean and global crypto exchanges (top 3 pairs)', inputSchema: z.object({}) }, async () => proxy('/api/arbitrage/demo'))
  server.registerTool('list_exchange_fees', { description: 'Trading fees, withdrawal fees, and transfer times for all supported exchanges (Bithumb, Upbit, Coinone, GoPax, Binance)', inputSchema: z.object({}) }, async () => proxy('/api/route/fees'))
  server.registerTool('compare_exchange_prices', { description: 'Compare Bithumb KRW prices vs Binance USD prices for tracked coins with transfer-time estimates', inputSchema: z.object({ coin: z.string().optional().describe('Coin symbol (e.g. BTC, XRP). Omit for all.') }) }, async ({ coin }) => {
    const qs = coin?.trim() ? `?coin=${encodeURIComponent(coin.trim().toUpperCase())}` : ''
    return proxy(`/api/route/pairs${qs}`)
  })
  server.registerTool('search_services', { description: 'Search the CrossFin service registry (184 services) by keyword', inputSchema: z.object({ query: z.string().describe('Search keyword') }) }, async ({ query }) => proxy(`/api/registry/search?q=${encodeURIComponent(query)}`))
  server.registerTool('list_services', { description: 'List services from the CrossFin registry with optional category filter', inputSchema: z.object({ category: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }) }, async ({ category, limit }) => {
    const qs = new URLSearchParams()
    if (category?.trim()) qs.set('category', category.trim())
    if (typeof limit === 'number') qs.set('limit', String(limit))
    return proxy(`/api/registry${qs.size ? `?${qs}` : ''}`)
  })
  server.registerTool('get_service', { description: 'Get detailed information about a specific service by ID', inputSchema: z.object({ serviceId: z.string() }) }, async ({ serviceId }) => proxy(`/api/registry/${encodeURIComponent(serviceId)}`))
  server.registerTool('list_categories', { description: 'List all service categories with counts', inputSchema: z.object({}) }, async () => proxy('/api/registry/categories'))
  server.registerTool('get_analytics', { description: 'CrossFin gateway usage analytics — total calls, top services, recent activity', inputSchema: z.object({}) }, async () => proxy('/api/analytics/overview'))
  server.registerTool('get_guide', { description: 'Complete CrossFin API guide — services, pricing, x402 payment flow, code examples', inputSchema: z.object({}) }, async () => proxy('/api/docs/guide'))
  server.registerTool('find_optimal_route', { description: 'Find cheapest/fastest path across 5 exchanges using 11 bridge coins. Paid: $0.10 via x402. Requires local install with EVM_PRIVATE_KEY.', inputSchema: z.object({ from: z.string().describe('Source (e.g. bithumb:KRW)'), to: z.string().describe('Destination (e.g. binance:USDC)'), amount: z.number(), strategy: z.enum(['cheapest', 'fastest', 'balanced']).optional() }) }, async () => LOCAL_ONLY)
  server.registerTool('call_paid_service', { description: 'Call any CrossFin paid API with automatic x402 USDC payment. Requires local install with EVM_PRIVATE_KEY.', inputSchema: z.object({ serviceId: z.string().optional(), url: z.string().optional(), params: z.record(z.string(), z.string()).optional() }) }, async () => LOCAL_ONLY)
  server.registerTool('create_wallet', { description: 'Create a wallet in the local CrossFin ledger. Requires local install.', inputSchema: z.object({ label: z.string(), initialDepositKrw: z.number().optional() }) }, async () => LOCAL_ONLY)
  server.registerTool('get_balance', { description: 'Get wallet balance (KRW). Requires local install.', inputSchema: z.object({ walletId: z.string() }) }, async () => LOCAL_ONLY)
  server.registerTool('transfer', { description: 'Transfer funds between wallets (KRW). Requires local install.', inputSchema: z.object({ fromWalletId: z.string(), toWalletId: z.string(), amountKrw: z.number() }) }, async () => LOCAL_ONLY)
  server.registerTool('list_transactions', { description: 'List transactions. Requires local install.', inputSchema: z.object({ walletId: z.string().optional(), limit: z.number().optional() }) }, async () => LOCAL_ONLY)
  server.registerTool('set_budget', { description: 'Set daily spend limit (KRW). Requires local install.', inputSchema: z.object({ dailyLimitKrw: z.number().nullable() }) }, async () => LOCAL_ONLY)

  await server.server.connect(transport)
  const res = await transport.handleRequest(c.req.raw)
  return new Response(res.body, { status: res.status, headers: {
    ...Object.fromEntries(res.headers.entries()),
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
  }})
})

app.route('/api', api)

// === Guardian Rules Engine ===

async function evaluateGuardian(
  db: D1Database,
  agentId: string | null,
  costUsd: number,
  serviceId?: string,
): Promise<{ allowed: boolean; rule?: string; reason?: string }> {
  if (!agentId) return { allowed: true }

  // Check KILL_SWITCH (global)
  const killSwitch = await db.prepare(
    "SELECT id FROM guardian_rules WHERE type = 'KILL_SWITCH' AND active = 1 AND (agent_id IS NULL OR agent_id = ?) LIMIT 1"
  ).bind(agentId).first<{ id: string }>()
  if (killSwitch) {
    return { allowed: false, rule: killSwitch.id, reason: 'Kill switch active — all operations halted' }
  }

  // Check SPEND_CAP
  const spendCap = await db.prepare(
    "SELECT id, params FROM guardian_rules WHERE type = 'SPEND_CAP' AND active = 1 AND (agent_id IS NULL OR agent_id = ?) ORDER BY agent_id DESC LIMIT 1"
  ).bind(agentId).first<{ id: string; params: string }>()

  if (spendCap) {
    const params = JSON.parse(spendCap.params) as { dailyLimitUsd?: number; monthlyLimitUsd?: number }
    if (params.dailyLimitUsd) {
      const todaySpend = await db.prepare(
        "SELECT COALESCE(SUM(amount_usd), 0) as total FROM agent_spend WHERE agent_id = ? AND created_at >= datetime('now', '-1 day')"
      ).bind(agentId).first<{ total: number }>()
      const spent = todaySpend?.total ?? 0
      if (spent + costUsd > params.dailyLimitUsd) {
        return {
          allowed: false,
          rule: spendCap.id,
          reason: `Daily spend cap: $${spent.toFixed(2)} / $${params.dailyLimitUsd.toFixed(2)} used. This call ($${costUsd.toFixed(4)}) would exceed limit.`,
        }
      }
    }
  }

  // Check FAIL_STREAK
  const failStreak = await db.prepare(
    "SELECT id, params FROM guardian_rules WHERE type = 'FAIL_STREAK' AND active = 1 AND (agent_id IS NULL OR agent_id = ?) ORDER BY agent_id DESC LIMIT 1"
  ).bind(agentId).first<{ id: string; params: string }>()

  if (failStreak) {
    const params = JSON.parse(failStreak.params) as { maxConsecutiveFails?: number }
    const maxFails = params.maxConsecutiveFails ?? 5
    const recentCalls = await db.prepare(
      'SELECT status FROM service_calls WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
    ).bind(agentId, maxFails).all<{ status: string }>()

    const consecutiveFails = recentCalls.results?.filter((r) => r.status === 'error').length ?? 0
    if (consecutiveFails >= maxFails) {
      return {
        allowed: false,
        rule: failStreak.id,
        reason: `Fail streak: ${consecutiveFails} consecutive failures. Auto-paused until manual reset.`,
      }
    }
  }

  // Check CIRCUIT_BREAKER (per service)
  if (serviceId) {
    const circuitBreaker = await db.prepare(
      "SELECT id, params FROM guardian_rules WHERE type = 'CIRCUIT_BREAKER' AND active = 1 AND (agent_id IS NULL OR agent_id = ?) ORDER BY agent_id DESC LIMIT 1"
    ).bind(agentId).first<{ id: string; params: string }>()

    if (circuitBreaker) {
      const params = JSON.parse(circuitBreaker.params) as { failRatePct?: number; windowMinutes?: number }
      const windowMin = params.windowMinutes ?? 60
      const threshold = params.failRatePct ?? 50

      const stats = await db.prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors FROM service_calls WHERE service_id = ? AND created_at >= datetime('now', ? || ' minutes')"
      ).bind(serviceId, `-${windowMin}`).first<{ total: number; errors: number }>()

      const total = stats?.total ?? 0
      const errors = stats?.errors ?? 0
      if (total >= 5 && (errors / total) * 100 > threshold) {
        return {
          allowed: false,
          rule: circuitBreaker.id,
          reason: `Circuit breaker: ${errors}/${total} calls failed (${Math.round((errors / total) * 100)}%) in last ${windowMin}min.`,
        }
      }
    }
  }

  return { allowed: true }
}

async function logAutonomousAction(
  db: D1Database,
  agentId: string | null,
  actionType: string,
  serviceId: string | null,
  decision: string,
  confidence: number | null,
  costUsd: number,
  ruleApplied: string | null,
  details: Record<string, unknown>,
) {
  await db.prepare(
    'INSERT INTO autonomous_actions (id, agent_id, action_type, service_id, decision, confidence, cost_usd, rule_applied, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), agentId, actionType, serviceId, decision, confidence, costUsd, ruleApplied, JSON.stringify(details),
  ).run()
}

async function recordSpend(db: D1Database, agentId: string, amountUsd: number, serviceId: string | null, txHash: string | null) {
  await db.prepare(
    'INSERT INTO agent_spend (id, agent_id, amount_usd, service_id, tx_hash) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), agentId, amountUsd, serviceId, txHash).run()
}

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

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    const [bithumbData, binancePrices, krwRate] = await Promise.all([
      fetchBithumbAll(),
      fetchGlobalPrices(env.DB),
      fetchKrwRate(),
    ])

    const premiums = calcPremiums(bithumbData, binancePrices, krwRate)

    // 1. Kimchi snapshot
    const insertSql = 'INSERT INTO kimchi_snapshots (id, coin, bithumb_krw, binance_usd, premium_pct, krw_usd_rate, volume_24h_usd) VALUES (?, ?, ?, ?, ?, ?, ?)'
    const statements = premiums.map((p) => env.DB.prepare(insertSql).bind(
      crypto.randomUUID(),
      p.coin,
      p.bithumbKrw,
      p.binanceUsd,
      p.premiumPct,
      krwRate,
      p.volume24hUsd,
    ))

    if (statements.length > 0) {
      await env.DB.batch(statements)
    }

    if (isEnabledFlag(env.CROSSFIN_GUARDIAN_ENABLED)) {
      // 2. Autonomous arbitrage scan — log decisions (optional, behind feature flag)
      const BITHUMB_FEES = 0.25
      for (const p of premiums.slice(0, 10)) {
        const netProfit = Math.abs(p.premiumPct) - BITHUMB_FEES - 0.1
        const transferTime = 5
        const slippage = 0.15
        const volatility = Math.abs(p.premiumPct) * 0.3

        const adjustedProfit = netProfit - slippage
        const premiumRisk = volatility * Math.sqrt(transferTime / 60)
        const score = adjustedProfit - premiumRisk

        let decision: string
        let confidence: number
        if (score > 1.0) { decision = 'EXECUTE'; confidence = Math.min(0.95, 0.8 + score * 0.05) }
        else if (score > 0) { decision = 'WAIT'; confidence = 0.5 + score * 0.3 }
        else { decision = 'SKIP'; confidence = Math.max(0.1, 0.5 + score * 0.2) }

        await env.DB.prepare(
          'INSERT INTO autonomous_actions (id, agent_id, action_type, service_id, decision, confidence, cost_usd, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          crypto.randomUUID(), null, 'ARBITRAGE_SCAN', null, decision, confidence, 0,
          JSON.stringify({
            coin: p.coin, premiumPct: p.premiumPct, netProfit, score,
            reason: decision === 'EXECUTE' ? `${p.coin} spread ${p.premiumPct.toFixed(2)}% exceeds threshold` : `${p.coin} score ${score.toFixed(2)} below threshold`,
          }),
        ).run()
      }

      await env.DB.prepare(
        'INSERT INTO audit_logs (id, agent_id, action, resource, resource_id, detail, result) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), null, 'scheduled.guardian_scan', 'autonomous_actions', null, `snapshots=${statements.length},scanned=${Math.min(10, premiums.length)}`, 'success').run()
    } else {
      await env.DB.prepare(
        'INSERT INTO audit_logs (id, agent_id, action, resource, resource_id, detail, result) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), null, 'scheduled.snapshot_kimchi', 'kimchi_snapshots', null, `snapshots=${statements.length}`, 'success').run()
    }
  },
}
