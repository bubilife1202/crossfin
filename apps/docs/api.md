# API Reference

Base URL: `https://crossfin.dev` — 9 exchanges: Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, Binance, OKX, Bybit

## 1. Routing

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/route/exchanges', description: 'Supported exchanges and coins', price: 'Free' },
  { method: 'GET', path: '/api/route/status', description: 'Exchange network health (live status across 9 exchanges)', price: 'Free' },
  { method: 'GET', path: '/api/route/pairs', description: 'Bridge pairs with live prices', price: 'Free' },
  { method: 'GET', path: '/api/route/fees', description: 'Trading + withdrawal fee table', price: 'Free' },
  { method: 'GET', path: '/api/routing/optimal', description: 'Live optimal route + real exchange fees (for RouteGraph)', price: 'Free' },
  { method: 'GET', path: '/api/premium/route/find', description: 'Full optimal route analysis', price: '$0.10' },
]" />

---

## 2. Arbitrage & Route Spread Index

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/arbitrage/demo', description: 'Top-3 decisions (EXECUTE/WAIT/SKIP)', price: 'Free' },
  { method: 'GET', path: '/api/premium/arbitrage/kimchi', description: 'Full 11-pair route spread index', price: '$0.05' },
  { method: 'GET', path: '/api/premium/arbitrage/opportunities', description: 'Full arbitrage scan', price: '$0.10' },
  { method: 'GET', path: '/api/premium/arbitrage/kimchi/history', description: 'Route spread 7-day history', price: '$0.05' },
]" />

---

## 3. Korean Market Data

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/premium/market/fx/usdkrw', description: 'USD/KRW rate', price: '$0.01' },
  { method: 'GET', path: '/api/premium/market/upbit/ticker', description: 'Upbit ticker', price: '$0.02' },
  { method: 'GET', path: '/api/premium/market/upbit/orderbook', description: 'Upbit orderbook', price: '$0.02' },
  { method: 'GET', path: '/api/premium/market/coinone/ticker', description: 'Coinone ticker', price: '$0.02' },
  { method: 'GET', path: '/api/premium/bithumb/orderbook', description: 'Bithumb orderbook', price: '$0.02' },
  { method: 'GET', path: '/api/premium/crypto/korea/5exchange', description: 'Cross-exchange prices', price: '$0.08' },
  { method: 'GET', path: '/api/premium/news/korea/headlines', description: 'Korean crypto news', price: '$0.03' },
]" />

---

## 4. Korean Stock APIs

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/premium/market/korea/indices', description: 'KOSPI & KOSDAQ', price: '$0.03' },
  { method: 'GET', path: '/api/premium/market/korea/stocks/momentum', description: 'Top movers', price: '$0.05' },
  { method: 'GET', path: '/api/premium/market/korea/investor-flow', description: 'Investor flow', price: '$0.05' },
  { method: 'GET', path: '/api/premium/market/korea/etf', description: '1,070+ ETFs', price: '$0.03' },
]" />

---

## 5. Bundles

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/premium/morning/brief', description: 'Morning Brief', price: '$0.20' },
  { method: 'GET', path: '/api/premium/crypto/snapshot', description: 'Crypto Snapshot', price: '$0.15' },
  { method: 'GET', path: '/api/premium/kimchi/stats', description: 'Route Spread Stats', price: '$0.15' },
  { method: 'GET', path: '/api/premium/market/korea/stock-brief', description: 'Stock Brief', price: '$0.10' },
]" />

---

## 6. ACP (Agent Commerce Protocol)

<ApiTable :endpoints="[
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
  { method: 'GET', path: '/.well-known/crossfin.json', description: 'Agent auto-discovery', price: 'Free' },
  { method: 'GET', path: '/.well-known/x402.json', description: 'x402 discovery metadata', price: 'Free' },
  { method: 'GET', path: '/api/openapi.json', description: 'OpenAPI 3.1 spec', price: 'Free' },
  { method: 'GET', path: '/api/docs/guide', description: 'Structured agent guide', price: 'Free' },
]" />

---

## 8. Utility Paid APIs

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/premium/report', description: 'Premium report (agents/wallets/transactions summary)', price: '$0.001' },
  { method: 'GET', path: '/api/premium/enterprise', description: 'Enterprise receipt/proof endpoint', price: '$20.00' },
]" />
