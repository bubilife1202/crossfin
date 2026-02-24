import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  CROSSFIN_DISCLAIMER,
  TRACKED_PAIRS,
  EXCHANGE_FEES,
  WITHDRAWAL_FEES,
  ROUTING_EXCHANGES,
  GLOBAL_ROUTING_EXCHANGE_SET,
  KOREAN_ROUTING_EXCHANGE_SET,
  EXCHANGE_DISPLAY_NAME,
  ROUTING_EXCHANGE_COUNTRY,
  BRIDGE_COINS,
} from '../constants'
import type {
  RoutingExchange,
  RoutingStrategy,
} from '../constants'
import {
  getWithdrawalFee,
  getExchangeTradingFees,
  getExchangeWithdrawalFees,
  fetchBithumbAll,
  fetchGlobalPrices,
  fetchKrwRate,
} from '../lib/fetchers'
import { getTransferTime } from '../lib/engine'
import type { Env } from '../types'

type RoutingDeps = {
  findOptimalRoute: (
    fromExchange: string,
    fromCurrency: string,
    toExchange: string,
    toCurrency: string,
    amount: number,
    strategy: RoutingStrategy,
    db: D1Database,
  ) => Promise<{
    optimal: unknown | null
    alternatives: unknown[]
    meta: { dataFreshness?: string }
  }>
  assertRoutingCurrencySupported: (exchange: string, currency: string, label: 'from' | 'to') => void
}

function isGlobalRoutingExchange(exchange: string): boolean {
  return GLOBAL_ROUTING_EXCHANGE_SET.has(exchange.toLowerCase())
}

function isKoreanRoutingExchange(exchange: string): boolean {
  return KOREAN_ROUTING_EXCHANGE_SET.has(exchange.toLowerCase())
}

function isTrackedPairCoin(coin: string): boolean {
  return Object.prototype.hasOwnProperty.call(TRACKED_PAIRS, coin)
}

function trackedPairCoinsCsv(): string {
  return Object.keys(TRACKED_PAIRS).join(', ')
}

export async function getRouteFeesPayload(db: D1Database, coinRaw: string | null | undefined): Promise<Record<string, unknown>> {
  const [tradingFees, withdrawalFees] = await Promise.all([
    getExchangeTradingFees(db),
    getExchangeWithdrawalFees(db),
  ])

  const coin = coinRaw ? coinRaw.toUpperCase() : null

  const fees = ROUTING_EXCHANGES.map((ex) => {
    const withdrawals = coin
      ? { [coin]: getWithdrawalFee(ex, coin, withdrawalFees) }
      : withdrawalFees[ex] ?? WITHDRAWAL_FEES[ex] ?? {}
    return {
      exchange: ex,
      tradingFeePct: tradingFees[ex] ?? EXCHANGE_FEES[ex],
      withdrawalFees: withdrawals,
      transferTimes: coin
        ? { [coin]: getTransferTime(coin) }
        : Object.fromEntries(Object.keys(withdrawals).map((c) => [c, getTransferTime(c)])),
    }
  })

  return { service: 'crossfin-route-fees', coin: coin ?? 'all', fees, _disclaimer: CROSSFIN_DISCLAIMER, at: new Date().toISOString() }
}

export async function getRoutePairsPayload(db: D1Database, coinRaw?: string | null): Promise<Record<string, unknown>> {
  const [bithumbResult, globalResult, krwResult] = await Promise.allSettled([
    fetchBithumbAll(), fetchGlobalPrices(db), fetchKrwRate(),
  ])
  const bithumbAll = bithumbResult.status === 'fulfilled' ? bithumbResult.value : {}
  const globalPrices: Record<string, number> = globalResult.status === 'fulfilled' ? globalResult.value : {}
  const krwRate = krwResult.status === 'fulfilled' ? krwResult.value : 1450

  const coin = coinRaw ? coinRaw.trim().toUpperCase() : ''
  if (coin && !isTrackedPairCoin(coin)) {
    throw new HTTPException(400, {
      message: `Unsupported coin: ${coin}. Supported: ${trackedPairCoinsCsv()}`,
    })
  }

  const pairEntries = coin
    ? ([[coin, TRACKED_PAIRS[coin] as string]] as Array<[string, string]>)
    : Object.entries(TRACKED_PAIRS)

  const pairs = pairEntries.map(([coinName, binanceSymbol]) => {
    const bithumb = bithumbAll[coinName]
    const binancePrice = globalPrices[binanceSymbol]
    return {
      coin: coinName,
      binanceSymbol,
      bithumbKrw: bithumb?.closing_price ? parseFloat(bithumb.closing_price) : null,
      binanceUsd: binancePrice ?? null,
      transferTimeMin: getTransferTime(coinName),
      bridgeSupported: BRIDGE_COINS.includes(coinName as typeof BRIDGE_COINS[number]),
    }
  })

  return {
    service: 'crossfin-route-pairs',
    coin: coin || 'all',
    krwUsdRate: krwRate,
    pairs,
    _disclaimer: CROSSFIN_DISCLAIMER,
    at: new Date().toISOString(),
  }
}

async function checkRouteHttpOk(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    const ok = res.ok
    await res.body?.cancel()
    return ok
  } catch {
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function getRouteStatusPayload(db: D1Database): Promise<Record<string, unknown>> {
  const btcSymbol = TRACKED_PAIRS.BTC ?? 'BTCUSDT'
  const ROUTE_HEALTH_TIMEOUT_MS = 4500

  const globalFeedOnlinePromise = fetchGlobalPrices(db)
    .then((prices) => {
      const btc = prices[btcSymbol]
      return typeof btc === 'number' && Number.isFinite(btc) && btc > 1000
    })
    .catch(() => false)

  const [bithumbOnline, upbitOnline, coinoneOnline, gopaxOnline, bitflyerOnline, wazirxOnline, bitbankOnline, indodaxOnline, bitkubOnline, kucoinOnline, coinbaseOnline, globalFeedOnline] = await Promise.all([
    checkRouteHttpOk('https://api.bithumb.com/public/ticker/BTC_KRW', ROUTE_HEALTH_TIMEOUT_MS),
    checkRouteHttpOk('https://api.upbit.com/v1/ticker?markets=KRW-BTC', ROUTE_HEALTH_TIMEOUT_MS),
    checkRouteHttpOk('https://api.coinone.co.kr/public/v2/ticker_new/KRW/BTC', ROUTE_HEALTH_TIMEOUT_MS),
    checkRouteHttpOk('https://api.gopax.co.kr/trading-pairs/BTC-KRW/ticker', ROUTE_HEALTH_TIMEOUT_MS),
    checkRouteHttpOk('https://api.bitflyer.com/v1/getticker?product_code=BTC_JPY', ROUTE_HEALTH_TIMEOUT_MS),
    checkRouteHttpOk('https://api.wazirx.com/api/v2/tickers', ROUTE_HEALTH_TIMEOUT_MS),
    checkRouteHttpOk('https://public.bitbank.cc/btc_jpy/ticker', ROUTE_HEALTH_TIMEOUT_MS),
    checkRouteHttpOk('https://indodax.com/api/ticker/btcidr', ROUTE_HEALTH_TIMEOUT_MS),
    checkRouteHttpOk('https://api.bitkub.com/api/market/ticker?sym=THB_BTC', ROUTE_HEALTH_TIMEOUT_MS),
    checkRouteHttpOk('https://api.kucoin.com/api/v1/prices?currencies=BTC', ROUTE_HEALTH_TIMEOUT_MS),
    checkRouteHttpOk('https://api.coinbase.com/api/v3/brokerage/market/products?product_ids=BTC-USD&product_type=SPOT', ROUTE_HEALTH_TIMEOUT_MS),
    globalFeedOnlinePromise,
  ])

  const statusByExchange: Record<RoutingExchange, 'online' | 'offline'> = {
    bithumb: bithumbOnline ? 'online' : 'offline',
    upbit: upbitOnline ? 'online' : 'offline',
    coinone: coinoneOnline ? 'online' : 'offline',
    gopax: gopaxOnline ? 'online' : 'offline',
    bitflyer: (bitflyerOnline || globalFeedOnline) ? 'online' : 'offline',
    wazirx: wazirxOnline ? 'online' : 'offline',
    bitbank: bitbankOnline ? 'online' : 'offline',
    indodax: indodaxOnline ? 'online' : 'offline',
    bitkub: bitkubOnline ? 'online' : 'offline',
    binance: globalFeedOnline ? 'online' : 'offline',
    okx: globalFeedOnline ? 'online' : 'offline',
    bybit: globalFeedOnline ? 'online' : 'offline',
    kucoin: (kucoinOnline || globalFeedOnline) ? 'online' : 'offline',
    coinbase: (coinbaseOnline || globalFeedOnline) ? 'online' : 'offline',
  }

  const statuses = ROUTING_EXCHANGES.map((exchange) => ({
    exchange,
    status: statusByExchange[exchange],
  }))

  const allOnline = statuses.every((s) => s.status === 'online')
  return {
    service: 'crossfin-route-status',
    healthy: allOnline,
    exchanges: statuses,
    globalFeed: {
      status: globalFeedOnline ? 'online' : 'offline',
      symbol: btcSymbol,
    },
    _disclaimer: CROSSFIN_DISCLAIMER,
    at: new Date().toISOString(),
  }
}

export function createRoutingRoutes(deps: RoutingDeps): Hono<Env> {
  const routing = new Hono<Env>()

  routing.get('/routing/optimal', async (c) => {
    const fromRaw = c.req.query('from') ?? 'bithumb:KRW'
    const toRaw = c.req.query('to') ?? 'binance:USDC'
    const amountRaw = c.req.query('amount') ?? '1000000'
    const strategyRaw = c.req.query('strategy') ?? 'cheapest'

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
    const fromCur = fromCurrency.toUpperCase()
    const toCur = toCurrency.toUpperCase()
    deps.assertRoutingCurrencySupported(fromEx, fromCur, 'from')
    deps.assertRoutingCurrencySupported(toEx, toCur, 'to')

    const amount = Number(amountRaw)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HTTPException(400, { message: 'amount must be a positive number' })
    }

    const strategy = (['cheapest', 'fastest', 'balanced'].includes(strategyRaw) ? strategyRaw : 'cheapest') as RoutingStrategy

    const routingResult = await deps.findOptimalRoute(fromEx, fromCur, toEx, toCur, amount, strategy, c.env.DB)

    return c.json({
      service: 'crossfin-routing-preview',
      free: true,
      request: { from: `${fromEx}:${fromCur}`, to: `${toEx}:${toCur}`, amount, strategy },
      optimal: routingResult.optimal ?? null,
      alternativesCount: routingResult.alternatives?.length ?? 0,
      dataFreshness: routingResult.meta?.dataFreshness ?? 'unknown',
      _premiumCTA: {
        message: 'This is a free preview. For full route analysis with alternatives, step-by-step details, fee breakdown, and slippage estimates, use the premium endpoint.',
        endpoint: '/api/premium/route/find',
        price: '$0.10 USDC on Base',
      },
      _disclaimer: CROSSFIN_DISCLAIMER,
      at: new Date().toISOString(),
    })
  })

  routing.get('/premium/route/find', async (c) => {
    const fromRaw = c.req.query('from')
    const toRaw = c.req.query('to')
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
    const fromCur = fromCurrency.toUpperCase()
    const toCur = toCurrency.toUpperCase()
    deps.assertRoutingCurrencySupported(fromEx, fromCur, 'from')
    deps.assertRoutingCurrencySupported(toEx, toCur, 'to')

    const amount = Number(amountRaw)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HTTPException(400, { message: 'amount must be a positive number' })
    }

    const strategy = (['cheapest', 'fastest', 'balanced'].includes(strategyRaw) ? strategyRaw : 'cheapest') as RoutingStrategy

    const { optimal, alternatives, meta } = await deps.findOptimalRoute(
      fromEx, fromCur, toEx, toCur, amount, strategy, c.env.DB,
    )

    return c.json({
      paid: true,
      service: 'crossfin-route-finder',
      summary: (optimal as { summary?: unknown } | null)?.summary ?? null,
      request: { from: `${fromEx}:${fromCur}`, to: `${toEx}:${toCur}`, amount, strategy },
      optimal,
      alternatives,
      meta,
      _disclaimer: CROSSFIN_DISCLAIMER,
    })
  })

  routing.get('/route/exchanges', async (c) => {
    const [tradingFees, withdrawalFees] = await Promise.all([
      getExchangeTradingFees(c.env.DB),
      getExchangeWithdrawalFees(c.env.DB),
    ])

    const exchanges = ROUTING_EXCHANGES.map((ex) => ({
      id: ex,
      name: EXCHANGE_DISPLAY_NAME[ex],
      country: ROUTING_EXCHANGE_COUNTRY[ex],
      tradingFeePct: tradingFees[ex] ?? EXCHANGE_FEES[ex],
      supportedCoins: Object.keys(withdrawalFees[ex] ?? WITHDRAWAL_FEES[ex] ?? {}),
      type: isGlobalRoutingExchange(ex) ? 'global' : isKoreanRoutingExchange(ex) ? 'korean' : 'regional',
    }))
    return c.json({ service: 'crossfin-route-exchanges', exchanges, _disclaimer: CROSSFIN_DISCLAIMER, at: new Date().toISOString() })
  })

  routing.get('/route/fees', async (c) => {
    return c.json(await getRouteFeesPayload(c.env.DB, c.req.query('coin')))
  })

  routing.get('/route/pairs', async (c) => {
    return c.json(await getRoutePairsPayload(c.env.DB, c.req.query('coin')))
  })

  routing.get('/route/status', async (c) => {
    return c.json(await getRouteStatusPayload(c.env.DB))
  })

  return routing
}
