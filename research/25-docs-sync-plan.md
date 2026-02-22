# #25 — 문서 최신화 기획서 (v1.12.0 동기화)

> 작성: 2026-02-22
> 목적: v1.11.0 (전면 무료화) + v1.10.0 (FAVORABLE→POSITIVE_SPREAD) + v1.11.0 (네이버 12개 비활성화) 이후 문서/코드가 프로덕션과 어긋난 부분 전량 수정

---

## 1. 변경 배경

| 버전 | 변경 내용 | 문서 반영 여부 |
|------|----------|--------------|
| v1.10.0 | `FAVORABLE`→`POSITIVE_SPREAD`, `UNFAVORABLE`→`NEGATIVE_SPREAD`, `favorableCandidates`→`positiveSpreadCount` | API 코드만 반영. SDK/catalog/examples/docs 미반영 |
| v1.11.0 | x402 결제 비활성화 — 전 엔드포인트 무료 | CHANGELOG만 기록. docs/README/SDK README 미반영 |
| v1.11.0 | 네이버 금융 12개 엔드포인트 503 비활성화 | CHANGELOG만 기록. docs/api.md에 정상 표기 |
| v1.12.0 | Asian Premium Index 4개 엔드포인트 추가 | docs/api.md에 반영됨 ✅ |

---

## 2. 수정 대상 파일 목록

### 🔴 P0 — FAVORABLE 잔여 (타입 안전성 문제)

#### 2-1. `packages/sdk/src/types.ts`

| 라인 | 현재 | 수정 |
|------|------|------|
| 49 | `favorableCandidates: number` | `positiveSpreadCount: number` |
| 114 | `indicator: 'FAVORABLE' \| 'NEUTRAL' \| 'UNFAVORABLE'` | `indicator: 'POSITIVE_SPREAD' \| 'NEUTRAL' \| 'NEGATIVE_SPREAD'` |
| 126 | `favorableCandidates: number` | `positiveSpreadCount: number` |
| 127 | `marketCondition: 'favorable' \| 'neutral' \| 'unfavorable'` | `marketCondition: 'positive' \| 'neutral' \| 'negative'` |
| 504 | `indicator: 'FAVORABLE' \| 'NEUTRAL' \| 'UNFAVORABLE'` | `indicator: 'POSITIVE_SPREAD' \| 'NEUTRAL' \| 'NEGATIVE_SPREAD'` |

> ⚠️ BREAKING CHANGE — SDK 사용자 코드에 영향. 메이저 버전업은 아니지만 CHANGELOG에 BREAKING 명시 필요.

#### 2-2. `catalog/crossfin-catalog.json`

| 라인 | 현재 | 수정 |
|------|------|------|
| 148 | `"FAVORABLE/NEUTRAL/UNFAVORABLE indicators"` | `"POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD indicators"` |

#### 2-3. `examples/gpt-actions-schema.yaml`

| 라인 | 현재 | 수정 |
|------|------|------|
| 43 | `Includes indicator (FAVORABLE/NEUTRAL/UNFAVORABLE)` | `Includes indicator (POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD)` |

---

### 🔴 P0 — 결제 정보 (유료→무료 미반영)

#### 2-4. `apps/docs/api.md`

**변경 방향**: 모든 `price: '$X.XX'` → `price: 'Free'`

영향 범위: 라인 13, 22~25, 33~45, 53~62, 70, 91~94, 138 (약 35개 엔드포인트)

추가 작업:
- 섹션 4 "Korean Stock APIs" — 12개 엔드포인트에 `⚠️ 503 — 마이그레이션 중` 표기 또는 섹션 자체를 접어두기
- 섹션 5 "Global Market Data" — `global/indices-chart`도 503이므로 동일 처리

#### 2-5. `apps/docs/quickstart.md`

| 라인 | 현재 | 수정 |
|------|------|------|
| 53 | `## Step 6: Paid optimal route (x402)` | `## Step 6: Full optimal route` |
| 59 | `Full route analysis ($0.10). Use an x402-capable client with Base USDC settlement.` | `Full route analysis (free). Returns complete step-by-step route with all alternatives and fee breakdown.` |

#### 2-6. `apps/docs/mcp.md`

| 라인 | 현재 | 수정 |
|------|------|------|
| 29 | `No EVM key? Free tools work without one. Paid tools require a Base wallet with USDC.` | `All tools are free. No API key or wallet required.` |
| 36 | `price: '$0.10'` (find_optimal_route) | `price: 'Free'` |
| 40 | `price: 'Varies'` (call_paid_service) | `price: 'Free'` |

#### 2-7. `apps/docs/index.md`

| 라인 | 현재 | 수정 |
|------|------|------|
| 6 | `call paid APIs over x402` | `real-time Korean and Asian crypto market data` |
| 31 | `price: '$0.10'` | `price: 'Free'` |

#### 2-8. `packages/sdk/README.md`

| 항목 | 현재 | 수정 |
|------|------|------|
| 예시 버전 | `version: '1.10.0'` | `version: '1.12.0'` |
| "Premium Endpoints (x402)" 섹션 | x402 결제 필수로 설명 | "All endpoints are currently free" 안내 + 가격표는 "향후 재도입 예정" 표기 |
| 35개 프리미엄 메서드 가격표 | 가격 표시 | `Free (normally $X.XX)` 또는 가격 열 자체 제거 |
| 네이버 의존 메서드들 | 정상 표기 | `⚠️ Currently disabled (503)` 표기 |

#### 2-9. 루트 `README.md`

| 항목 | 현재 | 수정 |
|------|------|------|
| "35 Paid APIs" 섹션 제목 | `## 35 Paid APIs` | `## 43 API Endpoints` (전부 무료) |
| "All paid via x402" | x402 USDC 결제 필수 | `Currently all free. x402 payment infrastructure ready for future activation.` |
| "Payment (x402)" 섹션 | 결제 방법 설명 | 유지하되 "Currently disabled — all endpoints free during beta" 주석 추가 |
| Korean Stock APIs 접힌 섹션 | 12개 전부 가격표 | `⚠️ Temporarily disabled` 표기 |
| `> **No EVM key?**` 부분 | `Paid tools require a Base wallet with USDC.` | `All tools are currently free. No wallet required.` |

---

### 🟡 P1 — 버전 불일치

#### 2-10. `packages/sdk/README.md`

- 예시 출력 `version: '1.10.0'` → `'1.12.0'`

#### 2-11. `packages/sdk/package.json`

- 버전업 확인 (현재 npm 1.12.0인지, 로컬이 동기화인지)

---

### ⚪ P2 — 수정 불필요 (역사 문서)

아래 파일은 작성 시점 기준 분석 문서로, 수정 대상 아님:

- `research/08-codebase-audit.md`
- `research/18-regulation-compliance.md`
- `research/21-gap-analysis.md`
- `research/22-risk-audit.md`
- `STRATEGY_REPORT.md`
- `HASHED_APPLICATION_EMAIL.md`
- `PRD.md`
- `AS_IS_TO_BE.md`

---

## 3. 수정하지 않는 것

- API 코드 (`apps/api/src/index.ts`) — 이미 v1.12.0에서 정상 반영됨
- MCP 서버 코드 (`apps/mcp-server/`) — 이미 반영됨
- live 사이트 (`apps/live/`) — FAVORABLE 0건, 정상
- web 사이트 (`apps/web/`) — 정상

---

## 4. 실행 순서

```
Phase 1: SDK 타입 수정 (BREAKING — 다른 것보다 선행)
  → packages/sdk/src/types.ts 수정
  → packages/sdk 빌드 확인

Phase 2: 문서 일괄 수정 (병렬 가능)
  → catalog/crossfin-catalog.json
  → examples/gpt-actions-schema.yaml
  → apps/docs/api.md
  → apps/docs/quickstart.md
  → apps/docs/mcp.md
  → apps/docs/index.md
  → packages/sdk/README.md
  → 루트 README.md

Phase 3: 버전업 + 배포
  → CHANGELOG.md 업데이트
  → 버전 체크리스트 12개 파일 동시 업데이트 (AGENTS.md 참조)
  → SDK npm publish
  → docs 배포
  → 프로덕션 검증
```

---

## 5. 검증 기준

- [ ] `grep -r "FAVORABLE" --include="*.ts" --include="*.json" --include="*.yaml" --include="*.md" apps/ packages/ catalog/ examples/` → research/ 제외하고 0건
- [ ] `grep -r "\\$0\\." --include="*.md" apps/docs/` → 0건 (가격 표기 전량 제거)
- [ ] SDK 빌드 성공 (`npm run build`)
- [ ] docs 사이트 빌드 성공
- [ ] 503 엔드포인트가 문서에 비활성 표기
- [ ] 프로덕션 health 체크 통과
