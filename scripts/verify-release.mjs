#!/usr/bin/env node

import dns from 'node:dns'
import { spawn } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

dns.setDefaultResultOrder('ipv4first')

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TIMEOUT_MS = Number.parseInt(process.env.VERIFY_TIMEOUT_MS ?? '20000', 10)
const FETCH_RETRIES = Number.parseInt(process.env.VERIFY_FETCH_RETRIES ?? '4', 10)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolveUrl(rawValue, label) {
  const value = String(rawValue ?? '').trim().replace(/\/+$/, '')
  assert(value.startsWith('https://'), `${label} must start with https://`)
  return value
}

function repoPath(...parts) {
  return path.join(ROOT_DIR, ...parts)
}

function lineNumberForIndex(text, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

function lineAt(text, lineNumber) {
  const lines = text.split('\n')
  return lines[lineNumber - 1] ?? ''
}

async function runCommand({ label, cwd, command, args }) {
  console.log(`[verify] ${label}`)
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.env,
    })

    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${label} failed (exit ${code ?? 'unknown'})`))
    })
  })
}

async function fetchWithTimeout(url, init = {}) {
  let lastErr
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const headers = new Headers(init.headers ?? {})
      headers.set('User-Agent', 'crossfin-verify-release/1.0')
      headers.set('X-CrossFin-Internal', '1')
      return await fetch(url, { ...init, headers, signal: controller.signal })
    } catch (err) {
      lastErr = err
      if (attempt === FETCH_RETRIES) break
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastErr
}

async function fetchText(url, init = {}) {
  const res = await fetchWithTimeout(url, init)
  const text = await res.text()
  return { res, text }
}

async function fetchJson(url, init = {}) {
  const { res, text } = await fetchText(url, init)
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Expected JSON from ${url} but got: ${text.slice(0, 300)}`)
  }
  return { res, json, text }
}

async function checkText({ name, url, expectedStatus = 200, contains }) {
  const { res, text } = await fetchText(url)
  assert(res.status === expectedStatus, `${name}: expected ${expectedStatus}, got ${res.status}`)
  if (contains) {
    assert(text.includes(contains), `${name}: expected body to include "${contains}"`)
  }
  console.log(`[ok] ${name}`)
}

async function checkJson({ name, url, method = 'GET', body, expectedStatus = 200, validate }) {
  const headers = new Headers()
  let payload = undefined
  if (body !== undefined) {
    headers.set('content-type', 'application/json')
    payload = JSON.stringify(body)
  }

  const { res, json, text } = await fetchJson(url, {
    method,
    headers,
    body: payload,
  })

  assert(res.status === expectedStatus, `${name}: expected ${expectedStatus}, got ${res.status}. body=${text.slice(0, 300)}`)
  if (validate) validate(json)
  console.log(`[ok] ${name}`)
}

async function collectFiles(basePath) {
  const stats = await stat(basePath)
  if (stats.isFile()) return [basePath]

  const out = []
  const entries = await readdir(basePath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(basePath, entry.name)
    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath)
      out.push(...nested)
      continue
    }
    out.push(fullPath)
  }
  return out
}

async function runCopyDriftCheck() {
  const scanRoots = [
    repoPath('README.md'),
    repoPath('apps/docs'),
    repoPath('apps/web/src'),
    repoPath('apps/live/src'),
    repoPath('apps/mcp-server/README.md'),
    repoPath('packages/sdk/README.md'),
    repoPath('examples'),
  ]

  const fileSet = new Set()
  for (const root of scanRoots) {
    const files = await collectFiles(root)
    for (const file of files) {
      if (/(\.md|\.ts|\.tsx)$/i.test(file)) {
        fileSet.add(file)
      }
    }
  }

  const patterns = [
    { name: 'legacy version marker', regex: /v1\.12\.0/g },
    { name: 'stale paid API count', regex: /35\+?\s*(paid APIs|유료 API)/gi },
    { name: 'stale stock API references', regex: /KOSPI|KOSDAQ|crossfin_stock_brief/gi },
    { name: 'stale exchange count phrase', regex: /\b7 exchanges\b/gi },
    { name: 'legacy payment wording', regex: /x402-paywalled\s*\(USDC\)/gi },
    { name: 'legacy wallet wording', regex: /No EVM wallet or API key required/gi },
    { name: 'legacy signal wording', regex: /EXECUTE\/WAIT\/SKIP/g },
  ]

  const violations = []
  for (const file of [...fileSet].sort()) {
    const content = await readFile(file, 'utf8')
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
      let match
      while ((match = regex.exec(content)) !== null) {
        const line = lineNumberForIndex(content, match.index)
        violations.push({
          file: path.relative(ROOT_DIR, file),
          line,
          pattern: pattern.name,
          text: lineAt(content, line).trim(),
        })
        if (violations.length >= 50) break
      }
      if (violations.length >= 50) break
    }
    if (violations.length >= 50) break
  }

  if (violations.length > 0) {
    const lines = violations.map((v) => `- ${v.file}:${v.line} [${v.pattern}] ${v.text}`)
    throw new Error(`Copy drift check failed:\n${lines.join('\n')}`)
  }

  console.log(`[ok] copy drift scan (${fileSet.size} files)`)
}

async function runVersionConsistencyCheck() {
  const apiPkg = JSON.parse(await readFile(repoPath('apps/api/package.json'), 'utf8'))
  const ver = apiPkg.version
  assert(typeof ver === 'string' && /^\d+\.\d+\.\d+$/.test(ver), `api version must be semver, got: ${ver}`)

  const checks = [
    { file: 'apps/web/package.json', pattern: `"version": "${ver}"` },
    { file: 'apps/live/package.json', pattern: `"version": "${ver}"` },
    { file: 'apps/mcp-server/package.json', pattern: `"version": "${ver}"` },
    { file: 'packages/sdk/package.json', pattern: `"version": "${ver}"` },
    { file: 'apps/mcp-server/server.json', pattern: `"version": "${ver}"` },
    { file: 'apps/web/public/.well-known/crossfin.json', pattern: `"version": "${ver}"` },
    { file: 'catalog/crossfin-catalog.json', pattern: `"apiVersion": "${ver}"` },
    { file: 'smithery.yaml', pattern: `crossfin-mcp@${ver}` },
    { file: 'examples/gpt-actions-schema.yaml', pattern: `version: "${ver}"` },
    { file: 'apps/api/src/lib/fetchers.ts', pattern: `CrossFin-API/${ver}` },
    { file: 'packages/sdk/src/types.ts', pattern: `v${ver}` },
    { file: 'README.md', pattern: `(v${ver})` },
    { file: 'apps/docs/api.md', pattern: `(v${ver})` },
  ]

  const mismatches = []
  for (const { file, pattern } of checks) {
    const content = await readFile(repoPath(file), 'utf8')
    if (!content.includes(pattern)) {
      mismatches.push(`  ${file} — expected "${pattern}"`)
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Version consistency check failed (expected ${ver}):\n${mismatches.join('\n')}\nRun: node scripts/bump-version.mjs ${ver}`)
  }

  console.log(`[ok] version consistency (${checks.length + 1} files @ ${ver})`)
}

async function runEndpointChecks(baseUrl, docsUrl, liveUrl) {
  await Promise.all([
    checkJson({
      name: 'api health',
      url: `${baseUrl}/api/health`,
      validate: (json) => {
        assert(isObject(json), 'api health: response must be object')
        assert(json.status === 'ok', 'api health: status must be ok')
        assert(typeof json.version === 'string' && json.version.length > 0, 'api health: version must be string')
      },
    }),
    checkJson({
      name: 'openapi spec',
      url: `${baseUrl}/api/openapi.json`,
      validate: (json) => {
        assert(isObject(json.paths), 'openapi spec: paths must be object')
      },
    }),
    checkJson({
      name: 'agent guide',
      url: `${baseUrl}/api/docs/guide`,
      validate: (json) => {
        assert(typeof json.version === 'string' && json.version.length > 0, 'agent guide: version must be string')
      },
    }),
    checkJson({
      name: 'route exchanges',
      url: `${baseUrl}/api/route/exchanges`,
      validate: (json) => {
        assert(Array.isArray(json.exchanges), 'route exchanges: exchanges must be array')
        assert(json.exchanges.length >= 14, 'route exchanges: expected at least 14 exchanges')
      },
    }),
    checkJson({
      name: 'route status',
      url: `${baseUrl}/api/route/status`,
      validate: (json) => {
        assert(Array.isArray(json.exchanges), 'route status: exchanges must be array')
        assert(json.exchanges.length > 0, 'route status: exchanges must be non-empty')
      },
    }),
    checkJson({
      name: 'route pairs BTC',
      url: `${baseUrl}/api/route/pairs?coin=BTC`,
      validate: (json) => {
        assert(Array.isArray(json.pairs), 'route pairs BTC: pairs must be array')
      },
    }),
    checkJson({ name: 'route pairs invalid', url: `${baseUrl}/api/route/pairs?coin=INVALID`, expectedStatus: 400 }),
    checkJson({ name: 'arbitrage demo', url: `${baseUrl}/api/arbitrage/demo`, validate: (json) => assert(Array.isArray(json.preview), 'arbitrage demo: preview must be array') }),
    checkJson({ name: 'premium kimchi', url: `${baseUrl}/api/premium/arbitrage/kimchi` }),
    checkJson({ name: 'premium opportunities', url: `${baseUrl}/api/premium/arbitrage/opportunities` }),
    checkJson({ name: 'premium route find', url: `${baseUrl}/api/premium/route/find?from=bithumb:KRW&to=binance:USDC&amount=1000000&strategy=cheapest` }),
    checkJson({ name: 'premium report', url: `${baseUrl}/api/premium/report` }),
    checkJson({ name: 'premium enterprise', url: `${baseUrl}/api/premium/enterprise` }),
    checkJson({
      name: 'registry stats',
      url: `${baseUrl}/api/registry/stats`,
      validate: (json) => {
        assert(isObject(json), 'registry stats: response must be object')
      },
    }),
    checkJson({ name: 'analytics overview', url: `${baseUrl}/api/analytics/overview` }),
    checkJson({
      name: 'acp quote valid',
      url: `${baseUrl}/api/acp/quote`,
      method: 'POST',
      body: { from: 'bithumb:KRW', to: 'binance:USDC', amount: 1_000_000, strategy: 'cheapest' },
      validate: (json) => {
        assert(typeof json.quote_id === 'string' && json.quote_id.length > 0, 'acp quote valid: quote_id missing')
      },
    }),
    checkJson({
      name: 'acp quote invalid strategy',
      url: `${baseUrl}/api/acp/quote`,
      method: 'POST',
      body: { from: 'bithumb:KRW', to: 'binance:USDC', amount: 1_000_000, strategy: 'invalid_strategy' },
      expectedStatus: 400,
    }),
    checkJson({
      name: 'acp execute without key',
      url: `${baseUrl}/api/acp/execute`,
      method: 'POST',
      body: { quote_id: 'q_dummy' },
      expectedStatus: 401,
    }),
    checkJson({
      name: 'agent register invalid body',
      url: `${baseUrl}/api/agents/register`,
      method: 'POST',
      body: {},
      expectedStatus: 400,
    }),
    checkJson({
      name: 'well-known crossfin',
      url: `${baseUrl}/.well-known/crossfin.json`,
      validate: (json) => {
        assert(typeof json.version === 'string' && json.version.length > 0, 'well-known crossfin: version missing')
      },
    }),
    checkJson({ name: 'well-known x402', url: `${baseUrl}/.well-known/x402.json` }),
    checkJson({ name: 'well-known agent', url: `${baseUrl}/.well-known/agent.json` }),
    checkJson({ name: 'well-known ai-plugin', url: `${baseUrl}/.well-known/ai-plugin.json` }),
    checkText({ name: 'llms.txt', url: `${baseUrl}/llms.txt`, contains: 'CrossFin' }),
    checkText({ name: 'main page', url: `${baseUrl}` }),
    checkText({ name: 'live page', url: `${liveUrl}` }),
    checkText({ name: 'docs home', url: `${docsUrl}` }),
    checkText({ name: 'docs api page', url: `${docsUrl}/api`, contains: '14 exchanges' }),
  ])
}

async function main() {
  assert(Number.isFinite(TIMEOUT_MS) && TIMEOUT_MS >= 1000, 'VERIFY_TIMEOUT_MS must be a number >= 1000')
  assert(Number.isFinite(FETCH_RETRIES) && FETCH_RETRIES >= 1, 'VERIFY_FETCH_RETRIES must be a number >= 1')

  const baseUrl = resolveUrl(process.env.VERIFY_BASE_URL ?? 'https://crossfin.dev', 'VERIFY_BASE_URL')
  const docsUrl = resolveUrl(process.env.VERIFY_DOCS_URL ?? 'https://docs.crossfin.dev', 'VERIFY_DOCS_URL')
  const liveUrl = resolveUrl(process.env.VERIFY_LIVE_URL ?? 'https://live.crossfin.dev', 'VERIFY_LIVE_URL')

  console.log('[verify] release verification started')

  await Promise.all([
    runCommand({ label: 'api build', cwd: repoPath('apps', 'api'), command: 'npm', args: ['run', 'build'] }),
    runCommand({ label: 'api contract verify', cwd: repoPath('apps', 'api'), command: 'npm', args: ['run', 'contract:verify'] }),
    runCommand({ label: 'api catalog verify', cwd: repoPath('apps', 'api'), command: 'npm', args: ['run', 'catalog:verify'] }),
    runCommand({ label: 'web build', cwd: repoPath('apps', 'web'), command: 'npm', args: ['run', 'build'] }),
    runCommand({ label: 'docs build', cwd: repoPath('apps', 'docs'), command: 'npm', args: ['run', 'build'] }),
  ])

  await Promise.all([
    runCopyDriftCheck(),
    runVersionConsistencyCheck(),
    runEndpointChecks(baseUrl, docsUrl, liveUrl),
  ])

  console.log('[verify] release verification passed')
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[verify] failed: ${message}`)
  process.exit(1)
})
