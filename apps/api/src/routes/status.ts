import { Hono } from 'hono'
import type { Env } from '../types'
import { getEndpointHealth } from '../lib/monitoring'

const status = new Hono<Env>()

// GET /status — public status page
status.get('/', async (c) => {
  const db = c.env.DB

  // 1. Per-endpoint error rates (last 1h)
  let endpointHealth: Awaited<ReturnType<typeof getEndpointHealth>> = []
  try {
    endpointHealth = await getEndpointHealth(db, 1)
  } catch {
    // endpoint_calls table may not exist yet
  }

  // 2. Overall API status based on error rates
  const totalErrors = endpointHealth.reduce((sum, e) => sum + e.errorCount, 0)
  const totalCalls = endpointHealth.reduce((sum, e) => sum + e.totalCalls, 0)
  const overallErrorRate = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0
  const apiStatus =
    overallErrorRate > 25 ? 'down' : overallErrorRate > 5 ? 'degraded' : 'healthy'

  // 3. External API health — probe key exchanges
  const exchangeUrls: Record<string, string> = {
    bithumb: 'https://api.bithumb.com/public/ticker/BTC_KRW',
    upbit: 'https://api.upbit.com/v1/ticker?markets=KRW-BTC',
    binance: 'https://api.binance.com/api/v3/ping',
    coinone: 'https://api.coinone.co.kr/public/v2/ticker_new/KRW/BTC',
  }

  const exchangeChecks = await Promise.all(
    Object.entries(exchangeUrls).map(async ([name, url]) => {
      const start = Date.now()
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
        return {
          name,
          status: res.ok ? ('online' as const) : ('degraded' as const),
          latencyMs: Date.now() - start,
        }
      } catch {
        return {
          name,
          status: 'offline' as const,
          latencyMs: Date.now() - start,
        }
      }
    }),
  )

  // 4. Uptime percentage from uptime_checks table (last 24h)
  let uptimePct = 100
  let lastCheckAt: string | null = null
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const uptimeRow = await db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as up_count
         FROM uptime_checks
         WHERE created_at >= ?`,
      )
      .bind(dayAgo)
      .first<{ total: number; up_count: number }>()

    const total = Number(uptimeRow?.total ?? 0)
    const upCount = Number(uptimeRow?.up_count ?? 0)
    if (total > 0) {
      uptimePct = Math.round((upCount / total) * 10000) / 100
    }

    const lastRow = await db
      .prepare(
        'SELECT created_at FROM uptime_checks ORDER BY created_at DESC LIMIT 1',
      )
      .first<{ created_at: string }>()
    lastCheckAt = lastRow?.created_at ?? null
  } catch {
    // uptime_checks table may not exist yet
  }

  return c.json({
    status: apiStatus,
    uptimePercent24h: uptimePct,
    lastCheckAt,
    endpoints: endpointHealth.map((e) => ({
      endpoint: e.endpoint,
      totalCalls: e.totalCalls,
      errorCount: e.errorCount,
      errorRate: e.errorRate,
      avgLatencyMs: e.avgLatencyMs,
    })),
    externalApis: exchangeChecks,
    at: new Date().toISOString(),
  })
})

export default status
