import type {
  CrossFinClientOptions,
  CrossFinErrorBody,
  // Free
  HealthResponse,
  AgentGuideResponse,
  DiscoveryResponse,
  ArbitrageDemoResponse,
  UsdcTransfersResponse,
  // Routing (free)
  ExchangesResponse,
  FeesResponse,
  PairsResponse,
  StatusResponse,
  OptimalRouteResponse,
  RouteParams,
  // Registry
  RegistryStatsResponse,
  RegistrySearchResponse,
  RegistryCategoriesResponse,
  RegistryListResponse,
  RegistryServiceResponse,
  // ACP
  AcpStatusResponse,
  AcpQuoteParams,
  AcpQuoteResponse,
  AcpExecuteResponse,
  AcpExecutionStatusResponse,
  // Analytics
  AnalyticsOverviewResponse,
  AnalyticsServiceResponse,
  // Premium — Kimchi / Arbitrage
  KimchiResponse,
  KimchiHistoryResponse,
  OpportunitiesResponse,
  // Premium — Bithumb
  BithumbOrderbookResponse,
  BithumbVolumeAnalysisResponse,
  // Premium — Market Korea
  KoreaMarketSentimentResponse,
  UsdKrwResponse,
  UpbitTickerResponse,
  UpbitOrderbookResponse,
  UpbitSignalsResponse,
  CoinoneTickerResponse,
  CrossExchangeResponse,
  // Premium — Crypto Korea
  Korea5ExchangeResponse,
  KoreaExchangeStatusResponse,
  KoreaFxRateResponse,
  UpbitCandlesResponse,
  // Premium — Global
  GlobalIndicesChartResponse,
  // Premium — News
  KoreaHeadlinesResponse,
  // Premium — Bundles
  MorningBriefResponse,
  CryptoSnapshotResponse,
  KimchiStatsResponse,
  // Premium — Utility
  PremiumReportResponse,
  EnterpriseReportResponse,
} from './types.js'

const DEFAULT_BASE_URL = 'https://crossfin.dev'

export class CrossFinError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: CrossFinErrorBody,
  ) {
    const msg =
      status === 402
        ? `Payment required (402): This is a paid endpoint. Send USDC on Base via the x402 protocol to access it. ${body.message ?? ''}`
        : `CrossFin API error ${status}: ${body.message ?? body.error ?? JSON.stringify(body)}`
    super(msg)
    this.name = 'CrossFinError'
  }
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

export class CrossFinClient {
  private readonly baseUrl: string
  private readonly apiKey?: string

  constructor(options?: CrossFinClientOptions) {
    this.baseUrl = (options?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.apiKey = options?.apiKey
  }

  // ---------------------------------------------------------------------------
  // Internal fetch helper
  // ---------------------------------------------------------------------------

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Accept': 'application/json' }
    if (this.apiKey) headers['X-Agent-Key'] = this.apiKey
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      let errorBody: CrossFinErrorBody
      try {
        errorBody = (await res.json()) as CrossFinErrorBody
      } catch {
        errorBody = { message: res.statusText }
      }
      throw new CrossFinError(res.status, errorBody)
    }

    return (await res.json()) as T
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  // ---------------------------------------------------------------------------
  // Free endpoints
  // ---------------------------------------------------------------------------

  /** Health check — GET /api/health */
  health(): Promise<HealthResponse> {
    return this.get('/api/health')
  }

  /** Agent onboarding guide — GET /api/docs/guide */
  guide(): Promise<AgentGuideResponse> {
    return this.get('/api/docs/guide')
  }

  /** Well-known discovery metadata — GET /.well-known/crossfin.json */
  discovery(): Promise<DiscoveryResponse> {
    return this.get('/.well-known/crossfin.json')
  }

  /** On-chain USDC transfers — GET /api/onchain/usdc-transfers */
  usdcTransfers(limit?: number): Promise<UsdcTransfersResponse> {
    return this.get(`/api/onchain/usdc-transfers${qs({ limit })}`)
  }

  // ---------------------------------------------------------------------------
  // Routing (free)
  // ---------------------------------------------------------------------------

  route = {
    /** List supported exchanges — GET /api/route/exchanges */
    exchanges: (): Promise<ExchangesResponse> => this.get('/api/route/exchanges'),

    /** Fee comparison table — GET /api/route/fees */
    fees: (coin?: string): Promise<FeesResponse> => this.get(`/api/route/fees${qs({ coin })}`),

    /** Supported pairs with live prices — GET /api/route/pairs */
    pairs: (coin?: string): Promise<PairsResponse> => this.get(`/api/route/pairs${qs({ coin })}`),

    /** Exchange API health check — GET /api/route/status */
    status: (): Promise<StatusResponse> => this.get('/api/route/status'),

    /** Free live optimal route — GET /api/routing/optimal */
    optimal: (params?: Partial<RouteParams>): Promise<OptimalRouteResponse> =>
      this.get(`/api/routing/optimal${qs({ from: params?.from, to: params?.to, amount: params?.amount, strategy: params?.strategy })}`),
  }

  // ---------------------------------------------------------------------------
  // Arbitrage (free)
  // ---------------------------------------------------------------------------

  arbitrage = {
    /** Free Route Spread preview (top 3 pairs) — GET /api/arbitrage/demo */
    demo: (): Promise<ArbitrageDemoResponse> => this.get('/api/arbitrage/demo'),
  }

  // ---------------------------------------------------------------------------
  // Registry (free)
  // ---------------------------------------------------------------------------

  registry = {
    /** Registry stats — GET /api/registry/stats */
    stats: (): Promise<RegistryStatsResponse> => this.get('/api/registry/stats'),

    /** Search services — GET /api/registry/search */
    search: (query: string, options?: { limit?: number; offset?: number }): Promise<RegistrySearchResponse> =>
      this.get(`/api/registry/search${qs({ q: query, limit: options?.limit, offset: options?.offset })}`),

    /** List categories — GET /api/registry/categories */
    categories: (): Promise<RegistryCategoriesResponse> => this.get('/api/registry/categories'),

    /** List services — GET /api/registry */
    list: (options?: { category?: string; provider?: string; isCrossfin?: boolean; limit?: number; offset?: number }): Promise<RegistryListResponse> =>
      this.get(`/api/registry${qs({ category: options?.category, provider: options?.provider, isCrossfin: options?.isCrossfin, limit: options?.limit, offset: options?.offset })}`),

    /** Get service by ID — GET /api/registry/:id */
    get: (id: string): Promise<RegistryServiceResponse> => this.get(`/api/registry/${encodeURIComponent(id)}`),
  }

  // ---------------------------------------------------------------------------
  // ACP
  // ---------------------------------------------------------------------------

  acp = {
    /** ACP protocol status — GET /api/acp/status */
    status: (): Promise<AcpStatusResponse> => this.get('/api/acp/status'),

    /** Request routing quote — POST /api/acp/quote */
    quote: (params: AcpQuoteParams): Promise<AcpQuoteResponse> => this.post('/api/acp/quote', params),

    /** Start tracked execution — POST /api/acp/execute */
    execute: (quoteId: string): Promise<AcpExecuteResponse> => this.post('/api/acp/execute', { quote_id: quoteId }),

    /** Get execution progress — GET /api/acp/executions/:executionId */
    execution: (executionId: string): Promise<AcpExecutionStatusResponse> =>
      this.get(`/api/acp/executions/${encodeURIComponent(executionId)}`),
  }

  // ---------------------------------------------------------------------------
  // Analytics (free)
  // ---------------------------------------------------------------------------

  analytics = {
    /** Analytics overview — GET /api/analytics/overview */
    overview: (): Promise<AnalyticsOverviewResponse> => this.get('/api/analytics/overview'),

    /** Analytics per service — GET /api/analytics/services/:serviceId */
    service: (serviceId: string): Promise<AnalyticsServiceResponse> =>
      this.get(`/api/analytics/services/${encodeURIComponent(serviceId)}`),
  }

  // ---------------------------------------------------------------------------
  // Premium endpoints (x402 payment required)
  // ---------------------------------------------------------------------------

  premium = {
    // -- Kimchi / Arbitrage --

    /** Full Route Spread Index — $0.05 USDC */
    kimchi: (): Promise<KimchiResponse> => this.get('/api/premium/arbitrage/kimchi'),

    /** Route Spread History (hourly) — $0.05 USDC */
    kimchiHistory: (options?: { coin?: string; hours?: number }): Promise<KimchiHistoryResponse> =>
      this.get(`/api/premium/arbitrage/kimchi/history${qs({ coin: options?.coin, hours: options?.hours })}`),

    /** Arbitrage Decision Service — $0.10 USDC */
    opportunities: (): Promise<OpportunitiesResponse> => this.get('/api/premium/arbitrage/opportunities'),

    // -- Bithumb --

    /** Live Bithumb Orderbook — $0.02 USDC */
    bithumbOrderbook: (pair?: string): Promise<BithumbOrderbookResponse> =>
      this.get(`/api/premium/bithumb/orderbook${qs({ pair })}`),

    /** Bithumb 24h Volume Analysis — $0.03 USDC */
    bithumbVolumeAnalysis: (): Promise<BithumbVolumeAnalysisResponse> =>
      this.get('/api/premium/bithumb/volume-analysis'),

    // -- Market Korea --

    /** Korean Market Sentiment — $0.03 USDC */
    koreaMarketSentiment: (): Promise<KoreaMarketSentimentResponse> =>
      this.get('/api/premium/market/korea'),

    /** USD/KRW Exchange Rate — $0.01 USDC */
    usdKrw: (): Promise<UsdKrwResponse> => this.get('/api/premium/market/fx/usdkrw'),

    /** Upbit Ticker (KRW market) — $0.02 USDC */
    upbitTicker: (market?: string): Promise<UpbitTickerResponse> =>
      this.get(`/api/premium/market/upbit/ticker${qs({ market })}`),

    /** Upbit Orderbook (KRW market) — $0.02 USDC */
    upbitOrderbook: (market?: string): Promise<UpbitOrderbookResponse> =>
      this.get(`/api/premium/market/upbit/orderbook${qs({ market })}`),

    /** Upbit Trading Signals — $0.05 USDC */
    upbitSignals: (): Promise<UpbitSignalsResponse> => this.get('/api/premium/market/upbit/signals'),

    /** Coinone Ticker (KRW market) — $0.02 USDC */
    coinoneTicker: (currency?: string): Promise<CoinoneTickerResponse> =>
      this.get(`/api/premium/market/coinone/ticker${qs({ currency })}`),

    /** Cross-Exchange Decision Service — $0.08 USDC */
    crossExchange: (coins?: string): Promise<CrossExchangeResponse> =>
      this.get(`/api/premium/market/cross-exchange${qs({ coins })}`),


    // -- Crypto Korea --

    /** Korea 5-Exchange Price Compare — $0.08 USDC */
    korea5Exchange: (coin?: string): Promise<Korea5ExchangeResponse> =>
      this.get(`/api/premium/crypto/korea/5exchange${qs({ coin })}`),

    /** Korea Exchange Status — $0.03 USDC */
    koreaExchangeStatus: (): Promise<KoreaExchangeStatusResponse> =>
      this.get('/api/premium/crypto/korea/exchange-status'),

    /** Korea FX Rate (CRIX) — $0.01 USDC */
    koreaFxRate: (): Promise<KoreaFxRateResponse> => this.get('/api/premium/crypto/korea/fx-rate'),

    /** Upbit Candles — $0.02 USDC */
    upbitCandles: (options?: { coin?: string; type?: string; count?: number }): Promise<UpbitCandlesResponse> =>
      this.get(`/api/premium/crypto/korea/upbit-candles${qs({ coin: options?.coin, type: options?.type, count: options?.count })}`),

    // -- Global --

    /** Global Indices Chart — $0.02 USDC */
    globalIndicesChart: (options?: { index?: string; period?: string }): Promise<GlobalIndicesChartResponse> =>
      this.get(`/api/premium/market/global/indices-chart${qs({ index: options?.index, period: options?.period })}`),

    // -- News --

    /** Korean Headlines (RSS) — $0.03 USDC */
    koreaHeadlines: (limit?: number): Promise<KoreaHeadlinesResponse> =>
      this.get(`/api/premium/news/korea/headlines${qs({ limit })}`),

    // -- Bundles --

    /** Morning Brief — $0.20 USDC */
    morningBrief: (): Promise<MorningBriefResponse> => this.get('/api/premium/morning/brief'),

    /** Crypto Snapshot — $0.15 USDC */
    cryptoSnapshot: (): Promise<CryptoSnapshotResponse> => this.get('/api/premium/crypto/snapshot'),

    /** Route Spread Stats — $0.15 USDC */
    kimchiStats: (): Promise<KimchiStatsResponse> => this.get('/api/premium/kimchi/stats'),

    // -- Routing (paid) --

    /** Optimal Route Finder — $0.10 USDC */
    routeFind: (params: RouteParams): Promise<OptimalRouteResponse> =>
      this.get(`/api/premium/route/find${qs({ from: params.from, to: params.to, amount: params.amount, strategy: params.strategy })}`),

    // -- Utility --

    /** Premium Report (x402 check) — $0.001 USDC */
    report: (): Promise<PremiumReportResponse> => this.get('/api/premium/report'),

    /** Enterprise Receipt — $20.00 USDC */
    enterprise: (): Promise<EnterpriseReportResponse> => this.get('/api/premium/enterprise'),
  }
}
