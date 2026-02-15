# Payment Runbook (Base Mainnet, x402)

Goal: produce a real Base mainnet settlement tx (basescan link) for Hashed.

## 1) Create / pick a payer wallet

If you already have one, skip.

```bash
cd apps/api
npm run x402:wallet
```

Keep the private key secret.

## 2) Fund payer with USDC on Base

Minimum for a micro test: $1-5 USDC is enough.

Recommended endpoints for first real payment:

- `https://crossfin.dev/api/premium/market/fx/usdkrw` ($0.01)
- `https://crossfin.dev/api/premium/market/upbit/ticker?market=KRW-BTC` ($0.02)

## 3) Confirm USDC balance (optional)

```bash
cd apps/api
CHAIN=base EVM_PRIVATE_KEY="0x..." npm run x402:balance
```

## 4) Run a paid call and capture the basescan link

```bash
cd apps/api
API_URL="https://crossfin.dev/api/premium/market/fx/usdkrw" \
EVM_PRIVATE_KEY="0x..." \
npm run x402:paid
```

Expected:
- `first_status=402`
- `final_status=200`
- `basescan=https://basescan.org/tx/0x...`

## 5) Screenshot checklist

- Terminal output showing `basescan=...`
- `https://basescan.org/tx/...` page
- `https://crossfin.dev/api/registry/stats` showing service counts
