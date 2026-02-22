# CrossFin MCP Server

[![npm version](https://img.shields.io/npm/v/crossfin-mcp)](https://www.npmjs.com/package/crossfin-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![x402](https://img.shields.io/badge/payments-x402%20USDC-purple)](https://x402.org)

**Give your AI agent access to Asian crypto markets.** 16 tools for real-time Korean exchange data, cross-exchange routing, and x402 paid API execution across 13 exchanges.

---

## Quick Start

```bash
npx -y crossfin-mcp
```

That's it. Your agent now has 16 tools. Most tools work with no wallet setup, and payment-capable tools require `EVM_PRIVATE_KEY`.

Open beta note: CrossFin API endpoints are currently free, but payment-capable MCP tools still require wallet config for x402 flow compatibility.

---

## Client Configuration

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

### Cursor

`.cursor/mcp.json` in your project root:

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

### VS Code

`.vscode/mcp.json` in your project root (or user-level in settings):

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "evm-key",
      "description": "Base wallet private key for x402 payments (optional)",
      "password": true
    }
  ],
  "servers": {
    "crossfin": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "crossfin-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "${input:evm-key}"
      }
    }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

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

### npx (standalone)

```bash
EVM_PRIVATE_KEY=0x... npx -y crossfin-mcp
```

> **No EVM key?** Omit `EVM_PRIVATE_KEY` entirely. Free tools work without one.

---

## All 16 Tools

### Routing Engine

| Tool | Price | Description |
|------|-------|-------------|
| `find_optimal_route` | x402 flow | Optimal crypto transfer path across 13 exchanges with 11 bridge coins |
| `list_exchange_fees` | Free | Trading + withdrawal fee comparison for all exchanges |
| `compare_exchange_prices` | Free | Live Bithumb KRW vs Binance USD price comparison |
| `get_kimchi_premium` | Free | Korean vs. global route spread preview (top 3 pairs) |

### Paid API Gateway

| Tool | Price | Description |
|------|-------|-------------|
| `call_paid_service` | x402 flow | Call catalog premium endpoints with automatic x402 USDC payment |

### Service Registry

| Tool | Price | Description |
|------|-------|-------------|
| `search_services` | Free | Search registered services by keyword |
| `list_services` | Free | Browse the service catalog with category filter |
| `get_service` | Free | Get details for a specific service |
| `list_categories` | Free | List all service categories with counts |
| `get_guide` | Free | Full CrossFin agent guide (services, pricing, x402 flow) |
| `get_analytics` | Free | Gateway usage stats (total calls, top services) |

### Local Ledger

| Tool | Price | Description |
|------|-------|-------------|
| `create_wallet` | Free | Create a wallet in the local CrossFin ledger |
| `get_balance` | Free | Check wallet balance (KRW) |
| `transfer` | Free | Transfer funds between wallets |
| `list_transactions` | Free | Transaction history (optionally filtered by wallet) |
| `set_budget` | Free | Set a daily spend limit (KRW) |

---

## Sample Prompts

**Korean**

> 빗썸에서 바이낸스로 500만원 USDC 만들려면 가장 싼 방법이 뭐야?

> 지금 한국-글로벌 스프레드 얼마야?

> 거래소별 XRP 가격 비교해줘

> 오늘 한국 시장 브리핑해줘

**English**

> What's the cheapest way to move 5M KRW from Bithumb to Binance as USDC?

> Show me the current Korea-global crypto spread.

> Compare XRP prices across exchanges.

> Give me this morning's Korean market brief.

---

## Supported Exchanges

**Korea:** Bithumb, Upbit, Coinone, GoPax
**Regional Fiat:** bitFlyer, WazirX, bitbank, Indodax, Bitkub
**Global:** Binance, OKX, Bybit, KuCoin

### Bridge Coins

BTC, ETH, XRP, SOL, DOGE, ADA, DOT, LINK, AVAX, TRX, KAIA

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EVM_PRIVATE_KEY` | For paid tools | Base wallet private key for x402 USDC payments |
| `CROSSFIN_API_URL` | No | API base URL (default: `https://crossfin.dev`) |
| `CROSSFIN_LEDGER_PATH` | No | Local ledger file path (default: `~/.crossfin/ledger.json`) |

---

## x402 Payments

Paid tools use the [x402 protocol](https://x402.org) for automatic micropayments. When your agent calls a paid endpoint:

1. The API responds with `402 Payment Required` and a price header
2. The MCP server signs a USDC payment on **Base** (L2) using your `EVM_PRIVATE_KEY`
3. The payment is submitted and the API returns the data along with a transaction receipt

Payments settle on-chain. Each response includes `txHash` and a Basescan link for verification. Prices range from $0.01 to $0.20 per call.

To get started, fund a Base wallet with USDC and set `EVM_PRIVATE_KEY`. No account registration or API keys required.

---

## Agent Discovery

CrossFin exposes standard discovery endpoints so agent frameworks can auto-detect capabilities:

| Endpoint | Description |
|----------|-------------|
| [`/.well-known/ai-plugin.json`](https://crossfin.dev/.well-known/ai-plugin.json) | OpenAI plugin manifest |
| [`/.well-known/agent.json`](https://crossfin.dev/.well-known/agent.json) | A2A Agent Card (Google Agent-to-Agent protocol) |
| [`/.well-known/x402.json`](https://crossfin.dev/.well-known/x402.json) | x402 payment discovery (network, token, payTo) |
| [`/.well-known/crossfin.json`](https://crossfin.dev/.well-known/crossfin.json) | CrossFin metadata (MCP, API, registry links) |
| [`/llms.txt`](https://crossfin.dev/llms.txt) | LLM-friendly service description |

---

## Links

- [crossfin.dev](https://crossfin.dev) -- Dashboard & API
- [live.crossfin.dev](https://live.crossfin.dev) -- Live routing demo
- [docs.crossfin.dev](https://docs.crossfin.dev) -- Documentation
- [GitHub](https://github.com/bubilife1202/crossfin) -- Source code
- [npm](https://www.npmjs.com/package/crossfin-mcp) -- Package
