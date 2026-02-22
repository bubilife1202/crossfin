import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../types'

type RegistryAdminDeps = {
  requireAdmin: (c: Context<Env>) => void
  ensureRegistrySeeded: (db: D1Database, paymentReceiverAddress: string, options?: { force?: boolean }) => Promise<void>
  audit: typeof import('../lib/helpers').audit
}

export function createRegistryAdminRoutes(deps: RegistryAdminDeps): Hono<Env> {
  const registryAdmin = new Hono<Env>()

  registryAdmin.get('/api/registry/sync', async (c) => {
    deps.requireAdmin(c)

    const confirm = (c.req.query('confirm') ?? '').trim().toLowerCase()
    if (confirm !== 'yes') {
      throw new HTTPException(400, { message: 'Add ?confirm=yes to sync new registry seeds (insert-only)' })
    }

    const before = await c.env.DB.batch([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM services'),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active'"),
    ])

    await deps.ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS, { force: true })

    const after = await c.env.DB.batch([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM services'),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active'"),
    ])

    const beforeTotal = Number(((before[0]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
    const beforeActive = Number(((before[1]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
    const afterTotal = Number(((after[0]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
    const afterActive = Number(((after[1]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))

    await deps.audit(
      c.env.DB,
      null,
      'admin.registry.sync',
      'services',
      null,
      'success',
      `before_total=${beforeTotal} before_active=${beforeActive} after_total=${afterTotal} after_active=${afterActive}`,
    )

    return c.json({
      ok: true,
      services: {
        before: { total: beforeTotal, active: beforeActive },
        after: { total: afterTotal, active: afterActive },
        added: { total: Math.max(0, afterTotal - beforeTotal), active: Math.max(0, afterActive - beforeActive) },
      },
      at: new Date().toISOString(),
    })
  })

  registryAdmin.get('/api/registry/reseed', async (c) => {
    deps.requireAdmin(c)

    const confirm = (c.req.query('confirm') ?? '').trim().toLowerCase()
    if (confirm !== 'yes') {
      throw new HTTPException(400, { message: 'Add ?confirm=yes to reseed the registry' })
    }

    await c.env.DB.prepare('DELETE FROM services').run()
    await deps.ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

    const row = await c.env.DB.prepare('SELECT COUNT(*) as count FROM services').first<{ count: number | string }>()
    const count = row ? Number(row.count) : 0

    await deps.audit(
      c.env.DB,
      null,
      'admin.registry.reseed',
      'services',
      null,
      'success',
      `services_total=${count}`,
    )

    return c.json({
      ok: true,
      services: { total: count },
      at: new Date().toISOString(),
    })
  })

  return registryAdmin
}
