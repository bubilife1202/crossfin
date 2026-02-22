import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../types'

type RegistryPublicDeps = {
  ensureRegistrySeeded: (db: D1Database, paymentReceiverAddress: string) => Promise<void>
  toServiceResponse: (row: Record<string, unknown>) => unknown
}

export function createRegistryPublicRoutes(deps: RegistryPublicDeps): Hono<Env> {
  const registry = new Hono<Env>()

  registry.get('/api/registry', async (c) => {
    await deps.ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

    const category = (c.req.query('category') ?? '').trim()
    const provider = (c.req.query('provider') ?? '').trim()
    const isCrossfin = (c.req.query('isCrossfin') ?? '').trim()
    const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? '100')))
    const offset = Math.max(0, Number(c.req.query('offset') ?? '0'))

    const where: string[] = ["status = 'active'"]
    const params: unknown[] = []

    if (category) {
      where.push('category = ?')
      params.push(category)
    }

    if (provider) {
      where.push('provider = ?')
      params.push(provider)
    }

    if (isCrossfin) {
      const flag = isCrossfin === 'true' || isCrossfin === '1' ? 1 : 0
      where.push('is_crossfin = ?')
      params.push(flag)
    }

    const whereSql = where.join(' AND ')

    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM services WHERE ${whereSql}`
    ).bind(...params).first<{ count: number | string }>()

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM services WHERE ${whereSql}
       ORDER BY is_crossfin DESC, created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all<Record<string, unknown>>()

    return c.json({
      data: (results ?? []).map((row) => deps.toServiceResponse(row)),
      total: countRow ? Number(countRow.count) : 0,
      limit,
      offset,
      at: new Date().toISOString(),
    })
  })

  registry.get('/api/registry/search', async (c) => {
    await deps.ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

    const qRaw = (c.req.query('q') ?? '').trim()
    if (!qRaw) throw new HTTPException(400, { message: 'q is required' })

    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50')))
    const offset = Math.max(0, Number(c.req.query('offset') ?? '0'))
    const q = `%${qRaw.replace(/[\%_]/g, (match) => `\\${match}`)}%`

    const whereSql = "status = 'active' AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR provider LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR endpoint LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')"
    const params = [q, q, q, q, q, q]

    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM services WHERE ${whereSql}`
    ).bind(...params).first<{ count: number | string }>()

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM services WHERE ${whereSql}
       ORDER BY is_crossfin DESC, created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all<Record<string, unknown>>()

    return c.json({
      q: qRaw,
      data: (results ?? []).map((row) => deps.toServiceResponse(row)),
      total: countRow ? Number(countRow.count) : 0,
      limit,
      offset,
      at: new Date().toISOString(),
    })
  })

  registry.get('/api/registry/categories', async (c) => {
    await deps.ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

    const { results } = await c.env.DB.prepare(
      "SELECT category, COUNT(*) as count FROM services WHERE status = 'active' GROUP BY category ORDER BY count DESC"
    ).all<{ category: string; count: number }>()

    return c.json({
      data: (results ?? []).map((r) => ({ category: r.category, count: Number(r.count) })),
      at: new Date().toISOString(),
    })
  })

  registry.get('/api/registry/stats', async (c) => {
    await deps.ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

    const results = await c.env.DB.batch([
      c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active'"),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active' AND is_crossfin = 1"),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active' AND is_crossfin = 0"),
    ])

    const total = results[0]?.results?.[0] as { count?: number | string } | undefined
    const crossfin = results[1]?.results?.[0] as { count?: number | string } | undefined
    const external = results[2]?.results?.[0] as { count?: number | string } | undefined

    return c.json({
      services: {
        total: Number(total?.count ?? 0),
        crossfin: Number(crossfin?.count ?? 0),
        external: Number(external?.count ?? 0),
      },
      at: new Date().toISOString(),
    })
  })

  registry.get('/api/registry/:id', async (c) => {
    await deps.ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

    const id = c.req.param('id')
    const row = await c.env.DB.prepare(
      'SELECT * FROM services WHERE id = ?'
    ).bind(id).first<Record<string, unknown>>()

    if (!row) throw new HTTPException(404, { message: 'Service not found' })

    return c.json({ data: deps.toServiceResponse(row) })
  })

  return registry
}
