import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../types'

type AgentsDeps = {
  agentAuth: MiddlewareHandler<Env>
  requireAdmin: (c: Context<Env>) => void
  requireGuardianEnabled: (c: Context<Env>) => void
  sha256Hex: (value: string) => Promise<string>
  timingSafeEqual: (a: string, b: string) => boolean
  isEnabledFlag: (value: string | undefined) => boolean
  isRecord: (value: unknown) => value is Record<string, unknown>
  fetchWithTimeout: (url: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>
  topicToAddress: (topic: string) => string
  getClientRateLimitKey: (c: Context<Env>) => string
  ensureAgentRegistrationAttemptsTable: (db: D1Database) => Promise<void>
  maskIpForAudit: (ip: string) => string
  logAgentRegistrationAttempt: (
    db: D1Database,
    ipHash: string,
    ipHint: string,
    name: string,
    success: boolean,
    reason: string,
    agentId?: string | null,
  ) => Promise<void>
  logAutonomousAction: (
    db: D1Database,
    agentId: string | null,
    actionType: string,
    serviceId: string | null,
    decision: string,
    confidence: number | null,
    costUsd: number,
    ruleApplied: string | null,
    details: Record<string, unknown>,
  ) => Promise<void>
  audit: typeof import('../lib/helpers').audit
  agentRegisterAttemptWindowMinutes: number
  agentRegisterMaxAttemptsPerWindow: number
  crossfinWallet: string
  usdcBaseAddress: string
}

export function createAgentsRoutes(deps: AgentsDeps): Hono<Env> {
  const agents = new Hono<Env>()

  agents.post('/api/agents', async (c) => {
    deps.requireAdmin(c)

    const body = await c.req.json<{ name: string }>()
    if (!body.name?.trim()) throw new HTTPException(400, { message: 'name is required' })

    const id = crypto.randomUUID()
    const apiKey = `cf_${crypto.randomUUID().replace(/-/g, '')}`
    const apiKeyHash = await deps.sha256Hex(apiKey)

    await c.env.DB.prepare(
      'INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?)'
    ).bind(id, body.name.trim(), apiKeyHash).run()

    await deps.audit(c.env.DB, id, 'agent.create', 'agents', id, 'success')

    return c.json({ id, name: body.name.trim(), apiKey }, 201)
  })

  agents.get('/api/agents/:agentId/actions', deps.agentAuth, async (c) => {
    deps.requireGuardianEnabled(c)
    const requesterAgentId = c.get('agentId')
    const agentId = c.req.param('agentId')
    if (agentId !== requesterAgentId) {
      throw new HTTPException(403, { message: 'Forbidden' })
    }

    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200)

    const { results } = await c.env.DB.prepare(
      'SELECT * FROM autonomous_actions WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
    ).bind(agentId, limit).all()

    return c.json({
      agentId,
      actions: (results ?? []).map((a: any) => ({
        ...a,
        details: JSON.parse(a.details || '{}'),
      })),
      at: new Date().toISOString(),
    })
  })

  agents.post('/api/deposits', deps.agentAuth, async (c) => {
    deps.requireGuardianEnabled(c)
    const agentId = c.get('agentId')
    const body = await c.req.json<{
      tx_hash: string
    }>()

    if (!body.tx_hash?.trim()) {
      throw new HTTPException(400, { message: 'tx_hash is required' })
    }

    const txHash = body.tx_hash.trim().toLowerCase()

    const existing = await c.env.DB.prepare(
      'SELECT id, status, agent_id FROM deposits WHERE tx_hash = ?'
    ).bind(txHash).first<{ id: string; status: string; agent_id: string | null }>()
    if (existing) {
      if (existing.agent_id === agentId) {
        return c.json({ id: existing.id, status: existing.status, message: 'Deposit already processed' })
      }
      throw new HTTPException(409, { message: 'Transaction already claimed by another agent' })
    }

    const basescanUrl = `https://api.basescan.org/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}`
    const receipt: unknown = await deps.fetchWithTimeout(basescanUrl, undefined, 10000).then((r) => r.json()).catch(() => null)
    const receiptResult = deps.isRecord(receipt) && deps.isRecord(receipt.result) ? receipt.result : null

    if (!receiptResult?.status || receiptResult.status !== '0x1') {
      throw new HTTPException(400, { message: 'Transaction not found or not confirmed on Base mainnet' })
    }

    let amountUsd = 0
    let fromAddress = ''
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

    const receiptLogs = Array.isArray(receiptResult.logs) ? receiptResult.logs : []
    for (const log of receiptLogs) {
      if (
        log.address?.toLowerCase() === deps.usdcBaseAddress.toLowerCase() &&
        log.topics?.[0] === transferTopic &&
        deps.topicToAddress(log.topics?.[2] ?? '') === deps.crossfinWallet.toLowerCase()
      ) {
        const parsed = Number.parseInt(log.data, 16)
        if (!Number.isFinite(parsed) || parsed <= 0) continue
        amountUsd = parsed / 1e6
        fromAddress = deps.topicToAddress(log.topics[1] ?? '')
        break
      }
    }

    if (amountUsd <= 0) {
      throw new HTTPException(400, { message: 'No USDC transfer to CrossFin wallet found in transaction' })
    }

    const depositId = crypto.randomUUID()

    let credited = false
    const wallet = await c.env.DB.prepare(
      'SELECT id FROM wallets WHERE agent_id = ? LIMIT 1'
    ).bind(agentId).first<{ id: string }>()

    if (wallet) {
      const creditCents = Math.round(amountUsd * 100)
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO deposits (id, agent_id, tx_hash, amount_usd, from_address, status, verified_at) VALUES (?, ?, ?, ?, ?, 'verified', datetime('now'))"
        ).bind(depositId, agentId, txHash, amountUsd, fromAddress),
        c.env.DB.prepare(
          'UPDATE wallets SET balance_cents = balance_cents + ? WHERE id = ?'
        ).bind(creditCents, wallet.id),
        c.env.DB.prepare(
          "INSERT INTO transactions (id, to_wallet_id, amount_cents, rail, memo, status) VALUES (?, ?, ?, 'x402', ?, 'completed')"
        ).bind(crypto.randomUUID(), wallet.id, creditCents, `Deposit via ${txHash.slice(0, 10)}...`),
      ])
      credited = true
    } else {
      await c.env.DB.prepare(
        "INSERT INTO deposits (id, agent_id, tx_hash, amount_usd, from_address, status, verified_at) VALUES (?, ?, ?, ?, ?, 'verified', datetime('now'))"
      ).bind(depositId, agentId, txHash, amountUsd, fromAddress).run()
    }

    await deps.logAutonomousAction(c.env.DB, agentId, 'DEPOSIT_VERIFY', null, 'POSITIVE_SPREAD', 1.0, amountUsd, null, {
      txHash,
      amountUsd,
      fromAddress,
      basescan: `https://basescan.org/tx/${txHash}`,
    })

    await deps.audit(c.env.DB, agentId, 'deposit.verify', 'deposits', depositId, 'success', `$${amountUsd.toFixed(2)} USDC from ${fromAddress.slice(0, 10)}...`)

    return c.json({
      id: depositId,
      status: 'verified',
      amountUsd,
      fromAddress,
      txHash,
      basescan: `https://basescan.org/tx/${txHash}`,
      credited,
    }, 201)
  })

  agents.get('/api/deposits', deps.agentAuth, async (c) => {
    deps.requireGuardianEnabled(c)
    const agentId = c.get('agentId')
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM deposits WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
    ).bind(agentId, limit).all()
    return c.json({
      deposits: (results ?? []).map((d: any) => ({
        ...d,
        basescan: `https://basescan.org/tx/${d.tx_hash}`,
      })),
      at: new Date().toISOString(),
    })
  })

  agents.post('/api/agents/register', async (c) => {
    let body: {
      name?: string
      evm_address?: string
      signup_token?: string
    }

    try {
      body = await c.req.json()
    } catch {
      throw new HTTPException(400, { message: 'Invalid JSON body' })
    }

    const name = body.name?.trim() ?? ''
    if (!name) {
      throw new HTTPException(400, { message: 'name is required' })
    }

    const clientIp = deps.getClientRateLimitKey(c)
    const ipHint = deps.maskIpForAudit(clientIp)
    const ipHash = await deps.sha256Hex(`agent-register:${clientIp}`)

    await deps.ensureAgentRegistrationAttemptsTable(c.env.DB)

    const attemptWindowModifier = `-${deps.agentRegisterAttemptWindowMinutes} minutes`
    const attemptsRow = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM agent_registration_attempts WHERE ip_hash = ? AND created_at >= datetime('now', ?)"
    ).bind(ipHash, attemptWindowModifier).first<{ count: number | string }>()

    const recentAttempts = Number(attemptsRow?.count ?? 0)
    if (recentAttempts >= deps.agentRegisterMaxAttemptsPerWindow) {
      try {
        await deps.logAgentRegistrationAttempt(c.env.DB, ipHash, ipHint, name, false, 'rate_limited')
        await deps.audit(
          c.env.DB,
          null,
          'agent.self_register',
          'agents',
          null,
          'blocked',
          `rate_limited ip=${ipHint} window=${deps.agentRegisterAttemptWindowMinutes}m limit=${deps.agentRegisterMaxAttemptsPerWindow}`,
        )
      } catch (err) {
        console.error('Failed to record rate-limited registration attempt', err)
      }

      throw new HTTPException(429, {
        message: `Too many registration attempts from this IP. Try again in ${deps.agentRegisterAttemptWindowMinutes} minutes.`,
      })
    }

    const requiredSignupToken = (c.env.CROSSFIN_AGENT_SIGNUP_TOKEN ?? '').trim()
    if (!requiredSignupToken) {
      try {
        await deps.logAgentRegistrationAttempt(c.env.DB, ipHash, ipHint, name, false, 'signup_token_not_configured')
        await deps.audit(c.env.DB, null, 'agent.self_register', 'agents', null, 'blocked', 'signup_token_not_configured')
      } catch (err) {
        console.error('Failed to record missing signup-token configuration', err)
      }
      throw new HTTPException(503, { message: 'Agent registration is temporarily unavailable' })
    }

    const providedSignupToken = (c.req.header('X-CrossFin-Signup-Token') ?? body.signup_token ?? '').trim()
    if (requiredSignupToken && !deps.timingSafeEqual(providedSignupToken, requiredSignupToken)) {
      try {
        await deps.logAgentRegistrationAttempt(c.env.DB, ipHash, ipHint, name, false, 'invalid_signup_token')
        await deps.audit(c.env.DB, null, 'agent.self_register', 'agents', null, 'blocked', `invalid_signup_token ip=${ipHint}`)
      } catch (err) {
        console.error('Failed to record invalid-token registration attempt', err)
      }
      throw new HTTPException(401, { message: 'Invalid signup token' })
    }

    const id = crypto.randomUUID()
    const rawApiKey = `cf_${crypto.randomUUID().replace(/-/g, '')}`
    const keyHash = await deps.sha256Hex(rawApiKey)

    await c.env.DB.prepare(
      "INSERT INTO agents (id, name, api_key, status) VALUES (?, ?, ?, 'active')"
    ).bind(id, name, keyHash).run()

    const walletId = crypto.randomUUID()
    await c.env.DB.prepare(
      'INSERT INTO wallets (id, agent_id, label, balance_cents) VALUES (?, ?, ?, 0)'
    ).bind(walletId, id, 'Default Wallet').run()

    const defaultRules = [
      { type: 'SPEND_CAP', params: { dailyLimitUsd: 10.0 } },
      { type: 'FAIL_STREAK', params: { maxConsecutiveFails: 10 } },
      { type: 'CIRCUIT_BREAKER', params: { failRatePct: 60, windowMinutes: 30 } },
    ]
    let guardianApplied = false
    if (deps.isEnabledFlag(c.env.CROSSFIN_GUARDIAN_ENABLED)) {
      try {
        for (const rule of defaultRules) {
          await c.env.DB.prepare(
            'INSERT INTO guardian_rules (id, agent_id, type, params) VALUES (?, ?, ?, ?)'
          ).bind(crypto.randomUUID(), id, rule.type, JSON.stringify(rule.params)).run()
        }
        guardianApplied = true
      } catch (err) {
        console.error('Failed to apply default guardian rules', err)
      }
    }

    await deps.audit(c.env.DB, id, 'agent.self_register', 'agents', id, 'success')
    try {
      await deps.logAgentRegistrationAttempt(c.env.DB, ipHash, ipHint, name, true, 'created', id)
    } catch (err) {
      console.error('Failed to record successful registration attempt', err)
    }

    return c.json({
      id,
      name,
      apiKey: rawApiKey,
      walletId,
      guardianRules: guardianApplied ? defaultRules.map((r) => r.type) : [],
      note: guardianApplied
        ? 'Save your API key - it cannot be retrieved later. Default Guardian rules have been applied.'
        : 'Save your API key - it cannot be retrieved later.',
    }, 201)
  })

  return agents
}
