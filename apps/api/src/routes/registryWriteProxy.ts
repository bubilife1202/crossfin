import { Hono, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../types'

type MappedRegistryService = {
  id: string
  method: string
  endpoint: string
}

type RegistryWriteProxyDeps = {
  agentAuth: MiddlewareHandler<Env>
  ensureRegistrySeeded: (db: D1Database, paymentReceiverAddress: string) => Promise<void>
  requireRegistryProvider: (value: string | undefined) => string
  requireRegistryCategory: (value: string | undefined) => string
  requirePublicHttpsUrl: (value: string) => Promise<string>
  normalizeMethod: (method: string | undefined) => string
  mapServiceRow: (row: Record<string, unknown>) => MappedRegistryService
  toServiceResponse: (row: Record<string, unknown>) => unknown
  assertPublicHostname: (url: URL) => void
  assertHostnameResolvesToPublicIp: (hostnameRaw: string) => Promise<void>
  buildProxyResponseHeaders: (upstreamHeaders: Headers) => Headers
  audit: typeof import('../lib/helpers').audit
}

export function createRegistryWriteProxyRoutes(deps: RegistryWriteProxyDeps): Hono<Env> {
  const routes = new Hono<Env>()

  routes.post('/api/registry', deps.agentAuth, async (c) => {
    await deps.ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

    const agentId = c.get('agentId')
    const body = await c.req.json<{
      name?: string
      description?: string | null
      provider?: string
      category?: string
      endpoint?: string
      method?: string
      price?: string
      currency?: string
      network?: string | null
      payTo?: string | null
      tags?: unknown
      inputSchema?: unknown
      outputExample?: unknown
    }>()

    const name = body.name?.trim() ?? ''
    const provider = deps.requireRegistryProvider(body.provider)
    const category = deps.requireRegistryCategory(body.category)
    const endpoint = body.endpoint ? await deps.requirePublicHttpsUrl(body.endpoint) : ''
    const price = body.price?.trim() ?? ''
    const currency = (body.currency?.trim() ?? 'USDC') || 'USDC'

    if (!name) throw new HTTPException(400, { message: 'name is required' })
    if (!endpoint) throw new HTTPException(400, { message: 'endpoint is required' })
    if (!price) throw new HTTPException(400, { message: 'price is required' })

    const tags = Array.isArray(body.tags)
      ? body.tags.filter((t): t is string => typeof t === 'string').slice(0, 20)
      : []

    const id = crypto.randomUUID()
    const method = deps.normalizeMethod(body.method)
    const status = 'active'

    await c.env.DB.prepare(
      `INSERT INTO services
        (id, name, description, provider, category, endpoint, method, price, currency, network, pay_to, tags, input_schema, output_example, status, is_crossfin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).bind(
      id,
      name,
      body.description ?? null,
      provider,
      category,
      endpoint,
      method,
      price,
      currency,
      body.network ?? null,
      body.payTo ?? null,
      tags.length ? JSON.stringify(tags) : null,
      body.inputSchema ? JSON.stringify(body.inputSchema) : null,
      body.outputExample ? JSON.stringify(body.outputExample) : null,
      status,
    ).run()

    await deps.audit(c.env.DB, agentId, 'service.create', 'services', id, 'success')

    const created = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(id).first<Record<string, unknown>>()
    return c.json({ data: created ? deps.toServiceResponse(created) : { id } }, 201)
  })

  async function proxyToService(c: Parameters<MiddlewareHandler<Env>>[0], method: 'GET' | 'POST'): Promise<Response> {
    await deps.ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

    const agentId = c.get('agentId')
    if (!agentId) throw new HTTPException(401, { message: 'Missing X-Agent-Key header' })

    const serviceId = c.req.param('serviceId')
    const row = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(serviceId).first<Record<string, unknown>>()
    if (!row) throw new HTTPException(404, { message: 'Service not found' })

    const service = deps.mapServiceRow(row)

    if (service.method !== 'UNKNOWN' && service.method !== method) {
      throw new HTTPException(405, { message: `Method not allowed (expected ${service.method})` })
    }

    const proxyMaxBodyBytes = 512 * 1024
    const proxyRateLimitPerMinutePerService = 60
    const proxyRateLimitPerMinutePerAgent = 240
    const proxyUpstreamTimeoutMs = 10_000

    const [serviceWindowRow, agentWindowRow] = await c.env.DB.batch([
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM service_calls WHERE agent_id = ? AND service_id = ? AND created_at >= datetime('now', '-60 seconds')"
      ).bind(agentId, service.id),
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM service_calls WHERE agent_id = ? AND created_at >= datetime('now', '-60 seconds')"
      ).bind(agentId),
    ])

    const countService = Number(((serviceWindowRow?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
    const countAgent = Number(((agentWindowRow?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
    if (countService >= proxyRateLimitPerMinutePerService || countAgent >= proxyRateLimitPerMinutePerAgent) {
      throw new HTTPException(429, { message: 'Rate limited' })
    }

    let upstreamUrl: URL
    try {
      upstreamUrl = new URL(service.endpoint)
    } catch {
      throw new HTTPException(500, { message: 'Service endpoint is not a valid URL' })
    }

    try {
      deps.assertPublicHostname(upstreamUrl)
      await deps.assertHostnameResolvesToPublicIp(upstreamUrl.hostname)
    } catch {
      throw new HTTPException(502, { message: 'Service endpoint blocked' })
    }

    const incomingUrl = new URL(c.req.url)
    for (const [key, value] of incomingUrl.searchParams.entries()) {
      upstreamUrl.searchParams.append(key, value)
    }

    const start = Date.now()
    const callId = crypto.randomUUID()

    try {
      const headers: Record<string, string> = {}
      const accept = c.req.header('accept')
      if (accept) headers.accept = accept

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), proxyUpstreamTimeoutMs)
      const init: RequestInit = { method, headers, redirect: 'manual', signal: controller.signal }
      if (method === 'POST') {
        const contentLength = Number(c.req.header('content-length') ?? '0')
        if (contentLength > proxyMaxBodyBytes) {
          throw new HTTPException(413, { message: 'Payload too large' })
        }
        const contentType = c.req.header('content-type')
        if (contentType) headers['content-type'] = contentType
        const body = await c.req.arrayBuffer()
        if (body.byteLength > proxyMaxBodyBytes) {
          throw new HTTPException(413, { message: 'Payload too large' })
        }
        init.body = body
      }

      let upstreamRes: Response
      try {
        upstreamRes = await fetch(upstreamUrl.toString(), init)
      } finally {
        clearTimeout(timeoutId)
      }
      const responseTimeMs = Date.now() - start
      const isRedirectResponse = upstreamRes.status >= 300 && upstreamRes.status < 400
      const status = upstreamRes.ok && !isRedirectResponse ? 'success' : 'error'

      try {
        await c.env.DB.prepare(
          'INSERT INTO service_calls (id, service_id, agent_id, status, response_time_ms) VALUES (?, ?, ?, ?, ?)'
        ).bind(callId, service.id, agentId, status, responseTimeMs).run()
      } catch (err) {
        console.error('Failed to log service call', err)
      }

      if (isRedirectResponse) {
        return c.json({ error: 'Upstream redirects are not allowed' }, 502)
      }

      const outHeaders = deps.buildProxyResponseHeaders(upstreamRes.headers)
      return new Response(upstreamRes.body, { status: upstreamRes.status, headers: outHeaders })
    } catch (err) {
      if (err instanceof HTTPException) throw err

      const responseTimeMs = Date.now() - start

      try {
        await c.env.DB.prepare(
          'INSERT INTO service_calls (id, service_id, agent_id, status, response_time_ms) VALUES (?, ?, ?, ?, ?)'
        ).bind(callId, service.id, agentId, 'error', responseTimeMs).run()
      } catch (logErr) {
        console.error('Failed to log service call', logErr)
      }

      if (err instanceof Error && err.name === 'AbortError') {
        return c.json({ error: 'Upstream request timed out' }, 504)
      }

      console.error('Proxy upstream request failed', err)
      return c.json({ error: 'Upstream request failed' }, 502)
    }
  }

  routes.get('/api/proxy/:serviceId', deps.agentAuth, async (c) => proxyToService(c, 'GET'))
  routes.post('/api/proxy/:serviceId', deps.agentAuth, async (c) => proxyToService(c, 'POST'))

  return routes
}
