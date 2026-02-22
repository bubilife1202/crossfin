# 경쟁사 실제 매출 모델 심층 분석

> 조사일: 2026-02-21

---

## 1. Firecrawl

### 회사 개요
- 웹 스크래핑/데이터 추출 API (AI용)
- Y Combinator 출신, 2025년 8월 Series A $14.5M (Nexus Venture Partners 리드)
- 직원 ~10명, 사용자 350,000+

### 실제 매출
| 지표 | 수치 |
|------|------|
| 2024년 매출 | **$1.5M** |
| YoY 성장 | **15x** (전년 대비) |
| 2025년 매출 추정 | **$5-10M ARR** (15x 성장 트렌드 기반) |

### 가격 체계 (전통 SaaS)
| 플랜 | 월 가격 (연납) | 크레딧/월 | 크레딧당 비용 |
|------|---------------|-----------|--------------|
| Free | $0 | 500 (일회) | - |
| Hobby | $16 | 3,000 | ~$0.005 |
| Standard | $83 | 100,000 | ~$0.0008 |
| Growth | $333 | 500,000 | ~$0.0007 |
| Scale | $599 | 1,000,000 | ~$0.0006 |
| Enterprise | Custom | Custom | 협의 |

### x402 실험
- **엔드포인트**: `https://api.firecrawl.dev/v1/x402/search`
- **가격**: $0.01 USDC/검색 (온체인 결제)
- **특징**: API 키 불필요, 지갑만 있으면 즉시 사용
- **현황**: 실험적 단계, 매출 기여도는 미미할 것으로 추정
- **의미**: 기존 SaaS와 병행하는 "에이전트 친화적" 채널 확보

### 돈이 되는 것
- **Standard ($83/월)** 플랜이 "Most Popular" -- 대부분의 매출은 SaaS 구독
- 크레딧 초과 사용 추가 과금이 주요 업셀 메커니즘
- AI 데이터 파이프라인용 웹 스크래핑이 핵심 가치
- x402는 아직 마케팅/PoC 단계

---

## 2. Apexti Toolbelt

### 회사 개요
- 2,000+ 호스팅 도구, 1,500+ Web3 API 제공
- MCP Bridge로 AI 에이전트 연결
- 2023년 2월 Series A $8.5M 유치

### 매출 모델
| 지표 | 상태 |
|------|------|
| 가격 공개 | **비공개** (Book a demo 모델) |
| 호출당 비용 | 추정 ~$0.02/call (x402 기반) |
| 월 매출 | **비공개** (추정 어려움) |

### 분석
- 가격 정보를 철저히 비공개 -- 엔터프라이즈 세일즈 모델 시사
- x402 프로토콜 생태계에 참여 (awesome-x402 목록에 등재)
- MCP (Model Context Protocol) 서버 빌더 제공 -- AI 에이전트 인프라에 집중
- **실제 거래량은 알 수 없음** -- 아직 초기 단계로 추정
- Web3 데이터 인덱싱 + API 호스팅이 핵심 비즈니스

### 돈이 되는 것 (추정)
- 엔터프라이즈 계약 (기관 고객 대상)
- API 호출 볼륨 기반 과금
- MCP 인프라 서비스 (에이전트가 도구에 접근하는 게이트웨이)

---

## 3. CryptoQuant

### 회사 개요
- 한국 기반 온체인 분석 SaaS (CEO: 주기영)
- **$9.44M 펀딩** (Series A $6.44M, 2023년 6월)
- 직원 64명
- 사용자: 트레이더 1M+, 기관 고객 150+
- Bloomberg, CNBC, CoinDesk가 데이터 인용

### 실제 매출
| 지표 | 수치 |
|------|------|
| 2023년 매출 | **$8M** |
| 직원당 매출 | ~$125K/년 |
| 기관 고객 | 150+ (은행, 프롭, 마켓메이커, 헤지펀드) |

### 가격 체계
| 플랜 | 월 가격 | 연납 가격/월 | 핵심 기능 |
|------|---------|-------------|-----------|
| Free | $0 | - | 기본 차트, 제한된 데이터 |
| Advanced | $39 | $29 | Pro 차트, 알림 5개, 전체 히스토리 |
| Professional | $109 | $99 | API (24H 해상도), 알림 20개 |
| Enterprise | $799 | $699 | 전용 API, 커스텀 데이터, SLA |

### 매출 구조 분석
- **Enterprise ($699-799/월)**: 150+ 기관 고객 x $699/월 = **~$1.26M/년** (최소)
- **Professional ($99-109/월)**: 추정 수천 명 트레이더
- **Advanced ($29-39/월)**: 대중 개인 투자자
- **Data Licensing**: Bloomberg, CME Group 등에 데이터 공급 (별도 계약)

### 돈이 되는 데이터
1. **거래소 플로우 데이터** -- 어떤 거래소에 BTC가 입출금되는지 (고래 추적)
2. **마이너 관련 지표** -- 해시레이트, 마이너 수익, 마이닝 난이도
3. **UTXO 기반 분석** -- 실현 손익, SOPR, MVRV 등
4. **기관용 커스텀 리포트** -- 가장 마진이 높은 상품
5. **CME Group 데이터 제공** -- 파생상품 시장과 연계

### CrossFin 관련 시사점
- 한국 CEO, 한국 기반이지만 글로벌 매출
- "온체인 데이터 + 독자적 지표"가 핵심 차별화
- 기관 고객이 매출의 핵심 (150+ 기관)
- $8M을 64명으로 달성 -- 효율적인 운영

---

## 4. Nansen

### 회사 개요
- 온체인 분석 플랫폼 (스마트 머니 추적 특화)
- **$88.2M 펀딩** (Series B $75M, a16z/Accel)
- 기업 가치 **$750M**
- 500M+ 라벨링된 지갑 주소, 30+ 블록체인 커버
- $2B+ 관리 자산(AUM) 추적

### 실제 매출
| 지표 | 수치 |
|------|------|
| 2022년 매출 | **$7.7M** |
| 2023년 매출 | **$11.9M** |
| YoY 성장 | ~55% |
| 2024-25년 매출 | **비공개** (추정 $15-20M) |

### 가격 체계 (2025년 9월 개편)
| 플랜 | 가격 | 변경사항 |
|------|------|---------|
| Free | $0 | 기본 기능, 0.25% 트레이딩 수수료 |
| Pro | $49/월 (연납) 또는 $69/월 | Pioneer($129) + Professional($999) 통합 |

- **62% 가격 인하** (기존 Pioneer 대비)
- **95% 가격 인하** (기존 Professional 대비)

### API 크레딧 시스템
| 엔드포인트 | 크레딧/호출 |
|-----------|------------|
| 주소 트랜잭션 조회 | 0 (무료) |
| 카운터파티 분석 | 5 |
| 토큰 스크리너 | 5 |
| 고급 알파 데이터 | 더 높은 크레딧 |

- Flexi-credit: 필요한 만큼 구매
- $10,000+ 벌크 구매시 할인 (세일즈팀 상담)
- **기본 데이터는 저렴하게, 알파 생성 데이터는 비싸게** -- 가치 기반 가격

### 매출 구조 변화
- 2025년 대폭 가격 인하 = **볼륨 확대 전략**으로 전환
- 기존: 소수 고가 구독자 -> 현재: 대중화 + 트레이딩 수수료
- **새 수익원**: Pro Trading (0.10% 수수료, Free는 0.25%)
- 크립토 지갑 + 트레이딩 통합 = 플랫폼 비즈니스로 진화

### 한국 시장 커버리지
- 한국 거래소 (업비트, 빗썸 등) 데이터 포함
- 한국어 지원은 제한적
- 한국 기관 고객 별도 확인 불가

---

## 5. 공통 패턴 분석

### 돈 되는 API vs 안 되는 API

| 돈 되는 API | 안 되는 API |
|------------|------------|
| 독자적 가공 데이터 (라벨링, 지표) | 원시 블록체인 데이터 (노드 직접 조회 가능) |
| 실시간 알파 (고래 움직임, 스마트머니) | 지연된 시세 데이터 (무료 대안 다수) |
| 기관급 SLA + 전용 인프라 | 불안정한 무료 API |
| 크로스체인 통합 데이터 | 단일 체인 기본 데이터 |
| AI/에이전트 최적화 포맷 | 레거시 REST 단순 응답 |

### "무료로 얻을 수 없는 데이터"의 조건

1. **가공/라벨링된 데이터**: Nansen의 500M+ 라벨링 지갑, CryptoQuant의 독자 지표
   - 원시 데이터는 무료, 가공에 가치가 있음
2. **실시간 + 신뢰성**: SLA 보장, 99.9% 업타임
   - 무료 API는 rate limit, 불안정, 느림
3. **교차 분석**: 거래소 + 온체인 + 소셜 통합
   - 여러 소스를 합치는 데 비용과 시간이 듬
4. **역사적 데이터 깊이**: 5-10년 히스토리, 고해상도
   - 무료 소스는 보통 최근 데이터만 제공
5. **커스텀 지표/알림**: 특정 조건 모니터링
   - 직접 구축하면 인프라 비용 + 개발 시간

### 매출 모델별 비교

| 회사 | 주 매출원 | 추정 ARR | 팀 규모 | ARR/인당 |
|------|----------|---------|---------|---------|
| Firecrawl | SaaS 구독 + 크레딧 초과 | $5-10M | 10명 | $500K-1M |
| CryptoQuant | SaaS 구독 + 기관 라이선스 | $8-10M | 64명 | $125-156K |
| Nansen | SaaS 구독 -> 플랫폼(트레이딩) | $15-20M | 170명 | $88-118K |
| Apexti | 엔터프라이즈 + API 호출 | 불명 | 불명 | 불명 |

### 가격 전략 트렌드

1. **x402 미시결제**: Firecrawl, CoinGecko 모두 $0.01/call -- 에이전트 시장 선점
2. **크레딧 기반**: Firecrawl, Nansen -- 사용량 기반이지만 선불 구조
3. **가치 기반 차등**: Nansen -- 기본 데이터 무료, 알파 데이터 고가
4. **대폭 가격 인하 + 플랫폼화**: Nansen이 95% 인하 후 트레이딩 수수료로 전환

---

## 6. CrossFin에 적용할 수 있는 교훈

### 즉시 적용 가능한 전략

1. **가공 데이터에 집중**: 김치프리미엄, 한국 거래소 특화 지표 등 "무료로 얻기 어려운" 데이터
2. **x402 조기 도입**: $0.01/call은 이미 업계 표준 가격대 형성 중
3. **기관 고객 확보가 핵심**: CryptoQuant 매출의 핵심은 150+ 기관
4. **효율적 팀 운영**: Firecrawl은 10명으로 $1.5M -> 추정 $5-10M

### CrossFin의 차별화 포인트

| 기존 경쟁사가 약한 영역 | CrossFin 기회 |
|----------------------|-------------|
| 한국 거래소 실시간 데이터 | 업비트/빗썸 API 래핑 + 독자 지표 |
| 김치프리미엄 실시간 추적 | 한국 시장만의 독특한 데이터 |
| KRW 환율 연동 분석 | 원화 기반 크로스보더 가격 비교 |
| 한국 규제/뉴스 반영 | 한국어 NLP 기반 감성 분석 |
| MCP 네이티브 한국 금융 | AI 에이전트 시장 선점 |

### 가격대 벤치마크 (CrossFin 참고)

| 티어 | 추천 가격대 | 근거 |
|------|-----------|------|
| Free | $0 | CryptoQuant/Nansen 모두 Free 제공 |
| Starter | $19-29/월 | CryptoQuant Advanced($29) 수준 |
| Pro | $49-99/월 | Nansen Pro($49), CryptoQuant Professional($99) 사이 |
| Enterprise | $299-699/월 | CryptoQuant Enterprise($699) 대비 한국 특화로 경쟁력 |
| x402 호출 | $0.005-0.01/call | Firecrawl/CoinGecko 표준($0.01) 수준 |

### 핵심 메시지

> **"원시 데이터는 무료다. 가공, 라벨링, 실시간 신뢰성, 크로스 분석에 돈을 낸다."**
>
> CrossFin이 수익화하려면:
> 1. 한국 금융 시장의 "무료로 얻기 어려운" 가공 데이터를 만들고
> 2. x402로 에이전트 시장에 선제 진입하며
> 3. 기관 고객(한국 크립토 헤지펀드, 프롭, 트레이딩 데스크)을 확보해야 한다

---

## Sources

- [Firecrawl Pricing](https://www.firecrawl.dev/pricing)
- [Firecrawl x402 Case Study - Coinbase](https://www.coinbase.com/developer-platform/discover/case-studies/firecrawl)
- [Firecrawl Revenue Data - GetLatka](https://getlatka.com/companies/firecrawl.dev)
- [Firecrawl Series A - TechCrunch](https://techcrunch.com/2025/08/19/ai-crawler-firecrawl-raises-14-5m-is-still-looking-to-hire-agents-as-employees/)
- [Apexti Toolbelt](https://apexti.com/toolbelt)
- [Apexti Crunchbase](https://www.crunchbase.com/organization/apexti)
- [CryptoQuant Pricing](https://cryptoquant.com/pricing)
- [CryptoQuant Revenue - GetLatka](https://getlatka.com/companies/cryptoquant.com/team)
- [CryptoQuant Review - CaptainAltcoin](https://captainaltcoin.com/cryptoquant-review/)
- [Nansen Pricing](https://academy.nansen.ai/articles/0414043-new-pricing-explained)
- [Nansen API Credits](https://docs.nansen.ai/about/credits-and-pricing-guide)
- [Nansen Revenue - GetLatka](https://getlatka.com/companies/nansen)
- [CoinGecko x402 - Coinbase](https://www.coinbase.com/en-fr/developer-platform/discover/launches/coingecko-x402)
- [x402 Protocol Ecosystem](https://www.x402.org/ecosystem)
