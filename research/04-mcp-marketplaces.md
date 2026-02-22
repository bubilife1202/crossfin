# MCP 마켓플레이스 등록 기회 분석

> 작성일: 2026-02-21 | crossfin-mcp v1.9.0 (16개 툴, x402 결제 통합)

---

## 1. CrossFin MCP 서버 현황

| 항목 | 내용 |
|------|------|
| npm 패키지 | `crossfin-mcp@1.9.0` |
| MCP Name | `io.github.bubilife1202/crossfin` |
| 총 툴 수 | 16개 (무료 11개 + 유료 2개 + 지갑/레저 5개) |
| x402 결제 | Base 네트워크 USDC 자동 결제 통합 완료 |
| Smithery 설정 | `smithery.yaml` 존재 (commandFunction 방식) |
| Glama 설정 | `glama.json` + `.well-known/glama.json` 존재 |

### 툴 목록

**무료 (Free) 툴:**
- `search_services` — 서비스 레지스트리 키워드 검색
- `list_services` — 카테고리별 서비스 목록
- `get_service` — 개별 서비스 상세 정보
- `list_categories` — 전체 카테고리 목록
- `get_kimchi_premium` — 김치프리미엄(Route Spread) 실시간 프리뷰
- `get_analytics` — 게이트웨이 사용량 통계
- `get_guide` — 완전 API 가이드
- `list_exchange_fees` — 9개 거래소 수수료 비교
- `compare_exchange_prices` — 한국 vs 글로벌 코인 가격 비교

**유료 (Paid, x402) 툴:**
- `call_paid_service` — 범용 유료 API 호출 (자동 결제)
- `find_optimal_route` — 아시아 거래소 간 최적 송금 경로 ($0.10/call)

**로컬 레저 (Wallet) 툴:**
- `create_wallet`, `get_balance`, `transfer`, `list_transactions`, `set_budget`

---

## 2. 마켓플레이스별 상세 분석

### 2.1 공식 MCP Registry (modelcontextprotocol.io)

| 항목 | 내용 |
|------|------|
| URL | https://registry.modelcontextprotocol.io |
| 운영 | Anthropic + 오픈소스 커뮤니티 (GitHub: modelcontextprotocol/registry) |
| 출시일 | 2025-09-08 (프리뷰), 2026년 정식 운영 중 |
| 등록 방식 | CLI 도구 `mcp-publisher` 사용 |
| 네이밍 | GitHub 기반 (`io.github.bubilife1202/crossfin` — 이미 package.json에 설정됨) |

**등록 절차:**
1. `mcp-publisher init` — server.json 템플릿 생성
2. server.json 편집 (서버 메타데이터, 설명, 도구 목록)
3. `mcp-publisher login github` — GitHub 인증
4. `mcp-publisher publish` — 레지스트리에 퍼블리시

**전제 조건:**
- npm에 패키지 게시 완료 (이미 완료됨: `crossfin-mcp@1.9.0`)
- GitHub 계정 인증 (bubilife1202)
- server.json 파일 작성 필요

**노출 효과:**
- Claude Desktop 통합: "Browse Extensions" 디렉토리에서 직접 노출
- Claude Desktop Extensions (.mcpb 포맷)으로 원클릭 설치 가능
- 공식 레지스트리 API를 통해 모든 MCP 클라이언트에서 검색 가능
- Anthropic 검수 과정을 통과하면 "Anthropic-reviewed" 배지 획득 가능

**경쟁 현황 (금융/크립토 MCP 서버):**
- Alpha Vantage MCP — 주식/포렉스/크립토 (가장 인기)
- Financial Datasets MCP — 재무제표/주가
- QuantConnect MCP — 알고리즘 트레이딩
- MetaTrader 5 MCP — 포렉스/CFD
- Polygon.io MCP — 실시간 시장 데이터
- **한국 시장 특화 MCP 서버 없음** — CrossFin의 강력한 차별점

**예상 노출/설치:**
- 월 5,000~20,000회 검색 노출 (financial, crypto 카테고리)
- 월 100~500회 설치 (초기), 성장 시 1,000+
- Claude Desktop DAU 기준 매우 높은 도달 가능성

---

### 2.2 Cursor Marketplace

| 항목 | 내용 |
|------|------|
| URL | cursor.com/marketplace |
| 운영 | Cursor (Anysphere) |
| 출시일 | 2026-02-17 (Cursor 2.5) |
| MAD | 250,000+ 월간 활성 개발자 |
| 등록 방식 | cursor.com/marketplace/publish에서 플러그인 제출 |
| 설치 | `/add-plugin` 명령어로 원클릭 설치 |

**등록 절차:**
1. 플러그인 디렉토리 구조 생성 (`.cursor-plugin/plugin.json` 매니페스트)
2. plugin.json 작성: name, displayName, author, description, keywords, license, version
3. MCP 서버 설정을 플러그인으로 번들링 (skills, subagents, hooks, rules 포함 가능)
4. cursor.com/marketplace/publish에서 제출
5. 검수 후 마켓플레이스 노출

**plugin.json 예시 (CrossFin용):**
```json
{
  "name": "crossfin-mcp",
  "displayName": "CrossFin - Korean Crypto & Finance",
  "author": "bubilife1202",
  "description": "Real-time Korean crypto premium, exchange routing, and financial data via x402 payments",
  "keywords": ["crypto", "korea", "finance", "x402", "kimchi-premium"],
  "license": "UNLICENSED",
  "version": "1.9.0"
}
```

**경쟁 현황:**
- cursor.directory/mcp에 250,000+ 개발자 접근
- 금융 MCP 서버 존재하나, 한국 시장 특화 없음
- Cursor 2.5부터 MCP + skills + subagents 번들링 가능 — CrossFin의 복합 기능에 유리

**예상 노출/설치:**
- 월 10,000~50,000회 검색 노출 (개발자 중심 플랫폼)
- 월 200~1,000회 설치 (크립토 개발자 타겟)
- 개발자가 주 사용층이므로 API 통합/유료 전환율 높음

---

### 2.3 LobeHub MCP Marketplace

| 항목 | 내용 |
|------|------|
| URL | https://lobehub.com/mcp |
| 운영 | LobeHub (오픈소스 AI 에이전트 플랫폼) |
| GitHub Stars | 72,000+ (lobehub 메인), 50,000+ (lobe-chat) |
| 기여자 | 637+ |
| 등록 방식 | GitHub PR 제출 (mcp_server_market.json에 추가) |

**등록 절차:**
1. LobeHub의 MCP 서버 마켓 저장소 포크
2. `mcp_server_market.json` 파일에 CrossFin 서버 설정 추가
3. PR 제출 (서버 설명, 사용 방법, 의존성 문서 포함)
4. 호환성 테스트 (chatmcp 앱으로)
5. 머지 후 마켓플레이스 노출

**설정 예시 (CrossFin용):**
```json
{
  "crossfin": {
    "command": "npx",
    "args": ["-y", "crossfin-mcp@1.9.0"],
    "env": {
      "EVM_PRIVATE_KEY": "<YOUR_EVM_PRIVATE_KEY>"
    }
  }
}
```

**경쟁 현황:**
- Polymarket MCP 서버 등 크립토 관련 서버 존재
- 금융 데이터 MCP 서버 다수 등록 (Polygon.io 등)
- **한국 특화 금융/크립토 MCP 서버 없음**

**예상 노출/설치:**
- LobeHub 사용자 기반이 크고 아시아(중국) 사용자 비중 높음
- 월 3,000~10,000회 검색 노출
- 월 100~500회 설치 (한국/아시아 크립토 관심 사용자)
- 중국/아시아 사용자가 많아 한국 크립토 프리미엄 데이터에 관심도 높을 것

---

### 2.4 Smithery.ai

| 항목 | 내용 |
|------|------|
| URL | https://smithery.ai |
| 운영 | Smithery AI |
| 등록 서버 | 7,300+ MCP 서버 |
| 등록 방식 | GitHub 연동 + smithery.yaml (이미 존재) |
| 배포 옵션 | Remote (Smithery 호스팅) 또는 Local (MCP 번들) |

**등록 절차 (CrossFin은 smithery.yaml이 이미 완성됨):**
1. GitHub에 코드 푸시 (완료)
2. smithery.ai/new에서 GitHub 로그인
3. GitHub 저장소 연결 (bubilife1202/crossfin)
4. smithery.yaml 자동 감지 → 서버 등록
5. Deployments 탭에서 배포 설정 (Remote 또는 Local)

**현재 CrossFin smithery.yaml 상태:** 완성됨
- `startCommand.type: stdio`
- `configSchema`: evmPrivateKey, apiUrl, ledgerPath 설정 완료
- `commandFunction`: `npx -y crossfin-mcp@1.9.0` 실행 완료

**추가 CLI 옵션:**
```bash
smithery mcp publish <url> -n bubilife1202/crossfin
```

**경쟁 현황:**
- 7,300+ 서버 중 금융 카테고리 다수
- monarch-mcp-server 등 개인 자산관리 MCP 존재
- **한국 크립토/금융 특화 MCP 없음**

**예상 노출/설치:**
- 월 2,000~8,000회 검색 노출
- 월 50~300회 설치
- Smithery의 원클릭 설치가 사용자 전환에 유리

---

### 2.5 Glama.ai

| 항목 | 내용 |
|------|------|
| URL | https://glama.ai/mcp/servers |
| 운영 | Glama |
| 등록 서버 | 17,564+ MCP 서버 (가장 큰 디렉토리) |
| 등록 방식 | "Add Server" + `.well-known/glama.json` (이미 존재) |
| 카테고리 | Finance 카테고리 별도 존재 |

**등록 절차 (CrossFin은 glama.json이 이미 완성됨):**
1. `.well-known/glama.json` 배포 (crossfin.dev에 이미 존재)
2. glama.ai에서 "Add Server" 클릭
3. GitHub 저장소 URL 입력 (bubilife1202/crossfin)
4. 자동 크롤링 후 서버 등록
5. Finance 카테고리에 노출

**현재 CrossFin glama.json 상태:** 완성됨
- `$schema`: glama.ai MCP 서버 스키마
- `maintainers`: bubilife1202
- `.well-known/glama.json`: name, maintainer email, repository URL 설정 완료

**경쟁 현황 (Finance 카테고리):**
- Market Expert MCP (DolphinWorld) — 일반 시장 분석
- Spraay x402 MCP (plagtech) — x402 결제 통합 예시
- **한국 특화 금융 MCP 없음**
- Finance 카테고리 전용 URL: https://glama.ai/mcp/servers/categories/finance

**예상 노출/설치:**
- 가장 큰 MCP 디렉토리 → 높은 SEO 노출
- 월 5,000~15,000회 검색 노출
- 월 100~400회 설치
- 30일간 사용량 기준 정렬 기능으로 인기 서버 부각 가능

---

## 3. 마켓플레이스 종합 비교

| 마켓플레이스 | 사용자 규모 | 등록 난이도 | 준비 상태 | 예상 월간 설치 | 우선순위 |
|------------|-----------|-----------|---------|-------------|---------|
| **공식 MCP Registry** | Claude 전체 사용자 | 중 (CLI 도구) | server.json 작성 필요 | 100~500 | **1순위** |
| **Smithery.ai** | 7,300+ 서버 | **낮음** (yaml 완료) | **즉시 등록 가능** | 50~300 | **2순위** |
| **Glama.ai** | 17,564+ 서버 | **낮음** (json 완료) | **즉시 등록 가능** | 100~400 | **3순위** |
| **Cursor Marketplace** | 250K+ MAD | 중 (plugin 구조) | plugin.json 작성 필요 | 200~1,000 | **4순위** |
| **LobeHub** | 72K+ GitHub Stars | 중 (PR 제출) | JSON 설정 작성 필요 | 100~500 | **5순위** |

---

## 4. x402 Per-Call 수익 예상

### 4.1 x402 동작 방식 (CrossFin 적용)

```
사용자 → MCP 클라이언트 → crossfin-mcp → CrossFin API (/api/premium/*)
                                         ← HTTP 402 + 가격 메타데이터
                           자동 USDC 결제 → Base 블록체인
                                         ← 데이터 + txHash 반환
```

### 4.2 현재 유료 엔드포인트

| 서비스 | 가격 | 설명 |
|--------|------|------|
| `find_optimal_route` | $0.10/call | 아시아 거래소 간 최적 송금 경로 |
| `call_paid_service` | 서비스별 상이 | 범용 유료 API 호출 |

### 4.3 수익 시나리오

**보수적 시나리오 (6개월 후):**
- 전체 마켓플레이스 월간 설치: 500건
- 유료 도구 전환율: 5% (25명 활성 유료 사용자)
- 유료 사용자 평균 월간 호출: 20회
- 호출당 평균 가격: $0.10
- **월 수익: 25 x 20 x $0.10 = $50/월**

**중간 시나리오 (12개월 후):**
- 전체 마켓플레이스 월간 설치: 2,000건
- 유료 도구 전환율: 8% (160명)
- 유료 사용자 평균 월간 호출: 50회
- 호출당 평균 가격: $0.10
- **월 수익: 160 x 50 x $0.10 = $800/월**

**낙관적 시나리오 (18개월 후):**
- 전체 마켓플레이스 월간 설치: 5,000건
- 유료 도구 전환율: 10% (500명)
- 유료 사용자 평균 월간 호출: 100회
- 호출당 평균 가격: $0.12 (신규 프리미엄 서비스 추가)
- **월 수익: 500 x 100 x $0.12 = $6,000/월**

### 4.4 수익 극대화 전략

1. **유료 도구 추가**: 현재 2개 → 5~10개로 확대
   - 실시간 김치프리미엄 알림 ($0.05/call)
   - 거래소별 깊이 분석 ($0.08/call)
   - 한국 주식 실시간 데이터 ($0.15/call)
   - 크로스보더 송금 비용 계산기 ($0.10/call)

2. **구독 모델 병행**: 월 $5~$20 무제한 호출 패스
   - x402 단건 결제와 구독 하이브리드

3. **프리미엄 번들**: 여러 API 묶음 할인
   - 크립토 분석 번들: $0.50/10calls

---

## 5. 등록 실행 계획 (Action Items)

### 즉시 실행 가능 (1~2일)

#### Smithery.ai 등록
- [x] `smithery.yaml` 완성됨
- [ ] smithery.ai/new에서 GitHub 연결
- [ ] 서버 등록 및 배포 설정
- 예상 소요: 30분

#### Glama.ai 등록
- [x] `glama.json` + `.well-known/glama.json` 완성됨
- [ ] glama.ai에서 "Add Server" 클릭
- [ ] GitHub 저장소 URL 입력
- 예상 소요: 15분

### 단기 실행 (1주)

#### 공식 MCP Registry 등록
- [ ] `mcp-publisher` CLI 설치 (`brew install mcp-publisher` 또는 GitHub 릴리즈)
- [ ] `mcp-publisher init` → server.json 생성
- [ ] server.json 편집 (서버 메타데이터, 도구 설명, 키워드)
- [ ] `mcp-publisher login github` (bubilife1202 계정)
- [ ] `mcp-publisher publish` 실행
- [ ] Claude Desktop Extensions (.mcpb) 포맷 패키징 검토
- 예상 소요: 2~3시간

#### Cursor Marketplace 등록
- [ ] `.cursor-plugin/plugin.json` 매니페스트 생성
- [ ] MCP 서버 + skills 번들링
- [ ] cursor.com/marketplace/publish에서 제출
- 예상 소요: 3~4시간

### 중기 실행 (2주)

#### LobeHub MCP Marketplace 등록
- [ ] LobeHub MCP 서버 마켓 저장소 포크
- [ ] `mcp_server_market.json`에 CrossFin 설정 추가
- [ ] PR 제출 (한국어/영어 설명 포함)
- [ ] chatmcp 호환성 테스트
- 예상 소요: 2~3시간

---

## 6. CrossFin의 경쟁 우위

### 6.1 유일한 한국 특화 MCP 서버
- 모든 주요 마켓플레이스에서 한국 크립토/금융 특화 MCP 서버가 **전무**
- 김치프리미엄, 한국 거래소 (Bithumb, Upbit, Coinone, GoPax) 데이터는 CrossFin만 제공
- "Korean crypto premium", "kimchi premium", "Korean exchange" 검색 시 독점적 노출

### 6.2 x402 네이티브 통합
- x402가 MCP 생태계의 표준 결제 수단으로 자리매김 중
- Cloudflare, Vercel, Google, Coinbase 등 대형 플랫폼 지원
- x402 Solana 런칭 이후 35M+ 트랜잭션, $10M+ 볼륨
- CrossFin은 이미 x402 통합 완료 → "x402 MCP" 검색 시 노출

### 6.3 아시아 거래소 라우팅 엔진
- 9개 아시아 거래소, 11개 브릿지 코인 지원
- 최적 경로 탐색 (cheapest/fastest/balanced)
- 다른 금융 MCP 서버에 없는 고유 기능

---

## 7. 핵심 결론

1. **Smithery.ai와 Glama.ai는 즉시 등록 가능** — 설정 파일이 이미 완성되어 있어 30분 이내 등록 완료 가능
2. **공식 MCP Registry 등록이 가장 중요** — Claude Desktop 사용자 직접 도달 + "Anthropic-reviewed" 배지 가능
3. **Cursor Marketplace는 개발자 도달에 최적** — 250K+ MAD, 유료 전환율 높은 개발자 타겟
4. **한국 특화 MCP는 블루오션** — 모든 마켓플레이스에서 경쟁자 없음
5. **x402 per-call 수익은 보수적으로 $50/월 시작, 12개월 후 $800/월 성장 가능**
6. **5개 마켓플레이스 전체 등록 시 총 소요 시간: 약 1~2일** (대부분 이미 준비됨)
