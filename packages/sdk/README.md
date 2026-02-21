# @crossfin/sdk

TypeScript SDK for the [CrossFin API](https://crossfin.dev) — Korean crypto market data, cross-exchange routing, and x402 agent services.

## Installation

```bash
npm install @crossfin/sdk
```

## Quick Start

```typescript
import { CrossFinClient } from '@crossfin/sdk'

const client = new CrossFinClient()

// Free endpoints — no API key needed
const health = await client.health()
console.log(health) // { name: 'crossfin-api', version: '1.8.9', status: 'ok' }

// Route Spread preview (free)
const demo = await client.arbitrage.demo()
console.log(demo.preview) // top 3 pairs with premium data

// Optimal routing (free)
const route = await client.route.optimal({
  from: 'bithumb:KRW',
  to: 'binance:USDC',
  amount: 1_000_000,
  strategy: 'cheapest',
})

// Registry search
const results = await client.registry.search('crypto')
```

## With API Key

```typescript
const client = new CrossFinClient({ apiKey: 'your-agent-key' })

// Registry operations that require auth
const services = await client.registry.list()
```

## Premium Endpoints (x402)

Premium endpoints require payment via the [x402 protocol](https://x402.org) (USDC on Base mainnet). If you call a premium endpoint without payment, a `CrossFinError` with status 402 will be thrown with a clear message.

```typescript
import { CrossFinClient, CrossFinError } from '@crossfin/sdk'

const client = new CrossFinClient()

try {
  // Full Route Spread Index — $0.05 USDC
  const kimchi = await client.premium.kimchi()
  console.log(kimchi.premiums)
} catch (err) {
  if (err instanceof CrossFinError && err.status === 402) {
    console.log('Payment required:', err.message)
  }
}
```

### Available Premium Methods

| Method | Price | Description |
|--------|-------|-------------|
| `premium.kimchi()` | $0.05 | Full Route Spread Index |
| `premium.kimchiHistory({ coin, hours })` | $0.05 | Route Spread History (hourly) |
| `premium.opportunities()` | $0.10 | Arbitrage Decision Service |
| `premium.bithumbOrderbook(pair)` | $0.02 | Live Bithumb Orderbook |
| `premium.bithumbVolumeAnalysis()` | $0.03 | Bithumb 24h Volume Analysis |
| `premium.koreaMarketSentiment()` | $0.03 | Korean Market Sentiment |
| `premium.usdKrw()` | $0.01 | USD/KRW Exchange Rate |
| `premium.upbitTicker(market)` | $0.02 | Upbit Ticker |
| `premium.upbitOrderbook(market)` | $0.02 | Upbit Orderbook |
| `premium.upbitSignals()` | $0.05 | Upbit Trading Signals |
| `premium.coinoneTicker(currency)` | $0.02 | Coinone Ticker |
| `premium.crossExchange(coins)` | $0.08 | Cross-Exchange Decision Service |
| `premium.koreaIndices()` | $0.03 | KOSPI/KOSDAQ Indices |
| `premium.koreaIndicesHistory({ index, days })` | $0.05 | Korea Indices History |
| `premium.koreaStocksMomentum(market)` | $0.05 | Korea Stocks Momentum |
| `premium.koreaInvestorFlow(stock)` | $0.05 | Korea Investor Flow |
| `premium.koreaIndexFlow(index)` | $0.03 | Korea Index Flow |
| `premium.koreaStockDetail(stock)` | $0.05 | Korea Stock Detail |
| `premium.koreaStockNews(stock)` | $0.03 | Korea Stock News |
| `premium.koreaThemes()` | $0.05 | Korea Market Themes |
| `premium.koreaDisclosure(stock)` | $0.03 | Korea Disclosure Feed |
| `premium.koreaEtf()` | $0.03 | Korea ETF Universe |
| `premium.stockBrief(stock)` | $0.10 | Stock Brief Bundle |
| `premium.korea5Exchange(coin)` | $0.08 | Korea 5-Exchange Compare |
| `premium.koreaExchangeStatus()` | $0.03 | Korea Exchange Status |
| `premium.koreaFxRate()` | $0.01 | Korea FX Rate (CRIX) |
| `premium.upbitCandles({ coin, type, count })` | $0.02 | Upbit Candles |
| `premium.globalIndicesChart({ index, period })` | $0.02 | Global Indices Chart |
| `premium.koreaHeadlines(limit)` | $0.03 | Korean Headlines |
| `premium.morningBrief()` | $0.20 | Morning Brief Bundle |
| `premium.cryptoSnapshot()` | $0.15 | Crypto Snapshot Bundle |
| `premium.kimchiStats()` | $0.15 | Route Spread Stats Bundle |
| `premium.routeFind(params)` | $0.10 | Optimal Route Finder |
| `premium.report()` | $0.001 | Premium Report (x402 check) |
| `premium.enterprise()` | $20.00 | Enterprise Receipt |

## Free Endpoints

```typescript
// Health & Discovery
client.health()
client.guide()
client.discovery()

// Routing
client.route.exchanges()
client.route.fees(coin?)
client.route.pairs(coin?)
client.route.status()
client.route.optimal({ from, to, amount, strategy })

// Arbitrage
client.arbitrage.demo()

// Registry
client.registry.stats()
client.registry.search(query)
client.registry.categories()
client.registry.list({ category, provider, limit, offset })
client.registry.get(id)

// ACP (Agent Commerce Protocol)
client.acp.status()
client.acp.quote({ from, to, amount, strategy })
client.acp.execute(quoteId)
client.acp.execution(executionId)

// Analytics
client.analytics.overview()
client.analytics.service(serviceId)

// On-chain
client.usdcTransfers(limit?)
```

## Error Handling

All API errors throw `CrossFinError` with `status` and `body` properties:

```typescript
import { CrossFinError } from '@crossfin/sdk'

try {
  await client.premium.kimchi()
} catch (err) {
  if (err instanceof CrossFinError) {
    console.log(err.status) // 402
    console.log(err.body)   // { error: '...', message: '...' }
  }
}
```

## Requirements

- Node.js 18+ or any runtime with native `fetch` (Deno, Bun, Cloudflare Workers)
- No external dependencies
