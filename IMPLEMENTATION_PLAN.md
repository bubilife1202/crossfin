# CrossFin 엔드포인트 개선 상세 구현 계획서

> 작성일: 2026-02-17
> 목적: 30개 엔드포인트를 "판단 레이어 포함 서비스"로 전환하기 위한 구체적 변경사항

---

## 요약

- **현재**: 30개 중 27개가 외부 API를 그대로 전달하는 프록시. 에이전트가 직접 호출하면 무료.
- **목표**: 모든 엔드포인트에 "에이전트가 직접 못하는 분석/판단"을 추가. + 신규 복합 엔드포인트 3-4개.
- **이미 판단 레이어가 있는 것**: 3개 (#5 arbitrage/opportunities, #12 upbit/signals, #30 cross-exchange)

---

## 분류별 현황

| 분류 | 개수 | 해당 엔드포인트 |
|------|------|----------------|
| A. 이미 판단 레이어 있음 (유지/강화) | 3개 | #5, #12, #30 |
| B. 데이터 조합은 하지만 판단 없음 (판단 추가) | 5개 | #3, #7, #8, #19, #20 |
| C. 단순 프록시 — 시세/가격류 (분석 레이어 추가) | 8개 | #6, #9, #10, #11, #13, #25, #27, #28 |
| D. 단순 프록시 — 한국 주식/지수류 (투자 판단 추가) | 8개 | #14, #15, #16, #17, #18, #21, #23, #26 |
| E. 단순 프록시 — 뉴스/공시류 (영향도 분석 추가) | 3개 | #22, #24, #29 |
| F. 유지/삭제 | 3개 | #1, #2, #4 |

---

## A. 이미 판단 레이어 있음 (3개) — 강화만

### #5 `/api/premium/arbitrage/opportunities` ($0.10)
- **현재**: EXECUTE/WAIT/SKIP 판단 + confidence + 슬리피지 + 변동성
- **강화**:
  - `riskScore` 추가 (0-100, 전송시간 + 변동성 + 유동성 종합)
  - `expectedNetProfitUsd` 추가 (수수료/전송비/슬리피지 차감 후 순이익)
  - `timeWindow` 추가 ("기회가 유효한 예상 시간")
  - `historicalSuccessRate` 추가 (과거 유사 조건에서의 성공률, kimchi_snapshots DB 활용)

### #12 `/api/premium/market/upbit/signals` ($0.05)
- **현재**: momentum bucketing + volume signal + bullish/bearish/neutral
- **강화**:
  - `suggestedAction` 추가: BUY/SELL/HOLD + 근거
  - `relativeStrength` 추가: 6개 코인 간 상대 강도 비교
  - `volumeAnomaly` 추가: 24h 평균 대비 현재 거래량 이상치 감지
  - `crossExchangeConfirm` 추가: Bithumb에서도 같은 시그널인지 교차검증

### #30 `/api/premium/market/cross-exchange` ($0.08)
- **현재**: ARBITRAGE/HOLD/MONITOR 시그널 + 스프레드 분석
- **강화**:
  - `optimalPath` 추가: "Upbit에서 매수 → Bithumb에서 매도" 같은 구체적 경로
  - `estimatedFees` 추가: 거래소별 수수료 + 전송비 포함 순이익
  - `urgency` 추가: HIGH/MEDIUM/LOW (스프레드 축소 속도 기반)

---

## B. 데이터 조합은 하지만 판단 없음 (5개) — 판단 레이어 추가

### #3 `/api/premium/arbitrage/kimchi` ($0.05)
- **현재**: 김치프리미엄 % 숫자만 반환 (BTC/ETH/XRP 등 쌍별)
- **추가할 것**:
  ```
  judgment: {
    action: "EXECUTE" | "WAIT" | "SKIP",
    confidence: 87,
    reason: "BTC 프리미엄 3.8%는 30일 평균(2.1%) 대비 높음. 최근 3시간 상승 추세.",
    bestPair: "BTC",
    estimatedNetProfit: { usd: 47.20, afterFees: 38.50 },
    riskLevel: "MEDIUM",
    historicalContext: "최근 30일간 3.5% 이상일 때 72%가 24h 내 하락"
  }
  ```
- **구현 방법**: kimchi_snapshots DB에서 최근 30일 데이터 조회 → 현재값과 비교 → 추세/백분위/평균 계산 → 판단 생성

### #7 `/api/premium/bithumb/volume-analysis` ($0.03)
- **현재**: 24h 거래량, 비정상 거래량, 상위 코인 목록
- **추가할 것**:
  ```
  judgment: {
    marketPhase: "ACCUMULATION" | "DISTRIBUTION" | "MARKUP" | "MARKDOWN",
    unusualVolumeAlert: true,
    alertCoins: ["XRP", "SOL"],
    interpretation: "XRP 거래량 평소 3.2배. 대형 매수세 유입 가능성. SOL은 매도 물량 집중.",
    suggestedAction: "XRP 주목, SOL 관망",
    confidence: 74
  }
  ```
- **구현 방법**: 거래량 패턴 분석 (급등/급락 감지) + 가격 변동 방향과 거래량 방향 교차 분석

### #8 `/api/premium/market/korea` ($0.03)
- **현재**: 상승/하락/거래량 상위 + marketMood
- **추가할 것**:
  ```
  judgment: {
    marketState: "RISK_ON" | "RISK_OFF" | "MIXED",
    dominantTrend: "알트코인 강세 — BTC 횡보 중 알트 순환매 진행",
    topMover: { coin: "SOL", reason: "거래량 급증 + 5% 상승, 글로벌 SOL 랠리 연동" },
    riskIndicator: 62,  // 0(안전) ~ 100(위험)
    suggestedFocus: ["SOL", "XRP"],
    avoidList: ["DOGE"],
    confidence: 68
  }
  ```

### #19 `/api/premium/crypto/korea/5exchange` ($0.08)
- **현재**: 5개 거래소 가격 비교 + 스프레드
- **추가할 것**:
  ```
  judgment: {
    bestBuyExchange: "Upbit",
    bestSellExchange: "Bithumb",
    domesticArbitrage: {
      possible: true,
      spreadPct: 0.34,
      estimatedProfitPer1000Usd: 2.80,
      fees: { buyFee: 0.25, sellFee: 0.25, netProfit: 2.30 },
      action: "MONITOR"  // 스프레드가 수수료 이하이므로
    },
    priceConsensus: "4/5 거래소 수렴 — 시장 안정",
    outlierExchange: "GoPax (거래량 부족, 가격 신뢰도 낮음)"
  }
  ```

### #20 `/api/premium/crypto/korea/exchange-status` ($0.03)
- **현재**: 입출금 가능/불가 상태
- **추가할 것**:
  ```
  judgment: {
    riskCoins: ["LUNA", "FTT"],
    riskReason: "입출금 동시 중단 — 네트워크 이슈 또는 상장폐지 검토 가능성",
    newlyDisabled: ["ARB"],  // 최근 변경된 것
    safeForTransfer: ["BTC", "ETH", "XRP", "SOL"],
    overallHealth: "NORMAL",  // NORMAL | CAUTION | WARNING
    actionAdvice: "LUNA, FTT 보유 시 즉시 점검 필요"
  }
  ```

---

## C. 단순 프록시 — 시세/가격류 (8개) — 분석 레이어 추가

### #6 `/api/premium/bithumb/orderbook` ($0.02)
- **현재**: 호가창 데이터 + 스프레드
- **추가할 것**: 유동성 분석
  ```
  analysis: {
    liquidityScore: 78,  // 0-100
    buyWallDepthUsd: 45000,
    sellWallDepthUsd: 38000,
    imbalance: "BUY_HEAVY",  // 매수벽이 더 두꺼움
    slippageEstimate: { for1000Usd: 0.12, for5000Usd: 0.45, for10000Usd: 1.2 },
    interpretation: "매수벽 강함. $1000 이하 주문은 슬리피지 미미. 시장가 매수 유리."
  }
  ```

### #9 `/api/premium/market/fx/usdkrw` ($0.01)
- **현재**: USD/KRW 환율 숫자만
- **추가할 것**: 환율 맥락
  ```
  analysis: {
    trend: "WEAKENING_KRW",  // 원화 약세 추세
    changeFromYesterday: +3.50,
    changePct: +0.24,
    weeklyTrend: "상승",
    impact: {
      forKimchiPremium: "환율 상승 → 김치프리미엄 축소 경향",
      forCryptoArbitrage: "원화 약세 시 해외 매수 → 국내 매도 수익성 감소",
      forStockInvestors: "외인 매도 압력 증가 가능"
    }
  }
  ```

### #10 `/api/premium/market/upbit/ticker` ($0.02)
- **현재**: 시세, 24h 변동, 거래량
- **추가할 것**: 거래소 간 비교 + 시그널
  ```
  analysis: {
    vsGlobal: { binanceUsd: 92100, premiumPct: 2.3 },
    vsBithumb: { priceDiffPct: -0.12, cheaperAt: "Upbit" },
    volumeRank: "상위 15%",
    momentum: "NEUTRAL",
    quickTake: "Upbit이 Bithumb 대비 0.12% 저렴. 글로벌 대비 프리미엄 2.3%. 매수는 Upbit 권장."
  }
  ```

### #11 `/api/premium/market/upbit/orderbook` ($0.02)
- **현재**: 호가 데이터 + 스프레드
- **추가할 것**: (#6과 동일한 유동성 분석)

### #13 `/api/premium/market/coinone/ticker` ($0.02)
- **현재**: Coinone 시세
- **추가할 것**: 거래소 간 비교
  ```
  analysis: {
    vsUpbit: { priceDiffPct: +0.08 },
    vsBithumb: { priceDiffPct: -0.15 },
    volumeComparison: "Coinone 거래량은 Upbit의 3.2%",
    liquidityWarning: "거래량 낮음. 대량 주문 시 슬리피지 주의.",
    recommendation: "소액 거래만 권장"
  }
  ```

### #25 `/api/premium/crypto/korea/fx-rate` ($0.01)
- **현재**: CRIX 기반 USD/KRW
- **추가할 것**: #9와 합쳐서 이중 소스 비교
  ```
  analysis: {
    openErRate: 1342.50,
    crixRate: 1343.20,
    discrepancy: 0.05,
    reliability: "HIGH",  // 두 소스 수렴
    forArbitrage: "환율 차이 0.05% — 아비트리지 계산에 영향 미미"
  }
  ```

### #27 `/api/premium/crypto/korea/upbit-candles` ($0.02)
- **현재**: OHLCV 캔들 데이터
- **추가할 것**: 기술적 분석
  ```
  analysis: {
    pattern: "HIGHER_LOWS",  // 저점 상승 패턴
    support: 91500000,
    resistance: 94200000,
    volumeTrend: "INCREASING",
    simpleSignal: "SHORT_TERM_BULLISH",
    interpretation: "저점 상승 + 거래량 증가. 단기 상승 모멘텀. 저항선 94.2M 돌파 시 추가 상승 가능.",
    confidence: 65
  }
  ```

### #28 `/api/premium/market/global/indices-chart` ($0.02)
- **현재**: 글로벌 지수 OHLCV
- **추가할 것**: 지수 간 상관관계 + 한국 영향
  ```
  analysis: {
    trend: "UPTREND",
    correlation: { withKospi: 0.72, withBtc: 0.45 },
    impact: "다우존스 상승 → KOSPI 익일 갭업 확률 68% (최근 60일 기준)",
    globalMood: "RISK_ON"
  }
  ```

---

## D. 단순 프록시 — 한국 주식/지수류 (8개) — 투자 판단 추가

### #14 `/api/premium/market/korea/indices` ($0.03)
- **현재**: KOSPI/KOSDAQ 지수, 변동폭, 방향
- **추가할 것**:
  ```
  analysis: {
    marketPhase: "장중" | "장전" | "장후",
    todayMomentum: "BULLISH",
    foreignFlow: "3일 연속 순매수 +2,340억",
    institutionalFlow: "순매도 -890억",
    retailFlow: "순매수 +1,450억",
    interpretation: "외인 주도 상승. 기관 차익실현 중. 반도체 테마 주도.",
    shortTermOutlook: "상승 모멘텀 유지, 단 기관 매도 증가 시 조정 가능",
    confidence: 72
  }
  ```
- **구현 방법**: `/api/premium/market/korea/index-flow` (#18)의 데이터를 내부적으로 함께 호출하여 수급 데이터 결합

### #15 `/api/premium/market/korea/indices/history` ($0.05)
- **현재**: OHLC 히스토리
- **추가할 것**: 기술적 분석
  ```
  analysis: {
    movingAvg: { ma5: 2841, ma20: 2823, ma60: 2798 },
    trend: "5일선 > 20일선 > 60일선 — 정배열 (강세)",
    support: 2798,
    resistance: 2870,
    rsi14: 62,
    interpretation: "정배열 유지, RSI 과매수 구간 진입 전. 추가 상승 여력 있으나 2,870 저항선 주목."
  }
  ```

### #16 `/api/premium/market/korea/stocks/momentum` ($0.05)
- **현재**: 시총 상위, 상승/하락 상위
- **추가할 것**:
  ```
  analysis: {
    dominantTheme: "반도체",
    themeStrength: 87,
    rotationSignal: "대형주 → 중소형주 순환매 시작 조짐",
    topPick: { name: "SK하이닉스", reason: "외인 3일 연속 순매수 + 테마 주도주" },
    avoidList: [{ name: "XX건설", reason: "거래량 급감 + 기관 대량 매도" }],
    marketBreadth: "상승 60% / 하락 40% — 양호"
  }
  ```

### #17 `/api/premium/market/korea/investor-flow` ($0.05)
- **현재**: 외인/기관/개인 순매수 10일 히스토리
- **추가할 것**:
  ```
  analysis: {
    foreignTrend: "3일 연속 순매수 — 적극적 매수세",
    institutionalTrend: "차익실현 모드",
    retailTrend: "순매수 전환",
    dominantForce: "FOREIGN_BUY",
    signal: "외인 주도 상승 시 단기 상승 확률 높음",
    historicalPattern: "외인 3일 연속 순매수 후 5일 평균 수익률 +1.2%",
    confidence: 70
  }
  ```

### #18 `/api/premium/market/korea/index-flow` ($0.03)
- **현재**: 지수 레벨 수급 데이터
- **추가할 것**:
  ```
  analysis: {
    netFlowDirection: "외인 유입 > 기관 유출",
    implication: "외인이 시장을 주도. 환율 안정 시 지속 가능.",
    riskFactor: "환율 1,350원 돌파 시 외인 이탈 가능성"
  }
  ```

### #21 `/api/premium/market/korea/stock-detail` ($0.05)
- **현재**: PER/PBR/EPS/배당수익률/52주 범위/애널리스트 목표가
- **추가할 것**:
  ```
  analysis: {
    valuation: "FAIR" | "UNDERVALUED" | "OVERVALUED",
    valuationReason: "PER 12.3x는 업종 평균(14.8x) 대비 저평가",
    targetUpside: "+18.5% (현재 72,000원 → 목표 85,300원)",
    dividendAttractiveness: "배당수익률 2.1%는 시장 평균(1.8%) 상회",
    riskFactors: ["업종 경기 둔화 우려", "원자재 가격 상승"],
    quickVerdict: "저평가 구간. 배당 매력 있음. 중장기 매수 관점 유효.",
    confidence: 66
  }
  ```

### #23 `/api/premium/market/korea/themes` ($0.05)
- **현재**: 테마 목록 + 상승/하락 종목 수
- **추가할 것**:
  ```
  analysis: {
    hotThemes: [{ name: "반도체", momentum: "ACCELERATING", reason: "글로벌 AI 투자 확대" }],
    fadingThemes: [{ name: "2차전지", momentum: "DECELERATING", reason: "거래량 감소 + 외인 매도" }],
    emergingThemes: [{ name: "방산", momentum: "EMERGING", reason: "지정학 리스크 + 정책 수혜" }],
    themeRotation: "성장주 → 가치주 전환 초기",
    bestThemeForAgent: { name: "반도체", confidence: 78 }
  }
  ```

### #26 `/api/premium/market/korea/etf` ($0.03)
- **현재**: ETF 50개 목록 (NAV, 3개월 수익률, 시가총액)
- **추가할 것**:
  ```
  analysis: {
    topPerformers: [{ name: "TIGER 반도체", return3m: "+15.2%", reason: "반도체 테마 주도" }],
    categoryLeaders: {
      equity: "KODEX 200",
      sector: "TIGER 반도체",
      bond: "KOSEF 국고채10년",
      dividend: "ARIRANG 고배당"
    },
    flowTrend: "주식형 ETF로 자금 유입 증가",
    recommendation: "시장 상승 베팅 → KODEX 레버리지, 안전 선호 → KOSEF 국고채"
  }
  ```

---

## E. 단순 프록시 — 뉴스/공시류 (3개) — 영향도 분석 추가

### #22 `/api/premium/market/korea/stock-news` ($0.03)
- **현재**: 종목 뉴스 목록 (제목, 매체, 날짜)
- **추가할 것**:
  ```
  analysis: {
    sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL",
    sentimentScore: 72,  // 0-100
    keyTopics: ["실적 호조", "수출 증가", "신규 투자"],
    impactAssessment: "긍정적 뉴스 우세. 실적 관련 뉴스 집중 — 단기 주가에 긍정적.",
    majorNews: { title: "삼성전자 반도체 수출 +23%", impact: "HIGH", direction: "POSITIVE" }
  }
  ```
- **구현 방법**: 뉴스 제목 키워드 분석 (긍정/부정 단어 사전 기반 감성 분석)

### #24 `/api/premium/market/korea/disclosure` ($0.03)
- **현재**: 공시 목록 (제목, 날짜)
- **추가할 것**:
  ```
  analysis: {
    materialDisclosures: [{ title: "유상증자 결정", impact: "HIGH", direction: "NEGATIVE" }],
    impactSummary: "유상증자 공시 — 주가 희석 우려. 단기 하락 가능성.",
    actionAdvice: "보유 시 유상증자 비율 확인 필요. 신규 매수 자제 권장."
  }
  ```
- **구현 방법**: 공시 제목에서 키워드 매칭 (유상증자, 자사주매입, 대표이사변경, 합병 등 → 영향도 분류)

### #29 `/api/premium/news/korea/headlines` ($0.03)
- **현재**: Google News RSS 파싱 (제목, 매체, 링크)
- **추가할 것**:
  ```
  analysis: {
    marketImpact: "MODERATE",
    topStory: { title: "반도체 수출 역대 최고", relevance: "CRYPTO_MARKET" | "STOCK_MARKET" | "FX" },
    sentimentOverall: "POSITIVE",
    keyThemes: ["반도체 호황", "금리 동결", "부동산 규제"],
    cryptoRelevant: [{ headline: "비트코인 ETF 승인", impact: "POSITIVE" }],
    stockRelevant: [{ headline: "삼성전자 투자 확대", impact: "POSITIVE" }]
  }
  ```

---

## F. 유지/삭제 (3개)

### #1 `/api/premium/report` ($0.001) — 유지
- x402 결제 테스트용. 변경 불필요.

### #2 `/api/premium/enterprise` ($20.00) — 삭제 또는 리디자인
- 현재 UUID만 생성. 의미 없음.
- **옵션 A**: 삭제
- **옵션 B**: "전체 시장 종합 리포트" 엔드포인트로 리디자인 (모든 데이터 + 판단을 하나의 프리미엄 리포트로)

### #4 `/api/premium/arbitrage/kimchi/history` ($0.05) — 유지 (고유 가치)
- 자체 DB에 축적된 히스토리. 이미 고유 가치 있음.
- **추가할 것**: 간단한 통계 summary
  ```
  analysis: {
    avgPremium: 2.3,
    maxPremium: 5.1,
    minPremium: -0.4,
    currentVsAvg: "현재 3.2%는 평균(2.3%) 대비 높음",
    trend: "최근 6시간 상승 추세"
  }
  ```

---

## 신규 복합 분석 엔드포인트 (3-4개)

### NEW #1: `/api/premium/korea/market-brief` ($0.15)
- **기능**: 한국 시장 전체를 한 번에 요약
- **내부 호출**: KOSPI/KOSDAQ (#14) + 수급 (#18) + 김치프리미엄 (#3) + 환율 (#9) + 뉴스 (#29)
- **응답**:
  ```
  {
    stockMarket: { kospi: 2847, direction: "UP", foreignFlow: "+2340억" },
    cryptoMarket: { btcKrw: 92340000, kimchiPremium: 3.2, mood: "NEUTRAL" },
    fxMarket: { usdKrw: 1342.5, trend: "STABLE" },
    topNews: "반도체 수출 역대 최고",
    overallAssessment: "주식 시장 외인 주도 상승. 크립토 횡보. 환율 안정. 전반적 RISK_ON.",
    agentRecommendation: "한국 주식 비중 확대 적합. 크립토 아비트리지는 프리미엄 축소 대기.",
    confidence: 71
  }
  ```

### NEW #2: `/api/premium/korea/arbitrage-alert` ($0.15)
- **기능**: 실시간 아비트리지 기회 종합 알림
- **내부 호출**: 김치프리미엄 (#3) + 5거래소 (#19) + cross-exchange (#30) + 환율 (#25) + 호가창 (#6, #11)
- **응답**:
  ```
  {
    opportunities: [
      {
        type: "KIMCHI_PREMIUM",
        coin: "BTC",
        premium: 3.8,
        route: "Binance 매수 → Bithumb 매도",
        estimatedNetProfit: { usd: 47.20 },
        risk: "MEDIUM",
        action: "EXECUTE",
        confidence: 85
      },
      {
        type: "DOMESTIC_SPREAD",
        coin: "ETH",
        spread: 0.34,
        route: "Upbit 매수 → Bithumb 매도",
        estimatedNetProfit: { usd: 2.30 },
        risk: "LOW",
        action: "MONITOR",
        confidence: 72
      }
    ],
    totalOpportunities: 2,
    bestOpportunity: "BTC 김치프리미엄 아비트리지",
    marketCondition: "아비트리지 기회 보통. 프리미엄 상승 추세."
  }
  ```

### NEW #3: `/api/premium/korea/stock-radar` ($0.15)
- **기능**: 종목 스캐너 — 수급 급변 + 테마 + 공시를 종합
- **내부 호출**: 수급 (#17) + 테마 (#23) + 공시 (#24) + 뉴스 (#22) + momentum (#16)
- **응답**: 투자 시그널이 발생한 종목 목록 + 근거 + 판단

### NEW #4: `/api/premium/korea/sentiment` ($0.10)
- **기능**: 시장 심리 종합 지수
- **내부 호출**: 뉴스 (#29) + 거래량 (#7, #8) + 수급 (#17, #18) + 환율 (#9)
- **응답**: 종합 심리 점수 (0-100) + 공포/탐욕 지표 + 구성요소별 점수

---

## 구현 순서

| 순서 | 작업 | 영향 엔드포인트 | 예상 시간 |
|------|------|----------------|-----------|
| 1 | A그룹 강화 (이미 있는 판단 보강) | #5, #12, #30 | 1.5시간 |
| 2 | B그룹 판단 추가 (가장 가치 높음) | #3, #7, #8, #19, #20 | 2시간 |
| 3 | 신규 market-brief + arbitrage-alert | NEW #1, #2 | 2시간 |
| 4 | D그룹 투자 판단 추가 | #14-18, #21, #23, #26 | 2.5시간 |
| 5 | C그룹 분석 레이어 추가 | #6, #9-11, #13, #25, #27, #28 | 2시간 |
| 6 | E그룹 영향도 분석 추가 | #22, #24, #29 | 1시간 |
| 7 | 신규 stock-radar + sentiment | NEW #3, #4 | 1.5시간 |
| 8 | #2 enterprise 리디자인 | #2 | 30분 |

**총 예상: ~13시간**

---

## 구현 원칙

1. **기존 응답 깨지지 않게**: 기존 필드는 모두 유지. `analysis` 또는 `judgment` 필드를 추가.
2. **내부 API 재사용**: 신규 복합 엔드포인트는 기존 엔드포인트의 로직을 함수로 추출하여 재사용.
3. **판단 근거 투명**: 모든 판단에 `reason` (한글) + `confidence` (%) 포함.
4. **에이전트 친화적**: 모든 판단은 `action` 필드로 명확한 행동 지시 (EXECUTE/WAIT/SKIP/BUY/SELL/HOLD/MONITOR).
5. **영어 필드명 + 한글 해석**: 필드명은 영어, interpretation/reason은 한글 (해외 에이전트도 사용 가능하도록).
