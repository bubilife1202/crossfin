import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'

export type Bindings = {
  DB: D1Database
  FACILITATOR_URL: string
  X402_NETWORK: string
  PAYMENT_RECEIVER_ADDRESS: string
  CROSSFIN_ADMIN_TOKEN?: string
  CROSSFIN_GUARDIAN_ENABLED?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_WEBHOOK_SECRET?: string
  TELEGRAM_ADMIN_CHAT_ID?: string
  ZAI_API_KEY?: string
  CROSSFIN_AGENT_SIGNUP_TOKEN?: string
}

export type A2aSkillResult = { data: unknown; error?: undefined } | { error: string; data?: undefined }
export type A2aSkillHandler = (skill: string | undefined, message: string) => Promise<A2aSkillResult>
export type Variables = {
  agentId: string
  a2aSkillHandler?: A2aSkillHandler
}

export type Env = { Bindings: Bindings; Variables: Variables }

export type Caip2 = `${string}:${string}`

export function requireCaip2(value: string): Caip2 {
  const trimmed = value.trim()
  if (!trimmed || !trimmed.includes(':')) {
    throw new HTTPException(500, { message: 'Invalid X402_NETWORK (expected CAIP-2 like eip155:84532)' })
  }
  return trimmed as Caip2
}

export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  const maxLength = Math.max(aBytes.length, bBytes.length)

  let diff = aBytes.length === bBytes.length ? 0 : 1
  for (let i = 0; i < maxLength; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0)
  }

  return diff === 0
}

export function isEnabledFlag(value: string | undefined): boolean {
  const raw = (value ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export function requireGuardianEnabled(c: Context<Env>): void {
  if (!isEnabledFlag(c.env.CROSSFIN_GUARDIAN_ENABLED)) {
    throw new HTTPException(404, { message: 'Not found' })
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(new Uint8Array(digest))
}

export function requireAdmin(c: Context<Env>): void {
  const expected = (c.env.CROSSFIN_ADMIN_TOKEN ?? '').trim()

  if (!expected) {
    throw new HTTPException(404, { message: 'Not found' })
  }

  const headerToken = (c.req.header('X-CrossFin-Admin-Token') ?? '').trim()
  const auth = (c.req.header('Authorization') ?? '').trim()
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''

  const provided = headerToken || bearer
  if (!provided || !timingSafeEqual(provided, expected)) {
    throw new HTTPException(401, { message: 'Unauthorized' })
  }
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}
