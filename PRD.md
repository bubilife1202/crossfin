# CrossFin PRD — Guardian Autonomous Growth

> Last updated: 2026-02-18
> Status: Planning locked, implementation pending (target v1.4.0)

---

## 0) Product State (as-is, verified)

Live:
- Dashboard: https://crossfin.dev
- Live demo: https://live.crossfin.dev
- Guide: `GET /api/docs/guide`
- OpenAPI: `GET /api/openapi.json`
- Discovery: `GET /.well-known/crossfin.json`

Current capabilities:
- Registry: 184 services (CrossFin 35 + external 149), verified-only policy
- Paid APIs: 35 x402 endpoints (USDC on Base mainnet), including 4 bundle endpoints + Routing Engine
- Bundle APIs (v1.8.0):
  - `GET /api/premium/morning/brief` ($0.20) — Daily market summary (kimchi + FX + indices + momentum + headlines)
  - `GET /api/premium/crypto/snapshot` ($0.15) — Crypto overview (5-exchange + kimchi + volume + FX)
  - `GET /api/premium/kimchi/stats` ($0.15) — Kimchi premium deep analysis (current + trend + arbitrage signal + cross-exchange)
  - `GET /api/premium/market/korea/stock-brief?stock=005930` ($0.10) — Stock analysis (fundamentals + news + investor flow + disclosures)
- Routing Engine (v1.8.1):
- `GET /api/premium/route/find` ($0.10) — optimal transfer route across 9 exchanges (bridge coin comparison, slippage, fees)
  - `GET /api/route/exchanges` — supported exchanges list (free)
  - `GET /api/route/fees` — fee comparison table (free)
  - `GET /api/route/pairs` — trading pairs with live prices (free)
  - `GET /api/route/status` — exchange health check (free)
- ACP (Agentic Commerce Protocol) compatibility layer (v1.8.1):
  - `POST /api/acp/quote` — request routing quote (free)
  - `POST /api/acp/execute` — execute route (simulation) (free)
  - `GET /api/acp/status` — protocol status + capabilities (free)
- Proxy: `GET/POST /api/proxy/:serviceId` with `X-Agent-Key`
- Analytics: `GET /api/analytics/overview`
- Agent auth: admin-created agent key + API protection
- D1 schema: `agents`, `wallets`, `transactions`, `budgets`, `services`, `service_calls`, `audit_logs`, `kimchi_snapshots`
- MCP server: 16 tools (registry/docs/analytics + local ledger + paid call execution + routing tools)

Known gap:
- No unattended autonomous loop yet (no Cloudflare scheduled handler for operations)
- No external deposit-to-credit flow yet
- No Guardian decision engine yet

---

## 1) One-line Goal

CrossFin evolves from "x402 service gateway" to "autonomous agent operating bank":
agents run continuously under hard risk rules, grow usage, and survive without manual operation.

---

## 2) Product Principles

1. **Agent-first execution**: optimize for machine clients, not manual human flows.
2. **Safety before growth**: Guardian rules can block any action that violates risk policy.
3. **Verified claims only**: no unverified profit narrative; only on-chain proof and measured metrics.
4. **External-value growth**: growth must come from external paid usage, not internal circular transfers.
5. **Minimal irreversible risk**: kill switch, spend caps, and staged rollout are mandatory.

---

## 3) Scope (v1.4.0)

### In scope
- Unattended automation foundation on Cloudflare (cron + scheduled handler)
- Guardian decision engine (ALLOW / SKIP / BLOCK)
- External deposit intake and credit attribution
- MCP paid-call execution tool
- Live dashboard survival metrics and payment event feed
- Agent growth funnel instrumentation

### Out of scope (for this release)
- Full `POST /api/pay` settlement delegation to upstream providers
- Multi-rail fiat integrations (Stripe/KakaoPay/Toss)
- Agent credit score / lending
- Guaranteed return claims or trading-alpha promises

---

## 4) User + System Jobs

### Primary users
- Autonomous agents (programmatic clients)
- Agent operators (configure policy, not manual every-call control)

### Jobs to be done
1. Agent discovers useful services quickly.
2. Agent can pay and execute safely without manual signing loops.
3. System enforces spend/risk policy automatically.
4. Operator can verify health, growth, and on-chain proof in real time.

---

## 5) Strategy: Three Engines

### Engine A — Execution (run unattended)
- Cloudflare cron triggers call scheduled handler.
- Runner executes cycle only when preconditions are satisfied.
- Result events are persisted and observable.

### Engine B — Guardian (decide safely)
- Every action passes rule checks before execution.
- Rule failure returns explicit reason codes.
- Emergency kill switch halts spend immediately.

### Engine C — Growth (compound usage)
- Better service quality ranking -> better discovery -> more successful calls -> stronger ranking.
- Agent activation funnel measured end-to-end.
- Registry hygiene auto-disables dead providers to protect trust.

---

## 6) Detailed Requirements

## 6.1 Automation Foundation

### Requirement
Run core operations without human triggers.

### Changes
- Add cron triggers in `apps/api/wrangler.toml`
  - `*/5 * * * *` survival cycle
  - `*/2 * * * *` deposit reconcile
  - `*/30 * * * *` external service health check
- Add Worker `scheduled` handler in `apps/api/src/index.ts`
- Add execution lock (single-cycle concurrency control)

### Acceptance
- 72h unattended run with no double-execution
- all cycles recorded with state (`success`, `skipped`, `blocked`, `error`)

## 6.2 Guardian Decision Engine

### Requirement
Every spend-related action must be explicitly allowed by deterministic rules.

### Rule set (minimum)
1. `KILL_SWITCH_ON` -> BLOCK
2. `NO_PREPAY_CREDIT` -> BLOCK
3. `NEGATIVE_EXPECTED_MARGIN` -> SKIP
4. `DAILY_LIMIT_EXCEEDED` or `MONTHLY_LIMIT_EXCEEDED` -> BLOCK
5. `FAIL_STREAK_EXCEEDED` -> BLOCK + cooldown
6. `SERVICE_CIRCUIT_OPEN` -> SKIP
7. Otherwise -> ALLOW

### Response contract
- `decision`: `ALLOW | SKIP | BLOCK`
- `reasonCode`: machine-readable string
- `detail`: numeric context (spend, limit, margin, fail streak)

### Acceptance
- Integration tests validate each reason code path
- Budget overage never executes downstream call

## 6.3 External Deposit -> Agent Credit

### Requirement
Accept external funding and map it to agent spendable credits.

### New API
- `POST /api/deposits` (`X-Agent-Key`): submit `txHash`
- `GET /api/deposits`: list agent deposit history
- `GET /api/balance`: current spendable credit and limits

### Verification flow
1. Validate tx hash format
2. Verify on-chain receipt and USDC transfer to configured receiver address
3. Deduplicate by `tx_hash` unique key
4. Credit wallet balance and append transaction log atomically

### Acceptance
- Duplicate tx cannot be credited twice
- Invalid transfer cannot be credited
- Valid transfer updates balance and appears in history

## 6.4 MCP Paid Execution

### Requirement
Agents can execute paid calls through MCP directly.

### New MCP tool
- `call_paid_service`
  - input: `serviceId`, optional params/body
  - actions: service lookup -> guardian pre-check -> x402 paid fetch -> structured result
  - output: response payload + payment metadata + trace fields

### Dependencies
- Add MCP dependencies: `@x402/fetch`, `@x402/evm`, `@x402/core`, `viem`
- Require runtime env: `EVM_PRIVATE_KEY`

### Acceptance
- One paid endpoint call succeeds via MCP end-to-end
- Payment metadata available for proof rendering

## 6.5 Live Survival Dashboard

### Requirement
Make autonomous health obvious in one screen.

### New panels on `live.crossfin.dev`
- Alive state (`ALIVE` / `DEGRADED` / `STOPPED`)
- Reserve, spend/day, income/day, net/day
- Runway estimate
- Recent payment/deposit events with scan links
- Guardian decisions feed (reason code visible)

### Acceptance
- Dashboard updates from API every refresh interval
- Operator can diagnose why a cycle was blocked without log digging

## 6.6 Growth Flywheel Instrumentation

### Requirement
Measure growth with causal metrics, not narrative claims.

### Tracked funnel
1. Discovery (`/api/registry*`, `/.well-known/crossfin.json`)
2. Activation (`POST /api/agents/register` or equivalent onboarding action)
3. First paid call (within 24h)
4. 7-day retained agent

### Core growth metrics
- Active agents (7d)
- Paid calls/day
- Success rate
- Median response time
- Reserve growth rate
- 7-day retention

---

## 7) Data Model Additions (v1.4.0)

New tables (minimum):
- `deposits` (tx hash, chain, sender, amount, status, verified_at)
- `guardian_events` (decision, reason_code, detail, cycle_id, created_at)
- `automation_runs` (job type, state, lock key, started_at, finished_at)

Indexes:
- `deposits(tx_hash)` unique
- `guardian_events(agent_id, created_at)`
- `automation_runs(job_type, started_at)`

Note:
- Keep existing `wallets`, `transactions`, `budgets`, `service_calls` as source of truth for spending and usage.

---

## 8) Rollout Plan

### Stage 0 — Shadow (no spend)
- Run scheduler + guardian in dry mode
- record decisions only
- duration: 2-3 days

### Stage 1 — Low-risk spend
- enable limited spend caps
- only low-price endpoints
- strict kill-switch monitoring

### Stage 2 — Full autonomous loop
- enable full cycle with deposit credit + paid execution
- growth instrumentation active

### Stage 3 — Scale and optimize
- tighten quality ranking
- expand service supply and agent onboarding channels

Rollback trigger (any stage):
- repeated unknown error loops
- incorrect credit attribution
- guardian bypass detected

---

## 9) Operations and Incident Policy

### Must-have safeguards
- Global kill switch (admin protected)
- Per-agent daily/monthly caps
- Fail streak breaker
- Circuit open for unhealthy external services

### Incident levels
- **P0**: unsafe spend or credit mismatch -> immediate stop + rollback window
- **P1**: automation stuck or repeated block loops -> degrade mode
- **P2**: dashboard/analytics lag -> keep execution but alert operator

---

## 10) Success Criteria (Definition of Done)

Product is considered successful when all are true:
1. Cron-driven jobs run unattended for 72h.
2. Guardian blocks unsafe actions with explicit reason codes.
3. External deposit credit attribution is correct and idempotent.
4. MCP paid-call tool works in production flow.
5. Live dashboard shows survival and guardian evidence in real time.
6. Growth funnel metrics are queryable and tracked daily.

---

## 11) Timeline (execution-first)

Week 1:
- cron + scheduled handler
- guardian core checks
- deposit schema + endpoints

Week 2:
- MCP `call_paid_service`
- live survival panels
- growth funnel metrics pipeline

Week 3:
- hardening (locks, retries, runbook)
- production rehearsal + demo assets

---

## 12) Demo Narrative (Hashed submission)

Message:
- "Agent profit promise"가 아니라,
- **"Agent autonomous survival infrastructure"**를 증명한다.

Proof package:
1. autonomous cycle execution logs
2. guardian decision traces
3. on-chain payment/deposit links
4. survival metric trend (reserve/runway/net)

---

## Appendix A — Explicit Non-Claims

- We do not claim guaranteed returns.
- We do not treat unverified viral stories as product evidence.
- We do not run autonomous spend without enforceable guardrails.
