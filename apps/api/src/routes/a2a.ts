import { Hono, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env, A2aSkillHandler } from '../types'

// ---------------------------------------------------------------------------
// A2A (Agent-to-Agent) Protocol — JSON-RPC-style task management
// Google A2A spec: agents create tasks, poll status, cancel.
// Each task maps a skill + freeform message to a CrossFin API call.
//
// Skill dispatch is injected via Hono context middleware (index.ts) to avoid
// self-fetch on Cloudflare Workers, which would receive an HTML challenge page
// instead of JSON.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// A2A Rate Limiter — IP-based, in-memory per isolate
// ---------------------------------------------------------------------------
const A2A_RATE_LIMIT_WINDOW_MS = 60_000
const A2A_RATE_LIMIT_MAX_REQUESTS = 30
const A2A_RATE_LIMIT_MAX_BUCKETS = 10_000
const a2aRateBuckets = new Map<string, { count: number; windowStartedAt: number }>()

function pruneA2aRateBuckets(): void {
  if (a2aRateBuckets.size < A2A_RATE_LIMIT_MAX_BUCKETS) return
  const cutoff = Date.now() - A2A_RATE_LIMIT_WINDOW_MS * 2
  for (const [key, bucket] of a2aRateBuckets.entries()) {
    if (bucket.windowStartedAt < cutoff) a2aRateBuckets.delete(key)
  }
}

const a2aRateLimiter: MiddlewareHandler<Env> = async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const now = Date.now()
  pruneA2aRateBuckets()

  const existing = a2aRateBuckets.get(ip)
  if (existing && now - existing.windowStartedAt < A2A_RATE_LIMIT_WINDOW_MS) {
    existing.count++
    if (existing.count > A2A_RATE_LIMIT_MAX_REQUESTS) {
      throw new HTTPException(429, { message: 'A2A rate limit exceeded. Try again later.' })
    }
  } else {
    a2aRateBuckets.set(ip, { count: 1, windowStartedAt: now })
  }

  await next()
}

// ---------------------------------------------------------------------------
// Optional agent auth — extracts agent identity if X-Agent-Key is provided.
// Tasks are scoped to the creator's agent ID when authenticated.
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

let a2aTableReady: Promise<void> | null = null
async function ensureA2aTable(db: D1Database): Promise<void> {
  if (!a2aTableReady) {
    a2aTableReady = (async () => {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS a2a_tasks (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'working' CHECK (status IN ('working','completed','failed','canceled')),
          skill TEXT,
          message TEXT NOT NULL,
          result TEXT,
          creator_ip TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run()
      // Migrate: add creator_ip column if table existed before this version
      await db.prepare(`ALTER TABLE a2a_tasks ADD COLUMN creator_ip TEXT`).run().catch(() => {
        // Column already exists — ignore
      })
    })().catch(() => { a2aTableReady = null })
  }
  return a2aTableReady
}

/** Trusted client IP — only CF-Connecting-IP is trusted for access-control scoping. */
function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('CF-Connecting-IP') ?? 'unknown'
}

// ---------------------------------------------------------------------------
// Skill inference — resolves freeform message to a skill id
// ---------------------------------------------------------------------------

function inferSkill(message: string): string | undefined {
  const lower = message.toLowerCase()
  if (lower.includes('route') || lower.includes('routing') || lower.includes('transfer') || lower.includes('send')) return 'crypto-routing'
  if (lower.includes('spread') || lower.includes('kimchi') || lower.includes('premium') || lower.includes('arbitrage')) return 'route-spread'
  if (lower.includes('market') || lower.includes('korea') || lower.includes('kospi') || lower.includes('stock') || lower.includes('price')) return 'korean-market-data'
  if (lower.includes('wallet') || lower.includes('budget') || lower.includes('agent') || lower.includes('acp') || lower.includes('finance')) return 'agent-finance'
  return undefined
}

// ---------------------------------------------------------------------------
// POST /tasks — Create a new A2A task
// ---------------------------------------------------------------------------

a2a.post('/tasks', a2aRateLimiter, async (c) => {
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

  // Get injected skill handler from middleware (avoids self-fetch on CF Workers)
  const skillHandler = c.get('a2aSkillHandler') as A2aSkillHandler | undefined
  if (!skillHandler) {
    throw new HTTPException(500, { message: 'A2A skill handler not configured' })
  }

  await ensureA2aTable(c.env.DB)

  const id = taskId()
  const now = new Date().toISOString()
  const clientIp = getClientIp(c)

  // Resolve skill from explicit parameter or message inference
  const resolvedSkill = skill ?? inferSkill(message)

  // Insert task as "working"
  await c.env.DB.prepare(
    `INSERT INTO a2a_tasks (id, status, skill, message, creator_ip, created_at, updated_at)
     VALUES (?, 'working', ?, ?, ?, ?, ?)`,
  ).bind(id, skill ?? null, message, clientIp, now, now).run()

  // Dispatch skill via injected handler (direct function call, no HTTP)
  const result = await skillHandler(resolvedSkill, message)
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
    skill: resolvedSkill ?? null,
    result: result.error ? { error: result.error } : result.data,
    created_at: now,
  })
})

// ---------------------------------------------------------------------------
// GET /tasks/:id — Get task status / result
// ---------------------------------------------------------------------------

a2a.get('/tasks/:id', a2aRateLimiter, async (c) => {
  const id = c.req.param('id')

  await ensureA2aTable(c.env.DB)

  const row = await c.env.DB.prepare(
    `SELECT id, status, skill, message, result, creator_ip, created_at, updated_at FROM a2a_tasks WHERE id = ?`,
  ).bind(id).first<{
    id: string
    status: string
    skill: string | null
    message: string
    result: string | null
    creator_ip: string | null
    created_at: string
    updated_at: string
  }>()

  if (!row) {
    throw new HTTPException(404, { message: `Task not found: ${id}` })
  }

  // Scope task access to creator IP (best-effort without auth)
  const clientIp = getClientIp(c)
  if (row.creator_ip && row.creator_ip !== clientIp) {
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

a2a.post('/tasks/:id/cancel', a2aRateLimiter, async (c) => {
  const id = c.req.param('id')

  await ensureA2aTable(c.env.DB)

  const row = await c.env.DB.prepare(
    `SELECT id, status, creator_ip FROM a2a_tasks WHERE id = ?`,
  ).bind(id).first<{ id: string; status: string; creator_ip: string | null }>()

  if (!row) {
    throw new HTTPException(404, { message: `Task not found: ${id}` })
  }

  // Scope cancel access to creator IP
  const clientIp = getClientIp(c)
  if (row.creator_ip && row.creator_ip !== clientIp) {
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
