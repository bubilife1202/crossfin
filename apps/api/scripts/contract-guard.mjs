#!/usr/bin/env node

const baseUrl = (process.env.CONTRACT_BASE_URL ?? 'https://crossfin.dev').trim().replace(/\/+$/, '')
const contractAgentKey = (
  process.env.CONTRACT_AGENT_KEY
  ?? process.env.CROSSFIN_AGENT_KEY
  ?? process.env.X_AGENT_KEY
  ?? ''
).trim()

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function parseJson(res, label) {
  let body
  try {
    body = await res.json()
  } catch {
    throw new Error(`${label}: expected JSON response (status=${res.status})`)
  }
  return body
}

async function expectStatus(res, expected, label) {
  if (res.status === expected) return

  const text = await res.text().catch(() => '')
  throw new Error(`${label}: expected ${expected}, got ${res.status}. body=${text.slice(0, 300)}`)
}

async function postJson(path, payload) {
  const headers = {
    'content-type': 'application/json',
    'x-crossfin-internal': '1',
    'user-agent': 'crossfin-contract-guard/1.0',
  }
  if (contractAgentKey) headers['x-agent-key'] = contractAgentKey

  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
}

async function getJson(path) {
  const headers = {
    'x-crossfin-internal': '1',
    'user-agent': 'crossfin-contract-guard/1.0',
  }
  if (contractAgentKey) headers['x-agent-key'] = contractAgentKey

  return fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers,
  })
}

async function run() {
  console.log(`contract-guard: checking ${baseUrl}`)

  const quoteFromToRes = await postJson('/api/acp/quote', {
    from: 'bithumb:KRW',
    to: 'binance:USDC',
    amount: 1000000,
    strategy: 'cheapest',
  })
  await expectStatus(quoteFromToRes, 200, 'ACP quote with from/to')
  const quoteFromTo = await parseJson(quoteFromToRes, 'ACP quote with from/to')
  assert(typeof quoteFromTo.quote_id === 'string' && quoteFromTo.quote_id.length > 0, 'ACP quote with from/to: quote_id missing')

  const quoteExpandedRes = await postJson('/api/acp/quote', {
    from_exchange: 'bithumb',
    from_currency: 'KRW',
    to_exchange: 'binance',
    to_currency: 'USDC',
    amount: 1000000,
    strategy: 'cheapest',
  })
  await expectStatus(quoteExpandedRes, 200, 'ACP quote with expanded fields')
  const quoteExpanded = await parseJson(quoteExpandedRes, 'ACP quote with expanded fields')
  assert(typeof quoteExpanded.quote_id === 'string' && quoteExpanded.quote_id.length > 0, 'ACP quote with expanded fields: quote_id missing')

  const invalidStrategyRes = await postJson('/api/acp/quote', {
    from: 'bithumb:KRW',
    to: 'binance:USDC',
    amount: 1000000,
    strategy: 'invalid_strategy',
  })
  await expectStatus(invalidStrategyRes, 400, 'ACP quote invalid strategy')

  const executeRes = await postJson('/api/acp/execute', { quote_id: quoteFromTo.quote_id })
  if (!contractAgentKey) {
    await expectStatus(executeRes, 401, 'ACP execute start (no agent key)')
    const executeUnauthorized = await parseJson(executeRes, 'ACP execute start (no agent key)')
    const errorText = String(executeUnauthorized.error ?? '')
    assert(errorText.toLowerCase().includes('x-agent-key'), 'ACP execute start (no agent key): expected missing key error')
  } else {
    await expectStatus(executeRes, 200, 'ACP execute start')
    const execution = await parseJson(executeRes, 'ACP execute start')
    assert(typeof execution.execution_id === 'string' && execution.execution_id.length > 0, 'ACP execute start: execution_id missing')
    assert(execution.status === 'running' || execution.status === 'completed', `ACP execute start: unexpected status ${execution.status}`)

    const executionStatusRes = await getJson(`/api/acp/executions/${encodeURIComponent(execution.execution_id)}`)
    await expectStatus(executionStatusRes, 200, 'ACP execution status')
    const executionStatus = await parseJson(executionStatusRes, 'ACP execution status')
    assert(executionStatus.execution_id === execution.execution_id, 'ACP execution status: execution_id mismatch')
  }

  const pairsBtcRes = await getJson('/api/route/pairs?coin=BTC')
  await expectStatus(pairsBtcRes, 200, 'Route pairs coin=BTC')
  const pairsBtc = await parseJson(pairsBtcRes, 'Route pairs coin=BTC')
  const btcPairs = Array.isArray(pairsBtc.pairs) ? pairsBtc.pairs : []
  assert(btcPairs.length > 0, 'Route pairs coin=BTC: expected non-empty pairs')
  assert(btcPairs.every((entry) => entry && entry.coin === 'BTC'), 'Route pairs coin=BTC: found non-BTC row')

  const pairsInvalidRes = await getJson('/api/route/pairs?coin=INVALID')
  await expectStatus(pairsInvalidRes, 400, 'Route pairs coin=INVALID')

  const registerInvalidRes = await postJson('/api/agents/register', {})
  await expectStatus(registerInvalidRes, 400, 'Agent register missing name')

  console.log('contract-guard: verification passed')
}

run().catch((err) => {
  console.error(`contract-guard: ${err.message}`)
  process.exit(1)
})
