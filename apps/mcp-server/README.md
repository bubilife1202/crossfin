# CrossFin MCP Server

**Give your AI agent access to Asian crypto markets.** 16 tools for real-time Korean exchange data, cross-exchange routing, and x402 paid API execution.

## Install

```bash
npx -y crossfin-mcp
```

### Claude Desktop config

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

> **No EVM key?** Free tools work without one. Paid tools ($0.01–$0.10 per call) require a Base wallet with USDC.

## What your agent can do

- **"빗썸에서 바이낸스로 500만원 USDC 만들려면?"** → `find_optimal_route` evaluates 11 bridge coins, returns cheapest path
- **"김치 프리미엄 얼마야?"** → `get_kimchi_premium` returns real-time spread across 11 pairs
- **"거래소별 XRP 가격 비교해줘"** → `compare_exchange_prices` checks 4 Korean exchanges
- **"한국 시장 브리핑해줘"** → `call_paid_service` calls Morning Brief bundle

## Tools

| Tool | Free/Paid | Description |
|------|-----------|-------------|
| `find_optimal_route` | $0.10 | Optimal crypto transfer path across 5 exchanges (11 bridge coins) |
| `list_exchange_fees` | Free | Trading + withdrawal fee comparison |
| `compare_exchange_prices` | Free | Live price comparison across Korean exchanges |
| `get_kimchi_premium` | Free | Korean vs. global price spread preview |
| `call_paid_service` | Varies | Call any of 35 paid APIs with automatic x402 payment |
| `search_services` | Free | Search 184 registered services |
| `list_services` | Free | Browse service catalog |
| `get_service` | Free | Service details |
| `list_categories` | Free | Service categories |
| `get_guide` | Free | Full agent guide |
| `get_analytics` | Free | Gateway usage stats |
| `create_wallet` | Free | Local ledger wallet |
| `get_balance` | Free | Check wallet balance |
| `transfer` | Free | Transfer between wallets |
| `list_transactions` | Free | Transaction history |
| `set_budget` | Free | Daily spend limit |

## Supported exchanges

Bithumb, Upbit, Coinone, GoPax (Korea) + Binance (Global)

## Bridge coins

BTC, ETH, XRP, SOL, DOGE, ADA, DOT, LINK, AVAX, TRX, KAIA

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EVM_PRIVATE_KEY` | For paid tools | Base wallet private key for x402 USDC payments |
| `CROSSFIN_API_URL` | No | API base URL (default: `https://crossfin.dev`) |
| `CROSSFIN_LEDGER_PATH` | No | Local ledger path (default: `~/.crossfin/ledger.json`) |

## Links

- [crossfin.dev](https://crossfin.dev) — Dashboard
- [live.crossfin.dev](https://live.crossfin.dev) — Live routing demo
- [GitHub](https://github.com/bubilife1202/crossfin) — Source code
- [npm](https://www.npmjs.com/package/crossfin-mcp) — Package
