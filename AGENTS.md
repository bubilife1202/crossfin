# AGENTS.md — CrossFin

## What is CrossFin?

Cross-border crypto routing engine for AI agents. Routes capital across 14 Korean and global exchanges with x402 USDC micropayments on Base.

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

- `apps/api/src/index.ts` — All API routes (~11500 lines)
- `apps/api/src/constants.ts` — Exchange fees, bridge coins, routing config
- `apps/api/src/types.ts` — Type definitions and utility functions
- `apps/api/src/lib/fetchers.ts` — Exchange data fetchers
- `apps/api/src/lib/engine.ts` — Routing engine logic
- `apps/api/src/catalog.ts` — Service catalog metadata (from catalog/crossfin-catalog.json)
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
Regional: bitFlyer (JPY), WazirX (INR), bitbank (JPY), Indodax (IDR), Bitkub (THB)
Global: Binance, OKX, Bybit, KuCoin, Coinbase
Bridge coins: BTC, ETH, XRP, SOL, DOGE, ADA, DOT, LINK, AVAX, TRX, KAIA, SUI, APT

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

## Versioning — 반드시 3개 동시 업데이트

API, MCP 서버, SDK는 **항상 같은 버전**을 유지한다. 버전을 올릴 때 아래 파일을 **모두** 업데이트해야 한다.

### 버전 업데이트 체크리스트

```
[ ] catalog/crossfin-catalog.json          → apiVersion
[ ] apps/mcp-server/package.json           → version
[ ] apps/mcp-server/server.json            → version + packages[].version
[ ] apps/mcp-server/package-lock.json      → version (npm install로 자동)
[ ] packages/sdk/package.json              → version
[ ] packages/sdk/package-lock.json         → version (npm install로 자동)
[ ] packages/sdk/src/types.ts              → 버전 문자열 있으면 변경
[ ] packages/sdk/README.md                 → 예시 출력의 version
[ ] apps/web/public/.well-known/crossfin.json → version + updatedAt
[ ] examples/gpt-actions-schema.yaml       → version
[ ] smithery.yaml                          → crossfin-mcp@{version}
[ ] CHANGELOG.md                           → 새 버전 항목 추가
```

### 배포 순서

```bash
# 1. npm publish (MCP + SDK)
cd apps/mcp-server && npm run build && npm publish
cd packages/sdk && npm run build && npm publish --access public

# 2. API 배포
cd apps/api && npx wrangler deploy

# 3. Web 배포 (crossfin.json 변경 시)
cd apps/web && npm run build && npx wrangler pages deploy dist --project-name=crossfin

# 4. Docs 배포 (문서 변경 시)
cd apps/docs && npm run build && npx wrangler pages deploy dist --project-name=crossfin-docs

# 5. Live 배포 (live 변경 시)
cd apps/live && npm run build && npx wrangler pages deploy dist --project-name=crossfin-live
```

### 절대 하면 안 되는 것

- API, MCP, SDK 중 하나만 버전 올리고 나머지는 안 올리기
- CHANGELOG에 새 버전 항목 안 넣기
- npm publish 후 git commit/push 안 하기

## Coding Conventions

- TypeScript throughout
- Hono framework for API (Cloudflare Workers)
- No ORM — raw D1 SQL queries
- Single-file API architecture (index.ts)
- MCP SDK for tool registration
- Zod for input validation
