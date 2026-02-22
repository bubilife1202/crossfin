# CrossFin API 데이터 정확성 & 법적 리스크 감사 보고서

> 작성일: 2026-02-21
> Task #22: 데이터 정확성 리스크 감사 & 면책 조항 분석

---

## 목차

1. [요약 (Executive Summary)](#1-요약)
2. [데이터 정확성 리스크 분석](#2-데이터-정확성-리스크-분석)
3. [면책 조항 현황 분석](#3-면책-조항-현황-분석)
4. [잘못된 정보 시나리오 분석](#4-잘못된-정보-시나리오-분석)
5. [경쟁사 면책 사례 분석](#5-경쟁사-면책-사례-분석)
6. [위험 등급별 정리](#6-위험-등급별-정리)
7. [필요한 면책 조항 문구](#7-필요한-면책-조항-문구)
8. [API 응답 disclaimer 필드 구현 예시](#8-api-응답-disclaimer-필드-구현-예시)
9. [조치 로드맵](#9-조치-로드맵)

---

## 1. 요약

CrossFin API의 데이터 정확성과 법적 리스크를 소스 코드 수준에서 감사한 결과, **심각한 손해배상 리스크가 존재하는 영역은 제한적이나, 개선이 필요한 영역이 다수** 발견되었다.

### 핵심 발견 사항

| 등급 | 항목 수 | 요약 |
|------|---------|------|
| :red_circle: 즉시 수정 필요 | 4 | 캐시 폴백 시 stale 데이터 무경고 반환, 면책 조항 누락 엔드포인트, 슬리피지 추정 한계 미고지, 하드코딩 폴백 환율 |
| :yellow_circle: 권장 개선 | 5 | 면책 조항 강화, 데이터 소스 투명성, ToS 부재, FAVORABLE 표현 완화, 네이버 의존성 |
| :green_circle: 안전 | 4 | 다중 데이터 소스, 기본 면책 포함, VASP 비해당, 오더북 기반 계산 |

---

## 2. 데이터 정확성 리스크 분석

### 2.1 김치프리미엄 계산 로직

**파일**: `apps/api/src/index.ts` (라인 6589-6612), `apps/api/src/lib/fetchers.ts` (라인 970-999)

**계산 방식**:
```
premiumPct = ((bithumbUsd - binancePrice) / binancePrice) * 100
bithumbUsd = bithumbKrw / krwRate
```

**데이터 소스**:
- 한국 가격: 빗썸 API (`https://api.bithumb.com/public/ticker/ALL_KRW`) - `closing_price` 사용
- 글로벌 가격: Binance > OKX > Bybit > CryptoCompare > CoinGecko > D1 스냅샷 순으로 폴백
- 환율: `open.er-api.com` (무료 API)

**리스크 요소**:

| 항목 | 상세 | 리스크 |
|------|------|--------|
| **빗썸 `closing_price`** | 최종 체결가 사용 (호가 중간값이 아님) | 호가 스프레드가 넓은 코인에서 부정확 가능 |
| **환율 업데이트 주기** | 성공 시 5분 TTL (`FX_RATE_SUCCESS_TTL_MS = 5 * 60_000`) | 환율 급변 시 최대 5분간 오래된 환율로 계산 |
| **글로벌 가격 캐시** | 성공 시 10초 TTL (`GLOBAL_PRICES_SUCCESS_TTL_MS = 10_000`) | 실시간에 가깝지만 최대 10초 지연 |
| **빗썸 가격 캐시** | 성공 시 10초 TTL (`BITHUMB_ALL_SUCCESS_TTL_MS = 10_000`) | 최대 10초 지연 |

**:red_circle: 위험**: 환율 API 다운 시 하드코딩된 폴백값 `{ KRW: 1450, JPY: 150, INR: 85 }` 사용 (fetchers.ts 라인 851). 실제 환율과 크게 다를 수 있으며, 사용자에게 폴백값 사용 중임을 알리지 않음.

### 2.2 환율 데이터

**파일**: `apps/api/src/lib/fetchers.ts` (라인 836-883)

**소스**: `https://open.er-api.com/v6/latest/USD` (무료 오픈 API)

**안전장치**:
- KRW: 500-5000 범위 검증 (`krw < 500 || krw > 5000`)
- JPY: 50-300 범위 검증
- INR: 20-200 범위 검증

**:yellow_circle: 이슈**: open.er-api.com은 무료 서비스로 SLA가 없다. 환율은 하루 1회 업데이트되며 실시간이 아니다. 하지만 API 응답에서 환율 소스(`source: 'open.er-api.com'`)는 명시되어 있어 투명성은 확보됨.

### 2.3 거래소 API 호출 & 에러 핸들링

**파일**: `apps/api/src/lib/fetchers.ts` 전체

**에러 핸들링 패턴**:

모든 거래소 fetcher는 동일한 패턴을 따름:

```typescript
// 1. 캐시 확인
if (cached && now < cached.expiresAt) return cached.value

// 2. In-flight 요청 중복 방지
if (globalAny.__crossfinXxxInFlight) return globalAny.__crossfinXxxInFlight

// 3. 실패 시 fallback
catch {
  globalAny.__crossfinXxxCache = { value: fallback, expiresAt: now + FAILURE_TTL_MS }
  if (Object.keys(fallback).length > 0) return fallback
  throw new HTTPException(502, { message: 'API unavailable' })
}
```

**:red_circle: 핵심 위험 - Stale 캐시 데이터 무경고 반환**:

API가 다운되면 이전 캐시 데이터를 반환하지만, **사용자에게 데이터가 캐시/stale임을 알리지 않는다**. 예를 들어:

- Binance API 다운 시: 이전에 캐시된 가격을 반환 (최대 10초 전 데이터)
- 모든 글로벌 거래소 API 다운 시: CryptoCompare > CoinGecko > D1 스냅샷 순으로 폴백하지만 최종 응답에서 어떤 소스를 사용했는지 대부분의 엔드포인트에서 표시하지 않음
- 빗썸 API 다운 시: 캐시된 데이터 반환 (실패 TTL 2초) 또는 빈 객체면 502 에러

**긍정적 측면**:
- 라우팅 엔드포인트의 `dataFreshness` 필드(`'live' | 'cached' | 'stale'`)는 데이터 신선도를 표시함 (index.ts 라인 6485)
- Binance는 5개 미러 URL로 failover 구현
- `fetchGlobalPrices()`는 4단계 폴백 체인 보유 (Binance+OKX+Bybit > CryptoCompare > CoinGecko > D1)

### 2.4 라우팅 엔진 - 수수료/슬리피지 계산

**파일**: `apps/api/src/lib/engine.ts`, `apps/api/src/index.ts` (라인 6097-6500)

**슬리피지 계산** (engine.ts 라인 11-47):
```typescript
estimateSlippage(levels, tradeAmountKrw)
// - 오더북 레벨을 순회하며 가중평균가 계산
// - 오더북이 없으면 기본 2.0% 반환
// - 오더북이 얇으면 remaining > 0 상태로 종료될 수 있음
```

**:red_circle: 위험 - 슬리피지 추정의 한계**:

1. **고정 거래 규모 사용**: 아비트리지 기회 계산에서 `TRADE_SIZE_KRW = 15_000_000` (약 $10,000) 고정 사용 (index.ts 라인 6717). 실제 거래 규모가 다르면 슬리피지가 크게 달라질 수 있음.
2. **오더북 깊이 부족 시**: `totalQty === 0`이면 기본 2.0% 반환 - 실제로는 훨씬 높을 수 있음.
3. **라우팅에서 `buySlippagePct = 0.10` 하드코딩**: 글로벌 거래소의 슬리피지를 0.10%로 고정 추정 (index.ts 라인 6257). 실제 오더북을 참조하지 않음.
4. **`skipOrderbook = true`**: 라우팅 경로 계산 시 대부분 오더북 조회를 건너뜀 (index.ts 라인 6274). 성능 최적화이나 정확도 저하.

**:yellow_circle: 이슈 - Coinone/GOPAX 오더북 미사용**:
- Coinone 가격은 `fetchCoinoneTicker`로 가져오지만 오더북은 가져오지 않음 (빈 `asks: []` 반환)
- GOPAX도 마찬가지
- 이들 거래소에서의 슬리피지 추정은 0%로 계산됨 - 실제보다 낙관적

### 2.5 주식 데이터 (네이버 금융)

**파일**: `apps/api/src/index.ts` (라인 7209-7960)

**소스**: 네이버 금융 모바일 API (`m.stock.naver.com/api/...`)

**:yellow_circle: 주요 리스크**:

1. **비공식 API 사용**: `m.stock.naver.com/api/*`는 네이버의 공식 외부 API가 아닌 모바일 웹앱용 내부 API. 사전 고지 없이 변경/차단 가능.
2. **에러 핸들링 미흡**: 대부분의 네이버 엔드포인트는 `res.ok` 확인 후 실패 시 502 에러를 던지지만, 응답 구조 변경 시 파싱 에러 가능.
3. **캐시 없음**: 네이버 데이터는 캐싱하지 않아, 네이버 API 변경 시 즉시 장애.
4. **데이터 지연**: 네이버 금융 자체의 데이터 지연(약 15분 지연 가능)이 CrossFin 응답에 그대로 전달.
5. **ETF 데이터**: 별도 URL(`finance.naver.com/api/sise/etfItemList.nhn`) 사용 - 레거시 API로 더 불안정할 수 있음.

---

## 3. 면책 조항 현황 분석

### 3.1 현재 면책 조항

**파일**: `apps/api/src/constants.ts` (라인 1)

```typescript
export const CROSSFIN_DISCLAIMER = 'This data is for informational purposes only and does not constitute investment advice, financial advice, or trading advice. CrossFin is not a registered investment advisor. All trading decisions are made at the user\'s own risk. 본 데이터는 정보 제공 목적으로만 제공되며 투자 자문에 해당하지 않습니다.'
```

### 3.2 면책 조항 포함 현황

| 엔드포인트 유형 | `_disclaimer` 포함 | 개수 |
|----------------|-------------------|------|
| 유료 금융 데이터 엔드포인트 | :white_check_mark: 포함 | ~30개 |
| 무료 메타데이터/헬스 엔드포인트 | :x: 미포함 | ~10개 |
| 레지스트리/서비스 엔드포인트 | :x: 미포함 | ~15개 |
| 분석/관리 엔드포인트 | :x: 미포함 | ~20개 |
| 에러 응답 | :x: 미포함 | 전체 |

**:red_circle: 위험 - 일부 금융 관련 엔드포인트에 면책 미포함**:

총 ~115개 JSON 응답 중 약 45개만 `_disclaimer` 필드를 포함한다. 금융 데이터를 반환하는 주요 엔드포인트에는 대부분 포함되어 있으나, 다음이 누락될 수 있음:
- 라우팅 관련 일부 내부 응답
- ACP 실행 관련 응답
- 텔레그램 봇 응답

### 3.3 이용약관 (Terms of Service)

**:red_circle: 부재**: 프로젝트에 별도의 Terms of Service, 이용약관, 개인정보처리방침 파일이 **존재하지 않는다**.

### 3.4 현재 면책 조항의 한계

1. **한국어 면책이 너무 간략**: 영어는 3문장이나 한국어는 1문장으로 축약
2. **데이터 정확성 면책 없음**: "데이터가 부정확할 수 있음"에 대한 면책이 없음
3. **손해배상 면책 없음**: 데이터 사용으로 인한 손해에 대한 책임 제한 조항 없음
4. **서비스 중단 면책 없음**: API 다운타임이나 데이터 지연에 대한 면책 없음
5. **제3자 데이터 면책 없음**: 빗썸, Binance, 네이버 등 제3자 데이터 소스에 대한 면책 없음

---

## 4. 잘못된 정보 시나리오 분석

### 시나리오 1: 거래소 API 다운 + 캐시된 오래된 가격 반환

**발생 조건**: Binance, OKX, Bybit 모두 동시 장애
**코드 동작** (`fetchGlobalPrices` - fetchers.ts 라인 610-830):
1. CryptoCompare 폴백 시도
2. CoinGecko 폴백 시도
3. D1 스냅샷 폴백 (최대 7일 전 데이터!)
4. 이전 캐시 반환

**:red_circle: 손해배상 시나리오**:
- 사용자가 7일 전 스냅샷 기반의 김치프리미엄 데이터를 실시간으로 착각
- 이를 근거로 아비트리지 거래 실행
- 실제 가격과 크게 다른 결과로 손실 발생
- **위험도: 높음** - D1 스냅샷 폴백 시 데이터 나이(age)가 표시되지 않음

### 시나리오 2: 환율 API 다운 + 하드코딩 폴백

**발생 조건**: open.er-api.com 장애
**코드 동작** (fetchers.ts 라인 851):
```typescript
const fallback = cached?.value ?? { KRW: 1450, JPY: 150, INR: 85 }
```

**:red_circle: 손해배상 시나리오**:
- 실제 환율이 1350원인데 1450원으로 계산
- 김치프리미엄이 약 7% 과대평가
- 사용자가 실제로 존재하지 않는 아비트리지 기회를 인식
- **위험도: 높음** - 환율 오차가 모든 원화 관련 계산에 전파됨

### 시나리오 3: 네이버 금융 API 구조 변경

**발생 조건**: 네이버가 모바일 API 응답 구조 변경
**코드 동작**: `isRecord` 검증 실패 시 빈 데이터 또는 `null` 반환
**영향**:
- KOSPI/KOSDAQ 지수: 502 에러 발생 (비교적 안전한 처리)
- 주식 상세/뉴스/테마: 빈 결과 반환 가능
- **위험도: 중간** - 에러로 처리되므로 잘못된 데이터보다는 서비스 불가 상태

### 시나리오 4: 오더북이 얇을 때 슬리피지 과소추정

**발생 조건**: 소형 알트코인 또는 비주류 거래소
**코드 동작** (engine.ts 라인 44):
```typescript
if (totalQty === 0) return 2.0 // default high slippage if no depth
```

**:yellow_circle: 손해배상 시나리오**:
- 오더북이 매우 얇은 코인에서 2% 슬리피지 추정
- 실제 슬리피지가 10%+
- 사용자가 "수익성 있음"으로 표시된 아비트리지를 실행했으나 손실
- **위험도: 중간** - 기본 2%는 보수적이나 극단적 케이스에서 부족

### 시나리오 5: FAVORABLE 신호를 투자 추천으로 해석

**발생 조건**: 아비트리지 기회 엔드포인트의 `indicator: 'FAVORABLE'` 응답
**코드 동작** (engine.ts 라인 88-120):
```typescript
if (score > 1.0) {
  return {
    indicator: 'FAVORABLE',
    signalStrength: ...,
    reason: `Adjusted profit ... exceeds risk ... with strong margin`,
  }
}
```

**:yellow_circle: 리스크**:
- `FAVORABLE` + `signalStrength: 0.95` + `reason: "strong margin"` 조합이 투자 추천으로 해석될 여지
- 면책 조항이 있으나 `reason` 필드의 표현이 적극적
- 금감원의 "API를 통한 조직적 거래 패턴 감시"에 포착될 가능성

---

## 5. 경쟁사 면책 사례 분석

### 5.1 CoinGecko

**면책 핵심 요소**:
- 모든 데이터를 **"AS IS" 및 "AS AVAILABLE"** 기반으로 제공
- **정확성, 완전성, 신뢰성에 대한 보증 명시적 부인**
- 투자 조언, 금융 조언, 거래 조언에 해당하지 않음을 명시
- **사용자 책임**: API 사용자는 자신의 고객에게 데이터 제한사항을 고지할 의무
- **책임 제한**: 최대 배상 한도 S$50 (싱가포르 달러)
- 명시적/묵시적 보증 모두 부인 (상품성, 특정 목적 적합성, 비침해)

### 5.2 CoinMarketCap

**면책 핵심 요소**:
- "정보는 투자 조언, 금융 조언, 거래 조언 **어떤 종류의 조언에도 해당하지 않음**"
- "정확성을 위해 노력하되 **틀린 정보에 대한 책임은 지지 않음**"
- 사용자의 **자체 실사(due diligence)** 및 금융 자문가 상담 권고
- 플랫폼 사용 또는 정보 신뢰로 인한 **어떤 종류의 손해에도 책임 없음**

### 5.3 CryptoQuant

**면책 핵심 요소**:
- 데이터 및 분석의 **정확성/완전성에 대한 책임 부인**
- **24/7 가용성 보장하지 않음**, 전송 지연/오류/중단에 책임 없음
- **금융 자문가 아님**, 데이터 기반 의사결정 전 전문가 상담 권고
- 명시적/묵시적 **모든 보증 부인**

### 5.4 공통 패턴 요약

경쟁사들이 공통적으로 포함하는 면책 요소:

1. **"AS IS" 제공**: 데이터의 정확성, 완전성, 시의성 보증하지 않음
2. **투자 조언 아님**: 어떤 종류의 금융/투자/거래 조언에도 해당하지 않음
3. **사용자 책임**: 데이터 기반 의사결정은 전적으로 사용자 책임
4. **손해배상 면책**: 데이터 사용으로 인한 직접적/간접적 손해에 책임 없음
5. **서비스 보증 없음**: 서비스 가용성, 무중단 운영 보증하지 않음
6. **제3자 데이터**: 제3자 데이터 소스의 정확성에 대한 책임 없음
7. **책임 한도**: 최대 배상 한도를 매우 낮게 설정 (CoinGecko: S$50)

**CrossFin과의 차이점**: CrossFin의 현재 면책 조항은 위 7개 요소 중 **2번만 부분적으로 충족**한다.

---

## 6. 위험 등급별 정리

### :red_circle: 즉시 수정 필요 (손해배상 가능성 있는 것)

#### R1. 캐시 폴백 시 Stale 데이터 무경고 반환

- **위치**: `apps/api/src/lib/fetchers.ts` 전체 fetcher 함수
- **문제**: 거래소 API 장애 시 이전 캐시 데이터를 반환하되, 응답에 데이터가 stale임을 표시하지 않음
- **손해배상 시나리오**: 사용자가 오래된 가격을 실시간으로 착각하고 거래 실행
- **수정 방안**: 모든 금융 데이터 응답에 `dataSource` 및 `dataAge` 필드 추가. 폴백 시 `"warning": "This data may be delayed"` 포함

#### R2. 면책 조항 부재 엔드포인트

- **위치**: `apps/api/src/index.ts` 전체 (~115개 응답 중 ~45개만 면책 포함)
- **문제**: 금융 데이터를 반환하는 일부 엔드포인트에 `_disclaimer` 필드 누락
- **손해배상 시나리오**: 면책 없는 엔드포인트의 데이터로 손실 발생 시 면책 주장 불가
- **수정 방안**: 글로벌 미들웨어에서 모든 JSON 응답에 자동으로 면책 필드 삽입

#### R3. 슬리피지 추정 한계 미고지

- **위치**: `apps/api/src/lib/engine.ts` (라인 11-47), `apps/api/src/index.ts` (라인 6257)
- **문제**:
  - 글로벌 거래소 슬리피지를 0.10%로 하드코딩
  - 오더북 없으면 2.0% 기본값 (실제보다 낙관적일 수 있음)
  - Coinone/GOPAX 오더북 미참조 (0% 슬리피지)
  - `TRADE_SIZE_KRW = 15,000,000` 고정 기준
- **손해배상 시나리오**: 슬리피지 과소추정으로 "수익성 있음"으로 표시된 기회가 실제로는 손실
- **수정 방안**: 응답에 "슬리피지는 추정치이며 실제와 다를 수 있음" 경고 추가. 거래 규모 기반 슬리피지 추정 구현 검토.

#### R4. 하드코딩된 폴백 환율

- **위치**: `apps/api/src/lib/fetchers.ts` (라인 851)
- **문제**: 환율 API 실패 시 `{ KRW: 1450, JPY: 150, INR: 85 }` 하드코딩 폴백 사용. 현재 실제 환율과 다를 수 있음.
- **손해배상 시나리오**: 폴백 환율이 실제와 100원+ 차이 시, 김치프리미엄이 수 %p 왜곡
- **수정 방안**: 폴백 사용 시 응답에 `"fxWarning": "Using fallback exchange rate"` 필드 추가. 폴백값을 정기적으로 업데이트하는 메커니즘 구현.

### :yellow_circle: 권장 개선 사항

#### Y1. 면책 조항 내용 강화

- **현재**: 투자 조언 아님 + 사용자 책임만 명시
- **필요**: AS IS 제공, 데이터 정확성 미보증, 손해배상 면책, 서비스 가용성 미보증, 제3자 데이터 면책, 책임 한도 설정

#### Y2. Terms of Service (이용약관) 부재

- 별도의 ToS 파일이 프로젝트에 존재하지 않음
- API 사용의 법적 프레임워크가 없음
- 분쟁 해결 절차, 준거법, 관할법원 명시 필요

#### Y3. 데이터 소스 투명성 강화

- 대부분의 엔드포인트에서 `source` 필드는 있으나, 데이터가 실시간인지 캐시인지 표시하지 않음
- `dataFreshness` 필드가 라우팅 엔드포인트에만 존재 (index.ts 라인 5951)
- 모든 금융 데이터 응답에 데이터 나이/신선도 표시 권장

#### Y4. FAVORABLE/UNFAVORABLE 표현 완화 검토

- `indicator: 'FAVORABLE'`, `signalStrength: 0.95`, `reason: "strong margin"` 조합이 투자 추천으로 해석될 여지
- 기존 규제 분석(18-regulation-compliance.md)에서도 중립적 데이터 표현 권장
- 금감원의 "API를 통한 조직적 거래 패턴 감시" 강화에 주의 필요

#### Y5. 네이버 금융 의존성 리스크

- 비공식 API 사용으로 사전 고지 없는 변경/차단 가능
- 캐시 미적용으로 장애 시 즉시 영향
- 대체 데이터 소스 또는 캐시 레이어 검토 필요

### :green_circle: 안전한 것 (문제 없는 것)

#### G1. 다중 데이터 소스 폴백 체인

- 글로벌 가격: Binance(5개 미러) > OKX > Bybit > CryptoCompare > CoinGecko > D1
- 단일 소스 장애 시에도 서비스 연속성 확보
- 개별 가격 gap-fill 메커니즘도 구현됨

#### G2. 기본 면책 조항 포함

- 주요 유료 금융 데이터 엔드포인트에 `_disclaimer` 필드 포함
- "투자 자문에 해당하지 않습니다" 명시
- 한국어 면책도 (간략하지만) 포함

#### G3. VASP 비해당 가능성 높음

- 규제 분석(18-regulation-compliance.md)에 따르면, 현재 서비스는 "단순 시세 정보 제공"으로 VASP 비해당
- 실제 거래 실행 기능 없음 (시뮬레이션만)

#### G4. 아비트리지 계산의 보수적 요소

- 출금 수수료 포함 계산 (빗썸 실시간 동기화)
- 출금 정지 코인 감지 시 `UNFAVORABLE` 강제 설정
- 거래량 기반 리스크 스코어 (`high`/`medium`/`low`)
- 프리미엄 트렌드 및 변동성 반영

---

## 7. 필요한 면책 조항 문구

### 7.1 메인 면책 조항 (한국어)

```
[면책 고지]

1. 본 서비스는 정보 제공 목적으로만 제공되며, 투자 자문, 금융 자문, 거래 자문 또는 어떠한 종류의
   전문적 조언에도 해당하지 않습니다. CrossFin은 등록된 투자자문업자가 아닙니다.

2. 본 서비스를 통해 제공되는 모든 데이터, 분석, 정보는 "있는 그대로(AS IS)" 제공되며,
   그 정확성, 완전성, 시의성 또는 신뢰성에 대하여 명시적이든 묵시적이든 어떠한 보증도
   하지 않습니다.

3. 본 서비스의 데이터는 제3자 거래소 API, 외부 환율 서비스, 외부 금융 데이터 제공업체
   등 외부 소스에서 수집되며, CrossFin은 이러한 외부 소스 데이터의 정확성에 대하여
   책임을 지지 않습니다. 데이터 전송 과정에서 지연, 오류, 누락이 발생할 수 있습니다.

4. 본 서비스에서 제공하는 김치프리미엄, 아비트리지 기회, 라우팅 추천, 시장 분석 등의
   정보는 참고용이며, 특정 가상자산이나 금융 상품의 매수, 매도, 보유를 권유하거나
   추천하는 것이 아닙니다.

5. 슬리피지, 수수료, 전송 시간 등의 추정치는 과거 데이터와 현재 시장 상황에 기반한
   추정값이며, 실제 거래 결과와 상이할 수 있습니다. 특히 유동성이 낮은 시장에서는
   추정치와 실제 결과 간의 차이가 클 수 있습니다.

6. 본 서비스의 이용으로 발생하는 모든 투자 결정 및 거래는 이용자의 독립적인 판단과
   책임 하에 이루어지며, CrossFin은 이러한 결정으로 인한 직접적, 간접적, 부수적,
   결과적 또는 특별한 손해에 대하여 어떠한 책임도 부담하지 않습니다.

7. 본 서비스는 24시간 무중단 운영을 보장하지 않으며, 유지보수, 업그레이드, 외부 서비스
   장애 등으로 인한 서비스 중단이나 데이터 지연이 발생할 수 있습니다.

8. 본 서비스 이용에 따른 모든 분쟁은 대한민국 법률을 준거법으로 하며,
   서울중앙지방법원을 전속적 합의관할법원으로 합니다.
```

### 7.2 메인 면책 조항 (English)

```
[DISCLAIMER]

1. This service is provided for informational purposes only and does not constitute
   investment advice, financial advice, trading advice, or any form of professional
   recommendation. CrossFin is not a registered investment advisor.

2. All data, analyses, and information provided through this service are offered on
   an "AS IS" and "AS AVAILABLE" basis, without warranties of any kind, whether
   express or implied, including but not limited to warranties of accuracy,
   completeness, timeliness, merchantability, fitness for a particular purpose,
   or non-infringement.

3. Data is sourced from third-party exchange APIs, external FX rate services, and
   external financial data providers. CrossFin assumes no responsibility for the
   accuracy of such third-party data. Delays, errors, and omissions may occur
   during data transmission.

4. Information including but not limited to kimchi premium, arbitrage opportunities,
   routing recommendations, and market analyses is provided as reference only and
   does not constitute a recommendation to buy, sell, or hold any virtual asset or
   financial instrument.

5. Estimates of slippage, fees, transfer times, and other metrics are based on
   historical data and current market conditions and may differ materially from
   actual trading outcomes. Deviations may be particularly significant in
   low-liquidity markets.

6. All investment decisions and trades made based on this service are at the user's
   sole discretion and risk. CrossFin shall not be liable for any direct, indirect,
   incidental, consequential, or special damages arising from such decisions.

7. This service does not guarantee uninterrupted operation. Service interruptions
   or data delays may occur due to maintenance, upgrades, or third-party service
   outages.

8. IN NO EVENT SHALL CROSSFIN'S TOTAL LIABILITY EXCEED THE AMOUNT PAID BY THE USER
   FOR THE SPECIFIC API CALL THAT GAVE RISE TO THE CLAIM.
```

### 7.3 API 응답용 간략 면책 (한국어/영어 병기)

```
This data is provided "AS IS" for informational purposes only. It does not constitute investment advice. Data accuracy, completeness, and timeliness are not guaranteed. All trading decisions are at the user's sole risk. CrossFin is not liable for any losses arising from the use of this data. | 본 데이터는 정보 제공 목적의 "있는 그대로" 제공이며, 투자 자문에 해당하지 않습니다. 데이터의 정확성, 완전성, 시의성은 보증되지 않습니다. 모든 거래 결정은 이용자의 책임이며, CrossFin은 본 데이터 사용으로 인한 어떠한 손해에도 책임을 지지 않습니다.
```

---

## 8. API 응답 disclaimer 필드 구현 예시

### 8.1 강화된 disclaimer 상수

```typescript
// apps/api/src/constants.ts

export const CROSSFIN_DISCLAIMER =
  'This data is provided "AS IS" for informational purposes only. ' +
  'It does not constitute investment advice. Data accuracy, completeness, ' +
  'and timeliness are not guaranteed. All trading decisions are at the ' +
  "user's sole risk. CrossFin is not liable for any losses arising from " +
  'the use of this data. | ' +
  '본 데이터는 정보 제공 목적의 "있는 그대로" 제공이며, 투자 자문에 해당하지 않습니다. ' +
  '데이터의 정확성, 완전성, 시의성은 보증되지 않습니다. 모든 거래 결정은 이용자의 ' +
  '책임이며, CrossFin은 본 데이터 사용으로 인한 어떠한 손해에도 책임을 지지 않습니다.'

export const CROSSFIN_DISCLAIMER_URL = 'https://crossfin.xyz/legal/disclaimer'
export const CROSSFIN_TOS_URL = 'https://crossfin.xyz/legal/terms'
```

### 8.2 글로벌 미들웨어로 자동 삽입

```typescript
// apps/api/src/index.ts - 글로벌 미들웨어

import { CROSSFIN_DISCLAIMER, CROSSFIN_DISCLAIMER_URL } from './constants'

// 모든 JSON 응답에 자동으로 면책 필드 추가
app.use('*', async (c, next) => {
  await next()

  // JSON 응답에만 적용
  const contentType = c.res.headers.get('content-type')
  if (!contentType?.includes('application/json')) return

  try {
    const body = await c.res.json()
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      const enhanced = {
        ...body,
        _legal: {
          disclaimer: CROSSFIN_DISCLAIMER,
          disclaimerUrl: CROSSFIN_DISCLAIMER_URL,
          tosUrl: CROSSFIN_TOS_URL,
          dataProvision: 'AS_IS',
          notInvestmentAdvice: true,
        },
      }
      c.res = c.json(enhanced, c.res.status)
    }
  } catch {
    // 파싱 실패 시 원본 응답 유지
  }
})
```

### 8.3 데이터 신선도 표시 예시

```typescript
// 모든 금융 데이터 응답에 포함할 메타데이터
interface DataMeta {
  _disclaimer: string
  _legal: {
    disclaimer: string
    disclaimerUrl: string
    tosUrl: string
    dataProvision: 'AS_IS'
    notInvestmentAdvice: true
  }
  _dataMeta: {
    freshness: 'live' | 'cached' | 'stale' | 'fallback'
    sourceAgeMs: number
    sources: string[]
    warnings: string[]
  }
  at: string
}

// 응답 예시
{
  "paid": true,
  "service": "crossfin-kimchi-premium",
  "krwUsdRate": 1385.50,
  "pairsTracked": 11,
  "avgPremiumPct": 2.15,
  "premiums": [...],
  "_disclaimer": "This data is provided \"AS IS\" for informational purposes only...",
  "_legal": {
    "disclaimer": "This data is provided \"AS IS\" for informational purposes only...",
    "disclaimerUrl": "https://crossfin.xyz/legal/disclaimer",
    "tosUrl": "https://crossfin.xyz/legal/terms",
    "dataProvision": "AS_IS",
    "notInvestmentAdvice": true
  },
  "_dataMeta": {
    "freshness": "live",
    "sourceAgeMs": 3200,
    "sources": ["bithumb", "binance", "open.er-api.com"],
    "warnings": []
  },
  "at": "2026-02-21T10:30:00.000Z"
}

// 폴백 데이터 사용 시 응답 예시
{
  "paid": true,
  "service": "crossfin-kimchi-premium",
  "krwUsdRate": 1450,
  "_dataMeta": {
    "freshness": "fallback",
    "sourceAgeMs": 86400000,
    "sources": ["d1-snapshot"],
    "warnings": [
      "Exchange rate is using hardcoded fallback value (1450 KRW/USD). Actual rate may differ significantly.",
      "Price data is from D1 snapshot, not real-time. Data may be up to 7 days old."
    ]
  },
  "_disclaimer": "...",
  "at": "2026-02-21T10:30:00.000Z"
}
```

### 8.4 아비트리지 응답 표현 완화 예시

```typescript
// 현재: 적극적 표현
{
  "indicator": "FAVORABLE",
  "signalStrength": 0.92,
  "reason": "Adjusted profit 2.15% exceeds risk 0.3% with strong margin"
}

// 권장: 중립적 표현
{
  "marketSignal": "POSITIVE_SPREAD",  // FAVORABLE -> POSITIVE_SPREAD
  "confidenceLevel": 0.92,            // signalStrength -> confidenceLevel
  "analysis": "Spread of 2.15% observed after estimated costs. Historical volatility risk: 0.3%.",
  "caveat": "This is a data observation, not a trading recommendation. Actual results may vary significantly."
}
```

---

## 9. 조치 로드맵

### 즉시 조치 (1-2주)

| # | 조치 | 대상 파일 | 위험 해소 |
|---|------|----------|----------|
| 1 | 면책 조항 텍스트 강화 (7.3절 적용) | `constants.ts` | R2, Y1 |
| 2 | 폴백 데이터 사용 시 `warnings` 필드 추가 | `fetchers.ts`, `index.ts` | R1, R4 |
| 3 | 슬리피지 추정 한계 경고 추가 | `engine.ts`, `index.ts` | R3 |
| 4 | 글로벌 미들웨어로 모든 응답에 면책 자동 삽입 | `index.ts` | R2 |
| 5 | 환율 폴백 경고 메시지 추가 | `fetchers.ts` | R4 |

### 단기 조치 (1-2개월)

| # | 조치 | 비고 |
|---|------|------|
| 6 | Terms of Service (이용약관) 페이지 작성/배포 | Y2 |
| 7 | Privacy Policy (개인정보처리방침) 작성 | 법적 필수 |
| 8 | `_dataMeta` 필드 전면 도입 (8.3절) | Y3 |
| 9 | FAVORABLE/UNFAVORABLE 표현 중립화 검토 | Y4 |
| 10 | 네이버 금융 데이터 캐시 레이어 추가 | Y5 |

### 중기 조치 (3-6개월)

| # | 조치 | 비고 |
|---|------|------|
| 11 | 한국 가상자산 전문 법무법인 자문 확보 | 18-regulation-compliance.md 권고 |
| 12 | x402 USDC 결제의 VASP 해당 여부 법률 자문 | 규제 리스크 |
| 13 | 글로벌 거래소 오더북 기반 슬리피지 계산 구현 | R3 근본 해결 |
| 14 | 환율 데이터 소스 다중화 (유료 API 검토) | R4 근본 해결 |
| 15 | 네이버 금융 대체 데이터 소스 확보 | Y5 근본 해결 |

---

## 참고 자료

### 경쟁사 면책 사례
- [CoinGecko API Terms of Service](https://www.coingecko.com/en/api_terms)
- [CoinGecko Disclaimer](https://www.coingecko.com/en/disclaimer)
- [CoinMarketCap Disclaimer](https://coinmarketcap.com/disclaimer/)
- [CoinMarketCap Terms of Service](https://coinmarketcap.com/terms/)
- [CryptoQuant Terms of Service](https://cryptoquant.com/terms-of-service)

### 내부 참고 문서
- [CrossFin 규제 컴플라이언스 분석](/research/18-regulation-compliance.md)

### 관련 법률
- [가상자산 이용자 보호 등에 관한 법률](https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=261099)
- [금융위 VASP 신고 유권해석](https://www.sedaily.com/NewsView/2D5A479IUP)
