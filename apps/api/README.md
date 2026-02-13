# CrossFin API (Workers + D1 + x402)

Live API:
- Base URL: https://crossfin-api.bubilife.workers.dev

Key endpoints:
- `GET /` health
- `GET /api/stats` public counters
- `POST /api/agents` create agent (returns `apiKey`)
- `GET /api/premium/report` x402-paywalled (USDC) premium endpoint

## Run locally

```bash
cd apps/api
npm install
npx wrangler d1 migrations apply crossfin-db --local
npx wrangler dev --port 8787
```

## Trigger a paid request (no real money)

This uses **Base Sepolia testnet** (`eip155:84532`) and the default facilitator:
- Facilitator: `https://x402.org/facilitator`

1) Create a fresh payer wallet (prints address + private key):

```bash
cd apps/api
npm run x402:wallet
```

2) Fund it with **testnet USDC** (free):
- Circle faucet: https://faucet.circle.com (Token: USDC, Network: Base Sepolia)

3) Run the paid call:

```bash
cd apps/api
EVM_PRIVATE_KEY="<private_key from step 1>" npm run x402:paid
```

If it succeeds, the script prints a `basescan=` link with the settlement transaction.
