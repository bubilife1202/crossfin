# CrossFin

**The only way AI agents access Asian crypto markets.**

CrossFin is a financial router for AI agents. It finds the cheapest path to move money across 13 exchanges (Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, bitbank, Indodax, Bitkub, Binance, OKX, Bybit, KuCoin), pays for APIs with crypto (x402 protocol), and gives agents real-time access to market data that's normally locked behind Korean-language interfaces and IP restrictions.

**Live:** [crossfin.dev](https://crossfin.dev) | **Demo:** [live.crossfin.dev](https://live.crossfin.dev)

---

## Install in 30 seconds

Add this to your MCP client config:

```json
{
  "mcpServers": {
    "crossfin": {
      "command": "npx",
      "args": ["-y", "crossfin-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Restart your MCP client. Done. 16 tools available immediately.

> **All API endpoints are currently free** during open beta. No API key required. EVM wallet is optional (needed for x402 payment flow testing).

---

## What can it do?

**Ask your agent:**

- "빗썸에서 바이낸스로 500만원 USDC 만들려면 가장 싼 방법이 뭐야?" → Routing engine evaluates 11 bridge coins across 13 exchanges, returns optimal path with fees
- "지금 한국-글로벌 스프레드 얼마야?" → Real-time price spread between Korean and global exchanges for 11 crypto pairs
- "일본이랑 태국 프리미엄 비교해줘" → Asian Premium Index across Korea, Japan, Indonesia, Thailand
- "오늘 한국 시장 브리핑해줘" → Morning Brief bundle: route spread + FX + headlines

**For developers/agents:**

- `find_optimal_route` — cheapest/fastest/balanced path across Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, bitbank, Indodax, Bitkub, Binance, OKX, Bybit, KuCoin using 11 bridge coins (BTC, ETH, XRP, SOL, DOGE, ADA, DOT, LINK, AVAX, TRX, KAIA)
- `get_kimchi_premium` — real-time Korean vs. global route spread
- `compare_exchange_prices` — live Bithumb KRW vs Binance USD price comparison
- `call_paid_service` — call any paid API with automatic x402 USDC payment (currently free during open beta)
- Asian Premium endpoints — Japan, Indonesia, Thailand crypto premiums vs global markets

---

## Why CrossFin?

**Korean exchanges are a walled garden.** Korean-language APIs, IP restrictions, real-name bank account requirements (실명확인 계좌제), and no English documentation. AI agents can't access them — unless they go through CrossFin.

**Prices differ across exchanges.** The same BTC can be 2-3% more expensive on Korean exchanges (route spread). CrossFin's routing engine finds the cheapest bridge coin and path, factoring in trading fees, withdrawal fees, slippage, and transfer time.

**x402 ready.** No API keys, no subscriptions, no invoices. All endpoints are currently free during open beta. x402 payment infrastructure (USDC on Base) ready for future activation.

---

## Routing Engine

The core product. Given a source (exchange + currency) and destination, CrossFin evaluates all possible paths:

```
Input:  bithumb:KRW → binance:USDC, ₩5,000,000
Output: Buy AVAX on Bithumb → Transfer to Binance → Sell for USDC
        Cost: 0.07% (₩3,500) | Time: ~3 min | Output: $3,452 USDC

        Alternatives:
        BTC  → 0.33% | ~21 min | $3,443
        DOT  → 0.38% | ~6 min  | $3,441
```

Considers: trading fees (0.10–0.25%), withdrawal fees (fixed per coin), orderbook slippage, transfer time, route spread direction.

Supports bidirectional routing: Korea → Global and Global → Korea.

**Free preview:** `POST /api/acp/quote` (ACP compatible)
**Full route:** `GET /api/premium/route/find` (free during open beta)

---

## MCP Tools (16 total)

| Tool | What it does |
|------|-------------|
| `find_optimal_route` | Optimal crypto transfer path across 13 exchanges (free) |
| `list_exchange_fees` | Trading + withdrawal fee comparison |
| `compare_exchange_prices` | Live Bithumb KRW vs Binance USD comparison |
| `get_kimchi_premium` | Korean vs. global route spread (free preview) |
| `search_services` | Search registered services |
| `get_guide` | Full agent guide (services, payment flow, examples) |
| `call_paid_service` | Call any paid API with automatic x402 payment |
| `create_wallet` | Local ledger wallet |
| `get_balance` | Check wallet balance |
| `transfer` | Transfer between wallets |
| `list_transactions` | Transaction history |
| `set_budget` | Daily spend limit |
| `list_services` | Browse service catalog |
| `get_service` | Service details |
| `list_categories` | Service categories |
| `get_analytics` | Gateway usage stats |

---

## Asian Premium Index (v1.13.0)

Real-time crypto premium analysis across 4 Asian countries. All free, no API key needed.

| Endpoint | Description |
|----------|-------------|
| `GET /api/premium/asia/japan` | Japan premium — bitbank.cc JPY vs Binance USD |
| `GET /api/premium/asia/indonesia` | Indonesia premium — Indodax IDR vs Binance USD |
| `GET /api/premium/asia/thailand` | Thailand premium — Bitkub THB vs Binance USD |
| `GET /api/premium/asia/overview` | 4-country overview (Korea + Japan + Indonesia + Thailand) |

Data sources: bitbank.cc (Japan), Indodax (Indonesia), Bitkub (Thailand), Bithumb (Korea), Binance (Global)

---

## API Endpoints (Currently All Free)

All endpoints are currently free during open beta. x402 payment infrastructure is ready for future activation.

<details>
<summary><strong>Korean Market APIs</strong></summary>

| Endpoint | Price | Description |
|----------|-------|-------------|
| `/api/premium/arbitrage/kimchi` | Free | Full Route Spread (11 pairs incl. KAIA) |
| `/api/premium/arbitrage/opportunities` | Free | Arbitrage indicators (POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD) |
| `/api/premium/bithumb/orderbook?pair=BTC` | Free | Bithumb orderbook (30 levels) |
| `/api/premium/market/upbit/ticker` | Free | Upbit ticker |
| `/api/premium/market/upbit/orderbook` | Free | Upbit orderbook |
| `/api/premium/market/coinone/ticker` | Free | Coinone ticker |
| `/api/premium/market/fx/usdkrw` | Free | USD/KRW exchange rate |
| `/api/premium/market/korea` | Free | Korean market sentiment |
| `/api/premium/market/cross-exchange` | Free | Cross-exchange arbitrage decision |
| `/api/premium/news/korea/headlines` | Free | Korean headlines |
| `/api/premium/arbitrage/kimchi/history` | Free | Route spread history (7 days) |
| `/api/premium/bithumb/volume-analysis` | Free | Bithumb volume analysis |
| `/api/premium/market/upbit/signals` | Free | Upbit trading signals |
| `/api/premium/crypto/korea/5exchange` | Free | Cross-exchange price comparison |
| `/api/premium/crypto/korea/exchange-status` | Free | Deposit/withdrawal status |
| `/api/premium/crypto/korea/fx-rate` | Free | Real-time KRW/USD (Upbit CRIX) |
| `/api/premium/crypto/korea/upbit-candles` | Free | Upbit OHLCV candles |

</details>

<details>
<summary><strong>Bundle APIs</strong></summary>

| Endpoint | Price | Description |
|----------|-------|-------------|
| `/api/premium/morning/brief` | Free | Morning Brief (route spread + FX + headlines) |
| `/api/premium/crypto/snapshot` | Free | Crypto Snapshot (4-exchange + route spread + volume + FX) |
| `/api/premium/kimchi/stats` | Free | Route Spread Stats (spreads + trend + arbitrage signal) |

</details>

<details>
<summary><strong>Utility APIs (Temporarily Free in Open Beta)</strong></summary>

| Endpoint | Price | Description |
|----------|-------|-------------|
| `/api/premium/report` | Free | Premium report (agents/wallets/transactions summary) |
| `/api/premium/enterprise` | Free | Enterprise receipt/proof endpoint |
| `/api/legal/disclaimer` | Free | Full legal disclaimer (EN/KO) |
| `/api/analytics/overview` | Free | Gateway analytics overview |
| `/api/analytics/funnel/overview` | Free | Funnel analytics overview |
| `/api/analytics/funnel/events` | Free | Funnel analytics event ingestion |
| `/api/analytics/services/{serviceId}` | Free | Per-service analytics |
| `/api/onchain/usdc-transfers` | Free | On-chain USDC transfer monitor (Base) |
| `/api/proxy/{serviceId}` | Free | Proxy endpoint for registered services |
| `/api/telegram/webhook` | Free | Telegram bot webhook endpoint |

</details>

<details>
<summary><strong>Protocol APIs (A2A + ACP)</strong></summary>

| Endpoint | Price | Description |
|----------|-------|-------------|
| `POST /api/a2a/tasks` | Free | A2A task execution (crypto-routing, route-spread, market data) |
| `GET /api/acp/status` | Free | ACP protocol status and capabilities |
| `POST /api/acp/quote` | Free | ACP-compatible routing quote (preview) |
| `POST /api/acp/execute` | Free | ACP execution endpoint |

</details>

<details>
<summary><strong>Routing Engine</strong></summary>

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/route/exchanges` | Free | Supported exchanges and coins |
| `GET /api/route/fees` | Free | Fee comparison table |
| `GET /api/route/pairs` | Free | Trading pairs with live prices |
| `GET /api/route/status` | Free | Exchange health check |
| `GET /api/premium/route/find` | Free | Full optimal route analysis |
| `POST /api/acp/quote` | Free | ACP-compatible routing quote (preview) |

</details>

<details>
<summary><strong>Registry & Discovery (Free)</strong></summary>

| Endpoint | Description |
|----------|-------------|
| `GET /api/registry` | List all registered services |
| `GET /api/registry/search?q=...` | Full-text search |
| `GET /api/registry/categories` | Categories with counts |
| `GET /api/registry/stats` | Registry stats (total/crossfin/external) |
| `GET /api/docs/guide` | Structured agent guide |
| `GET /.well-known/crossfin.json` | Agent auto-discovery |
| `GET /.well-known/x402.json` | x402 discovery metadata |
| `GET /.well-known/agent.json` | A2A Agent Card |
| `GET /.well-known/ai-plugin.json` | OpenAI plugin manifest |
| `GET /llms.txt` | LLM-readable site map |
| `GET /api/openapi.json` | OpenAPI 3.1 spec |

</details>

---

## Payment (x402)

> **Note:** All endpoints are currently free during open beta. The x402 payment code below is for reference when payments are re-enabled.

No API keys. No subscriptions. Pay per call with USDC on Base.

```javascript
import { x402Client, wrapFetchWithPayment } from '@x402/fetch'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import { privateKeyToAccount } from 'viem/accounts'

const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY)
const client = new x402Client()
registerExactEvmScheme(client, { signer })

const paidFetch = wrapFetchWithPayment(fetch, client)
const res = await paidFetch('https://crossfin.dev/api/premium/arbitrage/kimchi')
console.log(await res.json())
```

<details>
<summary><strong>Python</strong></summary>

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

</details>

---

## Tech Stack

Cloudflare Workers + Hono, D1 (SQLite), x402 protocol, USDC on Base, MCP SDK, React + Vite (dashboard)

## Project Structure

```
apps/
  api/          Cloudflare Workers API
  mcp-server/   MCP Server (16 tools, npm: crossfin-mcp)
  web/          Gateway Dashboard (crossfin.dev)
  live/         Live Demo (live.crossfin.dev)
  docs/         Documentation (docs.crossfin.dev)
```

## Release Verification

Run a full pre-deploy verification sweep in one command:

```bash
npm --prefix apps/api run verify:release
```

This command runs API contract/catalog verification, builds API/web/docs in parallel, checks production API/page responses, and fails on stale copy patterns in README/docs/web/live/examples.

## Links

- [Dashboard](https://crossfin.dev) — Gateway UI
- [Live Demo](https://live.crossfin.dev) — Real-time routing demo
- [Agent Guide](https://crossfin.dev/api/docs/guide) — Structured JSON for agents
- [OpenAPI Spec](https://crossfin.dev/api/openapi.json) — Machine-readable API spec
- [Docs](https://docs.crossfin.dev) — Developer documentation
- [npm: crossfin-mcp](https://www.npmjs.com/package/crossfin-mcp) — MCP server package

## Built with AI

CrossFin was built entirely through AI collaboration by a non-developer in 1 week. Zero prior coding experience. This project is proof that AI agents can build production software — and CrossFin is the infrastructure for that future.
