# CrossFin 갭 분석: 로드맵 vs 실제 구현 상태

> **작성일**: 2026-02-21
> **기준 문서**: `research/20-comprehensive-roadmap.md` (종합 수익화 로드맵)
> **분석 방법**: 소스 코드 직접 확인 (추측 없음)

---

## 완료된 것 (로드맵에서 빼야 할 것)

### 1. 라우팅 엔진 — 완전 작동

**증거**: `apps/api/src/index.ts` 라인 6097~6500+ `findOptimalRoute()` 함수

- 9개 거래소 지원: Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, Binance, OKX, Bybit
- 11개 브릿지 코인으로 경로 탐색
- 3가지 전략: cheapest, fastest, balanced
- 실시간 오더북 기반 슬리피지 추정 (`estimateSlippage()` in `lib/engine.ts`)
- 거래 수수료 + 출금 수수료 + 전송 시간 모두 고려
- 출금 정지 상태도 체크 (`getWithdrawalSuspensions`)
- bidirectional: 한국 -> 글로벌, 글로벌 -> 한국, 지역 -> 지역 모두 지원
- FAVORABLE/NEUTRAL/UNFAVORABLE 시그널 (`computeRouteAction()` in `lib/engine.ts`)

### 2. x402 결제 미들웨어 — 완전 작동

**증거**: `apps/api/src/index.ts` 라인 4 (`import { paymentMiddleware, x402ResourceServer } from '@x402/hono'`), 라인 2502~2700+

- `@x402/hono` 패키지 사용, Hono 미들웨어로 통합
- 35개 유료 엔드포인트 모두 x402 paywall 적용
- 가격 설정: $0.001 ~ $20.00 (엔드포인트별 차등)
- USDC on Base mainnet 결제
- Coinbase x402 facilitator 연동
- Bazaar discovery extension 포함
- 결제 기록 D1에 저장 (`ensurePremiumPaymentsTable`)

### 3. MCP 서버 — 16개 도구 완전 구현

**증거**: `apps/mcp-server/src/index.ts` 라인 102~633 (16개 `server.registerTool` 호출)

| # | 도구 이름 | 유형 | 상태 |
|---|-----------|------|------|
| 1 | `create_wallet` | 로컬 월렛 | 구현 완료 |
| 2 | `get_balance` | 로컬 월렛 | 구현 완료 |
| 3 | `transfer` | 로컬 월렛 | 구현 완료 |
| 4 | `list_transactions` | 로컬 월렛 | 구현 완료 |
| 5 | `set_budget` | 로컬 월렛 | 구현 완료 |
| 6 | `search_services` | 무료 | 구현 완료 |
| 7 | `list_services` | 무료 | 구현 완료 |
| 8 | `get_service` | 무료 | 구현 완료 |
| 9 | `list_categories` | 무료 | 구현 완료 |
| 10 | `get_kimchi_premium` | 무료 | 구현 완료 |
| 11 | `get_analytics` | 무료 | 구현 완료 |
| 12 | `get_guide` | 무료 | 구현 완료 |
| 13 | `call_paid_service` | 유료 (x402) | 구현 완료 |
| 14 | `find_optimal_route` | 유료 (x402) | 구현 완료 |
| 15 | `list_exchange_fees` | 무료 | 구현 완료 |
| 16 | `compare_exchange_prices` | 무료 | 구현 완료 |

- API 서버 내 MCP 라우트(`/mcp`)에도 동일 16개 도구가 SSE/Streamable HTTP 모드로 등록됨 (`apps/api/src/routes/mcp.ts`)

### 4. NPM 패키지 배포 — 완료

**증거**: `npm view crossfin-mcp version` -> `1.9.0`, `npm view @crossfin/sdk version` -> `1.9.0`

- `crossfin-mcp@1.9.0` (MCP 서버): npm 배포 완료
- `@crossfin/sdk@1.9.0` (TypeScript SDK): npm 배포 완료
- SDK: 51개 메서드, TypeScript 타입 포함

### 5. 텔레그램 봇 — 기본 기능 작동

**증거**: `apps/api/src/index.ts` 라인 10833~11220 (`/api/telegram/webhook`)

작동하는 명령어:
- `/help`, `/start` — 가이드 표시
- `/route bithumb:KRW binance:USDC 5000000` — 최적 경로 탐색
- `/price BTC` — 실시간 가격 (빗썸 KRW + 바이낸스 USD)
- `/status` — 거래소 온라인/오프라인 상태
- `/kimchi BTC`, `/spread BTC` — 김프(Route Spread) 데모 조회
- `/fees XRP` — 거래소 수수료 비교
- **자연어 AI 모드** — GLM-5 기반, 한국어/영어 자동 감지, tool calling으로 라우팅/가격/수수료 조회 (`glmChatCompletion()`, 5개 AI tool)
- 채팅 히스토리 D1 저장 (`telegram_messages` 테이블)
- rate limit: 40/시간/채팅, 3000/일 글로벌

### 6. 김프(Route Spread) 데이터 — 완전 작동

**증거**: `kimchi_snapshots` 테이블, 매분 cron (`scheduled()` 핸들러, 라인 11357+)

- 매분 cron으로 빗썸 vs 바이낸스 프리미엄 스냅샷 D1에 저장
- 히스토리 조회: `/api/premium/arbitrage/kimchi/history` (7일 lookback)
- 통계: `/api/premium/kimchi/stats` (24h 트렌드, 변동성, 최적 기회)
- 자동 아비트라지 스캔 (Guardian 모드 활성화 시)

### 7. Glama.ai 인증 엔드포인트 — 완료

**증거**: `apps/api/src/index.ts` 라인 1397 (`/.well-known/glama.json` 라우트), `glama.json` 루트 파일

- `/.well-known/glama.json` 엔드포인트 작동
- 루트에 `glama.json` 정적 파일도 존재
- maintainer, repository 정보 포함

### 8. Smithery 설정 파일 — 완료

**증거**: `/Users/cozac/Code/crossfin/smithery.yaml`

- `smithery.yaml` 존재
- stdio 타입, `npx crossfin-mcp@1.9.0` 실행 커맨드
- `evmPrivateKey`, `apiUrl`, `ledgerPath` 설정 스키마

### 9. 기타 완료 항목

- **A2A (Agent-to-Agent) 프로토콜**: `apps/api/src/routes/a2a.ts` — JSON-RPC 기반 A2A 핸들러
- **OpenAPI 스펙**: `/api/openapi.json` 완전한 스펙 자동 생성
- **OpenAI Plugin Manifest**: `/.well-known/ai-plugin.json`
- **Agent Card**: `/.well-known/agent.json`
- **x402 Discovery**: `/.well-known/x402.json`
- **서비스 레지스트리**: 184개 서비스 등록 (검색, 카테고리 필터링)
- **업타임 모니터링**: 매분 cron + 상태 변화 시 텔레그램 알림 (관리자)
- **bitFlyer(일본) 기본 통합**: 라우팅 엔진에 bitFlyer 포함, JPY FX 합성 가격 fallback

---

## 부분 완료 (마무리만 하면 되는 것)

### 1. 텔레그램 김프 알람봇 — 핵심 기능 미구현

**현재 상태**: 텔레그램 봇 자체는 작동하지만, **김프 알람 기능이 없음**

**코드에 있는 것**:
- `/kimchi BTC` 명령: 현재 김프 수동 조회만 가능 (demo 데이터)
- 관리자 알림: 업타임 상태 변화 시 텔레그램 알림 (`TELEGRAM_ADMIN_CHAT_ID`)

**코드에 없는 것**:
- 김프 임계값 설정 기능 (3%, 5%, 10% 등) -- **코드 없음**
- 사용자별 알람 구독 -- **코드 없음**
- 자동 김프 알람 발송 (cron에서 사용자에게) -- **코드 없음**
- 유료 구독 결제 연동 (Toss Payments, x402) -- **코드 없음**
- 텔레그램 채널 운영 (무료 알람용) -- **미확인**

**남은 작업**:
1. `kimchi_alarm_subscriptions` 테이블 생성 (chat_id, threshold_pct, tier)
2. `/alarm 5` 명령어 추가 (5% 임계값 설정)
3. cron 핸들러에서 임계값 초과 시 자동 텔레그램 메시지 발송
4. 유료 티어 구분 (무료: BTC만 10분 지연 / 유료: 전코인 실시간)
5. 결제 연동 (Toss Payments or Stripe)

### 2. MCP 마켓플레이스 등록 — 설정만 완료, 실제 등록 미확인

**현재 상태**: 설정 파일은 존재하지만, 실제 마켓플레이스 등록 여부는 코드만으로 확인 불가

**완료된 것**:
- `smithery.yaml` 설정 파일 (**존재**)
- `glama.json` + `/.well-known/glama.json` 엔드포인트 (**존재**)

**미완료 확실한 것**:
- Official MCP Registry PR -- 코드에 관련 흔적 없음
- Cursor Directory 등록 -- 코드에 관련 흔적 없음
- LobeHub 플러그인 등록 -- 코드에 관련 흔적 없음

**남은 작업**:
1. Smithery.ai에 실제 제출 (smithery.yaml 기반)
2. Glama.ai에 실제 제출 (이미 verification 엔드포인트 있으므로 제출만)
3. [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) 에 PR 제출
4. Cursor Directory에 등록
5. LobeHub에 플러그인 등록

### 3. 무료 API 카니발라이제이션 — 문제 확인됨, 수정 안 됨

**현재 상태**: 무료 `/api/routing/optimal`이 유료 `/api/premium/route/find`와 **거의 동일한 데이터를 반환**

**코드 비교** (`apps/api/src/index.ts`):

| 항목 | 무료 `/api/routing/optimal` (라인 9915) | 유료 `/api/premium/route/find` (라인 9971) |
|------|---------------------------------------|------------------------------------------|
| 호출 함수 | `findOptimalRoute()` (동일) | `findOptimalRoute()` (동일) |
| 반환 데이터 | `optimal`, `alternatives`, `meta`, `fees` | `optimal`, `alternatives`, `meta` |
| 추가 데이터 | trading fees + withdrawal fees 포함 | `summary` 필드 추가 |
| 가격 | 무료 | $0.10 (x402) |

**핵심 문제**: 무료 버전이 오히려 `fees` 데이터를 **더 많이** 반환함. 유료 버전은 `paid: true`와 `summary`만 추가. 무료가 유료를 완전히 잠식하는 상태.

**남은 작업**:
1. 무료 응답에서 `alternatives` 제거 (최적 1개만)
2. 무료 응답에서 상세 슬리피지, 수수료 분석 제거
3. 무료 응답에 "상세 분석은 Premium API 참조" CTA 삽입
4. rate limit 강화: 무료 10회/시간 -> 5회/시간
5. 유료에만 제공할 필드: `alternatives`, `meta.pricesUsed`, `meta.skippedReasons`, `fees`

---

## 아직 안 한 것 (진짜 해야 할 것)

### 1. RapidAPI 등록 — 코드 없음

**증거**: 프로젝트 전체에서 `rapidapi` 검색 결과 0건 (연구 문서 외)

**구체적으로 해야 할 것**:
1. RapidAPI Hub 계정 생성
2. "Kimchi Premium API" 등록
3. RapidAPI 프록시 설정 (기존 API에 RapidAPI 헤더 인증 래핑)
4. Free / $9.99 / $49.99 / $199.99 티어 설정
5. API 문서 영문화

### 2. Apify Actor — 코드 없음

**증거**: 프로젝트 전체에서 `apify` 검색 결과 0건 (코드 파일 기준)

**구체적으로 해야 할 것**:
1. Apify Creator Plan 가입 ($1/월)
2. 김치프리미엄 모니터 Actor 개발 (기존 API 래핑)
3. 업비트 실시간 시세 Actor 개발
4. 한국 주식 데이터 Actor 개발
5. 거래소 비교 Actor 개발
6. 라우팅 Actor 개발
7. 각 Actor README 영문 작성

### 3. ClawHub/OpenClaw 스킬 — 코드 없음

**증거**: 프로젝트 전체에서 `clawhub`, `openclaw`, `claw` 검색 결과 0건

**구체적으로 해야 할 것**:
1. OpenClaw 스킬 포맷 학습
2. `crossfin-korea-crypto` 스킬 개발
3. `crossfin-korea-market` 스킬 개발
4. `crossfin-route-finder` 스킬 개발
5. OpenClaw 마켓에 등록

### 4. B2C 구독 결제 연동 — 코드 없음

**증거**: `Toss Payments`, `kakaopay`, `subscription`, `구독` 관련 코드 없음 (x402 per-call만 존재)

**구체적으로 해야 할 것**:
1. Toss Payments (또는 Stripe) 결제 모듈 구현
2. 3티어 구독 상품 (무료/4,900원/14,900원) 설계
3. 구독자 관리 테이블 (`subscriptions`)
4. 결제 webhook 핸들러
5. 구독 상태에 따른 기능 게이팅

### 5. 한국 주식 데이터 API 상품화 — 미구현

**증거**: 기존 API에 KOSPI/KOSDAQ 인덱스 데이터는 일부 있으나 (모닝 브리프에 포함), 별도 상품화된 API는 없음

**구체적으로 해야 할 것**:
1. KRX/한투 API 연동 강화
2. 외국인 순매수 실시간 API
3. 기관 수급 API
4. KOSPI 섹터 분석 API
5. ETF 흐름 API
6. B2B 가격 설정 ($49~$199/월)

### 6. x402 Facilitator 아시아 특화 — 미구현

**증거**: 현재는 Coinbase x402 facilitator를 **사용**하는 클라이언트 역할만. 자체 facilitator 없음.

**구체적으로 해야 할 것**:
1. x402 Facilitator 서버 아키텍처 설계
2. Coinbase CDP 연동
3. KRW/JPY 가격 표시 지원
4. 아시아 저지연 인프라 배포
5. 중개 수수료 0.5~1% 설정

### 7. 일본 시장 진출 — 부분적 (bitFlyer만)

**증거**: bitFlyer는 라우팅 엔진 9개 거래소 중 하나로 포함됨. 단, 합성 가격 fallback 사용 (직접 API가 아닌 글로벌 가격 x JPY FX).

**구체적으로 해야 할 것**:
1. bitFlyer API 직접 연동 (현재는 합성 가격)
2. bitbank 추가
3. Coincheck 추가
4. JPY 스테이블코인 연동
5. 일본어 문서/마케팅

### 8. 파트너십 — 없음

**증거**: Locus, Sponge, Natural 관련 코드/설정 없음 (연구 문서만 존재)

**구체적으로 해야 할 것**:
1. Locus 팀 콜드 이메일 발송
2. Sponge 팀 콜드 이메일 발송
3. 기술 통합 PoC 개발
4. 파트너십 MOU 체결

### 9. 마케팅/커뮤니티 — 없음

**증거**: 코드에 마케팅 자동화, SNS 통합, 커뮤니티 관리 관련 코드 없음

**구체적으로 해야 할 것**:
1. 텔레그램 크립토 채널 홍보
2. X/Twitter 김프 데이터 카드 자동 게시
3. GeekNews, Disquiet 포스팅
4. 네이버 카페 (Bitman 등) 포스팅
5. 유튜버 스폰서십

### 10. Route Spread Index 상품화 — 부분적

**증거**: 김프 데이터는 있으나, "Route Spread Index"라는 별도 상품은 없음

**구체적으로 해야 할 것**:
1. 9개 거래소 간 실시간 스프레드 인덱스 (현재는 빗썸 vs 바이낸스만)
2. 인덱스 시각화/차트 API
3. 번들 API (단일 호출로 김프 + 라우팅 + 시장 데이터)
4. B2B 가격 설정

---

## 요약 매트릭스

| 로드맵 항목 | 상태 | 근거 |
|------------|------|------|
| 라우팅 엔진 (9거래소, 11 브릿지코인) | 완료 | `findOptimalRoute()` 완전 구현 |
| x402 결제 | 완료 | `@x402/hono` 미들웨어, 35개 유료 엔드포인트 |
| MCP 서버 16개 도구 | 완료 | 16개 `registerTool` 확인 |
| NPM 패키지 (MCP + SDK) | 완료 | npm에 `1.9.0` 배포 확인 |
| 텔레그램 봇 (기본) | 완료 | 7개 명령어 + AI 모드 |
| 김프 데이터 수집 | 완료 | 매분 cron, D1 `kimchi_snapshots` |
| Glama.ai 인증 | 완료 | `/.well-known/glama.json` 라이브 |
| Smithery 설정 | 완료 | `smithery.yaml` 존재 |
| A2A 프로토콜 | 완료 | `routes/a2a.ts` 구현 |
| **텔레그램 김프 알람** | **미완료** | 수동 조회만, 자동 알람 없음 |
| **MCP 마켓 실제 등록** | **미완료** | 설정만 있고 실제 제출 미확인 |
| **카니발라이제이션 수정** | **미완료** | 무료=유료 동일 함수 호출 |
| **RapidAPI 등록** | **미착수** | 코드 0줄 |
| **Apify Actor** | **미착수** | 코드 0줄 |
| **ClawHub 스킬** | **미착수** | 코드 0줄 |
| **B2C 구독 결제** | **미착수** | Toss/Stripe 코드 없음 |
| **한국 주식 API 상품화** | **미착수** | 별도 엔드포인트 없음 |
| **x402 Facilitator** | **미착수** | 자체 facilitator 없음 |
| **일본 시장 확장** | **부분** | bitFlyer만, 합성 가격 |
| **파트너십** | **미착수** | 연구 문서만 존재 |
| **마케팅** | **미착수** | 코드/자동화 없음 |

---

## 즉시 매출 Top 5 최종 판정

| # | 항목 | 판정 | 상세 |
|---|------|------|------|
| 1 | 텔레그램 김프 알람봇 | **부분** | 봇 있음, 김프 데이터 있음, **알람 기능 없음** |
| 2 | MCP 마켓 5곳 등록 | **부분** | smithery.yaml/glama.json 있음, **실제 제출 안 함** |
| 3 | RapidAPI 등록 | **미착수** | 코드 0줄 |
| 4 | Apify Actor | **미착수** | 코드 0줄 |
| 5 | 카니발라이제이션 수정 | **미착수** | 무료가 유료와 동일한 함수 호출, **수정 안 함** |

---

> **결론**: 인프라(라우팅 엔진, x402, MCP, SDK, 봇 기본)는 탄탄하게 완성되어 있음.
> 그러나 **유통(마켓플레이스 등록)**, **수익화(알람 구독, 카니발라이제이션 수정)**, **마케팅** 은 전혀 시작하지 않은 상태.
> 기술 자산은 충분하므로, 이번 주는 "등록 + 알람 기능 + 카니발라이제이션 수정"에만 집중하면 됨.
