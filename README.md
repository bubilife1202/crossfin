# CrossFin

**The only way AI agents access Asian crypto markets.**

CrossFin is a financial router for AI agents. It finds the cheapest path to move money across 7 exchanges (Bithumb, Upbit, Coinone, GoPax + Binance, OKX, Bybit), pays for APIs with crypto (x402 protocol), and gives agents real-time access to market data that's normally locked behind Korean-language interfaces and IP restrictions.

**Live:** [crossfin.dev](https://crossfin.dev) | **Demo:** [live.crossfin.dev](https://live.crossfin.dev)

---

## Install in 30 seconds

Add this to your Claude Desktop config (`claude_desktop_config.json`):

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

Restart Claude Desktop. Done. 16 tools available immediately.

> **No EVM key?** Free tools (price lookup, fee comparison, kimchi premium) work without one. Paid tools ($0.01–$0.10 per call) require a Base wallet with USDC.

---

## What can it do?

**Ask your agent:**

- "빗썸에서 바이낸스로 500만원 USDC 만들려면 가장 싼 방법이 뭐야?" → Routing engine evaluates 11 bridge coins across 7 exchanges, returns optimal path with fees
- "지금 김치 프리미엄 얼마야?" → Real-time price spread between Korean and global exchanges for 11 crypto pairs
- "삼성전자 외국인 매수 동향 알려줘" → Korean stock investor flow data (foreign/institutional/individual)
- "오늘 한국 시장 브리핑해줘" → Morning Brief bundle: kimchi premium + FX + KOSPI/KOSDAQ + stock momentum + headlines

**For developers/agents:**

- `find_optimal_route` — cheapest/fastest/balanced path across Bithumb, Upbit, Coinone, GoPax, Binance, OKX, Bybit using 11 bridge coins (BTC, ETH, XRP, SOL, DOGE, ADA, DOT, LINK, AVAX, TRX, KAIA)
- `get_kimchi_premium` — real-time Korean vs. global price spread
- `compare_exchange_prices` — live price comparison across Korean exchanges
- `call_paid_service` — call any of 35 paid APIs with automatic x402 USDC payment

---

## Why CrossFin?

**Korean exchanges are a walled garden.** Korean-language APIs, IP restrictions, real-name bank account requirements (실명확인 계좌제), and no English documentation. AI agents can't access them — unless they go through CrossFin.

**Prices differ across exchanges.** The same BTC can be 2-3% more expensive on Korean exchanges (kimchi premium). CrossFin's routing engine finds the cheapest bridge coin and path, factoring in trading fees, withdrawal fees, slippage, and transfer time.

**x402 native.** No API keys, no subscriptions, no invoices. Agents pay per call with USDC on Base. $0.01 for an FX rate, $0.10 for a full routing analysis.

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

Considers: trading fees (0.10–0.25%), withdrawal fees (fixed per coin), orderbook slippage, transfer time, kimchi premium direction.

Supports bidirectional routing: Korea → Global and Global → Korea.

**Free preview:** `POST /api/acp/quote` (ACP compatible)
**Full route:** `GET /api/premium/route/find` ($0.10 via x402)

---

## MCP Tools (16 total)

| Tool | What it does |
|------|-------------|
| `find_optimal_route` | Optimal crypto transfer path across 7 exchanges (paid, $0.10) |
| `list_exchange_fees` | Trading + withdrawal fee comparison |
| `compare_exchange_prices` | Live price comparison across Korean exchanges |
| `get_kimchi_premium` | Korean vs. global price spread (free preview) |
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

## 35 Paid APIs

All paid via x402 (USDC on Base). No API key needed.

<details>
<summary><strong>Korean Market APIs ($0.01–$0.10)</strong></summary>

| Endpoint | Price | Description |
|----------|-------|-------------|
| `/api/premium/arbitrage/kimchi` | $0.05 | Full Kimchi Premium (11 pairs incl. KAIA) |
| `/api/premium/arbitrage/opportunities` | $0.10 | Arbitrage decisions (EXECUTE/WAIT/SKIP) |
| `/api/premium/bithumb/orderbook?pair=BTC` | $0.02 | Bithumb orderbook (30 levels) |
| `/api/premium/market/upbit/ticker` | $0.02 | Upbit ticker |
| `/api/premium/market/upbit/orderbook` | $0.02 | Upbit orderbook |
| `/api/premium/market/coinone/ticker` | $0.02 | Coinone ticker |
| `/api/premium/market/fx/usdkrw` | $0.01 | USD/KRW exchange rate |
| `/api/premium/market/korea` | $0.03 | Korean market sentiment |
| `/api/premium/market/cross-exchange` | $0.08 | Cross-exchange arbitrage decision |
| `/api/premium/news/korea/headlines` | $0.03 | Korean headlines |
| `/api/premium/arbitrage/kimchi/history` | $0.05 | Kimchi premium history (7 days) |
| `/api/premium/bithumb/volume-analysis` | $0.03 | Bithumb volume analysis |
| `/api/premium/market/upbit/signals` | $0.05 | Upbit trading signals |
| `/api/premium/crypto/korea/5exchange` | $0.08 | 4-exchange price comparison |
| `/api/premium/crypto/korea/exchange-status` | $0.03 | Deposit/withdrawal status |
| `/api/premium/crypto/korea/fx-rate` | $0.01 | Real-time KRW/USD (Upbit CRIX) |
| `/api/premium/crypto/korea/upbit-candles` | $0.02 | Upbit OHLCV candles |

</details>

<details>
<summary><strong>Korean Stock APIs ($0.03–$0.05)</strong></summary>

| Endpoint | Price | Description |
|----------|-------|-------------|
| `/api/premium/market/korea/indices` | $0.03 | KOSPI & KOSDAQ real-time |
| `/api/premium/market/korea/indices/history` | $0.05 | KOSPI/KOSDAQ daily OHLC (60 days) |
| `/api/premium/market/korea/stocks/momentum` | $0.05 | Top gainers/losers/market cap |
| `/api/premium/market/korea/investor-flow` | $0.05 | Stock investor flow (foreign/institutional) |
| `/api/premium/market/korea/index-flow` | $0.03 | Index-level investor flow |
| `/api/premium/market/korea/stock-detail` | $0.05 | Stock analysis (PER, PBR, consensus) |
| `/api/premium/market/korea/stock-news` | $0.03 | Stock-specific news |
| `/api/premium/market/korea/themes` | $0.05 | Market themes/sectors |
| `/api/premium/market/korea/disclosure` | $0.03 | Corporate disclosures |
| `/api/premium/market/korea/etf` | $0.03 | 1,070+ Korean ETFs |
| `/api/premium/market/global/indices-chart` | $0.02 | Global index charts (Dow, NASDAQ, etc.) |

</details>

<details>
<summary><strong>Bundle APIs ($0.10–$0.20)</strong></summary>

| Endpoint | Price | Description |
|----------|-------|-------------|
| `/api/premium/morning/brief` | $0.20 | Morning Brief (kimchi + FX + stocks + headlines) |
| `/api/premium/crypto/snapshot` | $0.15 | Crypto Snapshot (5-exchange + kimchi + volume + FX) |
| `/api/premium/kimchi/stats` | $0.15 | Kimchi Stats (spreads + trend + arbitrage signal) |
| `/api/premium/market/korea/stock-brief` | $0.10 | Stock Brief (fundamentals + news + flow) |

</details>

<details>
<summary><strong>Routing Engine</strong></summary>

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/route/exchanges` | Free | Supported exchanges and coins |
| `GET /api/route/fees` | Free | Fee comparison table |
| `GET /api/route/pairs` | Free | Trading pairs with live prices |
| `GET /api/route/status` | Free | Exchange health check |
| `GET /api/premium/route/find` | $0.10 | Full optimal route analysis |
| `POST /api/acp/quote` | Free | ACP-compatible routing quote (preview) |

</details>

<details>
<summary><strong>Registry & Discovery (Free)</strong></summary>

| Endpoint | Description |
|----------|-------------|
| `GET /api/registry` | List all registered services |
| `GET /api/registry/search?q=...` | Full-text search |
| `GET /api/registry/categories` | Categories with counts |
| `GET /api/docs/guide` | Structured agent guide |
| `GET /.well-known/crossfin.json` | Agent auto-discovery |
| `GET /.well-known/x402.json` | x402 discovery metadata |
| `GET /api/openapi.json` | OpenAPI 3.1 spec |

</details>

---

## Payment (x402)

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

## Links

- [Dashboard](https://crossfin.dev) — Gateway UI
- [Live Demo](https://live.crossfin.dev) — Real-time routing demo
- [Agent Guide](https://crossfin.dev/api/docs/guide) — Structured JSON for agents
- [OpenAPI Spec](https://crossfin.dev/api/openapi.json) — Machine-readable API spec
- [Docs](https://docs.crossfin.dev) — Developer documentation
- [npm: crossfin-mcp](https://www.npmjs.com/package/crossfin-mcp) — MCP server package

## Built with AI

CrossFin was built entirely through AI collaboration by a non-developer in 3 weeks. Zero prior coding experience. This project is proof that AI agents can build production software — and CrossFin is the infrastructure for that future.
