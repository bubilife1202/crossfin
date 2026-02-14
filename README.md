# CrossFin

Korean crypto arbitrage data API for AI agents. Pay-per-request via [x402](https://x402.org) protocol with USDC on Base mainnet.

**Live:** https://crossfin.dev

## What is CrossFin?

CrossFin provides real-time Kimchi Premium data — the price gap between Korean exchanges (Bithumb) and global markets. AI agents pay per request with USDC, no API keys needed.

The Kimchi Premium historically ranges 2–10%, creating real arbitrage opportunities. CrossFin is the only Korean exchange data provider in the x402 ecosystem.

## Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/arbitrage/demo` | Free | Top 3 pairs preview |
| `GET /api/premium/arbitrage/kimchi` | $0.05 USDC | Full Kimchi Premium index (10+ pairs) |
| `GET /api/premium/arbitrage/opportunities` | $0.10 USDC | Profitable arbitrage routes with risk scores |
| `GET /api/premium/bithumb/orderbook?pair=BTC` | $0.02 USDC | Live Bithumb orderbook (30 levels) |
| `GET /api/premium/market/korea` | $0.03 USDC | Korean market sentiment & movers |
| `GET /api/openapi.json` | Free | OpenAPI 3.1 spec for agent discovery |

## Try it

```bash
curl https://crossfin.dev/api/arbitrage/demo
```

## Stack

- **API:** Cloudflare Workers + Hono + D1
- **Payments:** x402 protocol (@x402/hono, @x402/extensions/bazaar)
- **Data:** Bithumb API + CryptoCompare API
- **Network:** Base mainnet, USDC
- **Website:** Cloudflare Pages (React + Vite)

## Project Structure

```
apps/
  api/       Cloudflare Workers API (x402 paywall + arbitrage data)
  web/       Landing page (Cloudflare Pages)
```

## Development

### API

```bash
cd apps/api
npm install
npx wrangler d1 migrations apply crossfin-db --local
npx wrangler dev --port 8787
```

### Website

```bash
cd apps/web
npm install
npm run dev
```

## Deploy

```bash
cd apps/api && npx wrangler deploy
cd apps/web && npm run build && npx wrangler pages deploy dist --project-name crossfin
```

## Links

- **Live API:** https://crossfin.dev/api/health
- **Free demo:** https://crossfin.dev/api/arbitrage/demo
- **OpenAPI spec:** https://crossfin.dev/api/openapi.json
- **x402 ecosystem PR:** https://github.com/coinbase/x402/pull/1187
- **BlockRun listing:** https://github.com/BlockRunAI/awesome-blockrun/issues/5
