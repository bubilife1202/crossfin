# CrossFin

**The x402 Agent Services Gateway** — Discover, call, and pay for AI agent services in one place. 179 services (30 CrossFin + 149 external), Korean market APIs, MCP server, and structured agent guides. All payments via [x402](https://x402.org) protocol with USDC on Base mainnet.

**Live:** https://crossfin.dev | **Demo:** https://live.crossfin.dev

## What is CrossFin?

CrossFin is a **gateway and registry for AI agent services**, built on the x402 payment protocol.

- **Service Registry:** 179 verified services from multiple x402 providers (CrossFin, Einstein AI, x402engine)
- **Agent Guide API:** Structured JSON guide at `/api/docs/guide` — service catalog, payment flow, code examples, MCP setup
- **Agent Discovery:** `/.well-known/crossfin.json` for automatic service detection
- **MCP Server:** 13 tools for Claude Desktop and other MCP clients — search, browse, call, and pay for services
- **Korea-First APIs:** 30 proprietary endpoints (Kimchi Premium, Bithumb, Upbit, Coinone, FX, stock analysis, ETF, themes, global indices)
- **Proxy Layer:** Call any registered service through CrossFin (`/api/proxy/:serviceId`) — requires `X-Agent-Key`, 5% fee header, automatic call logging
- **Analytics:** Real-time service usage stats (`/api/analytics/overview`)
- **Live Demo:** Real-time gateway dashboard at [live.crossfin.dev](https://live.crossfin.dev)

**Think RapidAPI, but for AI agents paying with crypto.**

## Why CrossFin?

| Problem | CrossFin Solution |
|---------|-------------------|
| x402 services are scattered across the internet | Unified registry with 179 verified services |
| Agents can't discover available APIs | Search API + `.well-known/crossfin.json` + MCP server |
| No Korean market data for agents | 30 proprietary Korea APIs (crypto + stocks + ETF + themes + indices) |
| No structured docs for agents | `/api/docs/guide` — JSON guide with schemas, examples, payment flow |
| No revenue model for gateway operators | 5% proxy fee on every call through CrossFin |
| Crypto is hard for end users | Roadmap: fiat on-ramp (KRW → USDC auto-conversion) |

## Endpoints

### Registry (Free)

| Endpoint | Description |
|----------|-------------|
| `GET /api/registry` | List all services (filterable by category, provider) |
| `GET /api/registry/search?q=...` | Full-text search across services |
| `GET /api/registry/categories` | Category breakdown with counts |
| `GET /api/registry/stats` | Total services: 179 (30 CrossFin + 149 external) |
| `GET /api/registry/:id` | Service detail with guide, inputSchema, outputExample |
| `POST /api/registry` | Register a new service (requires `X-Agent-Key`) |

### Agent Discovery & Docs (Free)

| Endpoint | Description |
|----------|-------------|
| `GET /api/docs/guide` | Structured JSON guide for agents (services, payment, MCP setup) |
| `GET /.well-known/crossfin.json` | Agent auto-discovery metadata |

### Proxy (Free — 5% fee built into forwarded price)

| Endpoint | Description |
|----------|-------------|
| `GET /api/proxy/:serviceId` | Forward GET request to service (requires `X-Agent-Key`), log call |
| `POST /api/proxy/:serviceId` | Forward POST request to service (requires `X-Agent-Key`), log call |

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
| `GET /api/premium/arbitrage/opportunities` | $0.10 | Arbitrage decision service (EXECUTE/WAIT/SKIP with slippage, trends, confidence) |
| `GET /api/premium/bithumb/orderbook?pair=BTC` | $0.02 | Bithumb orderbook (30 levels) |
| `GET /api/premium/market/korea` | $0.03 | Korean market sentiment & movers |
| `GET /api/premium/market/fx/usdkrw` | $0.01 | USD/KRW exchange rate |
| `GET /api/premium/market/upbit/ticker?market=KRW-BTC` | $0.02 | Upbit ticker |
| `GET /api/premium/market/upbit/orderbook?market=KRW-BTC` | $0.02 | Upbit orderbook |
| `GET /api/premium/market/coinone/ticker?currency=BTC` | $0.02 | Coinone ticker |
| `GET /api/premium/market/cross-exchange` | $0.08 | Cross-exchange decision service (ARBITRAGE/HOLD/MONITOR with best buy/sell routing) |
| `GET /api/premium/news/korea/headlines` | $0.03 | Korean headlines (Google News RSS) |
| `GET /api/premium/arbitrage/kimchi/history` | $0.05 | Historical kimchi premium (hourly snapshots, up to 7 days) |
| `GET /api/premium/bithumb/volume-analysis` | $0.03 | Bithumb 24h volume distribution & unusual activity detection |
| `GET /api/premium/market/upbit/signals` | $0.05 | Upbit trading signals (momentum, volatility, confidence) |
| `GET /api/premium/market/korea/indices` | $0.03 | KOSPI & KOSDAQ real-time index (price, change, direction, market status) |
| `GET /api/premium/market/korea/indices/history` | $0.05 | KOSPI/KOSDAQ daily OHLC history (up to 60 trading days) |
| `GET /api/premium/market/korea/stocks/momentum` | $0.05 | Korean stock momentum (top market cap, gainers, losers) |
| `GET /api/premium/market/korea/investor-flow?stock=005930` | $0.05 | Stock investor flow — 10-day foreign/institutional/individual net buying |
| `GET /api/premium/market/korea/index-flow?index=KOSPI` | $0.03 | KOSPI/KOSDAQ investor flow — foreign/institutional/individual net buying (billion KRW) |
| `GET /api/premium/crypto/korea/5exchange?coin=BTC` | $0.08 | Compare crypto prices across 5 Korean exchanges (Upbit, Bithumb, Korbit, Coinone, GoPax) |
| `GET /api/premium/crypto/korea/exchange-status` | $0.03 | Bithumb deposit/withdrawal status for all coins |
| `GET /api/premium/market/korea/stock-detail?stock=005930` | $0.05 | Comprehensive stock analysis — PER, PBR, consensus, industry peers |
| `GET /api/premium/market/korea/stock-news?stock=005930` | $0.03 | Stock-specific news from Naver Finance |
| `GET /api/premium/market/korea/themes` | $0.05 | Korean stock market themes/sectors with performance |
| `GET /api/premium/market/korea/disclosure?stock=005930` | $0.03 | Corporate disclosure filings |
| `GET /api/premium/crypto/korea/fx-rate` | $0.01 | Real-time KRW/USD exchange rate (Upbit CRIX, 52-week high/low) |
| `GET /api/premium/market/korea/etf` | $0.03 | Korean ETF list with NAV, price, 3-month returns (1,070+ ETFs) |
| `GET /api/premium/crypto/korea/upbit-candles?coin=BTC&type=days` | $0.02 | Upbit OHLCV candles (1m to monthly, up to 200 candles) |
| `GET /api/premium/market/global/indices-chart?index=.DJI` | $0.02 | Global index chart — Dow, NASDAQ, Hang Seng, Nikkei |

### Other (Free)

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check (includes version) |
| `GET /api/stats` | Public-safe rounded counters |
| `GET /api/openapi.json` | OpenAPI 3.1 spec (agent-readable) |

## MCP Server

CrossFin includes an MCP (Model Context Protocol) server for Claude Desktop and other MCP clients. 13 tools available:

### Install

```bash
# Claude Desktop (and most MCP clients) will run this command for you once configured.
npx -y crossfin-mcp

# Or global install
npm i -g crossfin-mcp
crossfin-mcp
```

### 60-second Setup

1. Add the Claude Desktop config (below)
2. Restart Claude Desktop
3. Use tools like `get_guide`, `search_services`, or `call_paid_service`

| Tool | Description |
|------|-------------|
| `search_services` | Search the service registry by keyword |
| `list_services` | List services with optional category filter |
| `get_service` | Get details for a specific service |
| `list_categories` | List all categories with counts |
| `get_kimchi_premium` | Free kimchi premium preview |
| `get_analytics` | Gateway usage analytics |
| `get_guide` | Get the full CrossFin agent guide |
| `create_wallet` | Create a wallet in local ledger |
| `get_balance` | Check wallet balance |
| `transfer` | Transfer funds between wallets |
| `list_transactions` | List recent transactions |
| `set_budget` | Set daily spend limit |
| `call_paid_service` | Call a paid API with automatic x402 USDC payment (returns data + txHash + basescan link) |

### Claude Desktop Config

```json
{
  "mcpServers": {
    "crossfin": {
      "command": "npx",
      "args": ["-y", "crossfin-mcp"],
      "env": {
        "CROSSFIN_API_URL": "https://crossfin.dev",
        "EVM_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

### Claude Desktop Config (Local Build)

```json
{
  "mcpServers": {
    "crossfin": {
      "command": "node",
      "args": ["/path/to/crossfin/apps/mcp-server/dist/index.js"],
      "env": {
        "CROSSFIN_API_URL": "https://crossfin.dev",
        "EVM_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

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
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const client = new x402Client();
registerExactEvmScheme(client, { signer });

const paidFetch = wrapFetchWithPayment(fetch, client);
const res = await paidFetch('https://crossfin.dev/api/premium/arbitrage/kimchi', { method: 'GET' });
console.log(await res.json());
```

### Pay with x402 (Python)

```python
import os
from eth_account import Account
from x402 import x402ClientSync
from x402.http.clients import x402_requests
from x402.mechanisms.evm import EthAccountSigner
from x402.mechanisms.evm.exact.register import register_exact_evm_client

client = x402ClientSync()
account = Account.from_key(os.environ['EVM_PRIVATE_KEY'])
register_exact_evm_client(client, EthAccountSigner(account))

with x402_requests(client) as session:
    r = session.get('https://crossfin.dev/api/premium/arbitrage/kimchi')
    print(r.json())
```

## Revenue Model

```
Phase 1 (Now)      → Own API revenue: $0.01–$0.10 per call (30 Korean market APIs)
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
| MCP Server | @modelcontextprotocol/sdk (13 tools) |
| Frontend | React + Vite → Cloudflare Pages |
| Live Demo | React + Vite → Cloudflare Pages (live.crossfin.dev) |
| Domain | crossfin.dev + live.crossfin.dev |

## Project Structure

```
apps/
    api/          Cloudflare Workers API (v1.7.1)
    src/
      index.ts    Routes, x402 paywall, registry, guide, seeds, proxy, analytics
    migrations/
      0001_init.sql               Agents, wallets, transactions, budgets
      0002_services_registry.sql  Services registry + call logging
      0003_kimchi_history.sql     Kimchi premium hourly snapshots
    scripts/
      x402-paid-fetch.mjs    Test x402 paid endpoints
      x402-funds-check.mjs   Check Base wallet balance
      x402-usdc-balance.mjs  Check USDC balance
      x402-gen-wallet.mjs    Generate EVM wallet
  mcp-server/   MCP Server (13 tools)
    src/
      index.ts       MCP tool definitions + CrossFin API integration
      ledgerStore.ts Local ledger for wallet/budget tools
  web/          Gateway Dashboard (React, tab-based UI)
    src/
      App.tsx       3-tab layout: Services, Developers, Activity
      App.css       Tab bar + component styles
      lib/api.ts    API client with type-safe fetchers
    public/
      .well-known/crossfin.json  Static agent discovery metadata
  live/         Live Demo Dashboard (React)
    src/
      App.tsx       Real-time monitoring: kimchi premium, gateway stats, health
      App.css       Dark trading-terminal theme
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

# Live Demo → live.crossfin.dev
cd apps/live && npm run build && npx wrangler pages deploy dist --project-name crossfin-live
```

## Links

- **Dashboard:** https://crossfin.dev
- **Live Demo:** https://live.crossfin.dev
- **Agent Guide:** https://crossfin.dev/api/docs/guide
- **Agent Discovery:** https://crossfin.dev/.well-known/crossfin.json
- **Registry Stats:** https://crossfin.dev/api/registry/stats
- **Free Demo:** https://crossfin.dev/api/arbitrage/demo
- **OpenAPI Spec:** https://crossfin.dev/api/openapi.json
- **Analytics:** https://crossfin.dev/api/analytics/overview
- **x402 Ecosystem PR:** https://github.com/coinbase/x402/pull/1187
- **BlockRun Listing:** https://github.com/BlockRunAI/awesome-blockrun/issues/5

## Built With AI

CrossFin was built entirely through AI collaboration (Claude) by a non-developer in 2.5 weeks. Zero prior coding experience. This project itself is proof that AI agents can build production software — and CrossFin is the infrastructure for that future.
