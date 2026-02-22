# PATCH-1.12.0 — Asian Premium Index

## 개요

한국 김치프리미엄과 동일한 방식으로 일본·인도네시아·태국의 크립토 프리미엄을 계산하는 엔드포인트 추가.
"Asian Premium Index" — 4개국 아시아 프리미엄을 한 눈에 보는 서비스. **세계 유일.**

## 버전

- `1.11.0` → `1.12.0`

## 가입/인증 필요 여부

| 소스 | 가입 필요 | 비고 |
|------|----------|------|
| bitbank.cc (일본) | ❌ 불필요 | 공개 REST API |
| Indodax (인도네시아) | ❌ 불필요 | 공개 REST API |
| Bitkub (태국) | ❌ 불필요 | 공개 REST API |
| BOJ (일본은행 환율) | ❌ 불필요 | 공개 API |
| 기존 글로벌 가격 (Binance 등) | ❌ 기존 사용중 | fetchGlobalPrices() |
| 기존 FX 환율 | ❌ 기존 사용중 | fetchUsdFxRates() → KRW, JPY, INR |

## 변경 사항

### 1. 신규 Fetcher 함수 (fetchers.ts)

#### 1-1. `fetchBitbankTickers()`
```typescript
// bitbank.cc — 일본 #2 거래소, 30+ JPY 쌍
// GET https://public.bitbank.cc/tickers_jpy
// 인증: 없음 | Rate limit: ~60 req/min
// 캐시: 10s success / 3s failure
// 반환: Record<string, { last: string; vol: string; buy: string; sell: string }>
```

#### 1-2. `fetchIndodaxTickers()`
```typescript
// Indodax — 인도네시아 최대 거래소, 200+ IDR 쌍
// GET https://indodax.com/api/summaries
// 인증: 없음 | Rate limit: 180 req/min
// 캐시: 10s success / 3s failure
// 반환: Record<string, { last: string; vol_idr: string; buy: string; sell: string }>
```

#### 1-3. `fetchBitkubTickers()`
```typescript
// Bitkub — 태국 최대 거래소, 50+ THB 쌍
// GET https://api.bitkub.com/api/market/ticker
// 인증: 없음 | Rate limit: ~60 req/min
// 캐시: 10s success / 3s failure
// 반환: Record<string, { last: number; highestBid: number; lowestAsk: number; baseVolume: number }>
```

#### 1-4. `fetchUsdFxRates()` 확장
```
기존: { KRW, JPY, INR }
변경: { KRW, JPY, INR, IDR, THB }
```
기존 FX API 소스에 IDR, THB 추가. 동일 API에서 가져올 수 있는지 확인 후, 안 되면 별도 소스 추가.

### 2. 신규 API 엔드포인트 (index.ts)

#### 2-1. `GET /api/premium/asia/japan` — 일본 프리미엄
```
요청: ?coin=BTC (기본 BTC, 선택: ETH, XRP, SOL, DOGE, ADA, DOT, LINK, AVAX)
응답:
{
  service: "crossfin-japan-premium",
  exchange: "bitbank",
  currency: "JPY",
  usdJpyRate: 149.5,
  pairsTracked: 9,
  avgPremiumPct: 1.23,
  topPremium: { coin: "BTC", premiumPct: 1.45, ... },
  premiums: [
    {
      coin: "BTC",
      bitbankJpy: 14850000,
      bitbankUsd: 99331,
      globalUsd: 98000,
      premiumPct: 1.36,
      volume24hJpy: 12345678900,
      volume24hUsd: 82578000
    },
    ...
  ],
  _disclaimer: "...",
  at: "2026-02-22T..."
}
```

#### 2-2. `GET /api/premium/asia/indonesia` — 인도네시아 프리미엄
```
요청: ?coin=BTC (기본 BTC)
응답:
{
  service: "crossfin-indonesia-premium",
  exchange: "indodax",
  currency: "IDR",
  usdIdrRate: 16200,
  pairsTracked: N,
  avgPremiumPct: 2.34,
  premiums: [
    {
      coin: "BTC",
      indodaxIdr: 1620000000,
      indodaxUsd: 100000,
      globalUsd: 98000,
      premiumPct: 2.04,
      volume24hIdr: ...,
      volume24hUsd: ...
    },
    ...
  ],
  _disclaimer: "...",
  at: "..."
}
```

#### 2-3. `GET /api/premium/asia/thailand` — 태국 프리미엄
```
요청: ?coin=BTC (기본 BTC)
응답:
{
  service: "crossfin-thailand-premium",
  exchange: "bitkub",
  currency: "THB",
  usdThbRate: 35.8,
  pairsTracked: N,
  avgPremiumPct: 0.89,
  premiums: [
    {
      coin: "BTC",
      bitkubThb: 3508000,
      bitkubUsd: 98000,
      globalUsd: 97500,
      premiumPct: 0.51,
      volume24hThb: ...,
      volume24hUsd: ...
    },
    ...
  ],
  _disclaimer: "...",
  at: "..."
}
```

#### 2-4. `GET /api/premium/asia/overview` — 아시안 프리미엄 인덱스 (번들)
```
요청: 없음
응답:
{
  service: "crossfin-asian-premium-index",
  summary: {
    highestPremiumCountry: "indonesia",
    highestPremiumPct: 2.34,
    lowestPremiumCountry: "thailand",
    lowestPremiumPct: 0.89,
    asianAvgPremiumPct: 1.62
  },
  korea: {
    exchange: "bithumb",
    currency: "KRW",
    avgPremiumPct: 2.10,
    topCoin: "BTC",
    topPremiumPct: 2.45,
    pairsTracked: 11,
    fxRate: 1450
  },
  japan: {
    exchange: "bitbank",
    currency: "JPY",
    avgPremiumPct: 1.23,
    topCoin: "BTC",
    topPremiumPct: 1.45,
    pairsTracked: 9,
    fxRate: 149.5
  },
  indonesia: {
    exchange: "indodax",
    currency: "IDR",
    avgPremiumPct: 2.34,
    topCoin: "BTC",
    topPremiumPct: 2.80,
    pairsTracked: 8,
    fxRate: 16200
  },
  thailand: {
    exchange: "bitkub",
    currency: "THB",
    avgPremiumPct: 0.89,
    topCoin: "BTC",
    topPremiumPct: 1.10,
    pairsTracked: 6,
    fxRate: 35.8
  },
  _disclaimer: "...",
  at: "..."
}
```

### 3. 프리미엄 계산 공통 코인

기존 김치프리미엄에서 추적하는 11개 코인 중 각 거래소에서 지원하는 것만 계산:

| 코인 | 빗썸 (KR) | bitbank (JP) | Indodax (ID) | Bitkub (TH) |
|------|-----------|-------------|-------------|-------------|
| BTC | ✅ | ✅ | ✅ | ✅ |
| ETH | ✅ | ✅ | ✅ | ✅ |
| XRP | ✅ | ✅ | ✅ | ✅ |
| SOL | ✅ | ✅ (sol_jpy) | ✅ | ✅ |
| DOGE | ✅ | ✅ | ✅ | ✅ |
| ADA | ✅ | ✅ | ✅ | ✅ |
| DOT | ✅ | ✅ | ✅ | ✅ |
| LINK | ✅ | ✅ | ✅ | ✅ |
| AVAX | ✅ | ✅ | ✅ | ✅ |
| TRX | ✅ | ❌ | ✅ | ✅ |
| KAIA | ✅ | ❌ | ❌ | ❌ |

### 4. FX 환율 소스

기존 `fetchUsdFxRates()` 확장:
- 현재 소스 확인 후 IDR, THB 추가 가능 여부 판단
- 불가능 시 대안: ExchangeRate-API, Open Exchange Rates (무료 티어), 또는 Upbit CRIX 활용
- BOJ API (`https://www.stat-search.boj.or.jp`)는 JPY 전용이므로 IDR/THB에는 사용 불가

### 5. constants.ts 변경

```typescript
// 신규 거래소 수수료 추가
export const EXCHANGE_FEES: Record<string, number> = {
  ...기존,
  bitbank: 0.12,     // Maker 0.02%, Taker 0.12% (Taker 기준)
  indodax: 0.30,     // 0.3%
  bitkub: 0.25,      // 0.25%
}
```

### 6. 버전 업데이트 (AGENTS.md 규칙)

```
[ ] catalog/crossfin-catalog.json          → apiVersion 1.12.0
[ ] apps/mcp-server/package.json           → version 1.12.0
[ ] apps/mcp-server/server.json            → version + packages[].version
[ ] packages/sdk/package.json              → version 1.12.0
[ ] packages/sdk/src/types.ts              → 버전 코멘트
[ ] apps/web/public/.well-known/crossfin.json → version + updatedAt
[ ] examples/gpt-actions-schema.yaml       → version
[ ] smithery.yaml                          → crossfin-mcp@1.12.0
[ ] apps/api/src/lib/fetchers.ts           → CROSSFIN_UA 문자열
[ ] CHANGELOG.md                           → 1.12.0 항목
```

### 7. 배포 순서

```bash
# 1. 코드 변경 + TypeScript 빌드 확인
cd apps/api && npx tsc --noEmit

# 2. Git commit
git add -A && git commit -m "feat: Asian Premium Index — Japan, Indonesia, Thailand (v1.12.0)"

# 3. API 배포
cd apps/api && npx wrangler deploy

# 4. 프로덕션 검증
curl https://crossfin.dev/api/health                        # version: 1.12.0
curl https://crossfin.dev/api/premium/asia/japan             # 200 + 프리미엄 데이터
curl https://crossfin.dev/api/premium/asia/indonesia         # 200 + 프리미엄 데이터
curl https://crossfin.dev/api/premium/asia/thailand          # 200 + 프리미엄 데이터
curl https://crossfin.dev/api/premium/asia/overview          # 200 + 4개국 종합

# 5. Git push
git push
```

## 신규 엔드포인트 요약

| 엔드포인트 | 설명 | 소스 |
|-----------|------|------|
| `GET /api/premium/asia/japan` | 일본 프리미엄 (bitbank vs Binance) | bitbank.cc |
| `GET /api/premium/asia/indonesia` | 인도네시아 프리미엄 (Indodax vs Binance) | indodax.com |
| `GET /api/premium/asia/thailand` | 태국 프리미엄 (Bitkub vs Binance) | bitkub.com |
| `GET /api/premium/asia/overview` | 아시안 프리미엄 인덱스 (4개국 종합) | 위 3개 + 기존 김치프리미엄 |

## 예상 소요 시간

| 작업 | 시간 |
|------|------|
| Fetcher 3개 구현 (bitbank, indodax, bitkub) | 1.5h |
| FX 환율 확장 (IDR, THB) | 0.5h |
| 엔드포인트 4개 구현 | 2h |
| 버전 파일 업데이트 + CHANGELOG | 0.5h |
| 빌드 확인 + 배포 + 검증 | 0.5h |
| **합계** | **~5h** |
