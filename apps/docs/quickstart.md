# Quickstart

Start in under 2 minutes with free endpoints across 9 exchanges (Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, Binance, OKX, Bybit).

## Step 1: Check health

```bash
curl https://crossfin.dev/api/health
```

## Step 2: Explore exchange network

```bash
curl https://crossfin.dev/api/route/exchanges
```

```bash
curl https://crossfin.dev/api/route/status
```

```bash
curl "https://crossfin.dev/api/route/fees?coin=XRP"
```

Returns all 9 exchanges with supported coins, online status, and fee schedules.

## Step 3: Free arbitrage preview

```bash
curl https://crossfin.dev/api/arbitrage/demo
```

Top 3 route spread pairs with POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD indicators.

## Step 4: Free ACP routing quote

```bash
curl -X POST https://crossfin.dev/api/acp/quote \
  -H "Content-Type: application/json" \
  -d '{"from":"bithumb:KRW","to":"binance:USDC","amount":5000000}'
```

Returns optimal route with bridge coin, fees, and alternatives. No payment required.

## Step 5: Live optimal route graph data (free)

```bash
curl "https://crossfin.dev/api/routing/optimal?from=bithumb:KRW&to=binance:USDC&amount=5000000&strategy=cheapest"
```

Returns live optimal route + alternatives with real exchange fee table from D1.

## Step 6: Paid optimal route (x402)

```
GET /api/premium/route/find?from=bithumb:KRW&to=binance:USDC&amount=5000000&strategy=cheapest
```

Full route analysis ($0.10). Use an x402-capable client with Base USDC settlement.
