// ---------------------------------------------------------------------------
// CrossFin SDK — Response types derived from OpenAPI spec v1.8.9
// ---------------------------------------------------------------------------

/** GET /api/health */
export interface HealthResponse {
  name: string
  version: string
  status: string
}

/** GET /api/docs/guide */
export interface AgentGuideResponse {
  [key: string]: unknown
}

/** GET /.well-known/crossfin.json */
export interface DiscoveryResponse {
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Arbitrage
// ---------------------------------------------------------------------------

export interface ArbitrageDemoDecision {
  indicator: string
  signalStrength: number
  reason: string
}

export interface ArbitrageDemoPreview {
  coin: string
  premiumPct: number
  direction: string
  decision: ArbitrageDemoDecision
}

/** GET /api/arbitrage/demo */
export interface ArbitrageDemoResponse {
  demo: boolean
  note: string
  paidEndpoint: string
  pairsShown: number
  totalPairsAvailable: number
  krwUsdRate: number
  preview: ArbitrageDemoPreview[]
  avgPremiumPct: number
  favorableCandidates: number
  marketCondition: string
  at: string
}

// ---------------------------------------------------------------------------
// Route Spread (Kimchi Premium)
// ---------------------------------------------------------------------------

export interface KimchiPremiumItem {
  coin: string
  bithumbKrw: number
  bithumbUsd: number
  binanceUsd: number
  premiumPct: number
  volume24hKrw: number
  volume24hUsd: number
  change24hPct: number
}

/** GET /api/premium/arbitrage/kimchi */
export interface KimchiResponse {
  paid: boolean
  service: string
  krwUsdRate: number
  pairsTracked: number
  avgPremiumPct: number
  topPremium: Record<string, unknown>
  premiums: KimchiPremiumItem[]
  at: string
}

/** GET /api/premium/arbitrage/kimchi/history */
export interface KimchiHistoryResponse {
  paid: boolean
  service: string
  coin: string | null
  hours: number
  groupedBy: string
  range: Record<string, unknown>
  snapshots: Record<string, unknown>[]
  count: number
  at: string
}

// ---------------------------------------------------------------------------
// Arbitrage Opportunities
// ---------------------------------------------------------------------------

export interface ArbitrageOpportunity {
  coin: string
  direction: string
  grossPremiumPct: number
  estimatedFeesPct: number
  tradingFeesPct: number
  withdrawalFeePct: number
  withdrawalSuspended: boolean
  netProfitPct: number
  profitPer10kUsd: number
  volume24hUsd: number
  riskScore: string
  profitable: boolean
  slippageEstimatePct: number
  transferTimeMin: number
  premiumTrend: 'rising' | 'falling' | 'stable'
  indicator: 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE'
  signalStrength: number
  reason: string
}

/** GET /api/premium/arbitrage/opportunities */
export interface OpportunitiesResponse {
  paid: boolean
  service: string
  krwUsdRate: number
  totalOpportunities: number
  profitableCount: number
  favorableCandidates: number
  marketCondition: 'favorable' | 'neutral' | 'unfavorable'
  estimatedFeesNote: string
  bestOpportunity: Record<string, unknown>
  opportunities: ArbitrageOpportunity[]
  at: string
}

// ---------------------------------------------------------------------------
// Bithumb
// ---------------------------------------------------------------------------

export interface OrderbookEntry {
  price: string
  quantity: string
}

/** GET /api/premium/bithumb/orderbook */
export interface BithumbOrderbookResponse {
  paid: boolean
  service: string
  pair: string
  exchange: string
  bestBidKrw: number
  bestAskKrw: number
  spreadKrw: number
  spreadPct: number
  bestBidUsd: number
  bestAskUsd: number
  depth: {
    bids: OrderbookEntry[]
    asks: OrderbookEntry[]
  }
  at: string
}

/** GET /api/premium/bithumb/volume-analysis */
export interface BithumbVolumeAnalysisResponse {
  paid: boolean
  service: string
  totalVolume24hKrw: number
  totalVolume24hUsd: number
  totalCoins: number
  volumeConcentration: {
    top5Pct: number
    top5Coins: Record<string, unknown>[]
  }
  volumeWeightedChangePct: number
  unusualVolume: Record<string, unknown>[]
  topByVolume: Record<string, unknown>[]
  at: string
}

// ---------------------------------------------------------------------------
// Market — Korea
// ---------------------------------------------------------------------------

/** GET /api/premium/market/korea */
export interface KoreaMarketSentimentResponse {
  paid: boolean
  service: string
  exchange: string
  totalCoins: number
  totalVolume24hUsd: number
  avgChange24hPct: number
  marketMood: 'bullish' | 'bearish' | 'neutral'
  topGainers: Record<string, unknown>[]
  topLosers: Record<string, unknown>[]
  topVolume: Record<string, unknown>[]
  krwUsdRate: number
  at: string
}

/** GET /api/premium/market/fx/usdkrw */
export interface UsdKrwResponse {
  paid: boolean
  service: string
  usdKrw: number
  at: string
  [key: string]: unknown
}

/** GET /api/premium/market/upbit/ticker */
export interface UpbitTickerResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/market/upbit/orderbook */
export interface UpbitOrderbookResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

export interface UpbitSignal {
  market: string
  priceKrw: number
  change24hPct: number
  volume24hKrw: number
  volatilityPct: number
  volumeSignal: 'high' | 'normal' | 'low'
  momentum: 'strong-up' | 'up' | 'neutral' | 'down' | 'strong-down'
  signal: 'bullish' | 'bearish' | 'neutral'
  confidence: 'high' | 'medium' | 'low'
}

/** GET /api/premium/market/upbit/signals */
export interface UpbitSignalsResponse {
  paid: boolean
  service: string
  signals: UpbitSignal[]
  marketSummary: {
    bullishCount: number
    bearishCount: number
    neutralCount: number
    overallSentiment: 'bullish' | 'bearish' | 'neutral'
  }
  at: string
}

/** GET /api/premium/market/coinone/ticker */
export interface CoinoneTickerResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Cross-Exchange
// ---------------------------------------------------------------------------

export interface CrossExchangeCoin {
  coin: string
  bestBuyExchange: string
  bestSellExchange: string
  spreadPct: number
  indicator: 'SPREAD_OPPORTUNITY' | 'NEUTRAL_SIGNAL' | 'MONITORING'
}

/** GET /api/premium/market/cross-exchange */
export interface CrossExchangeResponse {
  paid: boolean
  service: string
  coinsCompared: number
  krwUsdRate: number
  spreadOpportunityCount: number
  coins: CrossExchangeCoin[]
  at: string
}

// ---------------------------------------------------------------------------
// Korea Indices
// ---------------------------------------------------------------------------

/** GET /api/premium/market/korea/indices */
export interface KoreaIndicesResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/market/korea/indices/history */
export interface KoreaIndicesHistoryResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Korea Stocks
// ---------------------------------------------------------------------------

/** GET /api/premium/market/korea/stocks/momentum */
export interface KoreaStocksMomentumResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/market/korea/investor-flow */
export interface KoreaInvestorFlowResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/market/korea/index-flow */
export interface KoreaIndexFlowResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/market/korea/stock-detail */
export interface KoreaStockDetailResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/market/korea/stock-news */
export interface KoreaStockNewsResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/market/korea/themes */
export interface KoreaThemesResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/market/korea/disclosure */
export interface KoreaDisclosureResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/market/korea/etf */
export interface KoreaEtfResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Korea Stock Brief (bundle)
// ---------------------------------------------------------------------------

/** GET /api/premium/market/korea/stock-brief */
export interface StockBriefResponse {
  paid: boolean
  service: string
  stock: string
  name: string | null
  detail: Record<string, unknown> | null
  news: Record<string, unknown>[]
  investorFlow: Record<string, unknown> | null
  disclosures: Record<string, unknown>[]
  at: string
}

// ---------------------------------------------------------------------------
// Crypto Korea
// ---------------------------------------------------------------------------

/** GET /api/premium/crypto/korea/5exchange */
export interface Korea5ExchangeResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/crypto/korea/exchange-status */
export interface KoreaExchangeStatusResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/crypto/korea/fx-rate */
export interface KoreaFxRateResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/crypto/korea/upbit-candles */
export interface UpbitCandlesResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Global Markets
// ---------------------------------------------------------------------------

/** GET /api/premium/market/global/indices-chart */
export interface GlobalIndicesChartResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

/** GET /api/premium/news/korea/headlines */
export interface KoreaHeadlinesResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

/** GET /api/premium/morning/brief */
export interface MorningBriefResponse {
  paid: boolean
  service: string
  kimchiPremium: {
    avgPremiumPct: number
    topPair: string
    pairsTracked: number
    premiums: Record<string, unknown>[]
  }
  fxRate: {
    usdKrw: number
    source: string
  }
  indices: {
    kospi: { price: number; changePct: number; volume: number; status: string }
    kosdaq: { price: number; changePct: number; volume: number; status: string }
  }
  momentum: {
    topGainers: Record<string, unknown>[]
    topLosers: Record<string, unknown>[]
    market: string
  }
  headlines: Record<string, unknown>[]
  at: string
}

/** GET /api/premium/crypto/snapshot */
export interface CryptoSnapshotResponse {
  paid: boolean
  service: string
  kimchiPremium: {
    avgPremiumPct: number
    topPair: string
    pairsTracked: number
    premiums: Record<string, unknown>[]
  }
  fxRate: { usdKrw: number }
  exchanges: {
    upbit: { krw: number; usd: number } | null
    bithumb: { krw: number; usd: number } | null
    coinone: { krw: number; usd: number } | null
    gopax: { krw: number; usd: number } | null
    spread: { minUsd: number; maxUsd: number; spreadPct: number }
  }
  volumeAnalysis: {
    totalVolume24hKrw: number
    totalVolume24hUsd: number
    topByVolume: Record<string, unknown>[]
  }
  at: string
}

/** GET /api/premium/kimchi/stats */
export interface KimchiStatsResponse {
  paid: boolean
  service: string
  current: {
    avgPremiumPct: number
    topPair: { coin: string; premiumPct: number }
    bottomPair: { coin: string; premiumPct: number }
    pairsTracked: number
    premiums: Record<string, unknown>[]
  }
  trend: {
    direction: 'rising' | 'falling' | 'stable'
    current24hAvg: number
    previous24hAvg: number
    changePct: number
  }
  bestOpportunity: {
    coin: string
    premiumPct: number
    indicator: 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE'
    signalStrength: number
    reason: string
  }
  crossExchangeSpread: {
    coin: string
    upbitKrw: number | null
    bithumbKrw: number | null
    coinoneKrw: number | null
    spreadPct: number
    bestBuy: string
    bestSell: string
  }
  fxRate: { usdKrw: number }
  at: string
}

// ---------------------------------------------------------------------------
// Premium Utility
// ---------------------------------------------------------------------------

/** GET /api/premium/report */
export interface PremiumReportResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

/** GET /api/premium/enterprise */
export interface EnterpriseReportResponse {
  paid: boolean
  service: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface RouteParams {
  from: string
  to: string
  amount: number
  strategy?: 'cheapest' | 'fastest' | 'balanced'
}

/** GET /api/routing/optimal & GET /api/premium/route/find */
export interface OptimalRouteResponse {
  [key: string]: unknown
}

/** GET /api/route/exchanges */
export interface ExchangesResponse {
  [key: string]: unknown
}

/** GET /api/route/fees */
export interface FeesResponse {
  [key: string]: unknown
}

/** GET /api/route/pairs */
export interface PairsResponse {
  [key: string]: unknown
}

/** GET /api/route/status */
export interface StatusResponse {
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// On-chain
// ---------------------------------------------------------------------------

export interface UsdcTransfer {
  hash: string
  from: string
  to: string
  value: string
  tokenDecimal: string
  timeStamp: string
}

/** GET /api/onchain/usdc-transfers */
export interface UsdcTransfersResponse {
  wallet: string
  contract: string
  token: { symbol: string; decimals: number }
  transfers: UsdcTransfer[]
  at: string
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** GET /api/registry/stats */
export interface RegistryStatsResponse {
  [key: string]: unknown
}

/** GET /api/registry/search */
export interface RegistrySearchResponse {
  [key: string]: unknown
}

/** GET /api/registry/categories */
export interface RegistryCategoriesResponse {
  [key: string]: unknown
}

/** GET /api/registry */
export interface RegistryListResponse {
  [key: string]: unknown
}

/** GET /api/registry/:id */
export interface RegistryServiceResponse {
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// ACP
// ---------------------------------------------------------------------------

/** GET /api/acp/status */
export interface AcpStatusResponse {
  [key: string]: unknown
}

export interface AcpQuoteParams {
  from: string
  to: string
  amount: number
  strategy?: 'cheapest' | 'fastest' | 'balanced'
}

/** POST /api/acp/quote */
export interface AcpQuoteResponse {
  [key: string]: unknown
}

/** POST /api/acp/execute */
export interface AcpExecuteResponse {
  [key: string]: unknown
}

/** GET /api/acp/executions/:executionId */
export interface AcpExecutionStatusResponse {
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/** GET /api/analytics/overview */
export interface AnalyticsOverviewResponse {
  [key: string]: unknown
}

/** GET /api/analytics/services/:serviceId */
export interface AnalyticsServiceResponse {
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface CrossFinClientOptions {
  apiKey?: string
  baseUrl?: string
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export interface CrossFinErrorBody {
  error?: string
  message?: string
  [key: string]: unknown
}
