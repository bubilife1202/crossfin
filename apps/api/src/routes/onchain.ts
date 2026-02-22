import { Hono } from 'hono'
import type { Env } from '../types'
import {
  BASE_USDC_ADDRESS,
  USDC_DECIMALS,
  fetchRecentUsdcTransfers,
  type UsdcTransfer,
} from '../lib/onchain'

type Cached = { transfers: UsdcTransfer[]; expiresAt: number }

const onchain = new Hono<Env>()

onchain.get('/api/onchain/usdc-transfers', async (c) => {
  const limit = Math.min(20, Math.max(1, Number(c.req.query('limit') ?? '10') || 10))
  const wallet = c.env.PAYMENT_RECEIVER_ADDRESS
  const cacheTtlMs = 20_000

  const globalAny = globalThis as unknown as {
    __crossfinUsdcTransfersCache?: Cached
    __crossfinUsdcTransfersInFlight?: Promise<void> | null
  }

  const now = Date.now()
  const cached = globalAny.__crossfinUsdcTransfersCache
  const fresh = Boolean(cached && now < cached.expiresAt)

  if (!fresh && !globalAny.__crossfinUsdcTransfersInFlight) {
    const refreshPromise = fetchRecentUsdcTransfers(wallet, 20)
      .then((transfers) => {
        globalAny.__crossfinUsdcTransfersCache = { transfers, expiresAt: Date.now() + cacheTtlMs }
      })
      .catch((err) => {
        console.error('usdc-transfers fetch failed', err)
        const fallback = cached?.transfers ?? []
        globalAny.__crossfinUsdcTransfersCache = { transfers: fallback, expiresAt: Date.now() + cacheTtlMs }
      })
      .finally(() => {
        globalAny.__crossfinUsdcTransfersInFlight = null
      })

    globalAny.__crossfinUsdcTransfersInFlight = refreshPromise
    c.executionCtx.waitUntil(refreshPromise)
  }

  return c.json({
    wallet,
    contract: BASE_USDC_ADDRESS,
    token: { symbol: 'USDC', decimals: USDC_DECIMALS },
    transfers: (cached?.transfers ?? []).slice(0, limit),
    fresh,
    at: new Date().toISOString(),
  })
})

export default onchain
