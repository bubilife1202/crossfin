import { describe, it, expect } from 'vitest'
import { cloneDefaultTradingFees, cloneDefaultWithdrawalFees, getWithdrawalFee, calcPremiums } from './fetchers'
import { EXCHANGE_FEES, WITHDRAWAL_FEES } from '../constants'

// ---------------------------------------------------------------------------
// cloneDefaultTradingFees
// ---------------------------------------------------------------------------
describe('cloneDefaultTradingFees', () => {
  it('returns a copy of EXCHANGE_FEES', () => {
    const fees = cloneDefaultTradingFees()
    expect(fees).toEqual(EXCHANGE_FEES)
  })

  it('does not return the same reference', () => {
    const fees = cloneDefaultTradingFees()
    expect(fees).not.toBe(EXCHANGE_FEES)
  })

  it('mutation does not affect original', () => {
    const fees = cloneDefaultTradingFees()
    fees.bithumb = 999
    expect(EXCHANGE_FEES.bithumb).toBe(0.25)
  })
})

// ---------------------------------------------------------------------------
// cloneDefaultWithdrawalFees
// ---------------------------------------------------------------------------
describe('cloneDefaultWithdrawalFees', () => {
  it('returns a copy of WITHDRAWAL_FEES', () => {
    const fees = cloneDefaultWithdrawalFees()
    expect(fees).toEqual(WITHDRAWAL_FEES)
  })

  it('does not return the same reference for top-level', () => {
    const fees = cloneDefaultWithdrawalFees()
    expect(fees).not.toBe(WITHDRAWAL_FEES)
  })

  it('does not return the same reference for nested objects', () => {
    const fees = cloneDefaultWithdrawalFees()
    expect(fees.binance).not.toBe(WITHDRAWAL_FEES.binance)
  })

  it('mutation does not affect original', () => {
    const fees = cloneDefaultWithdrawalFees()
    if (fees.binance) fees.binance.BTC = 999
    expect(WITHDRAWAL_FEES.binance?.BTC).toBe(0.0002)
  })
})

// ---------------------------------------------------------------------------
// getWithdrawalFee
// ---------------------------------------------------------------------------
describe('getWithdrawalFee', () => {
  it('returns correct fee for known exchange/coin', () => {
    expect(getWithdrawalFee('binance', 'BTC')).toBe(0.0002)
  })

  it('returns 0 for unknown exchange', () => {
    expect(getWithdrawalFee('nonexistent', 'BTC')).toBe(0)
  })

  it('returns 0 for unknown coin', () => {
    expect(getWithdrawalFee('binance', 'NONEXISTENT')).toBe(0)
  })

  it('is case-insensitive for exchange (lowercase)', () => {
    expect(getWithdrawalFee('BINANCE', 'BTC')).toBe(0.0002)
  })

  it('is case-insensitive for coin (uppercase)', () => {
    expect(getWithdrawalFee('binance', 'btc')).toBe(0.0002)
  })

  it('uses custom withdrawal fees map when provided', () => {
    const custom = { myexchange: { ETH: 0.05 } }
    expect(getWithdrawalFee('myexchange', 'ETH', custom)).toBe(0.05)
  })

  it('returns 0 from custom map for missing coin', () => {
    const custom = { myexchange: { ETH: 0.05 } }
    expect(getWithdrawalFee('myexchange', 'BTC', custom)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// calcPremiums
// ---------------------------------------------------------------------------
describe('calcPremiums', () => {
  const baseBinancePrices: Record<string, number> = {
    BTCUSDT: 100000,
    ETHUSDT: 3000,
    XRPUSDT: 2.5,
  }

  it('calculates positive premium when Korean price is higher', () => {
    const bithumb: Record<string, Record<string, string>> = {
      BTC: { closing_price: '150000000', acc_trade_value_24H: '1000000000', fluctate_rate_24H: '1.5' },
    }
    const krwRate = 1400
    const premiums = calcPremiums(bithumb, baseBinancePrices, krwRate)
    const btc = premiums.find((p) => p.coin === 'BTC')
    expect(btc).toBeDefined()
    expect(btc!.premiumPct).toBeGreaterThan(0) // 150000000/1400 = 107142 vs 100000
  })

  it('calculates negative premium when Korean price is lower', () => {
    const bithumb: Record<string, Record<string, string>> = {
      BTC: { closing_price: '130000000', acc_trade_value_24H: '1000000000', fluctate_rate_24H: '-2' },
    }
    const krwRate = 1400
    const premiums = calcPremiums(bithumb, baseBinancePrices, krwRate)
    const btc = premiums.find((p) => p.coin === 'BTC')
    expect(btc).toBeDefined()
    expect(btc!.premiumPct).toBeLessThan(0) // 130000000/1400 = 92857 vs 100000
  })

  it('skips coins missing from bithumb data', () => {
    const bithumb: Record<string, Record<string, string>> = {}
    const premiums = calcPremiums(bithumb, baseBinancePrices, 1400)
    expect(premiums.length).toBe(0)
  })

  it('skips coins missing closing_price', () => {
    const bithumb: Record<string, Record<string, string>> = {
      BTC: { acc_trade_value_24H: '1000000000', fluctate_rate_24H: '1.5' },
    }
    const premiums = calcPremiums(bithumb, baseBinancePrices, 1400)
    expect(premiums.length).toBe(0)
  })

  it('skips coins with zero or negative closing_price', () => {
    const bithumb: Record<string, Record<string, string>> = {
      BTC: { closing_price: '0', acc_trade_value_24H: '1000000000', fluctate_rate_24H: '0' },
    }
    const premiums = calcPremiums(bithumb, baseBinancePrices, 1400)
    expect(premiums.length).toBe(0)
  })

  it('skips coins missing from binance prices', () => {
    const bithumb: Record<string, Record<string, string>> = {
      BTC: { closing_price: '150000000', acc_trade_value_24H: '1000000000', fluctate_rate_24H: '0' },
    }
    const premiums = calcPremiums(bithumb, {}, 1400) // no Binance prices
    expect(premiums.length).toBe(0)
  })

  it('handles multiple coins and sorts by absolute premium', () => {
    const bithumb: Record<string, Record<string, string>> = {
      BTC: { closing_price: '150000000', acc_trade_value_24H: '1000000000', fluctate_rate_24H: '0' },
      ETH: { closing_price: '5000000', acc_trade_value_24H: '500000000', fluctate_rate_24H: '0' },
    }
    const premiums = calcPremiums(bithumb, baseBinancePrices, 1400)
    expect(premiums.length).toBe(2)
    // Should be sorted by absolute premium descending
    expect(Math.abs(premiums[0]!.premiumPct)).toBeGreaterThanOrEqual(Math.abs(premiums[1]!.premiumPct))
  })

  it('calculates volume in USD correctly', () => {
    const bithumb: Record<string, Record<string, string>> = {
      BTC: { closing_price: '140000000', acc_trade_value_24H: '14000000000', fluctate_rate_24H: '0' },
    }
    const krwRate = 1400
    const premiums = calcPremiums(bithumb, baseBinancePrices, krwRate)
    const btc = premiums[0]!
    expect(btc.volume24hUsd).toBe(Math.round(14000000000 / 1400))
  })

  it('only processes coins defined in TRACKED_PAIRS', () => {
    const bithumb: Record<string, Record<string, string>> = {
      FAKE_COIN: { closing_price: '100', acc_trade_value_24H: '100', fluctate_rate_24H: '0' },
    }
    const binancePrices = { FAKE_COINUSDT: 1 }
    const premiums = calcPremiums(bithumb, binancePrices, 1400)
    expect(premiums.length).toBe(0) // FAKE_COIN not in TRACKED_PAIRS
  })
})
