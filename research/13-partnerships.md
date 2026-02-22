# Sponge / Natural / Locus 파트너십 가능성 분석

> CrossFin의 아시아 시장 라우팅 역량과 에이전트 결제 인프라 기업들의 파트너십 기회 분석
> 연구일: 2026-02-21

---

## 1. Sponge (YC) — 에이전트 금융 인프라

### 1.1 제품 상세

| 항목 | 내용 |
|------|------|
| **한줄 요약** | AI 에이전트에게 은행계좌, 카드, 크립토 접근권 제공 |
| **창업팀** | ex-Stripe Crypto 팀 테크리드 출신 (Stripe 스테이블코인 금융계좌, 결제, 자금이동 시스템 구축) |
| **배치** | Y Combinator |
| **주요 제품** | Sponge Wallet (에이전트 자율 결제), Sponge Gateway (기업이 에이전트에 직접 판매) |
| **지원 체인** | Ethereum, Base, Solana (메인넷) + Sepolia, Base Sepolia, Solana Devnet, Tempo (테스트넷) |
| **핵심 기능** | 멀티체인 크립토 전송, USDC 전송, 잔액 조회, 에이전트별 API키 스코핑, 지출 한도, 허용 목록, 감사 로깅 |

### 1.2 API/SDK 문서

- **SpongeWallet SDK**: TypeScript 기반, 지갑 생성/인증/트랜잭션 처리 (Claude 연동 내장)
- **SpongeAdmin SDK**: 마스터키로 프로그래매틱 에이전트 생성
- **MCP Server**: Claude Desktop 및 기타 MCP 클라이언트용 서버
- 문서: [paysponge.com/docs](https://paysponge.com/docs)

### 1.3 아시아 진출 계획

- **현재 아시아 진출 계획 언급 없음**
- 지원 체인은 글로벌 체인(Ethereum, Base, Solana)에 한정
- 한국 거래소(빗썸, 업비트 등) 접근 기능 전무
- KRW 페어 또는 아시아 로컬 거래소 지원 없음

### 1.4 CrossFin 통합 제안 포인트

**핵심 시나리오: Sponge 에이전트 -> CrossFin 라우팅 -> 한국 거래소 접근**

```
Sponge Wallet (USDC on Base)
  ↓ CrossFin API 호출
  ↓ find_optimal_route: USDC → 빗썸/업비트 KRW 변환 최적 경로
  ↓ 11개 브릿지 코인 평가, 수수료/슬리피지/전송시간 최적화
  ↓ 결과: 에이전트가 한국 시장 가격에 접근 가능
```

**구체적 통합 시나리오:**
1. **김치 프리미엄 차익거래**: Sponge 에이전트가 글로벌-한국 스프레드 모니터링 후 자동 거래 (CrossFin `get_kimchi_premium` → `find_optimal_route`)
2. **한국 시장 데이터 접근**: Sponge 에이전트가 한국 주식/크립토 데이터 소비 (CrossFin x402 유료 API)
3. **크로스보더 자금 이동**: Sponge Wallet → CrossFin 라우팅 → 한국 거래소 입금, 또는 역방향
4. **Sponge Gateway 등록**: CrossFin API를 Sponge Gateway에 등록 → 모든 Sponge 에이전트가 한국 시장 접근 가능

**기술적 보완성: 높음**
- Sponge = 지갑 + 에이전트 신원 관리
- CrossFin = 아시아 시장 라우팅 + 데이터
- 두 제품이 경쟁하지 않고 완벽하게 보완

---

## 2. Natural ($9.8M Seed) — B2B 에이전트 결제

### 2.1 제품 상세

| 항목 | 내용 |
|------|------|
| **한줄 요약** | B2B 임베디드 에이전트 결제 인프라 |
| **창업팀** | Kahlil Lalji (CEO), Walt Leung, Eric Wang |
| **투자** | $9.8M Seed (Abstract + Human Capital 공동 리드) |
| **주요 투자자** | Bridge CEO, Mercury CEO, Ramp CEO/CTO, Vercel CEO, Unit CEO, Emprise Bank CEO |
| **타겟 산업** | 물류, 부동산 관리, 조달, 헬스케어, 건설 |
| **핵심 가치** | 에이전트가 벤더 소싱, 협상, 실시간 결제를 자율 수행 |
| **상태** | 2025년 10월 스텔스 출시, 2026년 GA 목표 |

### 2.2 API/SDK 문서

- 공개 API 문서 미확인 (아직 GA 전)
- 핵심 스택: 신원(identity), 권한(authorization), 저지연 정산(low-latency settlement)
- 팀 규모: 연말까지 10명 이하 유지 계획 → 파트너십 통한 기능 확장 선호 가능성

### 2.3 아시아 수요 분석

**타겟 산업별 아시아 시장 기회:**

| 산업 | 아시아 수요 | CrossFin 연관성 |
|------|-----------|----------------|
| **물류** | 아시아 물류 허브 (한국 인천, 일본, 싱가포르) — 화물 협상/결제 에이전트 필요 | 크로스보더 결제 라우팅 |
| **조달** | 한국/일본/중국 제조업 공급망 — 에이전트 기반 벤더 결제 | KRW/JPY 결제 지원 |
| **헬스케어** | 의료 관광 (한국→동남아) — 벤더/공급자 결제 자동화 | 아시아 FX + 결제 |
| **건설** | 아시아 인프라 투자 증가 — 하도급 결제 자동화 | 다통화 정산 |

### 2.4 통합 시나리오

**핵심: Natural 에이전트의 아시아 결제 레일로서의 CrossFin**

```
Natural B2B 에이전트 (물류/조달)
  ↓ 한국/일본 벤더 결제 필요
  ↓ Natural → CrossFin API 호출
  ↓ CrossFin: USDC → 최적 경로 → KRW/JPY 변환
  ↓ 벤더에게 현지 통화로 결제 완료
```

**구체적 시나리오:**
1. **물류 정산**: 화물 에이전트가 한국 운송사에 KRW로 결제 (Natural 결제 로직 + CrossFin 라우팅)
2. **조달 자동화**: 조달 에이전트가 한국 부품 공급사에 실시간 결제 (Natural 협상 + CrossFin FX/결제)
3. **크로스보더 B2B**: 미국 기업 에이전트 → Natural → CrossFin → 한국/일본 벤더 결제

**기술적 보완성: 중상**
- Natural = B2B 결제 로직 + 산업별 워크플로우
- CrossFin = 아시아 결제 레일 + FX 최적화
- Natural이 GA 전이라 초기 파트너십 체결 최적 시점

---

## 3. Locus (YC F25) — 에이전트 자금/권한/감사

### 3.1 제품 상세

| 항목 | 내용 |
|------|------|
| **한줄 요약** | AI 에이전트 결제의 제어 계층 (자금 연결, 권한 정의, 감사 추적) |
| **창업팀** | Cole Dermott (ex-Coinbase B2B 결제), Eliot Lee (ex-Scale AI) |
| **배치** | Y Combinator F25 |
| **지원 레일** | USDC on Base (라이브), ACH (예정), Wire (예정) |
| **핵심 기능** | 에이전트 신원, 예산 통제 ($500/day 등), 권한 프레임워크, 감사 추적, 규칙 강제 |

### 3.2 CrossFin과의 보완 관계

**Locus와 CrossFin은 에이전트 결제 스택의 서로 다른 계층을 담당:**

```
[Locus 계층 — 제어/거버넌스]
  에이전트 신원 관리
  예산 한도 설정 ($500/day)
  벤더 허용 목록
  감사 추적/로깅
       ↓
[CrossFin 계층 — 실행/라우팅]
  아시아 거래소 라우팅
  최적 경로 탐색
  FX 최적화
  x402 결제 실행
```

**핵심 보완점:**

| Locus 역할 | CrossFin 역할 |
|-----------|--------------|
| "이 에이전트는 하루 $500까지 쓸 수 있다" | "이 $500을 가장 싸게 KRW로 바꾸는 경로" |
| "빗썸/업비트만 허용된 거래소" | "빗썸/업비트 API 접근 + 라우팅" |
| "모든 거래 감사 기록" | "각 라우팅 결과의 수수료/시간/슬리피지 데이터" |
| "USDC on Base로 자금 관리" | "USDC → 최적 브릿지 코인 → 목적지 거래소" |

**통합 시나리오:**
1. **거버넌스 기반 거래**: Locus 권한 체크 → CrossFin 라우팅 → 한국 거래소 실행
2. **예산 내 최적화**: Locus가 일일 예산 설정 → CrossFin이 예산 내 최적 경로 반환
3. **감사 통합**: Locus 감사 로그 + CrossFin 라우팅 로그 → 완전한 트랜잭션 감사 추적

**기술적 보완성: 매우 높음**
- 동일 레일 사용 (USDC on Base) → 즉시 통합 가능
- Locus = 제어 (WHO/HOW MUCH), CrossFin = 실행 (WHERE/HOW)
- 경쟁 관계 완전 부재

---

## 4. 파트너십 제안서 프레임워크

### 4.1 접근 방식

| 채널 | 대상 | 실행 방안 |
|------|------|----------|
| **YC 네트워크** | Sponge, Locus | YC 동문/배치 네트워크 활용 (CrossFin이 YC 관련이면 직접 인트로, 아니면 공통 투자자/멘토 경유) |
| **콜드 이메일** | Natural | 투자자 공통점(있으면) 또는 LinkedIn 직접 연락 — CEO Kahlil Lalji 타겟 |
| **해커톤/이벤트** | Locus | Locus가 YC HQ에서 "Agentic Payments Hackathon" 개최 → 참가 또는 후원/데모 |
| **기술 데모** | 전체 | CrossFin MCP + 대상 SDK 연동 데모 제작 → "15분 안에 한국 거래소 접근" 보여주기 |

### 4.2 제안 내용

#### Tier 1: 기술 통합 (즉시 실행 가능)

```
[제안 내용]
- CrossFin API를 파트너 플랫폼의 아시아 결제 레일로 등록
- MCP 도구 통합: 파트너 에이전트가 CrossFin 도구를 네이티브로 호출
- 공동 SDK: 파트너 SDK에 CrossFin 아시아 라우팅 모듈 번들

[수익 모델]
- x402 API 콜당 수익 (CrossFin $0.01-$0.10/call)
- 파트너 수수료: 라우팅 수수료의 10-20% 레브쉐어
- 또는: 파트너 플랫폼 통한 볼륨에 대해 고정 월정액 + 초과분 종량제
```

#### Tier 2: 공동 제품 (3-6개월)

```
[제안 내용]
- "Asia Gateway" 공동 브랜드 제품
- 파트너 에이전트 → CrossFin 라우팅 → 아시아 9개 거래소 원클릭 접근
- 공동 마케팅: "아시아 크립토 시장의 유일한 에이전트 접근점"

[수익 모델]
- 수익 쉐어 50:50 또는 70:30 (CrossFin 기술 + 파트너 유통)
- 볼륨 기반 티어 가격
```

#### Tier 3: 전략적 제휴 (6-12개월)

```
[제안 내용]
- 독점적 아시아 라우팅 파트너 계약
- 공동 투자/크로스 지분
- 통합 엔터프라이즈 세일즈

[수익 모델]
- 연간 라이선스 + 거래량 기반 수익 쉐어
- 최소 보장 볼륨(MVC) 약정
```

### 4.3 콜드 이메일 템플릿

```
Subject: CrossFin — Asia crypto routing for [Sponge/Natural/Locus] agents

Hi [Name],

I'm [Name], founder of CrossFin — the only way AI agents access
Asian crypto markets (Bithumb, Upbit, Coinone + 6 more exchanges).

Your agents handle [wallets/payments/permissions] globally, but
Korean exchanges are a walled garden: Korean-language APIs, IP
restrictions, real-name bank requirements. We solve this.

Quick stats:
- 9 exchanges, 11 bridge coins, real-time routing optimization
- x402 native: agents pay per call with USDC on Base ($0.01-$0.10)
- 2-3% kimchi premium arbitrage opportunity for agents

Integration is a single MCP tool or API call. I can show you a
working demo in 15 minutes.

Would you be open to a quick call this week?

[Signature]
```

### 4.4 타임라인

| 시기 | 마일스톤 | 대상 |
|------|---------|------|
| **Week 1-2** | 콜드 아웃리치 + 데모 영상 제작 | Sponge, Locus, Natural |
| **Week 3-4** | 첫 기술 미팅 + API 연동 PoC | 가장 먼저 응답하는 파트너 |
| **Month 2** | 기술 통합 완료 (Tier 1) | 1-2개 파트너 |
| **Month 3** | 공동 데모/블로그 포스트 발표 | 통합 완료 파트너 |
| **Month 4-6** | Tier 2 공동 제품 논의 + 볼륨 확인 | 트래픽 발생 파트너 |
| **Month 6-12** | Tier 3 전략적 제휴 평가 | 주요 파트너 |

### 4.5 우선순위 매트릭스

| 기업 | 기술 보완성 | 통합 용이성 | 시장 영향력 | 타이밍 | **총점** |
|------|-----------|-----------|-----------|--------|---------|
| **Locus** | ★★★★★ | ★★★★★ (동일 레일 USDC/Base) | ★★★ (초기) | ★★★★★ (F25 초기) | **18/20** |
| **Sponge** | ★★★★★ | ★★★★ (MCP 지원) | ★★★★ (YC) | ★★★★ | **17/20** |
| **Natural** | ★★★★ | ★★★ (GA 전) | ★★★★★ ($9.8M, 올스타 투자자) | ★★★★ (GA 준비 중) | **16/20** |

**권장 순서: Locus > Sponge > Natural**

---

## 5. 시장 컨텍스트 — 에이전트 결제 시장 구조 (2026)

### 에이전트 결제 인프라 6대 계층

| 계층 | 기능 | 주요 기업 | CrossFin 위치 |
|------|------|----------|-------------|
| **인프라** | 지갑 관리 | PayOS, Nekuda, Prava, Proxy | - |
| **신원** | 에이전트 인증 | Skyfire, Visa TAP | - |
| **발급** | 가상카드 생성 | Lithic, Marqeta, Highnote, Rain | - |
| **실행** | 브라우저 자동화 | Rye, Induced AI | - |
| **B2B/기업** | 엔터프라이즈 워크플로우 | Natural, Payman AI, Brex, Ramp | - |
| **표준** | 프로토콜 스펙 | Visa, Mastercard, Stripe, Google | - |

**CrossFin의 고유 포지션: "아시아 라우팅 계층"**
- 위 6대 계층 어디에도 아시아 시장 접근 솔루션이 없음
- 모든 인프라가 북미 중심 — 아시아는 완전한 공백
- CrossFin = 위 모든 계층의 에이전트가 아시아 시장에 접근할 때 필수적인 미들웨어

### 아시아 시장의 기회

- 한국/일본이 2026년 KRW/JPY 스테이블코인 제도화 추진 중
- Visa가 2026년 초 아시아 태평양에서 에이전트 커머스 파일럿 시작
- 크로스보더 결제 시장에서 텔레콤 기반 지갑의 국제 결제 네트워크 직접 연결 트렌드
- 한국 금융감독원의 2026년 AI 감독 우선과제 설정 → 규제 환경 정비 중

---

## 6. 핵심 결론

### CrossFin의 파트너십 강점

1. **유일한 아시아 에이전트 결제 인프라**: 에이전트 결제 시장의 모든 플레이어가 북미 중심. 아시아 커버리지를 가진 곳이 없음
2. **x402 네이티브**: API키/구독 없이 USDC per-call 결제 → 에이전트 플랫폼과 즉시 통합 가능
3. **MCP 지원**: 에이전트 생태계의 표준 프로토콜 지원 → 기술 통합 비용 최소
4. **9개 거래소 커버리지**: 한국(빗썸, 업비트, 코인원, 고팍스) + 일본(bitFlyer) + 글로벌(바이낸스, OKX, 바이비트, WazirX)

### 리스크

1. **시장 성숙도**: 에이전트 결제 시장 자체가 초기 → 파트너 볼륨이 기대보다 낮을 수 있음
2. **규제 불확실성**: 한국 VASP 규제, 실명확인 요건 → 에이전트의 한국 거래소 직접 거래에 제약
3. **기술 의존성**: 파트너사 제품이 아직 초기(특히 Natural, Locus) → 통합 우선순위 변경 가능

### 즉시 실행 항목

1. Locus에 Agentic Payments Hackathon 참가 신청 + CrossFin 데모 준비
2. Sponge Gateway에 CrossFin API 등록 시도 → "한국 거래소 접근" 서비스로
3. Natural CEO (Kahlil Lalji)에 콜드 이메일 발송 → 물류/조달 유스케이스 피칭
4. 3사 공통 데모 영상 제작: "Sponge/Natural/Locus 에이전트가 CrossFin으로 한국 거래소에 접근하는 15분 데모"

---

## Sources

- [Sponge YC Profile](https://www.ycombinator.com/companies/sponge)
- [Sponge Launch YC](https://www.ycombinator.com/launches/PTD-sponge-financial-infrastructure-for-the-agent-economy)
- [Sponge API Docs](https://paysponge.com/docs)
- [Natural $9.8M Seed (BusinessWire)](https://www.businesswire.com/news/home/20251023151615/en/Fintech-Natural-Launches-With-$9.8M-Seed-Round-to-Power-Agentic-Payments)
- [Natural (Yahoo Finance)](https://finance.yahoo.com/news/fintech-natural-launches-9-8m-130000758.html)
- [Locus YC Profile](https://www.ycombinator.com/companies/locus)
- [Locus Launch YC](https://www.ycombinator.com/launches/Oj6-locus-payment-infrastructure-for-ai-agents)
- [AI Agent Payments Landscape 2026 (Proxy)](https://www.useproxy.ai/blog/ai-agent-payments-landscape-2026)
- [Asia Stablecoin Ecosystem 2026 (ainvest)](https://www.ainvest.com/news/rise-asia-local-stablecoin-ecosystem-geopolitical-implications-investors-2026-2601/)
- [Japan/Korea Stablecoin Race (The Block)](https://www.theblock.co/post/383835/asias-stablecoin-focus-2025)
