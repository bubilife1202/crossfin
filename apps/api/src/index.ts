import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { paymentMiddleware, x402ResourceServer } from '@x402/hono'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions/bazaar'
import {
  CROSSFIN_API_VERSION,
  CROSSFIN_PAID_ENDPOINTS,
  CROSSFIN_PAID_PRICING,
  withSampleQuery,
} from './catalog'
import type { Bindings, Env } from './types'
import {
  requireCaip2,
  timingSafeEqual,
  isEnabledFlag,
  requireGuardianEnabled,
  isRecord,
  sha256Hex,
  requireAdmin,
  round2,
} from './types'
import {
  CROSSFIN_DISCLAIMER,
  CROSSFIN_LEGAL,
  TRACKED_PAIRS,
  DEFAULT_CROSS_EXCHANGE_COINS,
  BITHUMB_FEES_PCT,
  BINANCE_FEES_PCT,
  EXCHANGE_FEES,
  WITHDRAWAL_FEES,
  ROUTING_EXCHANGES,
  GLOBAL_ROUTING_EXCHANGE_SET,
  KOREAN_ROUTING_EXCHANGE_SET,
  ROUTING_EXCHANGE_CURRENCIES,
  ROUTING_SUPPORTED_CURRENCIES,
  EXCHANGE_DISPLAY_NAME,
  ROUTING_EXCHANGE_COUNTRY,
  BRIDGE_COINS,
  GLOBAL_PRICES_SUCCESS_TTL_MS,
  CORS_ALLOWED_ORIGINS,
} from './constants'
import type {
  RoutingExchange,
  RoutingStrategy,
} from './constants'
import {
  cloneDefaultTradingFees,
  cloneDefaultWithdrawalFees,
  getWithdrawalFee,
  getExchangeTradingFees,
  getExchangeWithdrawalFees,
  getWithdrawalSuspensions,
  fetchBithumbAll,
  fetchBithumbOrderbook,
  getExchangePrice,
  fetchGlobalPrices,
  fetchGlobalPricesWithMeta,
  fetchUsdFxRates,
  fetchKrwRate,
  fetchFxRatesWithMeta,
  fetchUpbitTicker,
  fetchUpbitOrderbook,
  fetchCoinoneTicker,
  fetchWazirxTickers,
  fetchBitbankTickers,
  fetchIndodaxTickers,
  fetchBitkubTickers,
  calcAsianPremium,
  calcPremiums,
  fetchWithTimeout,
  CROSSFIN_UA,
} from './lib/fetchers'
import {
  getTransferTime,
  estimateSlippage,
  getPremiumTrend,
  computeAction,
  computeRouteAction,
} from './lib/engine'
import { topicToAddress } from './lib/onchain'
import { audit, ensurePremiumPaymentsTable } from './lib/helpers'
import adminRoutes from './routes/admin'
import mcpRoutes from './routes/mcp'
import a2aRoutes from './routes/a2a'
import statusRoutes from './routes/status'
import discoveryRoutes from './routes/discovery'
import legalRoutes from './routes/legal'
import onchainRoutes from './routes/onchain'
import { createDocsRoutes } from './routes/docs'
import { createMetaRoutes } from './routes/meta'
import { createRegistryPublicRoutes } from './routes/registryPublic'
import { createRegistryAdminRoutes } from './routes/registryAdmin'
import { createCronRoutes } from './routes/cron'
import { createGuardianRoutes } from './routes/guardian'
import { createAnalyticsRoutes } from './routes/analytics'
import {
  createRoutingRoutes,
  getRoutePairsPayload,
  getRouteFeesPayload,
  getRouteStatusPayload,
} from './routes/routing'

import type { GlobalPricesMeta, FxRatesMeta } from './lib/fetchers'

type DataMeta = {
  freshness: 'live' | 'cached' | 'stale' | 'fallback'
  sourceAgeMs: number
  sources: string[]
  warnings: string[]
}

function buildDataMeta(priceMeta?: GlobalPricesMeta, fxMeta?: FxRatesMeta): DataMeta {
  const warnings: string[] = []
  const sources: string[] = []
  let worstFreshness: DataMeta['freshness'] = 'live'
  let maxAgeMs = 0

  const freshnessRank = { live: 0, cached: 1, stale: 2, fallback: 3 } as const
  const worsen = (current: DataMeta['freshness'], next: DataMeta['freshness']): DataMeta['freshness'] =>
    freshnessRank[next] > freshnessRank[current] ? next : current

  if (priceMeta) {
    sources.push(`prices:${priceMeta.source}`)
    warnings.push(...priceMeta.warnings)
    if (priceMeta.ageMs > maxAgeMs) maxAgeMs = priceMeta.ageMs
    if (priceMeta.source === 'd1-snapshot') worstFreshness = worsen(worstFreshness, 'fallback')
    else if (priceMeta.source === 'coingecko' || priceMeta.source === 'cryptocompare') worstFreshness = worsen(worstFreshness, 'stale')
    else if (priceMeta.ageMs > 30000) worstFreshness = worsen(worstFreshness, 'cached')
  }

  if (fxMeta) {
    sources.push(`fx:${fxMeta.source}`)
    warnings.push(...fxMeta.warnings)
    if (fxMeta.isFallback) worstFreshness = worsen(worstFreshness, 'fallback')
  }

  return { freshness: worstFreshness, sourceAgeMs: Math.round(maxAgeMs), sources, warnings }
}

const TELEGRAM_ROUTE_USAGE = [
  '라우팅 명령 형식:',
  '/route bithumb:KRW binance:USDC 5000000 cheapest',
  '/route bithumb binance 5000000',
  '전략: cheapest | fastest | balanced (생략 시 cheapest)',
].join('\n')

function parseTelegramRouteCommand(text: string): {
  fromExchange: string
  fromCurrency: string
  toExchange: string
  toCurrency: string
  amount: number
  strategy: RoutingStrategy
} | null {
  const trimmed = text.trim()
  if (!/^\/route(?:@[a-zA-Z0-9_]+)?\b/i.test(trimmed)) return null

  const usage = `입력 형식이 올바르지 않습니다.\n${TELEGRAM_ROUTE_USAGE}`

  const content = trimmed.replace(/^\/route(?:@[a-zA-Z0-9_]+)?\s*/i, '').trim()
  if (!content) {
    throw new HTTPException(400, { message: usage })
  }

  const parseAmountToken = (raw: string): number => {
    const normalized = raw
      .replace(/_/g, '')
      .replace(/,/g, '')
      .replace(/[^\d.]/g, '')
      .trim()
    if (!normalized) return NaN
    return Number(normalized)
  }

  const splitExchangeCurrencyToken = (token: string): { exchange: string; currency: string } => {
    const cleaned = token
      .trim()
      .replace(/^from[:=]/i, '')
      .replace(/^to[:=]/i, '')
      .replace(/[()[\],]/g, '')
      .replace('/', ':')
    const [exchangeRaw, currencyRaw] = cleaned.split(':')
    return {
      exchange: String(exchangeRaw ?? '').trim().toLowerCase(),
      currency: String(currencyRaw ?? '').trim().toUpperCase(),
    }
  }

  const strategySet = new Set<string>(['cheapest', 'fastest', 'balanced'])

  let fromToken = ''
  let toToken = ''
  let amountToken = ''
  let strategyRaw = 'cheapest'

  const keyValueParts = content.split(/\s+/).filter(Boolean)
  const keyValue = keyValueParts.reduce<Record<string, string>>((acc, part) => {
    const eq = part.indexOf('=')
    if (eq <= 0) return acc
    const key = part.slice(0, eq).trim().toLowerCase()
    const value = part.slice(eq + 1).trim()
    if (key && value) acc[key] = value
    return acc
  }, {})

  if (keyValue.from && keyValue.to && keyValue.amount) {
    fromToken = keyValue.from
    toToken = keyValue.to
    amountToken = keyValue.amount
    strategyRaw = String(keyValue.strategy ?? 'cheapest')
  } else {
    const tokens = content
      .replace(/<->/g, ' ')
      .replace(/-->/g, ' ')
      .replace(/->/g, ' ')
      .replace(/[\u2192\u21c4]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)

    if (tokens.length < 3) {
      throw new HTTPException(400, { message: usage })
    }

    const maybeStrategy = tokens[tokens.length - 1]?.toLowerCase() ?? ''
    if (strategySet.has(maybeStrategy)) {
      strategyRaw = maybeStrategy
      tokens.pop()
    }

    let amountIndex = -1
    for (let idx = tokens.length - 1; idx >= 0; idx -= 1) {
      const candidate = tokens[idx] ?? ''
      const parsedAmount = parseAmountToken(candidate)
      if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
        amountIndex = idx
        break
      }
    }
    if (amountIndex < 0) {
      throw new HTTPException(400, { message: `${usage}\n금액은 0보다 큰 숫자로 입력해주세요.` })
    }

    amountToken = tokens[amountIndex] ?? ''
    const endpointTokens = tokens
      .filter((_, idx) => idx !== amountIndex)
      .map((token) => token.replace(/[()[\],]/g, '').trim())
      .filter(Boolean)
      .filter((token) => {
        const lowered = token.toLowerCase()
        return lowered !== 'from' && lowered !== 'to'
      })

    if (endpointTokens.length < 2) {
      throw new HTTPException(400, { message: usage })
    }

    fromToken = endpointTokens[0] ?? ''
    toToken = endpointTokens[1] ?? ''
  }

  const { exchange: fromExchange, currency: fromCurrencyRaw } = splitExchangeCurrencyToken(fromToken)
  const { exchange: toExchange, currency: toCurrencyRaw } = splitExchangeCurrencyToken(toToken)
  const amount = parseAmountToken(amountToken)

  if (!ROUTING_EXCHANGES.includes(fromExchange as RoutingExchange)) {
    throw new HTTPException(400, {
      message: `출발 거래소가 잘못되었습니다: ${fromExchange || '(empty)'}\n지원 거래소: ${ROUTING_EXCHANGES.join(', ')}`,
    })
  }
  if (!ROUTING_EXCHANGES.includes(toExchange as RoutingExchange)) {
    throw new HTTPException(400, {
      message: `도착 거래소가 잘못되었습니다: ${toExchange || '(empty)'}\n지원 거래소: ${ROUTING_EXCHANGES.join(', ')}`,
    })
  }

  const defaultCurrencyFor = (exchange: string): string => {
    const allowed = ROUTING_EXCHANGE_CURRENCIES[exchange as RoutingExchange] ?? []
    return String(allowed[0] ?? '').toUpperCase()
  }

  const fromCurrency = String(fromCurrencyRaw ?? '').trim().toUpperCase() || defaultCurrencyFor(fromExchange)
  const toCurrency = String(toCurrencyRaw ?? '').trim().toUpperCase() || defaultCurrencyFor(toExchange)

  if (!fromCurrency || !toCurrency) {
    throw new HTTPException(400, {
      message: `통화를 자동 추론할 수 없습니다.\n${TELEGRAM_ROUTE_USAGE}`,
    })
  }

  assertRoutingCurrencySupported(fromExchange, fromCurrency, 'from')
  assertRoutingCurrencySupported(toExchange, toCurrency, 'to')
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HTTPException(400, { message: '금액은 0보다 큰 숫자로 입력해주세요.' })
  }

  const strategyToken = String(strategyRaw).trim().toLowerCase().replace(/[^a-z]/g, '')
  const strategy: RoutingStrategy =
    strategyToken === 'fastest'
      ? 'fastest'
      : strategyToken === 'balanced'
        ? 'balanced'
        : 'cheapest'

  return { fromExchange, fromCurrency, toExchange, toCurrency, amount, strategy }
}

function parseTelegramCoinArgument(text: string): string | null {
  const args = text.trim().split(/\s+/)
  if (args.length < 2) return null

  const raw = String(args[1] ?? '').trim().toUpperCase()
  if (!raw) return null

  const normalized = raw.replace(/[^A-Z0-9]/g, '')
  return normalized || null
}

function isTrackedPairCoin(coin: string): boolean {
  return Object.prototype.hasOwnProperty.call(TRACKED_PAIRS, coin)
}

function trackedPairCoinsCsv(): string {
  return Object.keys(TRACKED_PAIRS).join(', ')
}

async function telegramSendMessage(
  botToken: string,
  chatId: string | number,
  text: string,
  parseMode?: 'Markdown',
): Promise<void> {
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      parse_mode: parseMode,
    }),
  }, 10000)
  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`telegram_send_message_failed:${response.status} ${details.slice(0, 180)}`)
  }
}

async function telegramSendTyping(botToken: string, chatId: string | number): Promise<void> {
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  }, 10000)
  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`telegram_send_typing_failed:${response.status} ${details.slice(0, 180)}`)
  }
}

async function telegramSendTypingSafe(botToken: string, chatId: string | number): Promise<void> {
  try {
    await telegramSendTyping(botToken, chatId)
    console.log('[telegram] sendChatAction success', chatId)
  } catch (err) {
    console.warn('[telegram] sendChatAction failed', err)
  }
}

function startTelegramTypingLoop(
  botToken: string,
  chatId: string | number,
  intervalMs: number = 4000,
  waitUntil?: (promise: Promise<unknown>) => void,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const stop = () => {
    stopped = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const sendTyping = () => {
    const p = telegramSendTypingSafe(botToken, chatId)
    if (waitUntil) waitUntil(p)
  }

  sendTyping()
  const tick = () => {
    if (stopped) return
    timer = setTimeout(() => {
      if (stopped) return
      sendTyping()
      tick()
    }, intervalMs)
  }
  tick()

  return stop
}

interface GlmMessage {
  role: string
  content?: string
  tool_calls?: Array<{
    id: string
    type: string
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string
}

interface GlmTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

const CROSSFIN_TELEGRAM_TOOLS: GlmTool[] = [
  {
    type: 'function',
    function: {
      name: 'find_route',
      description: 'Find the cheapest/fastest crypto transfer route across 13 exchanges (Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, bitbank, Indodax, Bitkub, Binance, OKX, Bybit, KuCoin). Use when user asks about sending crypto, transferring money, or finding best exchange path.',
      parameters: {
        type: 'object',
        properties: {
          from_exchange: { type: 'string', description: 'Source exchange (bithumb/upbit/coinone/gopax/bitflyer/wazirx/bitbank/indodax/bitkub/binance/okx/bybit/kucoin)', enum: ['bithumb', 'upbit', 'coinone', 'gopax', 'bitflyer', 'wazirx', 'bitbank', 'indodax', 'bitkub', 'binance', 'okx', 'bybit', 'kucoin'] },
          from_currency: { type: 'string', description: 'Source currency (KRW/JPY/INR/USDC/USDT/USD)', enum: ['KRW', 'JPY', 'INR', 'USDC', 'USDT', 'USD'] },
          to_exchange: { type: 'string', description: 'Destination exchange', enum: ['bithumb', 'upbit', 'coinone', 'gopax', 'bitflyer', 'wazirx', 'bitbank', 'indodax', 'bitkub', 'binance', 'okx', 'bybit', 'kucoin'] },
          to_currency: { type: 'string', description: 'Destination currency', enum: ['KRW', 'JPY', 'INR', 'USDC', 'USDT', 'USD'] },
          amount: { type: 'number', description: 'Amount to transfer' },
          strategy: { type: 'string', description: 'Routing strategy', enum: ['cheapest', 'fastest', 'balanced'] },
        },
        required: ['from_exchange', 'from_currency', 'to_exchange', 'to_currency', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_prices',
      description: 'Get live crypto prices across Korean and global exchanges. Use when user asks about prices, rates, or how much a coin costs.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_exchange_status',
      description: 'Check which exchanges are online/offline. Use when user asks about exchange status or if an exchange is working.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_kimchi_premium',
      description: 'Get the Korea-vs-global route spread. Use when user asks about route spread, arbitrage, or Korea/global price difference.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fees',
      description: 'Compare trading and withdrawal fees across exchanges. Use when user asks about fees, costs, or which exchange is cheapest.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

const CROSSFIN_TELEGRAM_SYSTEM_PROMPT = 'You are CrossFin Bot — an AI assistant that finds the cheapest crypto transfer routes across 13 exchanges (Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, bitbank, Indodax, Bitkub, Binance, OKX, Bybit, KuCoin). You also check live prices, exchange status, route spread, and fees. Rules: 1) Never use emojis. 2) Be concise — short sentences, no filler. 3) Match the user\'s language (Korean or English). 4) When you have enough info, call tools immediately instead of asking more questions. 5) If info is missing, ask in one short sentence, not a numbered list. 6) Only answer questions about crypto routing, exchange prices, fees, route spread, and Korean/global crypto markets. For unrelated topics, say you only handle crypto routing and suggest what you can help with. 7) You are read-only — you CANNOT execute trades, send crypto, or move funds. You only FIND and RECOMMEND routes. Never ask "실행하시겠습니까" or suggest you can execute anything. 8) After showing a route, suggest the user can try different amounts or exchange pairs.'

async function glmChatCompletion(apiKey: string, messages: GlmMessage[], tools: GlmTool[]): Promise<GlmMessage> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch('https://api.z.ai/api/coding/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}`, 'User-Agent': 'CrossFin-API/1.10.1' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'glm-5',
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 2048,
        stream: false,
      }),
    })
    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`GLM-5 API error ${res.status}: ${errText.slice(0, 200)}`)
    }
    const raw: unknown = await res.json()
    if (!raw || typeof raw !== 'object' || !('choices' in raw)) throw new Error('GLM-5 unexpected response format')
    const data = raw as { choices: Array<{ message: GlmMessage }> }
    const message = data.choices[0]?.message
    if (!message) throw new Error('GLM-5 API returned no message')
    return message
  } finally {
    clearTimeout(timeout)
  }
}

async function executeTelegramTool(name: string, args: Record<string, unknown>, db: D1Database): Promise<string> {
  switch (name) {
    case 'find_route': {
      const fromExchange = String(args.from_exchange ?? '').trim().toLowerCase()
      const fromCurrency = String(args.from_currency ?? '').trim().toUpperCase()
      const toExchange = String(args.to_exchange ?? '').trim().toLowerCase()
      const toCurrency = String(args.to_currency ?? '').trim().toUpperCase()
      const amount = Number(args.amount ?? NaN)
      const strategyRaw = String(args.strategy ?? 'cheapest').trim().toLowerCase()
      const strategy: RoutingStrategy =
        strategyRaw === 'fastest' ? 'fastest' : strategyRaw === 'balanced' ? 'balanced' : 'cheapest'

      if (!ROUTING_EXCHANGES.includes(fromExchange as RoutingExchange)) {
        throw new Error(`Invalid from_exchange: ${fromExchange}`)
      }
      if (!ROUTING_EXCHANGES.includes(toExchange as RoutingExchange)) {
        throw new Error(`Invalid to_exchange: ${toExchange}`)
      }
      if (!fromCurrency || !toCurrency) {
        throw new Error('from_currency and to_currency are required')
      }
      if (!isRoutingCurrencySupported(fromExchange, fromCurrency)) {
        throw new Error(`Unsupported from pair: ${fromExchange}:${fromCurrency}`)
      }
      if (!isRoutingCurrencySupported(toExchange, toCurrency)) {
        throw new Error(`Unsupported to pair: ${toExchange}:${toCurrency}`)
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('amount must be a positive number')
      }

      const route = await findOptimalRoute(
        fromExchange,
        fromCurrency,
        toExchange,
        toCurrency,
        amount,
        strategy,
        db,
      )
      return JSON.stringify(route)
    }
    case 'get_prices': {
      const data = await getRoutePairsPayload(db)
      return JSON.stringify(data)
    }
    case 'get_exchange_status': {
      const data = await getRouteStatusPayload(db)
      return JSON.stringify(data)
    }
    case 'get_kimchi_premium': {
      const data = await getArbitrageDemoPayload(db)
      return JSON.stringify(data)
    }
    case 'get_fees': {
      const data = await getRouteFeesPayload(db, null)
      return JSON.stringify(data)
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

const app = new Hono<Env>()

const PUBLIC_RATE_LIMIT_WINDOW_MS = 60_000
const PUBLIC_RATE_LIMIT_PER_WINDOW = 120
const PUBLIC_RATE_LIMIT_MAX_BUCKETS = 20_000
const AGENT_REGISTER_ATTEMPT_WINDOW_MINUTES = 60
const AGENT_REGISTER_MAX_ATTEMPTS_PER_WINDOW = 3
const TELEGRAM_AI_MAX_MESSAGES_PER_CHAT_PER_HOUR = 40
const TELEGRAM_AI_MAX_MESSAGES_GLOBAL_PER_DAY = 3000
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
    normalized === '/api/acp/status' ||
    normalized === '/api/acp/quote' ||
    normalized === '/api/acp/execute' ||
    normalized === '/api/mcp' ||
    normalized === '/api/telegram/webhook' ||
    normalized === '/api/status'
  ) {
    return normalized
  }

  if (normalized.startsWith('/api/a2a/')) return '/api/a2a'
  if (normalized.startsWith('/api/acp/executions/')) return '/api/acp/executions/:executionId'
  if (normalized.startsWith('/api/registry/')) return '/api/registry/:id'
  if (normalized.startsWith('/api/analytics/services/')) return '/api/analytics/services/:serviceId'
  return null
}

function getEndpointTelemetryRouteKey(path: string): string | null {
  const normalized = trimTrailingSlash(path)
  if (!normalized.startsWith('/api/')) return null

  if (
    normalized === '/api/analytics/overview' ||
    normalized === '/api/analytics/funnel/overview' ||
    normalized === '/api/analytics/funnel/events' ||
    normalized === '/api/stats' ||
    normalized === '/api/registry/stats' ||
    normalized === '/api/registry/categories'
  ) {
    return null
  }

  if (normalized.startsWith('/api/registry/')) return '/api/registry/:id'
  if (normalized.startsWith('/api/analytics/services/')) return '/api/analytics/services/:serviceId'
  if (normalized.startsWith('/api/proxy/')) return '/api/proxy/:serviceId'
  if (normalized.startsWith('/api/acp/executions/')) return '/api/acp/executions/:executionId'
  return normalized
}

function getClientRateLimitKey(c: Context<Env>): string {
  // Use only CF-Connecting-IP (set by Cloudflare, not spoofable by clients).
  // Do NOT fall back to X-Forwarded-For which can be forged to bypass rate limits.
  const cfIp = (c.req.header('CF-Connecting-IP') ?? '').trim()
  return cfIp || 'unknown'
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
  origin: (requestOrigin) => CORS_ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : '',
  allowHeaders: ['Content-Type', 'Authorization', 'X-Agent-Key', 'X-CrossFin-Signup-Token', 'PAYMENT-SIGNATURE'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
}))

app.use('/api/*', publicRateLimit)

let endpointCallsTableReady: Promise<void> | null = null
let agentRegistrationAttemptsTableReady: Promise<void> | null = null
type EndpointTrafficSource = 'external' | 'internal' | 'dashboard'

async function ensureEndpointCallsTable(db: D1Database): Promise<void> {
  if (!endpointCallsTableReady) {
    endpointCallsTableReady = db.batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS endpoint_calls (
           id TEXT PRIMARY KEY,
           method TEXT NOT NULL,
           path TEXT NOT NULL,
           status TEXT NOT NULL,
           response_time_ms INTEGER,
           created_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_endpoint_calls_path_created ON endpoint_calls(path, created_at)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_endpoint_calls_created ON endpoint_calls(created_at)'),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS endpoint_calls_v2 (
           id TEXT PRIMARY KEY,
           method TEXT NOT NULL,
           path TEXT NOT NULL,
           status TEXT NOT NULL,
           response_time_ms INTEGER,
           traffic_source TEXT NOT NULL DEFAULT 'external' CHECK (traffic_source IN ('external', 'internal', 'dashboard')),
           user_agent TEXT,
           ip_hash TEXT,
           session_fingerprint TEXT,
           created_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_endpoint_calls_v2_path_created ON endpoint_calls_v2(path, created_at)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_endpoint_calls_v2_created ON endpoint_calls_v2(created_at)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_endpoint_calls_v2_source_created ON endpoint_calls_v2(traffic_source, created_at)'),
    ]).then(async () => {
      await db.exec('ALTER TABLE endpoint_calls_v2 ADD COLUMN ip_hash TEXT').catch(() => {})
      await db.exec('ALTER TABLE endpoint_calls_v2 ADD COLUMN session_fingerprint TEXT').catch(() => {})
      await db.exec('CREATE INDEX IF NOT EXISTS idx_endpoint_calls_v2_ip_hash ON endpoint_calls_v2(ip_hash)').catch(() => {})
      await db.exec('CREATE INDEX IF NOT EXISTS idx_endpoint_calls_v2_fingerprint ON endpoint_calls_v2(session_fingerprint)').catch(() => {})
    }).catch((err) => {
      endpointCallsTableReady = null
      throw err
    })
  }

  await endpointCallsTableReady
}

async function ensureAgentRegistrationAttemptsTable(db: D1Database): Promise<void> {
  if (!agentRegistrationAttemptsTableReady) {
    agentRegistrationAttemptsTableReady = db.batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS agent_registration_attempts (
           id TEXT PRIMARY KEY,
           ip_hash TEXT NOT NULL,
           ip_hint TEXT NOT NULL,
           name TEXT,
           success INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1)),
           reason TEXT NOT NULL,
           agent_id TEXT REFERENCES agents(id),
           created_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_agent_registration_attempts_ip_created ON agent_registration_attempts(ip_hash, created_at DESC)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_agent_registration_attempts_success_created ON agent_registration_attempts(success, created_at DESC)'),
    ]).then(() => undefined).catch((err) => {
      agentRegistrationAttemptsTableReady = null
      throw err
    })
  }

  await agentRegistrationAttemptsTableReady
}

function maskIpForAudit(ip: string): string {
  const raw = ip.trim()
  if (!raw || raw === 'unknown') return 'unknown'

  if (raw.includes(':')) {
    const parts = raw.split(':').filter(Boolean)
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}:*`
    return `${parts[0] ?? 'ipv6'}:*`
  }

  const parts = raw.split('.')
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`
  return raw
}

async function logAgentRegistrationAttempt(
  db: D1Database,
  ipHash: string,
  ipHint: string,
  name: string,
  success: boolean,
  reason: string,
  agentId: string | null = null,
): Promise<void> {
  await ensureAgentRegistrationAttemptsTable(db)
  await db.prepare(
    `INSERT INTO agent_registration_attempts
      (id, ip_hash, ip_hint, name, success, reason, agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    ipHash,
    ipHint,
    name || null,
    success ? 1 : 0,
    reason,
    agentId,
  ).run()
}

/** Origins whose API calls should NOT be counted in endpoint telemetry (dashboard self-calls). */
const TELEMETRY_EXCLUDED_ORIGINS = new Set([
  'https://crossfin.dev',
  'https://www.crossfin.dev',
  'https://crossfin.pages.dev',
  'https://live.crossfin.dev',
  'https://crossfin-live.pages.dev',
  'http://localhost:5173',
])

function isSelfDashboardCall(c: Context<Env>): boolean {
  const origin = (c.req.header('Origin') ?? '').trim().toLowerCase()
  if (origin && TELEMETRY_EXCLUDED_ORIGINS.has(origin)) return true

  const referer = (c.req.header('Referer') ?? '').trim().toLowerCase()
  if (!referer) return false
  try {
    return TELEMETRY_EXCLUDED_ORIGINS.has(new URL(referer).origin)
  } catch { return false }
}

const INTERNAL_CALL_USER_AGENT_PATTERNS = [
  'smoke-prod',
  'contract-guard',
]

function getEndpointTrafficSource(c: Context<Env>): EndpointTrafficSource {
  if (isSelfDashboardCall(c)) return 'dashboard'

  const taggedInternal = (c.req.header('X-CrossFin-Internal') ?? '').trim().toLowerCase()
  if (taggedInternal === '1' || taggedInternal === 'true' || taggedInternal === 'yes') {
    return 'internal'
  }

  const userAgent = (c.req.header('User-Agent') ?? '').trim().toLowerCase()
  if (userAgent && INTERNAL_CALL_USER_AGENT_PATTERNS.some((p) => userAgent.includes(p))) {
    return 'internal'
  }

  return 'external'
}

const endpointTelemetry: MiddlewareHandler<Env> = async (c, next) => {
  const routeKey = getEndpointTelemetryRouteKey(c.req.path)
  const source = getEndpointTrafficSource(c)
  if (!routeKey || c.req.method === 'OPTIONS' || source === 'dashboard') {
    await next()
    return
  }

  const startedAt = Date.now()
  let statusCode = 500

  try {
    await next()
    statusCode = c.res.status
  } catch (err) {
    statusCode = err instanceof HTTPException ? err.status : 500
    throw err
  } finally {
    const responseTimeMs = Date.now() - startedAt
    const status = statusCode >= 200 && statusCode < 500 ? 'success' : 'error'

    try {
      await ensureEndpointCallsTable(c.env.DB)
      const clientIp = getClientRateLimitKey(c)
      const userAgent = (c.req.header('User-Agent') ?? '').slice(0, 180)
      const ipHash = await sha256Hex(`endpoint-telemetry:${clientIp}`).catch(() => null)
      const fingerprint = await sha256Hex(`fp:${clientIp}:${userAgent}`).catch(() => null)

      await c.env.DB.prepare(
        'INSERT INTO endpoint_calls (id, method, path, status, response_time_ms) VALUES (?, ?, ?, ?, ?)'
      ).bind(
        `endpoint_call_${crypto.randomUUID()}`,
        c.req.method,
        routeKey,
        status,
        responseTimeMs,
      ).run()

      await c.env.DB.prepare(
        'INSERT INTO endpoint_calls_v2 (id, method, path, status, response_time_ms, traffic_source, user_agent, ip_hash, session_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        `endpoint_call_v2_${crypto.randomUUID()}`,
        c.req.method,
        routeKey,
        status,
        responseTimeMs,
        source,
        userAgent,
        ipHash,
        fingerprint,
      ).run().catch(() => {
        return c.env.DB.prepare(
          'INSERT INTO endpoint_calls_v2 (id, method, path, status, response_time_ms, traffic_source, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          `endpoint_call_v2_${crypto.randomUUID()}`,
          c.req.method,
          routeKey,
          status,
          responseTimeMs,
          source,
          userAgent,
        ).run()
      })
    } catch (err) {
      console.error('Failed to log endpoint call', err)
    }
  }
}

app.use('/api/*', endpointTelemetry)

// Global disclaimer + legal injection middleware
app.use('*', async (c, next) => {
  await next()
  const ct = c.res.headers.get('content-type')
  if (!ct?.includes('application/json')) return
  try {
    const body = await c.res.clone().json()
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      const enhanced: Record<string, unknown> = { ...body }
      if (!('_disclaimer' in enhanced)) enhanced._disclaimer = CROSSFIN_DISCLAIMER
      if (!('_legal' in enhanced)) enhanced._legal = CROSSFIN_LEGAL
      c.res = Response.json(enhanced, {
        status: c.res.status,
        headers: c.res.headers,
      })
    }
  } catch {
    // keep original response on parse failure
  }
})

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, _disclaimer: CROSSFIN_DISCLAIMER, _legal: CROSSFIN_LEGAL }, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error', _disclaimer: CROSSFIN_DISCLAIMER, _legal: CROSSFIN_LEGAL }, 500)
})

const getGuidePayload = () => ({
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
      { path: '/api/arbitrage/demo', description: 'Free route spread preview (top 3 pairs)' },
      { path: '/api/analytics/overview', description: 'Gateway usage analytics' },
      { path: '/api/analytics/funnel/overview', description: 'Web onboarding conversion funnel analytics' },
      { path: '/api/analytics/funnel/events', description: 'Track web onboarding events (POST)' },
      { path: '/api/stats', description: 'Public-safe summary (sensitive counts redacted)' },
      { path: '/api/openapi.json', description: 'OpenAPI 3.1 specification' },
      { path: '/api/docs/guide', description: 'This guide' },
      { path: '/.well-known/crossfin.json', description: 'CrossFin discovery metadata for agents' },
      { path: '/.well-known/x402.json', description: 'x402 discovery metadata (payment/network/endpoints)' },
      { path: '/.well-known/glama.json', description: 'Glama.ai ownership verification' },
      { path: '/api/route/exchanges', description: 'List supported exchanges with trading fees and supported coins' },
      { path: '/api/route/fees', description: 'Fee comparison table — trading + withdrawal fees for all exchanges' },
      { path: '/api/route/fees?coin=KAIA', description: 'Fee comparison for a specific coin' },
      { path: '/api/route/pairs', description: 'All supported trading pairs with live Binance prices' },
      { path: '/api/route/status', description: 'Exchange API health check (online/offline per exchange)' },
      { path: '/api/routing/optimal', description: 'Free live routing endpoint for RouteGraph (orderbook/slippage + real fee table)' },
      { path: '/api/acp/status', description: 'ACP protocol capabilities and supported exchanges' },
      { path: 'POST /api/acp/quote', description: 'Request a free routing quote (ACP-compatible, preview-only)' },
      { path: 'POST /api/acp/execute', description: 'Start tracked execution (step-level orchestration simulation)' },
      { path: 'GET /api/acp/executions/{execution_id}', description: 'Get execution progress and step-by-step state' },
      { path: 'POST /api/telegram/webhook', description: 'Telegram bot webhook endpoint for /route command integration' },
    ],
    notes: [
      'Proxy endpoints (/api/proxy/:serviceId) require X-Agent-Key to prevent abuse.',
      'Regional fiat exchanges (KRW: Upbit/Bithumb/Coinone/GoPax, JPY: bitFlyer, INR: WazirX, IDR: Indodax, THB: Bitkub) and global exchanges (Binance/OKX/Bybit) are all supported.',
      'Routing engine supports bidirectional transfers: Korea→Global and Global→Korea.',
    ],
    crossfinServices: {
      _note: '33 cataloged paid endpoints organized by category (+2 utility paid endpoints: /api/premium/report, /api/premium/enterprise). All paid via x402 with USDC on Base mainnet.',
      crypto_arbitrage: [
        { id: 'crossfin_kimchi_premium', endpoint: '/api/premium/arbitrage/kimchi', price: '$0.05', description: 'Real-time Route Spread Index — price spread between Korean (Bithumb) and global (Binance) exchanges for 11 crypto pairs including KAIA.' },
        { id: 'crossfin_kimchi_premium_history', endpoint: '/api/premium/arbitrage/kimchi/history', price: '$0.05', description: 'Hourly snapshots of route spread data from D1 database, up to 7 days lookback. Query by coin and time range.' },
        { id: 'crossfin_arbitrage_opportunities', endpoint: '/api/premium/arbitrage/opportunities', price: '$0.10', description: 'AI-ready market condition indicators: POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD with slippage, premium trends, transfer time risk, and signal strength scores.' },
        { id: 'crossfin_cross_exchange', endpoint: '/api/premium/market/cross-exchange', price: '$0.08', description: 'Compare prices across 4 Korean exchanges with SPREAD_OPPORTUNITY/NEUTRAL_SIGNAL/MONITORING indicators and best buy/sell routing.' },
        { id: 'crossfin_crypto_korea_5exchange', endpoint: '/api/premium/crypto/korea/5exchange?coin=BTC', price: '$0.08', description: 'Compare crypto prices across 4 Korean exchanges (Upbit, Bithumb, Coinone, GoPax) for any coin.' },
      ],
      exchange_data: [
        { id: 'crossfin_bithumb_orderbook', endpoint: '/api/premium/bithumb/orderbook?pair=BTC', price: '$0.02', description: 'Live 30-level orderbook depth from Bithumb for any KRW trading pair.' },
        { id: 'crossfin_bithumb_volume', endpoint: '/api/premium/bithumb/volume-analysis', price: '$0.03', description: '24h volume distribution, concentration, and unusual volume detection across Bithumb.' },
        { id: 'crossfin_upbit_ticker', endpoint: '/api/premium/market/upbit/ticker?market=KRW-BTC', price: '$0.02', description: 'Upbit spot ticker data for any KRW market pair.' },
        { id: 'crossfin_upbit_orderbook', endpoint: '/api/premium/market/upbit/orderbook?market=KRW-BTC', price: '$0.02', description: 'Upbit orderbook snapshot for any KRW market pair.' },
        { id: 'crossfin_upbit_signals', endpoint: '/api/premium/market/upbit/signals', price: '$0.05', description: 'Trading signals for major KRW markets on Upbit — momentum, relative volume, volatility, and combined bullish/bearish/neutral call.' },
        { id: 'crossfin_upbit_candles', endpoint: '/api/premium/crypto/korea/upbit-candles?coin=BTC&type=days', price: '$0.02', description: 'Upbit OHLCV candle data (1m, 5m, 15m, 1h, 4h, daily, weekly, monthly). Up to 200 candles.' },
        { id: 'crossfin_coinone_ticker', endpoint: '/api/premium/market/coinone/ticker?currency=BTC', price: '$0.02', description: 'Coinone spot ticker data for any KRW pair.' },
        { id: 'crossfin_crypto_korea_exchange_status', endpoint: '/api/premium/crypto/korea/exchange-status', price: '$0.03', description: 'Bithumb deposit/withdrawal status for all coins — check before transferring.' },
      ],
      market_sentiment: [
        { id: 'crossfin_korea_sentiment', endpoint: '/api/premium/market/korea', price: '$0.03', description: 'Korean crypto market sentiment — top gainers, losers, volume leaders, and overall market mood (bullish/bearish/neutral).' },
        { id: 'crossfin_korea_headlines', endpoint: '/api/premium/news/korea/headlines', price: '$0.03', description: 'Korean crypto/finance news headlines via Google News RSS feed.' },
      ],
      fx_rates: [
        { id: 'crossfin_usdkrw', endpoint: '/api/premium/market/fx/usdkrw', price: '$0.01', description: 'USD/KRW exchange rate for converting Korean exchange prices.' },
        { id: 'crossfin_crypto_korea_fx_rate', endpoint: '/api/premium/crypto/korea/fx-rate', price: '$0.01', description: 'Real-time KRW/USD exchange rate from Upbit CRIX with 52-week high/low context.' },
      ],
      bundle_apis: [
        { id: 'crossfin_morning_brief', endpoint: '/api/premium/morning/brief', price: '$0.20', description: 'Morning Brief — route spread + FX rate + headlines in one call. Best value for daily market overview.' },
        { id: 'crossfin_crypto_snapshot', endpoint: '/api/premium/crypto/snapshot', price: '$0.15', description: 'Crypto Snapshot — 4-exchange BTC prices + route spread + Bithumb volume + FX rate in one call.' },
        { id: 'crossfin_kimchi_stats', endpoint: '/api/premium/kimchi/stats', price: '$0.15', description: 'Route Spread Stats — current spreads + 24h trend + arbitrage signal + cross-exchange spread in one call.' },
      ],
      routing_engine: [
        { id: 'crossfin_route_find', endpoint: '/api/premium/route/find?from=bithumb:KRW&to=binance:USDC&amount=1000000', price: '$0.10', description: 'Find optimal crypto transfer route across 13 exchanges (Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, bitbank, Indodax, Bitkub, Binance, OKX, Bybit, KuCoin). Compares 11 bridge coins, estimates fees and slippage. Bidirectional: regional fiat↔global.' },
      ],
    },
    routingEngine: {
      overview: 'CrossFin Routing Engine finds the cheapest, fastest, or balanced crypto transfer route across 13 exchanges. It compares 11 bridge coins, models trading fees, withdrawal fees, slippage, and transfer times.',
      supportedExchanges: [
        { id: 'bithumb', country: 'South Korea', tradingFee: '0.25%', note: 'Lowest withdrawal fee policy' },
        { id: 'upbit', country: 'South Korea', tradingFee: '0.05%', note: 'Largest Korean exchange by volume (KRW market)' },
        { id: 'coinone', country: 'South Korea', tradingFee: '0.20%', note: 'Supports KAIA' },
        { id: 'gopax', country: 'South Korea', tradingFee: '0.20%', note: 'Supports KAIA, no DOT' },
        { id: 'binance', country: 'Global', tradingFee: '0.10%', note: 'Global exchange, trades in USDT/USDC' },
        { id: 'okx', country: 'Global', tradingFee: '0.08%', note: 'Deep global spot liquidity, strong USDT market depth' },
        { id: 'bybit', country: 'Global', tradingFee: '0.10%', note: 'High Asian spot liquidity with stable public API' },
        { id: 'kucoin', country: 'Global', tradingFee: '0.10%', note: 'Global exchange, trades in USDC/USDT/USD with deep altcoin liquidity' },
        { id: 'bitflyer', country: 'Japan', tradingFee: '0.15%', note: 'Largest Japanese exchange, synthetic pricing via global feed × FX' },
        { id: 'wazirx', country: 'India', tradingFee: '0.20%', note: 'Indian exchange with INR pairs' },
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
        koreaToGlobal: { example: 'from=bithumb:KRW&to=binance:USDC&amount=1000000', description: 'Transfer KRW from Korean exchange to USDC on Binance. Common for taking profits from route spread.' },
        globalToKorea: { example: 'from=binance:USDC&to=bithumb:KRW&amount=1000', description: 'Transfer USDC from Binance to KRW on Korean exchange. Profitable when route spread is positive (buy cheap globally, sell expensive in Korea).' },
      },
      responseIncludes: ['Optimal route with step-by-step execution plan', 'Up to 10 alternative routes ranked by strategy', 'Fee breakdown (trading + withdrawal)', 'Estimated output amount and net profit/loss %', 'Transfer time estimate per bridge coin', 'User-friendly summary with recommendation (GOOD_DEAL/PROCEED/EXPENSIVE/VERY_EXPENSIVE)', 'Live exchange rates used for calculation'],
      freeEndpoints: [
        { path: '/api/route/exchanges', description: 'List all 13 exchanges with supported coins and fees' },
        { path: '/api/route/fees', description: 'Full fee comparison table (add ?coin=KAIA to filter)' },
        { path: '/api/route/pairs', description: 'All trading pairs with live Binance prices' },
        { path: '/api/route/status', description: 'Exchange API health check' },
        { path: '/api/routing/optimal?from=bithumb:KRW&to=binance:USDC&amount=1000000', description: 'Live optimal route + alternatives + D1 fee table (free, RouteGraph)' },
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
      overview: 'Agentic Commerce Protocol (ACP) — standardized quote/execute flow for agent-to-agent commerce. CrossFin ACP lets agents request routing quotes and run tracked step-level execution orchestration without x402 payment.',
      endpoints: [
        { method: 'POST', path: '/api/acp/quote', price: 'Free', description: 'Request a routing quote. Returns preview of optimal route (no step-by-step details). For full analysis, upgrade to /api/premium/route/find ($0.10).' },
        { method: 'POST', path: '/api/acp/execute', price: 'Free', description: 'Start execution orchestration from quote_id. Returns execution_id and real-time step state.' },
        { method: 'GET', path: '/api/acp/executions/{execution_id}', price: 'Free', description: 'Get execution progress, ETA, and per-step status.' },
        { method: 'GET', path: '/api/acp/status', price: 'Free', description: 'ACP protocol capabilities, supported exchanges, bridge coins, and execution mode.' },
      ],
      quoteRequestExample: {
        method: 'POST',
        url: 'https://crossfin.dev/api/acp/quote',
        body: { from_exchange: 'bithumb', from_currency: 'KRW', to_exchange: 'binance', to_currency: 'USDC', amount: 1000000, strategy: 'cheapest' },
      },
      compatibleWith: ['locus', 'x402', 'openai-acp'],
      executionMode: 'tracked_orchestration',
      liveExecution: 'requires_exchange_api_key_integration',
    },
    useCases: [
      {
        name: 'Daily Market Brief Agent',
        description: 'Agent that sends a daily summary of Korean markets to a Slack/Discord channel.',
        flow: '1. Call /api/premium/morning/brief ($0.20) for full market overview. 2. Parse route spread, FX rate, headlines. 3. Format and post to channel.',
        cost: '$0.20/day',
      },
      {
        name: 'Route Spread Monitor',
        description: 'Agent that monitors route spread and alerts when arbitrage opportunity appears.',
        flow: '1. Poll /api/premium/arbitrage/opportunities ($0.10) every 15 minutes. 2. When indicator=POSITIVE_SPREAD, call /api/premium/route/find ($0.10) for optimal route. 3. Alert user with route details.',
        cost: '~$10/day (polling every 15m)',
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
      description: 'CrossFin MCP server for any MCP-compatible client.',
      npmPackage: 'crossfin-mcp',
      install: 'npx -y crossfin-mcp',
      globalInstall: 'npm i -g crossfin-mcp && crossfin-mcp',
      localBuild: 'cd apps/mcp-server && npm install && npm run build',
      notes: [
        'MCP servers are typically launched by the client (e.g. Cursor, Windsurf, or any MCP-compatible app). You usually do not run the stdio server directly in a terminal.',
        'Set EVM_PRIVATE_KEY to enable paid calls; leave it unset if you only want free browsing/search tools.',
      ],
      tools: [
        { name: 'search_services', description: 'Search the service registry by keyword' },
        { name: 'list_services', description: 'List services with optional category filter' },
        { name: 'get_service', description: 'Get details for a specific service' },
        { name: 'list_categories', description: 'List all categories with counts' },
        { name: 'get_kimchi_premium', description: 'Free route spread preview (top 3 pairs)' },
        { name: 'get_analytics', description: 'Gateway usage analytics' },
        { name: 'get_guide', description: 'Get the full CrossFin agent guide' },
        { name: 'create_wallet', description: 'Create a wallet in local ledger' },
        { name: 'get_balance', description: 'Check wallet balance' },
        { name: 'transfer', description: 'Transfer funds between wallets' },
        { name: 'list_transactions', description: 'List recent transactions' },
        { name: 'set_budget', description: 'Set daily spend limit' },
        { name: 'call_paid_service', description: 'Call a paid API with automatic x402 USDC payment (returns data + txHash + basescan link)' },
        { name: 'find_optimal_route', description: 'Find optimal crypto transfer route across 13 exchanges using 11 bridge coins (routing engine)' },
        { name: 'list_exchange_fees', description: 'List supported exchange fees — trading and withdrawal fees for all exchanges (routing engine)' },
        { name: 'compare_exchange_prices', description: 'Compare live exchange prices for routing across 13 exchanges (routing engine)' },
      ],
      mcpClientConfig: {
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
      mcpClientConfigLocalBuild: {
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

// === OpenAPI Spec ===

const getOpenApiPayload = () => ({
    openapi: '3.1.0',
    info: {
      title: 'CrossFin — x402 Agent Services Gateway (Korea)',
      version: CROSSFIN_API_VERSION,
      description: 'Service registry + pay-per-request APIs for AI agents. Discover x402 services and access Korean market data. Payments via x402 protocol with USDC on Base mainnet. Disclaimer: All data is for informational purposes only and does not constitute investment advice.',
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
          summary: 'Free Route Spread preview (top 3 pairs)',
          description: 'Free preview of the Route Spread index. Shows top 3 pairs by premium percentage. No payment required.',
          tags: ['Free'],
          responses: {
            '200': {
              description: 'Preview of route spread data',
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
                  decision: { type: 'object', properties: { indicator: { type: 'string' }, signalStrength: { type: 'number' }, reason: { type: 'string' } } },
                } } },
                avgPremiumPct: { type: 'number' },
                positiveSpreadCount: { type: 'integer' },
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
          summary: 'Full Route Spread Index — $0.05 USDC',
          description: 'Real-time price spread between Korean exchange (Bithumb) and global exchanges for 10+ crypto pairs. Includes premium percentage, volume, 24h change for each pair. Payment: $0.05 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Full route spread data for all tracked pairs',
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
          summary: 'Route Spread History (hourly) — $0.05 USDC',
          description: 'Historical hourly snapshots of the Route Spread data captured by CrossFin cron. Query by coin and time range. Payment: $0.05 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [
            { name: 'coin', in: 'query', description: 'Optional coin filter (e.g. BTC, ETH). Default: all', schema: { type: 'string' } },
            { name: 'hours', in: 'query', description: 'Lookback window in hours (default: 24, max: 168)', schema: { type: 'integer', default: 24, maximum: 168 } },
          ],
          responses: {
            '200': {
              description: 'Hourly route spread snapshots',
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
          description: 'AI-ready market condition analysis for Korean vs global crypto exchanges. Returns condition indicators (POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD) with slippage estimates, premium trends, transfer time risk, and signal strength scores. Includes direction, estimated profit after fees (Bithumb 0.25% + Binance 0.10%), and market condition assessment. Payment: $0.10 USDC on Base via x402.',
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
                positiveSpreadCount: { type: 'integer' },
                marketCondition: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
                estimatedFeesNote: { type: 'string' },
                bestOpportunity: { type: 'object' },
                opportunities: { type: 'array', items: { type: 'object', properties: {
                  coin: { type: 'string' }, direction: { type: 'string' }, grossPremiumPct: { type: 'number' },
                  estimatedFeesPct: { type: 'number' }, tradingFeesPct: { type: 'number' },
                  withdrawalFeePct: { type: 'number' }, withdrawalSuspended: { type: 'boolean' },
                  netProfitPct: { type: 'number' },
                  profitPer10kUsd: { type: 'number' }, volume24hUsd: { type: 'number' },
                  riskScore: { type: 'string' }, profitable: { type: 'boolean' },
                  slippageEstimatePct: { type: 'number' }, transferTimeMin: { type: 'number' },
                  premiumTrend: { type: 'string', enum: ['rising', 'falling', 'stable'] },
                  indicator: { type: 'string', enum: ['POSITIVE_SPREAD', 'NEUTRAL', 'NEGATIVE_SPREAD'] },
                  signalStrength: { type: 'number' }, reason: { type: 'string' },
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
          description: 'Compare crypto prices across 4 exchanges with market condition indicators. Returns per-coin best buy/sell exchange, spread analysis, and condition indicators (SPREAD_OPPORTUNITY/NEUTRAL_SIGNAL/MONITORING). Shows route spread per exchange and domestic spread opportunities.',
          parameters: [{ name: 'coins', in: 'query', schema: { type: 'string' }, description: 'Comma-separated coins (default: BTC,ETH,XRP,DOGE,ADA,SOL)' }],
          tags: ['Premium — $0.08 USDC'],
          responses: {
            '200': { description: 'Cross-exchange comparison with decision signals', content: { 'application/json': { schema: { type: 'object', properties: {
              paid: { type: 'boolean' }, service: { type: 'string' },
              coinsCompared: { type: 'integer' }, krwUsdRate: { type: 'number' },
              spreadOpportunityCount: { type: 'integer' },
              coins: { type: 'array', items: { type: 'object', properties: {
                coin: { type: 'string' }, bestBuyExchange: { type: 'string' }, bestSellExchange: { type: 'string' },
                spreadPct: { type: 'number' }, indicator: { type: 'string', enum: ['SPREAD_OPPORTUNITY', 'NEUTRAL_SIGNAL', 'MONITORING'] },
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
          description: 'One-call daily market summary combining route spread, USD/KRW FX rate, KOSPI/KOSDAQ indices, stock momentum, and Korean headlines. Payment: $0.20 USDC on Base via x402.',
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
          description: 'One-call crypto market overview combining 4-exchange BTC price comparison (Upbit/Bithumb/Coinone/GoPax), route spread, Bithumb volume analysis, and USD/KRW FX rate. Payment: $0.15 USDC on Base via x402.',
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
          summary: 'Route Spread Stats bundle — $0.15 USDC',
          description: 'Comprehensive route spread analysis combining current premiums, 24h trend from D1 snapshots, top arbitrage indicator (POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD), and cross-exchange BTC spread across Korean exchanges. Payment: $0.15 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Route Spread stats bundle response',
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
                        indicator: { type: 'string', enum: ['POSITIVE_SPREAD', 'NEUTRAL', 'NEGATIVE_SPREAD'] },
                        signalStrength: { type: 'number' },
                        reason: { type: 'string' },
                      }, required: ['coin', 'premiumPct', 'indicator', 'signalStrength', 'reason'] },
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

      '/api/routing/optimal': {
        get: {
          operationId: 'routeFindOptimalFree',
          summary: 'Free routing preview (limited)',
          description: 'Free routing preview. Returns optimal route summary only (bridge coin, cost, time, indicator). For full analysis with alternatives, step-by-step details, and fee breakdown, use /api/premium/route/find ($0.10).',
          tags: ['Routing'],
          parameters: [
            { name: 'from', in: 'query', required: false, description: 'Source (exchange:currency). Default: bithumb:KRW', schema: { type: 'string', default: 'bithumb:KRW' } },
            { name: 'to', in: 'query', required: false, description: 'Destination (exchange:currency). Default: binance:USDC', schema: { type: 'string', default: 'binance:USDC' } },
            { name: 'amount', in: 'query', required: false, description: 'Amount in source currency. Default: 1000000', schema: { type: 'number', default: 1000000 } },
            { name: 'strategy', in: 'query', required: false, description: 'Routing strategy', schema: { type: 'string', enum: ['cheapest', 'fastest', 'balanced'], default: 'cheapest' } },
          ],
          responses: {
            '200': { description: 'Route preview (summary only)', content: { 'application/json': { schema: { type: 'object' } } } },
            '400': { description: 'Invalid query parameters' },
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
          parameters: [{ name: 'coin', in: 'query', required: false, description: 'Optional coin filter (e.g. BTC, XRP)', schema: { type: 'string' } }],
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
          description: 'ACP endpoint. Requests a routing quote compatible with OpenAI + Stripe style agent commerce flows. Supports both from/to (exchange:currency) and from_exchange/from_currency style inputs.',
          tags: ['ACP'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    from: { type: 'string', description: 'Source exchange:currency (e.g., bithumb:KRW)' },
                    to: { type: 'string', description: 'Destination exchange:currency (e.g., binance:USDC)' },
                    from_exchange: { type: 'string' },
                    from_currency: { type: 'string' },
                    to_exchange: { type: 'string' },
                    to_currency: { type: 'string' },
                    amount: { type: 'number' },
                    strategy: { type: 'string', enum: ['cheapest', 'fastest', 'balanced'], default: 'cheapest' },
                  },
                  oneOf: [
                    { required: ['from', 'to', 'amount'] },
                    { required: ['from_exchange', 'from_currency', 'to_exchange', 'to_currency', 'amount'] },
                  ],
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
          summary: 'Start tracked route execution',
          description: 'ACP endpoint. Starts execution orchestration for a previously quoted route and returns an execution_id for progress tracking.',
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
            '200': { description: 'Execution started', content: { 'application/json': { schema: { type: 'object' } } } },
            '400': { description: 'Invalid request body' },
            '404': { description: 'Quote not found' },
            '410': { description: 'Quote expired' },
          },
        },
      },
      '/api/acp/executions/{executionId}': {
        get: {
          operationId: 'acpExecutionStatus',
          summary: 'Get ACP execution progress',
          description: 'ACP endpoint. Returns step-level execution progress and ETA for an execution_id.',
          tags: ['ACP'],
          parameters: [
            { name: 'executionId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Execution status', content: { 'application/json': { schema: { type: 'object' } } } },
            '404': { description: 'Execution not found' },
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
      '/api/telegram/webhook': {
        post: {
          operationId: 'telegramWebhook',
          summary: 'Telegram bot webhook endpoint',
          description: 'Receives Telegram updates and executes /route, /price, /status, /spread, /fees commands. If TELEGRAM_BOT_TOKEN is configured, X-Telegram-Bot-Api-Secret-Token must match TELEGRAM_WEBHOOK_SECRET.',
          tags: ['Telegram'],
          parameters: [
            {
              name: 'X-Telegram-Bot-Api-Secret-Token',
              in: 'header',
              required: false,
              description: 'Telegram webhook secret token header.',
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          responses: {
            '200': { description: 'Webhook accepted' },
            '400': { description: 'Invalid JSON body' },
            '401': { description: 'Unauthorized webhook token' },
            '500': { description: 'Webhook is enabled but server secret is not configured' },
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

// === x402 Payment Middleware (DISABLED v1.11.0) ===
// All premium endpoints are now free to acquire users.
// Revenue $0, real users single digits — paywall removed.
// Original payment configuration preserved in PATCH-1.11.0.md.
// To re-enable: restore paymentMiddleware() from git history (commit before v1.11.0).
app.use(
  '/api/premium/*',
  async (_c, next) => {
    await next()
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
    console.warn(`[DEPRECATION] Agent ${agent.id} used plaintext API key. Auto-migrating to hash.`)
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        'UPDATE agents SET api_key = ?, key_migrated_at = datetime("now"), updated_at = datetime("now") WHERE id = ?'
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
      whatItDoes: 'Real-time Route Spread index: price spread between Korean exchange (Bithumb) and global exchange (Binance) across 10+ pairs.',
      whenToUse: [
        'Detect Korea-vs-global mispricing (route spread) in real time',
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
      whatItDoes: 'Hourly historical snapshots of route spread captured by CrossFin cron (up to 7 days lookback).',
      whenToUse: [
        'Backtest route spread strategies',
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
      whatItDoes: 'AI-ready market condition analysis. Analyzes Korean vs global exchange prices, estimates slippage from live orderbooks, checks premium trends, and returns POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD indicators with signal strength scores.',
      whenToUse: [
        'Get instant POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD condition indicators for route spread analysis',
        'Build autonomous monitoring agents that act on signal strength scores',
        'Monitor market conditions (positive/neutral/negative spread) for data observation',
        'Estimate real execution costs including slippage and transfer time risk',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Check marketCondition for overall assessment',
        'Filter opportunities[] where indicator === "POSITIVE_SPREAD" for positive spread conditions',
        'Use signalStrength score to gauge conviction (higher = stronger signal)',
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
      positiveSpreadCount: 3,
      marketCondition: 'positive',
      bestOpportunity: {
        coin: 'XRP', netProfitPct: 1.2, direction: 'buy-global-sell-korea',
        slippageEstimatePct: 0.15, transferTimeMin: 0.5, premiumTrend: 'rising',
        indicator: 'POSITIVE_SPREAD', signalStrength: 0.87, reason: 'Spread of 1.05% observed after estimated costs. Historical volatility risk: 0.12%.',
      },
      opportunities: [{
        coin: 'XRP', netProfitPct: 1.2, grossPremiumPct: 2.3, estimatedFeesPct: 1.1,
        tradingFeesPct: 0.35, withdrawalFeePct: 0.75, withdrawalSuspended: false, riskScore: 'low',
        slippageEstimatePct: 0.15, transferTimeMin: 0.5, premiumTrend: 'rising',
        indicator: 'POSITIVE_SPREAD', signalStrength: 0.87, reason: 'Spread of 1.05% observed after estimated costs. Historical volatility risk: 0.12%.',
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
      whatItDoes: 'Cross-exchange condition analysis. Compares crypto prices across Bithumb, Upbit, Coinone, and Binance with market condition indicators. Returns best buy/sell exchange per coin and SPREAD_OPPORTUNITY/NEUTRAL_SIGNAL/MONITORING indicators.',
      whenToUse: [
        'Find the cheapest exchange to buy and most expensive to sell',
        'Get instant SPREAD_OPPORTUNITY/NEUTRAL_SIGNAL/MONITORING indicators for domestic exchange spreads',
        'Compare KRW prices vs global USD prices across all 4 exchanges',
        'Build cross-exchange monitoring tools using condition indicators',
      ],
      howToCall: [
        'Send GET request (optional ?coins=BTC,ETH,XRP)',
        'Pay via x402 if HTTP 402 is returned',
        'Check spreadOpportunityCount in summary for quick assessment',
        'Filter coins[] where indicator === "SPREAD_OPPORTUNITY" for spread opportunities',
        'Use bestBuyExchange and bestSellExchange for execution routing',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/market/cross-exchange -o /dev/null',
      relatedServiceIds: ['crossfin_kimchi_premium', 'crossfin_usdkrw', 'crossfin_arbitrage_opportunities'],
    },
    inputSchema: { type: 'http', method: 'GET', query: { coins: 'Comma-separated coins (default: BTC,ETH,XRP,DOGE,ADA,SOL)' } },
    outputExample: {
      paid: true, service: 'crossfin-cross-exchange', coinsCompared: 6, krwUsdRate: 1450,
      spreadOpportunityCount: 2,
      coins: [{
        coin: 'BTC', bestBuyExchange: 'coinone', bestSellExchange: 'bithumb', spreadPct: 0.65,
        indicator: 'SPREAD_OPPORTUNITY', kimchiPremium: { average: 2.1 },
      }],
      summary: { avgKimchiPremium: 2.1, spreadOpportunityCount: 2, bestDomesticSpread: { coin: 'BTC', buy: 'coinone', sell: 'bithumb', spreadPct: 0.65, indicator: 'SPREAD_OPPORTUNITY' } },
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


function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => isRecord(item))
}

function toStringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function toNumberValue(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim()
    if (!normalized) return fallback
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
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
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'crossfin-registry-seed/1.0' } })
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
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'crossfin-registry-seed/1.0' } })
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

    const expectedCrossfinSeedCount = crossfinSeedSpecs.length
    const count = row ? Number(row.count) : 0
    if (!force && Number.isFinite(count) && count > 0) {
      const crossfinRow = await db
        .prepare('SELECT COUNT(*) as count FROM services WHERE is_crossfin = 1')
        .first<{ count: number | string }>()
      const crossfinCount = crossfinRow ? Number(crossfinRow.count) : 0
      if (Number.isFinite(crossfinCount) && crossfinCount >= expectedCrossfinSeedCount) {
        const crossfinStatements = crossfinSeeds.map((seed) => {
          const tags = seed.tags ? JSON.stringify(seed.tags) : null
          const inputSchema = seed.inputSchema ? JSON.stringify(seed.inputSchema) : null
          const outputExample = seed.outputExample ? JSON.stringify(seed.outputExample) : null
          const isCrossfin = seed.isCrossfin ? 1 : 0

          return db.prepare(
            `INSERT INTO services
              (id, name, description, provider, category, endpoint, method, price, currency, network, pay_to, tags, input_schema, output_example, status, is_crossfin)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               description = excluded.description,
               provider = excluded.provider,
               category = excluded.category,
               endpoint = excluded.endpoint,
               method = excluded.method,
               price = excluded.price,
               currency = excluded.currency,
               network = excluded.network,
               pay_to = excluded.pay_to,
               tags = excluded.tags,
               input_schema = excluded.input_schema,
               output_example = excluded.output_example,
               status = excluded.status,
               is_crossfin = excluded.is_crossfin`
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

        if (crossfinStatements.length > 0) {
          await db.batch(crossfinStatements)
        }
        registrySeedCheckedUntil = Date.now() + REGISTRY_SEED_CHECK_TTL_MS
        return
      }
    }

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
        `INSERT INTO services
          (id, name, description, provider, category, endpoint, method, price, currency, network, pay_to, tags, input_schema, output_example, status, is_crossfin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           provider = excluded.provider,
           category = excluded.category,
           endpoint = excluded.endpoint,
           method = excluded.method,
           price = excluded.price,
           currency = excluded.currency,
           network = excluded.network,
           pay_to = excluded.pay_to,
           tags = excluded.tags,
           input_schema = excluded.input_schema,
           output_example = excluded.output_example,
           status = excluded.status,
           is_crossfin = excluded.is_crossfin`
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

// === Korean Arbitrage Data Helpers ===


function isGlobalRoutingExchange(exchange: string): boolean {
  return GLOBAL_ROUTING_EXCHANGE_SET.has(exchange.toLowerCase())
}

function isKoreanRoutingExchange(exchange: string): boolean {
  return KOREAN_ROUTING_EXCHANGE_SET.has(exchange.toLowerCase())
}

function isUsdLikeCurrency(currency: string): boolean {
  const cur = currency.trim().toUpperCase()
  return cur === 'USD' || cur === 'USDT' || cur === 'USDC'
}

function isRoutingCurrencySupported(exchange: string, currency: string): boolean {
  const ex = exchange.trim().toLowerCase()
  const cur = currency.trim().toUpperCase()
  if (!ROUTING_EXCHANGES.includes(ex as RoutingExchange)) return false
  const allowed = ROUTING_EXCHANGE_CURRENCIES[ex as RoutingExchange] ?? []
  return allowed.includes(cur)
}

function assertRoutingCurrencySupported(exchange: string, currency: string, label: 'from' | 'to'): void {
  const ex = exchange.trim().toLowerCase()
  const cur = currency.trim().toUpperCase()
  if (isRoutingCurrencySupported(ex, cur)) return

  const allowed = ROUTING_EXCHANGES.includes(ex as RoutingExchange)
    ? ROUTING_EXCHANGE_CURRENCIES[ex as RoutingExchange].join('/')
    : 'unknown exchange'
  throw new HTTPException(400, {
    message: `Unsupported ${label} pair: ${ex}:${cur}. Allowed ${label} currencies for ${ex}: ${allowed}`,
  })
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
  indicator: 'POSITIVE_SPREAD' | 'NEUTRAL' | 'NEGATIVE_SPREAD'
  signalStrength: number
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
  exchangeRates: { KRW_USD: number; JPY_USD?: number; INR_USD?: number; IDR_USD?: number; THB_USD?: number }
  pricesUsed: Record<string, Record<string, number>>
  routesEvaluated: number
  bridgeCoinsTotal: number
  evaluatedCoins: Array<(typeof BRIDGE_COINS)[number]>
  skippedCoins?: Array<(typeof BRIDGE_COINS)[number]>
  skippedReasons?: Record<string, string>
  analysisTimestamp: string
  disclaimer: string
  slippageCaveat: string
  priceAge: {
    globalPrices: { ageMs: number; source: string; cacheTtlMs: number }
    koreanPrices: { source: string }
    fxRates: { source: string; fallback: boolean }
  }
  feesSource: 'd1' | 'hardcoded-fallback'
  dataFreshness: 'live' | 'cached' | 'stale' | 'fallback'
  warnings?: string[]
}

type RegionalExchangePriceQuote = {
  priceLocal: number
  quoteCurrency: string
  asks: Array<{ price: string; quantity: string }>
}

// Fetch price for a coin on a regional fiat exchange (KRW/JPY/INR).
async function fetchRegionalExchangePrice(
  exchange: string,
  coin: string,
  bithumbAll?: Record<string, Record<string, string>>,
  skipOrderbook = false,
): Promise<RegionalExchangePriceQuote | null> {
  try {
    const coinUpper = coin.toUpperCase()
    const coinLower = coin.toLowerCase()

    if (exchange === 'bithumb') {
      const data = bithumbAll ?? await fetchBithumbAll()
      const entry = data[coinUpper]
      if (!entry?.closing_price) return null
      let asks: Array<{ price: string; quantity: string }> = []
      if (!skipOrderbook) {
        try {
          const obRes = await fetchWithTimeout(`https://api.bithumb.com/public/orderbook/${coinUpper}_KRW?count=30`)
          if (obRes.ok) {
            const obData = await obRes.json() as { data?: { asks?: Array<{ price: string; quantity: string }> } }
            asks = obData?.data?.asks ?? []
          } else {
            await obRes.body?.cancel()
          }
        } catch { /* ignore */ }
      }
      return { priceLocal: parseFloat(entry.closing_price), quoteCurrency: 'KRW', asks }
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
      return { priceLocal: tradePrice, quoteCurrency: 'KRW', asks }
    }

    if (exchange === 'coinone') {
      const ticker = await fetchCoinoneTicker(coinUpper)
      const lastPrice = ticker?.last
      const parsed = typeof lastPrice === 'string' ? Number(lastPrice) : NaN
      if (!Number.isFinite(parsed) || parsed <= 0) return null
      return { priceLocal: parsed, quoteCurrency: 'KRW', asks: [] }
    }

    if (exchange === 'gopax') {
      try {
        const res = await fetchWithTimeout(`https://api.gopax.co.kr/trading-pairs/${coinUpper}-KRW/ticker`)
        if (!res.ok) { await res.body?.cancel(); return null }
        const data = await res.json() as { price?: number; close?: number }
        const gopaxPrice = data.price ?? data.close
        if (!Number.isFinite(gopaxPrice) || Number(gopaxPrice) <= 0) return null
        return { priceLocal: Number(gopaxPrice), quoteCurrency: 'KRW', asks: [] }
      } catch { return null }
    }

    if (exchange === 'bitflyer') {
      const productCode = `${coinUpper}_JPY`
      const tickerRes = await fetchWithTimeout(`https://api.bitflyer.com/v1/getticker?product_code=${productCode}`)
      if (!tickerRes.ok) { await tickerRes.body?.cancel(); return null }
      const tickerData = await tickerRes.json() as { status?: number; ltp?: number; best_ask?: number }
      if (typeof tickerData.status === 'number' && tickerData.status < 0) return null
      const bitflyerPrice = Number(tickerData.ltp ?? tickerData.best_ask ?? NaN)
      if (!Number.isFinite(bitflyerPrice) || bitflyerPrice <= 0) return null

      let asks: Array<{ price: string; quantity: string }> = []
      if (!skipOrderbook) {
        try {
          const obRes = await fetchWithTimeout(`https://api.bitflyer.com/v1/getboard?product_code=${productCode}`)
          if (obRes.ok) {
            const obData = await obRes.json() as { asks?: Array<{ price?: number; size?: number }> }
            asks = Array.isArray(obData.asks)
              ? obData.asks.map((row) => ({ price: String(row.price ?? 0), quantity: String(row.size ?? 0) }))
              : []
          } else {
            await obRes.body?.cancel()
          }
        } catch { /* ignore */ }
      }
      return { priceLocal: bitflyerPrice, quoteCurrency: 'JPY', asks }
    }

    if (exchange === 'wazirx') {
      const market = `${coinLower}inr`
      const tickers = await fetchWazirxTickers()
      const row = tickers[market]
      if (!row) return null

      const last = Number(row.last ?? NaN)
      const sell = Number(row.sell ?? NaN)
      const buy = Number(row.buy ?? NaN)
      const wazirxPrice = Number.isFinite(last) && last > 0
        ? last
        : Number.isFinite(sell) && sell > 0
          ? sell
          : Number.isFinite(buy) && buy > 0
            ? buy
            : NaN
      if (!Number.isFinite(wazirxPrice) || wazirxPrice <= 0) return null

      let asks: Array<{ price: string; quantity: string }> = []
      if (!skipOrderbook) {
        try {
          const obRes = await fetchWithTimeout(`https://api.wazirx.com/api/v2/depth?market=${market}&limit=30`)
          if (obRes.ok) {
            const obData = await obRes.json() as { asks?: Array<[string, string]> }
            asks = Array.isArray(obData.asks)
              ? obData.asks.map((row) => ({ price: String(row[0] ?? 0), quantity: String(row[1] ?? 0) }))
              : []
          } else {
            await obRes.body?.cancel()
          }
        } catch { /* ignore */ }
      }
      return { priceLocal: wazirxPrice, quoteCurrency: 'INR', asks }
    }

    if (exchange === 'bitbank') {
      const tickers = await fetchBitbankTickers()
      const row = tickers[coinUpper]
      if (!row) return null
      const last = Number(row.last ?? NaN)
      if (!Number.isFinite(last) || last <= 0) return null

      let asks: Array<{ price: string; quantity: string }> = []
      if (!skipOrderbook) {
        try {
          const obRes = await fetchWithTimeout(`https://public.bitbank.cc/${coinLower}_jpy/depth`)
          if (obRes.ok) {
            const obData = await obRes.json() as { data?: { asks?: Array<[string, string]> } }
            asks = Array.isArray(obData?.data?.asks)
              ? obData.data.asks.map((row) => ({ price: String(row[0] ?? 0), quantity: String(row[1] ?? 0) }))
              : []
          } else {
            await obRes.body?.cancel()
          }
        } catch { /* ignore */ }
      }
      return { priceLocal: last, quoteCurrency: 'JPY', asks }
    }

    if (exchange === 'bitkub') {
      const tickers = await fetchBitkubTickers()
      const row = tickers[coinUpper]
      if (!row) return null
      const last = Number(row.last ?? NaN)
      if (!Number.isFinite(last) || last <= 0) return null

      let asks: Array<{ price: string; quantity: string }> = []
      if (!skipOrderbook) {
        try {
          const obRes = await fetchWithTimeout(`https://api.bitkub.com/api/market/depth?sym=THB_${coinUpper}&lmt=30`)
          if (obRes.ok) {
            const obData = await obRes.json() as { asks?: Array<[number, number, number]> }
            asks = Array.isArray(obData.asks)
              ? obData.asks.map((row) => ({ price: String(row[1] ?? 0), quantity: String(row[0] ?? 0) }))
              : []
          } else {
            await obRes.body?.cancel()
          }
        } catch { /* ignore */ }
      }
      return { priceLocal: last, quoteCurrency: 'THB', asks }
    }

    if (exchange === 'indodax') {
      const tickers = await fetchIndodaxTickers()
      const row = tickers[coinUpper]
      if (!row) return null
      const last = Number(row.last ?? NaN)
      if (!Number.isFinite(last) || last <= 0) return null

      let asks: Array<{ price: string; quantity: string }> = []
      if (!skipOrderbook) {
        try {
          const obRes = await fetchWithTimeout(`https://indodax.com/api/depth/${coinLower}idr`)
          if (obRes.ok) {
            const obData = await obRes.json() as { buy?: Array<[number, number]>; sell?: Array<[number, number]> }
            asks = Array.isArray(obData.sell)
              ? obData.sell.map((row) => ({ price: String(row[0] ?? 0), quantity: String(row[1] ?? 0) }))
              : []
          } else {
            await obRes.body?.cancel()
          }
        } catch { /* ignore */ }
      }
      return { priceLocal: last, quoteCurrency: 'IDR', asks }
    }

    return null
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

  const [
    tradingFeesResult,
    withdrawalFeesResult,
    withdrawalSuspensionsResult,
    fxMetaResult,
    bithumbAllResult,
    globalPricesResult,
  ] = await Promise.allSettled([
    getExchangeTradingFees(db),
    getExchangeWithdrawalFees(db),
    getWithdrawalSuspensions(db),
    fetchFxRatesWithMeta(),
    fetchBithumbAll(),
    fetchGlobalPrices(db),
  ])
  const tradingFees = tradingFeesResult.status === 'fulfilled' ? tradingFeesResult.value : cloneDefaultTradingFees()
  const withdrawalFees = withdrawalFeesResult.status === 'fulfilled' ? withdrawalFeesResult.value : cloneDefaultWithdrawalFees()
  const withdrawalSuspensions = withdrawalSuspensionsResult.status === 'fulfilled' ? withdrawalSuspensionsResult.value : {}
  const fxMeta = fxMetaResult.status === 'fulfilled'
    ? fxMetaResult.value
    : {
        rates: { KRW: 1450, JPY: 150, INR: 85, IDR: 16000, THB: 36 },
        isFallback: true,
        source: 'fallback-hardcoded',
        warnings: ['FX source unavailable. Using hardcoded fallback rates.'],
      }
  const usdFxRates = fxMeta.rates
  const krwRate = usdFxRates.KRW
  const bithumbAll = bithumbAllResult.status === 'fulfilled' ? bithumbAllResult.value : {}
  const globalPrices: Record<string, number> = globalPricesResult.status === 'fulfilled' ? globalPricesResult.value : {}

  const feesFromD1 = tradingFeesResult.status === 'fulfilled'
  const globalPricesSource = (() => {
    const globalAny = globalThis as unknown as { __crossfinGlobalPricesCache?: { expiresAt: number; source: string } }
    const cached = globalAny.__crossfinGlobalPricesCache
    if (!cached) return { ageMs: 0, source: 'none', cacheTtlMs: GLOBAL_PRICES_SUCCESS_TTL_MS }
    const ageMs = Math.max(0, Date.now() - (cached.expiresAt - GLOBAL_PRICES_SUCCESS_TTL_MS))
    return { ageMs, source: cached.source ?? 'unknown', cacheTtlMs: GLOBAL_PRICES_SUCCESS_TTL_MS }
  })()

  const pricesUsed: Record<string, Record<string, number>> = {}
  const routes: Route[] = []
  const skippedReasons: Partial<Record<(typeof BRIDGE_COINS)[number], string>> = {}

  const getGlobalPriceUsd = (exchange: string, coin: string): number | null => {
    const symbol = TRACKED_PAIRS[coin]
    if (!symbol) return null
    const exchangePrice = getExchangePrice(exchange, symbol)
    const price = typeof exchangePrice === 'number' ? exchangePrice : globalPrices[symbol]
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null
  }

  const getRegionalPriceWithFallback = (
    exchange: string,
    currency: string,
    coin: string,
    quote: RegionalExchangePriceQuote | null,
  ): RegionalExchangePriceQuote | null => {
    if (quote) return quote
    // bitFlyer endpoint can intermittently block Cloudflare egress; use synthetic JPY quote as last-resort fallback.
    if (exchange !== 'bitflyer' || currency !== 'JPY') return null

    const usd = getGlobalPriceUsd('binance', coin)
      ?? getGlobalPriceUsd('okx', coin)
      ?? getGlobalPriceUsd('bybit', coin)
    const jpy = usdFxRates.JPY
    if (!usd || !Number.isFinite(jpy) || jpy <= 0) return null

    return {
      priceLocal: usd * jpy * 1.002,
      quoteCurrency: 'JPY',
      asks: [],
    }
  }

  const fromIsGlobal = isGlobalRoutingExchange(fromEx)
  const toIsGlobal = isGlobalRoutingExchange(toEx)
  const isGlobalToRegional = fromIsGlobal && !toIsGlobal
  const isRegionalToGlobal = !fromIsGlobal && toIsGlobal
  const isRegionalToRegional = !fromIsGlobal && !toIsGlobal

  const toUsdAmount = (value: number, currency: string): number | null => {
    if (!Number.isFinite(value) || value <= 0) return null
    const cur = currency.trim().toUpperCase()
    if (isUsdLikeCurrency(cur)) return value
    const fx = usdFxRates[cur as keyof typeof usdFxRates]
    if (typeof fx !== 'number' || !Number.isFinite(fx) || fx <= 0) return null
    return value / fx
  }

  const fromUsdAmount = (usd: number, currency: string): number | null => {
    if (!Number.isFinite(usd) || usd <= 0) return null
    const cur = currency.trim().toUpperCase()
    if (isUsdLikeCurrency(cur)) return usd
    const fx = usdFxRates[cur as keyof typeof usdFxRates]
    if (typeof fx !== 'number' || !Number.isFinite(fx) || fx <= 0) return null
    return usd * fx
  }

  const formatAmountByCurrency = (value: number, currency: string): string => {
    const rounded = round2(value)
    const cur = currency.trim().toUpperCase()
    if (cur === 'KRW') return `₩${rounded.toLocaleString()} KRW`
    if (cur === 'JPY') return `¥${rounded.toLocaleString()} JPY`
    if (cur === 'INR') return `₹${rounded.toLocaleString()} INR`
    if (cur === 'IDR') return `Rp${rounded.toLocaleString()} IDR`
    if (cur === 'THB') return `฿${rounded.toLocaleString()} THB`
    if (isUsdLikeCurrency(cur)) return `$${rounded.toLocaleString()} ${cur}`
    return `${rounded.toLocaleString()} ${cur}`
  }

  const capitalizeExchange = (ex: string): string => ex ? ex.charAt(0).toUpperCase() + ex.slice(1) : ex
  const inputValueUsd = toUsdAmount(amount, fromCur)
  if (!inputValueUsd) {
    throw new HTTPException(400, { message: `Unsupported source currency conversion: ${fromCur}` })
  }

  // For each bridge coin, calculate the full path cost
  for (const bridgeCoin of BRIDGE_COINS) {
    // Check if bridge coin is supported on both exchanges
    const fromFee = tradingFees[fromEx] ?? EXCHANGE_FEES[fromEx]
    const toFee = tradingFees[toEx] ?? EXCHANGE_FEES[toEx]
    const fromWithdrawals = withdrawalFees[fromEx] ?? WITHDRAWAL_FEES[fromEx]
    if (!fromWithdrawals || !Object.prototype.hasOwnProperty.call(fromWithdrawals, bridgeCoin)) {
      skippedReasons[bridgeCoin] = `${bridgeCoin} withdrawal not supported on ${fromEx}`
      continue
    }
    if (withdrawalSuspensions[fromEx]?.has(bridgeCoin)) {
      skippedReasons[bridgeCoin] = `${bridgeCoin} withdrawal suspended on ${fromEx}`
      continue
    }

    const withdrawFee = getWithdrawalFee(fromEx, bridgeCoin, withdrawalFees)
    if (fromFee === undefined || toFee === undefined) continue

    const fromFeePct = fromFee
    const toFeePct = toFee

    try {
      let buyFeePct: number
      let buySlippagePct: number
      let buyPriceUsed: number
      let coinsBought: number
      let coinsAfterWithdraw: number
      let sellPriceUsed: number
      let finalOutput: number
      let transferTime: number
      let outputValueUsdForCost: number

      if (isGlobalToRegional) {
        const sourceGlobalPrice = getGlobalPriceUsd(fromEx, bridgeCoin)
        if (!sourceGlobalPrice) continue

        buyFeePct = fromFeePct
        // NOTE: Hardcoded slippage estimate for global exchanges. Actual slippage depends on orderbook depth and trade size.
        buySlippagePct = 0.10
        buyPriceUsed = sourceGlobalPrice

        const effectiveBuyPriceUsd = sourceGlobalPrice * (1 + (buySlippagePct / 100))
        const amountAfterBuyFee = amount * (1 - buyFeePct / 100)
        coinsBought = amountAfterBuyFee / effectiveBuyPriceUsd

        const withdrawFeeFromSource = withdrawFee
        coinsAfterWithdraw = coinsBought - withdrawFeeFromSource
        if (coinsAfterWithdraw <= 0) continue
        transferTime = getTransferTime(bridgeCoin)

        const destPrice = getRegionalPriceWithFallback(
          toEx,
          toCur,
          bridgeCoin,
          await fetchRegionalExchangePrice(
            toEx, bridgeCoin, toEx === 'bithumb' ? bithumbAll : undefined, true,
          ),
        )
        if (!destPrice || destPrice.quoteCurrency !== toCur || destPrice.priceLocal <= 0) continue

        sellPriceUsed = destPrice.priceLocal
        finalOutput = coinsAfterWithdraw * destPrice.priceLocal * (1 - toFeePct / 100)
        const outputUsd = toUsdAmount(finalOutput, toCur)
        if (!outputUsd) continue
        outputValueUsdForCost = outputUsd

        pricesUsed[bridgeCoin] = {
          [`${fromEx}_usd`]: buyPriceUsed,
          [`${toEx}_${toCur.toLowerCase()}`]: sellPriceUsed,
        }
      } else if (isRegionalToGlobal || isRegionalToRegional) {
        const sourcePrice = getRegionalPriceWithFallback(
          fromEx,
          fromCur,
          bridgeCoin,
          await fetchRegionalExchangePrice(
            fromEx, bridgeCoin, fromEx === 'bithumb' ? bithumbAll : undefined, true,
          ),
        )
        if (!sourcePrice || sourcePrice.quoteCurrency !== fromCur || sourcePrice.priceLocal <= 0) continue

        buyFeePct = fromFeePct
        buySlippagePct = sourcePrice.asks.length > 0
          ? estimateSlippage(sourcePrice.asks, amount)
          : 0.15 // default estimate
        buyPriceUsed = sourcePrice.priceLocal
        const effectiveBuyPrice = sourcePrice.priceLocal * (1 + (buySlippagePct / 100))
        const amountAfterBuyFee = amount * (1 - buyFeePct / 100)
        coinsBought = amountAfterBuyFee / effectiveBuyPrice

        coinsAfterWithdraw = coinsBought - withdrawFee
        if (coinsAfterWithdraw <= 0) continue
        transferTime = getTransferTime(bridgeCoin)

        if (toIsGlobal) {
          const targetGlobalPrice = getGlobalPriceUsd(toEx, bridgeCoin)
          if (!targetGlobalPrice) continue
          sellPriceUsed = targetGlobalPrice
          finalOutput = coinsAfterWithdraw * targetGlobalPrice * (1 - toFeePct / 100)
        } else {
          const destPrice = getRegionalPriceWithFallback(
            toEx,
            toCur,
            bridgeCoin,
            await fetchRegionalExchangePrice(toEx, bridgeCoin, toEx === 'bithumb' ? bithumbAll : undefined, true),
          )
          if (!destPrice || destPrice.quoteCurrency !== toCur || destPrice.priceLocal <= 0) continue
          sellPriceUsed = destPrice.priceLocal
          finalOutput = coinsAfterWithdraw * destPrice.priceLocal * (1 - toFeePct / 100)
        }

        const outputUsd = toUsdAmount(finalOutput, toCur)
        if (!outputUsd) continue
        outputValueUsdForCost = outputUsd

        pricesUsed[bridgeCoin] = {
          [`${fromEx}_${fromCur.toLowerCase()}`]: buyPriceUsed,
          ...(toIsGlobal ? { [`${toEx}_usd`]: sellPriceUsed } : { [`${toEx}_${toCur.toLowerCase()}`]: sellPriceUsed }),
        }
      } else if (fromIsGlobal && toIsGlobal) {
        // Global → Global: buy coin with USDC on source, transfer, sell for USDC on destination
        const sourceGlobalPrice = getGlobalPriceUsd(fromEx, bridgeCoin)
        if (!sourceGlobalPrice) continue

        buyFeePct = fromFeePct
        buySlippagePct = 0.10
        buyPriceUsed = sourceGlobalPrice

        const effectiveBuyPriceUsd = sourceGlobalPrice * (1 + (buySlippagePct / 100))
        const amountAfterBuyFee = amount * (1 - buyFeePct / 100)
        coinsBought = amountAfterBuyFee / effectiveBuyPriceUsd

        coinsAfterWithdraw = coinsBought - withdrawFee
        if (coinsAfterWithdraw <= 0) continue
        transferTime = getTransferTime(bridgeCoin)

        const targetGlobalPrice = getGlobalPriceUsd(toEx, bridgeCoin)
        if (!targetGlobalPrice) continue
        sellPriceUsed = targetGlobalPrice
        finalOutput = coinsAfterWithdraw * targetGlobalPrice * (1 - toFeePct / 100)

        const outputUsd = toUsdAmount(finalOutput, toCur)
        if (!outputUsd) continue
        outputValueUsdForCost = outputUsd

        pricesUsed[bridgeCoin] = {
          [`${fromEx}_usd`]: buyPriceUsed,
          [`${toEx}_usd`]: sellPriceUsed,
        }
      } else {
        continue
      }

      const totalCostPct = ((inputValueUsd - outputValueUsdForCost) / inputValueUsd) * 100
      const totalTimeMinutes = transferTime + 1 // +1 min for trade execution

      const { indicator, signalStrength, reason } = computeRouteAction(
        totalCostPct,
        buySlippagePct,
        transferTime,
      )

      const estimatedOutput = Math.round(finalOutput * 100) / 100
      const inputValueUsdRounded = Math.round(inputValueUsd * 100) / 100
      const totalCostPctRounded = Math.round(totalCostPct * 100) / 100
      const totalTimeMinutesRounded = Math.round(totalTimeMinutes * 10) / 10

      const formatInput = (): string => {
        return formatAmountByCurrency(amount, fromCur)
      }

      const formatOutput = (value: number): string => {
        return formatAmountByCurrency(value, toCur)
      }

      const totalFee = (() => {
        const inputInOutputCurrency = fromUsdAmount(inputValueUsd, toCur)
        if (inputInOutputCurrency) {
          const feeAmount = Math.abs(inputInOutputCurrency - finalOutput)
          return `${formatAmountByCurrency(feeAmount, toCur)} (${totalCostPctRounded}%)`
        }
        const feeAmountUsd = Math.abs(inputValueUsd - outputValueUsdForCost)
        return `${formatAmountByCurrency(feeAmountUsd, 'USD')} (${totalCostPctRounded}%)`
      })()

      const finalIndicator: Route['indicator'] = indicator
      const finalReason = reason
      const recommendation: Route['summary']['recommendation'] =
        finalIndicator === 'POSITIVE_SPREAD'
          ? (totalCostPct < 1 ? 'GOOD_DEAL' : 'PROCEED')
          : finalIndicator === 'NEUTRAL'
            ? 'PROCEED'
            : totalCostPct < 5
              ? 'EXPENSIVE'
              : 'VERY_EXPENSIVE'

      const route: Route = {
        id: `${fromEx}-${bridgeCoin}-${toEx}`,
        summary: {
          input: formatInput(),
          output: formatOutput(estimatedOutput),
          outputWithoutFees: (() => {
            const noFeeOutput = fromUsdAmount(inputValueUsdRounded, toCur)
            if (!noFeeOutput) return formatAmountByCurrency(inputValueUsdRounded, 'USD')
            return formatOutput(noFeeOutput)
          })(),
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
        indicator: finalIndicator,
        signalStrength: Math.round(signalStrength * 100) / 100,
        reason: finalReason,
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
      exchangeRates: { KRW_USD: krwRate, JPY_USD: usdFxRates.JPY, INR_USD: usdFxRates.INR, IDR_USD: usdFxRates.IDR, THB_USD: usdFxRates.THB },
      pricesUsed,
      routesEvaluated: routes.length,
      bridgeCoinsTotal: BRIDGE_COINS.length,
      evaluatedCoins,
      skippedCoins: skippedCoins.length > 0 ? skippedCoins : undefined,
      skippedReasons: Object.keys(skippedReasons).length > 0
        ? skippedReasons as Record<string, string>
        : undefined,
      analysisTimestamp: new Date().toISOString(),
      disclaimer: 'Estimates based on current orderbook depth and market prices. Actual costs may vary due to price movements during execution.',
      slippageCaveat: 'Slippage estimates are approximations based on limited orderbook data. Actual slippage may be significantly higher, especially for large trades or illiquid pairs.',
      priceAge: {
        globalPrices: globalPricesSource,
        koreanPrices: { source: 'exchange-api-direct' },
        fxRates: { source: fxMeta.source, fallback: fxMeta.isFallback },
      },
      feesSource: feesFromD1 ? 'd1' : 'hardcoded-fallback',
      dataFreshness: fxMeta.isFallback
        ? 'fallback'
        : (globalPricesSource.ageMs < GLOBAL_PRICES_SUCCESS_TTL_MS ? (globalPricesSource.ageMs < 5000 ? 'live' : 'cached') : 'stale'),
      warnings: fxMeta.warnings.length > 0 ? fxMeta.warnings : undefined,
    },
  }
}

// ============================================================
// END ROUTING ENGINE CORE
// ============================================================

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

// === Route Spread (paid $0.05) ===

app.get('/api/premium/arbitrage/kimchi', async (c) => {
  const [bithumbData, priceMeta, fxMeta] = await Promise.all([
    fetchBithumbAll(),
    fetchGlobalPricesWithMeta(c.env.DB),
    fetchFxRatesWithMeta(),
  ])

  const krwRate = fxMeta.rates.KRW
  const premiums = calcPremiums(bithumbData, priceMeta.prices, krwRate)
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
    _dataMeta: buildDataMeta(priceMeta, fxMeta),
    _disclaimer: CROSSFIN_DISCLAIMER,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/asia/japan', async (c) => {
  const [bitbankData, globalPrices, fxRates] = await Promise.all([
    fetchBitbankTickers(),
    fetchGlobalPrices(c.env.DB),
    fetchUsdFxRates(),
  ])

  const premiums = calcAsianPremium(bitbankData, globalPrices, fxRates.JPY, 'last', 'vol', 'JPY', 'bitbank')
  const avg = premiums.length > 0
    ? Math.round(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length * 100) / 100
    : 0

  return c.json({
    service: 'crossfin-japan-premium',
    exchange: 'bitbank',
    currency: 'JPY',
    usdJpyRate: fxRates.JPY,
    pairsTracked: premiums.length,
    avgPremiumPct: avg,
    topPremium: premiums[0] ?? null,
    premiums,
    _disclaimer: CROSSFIN_DISCLAIMER,
    _legal: CROSSFIN_LEGAL,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/asia/indonesia', async (c) => {
  const [indodaxData, globalPrices, fxRates] = await Promise.all([
    fetchIndodaxTickers(),
    fetchGlobalPrices(c.env.DB),
    fetchUsdFxRates(),
  ])

  const premiums = calcAsianPremium(indodaxData, globalPrices, fxRates.IDR, 'last', 'vol_idr', 'IDR', 'indodax')
  const avg = premiums.length > 0
    ? Math.round(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length * 100) / 100
    : 0

  return c.json({
    service: 'crossfin-indonesia-premium',
    exchange: 'indodax',
    currency: 'IDR',
    usdIdrRate: fxRates.IDR,
    pairsTracked: premiums.length,
    avgPremiumPct: avg,
    topPremium: premiums[0] ?? null,
    premiums,
    _disclaimer: CROSSFIN_DISCLAIMER,
    _legal: CROSSFIN_LEGAL,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/asia/thailand', async (c) => {
  const [bitkubData, globalPrices, fxRates] = await Promise.all([
    fetchBitkubTickers(),
    fetchGlobalPrices(c.env.DB),
    fetchUsdFxRates(),
  ])

  const premiums = calcAsianPremium(bitkubData, globalPrices, fxRates.THB, 'last', 'quoteVolume', 'THB', 'bitkub')
  const avg = premiums.length > 0
    ? Math.round(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length * 100) / 100
    : 0

  return c.json({
    service: 'crossfin-thailand-premium',
    exchange: 'bitkub',
    currency: 'THB',
    usdThbRate: fxRates.THB,
    pairsTracked: premiums.length,
    avgPremiumPct: avg,
    topPremium: premiums[0] ?? null,
    premiums,
    _disclaimer: CROSSFIN_DISCLAIMER,
    _legal: CROSSFIN_LEGAL,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/asia/overview', async (c) => {
  const [bithumbData, bitbankData, indodaxData, bitkubData, globalPrices, fxRates] = await Promise.all([
    fetchBithumbAll(),
    fetchBitbankTickers(),
    fetchIndodaxTickers(),
    fetchBitkubTickers(),
    fetchGlobalPrices(c.env.DB),
    fetchUsdFxRates(),
  ])

  const koreaPremiums = calcPremiums(bithumbData, globalPrices, fxRates.KRW)
  const japanPremiums = calcAsianPremium(bitbankData, globalPrices, fxRates.JPY, 'last', 'vol', 'JPY', 'bitbank')
  const indoPremiums = calcAsianPremium(indodaxData, globalPrices, fxRates.IDR, 'last', 'vol_idr', 'IDR', 'indodax')
  const thaiPremiums = calcAsianPremium(bitkubData, globalPrices, fxRates.THB, 'last', 'quoteVolume', 'THB', 'bitkub')

  const calcAvg = (p: Array<{ premiumPct: number }>) => p.length > 0
    ? Math.round(p.reduce((s, x) => s + x.premiumPct, 0) / p.length * 100) / 100
    : 0

  const korea = { name: 'korea', avg: calcAvg(koreaPremiums), top: koreaPremiums[0], pairs: koreaPremiums.length, exchange: 'bithumb', currency: 'KRW', fxRate: fxRates.KRW }
  const japan = { name: 'japan', avg: calcAvg(japanPremiums), top: japanPremiums[0], pairs: japanPremiums.length, exchange: 'bitbank', currency: 'JPY', fxRate: fxRates.JPY }
  const indonesia = { name: 'indonesia', avg: calcAvg(indoPremiums), top: indoPremiums[0], pairs: indoPremiums.length, exchange: 'indodax', currency: 'IDR', fxRate: fxRates.IDR }
  const thailand = { name: 'thailand', avg: calcAvg(thaiPremiums), top: thaiPremiums[0], pairs: thaiPremiums.length, exchange: 'bitkub', currency: 'THB', fxRate: fxRates.THB }
  const countries = [korea, japan, indonesia, thailand]

  const allAvgs = countries.map((country) => country.avg)
  const highest = countries.reduce((a, b) => (a.avg > b.avg ? a : b))
  const lowest = countries.reduce((a, b) => (a.avg < b.avg ? a : b))

  return c.json({
    service: 'crossfin-asian-premium-index',
    summary: {
      highestPremiumCountry: highest.name,
      highestPremiumPct: highest.avg,
      lowestPremiumCountry: lowest.name,
      lowestPremiumPct: lowest.avg,
      asianAvgPremiumPct: Math.round(allAvgs.reduce((s, v) => s + v, 0) / allAvgs.length * 100) / 100,
    },
    korea: { exchange: 'bithumb', currency: 'KRW', avgPremiumPct: korea.avg, topCoin: korea.top?.coin ?? null, topPremiumPct: korea.top?.premiumPct ?? null, pairsTracked: korea.pairs, fxRate: korea.fxRate },
    japan: { exchange: 'bitbank', currency: 'JPY', avgPremiumPct: japan.avg, topCoin: japan.top?.coin ?? null, topPremiumPct: japan.top?.premiumPct ?? null, pairsTracked: japan.pairs, fxRate: japan.fxRate },
    indonesia: { exchange: 'indodax', currency: 'IDR', avgPremiumPct: indonesia.avg, topCoin: indonesia.top?.coin ?? null, topPremiumPct: indonesia.top?.premiumPct ?? null, pairsTracked: indonesia.pairs, fxRate: indonesia.fxRate },
    thailand: { exchange: 'bitkub', currency: 'THB', avgPremiumPct: thailand.avg, topCoin: thailand.top?.coin ?? null, topPremiumPct: thailand.top?.premiumPct ?? null, pairsTracked: thailand.pairs, fxRate: thailand.fxRate },
    _disclaimer: CROSSFIN_DISCLAIMER,
    _legal: CROSSFIN_LEGAL,
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
    _disclaimer: CROSSFIN_DISCLAIMER,
    at: new Date().toISOString(),
  })
})

// === Arbitrage Opportunities (paid $0.10) ===

app.get('/api/premium/arbitrage/opportunities', async (c) => {
  const [bithumbData, priceMeta, fxMeta] = await Promise.all([
    fetchBithumbAll(),
    fetchGlobalPricesWithMeta(c.env.DB),
    fetchFxRatesWithMeta(),
  ])

  const krwRate = fxMeta.rates.KRW
  const premiums = calcPremiums(bithumbData, priceMeta.prices, krwRate)
  const tradingFeesPct = BITHUMB_FEES_PCT + BINANCE_FEES_PCT

  // Fetch orderbooks, premium trends, and withdrawal suspensions in parallel
  const orderbookPromises = premiums.map((p) =>
    fetchBithumbOrderbook(p.coin).catch(() => ({ bids: [], asks: [] })),
  )
  const trendPromises = premiums.map((p) =>
    getPremiumTrend(c.env.DB, p.coin, 6),
  )
  const [orderbooks, trends, suspensions] = await Promise.all([
    Promise.all(orderbookPromises),
    Promise.all(trendPromises),
    getWithdrawalSuspensions(c.env.DB),
  ])

  const TRADE_SIZE_KRW = 15_000_000 // ~$10,000 reference trade

  const opportunities = premiums
    .map((p, i) => {
      const absPremiumPct = Math.abs(p.premiumPct)
      const direction = p.premiumPct > 0 ? 'buy-global-sell-korea' : 'buy-korea-sell-global'
      const marketSideLabel = p.premiumPct >= 0 ? 'Korea premium setup (buy global -> sell Korea)' : 'Korea discount setup (buy Korea -> sell global)'
      const riskScore = p.volume24hUsd < 100000 ? 'high' : p.volume24hUsd < 1000000 ? 'medium' : 'low'

      // Fix 1: Include withdrawal fee as percentage of trade size
      const sourceExchange = direction === 'buy-global-sell-korea' ? 'binance' : 'bithumb'
      const withdrawalFeeCoins = getWithdrawalFee(sourceExchange, p.coin)
      const coinPriceKrw = p.bithumbKrw
      const withdrawalFeePct = coinPriceKrw > 0 ? (withdrawalFeeCoins * coinPriceKrw) / TRADE_SIZE_KRW * 100 : 0
      const totalFeesPct = tradingFeesPct + withdrawalFeePct

      const netProfitPct = absPremiumPct - totalFeesPct
      const profitPer10kUsd = Math.round(netProfitPct * 100) // cents per $10,000 traded

      // Fix 3: Check withdrawal suspension
      const withdrawalSuspended = !!(suspensions[sourceExchange]?.has(p.coin))

      // Fix 2: Use correct orderbook side for slippage estimation
      const ob = orderbooks[i] ?? { bids: [], asks: [] }
      const orderbookSide = direction === 'buy-korea-sell-global'
        ? (ob.asks as Array<{ price: string; quantity: string }>).slice(0, 10)
        : (ob.bids as Array<{ price: string; quantity: string }>).slice(0, 10)
      const slippageEstimatePct = estimateSlippage(orderbookSide, TRADE_SIZE_KRW)
      const transferTimeMin = getTransferTime(p.coin)
      const trendData = trends[i] ?? { trend: 'stable' as const, volatilityPct: 0 }
      const { trend: premiumTrend, volatilityPct } = trendData

      // Fix 5: Feed riskScore into computeAction — high volume risk multiplies premiumRisk
      const adjustedVolatility = riskScore === 'high' ? volatilityPct * 1.5 : volatilityPct

      // Fix 3 continued: If withdrawals suspended, force NEGATIVE_SPREAD
      let indicator: 'POSITIVE_SPREAD' | 'NEUTRAL' | 'NEGATIVE_SPREAD'
      let signalStrength: number
      let baseReason: string
      if (withdrawalSuspended) {
        indicator = 'NEGATIVE_SPREAD'
        signalStrength = 0.1
        baseReason = `Withdrawals suspended on ${sourceExchange} for ${p.coin} — transfer not possible`
      } else {
        const result = computeAction(netProfitPct, slippageEstimatePct, transferTimeMin, adjustedVolatility)
        indicator = result.indicator
        signalStrength = result.signalStrength
        baseReason = result.reason
      }
      const reason = `${baseReason}. ${marketSideLabel}; gross edge ${round2(absPremiumPct)}% before fees (trading ${round2(tradingFeesPct)}% + withdrawal ${round2(withdrawalFeePct)}%).`

      return {
        coin: p.coin,
        direction,
        grossPremiumPct: p.premiumPct,
        estimatedFeesPct: round2(totalFeesPct),
        tradingFeesPct: round2(tradingFeesPct),
        withdrawalFeePct: round2(withdrawalFeePct),
        withdrawalSuspended,
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
        indicator,
        signalStrength,
        reason,
      }
    })
    .sort((a, b) => b.netProfitPct - a.netProfitPct)

  const profitable = opportunities.filter((o) => o.profitable)
  const positiveSpreadCount = opportunities.filter((o) => o.indicator === 'POSITIVE_SPREAD').length
  const marketCondition: 'positive' | 'neutral' | 'negative' =
    positiveSpreadCount >= 3 ? 'positive' : positiveSpreadCount >= 1 ? 'neutral' : 'negative'

  return c.json({
    paid: true,
    service: 'crossfin-arbitrage-opportunities',
    krwUsdRate: krwRate,
    totalOpportunities: opportunities.length,
    profitableCount: profitable.length,
    positiveSpreadCount,
    marketCondition,
    estimatedFeesNote: `Trading ${round2(tradingFeesPct)}% + per-coin withdrawal fees included`,
    bestOpportunity: profitable[0] ?? null,
    opportunities,
    _dataMeta: buildDataMeta(priceMeta, fxMeta),
    _disclaimer: CROSSFIN_DISCLAIMER,
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
    _disclaimer: CROSSFIN_DISCLAIMER,
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
    _disclaimer: CROSSFIN_DISCLAIMER,
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
    _disclaimer: CROSSFIN_DISCLAIMER,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/fx/usdkrw', async (c) => {
  const fxMeta = await fetchFxRatesWithMeta()
  const krwRate = fxMeta.rates.KRW
  return c.json({
    paid: true,
    service: 'crossfin-usdkrw',
    usdKrw: krwRate,
    source: fxMeta.source,
    fallback: fxMeta.isFallback,
    warnings: fxMeta.warnings.length > 0 ? fxMeta.warnings : undefined,
    _disclaimer: CROSSFIN_DISCLAIMER,
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
    _disclaimer: CROSSFIN_DISCLAIMER,
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
    _disclaimer: CROSSFIN_DISCLAIMER,
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
    _disclaimer: CROSSFIN_DISCLAIMER,
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
    _disclaimer: CROSSFIN_DISCLAIMER,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/crypto/korea/5exchange', async (c) => {
  const coin = (c.req.query('coin') ?? 'BTC').toUpperCase()

  const [upbitRes, bithumbRes, coinoneRes, gopaxRes] = await Promise.allSettled([
    fetchWithTimeout(`https://api.upbit.com/v1/ticker?markets=KRW-${coin}`).then(r => r.json()),
    fetchWithTimeout(`https://api.bithumb.com/public/ticker/${coin}_KRW`).then(r => r.json()),
    fetchWithTimeout(`https://api.coinone.co.kr/public/v2/ticker_new/KRW/${encodeURIComponent(coin)}`).then(r => r.json()),
    fetchWithTimeout(`https://api.gopax.co.kr/trading-pairs/${coin}-KRW/ticker`).then(r => r.json()),
  ])

  const exchanges: Array<{ exchange: string; priceKrw: number; volume24h: number; change24hPct: number | null }> = []
  if (upbitRes.status === 'fulfilled' && Array.isArray(upbitRes.value) && upbitRes.value[0]) {
    const d = isRecord(upbitRes.value[0]) ? upbitRes.value[0] : null
    if (d) {
      const price = toNumberValue(d.trade_price, Number.NaN)
      if (Number.isFinite(price) && price > 0) {
        const signedChangeRate = toNumberValue(d.signed_change_rate, Number.NaN)
        exchanges.push({
          exchange: 'Upbit',
          priceKrw: price,
          volume24h: toNumberValue(d.acc_trade_volume_24h),
          change24hPct: Number.isFinite(signedChangeRate) ? signedChangeRate * 100 : null,
        })
      }
    }
  }

  if (bithumbRes.status === 'fulfilled' && isRecord(bithumbRes.value) && isRecord(bithumbRes.value.data)) {
    const d = bithumbRes.value.data
    const price = toNumberValue(d.closing_price, Number.NaN)
    if (Number.isFinite(price) && price > 0) {
      const change24hPct = toNumberValue(d.fluctate_rate_24H, Number.NaN)
      exchanges.push({
        exchange: 'Bithumb',
        priceKrw: price,
        volume24h: toNumberValue(d.units_traded_24H),
        change24hPct: Number.isFinite(change24hPct) ? change24hPct : null,
      })
    }
  }

  if (coinoneRes.status === 'fulfilled' && isRecord(coinoneRes.value)) {
    const coinoneData = coinoneRes.value
    // v2 API: { result: 'success', tickers: [{ last: ..., target_volume: ... }] }
    const ticker = Array.isArray(coinoneData.tickers) && isRecord(coinoneData.tickers[0]) ? coinoneData.tickers[0] : null
    if (ticker) {
      const price = toNumberValue(ticker.last, Number.NaN)
      if (Number.isFinite(price) && price > 0) {
        exchanges.push({
          exchange: 'Coinone',
          priceKrw: price,
          volume24h: toNumberValue(ticker.target_volume),
          change24hPct: null,
        })
      }
    }
  }

  if (gopaxRes.status === 'fulfilled' && isRecord(gopaxRes.value)) {
    const d = gopaxRes.value
    const price = toNumberValue(d.price, Number.NaN)
    if (Number.isFinite(price) && price > 0) {
      exchanges.push({
        exchange: 'GoPax',
        priceKrw: price,
        volume24h: toNumberValue(d.volume),
        change24hPct: null,
      })
    }
  }

  const prices = exchanges.map(e => e.priceKrw).filter(p => p > 0)
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0
  const spreadPct = minPrice > 0 ? Math.round((maxPrice - minPrice) / minPrice * 10000) / 100 : 0

  const failedExchanges: string[] = []
  if (upbitRes.status === 'rejected') failedExchanges.push('upbit')
  if (bithumbRes.status === 'rejected') failedExchanges.push('bithumb')
  if (coinoneRes.status === 'rejected') failedExchanges.push('coinone')
  if (gopaxRes.status === 'rejected') failedExchanges.push('gopax')
  const exchangeWarnings: string[] = failedExchanges.length > 0
    ? [`Exchange API(s) unavailable: ${failedExchanges.join(', ')}. Data may be incomplete.`]
    : []

  return c.json({
    paid: true,
    service: 'crossfin-crypto-5exchange',
    coin,
    exchangeCount: exchanges.length,
    exchanges,
    spread: { minPriceKrw: minPrice, maxPriceKrw: maxPrice, spreadPct },
    source: 'upbit+bithumb+coinone+gopax',
    _dataMeta: {
      freshness: (failedExchanges.length >= 3 ? 'stale' : exchanges.length > 0 ? 'live' : 'fallback') as DataMeta['freshness'],
      sourceAgeMs: 0,
      sources: ['upbit', 'bithumb', 'coinone', 'gopax'].filter(e => !failedExchanges.includes(e)),
      warnings: exchangeWarnings,
    },
    _disclaimer: CROSSFIN_DISCLAIMER,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/crypto/korea/exchange-status', async (c) => {
  const res = await fetchWithTimeout('https://api.bithumb.com/public/assetsstatus/ALL')
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
    _disclaimer: CROSSFIN_DISCLAIMER,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/crypto/korea/fx-rate', async (c) => {
  const res = await fetchWithTimeout('https://crix-api-cdn.upbit.com/v1/forex/recent?codes=FRX.KRWUSD')
  if (!res.ok) throw new HTTPException(502, { message: 'FX rate data unavailable' })
  const data = toRecordArray(await res.json() as unknown)
  const quote = data[0]
  if (!quote) {
    throw new HTTPException(502, { message: 'FX rate payload unavailable' })
  }

  const basePrice = toNumberValue(quote.basePrice, Number.NaN)
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    throw new HTTPException(502, { message: 'FX rate payload invalid' })
  }

  return c.json({
    paid: true,
    service: 'crossfin-korea-fx-rate',
    pair: 'KRW/USD',
    basePrice,
    change: toStringValue(quote.change),
    changePrice: toNumberValue(quote.changePrice),
    openingPrice: toNumberValue(quote.openingPrice),
    high52w: toNumberValue(quote.high52wPrice),
    low52w: toNumberValue(quote.low52wPrice),
    source: 'upbit-crix',
    _disclaimer: CROSSFIN_DISCLAIMER,
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
  const res = await fetchWithTimeout(`https://api.upbit.com/v1/candles/${type}?market=${market}&count=${count}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Upbit candle data unavailable' })
  const raw = toRecordArray(await res.json() as unknown)

  return c.json({
    paid: true,
    service: 'crossfin-upbit-candles',
    market,
    type,
    count: raw.length,
    candles: raw.map((r) => ({
      date: toStringValue(r.candle_date_time_kst),
      open: toNumberValue(r.opening_price),
      high: toNumberValue(r.high_price),
      low: toNumberValue(r.low_price),
      close: toNumberValue(r.trade_price),
      volume: toNumberValue(r.candle_acc_trade_volume),
      tradeAmount: toNumberValue(r.candle_acc_trade_price),
    })),
    source: 'upbit',
    _disclaimer: CROSSFIN_DISCLAIMER,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/news/korea/headlines', async (c) => {
  const limit = Math.min(20, Math.max(1, Number(c.req.query('limit') ?? '10')))
  const feedUrl = 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko'

  const res = await fetchWithTimeout(feedUrl, { headers: { 'User-Agent': 'crossfin-news/1.0' } })
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
    _disclaimer: CROSSFIN_DISCLAIMER,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/crypto/snapshot', async (c) => {
  const at = new Date().toISOString()
  const coin = 'BTC'

  const bithumbPromise = fetchBithumbAll()
  const globalPricesPromise = fetchGlobalPricesWithMeta(c.env.DB)
  const fxMetaPromise = fetchFxRatesWithMeta()

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
      const res = await fetchWithTimeout(url)
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

  const [bithumbSet, globalSet, fxSet, exchangesSet] = await Promise.allSettled([
    bithumbPromise,
    globalPricesPromise,
    fxMetaPromise,
    exchangesTask,
  ] as const)

  const fxMeta = fxSet.status === 'fulfilled' ? fxSet.value : null
  const priceMeta = globalSet.status === 'fulfilled' ? globalSet.value : null
  const usdKrw = fxMeta ? fxMeta.rates.KRW : 1450

  const kimchiPremium = (() => {
    if (bithumbSet.status !== 'fulfilled' || !priceMeta) {
      return { avgPremiumPct: 0, topPair: '', pairsTracked: 0, premiums: [] as KimchiPremiumRow[] }
    }

    const premiums = calcPremiums(bithumbSet.value, priceMeta.prices, usdKrw)
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
    _dataMeta: buildDataMeta(priceMeta ?? undefined, fxMeta ?? undefined),
    _disclaimer: CROSSFIN_DISCLAIMER,
    at,
  })
})

app.get('/api/premium/kimchi/stats', async (c) => {
  const at = new Date().toISOString()

  type KimchiPremiumRow = ReturnType<typeof calcPremiums>[number]

  const priceMetaPromise = fetchGlobalPricesWithMeta(c.env.DB)
  const fxMetaPromise = fetchFxRatesWithMeta()

  const currentTask = (async () => {
    const bithumbPromise = fetchBithumbAll()

    const [bithumbSet, globalSet, fxSet] = await Promise.allSettled([
      bithumbPromise,
      priceMetaPromise,
      fxMetaPromise,
    ] as const)

    const fxMeta = fxSet.status === 'fulfilled' ? fxSet.value : null
    const priceMeta = globalSet.status === 'fulfilled' ? globalSet.value : null
    const usdKrw = fxMeta ? fxMeta.rates.KRW : 1450

    const premiums: KimchiPremiumRow[] =
      bithumbSet.status === 'fulfilled' && priceMeta
        ? calcPremiums(bithumbSet.value, priceMeta.prices, usdKrw)
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
        return { coin: '', premiumPct: 0, indicator: 'NEGATIVE_SPREAD' as const, signalStrength: 0.1, reason: 'No premium data available' }
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
      const absPremiumPct = Math.abs(premiumPct)
      const netProfitPct = absPremiumPct - totalFeesPct
      const TRADE_SIZE_KRW = 15_000_000
      const slippageEstimatePct = estimateSlippage(asks, TRADE_SIZE_KRW)
      const transferTimeMin = getTransferTime(coin)
      const volatilityPct = trendSet.status === 'fulfilled' ? trendSet.value.volatilityPct : 0

      const { indicator, signalStrength, reason: baseReason } = computeAction(
        netProfitPct,
        slippageEstimatePct,
        transferTimeMin,
        volatilityPct,
      )
      const reason = `${baseReason}. ${premiumPct >= 0 ? 'Korea premium setup (buy global -> sell Korea)' : 'Korea discount setup (buy Korea -> sell global)'}; gross edge ${round2(absPremiumPct)}% before fees.`

      return { coin, premiumPct, indicator, signalStrength, reason }
    } catch {
      return { coin: '', premiumPct: 0, indicator: 'NEGATIVE_SPREAD' as const, signalStrength: 0.1, reason: 'Failed to compute opportunity' }
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
    : { coin: '', premiumPct: 0, indicator: 'NEGATIVE_SPREAD' as const, signalStrength: 0.1, reason: 'Failed to compute opportunity' }

  const crossExchangeSpread = spreadSet.status === 'fulfilled'
    ? spreadSet.value
    : { coin: 'BTC' as const, upbitKrw: null as number | null, bithumbKrw: null as number | null, coinoneKrw: null as number | null, spreadPct: 0, bestBuy: '', bestSell: '' }

  const [resolvedPriceMeta, resolvedFxMeta] = await Promise.all([
    priceMetaPromise.catch(() => undefined),
    fxMetaPromise.catch(() => undefined),
  ])

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
    _dataMeta: buildDataMeta(resolvedPriceMeta, resolvedFxMeta),
    _disclaimer: CROSSFIN_DISCLAIMER,
    at,
  })
})

app.get('/api/premium/morning/brief', async (c) => {
  const at = new Date().toISOString()

  const fxMetaPromise = fetchFxRatesWithMeta()
  const priceMetaPromise = fetchGlobalPricesWithMeta(c.env.DB)

  type KimchiPremiumRow = ReturnType<typeof calcPremiums>[number]
  type HeadlinesItem = { title: string; publisher: string | null; link: string; publishedAt: string }

  const kimchiTask = (async () => {
    const [bithumbData, pMeta, fMeta] = await Promise.all([
      fetchBithumbAll(),
      priceMetaPromise,
      fxMetaPromise,
    ])

    const krwRate = fMeta.rates.KRW
    const premiums = calcPremiums(bithumbData, pMeta.prices, krwRate)
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

  const headlinesTask = (async () => {
    const feedUrl = 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko'
    const res = await fetchWithTimeout(feedUrl, { headers: { 'User-Agent': 'crossfin-news/1.0' } })
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

  const [fxSet, priceSet, kimchiSet, headlinesSet] = await Promise.allSettled([
    fxMetaPromise,
    priceMetaPromise,
    kimchiTask,
    headlinesTask,
  ] as const)

  const fxMeta = fxSet.status === 'fulfilled' ? fxSet.value : null
  const priceMeta = priceSet.status === 'fulfilled' ? priceSet.value : null
  const usdKrw = fxMeta ? fxMeta.rates.KRW : 1450

  const kimchiPremium = kimchiSet.status === 'fulfilled'
    ? kimchiSet.value
    : { avgPremiumPct: 0, topPair: '', pairsTracked: 0, premiums: [] as KimchiPremiumRow[] }

  const headlines = headlinesSet.status === 'fulfilled' ? headlinesSet.value : []

  return c.json({
    paid: true,
    service: 'crossfin-morning-brief',
    kimchiPremium,
    fxRate: {
      usdKrw: round2(usdKrw),
      source: fxMeta ? fxMeta.source : 'fallback',
    },
    headlines,
    _dataMeta: buildDataMeta(priceMeta ?? undefined, fxMeta ?? undefined),
    _disclaimer: CROSSFIN_DISCLAIMER,
    at,
  })
})

app.get('/api/premium/market/cross-exchange', async (c) => {
  const coins = parseCoinsQueryParam(c.req.query('coins'))

  const [bithumbSet, binanceSet, fxSet] = await Promise.allSettled([
    fetchBithumbAll(),
    fetchGlobalPricesWithMeta(c.env.DB),
    fetchFxRatesWithMeta(),
  ])

  const bithumbData: Record<string, Record<string, string>> = bithumbSet.status === 'fulfilled' ? bithumbSet.value : {}
  const priceMeta = binanceSet.status === 'fulfilled' ? binanceSet.value : null
  const fxMeta = fxSet.status === 'fulfilled' ? fxSet.value : null
  const binancePrices: Record<string, number> = priceMeta ? priceMeta.prices : {}
  const krwRate = fxMeta ? fxMeta.rates.KRW : 1450

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
      let indicator: 'SPREAD_OPPORTUNITY' | 'NEUTRAL_SIGNAL' | 'MONITORING' = 'NEUTRAL_SIGNAL'
      if (domesticArbitrage && domesticArbitrage.spreadPct > 0.5) {
        indicator = 'SPREAD_OPPORTUNITY'
      } else if (domesticArbitrage && domesticArbitrage.spreadPct > 0.2) {
        indicator = 'MONITORING'
      }

      return {
        coin,
        exchanges,
        kimchiPremium,
        domesticArbitrage,
        bestBuyExchange: domesticArbitrage?.lowestExchange ?? null,
        bestSellExchange: domesticArbitrage?.highestExchange ?? null,
        spreadPct: domesticArbitrage?.spreadPct ?? 0,
        indicator,
      }
    }),
  )

  const avgPremiums = rows
    .map((r) => r.kimchiPremium.average)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const avgKimchiPremium = avgPremiums.length > 0
    ? round2(avgPremiums.reduce((s, p) => s + p, 0) / avgPremiums.length)
    : 0

  const spreadOpportunityCandidates = rows
    .filter((r) => r.domesticArbitrage !== null)
    .map((r) => ({
      coin: r.coin,
      buy: r.domesticArbitrage!.lowestExchange,
      sell: r.domesticArbitrage!.highestExchange,
      spreadPct: r.domesticArbitrage!.spreadPct,
      indicator: r.indicator,
    }))
    .sort((a, b) => b.spreadPct - a.spreadPct)

  const spreadOpportunityCount = rows.filter((r) => r.indicator === 'SPREAD_OPPORTUNITY').length

  return c.json({
    paid: true,
    service: 'crossfin-cross-exchange',
    coinsCompared: coins.length,
    krwUsdRate: round2(krwRate),
    spreadOpportunityCount,
    coins: rows,
    summary: {
      avgKimchiPremium,
      spreadOpportunityCount,
      bestDomesticSpread: spreadOpportunityCandidates[0] ?? null,
    },
    _dataMeta: buildDataMeta(priceMeta ?? undefined, fxMeta ?? undefined),
    _disclaimer: CROSSFIN_DISCLAIMER,
    at: new Date().toISOString(),
  })
})

// === Free Demo — delayed route spread (no paywall) ===

async function getArbitrageDemoPayload(db: D1Database): Promise<Record<string, unknown>> {
  const buildPreview = (rows: Array<{ coin: string; premiumPct: number }>) =>
    rows.slice(0, 3).map((p) => {
      const absPremiumPct = Math.abs(p.premiumPct)
      const netProfitPct = absPremiumPct - BITHUMB_FEES_PCT - 0.1
      const transferTime = getTransferTime(p.coin)
      const slippage = 0.15
      const volatility = Math.abs(p.premiumPct) * 0.3
      const decision = computeAction(netProfitPct, slippage, transferTime, volatility)
      return {
        coin: p.coin,
        premiumPct: absPremiumPct,
        direction: p.premiumPct >= 0 ? 'Korea premium' : 'Korea discount',
        decision: {
          indicator: decision.indicator,
          signalStrength: decision.signalStrength,
          reason: `${decision.reason}. ${p.premiumPct >= 0 ? 'Korea premium setup (buy global -> sell Korea)' : 'Korea discount setup (buy Korea -> sell global)'}; gross edge ${round2(absPremiumPct)}% before fees.`,
        },
      }
    })

  try {
    const [bithumbData, binancePrices, krwRate] = await Promise.all([
      fetchBithumbAll(),
      fetchGlobalPrices(db),
      fetchKrwRate(),
    ])

    const premiums = calcPremiums(bithumbData, binancePrices, krwRate)
    if (premiums.length === 0) throw new Error('No premiums available')

    const preview = buildPreview(premiums)
    const avgPremium = Math.round(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length * 100) / 100
    const positiveSpreadCount = preview.filter((p) => p.decision.indicator === 'POSITIVE_SPREAD').length

    return {
      demo: true,
      dataSource: 'live',
      note: 'Free preview — top 3 pairs with AI decision layer. Pay $0.10 USDC for full analysis.',
      paidEndpoint: '/api/premium/arbitrage/opportunities',
      krwUsdRate: krwRate,
      pairsShown: preview.length,
      totalPairsAvailable: premiums.length,
      preview,
      avgPremiumPct: avgPremium,
      positiveSpreadCount,
      marketCondition: positiveSpreadCount >= 2 ? 'positive' : positiveSpreadCount === 1 ? 'neutral' : 'negative',
      _disclaimer: CROSSFIN_DISCLAIMER,
      at: new Date().toISOString(),
    }
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

      const res = await db.prepare(sql).all<SnapshotRow>()
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
    const positiveSpreadCount = preview.filter((p) => p.decision.indicator === 'POSITIVE_SPREAD').length
    const snapshotAt = premiums[0]?.createdAt ?? null

    if (preview.length === 0) {
      // Final fallback: stable demo output to keep live dashboard non-empty.
      const fallbackPremiums = [
        { coin: 'BTC', premiumPct: 0.0 },
        { coin: 'ETH', premiumPct: 0.0 },
        { coin: 'XRP', premiumPct: 0.0 },
      ]
      const fallbackPreview = buildPreview(fallbackPremiums)
      return {
        demo: true,
        dataSource: 'fallback',
        note: 'Demo fallback — live price feeds are temporarily unavailable.',
        paidEndpoint: '/api/premium/arbitrage/opportunities',
        krwUsdRate,
        pairsShown: fallbackPreview.length,
        totalPairsAvailable: fallbackPremiums.length,
        preview: fallbackPreview,
        avgPremiumPct: 0,
        positiveSpreadCount: 0,
        marketCondition: 'negative',
        _disclaimer: CROSSFIN_DISCLAIMER,
        at: new Date().toISOString(),
      }
    }

    return {
      demo: true,
      dataSource: 'snapshot',
      note: 'Snapshot preview — live price feeds are rate-limited. Pay $0.10 USDC for full analysis.',
      paidEndpoint: '/api/premium/arbitrage/opportunities',
      krwUsdRate,
      pairsShown: preview.length,
      totalPairsAvailable: premiums.length,
      preview,
      avgPremiumPct: avgPremium,
      positiveSpreadCount,
      marketCondition: positiveSpreadCount >= 2 ? 'positive' : positiveSpreadCount === 1 ? 'neutral' : 'negative',
      _disclaimer: CROSSFIN_DISCLAIMER,
      snapshotAt,
      at: new Date().toISOString(),
    }
  }
}

app.get('/api/arbitrage/demo', async (c) => {
  return c.json(await getArbitrageDemoPayload(c.env.DB))
})

// === Autonomous Actions Log ===

app.get('/api/agents/:agentId/actions', agentAuth, async (c) => {
  requireGuardianEnabled(c)
  const requesterAgentId = c.get('agentId')
  const agentId = c.req.param('agentId')
  if (agentId !== requesterAgentId) {
    throw new HTTPException(403, { message: 'Forbidden' })
  }

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

app.post('/api/deposits', agentAuth, async (c) => {
  requireGuardianEnabled(c)
  const agentId = c.get('agentId')
  const body = await c.req.json<{
    tx_hash: string
  }>()

  if (!body.tx_hash?.trim()) {
    throw new HTTPException(400, { message: 'tx_hash is required' })
  }

  const txHash = body.tx_hash.trim().toLowerCase()

  // Check for duplicate
  const existing = await c.env.DB.prepare(
    'SELECT id, status, agent_id FROM deposits WHERE tx_hash = ?'
  ).bind(txHash).first<{ id: string; status: string; agent_id: string | null }>()
  if (existing) {
    if (existing.agent_id === agentId) {
      return c.json({ id: existing.id, status: existing.status, message: 'Deposit already processed' })
    }
    throw new HTTPException(409, { message: 'Transaction already claimed by another agent' })
  }

  // Verify on Basescan
  const basescanUrl = `https://api.basescan.org/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}`
  const receipt: unknown = await fetchWithTimeout(basescanUrl, undefined, 10000).then((r) => r.json()).catch(() => null)
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

  let credited = false
  const wallet = await c.env.DB.prepare(
    'SELECT id FROM wallets WHERE agent_id = ? LIMIT 1'
  ).bind(agentId).first<{ id: string }>()

  if (wallet) {
    const creditCents = Math.round(amountUsd * 100)
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO deposits (id, agent_id, tx_hash, amount_usd, from_address, status, verified_at) VALUES (?, ?, ?, ?, ?, 'verified', datetime('now'))"
      ).bind(depositId, agentId, txHash, amountUsd, fromAddress),
      c.env.DB.prepare(
        'UPDATE wallets SET balance_cents = balance_cents + ? WHERE id = ?'
      ).bind(creditCents, wallet.id),
      c.env.DB.prepare(
        "INSERT INTO transactions (id, to_wallet_id, amount_cents, rail, memo, status) VALUES (?, ?, ?, 'x402', ?, 'completed')"
      ).bind(crypto.randomUUID(), wallet.id, creditCents, `Deposit via ${txHash.slice(0, 10)}...`),
    ])
    credited = true
  } else {
    await c.env.DB.prepare(
      "INSERT INTO deposits (id, agent_id, tx_hash, amount_usd, from_address, status, verified_at) VALUES (?, ?, ?, ?, ?, 'verified', datetime('now'))"
    ).bind(depositId, agentId, txHash, amountUsd, fromAddress).run()
  }

  await logAutonomousAction(c.env.DB, agentId, 'DEPOSIT_VERIFY', null, 'POSITIVE_SPREAD', 1.0, amountUsd, null, {
    txHash,
    amountUsd,
    fromAddress,
    basescan: `https://basescan.org/tx/${txHash}`,
  })

  await audit(c.env.DB, agentId, 'deposit.verify', 'deposits', depositId, 'success', `$${amountUsd.toFixed(2)} USDC from ${fromAddress.slice(0, 10)}...`)

  return c.json({
    id: depositId,
    status: 'verified',
    amountUsd,
    fromAddress,
    txHash,
    basescan: `https://basescan.org/tx/${txHash}`,
    credited,
  }, 201)
})

app.get('/api/deposits', agentAuth, async (c) => {
  requireGuardianEnabled(c)
  const agentId = c.get('agentId')
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM deposits WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(agentId, limit).all()
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
  let body: {
    name?: string
    evm_address?: string
    signup_token?: string
  }

  try {
    body = await c.req.json()
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' })
  }

  const name = body.name?.trim() ?? ''
  if (!name) {
    throw new HTTPException(400, { message: 'name is required' })
  }

  const clientIp = getClientRateLimitKey(c)
  const ipHint = maskIpForAudit(clientIp)
  const ipHash = await sha256Hex(`agent-register:${clientIp}`)

  await ensureAgentRegistrationAttemptsTable(c.env.DB)

  const attemptWindowModifier = `-${AGENT_REGISTER_ATTEMPT_WINDOW_MINUTES} minutes`
  const attemptsRow = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM agent_registration_attempts WHERE ip_hash = ? AND created_at >= datetime('now', ?)"
  ).bind(ipHash, attemptWindowModifier).first<{ count: number | string }>()

  const recentAttempts = Number(attemptsRow?.count ?? 0)
  if (recentAttempts >= AGENT_REGISTER_MAX_ATTEMPTS_PER_WINDOW) {
    try {
      await logAgentRegistrationAttempt(c.env.DB, ipHash, ipHint, name, false, 'rate_limited')
      await audit(
        c.env.DB,
        null,
        'agent.self_register',
        'agents',
        null,
        'blocked',
        `rate_limited ip=${ipHint} window=${AGENT_REGISTER_ATTEMPT_WINDOW_MINUTES}m limit=${AGENT_REGISTER_MAX_ATTEMPTS_PER_WINDOW}`,
      )
    } catch (err) {
      console.error('Failed to record rate-limited registration attempt', err)
    }

    throw new HTTPException(429, {
      message: `Too many registration attempts from this IP. Try again in ${AGENT_REGISTER_ATTEMPT_WINDOW_MINUTES} minutes.`,
    })
  }

  const requiredSignupToken = (c.env.CROSSFIN_AGENT_SIGNUP_TOKEN ?? '').trim()
  if (!requiredSignupToken) {
    try {
      await logAgentRegistrationAttempt(c.env.DB, ipHash, ipHint, name, false, 'signup_token_not_configured')
      await audit(c.env.DB, null, 'agent.self_register', 'agents', null, 'blocked', 'signup_token_not_configured')
    } catch (err) {
      console.error('Failed to record missing signup-token configuration', err)
    }
    throw new HTTPException(503, { message: 'Agent registration is temporarily unavailable' })
  }

  const providedSignupToken = (c.req.header('X-CrossFin-Signup-Token') ?? body.signup_token ?? '').trim()
  if (requiredSignupToken && !timingSafeEqual(providedSignupToken, requiredSignupToken)) {
    try {
      await logAgentRegistrationAttempt(c.env.DB, ipHash, ipHint, name, false, 'invalid_signup_token')
      await audit(c.env.DB, null, 'agent.self_register', 'agents', null, 'blocked', `invalid_signup_token ip=${ipHint}`)
    } catch (err) {
      console.error('Failed to record invalid-token registration attempt', err)
    }
    throw new HTTPException(401, { message: 'Invalid signup token' })
  }

  const id = crypto.randomUUID()
  const rawApiKey = `cf_${crypto.randomUUID().replace(/-/g, '')}`
  const keyHash = await sha256Hex(rawApiKey)

  await c.env.DB.prepare(
    "INSERT INTO agents (id, name, api_key, status) VALUES (?, ?, ?, 'active')"
  ).bind(id, name, keyHash).run()

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
  try {
    await logAgentRegistrationAttempt(c.env.DB, ipHash, ipHint, name, true, 'created', id)
  } catch (err) {
    console.error('Failed to record successful registration attempt', err)
  }

  return c.json({
    id,
    name,
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
    _disclaimer: CROSSFIN_DISCLAIMER,
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
    _disclaimer: CROSSFIN_DISCLAIMER,
    at: now,
  })
})

const api = new Hono<Env>()

api.get('/survival/status', async (c) => {
  const now = new Date()
  await ensureEndpointCallsTable(c.env.DB)

  const [allTotalCalls, allTodayCalls, allWeekCalls, externalTotalCalls, externalTodayCalls, externalWeekCalls] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM endpoint_calls').first<{ cnt: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM endpoint_calls WHERE created_at >= datetime('now', '-1 day')"
    ).first<{ cnt: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM endpoint_calls WHERE created_at >= datetime('now', '-7 day')"
    ).first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM endpoint_calls_v2 WHERE traffic_source = 'external'").first<{ cnt: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM endpoint_calls_v2 WHERE traffic_source = 'external' AND created_at >= datetime('now', '-1 day')"
    ).first<{ cnt: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM endpoint_calls_v2 WHERE traffic_source = 'external' AND created_at >= datetime('now', '-7 day')"
    ).first<{ cnt: number }>(),
  ])

  const activeServices = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM services WHERE status = 'active'"
  ).first<{ cnt: number }>()

  const totalCallsAll = allTotalCalls?.cnt ?? 0
  const callsTodayAll = allTodayCalls?.cnt ?? 0
  const callsWeekAll = allWeekCalls?.cnt ?? 0
  const totalCallsExternal = externalTotalCalls?.cnt ?? 0
  const callsTodayExternal = externalTodayCalls?.cnt ?? 0
  const callsWeekExternal = externalWeekCalls?.cnt ?? 0
  const alive = true

  return c.json({
    alive,
    state: alive ? 'ALIVE' : 'STOPPED',
    version: CROSSFIN_API_VERSION,
    metrics: {
      totalCalls: totalCallsAll,
      callsToday: callsTodayAll,
      callsThisWeek: callsWeekAll,
      externalTotalCalls: totalCallsExternal,
      externalCallsToday: callsTodayExternal,
      externalCallsThisWeek: callsWeekExternal,
      activeServices: activeServices?.cnt ?? 0,
    },
    traffic: {
      all: {
        totalCalls: totalCallsAll,
        callsToday: callsTodayAll,
        callsThisWeek: callsWeekAll,
      },
      external: {
        totalCalls: totalCallsExternal,
        callsToday: callsTodayExternal,
        callsThisWeek: callsWeekExternal,
      },
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

  // Pre-check balance to fast-fail before the atomic batch
  const srcWallet = await c.env.DB.prepare(
    'SELECT balance_cents FROM wallets WHERE id = ? AND agent_id = ?'
  ).bind(body.fromWalletId, agentId).first<{ balance_cents: number }>()
  if (!srcWallet || srcWallet.balance_cents < amount) {
    await audit(c.env.DB, agentId, 'transfer.blocked', 'transactions', null, 'blocked', 'Insufficient balance')
    throw new HTTPException(400, { message: 'Insufficient balance' })
  }

  // Atomic batch: debit, credit, and transaction record all succeed or all fail.
  // The debit WHERE clause (balance_cents >= ?) is a safety net against concurrent races.
  const batchResults = await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE wallets SET balance_cents = balance_cents - ?, updated_at = datetime("now") WHERE id = ? AND agent_id = ? AND balance_cents >= ?'
    ).bind(amount, body.fromWalletId, agentId, amount),
    c.env.DB.prepare(
      'UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = datetime("now") WHERE id = ?'
    ).bind(amount, body.toWalletId),
    c.env.DB.prepare(
      "INSERT INTO transactions (id, from_wallet_id, to_wallet_id, amount_cents, rail, memo, status) VALUES (?, ?, ?, ?, ?, ?, 'completed')"
    ).bind(txId, body.fromWalletId, body.toWalletId, amount, rail, body.memo ?? ''),
  ])

  const debitChanges = Number(batchResults[0]?.meta.changes ?? 0)
  if (debitChanges === 0) {
    // Debit WHERE clause didn't match (concurrent race drained balance).
    // Reverse the credit and remove the transaction record atomically.
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE wallets SET balance_cents = balance_cents - ?, updated_at = datetime("now") WHERE id = ?'
      ).bind(amount, body.toWalletId),
      c.env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(txId),
    ])
    await audit(c.env.DB, agentId, 'transfer.blocked', 'transactions', null, 'blocked', 'Insufficient balance')
    throw new HTTPException(400, { message: 'Insufficient balance' })
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

async function getPublicStatsPayload(db: D1Database): Promise<{
  agents: number
  wallets: number
  transactions: number
  blocked: number
  note: string
  at: string
}> {
  const results = await db.batch([
    db.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'active'"),
    db.prepare('SELECT COUNT(*) as count FROM wallets'),
    db.prepare('SELECT COUNT(*) as count FROM transactions'),
  ])

  const agents = Number((results[0]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
  const wallets = Number((results[1]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
  const transactions = Number((results[2]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)

  const blocked = await db.prepare(
    "SELECT COUNT(*) as count FROM audit_logs WHERE result = 'blocked'"
  ).first<{ count: number | string }>()

  const bucket = (value: number): number => {
    if (!Number.isFinite(value) || value <= 0) return 0
    if (value < 10) return 10
    if (value < 100) return Math.ceil(value / 10) * 10
    return Math.ceil(value / 100) * 100
  }

  return {
    agents: bucket(agents),
    wallets: bucket(wallets),
    transactions: bucket(transactions),
    blocked: bucket(Number(blocked?.count ?? 0)),
    note: 'Public counters are rounded for privacy',
    at: new Date().toISOString(),
  }
}

function parseAcpExchangeCurrency(
  body: Record<string, unknown>,
  tupleKey: 'from' | 'to',
  exchangeKey: 'from_exchange' | 'to_exchange',
  currencyKey: 'from_currency' | 'to_currency',
): { exchange: string; currency: string } {
  const tupleRaw = typeof body[tupleKey] === 'string' ? String(body[tupleKey]).trim() : ''
  const exchangeRaw = typeof body[exchangeKey] === 'string' ? String(body[exchangeKey]).trim().toLowerCase() : ''
  const currencyRaw = typeof body[currencyKey] === 'string' ? String(body[currencyKey]).trim().toUpperCase() : ''

  const normalizeTuple = (value: string): { exchange: string; currency: string } => {
    const parts = value.split(':')
    if (parts.length !== 2) {
      throw new HTTPException(400, { message: `${tupleKey} must use exchange:currency format (e.g., bithumb:KRW)` })
    }

    const exchange = String(parts[0] ?? '').trim().toLowerCase()
    const currency = String(parts[1] ?? '').trim().toUpperCase()
    if (!exchange || !currency) {
      throw new HTTPException(400, { message: `${tupleKey} must use exchange:currency format (e.g., bithumb:KRW)` })
    }

    return { exchange, currency }
  }

  let exchange = exchangeRaw
  let currency = currencyRaw

  if (tupleRaw) {
    const parsed = normalizeTuple(tupleRaw)
    exchange = parsed.exchange
    currency = parsed.currency

    if (exchangeRaw && exchangeRaw !== exchange) {
      throw new HTTPException(400, { message: `Conflicting ${tupleKey} and ${exchangeKey} values` })
    }
    if (currencyRaw && currencyRaw !== currency) {
      throw new HTTPException(400, { message: `Conflicting ${tupleKey} and ${currencyKey} values` })
    }
  } else if (!exchange || !currency) {
    throw new HTTPException(400, {
      message: `Provide either ${tupleKey} (exchange:currency) or both ${exchangeKey} and ${currencyKey}`,
    })
  }

  if (!ROUTING_EXCHANGES.includes(exchange as RoutingExchange)) {
    throw new HTTPException(400, {
      message: `Unsupported ${exchangeKey}: ${exchange}. Supported: ${ROUTING_EXCHANGES.join(', ')}`,
    })
  }

  if (!/^[A-Z0-9]{2,12}$/.test(currency)) {
    throw new HTTPException(400, { message: `Invalid ${currencyKey}: ${currency}` })
  }

  return { exchange, currency }
}

function parseRoutingStrategyInput(value: unknown): RoutingStrategy {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!raw) return 'cheapest'

  if (raw === 'cheapest' || raw === 'fastest' || raw === 'balanced') {
    return raw
  }

  throw new HTTPException(400, { message: 'strategy must be one of: cheapest, fastest, balanced' })
}

type AcpExecutionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'expired'
type AcpExecutionStepStatus = 'pending' | 'in_progress' | 'completed'

type AcpQuoteRequest = {
  from_exchange: string
  from_currency: string
  to_exchange: string
  to_currency: string
  amount: number
  strategy: RoutingStrategy
}

type AcpRouteSnapshot = {
  bridgeCoin: Route['bridgeCoin']
  totalCostPct: number
  totalTimeMinutes: number
  estimatedInput: number
  estimatedOutput: number
  indicator: Route['indicator']
  signalStrength: number
  reason: string
  summary: Route['summary'] | null
}

type AcpStepTemplate = {
  step: number
  type: RouteStep['type']
  from: RouteStep['from']
  to: RouteStep['to']
  amountIn: number
  amountOut: number
  estimatedCost: RouteStep['estimatedCost']
  durationMs: number
}

let acpTablesReady: Promise<void> | null = null

async function ensureAcpTables(db: D1Database): Promise<void> {
  if (!acpTablesReady) {
    acpTablesReady = db.batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS acp_quotes (
           id TEXT PRIMARY KEY,
           from_exchange TEXT NOT NULL,
           from_currency TEXT NOT NULL,
           to_exchange TEXT NOT NULL,
           to_currency TEXT NOT NULL,
           amount REAL NOT NULL CHECK (amount > 0),
           strategy TEXT NOT NULL CHECK (strategy IN ('cheapest', 'fastest', 'balanced')),
           optimal_route_json TEXT,
           alternatives_json TEXT NOT NULL DEFAULT '[]',
           meta_json TEXT NOT NULL DEFAULT '{}',
           status TEXT NOT NULL DEFAULT 'quoted' CHECK (status IN ('quoted', 'executed', 'expired')),
           expires_at TEXT NOT NULL,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_acp_quotes_created ON acp_quotes(created_at DESC)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_acp_quotes_expires ON acp_quotes(expires_at)'),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS acp_executions (
           id TEXT PRIMARY KEY,
           quote_id TEXT NOT NULL REFERENCES acp_quotes(id),
           status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'expired')),
           simulated INTEGER NOT NULL DEFAULT 1,
           route_json TEXT NOT NULL,
           steps_json TEXT NOT NULL,
           current_step INTEGER NOT NULL DEFAULT 0,
           total_steps INTEGER NOT NULL DEFAULT 0,
           started_at TEXT,
           completed_at TEXT,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_acp_executions_quote_created ON acp_executions(quote_id, created_at DESC)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_acp_executions_status_created ON acp_executions(status, created_at DESC)'),
    ]).then(() => undefined).catch((err) => {
      acpTablesReady = null
      throw err
    })
  }

  await acpTablesReady
}

function parseAcpJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function toAcpRouteSnapshot(route: Route): AcpRouteSnapshot {
  return {
    bridgeCoin: route.bridgeCoin,
    totalCostPct: route.totalCostPct,
    totalTimeMinutes: route.totalTimeMinutes,
    estimatedInput: route.estimatedInput,
    estimatedOutput: route.estimatedOutput,
    indicator: route.indicator,
    signalStrength: route.signalStrength,
    reason: route.reason,
    summary: route.summary ?? null,
  }
}

function normalizeAcpStepDurationMs(step: RouteStep): number {
  const fromEstimate = Number.isFinite(step.estimatedCost.timeMinutes)
    ? Math.round(step.estimatedCost.timeMinutes * 1000)
    : 0
  const minDurationMs = step.type === 'transfer' ? 4_000 : 2_000
  const maxDurationMs = step.type === 'transfer' ? 30_000 : 10_000
  return Math.min(maxDurationMs, Math.max(minDurationMs, fromEstimate || minDurationMs))
}

function toAcpStepTemplates(route: Route): AcpStepTemplate[] {
  return route.steps.map((step, index) => ({
    step: index + 1,
    type: step.type,
    from: step.from,
    to: step.to,
    amountIn: step.amountIn,
    amountOut: step.amountOut,
    estimatedCost: step.estimatedCost,
    durationMs: normalizeAcpStepDurationMs(step),
  }))
}

function buildAcpExecutionResponse(
  executionId: string,
  quoteId: string,
  request: AcpQuoteRequest,
  route: AcpRouteSnapshot,
  stepTemplates: AcpStepTemplate[],
  startedAtIso: string | null,
  createdAtIso: string,
  nowMs = Date.now(),
) {
  const startedAtMs = startedAtIso ? Date.parse(startedAtIso) : Number.NaN
  const createdAtMs = Date.parse(createdAtIso)
  const baseMs = Number.isFinite(startedAtMs) ? startedAtMs : (Number.isFinite(createdAtMs) ? createdAtMs : nowMs)
  const hasStarted = Number.isFinite(startedAtMs)

  const totalDurationMs = stepTemplates.reduce((sum, step) => sum + step.durationMs, 0)
  const elapsedMs = hasStarted ? Math.max(0, nowMs - baseMs) : 0
  const clampedElapsedMs = Math.min(elapsedMs, totalDurationMs)

  let stepCursor = baseMs
  let inProgressFound = false
  let completedSteps = 0
  let currentStep: number | null = null

  const steps = stepTemplates.map((step) => {
    const stepStartMs = stepCursor
    const stepEndMs = stepCursor + step.durationMs
    stepCursor = stepEndMs

    let status: AcpExecutionStepStatus = 'pending'
    if (hasStarted && nowMs >= stepEndMs) {
      status = 'completed'
      completedSteps += 1
    } else if (hasStarted && !inProgressFound && nowMs >= stepStartMs) {
      status = 'in_progress'
      inProgressFound = true
      currentStep = step.step
    }

    if (status === 'pending' && !currentStep && hasStarted && completedSteps < stepTemplates.length) {
      currentStep = step.step
    }

    return {
      step: step.step,
      type: step.type,
      status,
      from: step.from,
      to: step.to,
      amount_in: step.amountIn,
      amount_out: step.amountOut,
      estimated_duration_seconds: Math.round(step.durationMs / 100) / 10,
      estimated_cost: {
        fee_pct: step.estimatedCost.feePct,
        fee_absolute: step.estimatedCost.feeAbsolute,
        slippage_pct: step.estimatedCost.slippagePct,
      },
      started_at: status === 'pending' ? null : new Date(stepStartMs).toISOString(),
      completed_at: status === 'completed' ? new Date(stepEndMs).toISOString() : null,
      expected_completion_at: status === 'completed' ? null : new Date(stepEndMs).toISOString(),
    }
  })

  const completed = completedSteps >= stepTemplates.length
  const status: AcpExecutionStatus = !hasStarted ? 'queued' : completed ? 'completed' : 'running'
  const percent = totalDurationMs > 0 ? Math.min(100, Math.round((clampedElapsedMs / totalDurationMs) * 100)) : 100
  const etaSeconds = status === 'completed' ? 0 : Math.max(0, Math.ceil((totalDurationMs - clampedElapsedMs) / 1000))
  const completedAt = status === 'completed' && hasStarted ? new Date(baseMs + totalDurationMs).toISOString() : null

  return {
    protocol: 'acp',
    version: '1.0',
    type: 'execution',
    provider: 'crossfin',
    quote_id: quoteId,
    execution_id: executionId,
    status,
    simulated: true,
    mode: 'tracked_orchestration',
    request,
    route,
    progress: {
      total_steps: stepTemplates.length,
      completed_steps: completedSteps,
      current_step: status === 'completed' ? null : currentStep,
      percent,
      eta_seconds: etaSeconds,
    },
    steps,
    started_at: hasStarted ? new Date(baseMs).toISOString() : null,
    completed_at: completedAt,
    updated_at: new Date(nowMs).toISOString(),
    actions: {
      status: { method: 'GET', url: `/api/acp/executions/${executionId}` },
    },
  }
}

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

  const fromParsed = parseAcpExchangeCurrency(body, 'from', 'from_exchange', 'from_currency')
  const toParsed = parseAcpExchangeCurrency(body, 'to', 'to_exchange', 'to_currency')

  const fromExchange = fromParsed.exchange
  const fromCurrency = fromParsed.currency
  const toExchange = toParsed.exchange
  const toCurrency = toParsed.currency
  const amount = Number(body.amount ?? 0)
  const strategy = parseRoutingStrategyInput(body.strategy)
  assertRoutingCurrencySupported(fromExchange, fromCurrency, 'from')
  assertRoutingCurrencySupported(toExchange, toCurrency, 'to')

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HTTPException(400, { message: 'amount must be a positive number' })
  }

  const { optimal, alternatives, meta } = await findOptimalRoute(
    fromExchange, fromCurrency, toExchange, toCurrency, amount, strategy, c.env.DB,
  )

  await ensureAcpTables(c.env.DB)
  const quoteId = `cfq_${crypto.randomUUID().slice(0, 12)}`
  const expiresAt = new Date(Date.now() + 60_000).toISOString()

  // Strip optimal route to preview (no steps, limited fields)
  const optimalPreview = optimal ? {
    bridgeCoin: optimal.bridgeCoin,
    totalCostPct: optimal.totalCostPct,
    totalTimeMinutes: optimal.totalTimeMinutes,
    estimatedInput: optimal.estimatedInput,
    estimatedOutput: optimal.estimatedOutput,
    indicator: optimal.indicator,
    signalStrength: optimal.signalStrength,
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

  const metaPreview = {
    exchangeRates: meta.exchangeRates,
    routesEvaluated: meta.routesEvaluated,
    bridgeCoinsTotal: meta.bridgeCoinsTotal,
    evaluatedCoins: meta.evaluatedCoins,
    skippedCoins: meta.skippedCoins,
    skippedReasons: meta.skippedReasons,
    analysisTimestamp: meta.analysisTimestamp,
    disclaimer: meta.disclaimer,
    priceAge: meta.priceAge,
    feesSource: meta.feesSource,
    dataFreshness: meta.dataFreshness,
  }

  await c.env.DB.prepare(
    `INSERT INTO acp_quotes
      (id, from_exchange, from_currency, to_exchange, to_currency, amount, strategy, optimal_route_json, alternatives_json, meta_json, status, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quoted', ?, ?)`
  ).bind(
    quoteId,
    fromExchange,
    fromCurrency,
    toExchange,
    toCurrency,
    amount,
    strategy,
    JSON.stringify(optimal),
    JSON.stringify(alternatives),
    JSON.stringify(meta),
    expiresAt,
    new Date().toISOString(),
  ).run()

  return c.json({
    protocol: 'acp',
    version: '1.0',
    type: 'quote',
    provider: 'crossfin',
    quote_id: quoteId,
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
    expires_at: expiresAt, // 60s quote validity
    actions: {
      execute: { method: 'POST', url: '/api/acp/execute', note: 'Start tracked execution orchestration from this quote_id' },
      execution_status: { method: 'GET', url: '/api/acp/executions/{execution_id}' },
    },
    _disclaimer: CROSSFIN_DISCLAIMER,
  })
})

// POST /api/acp/execute — Start tracked execution orchestration (free)
app.post('/api/acp/execute', agentAuth, async (c) => {
  let body: Record<string, unknown>
  try {
    body = await c.req.json() as Record<string, unknown>
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' })
  }

  const quoteId = String(body.quote_id ?? '')
  if (!quoteId) throw new HTTPException(400, { message: 'quote_id is required' })

  await ensureAcpTables(c.env.DB)

  const quote = await c.env.DB.prepare(
    `SELECT id, from_exchange, from_currency, to_exchange, to_currency, amount, strategy, optimal_route_json, expires_at, created_at
     FROM acp_quotes
     WHERE id = ?
     LIMIT 1`
  ).bind(quoteId).first<{
    id: string
    from_exchange: string
    from_currency: string
    to_exchange: string
    to_currency: string
    amount: number | string
    strategy: string
    optimal_route_json: string | null
    expires_at: string
    created_at: string
  }>()

  if (!quote) {
    throw new HTTPException(404, { message: `quote not found: ${quoteId}` })
  }

  const expiresAtMs = Date.parse(quote.expires_at)
  if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
    await c.env.DB.prepare(
      "UPDATE acp_quotes SET status = 'expired', updated_at = ? WHERE id = ?"
    ).bind(new Date().toISOString(), quoteId).run()
    throw new HTTPException(410, { message: `quote expired: ${quoteId}. Request a new quote.` })
  }

  const parsedRoute = parseAcpJson<unknown>(quote.optimal_route_json, null)
  if (!isRecord(parsedRoute) || !Array.isArray(parsedRoute.steps)) {
    throw new HTTPException(409, { message: `quote ${quoteId} has no executable route` })
  }

  const route = parsedRoute as unknown as Route
  const stepTemplates = toAcpStepTemplates(route)
  if (stepTemplates.length === 0) {
    throw new HTTPException(409, { message: `quote ${quoteId} has no executable steps` })
  }

  const executionId = `cfx_${crypto.randomUUID().slice(0, 12)}`
  const nowIso = new Date().toISOString()

  await c.env.DB.prepare(
    `INSERT INTO acp_executions
      (id, quote_id, status, simulated, route_json, steps_json, current_step, total_steps, started_at, completed_at, created_at, updated_at)
     VALUES (?, ?, 'running', 1, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).bind(
    executionId,
    quoteId,
    JSON.stringify(route),
    JSON.stringify(stepTemplates),
    1,
    stepTemplates.length,
    nowIso,
    nowIso,
    nowIso,
  ).run()

  await c.env.DB.prepare(
    "UPDATE acp_quotes SET status = 'executed', updated_at = ? WHERE id = ?"
  ).bind(nowIso, quoteId).run()

  const strategyRaw = quote.strategy.trim().toLowerCase()
  const strategy: RoutingStrategy = strategyRaw === 'fastest' || strategyRaw === 'balanced' ? strategyRaw : 'cheapest'
  const request: AcpQuoteRequest = {
    from_exchange: quote.from_exchange,
    from_currency: quote.from_currency,
    to_exchange: quote.to_exchange,
    to_currency: quote.to_currency,
    amount: Number(quote.amount),
    strategy,
  }

  const response = buildAcpExecutionResponse(
    executionId,
    quoteId,
    request,
    toAcpRouteSnapshot(route),
    stepTemplates,
    nowIso,
    quote.created_at,
  )

  await c.env.DB.prepare(
    'UPDATE acp_executions SET status = ?, current_step = ?, completed_at = ?, updated_at = ? WHERE id = ?'
  ).bind(
    response.status,
    Number(response.progress.current_step ?? 0),
    response.completed_at,
    response.updated_at,
    executionId,
  ).run()

  return c.json(response)
})

// GET /api/acp/executions/:executionId — ACP execution progress (free)
app.get('/api/acp/executions/:executionId', agentAuth, async (c) => {
  const executionId = String(c.req.param('executionId') ?? '').trim()
  if (!executionId) throw new HTTPException(400, { message: 'executionId is required' })

  await ensureAcpTables(c.env.DB)

  const row = await c.env.DB.prepare(
    `SELECT
       e.id,
       e.quote_id,
       e.route_json,
       e.steps_json,
       e.started_at,
       e.created_at,
       e.completed_at,
       q.from_exchange,
       q.from_currency,
       q.to_exchange,
       q.to_currency,
       q.amount,
       q.strategy
     FROM acp_executions e
     JOIN acp_quotes q ON q.id = e.quote_id
     WHERE e.id = ?
     LIMIT 1`
  ).bind(executionId).first<{
    id: string
    quote_id: string
    route_json: string
    steps_json: string
    started_at: string | null
    created_at: string
    completed_at: string | null
    from_exchange: string
    from_currency: string
    to_exchange: string
    to_currency: string
    amount: number | string
    strategy: string
  }>()

  if (!row) {
    throw new HTTPException(404, { message: `execution not found: ${executionId}` })
  }

  const parsedRoute = parseAcpJson<unknown>(row.route_json, null)
  if (!isRecord(parsedRoute) || !Array.isArray(parsedRoute.steps)) {
    throw new HTTPException(500, { message: `execution ${executionId} is missing route state` })
  }
  const route = parsedRoute as unknown as Route

  const storedTemplates = parseAcpJson<AcpStepTemplate[]>(row.steps_json, [])
  const stepTemplates = storedTemplates.length > 0 ? storedTemplates : toAcpStepTemplates(route)

  const strategyRaw = row.strategy.trim().toLowerCase()
  const strategy: RoutingStrategy = strategyRaw === 'fastest' || strategyRaw === 'balanced' ? strategyRaw : 'cheapest'
  const request: AcpQuoteRequest = {
    from_exchange: row.from_exchange,
    from_currency: row.from_currency,
    to_exchange: row.to_exchange,
    to_currency: row.to_currency,
    amount: Number(row.amount),
    strategy,
  }

  const response = buildAcpExecutionResponse(
    executionId,
    row.quote_id,
    request,
    toAcpRouteSnapshot(route),
    stepTemplates,
    row.started_at,
    row.created_at,
  )

  await c.env.DB.prepare(
    'UPDATE acp_executions SET status = ?, current_step = ?, completed_at = ?, updated_at = ? WHERE id = ?'
  ).bind(
    response.status,
    Number(response.progress.current_step ?? 0),
    response.completed_at,
    response.updated_at,
    executionId,
  ).run()

  return c.json(response)
})

function getAcpStatusPayload(): {
  protocol: 'acp'
  version: string
  provider: string
  capabilities: string[]
  supported_exchanges: string[]
  supported_currencies: { source: string[]; destination: string[] }
  bridge_coins: string[]
  execution_mode: string
  tracking: { step_level: boolean; endpoint: string }
  live_execution: string
  compatible_with: string[]
  at: string
} {
  return {
    protocol: 'acp',
    version: '1.0',
    provider: 'crossfin',
    capabilities: ['quote', 'execute', 'execution_status'],
    supported_exchanges: [...ROUTING_EXCHANGES],
    supported_currencies: {
      source: [...ROUTING_SUPPORTED_CURRENCIES],
      destination: [...ROUTING_SUPPORTED_CURRENCIES],
    },
    bridge_coins: [...BRIDGE_COINS],
    execution_mode: 'tracked_orchestration',
    tracking: {
      step_level: true,
      endpoint: '/api/acp/executions/{execution_id}',
    },
    live_execution: 'requires_exchange_api_credentials',
    compatible_with: ['locus', 'x402', 'openai-acp'],
    at: new Date().toISOString(),
  }
}

app.post('/api/telegram/webhook', async (c) => {
  console.log('[telegram] webhook POST received')
  const botToken = (c.env.TELEGRAM_BOT_TOKEN ?? '').trim()
  if (!botToken) {
    return c.json({ ok: true, ignored: true, reason: 'TELEGRAM_BOT_TOKEN missing' })
  }

  const secret = (c.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim()
  if (!secret) {
    throw new HTTPException(500, { message: 'TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_BOT_TOKEN is configured' })
  }

  const providedSecret = (c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? '').trim()
  if (!timingSafeEqual(providedSecret, secret)) {
    throw new HTTPException(401, { message: 'Unauthorized webhook token' })
  }

  let body: {
    message?: {
      chat?: { id?: number | string }
      text?: string
    }
  }

  try {
    body = await c.req.json()
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' })
  }

  const chatId = body?.message?.chat?.id
  const text = String(body?.message?.text ?? '').trim()

  if (!chatId || !text) {
    return c.json({ ok: true, ignored: true })
  }

  const helpText = [
    'CrossFin 라우팅 봇 가이드',
    '',
    '추천 입력(자연어):',
    '빗썸에서 바이낸스로 500만원 보내줘',
    '빗썸에서 바이낸스로 리플(XRP)로 보내고 싶어',
    '',
    TELEGRAM_ROUTE_USAGE,
    '',
    '다른 명령어:',
    '/status',
    '/price BTC',
    '/spread BTC',
    '/fees XRP',
    '/help',
    '',
    `지원 거래소: ${ROUTING_EXCHANGES.join(', ')}`,
  ].join('\n')

  if (text.startsWith('/')) {
    const commandRaw = text.split(/\s+/)[0] ?? ''
    const command = commandRaw.split('@')[0]?.toLowerCase() ?? ''
    const stopTyping = startTelegramTypingLoop(botToken, chatId, 4000, (p) => c.executionCtx.waitUntil(p))

    try {
      if (command === '/help' || command === '/start') {
        await telegramSendMessage(botToken, chatId, helpText)
        return c.json({ ok: true, handled: true, mode: 'slash' })
      }

      if (command === '/route') {
        const parsed = parseTelegramRouteCommand(text)
        if (!parsed) {
          await telegramSendMessage(botToken, chatId, helpText)
          return c.json({ ok: true, handled: true, mode: 'slash' })
        }

        const { optimal, alternatives } = await findOptimalRoute(
          parsed.fromExchange,
          parsed.fromCurrency,
          parsed.toExchange,
          parsed.toCurrency,
          parsed.amount,
          parsed.strategy,
          c.env.DB,
        )

        if (!optimal) {
          await telegramSendMessage(
            botToken,
            chatId,
            '유효한 경로를 찾지 못했습니다.\n거래소 조합을 바꾸거나 금액을 낮춰 다시 시도해주세요.',
          )
          return c.json({ ok: true, handled: true, routeFound: false, mode: 'slash' })
        }

        const altCount = alternatives.length
        const summary = optimal.summary
        const outputText = summary?.output ?? `${optimal.estimatedOutput.toLocaleString()} ${parsed.toCurrency}`
        const reply = [
          `Best route: ${optimal.bridgeCoin} (${parsed.strategy})`,
          `${parsed.fromExchange.toUpperCase()}:${parsed.fromCurrency} -> ${parsed.toExchange.toUpperCase()}:${parsed.toCurrency}`,
          `Input: ${parsed.amount.toLocaleString()} ${parsed.fromCurrency}`,
          `Output: ${outputText}`,
          `Total cost: ${optimal.totalCostPct.toFixed(3)}%`,
          `ETA: ${optimal.totalTimeMinutes.toFixed(1)} min`,
          `Indicator: ${optimal.indicator} (${Math.round(optimal.signalStrength * 100)}% signal strength)`,
          `${optimal.reason}`,
          `Alternatives evaluated: ${altCount}`,
        ].join('\n')

        await telegramSendMessage(botToken, chatId, reply)
        return c.json({ ok: true, handled: true, routeFound: true, mode: 'slash' })
      }

      if (command === '/price') {
        const coinArg = parseTelegramCoinArgument(text)
        if (coinArg && !isTrackedPairCoin(coinArg)) {
          await telegramSendMessage(
            botToken,
            chatId,
            `Unsupported coin: ${coinArg}\nSupported: ${trackedPairCoinsCsv()}`,
          )
          return c.json({ ok: true, handled: true, mode: 'slash', error: 'unsupported_coin' })
        }

        const payload = await getRoutePairsPayload(c.env.DB, coinArg)
        const pairsRaw = (payload as { pairs?: unknown }).pairs
        const pairs = Array.isArray(pairsRaw) ? pairsRaw : []
        const top = pairs.slice(0, 8).map((item) => {
          const row = isRecord(item) ? item : {}
          const coin = String(row.coin ?? '')
          const krw = row.bithumbKrw === null || row.bithumbKrw === undefined ? 'n/a' : `${Number(row.bithumbKrw).toLocaleString()} KRW`
          const usd = row.binanceUsd === null || row.binanceUsd === undefined ? 'n/a' : `$${Number(row.binanceUsd).toLocaleString()}`
          return `${coin}: ${krw} | ${usd}`
        })

        const header = coinArg
          ? `Live prices for ${coinArg} (Bithumb KRW | Binance USD):`
          : 'Live prices (Bithumb KRW | Binance USD):'
        const reply = [header, ...(top.length > 0 ? top : ['No data available right now.'])].join('\n')
        await telegramSendMessage(botToken, chatId, reply)
        return c.json({ ok: true, handled: true, mode: 'slash' })
      }

      if (command === '/status') {
        const payload = await getRouteStatusPayload(c.env.DB)
        const exchangesRaw = (payload as { exchanges?: unknown }).exchanges
        const exchanges = Array.isArray(exchangesRaw) ? exchangesRaw : []
        const lines = exchanges.map((item) => {
          const row = isRecord(item) ? item : {}
          const exchange = String(row.exchange ?? 'unknown')
          const status = String(row.status ?? 'offline')
          return `${exchange.toUpperCase()}: ${status}`
        })
        const healthy = Boolean((payload as { healthy?: unknown }).healthy)
        const reply = [`Exchange status (${healthy ? 'healthy' : 'degraded'}):`, ...lines].join('\n')
        await telegramSendMessage(botToken, chatId, reply)
        return c.json({ ok: true, handled: true, mode: 'slash' })
      }

      if (command === '/kimchi' || command === '/spread') {
        const coinArg = parseTelegramCoinArgument(text)
        if (coinArg && !isTrackedPairCoin(coinArg)) {
          await telegramSendMessage(
            botToken,
            chatId,
            `Unsupported coin: ${coinArg}\nSupported: ${trackedPairCoinsCsv()}`,
          )
          return c.json({ ok: true, handled: true, mode: 'slash', error: 'unsupported_coin' })
        }

        const payload = await getArbitrageDemoPayload(c.env.DB)
        const avgPremiumPct = Number((payload as { avgPremiumPct?: unknown }).avgPremiumPct ?? 0)
        const marketCondition = String((payload as { marketCondition?: unknown }).marketCondition ?? 'unknown')
        const previewRaw = (payload as { preview?: unknown }).preview
        const preview = Array.isArray(previewRaw) ? previewRaw : []
        const filtered = coinArg
          ? preview.filter((item) => {
              const row = isRecord(item) ? item : {}
              return String(row.coin ?? '').toUpperCase() === coinArg
            })
          : preview

        if (coinArg && filtered.length === 0) {
          await telegramSendMessage(
            botToken,
            chatId,
            `No free route spread snapshot for ${coinArg} right now.\nTry /price ${coinArg} or paid endpoint /api/premium/arbitrage/kimchi.`,
          )
          return c.json({ ok: true, handled: true, mode: 'slash', coin: coinArg, preview: false })
        }

        const lines = filtered.map((item) => {
          const row = isRecord(item) ? item : {}
          const coin = String(row.coin ?? '')
          const premiumPct = Number(row.premiumPct ?? 0)
          const decision = isRecord(row.decision) ? row.decision : {}
          const indicator = String(decision.indicator ?? 'NEUTRAL')
          return `${coin}: ${premiumPct.toFixed(2)}% (${indicator})`
        })

        const reply = [
          coinArg
            ? `Route spread (demo, ${coinArg}): avg ${avgPremiumPct.toFixed(2)}%`
            : `Route spread (demo): avg ${avgPremiumPct.toFixed(2)}%`,
          `Market condition: ${marketCondition}`,
          ...lines,
        ].join('\n')
        await telegramSendMessage(botToken, chatId, reply)
        return c.json({ ok: true, handled: true, mode: 'slash' })
      }

      if (command === '/fees') {
        const coinArg = parseTelegramCoinArgument(text)
        if (coinArg && !isTrackedPairCoin(coinArg)) {
          await telegramSendMessage(
            botToken,
            chatId,
            `Unsupported coin: ${coinArg}\nSupported: ${trackedPairCoinsCsv()}`,
          )
          return c.json({ ok: true, handled: true, mode: 'slash', error: 'unsupported_coin' })
        }

        const payload = await getRouteFeesPayload(c.env.DB, coinArg ?? null)
        const feesRaw = (payload as { fees?: unknown }).fees
        const fees = Array.isArray(feesRaw) ? feesRaw : []
        const lines = fees.map((item) => {
          const row = isRecord(item) ? item : {}
          const exchange = String(row.exchange ?? 'unknown')
          const tradingFeePct = Number(row.tradingFeePct ?? 0)
          const withdrawalFees = isRecord(row.withdrawalFees) ? row.withdrawalFees : {}

          if (coinArg) {
            const fee = Number(withdrawalFees[coinArg] ?? NaN)
            const feeText = Number.isFinite(fee) ? String(fee) : 'n/a'
            return `${exchange.toUpperCase()}: trade ${tradingFeePct.toFixed(2)}%, withdraw ${coinArg} ${feeText}`
          }

          const xrpFee = Number(withdrawalFees.XRP ?? 0)
          const usdtFee = Number(withdrawalFees.USDT ?? 0)
          return `${exchange.toUpperCase()}: trade ${tradingFeePct.toFixed(2)}%, withdraw XRP ${xrpFee}, USDT ${usdtFee}`
        })
        const reply = [coinArg ? `Exchange fees for ${coinArg}:` : 'Exchange fees (quick view):', ...lines].join('\n')
        await telegramSendMessage(botToken, chatId, reply)
        return c.json({ ok: true, handled: true, mode: 'slash' })
      }

      await telegramSendMessage(botToken, chatId, helpText)
      return c.json({ ok: true, handled: true, mode: 'slash', fallback: 'help' })
    } catch (err) {
      const message = err instanceof HTTPException ? err.message : (err instanceof Error ? err.message : '명령 처리 중 오류가 발생했습니다.')
      const prefix = command === '/route' ? '라우팅 입력 오류' : '명령 처리 오류'
      const suffix = command === '/route'
        ? `\n\n${TELEGRAM_ROUTE_USAGE}`
        : ''
      await telegramSendMessage(botToken, chatId, `${prefix}: ${message}${suffix}`)
      return c.json({ ok: true, handled: true, error: message, mode: 'slash' })
    } finally {
      stopTyping()
    }
  }

  const stopTyping = startTelegramTypingLoop(botToken, chatId, 4000, (p) => c.executionCtx.waitUntil(p))
  try {
    const zaiApiKey = (c.env.ZAI_API_KEY ?? '').trim()
    if (!zaiApiKey) {
      await telegramSendMessage(botToken, chatId, 'AI 모드가 아직 설정되지 않았습니다(ZAI_API_KEY 누락).\n/help 로 명령어 가이드를 확인해주세요.')
      return c.json({ ok: true, handled: true, mode: 'ai', configured: false })
    }

    const chatIdStr = String(chatId)
    const MAX_HISTORY = 10

    const [chatHourlyCountRow, globalDailyCountRow] = await Promise.all([
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM telegram_messages WHERE role = 'user' AND chat_id = ? AND created_at >= datetime('now', '-1 hour')"
      ).bind(chatIdStr).first<{ count: number | string }>(),
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM telegram_messages WHERE role = 'user' AND created_at >= datetime('now', '-1 day')"
      ).first<{ count: number | string }>(),
    ])

    const chatHourlyCount = Number(chatHourlyCountRow?.count ?? 0)
    if (chatHourlyCount >= TELEGRAM_AI_MAX_MESSAGES_PER_CHAT_PER_HOUR) {
      await telegramSendMessage(
        botToken,
        chatId,
        `AI rate limit reached for this chat (${TELEGRAM_AI_MAX_MESSAGES_PER_CHAT_PER_HOUR}/hour). Please try again later or use slash commands like /route and /price.`,
      )
      return c.json({ ok: true, handled: true, mode: 'ai', blocked: 'chat_hourly_quota' })
    }

    const globalDailyCount = Number(globalDailyCountRow?.count ?? 0)
    if (globalDailyCount >= TELEGRAM_AI_MAX_MESSAGES_GLOBAL_PER_DAY) {
      await telegramSendMessage(
        botToken,
        chatId,
        'AI mode is temporarily busy. Please use slash commands for now (/route, /price, /status).',
      )
      return c.json({ ok: true, handled: true, mode: 'ai', blocked: 'global_daily_quota' })
    }

    await c.env.DB.prepare(
      `INSERT INTO telegram_messages (chat_id, role, content) VALUES (?, 'user', ?)`
    ).bind(chatIdStr, text).run()

    const historyRows = await c.env.DB.prepare(
      `SELECT role, content, tool_calls, tool_call_id FROM telegram_messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?`
    ).bind(chatIdStr, MAX_HISTORY).all<{ role: string; content: string | null; tool_calls: string | null; tool_call_id: string | null }>()

    const history: GlmMessage[] = (historyRows.results ?? []).reverse().map((row) => {
      const msg: GlmMessage = { role: row.role, content: row.content ?? undefined }
      if (row.tool_calls) {
        try { msg.tool_calls = JSON.parse(row.tool_calls) as GlmMessage['tool_calls'] } catch {}
      }
      if (row.tool_call_id) msg.tool_call_id = row.tool_call_id
      return msg
    })

    const messages: GlmMessage[] = [
      { role: 'system', content: CROSSFIN_TELEGRAM_SYSTEM_PROMPT },
      ...history,
    ]
    const maxToolLoops = 3
    let finalReply = ''

    try {
      for (let loop = 0; loop < maxToolLoops; loop += 1) {
        const assistantMessage = await glmChatCompletion(zaiApiKey, messages, CROSSFIN_TELEGRAM_TOOLS)
        messages.push({
          role: 'assistant',
          content: assistantMessage.content,
          tool_calls: assistantMessage.tool_calls,
        })

        const toolCalls = assistantMessage.tool_calls ?? []
        if (toolCalls.length === 0) {
          finalReply = (assistantMessage.content ?? '').trim()
          break
        }

        for (const toolCall of toolCalls) {
          if (toolCall.type !== 'function') continue

          let toolArgs: Record<string, unknown> = {}
          const rawArgs = toolCall.function.arguments
          if (rawArgs && rawArgs.trim()) {
            try {
              const parsed = JSON.parse(rawArgs) as unknown
              if (isRecord(parsed)) {
                toolArgs = parsed
              }
            } catch {
              toolArgs = {}
            }
          }

          let toolResult = ''
          try {
            toolResult = await executeTelegramTool(toolCall.function.name, toolArgs, c.env.DB)
          } catch (toolErr) {
            const toolError = toolErr instanceof Error ? toolErr.message : 'tool execution failed'
            toolResult = JSON.stringify({ error: toolError, tool: toolCall.function.name })
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          })
        }
      }

      if (!finalReply) {
        const lastToolMessage = [...messages].reverse().find((msg) => msg.role === 'tool' && typeof msg.content === 'string')
        finalReply = lastToolMessage?.content?.trim() || 'I gathered partial data, but could not complete the response in time. Please try again.'
      }
    } catch (llmErr) {
      const isTimeout = llmErr instanceof Error && llmErr.name === 'AbortError'
      finalReply = isTimeout
        ? '응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요. (Response timed out. Please try again shortly.)'
        : '일시적인 오류가 발생했습니다. 다시 시도해주세요. (A temporary error occurred. Please try again.)'
    }

    await c.env.DB.prepare(
      `INSERT INTO telegram_messages (chat_id, role, content) VALUES (?, 'assistant', ?)`
    ).bind(chatIdStr, finalReply).run()

    const deleteOld = `DELETE FROM telegram_messages WHERE chat_id = ? AND id NOT IN (SELECT id FROM telegram_messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 20)`
    await c.env.DB.prepare(deleteOld).bind(chatIdStr, chatIdStr).run()

    await telegramSendMessage(botToken, chatId, finalReply)
    return c.json({ ok: true, handled: true, mode: 'ai' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process AI request'
    await telegramSendMessage(botToken, chatId, `AI error: ${message}`)
    return c.json({ ok: true, handled: true, error: message, mode: 'ai' })
  } finally {
    stopTyping()
  }
})

// ============================================================
// END ROUTING + ACP (registered before app.route to bypass agentAuth)
// ============================================================

const analyticsRoutes = createAnalyticsRoutes({
  ensureRegistrySeeded,
  ensureEndpointCallsTable,
  toServiceResponse: (row) => applyCrossfinDocs(mapServiceRow(row)),
})

const routingRoutes = createRoutingRoutes({
  findOptimalRoute,
  assertRoutingCurrencySupported,
})

const docsRoutes = createDocsRoutes({
  getGuidePayload,
  getOpenApiPayload,
})

const metaRoutes = createMetaRoutes({
  getPublicStatsPayload,
  getAcpStatusPayload,
})

const registryPublicRoutes = createRegistryPublicRoutes({
  ensureRegistrySeeded,
  toServiceResponse: (row) => applyCrossfinDocs(mapServiceRow(row)),
})

const registryAdminRoutes = createRegistryAdminRoutes({
  requireAdmin,
  ensureRegistrySeeded,
  audit,
})

const cronRoutes = createCronRoutes({
  requireAdmin,
  fetchBithumbAll,
  fetchGlobalPrices,
  fetchKrwRate,
  calcPremiums,
  audit,
})

const guardianRoutes = createGuardianRoutes({
  agentAuth,
  requireGuardianEnabled,
  requireAdmin,
  audit,
})

app.route('/api/admin', adminRoutes)
app.route('/api/mcp', mcpRoutes)
app.route('/api/analytics', analyticsRoutes)
app.route('/api', routingRoutes)
app.route('/', discoveryRoutes)
app.route('/', legalRoutes)
app.route('/', docsRoutes)
app.route('/', metaRoutes)
app.route('/', registryAdminRoutes)
app.route('/', registryPublicRoutes)
app.route('/', onchainRoutes)
app.route('/', cronRoutes)
app.route('/', guardianRoutes)
// --- A2A skill handler injection (avoids self-fetch on CF Workers) ---
app.use('/api/a2a/*', async (c, next) => {
  const db = c.env.DB
  c.set('a2aSkillHandler', async (skill: string | undefined, message: string) => {
    try {
      switch (skill) {
        case 'crypto-routing': {
          const extractP = (text: string, key: string): string | undefined => {
            const regex = new RegExp(`${key}[=:\\s]+([^\\s,]+)`, 'i')
            return text.match(regex)?.[1]
          }
          const fromRaw = extractP(message, 'from') ?? 'bithumb:KRW'
          const toRaw = extractP(message, 'to') ?? 'binance:USDC'
          const amountStr = extractP(message, 'amount') ?? '1000000'
          const strategy = (extractP(message, 'strategy') ?? 'cheapest') as import('./constants').RoutingStrategy
          const [fromEx = 'bithumb', fromCur = 'KRW'] = fromRaw.split(':')
          const [toEx = 'binance', toCur = 'USDC'] = toRaw.split(':')
          const data = await findOptimalRoute(fromEx, fromCur, toEx, toCur, Number(amountStr), strategy, db)
          return { data }
        }
        case 'route-spread': {
          const data = await getArbitrageDemoPayload(db)
          return { data }
        }
        case 'korean-market-data': {
          const data = await getRoutePairsPayload(db)
          return { data }
        }
        case 'agent-finance': {
          return {
            data: {
              protocol: 'acp', version: '1.0', provider: 'crossfin',
              capabilities: ['quote', 'execute', 'execution_status'],
              supported_exchanges: [...ROUTING_EXCHANGES],
              supported_currencies: { source: [...ROUTING_SUPPORTED_CURRENCIES], destination: [...ROUTING_SUPPORTED_CURRENCIES] },
              bridge_coins: [...BRIDGE_COINS],
              execution_mode: 'tracked_orchestration',
              tracking: { step_level: true, endpoint: '/api/acp/executions/{execution_id}' },
              live_execution: 'requires_exchange_api_credentials',
              compatible_with: ['locus', 'x402', 'openai-acp'],
              at: new Date().toISOString(),
            },
          }
        }
        default:
          return { error: `Unknown skill: ${skill ?? '(none)'}. Available skills: crypto-routing, route-spread, korean-market-data, agent-finance` }
      }
    } catch (err) {
      return { error: `Skill dispatch failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  })
  await next()
})
app.route('/api/a2a', a2aRoutes)
app.route('/api/status', statusRoutes)
app.route('/api', api)

// === Guardian Rules Engine ===
// evaluateGuardian and recordSpend are used by the guardian-enabled proxy flow (not yet wired).

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
void evaluateGuardian
void recordSpend

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) {
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
      // 2. Autonomous arbitrage scan — uses same computeAction as the API endpoint
      const tradingFeesPct = BITHUMB_FEES_PCT + BINANCE_FEES_PCT
      const TRADE_SIZE_KRW = 15_000_000
      const [suspensions, ...obAndTrends] = await Promise.all([
        getWithdrawalSuspensions(env.DB),
        ...premiums.slice(0, 10).flatMap((p) => [
          fetchBithumbOrderbook(p.coin).catch(() => ({ bids: [], asks: [] })),
          getPremiumTrend(env.DB, p.coin, 6),
        ]),
      ])
      const guardianSuspensions = suspensions as Record<string, Set<string>>

      for (let idx = 0; idx < Math.min(10, premiums.length); idx++) {
        const p = premiums[idx]!
        const direction = p.premiumPct > 0 ? 'buy-global-sell-korea' : 'buy-korea-sell-global'
        const sourceExchange = direction === 'buy-global-sell-korea' ? 'binance' : 'bithumb'

        // Include withdrawal fee
        const withdrawalFeeCoins = getWithdrawalFee(sourceExchange, p.coin)
        const withdrawalFeePct = p.bithumbKrw > 0 ? (withdrawalFeeCoins * p.bithumbKrw) / TRADE_SIZE_KRW * 100 : 0
        const totalFeesPct = tradingFeesPct + withdrawalFeePct
        const netProfit = Math.abs(p.premiumPct) - totalFeesPct

        // Real orderbook slippage
        const ob = obAndTrends[idx * 2] as { bids: Array<{ price: string; quantity: string }>; asks: Array<{ price: string; quantity: string }> }
        const orderbookSide = direction === 'buy-korea-sell-global'
          ? (ob.asks ?? []).slice(0, 10)
          : (ob.bids ?? []).slice(0, 10)
        const slippage = estimateSlippage(orderbookSide, TRADE_SIZE_KRW)

        const transferTime = getTransferTime(p.coin)
        const trendData = obAndTrends[idx * 2 + 1] as { trend: string; volatilityPct: number }
        const volatility = trendData?.volatilityPct ?? 0
        const riskScore = p.volume24hUsd < 100000 ? 'high' : p.volume24hUsd < 1000000 ? 'medium' : 'low'
        const adjustedVolatility = riskScore === 'high' ? volatility * 1.5 : volatility

        // Withdrawal suspension check
        const withdrawalSuspended = !!(guardianSuspensions[sourceExchange]?.has(p.coin))

        let decision: string
        let confidence: number
        let reason: string
        if (withdrawalSuspended) {
          decision = 'NEGATIVE_SPREAD'
          confidence = 0.1
          reason = `Withdrawals suspended on ${sourceExchange} for ${p.coin}`
        } else {
          const result = computeAction(netProfit, slippage, transferTime, adjustedVolatility)
          decision = result.indicator
          confidence = result.signalStrength
          reason = result.reason
        }

        await env.DB.prepare(
          'INSERT INTO autonomous_actions (id, agent_id, action_type, service_id, decision, confidence, cost_usd, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          crypto.randomUUID(), null, 'ARBITRAGE_SCAN', null, decision, confidence, 0,
          JSON.stringify({
            coin: p.coin, premiumPct: p.premiumPct, netProfit: round2(netProfit),
            slippage: round2(slippage), transferTime, withdrawalSuspended,
            reason,
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

    // 3. Uptime check
    const uptimeUrl = 'https://crossfin.dev/api/health'
    let uptimeStatus: 'up' | 'down' = 'down'
    let httpStatus: number | null = null
    let latencyMs: number | null = null
    let uptimeError: string | null = null

    const startMs = Date.now()
    try {
      const res = await fetch(uptimeUrl, { signal: AbortSignal.timeout(10_000) })
      latencyMs = Date.now() - startMs
      httpStatus = res.status
      if (res.ok) {
        const body = await res.json<{ status?: string }>().catch(() => null)
        uptimeStatus = body?.status === 'ok' ? 'up' : 'down'
        if (uptimeStatus === 'down') uptimeError = `unexpected body: status=${body?.status ?? 'missing'}`
      } else {
        uptimeError = `http_${res.status}`
      }
    } catch (err) {
      latencyMs = Date.now() - startMs
      uptimeError = err instanceof Error ? err.message : String(err)
    }

    await env.DB.prepare(
      'INSERT INTO uptime_checks (id, status, http_status, latency_ms, error, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(crypto.randomUUID(), uptimeStatus, httpStatus, latencyMs, uptimeError).run()

    // Alert on state transitions (up→down or down→up)
    const botToken = (env.TELEGRAM_BOT_TOKEN ?? '').trim()
    const adminChatId = (env.TELEGRAM_ADMIN_CHAT_ID ?? '').trim()
    if (botToken && adminChatId) {
      const prevCheck = await env.DB.prepare(
        'SELECT status FROM uptime_checks ORDER BY created_at DESC LIMIT 1 OFFSET 1'
      ).first<{ status: string }>()
      const prevStatus = prevCheck?.status ?? 'up'

      if (prevStatus !== uptimeStatus) {
        if (uptimeStatus === 'down') {
          await telegramSendMessage(
            botToken,
            adminChatId,
            `🔴 CrossFin API is DOWN\nURL: ${uptimeUrl}\nError: ${uptimeError ?? 'unknown'}\nHTTP: ${httpStatus ?? 'N/A'}\nLatency: ${latencyMs ?? 'N/A'}ms`,
          )
        } else {
          await telegramSendMessage(
            botToken,
            adminChatId,
            `🟢 CrossFin API is back UP\nURL: ${uptimeUrl}\nHTTP: ${httpStatus}\nLatency: ${latencyMs}ms`,
          )
        }
      }
    }
  },
}
