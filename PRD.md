# CrossFin PRD — x402 Agent Gateway

> 최종 업데이트: 2026-02-15
> 상태: MVP 배포 완료 (v1.3.3)

---

## 0. 현재 제품 상태 (v1.3.3)

Live:
- Dashboard: https://crossfin.dev
- Live demo: https://live.crossfin.dev
- Registry stats: https://crossfin.dev/api/registry/stats
- Agent guide (JSON): https://crossfin.dev/api/docs/guide
- OpenAPI: https://crossfin.dev/api/openapi.json
- Discovery: https://crossfin.dev/.well-known/crossfin.json

현황 (프로덕션):
- Registry: 162 services (CrossFin 13 + External 149) — verified-only (dead providers disabled)
- Korea APIs: 13 paid endpoints (x402, USDC on Base mainnet)
- Proxy: `/api/proxy/:serviceId` GET/POST (forward + service_calls 로깅 + `X-CrossFin-Fee: 5%` 헤더). 결제 위임/정산은 Phase 2.
- Analytics: `/api/analytics/overview` (calls/top services/recent calls)
- Agent onboarding: `/api/docs/guide` + `/.well-known/crossfin.json`
- MCP Server: 12 tools (registry/guide/analytics + local wallet/budget)

남은 것 / 확인 필요한 것:
- Hashed 제출 자료: 데모 영상 + 이메일 + 핵심 메트릭 정리
- VISION.md x402 수치 업데이트 (3,500만 → 7,541만) (완료)
- `POST /api/pay` (결제 위임 엔드포인트) — 설계/보안/정산 포함 미구현
- 외부 서비스 주기적 헬스체크 + 자동 disable (cron)
- 프론트: 다크 모드, 문서 페이지(OpenAPI UI) 여부 결정

---

## 1. 한 줄 요약

**CrossFin = AI 에이전트를 위한 서비스 게이트웨이. 한국 시장을 첫 거점으로, x402 생태계의 서비스 발견 · 등록 · 결제를 하나로 묶는다.**

---

## 2. 문제

### 현재 상황 (2026.02)
- x402 생태계에 **618개+** 라이브 서비스가 있다
- **7,541만 건** 트랜잭션, **$2,424만** 거래량 처리됨
- AI 에이전트가 실제로 API를 호출하고 USDC로 결제하고 있다

### 문제점
1. **발견이 안 된다** — 서비스가 흩어져 있고, 에이전트가 기계적으로 쓸 수 있는 표준 디스커버리/가이드가 부족함
2. **등록이 어렵다** — 서비스 제공자가 되려면 x402 프로토콜을 직접 구현해야 함
3. **한국 서비스가 거의 없다** — 한국 거래소/원화 기반 데이터는 수요가 크지만 공급이 부족함
4. **분석이 없다** — 어떤 서비스가 얼마나 쓰이는지, 어떤 호출이 실패하는지 관측이 어려움

---

## 3. 솔루션

### CrossFin Gateway = 3개 레이어

```
┌────────────────────────────────────────────┐
│  Layer 3: Dashboard                        │
│  서비스 탐색, 온보딩, 호출/분석 가시화     │
├────────────────────────────────────────────┤
│  Layer 2: Registry                         │
│  서비스 등록/발견/검색 API + 가이드/스키마 │
├────────────────────────────────────────────┤
│  Layer 1: Services                         │
│  CrossFin 자체 한국 데이터 API (유료/x402) │
│  외부 서비스 프록시 (forward + 로깅)       │
└────────────────────────────────────────────┘
```

### 왜 RapidAPI가 아닌가
- RapidAPI는 **사람 개발자**가 수동으로 API를 찾고 연동
- CrossFin은 **AI 에이전트**가 자동으로 서비스 발견/결제
- x402 = HTTP 네이티브 결제 → 계정/API키 없이 결제 가능

### 왜 BlockRun이 아닌가
- BlockRun은 **LLM 라우팅**에 더 집중
- CrossFin은 **비-LLM 서비스** 게이트웨이 (데이터, 분석, 도구, 한국 시장)
- 한국 시장 특화 — 한국 거래소 데이터, KRW 환율

---

## 4. 타겟 유저

### Primary: AI 에이전트 (프로그래매틱 클라이언트)
- 크립토 트레이딩 봇
- 리서치 에이전트 (데이터 수집/분석)
- 자동화 워크플로우 (n8n, LangChain, CrewAI)

### Secondary: 서비스 제공자 (공급 측)
- 데이터 API 운영자
- MCP 서버 개발자
- 한국/아시아 시장 데이터 보유자

---

## 5. 기존 자산 (이미 구축된 것)

| 자산 | 상태 | 상세 |
|------|------|------|
| crossfin.dev 도메인 | ✅ 라이브 | Cloudflare Workers + Pages |
| x402 결제 | ✅ 작동 | Base 메인넷, USDC, Coinbase facilitator |
| 한국 데이터 API 13개 | ✅ 라이브 | 김프/히스토리/차익거래/호가/거래량/센티먼트/환율/뉴스/업비트/코인원/크로스거래소 |
| 무료 데모 1개 | ✅ 라이브 | `/api/arbitrage/demo` |
| Service Registry | ✅ 라이브 | `/api/registry/*` + 162 services (verified only) |
| Proxy (forward + 로깅) | ✅ 라이브 | `/api/proxy/:serviceId` GET/POST |
| Analytics | ✅ 라이브 | `/api/analytics/overview` |
| Agent Guide API | ✅ 라이브 | `/api/docs/guide` (구조화된 JSON) |
| Agent Discovery | ✅ 라이브 | `/.well-known/crossfin.json` |
| MCP Server | ✅ 라이브 | `apps/mcp-server` (12 tools) |
| OpenAPI 스펙 | ✅ 라이브 | `/api/openapi.json` |
| D1 DB | ✅ 배포 | agents, wallets, transactions, budgets, services, service_calls, kimchi_* |
| Agent 등록/인증 | ✅ 배포 | `POST /api/agents` (admin token required), `X-Agent-Key` |
| 예산 관리 | ✅ 배포 | daily/monthly limit, circuit breaker |
| x402 생태계 PR | 🔄 리뷰중 | https://github.com/coinbase/x402/pull/1187 |
| BlockRun 등록 | 🔄 오픈 | https://github.com/BlockRunAI/awesome-blockrun/issues/5 |

---

## 6. 제품 스코프 (MVP = 현재 배포본)

### 6.1 Service Registry API (Free)

목적: x402 서비스를 등록하고 검색하는 API. 에이전트가 "어떤 서비스가 있지?" 물으면 답하는 계층.

엔드포인트:

```
GET  /api/registry                    — 전체 서비스 목록 (무료)
GET  /api/registry/search?q=crypto    — 서비스 검색 (무료)
GET  /api/registry/:id                — 서비스 상세 (무료)
GET  /api/registry/categories         — 카테고리 목록
GET  /api/registry/stats              — 총 서비스 수 (CrossFin vs External)
POST /api/registry                    — 서비스 등록 (인증 필요)
```

초기 데이터(시드):
- CrossFin 자체 서비스: 13개
- 외부 x402 서비스: 149개 (Einstein AI `.well-known/x402.json` + 기타 providers)
- 원칙: 동작 검증된 것만 `active`, 죽은 서비스는 `disabled`

### 6.2 Gateway Proxy (현재 = forward + 로깅)

현재 구현:
- `/api/proxy/:serviceId` GET/POST
- 업스트림 요청을 그대로 forward
- `service_calls` 로그 적재 (analytics용)
- 응답 헤더에 `X-CrossFin-Proxy: true`, `X-CrossFin-Fee: 5%` 표기

아직 안 된 것(Phase 2):
- CrossFin이 결제를 위임받아 정산하는 구조 (`POST /api/pay` 또는 proxy 결제 라우팅)
- 수수료(5%)를 온체인 정산/분배까지 완결

### 6.3 Dashboard (Web UI)

crossfin.dev는 "서비스 대시보드"로 동작한다.

- 3 Tabs: Services / Developers / Activity
- Services: 검색 + 카테고리 필터 + CrossFin-only 토글 + 서비스 상세 패널
- Developers: Get Started(지갑/USDC/첫 호출) + API Playground + Register via API
- Activity: 호출 통계(총 호출/성공률/응답시간) + 최근 호출 + Top services
- Live Demo는 별도 앱으로 분리: https://live.crossfin.dev

### 6.4 한국 데이터 서비스 (Paid via x402)

13개 CrossFin 자체 유료 서비스 (USDC on Base, x402):
- Kimchi premium index + history
- Arbitrage opportunities
- Bithumb: orderbook, volume analysis
- Korea market sentiment
- USD/KRW
- Upbit: ticker, orderbook, trading signals
- Coinone: ticker
- Cross-exchange comparison
- Korea headlines

### 6.5 Agent Docs & Discovery (Free)

- `GET /api/docs/guide`: 에이전트용 구조화 가이드(JSON)
- `GET /.well-known/crossfin.json`: 에이전트 자동 디스커버리 메타데이터

### 6.6 MCP Server

`apps/mcp-server`:
- Registry/guide/analytics 도구 + 로컬 ledger 기반 wallet/budget 도구
- Claude Desktop 등 MCP 클라이언트에서 CrossFin을 바로 사용 가능

---

## 7. 기술 아키텍처

### 현재 스택
- Runtime: Cloudflare Workers (Hono)
- DB: Cloudflare D1 (SQLite)
- Payments: x402 (@x402/hono, @x402/extensions/bazaar)
- Frontend: Cloudflare Pages (React + Vite)
- Network: Base mainnet (eip155:8453), USDC

### 핵심 테이블
- `agents`, `wallets`, `transactions`, `budgets`
- `services`, `service_calls`
- `kimchi_snapshots` (히스토리)

### 버전 관리
- API health/openapi/guide/well-known에 버전 노출
- 릴리즈마다 `CHANGELOG.md` 업데이트

---

## 8. 다음 액션 (Backlog)

### Product
- [ ] Hashed 제출 자료: 데모 영상(<= 60s) + 이메일 + 스크린샷
- [ ] Dark mode (대시보드)
- [ ] OpenAPI 기반 문서 페이지(필요하면)

### Payments
- [ ] `POST /api/pay` 설계: 위임 결제/정산/수수료/보안
- [ ] 프록시 결제 라우팅(에이전트는 CrossFin에만 결제, CrossFin이 분배)

### Registry Hygiene
- [ ] 외부 서비스 헬스체크 cron + 자동 disable
- [ ] `/api/registry/sync` 보안 (관리자 토큰)

---

## 9. 수익 모델

### Phase 1 (지금)
- CrossFin 자체 서비스 매출: x402 결제당 $0.01~$0.10
- 무료 레지스트리/가이드: 트래픽 확보

### Phase 2
- 프록시 수수료: CrossFin을 통한 호출시 5%
- 서비스 제공자용 분석 대시보드

### Phase 3
- 에이전트 지출/예산 관리 고도화
- 멀티 레일 결제 라우팅 (Stripe/x402/아시아 페이먼츠)

---

## 10. 성공 지표

### 현재 (v1.3.3)
- 라이브 URL: crossfin.dev
- 등록 서비스: 162
- CrossFin 자체 서비스: 13
- Analytics + proxy forward + agent guide + MCP server: shipped

### Hashed 데모데이 목표 (4월 말)
- 등록 서비스: 500+
- 월간 호출: 100,000+
- MRR: $5,000+
- 등록 에이전트: 200+

---

## 11. 경쟁 분석

| | CrossFin | BlockRun.ai | x402engine.app | RapidAPI |
|--|----------|-------------|----------------|---------|
| 포커스 | 범용 서비스 게이트웨이 | LLM 라우팅 | 멀티 API 제공 | 범용 API 마켓 |
| 한국 데이터 | ✅ | ❌ | ❌ | ❌ |
| 결제 방식 | x402 (USDC) | x402 (USDC) | x402 (USDC) | 카드/구독 |
| 서비스 등록 | 개방 | 카탈로그 중심 | 제한적 | 개발자 중심 |
| 에이전트 온보딩 | ✅ (guide + well-known + MCP) | △ | △ | ❌ |

---

## 12. 리스크 & 대응

| 리스크 | 확률 | 대응 |
|--------|------|------|
| 외부 서비스 죽음/변경 | 높음 | 주기적 헬스체크 + verified-only + 자동 disable |
| 결제 위임 설계 복잡도 | 중 | Phase 2로 분리, 먼저 forward + 로깅부터 완성 |
| Hashed 제출 일정 | 중 | 60초 데모(검색→호출→402→응답) 시나리오 고정 |

---

## 13. 장기 비전 (VISION.md 연결)

이 MVP는 VISION.md에 정의된 "에이전트의 은행"으로 가는 첫 단계.

```
지금 (MVP)        → x402 서비스 게이트웨이 (발견 + 등록 + 자체 서비스)
3개월 후 (Phase 2) → 결제 위임/정산 + 수수료 (돈이 흐르는 파이프라인)
6개월 후 (Phase 3) → 에이전트 지갑/예산/지출 관리 고도화
```

---

## 부록: 예산

| 항목 | 비용 |
|------|------|
| Cloudflare Workers | 무료 (100K req/일) |
| Cloudflare Pages | 무료 |
| Cloudflare D1 | 무료 (5M rows) |
| crossfin.dev 도메인 | 이미 보유 |
| USDC (결제 테스트) | ~$5~10 |
| **총 추가 비용** | **~$5~10** |
