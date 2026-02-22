import { Hono } from 'hono'
import type { Env } from '../types'

type MetaDeps = {
  getPublicStatsPayload: (db: D1Database) => Promise<unknown>
  getAcpStatusPayload: () => unknown
}

export function createMetaRoutes(deps: MetaDeps): Hono<Env> {
  const meta = new Hono<Env>()

  meta.get('/api/stats', async (c) => {
    const payload = await deps.getPublicStatsPayload(c.env.DB)
    return c.json(payload)
  })

  meta.get('/api/acp/status', (c) => {
    return c.json(deps.getAcpStatusPayload())
  })

  return meta
}
