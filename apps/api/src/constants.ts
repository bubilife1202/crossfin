export const CROSSFIN_DISCLAIMER =
  'This data is provided "AS IS" for informational purposes only. ' +
  'It does not constitute investment advice. Data accuracy, completeness, ' +
  'and timeliness are not guaranteed. All trading decisions are at the ' +
  "user's sole risk. CrossFin is not liable for any losses arising from " +
  'the use of this data. | ' +
  '본 데이터는 정보 제공 목적의 "있는 그대로" 제공이며, 투자 자문에 해당하지 않습니다. ' +
  '데이터의 정확성, 완전성, 시의성은 보증되지 않습니다. 모든 거래 결정은 이용자의 ' +
  '책임이며, CrossFin은 본 데이터 사용으로 인한 어떠한 손해에도 책임을 지지 않습니다.'

export const CROSSFIN_DISCLAIMER_URL = 'https://crossfin.dev/legal/disclaimer'
export const CROSSFIN_TOS_URL = 'https://crossfin.dev/legal/terms'
export const CROSSFIN_PRIVACY_URL = 'https://crossfin.dev/legal/privacy'

export const CROSSFIN_LEGAL = {
  disclaimer: CROSSFIN_DISCLAIMER,
  disclaimerUrl: CROSSFIN_DISCLAIMER_URL,
  tosUrl: CROSSFIN_TOS_URL,
  privacyUrl: CROSSFIN_PRIVACY_URL,
  dataProvision: 'AS_IS' as const,
  notInvestmentAdvice: true,
}

export const TRACKED_PAIRS: Record<string, string> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', XRP: 'XRPUSDT',
  SOL: 'SOLUSDT', DOGE: 'DOGEUSDT', ADA: 'ADAUSDT',
  DOT: 'DOTUSDT', LINK: 'LINKUSDT', AVAX: 'AVAXUSDT',
  TRX: 'TRXUSDT', KAIA: 'KAIAUSDT',
}

export const DEFAULT_CROSS_EXCHANGE_COINS = ['BTC', 'ETH', 'XRP', 'DOGE', 'ADA', 'SOL'] as const

export const BITHUMB_FEES_PCT = 0.25 // Bithumb maker/taker fee
export const BINANCE_FEES_PCT = 0.10 // Binance spot fee

// --- Routing Engine: Exchange trading fees (%) ---
export const EXCHANGE_FEES: Record<string, number> = {
  bithumb: 0.25, upbit: 0.05, coinone: 0.20,
  gopax: 0.20, bitflyer: 0.15, wazirx: 0.20,
  binance: 0.10, okx: 0.08, bybit: 0.10,
}

// --- Routing Engine: Withdrawal fees per exchange per coin (fixed amount in coin units) ---
export const WITHDRAWAL_FEES: Record<string, Record<string, number>> = {
  bithumb: { BTC: 0.001, ETH: 0.01, XRP: 1.0, SOL: 0.01, DOGE: 5.0, ADA: 1.0, DOT: 0.1, LINK: 0.5, AVAX: 0.01, TRX: 1.0, KAIA: 0.005 },
  upbit: { BTC: 0.0005, ETH: 0.01, XRP: 1.0, SOL: 0.01, DOGE: 5.0, ADA: 1.0, DOT: 0.1, LINK: 0.5, AVAX: 0.01, TRX: 1.0 },
  coinone: { BTC: 0.0015, ETH: 0.01, XRP: 1.0, SOL: 0.01, DOGE: 5.0, ADA: 1.0, DOT: 0.1, LINK: 0.5, AVAX: 0.01, TRX: 1.0, KAIA: 0.86 },
  gopax: { BTC: 0.002, ETH: 0.01, XRP: 1.0, SOL: 0.01, DOGE: 5.0, ADA: 1.0, TRX: 1.0, LINK: 0.5, AVAX: 0.01, KAIA: 1.0 },
  bitflyer: { BTC: 0.0004, ETH: 0.005, XRP: 0.1 },
  wazirx: { BTC: 0.0006, ETH: 0.005, XRP: 1.0, SOL: 0.01, DOGE: 5.0, ADA: 1.0, DOT: 0.1, LINK: 0.3, AVAX: 0.01, TRX: 1.0, KAIA: 0.5 },
  binance: { BTC: 0.0002, ETH: 0.0016, XRP: 0.25, SOL: 0.01, DOGE: 5.0, ADA: 1.0, DOT: 0.1, LINK: 0.3, AVAX: 0.01, TRX: 1.0, USDT: 1.0, USDC: 1.0, KAIA: 0.005 },
  okx: { BTC: 0.0002, ETH: 0.0008, XRP: 0.2, SOL: 0.008, DOGE: 4.0, ADA: 0.8, DOT: 0.08, LINK: 0.3, AVAX: 0.01, TRX: 1.0, USDT: 1.0, USDC: 1.0, KAIA: 0.005 },
  bybit: { BTC: 0.0002, ETH: 0.0016, XRP: 0.25, SOL: 0.01, DOGE: 5.0, ADA: 1.0, DOT: 0.1, LINK: 0.3, AVAX: 0.01, TRX: 1.0, USDT: 1.0, USDC: 1.0, KAIA: 0.005 },
}

// --- Decision Layer: Transfer times (minutes) per coin ---
export const TRANSFER_TIME_MIN: Record<string, number> = {
  BTC: 28, ETH: 5, XRP: 0.5, SOL: 1, DOGE: 10, ADA: 5,
  DOT: 5, LINK: 5, AVAX: 2, TRX: 1, KAIA: 1,
}
export const DEFAULT_TRANSFER_TIME_MIN = 10

// --- Routing Engine: Supported exchanges ---
export const ROUTING_EXCHANGES = ['bithumb', 'upbit', 'coinone', 'gopax', 'bitflyer', 'wazirx', 'binance', 'okx', 'bybit'] as const
export type RoutingExchange = typeof ROUTING_EXCHANGES[number]

export const GLOBAL_ROUTING_EXCHANGE_SET = new Set<string>(['binance', 'okx', 'bybit'])
export const KOREAN_ROUTING_EXCHANGE_SET = new Set<string>(['bithumb', 'upbit', 'coinone', 'gopax'])

export const ROUTING_EXCHANGE_CURRENCIES: Record<RoutingExchange, readonly string[]> = {
  bithumb: ['KRW'],
  upbit: ['KRW'],
  coinone: ['KRW'],
  gopax: ['KRW'],
  bitflyer: ['JPY'],
  wazirx: ['INR'],
  binance: ['USDC', 'USDT', 'USD'],
  okx: ['USDC', 'USDT', 'USD'],
  bybit: ['USDC', 'USDT', 'USD'],
}

export const ROUTING_SUPPORTED_CURRENCIES = ['KRW', 'JPY', 'INR', 'USDC', 'USDT', 'USD'] as const

export const EXCHANGE_DISPLAY_NAME: Record<RoutingExchange, string> = {
  bithumb: 'Bithumb',
  upbit: 'Upbit',
  coinone: 'Coinone',
  gopax: 'GoPax',
  bitflyer: 'bitFlyer',
  wazirx: 'WazirX',
  binance: 'Binance',
  okx: 'OKX',
  bybit: 'Bybit',
}

export const ROUTING_EXCHANGE_COUNTRY: Record<RoutingExchange, string> = {
  bithumb: 'South Korea',
  upbit: 'South Korea',
  coinone: 'South Korea',
  gopax: 'South Korea',
  bitflyer: 'Japan',
  wazirx: 'India',
  binance: 'Global',
  okx: 'Global',
  bybit: 'Global',
}

// --- Routing Engine: Bridge coins for cross-exchange transfers ---
export const BRIDGE_COINS = ['XRP', 'SOL', 'TRX', 'KAIA', 'ETH', 'BTC', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK'] as const

export const FEE_CACHE_TTL_MS = 5 * 60_000
export const BITHUMB_WITHDRAWAL_STATUS_CACHE_TTL_MS = 60_000

export const GLOBAL_PRICES_SUCCESS_TTL_MS = 10_000
export const GLOBAL_PRICES_FAILURE_TTL_MS = 5_000

export type CachedGlobalPrices = { value: Record<string, number>; expiresAt: number; source: string }
export type CachedExchangePriceFeed = { value: Record<string, number>; expiresAt: number; source: string }
export type ExchangePrices = Record<string, Record<string, number>>

export type RoutingStrategy = 'cheapest' | 'fastest' | 'balanced'

export const CORS_ALLOWED_ORIGINS = new Set([
  'https://crossfin.dev',
  'https://www.crossfin.dev',
  'https://live.crossfin.dev',
  'https://crossfin.pages.dev',
  'https://crossfin-live.pages.dev',
  'http://localhost:5173',
  'http://localhost:5174',
])
