import { describe, it, expect } from 'vitest'
import { isRecord, round2, toHex } from './types'

// ---------------------------------------------------------------------------
// isRecord
// ---------------------------------------------------------------------------
describe('isRecord', () => {
  it('returns true for plain objects', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
  })

  it('returns false for null', () => {
    expect(isRecord(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isRecord(undefined)).toBe(false)
  })

  it('returns false for arrays', () => {
    expect(isRecord([])).toBe(false)
    expect(isRecord([1, 2, 3])).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(isRecord('string')).toBe(false)
    expect(isRecord(42)).toBe(false)
    expect(isRecord(true)).toBe(false)
  })

  it('returns true for objects with prototype', () => {
    expect(isRecord(new Date())).toBe(true)
    expect(isRecord(new Map())).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// round2
// ---------------------------------------------------------------------------
describe('round2', () => {
  it('rounds to 2 decimal places', () => {
    expect(round2(1.234)).toBe(1.23)
    expect(round2(1.235)).toBe(1.24)
    expect(round2(1.2)).toBe(1.2)
    expect(round2(1)).toBe(1)
  })

  it('handles negative numbers', () => {
    expect(round2(-1.234)).toBe(-1.23)
    expect(round2(-1.235)).toBe(-1.24)
  })

  it('handles zero', () => {
    expect(round2(0)).toBe(0)
  })

  it('handles very small numbers', () => {
    expect(round2(0.001)).toBe(0)
    expect(round2(0.005)).toBe(0.01)
  })

  it('handles large numbers', () => {
    expect(round2(123456.789)).toBe(123456.79)
  })
})

// ---------------------------------------------------------------------------
// toHex
// ---------------------------------------------------------------------------
describe('toHex', () => {
  it('converts empty array to empty string', () => {
    expect(toHex(new Uint8Array([]))).toBe('')
  })

  it('converts bytes to hex string', () => {
    expect(toHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff')
  })

  it('pads single-digit hex values', () => {
    expect(toHex(new Uint8Array([0]))).toBe('00')
    expect(toHex(new Uint8Array([1]))).toBe('01')
  })
})
