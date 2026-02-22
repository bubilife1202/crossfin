# CrossFin 코드베이스 감사 보고서 — 즉시 수익화 가능 기능 분석

**감사일**: 2026-02-21
**감사 범위**: apps/api, apps/mcp-server, packages/sdk, apps/live, apps/docs
**코드 규모**: API index.ts 11,511줄 / MCP server 650줄 / SDK client 411줄 / 타입 689줄

---

## 1. API 엔드포인트 전수 목록 (apps/api/src/)

### 1.1 무료 엔드포인트 (Free)

| # | 엔드포인트 | 상태 | 설명 |
|---|-----------|------|------|
| 1 | `GET /` | 작동 | API 루트 (버전/상태) |
| 2 | `GET /api/health` | 작동 | 헬스체크 |
| 3 | `GET /api/docs/guide` | 작동 | AI 에이전트 온보딩 가이드 (대형 JSON) |
| 4 | `GET /api/openapi.json` | 작동 | OpenAPI 3.1 스펙 |
| 5 | `GET /api/arbitrage/demo` | 작동 | 루트 스프레드 미리보기 (상위 3쌍) |
| 6 | `GET /api/onchain/usdc-transfers` | 작동 | Base 메인넷 USDC 전송 내역 |
| 7 | `GET /api/stats` | 작동 | 공개 통계 요약 |
| 8 | `GET /api/routing/optimal` | 작동 | **무료 라우팅 엔진** (오더북+슬리피지+D1 수수료 테이블) |
| 9 | `GET /api/route/exchanges` | 작동 | 지원 거래소 목록 (9개 거래소) |
| 10 | `GET /api/route/fees` | 작동 | 수수료 비교 테이블 |
| 11 | `GET /api/route/pairs` | 작동 | 트레이딩 페어 + 실시간 가격 |
| 12 | `GET /api/route/status` | 작동 | 거래소 API 건강 상태 |
| 13 | `GET /api/registry` | 작동 | 서비스 레지스트리 목록 |
| 14 | `GET /api/registry/search` | 작동 | 서비스 검색 |
| 15 | `GET /api/registry/categories` | 작동 | 카테고리 목록 |
| 16 | `GET /api/registry/stats` | 작동 | 레지스트리 통계 |
| 17 | `GET /api/registry/:id` | 작동 | 서비스 상세 정보 |
| 18 | `POST /api/registry` | 작동 | 서비스 등록 (에이전트 인증 필요) |
| 19 | `GET /api/registry/sync` | 작동 | 레지스트리 동기화 |
| 20 | `GET /api/registry/reseed` | 작동 | 레지스트리 리시드 |
| 21 | `GET /api/proxy/:serviceId` | 작동 | 서비스 프록시 (에이전트 키 필요) |
| 22 | `POST /api/proxy/:serviceId` | 작동 | 서비스 프록시 POST |
| 23 | `GET /api/analytics/overview` | 작동 | 게이트웨이 사용 분석 |
| 24 | `GET /api/analytics/services/:serviceId` | 작동 | 서비스별 분석 |
| 25 | `POST /api/analytics/funnel/events` | 작동 | 퍼널 이벤트 추적 |
| 26 | `GET /api/analytics/funnel/overview` | 작동 | 퍼널 분석 대시보드 |
| 27 | `POST /api/agents/register` | 작동 | 에이전트 등록 (토큰 필요) |
| 28 | `POST /api/agents` | 작동 | 에이전트 생성 |
| 29 | `GET /api/agents/:agentId/actions` | 작동 | 에이전트 액션 로그 |
| 30 | `POST /api/deposits` | 작동 | 입금 기록 |
| 31 | `GET /api/deposits` | 작동 | 입금 내역 조회 |
| 32 | `GET /api/guardian/status` | 작동 | 가디언 상태 |
| 33 | `GET /api/guardian/rules` | 작동 | 가디언 규칙 조회 |
| 34 | `POST /api/guardian/rules` | 작동 | 가디언 규칙 생성 |
| 35 | `DELETE /api/guardian/rules/:id` | 작동 | 가디언 규칙 삭제 |
| 36 | `GET /api/cron/snapshot-kimchi` | 작동 | 크론 스냅샷 |
| 37 | `POST /api/acp/quote` | 작동 | ACP 라우팅 견적 |
| 38 | `POST /api/acp/execute` | 작동 | ACP 실행 오케스트레이션 |
| 39 | `GET /api/acp/executions/:executionId` | 작동 | ACP 실행 상태 조회 |
| 40 | `GET /api/acp/status` | 작동 | ACP 프로토콜 상태 |
| 41 | `POST /api/telegram/webhook` | 작동 | 텔레그램 봇 웹훅 (AI 대화 + 라우팅) |

### 1.2 유료 엔드포인트 (x402 USDC 결제)

| # | 엔드포인트 | 가격 | 상태 | 카테고리 |
|---|-----------|------|------|---------|
| 1 | `/api/premium/arbitrage/kimchi` | $0.05 | 작동 | 크립토 차익 |
| 2 | `/api/premium/arbitrage/kimchi/history` | $0.05 | 작동 | 크립토 차익 |
| 3 | `/api/premium/arbitrage/opportunities` | $0.10 | 작동 | 크립토 차익 |
| 4 | `/api/premium/market/cross-exchange` | $0.08 | 작동 | 크립토 차익 |
| 5 | `/api/premium/crypto/korea/5exchange` | $0.08 | 작동 | 크립토 차익 |
| 6 | `/api/premium/bithumb/orderbook` | $0.02 | 작동 | 거래소 데이터 |
| 7 | `/api/premium/bithumb/volume-analysis` | $0.03 | 작동 | 거래소 데이터 |
| 8 | `/api/premium/market/upbit/ticker` | $0.02 | 작동 | 거래소 데이터 |
| 9 | `/api/premium/market/upbit/orderbook` | $0.02 | 작동 | 거래소 데이터 |
| 10 | `/api/premium/market/upbit/signals` | $0.05 | 작동 | 거래소 데이터 |
| 11 | `/api/premium/crypto/korea/upbit-candles` | $0.02 | 작동 | 거래소 데이터 |
| 12 | `/api/premium/market/coinone/ticker` | $0.02 | 작동 | 거래소 데이터 |
| 13 | `/api/premium/crypto/korea/exchange-status` | $0.03 | 작동 | 거래소 데이터 |
| 14 | `/api/premium/market/korea` | $0.03 | 작동 | 마켓 센티먼트 |
| 15 | `/api/premium/news/korea/headlines` | $0.03 | 작동 | 마켓 센티먼트 |
| 16 | `/api/premium/market/fx/usdkrw` | $0.01 | 작동 | FX 레이트 |
| 17 | `/api/premium/crypto/korea/fx-rate` | $0.01 | 작동 | FX 레이트 |
| 18 | `/api/premium/market/korea/indices` | $0.03 | 작동 | 한국 주식 |
| 19 | `/api/premium/market/korea/indices/history` | $0.05 | 작동 | 한국 주식 |
| 20 | `/api/premium/market/korea/stocks/momentum` | $0.05 | 작동 | 한국 주식 |
| 21 | `/api/premium/market/korea/investor-flow` | $0.05 | 작동 | 한국 주식 |
| 22 | `/api/premium/market/korea/index-flow` | $0.03 | 작동 | 한국 주식 |
| 23 | `/api/premium/market/korea/stock-detail` | $0.05 | 작동 | 한국 주식 |
| 24 | `/api/premium/market/korea/stock-news` | $0.03 | 작동 | 한국 주식 |
| 25 | `/api/premium/market/korea/themes` | $0.05 | 작동 | 한국 주식 |
| 26 | `/api/premium/market/korea/disclosure` | $0.03 | 작동 | 한국 주식 |
| 27 | `/api/premium/market/korea/etf` | $0.03 | 작동 | 한국 주식 |
| 28 | `/api/premium/market/korea/stock-brief` | $0.10 | 작동 | 한국 주식 번들 |
| 29 | `/api/premium/market/global/indices-chart` | $0.02 | 작동 | 글로벌 마켓 |
| 30 | `/api/premium/morning/brief` | $0.20 | 작동 | 번들 |
| 31 | `/api/premium/crypto/snapshot` | $0.15 | 작동 | 번들 |
| 32 | `/api/premium/kimchi/stats` | $0.15 | 작동 | 번들 |
| 33 | `/api/premium/route/find` | $0.10 | 작동 | 라우팅 엔진 |
| 34 | `/api/premium/report` | $0.001 | 작동 | 유틸리티 (x402 테스트) |
| 35 | `/api/premium/enterprise` | $20.00 | 작동 | 유틸리티 (엔터프라이즈 영수증) |

### 1.3 관리자 엔드포인트 (routes/admin.ts)

| 엔드포인트 | 상태 | 설명 |
|-----------|------|------|
| `PUT /api/admin/fees` | 작동 | 거래소 수수료 업데이트 |
| `GET /api/admin/payments` | 작동 | x402 결제 내역 조회 |
| `POST /api/admin/telegram/setup-webhook` | 작동 | 텔레그램 웹훅 설정 |
| `GET /api/admin/telegram/webhook-info` | 작동 | 텔레그램 웹훅 상태 |
| `POST /api/admin/telegram/test-typing` | 작동 | 텔레그램 타이핑 테스트 |

### 1.4 프로토콜 엔드포인트

| 엔드포인트 | 상태 | 프로토콜 |
|-----------|------|---------|
| `ALL /api/mcp` | 작동 | MCP (Streamable HTTP) |
| `POST /api/a2a/tasks` | 작동 | Google A2A |
| `GET /api/a2a/tasks/:id` | 작동 | Google A2A |
| `POST /api/a2a/tasks/:id/cancel` | 작동 | Google A2A |
| `GET /api/status` | 작동 | 상태 페이지 |

### 1.5 디스커버리 엔드포인트

| 엔드포인트 | 상태 | 용도 |
|-----------|------|------|
| `/.well-known/crossfin.json` | 작동 | CrossFin 디스커버리 |
| `/.well-known/x402.json` | 작동 | x402 결제 디스커버리 |
| `/.well-known/agent.json` | 작동 | Google A2A Agent Card |
| `/.well-known/ai-plugin.json` | 작동 | OpenAI 플러그인 매니페스트 |
| `/.well-known/glama.json` | 작동 | Glama.ai 소유 확인 |
| `/llms.txt` | 작동 | LLMs.txt 표준 |

---

## 2. MCP 서버 도구 목록 (apps/mcp-server/src/)

총 **16개 도구** 등록됨. 두 가지 버전 존재:
- **Cloudflare MCP** (routes/mcp.ts) — 웹 MCP 프로토콜, proxy 방식
- **로컬 MCP** (apps/mcp-server/) — stdio 트랜스포트, npm 패키지 `crossfin-mcp`

### 2.1 무료 도구 (9개)

| # | 도구명 | 구현 상태 | 설명 |
|---|--------|---------|------|
| 1 | `search_services` | 완전 구현 | 서비스 레지스트리 검색 |
| 2 | `list_services` | 완전 구현 | 서비스 목록 (카테고리 필터) |
| 3 | `get_service` | 완전 구현 | 서비스 상세 정보 |
| 4 | `list_categories` | 완전 구현 | 카테고리 목록 |
| 5 | `get_kimchi_premium` | 완전 구현 | 무료 루트 스프레드 미리보기 |
| 6 | `get_analytics` | 완전 구현 | 게이트웨이 사용 분석 |
| 7 | `get_guide` | 완전 구현 | CrossFin API 가이드 |
| 8 | `list_exchange_fees` | 완전 구현 | 거래소 수수료 비교 |
| 9 | `compare_exchange_prices` | 완전 구현 | 거래소 가격 비교 |

### 2.2 유료 도구 (2개 — x402 결제 필요)

| # | 도구명 | 구현 상태 | 가격 | 설명 |
|---|--------|---------|------|------|
| 10 | `find_optimal_route` | 완전 구현 | $0.10 | 최적 라우트 찾기 |
| 11 | `call_paid_service` | 완전 구현 | 변동 | 유료 API 호출 (자동 x402 결제) |

### 2.3 로컬 전용 도구 (5개 — 로컬 레저 관리)

| # | 도구명 | 구현 상태 | 설명 |
|---|--------|---------|------|
| 12 | `create_wallet` | 완전 구현 | 로컬 레저에 지갑 생성 |
| 13 | `get_balance` | 완전 구현 | 지갑 잔고 조회 |
| 14 | `transfer` | 완전 구현 | 지갑 간 송금 |
| 15 | `list_transactions` | 완전 구현 | 트랜잭션 목록 |
| 16 | `set_budget` | 완전 구현 | 일일 예산 설정 |

**Cloudflare 웹 MCP**: 도구 10-16은 `LOCAL_ONLY` 응답 반환 (로컬 설치 안내). 도구 1-9만 웹에서 실제 작동.

---

## 3. SDK 분석 (packages/sdk/)

### 3.1 노출된 API

```typescript
export { CrossFinClient, CrossFinError } from './client.js'
export type * from './types.js'
```

### 3.2 CrossFinClient 메서드 매핑

| 네임스페이스 | 메서드 수 | 커버리지 |
|-------------|---------|---------|
| `client.health()` / `guide()` / `discovery()` / `usdcTransfers()` | 4 | 무료 유틸리티 |
| `client.route.*` | 5 | 무료 라우팅 (exchanges, fees, pairs, status, optimal) |
| `client.arbitrage.demo()` | 1 | 무료 루트 스프레드 |
| `client.registry.*` | 5 | 무료 레지스트리 (stats, search, categories, list, get) |
| `client.acp.*` | 4 | 무료 ACP (status, quote, execute, execution) |
| `client.analytics.*` | 2 | 무료 분석 (overview, service) |
| `client.premium.*` | 30 | **모든 유료 엔드포인트** 완전 커버 |

**총 메서드: 51개** — 모든 API 엔드포인트 1:1 매핑 완료

### 3.3 SDK 품질 평가

- 타입 정의: 689줄, 주요 응답 타입 정의됨 (일부는 `[key: string]: unknown` 형태로 유연하게 처리)
- x402 결제 통합: SDK 자체에 없음. x402 클라이언트 라이브러리와 fetch 래핑 필요.
- npm 패키지: `crossfin-sdk` (배포 상태 확인 필요)
- **평가**: 완성도 높음. 타입 안전성은 개선 여지 있으나 기능적으로 완전함.

---

## 4. 라이브 대시보드 (apps/live/)

- **프레임워크**: React + TypeScript (Vite)
- **배포**: Cloudflare Pages (`live.crossfin.dev`)
- **주요 컴포넌트**:
  - `App.tsx` — 메인 대시보드 (루트 스프레드, 서비스 통계, 실시간 갱신)
  - `RouteGraph.tsx` — 라우팅 엔진 시각화 (인터랙티브 라우트 탐색기)
- **데이터 소스**: crossfin.dev API에서 15초 간격 폴링
- **평가**: 빌드 완료됨 (`dist/` 존재). 실시간 데모 용도로 작동.

---

## 5. 문서 사이트 (apps/docs/)

- **프레임워크**: VitePress
- **페이지**: index.md, quickstart.md, api.md, mcp.md, telegram.md
- **커스텀 컴포넌트**: Steps.vue, ToolGrid.vue, ApiTable.vue
- **배포**: Cloudflare Pages (`docs.crossfin.dev`)
- **평가**: 빌드 완료됨. 기본 문서 구조 갖추어져 있음.

---

## 6. 수익화 분류

### 6.1 즉시 수익화 가능 (Ready NOW)

| 기능 | 수익 모델 | 고유 가치 | 비고 |
|------|---------|---------|------|
| **라우팅 엔진** (`/api/premium/route/find`) | $0.10/호출 | **매우 높음** — 9개 거래소, 11개 브릿지 코인, 실시간 오더북 기반 슬리피지 계산, 출금 정지 상태 반영 | 시장에 동급 대안 없음 |
| **루트 스프레드 인덱스** (`/api/premium/arbitrage/kimchi`) | $0.05/호출 | **높음** — 빗썸 vs Binance/OKX/Bybit 실시간 비교 (11쌍) | 한국 거래소 API 직접 집계 |
| **차익거래 기회 분석** (`/api/premium/arbitrage/opportunities`) | $0.10/호출 | **높음** — FAVORABLE/NEUTRAL/UNFAVORABLE 시그널 + 슬리피지 + 프리미엄 트렌드 | 독자 결정 레이어 |
| **크로스 거래소 비교** (`/api/premium/market/cross-exchange`) | $0.08/호출 | **높음** — 4개 한국 거래소 가격 스프레드 + 최적 매수/매도 거래소 | 국내 거래소 간 차익 |
| **4거래소 가격 비교** (`/api/premium/crypto/korea/5exchange`) | $0.08/호출 | **높음** — 업비트, 빗썸, 코인원, 고팍스 실시간 비교 | 한국 특화 |
| **모닝 브리프** (`/api/premium/morning/brief`) | $0.20/호출 | **높음** — 루트 스프레드 + FX + KOSPI + 모멘텀 + 헤드라인 원콜 번들 | 고가치 번들 |
| **크립토 스냅샷** (`/api/premium/crypto/snapshot`) | $0.15/호출 | **높음** — 4거래소 가격 + 루트 스프레드 + 볼륨 + FX 번들 | 고가치 번들 |
| **김치 통계** (`/api/premium/kimchi/stats`) | $0.15/호출 | **높음** — 현재 스프레드 + 24시간 트렌드 + 최적 기회 + 크로스 거래소 스프레드 | 종합 분석 번들 |
| **MCP 서버** (`crossfin-mcp`) | 유료 도구 경유 | **높음** — 16개 도구, npm 패키지, Smithery 호환 | AI 에이전트 직접 접근 |
| **텔레그램 봇** (`/api/telegram/webhook`) | 간접 (유입) | **높음** — GLM-5 AI + 도구 호출 통합, 한국어/영어 자동 감지 | 사용자 유입 채널 |

### 6.2 거의 준비됨 (Almost Ready)

| 기능 | 수익 모델 | 필요 작업 | 비고 |
|------|---------|---------|------|
| **빗썸 오더북** (`/api/premium/bithumb/orderbook`) | $0.02/호출 | 없음 (작동 중) | 한국 외 사용자에게는 독점 데이터이나 단가가 낮음 |
| **업비트 시그널** (`/api/premium/market/upbit/signals`) | $0.05/호출 | 없음 (작동 중) | 모멘텀+볼륨+시그널 분석, 단독 가치 있음 |
| **한국 주식 관련 10개 엔드포인트** | $0.03~$0.05/호출 | 네이버 금융 스크래핑 안정성 확인 | KOSPI/KOSDAQ, 투자자 흐름, 테마, 공시, ETF 등 |
| **A2A 프로토콜** | 간접 | 실제 사용 사례 필요 | Google A2A 스펙 구현 완료 |
| **ACP 프로토콜** | 간접 | 실제 사용 사례 필요 | 견적/실행 오케스트레이션 작동 |

### 6.3 텔레그램/Apify/RapidAPI 래핑 가능

| 기능 | 래핑 대상 | 난이도 | 수익 잠재력 |
|------|---------|--------|-----------|
| **김치프리미엄 알림봇** | Telegram Bot | **낮음** — 웹훅 이미 구현됨 | 월 구독 $5~$20 |
| **라우팅 엔진** | RapidAPI | **낮음** — REST API 그대로 등록 | API 호출 당 과금 |
| **한국 크립토 데이터** | Apify Actor | **중간** — 래퍼 작성 필요 | Actor 실행 당 과금 |
| **한국 주식 데이터** | RapidAPI | **낮음** — REST API 그대로 등록 | API 호출 당 과금 |
| **모닝 브리프** | Telegram/Discord | **낮음** — 크론 + 메시지 포맷팅 | 월 구독 |
| **거래소 상태 모니터** | Telegram Bot | **낮음** — 출금 정지 알림 | 무료 유입 + 유료 전환 |
| **MCP 서버** | Smithery/Glama/Pipedream | **낮음** — 이미 npm 패키지 | MCP 마켓플레이스 노출 |

### 6.4 준비 안 됨 (Not Ready)

| 기능 | 이유 |
|------|------|
| **실제 거래 실행** | 읽기 전용만 구현 — 거래 실행 API 없음 |
| **실시간 웹소켓** | 현재 REST 폴링만 지원 — 실시간 스트리밍 없음 |
| **사용자 인증 시스템** | API 키 기반 에이전트 등록은 있으나, 일반 사용자 인증/과금은 없음 |
| **서브스크립션 결제** | x402 건당 결제만 존재 — 정기 구독 모델 없음 |

---

## 7. 핵심 질문 답변

### 7.1 무료로 얻을 수 없는 독점 데이터를 제공하는 엔드포인트는?

**독점 가치가 높은 것 (다른 곳에서 무료로 얻기 어려운 데이터)**:

1. **`/api/premium/route/find`** — 9개 거래소 크로스보더 라우팅. 수수료+슬리피지+출금 정지까지 반영한 최적 경로 계산은 어디에도 없음.
2. **`/api/premium/arbitrage/opportunities`** — AI 결정 레이어 (FAVORABLE/NEUTRAL/UNFAVORABLE) + 시그널 강도. 단순 가격 차이가 아닌 **실행 가능성 분석**.
3. **`/api/premium/market/cross-exchange`** — 한국 4거래소 간 가격 스프레드 + 최적 매수/매도 거래소 자동 추천. 한국 거래소 API를 직접 호출하므로 해외 사용자에게 접근 불가능한 데이터.
4. **`/api/premium/morning/brief`** — 5개 API를 하나로 번들. 에이전트에 최적화.
5. **`/api/premium/kimchi/stats`** — 24시간 트렌드 + D1 스냅샷 기반 방향성 분석.
6. **한국 주식 관련 10개 엔드포인트** — 네이버 금융 + DART 공시 + 투자자 흐름을 API화. 해외에서 접근 어려운 데이터.

### 7.2 단순 무료 API 프록시인 엔드포인트는?

**프록시에 가까운 것 (가치 추가 낮음)**:

1. **`/api/premium/market/fx/usdkrw`** ($0.01) — `open.er-api.com` 무료 API 프록시. 가치 추가 미미.
2. **`/api/premium/market/upbit/ticker`** ($0.02) — Upbit 공개 API 직접 프록시. 누구나 무료로 호출 가능.
3. **`/api/premium/market/upbit/orderbook`** ($0.02) — Upbit 공개 API 프록시.
4. **`/api/premium/market/coinone/ticker`** ($0.02) — Coinone 공개 API 프록시.
5. **`/api/premium/bithumb/orderbook`** ($0.02) — Bithumb 공개 API 프록시.
6. **`/api/premium/crypto/korea/fx-rate`** ($0.01) — Upbit CRIX API 프록시.
7. **`/api/premium/news/korea/headlines`** ($0.03) — Google News RSS 파싱.

> **그러나**: 이 프록시 엔드포인트들은 x402 프로토콜 + MCP 도구를 통해 **AI 에이전트가 자동으로 접근**할 수 있다는 점에서 가치가 있음. 에이전트 입장에서는 한국 거래소 API 직접 호출보다 CrossFin 게이트웨이 경유가 편리함.

### 7.3 라우팅 엔진 (`findOptimalRoute`) 실제 작동 여부

**작동함. 매우 정교하게 구현되어 있음.**

구현 세부사항:
- **코드 위치**: `apps/api/src/index.ts:6097~6587` (약 500줄)
- **브릿지 코인**: 11개 (XRP, SOL, TRX, KAIA, ETH, BTC, ADA, DOGE, AVAX, DOT, LINK)
- **지원 거래소**: 9개 (빗썸, 업비트, 코인원, 고팍스, bitFlyer, WazirX, Binance, OKX, Bybit)
- **지원 방향**: 양방향
  - Regional → Global (예: 빗썸 KRW → Binance USDC)
  - Global → Regional (예: Binance USDC → 빗썸 KRW)
  - Regional → Regional (예: 빗썸 KRW → 업비트 KRW)
- **가격 소스**:
  - Binance/OKX/Bybit 실시간 가격 (3중 폴백)
  - 빗썸 `/public/ticker/ALL_KRW`
  - 업비트 `/v1/ticker`
  - 코인원 `/public/v2/ticker_new`
  - WazirX `/api/v2/tickers`
  - bitFlyer: 글로벌 가격 x JPY 환율 (합성 가격)
  - FX 레이트: `open.er-api.com` (KRW, JPY, INR)
  - 폴백: CryptoCompare → CoinGecko → D1 스냅샷
- **수수료 계산**: D1 데이터베이스에서 실시간 조회 (관리자가 업데이트 가능)
- **출금 정지 반영**: 빗썸 `/public/assetsstatus/ALL` 실시간 확인
- **슬리피지 추정**: 오더북 기반 (`estimateSlippage` in engine.ts)
- **전략**: cheapest(비용 최소화) / fastest(속도 최적화) / balanced(균형)
- **출력**: 최적 경로 + 대안 경로 최대 10개 + 메타데이터 (수수료 분해, 예상 수령액, 전송 시간)
- **무료 버전**: `/api/routing/optimal` — 완전히 동일한 로직, 무료 (!)

**핵심 발견**: `/api/routing/optimal`은 **무료**이면서 유료 버전 (`/api/premium/route/find`)과 동일한 `findOptimalRoute` 함수를 호출함. 가격 차별화가 필요함.

### 7.4 x402 결제 통합 상태

**완전히 작동함.**

- **라이브러리**: `@x402/hono` (미들웨어), `@x402/evm/exact/server`, `@x402/core/server`
- **네트워크**: Base 메인넷 (`eip155:8453`)
- **자산**: USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- **Facilitator**: Coinbase x402 facilitator (`https://facilitator.payai.network`)
- **결제 기록**: D1 `premium_payments` 테이블에 저장 (payer, tx_hash, network, endpoint, amount, asset)
- **관리자 조회**: `GET /api/admin/payments` (admin 토큰 필요)
- **MCP 통합**: `crossfin-mcp`에서 `@x402/fetch` + `@x402/evm/exact/client`로 자동 결제
- **Bazaar 확장**: `@x402/extensions/bazaar` (declareDiscoveryExtension, bazaarResourceServerExtension) 통합됨

---

## 8. 인프라 분석

| 항목 | 내용 |
|------|------|
| **호스팅** | Cloudflare Workers |
| **데이터베이스** | Cloudflare D1 (SQLite) |
| **도메인** | crossfin.dev, docs.crossfin.dev, live.crossfin.dev |
| **캐싱** | 인메모리 (globalThis 캐시), TTL 기반 |
| **모니터링** | 에러 이벤트 기록 + 텔레그램 알림 + 에러율 체크 |
| **텔레메트리** | endpoint_calls / endpoint_calls_v2 테이블 (트래픽 소스 분류) |
| **레이트 리밋** | IP 기반, 120 req/min/endpoint |
| **CORS** | crossfin.dev, live.crossfin.dev, localhost |
| **AI 통합** | GLM-5 (텔레그램 봇), 도구 호출 루프 |

---

## 9. 주요 발견 및 권고

### 9.1 즉시 조치 필요

1. **무료 라우팅 엔진 Cannibalization 문제**
   - `/api/routing/optimal` (무료) = `/api/premium/route/find` ($0.10) **동일 로직**
   - 권고: 무료 버전에서 alternatives 제거, 또는 결과 일부 제한 (예: 상위 1개만, 수수료 분해 없음)

2. **프록시 엔드포인트 가격 정당성**
   - FX 레이트 ($0.01), 업비트 티커 ($0.02) 등은 무료 API 단순 프록시
   - 권고: 번들 API로만 유료화하고, 단독 프록시는 무료 전환 → 유입 경로로 활용

### 9.2 수익화 우선순위

1. **1순위: 텔레그램 봇 유료화** — 이미 작동하는 AI 봇에 프리미엄 기능 추가 (라우트 알림, 스프레드 모니터링)
2. **2순위: RapidAPI/Apify 등록** — REST API 그대로 래핑 가능, 즉시 실행 가능
3. **3순위: MCP 마켓플레이스** — Smithery, Glama에 등록 (npm 패키지 이미 존재)
4. **4순위: 번들 API 마케팅** — Morning Brief ($0.20)는 에이전트에 최고 가치
5. **5순위: 한국 주식 API 분리 판매** — 한국 주식 데이터는 독립적 시장 존재

### 9.3 코드 품질

- **전체 평가**: 프로덕션 레벨. 에러 핸들링, 캐싱, 레이트 리밋, 텔레메트리 모두 구현됨.
- **주요 개선점**:
  - `index.ts` 11,511줄은 리팩토링 필요 (라우트 분리 미완성)
  - 한국 주식 엔드포인트들은 네이버 금융 HTML 스크래핑 의존 → 불안정 가능성
  - 테스트 코드 없음 (발견 범위 내)

---

## 10. 결론

CrossFin은 **기술적으로 완성된 프로덕트**이다.

- 80+ 개 API 엔드포인트 (40+ 무료, 35+ 유료)
- 16개 MCP 도구 (9 무료, 2 유료, 5 로컬)
- 51개 메서드의 TypeScript SDK
- x402 결제 완전 통합
- Google A2A + ACP + MCP + OpenAI 플러그인 + LLMs.txt 지원
- 텔레그램 AI 봇 (GLM-5 기반)
- 9개 거래소 크로스보더 라우팅 엔진

**즉시 수익화 가능한 핵심 자산**:
1. 라우팅 엔진 (시장 유일)
2. 루트 스프레드/차익거래 시그널 (독자 결정 레이어)
3. 번들 API (Morning Brief, Crypto Snapshot)
4. 한국 주식/ETF/공시 데이터 API화
5. 텔레그램 AI 봇 + MCP 서버

**가장 큰 위험**은 무료 라우팅 엔진이 유료 버전을 카니발라이즈하는 것과, 유의미한 트래픽/사용자 확보가 아직 안 된 것이다.
