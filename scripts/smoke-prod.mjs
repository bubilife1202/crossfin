#!/usr/bin/env node
/**
 * Production smoke test for CrossFin.
 *
 * Usage:
 *   node scripts/smoke-prod.mjs --repeat 10
 *
 * Env:
 *   SMOKE_BASE_URL=https://crossfin.dev
 *   SMOKE_LIVE_URL=https://live.crossfin.dev
 *   SMOKE_REPEAT=10
 *   SMOKE_DELAY_MS=150
 *   SMOKE_TIMEOUT_MS=10000
 */

import { setTimeout as delay } from 'node:timers/promises'
import dns from 'node:dns'

// Some environments have flaky IPv6 connectivity; prefer IPv4 for CI reliability.
dns.setDefaultResultOrder('ipv4first')

function parseArgs(argv) {
  const out = new Map()
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i] ?? ''
    if (!raw.startsWith('--')) continue
    const key = raw.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out.set(key, next)
      i += 1
    } else {
      out.set(key, 'true')
    }
  }
  return out
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim()
  assert(raw.startsWith('https://'), 'Base URL must start with https://')
  return raw.replace(/\/$/, '')
}

function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

async function fetchWithTimeout(url, init, timeoutMs) {
  let lastErr
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const headers = new Headers(init?.headers ?? {})
      headers.set('X-CrossFin-Internal', '1')
      if (!headers.has('User-Agent')) {
        headers.set('User-Agent', 'crossfin-smoke-prod/1.0')
      }
      return await fetch(url, { ...init, headers, signal: ctrl.signal })
    } catch (err) {
      lastErr = err
      if (attempt < 2) {
        // Brief retry for transient network/DNS issues.
        await delay(150)
        continue
      }
      throw err
    } finally {
      clearTimeout(t)
    }
  }
  throw lastErr
}

async function readTextSafe(res, limit = 2000) {
  try {
    const text = await res.text()
    return text.length > limit ? `${text.slice(0, limit)}…` : text
  } catch {
    return ''
  }
}

async function fetchJson(url, init, timeoutMs) {
  let res
  try {
    res = await fetchWithTimeout(url, init, timeoutMs)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`fetch failed for ${url}: ${msg}`)
  }
  const text = await readTextSafe(res, 100_000)
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Expected JSON from ${url} but got: ${text.slice(0, 500)}`)
  }
  return { res, json, text }
}

function decodePaymentRequiredHeader(value) {
  const raw = String(value ?? '').trim()
  assert(raw, 'Missing PAYMENT-REQUIRED header')
  let decoded = ''
  try {
    decoded = Buffer.from(raw, 'base64').toString('utf8')
  } catch {
    throw new Error('PAYMENT-REQUIRED header is not valid base64')
  }
  try {
    return JSON.parse(decoded)
  } catch {
    throw new Error(`PAYMENT-REQUIRED header is not valid JSON: ${decoded.slice(0, 300)}`)
  }
}

function validatePaymentRequiredShape(payload) {
  assert(isRecord(payload), 'PAYMENT-REQUIRED decoded payload must be an object')
  assert(typeof payload.x402Version === 'number', 'PAYMENT-REQUIRED.x402Version must be a number')
  assert(isRecord(payload.resource), 'PAYMENT-REQUIRED.resource must be an object')
  assert(Array.isArray(payload.accepts) && payload.accepts.length > 0, 'PAYMENT-REQUIRED.accepts must be a non-empty array')
  const first = payload.accepts[0]
  assert(isRecord(first), 'PAYMENT-REQUIRED.accepts[0] must be an object')
  for (const k of ['scheme', 'network', 'amount', 'asset', 'payTo']) {
    assert(typeof first[k] === 'string' && first[k].trim(), `PAYMENT-REQUIRED.accepts[0].${k} must be a string`)
  }
}

async function ok200Json(url, timeoutMs) {
  const { res, json, text } = await fetchJson(url, { method: 'GET' }, timeoutMs)
  if (!res.ok) {
    throw new Error(`GET ${url} expected 200 but got ${res.status}: ${text.slice(0, 600)}`)
  }
  return json
}

async function expect402Paywall(url, timeoutMs) {
  let res
  try {
    res = await fetchWithTimeout(url, { method: 'GET', redirect: 'manual' }, timeoutMs)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`fetch failed for ${url}: ${msg}`)
  }
  const header = res.headers.get('PAYMENT-REQUIRED')
  if (res.status !== 402) {
    const text = await readTextSafe(res, 600)
    throw new Error(`GET ${url} expected 402 but got ${res.status}: ${text}`)
  }
  const decoded = decodePaymentRequiredHeader(header)
  validatePaymentRequiredShape(decoded)
}

async function postFunnelEvent(baseUrl, timeoutMs, runId) {
  const url = `${baseUrl}/api/analytics/funnel/events`
  const body = {
    eventName: 'mcp_command_copy',
    source: 'ci',
    metadata: { smoke: true, runId },
  }

  const { res, json, text } = await fetchJson(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
    },
    timeoutMs,
  )

  if (res.status !== 202) {
    throw new Error(`POST ${url} expected 202 but got ${res.status}: ${text.slice(0, 600)}`)
  }
  assert(isRecord(json) && json.ok === true, 'funnel track response must be { ok: true }')
}

async function checkLiveSite(liveUrl, timeoutMs) {
  // Live site is on Cloudflare Pages — allow extra time for edge propagation after deploys.
  const liveTimeoutMs = Math.max(timeoutMs, 30_000)
  const maxAttempts = 3
  let lastErr
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetchWithTimeout(liveUrl, { method: 'GET', redirect: 'manual' }, liveTimeoutMs)
      assert(res.status >= 200 && res.status < 400, `Live site expected 2xx/3xx but got ${res.status}`)
      return
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) {
        await delay(2_000 * attempt) // 2s, 4s backoff
        continue
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new Error(`fetch failed for ${liveUrl} after ${maxAttempts} attempts: ${msg}`)
}

async function runOnce(baseUrl, liveUrl, timeoutMs, runId) {
  const health = await ok200Json(`${baseUrl}/api/health`, timeoutMs)
  assert(isRecord(health), 'health payload must be an object')
  assert(health.status === 'ok', 'health.status must be ok')
  assert(typeof health.version === 'string' && health.version.trim(), 'health.version must be a string')

  const wellKnown = await ok200Json(`${baseUrl}/.well-known/crossfin.json`, timeoutMs)
  assert(isRecord(wellKnown), 'well-known payload must be an object')
  assert(wellKnown.version === health.version, 'well-known.version must match /api/health version')
  assert(isRecord(wellKnown.urls), 'well-known.urls must be an object')
  assert(String(wellKnown.urls.openapi ?? '') === `${baseUrl}/api/openapi.json`, 'well-known.urls.openapi must match baseUrl')
  assert(isRecord(wellKnown.mcp), 'well-known.mcp must be an object')
  assert(String(wellKnown.mcp.package ?? '') === 'crossfin-mcp', 'well-known.mcp.package must be crossfin-mcp')
  assert(String(wellKnown.mcp.run ?? '').includes('crossfin-mcp'), 'well-known.mcp.run must include crossfin-mcp')
  assert(Array.isArray(wellKnown.mcp.tools), 'well-known.mcp.tools must be an array')
  for (const requiredTool of ['find_optimal_route', 'list_exchange_fees', 'compare_exchange_prices']) {
    assert(wellKnown.mcp.tools.includes(requiredTool), `well-known.mcp.tools must include ${requiredTool}`)
  }

  const guide = await ok200Json(`${baseUrl}/api/docs/guide`, timeoutMs)
  assert(isRecord(guide), 'guide payload must be an object')
  assert(guide.version === health.version, 'guide.version must match /api/health version')
  assert(isRecord(guide.mcpServer), 'guide.mcpServer must be an object')
  assert(String(guide.mcpServer.npmPackage ?? '') === 'crossfin-mcp', 'guide.mcpServer.npmPackage must be crossfin-mcp')
  assert(String(guide.mcpServer.install ?? '').includes('crossfin-mcp'), 'guide.mcpServer.install must include crossfin-mcp')

  const openapi = await ok200Json(`${baseUrl}/api/openapi.json`, timeoutMs)
  assert(isRecord(openapi), 'openapi payload must be an object')
  assert(typeof openapi.openapi === 'string' && openapi.openapi.startsWith('3.'), 'openapi.openapi must be a version string')
  assert(isRecord(openapi.info) && openapi.info.version === health.version, 'openapi.info.version must match /api/health version')
  assert(isRecord(openapi.paths), 'openapi.paths must be an object')
  assert(isRecord(openapi.paths['/api/analytics/funnel/overview']), 'openapi must include funnel overview endpoint')
  assert(isRecord(openapi.paths['/api/analytics/funnel/events']), 'openapi must include funnel events endpoint')
  assert(isRecord(openapi.paths['/api/route/exchanges']), 'openapi must include /api/route/exchanges')
  assert(isRecord(openapi.paths['/api/route/fees']), 'openapi must include /api/route/fees')
  assert(isRecord(openapi.paths['/api/route/pairs']), 'openapi must include /api/route/pairs')
  assert(isRecord(openapi.paths['/api/route/status']), 'openapi must include /api/route/status')
  assert(isRecord(openapi.paths['/api/premium/route/find']), 'openapi must include /api/premium/route/find')
  assert(isRecord(openapi.paths['/api/acp/status']), 'openapi must include /api/acp/status')
  assert(isRecord(openapi.paths['/api/acp/quote']), 'openapi must include /api/acp/quote')
  assert(isRecord(openapi.paths['/api/acp/execute']), 'openapi must include /api/acp/execute')

  const registryStats = await ok200Json(`${baseUrl}/api/registry/stats`, timeoutMs)
  assert(isRecord(registryStats) && isRecord(registryStats.services), 'registry stats must include services object')
  assert(Number(registryStats.services.total ?? 0) > 0, 'registryStats.services.total must be > 0')

  const categories = await ok200Json(`${baseUrl}/api/registry/categories`, timeoutMs)
  assert(isRecord(categories) && Array.isArray(categories.data), 'registry categories must include data array')
  assert(categories.data.length > 0, 'registry categories must have at least 1 category')

  const arbitrage = await ok200Json(`${baseUrl}/api/arbitrage/demo`, timeoutMs)
  assert(isRecord(arbitrage), 'arbitrage demo must be an object')
  assert(Array.isArray(arbitrage.preview), 'arbitrage.preview must be an array')
  assert(arbitrage.preview.length > 0, 'arbitrage.preview must not be empty')
  assert(Number(arbitrage.pairsShown ?? 0) === arbitrage.preview.length, 'arbitrage.pairsShown must match preview length')
  assert(Number(arbitrage.totalPairsAvailable ?? 0) > 0, 'arbitrage.totalPairsAvailable must be > 0')

  const onchain = await ok200Json(`${baseUrl}/api/onchain/usdc-transfers?limit=1`, timeoutMs)
  assert(isRecord(onchain), 'onchain transfers must be an object')
  assert(Array.isArray(onchain.transfers), 'onchain.transfers must be an array')

  const analytics = await ok200Json(`${baseUrl}/api/analytics/overview`, timeoutMs)
  assert(isRecord(analytics), 'analytics overview must be an object')
  assert(typeof analytics.totalCalls === 'number', 'analytics.totalCalls must be a number')

  const funnel = await ok200Json(`${baseUrl}/api/analytics/funnel/overview`, timeoutMs)
  assert(isRecord(funnel) && isRecord(funnel.counts), 'funnel overview must include counts object')
  assert(typeof funnel.counts.mcp_command_copy === 'number', 'funnel.counts.mcp_command_copy must be a number')

  const survival = await ok200Json(`${baseUrl}/api/survival/status`, timeoutMs)
  assert(isRecord(survival), 'survival status must be an object')
  assert(survival.alive === true, 'survival.alive must be true')
  assert(survival.version === health.version, 'survival.version must match /api/health version')

  // Routing engine (free)
  const routeExchanges = await ok200Json(`${baseUrl}/api/route/exchanges`, timeoutMs)
  assert(isRecord(routeExchanges) && Array.isArray(routeExchanges.exchanges), 'route/exchanges must include exchanges array')
  const routeExchangeIds = (routeExchanges.exchanges ?? []).map((e) => (isRecord(e) ? String(e.id ?? '') : '')).filter(Boolean)
  const expectedExchanges = ['bithumb', 'upbit', 'coinone', 'gopax', 'bitflyer', 'wazirx', 'bitbank', 'indodax', 'bitkub', 'binance', 'okx', 'bybit', 'kucoin', 'coinbase']
  assert(routeExchangeIds.length === expectedExchanges.length, `route/exchanges must return ${expectedExchanges.length} exchanges`)
  for (const ex of expectedExchanges) {
    assert(routeExchangeIds.includes(ex), `route/exchanges must include ${ex}`)
  }
  assert(!routeExchangeIds.includes('korbit'), 'route/exchanges must not include korbit')

  const routeStatus = await ok200Json(`${baseUrl}/api/route/status`, timeoutMs)
  assert(isRecord(routeStatus) && Array.isArray(routeStatus.exchanges), 'route/status must include exchanges array')
  const statusIds = routeStatus.exchanges.map((e) => (isRecord(e) ? String(e.exchange ?? '') : '')).filter(Boolean)
  for (const ex of expectedExchanges) {
    assert(statusIds.includes(ex), `route/status must include ${ex}`)
  }
  assert(!statusIds.includes('korbit'), 'route/status must not include korbit')
  for (const row of routeStatus.exchanges) {
    assert(isRecord(row), 'route/status exchange entry must be an object')
    assert(typeof row.exchange === 'string' && row.exchange.trim(), 'route/status exchange entry must have exchange')
    assert(row.status === 'online' || row.status === 'offline', 'route/status entry status must be online|offline')
  }

  const routeFees = await ok200Json(`${baseUrl}/api/route/fees?coin=XRP`, timeoutMs)
  assert(isRecord(routeFees) && Array.isArray(routeFees.fees), 'route/fees must include fees array')
  assert(routeFees.fees.length === expectedExchanges.length, `route/fees must return ${expectedExchanges.length} entries`)
  for (const row of routeFees.fees) {
    assert(isRecord(row), 'route/fees entry must be an object')
    assert(expectedExchanges.includes(String(row.exchange ?? '')), 'route/fees entry exchange must be supported')
    assert(typeof row.tradingFeePct === 'number', 'route/fees entry tradingFeePct must be number')
    assert(isRecord(row.withdrawalFees), 'route/fees entry withdrawalFees must be object')
    assert(typeof row.withdrawalFees.XRP === 'number', 'route/fees must include XRP withdrawal fee number')
  }

  const routePairs = await ok200Json(`${baseUrl}/api/route/pairs`, timeoutMs)
  assert(isRecord(routePairs) && Array.isArray(routePairs.pairs), 'route/pairs must include pairs array')
  assert(typeof routePairs.krwUsdRate === 'number' && Number.isFinite(routePairs.krwUsdRate), 'route/pairs.krwUsdRate must be a number')
  const btcRow = routePairs.pairs.find((p) => isRecord(p) && String(p.coin ?? '') === 'BTC')
  assert(isRecord(btcRow), 'route/pairs must include BTC row')
  assert(typeof btcRow.binanceUsd === 'number' && Number.isFinite(btcRow.binanceUsd) && btcRow.binanceUsd > 1000, 'route/pairs BTC binanceUsd must be a sane number')

  // ACP status (free)
  const acpStatus = await ok200Json(`${baseUrl}/api/acp/status`, timeoutMs)
  assert(isRecord(acpStatus), 'acp/status must be an object')
  assert(Array.isArray(acpStatus.supported_exchanges), 'acp/status.supported_exchanges must be an array')
  for (const ex of expectedExchanges) {
    assert(acpStatus.supported_exchanges.includes(ex), `acp/status.supported_exchanges must include ${ex}`)
  }
  assert(!acpStatus.supported_exchanges.includes('korbit'), 'acp/status.supported_exchanges must not include korbit')

  await postFunnelEvent(baseUrl, timeoutMs, runId)

  await ok200Json(`${baseUrl}/api/premium/report`, timeoutMs)
  await ok200Json(`${baseUrl}/api/premium/arbitrage/kimchi`, timeoutMs)
  await ok200Json(`${baseUrl}/api/premium/route/find?from=bithumb:KRW&to=binance:USDC&amount=1000000&strategy=cheapest`, timeoutMs)
  await ok200Json(`${baseUrl}/api/premium/crypto/korea/5exchange?coin=BTC`, timeoutMs)

  await checkLiveSite(`${liveUrl}/`, timeoutMs)

  return { version: health.version }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.has('help')) {
    console.log('Usage: node scripts/smoke-prod.mjs --repeat 10 --base https://crossfin.dev --live https://live.crossfin.dev')
    process.exit(0)
  }

  const baseUrl = normalizeBaseUrl(args.get('base') ?? process.env.SMOKE_BASE_URL ?? 'https://crossfin.dev')
  const liveUrl = normalizeBaseUrl(args.get('live') ?? process.env.SMOKE_LIVE_URL ?? 'https://live.crossfin.dev')
  const repeat = toInt(args.get('repeat') ?? process.env.SMOKE_REPEAT, 10)
  const delayMs = toInt(args.get('delayMs') ?? process.env.SMOKE_DELAY_MS, 150)
  const timeoutMs = toInt(args.get('timeoutMs') ?? process.env.SMOKE_TIMEOUT_MS, 10_000)

  assert(repeat >= 1 && repeat <= 50, '--repeat must be between 1 and 50')
  assert(delayMs >= 0 && delayMs <= 5_000, '--delayMs must be between 0 and 5000')
  assert(timeoutMs >= 2_000 && timeoutMs <= 60_000, '--timeoutMs must be between 2000 and 60000')

  const startedAt = Date.now()
  let lastVersion = ''

  for (let i = 1; i <= repeat; i += 1) {
    console.log(`[smoke] run ${i}/${repeat}`)
    const out = await runOnce(baseUrl, liveUrl, timeoutMs, `run_${i}`)
    lastVersion = out.version
    if (delayMs > 0 && i !== repeat) await delay(delayMs)
  }

  const elapsedMs = Date.now() - startedAt
  console.log(`[smoke] ok (version=${lastVersion}, runs=${repeat}, elapsed=${elapsedMs}ms)`)
}

main().catch((err) => {
  console.error(`[smoke] failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
