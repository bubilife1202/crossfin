import { HTTPException } from 'hono/http-exception'
import { isRecord } from '../types'
import {
  TRACKED_PAIRS,
  EXCHANGE_FEES,
  WITHDRAWAL_FEES,
  FEE_CACHE_TTL_MS,
  BITHUMB_WITHDRAWAL_STATUS_CACHE_TTL_MS,
  GLOBAL_PRICES_SUCCESS_TTL_MS,
  GLOBAL_PRICES_FAILURE_TTL_MS,
} from '../constants'
import type {
  CachedGlobalPrices,
  CachedExchangePriceFeed,
  ExchangePrices,
} from '../constants'

// ============================================================
// Fetch with timeout utility
// ============================================================

export const CROSSFIN_UA = 'CrossFin-API/1.12.1'

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 5000,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = new Headers(init?.headers)
    if (!headers.has('User-Agent')) headers.set('User-Agent', CROSSFIN_UA)
    return await fetch(url, { ...init, signal: controller.signal, headers })
  } finally {
    clearTimeout(timeout)
  }
}

// ============================================================
// Fee helpers
// ============================================================

export function cloneDefaultTradingFees(): Record<string, number> {
  return { ...EXCHANGE_FEES }
}

export function cloneDefaultWithdrawalFees(): Record<string, Record<string, number>> {
  const entries = Object.entries(WITHDRAWAL_FEES).map(([exchange, fees]) => [exchange, { ...fees }])
  return Object.fromEntries(entries)
}

export function getWithdrawalFee(
  exchange: string,
  coin: string,
  withdrawalFees: Record<string, Record<string, number>> = WITHDRAWAL_FEES,
): number {
  return withdrawalFees[exchange.toLowerCase()]?.[coin.toUpperCase()] ?? 0
}

export function invalidateFeeCaches(): void {
  const globalAny = globalThis as unknown as {
    __crossfinTradingFeesCache?: { value: Record<string, number>; expiresAt: number }
    __crossfinTradingFeesInFlight?: Promise<Record<string, number>> | null
    __crossfinWithdrawalFeesCache?: { value: Record<string, Record<string, number>>; expiresAt: number }
    __crossfinWithdrawalFeesInFlight?: Promise<Record<string, Record<string, number>>> | null
    __crossfinWithdrawalSuspensionsCache?: { value: Record<string, Set<string>>; expiresAt: number }
    __crossfinWithdrawalSuspensionsInFlight?: Promise<Record<string, Set<string>>> | null
  }

  globalAny.__crossfinTradingFeesCache = undefined
  globalAny.__crossfinTradingFeesInFlight = null
  globalAny.__crossfinWithdrawalFeesCache = undefined
  globalAny.__crossfinWithdrawalFeesInFlight = null
  globalAny.__crossfinWithdrawalSuspensionsCache = undefined
  globalAny.__crossfinWithdrawalSuspensionsInFlight = null
}

let feeTablesReady: Promise<void> | null = null

export async function ensureFeeTables(db: D1Database): Promise<void> {
  if (!feeTablesReady) {
    feeTablesReady = (async () => {
      await db.batch([
        db.prepare(
          `CREATE TABLE IF NOT EXISTS exchange_trading_fees (
             exchange TEXT NOT NULL,
             fee_pct REAL NOT NULL,
             updated_at TEXT DEFAULT (datetime('now')),
             PRIMARY KEY (exchange)
           )`
        ),
        db.prepare(
          `CREATE TABLE IF NOT EXISTS exchange_withdrawal_fees (
             exchange TEXT NOT NULL,
             coin TEXT NOT NULL,
             fee REAL NOT NULL,
             suspended INTEGER DEFAULT 0,
             updated_at TEXT DEFAULT (datetime('now')),
             PRIMARY KEY (exchange, coin)
           )`
        ),
      ])

      const [tradingCountRow, withdrawalCountRow] = await Promise.all([
        db.prepare('SELECT COUNT(*) AS count FROM exchange_trading_fees').first<{ count: number | string }>(),
        db.prepare('SELECT COUNT(*) AS count FROM exchange_withdrawal_fees').first<{ count: number | string }>(),
      ])

      const tradingCount = Number(tradingCountRow?.count ?? 0)
      const withdrawalCount = Number(withdrawalCountRow?.count ?? 0)

      const stmts: D1PreparedStatement[] = []
      if (tradingCount === 0) {
        for (const [exchange, fee] of Object.entries(EXCHANGE_FEES)) {
          stmts.push(
            db.prepare('INSERT OR IGNORE INTO exchange_trading_fees (exchange, fee_pct) VALUES (?, ?)').bind(exchange, fee),
          )
        }
      }
      if (withdrawalCount === 0) {
        for (const [exchange, coins] of Object.entries(WITHDRAWAL_FEES)) {
          for (const [coin, fee] of Object.entries(coins)) {
            stmts.push(
              db.prepare('INSERT OR IGNORE INTO exchange_withdrawal_fees (exchange, coin, fee) VALUES (?, ?, ?)').bind(exchange, coin, fee),
            )
          }
        }
      }

      if (stmts.length > 0) await db.batch(stmts)
    })().catch((err) => {
      feeTablesReady = null
      throw err
    })
  }

  await feeTablesReady
}

// ============================================================
// Bithumb
// ============================================================

export async function fetchBithumbWithdrawalStatuses(): Promise<Record<string, boolean>> {
  const globalAny = globalThis as unknown as {
    __crossfinBithumbWithdrawalStatusCache?: { value: Record<string, boolean>; expiresAt: number }
    __crossfinBithumbWithdrawalStatusInFlight?: Promise<Record<string, boolean>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinBithumbWithdrawalStatusCache
  if (cached && now < cached.expiresAt) return cached.value
  if (globalAny.__crossfinBithumbWithdrawalStatusInFlight) return globalAny.__crossfinBithumbWithdrawalStatusInFlight

  const fallback = cached?.value ?? {}

  const promise = (async () => {
    try {
      const res = await fetchWithTimeout('https://api.bithumb.com/public/assetsstatus/ALL')
      if (!res.ok) throw new Error(`Bithumb asset status unavailable (${res.status})`)
      const data: unknown = await res.json()
      if (!isRecord(data) || data.status !== '0000' || !isRecord(data.data)) {
        throw new Error('Bithumb asset status invalid response')
      }

      const parsed: Record<string, boolean> = {}
      for (const [coinRaw, row] of Object.entries(data.data)) {
        if (!isRecord(row)) continue
        const coin = coinRaw.trim().toUpperCase()
        if (!coin) continue
        const withdrawalStatusRaw = row.withdrawal_status
        const withdrawalStatus = typeof withdrawalStatusRaw === 'string'
          ? Number(withdrawalStatusRaw)
          : Number(withdrawalStatusRaw)
        parsed[coin] = Number.isFinite(withdrawalStatus) && withdrawalStatus === 1
      }

      globalAny.__crossfinBithumbWithdrawalStatusCache = {
        value: parsed,
        expiresAt: now + BITHUMB_WITHDRAWAL_STATUS_CACHE_TTL_MS,
      }
      return parsed
    } catch {
      globalAny.__crossfinBithumbWithdrawalStatusCache = {
        value: fallback,
        expiresAt: now + BITHUMB_WITHDRAWAL_STATUS_CACHE_TTL_MS,
      }
      return fallback
    } finally {
      globalAny.__crossfinBithumbWithdrawalStatusInFlight = null
    }
  })()

  globalAny.__crossfinBithumbWithdrawalStatusInFlight = promise
  return promise
}

export async function syncBithumbWithdrawalSuspensions(db: D1Database): Promise<boolean> {
  try {
    await ensureFeeTables(db)
    const statuses = await fetchBithumbWithdrawalStatuses()
    const rowsResult = await db.prepare(
      "SELECT coin, suspended FROM exchange_withdrawal_fees WHERE exchange = 'bithumb'"
    ).all<{ coin: string; suspended: number | string }>()

    const updates: D1PreparedStatement[] = []
    for (const row of rowsResult.results ?? []) {
      const coin = row.coin.toUpperCase()
      const enabled = statuses[coin]
      const nextSuspended = enabled ? 0 : 1
      const currentSuspended = Number(row.suspended ?? 0) === 1 ? 1 : 0
      if (currentSuspended === nextSuspended) continue
      updates.push(
        db.prepare(
          "UPDATE exchange_withdrawal_fees SET suspended = ?, updated_at = datetime('now') WHERE exchange = 'bithumb' AND coin = ?"
        ).bind(nextSuspended, coin)
      )
    }

    if (updates.length === 0) return false
    await db.batch(updates)
    return true
  } catch {
    return false
  }
}

export async function getExchangeTradingFees(db: D1Database): Promise<Record<string, number>> {
  const globalAny = globalThis as unknown as {
    __crossfinTradingFeesCache?: { value: Record<string, number>; expiresAt: number }
    __crossfinTradingFeesInFlight?: Promise<Record<string, number>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinTradingFeesCache
  if (cached && now < cached.expiresAt) return cached.value
  if (globalAny.__crossfinTradingFeesInFlight) return globalAny.__crossfinTradingFeesInFlight

  const fallback = cached?.value ?? cloneDefaultTradingFees()

  const promise = (async () => {
    try {
      await ensureFeeTables(db)
      const res = await db.prepare('SELECT exchange, fee_pct FROM exchange_trading_fees').all<{ exchange: string; fee_pct: number | string }>()
      const fees = cloneDefaultTradingFees()
      for (const row of res.results ?? []) {
        const exchange = row.exchange.trim().toLowerCase()
        const fee = Number(row.fee_pct)
        if (!exchange || !Number.isFinite(fee) || fee < 0) continue
        fees[exchange] = fee
      }
      globalAny.__crossfinTradingFeesCache = { value: fees, expiresAt: now + FEE_CACHE_TTL_MS }
      return fees
    } catch {
      globalAny.__crossfinTradingFeesCache = { value: fallback, expiresAt: now + FEE_CACHE_TTL_MS }
      return fallback
    } finally {
      globalAny.__crossfinTradingFeesInFlight = null
    }
  })()

  globalAny.__crossfinTradingFeesInFlight = promise
  return promise
}

export async function getExchangeWithdrawalFees(db: D1Database): Promise<Record<string, Record<string, number>>> {
  const globalAny = globalThis as unknown as {
    __crossfinWithdrawalFeesCache?: { value: Record<string, Record<string, number>>; expiresAt: number }
    __crossfinWithdrawalFeesInFlight?: Promise<Record<string, Record<string, number>>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinWithdrawalFeesCache
  if (cached && now < cached.expiresAt) return cached.value
  if (globalAny.__crossfinWithdrawalFeesInFlight) return globalAny.__crossfinWithdrawalFeesInFlight

  const fallback = cached?.value ?? cloneDefaultWithdrawalFees()

  const promise = (async () => {
    try {
      await ensureFeeTables(db)
      const res = await db.prepare('SELECT exchange, coin, fee FROM exchange_withdrawal_fees').all<{
        exchange: string
        coin: string
        fee: number | string
      }>()

      const fees = cloneDefaultWithdrawalFees()
      for (const row of res.results ?? []) {
        const exchange = row.exchange.trim().toLowerCase()
        const coin = row.coin.trim().toUpperCase()
        const fee = Number(row.fee)
        if (!exchange || !coin || !Number.isFinite(fee) || fee < 0) continue
        if (!fees[exchange]) fees[exchange] = {}
        fees[exchange]![coin] = fee
      }

      globalAny.__crossfinWithdrawalFeesCache = { value: fees, expiresAt: now + FEE_CACHE_TTL_MS }
      return fees
    } catch {
      globalAny.__crossfinWithdrawalFeesCache = { value: fallback, expiresAt: now + FEE_CACHE_TTL_MS }
      return fallback
    } finally {
      globalAny.__crossfinWithdrawalFeesInFlight = null
    }
  })()

  globalAny.__crossfinWithdrawalFeesInFlight = promise
  return promise
}

export async function getWithdrawalSuspensions(db: D1Database): Promise<Record<string, Set<string>>> {
  const globalAny = globalThis as unknown as {
    __crossfinWithdrawalSuspensionsCache?: { value: Record<string, Set<string>>; expiresAt: number }
    __crossfinWithdrawalSuspensionsInFlight?: Promise<Record<string, Set<string>>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinWithdrawalSuspensionsCache
  if (cached && now < cached.expiresAt) {
    const changed = await syncBithumbWithdrawalSuspensions(db)
    if (!changed) return cached.value
  }
  if (globalAny.__crossfinWithdrawalSuspensionsInFlight) return globalAny.__crossfinWithdrawalSuspensionsInFlight

  const fallback = cached?.value ?? {}

  const promise = (async () => {
    try {
      await ensureFeeTables(db)
      await syncBithumbWithdrawalSuspensions(db)
      const res = await db.prepare('SELECT exchange, coin FROM exchange_withdrawal_fees WHERE suspended = 1').all<{
        exchange: string
        coin: string
      }>()

      const byExchange: Record<string, Set<string>> = {}
      for (const row of res.results ?? []) {
        const exchange = row.exchange.trim().toLowerCase()
        const coin = row.coin.trim().toUpperCase()
        if (!exchange || !coin) continue
        if (!byExchange[exchange]) byExchange[exchange] = new Set<string>()
        byExchange[exchange]!.add(coin)
      }

      globalAny.__crossfinWithdrawalSuspensionsCache = { value: byExchange, expiresAt: now + FEE_CACHE_TTL_MS }
      return byExchange
    } catch {
      globalAny.__crossfinWithdrawalSuspensionsCache = { value: fallback, expiresAt: now + FEE_CACHE_TTL_MS }
      return fallback
    } finally {
      globalAny.__crossfinWithdrawalSuspensionsInFlight = null
    }
  })()

  globalAny.__crossfinWithdrawalSuspensionsInFlight = promise
  return promise
}

export async function fetchBithumbAll(): Promise<Record<string, Record<string, string>>> {
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
      const res = await fetchWithTimeout('https://api.bithumb.com/public/ticker/ALL_KRW')
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

export async function fetchBithumbOrderbook(pair: string): Promise<{ bids: unknown[]; asks: unknown[] }> {
  const res = await fetchWithTimeout(`https://api.bithumb.com/public/orderbook/${pair}_KRW`)
  const raw: unknown = await res.json()
  if (!isRecord(raw)) throw new HTTPException(502, { message: 'Bithumb orderbook: invalid response' })
  if (raw.status !== '0000') throw new HTTPException(400, { message: `Invalid pair: ${pair}` })
  const data = raw.data
  if (!isRecord(data)) throw new HTTPException(502, { message: 'Bithumb orderbook: missing data' })
  const bids = Array.isArray(data.bids) ? data.bids : []
  const asks = Array.isArray(data.asks) ? data.asks : []
  return { bids, asks }
}

// ============================================================
// Global price feeds
// ============================================================

export async function fetchBinancePrices(): Promise<Record<string, number>> {
  const globalAny = globalThis as unknown as {
    __crossfinBinancePricesCache?: CachedExchangePriceFeed
    __crossfinBinancePricesInFlight?: Promise<Record<string, number>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinBinancePricesCache
  if (cached && now < cached.expiresAt && Object.keys(cached.value).length > 0) return cached.value
  if (globalAny.__crossfinBinancePricesInFlight) return globalAny.__crossfinBinancePricesInFlight

  const fallback = cached?.value ?? {}
  const symbols = Array.from(new Set(Object.values(TRACKED_PAIRS)))
  const query = encodeURIComponent(JSON.stringify(symbols))
  const BINANCE_BASE_URLS = [
    'https://data-api.binance.vision',
    'https://api.binance.com',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com',
  ]

  const promise = (async () => {
    for (const baseUrl of BINANCE_BASE_URLS) {
      try {
        const url = `${baseUrl}/api/v3/ticker/price?symbols=${query}`
        const res = await fetchWithTimeout(url)
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

        const btcSymbol = TRACKED_PAIRS.BTC
        const btc = btcSymbol ? prices[btcSymbol] : undefined
        if (typeof btc === 'number' && Number.isFinite(btc) && btc > 1000) {
          const hostname = new URL(baseUrl).hostname
          globalAny.__crossfinBinancePricesCache = {
            value: prices,
            expiresAt: now + GLOBAL_PRICES_SUCCESS_TTL_MS,
            source: `binance:${hostname}`,
          }
          return prices
        }
      } catch {
        // Try next base URL
      }
    }

    globalAny.__crossfinBinancePricesCache = {
      value: fallback,
      expiresAt: now + GLOBAL_PRICES_FAILURE_TTL_MS,
      source: cached?.source ?? 'binance:cached',
    }
    if (Object.keys(fallback).length > 0) return fallback
    throw new Error('Binance price feed unavailable')
  })()

  globalAny.__crossfinBinancePricesInFlight = promise
  return promise.finally(() => {
    globalAny.__crossfinBinancePricesInFlight = null
  })
}

export async function fetchOkxPrices(): Promise<Record<string, number>> {
  const globalAny = globalThis as unknown as {
    __crossfinOkxPricesCache?: CachedExchangePriceFeed
    __crossfinOkxPricesInFlight?: Promise<Record<string, number>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinOkxPricesCache
  if (cached && now < cached.expiresAt && Object.keys(cached.value).length > 0) return cached.value
  if (globalAny.__crossfinOkxPricesInFlight) return globalAny.__crossfinOkxPricesInFlight

  const fallback = cached?.value ?? {}
  const trackedSymbols = new Set(Object.values(TRACKED_PAIRS))

  const promise = (async () => {
    try {
      const res = await fetchWithTimeout('https://www.okx.com/api/v5/market/tickers?instType=SPOT')
      if (!res.ok) throw new Error(`OKX price feed unavailable (${res.status})`)
      const data: unknown = await res.json()
      if (!isRecord(data) || data.code !== '0' || !Array.isArray(data.data)) {
        throw new Error('OKX price feed invalid response')
      }

      const prices: Record<string, number> = {}
      for (const row of data.data) {
        if (!isRecord(row)) continue
        const instId = typeof row.instId === 'string' ? row.instId.trim().toUpperCase() : ''
        const lastRaw = typeof row.last === 'string' ? row.last.trim() : ''
        if (!instId.endsWith('-USDT')) continue
        const symbol = instId.replace('-', '')
        if (!trackedSymbols.has(symbol)) continue
        const price = Number(lastRaw)
        if (!Number.isFinite(price) || price <= 0) continue
        prices[symbol] = price
      }

      const btcSymbol = TRACKED_PAIRS.BTC
      const btc = btcSymbol ? prices[btcSymbol] : undefined
      if (typeof btc !== 'number' || !Number.isFinite(btc) || btc <= 1000) {
        throw new Error('OKX price feed returned no valid BTCUSDT')
      }

      globalAny.__crossfinOkxPricesCache = {
        value: prices,
        expiresAt: now + GLOBAL_PRICES_SUCCESS_TTL_MS,
        source: 'okx',
      }
      return prices
    } catch {
      globalAny.__crossfinOkxPricesCache = {
        value: fallback,
        expiresAt: now + GLOBAL_PRICES_FAILURE_TTL_MS,
        source: cached?.source ?? 'okx:cached',
      }
      if (Object.keys(fallback).length > 0) return fallback
      throw new Error('OKX price feed unavailable')
    }
  })()

  globalAny.__crossfinOkxPricesInFlight = promise
  return promise.finally(() => {
    globalAny.__crossfinOkxPricesInFlight = null
  })
}

export async function fetchBybitPrices(): Promise<Record<string, number>> {
  const globalAny = globalThis as unknown as {
    __crossfinBybitPricesCache?: CachedExchangePriceFeed
    __crossfinBybitPricesInFlight?: Promise<Record<string, number>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinBybitPricesCache
  if (cached && now < cached.expiresAt && Object.keys(cached.value).length > 0) return cached.value
  if (globalAny.__crossfinBybitPricesInFlight) return globalAny.__crossfinBybitPricesInFlight

  const fallback = cached?.value ?? {}
  const trackedSymbols = new Set(Object.values(TRACKED_PAIRS))

  const promise = (async () => {
    try {
      const res = await fetchWithTimeout('https://api.bybit.com/v5/market/tickers?category=spot')
      if (!res.ok) throw new Error(`Bybit price feed unavailable (${res.status})`)
      const data: unknown = await res.json()
      if (!isRecord(data) || data.retCode !== 0 || !isRecord(data.result) || !Array.isArray(data.result.list)) {
        throw new Error('Bybit price feed invalid response')
      }

      const prices: Record<string, number> = {}
      for (const row of data.result.list) {
        if (!isRecord(row)) continue
        const symbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : ''
        const lastPriceRaw = typeof row.lastPrice === 'string' ? row.lastPrice.trim() : ''
        if (!trackedSymbols.has(symbol)) continue
        const price = Number(lastPriceRaw)
        if (!Number.isFinite(price) || price <= 0) continue
        prices[symbol] = price
      }

      const btcSymbol = TRACKED_PAIRS.BTC
      const btc = btcSymbol ? prices[btcSymbol] : undefined
      if (typeof btc !== 'number' || !Number.isFinite(btc) || btc <= 1000) {
        throw new Error('Bybit price feed returned no valid BTCUSDT')
      }

      globalAny.__crossfinBybitPricesCache = {
        value: prices,
        expiresAt: now + GLOBAL_PRICES_SUCCESS_TTL_MS,
        source: 'bybit',
      }
      return prices
    } catch {
      globalAny.__crossfinBybitPricesCache = {
        value: fallback,
        expiresAt: now + GLOBAL_PRICES_FAILURE_TTL_MS,
        source: cached?.source ?? 'bybit:cached',
      }
      if (Object.keys(fallback).length > 0) return fallback
      throw new Error('Bybit price feed unavailable')
    }
  })()

  globalAny.__crossfinBybitPricesInFlight = promise
  return promise.finally(() => {
    globalAny.__crossfinBybitPricesInFlight = null
  })
}

export function getExchangePrice(exchange: string, symbol: string): number | undefined {
  const ex = exchange.trim().toLowerCase()
  const sym = symbol.trim().toUpperCase()
  if (!ex || !sym) return undefined
  const globalAny = globalThis as unknown as {
    __crossfinExchangePricesCache?: ExchangePrices
    __crossfinExchangePrices?: ExchangePrices
  }
  const cache = globalAny.__crossfinExchangePricesCache ?? globalAny.__crossfinExchangePrices
  const price = cache?.[ex]?.[sym]
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : undefined
}

export async function fetchGlobalPrices(db?: D1Database): Promise<Record<string, number>> {
  const globalAny = globalThis as unknown as {
    __crossfinGlobalPricesCache?: CachedGlobalPrices
    __crossfinGlobalPricesInFlight?: Promise<Record<string, number>> | null
    __crossfinExchangePricesCache?: ExchangePrices
    __crossfinExchangePrices?: ExchangePrices
  }

  const now = Date.now()
  const cached = globalAny.__crossfinGlobalPricesCache
  if (cached && now < cached.expiresAt && Object.keys(cached.value).length > 0) return cached.value
  if (globalAny.__crossfinGlobalPricesInFlight) return globalAny.__crossfinGlobalPricesInFlight

  const fallback = cached?.value ?? {}

  const promise = (async () => {
    const isValidPrices = (prices: Record<string, number>): boolean => {
      const btcSymbol = TRACKED_PAIRS.BTC
      if (!btcSymbol) return false
      const btc = prices[btcSymbol]
      if (typeof btc !== 'number' || !Number.isFinite(btc) || btc <= 1000) return false
      return Object.keys(prices).length >= 1
    }

    const [binanceSet, okxSet, bybitSet] = await Promise.allSettled([
      fetchBinancePrices(),
      fetchOkxPrices(),
      fetchBybitPrices(),
    ])

    const exchangePrices: ExchangePrices = {
      binance: binanceSet.status === 'fulfilled' ? binanceSet.value : {},
      okx: okxSet.status === 'fulfilled' ? okxSet.value : {},
      bybit: bybitSet.status === 'fulfilled' ? bybitSet.value : {},
    }

    const mergedPrices: Record<string, number> = {
      ...exchangePrices.binance,
    }
    const okxPrices: Record<string, number> = exchangePrices.okx ?? {}
    const bybitPrices: Record<string, number> = exchangePrices.bybit ?? {}
    for (const [symbol, price] of Object.entries(okxPrices)) {
      if (!(symbol in mergedPrices)) mergedPrices[symbol] = price
    }
    for (const [symbol, price] of Object.entries(bybitPrices)) {
      if (!(symbol in mergedPrices)) mergedPrices[symbol] = price
    }

    if (isValidPrices(mergedPrices)) {
      const sourceParts: string[] = []
      if (binanceSet.status === 'fulfilled') sourceParts.push('binance')
      if (okxSet.status === 'fulfilled') sourceParts.push('okx')
      if (bybitSet.status === 'fulfilled') sourceParts.push('bybit')
      const source = sourceParts.length > 0 ? sourceParts.join('+') : 'global'

      globalAny.__crossfinExchangePricesCache = exchangePrices
      globalAny.__crossfinExchangePrices = exchangePrices
      globalAny.__crossfinGlobalPricesCache = {
        value: mergedPrices,
        expiresAt: now + GLOBAL_PRICES_SUCCESS_TTL_MS,
        source,
      }
      return mergedPrices
    }

    // 2) CryptoCompare fallback (no key)
    try {
      const coins = Object.keys(TRACKED_PAIRS).join(',')
      const res = await fetchWithTimeout(
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
      const res = await fetchWithTimeout(url)
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

    // 4) D1 snapshot fallback
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
          const res = await fetchWithTimeout(`${baseUrl}/api/v3/ticker/price?symbol=${symbol}`)
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

export type GlobalPricesMeta = {
  prices: Record<string, number>
  source: string
  ageMs: number
  warnings: string[]
}

export async function fetchGlobalPricesWithMeta(db?: D1Database): Promise<GlobalPricesMeta> {
  const globalAny = globalThis as unknown as {
    __crossfinGlobalPricesCache?: CachedGlobalPrices
  }
  const prices = await fetchGlobalPrices(db)
  const cached = globalAny.__crossfinGlobalPricesCache
  const source = cached?.source ?? 'unknown'
  const ageMs = cached ? Date.now() - (cached.expiresAt - GLOBAL_PRICES_SUCCESS_TTL_MS) : 0
  const warnings: string[] = []
  if (source === 'd1-snapshot') {
    warnings.push('Price data is from D1 snapshot, not real-time. Data may be up to 7 days old.')
  } else if (source === 'coingecko' || source === 'cryptocompare') {
    warnings.push(`Price data from ${source} fallback. Primary exchange APIs may be unavailable.`)
  }
  if (ageMs > 30000) {
    warnings.push(`Price data may be delayed (age: ${Math.round(ageMs / 1000)}s).`)
  }
  return { prices, source, ageMs, warnings }
}

// ============================================================
// FX Rates
// ============================================================

export async function fetchUsdFxRates(): Promise<Record<'KRW' | 'JPY' | 'INR' | 'IDR' | 'THB', number>> {
  const FX_RATE_SUCCESS_TTL_MS = 5 * 60_000
  const FX_RATE_FAILURE_TTL_MS = 60_000

  type CachedRates = { value: Record<'KRW' | 'JPY' | 'INR' | 'IDR' | 'THB', number>; expiresAt: number }
  const globalAny = globalThis as unknown as {
    __crossfinUsdFxRatesCache?: CachedRates
    __crossfinUsdFxRatesInFlight?: Promise<Record<'KRW' | 'JPY' | 'INR' | 'IDR' | 'THB', number>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinUsdFxRatesCache
  if (cached && now < cached.expiresAt) return cached.value
  if (globalAny.__crossfinUsdFxRatesInFlight) return globalAny.__crossfinUsdFxRatesInFlight

  const fallback = cached?.value ?? { KRW: 1450, JPY: 150, INR: 85, IDR: 16200, THB: 36 }
  const promise = (async () => {
    try {
      const res = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD')
      if (!res.ok) throw new Error(`FX rate fetch failed (${res.status})`)
      const data = await res.json() as { rates?: Record<string, number> }

      const krw = Number(data.rates?.KRW)
      const jpy = Number(data.rates?.JPY)
      const inr = Number(data.rates?.INR)
      const idr = Number(data.rates?.IDR)
      const thb = Number(data.rates?.THB)
      if (!Number.isFinite(krw) || krw < 500 || krw > 5000) throw new Error('Invalid KRW FX rate')
      if (!Number.isFinite(jpy) || jpy < 50 || jpy > 300) throw new Error('Invalid JPY FX rate')
      if (!Number.isFinite(inr) || inr < 20 || inr > 200) throw new Error('Invalid INR FX rate')
      if (!Number.isFinite(idr) || idr < 10000 || idr > 25000) throw new Error('Invalid IDR FX rate')
      if (!Number.isFinite(thb) || thb < 20 || thb > 50) throw new Error('Invalid THB FX rate')

      const rates = { KRW: krw, JPY: jpy, INR: inr, IDR: idr, THB: thb }
      globalAny.__crossfinUsdFxRatesCache = { value: rates, expiresAt: now + FX_RATE_SUCCESS_TTL_MS }
      return rates
    } catch {
      globalAny.__crossfinUsdFxRatesCache = { value: fallback, expiresAt: now + FX_RATE_FAILURE_TTL_MS }
      return fallback
    } finally {
      globalAny.__crossfinUsdFxRatesInFlight = null
    }
  })()

  globalAny.__crossfinUsdFxRatesInFlight = promise
  return promise
}

export async function fetchKrwRate(): Promise<number> {
  const rates = await fetchUsdFxRates()
  return rates.KRW
}

export type FxRatesMeta = {
  rates: Record<'KRW' | 'JPY' | 'INR' | 'IDR' | 'THB', number>
  isFallback: boolean
  source: string
  warnings: string[]
}

export async function fetchFxRatesWithMeta(): Promise<FxRatesMeta> {
  const globalAny = globalThis as unknown as {
    __crossfinUsdFxRatesCache?: { value: Record<'KRW' | 'JPY' | 'INR' | 'IDR' | 'THB', number>; expiresAt: number }
  }
  const rates = await fetchUsdFxRates()
  const cached = globalAny.__crossfinUsdFxRatesCache
  // Detect if using hardcoded fallback by checking if values exactly match defaults
  const isHardcodedFallback = rates.KRW === 1450 && rates.JPY === 150 && rates.INR === 85 && rates.IDR === 16200 && rates.THB === 36
  const isFallback = isHardcodedFallback || !cached || Date.now() >= cached.expiresAt
  const warnings: string[] = []
  if (isHardcodedFallback) {
    warnings.push('Exchange rate is using hardcoded fallback value. Actual rate may differ significantly.')
  }
  return { rates, isFallback, source: isFallback ? 'fallback' : 'open.er-api.com', warnings }
}

// ============================================================
// Korean exchange tickers
// ============================================================

export async function fetchUpbitTicker(market: string) {
  const res = await fetchWithTimeout(`https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(market)}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Upbit API unavailable' })
  const data: unknown = await res.json()
  if (!Array.isArray(data) || data.length === 0 || !isRecord(data[0])) {
    throw new HTTPException(502, { message: 'Upbit API invalid response' })
  }
  return data[0]
}

export async function fetchUpbitOrderbook(market: string) {
  const res = await fetchWithTimeout(`https://api.upbit.com/v1/orderbook?markets=${encodeURIComponent(market)}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Upbit API unavailable' })
  const data: unknown = await res.json()
  if (!Array.isArray(data) || data.length === 0 || !isRecord(data[0])) {
    throw new HTTPException(502, { message: 'Upbit API invalid response' })
  }
  return data[0]
}

export async function fetchCoinoneTicker(currency: string) {
  const res = await fetchWithTimeout(`https://api.coinone.co.kr/public/v2/ticker_new/KRW/${encodeURIComponent(currency)}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Coinone API unavailable' })
  const data: unknown = await res.json()
  if (!isRecord(data) || data.result !== 'success' || !Array.isArray(data.tickers) || data.tickers.length === 0) {
    throw new HTTPException(502, { message: 'Coinone API invalid response' })
  }
  const first = data.tickers[0]
  if (!isRecord(first)) throw new HTTPException(502, { message: 'Coinone API invalid response' })
  return first
}

export async function fetchWazirxTickers(): Promise<Record<string, Record<string, unknown>>> {
  const WAZIRX_TICKERS_SUCCESS_TTL_MS = 10_000
  const WAZIRX_TICKERS_FAILURE_TTL_MS = 3_000

  type CachedWazirxTickers = { value: Record<string, Record<string, unknown>>; expiresAt: number }
  const globalAny = globalThis as unknown as {
    __crossfinWazirxTickersCache?: CachedWazirxTickers
    __crossfinWazirxTickersInFlight?: Promise<Record<string, Record<string, unknown>>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinWazirxTickersCache
  if (cached && now < cached.expiresAt && Object.keys(cached.value).length > 0) return cached.value
  if (globalAny.__crossfinWazirxTickersInFlight) return globalAny.__crossfinWazirxTickersInFlight

  const fallback = cached?.value ?? {}
  const promise = (async () => {
    try {
      const res = await fetchWithTimeout('https://api.wazirx.com/api/v2/tickers')
      if (!res.ok) throw new Error(`WazirX ticker feed unavailable (${res.status})`)
      const data: unknown = await res.json()
      if (!isRecord(data)) throw new Error('WazirX ticker feed invalid response')

      const parsed: Record<string, Record<string, unknown>> = {}
      for (const [market, row] of Object.entries(data)) {
        if (!isRecord(row)) continue
        parsed[market.trim().toLowerCase()] = row
      }
      if (Object.keys(parsed).length === 0) throw new Error('WazirX ticker feed empty')

      globalAny.__crossfinWazirxTickersCache = { value: parsed, expiresAt: now + WAZIRX_TICKERS_SUCCESS_TTL_MS }
      return parsed
    } catch {
      globalAny.__crossfinWazirxTickersCache = { value: fallback, expiresAt: now + WAZIRX_TICKERS_FAILURE_TTL_MS }
      if (Object.keys(fallback).length > 0) return fallback
      throw new Error('WazirX ticker feed unavailable')
    } finally {
      globalAny.__crossfinWazirxTickersInFlight = null
    }
  })()

  globalAny.__crossfinWazirxTickersInFlight = promise
  return promise
}

export async function fetchBitbankTickers(): Promise<Record<string, Record<string, unknown>>> {
  const BITBANK_TICKERS_SUCCESS_TTL_MS = 10_000
  const BITBANK_TICKERS_FAILURE_TTL_MS = 3_000

  type CachedBitbankTickers = { value: Record<string, Record<string, unknown>>; expiresAt: number }
  const globalAny = globalThis as unknown as {
    __crossfinBitbankTickersCache?: CachedBitbankTickers
    __crossfinBitbankTickersInFlight?: Promise<Record<string, Record<string, unknown>>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinBitbankTickersCache
  if (cached && now < cached.expiresAt && Object.keys(cached.value).length > 0) return cached.value
  if (globalAny.__crossfinBitbankTickersInFlight) return globalAny.__crossfinBitbankTickersInFlight

  const fallback = cached?.value ?? {}
  const promise = (async () => {
    try {
      const res = await fetchWithTimeout('https://public.bitbank.cc/tickers_jpy')
      if (!res.ok) throw new Error(`bitbank ticker feed unavailable (${res.status})`)
      const data: unknown = await res.json()
      if (!isRecord(data) || !Array.isArray(data.data)) throw new Error('bitbank ticker feed invalid response')

      const parsed: Record<string, Record<string, unknown>> = {}
      for (const row of data.data) {
        if (!isRecord(row)) continue
        const pair = String(row.pair ?? '').trim().toLowerCase()
        if (!pair.endsWith('_jpy')) continue
        const coin = pair.split('_')[0]?.trim().toUpperCase()
        if (!coin) continue
        parsed[coin] = row
      }
      if (Object.keys(parsed).length === 0) throw new Error('bitbank ticker feed empty')

      globalAny.__crossfinBitbankTickersCache = { value: parsed, expiresAt: now + BITBANK_TICKERS_SUCCESS_TTL_MS }
      return parsed
    } catch {
      globalAny.__crossfinBitbankTickersCache = { value: fallback, expiresAt: now + BITBANK_TICKERS_FAILURE_TTL_MS }
      if (Object.keys(fallback).length > 0) return fallback
      throw new Error('bitbank ticker feed unavailable')
    } finally {
      globalAny.__crossfinBitbankTickersInFlight = null
    }
  })()

  globalAny.__crossfinBitbankTickersInFlight = promise
  return promise
}

export async function fetchIndodaxTickers(): Promise<Record<string, Record<string, unknown>>> {
  const INDODAX_TICKERS_SUCCESS_TTL_MS = 10_000
  const INDODAX_TICKERS_FAILURE_TTL_MS = 3_000

  type CachedIndodaxTickers = { value: Record<string, Record<string, unknown>>; expiresAt: number }
  const globalAny = globalThis as unknown as {
    __crossfinIndodaxTickersCache?: CachedIndodaxTickers
    __crossfinIndodaxTickersInFlight?: Promise<Record<string, Record<string, unknown>>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinIndodaxTickersCache
  if (cached && now < cached.expiresAt && Object.keys(cached.value).length > 0) return cached.value
  if (globalAny.__crossfinIndodaxTickersInFlight) return globalAny.__crossfinIndodaxTickersInFlight

  const fallback = cached?.value ?? {}
  const promise = (async () => {
    try {
      const res = await fetchWithTimeout('https://indodax.com/api/summaries')
      if (!res.ok) throw new Error(`Indodax ticker feed unavailable (${res.status})`)
      const data: unknown = await res.json()
      if (!isRecord(data) || !isRecord(data.tickers)) throw new Error('Indodax ticker feed invalid response')

      const parsed: Record<string, Record<string, unknown>> = {}
      for (const [pair, row] of Object.entries(data.tickers)) {
        if (!isRecord(row)) continue
        const normalized = pair.trim().toLowerCase()
        if (!normalized.endsWith('_idr')) continue
        const coin = normalized.split('_')[0]?.trim().toUpperCase()
        if (!coin) continue
        parsed[coin] = row
      }
      if (Object.keys(parsed).length === 0) throw new Error('Indodax ticker feed empty')

      globalAny.__crossfinIndodaxTickersCache = { value: parsed, expiresAt: now + INDODAX_TICKERS_SUCCESS_TTL_MS }
      return parsed
    } catch {
      globalAny.__crossfinIndodaxTickersCache = { value: fallback, expiresAt: now + INDODAX_TICKERS_FAILURE_TTL_MS }
      if (Object.keys(fallback).length > 0) return fallback
      throw new Error('Indodax ticker feed unavailable')
    } finally {
      globalAny.__crossfinIndodaxTickersInFlight = null
    }
  })()

  globalAny.__crossfinIndodaxTickersInFlight = promise
  return promise
}

export async function fetchBitkubTickers(): Promise<Record<string, Record<string, unknown>>> {
  const BITKUB_TICKERS_SUCCESS_TTL_MS = 10_000
  const BITKUB_TICKERS_FAILURE_TTL_MS = 3_000

  type CachedBitkubTickers = { value: Record<string, Record<string, unknown>>; expiresAt: number }
  const globalAny = globalThis as unknown as {
    __crossfinBitkubTickersCache?: CachedBitkubTickers
    __crossfinBitkubTickersInFlight?: Promise<Record<string, Record<string, unknown>>> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinBitkubTickersCache
  if (cached && now < cached.expiresAt && Object.keys(cached.value).length > 0) return cached.value
  if (globalAny.__crossfinBitkubTickersInFlight) return globalAny.__crossfinBitkubTickersInFlight

  const fallback = cached?.value ?? {}
  const promise = (async () => {
    try {
      const res = await fetchWithTimeout('https://api.bitkub.com/api/market/ticker')
      if (!res.ok) throw new Error(`Bitkub ticker feed unavailable (${res.status})`)
      const data: unknown = await res.json()
      if (!isRecord(data)) throw new Error('Bitkub ticker feed invalid response')

      const parsed: Record<string, Record<string, unknown>> = {}
      for (const [pair, row] of Object.entries(data)) {
        if (!isRecord(row)) continue
        const normalized = pair.trim().toUpperCase()
        if (!normalized.startsWith('THB_')) continue
        const coin = normalized.split('_')[1]?.trim().toUpperCase()
        if (!coin) continue
        parsed[coin] = row
      }
      if (Object.keys(parsed).length === 0) throw new Error('Bitkub ticker feed empty')

      globalAny.__crossfinBitkubTickersCache = { value: parsed, expiresAt: now + BITKUB_TICKERS_SUCCESS_TTL_MS }
      return parsed
    } catch {
      globalAny.__crossfinBitkubTickersCache = { value: fallback, expiresAt: now + BITKUB_TICKERS_FAILURE_TTL_MS }
      if (Object.keys(fallback).length > 0) return fallback
      throw new Error('Bitkub ticker feed unavailable')
    } finally {
      globalAny.__crossfinBitkubTickersInFlight = null
    }
  })()

  globalAny.__crossfinBitkubTickersInFlight = promise
  return promise
}

// ============================================================
// calcPremiums helper
// ============================================================

export function calcAsianPremium(
  localTickers: Record<string, Record<string, unknown>>,
  globalPrices: Record<string, number>,
  fxRate: number,
  localPriceField: string,
  localVolumeField: string,
  currencyCode: string,
  exchangeName: string,
): Array<{
  coin: string
  localPrice: number
  localUsd: number
  globalUsd: number
  premiumPct: number
  volume24hLocal: number
  volume24hUsd: number
}> {
  void currencyCode
  void exchangeName
  const premiums: Array<{
    coin: string
    localPrice: number
    localUsd: number
    globalUsd: number
    premiumPct: number
    volume24hLocal: number
    volume24hUsd: number
  }> = []

  for (const [coin, globalSymbol] of Object.entries(TRACKED_PAIRS)) {
    const ticker = localTickers[coin]
    const globalPrice = globalPrices[globalSymbol]
    if (!ticker || typeof globalPrice !== 'number' || !Number.isFinite(globalPrice) || globalPrice <= 0) continue

    const localPrice = Number(ticker[localPriceField])
    const volume24hLocal = Number(ticker[localVolumeField])
    const localUsdRaw = localPrice / fxRate
    const premiumPctRaw = ((localUsdRaw - globalPrice) / globalPrice) * 100

    if (!Number.isFinite(localPrice) || localPrice <= 0) continue
    if (!Number.isFinite(volume24hLocal) || volume24hLocal < 0) continue
    if (!Number.isFinite(localUsdRaw)) continue
    if (!Number.isFinite(premiumPctRaw)) continue

    premiums.push({
      coin,
      localPrice,
      localUsd: Math.round(localUsdRaw * 100) / 100,
      globalUsd: globalPrice,
      premiumPct: Math.round(premiumPctRaw * 100) / 100,
      volume24hLocal,
      volume24hUsd: Math.round((volume24hLocal / fxRate) * 100) / 100,
    })
  }

  return premiums.sort((a, b) => Math.abs(b.premiumPct) - Math.abs(a.premiumPct))
}

export function calcPremiums(
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
    if (!Number.isFinite(bithumbKrw) || bithumbKrw <= 0) continue

    const bithumbUsd = bithumbKrw / krwRate
    const premiumPct = ((bithumbUsd - binancePrice) / binancePrice) * 100
    if (!Number.isFinite(premiumPct)) continue
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
