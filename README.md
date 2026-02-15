# CrossFin

**The x402 Agent Services Gateway** — Discover, call, and pay for AI agent services in one place. 112+ services, Korean market APIs, and a 5% proxy fee layer. All payments via [x402](https://x402.org) protocol with USDC on Base mainnet.

**Live:** https://crossfin.dev

## What is CrossFin?

CrossFin is a **marketplace and gateway for AI agent services**, built on the x402 payment protocol.

- **Service Registry:** 112+ x402 services — agents search, discover, and call APIs from one gateway
- **Proxy Layer:** Call any registered service through CrossFin (`/api/proxy/:serviceId`) — 5% fee, automatic call logging
- **Korea-First APIs:** 10 proprietary endpoints (Kimchi Premium, Bithumb, Upbit, Coinone, FX, headlines)
- **Analytics:** Real-time service usage stats (`/api/analytics/overview`)
- **Onboarding:** Get Started guide with Python/JS/cURL code snippets

**Think RapidAPI, but for AI agents paying with crypto.**

## Why CrossFin?

| Problem | CrossFin Solution |
|---------|-------------------|
| x402 services are scattered across the internet | Unified registry with 112+ services |
| Agents can't discover available APIs | Search API: `/api/registry/search?q=translate` |
| No Korean market data for agents | 10 proprietary Korea APIs (Bithumb, Upbit, Coinone) |
| No revenue model for gateway operators | 5% proxy fee on every call through CrossFin |
| Crypto is hard for end users | Roadmap: fiat on-ramp (KRW → USDC auto-conversion) |

## Endpoints

### Registry (Free)

| Endpoint | Description |
|----------|-------------|
| `GET /api/registry` | List all services (filterable by category, provider) |
| `GET /api/registry/search?q=...` | Full-text search across services |
| `GET /api/registry/categories` | Category breakdown with counts |
| `GET /api/registry/stats` | Total services: 113 (10 CrossFin + 103 external) |
| `GET /api/registry/:id` | Service detail by ID |
| `POST /api/registry` | Register a new service (requires `X-Agent-Key`) |

### Proxy (Free — 5% fee built into forwarded price)

| Endpoint | Description |
|----------|-------------|
| `GET /api/proxy/:serviceId` | Forward GET request to service, log call |
| `POST /api/proxy/:serviceId` | Forward POST request to service, log call |

### Analytics (Free)

| Endpoint | Description |
|----------|-------------|
| `GET /api/analytics/overview` | Total calls, top services, recent activity |
| `GET /api/analytics/services/:serviceId` | Per-service stats (calls, success rate, avg response time) |

### Korean Market APIs (Paid via x402)

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/arbitrage/demo` | Free | Kimchi Premium preview (top 3 pairs) |
| `GET /api/premium/arbitrage/kimchi` | $0.05 | Full Kimchi Premium index (10+ pairs) |
| `GET /api/premium/arbitrage/opportunities` | $0.10 | Arbitrage routes with risk scores |
| `GET /api/premium/bithumb/orderbook?pair=BTC` | $0.02 | Bithumb orderbook (30 levels) |
| `GET /api/premium/market/korea` | $0.03 | Korean market sentiment & movers |
| `GET /api/premium/market/fx/usdkrw` | $0.01 | USD/KRW exchange rate |
| `GET /api/premium/market/upbit/ticker?market=KRW-BTC` | $0.02 | Upbit ticker |
| `GET /api/premium/market/upbit/orderbook?market=KRW-BTC` | $0.02 | Upbit orderbook |
| `GET /api/premium/market/coinone/ticker?currency=BTC` | $0.02 | Coinone ticker |
| `GET /api/premium/market/cross-exchange` | $0.08 | Cross-exchange comparison (Bithumb vs Upbit vs Coinone vs Binance) |
| `GET /api/premium/news/korea/headlines` | $0.03 | Korean headlines (Google News RSS) |

### Other (Free)

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/stats` | Agent/wallet/transaction counts |
| `GET /api/openapi.json` | OpenAPI 3.1 spec (agent-readable) |

## Quick Start

```bash
# Free — browse the registry
curl https://crossfin.dev/api/registry/stats

# Free — search for services
curl "https://crossfin.dev/api/registry/search?q=crypto"

# Free — kimchi premium preview
curl https://crossfin.dev/api/arbitrage/demo

# Paid — requires x402 payment (USDC on Base)
curl https://crossfin.dev/api/premium/market/fx/usdkrw
```

### Pay with x402 (JavaScript)

```javascript
import { paymentFetch } from '@x402/fetch'

const res = await paymentFetch(
  'https://crossfin.dev/api/premium/market/fx/usdkrw',
  { privateKey: 'YOUR_PRIVATE_KEY' }
)
console.log(await res.json())
```

### Pay with x402 (Python)

```python
from x402 import Client

client = Client(private_key="YOUR_PRIVATE_KEY")
data = client.get("https://crossfin.dev/api/premium/arbitrage/kimchi")
print(data)
```

## Revenue Model

```
Phase 1 (Now)      → Own API revenue: $0.01–$0.10 per call (10 Korean market APIs)
Phase 2 (3 months) → Proxy fee: 5% on every call through /api/proxy/:serviceId
Phase 3 (6 months) → Agent banking: wallet management, budget controls, fiat on-ramp
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | Cloudflare Workers + Hono |
| Database | Cloudflare D1 (SQLite) |
| Payments | x402 protocol (@x402/hono, @x402/extensions/bazaar) |
| Network | Base mainnet, USDC |
| Frontend | React + Vite → Cloudflare Pages |
| Domain | crossfin.dev (Workers + Pages) |

## Project Structure

```
apps/
  api/          Cloudflare Workers API
    src/
      index.ts    All routes, x402 paywall, registry, proxy, analytics
    migrations/
      0001_init.sql               Agents, wallets, transactions, budgets
      0002_services_registry.sql  Services registry + call logging
    scripts/
      x402-paid-fetch.mjs    Test x402 paid endpoints
      x402-funds-check.mjs   Check Base wallet balance
      x402-usdc-balance.mjs  Check USDC balance
      x402-gen-wallet.mjs    Generate EVM wallet
  web/          Gateway Dashboard (React)
    src/
      App.tsx       Dashboard: services browser, analytics, get-started, register
      App.css       All styles
      lib/api.ts    API client with type-safe fetchers
```

## Development

```bash
# API
cd apps/api
npm install
npx wrangler d1 migrations apply crossfin-db --local
npx wrangler dev --port 8787

# Frontend
cd apps/web
npm install
npm run dev
```

## Deploy

```bash
# API → crossfin.dev/api/*
cd apps/api && npx wrangler deploy

# Frontend → crossfin.dev
cd apps/web && npm run build && npx wrangler pages deploy dist --project-name crossfin
```

## Links

- **Dashboard:** https://crossfin.dev
- **Registry Stats:** https://crossfin.dev/api/registry/stats
- **Free Demo:** https://crossfin.dev/api/arbitrage/demo
- **OpenAPI Spec:** https://crossfin.dev/api/openapi.json
- **Analytics:** https://crossfin.dev/api/analytics/overview
- **x402 Ecosystem PR:** https://github.com/coinbase/x402/pull/1187
- **BlockRun Listing:** https://github.com/BlockRunAI/awesome-blockrun/issues/5

## Built With AI

CrossFin was built entirely through AI collaboration (Claude) by a non-developer in 2.5 weeks. Zero prior coding experience. This project itself is proof that AI agents can build production software — and CrossFin is the infrastructure for that future.
