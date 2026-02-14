export type ApiStats = {
  agents: number
  wallets: number
  transactions: number
  blocked: number
}

export type PremiumAccept = {
  scheme: string
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds?: number
  extra?: Record<string, unknown>
}

export type PaymentRequired = {
  x402Version: number
  error?: string
  resource: { url: string; description?: string; mimeType?: string }
  accepts: PremiumAccept[]
}

export type ArbitragePair = {
  coin: string
  premiumPct: number
  direction: string
}

export type ArbitrageDemoResponse = {
  demo: boolean
  note: string
  paidEndpoint: string
  pairsShown: number
  totalPairsAvailable: number
  preview: ArbitragePair[]
  avgPremiumPct: number
  at: string
}

function apiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  if (raw) return raw.replace(/\/$/, '')

  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'crossfin.dev' || host === 'www.crossfin.dev') {
      return window.location.origin
    }
  }

  return 'https://crossfin.dev'
}

export function getApiBaseUrl(): string {
  return apiBaseUrl()
}

export async function fetchArbitrageDemo(signal?: AbortSignal): Promise<ArbitrageDemoResponse> {
  const res = await fetch(`${apiBaseUrl()}/api/arbitrage/demo`, { signal })
  if (!res.ok) throw new Error(`arbitrage_demo_failed:${res.status}`)
  const data: unknown = await res.json()
  if (!data || typeof data !== 'object') throw new Error('arbitrage_demo_invalid')
  const d = data as Record<string, unknown>
  const preview = Array.isArray(d.preview) ? d.preview : []
  return {
    demo: Boolean(d.demo),
    note: String(d.note ?? ''),
    paidEndpoint: String(d.paidEndpoint ?? ''),
    pairsShown: Number(d.pairsShown ?? 0),
    totalPairsAvailable: Number(d.totalPairsAvailable ?? 0),
    preview: preview.map((p: unknown) => {
      const pair = p as Record<string, unknown>
      return {
        coin: String(pair.coin ?? ''),
        premiumPct: Number(pair.premiumPct ?? 0),
        direction: String(pair.direction ?? ''),
      }
    }),
    avgPremiumPct: Number(d.avgPremiumPct ?? 0),
    at: String(d.at ?? ''),
  }
}

export async function fetchStats(signal?: AbortSignal): Promise<ApiStats> {
  const res = await fetch(`${apiBaseUrl()}/api/stats`, { signal })
  if (!res.ok) throw new Error(`stats_failed:${res.status}`)
  const data: unknown = await res.json()
  if (!data || typeof data !== 'object') throw new Error('stats_invalid')
  const s = data as Record<string, unknown>
  return {
    agents: Number(s.agents ?? 0),
    wallets: Number(s.wallets ?? 0),
    transactions: Number(s.transactions ?? 0),
    blocked: Number(s.blocked ?? 0),
  }
}

export async function fetchPaymentRequired(path: string, signal?: AbortSignal): Promise<PaymentRequired | null> {
  const p = path.startsWith('/') ? path : `/${path}`
  const res = await fetch(`${apiBaseUrl()}${p}`, { method: 'GET', signal })
  if (res.status !== 402) return null

  const header = res.headers.get('PAYMENT-REQUIRED')
  if (!header) return null

  try {
    const json = atob(header)
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    const pr = parsed as PaymentRequired
    if (!Array.isArray(pr.accepts)) return null
    return pr
  } catch {
    return null
  }
}

export async function fetchPremiumPaymentRequired(signal?: AbortSignal): Promise<PaymentRequired | null> {
  return fetchPaymentRequired('/api/premium/report', signal)
}

export async function fetchEnterprisePaymentRequired(signal?: AbortSignal): Promise<PaymentRequired | null> {
  return fetchPaymentRequired('/api/premium/enterprise', signal)
}
