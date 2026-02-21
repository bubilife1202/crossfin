import { round2 } from '../types'
import {
  TRANSFER_TIME_MIN,
  DEFAULT_TRANSFER_TIME_MIN,
} from '../constants'

export function getTransferTime(coin: string): number {
  return TRANSFER_TIME_MIN[coin.toUpperCase()] ?? DEFAULT_TRANSFER_TIME_MIN
}

export function estimateSlippage(
  levels: Array<{ price: string; quantity: string }>,
  tradeAmountKrw: number,
): number {
  if (!levels.length || tradeAmountKrw <= 0) return 0
  const firstLevel = levels[0]
  if (!firstLevel) return 0
  const bestPrice = parseFloat(firstLevel.price)
  if (!bestPrice || !Number.isFinite(bestPrice)) return 0

  let remaining = tradeAmountKrw
  let totalCost = 0
  let totalQty = 0

  for (const level of levels) {
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
  return Math.round((Math.abs(avgPrice - bestPrice) / bestPrice) * 10000) / 100 // percentage
}

export async function getPremiumTrend(
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

export function computeAction(
  netProfitPct: number,
  slippageEstimatePct: number,
  transferTimeMin: number,
  volatilityPct: number,
): { indicator: 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE'; signalStrength: number; reason: string; caveat: string } {
  const caveat = 'This is a market data observation, not a trading recommendation. Actual execution results may differ significantly, especially in low-liquidity markets.'
  const adjustedProfit = netProfitPct - slippageEstimatePct
  const premiumRisk = volatilityPct * Math.sqrt(transferTimeMin / 60)
  const score = adjustedProfit - premiumRisk

  if (score > 1.0) {
    const signalStrength = Math.min(0.95, 0.8 + (score - 1.0) * 0.05)
    return {
      indicator: 'FAVORABLE',
      signalStrength: Math.round(signalStrength * 100) / 100,
      reason: `Adjusted profit ${round2(adjustedProfit)}% exceeds risk ${round2(premiumRisk)}% with strong margin`,
      caveat,
    }
  } else if (score > 0) {
    const signalStrength = 0.5 + (score / 1.0) * 0.3
    return {
      indicator: 'NEUTRAL',
      signalStrength: Math.round(signalStrength * 100) / 100,
      reason: `Marginal profit ${round2(adjustedProfit)}% after risk ${round2(premiumRisk)}% — monitor for better entry`,
      caveat,
    }
  } else {
    const signalStrength = Math.max(0.1, 0.5 + score * 0.2)
    return {
      indicator: 'UNFAVORABLE',
      signalStrength: Math.round(signalStrength * 100) / 100,
      reason: `Negative expected return: adjusted profit ${round2(adjustedProfit)}% minus risk ${round2(premiumRisk)}%`,
      caveat,
    }
  }
}

export function computeRouteAction(
  totalCostPct: number,
  slippageEstimatePct: number,
  transferTimeMin: number,
): { indicator: 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE'; signalStrength: number; reason: string; caveat: string } {
  const caveat = 'Slippage estimates are approximations. Actual slippage may be significantly higher, especially for large trades or illiquid pairs.'
  const slippagePenalty = Math.max(0, slippageEstimatePct) * 0.4
  const timePenalty = Math.max(0, transferTimeMin - 2) * 0.07
  const score = totalCostPct + slippagePenalty + timePenalty

  if (score < 1.4) {
    const signalStrength = Math.max(0.58, Math.min(0.95, 0.91 - score * 0.1))
    return {
      indicator: 'FAVORABLE',
      signalStrength: Math.round(signalStrength * 100) / 100,
      reason: `Low projected routing cost ${round2(totalCostPct)}% with manageable transfer risk`,
      caveat,
    }
  }

  if (score < 3.2) {
    const signalStrength = Math.max(0.46, Math.min(0.84, 0.78 - (score - 1.4) * 0.08))
    return {
      indicator: 'NEUTRAL',
      signalStrength: Math.round(signalStrength * 100) / 100,
      reason: `Moderate routing cost ${round2(totalCostPct)}% — monitor liquidity before execution`,
      caveat,
    }
  }

  const signalStrength = Math.max(0.62, Math.min(0.97, 0.64 + (score - 3.2) * 0.08))
  return {
    indicator: 'UNFAVORABLE',
    signalStrength: Math.round(signalStrength * 100) / 100,
    reason: `High projected routing cost ${round2(totalCostPct)}% for current market conditions`,
    caveat,
  }
}
