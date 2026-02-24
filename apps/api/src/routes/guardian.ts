import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../types'

function safeJsonParse(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try { return JSON.parse(value) as Record<string, unknown> } catch { return {} }
}

type GuardianDeps = {
  agentAuth: MiddlewareHandler<Env>
  requireGuardianEnabled: (c: Context<Env>) => void
  requireAdmin: (c: Context<Env>) => void
  audit: typeof import('../lib/helpers').audit
}

export function createGuardianRoutes(deps: GuardianDeps): Hono<Env> {
  const guardian = new Hono<Env>()

  guardian.get('/api/guardian/rules', deps.agentAuth, async (c) => {
    deps.requireGuardianEnabled(c)
    const requesterAgentId = c.get('agentId')
    const requestedAgentId = (c.req.query('agent_id') ?? '').trim()
    if (requestedAgentId && requestedAgentId !== requesterAgentId) {
      throw new HTTPException(403, { message: 'Forbidden' })
    }

    const targetAgentId = requestedAgentId || requesterAgentId
    const stmt = c.env.DB.prepare(
      "SELECT * FROM guardian_rules WHERE active = 1 AND (agent_id IS NULL OR agent_id = ?) ORDER BY type, created_at DESC"
    ).bind(targetAgentId)
    const { results } = await stmt.all()
    return c.json({
      rules: (results ?? []).map((r: any) => ({
        ...r,
        params: safeJsonParse(r.params),
      })),
      at: new Date().toISOString(),
    })
  })

  guardian.post('/api/guardian/rules', async (c) => {
    deps.requireGuardianEnabled(c)
    deps.requireAdmin(c)
    const body = await c.req.json<{
      agent_id?: string | null
      type: string
      params?: Record<string, unknown>
    }>()

    const validTypes = ['SPEND_CAP', 'FAIL_STREAK', 'CIRCUIT_BREAKER', 'KILL_SWITCH']
    if (!validTypes.includes(body.type)) {
      throw new HTTPException(400, { message: `type must be one of: ${validTypes.join(', ')}` })
    }

    const id = crypto.randomUUID()
    await c.env.DB.prepare(
      'INSERT INTO guardian_rules (id, agent_id, type, params) VALUES (?, ?, ?, ?)'
    ).bind(id, body.agent_id ?? null, body.type, JSON.stringify(body.params ?? {})).run()

    await deps.audit(c.env.DB, null, 'guardian.rule.create', 'guardian_rules', id, 'success', `type=${body.type}`)
    return c.json({ id, type: body.type, params: body.params ?? {} }, 201)
  })

  guardian.delete('/api/guardian/rules/:id', async (c) => {
    deps.requireGuardianEnabled(c)
    deps.requireAdmin(c)
    const ruleId = c.req.param('id')?.trim()
    if (!ruleId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ruleId)) {
      throw new HTTPException(400, { message: 'Invalid rule ID format' })
    }
    await c.env.DB.prepare(
      'UPDATE guardian_rules SET active = 0, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(ruleId).run()
    await deps.audit(c.env.DB, null, 'guardian.rule.deactivate', 'guardian_rules', ruleId, 'success')
    return c.json({ ok: true, deactivated: ruleId })
  })

  guardian.get('/api/guardian/status', deps.agentAuth, async (c) => {
    deps.requireGuardianEnabled(c)
    const agentId = c.get('agentId')

    const [rules, recentActions, spendToday] = await Promise.all([
      c.env.DB.prepare(
        "SELECT id, agent_id, type, params, created_at FROM guardian_rules WHERE active = 1 AND (agent_id IS NULL OR agent_id = ?) ORDER BY created_at DESC LIMIT 20"
      ).bind(agentId).all(),
      c.env.DB.prepare(
        "SELECT id, agent_id, action_type, decision, confidence, cost_usd, rule_applied, details, created_at FROM autonomous_actions WHERE agent_id = ? ORDER BY created_at DESC LIMIT 30"
      ).bind(agentId).all(),
      c.env.DB.prepare(
        "SELECT agent_id, SUM(amount_usd) as total FROM agent_spend WHERE agent_id = ? AND created_at >= datetime('now', '-1 day') GROUP BY agent_id"
      ).bind(agentId).all(),
    ])

    const blockedCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM autonomous_actions WHERE agent_id = ? AND decision = 'BLOCK' AND created_at >= datetime('now', '-1 day')"
    ).bind(agentId).first<{ cnt: number }>()

    return c.json({
      guardian: {
        activeRules: (rules.results ?? []).length,
        rules: (rules.results ?? []).map((r: any) => ({
          id: r.id,
          agentId: r.agent_id,
          type: r.type,
          params: safeJsonParse(r.params),
          createdAt: r.created_at,
        })),
        blockedToday: blockedCount?.cnt ?? 0,
        agentSpendToday: (spendToday.results ?? []).map((s: any) => ({
          agentId: s.agent_id,
          totalUsd: s.total,
        })),
      },
      recentActions: (recentActions.results ?? []).map((a: any) => ({
        id: a.id,
        agentId: a.agent_id,
        actionType: a.action_type,
        decision: a.decision,
        confidence: a.confidence,
        costUsd: a.cost_usd,
        ruleApplied: a.rule_applied,
        details: safeJsonParse(a.details),
        createdAt: a.created_at,
      })),
      at: new Date().toISOString(),
    })
  })

  return guardian
}
