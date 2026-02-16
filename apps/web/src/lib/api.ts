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

export type RegistryService = {
  id: string
  name: string
  description: string | null
  provider: string
  category: string
  endpoint: string
  method: string
  price: string
  currency: string
  network: string | null
  payTo: string | null
  tags: string[]
  status: 'active' | 'disabled'
  isCrossfin: boolean
  createdAt: string
  updatedAt: string
}

export type RegistryListResponse = {
  data: RegistryService[]
  total: number
  limit: number
  offset: number
  at: string
}

export type RegistryStats = {
  total: number
  crossfin: number
  external: number
}

export type RegistryCategory = {
  category: string
  count: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function parseRegistryService(value: unknown): RegistryService {
  if (!isRecord(value)) throw new Error('registry_service_invalid')
  return {
    id: String(value.id ?? ''),
    name: String(value.name ?? ''),
    description: value.description === null || value.description === undefined ? null : String(value.description),
    provider: String(value.provider ?? ''),
    category: String(value.category ?? ''),
    endpoint: String(value.endpoint ?? ''),
    method: String(value.method ?? ''),
    price: String(value.price ?? ''),
    currency: String(value.currency ?? ''),
    network: value.network === null || value.network === undefined ? null : String(value.network),
    payTo: value.payTo === null || value.payTo === undefined ? null : String(value.payTo),
    tags: toStringArray(value.tags),
    status: value.status === 'disabled' ? 'disabled' : 'active',
    isCrossfin: Boolean(value.isCrossfin),
    createdAt: String(value.createdAt ?? ''),
    updatedAt: String(value.updatedAt ?? ''),
  }
}

export async function fetchRegistryStats(signal?: AbortSignal): Promise<RegistryStats> {
  const res = await fetch(`${apiBaseUrl()}/api/registry/stats`, { signal })
  if (!res.ok) throw new Error(`registry_stats_failed:${res.status}`)
  const data: unknown = await res.json()
  if (!isRecord(data) || !isRecord(data.services)) throw new Error('registry_stats_invalid')
  return {
    total: Number(data.services.total ?? 0),
    crossfin: Number(data.services.crossfin ?? 0),
    external: Number(data.services.external ?? 0),
  }
}

export async function fetchRegistryCategories(signal?: AbortSignal): Promise<RegistryCategory[]> {
  const res = await fetch(`${apiBaseUrl()}/api/registry/categories`, { signal })
  if (!res.ok) throw new Error(`registry_categories_failed:${res.status}`)
  const data: unknown = await res.json()
  if (!isRecord(data) || !Array.isArray(data.data)) throw new Error('registry_categories_invalid')
  return data.data
    .filter((row): row is Record<string, unknown> => isRecord(row))
    .map((row) => ({ category: String(row.category ?? ''), count: Number(row.count ?? 0) }))
    .filter((row) => row.category)
}

export async function fetchRegistryServices(params?: {
  category?: string
  provider?: string
  isCrossfin?: boolean
  limit?: number
  offset?: number
}, signal?: AbortSignal): Promise<RegistryListResponse> {
  const qs = new URLSearchParams()
  if (params?.category) qs.set('category', params.category)
  if (params?.provider) qs.set('provider', params.provider)
  if (typeof params?.isCrossfin === 'boolean') qs.set('isCrossfin', params.isCrossfin ? 'true' : 'false')
  if (typeof params?.limit === 'number') qs.set('limit', String(params.limit))
  if (typeof params?.offset === 'number') qs.set('offset', String(params.offset))

  const url = `${apiBaseUrl()}/api/registry${qs.toString() ? `?${qs}` : ''}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`registry_list_failed:${res.status}`)
  const data: unknown = await res.json()
  if (!isRecord(data) || !Array.isArray(data.data)) throw new Error('registry_list_invalid')
  return {
    data: data.data.map(parseRegistryService),
    total: Number(data.total ?? 0),
    limit: Number(data.limit ?? 0),
    offset: Number(data.offset ?? 0),
    at: String(data.at ?? ''),
  }
}

export async function searchRegistryServices(q: string, params?: { limit?: number; offset?: number }, signal?: AbortSignal): Promise<RegistryListResponse> {
  const query = q.trim()
  if (!query) throw new Error('registry_search_q_required')

  const qs = new URLSearchParams({ q: query })
  if (typeof params?.limit === 'number') qs.set('limit', String(params.limit))
  if (typeof params?.offset === 'number') qs.set('offset', String(params.offset))

  const res = await fetch(`${apiBaseUrl()}/api/registry/search?${qs.toString()}`, { signal })
  if (!res.ok) throw new Error(`registry_search_failed:${res.status}`)
  const data: unknown = await res.json()
  if (!isRecord(data) || !Array.isArray(data.data)) throw new Error('registry_search_invalid')
  return {
    data: data.data.map(parseRegistryService),
    total: Number(data.total ?? 0),
    limit: Number(data.limit ?? 0),
    offset: Number(data.offset ?? 0),
    at: String(data.at ?? ''),
  }
}

export type AnalyticsOverview = {
  totalCalls: number
  totalServices: number
  crossfinServices: number
  topServices: Array<{ serviceId: string; serviceName: string; calls: number }>
  recentCalls: Array<{ serviceId: string; serviceName: string; status: string; responseTimeMs: number; createdAt: string }>
}

export type FunnelEventName =
  | 'mcp_quickstart_view'
  | 'mcp_command_copy'
  | 'mcp_config_view'
  | 'mcp_config_copy'
  | 'mcp_guide_open'
  | 'mcp_install_verify'

export type FunnelOverview = {
  window: { days: number }
  counts: Record<FunnelEventName, number>
  conversion: {
    commandCopyPct: number
    configViewPct: number
    configCopyPct: number
    guideOpenPct: number
    installVerifyPct: number
  }
  uniqueVisitors: number
  topSources: Array<{ source: string; count: number }>
  at: string
}

export async function fetchAnalytics(signal?: AbortSignal): Promise<AnalyticsOverview> {
  const res = await fetch(`${apiBaseUrl()}/api/analytics/overview`, { signal })
  if (!res.ok) throw new Error(`analytics_failed:${res.status}`)
  const data: unknown = await res.json()
  if (!isRecord(data)) throw new Error('analytics_invalid')
  return {
    totalCalls: Number(data.totalCalls ?? 0),
    totalServices: Number(data.totalServices ?? 0),
    crossfinServices: Number(data.crossfinServices ?? 0),
    topServices: Array.isArray(data.topServices) ? data.topServices.map((s: unknown) => {
      const svc = s as Record<string, unknown>
      return {
        serviceId: String(svc.serviceId ?? ''),
        serviceName: String(svc.serviceName ?? ''),
        calls: Number(svc.calls ?? 0),
      }
    }) : [],
    recentCalls: Array.isArray(data.recentCalls) ? data.recentCalls.map((c: unknown) => {
      const call = c as Record<string, unknown>
      return {
        serviceId: String(call.serviceId ?? ''),
        serviceName: String(call.serviceName ?? ''),
        status: String(call.status ?? ''),
        responseTimeMs: Number(call.responseTimeMs ?? 0),
        createdAt: String(call.createdAt ?? ''),
      }
    }) : [],
  }
}

const DEFAULT_FUNNEL_COUNTS: Record<FunnelEventName, number> = {
  mcp_quickstart_view: 0,
  mcp_command_copy: 0,
  mcp_config_view: 0,
  mcp_config_copy: 0,
  mcp_guide_open: 0,
  mcp_install_verify: 0,
}

function parseFunnelEventName(value: unknown): FunnelEventName | null {
  switch (value) {
    case 'mcp_quickstart_view':
    case 'mcp_command_copy':
    case 'mcp_config_view':
    case 'mcp_config_copy':
    case 'mcp_guide_open':
    case 'mcp_install_verify':
      return value
    default:
      return null
  }
}

export async function fetchFunnelOverview(signal?: AbortSignal): Promise<FunnelOverview> {
  const res = await fetch(`${apiBaseUrl()}/api/analytics/funnel/overview`, { signal })
  if (!res.ok) throw new Error(`funnel_overview_failed:${res.status}`)
  const data: unknown = await res.json()
  if (!isRecord(data)) throw new Error('funnel_overview_invalid')

  const countsRaw = isRecord(data.counts) ? data.counts : {}
  const counts = { ...DEFAULT_FUNNEL_COUNTS }
  for (const [key, value] of Object.entries(countsRaw)) {
    const eventName = parseFunnelEventName(key)
    if (!eventName) continue
    counts[eventName] = Number(value ?? 0)
  }

  const conversionRaw = isRecord(data.conversion) ? data.conversion : {}

  return {
    window: { days: Number(isRecord(data.window) ? data.window.days : 7) },
    counts,
    conversion: {
      commandCopyPct: Number(conversionRaw.commandCopyPct ?? 0),
      configViewPct: Number(conversionRaw.configViewPct ?? 0),
      configCopyPct: Number(conversionRaw.configCopyPct ?? 0),
      guideOpenPct: Number(conversionRaw.guideOpenPct ?? 0),
      installVerifyPct: Number(conversionRaw.installVerifyPct ?? 0),
    },
    uniqueVisitors: Number(data.uniqueVisitors ?? 0),
    topSources: Array.isArray(data.topSources) ? data.topSources.map((s: unknown) => {
      const source = s as Record<string, unknown>
      return { source: String(source.source ?? ''), count: Number(source.count ?? 0) }
    }) : [],
    at: String(data.at ?? ''),
  }
}

export async function trackFunnelEvent(input: {
  eventName: FunnelEventName
  source?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/api/analytics/funnel/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventName: input.eventName,
      source: input.source ?? 'web',
      metadata: input.metadata,
    }),
    keepalive: true,
  })

  if (!res.ok && res.status !== 202) {
    throw new Error(`funnel_track_failed:${res.status}`)
  }
}

export async function createRegistryService(input: {
  agentKey: string
  name: string
  provider: string
  category: string
  endpoint: string
  method?: string
  price: string
  currency?: string
  network?: string | null
  payTo?: string | null
  tags?: string[]
}): Promise<RegistryService> {
  const agentKey = input.agentKey.trim()
  if (!agentKey) throw new Error('agent_key_required')

  const res = await fetch(`${apiBaseUrl()}/api/registry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Key': agentKey,
    },
    body: JSON.stringify({
      name: input.name,
      provider: input.provider,
      category: input.category,
      endpoint: input.endpoint,
      method: input.method,
      price: input.price,
      currency: input.currency,
      network: input.network,
      payTo: input.payTo,
      tags: input.tags,
    }),
  })

  if (!res.ok) throw new Error(`registry_create_failed:${res.status}`)
  const data: unknown = await res.json()
  if (!isRecord(data) || !('data' in data)) throw new Error('registry_create_invalid')
  return parseRegistryService((data as { data: unknown }).data)
}
