# ClawHub/OpenClaw 스킬 등록 기회 분석

> 작성일: 2026-02-21 | CrossFin 수익화 리서치 #5

---

## 1. OpenClaw 현재 상태

### GitHub & 성장 지표
| 지표 | 수치 | 비고 |
|------|------|------|
| GitHub Stars | ~195K+ | 66일 만에 9K→195K, 역대 최고 속도 |
| Forks | 20,000+ | 2026.02.02 기준 |
| 생성된 에이전트 | 1,500,000+ | 단, 실제 계정은 ~17,000개 (평균 88봇/계정) |
| ClawHub 스킬 수 | 5,705+ → 10,700+ | 2026.02.07~02.16 사이 급증 |
| 누적 다운로드 | 1,500,000+ | ClawHub 기준 |

### 주요 이벤트 타임라인
- **2026.01.28**: Moltbook 출시 (에이전트 전용 소셜 네트워크) → 1.5M 에이전트 유입
- **2026.01.30**: OpenClaw 리브랜딩, 2일 만에 106K 스타 돌파
- **2026.02.07**: ClawHavoc 사건 — 341개 악성 스킬 발견 (이후 총 1,184개로 확대)
- **2026.02.14**: 창시자 Steinberger, OpenAI 합류 발표 (acqui-hire)
- **2026.02.15**: Kimi Claw 출시 (Moonshot AI, ClawHub 5,000+ 스킬 통합)

### 한국 관련 동향
- 카카오, 네이버, 당근마켓 등 국내 기업들이 사내 OpenClaw 접근 차단
- 보안 우려에도 불구하고 개발자 커뮤니티에서 활발한 사용
- **한국 금융 특화 스킬은 사실상 1개(Naver Finance)만 존재**

---

## 2. ClawHub 스킬 등록 절차

### 등록 프로세스
```
1단계: 스킬 준비
   └── README.md, 인라인 주석, 에러 핸들링, 권한 정당화 문서

2단계: 개발자 계정 생성
   └── clawhub.ai → "Developer Account"
   └── GitHub 계정 1주 이상 필수

3단계: 메타데이터 작성 (clawhub.json)
   {
     "name": "crossfin-korea-crypto",
     "tagline": "Max 80자",
     "description": "2-3 문단",
     "category": "finance",
     "tags": ["korea", "crypto", "kimchi-premium"],
     "version": "1.0.0",
     "license": "MIT",
     "pricing": "free|paid",
     "support_url": "GitHub issues",
     "homepage": "crossfin.dev"
   }

4단계: 비주얼 자산
   └── 3-5개 스크린샷 (1920x1080 또는 1280x720, PNG)
   └── 30-90초 데모 영상 (선택)

5단계: 제출 & 리뷰
   └── tar -czf skill.tar.gz skill/
   └── ClawHub 대시보드 업로드
   └── 리뷰 기간: 2-5 영업일

6단계: 게시 후 관리
   └── 사용자 리뷰 모니터링, 시맨틱 버저닝, 호환성 유지
```

### 수수료 구조
| 유형 | 수수료 | 비고 |
|------|--------|------|
| 무료 스킬 | 0% | 대부분의 스킬 |
| 유료 스킬 | 30% 플랫폼 수수료 | $10~$200 가격대 |
| SaaS 연동 모델 | 0% (ClawHub 외부 과금) | 프리미엄 API 키 판매 |

### 리뷰 기준 & 주요 리젝 사유
- 불충분한 문서화
- 불명확한 권한 정당화
- 에러 핸들링 부재
- 코드 품질 미달
- 보안 취약점
- VirusTotal 자동 스캐닝 통과 필수

---

## 3. 금융 스킬 33개 구체적 목록

### 전체 33개 Finance 카테고리 스킬 (ohmyopenclaw.ai 기준)

#### A. 주식/시장 분석 (7개)
| # | 스킬명 | 기능 |
|---|--------|------|
| 1 | yahoo-finance | 주가, 시세, 펀더멘털, 실적, 옵션, 배당, 애널리스트 평점 |
| 2 | yahoo-data-fetcher | 야후 파이낸스 실시간 시세 |
| 3 | yahoo-finance-cli | 커맨드라인 금융 데이터 조회 |
| 4 | stock-price-checker | yfinance 기반 주가 확인 (API 키 불필요) |
| 5 | financial-market-analysis | 주식, 기업, 시장 심리 분석 |
| 6 | finance-news | AI 요약 포함 시장 뉴스 브리핑 |
| 7 | **naverstock-skill** | **네이버 파이낸스 KRX/해외 주가 (유일한 한국 스킬)** |

#### B. 개인 재무/예산 관리 (8개)
| # | 스킬명 | 기능 |
|---|--------|------|
| 8 | ynab | YNAB 예산/계좌/거래 관리 |
| 9 | watch-my-money | 은행 거래 분석, 지출 분류, 월별 예산 추적 |
| 10 | expense-tracker-pro | 자연어 지출 추적, 예산 설정 |
| 11 | finance-tracker | 완전한 개인 재무 관리 (다중 통화 지원) |
| 12 | expense-report | 비즈니스 경비 정리/분류/요약 |
| 13 | vehicle-tracker | 차량 경비 Google Sheets 추적 |
| 14 | just-fucking-cancel | 은행 거래 분석으로 구독 취소 |
| 15 | nordpool-fi | 핀란드 시간별 전기 가격/EV 충전 최적화 |

#### C. 회계/세금 (4개)
| # | 스킬명 | 기능 |
|---|--------|------|
| 16 | xero | Xero 회계 연동 (인보이스, 연락처, 은행거래) |
| 17 | plaid | Plaid 금융 플랫폼 CLI (계좌 연결) |
| 18 | tax-professional | 미국 세금 어드바이저/공제 최적화 |
| 19 | solo-cli | SOLO.ro 루마니아 회계 플랫폼 |

#### D. 기타/관련 분류 (14개)
| # | 스킬명 | 기능 |
|---|--------|------|
| 20-33 | analytics-tracking, api-credentials-hygiene, publisher, relationship-skills, create-content, swissweather, harvey, openssl, md-slides, idea, clawdbot-release-check, regex-writer, regex-gen, app-store-changelog | 금융 직접 관련 아님 (카테고리 혼재) |

### 핵심 발견: 실제 금융 기능 스킬은 19개에 불과
33개 중 14개는 금융과 직접 관련 없는 유틸리티/기타 스킬이 잘못 분류됨.

---

## 4. 한국 금융 스킬 공백 분석

### 현존하는 한국 금융 스킬: 1개
- **naverstock-skill**: 네이버 파이낸스 기반 KRX/해외 실시간 주가 조회

### 완전한 공백 영역 (존재하지 않는 스킬)

| 공백 영역 | 세부 | 시장 수요 |
|-----------|------|----------|
| **김치프리미엄 모니터링** | 5대 거래소(업비트/빗썸/코인원/빗파/바이낸스) 가격 비교, 실시간 프리미엄 계산 | **매우 높음** — 한국 크립토 시장 핵심 지표 |
| **크로스보더 아비트리지** | KRW-USD-BTC 삼각 아비트리지 기회 탐색 | 높음 |
| **KOSPI/KOSDAQ 데이터** | 종합지수, 업종별, 시가총액, 거래량 | 높음 |
| **외인/기관 수급** | 외국인/기관 순매수도, 프로그램 매매 동향 | 높음 |
| **KRX 공시** | DART 기업 공시 데이터 실시간 조회 | 중간 |
| **한국 금리/환율** | 한국은행 기준금리, USD/KRW 환율 | 중간 |
| **한국 부동산** | KB시세, 실거래가 | 중간 |
| **KRW 스테이블코인** | USDT→KRW 라우팅 경로 최적화 | 중간 |

### 경쟁 환경
- 일본 금융 스킬: 0개
- 대만 금융 스킬: 1개 (Taiwan Financial Trading API)
- 중국 금융 스킬: 0개 (규제 이슈)
- **아시아 금융 전체가 블루오션**

---

## 5. CrossFin 스킬 3개 등록 시나리오

### 스킬 A: crossfin-korea-crypto

```
이름: crossfin-korea-crypto
태그라인: "Korean crypto exchange data, kimchi premium & arbitrage signals"
카테고리: Finance
가격: Freemium (기본 무료 / 프리미엄 x402 과금)
```

**기능 범위:**
- 5대 한국 거래소 실시간 시세 (Upbit, Bithumb, Coinone, Korbit, Gopax)
- 김치프리미엄 실시간 계산 (KRW/USD 환율 반영)
- BTC/ETH/XRP 등 주요 코인 크로스 거래소 스프레드
- 아비트리지 기회 알림 (임계값 설정 가능)
- 거래소별 거래량/유동성 비교

**차별화 포인트:**
- ClawHub에 한국 크립토 스킬 **0개** → first-mover
- ClawHavoc 이후 "검증된 금융 스킬" 수요 급증
- 한국 크립토 트레이더 활동량 세계 3위

**수익 모델:**
- Free tier: 주요 코인 5개, 5분 딜레이
- Premium (x402): 전 코인, 실시간, 아비트리지 시그널 → $0.005/call

---

### 스킬 B: crossfin-korea-market

```
이름: crossfin-korea-market
태그라인: "KOSPI, KOSDAQ, institutional flow & market intelligence for Korea"
카테고리: Finance
가격: Freemium
```

**기능 범위:**
- KOSPI/KOSDAQ 지수, 업종별 지수
- 종목별 주가/차트/거래량
- 외국인/기관 순매수도 실시간
- 프로그램 매매 동향
- DART 주요 공시 요약
- 시가총액 상위 종목 랭킹

**차별화 포인트:**
- 기존 naverstock-skill은 단순 주가 조회만 가능
- 외인/기관 수급은 한국 시장 고유 핵심 데이터
- DART 공시 연동은 어디에도 없음

**수익 모델:**
- Free tier: 지수 + 상위 10개 종목
- Premium (x402): 전 종목, 수급 데이터, 공시 → $0.003/call

---

### 스킬 C: crossfin-route-finder

```
이름: crossfin-route-finder
태그라인: "Optimal cross-border payment routing across 50+ providers"
카테고리: Finance
가격: Premium only (x402)
```

**기능 범위:**
- 50개+ 결제/송금 제공자 실시간 환율/수수료 비교
- 최적 경로 추천 (비용, 속도, 신뢰도 가중)
- KRW↔USD, KRW↔JPY, KRW↔PHP 등 아시아 코리더
- 스테이블코인 경유 경로 포함 (USDT, USDC)
- 은행/핀테크/크립토 하이브리드 라우팅

**차별화 포인트:**
- ClawHub 전체에 결제 라우팅 스킬 **0개**
- 에이전트가 자율적으로 최적 송금 경로를 선택하는 유스케이스
- x402 네이티브 과금 → 에이전트 경제에 자연스럽게 통합

**수익 모델:**
- Premium only: $0.01/call (라우팅 엔진 호출 비용 반영)
- 수수료 리퍼럴 가능 (결제 제공자와 파트너십)

---

## 6. x402 Per-Call 수익 예상

### 전제 가정

| 항목 | 보수적 | 중간 | 낙관적 |
|------|--------|------|--------|
| OpenClaw 월간 활성 에이전트 | 50,000 | 150,000 | 500,000 |
| 금융 스킬 사용 비율 | 2% | 5% | 10% |
| 한국/아시아 관심 비율 | 5% | 10% | 15% |
| 에이전트당 일일 호출 수 | 10 | 30 | 100 |

### x402 프로토콜 단가 참고
- CoinGecko API: $0.01 USDC/request
- 일반 데이터 API: $0.001~$0.01/request
- CrossFin 타겟: $0.003~$0.01/request

### 스킬별 월간 수익 예상

#### crossfin-korea-crypto ($0.005/call)
| 시나리오 | 대상 에이전트 | 일일 호출 | 월간 호출 | 월간 수익 |
|----------|-------------|----------|----------|----------|
| 보수적 | 50 | 500 | 15,000 | $75 |
| 중간 | 750 | 22,500 | 675,000 | $3,375 |
| 낙관적 | 7,500 | 750,000 | 22,500,000 | $112,500 |

#### crossfin-korea-market ($0.003/call)
| 시나리오 | 대상 에이전트 | 일일 호출 | 월간 호출 | 월간 수익 |
|----------|-------------|----------|----------|----------|
| 보수적 | 50 | 500 | 15,000 | $45 |
| 중간 | 750 | 22,500 | 675,000 | $2,025 |
| 낙관적 | 7,500 | 750,000 | 22,500,000 | $67,500 |

#### crossfin-route-finder ($0.01/call)
| 시나리오 | 대상 에이전트 | 일일 호출 | 월간 호출 | 월간 수익 |
|----------|-------------|----------|----------|----------|
| 보수적 | 25 | 125 | 3,750 | $37.50 |
| 중간 | 375 | 5,625 | 168,750 | $1,687.50 |
| 낙관적 | 3,750 | 187,500 | 5,625,000 | $56,250 |

### 3개 스킬 합산 월간 수익
| 시나리오 | 월간 합산 | 연간 환산 |
|----------|----------|----------|
| **보수적** | **$157.50** | **$1,890** |
| **중간** | **$7,087.50** | **$85,050** |
| **낙관적** | **$236,250** | **$2,835,000** |

> 참고: ClawHub 유료 스킬은 30% 플랫폼 수수료가 있으나, x402 직접 과금 시 플랫폼 수수료 없이 100% 수취 가능.

---

## 7. 전략적 권고사항

### 즉시 실행 (1-2주)
1. **clawhub.ai 개발자 계정 생성** — 기존 GitHub 계정으로 즉시 가능
2. **crossfin-korea-crypto 우선 등록** — 가장 수요가 크고 CrossFin 기존 기능과 직결
3. **무료 버전으로 시작** — 사용자 확보 후 x402 프리미엄 추가

### 단기 (1개월)
4. **crossfin-korea-market 등록** — 주식 시장 데이터로 커버리지 확대
5. **VirusTotal 스캐닝 사전 준비** — 코드 보안 감사 통과 보장
6. **ClawHavoc 이후 "Verified Finance Skill" 포지셔닝** — 보안 검증 강조

### 중기 (2-3개월)
7. **crossfin-route-finder 등록** — 라우팅 엔진 x402 과금 시작
8. **x402 Facilitator 연동** — Base/USDC 결제 인프라 구축
9. **Kimi Claw 통합** — Moonshot AI의 ClawHub 연동 (중국 시장 접근)

### 핵심 기회 요약
- **한국 금융 특화 스킬 사실상 0개** → 선점 효과 극대화
- **ClawHavoc 이후 신뢰할 수 있는 금융 스킬 갈증** → 타이밍 최적
- **x402 네이티브 과금** → 에이전트 경제에 자연스러운 수익 모델
- **OpenAI acqui-hire** → OpenClaw 생태계 장기 성장 보장

---

## 참고 출처

- [OpenClaw GitHub](https://github.com/openclaw/openclaw) — 195K+ stars
- [ClawHub 공식](https://clawhub.ai/) — 스킬 마켓플레이스
- [ClawHub 등록 가이드](https://www.openclawexperts.io/guides/custom-dev/how-to-publish-a-skill-to-clawhub)
- [ClawHavoc 보안 사건](https://www.koi.ai/blog/clawhavoc-341-malicious-clawedbot-skills-found-by-the-bot-they-were-targeting)
- [Oh My OpenClaw Finance](https://ohmyopenclaw.ai/category/finance/) — 33개 금융 스킬 목록
- [x402 프로토콜](https://www.x402.org/) — 에이전트 결제 표준
- [OpenClaw + OpenAI Acqui-hire](https://www.llmrumors.com/news/openclaw-openai-acquihire-agent-race)
- [ClawHub Developer Guide 2026](https://www.digitalapplied.com/blog/clawhub-skills-marketplace-developer-guide-2026)
- [OpenClaw 1.5M 에이전트 분석](https://www.missioncloud.com/blog/openclaw-explained-how-1.5m-ai-agents-built-a-religion-crypto-economy-and-escaped-control)
- [Stripe x402 USDC 통합](https://www.theblock.co/post/389352/stripe-adds-x402-integration-usdc-agent-payments)
