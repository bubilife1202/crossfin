# CrossFin 성장 전략 V2 — 경쟁 환경 급변 분석

> 작성: 2026-02-17 | 이전 REVENUE_DEEP_RESEARCH.md 기반 + 신규 리서치 업데이트

---

## 경고: 경쟁 환경이 급격히 변했다

이전 리서치에서 "아시아 크로스플랫폼 에이전트 금융 관리 → 아무도 없음"이라고 했다. **더 이상 아무도 없지 않다.**

### 새로 등장한 직접 경쟁자들

| 회사 | 펀딩 | 하는 일 | CrossFin과의 관계 |
|------|------|---------|-------------------|
| **Sponge** (YC) | YC 배치 | 에이전트가 은행계좌+카드+크립토로 돈을 들고 쓰게 해줌 | **직접 경쟁** — "에이전트의 은행"을 정확히 만들고 있음 |
| **Natural** | $9.8M 시드 (Abstract, Human Capital) | 에이전트용 결제 인프라. B2B 임베디드 결제 | **직접 경쟁** — 물류/헬스케어/건설 에이전트 타겟 |
| **Paid** | $21.6M 시드 ($100M+ 밸류에이션, Lightspeed) | 에이전트 결과 기반 과금 인프라 | 간접 경쟁 — 과금 모델 레이어 |
| **Locus** (YC F25) | YC 배치 | 에이전트 자금 연결 + 권한/한도 설정 + 감사 | **직접 경쟁** — 에이전트 금융 관리 |
| **Sapiom** | $15.75M (Accel, Anthropic, Coinbase) | 에이전트 도구 구매 플랫폼 | 간접 경쟁 |
| **Lava** | $5.8M | 에이전트 지갑+크레딧 | 직접 경쟁 |

### 핵심 현실

**CrossFin의 원래 비전 "에이전트의 은행"을 Sponge(YC), Natural($9.8M), Locus(YC)가 이미 만들고 있다.**

이들은 미국 시장 + VC 자금 + YC 네트워크를 가지고 있다. 솔로 빌더가 정면 승부로 이길 수 없다.

**하지만 이들에게 없는 것이 있다: 아시아.**

---

## CrossFin의 진짜 기회: 아시아 에이전트 금융 라우터

### 왜 Sponge/Natural/Locus가 아시아를 못하는가

| 장벽 | 설명 |
|------|------|
| 실명확인 계좌제 | 한국 거래소 = 1거래소 1은행. API로 크로스거래소 이전 불가 |
| VAPUA 규제 | 가상자산이용자보호법. 외국 서비스가 한국 거래소 연동하려면 규제 이해 필수 |
| 아시아 결제 파편화 | 카카오페이/토스/네이버/LINE/Grab/알리페이 각각 독자 시스템 |
| 로컬 데이터 접근 | 네이버 금융, KRX 등 한국어 API는 외국 팀이 연동하기 극도로 어려움 |
| KRW 스테이블코인 | 2026년 한국/일본 자국 통화 스테이블코인 등장 예정 — 로컬 규제 이해 필수 |

**Sponge가 "에이전트에게 은행계좌를 줬다"고 해도, 그 에이전트가 빗썸에서 리플을 사서 바이낸스로 보내는 건 Sponge가 할 수 없다.**

---

## 2026년 핵심 트렌드 3가지

### 1. 한국/일본 자국 통화 스테이블코인 원년

한국과 일본이 2026년을 스테이블코인 돌파 원년으로 삼고 있다:
- **일본**: 미쓰비시UFJ, 스미토모미쓰이, 미즈호 3대 메가뱅크가 엔화 스테이블코인 파일럿. 2026년 말까지 5배 성장 전망
- **한국**: 카카오/네이버 기반 원화 스테이블코인 법안 추진. BDACS가 Avalanche에 KRW1 출시
- **CrossFin 기회**: 에이전트가 KRW 스테이블코인 ↔ USDC ↔ JPY 스테이블코인 간 라우팅할 때, CrossFin이 최적 경로를 찾아줌

### 2. OpenClaw 에코시스템 폭발 (200K+ GitHub 스타)

OpenClaw가 오픈소스 에이전트 생태계를 장악하고 있다:
- ClawHub에 5,705개 스킬 등록 (2026.02 기준)
- **금융 스킬 33개** — 하지만 한국 시장 관련 스킬은 네이버 금융 주식 조회 1개뿐
- 386개 악성 크립토 스킬 발견 → 검증된 금융 스킬 수요 급증
- Peter Steinberger가 OpenAI 합류 → 프로젝트는 오픈소스 재단으로 이관

**CrossFin 기회**: ClawHub에 검증된 한국 금융 스킬을 등록하면, 100만+ OpenClaw 에이전트가 한국 시장 데이터에 접근하는 유일한 통로가 됨

### 3. x402 V2 + 멀티체인 + 뱅크카드 통합

x402가 크립토만이 아니라 전통 결제까지 통합하고 있다:
- V2: "멀티체인 + 전통 결제 네트워크"를 표준화된 결제 형식으로 통합
- Base, Solana, Polygon, Avalanche, Sui, Near 지원
- ACH, 뱅크카드 네트워크 통합
- Google AP2가 x402를 공식 스테이블코인 facilitator로 통합

**CrossFin 기회**: x402 V2의 멀티체인 + 뱅크카드 통합 위에 아시아 결제 레일(카카오페이, 토스 등)을 추가하는 레이어

---

## 업데이트된 전략 우선순위

### Phase 0: 지금 당장 (VibeLabs 마감 전) — 2월 19일까지

| # | 할 일 | 이유 | 상태 |
|---|--------|------|------|
| 1 | TIER 1 + TIER 2 번들 엔드포인트 구현 | 서비스 가치 근본 개선 | 다른 에이전트 작업 중 |
| 2 | 라우팅 엔진 MVP (`find_optimal_route`) | CrossFin만의 킬러 기능 | 대기 중 |
| 3 | VibeLabs 지원서 작성 + 제출 | 마감 2/19 | 대기 중 |

### Phase 1: 이번 주 — 유통 채널 확보

| # | 할 일 | 기대 효과 | 소요 시간 |
|---|--------|----------|----------|
| 1 | **ClawHub에 CrossFin 금융 스킬 등록** | 100만+ OpenClaw 에이전트 노출. 한국 금융 스킬 유일 | 1-2일 |
| 2 | MCP 마켓플레이스 4곳 등록 | Claude/Cursor/LobeHub/Smithery 사용자 | 1일 |
| 3 | Apify Store Actor 등록 | 36,000+ 개발자 | 2-3일 |

### Phase 2: 2주 내 — 매출 만들기

| # | 할 일 | 기대 월 수익 | 소요 시간 |
|---|--------|-------------|----------|
| 1 | 텔레그램 김치프리미엄 알람봇 | ₩990K~9.9M ($700-7,000) | 3-5일 |
| 2 | RapidAPI Korea Financial Intelligence | $200-2,500 | 2-3일 |

### Phase 3: 1개월 내 — 생태계 포지셔닝

| # | 할 일 | 전략적 효과 |
|---|--------|------------|
| 1 | Lobster.cash/AgentPayy 한국 레일 통합 제안 | OpenClaw 결제 스택에 아시아 진입 |
| 2 | KRW1 스테이블코인 라우팅 지원 | 원화 스테이블코인 ↔ USDC 라우팅 최초 |
| 3 | x402 Foundation 아시아 파트너 지원 | 공식 아시아 Facilitator 포지션 |

### Phase 4: 3개월 내 — 확장

| # | 할 일 | 전략적 효과 |
|---|--------|------------|
| 1 | 일본 시장 데이터 추가 (JPX, bitFlyer) | 아시아 2개국 커버리지 |
| 2 | JPY 스테이블코인 라우팅 지원 | 한일 크로스보더 에이전트 금융 |
| 3 | 동남아 확장 (Grab, GCash, GoPay) | APAC 전체 커버리지 시작 |

---

## CrossFin 포지셔닝 재정의

### Before (AS-IS)
> "에이전트의 은행" — Sponge, Natural, Locus와 정면 경쟁

### After (TO-BE)
> "아시아 에이전트 금융 라우터" — Sponge/Natural/Locus가 못하는 아시아 영역을 채운다

### 한 줄 피치
> "Sponge gives agents a wallet. CrossFin tells them the cheapest path to move money across Asia."

### 관계 재정의

| 회사 | 관계 | 왜 |
|------|------|-----|
| Sponge | **파트너** (경쟁 아님) | Sponge 에이전트가 아시아에서 거래할 때 CrossFin 라우팅 사용 |
| Natural | **파트너** | Natural의 B2B 에이전트가 한국 시장 데이터 필요할 때 CrossFin |
| Locus | **파트너** | Locus가 에이전트 권한 관리, CrossFin이 아시아 라우팅 |
| OpenClaw | **플랫폼** | ClawHub 스킬로 한국 금융 접근 제공 |
| x402 Foundation | **인프라 파트너** | 아시아 Facilitator 역할 |

**핵심 전환: 경쟁자가 아니라 파트너가 되면 시장이 100배 커진다.**

---

## Hashed에게 이렇게 보여줘야 한다

Hashed의 2026 테제 (Protocol Economy 2026):
- "아시아에서 이 전환이 보이기 시작했다"
- "규제된 스테이블코인 파일럿, 초기 AI 에이전트 배포, RWA/트레저리 워크플로우"
- "인프라에서 돌파가 나온다, 내러티브가 아니라"

**CrossFin이 Hashed에게 맞는 이유**:
1. 아시아 특화 ✅ (한국 5거래소 + 네이버 금융 연동)
2. 인프라 ✅ (에이전트 금융 라우터)
3. 작동하는 프로덕트 ✅ (라이브, x402 결제 작동)
4. 스테이블코인 관련 ✅ (KRW↔USDC 라우팅)
5. 솔로 빌더가 17일에 만듦 ✅ (실행력 증명)

---

## 즉시 실행 가능한 NEW 기회들

### 1. ClawHub 스킬 등록 (★★★★★ 최우선 NEW)

**왜 지금인가**: OpenClaw에 금융 스킬 33개밖에 없고, 한국 시장은 1개(네이버 주식). 386개 악성 크립토 스킬 사태 이후 검증된 금융 스킬 수요 폭증.

**등록할 스킬**:
- `crossfin-korea-crypto` — 김치프리미엄, 5거래소 비교, 아비트리지 판단
- `crossfin-korea-market` — KOSPI/KOSDAQ + 외인/기관 수급 + 한국 뉴스
- `crossfin-route-finder` — 아시아 금융 라우팅 (라우팅 엔진 완성 후)

**임팩트**: 100만+ OpenClaw 에이전트가 한국 시장 데이터 접근 가능. x402 per-call 수익 자동 발생.

### 2. KRW1 스테이블코인 라우팅 (★★★★ 중기)

BDACS가 Avalanche에 KRW1을 출시했다. KRW1 ↔ USDC 라우팅을 CrossFin이 최초로 지원하면:
- 한국 거래소에서 원화로 사서 → KRW1로 전환 → USDC로 교환하는 경로
- 이 경로의 수수료/슬리피지/시간을 최적화하는 건 CrossFin만 할 수 있음

### 3. Sponge/Natural 파트너십 제안 (★★★ 중기)

이들이 아시아 시장을 열려면 CrossFin이 필요하다. 제안:
- "너희 에이전트가 한국/일본에서 거래할 때, CrossFin 라우팅 API를 써라"
- SDK integration이면 됨. 경쟁이 아니라 보완.

---

## 리서치 출처 (V2 추가분)

- [Natural $9.8M Seed — BusinessWire](https://www.businesswire.com/news/home/20251023151615/en/Fintech-Natural-Launches-With-$9.8M-Seed-Round-to-Power-Agentic-Payments)
- [Paid $21.6M Seed — TechCrunch](https://techcrunch.com/2025/09/28/paid-the-ai-agent-results-based-billing-startup-from-manny-medina-raises-huge-21m-seed/)
- [AI Agent Market $7.84B — TechFundingNews](https://techfundingnews.com/top-10-us-ai-agents-2026-fastest-scaling-category-52b-by-2030/)
- [OpenClaw 386 Malicious Skills — Infosecurity](https://www.infosecurity-magazine.com/news/malicious-crypto-trading-skills)
- [OpenClaw ClawHub Skills — BankrBot](https://github.com/BankrBot/openclaw-skills)
- [x402 Foundation — Coinbase](https://www.coinbase.com/blog/coinbase-and-cloudflare-will-launch-x402-foundation)
- [Google AP2 + x402 — Coinbase](https://www.coinbase.com/developer-platform/discover/launches/google_x402)
- [Korea/Japan Stablecoin Push — DL News](https://www.dlnews.com/articles/markets/south-korea-japan-aim-for-2026-stablecoin-breakthrough/)
- [Hashed Protocol Economy 2026 — CoinDesk](https://www.coindesk.com/markets/2025/12/05/asia-morning-briefing-crypto-s-next-breakout-will-come-from-infrastructure-not-narratives-hashed-says)
- [Agentic Commerce Beyond x402 — LongHash VC](https://www.longhash.vc/post/agentic-commerce-why-x402-is-just-the-beginning)
- [x402 V2 Multi-chain — Gate News](https://www.gate.com/news/detail/16774416)
- [KRW1 Stablecoin — BDACS/Avalanche](https://www.theblock.co/post/383835/asias-stablecoin-focus-2025)
- [Oh My OpenClaw Finance Skills](https://ohmyopenclaw.ai/category/finance/)
