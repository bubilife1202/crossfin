# Apify Store 등록 프로세스 & 한국 데이터 Actor 기회 분석

> 조사일: 2026-02-21 | CrossFin 수익화 리서치 #2

---

## 1. Apify Store 등록 절차

### 1.1 계정 및 준비

1. **Apify 계정 생성** -- apify.com 무료 가입
2. **Creator Plan 가입** -- $1/월, 처음 6개월간 $500 상당 플랫폼 크레딧 제공
3. **Actor 개발** -- Apify SDK(Node.js/Python)로 Actor 코드 작성
4. **로컬/클라우드 테스트** -- Apify CLI로 빌드 및 테스트

### 1.2 퍼블리싱 프로세스

1. **Apify Console > Publication > Display Information** 진입
2. 필수 항목 작성:
   - **아이콘** -- 고유 이미지 (타사 로고 사용 금지, 상표 이슈)
   - **Actor 이름** -- 검색 최적화된 명확한 이름
   - **설명(Description)** -- 간결한 기능 요약
   - **카테고리** -- 적합한 카테고리 선택
   - **SEO 타이틀** (40-50자) & **SEO 설명** (140-156자)
3. **README.md 작성** -- 최소 300단어, 6개 섹션 권장
   - 기능 설명, 사용 이유, 설정 방법, 입출력 스키마, 예제, FAQ
4. **"Publish to Store" 버튼 클릭** -- 모든 필드 완성 시 활성화
5. **리뷰** -- Apify 팀의 자동/수동 검토 (별도의 길고 복잡한 심사 프로세스는 없음)
6. **Apify Store 검색에서 확인** -- 퍼블리싱 즉시 노출

### 1.3 핵심 체크리스트

| 항목 | 세부 |
|------|------|
| README | 최소 300단어, 명확하고 비개발자도 이해 가능 |
| SEO | 키워드 최적화된 타이틀/설명 필수 |
| 테스트 | 안정적 동작 확인 후 퍼블리싱 |
| 마케팅 | 소셜미디어 공유, 튜토리얼 제작 권장 |

**평가: 진입 장벽 매우 낮음.** 별도의 개발자 심사나 복잡한 승인 프로세스 없이, 코드만 준비되면 당일 퍼블리싱 가능.

---

## 2. Apify Store 수수료 구조

### 2.1 수익 배분

| 모델 | 개발자 수익 | Apify 수수료 |
|------|-----------|-------------|
| Pay Per Result (PPR) | 80% of revenue - 플랫폼 사용 비용 | 20% + 플랫폼 비용 |
| Pay Per Event (PPE) | 80% of revenue - 플랫폼 사용 비용 | 20% + 플랫폼 비용 |
| Rental (월정액) | 80% of 구독료 | 20% |
| Pay Per Usage | 플랫폼 사용 비용 기반 | 플랫폼 마진 |

### 2.2 플랫폼 사용 비용 (PPR 기준)

- Compute Units: $0.3/CU
- Residential Proxies: $13/GB
- SERP Proxies: $3/1,000 SERPs
- Data Transfer: $0.20/GB
- Dataset Storage: $1/1,000 GB-hours

### 2.3 수익 계산 예시

**PPR 예시:** 2명의 유저가 각각 50,000건, 20,000건 결과를 요청 ($1/1,000건)
- 총 매출: $70
- 플랫폼 비용: $7
- **개발자 수익: 0.8 x $70 - $7 = $49**

**Rental 예시:** $30/월 구독
- **개발자 수익: $30 x 0.8 = $24/월/유저**

### 2.4 추가 혜택

- **Creator Plan**: $1/월, 6개월간 $500 크레딧 제공
- **퍼블리싱 무료** -- 수익이 발생하지 않으면 비용 없음
- **수익화 설정 변경**: 14일 대기 후 적용, 월 1회 변경 가능

---

## 3. 현재 한국 관련 Actor 목록

### 3.1 네이버 관련

| Actor 이름 | 개발자 | 가격 | 사용자 | 평점 |
|-----------|--------|------|--------|------|
| Naver Shopping Product Scraper | delicious_zebu | $30/월 + 사용료 | 4명 MAU | 4.9 (24) |
| KR Naver Stores Scraper | styleindexamerica | 무료/사용량 | - | - |
| Naver Map Search Results Scraper | delicious_zebu | - | - | - |
| Naver Blog Scraper | astronomical_lizard | - | - | - |
| Naver Keyword Scraper | billygogo | - | - | - |

### 3.2 쿠팡 관련

| Actor 이름 | 개발자 | 가격 | 사용자 | 비고 |
|-----------|--------|------|--------|------|
| Coupang Scraper | fatihtahta | $4/1,000건 | - | 검색/카테고리/상품 페이지 |
| Coupang Products Crawler | amit123 | $7.99/1,000건 | 12명 MAU | 131 북마크 |

### 3.3 기타 한국 플랫폼

- **Kakao Reviews Scraper** -- 카카오 선물하기 리뷰 추출

### 3.4 핵심 발견

- **한국 금융/크립토 Actor: 전무** -- 업비트, 빗썸, 코인원, 네이버 금융, KOSPI/KOSDAQ 관련 Actor 없음
- 한국 관련 Actor는 주로 이커머스(네이버 쇼핑, 쿠팡)에 집중
- 사용자 수가 전반적으로 낮음 (4~12 MAU) -- 니치 시장이지만 경쟁도 적음
- **CrossFin의 한국 금융 데이터는 완전한 블루오션**

---

## 4. 금융/크립토 Actor 현황

### 4.1 글로벌 크립토 Actor

| Actor 이름 | 데이터 소스 | 가격 | 특징 |
|-----------|-----------|------|------|
| CoinMarketCap Crypto Scraper | CoinMarketCap | ~$5/월 (사용량) | 가격, 시가총액, 거래량 |
| CoinGecko Scraper | CoinGecko | 사용량 기반 | 랭킹, 가격, 마켓캡 |
| Crypto Data Scraper | KuCoin | 사용량 기반 | OHLCV, 실시간 가격 |
| CoinMarketCap Historical Prices | CoinMarketCap | 사용량 기반 | 히스토리컬 데이터 |
| CoinMarketCap New Listing Scraper | CoinMarketCap | - | 신규 상장 코인 |

### 4.2 글로벌 주식/금융 Actor

| Actor 이름 | 데이터 소스 | 가격 | 특징 |
|-----------|-----------|------|------|
| Stock Market Data Scraper | Yahoo Finance | 사용량 기반 | 재무 데이터, 히스토리컬 |
| Google Finance API | Google Finance | 사용량 기반 | 실시간 주가, 환율 |
| Stock Earnings | Investing.com | 사용량 기반 | 어닝스 데이터 |
| Investing.com News Scraper | Investing.com | 사용량 기반 | 금융 뉴스 |
| Stock Exchange Scraper | (요청 상태) | - | 아이디어 단계 |

### 4.3 한국 금융/크립토 Actor

**현재 0개.** Apify Store에 한국 거래소(업비트, 빗썸, 코인원, 코빗, 고팍스) 또는 한국 주식 시장(KOSPI, KOSDAQ, 네이버 금융) 데이터를 제공하는 Actor가 단 하나도 없음.

---

## 5. "Korea Crypto Intelligence" Actor 수익 예상

### 5.1 제안 Actor 라인업

CrossFin의 기존 API를 Apify Actor로 래핑:

| Actor 이름 | 데이터 | 가격 모델 | 예상 가격 |
|-----------|--------|----------|----------|
| Korea Crypto Exchange Aggregator | 업비트+빗썸+코인원+코빗+고팍스 | PPR | $3/1,000건 |
| Kimchi Premium Tracker | 한국-글로벌 김프 실시간 | PPE | $0.01/조회 |
| Korea Stock Market Scraper | KOSPI/KOSDAQ/네이버 금융 | PPR | $5/1,000건 |
| Korean Crypto Orderbook | 5개 거래소 오더북 통합 | PPE | $0.005/스냅샷 |
| Korea Financial News Feed | 네이버 금융 뉴스 | PPR | $2/1,000건 |

### 5.2 수익 시나리오

**보수적 시나리오 (6개월 후)**
- 월 활성 사용자: 20~50명
- 평균 사용료: $30/월/유저
- 총 매출: $600~$1,500/월
- Apify 수수료 후 순수익: **$400~$1,000/월**

**낙관적 시나리오 (12개월 후)**
- 월 활성 사용자: 100~200명
- 평균 사용료: $50/월/유저
- 총 매출: $5,000~$10,000/월
- Apify 수수료 후 순수익: **$3,500~$7,000/월**

**근거:**
- Naver Shopping Scraper가 4 MAU에 $30/월 -- 훨씬 작은 니치
- CoinMarketCap 스크레이퍼는 ~$5/월이지만 한국 특화 데이터 없음
- 한국 크립토 시장은 글로벌 거래량의 10~15% 차지 (매우 큰 시장)
- 김치 프리미엄은 글로벌 트레이더들의 관심 지표
- **완전한 블루오션** -- 직접 경쟁자 0개

### 5.3 추가 수익원

- Apify Store 노출 -> CrossFin 유료 API 업셀 파이프라인
- Actor 사용자를 CrossFin MCP 서버 / SDK 유저로 전환
- 한국 시장 진출을 원하는 글로벌 트레이딩 봇/알고 트레이더 타겟

---

## 6. Apify $1M Challenge 참가 가능성

### 6.1 챌린지 현황

- **기간**: 2025년 11월 ~ 2026년 1월 (이미 종료)
- **참가자**: 704명의 개발자, 3,329개 Actor 제출, 1,086개 자격 충족
- **대상**: 1등 $30,000, 2등 $20,000, 3등 $10,000
- **주간 스포트라이트**: 매주 $2,000 (10주간)
- **사용자 기반 보상**: Actor당 최대 $2,000, 개인당 최대 $10,000

### 6.2 우승자

| 순위 | 개발자 | 상금 |
|------|--------|------|
| 1위 | SIAN OU (sian.agency) | $30,000 |
| 2위 | John (johnvc) | $20,000 |
| 3위 | HappiTap (happitap) | $10,000 |

### 6.3 CrossFin 관점

- **현재 챌린지는 종료됨** -- 직접 참가 불가
- **향후 챌린지 가능성 높음** -- Apify가 $500K+/월 개발자 지급 중이며 생태계 확장 중
- **지금 Actor를 등록해두면 다음 챌린지에 유리한 위치 선점**
- 챌린지 없이도 Store 노출 자체가 가치 있음 (50,000+ 월간 사용자)

---

## 7. Top Apify Actor 실제 월 수입 사례

### 7.1 플랫폼 전체 통계

- **Apify 월간 개발자 지급 총액**: $500,000+
- **톱 개발자 수입**: $10,000+/월 MRR
- **많은 개발자**: $1,000~$3,000/월
- **플랫폼 총 사용자**: 50,000+ MAU

### 7.2 ParseForge 사례 (가장 상세한 공개 사례)

- **124개 Actor 퍼블리싱** (6개월간)
- **1,900명 사용자** 확보
- **첫 번째 Actor 수입**: ~$1,000/월 MRR (부동산 매물 스크레이퍼)
- **최대 단건 수입**: $8,000 (한 고객이 전체 DB 스크레이핑)
- **생산 속도**: 주니어 4개/주, 시니어 5개/주 = 13+ Actor/주
- **목표**: 2027년까지 1,000개 Actor
- **전략**: "Actor Factory" 시스템 -- 24시간 내 컨셉→퍼블리싱

### 7.3 주요 Actor 수입 추정

| Actor 카테고리 | 대표 예시 | 사용자 | 추정 월 수입 |
|-------------|---------|--------|------------|
| Google Maps Scraper | apify/google-maps | 270,000+ | $50,000+/월 (추정) |
| 소셜미디어 스크레이퍼 | TikTok/Instagram | 수만명 | $10,000~$30,000/월 |
| 이커머스 스크레이퍼 | Amazon/Shopify | 수천명 | $5,000~$15,000/월 |
| 크립토 스크레이퍼 | CoinMarketCap | 수백명 | $500~$2,000/월 |
| 한국 관련 | Naver Shopping | 4~12명 | $100~$500/월 |

### 7.4 수익 극대화 전략 (검증된 패턴)

1. **First-mover advantage** -- 특정 플랫폼의 첫 Actor가 SEO와 사용자 충성도에서 압도적 유리
2. **다수 Actor 전략** -- ParseForge처럼 관련 Actor를 대량 퍼블리싱
3. **AI 도구 확장** -- 순수 스크레이퍼 외에 AI 기반 분석 도구로 비개발자 타겟
4. **MCP 서버 제공** -- $1M Challenge에서 MCP 서버가 주요 카테고리였음

---

## 8. CrossFin 실행 권고

### 8.1 즉시 실행 (1~2주)

1. **Apify Creator Plan 가입** ($1/월)
2. **Korea Crypto Exchange Aggregator Actor** 개발 (기존 API 래핑)
3. **Kimchi Premium Tracker Actor** 개발
4. PPR 모델로 $3~5/1,000건 가격 설정
5. Store 퍼블리싱 및 SEO 최적화

### 8.2 단기 (1~3개월)

6. Korea Stock Market Scraper (KOSPI/KOSDAQ) Actor 추가
7. Korean Crypto Orderbook Actor 추가
8. Korea Financial News Feed Actor 추가
9. CrossFin MCP Server를 Apify Actor로도 제공

### 8.3 중기 (3~6개월)

10. 사용자 피드백 기반 Actor 개선
11. Rental 모델 추가 (월정액 $29~$49)
12. Actor 사용자 -> CrossFin Pro API 업셀 파이프라인 구축
13. 다음 Apify 챌린지/이벤트 참가 준비

### 8.4 예상 투자 vs 수익

| 항목 | 비용 |
|------|------|
| Creator Plan | $1/월 |
| 개발 시간 | 1~2주 (기존 API 래핑) |
| 플랫폼 비용 | 크레딧으로 6개월 커버 |
| **총 초기 투자** | **거의 $0** |

| 기간 | 예상 월 수익 |
|------|------------|
| 3개월 후 | $200~$500 |
| 6개월 후 | $500~$2,000 |
| 12개월 후 | $2,000~$7,000 |

### 8.5 전략적 가치

- **비용 거의 제로**로 신규 유통 채널 확보
- **한국 금융 데이터 Actor 시장 선점** (First-mover)
- CrossFin 브랜드 노출 (50,000+ Apify MAU)
- API 업셀 파이프라인 (Actor -> Pro API 전환)
- MCP 서버 배포 채널 추가

---

## 소스

- [Apify Actor Publishing Guide](https://docs.apify.com/platform/actors/publishing/publish)
- [Apify Actor Monetization](https://docs.apify.com/academy/actor-marketing-playbook/store-basics/how-actor-monetization-works)
- [Apify Creator Plan](https://apify.com/pricing/creator-plan)
- [Apify $1M Challenge](https://apify.com/challenge)
- [ParseForge Success Story](https://blog.apify.com/parseforge-actor-factory/)
- [Apify Monetize Your Code](https://apify.com/partners/actor-developers)
- [Apify SEO for Actors](https://help.apify.com/en/articles/2644024-seo-for-actors)
- [Apify Marketing Checklist](https://docs.apify.com/academy/actor-marketing-playbook/promote-your-actor/checklist)
