import { describe, it, expect } from 'vitest'
import { estimateSlippage, getTransferTime, computeAction, computeRouteAction } from './engine'

// ---------------------------------------------------------------------------
// estimateSlippage
// ---------------------------------------------------------------------------
describe('estimateSlippage', () => {
  it('returns 0 for empty levels', () => {
    expect(estimateSlippage([], 1_000_000)).toBe(0)
  })

  it('returns 0 for zero trade amount', () => {
    const levels = [{ price: '50000', quantity: '1' }]
    expect(estimateSlippage(levels, 0)).toBe(0)
  })

  it('returns 0 for negative trade amount', () => {
    const levels = [{ price: '50000', quantity: '1' }]
    expect(estimateSlippage(levels, -100)).toBe(0)
  })

  it('returns 0 when entire order fits in first level (no slippage)', () => {
    const levels = [{ price: '50000', quantity: '100' }]
    // 50000 * 100 = 5,000,000 capacity. Trade = 1,000,000 → fits entirely
    const result = estimateSlippage(levels, 1_000_000)
    expect(result).toBe(0)
  })

  it('calculates slippage across multiple levels', () => {
    const levels = [
      { price: '50000', quantity: '10' },  // 500,000 capacity
      { price: '50100', quantity: '10' },  // 501,000 capacity
      { price: '50500', quantity: '10' },  // 505,000 capacity
    ]
    // Trade 1,000,000: fills 500k at 50000, fills remaining 500k at 50100
    const result = estimateSlippage(levels, 1_000_000)
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(1) // small slippage
  })

  it('returns 0 when bestPrice is 0 (early exit)', () => {
    const levels = [{ price: '0', quantity: '10' }]
    const result = estimateSlippage(levels, 1_000_000)
    expect(result).toBe(0) // bestPrice=0 triggers early return 0
  })

  it('returns 2.0 (default high) when valid bestPrice but no levels fill', () => {
    // bestPrice is valid (10) but qty is 0, so no fill → totalQty === 0
    const levels = [
      { price: '10', quantity: '0' },
      { price: '20', quantity: '0' },
    ]
    const result = estimateSlippage(levels, 1_000_000)
    expect(result).toBe(2.0)
  })

  it('handles levels with invalid data gracefully', () => {
    const levels = [
      { price: 'NaN', quantity: '10' },
      { price: '50000', quantity: '-5' },
      { price: '50000', quantity: '100' },
    ]
    // Only the last level is valid
    const result = estimateSlippage(levels, 1_000_000)
    expect(result).toBe(0)
  })

  it('handles partial fill at final level', () => {
    const levels = [
      { price: '100', quantity: '5' },   // 500 capacity
      { price: '200', quantity: '5' },   // 1000 capacity
    ]
    // Trade 800: fills all of level 1 (500), fills 300/1000 of level 2
    const result = estimateSlippage(levels, 800)
    expect(result).toBeGreaterThan(0)
  })

  it('returns percentage as expected', () => {
    // All in one level = 0% slippage
    const levels = [{ price: '10000', quantity: '1000' }]
    expect(estimateSlippage(levels, 100_000)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getTransferTime
// ---------------------------------------------------------------------------
describe('getTransferTime', () => {
  it('returns known transfer time for BTC', () => {
    expect(getTransferTime('BTC')).toBe(28)
  })

  it('returns known transfer time for XRP', () => {
    expect(getTransferTime('XRP')).toBe(0.5)
  })

  it('returns known transfer time for ETH', () => {
    expect(getTransferTime('ETH')).toBe(5)
  })

  it('returns default for unknown coin', () => {
    expect(getTransferTime('UNKNOWN_COIN')).toBe(10)
  })

  it('is case-insensitive', () => {
    expect(getTransferTime('btc')).toBe(28)
    expect(getTransferTime('Xrp')).toBe(0.5)
  })
})

// ---------------------------------------------------------------------------
// computeAction
// ---------------------------------------------------------------------------
describe('computeAction', () => {
  it('returns POSITIVE_SPREAD for high score', () => {
    const result = computeAction(3.0, 0.1, 5, 0.5)
    expect(result.indicator).toBe('POSITIVE_SPREAD')
    expect(result.signalStrength).toBeGreaterThan(0.8)
    expect(result.signalStrength).toBeLessThanOrEqual(0.95)
    expect(result.reason).toContain('Spread')
    expect(result.caveat).toBeTruthy()
  })

  it('returns NEUTRAL for marginal score', () => {
    const result = computeAction(0.5, 0.1, 1, 0.1)
    expect(result.indicator).toBe('NEUTRAL')
    expect(result.signalStrength).toBeGreaterThanOrEqual(0.5)
    expect(result.signalStrength).toBeLessThan(0.81)
  })

  it('returns NEGATIVE_SPREAD for negative score', () => {
    const result = computeAction(-1.0, 0.5, 10, 1.0)
    expect(result.indicator).toBe('NEGATIVE_SPREAD')
    expect(result.signalStrength).toBeGreaterThanOrEqual(0.1)
  })

  it('caps signalStrength at 0.95 for POSITIVE_SPREAD', () => {
    const result = computeAction(100.0, 0, 1, 0)
    expect(result.signalStrength).toBeLessThanOrEqual(0.95)
  })

  it('caps signalStrength at minimum 0.1 for NEGATIVE_SPREAD', () => {
    const result = computeAction(-100.0, 50, 60, 10)
    expect(result.signalStrength).toBeGreaterThanOrEqual(0.1)
  })

  it('always includes a caveat', () => {
    const r1 = computeAction(5, 0, 1, 0)
    const r2 = computeAction(-5, 0, 1, 0)
    const r3 = computeAction(0.3, 0.1, 2, 0.1)
    expect(r1.caveat.length).toBeGreaterThan(0)
    expect(r2.caveat.length).toBeGreaterThan(0)
    expect(r3.caveat.length).toBeGreaterThan(0)
  })

  it('higher slippage reduces score → may downgrade indicator', () => {
    const low = computeAction(2.0, 0.1, 5, 0.5)
    const high = computeAction(2.0, 2.5, 5, 0.5)
    // High slippage should result in worse or equal indicator
    const indicatorRank = { POSITIVE_SPREAD: 2, NEUTRAL: 1, NEGATIVE_SPREAD: 0 }
    expect(indicatorRank[high.indicator]).toBeLessThanOrEqual(indicatorRank[low.indicator])
  })

  it('higher volatility with longer transfer time reduces score', () => {
    const low = computeAction(2.0, 0.1, 1, 0.1)
    const high = computeAction(2.0, 0.1, 60, 5.0)
    const indicatorRank = { POSITIVE_SPREAD: 2, NEUTRAL: 1, NEGATIVE_SPREAD: 0 }
    expect(indicatorRank[high.indicator]).toBeLessThanOrEqual(indicatorRank[low.indicator])
  })
})

// ---------------------------------------------------------------------------
// computeRouteAction
// ---------------------------------------------------------------------------
describe('computeRouteAction', () => {
  it('returns POSITIVE_SPREAD for low total cost', () => {
    const result = computeRouteAction(0.5, 0.1, 1)
    expect(result.indicator).toBe('POSITIVE_SPREAD')
    expect(result.signalStrength).toBeGreaterThan(0.58)
  })

  it('returns NEUTRAL for moderate cost', () => {
    const result = computeRouteAction(2.0, 0.5, 5)
    expect(result.indicator).toBe('NEUTRAL')
  })

  it('returns NEGATIVE_SPREAD for high cost', () => {
    const result = computeRouteAction(5.0, 2.0, 30)
    expect(result.indicator).toBe('NEGATIVE_SPREAD')
    expect(result.signalStrength).toBeGreaterThanOrEqual(0.62)
  })

  it('always includes a caveat about slippage estimates', () => {
    const result = computeRouteAction(1.0, 0.1, 2)
    expect(result.caveat).toContain('Slippage')
  })

  it('low transfer time has less penalty', () => {
    const fast = computeRouteAction(1.0, 0.1, 1)
    const slow = computeRouteAction(1.0, 0.1, 60)
    // Slow should have worse or equal indicator
    const indicatorRank = { POSITIVE_SPREAD: 2, NEUTRAL: 1, NEGATIVE_SPREAD: 0 }
    expect(indicatorRank[slow.indicator]).toBeLessThanOrEqual(indicatorRank[fast.indicator])
  })

  it('signalStrength bounds are respected', () => {
    const r1 = computeRouteAction(0.1, 0.01, 1)
    const r2 = computeRouteAction(10, 10, 60)
    expect(r1.signalStrength).toBeLessThanOrEqual(0.95)
    expect(r1.signalStrength).toBeGreaterThanOrEqual(0.58)
    expect(r2.signalStrength).toBeLessThanOrEqual(0.97)
    expect(r2.signalStrength).toBeGreaterThanOrEqual(0.62)
  })
})
