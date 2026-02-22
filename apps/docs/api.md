# API Reference

Base URL: `https://crossfin.dev` — 13 exchanges: Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, bitbank, Indodax, Bitkub, Binance, OKX, Bybit, KuCoin

> Open beta notice: Endpoints that are normally paid are temporarily free. x402 payment enforcement is currently disabled and will be re-enabled later.

## 1. Routing

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/route/exchanges', description: 'Supported exchanges and coins', price: 'Free' },
  { method: 'GET', path: '/api/route/status', description: 'Exchange network health (live status across 13 exchanges)', price: 'Free' },
  { method: 'GET', path: '/api/route/pairs', description: 'Bridge pairs with live prices', price: 'Free' },
  { method: 'GET', path: '/api/route/fees', description: 'Trading + withdrawal fee table', price: 'Free' },
  { method: 'GET', path: '/api/routing/optimal', description: 'Live optimal route + real exchange fees (for RouteGraph)', price: 'Free' },
  { method: 'GET', path: '/api/premium/route/find', description: 'Full optimal route analysis', price: 'Free' },
]" />

---

## 2. Arbitrage & Route Spread Index

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/arbitrage/demo', description: 'Top-3 indicators (POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD)', price: 'Free' },
  { method: 'GET', path: '/api/premium/arbitrage/kimchi', description: 'Full 11-pair route spread index', price: 'Free' },
  { method: 'GET', path: '/api/premium/arbitrage/opportunities', description: 'Full arbitrage scan', price: 'Free' },
  { method: 'GET', path: '/api/premium/arbitrage/kimchi/history', description: 'Route spread 7-day history', price: 'Free' },
  { method: 'GET', path: '/api/premium/market/cross-exchange', description: 'Cross-Exchange Decision', price: 'Free' },
]" />

---

## 3. Korean Market Data

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/premium/market/fx/usdkrw', description: 'USD/KRW rate', price: 'Free' },
  { method: 'GET', path: '/api/premium/market/upbit/ticker', description: 'Upbit ticker', price: 'Free' },
  { method: 'GET', path: '/api/premium/market/upbit/orderbook', description: 'Upbit orderbook', price: 'Free' },
  { method: 'GET', path: '/api/premium/market/upbit/signals', description: 'Upbit Signals', price: 'Free' },
  { method: 'GET', path: '/api/premium/market/coinone/ticker', description: 'Coinone ticker', price: 'Free' },
  { method: 'GET', path: '/api/premium/bithumb/orderbook', description: 'Bithumb orderbook', price: 'Free' },
  { method: 'GET', path: '/api/premium/bithumb/volume-analysis', description: 'Bithumb Volume Analysis', price: 'Free' },
  { method: 'GET', path: '/api/premium/crypto/korea/5exchange', description: 'Cross-exchange prices', price: 'Free' },
  { method: 'GET', path: '/api/premium/crypto/korea/exchange-status', description: 'Korea Exchange Status', price: 'Free' },
  { method: 'GET', path: '/api/premium/crypto/korea/fx-rate', description: 'Korea FX Rate (CRIX)', price: 'Free' },
  { method: 'GET', path: '/api/premium/crypto/korea/upbit-candles?coin=BTC&type=days&count=30', description: 'Upbit Candles', price: 'Free' },
  { method: 'GET', path: '/api/premium/market/korea', description: 'Korea Market Sentiment', price: 'Free' },
  { method: 'GET', path: '/api/premium/news/korea/headlines', description: 'Korean crypto news', price: 'Free' },
]" />

---

## 4. Asian Premium Index (v1.12.0)

Real-time crypto premium analysis across 4 Asian countries. Compares local exchange prices vs Binance global prices.

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/premium/asia/japan', description: 'Japan premium (bitbank.cc JPY vs Binance USD)', price: 'Free' },
  { method: 'GET', path: '/api/premium/asia/indonesia', description: 'Indonesia premium (Indodax IDR vs Binance USD)', price: 'Free' },
  { method: 'GET', path: '/api/premium/asia/thailand', description: 'Thailand premium (Bitkub THB vs Binance USD)', price: 'Free' },
  { method: 'GET', path: '/api/premium/asia/overview', description: '4-country overview (Korea + Japan + Indonesia + Thailand)', price: 'Free' },
]" />

---

## 5. Bundles

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/premium/morning/brief', description: 'Morning Brief', price: 'Free' },
  { method: 'GET', path: '/api/premium/crypto/snapshot', description: 'Crypto Snapshot', price: 'Free' },
  { method: 'GET', path: '/api/premium/kimchi/stats', description: 'Route Spread Stats', price: 'Free' },
]" />

---

## 6. Protocol (ACP + A2A)

<ApiTable :endpoints="[
  { method: 'POST', path: '/api/a2a/tasks', description: 'A2A task execution endpoint (crypto-routing, route-spread, market data)', price: 'Free (Open Beta)' },
  { method: 'GET', path: '/api/acp/status', description: 'ACP protocol status', price: 'Free' },
  { method: 'POST', path: '/api/acp/quote', description: 'Routing quote (free preview)', price: 'Free' },
  { method: 'POST', path: '/api/acp/execute', description: 'Execute simulation', price: 'Free' },
]" />

---

## 7. Registry & Discovery

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/registry', description: 'All services', price: 'Free' },
  { method: 'GET', path: '/api/registry/search?q=', description: 'Full-text search', price: 'Free' },
  { method: 'GET', path: '/api/registry/categories', description: 'Categories with counts', price: 'Free' },
  { method: 'GET', path: '/api/registry/stats', description: 'Registry stats (total, crossfin, external)', price: 'Free' },
  { method: 'GET', path: '/api/openapi.json', description: 'OpenAPI 3.1 spec', price: 'Free' },
  { method: 'GET', path: '/api/docs/guide', description: 'Structured agent guide', price: 'Free' },
]" />

---

## 8. Agent Discovery

Well-known endpoints for agent frameworks and LLM toolchains to auto-discover CrossFin capabilities.

<ApiTable :endpoints="[
  { method: 'GET', path: '/.well-known/ai-plugin.json', description: 'OpenAI plugin manifest', price: 'Free' },
  { method: 'GET', path: '/.well-known/agent.json', description: 'A2A Agent Card (Google Agent-to-Agent protocol)', price: 'Free' },
  { method: 'GET', path: '/.well-known/glama.json', description: 'Glama ownership verification metadata', price: 'Free' },
  { method: 'GET', path: '/.well-known/x402.json', description: 'x402 payment discovery (network, token, payTo address)', price: 'Free' },
  { method: 'GET', path: '/.well-known/crossfin.json', description: 'CrossFin metadata (MCP, API, registry links)', price: 'Free' },
  { method: 'GET', path: '/llms.txt', description: 'LLM-friendly service description in plain text', price: 'Free' },
]" />

---

## 9. Utility, Analytics, and Operations

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/premium/report', description: 'Premium report (agents/wallets/transactions summary)', price: 'Free (Open Beta)' },
  { method: 'GET', path: '/api/premium/enterprise', description: 'Enterprise receipt/proof endpoint', price: 'Free (Open Beta)' },
  { method: 'GET', path: '/api/legal/disclaimer', description: 'Legal disclaimer (EN/KO)', price: 'Free' },
  { method: 'GET', path: '/api/legal/terms', description: 'Terms of service', price: 'Free' },
  { method: 'GET', path: '/api/legal/privacy', description: 'Privacy policy', price: 'Free' },
  { method: 'GET', path: '/api/analytics/overview', description: 'Gateway analytics overview', price: 'Free' },
  { method: 'GET', path: '/api/analytics/funnel/overview', description: 'Funnel analytics overview', price: 'Free' },
  { method: 'POST', path: '/api/analytics/funnel/events', description: 'Ingest funnel analytics events', price: 'Free' },
  { method: 'GET', path: '/api/analytics/services/{serviceId}', description: 'Per-service analytics', price: 'Free' },
  { method: 'GET', path: '/api/onchain/usdc-transfers', description: 'USDC transfer monitor (Base)', price: 'Free' },
  { method: 'GET', path: '/api/proxy/{serviceId}', description: 'Service proxy (GET)', price: 'Free' },
  { method: 'POST', path: '/api/proxy/{serviceId}', description: 'Service proxy (POST)', price: 'Free' },
  { method: 'POST', path: '/api/telegram/webhook', description: 'Telegram bot webhook endpoint', price: 'Free' },
]" />
