import { describe, it, expect } from 'vitest'
import {
  TRACKED_PAIRS,
  EXCHANGE_FEES,
  WITHDRAWAL_FEES,
  TRANSFER_TIME_MIN,
  ROUTING_EXCHANGES,
  BRIDGE_COINS,
  ROUTING_EXCHANGE_CURRENCIES,
  ROUTING_EXCHANGE_COUNTRY,
  EXCHANGE_DISPLAY_NAME,
  GLOBAL_ROUTING_EXCHANGE_SET,
  KOREAN_ROUTING_EXCHANGE_SET,
  CORS_ALLOWED_ORIGINS,
} from './constants'

// ---------------------------------------------------------------------------
// TRACKED_PAIRS
// ---------------------------------------------------------------------------
describe('TRACKED_PAIRS', () => {
  it('contains at least BTC, ETH, XRP', () => {
    expect(TRACKED_PAIRS.BTC).toBe('BTCUSDT')
    expect(TRACKED_PAIRS.ETH).toBe('ETHUSDT')
    expect(TRACKED_PAIRS.XRP).toBe('XRPUSDT')
  })

  it('all values end with USDT', () => {
    for (const [coin, symbol] of Object.entries(TRACKED_PAIRS)) {
      expect(symbol).toMatch(/USDT$/)
      expect(coin).toBe(coin.toUpperCase())
    }
  })
})

// ---------------------------------------------------------------------------
// EXCHANGE_FEES
// ---------------------------------------------------------------------------
describe('EXCHANGE_FEES', () => {
  it('all fees are positive numbers', () => {
    for (const [exchange, fee] of Object.entries(EXCHANGE_FEES)) {
      expect(typeof fee).toBe('number')
      expect(fee).toBeGreaterThan(0)
      expect(fee).toBeLessThan(5) // sanity: no exchange charges 5%
      expect(exchange).toBe(exchange.toLowerCase())
    }
  })

  it('every ROUTING_EXCHANGES entry has a fee', () => {
    for (const exchange of ROUTING_EXCHANGES) {
      expect(EXCHANGE_FEES[exchange]).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// WITHDRAWAL_FEES
// ---------------------------------------------------------------------------
describe('WITHDRAWAL_FEES', () => {
  it('all fees are non-negative numbers', () => {
    for (const [exchange, coins] of Object.entries(WITHDRAWAL_FEES)) {
      expect(exchange).toBe(exchange.toLowerCase())
      for (const [coin, fee] of Object.entries(coins)) {
        expect(typeof fee).toBe('number')
        expect(fee).toBeGreaterThanOrEqual(0)
        expect(coin).toBe(coin.toUpperCase())
      }
    }
  })

  it('every ROUTING_EXCHANGES entry has withdrawal fees', () => {
    for (const exchange of ROUTING_EXCHANGES) {
      expect(WITHDRAWAL_FEES[exchange]).toBeDefined()
    }
  })

  it('BTC withdrawal fee is sane (0.0001 - 0.01)', () => {
    for (const [, coins] of Object.entries(WITHDRAWAL_FEES)) {
      const btcFee = coins.BTC
      if (btcFee !== undefined) {
        expect(btcFee).toBeGreaterThanOrEqual(0.00001)
        expect(btcFee).toBeLessThan(0.01) // sanity
      }
    }
  })
})

// ---------------------------------------------------------------------------
// TRANSFER_TIME_MIN
// ---------------------------------------------------------------------------
describe('TRANSFER_TIME_MIN', () => {
  it('all times are positive', () => {
    for (const [coin, time] of Object.entries(TRANSFER_TIME_MIN)) {
      expect(time).toBeGreaterThan(0)
      expect(coin).toBe(coin.toUpperCase())
    }
  })

  it('XRP is fastest (under 1 min)', () => {
    expect(TRANSFER_TIME_MIN.XRP).toBeLessThanOrEqual(1)
  })

  it('BTC is slowest', () => {
    expect(TRANSFER_TIME_MIN.BTC).toBeGreaterThan(20)
  })
})

// ---------------------------------------------------------------------------
// ROUTING data consistency
// ---------------------------------------------------------------------------
describe('Routing data consistency', () => {
  it('every ROUTING_EXCHANGES entry has currencies', () => {
    for (const exchange of ROUTING_EXCHANGES) {
      const currencies = ROUTING_EXCHANGE_CURRENCIES[exchange]
      expect(currencies).toBeDefined()
      expect(currencies.length).toBeGreaterThan(0)
    }
  })

  it('every ROUTING_EXCHANGES entry has a country', () => {
    for (const exchange of ROUTING_EXCHANGES) {
      expect(ROUTING_EXCHANGE_COUNTRY[exchange]).toBeDefined()
    }
  })

  it('every ROUTING_EXCHANGES entry has a display name', () => {
    for (const exchange of ROUTING_EXCHANGES) {
      expect(EXCHANGE_DISPLAY_NAME[exchange]).toBeDefined()
      expect(EXCHANGE_DISPLAY_NAME[exchange].length).toBeGreaterThan(0)
    }
  })

  it('Korean + Global exchange sets cover all ROUTING_EXCHANGES', () => {
    const otherExchanges = new Set(['bitflyer', 'wazirx', 'bitbank', 'indodax', 'bitkub'])
    for (const exchange of ROUTING_EXCHANGES) {
      const isKorean = KOREAN_ROUTING_EXCHANGE_SET.has(exchange)
      const isGlobal = GLOBAL_ROUTING_EXCHANGE_SET.has(exchange)
      const isOther = otherExchanges.has(exchange)
      // Each exchange should be in exactly one category
      expect(isKorean || isGlobal || isOther).toBe(true)
      if (isKorean) expect(isGlobal).toBe(false)
      if (isGlobal) expect(isKorean).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// BRIDGE_COINS
// ---------------------------------------------------------------------------
describe('BRIDGE_COINS', () => {
  it('contains common coins', () => {
    expect(BRIDGE_COINS).toContain('BTC')
    expect(BRIDGE_COINS).toContain('ETH')
    expect(BRIDGE_COINS).toContain('XRP')
  })

  it('all bridge coins are in TRACKED_PAIRS', () => {
    for (const coin of BRIDGE_COINS) {
      expect(TRACKED_PAIRS[coin]).toBeDefined()
    }
  })

  it('all bridge coins have transfer times', () => {
    for (const coin of BRIDGE_COINS) {
      expect(TRANSFER_TIME_MIN[coin]).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// CORS_ALLOWED_ORIGINS
// ---------------------------------------------------------------------------
describe('CORS_ALLOWED_ORIGINS', () => {
  it('contains production domain', () => {
    expect(CORS_ALLOWED_ORIGINS.has('https://crossfin.dev')).toBe(true)
  })

  it('contains localhost for development', () => {
    expect(CORS_ALLOWED_ORIGINS.has('http://localhost:5173')).toBe(true)
  })

  it('all entries are valid URLs', () => {
    for (const origin of CORS_ALLOWED_ORIGINS) {
      expect(origin).toMatch(/^https?:\/\//)
    }
  })
})
