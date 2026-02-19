# Hashed Vibe Labs Seoul Batch 1 지원

**To:** vibelabs@hashed.com
**Subject:** [Vibe Labs 지원] CrossFin — 에이전트가 돈을 움직이는 시대, 그 길을 만듭니다

---

안녕하세요, CrossFin 팀입니다.

## 한 줄 소개

CrossFin은 한국 ↔ 글로벌 크립토 이동의 최적 경로를 찾아주는 라우팅 인프라입니다.
돈을 만지지 않습니다. 길을 만듭니다.

## 왜 지금인가

AI 에이전트가 결제하고, 구매하고, 자산을 움직이는 시대가 시작됐습니다. Conway Terminal, Skyfire, Stripe Agent Toolkit — 에이전트가 돈을 "쓰는" 인프라는 만들어지고 있지만, 아시아 크로스보더에서 돈을 "옮기는" 인프라는 아직 없습니다.

100만원을 한국에서 Binance USDC로 보내려면 7거래소 × 11코인 = 77개 경로가 있고, XRP로 보내면 수수료 0.07%, BTC로 보내면 2.3% — 이 차이가 ₩47,000입니다. 어떤 거래소도, 어떤 에이전트도 이 비교를 실시간으로 해주지 않습니다. CrossFin이 합니다.

## 7일, 164커밋, 3번 피벗

2월 13일에 첫 커밋을 찍었습니다. 7일 동안 164커밋, 3번 피벗했습니다.

- Day 1: Agent Ledger 데모 → 사용자 없음 → 같은 날 x402 Paywall로 피벗
- Day 2: 김프 데이터 API → 데이터만으론 가치 0원 → 라우팅 엔진으로 피벗
- Day 4: 라우팅 엔진 구축 → 7거래소 × 11코인, 77개 경로 실시간 비교
- Day 6: 7개 채널 배포, 라이브 데모, Telegram AI 봇
- Day 7: OKX/Bybit 추가(5→7거래소), API 문서 사이트, v1.8.6

혼자 만들었습니다. Codex, Cowork, OpenCode, Claude Code를 워크플로우 전체에 깊이 통합해서 — 코드 생성 80%, 리서치 90%, 디버깅 70%를 AI가 처리하고, 방향 설정과 판단은 사람이 합니다.

## 라이브 프로덕트

- API: https://crossfin.dev (75개 엔드포인트, x402 결제)
- 데모: https://live.crossfin.dev (인터랙티브 라우팅 데모 + 절약금액 시각화)
- Telegram AI 봇: https://t.me/crossfinn_bot (자연어 라우팅 조회)
- API 문서: https://docs.crossfin.dev
- 7개 배포 채널: npm · Smithery.ai · Anthropic MCP Registry · Streamable HTTP MCP · awesome-x402 · BlockRun · Bazaar

비즈니스 모델: 라우팅 쿼리당 $0.10. Non-custodial. Visa처럼 돈을 만지지 않고 라우팅만 합니다.

## 비전 — 크로스보더 크립토의 Bloomberg

라우팅 → 예측 → 인텔리전스. 쿼리마다 데이터가 쌓이고, 데이터가 쌓일수록 경로 비용 예측이 정확해지고, 정확해질수록 유저가 늘고, 유저가 늘수록 데이터가 쌓이는 플라이휠입니다. 봇·펀드·거래소에 데이터 API를 제공하는 크로스보더 크립토 인텔리전스 플랫폼이 최종 목표입니다.

## 팀

1인 팀. 비개발자. AI-native 빌더.
7일 만에 75개 API 엔드포인트 + 라우팅 엔진 + MCP 서버 + Telegram AI 봇 + 7개 채널 배포 + 문서 사이트까지 만들었습니다.

## 8주 안에 할 것

- Week 1-2: 거래소 9개 확장 + 오더북/네트워크 데이터 수집
- Week 3-4: 예측 라우팅 v1 (타이밍 추천) + SDK + 유저 온보딩
- Week 5-6: API 고객 10개 유치 + 에이전트 연동 트래픽 확보
- Week 7-8: 데이터 인텔리전스 대시보드 + 시드 라운드 준비

## 링크

- 라이브 API: https://crossfin.dev (75 endpoints, v1.8.6)
- 라이브 데모: https://live.crossfin.dev
- Telegram 봇: https://t.me/crossfinn_bot
- API 문서: https://docs.crossfin.dev
- GitHub: https://github.com/petechain23/crossfin (164+ commits)
- 피치덱: (첨부)

감사합니다.
CrossFin
