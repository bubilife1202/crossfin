/* ── Shared types, constants, and utilities for the routing sandbox ── */

export type RoutingStrategy = 'cheapest' | 'fastest' | 'balanced'

export type RouteStep = {
  type: 'buy' | 'sell' | 'transfer'
  from: { exchange: string; currency: string }
  to: { exchange: string; currency: string }
  estimatedCost: {
    feePct: number
    feeAbsolute: number
    slippagePct: number
    timeMinutes: number
  }
  amountIn: number
  amountOut: number
}

export type Route = {
  bridgeCoin: string
  steps: RouteStep[]
  totalCostPct: number
  totalTimeMinutes: number
  estimatedInput: number
  estimatedOutput: number
  action: 'EXECUTE' | 'WAIT' | 'SKIP'
  confidence: number
  reason: string
}

export type RouteMeta = {
  routesEvaluated: number
  bridgeCoinsTotal: number
  evaluatedCoins?: string[]
  skippedCoins?: string[]
  priceAge?: {
    globalPrices?: { ageMs: number; source: string; cacheTtlMs: number }
    koreanPrices?: { source: string }
  }
  feesSource?: 'd1' | 'hardcoded-fallback'
  dataFreshness?: 'live' | 'cached' | 'stale'
}

export type RoutingResponse = {
  request: {
    from: string
    to: string
    amount: number
    strategy: RoutingStrategy
  }
  optimal: Route | null
  alternatives: Route[]
  meta: RouteMeta
  at: string
}

/* ── API Response Normalization ── */

/**
 * The free API endpoint (/api/routing/optimal) returns a different shape
 * than what the UI expects. This function normalizes the raw API response:
 *   - indicator (POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD) → action (EXECUTE/WAIT/SKIP)
 *   - signalStrength → confidence
 *   - Synthesizes `meta` from top-level fields when missing
 *   - Defaults `alternatives` to [] when only alternativesCount is present
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRoute(raw: any): Route | null {
  if (!raw || typeof raw !== 'object') return null
  const indicator = String(raw.indicator ?? '')
  const action: Route['action'] =
    indicator === 'POSITIVE_SPREAD' ? 'EXECUTE'
    : indicator === 'NEGATIVE_SPREAD' ? 'SKIP'
    : raw.action === 'EXECUTE' || raw.action === 'WAIT' || raw.action === 'SKIP' ? raw.action
    : 'WAIT'
  return {
    bridgeCoin: String(raw.bridgeCoin ?? ''),
    steps: Array.isArray(raw.steps) ? raw.steps : [],
    totalCostPct: Number(raw.totalCostPct) || 0,
    totalTimeMinutes: Number(raw.totalTimeMinutes) || 0,
    estimatedInput: Number(raw.estimatedInput) || 0,
    estimatedOutput: Number(raw.estimatedOutput) || 0,
    action,
    confidence: Number.isFinite(raw.confidence) ? raw.confidence
      : Number.isFinite(raw.signalStrength) ? raw.signalStrength
      : 0.95,
    reason: String(raw.reason ?? ''),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeApiResponse(raw: any): RoutingResponse {
  const optimal = normalizeRoute(raw.optimal)
  const rawAlts = Array.isArray(raw.alternatives) ? raw.alternatives : []
  const alternatives = (rawAlts as unknown[]).map(normalizeRoute).filter((r): r is Route => r !== null)
  const meta: RouteMeta = raw.meta ?? {
    routesEvaluated: Number(raw.alternativesCount ?? alternatives.length) + (optimal ? 1 : 0),
    bridgeCoinsTotal: 11,
    dataFreshness: raw.dataFreshness ?? 'live',
  }
  return {
    request: raw.request ?? { from: '', to: '', amount: 0, strategy: 'cheapest' as RoutingStrategy },
    optimal,
    alternatives,
    meta,
    at: raw.at ?? new Date().toISOString(),
  }
}

export type RouteScenario = {
  from: string
  to: string
  amount: number
}

/* ── Constants ── */

export const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || 'https://crossfin.dev').replace(/\/$/, '')

export const ROTATE_INTERVAL_MS = 10_000
export const ROTATE_SECONDS = ROTATE_INTERVAL_MS / 1000

export const EXCHANGE_CONFIG: { value: string; label: string; currencies: string[] }[] = [
  { value: 'bithumb', label: 'Bithumb', currencies: ['KRW'] },
  { value: 'upbit', label: 'Upbit', currencies: ['KRW'] },
  { value: 'coinone', label: 'Coinone', currencies: ['KRW'] },
  { value: 'gopax', label: 'GoPax', currencies: ['KRW'] },
  { value: 'bitflyer', label: 'bitFlyer', currencies: ['JPY'] },
  { value: 'wazirx', label: 'WazirX', currencies: ['INR'] },
  { value: 'bitbank', label: 'bitbank', currencies: ['JPY'] },
  { value: 'indodax', label: 'Indodax', currencies: ['IDR'] },
  { value: 'bitkub', label: 'Bitkub', currencies: ['THB'] },
  { value: 'binance', label: 'Binance', currencies: ['USDC', 'USDT'] },
  { value: 'okx', label: 'OKX', currencies: ['USDC', 'USDT'] },
  { value: 'bybit', label: 'Bybit', currencies: ['USDC', 'USDT'] },
  { value: 'kucoin', label: 'KuCoin', currencies: ['USDC', 'USDT'] },
]

export const BRIDGE_COINS = ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'DOT', 'LINK', 'AVAX', 'TRX', 'KAIA'] as const

export const ROTATING_SCENARIOS: readonly RouteScenario[] = [
  { from: 'bithumb:KRW', to: 'binance:USDC', amount: 1_000_000 },
  { from: 'upbit:KRW', to: 'okx:USDC', amount: 1_000_000 },
  { from: 'coinone:KRW', to: 'bybit:USDC', amount: 1_000_000 },
  { from: 'bitflyer:JPY', to: 'binance:USDC', amount: 100_000 },
  { from: 'wazirx:INR', to: 'okx:USDC', amount: 100_000 },
  { from: 'binance:USDC', to: 'bithumb:KRW', amount: 1_000 },
  { from: 'bybit:USDC', to: 'upbit:KRW', amount: 1_000 },
  { from: 'okx:USDC', to: 'wazirx:INR', amount: 1_000 },
  { from: 'bitbank:JPY', to: 'binance:USDC', amount: 100_000 },
  { from: 'indodax:IDR', to: 'okx:USDC', amount: 10_000_000 },
  { from: 'bitkub:THB', to: 'bybit:USDC', amount: 30_000 },
  { from: 'kucoin:USDC', to: 'upbit:KRW', amount: 500 },
]

export const INITIAL_SCENARIO: RouteScenario = ROTATING_SCENARIOS[0] ?? { from: 'bithumb:KRW', to: 'binance:USDC', amount: 1_000_000 }

export const EXCHANGE_LABELS: Record<string, string> = {
  bithumb: 'Bithumb', upbit: 'Upbit', coinone: 'Coinone', gopax: 'GoPax',
  bitflyer: 'bitFlyer', wazirx: 'WazirX', binance: 'Binance', okx: 'OKX',
  bybit: 'Bybit', bitbank: 'bitbank', indodax: 'Indodax', bitkub: 'Bitkub', kucoin: 'KuCoin',
}

/* ── Utilities ── */

export function formatExchange(exchange: string): string {
  return EXCHANGE_LABELS[exchange.trim().toLowerCase()] ?? exchange.trim()
}

export function parseExchange(endpoint: string): string {
  const [exchange] = endpoint.split(':')
  return (exchange ?? '').toLowerCase()
}

export function defaultAmountForExchange(exchange: string): string {
  const cfg = EXCHANGE_CONFIG.find((e) => e.value === exchange)
  const cur = cfg?.currencies[0] ?? 'USDC'
  if (cur === 'KRW') return '1,000,000'
  if (cur === 'JPY' || cur === 'INR') return '100,000'
  if (cur === 'IDR') return '10,000,000'
  if (cur === 'THB') return '30,000'
  return '1,000'
}

export function formatAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (!cleaned) return ''
  const parts = cleaned.split('.')
  const intPart = parseInt(parts[0] ?? '', 10)
  if (isNaN(intPart)) return ''
  const formatted = intPart.toLocaleString('en-US')
  return parts.length > 1 ? `${formatted}.${(parts[1] ?? '').slice(0, 2)}` : formatted
}

export function parseAmountStr(s: string): number {
  return parseFloat(s.replace(/[^0-9.]/g, '')) || 0
}

export function sumStepFees(steps: RouteStep[], type: RouteStep['type']): number {
  return steps
    .filter((s) => s.type === type)
    .reduce((sum, s) => sum + (Number.isFinite(s.estimatedCost.feeAbsolute) ? s.estimatedCost.feeAbsolute : 0), 0)
}

/* ── SWR Cache Layer ── */

type CacheEntry = {
  data: RoutingResponse
  timestamp: number
}

const CACHE_MAX_AGE_MS = 30_000   // serve instantly if < 30s old
const CACHE_STALE_MS  = 120_000   // background-refresh if < 2min, hard-fetch if older

const routeCache = new Map<string, CacheEntry>()

function cacheKey(scenario: RouteScenario, strategy: RoutingStrategy): string {
  return `${scenario.from}|${scenario.to}|${scenario.amount}|${strategy}`
}

/**
 * Get cached response if available.
 * Returns { data, fresh } where fresh=true means no background refresh needed.
 */
export function getCachedRoute(
  scenario: RouteScenario,
  strategy: RoutingStrategy,
): { data: RoutingResponse; fresh: boolean } | null {
  const entry = routeCache.get(cacheKey(scenario, strategy))
  if (!entry) return null
  const age = Date.now() - entry.timestamp
  if (age > CACHE_STALE_MS) return null  // too old, treat as miss
  return { data: entry.data, fresh: age < CACHE_MAX_AGE_MS }
}

/**
 * Fetch route from API and update cache. Returns the response.
 * Throws on failure after retries.
 */
export async function fetchRoute(
  scenario: RouteScenario,
  strategy: RoutingStrategy,
  signal?: AbortSignal,
): Promise<RoutingResponse> {
  const params = new URLSearchParams({
    from: scenario.from,
    to: scenario.to,
    amount: String(scenario.amount),
    strategy,
  })
  const url = `${API_BASE}/api/routing/optimal?${params.toString()}`

  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12_000)
    signal?.addEventListener('abort', () => controller.abort(), { once: true })
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`${res.status}: ${text.slice(0, 120)}`)
      }
      const json = normalizeApiResponse(await res.json())
      routeCache.set(cacheKey(scenario, strategy), {
        data: json,
        timestamp: Date.now(),
      })
      return json
    } catch (e) {
      if (signal?.aborted) throw e
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }
      throw e
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error('Unreachable')
}

/* ── Prefetch Engine ── */

const inflight = new Set<string>()

/**
 * Fire-and-forget: fetch a single scenario into cache.
 * Silently ignores errors. Deduplicates concurrent calls for the same key.
 */
export function prefetchRoute(scenario: RouteScenario, strategy: RoutingStrategy): void {
  const key = cacheKey(scenario, strategy)
  // Skip if already cached (fresh) or already in-flight
  const existing = routeCache.get(key)
  if (existing && (Date.now() - existing.timestamp) < CACHE_MAX_AGE_MS) return
  if (inflight.has(key)) return
  inflight.add(key)
  fetchRoute(scenario, strategy)
    .catch(() => { /* swallow — prefetch is best-effort */ })
    .finally(() => inflight.delete(key))
}

/**
 * Prefetch ALL rotating scenarios with concurrency limit.
 * Starts from `startIndex` (current) and works outward so the next
 * scenarios are fetched first.
 * Call once on auto-mode mount — safe to call multiple times.
 */
export function prefetchAllScenarios(
  startIndex: number,
  strategy: RoutingStrategy = 'cheapest',
  concurrency = 3,
): void {
  // Build ordered list: next scenarios first, then wrap around
  const total = ROTATING_SCENARIOS.length
  const ordered: RouteScenario[] = []
  for (let i = 1; i <= total; i++) {
    ordered.push(ROTATING_SCENARIOS[(startIndex + i) % total]!)
  }

  let running = 0
  let idx = 0

  function next(): void {
    while (running < concurrency && idx < ordered.length) {
      const scenario = ordered[idx++]!
      const key = cacheKey(scenario, strategy)
      const existing = routeCache.get(key)
      // Skip already-cached
      if (existing && (Date.now() - existing.timestamp) < CACHE_MAX_AGE_MS) {
        continue
      }
      if (inflight.has(key)) {
        continue
      }
      running++
      inflight.add(key)
      fetchRoute(scenario, strategy)
        .catch(() => {})
        .finally(() => {
          inflight.delete(key)
          running--
          next()
        })
    }
  }
  next()
}
