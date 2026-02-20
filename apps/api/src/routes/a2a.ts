import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../types'

// ---------------------------------------------------------------------------
// A2A (Agent-to-Agent) Protocol — JSON-RPC-style task management
// Google A2A spec: agents create tasks, poll status, cancel.
// Each task maps a skill + freeform message to a CrossFin API call.
// ---------------------------------------------------------------------------

const a2a = new Hono<Env>()

const A2A_MAX_BODY_BYTES = 8 * 1024
const A2A_MAX_MESSAGE_CHARS = 2_000
const A2A_MAX_SKILL_CHARS = 64

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function taskId(): string {
  return `a2a_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

async function ensureA2aTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS a2a_tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'working' CHECK (status IN ('working','completed','failed','canceled')),
      skill TEXT,
      message TEXT NOT NULL,
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run()
}

// ---------------------------------------------------------------------------
// Skill dispatch — maps A2A skill id to a CrossFin API call
// ---------------------------------------------------------------------------

type SkillResult = { data: unknown; error?: undefined } | { error: string; data?: undefined }

async function dispatchSkill(
  skill: string | undefined,
  message: string,
  origin: string,
): Promise<SkillResult> {
  const resolved = skill ?? inferSkill(message)

  switch (resolved) {
    case 'crypto-routing': {
      // Parse simple natural language: "from bithumb:KRW to binance:USDC amount 5000000"
      const from = extractParam(message, 'from') ?? 'bithumb:KRW'
      const to = extractParam(message, 'to') ?? 'binance:USDC'
      const amount = extractParam(message, 'amount') ?? '1000000'
      const strategy = extractParam(message, 'strategy') ?? 'cheapest'
      const url = `${origin}/api/routing/optimal?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&amount=${encodeURIComponent(amount)}&strategy=${encodeURIComponent(strategy)}`
      return fetchInternal(url)
    }

    case 'route-spread': {
      const url = `${origin}/api/arbitrage/demo`
      return fetchInternal(url)
    }

    case 'korean-market-data': {
      const url = `${origin}/api/route/pairs`
      return fetchInternal(url)
    }

    case 'agent-finance': {
      const url = `${origin}/api/acp/status`
      return fetchInternal(url)
    }

    default:
      return { error: `Unknown skill: ${resolved ?? '(none)'}. Available skills: crypto-routing, route-spread, korean-market-data, agent-finance` }
  }
}

function inferSkill(message: string): string | undefined {
  const lower = message.toLowerCase()
  if (lower.includes('route') || lower.includes('routing') || lower.includes('transfer') || lower.includes('send')) return 'crypto-routing'
  if (lower.includes('spread') || lower.includes('kimchi') || lower.includes('premium') || lower.includes('arbitrage')) return 'route-spread'
  if (lower.includes('market') || lower.includes('korea') || lower.includes('kospi') || lower.includes('stock') || lower.includes('price')) return 'korean-market-data'
  if (lower.includes('wallet') || lower.includes('budget') || lower.includes('agent') || lower.includes('acp') || lower.includes('finance')) return 'agent-finance'
  return undefined
}

function extractParam(text: string, key: string): string | undefined {
  // Match "key value" or "key=value" or "key:value"
  const regex = new RegExp(`${key}[=:\\s]+([^\\s,]+)`, 'i')
  const match = text.match(regex)
  return match?.[1]
}

async function fetchInternal(url: string): Promise<SkillResult> {
  try {
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'CrossFin-A2A/1.0' },
    })
    if (!resp.ok) {
      const text = await resp.text()
      return { error: `Upstream ${resp.status}: ${text.slice(0, 500)}` }
    }
    const data = await resp.json()
    return { data }
  } catch (err) {
    return { error: `Internal fetch failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// ---------------------------------------------------------------------------
// POST /tasks — Create a new A2A task
// ---------------------------------------------------------------------------

a2a.post('/tasks', async (c) => {
  const contentLengthHeader = c.req.header('content-length')
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader)
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new HTTPException(400, { message: 'Invalid Content-Length header' })
    }
    if (contentLength > A2A_MAX_BODY_BYTES) {
      throw new HTTPException(413, { message: 'Request body too large' })
    }
  }

  let rawBody = ''
  try {
    rawBody = await c.req.text()
  } catch {
    throw new HTTPException(400, { message: 'Invalid request body' })
  }

  const bodyBytes = new TextEncoder().encode(rawBody).length
  if (bodyBytes > A2A_MAX_BODY_BYTES) {
    throw new HTTPException(413, { message: 'Request body too large' })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HTTPException(400, { message: 'JSON body must be an object' })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    throw new HTTPException(400, { message: 'message is required (string)' })
  }
  if (message.length > A2A_MAX_MESSAGE_CHARS) {
    throw new HTTPException(413, { message: `message is too long (max ${A2A_MAX_MESSAGE_CHARS} chars)` })
  }

  const skill = typeof body.skill === 'string' ? body.skill.trim() : undefined
  if (skill && skill.length > A2A_MAX_SKILL_CHARS) {
    throw new HTTPException(400, { message: `skill is too long (max ${A2A_MAX_SKILL_CHARS} chars)` })
  }
  const origin = new URL(c.req.url).origin

  await ensureA2aTable(c.env.DB)

  const id = taskId()
  const now = new Date().toISOString()

  // Insert task as "working"
  await c.env.DB.prepare(
    `INSERT INTO a2a_tasks (id, status, skill, message, created_at, updated_at)
     VALUES (?, 'working', ?, ?, ?, ?)`,
  ).bind(id, skill ?? null, message, now, now).run()

  // Dispatch skill synchronously (CrossFin APIs are fast)
  const result = await dispatchSkill(skill, message, origin)
  const finalStatus = result.error ? 'failed' : 'completed'
  const resultJson = JSON.stringify(result.error ? { error: result.error } : result.data)

  await c.env.DB.prepare(
    `UPDATE a2a_tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?`,
  ).bind(finalStatus, resultJson, new Date().toISOString(), id).run()

  return c.json({
    protocol: 'a2a',
    version: '1.0',
    taskId: id,
    status: finalStatus,
    skill: skill ?? inferSkill(message) ?? null,
    result: result.error ? { error: result.error } : result.data,
    created_at: now,
  })
})

// ---------------------------------------------------------------------------
// GET /tasks/:id — Get task status / result
// ---------------------------------------------------------------------------

a2a.get('/tasks/:id', async (c) => {
  const id = c.req.param('id')

  await ensureA2aTable(c.env.DB)

  const row = await c.env.DB.prepare(
    `SELECT id, status, skill, message, result, created_at, updated_at FROM a2a_tasks WHERE id = ?`,
  ).bind(id).first<{
    id: string
    status: string
    skill: string | null
    message: string
    result: string | null
    created_at: string
    updated_at: string
  }>()

  if (!row) {
    throw new HTTPException(404, { message: `Task not found: ${id}` })
  }

  let parsedResult: unknown = null
  if (row.result) {
    try { parsedResult = JSON.parse(row.result) } catch { parsedResult = row.result }
  }

  return c.json({
    protocol: 'a2a',
    version: '1.0',
    taskId: row.id,
    status: row.status,
    skill: row.skill,
    message: row.message,
    result: parsedResult,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })
})

// ---------------------------------------------------------------------------
// POST /tasks/:id/cancel — Cancel a task
// ---------------------------------------------------------------------------

a2a.post('/tasks/:id/cancel', async (c) => {
  const id = c.req.param('id')

  await ensureA2aTable(c.env.DB)

  const row = await c.env.DB.prepare(
    `SELECT id, status FROM a2a_tasks WHERE id = ?`,
  ).bind(id).first<{ id: string; status: string }>()

  if (!row) {
    throw new HTTPException(404, { message: `Task not found: ${id}` })
  }

  if (row.status === 'completed' || row.status === 'failed') {
    return c.json({
      protocol: 'a2a',
      version: '1.0',
      taskId: id,
      status: row.status,
      message: `Task already ${row.status}, cannot cancel`,
    })
  }

  await c.env.DB.prepare(
    `UPDATE a2a_tasks SET status = 'canceled', updated_at = ? WHERE id = ?`,
  ).bind(new Date().toISOString(), id).run()

  return c.json({
    protocol: 'a2a',
    version: '1.0',
    taskId: id,
    status: 'canceled',
  })
})

export default a2a
