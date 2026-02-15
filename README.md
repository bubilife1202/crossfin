# CrossFin

Service registry + Korean market APIs for AI agents. Pay-per-request via [x402](https://x402.org) protocol with USDC on Base mainnet.

**Live:** https://crossfin.dev

## What is CrossFin?

CrossFin is an **x402-native agent services gateway**.

- **Registry:** discover services via `GET /api/registry` (free)
- **Korea-first APIs:** Bithumb/Upbit/Coinone + FX + headlines (paid via x402)
- **Payments:** standard HTTP 402 flow with USDC on Base

CrossFin started as a Kimchi Premium API, and now also provides a registry layer so agents can find services programmatically.

## Endpoints

### Registry (Free)

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/registry` | Free | List services (filterable) |
| `GET /api/registry/search?q=...` | Free | Search services |
| `GET /api/registry/categories` | Free | Category counts |
| `GET /api/registry/stats` | Free | Registry totals |
| `POST /api/registry` | Free (auth) | Register a service (`X-Agent-Key`) |

### Korea APIs (Paid via x402)

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/arbitrage/demo` | Free | Top 3 pairs preview |
| `GET /api/premium/arbitrage/kimchi` | $0.05 USDC | Full Kimchi Premium index (10+ pairs) |
| `GET /api/premium/arbitrage/opportunities` | $0.10 USDC | Profitable arbitrage routes with risk scores |
| `GET /api/premium/bithumb/orderbook?pair=BTC` | $0.02 USDC | Live Bithumb orderbook (30 levels) |
| `GET /api/premium/market/korea` | $0.03 USDC | Korean market sentiment & movers |
| `GET /api/premium/market/fx/usdkrw` | $0.01 USDC | USD/KRW exchange rate |
| `GET /api/premium/market/upbit/ticker?market=KRW-BTC` | $0.02 USDC | Upbit ticker snapshot |
| `GET /api/premium/market/upbit/orderbook?market=KRW-BTC` | $0.02 USDC | Upbit orderbook snapshot |
| `GET /api/premium/market/coinone/ticker?currency=BTC` | $0.02 USDC | Coinone ticker snapshot |
| `GET /api/premium/news/korea/headlines` | $0.03 USDC | Korean headlines (RSS) |
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
  web/       Gateway dashboard (Cloudflare Pages)
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
