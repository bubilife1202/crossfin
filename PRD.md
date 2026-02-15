# CrossFin PRD — x402 Agent Gateway

> 최종 업데이트: 2026-02-15
> 상태: MVP 빌드 착수

---

## 1. 한 줄 요약

**CrossFin = AI 에이전트를 위한 서비스 게이트웨이. 한국 시장을 첫 거점으로, x402 생태계의 서비스 발견 · 등록 · 결제를 하나로 묶는다.**

Today status:
- Live dashboard: https://crossfin.dev
- Live registry stats: https://crossfin.dev/api/registry/stats
- Live OpenAPI: https://crossfin.dev/api/openapi.json

---

## 2. 문제

### 현재 상황
- x402 생태계에 **618개+** 라이브 서비스가 있다 (2026.02 기준)
- **7,541만 건** 트랜잭션, **$2,424만** 거래량 처리됨
- AI 에이전트가 실제로 API를 호출하고 USDC로 결제하고 있다

### 문제점
1. **발견이 안 된다** — 618개 서비스가 흩어져 있음. BlockRun이 카탈로그를 만들었지만 LLM 라우팅에 치중. 범용 서비스 발견 계층이 없음.
2. **등록이 어렵다** — 서비스 제공자가 되려면 x402 프로토콜을 직접 구현해야 함. 코딩 필요.
3. **한국 서비스가 0개** — 한국 일 거래량 $4.3B (글로벌 3위)인데 x402 생태계에 한국 데이터 제공자가 CrossFin 외에 없음.
4. **분석이 없다** — 어떤 서비스가 많이 쓰이는지, 어떤 에이전트가 얼마나 쓰는지 트래킹 불가.

---

## 3. 솔루션

### CrossFin Gateway = 3개 레이어

```
┌────────────────────────────────────────────┐
│  Layer 3: Dashboard                        │
│  실시간 트랜잭션, 서비스별 사용량, 수익     │
├────────────────────────────────────────────┤
│  Layer 2: Registry                         │
│  x402 서비스 등록/발견/검색 API             │
│  (자체 서비스 + 외부 서비스 등록)            │
├────────────────────────────────────────────┤
│  Layer 1: Services                         │
│  CrossFin 자체 한국 데이터 API (이미 구축)   │
│  외부 서비스 프록시 (수수료 5%)              │
└────────────────────────────────────────────┘
```

### 왜 RapidAPI가 아닌가
- RapidAPI는 **사람 개발자**가 수동으로 API를 찾고 연동
- CrossFin은 **AI 에이전트**가 자동으로 서비스를 발견하고 결제
- x402 = HTTP 네이티브 결제 → 계정/API키 없이 바로 결제 가능
- RapidAPI 모델 ($1B 유니콘, Nokia 인수)이 에이전트 시대에도 유효함을 검증

### 왜 BlockRun이 아닌가
- BlockRun은 **LLM 라우팅**에 집중 (GPT, Claude 등 모델 비용 최적화)
- CrossFin은 **비-LLM 서비스** 게이트웨이 (데이터, 분석, 도구, 한국 시장)
- 한국 시장 특화 — 한국어 지원, 한국 거래소 데이터, KRW 환율

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
| 한국 데이터 API 4개 | ✅ 라이브 | 김프, 차익거래, 호가창, 센티먼트 |
| 무료 데모 1개 | ✅ 라이브 | /api/arbitrage/demo |
| OpenAPI 스펙 | ✅ 라이브 | /api/openapi.json |
| Bazaar 확장 | ✅ 배포 | 서비스 자동 발견 |
| D1 DB | ✅ 배포 | agents, wallets, transactions, audit_logs |
| Agent 등록/인증 | ✅ 배포 | POST /api/agents, X-Agent-Key |
| 예산 관리 | ✅ 배포 | daily/monthly limit, circuit breaker |
| x402 생태계 PR | 🔄 리뷰중 | github.com/coinbase/x402/pull/1187 |
| BlockRun 등록 | 🔄 오픈 | github.com/BlockRunAI/awesome-blockrun/issues/5 |

---

## 6. MVP 스코프 (4일, 2/15~2/18)

### 6.1 Service Registry API

**목적**: x402 서비스를 등록하고 검색하는 API. AI 에이전트가 "어떤 서비스가 있지?" 물으면 답해주는 계층.

**엔드포인트:**

```
GET  /api/registry                    — 전체 서비스 목록 (무료)
GET  /api/registry/search?q=crypto    — 서비스 검색 (무료)
GET  /api/registry/:id                — 서비스 상세 (무료)
POST /api/registry                    — 서비스 등록 (인증 필요)
GET  /api/registry/categories         — 카테고리 목록
```

**서비스 등록 데이터 모델:**
```json
{
  "id": "uuid",
  "name": "CrossFin Kimchi Premium",
  "description": "Real-time price spread between Korean and global exchanges",
  "provider": "crossfin",
  "category": "crypto-data",
  "endpoint": "https://crossfin.dev/api/premium/arbitrage/kimchi",
  "method": "GET",
  "price": "$0.05",
  "currency": "USDC",
  "network": "eip155:8453",
  "payTo": "0xe4E79Ce6a1377C58f0Bb99D023908858A4DB5779",
  "tags": ["korea", "crypto", "arbitrage", "kimchi-premium"],
  "inputSchema": {},
  "outputExample": {},
  "status": "active",
  "createdAt": "2026-02-15T00:00:00Z"
}
```

**초기 데이터:**
- CrossFin 자체 서비스 4개 (이미 라이브)
- 외부 x402 서비스 수동 등록 20~50개 (x402engine, AsterPay, invy.bot, auor.io, minifetch, pinata 등에서 수집)

### 6.2 Gateway Proxy (Phase 1 — 간소화)

**MVP에서는 직접 프록시 안 함.** 서비스 URL을 반환하고, AI 에이전트가 직접 호출.

이유: x402 결제는 에이전트 → 서비스 직접 결제 구조. 중간에 프록시 넣으면 결제 흐름이 복잡해짐. MVP에서는 "발견" 레이어에 집중.

**Phase 2 (Hashed 프로그램 중):**
- CrossFin 프록시를 통한 호출 → 수수료 5% 추가
- 에이전트가 CrossFin 한 곳에만 결제하면 CrossFin이 분배

### 6.3 Dashboard (웹 UI)

**기존 crossfin.dev 웹사이트를 대시보드로 전환.**

표시 내용:
- 등록된 서비스 수
- 카테고리별 서비스 목록
- CrossFin 자체 서비스 호출 통계 (DB에서 집계)
- 실시간 한국 시장 데이터 (기존 데모 활용)
- 서비스 검색 UI

**Hashed 데모용 핵심 메트릭:**
- Total Services Registered: N개
- CrossFin Own Services: 4개 (라이브)
- Networks Supported: Base (USDC)
- 빌드 기간: 2주 (비개발자 + AI)

### 6.4 한국 데이터 서비스 확장

기존 4개 서비스에 추가:

| 서비스 | 가격 | 데이터 소스 | 우선순위 |
|--------|------|------------|---------|
| 업비트 시세 | $0.02 | Upbit Open API | P1 |
| 업비트 호가창 | $0.02 | Upbit Open API | P1 |
| 코인원 시세 | $0.02 | Coinone API | P2 |
| 한국 뉴스 헤드라인 | $0.03 | Naver News RSS | P2 |
| KRW/USD 실시간 환율 | $0.01 | ExchangeRate API | P1 |

→ 총 **9개 서비스**로 확장 (한국 최대 x402 서비스 제공자)

---

## 7. 기술 아키텍처

### 현재 스택 (유지)
- **Runtime**: Cloudflare Workers (Hono)
- **DB**: Cloudflare D1 (SQLite)
- **Payments**: x402 (@x402/hono, @x402/extensions/bazaar)
- **Frontend**: Cloudflare Pages (React + Vite)
- **Network**: Base mainnet (eip155:8453), USDC
- **Domain**: crossfin.dev

### 추가 필요
- D1 테이블: `services` (서비스 레지스트리)
- D1 테이블: `service_calls` (호출 로그, 선택적)
- API 라우트: `/api/registry/*`
- 프론트엔드: 대시보드 컴포넌트

### DB 스키마 추가

```sql
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  provider TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  price TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDC',
  network TEXT NOT NULL DEFAULT 'eip155:8453',
  pay_to TEXT,
  tags TEXT, -- JSON array
  input_schema TEXT, -- JSON
  output_example TEXT, -- JSON
  status TEXT NOT NULL DEFAULT 'active',
  is_crossfin INTEGER NOT NULL DEFAULT 0, -- 자체 서비스 여부
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_calls (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  response_time_ms INTEGER,
  created_at DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (service_id) REFERENCES services(id)
);
```

---

## 8. 4일 빌드 계획 (하루 = 1주일치 아웃풋)

> 원칙: AI가 빌드한다. 한 달치를 하루에 한다.

### Day 1 (2/15 토) — 풀스택 게이트웨이 완성

**백엔드 전체:**
- [ ] `services`, `service_calls` 테이블 마이그레이션 + 프로덕션 적용
- [ ] `/api/registry` 전체 CRUD (목록, 검색, 상세, 등록)
- [ ] `/api/registry/search?q=&category=` 검색 + 필터
- [ ] `/api/registry/categories` 카테고리 목록
- [ ] `/api/registry/stats` 레지스트리 통계 (총 서비스, 카테고리별 수, 네트워크별 수)
- [ ] CrossFin 자체 서비스 시드 (기존 4개 + 신규)
- [ ] 외부 x402 서비스 50개+ 시드 (x402engine 38개, AsterPay 13개, invy, auor, minifetch, pinata, firecrawl 등)

**한국 서비스 확장 (4개 → 9개+):**
- [ ] 업비트 시세 (Upbit ticker) — $0.02
- [ ] 업비트 호가창 (Upbit orderbook) — $0.02
- [ ] 코인원 시세 (Coinone ticker) — $0.02
- [ ] KRW/USD 실시간 환율 — $0.01
- [ ] 한국 뉴스 헤드라인 (Naver RSS) — $0.03

**프론트엔드 전면 리뉴얼:**
- [ ] 랜딩 → Gateway 대시보드 전환
  - Hero: "The Gateway for AI Agent Services" + 실시간 서비스 수/네트워크 카운터
  - 서비스 브라우저: 카테고리 탭 + 검색바 + 서비스 카드 그리드
  - 서비스 상세 모달: 엔드포인트, 가격, 네트워크, 태그, 예시 응답, "Try it" 버튼
  - CrossFin 자체 서비스 하이라이트 섹션 (한국 데이터)
  - 실시간 김프 위젯 (기존 데모 활용)
  - 서비스 등록 폼 (폼 제출 → POST /api/registry)
- [ ] 반응형 + 다크 모드
- [ ] API 문서 페이지 (OpenAPI 기반)

**배포 + 테스트:**
- [ ] D1 마이그레이션 로컬 → 프로덕션
- [ ] Workers 배포 + 모든 엔드포인트 라이브 확인
- [ ] Pages 배포 + 대시보드 라이브 확인
- [ ] OpenAPI 스펙 업데이트 (레지스트리 + 신규 서비스 반영)

### Day 2 (2/16 일) — 결제 + 트래픽 + 생태계

**결제 완료:**
- [ ] 빗썸 출금 (오후 9시 제한 해제 후 즉시)
- [ ] XRP → Binance → USDC 환전 → Base 출금 → payer 지갑
- [ ] x402 실결제 테스트 전 엔드포인트 (자체 서비스 9개)
- [ ] 결제 성공 트랜잭션 해시 + basescan 링크 기록
- [ ] 대시보드에 실 트랜잭션 반영

**외부 트래픽 확보 (목표: 10+명):**
- [ ] Twitter/X 포스트 — "Built an x402 service gateway in 2 weeks with AI. 50+ services, Korean crypto data."
- [ ] x402 Discord 공유
- [ ] r/cryptocurrency, r/AIAgents 포스트
- [ ] Hacker News Show HN 포스트
- [ ] AI agent Telegram/Discord 커뮤니티 (LangChain, CrewAI, n8n)
- [ ] Product Hunt 준비 (리스팅 작성)

**생태계 업데이트:**
- [ ] x402 PR #1187 업데이트 (Gateway 피봇 반영)
- [ ] BlockRun Issue #5 업데이트
- [ ] 신규 생태계 등록 (Composio, MCP directories)

**서비스 100개 돌파:**
- [ ] 추가 외부 서비스 스크래핑 및 등록
- [ ] BlockRun 618개 카탈로그에서 주요 서비스 임포트
- [ ] 목표: 100개+ 서비스 등록

### Day 3 (2/17 월) — 프록시 레이어 + 분석 + 수익화

**프록시 수수료 레이어:**
- [ ] `/api/proxy/:serviceId` — CrossFin을 통한 서비스 호출
- [ ] 자동 수수료 5% 추가 (가격 $0.05 → CrossFin 가격 $0.0525)
- [ ] 프록시 결제 → CrossFin 수령 → 원 서비스 포워딩
- [ ] 프록시 호출 로그 (service_calls 테이블)

**분석 대시보드:**
- [ ] 서비스별 호출 수, 매출, 응답 시간
- [ ] 카테고리별 트렌드
- [ ] 시간대별 트래픽 그래프
- [ ] 서비스 제공자용 통계 페이지

**에이전트 온보딩 플로우:**
- [ ] "Get Started" 페이지 — 에이전트 등록 → 지갑 생성 → 첫 API 호출 가이드
- [ ] Python/JS SDK 코드 스니펫 자동 생성
- [ ] cURL 예시 복사 버튼

**추가 서비스:**
- [ ] 한국 커뮤니티 센티먼트 (DCInside 크립토 갤러리 RSS)
- [ ] 업비트 거래량 분석
- [ ] 목표: 자체 서비스 12개+

### Day 4 (2/18 화) — Hashed 제출 + 데모 + 총마무리

**Hashed 지원 이메일:**
- [ ] 이메일 작성 (vibelabs@hashed.com)
  - 팀: 1인, 풀타임, 비개발자 — AI(Claude)로 전체 빌드
  - 라이브 URL: https://crossfin.dev
  - GitHub: https://github.com/bubilife1202/crossfin
  - 핵심 숫자: 서비스 100개+, 자체 12개+, 실 트랜잭션 N건, 빌드 2.5주
  - 소셜: Twitter 링크
- [ ] 데모 영상 (Loom/스크린 레코딩)
  - 대시보드 → 서비스 검색 → API 호출 → 실결제 → 트랜잭션 확인
  - 서비스 등록 폼 → 새 서비스 등록 → 목록에 반영
  - 60초 이내
- [ ] 스크린샷 5장 (대시보드, 서비스 목록, 결제 확인, 코드, basescan)
- [ ] 이메일 발송

**최종 점검:**
- [ ] 전 엔드포인트 라이브 테스트
- [ ] 대시보드 모든 페이지 동작 확인
- [ ] OpenAPI 최종 업데이트
- [ ] README 최종 업데이트
- [ ] Git push (clean commit history)
- [ ] Product Hunt 런칭

**추가 홍보:**
- [ ] Twitter 스레드 — "비개발자가 AI로 2.5주 만에 만든 x402 서비스 게이트웨이" 스토리
- [ ] x402 공식 채널에 사례 공유
- [ ] 한국 크립토 커뮤니티 (코인판, 디시) 공유

---

## 9. 수익 모델

### Phase 1 (MVP, 지금)
- **자체 서비스 매출**: x402 결제당 $0.02~$0.10 (직접 수익)
- **무료 레지스트리**: 서비스 등록/검색 무료 (트래픽 확보)

### Phase 2 (Hashed 프로그램 중, 3~4월)
- **프록시 수수료**: CrossFin을 통한 호출시 5% 수수료
- **프리미엄 리스팅**: 서비스 상위 노출 $10~50/월
- **분석 대시보드**: 서비스 제공자용 사용 통계 $20~100/월

### Phase 3 (프로그램 이후, 5~8월)
- **번들 구독**: 에이전트가 월 $50 내면 등록된 서비스 할인 이용
- **결제 라우팅**: 에이전트 지갑 관리 + 멀티 서비스 결제 최적화
- **엔터프라이즈**: 기업용 에이전트 지출 관리 SaaS

### 수익 목표 (Hashed 데모데이, 4월 말)
- 등록 서비스: 500개+
- 월간 API 호출: 100,000건+
- MRR: $5,000+ (자체 서비스 + 프록시 수수료)
- 등록 에이전트: 200+
- 외부 서비스 제공자: 20+
- 프록시 거래량: $10,000+/월

---

## 10. 성공 지표

### MVP (2/19 제출 시점)
| 지표 | 목표 |
|------|------|
| 라이브 URL | crossfin.dev ✅ |
| 등록 서비스 수 | 100+ |
| CrossFin 자체 서비스 | 12개+ |
| 프록시 수수료 레이어 | 라이브 |
| Registry API 응답 | < 200ms |
| 대시보드 라이브 | ✅ (서비스 브라우저 + 분석 + 등록 폼) |
| 실결제 테스트 | 다수 (Base 메인넷) |
| 외부 트래픽 | 10+명 |
| 홍보 채널 | Twitter, Reddit, HN, Discord, Product Hunt |

### Hashed 데모데이 (4월 말)
| 지표 | 목표 |
|------|------|
| 등록 서비스 | 500+ |
| 월간 호출 | 100,000+ |
| MRR | $5,000+ |
| 등록 에이전트 | 200+ |
| 프록시 거래량 | $10,000+/월 |
| 외부 서비스 제공자 | 20+ |
| 한국 서비스 | 20개+ (독점 데이터) |

---

## 11. 경쟁 분석

| | CrossFin | BlockRun.ai | x402engine.app | RapidAPI (Nokia) |
|--|----------|-------------|----------------|-----------------|
| 포커스 | 범용 서비스 게이트웨이 | LLM 라우팅 | 멀티 API 제공 | 범용 API 마켓 |
| 한국 데이터 | ✅ 유일 | ❌ | ❌ | ❌ |
| 결제 방식 | x402 (USDC) | x402 (USDC) | x402 (USDC) | 카드/구독 |
| 서비스 등록 | 누구나 가능 | 카탈로그만 | 자체만 | 개발자만 |
| AI 에이전트 최적화 | ✅ | ✅ | ✅ | ❌ (사람용) |
| 수수료 모델 | 5% 프록시 | 5% 마크업 | 자체 마진 | 20% 커미션 |
| 대시보드 | ✅ | ❌ | ❌ | ✅ |

### 차별화 포인트
1. **한국 시장 독점**: x402 생태계 유일한 한국 데이터 제공자
2. **서비스 등록 개방**: 누구나 자기 API를 등록 가능 (노코드 폼)
3. **범용 게이트웨이**: LLM에 한정되지 않고 모든 종류의 서비스 지원
4. **대시보드**: 서비스 제공자와 소비자 모두를 위한 분석 UI

---

## 12. 리스크 & 대응

| 리스크 | 확률 | 대응 |
|--------|------|------|
| x402 생태계 성장 정체 | 중 | 자체 서비스 매출로 버틴다. 생태계와 무관하게 한국 데이터 가치 유지. |
| BlockRun이 범용 게이트웨이로 확장 | 중 | 한국 특화 + 서비스 등록 개방으로 차별화. 네트워크 효과 선점. |
| 결제 테스트 실패 (USDC 부족) | 저 | 예산 $70 범위 내 XRP→USDC 경로 확보. 최소 $5 USDC면 테스트 가능. |
| Hashed 탈락 | 중 | 제품은 독립적으로 가치 있음. 다른 펀딩/부트스트랩 경로 추구. |

---

## 13. Hashed Vibe Labs 포지셔닝

### 우리가 보여줄 것

1. **빌드 속도**: 비개발자가 AI(Claude)로 2주 만에 풀스택 프로덕션 배포
2. **라이브 제품**: crossfin.dev — 대시보드 + 9개 서비스 + 레지스트리
3. **AI 활용 깊이**: 코드, 배포, 시장조사, 경쟁분석, 생태계 등록 전부 AI가 수행
4. **한국 × 크립토 × AI**: 세 트렌드의 교차점에 위치
5. **실제 트랜잭션**: Base 메인넷 실결제 증명

### 우리가 보여주지 않을 것 (Hashed 규칙)
- ❌ 피치덱
- ❌ 시장 분석 보고서
- ❌ 사업계획서

### 핵심 메시지
> "코딩을 모르는 1인이 AI로 2주 만에 x402 생태계의 서비스 게이트웨이를 만들었습니다. 한국 크립토 데이터 API 9개가 라이브이고, 50개+ 외부 서비스가 등록되어 있습니다. 이것이 AI 에이전트 경제의 인프라입니다."

---

## 14. 장기 비전 (VISION.md 연결)

이 MVP는 VISION.md에 정의된 **"에이전트의 은행"**으로 가는 첫 단계.

```
지금 (MVP)        → x402 서비스 게이트웨이 (발견 + 등록 + 자체 서비스)
3개월 후 (Phase 2) → 결제 프록시 + 수수료 (돈이 흐르는 파이프라인)
6개월 후 (Phase 3) → 에이전트 지갑 관리 + 멀티 플랫폼 결제 라우팅
1년 후 (Phase 4)   → 아시아 에이전트 금융 인프라 (카카오페이/토스/x402/Stripe 통합)
```

**서비스 게이트웨이 → 결제 게이트웨이 → 에이전트 은행**

이 경로에서 네트워크 효과가 작동한다:
- 서비스가 많을수록 → 에이전트가 모인다
- 에이전트가 많을수록 → 서비스가 등록된다
- 결제가 늘수록 → 데이터가 쌓인다
- 데이터가 쌓일수록 → 금융 서비스(신용, 예산, 분석)가 가능해진다

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
