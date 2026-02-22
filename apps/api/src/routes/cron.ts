import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../types'

type CronDeps = {
  requireAdmin: (c: Context<Env>) => void
  fetchBithumbAll: typeof import('../lib/fetchers').fetchBithumbAll
  fetchGlobalPrices: typeof import('../lib/fetchers').fetchGlobalPrices
  fetchKrwRate: typeof import('../lib/fetchers').fetchKrwRate
  calcPremiums: typeof import('../lib/fetchers').calcPremiums
  audit: typeof import('../lib/helpers').audit
}

export function createCronRoutes(deps: CronDeps): Hono<Env> {
  const cron = new Hono<Env>()

  cron.get('/api/cron/snapshot-kimchi', async (c) => {
    deps.requireAdmin(c)

    const [bithumbData, binancePrices, krwRate] = await Promise.all([
      deps.fetchBithumbAll(),
      deps.fetchGlobalPrices(c.env.DB),
      deps.fetchKrwRate(),
    ])

    const premiums = deps.calcPremiums(bithumbData, binancePrices, krwRate)
    const insertSql = 'INSERT INTO kimchi_snapshots (id, coin, bithumb_krw, binance_usd, premium_pct, krw_usd_rate, volume_24h_usd) VALUES (?, ?, ?, ?, ?, ?, ?)'
    const statements = premiums.map((p) => c.env.DB.prepare(insertSql).bind(
      crypto.randomUUID(),
      p.coin,
      p.bithumbKrw,
      p.binanceUsd,
      p.premiumPct,
      krwRate,
      p.volume24hUsd,
    ))

    if (statements.length > 0) {
      try {
        await c.env.DB.batch(statements)
      } catch (err) {
        console.error(err)
        throw new HTTPException(500, { message: 'DB schema not migrated (kimchi_snapshots table missing)' })
      }
    }

    await deps.audit(
      c.env.DB,
      null,
      'admin.cron.snapshot_kimchi',
      'kimchi_snapshots',
      null,
      'success',
      `snapshots=${statements.length}`,
    )

    return c.json({ ok: true, snapshots: statements.length })
  })

  return cron
}
