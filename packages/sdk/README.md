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
console.log(health) // { name: 'crossfin-api', version: '1.12.1', status: 'ok' }

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

## All Endpoints (Currently Free)

All endpoints are currently free during the open beta period. No x402 payment or wallet required. The x402 payment infrastructure is ready and will be re-enabled in a future version.

### Available Premium Methods

| Method | Description |
|--------|-------------|
| `premium.kimchi()` | Full Route Spread Index |
| `premium.kimchiHistory({ coin, hours })` | Route Spread History (hourly) |
| `premium.opportunities()` | Arbitrage Decision Service |
| `premium.bithumbOrderbook(pair)` | Live Bithumb Orderbook |
| `premium.bithumbVolumeAnalysis()` | Bithumb 24h Volume Analysis |
| `premium.koreaMarketSentiment()` | Korean Market Sentiment |
| `premium.usdKrw()` | USD/KRW Exchange Rate |
| `premium.upbitTicker(market)` | Upbit Ticker |
| `premium.upbitOrderbook(market)` | Upbit Orderbook |
| `premium.upbitSignals()` | Upbit Trading Signals |
| `premium.coinoneTicker(currency)` | Coinone Ticker |
| `premium.crossExchange(coins)` | Cross-Exchange Decision Service |
| `premium.korea5Exchange(coin)` | Korea 5-Exchange Compare |
| `premium.koreaExchangeStatus()` | Korea Exchange Status |
| `premium.koreaFxRate()` | Korea FX Rate (CRIX) |
| `premium.upbitCandles({ coin, type, count })` | Upbit Candles |
| `premium.koreaHeadlines(limit)` | Korean Headlines |
| `premium.morningBrief()` | Morning Brief Bundle |
| `premium.cryptoSnapshot()` | Crypto Snapshot Bundle |
| `premium.kimchiStats()` | Route Spread Stats Bundle |
| `premium.routeFind(params)` | Optimal Route Finder |
| `premium.report()` | Premium Report (x402 check) |
| `premium.enterprise()` | Enterprise Receipt |

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
