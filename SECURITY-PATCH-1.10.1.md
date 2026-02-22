# CrossFin v1.10.1 Security Patch — 수정 기획서

> 작성일: 2026-02-22
> 현재 버전: 1.10.0
> 목표 버전: **1.10.1**
> 범위: API 보안 패치 (기능 변경 없음, MCP/SDK 버전 동시 업데이트)

---

## 배경

무료 티어 개방 전 보안 감사 실시. 기본 보안 구조(admin 토큰, API 키 해싱, IP 레이트리밋, SSRF 방어)는 양호하나 아래 3건의 취약점 확인됨.

---

## 수정 항목

### 1. [CRITICAL] ACP 실행 엔드포인트 인증 추가

**현상**: `POST /api/acp/execute`와 `GET /api/acp/executions/:executionId`가 인증 없이 공개되어 있음. 누구나 quote_id만 알면 실행을 트리거하거나 실행 상태를 조회할 수 있음.

**파일**: `apps/api/src/index.ts`

**변경 내용**:
- `POST /api/acp/execute` (line ~10827): `agentAuth` 미들웨어 추가
- `GET /api/acp/executions/:executionId` (line ~10939): `agentAuth` 미들웨어 추가

**Before**:
```typescript
app.post('/api/acp/execute', async (c) => {
app.get('/api/acp/executions/:executionId', async (c) => {
```

**After**:
```typescript
app.post('/api/acp/execute', agentAuth, async (c) => {
app.get('/api/acp/executions/:executionId', agentAuth, async (c) => {
```

**영향**: ACP execute/status 호출 시 `X-Agent-Key` 헤더 필수. 기존 사용자 없으므로 breaking change 영향 없음.

**OpenAPI 스펙 업데이트**: 해당 엔드포인트에 `X-Agent-Key` 파라미터 추가.

**검증**:
- `X-Agent-Key` 없이 호출 → 401 반환 확인
- 유효한 키로 호출 → 정상 동작 확인
- OpenAPI 스펙에 반영 확인

---

### 2. [CRITICAL] CROSSFIN_AGENT_SIGNUP_TOKEN 시크릿 설정

**현상**: Cloudflare Workers secrets에 `CROSSFIN_AGENT_SIGNUP_TOKEN`이 미설정. 에이전트 자가등록(`POST /api/agents/register`)이 503으로 차단된 상태.

**변경 내용**:
- Cloudflare Workers에 시크릿 추가: `CROSSFIN_AGENT_SIGNUP_TOKEN`
- 값: 32자 이상 랜덤 토큰 생성

**설정 명령**:
```bash
cd apps/api
# 토큰 생성
TOKEN=$(openssl rand -hex 32)
echo "Generated token: $TOKEN"

# Cloudflare secret 등록
echo "$TOKEN" | npx wrangler secret put CROSSFIN_AGENT_SIGNUP_TOKEN
```

**검증**:
- 토큰 없이 등록 → 401 반환 확인
- 올바른 토큰으로 등록 → 201 + API 키 발급 확인
- 잘못된 토큰 → 401 반환 확인
- IP 레이트리밋 동작 확인 (60분 내 3회 초과 시 429)

**주의**: 토큰 값을 WALLETS.md처럼 파일에 저장하지 말 것. 필요 시 `wrangler secret list`로 존재 여부만 확인.

---

### 3. [HIGH] 레거시 평문 API 키 정리

**현상**: `agentAuth` 미들웨어가 SHA-256 해시 매칭 실패 시 평문 키로 폴백 조회. DB에 해시 안 된 키가 남아있을 가능성.

**파일**: `apps/api/src/index.ts` (line ~3376-3395)

**변경 내용**:
- D1 마이그레이션 스크립트 추가: 평문 키를 일괄 해시로 변환
- 평문 폴백 코드에 deprecation 경고 로그 추가
- 향후 v1.11.0에서 평문 폴백 완전 제거 예정 (이번 패치에서는 유지)

**마이그레이션 SQL** (`migrations/0005_hash_legacy_api_keys.sql`):
```sql
-- 평문 키 식별: cf_ 프리픽스가 있고 64자 hex가 아닌 것
-- 실제 해싱은 Workers 코드에서 수행 (SQL에서 SHA-256 불가)
-- 이 마이그레이션은 마커만 추가
ALTER TABLE agents ADD COLUMN key_migrated_at TEXT;
```

**런타임 마이그레이션**: 기존 평문 폴백 코드에서 마이그레이션 시 `key_migrated_at` 업데이트.

**Before** (line ~3387-3395):
```typescript
if (usedLegacyPlaintextKey) {
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      'UPDATE agents SET api_key = ?, updated_at = datetime("now") WHERE id = ?'
    ).bind(apiKeyHash, agent.id).run().catch((error) => {
      console.error('Failed to migrate legacy agent API key', error)
    })
  )
}
```

**After**:
```typescript
if (usedLegacyPlaintextKey) {
  console.warn(`[DEPRECATION] Agent ${agent.id} used plaintext API key. Auto-migrating to hash.`)
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      'UPDATE agents SET api_key = ?, key_migrated_at = datetime("now"), updated_at = datetime("now") WHERE id = ?'
    ).bind(apiKeyHash, agent.id).run().catch((error) => {
      console.error('Failed to migrate legacy agent API key', error)
    })
  )
}
```

**검증**:
- 기존 에이전트가 있다면 평문 키로 호출 → 정상 + 해시 마이그레이션 확인
- 마이그레이션 후 해시 키로만 인증 → 정상 확인
- `key_migrated_at` 컬럼 업데이트 확인

---

### 4. [MEDIUM] CORS allowHeaders에서 admin 헤더 제거

**현상**: CORS `allowHeaders`에 `X-CrossFin-Admin-Token`이 포함됨. 브라우저에서 admin 토큰을 보낼 수 있는 구조.

**파일**: `apps/api/src/index.ts` (line ~737)

**Before**:
```typescript
allowHeaders: ['Content-Type', 'Authorization', 'X-Agent-Key', 'X-CrossFin-Admin-Token', 'X-CrossFin-Internal', 'PAYMENT-SIGNATURE'],
```

**After**:
```typescript
allowHeaders: ['Content-Type', 'Authorization', 'X-Agent-Key', 'X-CrossFin-Signup-Token', 'PAYMENT-SIGNATURE'],
```

- `X-CrossFin-Admin-Token` 제거 (admin 호출은 서버 사이드에서만)
- `X-CrossFin-Internal` 제거 (불필요)
- `X-CrossFin-Signup-Token` 추가 (에이전트 등록용)

**검증**:
- 브라우저에서 admin 엔드포인트 호출 시 CORS preflight 차단 확인
- Agent 등록 시 signup token 헤더 정상 전달 확인

---

### 5. [MEDIUM] Guardian rule ID 검증 추가

**현상**: `DELETE /api/guardian/rules/:id`에서 ruleId 검증 없이 DB 쿼리 실행.

**파일**: `apps/api/src/index.ts` (line ~9427)

**Before**:
```typescript
const ruleId = c.req.param('id')
await c.env.DB.prepare(
  'UPDATE guardian_rules SET active = 0, ...'
).bind(ruleId).run()
```

**After**:
```typescript
const ruleId = c.req.param('id')?.trim()
if (!ruleId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ruleId)) {
  throw new HTTPException(400, { message: 'Invalid rule ID format' })
}
await c.env.DB.prepare(
  'UPDATE guardian_rules SET active = 0, ...'
).bind(ruleId).run()
```

**검증**:
- 유효한 UUID → 정상 삭제
- 잘못된 형식 → 400 반환
- 빈 값 → 400 반환

---

## 버전 업데이트 체크리스트

AGENTS.md 규칙에 따라 **모든 버전 파일 동시 업데이트** (1.10.0 → 1.10.1):

```
[ ] catalog/crossfin-catalog.json          → apiVersion: "1.10.1"
[ ] apps/mcp-server/package.json           → version: "1.10.1"
[ ] apps/mcp-server/server.json            → version + packages[].version
[ ] apps/mcp-server/package-lock.json      → npm install로 자동
[ ] packages/sdk/package.json              → version: "1.10.1"
[ ] packages/sdk/package-lock.json         → npm install로 자동
[ ] apps/web/public/.well-known/crossfin.json → version + updatedAt
[ ] examples/gpt-actions-schema.yaml       → version
[ ] smithery.yaml                          → crossfin-mcp@1.10.1
[ ] CHANGELOG.md                           → 1.10.1 항목 추가
```

---

## CHANGELOG 초안

```markdown
## [1.10.1] - 2026-02-22

### Security
- **ACP execute/status 엔드포인트에 `agentAuth` 인증 추가** — `POST /api/acp/execute`, `GET /api/acp/executions/:id` 호출 시 `X-Agent-Key` 헤더 필수
- **CORS allowHeaders 강화** — admin 토큰 헤더 제거, signup 토큰 헤더 추가
- **Guardian rule ID UUID 검증 추가** — 잘못된 형식 입력 시 400 반환
- **레거시 평문 API 키 deprecation 경고** — 평문 키 사용 시 콘솔 경고 출력 + `key_migrated_at` 추적

### Changed
- `CROSSFIN_AGENT_SIGNUP_TOKEN` Cloudflare secret 설정 (에이전트 자가등록 활성화)
```

---

## 배포 순서

```bash
# 0. 시크릿 설정 (배포 전)
cd apps/api
TOKEN=$(openssl rand -hex 32) && echo "$TOKEN" | npx wrangler secret put CROSSFIN_AGENT_SIGNUP_TOKEN

# 1. 코드 수정 + 커밋
git add -A && git commit -m "security: harden ACP auth, CORS, key migration (v1.10.1)"

# 2. API 배포
cd apps/api && npx wrangler deploy

# 3. MCP + SDK publish (버전만 변경, 코드 변경 없음)
cd apps/mcp-server && npm run build && npm publish
cd packages/sdk && npm run build && npm publish --access public

# 4. 배포 후 검증
curl -s -o /dev/null -w "%{http_code}" -X POST https://crossfin.dev/api/acp/execute
# 예상: 401 (이전: 400)

curl -s https://crossfin.dev/api/health | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])"
# 예상: 1.10.1
```

---

## 범위 외 (향후 작업)

- v1.11.0: 레거시 평문 키 폴백 완전 제거
- v1.11.0: 무료 티어 일일 호출 한도 (API 키 기반 100건/일)
- v1.11.0: Guardian rules agent 소유권 체크
- 미정: API 키 자동 로테이션 기능
