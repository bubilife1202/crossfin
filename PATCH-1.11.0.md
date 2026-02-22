# CrossFin v1.11.0 — 무료 티어 개방 + 법적 리스크 정리

## 개요

- **목표**: 전체 유료 엔드포인트 무료 개방 (유저 유입), 법적으로 위험한 네이버 금융 스크래핑 제거
- **버전**: 1.10.1 → 1.11.0
- **날짜**: 2026-02-22

---

## 변경 1: x402 결제 미들웨어 비활성화

### 배경
- 현재 매출 $0, 실사용자 한 자릿수
- x402 USDC 결제벽이 유저 유입 최대 장벽
- 서버비 $0 (Cloudflare Workers 무료 티어)
- rate limit 120회/분/IP 이미 적용되어 어뷰징 방어 충분

### 변경 내용
- `apps/api/src/index.ts`의 `app.use('/api/premium/*', ...)` 결제 미들웨어를 패스스루로 변경
- 기존 코드는 주석으로 보존 (재활성화 가능)
- 35개 유료 엔드포인트 → 전부 무료 접근 가능

### Before
```typescript
app.use(
  '/api/premium/*',
  async (c, next) => {
    const network = requireCaip2(c.env.X402_NETWORK)
    const facilitatorClient = new HTTPFacilitatorClient({ url: c.env.FACILITATOR_URL })
    const resourceServer = new x402ResourceServer(facilitatorClient)
    // ... 680 lines of payment configuration ...
    const middleware = paymentMiddleware({ ... }, resourceServer)
    return middleware(c, next)
  },
)
```

### After
```typescript
app.use(
  '/api/premium/*',
  async (_c, next) => {
    // x402 payment middleware disabled — all endpoints free (v1.11.0)
    // Revenue $0, users single digits. Remove paywall to acquire users.
    // To re-enable, restore the paymentMiddleware() configuration.
    await next()
  },
)
```

### 영향 받는 엔드포인트 (35개 전부)
- 김치프리미엄: `/api/premium/arbitrage/kimchi`, `/kimchi/history`, `/opportunities`
- 거래소 데이터: `/bithumb/orderbook`, `/volume-analysis`, `/upbit/ticker`, `/upbit/orderbook`, `/upbit/signals`, `/upbit-candles`, `/coinone/ticker`, `/cross-exchange`, `/5exchange`, `/exchange-status`
- FX: `/market/fx/usdkrw`, `/crypto/korea/fx-rate`
- 한국 주식: `/market/korea/indices`, `/indices/history`, `/stocks/momentum`, `/investor-flow`, `/index-flow`, `/stock-detail`, `/stock-news`, `/themes`, `/disclosure`, `/stock-brief`, `/etf`
- 글로벌: `/market/global/indices-chart`
- 뉴스: `/news/korea/headlines`
- 번들: `/morning/brief`, `/crypto/snapshot`, `/kimchi/stats`
- 라우팅: `/route/find`
- 유틸리티: `/report`, `/enterprise`

---

## 변경 2: 네이버 금융 엔드포인트 비활성화

### 배경 (법적 리스크)
- `m.stock.naver.com/api/*`는 네이버 내부 모바일 API — 공식 API 아님
- 네이버 이용약관: robots.txt 보호 데이터 수집 명시적 금지
- **판례**: 네이버 부동산 v. 다윈중개 (2024.09) — 네이버가 소송해서 승소
- **부정경쟁방지법 제2조 제1호 (차)목**: 타인의 상당한 투자 성과물 무단 사용 금지
- 특히 뉴스 엔드포인트: 네이버가 언론사에 라이선스비 지불한 콘텐츠 재배포 = 저작권 이중 위반

### 비활성화 대상 (12개 엔드포인트)

| # | 엔드포인트 | 네이버 API URL | 가격 |
|---|-----------|---------------|------|
| 1 | `/api/premium/market/korea/indices` | `m.stock.naver.com/api/index/KOSPI/basic` | $0.03 |
| 2 | `/api/premium/market/korea/indices/history` | `m.stock.naver.com/api/index/{index}/price` | $0.05 |
| 3 | `/api/premium/market/korea/stocks/momentum` | `m.stock.naver.com/api/stocks/marketValue/...` | $0.05 |
| 4 | `/api/premium/market/korea/investor-flow` | `m.stock.naver.com/api/stock/{stock}/trend` | $0.05 |
| 5 | `/api/premium/market/korea/index-flow` | `m.stock.naver.com/api/index/{index}/trend` | $0.03 |
| 6 | `/api/premium/market/korea/stock-detail` | `m.stock.naver.com/api/stock/{stock}/integration` | $0.05 |
| 7 | `/api/premium/market/korea/stock-news` | `m.stock.naver.com/api/news/stock/{stock}` | $0.03 |
| 8 | `/api/premium/market/korea/themes` | `m.stock.naver.com/api/stocks/theme` | $0.05 |
| 9 | `/api/premium/market/korea/disclosure` | `m.stock.naver.com/api/stock/{stock}/disclosure` | $0.03 |
| 10 | `/api/premium/market/korea/stock-brief` | 위 4개 합쳐서 호출 (detail+news+flow+disclosure) | $0.10 |
| 11 | `/api/premium/market/korea/etf` | `finance.naver.com/api/sise/etfItemList.nhn` | $0.03 |
| 12 | `/api/premium/market/global/indices-chart` | `api.stock.naver.com/chart/foreign/index/` | $0.02 |

### 비활성화 방법
- 각 핸들러 상단에 503 응답 추가:
```typescript
app.get('/api/premium/market/korea/indices', async (c) => {
  return c.json({
    error: 'Korean stock data temporarily unavailable',
    message: 'This endpoint is being migrated to an official data source (KRX). Check back soon.',
    migration: 'KRX (data.krx.co.kr)',
    alternatives: ['/api/premium/arbitrage/kimchi', '/api/premium/market/korea'],
  }, 503)
})
```

### 영향 받는 번들 엔드포인트
- `/api/premium/morning/brief` — KOSPI/KOSDAQ + 주식 모멘텀 부분 제거 필요 (나머지 유지: 김치프리미엄, FX, 뉴스)
- `/api/premium/kimchi/stats` — 영향 없음 (거래소 데이터만 사용)
- `/api/premium/crypto/snapshot` — 영향 없음 (거래소 데이터만 사용)

### 영향 없는 엔드포인트 (유지)
- `/api/premium/market/korea` — **빗썸** 데이터 사용 (네이버 아님) ✅
- `/api/premium/news/korea/headlines` — **Google News RSS** 사용 (네이버 아님) ✅
- 김치프리미엄, 오더북, 틱커, 볼륨, FX 등 — 거래소 직접 API ✅

---

## 변경 3: morning/brief 번들 수정

### 현재 구성
- 김치프리미엄 ✅ (거래소 API)
- FX 환율 ✅ (Upbit CRIX)
- KOSPI/KOSDAQ ❌ (네이버)
- 주식 모멘텀 ❌ (네이버)
- 뉴스 헤드라인 ✅ (Google News RSS)

### 변경 후
- 네이버 의존 부분 (KOSPI/KOSDAQ, 주식 모멘텀) 제거
- 나머지 (김치프리미엄, FX, 뉴스) 유지
- 응답에 `notice` 필드 추가: "Korean stock indices temporarily unavailable — migrating to KRX"

---

## 변경하지 않는 것

- 거래소 API 데이터 (빗썸, 업비트, 코인원, 고팍스, 바이낸스, OKX, 바이빗 등) — 유지
- Google News RSS — 유지
- CoinGecko — 유지 (별도 작업으로 유료 전환 또는 CryptoCompare 교체)
- 환율 (open.er-api.com, Upbit CRIX) — 유지
- rate limit (120회/분/IP) — 유지
- agentAuth — 유지
- x402 코드 자체 — 주석 보존 (삭제 아님)

---

## 버전 업데이트 대상 (1.10.1 → 1.11.0)

AGENTS.md 규칙에 따라 전체 동시 업데이트:

```
[ ] catalog/crossfin-catalog.json          → apiVersion
[ ] apps/mcp-server/package.json           → version
[ ] apps/mcp-server/server.json            → version + packages[].version
[ ] packages/sdk/package.json              → version
[ ] apps/web/public/.well-known/crossfin.json → version + updatedAt
[ ] examples/gpt-actions-schema.yaml       → version
[ ] smithery.yaml                          → crossfin-mcp@1.11.0
[ ] apps/api/src/lib/fetchers.ts           → CROSSFIN_UA string
[ ] CHANGELOG.md                           → 새 버전 항목
```

---

## CHANGELOG 항목

```markdown
## [1.11.0] - 2026-02-22

### Changed
- **전체 유료 엔드포인트 무료 개방** — x402 결제 미들웨어 비활성화, 35개 엔드포인트 무료 접근 가능
- **morning/brief 번들에서 한국 주식 데이터 제거** — KOSPI/KOSDAQ, 주식 모멘텀 섹션 제거 (나머지 유지)

### Removed
- **네이버 금융 의존 엔드포인트 12개 비활성화** — 법적 리스크 (비공식 API 스크래핑) 해소
  - `/api/premium/market/korea/indices`, `/indices/history`, `/stocks/momentum`
  - `/api/premium/market/korea/investor-flow`, `/index-flow`
  - `/api/premium/market/korea/stock-detail`, `/stock-news`, `/themes`, `/disclosure`, `/stock-brief`
  - `/api/premium/market/korea/etf`
  - `/api/premium/market/global/indices-chart`

### Security
- 네이버 금융 비공식 API 스크래핑 중단 (저작권법, 부정경쟁방지법 리스크 해소)
```

---

## 배포 순서

```bash
# 1. 코드 수정 (x402 비활성화 + 네이버 엔드포인트 503 처리)
# 2. 버전 파일 전체 업데이트
# 3. CHANGELOG 추가
# 4. TypeScript 진단 확인
# 5. git commit
# 6. wrangler deploy
# 7. 검증
curl https://crossfin.dev/api/health                        # version: 1.11.0
curl https://crossfin.dev/api/premium/arbitrage/kimchi       # 200 (무료)
curl https://crossfin.dev/api/premium/market/korea/indices   # 503 (비활성화)
```

---

## 후속 작업 (별도 버전)

- [ ] KRX 공식 데이터 API 연동 (네이버 대체) → v1.12.0
- [ ] BOK ECOS API 추가 (한국 매크로 경제 데이터) → v1.12.0
- [ ] CoinGecko 유료 전환 or CryptoCompare 교체
- [ ] 연합뉴스 RSS로 뉴스 소스 보강
