import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Context } from 'hono'
import type { Env } from '../types'
import { sha256Hex } from '../types'

const FUNNEL_EVENT_NAMES = [
  'mcp_quickstart_view',
  'mcp_command_copy',
  'mcp_config_view',
  'mcp_config_copy',
  'mcp_guide_open',
  'mcp_install_verify',
] as const

type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number]

const FUNNEL_EVENT_NAME_SET = new Set<string>(FUNNEL_EVENT_NAMES)
const MAX_FUNNEL_SOURCE_LENGTH = 64
const MAX_FUNNEL_METADATA_LENGTH = 2000
const MAX_FUNNEL_USER_AGENT_LENGTH = 180

type AnalyticsDeps = {
  ensureRegistrySeeded: (db: D1Database, paymentReceiverAddress: string) => Promise<void>
  ensureEndpointCallsTable: (db: D1Database) => Promise<void>
  toServiceResponse: (row: Record<string, unknown>) => unknown
}

function getClientRateLimitKey(c: Context<Env>): string {
  const cfIp = (c.req.header('CF-Connecting-IP') ?? '').trim()
  return cfIp || 'unknown'
}

function parseFunnelEventName(value: unknown): FunnelEventName {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!FUNNEL_EVENT_NAME_SET.has(raw)) {
    throw new HTTPException(400, { message: `eventName must be one of: ${FUNNEL_EVENT_NAMES.join(', ')}` })
  }
  return raw as FunnelEventName
}

function normalizeFunnelSource(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const sanitized = raw.replace(/[^a-z0-9._:/-]/g, '')
  if (!sanitized) return 'web'
  return sanitized.slice(0, MAX_FUNNEL_SOURCE_LENGTH)
}

function normalizeFunnelMetadata(value: unknown): string | null {
  if (value === null || value === undefined) return null

  let serialized = ''
  try {
    serialized = JSON.stringify(value)
  } catch {
    return null
  }

  if (!serialized || serialized === '{}' || serialized === '[]') return null
  if (serialized.length <= MAX_FUNNEL_METADATA_LENGTH) return serialized

  const fallback = JSON.stringify({ truncated: true, originalLength: serialized.length })
  return fallback.length <= MAX_FUNNEL_METADATA_LENGTH ? fallback : null
}

async function ensureFunnelEventsTable(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS funnel_events (
         id TEXT PRIMARY KEY,
         event_name TEXT NOT NULL,
         source TEXT NOT NULL DEFAULT 'web',
         metadata TEXT,
         ip_hash TEXT,
         user_agent TEXT,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    ),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_funnel_events_event_created ON funnel_events(event_name, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_funnel_events_source_created ON funnel_events(source, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_funnel_events_ip_created ON funnel_events(ip_hash, created_at)'),
  ])
}

async function hashClientKey(c: Context<Env>): Promise<string> {
  return sha256Hex(getClientRateLimitKey(c))
}

export function createAnalyticsRoutes(deps: AnalyticsDeps): Hono<Env> {
  const analytics = new Hono<Env>()

  analytics.post('/funnel/events', async (c) => {
    const contentLengthRaw = c.req.header('Content-Length')
    if (contentLengthRaw) {
      const contentLength = Number(contentLengthRaw)
      if (Number.isFinite(contentLength) && contentLength > 4096) {
        throw new HTTPException(413, { message: 'Payload too large' })
      }
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      throw new HTTPException(400, { message: 'Invalid JSON body' })
    }

    const payload = (body && typeof body === 'object' && !Array.isArray(body)) ? body as Record<string, unknown> : null
    if (!payload) throw new HTTPException(400, { message: 'JSON object body is required' })

    const eventName = parseFunnelEventName(payload.eventName)
    const source = normalizeFunnelSource(payload.source)
    const metadata = normalizeFunnelMetadata(payload.metadata)
    const userAgent = (c.req.header('User-Agent') ?? '').slice(0, MAX_FUNNEL_USER_AGENT_LENGTH)
    const ipHash = await hashClientKey(c)

    await ensureFunnelEventsTable(c.env.DB)
    await c.env.DB.prepare(
      'INSERT INTO funnel_events (id, event_name, source, metadata, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(`funnel_${crypto.randomUUID()}`, eventName, source, metadata, ipHash, userAgent).run()

    return c.json({ ok: true, eventName, source, at: new Date().toISOString() }, 202)
  })

  analytics.get('/funnel/overview', async (c) => {
    await ensureFunnelEventsTable(c.env.DB)

    const [byEventRes, bySourceRes, uniqueRes] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT event_name as eventName, COUNT(*) as count
         FROM funnel_events
         WHERE created_at >= datetime('now', '-7 day')
         GROUP BY event_name`
      ),
      c.env.DB.prepare(
        `SELECT source, COUNT(*) as count
         FROM funnel_events
         WHERE created_at >= datetime('now', '-7 day')
         GROUP BY source
         ORDER BY count DESC
         LIMIT 8`
      ),
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT ip_hash) as count
         FROM funnel_events
         WHERE created_at >= datetime('now', '-7 day')`
      ),
    ])

    const counts: Record<FunnelEventName, number> = {
      mcp_quickstart_view: 0,
      mcp_command_copy: 0,
      mcp_config_view: 0,
      mcp_config_copy: 0,
      mcp_guide_open: 0,
      mcp_install_verify: 0,
    }

    for (const row of (byEventRes?.results ?? []) as Array<{ eventName?: string; count?: number | string }>) {
      const eventName = typeof row.eventName === 'string' ? row.eventName : ''
      if (!FUNNEL_EVENT_NAME_SET.has(eventName)) continue
      counts[eventName as FunnelEventName] = Number(row.count ?? 0)
    }

    const quickstartViews = counts.mcp_quickstart_view
    const commandCopies = counts.mcp_command_copy
    const configViews = counts.mcp_config_view
    const configCopies = counts.mcp_config_copy
    const guideOpens = counts.mcp_guide_open
    const installVerifies = counts.mcp_install_verify

    const pct = (n: number, d: number) => d > 0 ? Math.min(100, Math.round((n / d) * 1000) / 10) : 0
    const conversion = quickstartViews > 0
      ? {
          commandCopyPct: pct(commandCopies, quickstartViews),
          configViewPct: pct(configViews, quickstartViews),
          configCopyPct: pct(configCopies, quickstartViews),
          guideOpenPct: pct(guideOpens, quickstartViews),
          installVerifyPct: pct(installVerifies, quickstartViews),
        }
      : {
          commandCopyPct: 0,
          configViewPct: 0,
          configCopyPct: 0,
          guideOpenPct: 0,
          installVerifyPct: 0,
        }

    const uniqueVisitors = Number((uniqueRes?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)

    return c.json({
      window: { days: 7 },
      counts,
      conversion,
      uniqueVisitors,
      topSources: (bySourceRes?.results ?? []).map((row) => ({
        source: String((row as { source?: string }).source ?? ''),
        count: Number((row as { count?: number | string }).count ?? 0),
      })),
      at: new Date().toISOString(),
    })
  })

  analytics.get('/overview', async (c) => {
    await deps.ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)
    await deps.ensureEndpointCallsTable(c.env.DB)

    const [callsAllRes, callsExternalRes, servicesCountRes, crossfinCountRes] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM endpoint_calls'),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM endpoint_calls_v2 WHERE traffic_source = 'external'"),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active'"),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active' AND is_crossfin = 1"),
    ])

    const totalCallsAll = Number((callsAllRes?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
    const totalCallsExternal = Number((callsExternalRes?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
    const totalServices = Number((servicesCountRes?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
    const crossfinServices = Number((crossfinCountRes?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)

    let uniqueUsersTotal = 0
    let uniqueUsers24h = 0
    let uniqueUsers7d = 0
    try {
      const [uAll, u24h, u7d] = await c.env.DB.batch([
        c.env.DB.prepare("SELECT COUNT(DISTINCT ip_hash) as count FROM endpoint_calls_v2 WHERE traffic_source = 'external' AND ip_hash IS NOT NULL"),
        c.env.DB.prepare("SELECT COUNT(DISTINCT ip_hash) as count FROM endpoint_calls_v2 WHERE traffic_source = 'external' AND ip_hash IS NOT NULL AND created_at >= datetime('now', '-1 day')"),
        c.env.DB.prepare("SELECT COUNT(DISTINCT ip_hash) as count FROM endpoint_calls_v2 WHERE traffic_source = 'external' AND ip_hash IS NOT NULL AND created_at >= datetime('now', '-7 day')"),
      ])
      uniqueUsersTotal = Number((uAll?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
      uniqueUsers24h = Number((u24h?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
      uniqueUsers7d = Number((u7d?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
    } catch {
      uniqueUsersTotal = 0
      uniqueUsers24h = 0
      uniqueUsers7d = 0
    }

    const [topAll, topExternal] = await Promise.all([
      c.env.DB.prepare(
        `SELECT method, path, COUNT(*) as calls
         FROM endpoint_calls
         GROUP BY method, path
         ORDER BY calls DESC
         LIMIT 10`
      ).all<{ method: string; path: string; calls: number | string }>(),
      c.env.DB.prepare(
        `SELECT method, path, COUNT(*) as calls
         FROM endpoint_calls_v2
         WHERE traffic_source = 'external'
         GROUP BY method, path
         ORDER BY calls DESC
         LIMIT 10`
      ).all<{ method: string; path: string; calls: number | string }>(),
    ])

    const [recentAll, recentExternal] = await Promise.all([
      c.env.DB.prepare(
        `SELECT method, path, status, response_time_ms as responseTimeMs, created_at as createdAt
         FROM endpoint_calls
         ORDER BY datetime(created_at) DESC
         LIMIT 20`
      ).all<{ method: string; path: string; status: string; responseTimeMs: number | string | null; createdAt: string }>(),
      c.env.DB.prepare(
        `SELECT method, path, status, response_time_ms as responseTimeMs, created_at as createdAt
         FROM endpoint_calls_v2
         WHERE traffic_source = 'external'
         ORDER BY datetime(created_at) DESC
         LIMIT 20`
      ).all<{ method: string; path: string; status: string; responseTimeMs: number | string | null; createdAt: string }>(),
    ])

    const toTopServices = (rows: Array<{ method: string; path: string; calls: number | string }>) => rows.map((r) => ({
      serviceId: `${String(r.method ?? '').toUpperCase()} ${String(r.path ?? '')}`,
      serviceName: `${String(r.method ?? '').toUpperCase()} ${String(r.path ?? '')}`,
      calls: Number(r.calls ?? 0),
    }))

    const toRecentCalls = (rows: Array<{ method: string; path: string; status: string; responseTimeMs: number | string | null; createdAt: string }>) => rows.map((r) => ({
      serviceId: `${String(r.method ?? '').toUpperCase()} ${String(r.path ?? '')}`,
      serviceName: `${String(r.method ?? '').toUpperCase()} ${String(r.path ?? '')}`,
      status: String(r.status ?? 'unknown'),
      responseTimeMs: r.responseTimeMs === null || r.responseTimeMs === undefined ? null : Number(r.responseTimeMs),
      createdAt: String(r.createdAt ?? ''),
    }))

    const topServicesAll = toTopServices(topAll.results ?? [])
    const topServicesExternal = toTopServices(topExternal.results ?? [])
    const recentCallsAll = toRecentCalls(recentAll.results ?? [])
    const recentCallsExternal = toRecentCalls(recentExternal.results ?? [])

    return c.json({
      totalCalls: totalCallsAll,
      totalCallsAll,
      totalCallsExternal,
      totalServices,
      crossfinServices,
      uniqueUsers: {
        total: uniqueUsersTotal,
        last24h: uniqueUsers24h,
        last7d: uniqueUsers7d,
      },
      topServices: topServicesAll,
      topServicesAll,
      topServicesExternal,
      recentCalls: recentCallsAll,
      recentCallsAll,
      recentCallsExternal,
      at: new Date().toISOString(),
    })
  })

  analytics.get('/services/:serviceId', async (c) => {
    await deps.ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

    const serviceId = c.req.param('serviceId')
    const row = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(serviceId).first<Record<string, unknown>>()
    if (!row) throw new HTTPException(404, { message: 'Service not found' })

    const statsRow = await c.env.DB.prepare(
      `SELECT
         COUNT(*) as totalCalls,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successCalls,
         AVG(response_time_ms) as avgResponseTimeMs,
         SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) as callsLast24h,
         SUM(CASE WHEN created_at >= datetime('now', '-7 day') THEN 1 ELSE 0 END) as callsLast7d
       FROM service_calls
       WHERE service_id = ?`
    ).bind(serviceId).first<{
      totalCalls: number | string
      successCalls: number | string | null
      avgResponseTimeMs: number | string | null
      callsLast24h: number | string | null
      callsLast7d: number | string | null
    }>()

    const totalCalls = Number(statsRow?.totalCalls ?? 0)
    const successCalls = Number(statsRow?.successCalls ?? 0)
    const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 1000) / 10 : 0
    const avgResponseTimeMs = statsRow?.avgResponseTimeMs === null || statsRow?.avgResponseTimeMs === undefined
      ? null
      : Math.round(Number(statsRow.avgResponseTimeMs))

    return c.json({
      service: deps.toServiceResponse(row),
      stats: {
        totalCalls,
        successRate,
        avgResponseTimeMs,
        callsLast24h: Number(statsRow?.callsLast24h ?? 0),
        callsLast7d: Number(statsRow?.callsLast7d ?? 0),
      },
      at: new Date().toISOString(),
    })
  })

  return analytics
}
