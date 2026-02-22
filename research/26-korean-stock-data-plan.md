# 한국 주식 데이터 재구축 기획서

> v1.13.0에서 네이버 파이낸스 의존 12개 엔드포인트를 완전 제거한 뒤, 공식 데이터 소스로 재구축하기 위한 기획서.

## 1. 현황 요약

### 1.1 제거 대상 (v1.13.0)

| # | 엔드포인트 | 설명 | 데이터 소스 |
|---|-----------|------|-----------|
| 1 | `/api/premium/market/korea/indices` | KOSPI/KOSDAQ 실시간 지수 | 네이버 금융 |
| 2 | `/api/premium/market/korea/indices/history` | KOSPI/KOSDAQ 일봉 (60일) | 네이버 금융 |
| 3 | `/api/premium/market/korea/stocks/momentum` | 시총 상위/상승/하락 종목 | 네이버 금융 |
| 4 | `/api/premium/market/korea/investor-flow` | 종목별 외인/기관/개인 수급 | 네이버 금융 |
| 5 | `/api/premium/market/korea/index-flow` | 지수별 투자자 수급 | 네이버 금융 |
| 6 | `/api/premium/market/korea/stock-detail` | 종목 분석 (PER, PBR, 컨센서스) | 네이버 금융 |
| 7 | `/api/premium/market/korea/stock-news` | 종목별 뉴스 | 네이버 금융 |
| 8 | `/api/premium/market/korea/themes` | 테마/섹터 동향 | 네이버 금융 |
| 9 | `/api/premium/market/korea/disclosure` | 기업 공시 | 네이버 금융 |
| 10 | `/api/premium/market/korea/stock-brief` | 종합 리포트 번들 | 네이버 금융 |
| 11 | `/api/premium/market/korea/etf` | 한국 ETF 목록 (1,070+) | 네이버 금융 |
| 12 | `/api/premium/market/global/indices-chart` | 글로벌 지수 차트 | 네이버 금융 |

### 1.2 제거 이유

- 네이버 금융은 공식 API가 아닌 내부 엔드포인트 스크래핑
- 언제든 차단/변경 가능 → 프로덕션 서비스로 부적합
- v1.11.0에서 이미 503 비활성화 상태였으나 코드가 남아 있었음
- 사용자에게 "있는데 안 되는" 서비스보다 "없는 게 나음"

### 1.3 영향받지 않는 엔드포인트

다음은 네이버 의존이 아니므로 제거하지 않음:

| 엔드포인트 | 데이터 소스 |
|-----------|-----------|
| `/api/premium/crypto/korea/5exchange` | Upbit, Bithumb, Coinone, GoPax API 직접 호출 |
| `/api/premium/crypto/korea/exchange-status` | Bithumb 공식 API |
| `/api/premium/crypto/korea/fx-rate` | Upbit CRIX API |
| `/api/premium/crypto/korea/upbit-candles` | Upbit 공식 API |
| `/api/premium/news/korea/headlines` | Google News RSS |

---

## 2. 대체 데이터 소스 평가

### 2.1 KRX 정보데이터시스템 (data.krx.co.kr) ⭐ 1순위

**장점:**
- 한국거래소 공식 데이터 — 가장 신뢰할 수 있는 소스
- 시세, 투자자별 매매동향, ETF, 공시 등 포괄적 제공
- 영어 UI 지원
- 무료 (API 호출 제한 존재)

**단점:**
- API가 REST가 아닌 폼 기반 POST 요청 (Content-Type: application/x-www-form-urlencoded)
- Rate limit이 명시적이지 않음 (과도 호출 시 IP 차단 가능)
- 해외 서버에서 접근 시 속도 이슈 가능
- 실시간 아닌 장 마감 후 데이터 (15분+ 딜레이)

**제공 데이터:**

| 카테고리 | KRX API 경로 | 대응 엔드포인트 |
|---------|-------------|---------------|
| KOSPI/KOSDAQ 지수 | `/api/statistics/stat/stat0101.cmd` | indices |
| 지수 히스토리 | `/api/statistics/stat/stat0101.cmd` (기간 파라미터) | indices/history |
| 시가총액 상위 | `/api/statistics/stat/stat0301.cmd` | stocks/momentum (시총) |
| 등락 종목 | `/api/statistics/stat/stat0401.cmd` | stocks/momentum (상승/하락) |
| 투자자별 매매동향 | `/api/statistics/stat/stat0602.cmd` | investor-flow, index-flow |
| ETF 시세 | `/api/statistics/stat/stat0401.cmd` (ETF 시장) | etf |

### 2.2 DART 전자공시시스템 (dart.fss.or.kr) ⭐ 공시 전용

**장점:**
- 금융감독원 공식 API — OpenDART
- API 키 발급 후 무료 사용 (일 1,000건)
- REST API + JSON 응답
- 2026년부터 자산 2조원+ 기업 영어 공시 의무화

**단점:**
- 공시 데이터만 제공 (시세/수급 없음)
- API 키 필요 (환경변수 관리)

**대응 엔드포인트:** disclosure

### 2.3 한국투자증권 Open API

**장점:**
- 실시간 시세 가능 (WebSocket)
- REST API + WebSocket
- GitHub 공개 문서

**단점:**
- 증권계좌 개설 필수 (한국 거주자 기준)
- 해외 서버 접근 제한 가능
- 이용 약관상 재배포 제한 가능

**판단:** 증권계좌 요구로 인해 당장은 부적합. 장기적으로 실시간 데이터가 필요할 때 검토.

### 2.4 EODHD (eodhd.com)

**장점:**
- KO(한국거래소) 2,410개 종목 + ETF 지원
- REST API + 글로벌 인프라
- 가격: $19.99/월~

**단점:**
- 유료 (비용 발생)
- 투자자별 매매동향 없음
- 실시간 아님

**판단:** KRX 직접 호출이 가능하면 불필요. 백업 소스로만 고려.

### 2.5 Yahoo Finance (비공식)

**장점:**
- 무료
- KOSPI(^KS11), KOSDAQ(^KQ11), 개별종목(.KS) 지원

**단점:**
- 비공식 API — 언제든 차단 가능 (네이버와 같은 문제)
- 데이터 정확성 보장 안 됨
- 수급 데이터 없음

**판단:** 네이버에서 Yahoo로 옮기는 건 같은 실수 반복. 제외.

---

## 3. 재구축 전략

### 3.1 핵심 원칙

1. **공식 API만 사용** — 스크래핑/비공식 엔드포인트 절대 금지
2. **점진적 복원** — 한 번에 12개가 아니라, 데이터 소스별로 나눠서
3. **데이터 품질 명시** — 딜레이, 갱신 주기, 소스를 응답에 포함
4. **새 경로 사용** — `/api/premium/market/korea/indices` 대신 `/api/v2/korea/...` 등 새 네이밍
5. **KRX 우선, DART 보조** — 시세/수급은 KRX, 공시는 DART

### 3.2 엔드포인트 재구축 우선순위

| 우선순위 | 엔드포인트 | 데이터 소스 | 난이도 | 비즈니스 가치 |
|---------|-----------|-----------|--------|-------------|
| **P0** | KOSPI/KOSDAQ 지수 | KRX | 중 | 높음 — Morning Brief 핵심 |
| **P0** | 투자자별 매매동향 (지수) | KRX | 중 | 높음 — 독점적 영어 데이터 |
| **P1** | 시총 상위/등락 종목 | KRX | 중 | 높음 — 시장 모멘텀 |
| **P1** | 종목별 투자자 수급 | KRX | 중 | 높음 — 독점적 |
| **P1** | 지수 히스토리 | KRX | 낮음 | 중 |
| **P2** | ETF 목록 | KRX | 낮음 | 중 |
| **P2** | 기업 공시 | DART | 중 | 중 |
| **P3** | 종목 분석 (PER/PBR 등) | KRX + 자체 계산 | 높음 | 중 |
| **P3** | 테마/섹터 | KRX | 중 | 낮음 |
| **미정** | 종목별 뉴스 | 미정 (공식 소스 없음) | 높음 | 낮음 |
| **미정** | 글로벌 지수 차트 | 미정 (한국 주식 아님) | — | 낮음 |
| **제외** | Stock Brief 번들 | P0~P2 완료 후 재구성 | — | 높음 |

### 3.3 새로운 API 경로 설계 (안)

```
/api/v2/korea/market/indices          ← KOSPI/KOSDAQ 실시간 (KRX)
/api/v2/korea/market/indices/history  ← 일봉 히스토리 (KRX)
/api/v2/korea/market/movers           ← 상승/하락/시총 (KRX)
/api/v2/korea/market/flow             ← 지수별 투자자 수급 (KRX)
/api/v2/korea/stock/{code}/flow       ← 종목별 투자자 수급 (KRX)
/api/v2/korea/stock/{code}/detail     ← 종목 분석 (KRX)
/api/v2/korea/stock/{code}/disclosure ← 공시 (DART)
/api/v2/korea/etf                     ← ETF 목록 (KRX)
/api/v2/korea/themes                  ← 테마/섹터 (KRX)
```

기존 경로(`/api/premium/market/korea/...`)는 재사용하지 않음. 클라이언트가 v1 경로를 호출하면 404가 되어 명확히 인지 가능.

---

## 4. KRX API 연동 구현 계획

### 4.1 KRX 데이터 페칭 패턴

```typescript
// KRX API는 폼 기반 POST 요청
async function fetchKrxData(apiPath: string, params: Record<string, string>) {
  const body = new URLSearchParams(params)
  const res = await fetch(`https://data.krx.co.kr${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': CROSSFIN_UA,
    },
    body: body.toString(),
  })
  if (!res.ok) throw new HTTPException(502, { message: 'KRX API unavailable' })
  return res.json()
}
```

### 4.2 캐싱 전략

- KRX 데이터는 실시간이 아닌 15분+ 딜레이
- Cloudflare Workers KV 또는 D1에 캐싱
- TTL: 장중 5분, 장외 1시간
- 장 운영 시간: 09:00~15:30 KST (평일)

```typescript
// Cache-aware fetcher
async function fetchKrxCached(
  apiPath: string,
  params: Record<string, string>,
  env: Env,
  ttlSeconds = 300
): Promise<unknown> {
  const cacheKey = `krx:${apiPath}:${JSON.stringify(params)}`
  
  // Check KV cache first
  const cached = await env.KV.get(cacheKey, 'json')
  if (cached) return cached
  
  const data = await fetchKrxData(apiPath, params)
  await env.KV.put(cacheKey, JSON.stringify(data), { expirationTtl: ttlSeconds })
  return data
}
```

### 4.3 DART API 연동

```typescript
// DART OpenAPI
async function fetchDartDisclosure(stockCode: string, env: Env) {
  const corpCode = await resolveCorpCode(stockCode, env) // KRX 6자리 → DART corpCode 매핑
  const res = await fetch(
    `https://opendart.fss.or.kr/api/list.json?crtfc_key=${env.DART_API_KEY}&corp_code=${corpCode}&page_count=10`,
  )
  if (!res.ok) throw new HTTPException(502, { message: 'DART API unavailable' })
  return res.json()
}
```

### 4.4 필요한 인프라 추가

| 항목 | 설명 | 비용 |
|------|------|------|
| Cloudflare KV | KRX 데이터 캐싱 | Workers 무료 플랜에 포함 |
| DART API 키 | OpenDART 환경변수 | 무료 |
| KRX 종목코드 ↔ DART corpCode 매핑 테이블 | D1에 저장 | 1회 세팅 |

---

## 5. 실행 로드맵

### Phase 1: KRX 기반 핵심 데이터 (v1.14.0)

**목표:** KOSPI/KOSDAQ 지수 + 투자자 수급 복원
**기간:** 1~2주
**작업:**
1. KRX API 페처 (`fetchKrxData`, `fetchKrxCached`) 구현
2. `/api/v2/korea/market/indices` — KOSPI/KOSDAQ 실시간 지수
3. `/api/v2/korea/market/flow` — 지수별 투자자 수급
4. Morning Brief에 새 indices 데이터 연결
5. MCP 서버에 새 도구 추가
6. SDK 타입/메서드 추가
7. 문서 업데이트

### Phase 2: 종목 데이터 확장 (v1.15.0)

**목표:** 개별 종목 수급 + 모멘텀
**기간:** 1~2주
**작업:**
1. `/api/v2/korea/market/movers` — 상승/하락/시총 상위
2. `/api/v2/korea/stock/{code}/flow` — 종목별 투자자 수급
3. `/api/v2/korea/market/indices/history` — 지수 일봉 히스토리
4. `/api/v2/korea/etf` — ETF 목록

### Phase 3: 공시 + 분석 (v1.16.0)

**목표:** DART 공시 + 종목 상세 분석
**기간:** 2~3주
**작업:**
1. DART API 연동 (`fetchDartDisclosure`)
2. KRX 종목코드 ↔ DART corpCode 매핑 테이블 구축
3. `/api/v2/korea/stock/{code}/disclosure` — 공시
4. `/api/v2/korea/stock/{code}/detail` — PER/PBR/시총 등 (KRX 데이터 기반 자체 계산)
5. `/api/v2/korea/themes` — 테마/섹터

### Phase 4: 번들 + 고급 기능 (v1.17.0)

**목표:** Stock Brief 번들 재구성 + 뉴스
**기간:** 2~3주
**작업:**
1. Stock Brief 번들 재구성 (Phase 1~3 엔드포인트 조합)
2. 뉴스 소스 결정 (DART 공시 기반 또는 별도 공식 소스)
3. 글로벌 지수 차트 대체 소스 검토 (필요 시)
4. x402 결제 재활성화 검토

---

## 6. 수익화 전략

### 6.1 가격 정책 (research/14 참조)

v1.17.0 완성 후 x402 결제 재활성화:

| 엔드포인트 | 가격 | 근거 |
|-----------|------|------|
| 지수 (indices) | $0.03 | 기본 시세 데이터 |
| 지수 히스토리 | $0.05 | 히스토리 조회 |
| 모멘텀 (movers) | $0.05 | 시장 분석 |
| 투자자 수급 (flow) | $0.05 | 독점적 데이터 — 프리미엄 가치 |
| 종목 수급 | $0.05 | 독점적 데이터 |
| 종목 분석 | $0.05 | 계산 비용 |
| 공시 | $0.03 | DART 데이터 래핑 |
| ETF | $0.03 | 리스트 조회 |
| Stock Brief | $0.10 | 번들 할인 |

### 6.2 독점적 가치

"영어로 한국 주식 외인/기관 수급 데이터를 저렴하게 API로 제공하는 곳은 세계에 없다."
— research/14-korea-stock-data.md

- TradePulse: 월 $10,000 (유일한 경쟁자)
- CrossFin: 콜당 $0.05 (x402)
- EWY ETF 1년 순유입 $47.9억 → 수요 입증

---

## 7. 리스크 & 대응

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| KRX API 해외 접근 차단 | 중 | 높음 | Cloudflare Workers Edge → 한국 리전 우선 라우팅, 또는 한국 VPS 프록시 |
| KRX API 구조 변경 | 낮 | 중 | 응답 파싱에 방어적 코딩, 모니터링 알림 |
| DART API 일일 한도 초과 | 낮 | 낮 | 캐싱으로 실제 호출 최소화 (일 100건 이하 예상) |
| KRX 이용약관 재배포 제한 | 중 | 높음 | 이용약관 정밀 검토 필요, 필요 시 KRX 데이터 구독 계약 |
| Cloudflare Workers 실행 시간 초과 | 낮 | 중 | KRX 응답 지연 시 타임아웃 설정 (5초), 캐시 폴백 |

---

## 8. 의사결정 필요 사항

다음 항목은 구현 전 결정 필요:

1. **KRX 이용약관 검토** — 데이터 재배포가 허용되는지 확인
2. **새 경로 네이밍** — `/api/v2/korea/...` vs `/api/korea/...` vs 기존 경로 재사용
3. **x402 결제 시점** — Phase 1부터 유료 vs 전체 완성 후 유료화
4. **글로벌 지수 차트** — 복원할 것인지, 한국 주식에 집중할 것인지
5. **종목 뉴스 소스** — DART 공시로 대체 vs 별도 뉴스 API 도입 vs 제외

---

## Sources

- [KRX 정보데이터시스템](https://data.krx.co.kr)
- [DART 전자공시시스템 OpenAPI](https://opendart.fss.or.kr)
- [research/14-korea-stock-data.md](./14-korea-stock-data.md) — 수익화 기회 분석
- [한국투자증권 Open API](https://github.com/koreainvestment/open-trading-api)
