# AGENTS.md — CrossFin

## What is CrossFin?

Cross-border crypto routing engine for AI agents. Routes capital across 9 Korean and global exchanges with x402 USDC micropayments on Base.

## Architecture

```
apps/
  api/          Hono on Cloudflare Workers — main API (x402, registry, routing, market data)
  mcp-server/   MCP server (npm: crossfin-mcp) — 16 tools for Claude, Cursor, etc.
  web/          React demo — local ledger UI
  live/         Live demo site (live.crossfin.dev)
  docs/         VitePress documentation (docs.crossfin.dev)
  demo-video/   Remotion video generator
```

## Key Files

- `apps/api/src/index.ts` — All API routes (~12500 lines, single file)
- `apps/api/src/catalog.ts` — Service catalog metadata
- `apps/mcp-server/src/index.ts` — MCP server with 16 tools
- `apps/mcp-server/src/ledgerStore.ts` — Local JSON ledger for agent wallets

## API Base URL

Production: `https://crossfin.dev`

## Endpoints Overview

- **Free**: health, exchange list, fees, pairs, status, arbitrage demo, routing graph, registry, ACP quote
- **Paid (x402 USDC on Base)**: route finding ($0.10), kimchi premium ($0.05), orderbooks ($0.02), Korean stocks ($0.03-$0.05), bundles ($0.10-$0.20)

## Discovery Endpoints

- `/.well-known/crossfin.json` — CrossFin agent discovery
- `/.well-known/x402.json` — x402 payment discovery
- `/.well-known/agent.json` — Google A2A Agent Card
- `/.well-known/ai-plugin.json` — OpenAI plugin manifest
- `/llms.txt` — LLM-readable site map
- `/api/openapi.json` — OpenAPI 3.1 spec
- `/api/docs/guide` — Structured agent onboarding guide

## Exchanges

Korea: Bithumb, Upbit, Coinone, GoPax
Regional: bitFlyer (JPY), WazirX (INR)
Global: Binance, OKX, Bybit
Bridge coins: BTC, ETH, XRP, SOL, DOGE, ADA, DOT, LINK, AVAX, TRX, KAIA

## Development

```bash
# API (Cloudflare Workers)
cd apps/api && npm install && npm run dev

# MCP server
cd apps/mcp-server && npm install && npm run build

# Web demo
cd apps/web && npm install && npm run dev

# Docs
cd apps/docs && npm install && npm run dev
```

## Testing

```bash
# Smoke test production
curl https://crossfin.dev/api/health
curl https://crossfin.dev/api/arbitrage/demo
curl https://crossfin.dev/api/route/exchanges
```

## Payment Flow (x402)

1. Client calls paid endpoint → gets HTTP 402 + PAYMENT-REQUIRED header
2. Client signs USDC transfer with EVM wallet
3. Client resends with PAYMENT-SIGNATURE header
4. Server verifies via facilitator → returns data

Network: Base mainnet (eip155:8453), Currency: USDC

## Coding Conventions

- TypeScript throughout
- Hono framework for API (Cloudflare Workers)
- No ORM — raw D1 SQL queries
- Single-file API architecture (index.ts)
- MCP SDK for tool registration
- Zod for input validation
