# Root Cause Remediation Plan (v1.13.0)

Date: 2026-02-22
Scope: API reliability and maintainability hardening

## Why this plan exists

Recent production incidents and audits revealed three structural risks:

1. `apps/api/src/index.ts` monolith complexity (~10k lines) increases regression risk.
2. Some upstream dependency failures can degrade route quality silently.
3. FX conversion depended heavily on a single source and hardcoded fallback behavior.

This plan is incremental (no big-bang rewrite), production-safe, and verifiable per phase.

## Root causes

### R1. Monolithic API composition
- Symptom: one large file handles route registration, helper logic, and business flow.
- Risk: difficult review boundaries, fragile edits, higher blast radius per change.

### R2. Weak failure isolation semantics
- Symptom: endpoints continue with fallback values but do not always surface fallback context consistently.
- Risk: consumers can misread stale/fallback output as fully live output.

### R3. FX source dependency concentration
- Symptom: prior FX flow depended primarily on `open.er-api.com`.
- Risk: source outage causes stale/hardcoded conversions with reduced transparency.

## Implementation phases

### Phase 1 (Immediate): FX redundancy + transparent fallback metadata
Status: In progress (implemented in this cycle)

Changes:
- Add FX source cascade in `fetchUsdFxRates()`:
  - `open.er-api.com`
  - `exchangerate.host`
  - `fawazahmed0/currency-api`
  - stale cache fallback
  - hardcoded fallback as last resort
- Track FX source in cache metadata.
- Return explicit `source` and `isFallback` via `fetchFxRatesWithMeta()`.
- Use FX meta in routing core (`findOptimalRoute`) to surface:
  - `priceAge.fxRates`
  - `dataFreshness: 'fallback'` when applicable
  - `warnings` when fallback is active
- Update `/api/premium/market/fx/usdkrw` response to include real source and fallback/warnings.

Acceptance criteria:
- Routing endpoints still respond successfully.
- FX endpoint returns source-aware payload.
- When primary FX source fails, service continues with alternate source or explicit fallback metadata.

### Phase 2 (Short-term): route-group extraction with zero behavior change
Status: Planned

Order:
1. Extract discovery/legal routes.
2. Extract analytics routes.
3. Extract routing route group.

Rules:
- No schema changes in responses.
- No middleware order changes.
- One route-group extraction per PR.

Acceptance criteria:
- All existing endpoint contract tests pass.
- `index.ts` line count reduced each phase.

### Phase 3 (Medium-term): premium/registry modular split
Status: Planned

Goals:
- Move premium market routes and registry/proxy routes to dedicated modules.
- Extract shared helpers/types to avoid duplicated inline logic.

Acceptance criteria:
- Production behavior unchanged.
- Route-level ownership and reviewability improved.

## Operational verification checklist

1. Typecheck: `apps/api`, `apps/web`, `apps/live`, `apps/mcp-server`
2. Build: `apps/web`, `apps/docs`
3. API smoke:
   - `/api/health`
   - `/api/route/exchanges`
   - `/api/routing/optimal`
   - `/api/premium/route/find`
   - `/api/premium/market/fx/usdkrw`
   - `/api/a2a/tasks`
4. Production page checks:
   - `crossfin.dev`
   - `live.crossfin.dev`
   - `docs.crossfin.dev`

## Non-goals (for this cycle)

- No full rewrite of API architecture.
- No infrastructure migration.
- No protocol/billing model change (open-beta free mode remains).
