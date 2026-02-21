# CrossFin API (Workers + D1 + x402)

Live API:
- Base URL: https://crossfin.dev

Key endpoints:
- `GET /api/health` health
- `GET /api/stats` public-safe rounded counters
- `GET /api/arbitrage/demo` free preview (top 3 pairs)
- `GET /api/premium/arbitrage/kimchi` x402-paywalled (USDC) route spread index ($0.05)
- `GET /api/premium/arbitrage/opportunities` x402-paywalled (USDC) arbitrage decision service — POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD ($0.10)
- `GET /api/premium/bithumb/orderbook?pair=BTC` x402-paywalled (USDC) orderbook ($0.02)
- `GET /api/premium/market/korea` x402-paywalled (USDC) market sentiment ($0.03)
- `GET /api/premium/enterprise` x402-paywalled (USDC) revenue endpoint ($20)

## Run locally

```bash
cd apps/api
npm install
npx wrangler d1 migrations apply crossfin-db --local
npx wrangler dev --port 8787
```

## Trigger a paid request (real USDC)

The live deployment uses **Base mainnet** (`eip155:8453`). Paid endpoints require **USDC on Base**.

1) Create a fresh payer wallet (prints address + private key):

```bash
cd apps/api
npm run x402:wallet
```

2) Fund it with **USDC on Base**:
- Send USDC (Base) to the payer wallet address.
- If your exchange only supports USDC on Ethereum, bridge it to Base first.

Note: For x402, the settlement transaction is typically submitted by the facilitator, so the payer wallet often does not need ETH for gas.

3) Run the paid call:

```bash
cd apps/api
EVM_PRIVATE_KEY="<private_key from step 1>" npm run x402:paid
```

By default this calls `GET /api/premium/enterprise` (priced at $20). To call a micro endpoint:

```bash
cd apps/api
API_URL="https://crossfin.dev/api/premium/report" EVM_PRIVATE_KEY="<private_key>" npm run x402:paid
```

If it succeeds, the script prints a `basescan=` link with the settlement transaction.
