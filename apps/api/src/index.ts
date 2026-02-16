import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'

import { paymentMiddleware, x402ResourceServer } from '@x402/hono'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions/bazaar'

type Bindings = {
  DB: D1Database
  FACILITATOR_URL: string
  X402_NETWORK: string
  PAYMENT_RECEIVER_ADDRESS: string
  CROSSFIN_ADMIN_TOKEN?: string
}

type Variables = {
  agentId: string
}

type Env = { Bindings: Bindings; Variables: Variables }

type Caip2 = `${string}:${string}`

function requireCaip2(value: string): Caip2 {
  const trimmed = value.trim()
  if (!trimmed || !trimmed.includes(':')) {
    throw new HTTPException(500, { message: 'Invalid X402_NETWORK (expected CAIP-2 like eip155:84532)' })
  }
  return trimmed as Caip2
}

function timingSafeEqual(a: string, b: string): boolean {
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

const app = new Hono<Env>()

app.use('*', cors({
  origin: ['http://localhost:5173', 'https://crossfin.pages.dev', 'https://crossfin.dev', 'https://www.crossfin.dev', 'https://live.crossfin.dev', 'https://crossfin-live.pages.dev'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Agent-Key', 'X-CrossFin-Admin-Token', 'PAYMENT-SIGNATURE'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
}))

function requireAdmin(c: Context<Env>): void {
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

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/', (c) => c.json({ name: 'crossfin-api', version: '1.4.1', status: 'ok' }))
app.get('/api/health', (c) => c.json({ name: 'crossfin-api', version: '1.4.1', status: 'ok' }))

app.get('/api/docs/guide', (c) => {
  return c.json({
    name: 'CrossFin Agent Guide',
    version: '1.4.1',
    overview: {
      what: 'CrossFin is a service gateway for AI agents. Discover, compare, and call x402/REST services through a single API.',
      services: 'Use GET /api/registry/stats for the current active service counts.',
      payment: 'CrossFin services use x402 protocol — pay per API call with USDC on Base mainnet. No API key, no subscription.',
      free: 'Registry search, categories, stats, and the arbitrage demo are all free.',
    },
    quickStart: {
      step1: {
        title: 'Search for services',
        endpoint: 'GET /api/registry/search?q=crypto',
        description: 'Search by keyword. Returns matching services with endpoint, price, and payment metadata.',
        example: 'curl https://crossfin.dev/api/registry/search?q=korea',
      },
      step2: {
        title: 'Get service details',
        endpoint: 'GET /api/registry/{id}',
        description: 'Get full details for a specific service including endpoint URL, pricing, inputSchema/outputExample, and (for CrossFin services) a guide field.',
        example: 'curl https://crossfin.dev/api/registry/crossfin_kimchi_premium',
      },
      step3: {
        title: 'Call the service',
        description:
          'Call the service endpoint directly. For x402 services, the first request returns HTTP 402 with payment details. Sign the payment and resend.',
        freeExample: 'curl https://crossfin.dev/api/arbitrage/demo',
        paidExample: 'Requires x402 client library — see x402Payment section below.',
      },
    },
    freeEndpoints: [
      { path: '/api/health', description: 'Health check' },
      { path: '/api/registry/search?q=', description: 'Search services by keyword' },
      { path: '/api/registry', description: 'List all services (filterable by category)' },
      { path: '/api/registry/categories', description: 'List categories with counts' },
      { path: '/api/registry/stats', description: 'Total service counts' },
      { path: '/api/registry/{id}', description: 'Service details by ID' },
      { path: '/api/arbitrage/demo', description: 'Free kimchi premium preview (top 3 pairs)' },
      { path: '/api/analytics/overview', description: 'Gateway usage analytics' },
      { path: '/api/stats', description: 'Agent/wallet/transaction counts' },
      { path: '/api/openapi.json', description: 'OpenAPI 3.1 specification' },
      { path: '/api/docs/guide', description: 'This guide' },
    ],
    notes: [
      'Proxy endpoints (/api/proxy/:serviceId) require X-Agent-Key to prevent abuse.',
    ],
    crossfinServices: [
      {
        id: 'crossfin_kimchi_premium',
        name: 'Kimchi Premium Index',
        price: '$0.05',
        description:
          'Real-time price spread between Korean (Bithumb) and global (Binance) exchanges for 10+ crypto pairs.',
      },
      {
        id: 'crossfin_kimchi_premium_history',
        name: 'Kimchi Premium History',
        price: '$0.05',
        description: 'Hourly snapshots of kimchi premium data, up to 7 days lookback.',
      },
      {
        id: 'crossfin_arbitrage_opportunities',
        name: 'Arbitrage Opportunities',
        price: '$0.10',
        description: 'Pre-calculated profitable arbitrage routes with fees and risk scores.',
      },
      {
        id: 'crossfin_bithumb_orderbook',
        name: 'Bithumb Orderbook',
        price: '$0.02',
        description: 'Live 30-level orderbook depth from Bithumb for any KRW trading pair.',
      },
      {
        id: 'crossfin_bithumb_volume',
        name: 'Bithumb Volume Analysis',
        price: '$0.03',
        description: '24h volume distribution, concentration, and unusual volume detection.',
      },
      {
        id: 'crossfin_korea_sentiment',
        name: 'Korea Market Sentiment',
        price: '$0.03',
        description: 'Top gainers, losers, volume leaders on Bithumb with market mood indicator.',
      },
      {
        id: 'crossfin_usdkrw',
        name: 'USD/KRW Rate',
        price: '$0.01',
        description: 'Current USD to KRW exchange rate for converting Korean exchange prices.',
      },
      {
        id: 'crossfin_upbit_ticker',
        name: 'Upbit Ticker',
        price: '$0.02',
        description: 'Upbit spot ticker data for any KRW market pair.',
      },
      {
        id: 'crossfin_upbit_orderbook',
        name: 'Upbit Orderbook',
        price: '$0.02',
        description: 'Upbit orderbook snapshot for any KRW market pair.',
      },
      {
        id: 'crossfin_upbit_signals',
        name: 'Upbit Trading Signals',
        price: '$0.05',
        description: 'Momentum, volatility, and volume signals for major Upbit KRW markets.',
      },
      {
        id: 'crossfin_coinone_ticker',
        name: 'Coinone Ticker',
        price: '$0.02',
        description: 'Coinone spot ticker data for any KRW pair.',
      },
      {
        id: 'crossfin_cross_exchange',
        name: 'Cross-Exchange Comparison',
        price: '$0.08',
        description: 'Compare crypto prices across Bithumb, Upbit, Coinone, and Binance simultaneously.',
      },
      {
        id: 'crossfin_korea_headlines',
        name: 'Korea Headlines',
        price: '$0.03',
        description: 'Korean crypto/finance news headlines via Google News RSS feed.',
      },
    ],
    x402Payment: {
      protocol: 'x402 (HTTP 402 Payment Required)',
      network: 'Base mainnet (eip155:8453)',
      currency: 'USDC',
      facilitator: 'Coinbase x402 facilitator',
      flow: [
        '1. Send GET request to paid endpoint',
        '2. Receive HTTP 402 with PAYMENT-REQUIRED header containing payment details (base64 JSON)',
        '3. Parse payment details (amount, recipient, network)',
        '4. Sign USDC transfer with your wallet',
        '5. Resend request with PAYMENT-SIGNATURE header',
        '6. Receive paid response (HTTP 200)',
      ],
      libraries: {
        javascript: '@x402/fetch (wrapFetchWithPayment)',
        python: 'x402 (pip install x402)',
      },
      walletRequirement: 'You need a wallet with USDC on Base mainnet. Minimum $0.01 for cheapest endpoint.',
      codeExamples: {
        curl: "# Free endpoint (no payment)\ncurl https://crossfin.dev/api/arbitrage/demo\n\n# Inspect PAYMENT-REQUIRED header (paid endpoint)\ncurl -s -D - https://crossfin.dev/api/premium/arbitrage/kimchi -o /dev/null",
        javascript: "import { x402Client, wrapFetchWithPayment } from '@x402/fetch';\nimport { registerExactEvmScheme } from '@x402/evm/exact/client';\nimport { privateKeyToAccount } from 'viem/accounts';\n\nconst signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);\nconst client = new x402Client();\nregisterExactEvmScheme(client, { signer });\n\nconst paidFetch = wrapFetchWithPayment(fetch, client);\nconst res = await paidFetch('https://crossfin.dev/api/premium/arbitrage/kimchi', { method: 'GET' });\nconsole.log(await res.json());",
        python: "import os\nfrom eth_account import Account\nfrom x402 import x402ClientSync\nfrom x402.http.clients import x402_requests\nfrom x402.mechanisms.evm import EthAccountSigner\nfrom x402.mechanisms.evm.exact.register import register_exact_evm_client\n\nclient = x402ClientSync()\naccount = Account.from_key(os.environ['EVM_PRIVATE_KEY'])\nregister_exact_evm_client(client, EthAccountSigner(account))\n\nwith x402_requests(client) as session:\n    r = session.get('https://crossfin.dev/api/premium/arbitrage/kimchi')\n    print(r.json())",
      },
    },
    mcpServer: {
      description: 'CrossFin MCP server for Claude Desktop and other MCP clients.',
      install: 'cd apps/mcp-server && npm install && npm run build',
      tools: [
        { name: 'search_services', description: 'Search the service registry by keyword' },
        { name: 'list_services', description: 'List services with optional category filter' },
        { name: 'get_service', description: 'Get details for a specific service' },
        { name: 'list_categories', description: 'List all categories with counts' },
        { name: 'get_kimchi_premium', description: 'Free kimchi premium preview' },
        { name: 'get_analytics', description: 'Gateway usage analytics' },
        { name: 'get_guide', description: 'Get the full CrossFin agent guide' },
        { name: 'create_wallet', description: 'Create a wallet in local ledger' },
        { name: 'get_balance', description: 'Check wallet balance' },
        { name: 'transfer', description: 'Transfer funds between wallets' },
        { name: 'list_transactions', description: 'List recent transactions' },
        { name: 'set_budget', description: 'Set daily spend limit' },
        { name: 'call_paid_service', description: 'Call a paid API with automatic x402 USDC payment (returns data + txHash + basescan link)' },
      ],
      claudeDesktopConfig: {
        mcpServers: {
          crossfin: {
            command: 'node',
            args: ['/path/to/crossfin/apps/mcp-server/dist/index.js'],
            env: {
              CROSSFIN_API_URL: 'https://crossfin.dev',
              EVM_PRIVATE_KEY: '0x...',
            },
          },
        },
      },
    },
    links: {
      website: 'https://crossfin.dev',
      liveDemo: 'https://live.crossfin.dev',
      github: 'https://github.com/bubilife1202/crossfin',
      openapi: 'https://crossfin.dev/api/openapi.json',
    },
  })
})

app.get('/.well-known/crossfin.json', (c) => {
  const origin = new URL(c.req.url).origin
  return c.json({
    name: 'CrossFin',
    version: '1.4.1',
    description: 'Agent-first directory and gateway for x402 services and Korean market data.',
    urls: {
      website: 'https://crossfin.dev',
      origin,
      openapi: `${origin}/api/openapi.json`,
      guide: `${origin}/api/docs/guide`,
      registry: `${origin}/api/registry`,
      registrySearch: `${origin}/api/registry/search?q=`,
    },
    payment: {
      protocol: 'x402',
      network: 'eip155:8453',
      currency: 'USDC',
      note: 'Paid endpoints respond with HTTP 402 and a PAYMENT-REQUIRED header (base64 JSON).',
    },
    mcp: {
      name: 'crossfin',
      repo: 'https://github.com/bubilife1202/crossfin/tree/main/apps/mcp-server',
      env: { CROSSFIN_API_URL: origin },
      tools: [
        'search_services',
        'list_services',
        'get_service',
        'list_categories',
        'get_kimchi_premium',
        'get_analytics',
        'get_guide',
        'call_paid_service',
      ],
    },
    updatedAt: new Date().toISOString(),
  })
})

// === OpenAPI Spec ===

app.get('/api/openapi.json', (c) => {
  return c.json({
    openapi: '3.1.0',
    info: {
      title: 'CrossFin — x402 Agent Services Gateway (Korea)',
      version: '1.4.1',
      description: 'Service registry + pay-per-request APIs for AI agents. Discover x402 services and access Korean market data. Payments via x402 protocol with USDC on Base mainnet.',
      contact: { url: 'https://crossfin.dev' },
      'x-logo': { url: 'https://crossfin.dev/logos/crossfin.png' },
    },
    servers: [{ url: 'https://crossfin.dev', description: 'Production' }],
    paths: {
      '/api/health': {
        get: {
          operationId: 'healthCheck',
          summary: 'Health check',
          tags: ['Free'],
          responses: { '200': { description: 'API status', content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, version: { type: 'string' }, status: { type: 'string' } } } } } } },
        },
      },
      '/api/docs/guide': {
        get: {
          operationId: 'agentGuide',
          summary: 'CrossFin agent onboarding guide',
          description: 'Structured JSON guide for AI agents: how to search services, pricing, x402 payment flow, and MCP usage.',
          tags: ['Free'],
          responses: {
            '200': {
              description: 'Agent guide (JSON)',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/.well-known/crossfin.json': {
        get: {
          operationId: 'crossfinWellKnown',
          summary: 'CrossFin discovery metadata',
          description: 'Well-known discovery endpoint for agents to find CrossFin registry + OpenAPI + guide links.',
          tags: ['Free'],
          responses: {
            '200': {
              description: 'Discovery metadata (JSON)',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/api/arbitrage/demo': {
        get: {
          operationId: 'arbitrageDemo',
          summary: 'Free Kimchi Premium preview (top 3 pairs)',
          description: 'Free preview of the Kimchi Premium index. Shows top 3 pairs by premium percentage. No payment required.',
          tags: ['Free'],
          responses: {
            '200': {
              description: 'Preview of kimchi premium data',
              content: { 'application/json': { schema: { type: 'object', properties: {
                demo: { type: 'boolean' },
                note: { type: 'string' },
                paidEndpoint: { type: 'string' },
                pairsShown: { type: 'integer' },
                totalPairsAvailable: { type: 'integer' },
                preview: { type: 'array', items: { type: 'object', properties: { coin: { type: 'string' }, premiumPct: { type: 'number' }, direction: { type: 'string' } } } },
                avgPremiumPct: { type: 'number' },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
          },
        },
      },
      '/api/premium/arbitrage/kimchi': {
        get: {
          operationId: 'kimchiPremium',
          summary: 'Full Kimchi Premium Index — $0.05 USDC',
          description: 'Real-time price spread between Korean exchange (Bithumb) and global exchanges for 10+ crypto pairs. Includes premium percentage, volume, 24h change for each pair. Payment: $0.05 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Full kimchi premium data for all tracked pairs',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                krwUsdRate: { type: 'number' },
                pairsTracked: { type: 'integer' },
                avgPremiumPct: { type: 'number' },
                topPremium: { type: 'object' },
                premiums: { type: 'array', items: { type: 'object', properties: {
                  coin: { type: 'string' }, bithumbKrw: { type: 'number' }, bithumbUsd: { type: 'number' },
                  binanceUsd: { type: 'number' }, premiumPct: { type: 'number' },
                  volume24hKrw: { type: 'number' }, volume24hUsd: { type: 'number' }, change24hPct: { type: 'number' },
                } } },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.05 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/arbitrage/kimchi/history': {
        get: {
          operationId: 'kimchiPremiumHistory',
          summary: 'Kimchi Premium History (hourly) — $0.05 USDC',
          description: 'Historical hourly snapshots of the Kimchi Premium data captured by CrossFin cron. Query by coin and time range. Payment: $0.05 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [
            { name: 'coin', in: 'query', description: 'Optional coin filter (e.g. BTC, ETH). Default: all', schema: { type: 'string' } },
            { name: 'hours', in: 'query', description: 'Lookback window in hours (default: 24, max: 168)', schema: { type: 'integer', default: 24, maximum: 168 } },
          ],
          responses: {
            '200': {
              description: 'Hourly kimchi premium snapshots',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                coin: { type: ['string', 'null'] },
                hours: { type: 'integer' },
                groupedBy: { type: 'string' },
                range: { type: 'object' },
                snapshots: { type: 'array', items: { type: 'object' } },
                count: { type: 'integer' },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.05 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/arbitrage/opportunities': {
        get: {
          operationId: 'arbitrageOpportunities',
          summary: 'Profitable Arbitrage Routes — $0.10 USDC',
          description: 'Pre-calculated profitable arbitrage routes between Korean and global crypto exchanges. Includes direction, estimated profit after fees (Bithumb 0.25% + Binance 0.10%), volume, and execution risk score. Payment: $0.10 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Arbitrage opportunities sorted by profitability',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                krwUsdRate: { type: 'number' },
                totalOpportunities: { type: 'integer' },
                profitableCount: { type: 'integer' },
                estimatedFeesNote: { type: 'string' },
                bestOpportunity: { type: 'object' },
                opportunities: { type: 'array', items: { type: 'object', properties: {
                  coin: { type: 'string' }, direction: { type: 'string' }, grossPremiumPct: { type: 'number' },
                  estimatedFeesPct: { type: 'number' }, netProfitPct: { type: 'number' },
                  profitPer10kUsd: { type: 'number' }, volume24hUsd: { type: 'number' },
                  riskScore: { type: 'string' }, profitable: { type: 'boolean' },
                } } },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.10 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/bithumb/orderbook': {
        get: {
          operationId: 'bithumbOrderbook',
          summary: 'Live Bithumb Orderbook — $0.02 USDC',
          description: 'Live orderbook depth from Bithumb (Korean exchange) for any trading pair. Top 30 bids and asks with spread calculation. Raw data from a market typically inaccessible to non-Korean users. Payment: $0.02 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [{ name: 'pair', in: 'query', description: 'Trading pair symbol (e.g. BTC, ETH, XRP)', schema: { type: 'string', default: 'BTC' } }],
          responses: {
            '200': {
              description: 'Orderbook depth data',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                pair: { type: 'string' },
                exchange: { type: 'string' },
                bestBidKrw: { type: 'number' }, bestAskKrw: { type: 'number' },
                spreadKrw: { type: 'number' }, spreadPct: { type: 'number' },
                bestBidUsd: { type: 'number' }, bestAskUsd: { type: 'number' },
                depth: { type: 'object', properties: {
                  bids: { type: 'array', items: { type: 'object', properties: { price: { type: 'string' }, quantity: { type: 'string' } } } },
                  asks: { type: 'array', items: { type: 'object', properties: { price: { type: 'string' }, quantity: { type: 'string' } } } },
                } },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.02 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/bithumb/volume-analysis': {
        get: {
          operationId: 'bithumbVolumeAnalysis',
          summary: 'Bithumb 24h Volume Analysis — $0.03 USDC',
          description: 'Bithumb-wide 24h volume analysis: total market volume, top coins by volume, volume concentration (top 5), volume-weighted change, and unusual volume detection. Payment: $0.03 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Volume analysis snapshot',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                totalVolume24hKrw: { type: 'number' },
                totalVolume24hUsd: { type: 'number' },
                totalCoins: { type: 'integer' },
                volumeConcentration: { type: 'object', properties: { top5Pct: { type: 'number' }, top5Coins: { type: 'array', items: { type: 'object' } } } },
                volumeWeightedChangePct: { type: 'number' },
                unusualVolume: { type: 'array', items: { type: 'object' } },
                topByVolume: { type: 'array', items: { type: 'object' } },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.03 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/korea': {
        get: {
          operationId: 'koreaMarketSentiment',
          summary: 'Korean Market Sentiment — $0.03 USDC',
          description: 'Korean crypto market sentiment from Bithumb. Top gainers, losers, volume leaders, total market volume, and overall market mood (bullish/bearish/neutral). Payment: $0.03 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Korean market sentiment data',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                exchange: { type: 'string' },
                totalCoins: { type: 'integer' },
                totalVolume24hUsd: { type: 'number' },
                avgChange24hPct: { type: 'number' },
                marketMood: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
                topGainers: { type: 'array', items: { type: 'object' } },
                topLosers: { type: 'array', items: { type: 'object' } },
                topVolume: { type: 'array', items: { type: 'object' } },
                krwUsdRate: { type: 'number' },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.03 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/fx/usdkrw': {
        get: {
          operationId: 'usdKrwRate',
          summary: 'USD/KRW Exchange Rate — $0.01 USDC',
          description: 'USD to KRW exchange rate used to convert Korean exchange prices into USD. Payment: $0.01 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': { description: 'FX rate', content: { 'application/json': { schema: { type: 'object' } } } },
            '402': { description: 'Payment required — $0.01 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/upbit/ticker': {
        get: {
          operationId: 'upbitTicker',
          summary: 'Upbit Ticker (KRW market) — $0.02 USDC',
          description: 'Upbit spot ticker for a given KRW market symbol (e.g., KRW-BTC). Payment: $0.02 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [{ name: 'market', in: 'query', description: 'Upbit market symbol (e.g. KRW-BTC)', schema: { type: 'string', default: 'KRW-BTC' } }],
          responses: {
            '200': { description: 'Ticker snapshot', content: { 'application/json': { schema: { type: 'object' } } } },
            '402': { description: 'Payment required — $0.02 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/upbit/orderbook': {
        get: {
          operationId: 'upbitOrderbook',
          summary: 'Upbit Orderbook (KRW market) — $0.02 USDC',
          description: 'Upbit orderbook snapshot for a given KRW market symbol (e.g., KRW-BTC). Payment: $0.02 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [{ name: 'market', in: 'query', description: 'Upbit market symbol (e.g. KRW-BTC)', schema: { type: 'string', default: 'KRW-BTC' } }],
          responses: {
            '200': { description: 'Orderbook snapshot', content: { 'application/json': { schema: { type: 'object' } } } },
            '402': { description: 'Payment required — $0.02 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/upbit/signals': {
        get: {
          operationId: 'upbitSignals',
          summary: 'Upbit Trading Signals (Momentum + Volume) — $0.05 USDC',
          description: 'Trading signals for major KRW markets on Upbit (KRW-BTC, KRW-ETH, KRW-XRP, KRW-SOL, KRW-DOGE, KRW-ADA). Includes momentum buckets, relative volume signals, volatility, and a combined bullish/bearish/neutral call. Payment: $0.05 USDC on Base via x402.',
          tags: ['Paid — x402'],
          responses: {
            '200': {
              description: 'Signals snapshot',
              content: { 'application/json': { schema: { type: 'object', properties: {
                paid: { type: 'boolean' },
                service: { type: 'string' },
                signals: { type: 'array', items: { type: 'object', properties: {
                  market: { type: 'string' },
                  priceKrw: { type: 'number' },
                  change24hPct: { type: 'number' },
                  volume24hKrw: { type: 'number' },
                  volatilityPct: { type: 'number' },
                  volumeSignal: { type: 'string', enum: ['high', 'normal', 'low'] },
                  momentum: { type: 'string', enum: ['strong-up', 'up', 'neutral', 'down', 'strong-down'] },
                  signal: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                } } },
                marketSummary: { type: 'object', properties: {
                  bullishCount: { type: 'integer' },
                  bearishCount: { type: 'integer' },
                  neutralCount: { type: 'integer' },
                  overallSentiment: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
                } },
                at: { type: 'string', format: 'date-time' },
              } } } },
            },
            '402': { description: 'Payment required — $0.05 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/coinone/ticker': {
        get: {
          operationId: 'coinoneTicker',
          summary: 'Coinone Ticker (KRW market) — $0.02 USDC',
          description: 'Coinone spot ticker for a given currency symbol (e.g., BTC). Payment: $0.02 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [{ name: 'currency', in: 'query', description: 'Asset symbol (e.g. BTC, ETH)', schema: { type: 'string', default: 'BTC' } }],
          responses: {
            '200': { description: 'Ticker snapshot', content: { 'application/json': { schema: { type: 'object' } } } },
            '402': { description: 'Payment required — $0.02 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/market/cross-exchange': {
        get: {
          operationId: 'crossExchangeComparison',
          summary: 'Cross-Exchange Comparison (Bithumb vs Upbit vs Coinone vs Binance)',
          description: 'Compare crypto prices across 4 exchanges. Shows kimchi premium per exchange and domestic arbitrage opportunities.',
          parameters: [{ name: 'coins', in: 'query', schema: { type: 'string' }, description: 'Comma-separated coins (default: BTC,ETH,XRP,DOGE,ADA,SOL)' }],
          tags: ['Premium — $0.08 USDC'],
          responses: {
            '200': { description: 'Cross-exchange comparison', content: { 'application/json': { schema: { type: 'object' } } } },
            '402': { description: 'Payment required — $0.08 USDC on Base mainnet' },
          },
        },
      },
      '/api/premium/news/korea/headlines': {
        get: {
          operationId: 'koreaHeadlines',
          summary: 'Korean Headlines (RSS) — $0.03 USDC',
          description: 'Top headlines feed for market context (Google News RSS). Payment: $0.03 USDC on Base via x402.',
          tags: ['Paid — x402'],
          parameters: [{ name: 'limit', in: 'query', description: 'Max items (1-20)', schema: { type: 'integer', default: 10 } }],
          responses: {
            '200': { description: 'Headlines list', content: { 'application/json': { schema: { type: 'object' } } } },
            '402': { description: 'Payment required — $0.03 USDC on Base mainnet' },
          },
        },
      },

      '/api/registry': {
        get: {
          operationId: 'registryList',
          summary: 'Service registry list (free)',
          tags: ['Free'],
          parameters: [
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'provider', in: 'query', schema: { type: 'string' } },
            { name: 'isCrossfin', in: 'query', schema: { type: 'string', enum: ['true', 'false', '1', '0'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': { description: 'Registry list', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
        post: {
          operationId: 'registryCreate',
          summary: 'Register a service (requires X-Agent-Key)',
          tags: ['Free'],
          parameters: [{ name: 'X-Agent-Key', in: 'header', required: true, schema: { type: 'string' } }],
          responses: {
            '201': { description: 'Created', content: { 'application/json': { schema: { type: 'object' } } } },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/registry/search': {
        get: {
          operationId: 'registrySearch',
          summary: 'Search services (free)',
          tags: ['Free'],
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': { description: 'Search results', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },
      '/api/registry/categories': {
        get: {
          operationId: 'registryCategories',
          summary: 'List categories (free)',
          tags: ['Free'],
          responses: { '200': { description: 'Categories', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
      '/api/registry/stats': {
        get: {
          operationId: 'registryStats',
          summary: 'Registry stats (free)',
          tags: ['Free'],
          responses: { '200': { description: 'Stats', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
      '/api/registry/{id}': {
        get: {
          operationId: 'registryGet',
          summary: 'Registry service detail (free)',
          tags: ['Free'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Service detail', content: { 'application/json': { schema: { type: 'object' } } } }, '404': { description: 'Not found' } },
        },
      },

      '/api/proxy/{serviceId}': {
        get: {
          operationId: 'proxyGet',
          summary: 'Proxy GET to a registered service (requires X-Agent-Key)',
          description: 'Looks up the service by id in the registry and forwards the request to its endpoint, passing through query params. Logs the call to service_calls. Requires X-Agent-Key to prevent public abuse.',
          tags: ['Free'],
          parameters: [
            { name: 'serviceId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'X-Agent-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Upstream response (passthrough)',
              headers: {
                'X-CrossFin-Proxy': { schema: { type: 'string', enum: ['true'] } },
                'X-CrossFin-Fee': { schema: { type: 'string', enum: ['5%'] } },
              },
              content: { '*/*': { schema: {} } },
            },
            '404': { description: 'Service not found' },
            '405': { description: 'Method not allowed' },
            '429': { description: 'Rate limited' },
            '502': { description: 'Upstream request failed' },
          },
        },
        post: {
          operationId: 'proxyPost',
          summary: 'Proxy POST to a registered service (requires X-Agent-Key)',
          description: 'Looks up the service by id in the registry and forwards the request to its endpoint, passing through query params and request body. Logs the call to service_calls. Requires X-Agent-Key to prevent public abuse.',
          tags: ['Free'],
          parameters: [
            { name: 'serviceId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'X-Agent-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          requestBody: { required: false, content: { '*/*': { schema: {} } } },
          responses: {
            '200': {
              description: 'Upstream response (passthrough)',
              headers: {
                'X-CrossFin-Proxy': { schema: { type: 'string', enum: ['true'] } },
                'X-CrossFin-Fee': { schema: { type: 'string', enum: ['5%'] } },
              },
              content: { '*/*': { schema: {} } },
            },
            '404': { description: 'Service not found' },
            '405': { description: 'Method not allowed' },
            '413': { description: 'Payload too large' },
            '429': { description: 'Rate limited' },
            '502': { description: 'Upstream request failed' },
          },
        },
      },

      '/api/analytics/overview': {
        get: {
          operationId: 'analyticsOverview',
          summary: 'Analytics overview (free)',
          tags: ['Free'],
          responses: { '200': { description: 'Overview stats', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },

      '/api/analytics/services/{serviceId}': {
        get: {
          operationId: 'analyticsService',
          summary: 'Analytics per service (free)',
          tags: ['Free'],
          parameters: [{ name: 'serviceId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Service stats', content: { 'application/json': { schema: { type: 'object' } } } },
            '404': { description: 'Service not found' },
          },
        },
      },
    },
    'x-x402': {
      network: 'eip155:8453',
      networkName: 'Base',
      asset: 'USDC',
      payTo: '0xe4E79Ce6a1377C58f0Bb99D023908858A4DB5779',
      facilitator: 'https://facilitator.x402endpoints.online',
      pricing: {
        '/api/premium/arbitrage/kimchi': '$0.05',
        '/api/premium/arbitrage/kimchi/history': '$0.05',
        '/api/premium/arbitrage/opportunities': '$0.10',
        '/api/premium/bithumb/orderbook': '$0.02',
        '/api/premium/bithumb/volume-analysis': '$0.03',
        '/api/premium/market/korea': '$0.03',
        '/api/premium/market/fx/usdkrw': '$0.01',
        '/api/premium/market/upbit/ticker': '$0.02',
        '/api/premium/market/upbit/orderbook': '$0.02',
        '/api/premium/market/upbit/signals': '$0.05',
        '/api/premium/market/coinone/ticker': '$0.02',
        '/api/premium/market/cross-exchange': '$0.08',
        '/api/premium/news/korea/headlines': '$0.03',
      },
    },
  })
})

app.use(
  '/api/premium/*',
  async (c, next) => {
    const network = requireCaip2(c.env.X402_NETWORK)
    const facilitatorClient = new HTTPFacilitatorClient({ url: c.env.FACILITATOR_URL })
    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register(network, new ExactEvmScheme())
      .registerExtension(bazaarResourceServerExtension)

    const middleware = paymentMiddleware(
      {
        'GET /api/premium/report': {
          accepts: {
            scheme: 'exact',
            price: '$0.001',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'CrossFin premium report (x402)',
          mimeType: 'application/json',
        },
        'GET /api/premium/enterprise': {
          accepts: {
            scheme: 'exact',
            price: '$20.00',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'CrossFin enterprise receipt (x402)',
          mimeType: 'application/json',
        },
        'GET /api/premium/arbitrage/kimchi': {
          accepts: {
            scheme: 'exact',
            price: '$0.05',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Real-time Kimchi Premium Index — price spread between Korean exchanges (Bithumb) and global exchanges (Binance) for top crypto pairs. Unique Korean market data unavailable anywhere else in x402 ecosystem.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-kimchi-premium', krwUsdRate: 1450, pairsTracked: 10, avgPremiumPct: 2.15, premiums: [{ coin: 'BTC', bithumbKrw: 145000000, bithumbUsd: 100000, binanceUsd: 97850, premiumPct: 2.2, volume24hUsd: 5000000 }] },
                schema: { properties: { paid: { type: 'boolean' }, pairsTracked: { type: 'number' }, avgPremiumPct: { type: 'number' }, premiums: { type: 'array' } }, required: ['paid', 'pairsTracked', 'avgPremiumPct', 'premiums'] },
              },
            }),
          },
        },
        'GET /api/premium/arbitrage/kimchi/history': {
          accepts: {
            scheme: 'exact',
            price: '$0.05',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Historical Kimchi Premium snapshots grouped by hour (from CrossFin cron). Query by coin and lookback hours.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { hours: 24, coin: 'BTC' },
              inputSchema: {
                properties: {
                  hours: { type: 'number', description: 'Lookback window in hours (1-168)' },
                  coin: { type: 'string', description: 'Optional coin filter (e.g., BTC, ETH)' },
                },
              },
              output: {
                example: { paid: true, service: 'crossfin-kimchi-premium-history', hours: 24, groupedBy: 'hour', snapshots: [{ coin: 'BTC', premiumPct: 2.2, hour: '2026-02-15T03:00:00Z' }], count: 1 },
                schema: { properties: { paid: { type: 'boolean' }, hours: { type: 'number' }, groupedBy: { type: 'string' }, snapshots: { type: 'array' }, count: { type: 'number' } }, required: ['paid', 'hours', 'groupedBy', 'snapshots', 'count'] },
              },
            }),
          },
        },
        'GET /api/premium/arbitrage/opportunities': {
          accepts: {
            scheme: 'exact',
            price: '$0.10',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Pre-calculated profitable arbitrage routes between Korean and global crypto exchanges. Includes estimated profit after fees, volume, and execution risk score.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-arbitrage-opportunities', totalOpportunities: 10, profitableCount: 3, bestOpportunity: { coin: 'BTC', direction: 'buy-global-sell-korea', netProfitPct: 1.85, riskScore: 'low' }, opportunities: [] },
                schema: { properties: { paid: { type: 'boolean' }, totalOpportunities: { type: 'number' }, profitableCount: { type: 'number' }, opportunities: { type: 'array' } }, required: ['paid', 'totalOpportunities', 'profitableCount', 'opportunities'] },
              },
            }),
          },
        },
        'GET /api/premium/bithumb/orderbook': {
          accepts: {
            scheme: 'exact',
            price: '$0.02',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Live Bithumb (Korean exchange) orderbook depth for any trading pair. Raw bid/ask data from a market typically inaccessible to non-Korean users.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { pair: 'BTC' },
              inputSchema: { properties: { pair: { type: 'string', description: 'Trading pair symbol (BTC, ETH, XRP, etc.)' } } },
              output: {
                example: { paid: true, service: 'crossfin-bithumb-orderbook', pair: 'BTC/KRW', exchange: 'Bithumb', bestBidKrw: 144900000, bestAskKrw: 145000000, spreadPct: 0.07, depth: { bids: [], asks: [] } },
                schema: { properties: { paid: { type: 'boolean' }, pair: { type: 'string' }, bestBidKrw: { type: 'number' }, bestAskKrw: { type: 'number' }, spreadPct: { type: 'number' } }, required: ['paid', 'pair', 'bestBidKrw', 'bestAskKrw'] },
              },
            }),
          },
        },
        'GET /api/premium/bithumb/volume-analysis': {
          accepts: {
            scheme: 'exact',
            price: '$0.03',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Bithumb 24h volume analysis: total market volume, volume concentration, volume-weighted change, and unusual volume detection (2x+ average).',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-bithumb-volume', totalVolume24hKrw: 1234567890, totalVolume24hUsd: 850000, totalCoins: 200, volumeConcentration: { top5Pct: 62.5, top5Coins: [{ coin: 'BTC', volume24hKrw: 400000000, volumeSharePct: 32.4 }] }, volumeWeightedChangePct: 0.75, unusualVolume: [], topByVolume: [], at: '2026-02-15T00:00:00.000Z' },
                schema: {
                  properties: {
                    paid: { type: 'boolean' },
                    service: { type: 'string' },
                    totalVolume24hKrw: { type: 'number' },
                    totalVolume24hUsd: { type: 'number' },
                    totalCoins: { type: 'number' },
                    volumeConcentration: { type: 'object' },
                    volumeWeightedChangePct: { type: 'number' },
                    unusualVolume: { type: 'array' },
                    topByVolume: { type: 'array' },
                    at: { type: 'string' },
                  },
                  required: ['paid', 'service', 'totalVolume24hKrw', 'totalVolume24hUsd', 'totalCoins', 'volumeConcentration', 'volumeWeightedChangePct', 'unusualVolume', 'topByVolume', 'at'],
                },
              },
            }),
          },
        },
        'GET /api/premium/market/korea': {
          accepts: {
            scheme: 'exact',
            price: '$0.03',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Korean crypto market sentiment — top movers, volume leaders, 24h gainers/losers on Bithumb. Unique Korean market intelligence for trading agents.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-korea-sentiment', exchange: 'Bithumb', totalCoins: 200, totalVolume24hUsd: 500000000, marketMood: 'neutral', topGainers: [], topLosers: [], topVolume: [] },
                schema: { properties: { paid: { type: 'boolean' }, totalCoins: { type: 'number' }, totalVolume24hUsd: { type: 'number' }, marketMood: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] } }, required: ['paid', 'totalCoins', 'marketMood'] },
              },
            }),
          },
        },
        'GET /api/premium/market/fx/usdkrw': {
          accepts: {
            scheme: 'exact',
            price: '$0.01',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'USD/KRW exchange rate (for converting KRW exchange prices into USD).',
          mimeType: 'application/json',
        },
        'GET /api/premium/market/upbit/ticker': {
          accepts: {
            scheme: 'exact',
            price: '$0.02',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Upbit spot ticker (KRW market).',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { market: 'KRW-BTC' },
              inputSchema: { properties: { market: { type: 'string', description: 'Upbit market symbol (e.g., KRW-BTC, KRW-ETH)' } } },
              output: {
                example: { paid: true, service: 'crossfin-upbit-ticker', market: 'KRW-BTC', tradePriceKrw: 100000000, tradePriceUsd: 68900, change24hPct: 1.25 },
                schema: { properties: { paid: { type: 'boolean' }, market: { type: 'string' }, tradePriceKrw: { type: 'number' }, tradePriceUsd: { type: 'number' } }, required: ['paid', 'market', 'tradePriceKrw'] },
              },
            }),
          },
        },
        'GET /api/premium/market/upbit/orderbook': {
          accepts: {
            scheme: 'exact',
            price: '$0.02',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Upbit orderbook snapshot (KRW market).',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { market: 'KRW-BTC' },
              inputSchema: { properties: { market: { type: 'string', description: 'Upbit market symbol (e.g., KRW-BTC, KRW-ETH)' } } },
              output: {
                example: { paid: true, service: 'crossfin-upbit-orderbook', market: 'KRW-BTC', bestBidKrw: 99990000, bestAskKrw: 100000000, spreadPct: 0.01 },
                schema: { properties: { paid: { type: 'boolean' }, market: { type: 'string' }, bestBidKrw: { type: 'number' }, bestAskKrw: { type: 'number' }, spreadPct: { type: 'number' } }, required: ['paid', 'market', 'bestBidKrw', 'bestAskKrw'] },
              },
            }),
          },
        },
        'GET /api/premium/market/upbit/signals': {
          accepts: {
            scheme: 'exact',
            price: '$0.05',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Upbit trading signals with momentum, relative volume signal, and volatility for KRW-BTC, KRW-ETH, KRW-XRP, KRW-SOL, KRW-DOGE, KRW-ADA.',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              output: {
                example: { paid: true, service: 'crossfin-upbit-signals', signals: [{ market: 'KRW-BTC', priceKrw: 100000000, change24hPct: 1.25, volume24hKrw: 5000000000, volatilityPct: 2.1, volumeSignal: 'high', momentum: 'up', signal: 'bullish', confidence: 'medium' }], marketSummary: { bullishCount: 2, bearishCount: 1, neutralCount: 3, overallSentiment: 'neutral' }, at: '2026-02-15T00:00:00.000Z' },
                schema: {
                  properties: {
                    paid: { type: 'boolean' },
                    service: { type: 'string' },
                    signals: { type: 'array' },
                    marketSummary: { type: 'object' },
                    at: { type: 'string' },
                  },
                  required: ['paid', 'service', 'signals', 'marketSummary', 'at'],
                },
              },
            }),
          },
        },
        'GET /api/premium/market/coinone/ticker': {
          accepts: {
            scheme: 'exact',
            price: '$0.02',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Coinone spot ticker (KRW market).',
          mimeType: 'application/json',
          extensions: {
            ...declareDiscoveryExtension({
              input: { currency: 'BTC' },
              inputSchema: { properties: { currency: { type: 'string', description: 'Asset symbol (e.g., BTC, ETH, XRP)' } } },
              output: {
                example: { paid: true, service: 'crossfin-coinone-ticker', currency: 'BTC', lastKrw: 100000000, lastUsd: 68900 },
                schema: { properties: { paid: { type: 'boolean' }, currency: { type: 'string' }, lastKrw: { type: 'number' }, lastUsd: { type: 'number' } }, required: ['paid', 'currency', 'lastKrw'] },
              },
            }),
          },
        },
        'GET /api/premium/market/cross-exchange': {
          accepts: {
            scheme: 'exact',
            price: '$0.08',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Cross-exchange comparison across Bithumb, Upbit, Coinone vs Binance. Shows kimchi premium per exchange and domestic arbitrage opportunities.',
          mimeType: 'application/json',
        },
        'GET /api/premium/news/korea/headlines': {
          accepts: {
            scheme: 'exact',
            price: '$0.03',
            network,
            payTo: c.env.PAYMENT_RECEIVER_ADDRESS,
            maxTimeoutSeconds: 300,
          },
          description: 'Korean headlines RSS (Google News feed) for market context.',
          mimeType: 'application/json',
        },
      },
      resourceServer,
    )

    return middleware(c, next)
  },
)

const agentAuth: MiddlewareHandler<Env> = async (c, next) => {
  const apiKey = c.req.header('X-Agent-Key')
  if (!apiKey) throw new HTTPException(401, { message: 'Missing X-Agent-Key header' })

  const agent = await c.env.DB.prepare(
    'SELECT id, status FROM agents WHERE api_key = ?'
  ).bind(apiKey).first<{ id: string; status: string }>()

  if (!agent) throw new HTTPException(401, { message: 'Invalid API key' })
  if (agent.status !== 'active') throw new HTTPException(403, { message: 'Agent suspended' })

  c.set('agentId', agent.id)
  await next()
}

app.post('/api/agents', async (c) => {
  requireAdmin(c)

  const body = await c.req.json<{ name: string }>()
  if (!body.name?.trim()) throw new HTTPException(400, { message: 'name is required' })

  const id = crypto.randomUUID()
  const apiKey = `cf_${crypto.randomUUID().replace(/-/g, '')}`

  await c.env.DB.prepare(
    'INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?)'
  ).bind(id, body.name.trim(), apiKey).run()

  await audit(c.env.DB, id, 'agent.create', 'agents', id, 'success')

  return c.json({ id, name: body.name.trim(), apiKey }, 201)
})

type ServiceStatus = 'active' | 'disabled'

type RegistryService = {
  id: string
  name: string
  description: string | null
  provider: string
  category: string
  endpoint: string
  method: string
  price: string
  currency: string
  network: string | null
  payTo: string | null
  tags: string[]
  inputSchema: unknown | null
  outputExample: unknown | null
  status: ServiceStatus
  isCrossfin: boolean
  createdAt: string
  updatedAt: string
}

type ServiceSeed = Omit<RegistryService, 'isCrossfin' | 'createdAt' | 'updatedAt' | 'tags' | 'inputSchema' | 'outputExample'> & {
  tags?: string[]
  inputSchema?: unknown
  outputExample?: unknown
  isCrossfin?: boolean
}

type ServiceGuide = {
  whatItDoes: string
  whenToUse: string[]
  howToCall: string[]
  exampleCurl: string
  notes?: string[]
  relatedServiceIds?: string[]
}

type RegistryServiceResponse = RegistryService & { guide?: ServiceGuide }

type CrossfinRuntimeDocs = {
  guide: ServiceGuide
  inputSchema: unknown
  outputExample: unknown
}

const CROSSFIN_RUNTIME_DOCS: Record<string, CrossfinRuntimeDocs> = {
  crossfin_kimchi_premium: {
    guide: {
      whatItDoes: 'Real-time Kimchi Premium index: price spread between Korean exchange (Bithumb) and global exchange (Binance) across 10+ pairs.',
      whenToUse: [
        'Detect Korea-vs-global mispricing (kimchi premium) in real time',
        'Build Korea market sentiment signals or arbitrage monitors',
        'Use as an input feature for trading/risk models',
      ],
      howToCall: [
        'Send GET request to the endpoint',
        'Handle HTTP 402 (x402 payment required) and pay with USDC on Base',
        'Retry with PAYMENT-SIGNATURE header to receive data',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/arbitrage/kimchi -o /dev/null',
      notes: ['Cheapest way to preview is GET /api/arbitrage/demo (free, top 3 pairs).'],
      relatedServiceIds: ['crossfin_arbitrage_opportunities', 'crossfin_cross_exchange', 'crossfin_usdkrw'],
    },
    inputSchema: {
      type: 'http',
      method: 'GET',
      query: {},
    },
    outputExample: {
      paid: true,
      service: 'crossfin-kimchi-premium',
      krwUsdRate: 1450,
      pairsTracked: 12,
      avgPremiumPct: 2.15,
      topPremium: { coin: 'XRP', premiumPct: 4.12 },
      premiums: [
        {
          coin: 'BTC',
          bithumbKrw: 145000000,
          bithumbUsd: 100000,
          binanceUsd: 97850,
          premiumPct: 2.2,
          volume24hUsd: 5000000,
          change24hPct: 1.1,
        },
      ],
      at: '2026-02-15T00:00:00.000Z',
    },
  },
  crossfin_kimchi_premium_history: {
    guide: {
      whatItDoes: 'Hourly historical snapshots of kimchi premium captured by CrossFin cron (up to 7 days lookback).',
      whenToUse: [
        'Backtest kimchi premium strategies',
        'Compute moving averages/volatility of premium',
        'Compare premium regimes across coins',
      ],
      howToCall: [
        'Send GET request with optional coin/hours query params',
        'Pay via x402 if HTTP 402 is returned',
        'Use the returned snapshots array for analysis',
      ],
      exampleCurl: 'curl -s -D - "https://crossfin.dev/api/premium/arbitrage/kimchi/history?hours=24" -o /dev/null',
      notes: ['hours defaults to 24, max 168. coin is optional (e.g. BTC, ETH).'],
      relatedServiceIds: ['crossfin_kimchi_premium'],
    },
    inputSchema: {
      type: 'http',
      method: 'GET',
      query: {
        coin: { type: 'string', required: false, example: 'BTC', description: 'Optional coin filter (BTC, ETH, XRP...)' },
        hours: { type: 'integer', required: false, example: 24, description: 'Lookback window in hours (max 168)' },
      },
    },
    outputExample: {
      paid: true,
      service: 'crossfin-kimchi-history',
      coin: 'BTC',
      hours: 24,
      groupedBy: 'hour',
      snapshots: [{ at: '2026-02-15T00:00:00.000Z', avgPremiumPct: 2.1 }],
      count: 24,
      at: '2026-02-15T00:00:00.000Z',
    },
  },
  crossfin_arbitrage_opportunities: {
    guide: {
      whatItDoes: 'Pre-calculated profitable arbitrage routes between Korean and global exchanges with fee assumptions and risk scoring.',
      whenToUse: [
        'Find best routes to exploit kimchi premium with fees considered',
        'Generate ranked opportunities list for execution bots',
        'Monitor market stress (risk score shifts) across routes',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Read opportunities[] sorted by net profitability',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/arbitrage/opportunities -o /dev/null',
      relatedServiceIds: ['crossfin_kimchi_premium', 'crossfin_cross_exchange'],
    },
    inputSchema: { type: 'http', method: 'GET', query: {} },
    outputExample: {
      paid: true,
      service: 'crossfin-arbitrage-opportunities',
      totalOpportunities: 24,
      profitableCount: 8,
      bestOpportunity: { coin: 'XRP', netProfitPct: 1.2, direction: 'Buy global, sell Korea' },
      opportunities: [{ coin: 'XRP', netProfitPct: 1.2, grossPremiumPct: 2.3, estimatedFeesPct: 1.1, riskScore: 'medium' }],
      at: '2026-02-15T00:00:00.000Z',
    },
  },
  crossfin_bithumb_orderbook: {
    guide: {
      whatItDoes: 'Live 30-level orderbook depth from Bithumb (KRW market), including spread metrics and USD conversions.',
      whenToUse: [
        'Estimate slippage and liquidity for a KRW pair on Bithumb',
        'Compute cross-exchange execution costs',
        'Drive market-making/hedging strategies',
      ],
      howToCall: [
        'Send GET with pair= (e.g. BTC, ETH)',
        'Pay via x402 if HTTP 402 is returned',
        'Use depth.bids/asks for execution models',
      ],
      exampleCurl: 'curl -s -D - "https://crossfin.dev/api/premium/bithumb/orderbook?pair=BTC" -o /dev/null',
      notes: ['pair is KRW market symbol (BTC, ETH, XRP...).'],
      relatedServiceIds: ['crossfin_kimchi_premium', 'crossfin_cross_exchange'],
    },
    inputSchema: {
      type: 'http',
      method: 'GET',
      query: { pair: { type: 'string', required: true, example: 'BTC', description: 'KRW trading pair symbol' } },
    },
    outputExample: {
      paid: true,
      service: 'crossfin-bithumb-orderbook',
      pair: 'BTC',
      exchange: 'bithumb',
      bestBidKrw: 145000000,
      bestAskKrw: 145100000,
      spreadKrw: 100000,
      spreadPct: 0.07,
      depth: { bids: [{ price: '145000000', quantity: '0.12' }], asks: [{ price: '145100000', quantity: '0.10' }] },
      at: '2026-02-15T00:00:00.000Z',
    },
  },
  crossfin_bithumb_volume: {
    guide: {
      whatItDoes: 'Bithumb-wide 24h volume analysis: top coins, volume concentration, unusual volume detection, and USD conversions.',
      whenToUse: [
        'Detect attention rotation in Korean markets',
        'Spot unusually active coins for momentum scans',
        'Estimate market-wide liquidity on Bithumb',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Use unusualVolume/topByVolume for signals',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/bithumb/volume-analysis -o /dev/null',
      relatedServiceIds: ['crossfin_korea_sentiment', 'crossfin_upbit_signals'],
    },
    inputSchema: { type: 'http', method: 'GET', query: {} },
    outputExample: {
      paid: true,
      service: 'crossfin-bithumb-volume-analysis',
      totalVolume24hUsd: 123456789,
      totalCoins: 200,
      volumeConcentration: { top5Pct: 42.1, top5Coins: [{ coin: 'BTC', pct: 12.3 }] },
      unusualVolume: [{ coin: 'XRP', score: 2.1 }],
      topByVolume: [{ coin: 'BTC', volume24hUsd: 50000000 }],
      at: '2026-02-15T00:00:00.000Z',
    },
  },
  crossfin_korea_sentiment: {
    guide: {
      whatItDoes: 'Korean market sentiment snapshot from Bithumb: top gainers/losers, volume leaders, and a mood indicator.',
      whenToUse: [
        'Quickly gauge market mood (bullish/bearish/neutral) in Korea',
        'Generate watchlists for movers and liquidity',
        'Augment global crypto sentiment with Korea-specific view',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Use movers and volume leaders to build alerts',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/market/korea -o /dev/null',
      relatedServiceIds: ['crossfin_bithumb_volume', 'crossfin_kimchi_premium'],
    },
    inputSchema: { type: 'http', method: 'GET', query: {} },
    outputExample: {
      paid: true,
      service: 'crossfin-korea-market',
      mood: 'neutral',
      gainers: [{ coin: 'XRP', change24hPct: 8.1 }],
      losers: [{ coin: 'ADA', change24hPct: -6.2 }],
      volumeLeaders: [{ coin: 'BTC', volume24hUsd: 50000000 }],
      at: '2026-02-15T00:00:00.000Z',
    },
  },
  crossfin_usdkrw: {
    guide: {
      whatItDoes: 'USD/KRW exchange rate used across CrossFin for converting KRW-denominated exchange prices into USD.',
      whenToUse: [
        'Convert KRW price feeds into USD',
        'Compute premiums in USD terms',
        'Normalize Korean exchange metrics with global markets',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Use usdKrw value in downstream calculations',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/market/fx/usdkrw -o /dev/null',
      relatedServiceIds: ['crossfin_kimchi_premium', 'crossfin_cross_exchange'],
    },
    inputSchema: { type: 'http', method: 'GET', query: {} },
    outputExample: { paid: true, service: 'crossfin-usdkrw', usdKrw: 1375.23, at: '2026-02-15T00:00:00.000Z' },
  },
  crossfin_upbit_ticker: {
    guide: {
      whatItDoes: 'Upbit spot ticker for a KRW market symbol (e.g. KRW-BTC).',
      whenToUse: [
        'Fetch Upbit last trade price and 24h change for KRW markets',
        'Compare Upbit vs Bithumb vs global exchanges',
        'Drive KRW market alerts',
      ],
      howToCall: [
        'Send GET with market= (e.g. KRW-BTC)',
        'Pay via x402 if HTTP 402 is returned',
        'Read price/change/volume fields',
      ],
      exampleCurl: 'curl -s -D - "https://crossfin.dev/api/premium/market/upbit/ticker?market=KRW-BTC" -o /dev/null',
      relatedServiceIds: ['crossfin_cross_exchange', 'crossfin_usdkrw'],
    },
    inputSchema: {
      type: 'http',
      method: 'GET',
      query: { market: { type: 'string', required: true, example: 'KRW-BTC', description: 'Upbit market symbol' } },
    },
    outputExample: { paid: true, service: 'crossfin-upbit-ticker', market: 'KRW-BTC', tradePriceKrw: 123456789, change24hPct: 1.2, at: '2026-02-15T00:00:00.000Z' },
  },
  crossfin_upbit_orderbook: {
    guide: {
      whatItDoes: 'Upbit orderbook snapshot for a KRW market symbol (e.g. KRW-BTC).',
      whenToUse: [
        'Estimate Upbit liquidity and spread',
        'Compare depth vs Bithumb',
        'Compute execution-aware signals',
      ],
      howToCall: [
        'Send GET with market= (e.g. KRW-BTC)',
        'Pay via x402 if HTTP 402 is returned',
        'Use units[] for depth calculations',
      ],
      exampleCurl: 'curl -s -D - "https://crossfin.dev/api/premium/market/upbit/orderbook?market=KRW-BTC" -o /dev/null',
      relatedServiceIds: ['crossfin_upbit_ticker', 'crossfin_bithumb_orderbook'],
    },
    inputSchema: {
      type: 'http',
      method: 'GET',
      query: { market: { type: 'string', required: true, example: 'KRW-BTC', description: 'Upbit market symbol' } },
    },
    outputExample: { paid: true, service: 'crossfin-upbit-orderbook', market: 'KRW-BTC', units: [{ bidPrice: 123, bidSize: 0.5, askPrice: 124, askSize: 0.4 }], at: '2026-02-15T00:00:00.000Z' },
  },
  crossfin_upbit_signals: {
    guide: {
      whatItDoes: 'Trading signals for major Upbit KRW markets using momentum, volatility, and relative volume features.',
      whenToUse: [
        'Run a lightweight momentum/volatility scan for KRW markets',
        'Rank markets for potential breakout or mean reversion',
        'Drive alerting and watchlist generation',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Use signals[] for per-market features and combined call',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/market/upbit/signals -o /dev/null',
      relatedServiceIds: ['crossfin_upbit_ticker', 'crossfin_bithumb_volume'],
    },
    inputSchema: { type: 'http', method: 'GET', query: {} },
    outputExample: { paid: true, service: 'crossfin-upbit-signals', signals: [{ market: 'KRW-BTC', momentum: 'neutral', volume: 'high', volatility: 'medium', call: 'neutral' }], at: '2026-02-15T00:00:00.000Z' },
  },
  crossfin_coinone_ticker: {
    guide: {
      whatItDoes: 'Coinone spot ticker for a given currency symbol (e.g. BTC).',
      whenToUse: [
        'Fetch Coinone KRW market price for a coin',
        'Triangulate Korea pricing across exchanges',
        'Build exchange comparison dashboards',
      ],
      howToCall: [
        'Send GET with currency= (e.g. BTC)',
        'Pay via x402 if HTTP 402 is returned',
        'Read price and volume fields',
      ],
      exampleCurl: 'curl -s -D - "https://crossfin.dev/api/premium/market/coinone/ticker?currency=BTC" -o /dev/null',
      relatedServiceIds: ['crossfin_cross_exchange', 'crossfin_usdkrw'],
    },
    inputSchema: { type: 'http', method: 'GET', query: { currency: { type: 'string', required: true, example: 'BTC', description: 'Coinone currency symbol' } } },
    outputExample: { paid: true, service: 'crossfin-coinone-ticker', currency: 'BTC', lastKrw: 123456789, change24hPct: 0.8, at: '2026-02-15T00:00:00.000Z' },
  },
  crossfin_cross_exchange: {
    guide: {
      whatItDoes: 'Compare crypto prices across Bithumb, Upbit, Coinone, and Binance in one response. Includes premiums per exchange.',
      whenToUse: [
        'Compare KRW prices vs global USD prices across exchanges',
        'Identify domestic vs global dislocations by exchange',
        'Generate an exchange-aware kimchi premium view',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Use comparison[] to compute per-exchange spreads',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/market/cross-exchange -o /dev/null',
      relatedServiceIds: ['crossfin_kimchi_premium', 'crossfin_usdkrw'],
    },
    inputSchema: { type: 'http', method: 'GET', query: {} },
    outputExample: { paid: true, service: 'crossfin-cross-exchange', comparisons: [{ coin: 'BTC', bithumbKrw: 1, upbitKrw: 1, coinoneKrw: 1, binanceUsd: 1, premiumPctBithumb: 2.1 }], at: '2026-02-15T00:00:00.000Z' },
  },
  crossfin_korea_headlines: {
    guide: {
      whatItDoes: 'Korean headlines feed (Google News RSS) for market context. Returns a list of recent headlines with publishers and links.',
      whenToUse: [
        'Add Korea news context to trading/analysis agents',
        'Run keyword monitoring and summarization pipelines',
        'Correlate market moves with headline bursts',
      ],
      howToCall: [
        'Send GET request',
        'Pay via x402 if HTTP 402 is returned',
        'Use items[] as input to summarizers or alerting',
      ],
      exampleCurl: 'curl -s -D - https://crossfin.dev/api/premium/news/korea/headlines -o /dev/null',
      notes: ['This endpoint parses RSS and may occasionally omit fields if the feed changes.'],
      relatedServiceIds: ['crossfin_kimchi_premium'],
    },
    inputSchema: { type: 'http', method: 'GET', query: { limit: { type: 'integer', required: false, example: 20, description: 'Max items (1..50). Default 20.' } } },
    outputExample: { paid: true, service: 'crossfin-korea-headlines', items: [{ title: 'Korean market headline', publisher: 'Example', link: 'https://news.google.com/...', publishedAt: '2026-02-15T00:00:00.000Z' }], at: '2026-02-15T00:00:00.000Z' },
  },
}

function applyCrossfinDocs(service: RegistryService): RegistryServiceResponse {
  if (!service.isCrossfin) return service
  const docs = CROSSFIN_RUNTIME_DOCS[service.id]
  if (!docs) return service
  return {
    ...service,
    guide: docs.guide,
    inputSchema: docs.inputSchema,
    outputExample: docs.outputExample,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonArrayOfStrings(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function parseJsonObject(value: string | null): unknown | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed
  } catch {
    return null
  }
}

function normalizeMethod(method: string | undefined): string {
  const raw = (method ?? '').trim().toUpperCase()
  if (!raw) return 'UNKNOWN'
  if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(raw)) return raw
  return 'UNKNOWN'
}

function isIpv4Address(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4) return false
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return false
    const n = Number(part)
    if (!Number.isInteger(n) || n < 0 || n > 255) return false
  }
  return true
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isIpv4Address(hostname)) return false
  const parts = hostname.split('.')
  if (parts.length !== 4) return false
  const a = Number(parts[0])
  const b = Number(parts[1])
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a >= 224) return true
  return false
}

function isIpv6Address(hostname: string): boolean {
  return hostname.includes(':')
}

function assertPublicHostname(url: URL): void {
  const hostname = url.hostname.trim().toLowerCase()
  if (!hostname) throw new HTTPException(400, { message: 'endpoint hostname is required' })

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new HTTPException(400, { message: 'endpoint hostname is not allowed' })
  }
  if (hostname === 'metadata.google.internal') {
    throw new HTTPException(400, { message: 'endpoint hostname is not allowed' })
  }

  if (isIpv6Address(hostname)) {
    throw new HTTPException(400, { message: 'endpoint must not be an IP address' })
  }
  if (isPrivateIpv4(hostname)) {
    throw new HTTPException(400, { message: 'endpoint must not be a private IP address' })
  }
  if (hostname === '169.254.169.254' || hostname === '0.0.0.0') {
    throw new HTTPException(400, { message: 'endpoint hostname is not allowed' })
  }
}

function requireHttpsUrl(value: string): string {
  const raw = value.trim()
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new HTTPException(400, { message: 'endpoint must be a valid URL' })
  }
  if (url.protocol !== 'https:') {
    throw new HTTPException(400, { message: 'endpoint must start with https://' })
  }
  return url.toString()
}

function requirePublicHttpsUrl(value: string): string {
  const raw = requireHttpsUrl(value)
  const url = new URL(raw)
  assertPublicHostname(url)
  return url.toString()
}

const PROXY_ALLOWED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-encoding',
  'cache-control',
  'etag',
  'last-modified',
  'vary',
  'payment-required',
  'payment-response',
] as const

function buildProxyResponseHeaders(upstreamHeaders: Headers): Headers {
  const outHeaders = new Headers()

  for (const headerName of PROXY_ALLOWED_RESPONSE_HEADERS) {
    const value = upstreamHeaders.get(headerName)
    if (value) outHeaders.set(headerName, value)
  }

  outHeaders.set('X-Content-Type-Options', 'nosniff')
  outHeaders.set('X-CrossFin-Proxy', 'true')
  outHeaders.set('X-CrossFin-Fee', '5%')
  return outHeaders
}

function mapServiceRow(row: Record<string, unknown>): RegistryService {
  const tags = parseJsonArrayOfStrings(typeof row.tags === 'string' ? row.tags : null)
  const statusRaw = typeof row.status === 'string' ? row.status : 'active'

  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    description: row.description === null || row.description === undefined ? null : String(row.description),
    provider: String(row.provider ?? ''),
    category: String(row.category ?? ''),
    endpoint: String(row.endpoint ?? ''),
    method: String(row.method ?? 'UNKNOWN'),
    price: String(row.price ?? ''),
    currency: String(row.currency ?? 'USDC'),
    network: row.network === null || row.network === undefined ? null : String(row.network),
    payTo: row.pay_to === null || row.pay_to === undefined ? null : String(row.pay_to),
    tags,
    inputSchema: parseJsonObject(typeof row.input_schema === 'string' ? row.input_schema : null),
    outputExample: parseJsonObject(typeof row.output_example === 'string' ? row.output_example : null),
    status: statusRaw === 'disabled' ? 'disabled' : 'active',
    isCrossfin: Number(row.is_crossfin ?? 0) === 1,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

async function fetchX402EngineSeeds(): Promise<ServiceSeed[]> {
  const url = 'https://x402-gateway-production.up.railway.app/.well-known/x402.json'
  const res = await fetch(url, { headers: { 'User-Agent': 'crossfin-registry-seed/1.0' } })
  if (!res.ok) return []

  const json: unknown = await res.json()
  if (!isRecord(json)) return []

  const networks = isRecord(json.networks) ? json.networks : null
  const base = networks && isRecord(networks.base) ? networks.base : null
  const network = base && typeof base.caip2 === 'string' ? base.caip2 : 'eip155:8453'
  const currency = base && typeof base.stablecoin === 'string' ? base.stablecoin : 'USDC'

  const categories = isRecord(json.categories) ? json.categories : null
  if (!categories) return []

  const seeds: ServiceSeed[] = []
  for (const [cat, value] of Object.entries(categories)) {
    if (!Array.isArray(value)) continue
    for (const item of value) {
      if (!isRecord(item)) continue
      const id = typeof item.id === 'string' ? item.id : ''
      const name = typeof item.name === 'string' ? item.name : ''
      const price = typeof item.price === 'string' ? item.price : ''
      const endpoint = typeof item.endpoint === 'string' ? item.endpoint : ''
      if (!id || !name || !price || !endpoint) continue

      const rawCat = String(cat)
      const isKnownDead =
        rawCat === 'compute' ||
        id.startsWith('image') ||
        id.startsWith('code') ||
        id.startsWith('audio') ||
        id.startsWith('llm') ||
        id.startsWith('wallet') ||
        id.startsWith('tx-') ||
        id === 'token-prices' ||
        id === 'ipfs-pin'
      const status: ServiceStatus = isKnownDead ? 'disabled' : 'active'

      seeds.push({
        id: `x402engine_${id}`,
        name,
        description: null,
        provider: 'x402engine',
        category: `x402engine:${rawCat}`,
        endpoint,
        method: 'UNKNOWN',
        price,
        currency,
        network,
        payTo: null,
        status,
        tags: ['x402', 'external', 'x402engine', rawCat],
      })
    }
  }

  return seeds
}

async function fetchEinsteinAiSeeds(): Promise<ServiceSeed[]> {
  const url = 'https://emc2ai.io/.well-known/x402.json'
  const res = await fetch(url, { headers: { 'User-Agent': 'crossfin-registry-seed/1.0' } })
  if (!res.ok) return []

  const json: unknown = await res.json()
  if (!isRecord(json)) return []

  const endpoints = isRecord(json.endpoints) ? json.endpoints : null
  const baseUrlRaw = endpoints && typeof endpoints.base === 'string' ? endpoints.base.trim() : ''
  if (!baseUrlRaw) return []

  let origin = 'https://emc2ai.io'
  try {
    origin = new URL(baseUrlRaw).origin
  } catch {
    origin = 'https://emc2ai.io'
  }

  const services = Array.isArray(json.services) ? json.services : []

  function toIdPart(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+/, '')
      .replace(/_+$/, '')
      .slice(0, 120)
  }

  function titleFromPath(path: string): string {
    const parts = path.split('/').filter(Boolean)
    const tail = parts.slice(-2).join(' ')
    const friendly = (tail || parts.slice(-1)[0] || path).replace(/-/g, ' ').trim()
    return friendly ? `Einstein AI ${friendly}` : 'Einstein AI Service'
  }

  const seeds: ServiceSeed[] = []
  for (const item of services) {
    if (!isRecord(item)) continue
    const path = typeof item.path === 'string' ? item.path.trim() : ''
    const method = typeof item.method === 'string' ? item.method.trim() : 'UNKNOWN'
    const description = typeof item.description === 'string' ? item.description.trim() : null
    const cat = typeof item.category === 'string' ? item.category.trim() : 'other'

    const pricing = isRecord(item.pricing) ? item.pricing : null
    const asset = pricing && typeof pricing.asset === 'string' ? pricing.asset.trim() : 'USDC'
    const amount = pricing && typeof pricing.amount === 'string' ? pricing.amount.trim() : ''
    const network = pricing && typeof pricing.network === 'string' ? pricing.network.trim() : 'eip155:8453'

    if (!path) continue

    const endpoint = path.startsWith('http')
      ? path
      : path.startsWith('/')
          ? `${origin}${path}`
          : `${baseUrlRaw.replace(/\/$/, '')}/${path}`

    const tags = Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === 'string') : []
    const idPart = toIdPart(path)
    const id = idPart ? `einstein_${idPart}` : `einstein_${crypto.randomUUID()}`
    const name = titleFromPath(path)
    const price = amount ? `$${amount}` : '$0.01+'

    seeds.push({
      id,
      name,
      description,
      provider: 'einstein-ai',
      category: `einstein:${cat || 'other'}`,
      endpoint,
      method,
      price,
      currency: asset || 'USDC',
      network: network || null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'einstein', ...tags],
    })
  }

  return seeds
}

async function ensureRegistrySeeded(
  db: D1Database,
  receiverAddress: string,
  input?: { force?: boolean }
): Promise<void> {
  let row: { count: number | string } | null
  try {
    row = await db.prepare('SELECT COUNT(*) as count FROM services').first<{ count: number | string }>()
  } catch {
    throw new HTTPException(500, { message: 'DB schema not migrated (services table missing)' })
  }

  const count = row ? Number(row.count) : 0
  if (!input?.force && Number.isFinite(count) && count > 0) return

  const crossfinSeeds: ServiceSeed[] = [
    {
      id: 'crossfin_kimchi_premium',
      name: 'CrossFin Kimchi Premium Index',
      description: 'Real-time price spread between Korean exchange (Bithumb) and global markets.',
      provider: 'crossfin',
      category: 'korea-crypto',
      endpoint: 'https://crossfin.dev/api/premium/arbitrage/kimchi',
      method: 'GET',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['korea', 'crypto', 'arbitrage', 'kimchi-premium'],
    },
    {
      id: 'crossfin_kimchi_premium_history',
      name: 'CrossFin Kimchi Premium History (Hourly)',
      description: 'Historical hourly snapshots of kimchi premium data captured by CrossFin cron.',
      provider: 'crossfin',
      category: 'korea-crypto',
      endpoint: 'https://crossfin.dev/api/premium/arbitrage/kimchi/history?hours=24',
      method: 'GET',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['korea', 'crypto', 'arbitrage', 'kimchi-premium', 'history'],
    },
    {
      id: 'crossfin_arbitrage_opportunities',
      name: 'CrossFin Arbitrage Opportunities',
      description: 'Pre-calculated profitable arbitrage routes between Korean and global exchanges.',
      provider: 'crossfin',
      category: 'korea-crypto',
      endpoint: 'https://crossfin.dev/api/premium/arbitrage/opportunities',
      method: 'GET',
      price: '$0.10',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['korea', 'crypto', 'arbitrage'],
    },
    {
      id: 'crossfin_bithumb_orderbook',
      name: 'CrossFin Bithumb Orderbook',
      description: 'Live orderbook depth from Bithumb for any KRW pair.',
      provider: 'crossfin',
      category: 'korea-crypto',
      endpoint: 'https://crossfin.dev/api/premium/bithumb/orderbook?pair=BTC',
      method: 'GET',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['korea', 'crypto', 'orderbook', 'bithumb'],
    },
    {
      id: 'crossfin_bithumb_volume',
      name: 'CrossFin Bithumb Volume Analysis',
      description: 'Bithumb-wide 24h volume analysis with concentration and unusual volume detection.',
      provider: 'crossfin',
      category: 'korea-crypto',
      endpoint: 'https://crossfin.dev/api/premium/bithumb/volume-analysis',
      method: 'GET',
      price: '$0.03',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['korea', 'crypto', 'bithumb', 'volume', 'analysis'],
    },
    {
      id: 'crossfin_korea_sentiment',
      name: 'CrossFin Korea Market Sentiment',
      description: 'Top movers and volume leaders on Bithumb.',
      provider: 'crossfin',
      category: 'korea-crypto',
      endpoint: 'https://crossfin.dev/api/premium/market/korea',
      method: 'GET',
      price: '$0.03',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['korea', 'crypto', 'sentiment'],
    },
    {
      id: 'crossfin_usdkrw',
      name: 'CrossFin USD/KRW Rate',
      description: 'USD to KRW exchange rate used for converting Korean exchange prices.',
      provider: 'crossfin',
      category: 'fx',
      endpoint: 'https://crossfin.dev/api/premium/market/fx/usdkrw',
      method: 'GET',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['fx', 'krw', 'usd'],
    },
    {
      id: 'crossfin_upbit_ticker',
      name: 'CrossFin Upbit Ticker',
      description: 'Upbit spot ticker (KRW market).',
      provider: 'crossfin',
      category: 'korea-crypto',
      endpoint: 'https://crossfin.dev/api/premium/market/upbit/ticker?market=KRW-BTC',
      method: 'GET',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['korea', 'crypto', 'upbit', 'ticker'],
    },
    {
      id: 'crossfin_upbit_orderbook',
      name: 'CrossFin Upbit Orderbook',
      description: 'Upbit orderbook snapshot (KRW market).',
      provider: 'crossfin',
      category: 'korea-crypto',
      endpoint: 'https://crossfin.dev/api/premium/market/upbit/orderbook?market=KRW-BTC',
      method: 'GET',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['korea', 'crypto', 'upbit', 'orderbook'],
    },
    {
      id: 'crossfin_upbit_signals',
      name: 'CrossFin Upbit Trading Signals',
      description: 'Upbit momentum + relative volume + volatility trading signals for major KRW markets.',
      provider: 'crossfin',
      category: 'korea-crypto',
      endpoint: 'https://crossfin.dev/api/premium/market/upbit/signals',
      method: 'GET',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['korea', 'crypto', 'upbit', 'signals', 'momentum'],
    },
    {
      id: 'crossfin_coinone_ticker',
      name: 'CrossFin Coinone Ticker',
      description: 'Coinone spot ticker (KRW market).',
      provider: 'crossfin',
      category: 'korea-crypto',
      endpoint: 'https://crossfin.dev/api/premium/market/coinone/ticker?currency=BTC',
      method: 'GET',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['korea', 'crypto', 'coinone', 'ticker'],
    },
    {
      id: 'crossfin_cross_exchange',
      name: 'CrossFin Cross-Exchange Comparison',
      description: 'Compare crypto prices across Bithumb, Upbit, Coinone, and Binance. Shows kimchi premium per exchange and domestic arbitrage opportunities.',
      provider: 'crossfin',
      category: 'korea-crypto',
      endpoint: 'https://crossfin.dev/api/premium/market/cross-exchange',
      method: 'GET',
      price: '$0.08',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['korea', 'x402', 'crossfin', 'exchange', 'comparison', 'arbitrage', 'kimchi-premium'],
    },
    {
      id: 'crossfin_korea_headlines',
      name: 'CrossFin Korea Headlines (RSS)',
      description: 'Top headlines feed for Korean market context (Google News RSS).',
      provider: 'crossfin',
      category: 'news',
      endpoint: 'https://crossfin.dev/api/premium/news/korea/headlines',
      method: 'GET',
      price: '$0.03',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: receiverAddress,
      status: 'active',
      isCrossfin: true,
      tags: ['korea', 'news', 'rss'],
    },
  ]

  const externalSeeds: ServiceSeed[] = [
    {
      id: 'invy_wallet_holdings',
      name: 'invy.bot Wallet Holdings Lookup',
      description: 'Wallet holdings lookup across chains (x402).',
      provider: 'invy.bot',
      category: 'wallet-intel',
      endpoint: 'https://invy.bot/{address}',
      method: 'UNKNOWN',
      price: '$0.01+',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'wallet'],
    },
    {
      id: 'minifetch_metadata',
      name: 'Minifetch Metadata Extraction',
      description: 'Extract metadata and links from web pages (x402).',
      provider: 'minifetch',
      category: 'web',
      endpoint: 'https://minifetch.com',
      method: 'UNKNOWN',
      price: '$0.002+',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'web'],
    },
    {
      id: 'pinata_x402',
      name: 'Pinata x402 IPFS',
      description: 'Account-free IPFS uploads via x402.',
      provider: 'pinata',
      category: 'storage',
      endpoint: 'https://402.pinata.cloud',
      method: 'UNKNOWN',
      price: '$0.001+',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'ipfs'],
    },
    {
      id: 'auor_oreo',
      name: 'auor.io (Oreo) Research Toolkit',
      description: 'Multi-API research toolkit (x402).',
      provider: 'auor.io',
      category: 'tools',
      endpoint: 'https://auor.io',
      method: 'UNKNOWN',
      price: '$0.04+',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'tools'],
    },

    {
      id: 'firecrawl_scrape',
      name: 'Firecrawl Scrape URL',
      description: 'Scrape a single URL into LLM-ready data (markdown/json, screenshots).',
      provider: 'firecrawl',
      category: 'web',
      endpoint: 'https://api.firecrawl.dev/v2/scrape',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'web', 'scraping'],
    },
    {
      id: 'firecrawl_crawl',
      name: 'Firecrawl Crawl Site',
      description: 'Crawl a site and extract content + metadata across pages.',
      provider: 'firecrawl',
      category: 'web',
      endpoint: 'https://api.firecrawl.dev/v2/crawl',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'web', 'crawl'],
    },
    {
      id: 'firecrawl_search',
      name: 'Firecrawl Web Search + Scrape',
      description: 'Search the web and return full-page content for results.',
      provider: 'firecrawl',
      category: 'web',
      endpoint: 'https://api.firecrawl.dev/v2/search',
      method: 'POST',
      price: '$0.02',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'web', 'search'],
    },
    {
      id: 'firecrawl_extract',
      name: 'Firecrawl Extract Structured Data',
      description: 'Extract structured data from webpages using natural-language instructions.',
      provider: 'firecrawl',
      category: 'ai-ml',
      endpoint: 'https://api.firecrawl.dev/v2/extract',
      method: 'POST',
      price: '$0.03',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'ai', 'extraction'],
    },
    {
      id: 'firecrawl_map',
      name: 'Firecrawl Map Site URLs',
      description: 'Discover a list of URLs for a website quickly and reliably.',
      provider: 'firecrawl',
      category: 'web',
      endpoint: 'https://api.firecrawl.dev/v2/map',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'web', 'site-map'],
    },

    {
      id: 'asterpay_market_price',
      name: 'AsterPay Market Price',
      description: 'Current crypto price + 24h change, market cap, and volume (x402).',
      provider: 'asterpay',
      category: 'defi',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/market/price/{symbol}',
      method: 'GET',
      price: '$0.001',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'market-data'],
    },
    {
      id: 'asterpay_market_ohlcv',
      name: 'AsterPay Market OHLCV',
      description: 'OHLCV candle data (1-90 days) for crypto assets (x402).',
      provider: 'asterpay',
      category: 'defi',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/market/ohlcv/{symbol}',
      method: 'GET',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'ohlcv'],
    },
    {
      id: 'asterpay_market_trending',
      name: 'AsterPay Trending Coins',
      description: 'Trending crypto assets with rank and 24h change (x402).',
      provider: 'asterpay',
      category: 'defi',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/market/trending',
      method: 'GET',
      price: '$0.002',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'trending'],
    },
    {
      id: 'asterpay_ai_summarize',
      name: 'AsterPay Text Summarization',
      description: 'AI-powered summarization of arbitrary text (x402).',
      provider: 'asterpay',
      category: 'ai-ml',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/ai/summarize',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'summarization'],
    },
    {
      id: 'asterpay_ai_sentiment',
      name: 'AsterPay Sentiment Analysis',
      description: 'Sentiment analysis on any text (x402).',
      provider: 'asterpay',
      category: 'ai-ml',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/ai/sentiment',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'nlp'],
    },
    {
      id: 'asterpay_ai_translate',
      name: 'AsterPay Translation',
      description: 'Translate text between languages (x402).',
      provider: 'asterpay',
      category: 'ai-ml',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/ai/translate',
      method: 'POST',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'translation'],
    },
    {
      id: 'asterpay_ai_code_review',
      name: 'AsterPay Code Review',
      description: 'Automated code review with suggestions (x402).',
      provider: 'asterpay',
      category: 'ai-ml',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/ai/code-review',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'codegen'],
    },
    {
      id: 'asterpay_crypto_wallet_score',
      name: 'AsterPay Wallet Reputation Score',
      description: 'On-chain wallet reputation scoring (x402).',
      provider: 'asterpay',
      category: 'analytics',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/crypto/wallet-score/{address}',
      method: 'GET',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'wallet'],
    },
    {
      id: 'asterpay_crypto_token_analysis',
      name: 'AsterPay Token Analysis',
      description: 'Deep token analysis with holders, activity, and risk (x402).',
      provider: 'asterpay',
      category: 'defi',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/crypto/token-analysis/{address}',
      method: 'GET',
      price: '$0.10',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'token'],
    },
    {
      id: 'asterpay_crypto_whale_alerts',
      name: 'AsterPay Whale Alerts',
      description: 'Real-time large transaction alerts (x402).',
      provider: 'asterpay',
      category: 'analytics',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/crypto/whale-alerts',
      method: 'GET',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'alerts'],
    },
    {
      id: 'asterpay_util_qr_code',
      name: 'AsterPay QR Code Generator',
      description: 'Generate QR codes from arbitrary data (x402).',
      provider: 'asterpay',
      category: 'utility',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/util/qr-code',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'qr'],
    },
    {
      id: 'asterpay_util_screenshot',
      name: 'AsterPay Screenshot Capture',
      description: 'Capture a screenshot of any URL (x402).',
      provider: 'asterpay',
      category: 'utility',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/util/screenshot',
      method: 'POST',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'screenshot'],
    },
    {
      id: 'asterpay_util_pdf_generate',
      name: 'AsterPay PDF Generator',
      description: 'Generate PDF documents from HTML/data (x402).',
      provider: 'asterpay',
      category: 'utility',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/util/pdf-generate',
      method: 'POST',
      price: '$0.03',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'asterpay', 'pdf'],
    },
    {
      id: 'asterpay_settlement_estimate',
      name: 'AsterPay Settlement Estimate',
      description: 'Estimate USDC -> EUR settlement via SEPA Instant (free).',
      provider: 'asterpay',
      category: 'analytics',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/settlement/estimate',
      method: 'GET',
      price: '$0.00',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['external', 'asterpay', 'settlement'],
    },
    {
      id: 'asterpay_settlement_quote',
      name: 'AsterPay Settlement Quote',
      description: 'Get a settlement quote with fees and delivery time (free).',
      provider: 'asterpay',
      category: 'analytics',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v1/settlement/quote',
      method: 'GET',
      price: '$0.00',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['external', 'asterpay', 'settlement'],
    },
    {
      id: 'asterpay_x402_supported',
      name: 'AsterPay Supported Networks',
      description: 'List supported payment schemes and networks (free).',
      provider: 'asterpay',
      category: 'utility',
      endpoint: 'https://x402-api-production-ba87.up.railway.app/v2/x402/supported',
      method: 'GET',
      price: '$0.00',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'asterpay', 'x402'],
    },

    {
      id: 'snackmoney_x_pay',
      name: 'Snack Money Pay to X (Twitter)',
      description: 'Send USDC tips/payments to an X user via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/x/pay',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'social', 'x'],
    },
    {
      id: 'snackmoney_x_batch_pay',
      name: 'Snack Money Batch Pay to X',
      description: 'Batch send USDC to multiple X users via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/x/batch-pay',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'batch', 'x'],
    },
    {
      id: 'snackmoney_farcaster_pay',
      name: 'Snack Money Pay to Farcaster',
      description: 'Send USDC tips/payments to a Farcaster user via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/farcaster/pay',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'social', 'farcaster'],
    },
    {
      id: 'snackmoney_farcaster_batch_pay',
      name: 'Snack Money Batch Pay to Farcaster',
      description: 'Batch send USDC to multiple Farcaster users via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/farcaster/batch-pay',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'batch', 'farcaster'],
    },
    {
      id: 'snackmoney_github_pay',
      name: 'Snack Money Pay to GitHub',
      description: 'Send USDC payments to a GitHub user via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/github/pay',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'github'],
    },
    {
      id: 'snackmoney_github_batch_pay',
      name: 'Snack Money Batch Pay to GitHub',
      description: 'Batch send USDC to multiple GitHub users via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/github/batch-pay',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'batch', 'github'],
    },
    {
      id: 'snackmoney_email_pay',
      name: 'Snack Money Pay via Email',
      description: 'Send USDC payments to a user identified by email via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/email/pay',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'email'],
    },
    {
      id: 'snackmoney_email_batch_pay',
      name: 'Snack Money Batch Pay via Email',
      description: 'Batch send USDC to users identified by email via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/email/batch-pay',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'batch', 'email'],
    },
    {
      id: 'snackmoney_web_pay',
      name: 'Snack Money Pay via Domain/URL',
      description: 'Send USDC to a recipient identified by domain/URL via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/web/pay',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'web'],
    },
    {
      id: 'snackmoney_web_batch_pay',
      name: 'Snack Money Batch Pay via Domain/URL',
      description: 'Batch send USDC to recipients identified by domain/URL via x402.',
      provider: 'snack.money',
      category: 'utility',
      endpoint: 'https://api.snack.money/payments/web/batch-pay',
      method: 'POST',
      price: '$0.05',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'batch', 'web'],
    },
    {
      id: 'snackmoney_payments_validate',
      name: 'Snack Money Validate Payment',
      description: 'Validate x402 payment status and details.',
      provider: 'snack.money',
      category: 'security',
      endpoint: 'https://api.snack.money/payments/validate',
      method: 'GET',
      price: '$0.001',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'payments', 'validation'],
    },

    {
      id: 'ouchanip_email_validation',
      name: 'ouchanip Email Validation',
      description: 'Validate email format, deliverability, and disposable status (x402).',
      provider: 'ouchanip',
      category: 'security',
      endpoint: 'https://email-validation-api-x402-689670267582.us-central1.run.app/validate',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'email', 'validation'],
    },
    {
      id: 'ouchanip_qr_code',
      name: 'ouchanip QR Code Generator',
      description: 'Generate QR code PNG images from URLs (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://qr-code-api-x402-689670267582.us-central1.run.app/generate',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'qr', 'images'],
    },
    {
      id: 'ouchanip_pdf_invoice',
      name: 'ouchanip PDF Invoice Generator',
      description: 'Generate PDF invoices from structured JSON data (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://pdf-invoice-api-x402-689670267582.us-central1.run.app/generate',
      method: 'POST',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'pdf', 'invoices'],
    },
    {
      id: 'ouchanip_ogp_image',
      name: 'ouchanip OGP Image Generator',
      description: 'Generate OGP images (1200x630 PNG) for links/posts (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://ogp-image-api-x402-689670267582.us-central1.run.app/generate',
      method: 'POST',
      price: '$0.01',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'images', 'ogp'],
    },
    {
      id: 'ouchanip_markdown_to_pdf',
      name: 'ouchanip Markdown to PDF',
      description: 'Convert Markdown into clean, styled PDF documents (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://md-to-pdf-api-x402-689670267582.us-central1.run.app/convert',
      method: 'POST',
      price: '$0.02',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'pdf', 'markdown'],
    },
    {
      id: 'ouchanip_image_resize',
      name: 'ouchanip Image Resize',
      description: 'Resize images to specified dimensions (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://image-resize-api-x402-689670267582.us-central1.run.app/resize',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'images'],
    },
    {
      id: 'ouchanip_url_metadata',
      name: 'ouchanip URL Metadata Extractor',
      description: 'Extract title/description/preview image metadata from a URL (x402).',
      provider: 'ouchanip',
      category: 'web',
      endpoint: 'https://url-metadata-api-x402-689670267582.us-central1.run.app/extract',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'web', 'metadata'],
    },
    {
      id: 'ouchanip_csv_json',
      name: 'ouchanip CSV/JSON Converter',
      description: 'Convert between CSV and JSON payloads (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://csv-json-api-x402-689670267582.us-central1.run.app/convert',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'conversion'],
    },
    {
      id: 'ouchanip_text_diff',
      name: 'ouchanip Text Diff',
      description: 'Compute diffs between two texts (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://diff-api-x402-689670267582.us-central1.run.app/diff',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'diff'],
    },
    {
      id: 'ouchanip_dns_lookup',
      name: 'ouchanip DNS Lookup',
      description: 'DNS lookup for a domain (x402).',
      provider: 'ouchanip',
      category: 'utility',
      endpoint: 'https://dns-lookup-api-x402-689670267582.us-central1.run.app/lookup',
      method: 'POST',
      price: '$0.005',
      currency: 'USDC',
      network: 'eip155:8453',
      payTo: null,
      status: 'active',
      tags: ['x402', 'external', 'dns'],
    },

    {
      id: 'openmeteo_forecast',
      name: 'Open-Meteo Weather Forecast',
      description: 'Free weather forecasts (hourly/daily) without API keys.',
      provider: 'open-meteo',
      category: 'data',
      endpoint: 'https://api.open-meteo.com/v1/forecast',
      method: 'GET',
      price: '$0.001',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'weather'],
    },
    {
      id: 'openweather_current',
      name: 'OpenWeather Current Weather',
      description: 'Current weather data (API key required).',
      provider: 'openweather',
      category: 'data',
      endpoint: 'https://api.openweathermap.org/data/2.5/weather',
      method: 'GET',
      price: '$0.005',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'weather'],
    },
    {
      id: 'coingecko_simple_price',
      name: 'CoinGecko Simple Price',
      description: 'Token price lookups by id and vs-currency.',
      provider: 'coingecko',
      category: 'defi',
      endpoint: 'https://api.coingecko.com/api/v3/simple/price',
      method: 'GET',
      price: '$0.002',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'prices', 'crypto'],
    },
    {
      id: 'defillama_prices',
      name: 'DeFiLlama Prices',
      description: 'Token prices for multiple assets (DeFiLlama).',
      provider: 'defillama',
      category: 'defi',
      endpoint: 'https://coins.llama.fi/prices/current/{coins}',
      method: 'GET',
      price: '$0.002',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'defi', 'prices'],
    },
    {
      id: 'cloudflare_radar_domains',
      name: 'Cloudflare Radar Domain Rank',
      description: 'Domain popularity and ranking insights (Cloudflare Radar).',
      provider: 'cloudflare',
      category: 'analytics',
      endpoint: 'https://api.cloudflare.com/client/v4/radar/ranking/domains',
      method: 'GET',
      price: '$0.01',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'analytics', 'dns'],
    },
    {
      id: 'ipinfo_geo',
      name: 'ipinfo.io IP Geolocation',
      description: 'IP geolocation and ASN/org lookup (token optional).',
      provider: 'ipinfo',
      category: 'data',
      endpoint: 'https://ipinfo.io/{ip}/json',
      method: 'GET',
      price: '$0.005',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'geo', 'ip'],
    },
    {
      id: 'google_dns_resolve',
      name: 'Google DNS over HTTPS',
      description: 'DNS over HTTPS resolution endpoint.',
      provider: 'google',
      category: 'utility',
      endpoint: 'https://dns.google/resolve',
      method: 'GET',
      price: '$0.001',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'dns'],
    },
    {
      id: 'tinyurl_shorten',
      name: 'TinyURL URL Shortener',
      description: 'Simple URL shortening via querystring API.',
      provider: 'tinyurl',
      category: 'utility',
      endpoint: 'https://tinyurl.com/api-create.php',
      method: 'GET',
      price: '$0.001',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'shortener'],
    },
    {
      id: 'qrserver_qr_generate',
      name: 'QRServer QR Code Generator',
      description: 'Generate QR codes (PNG) via query parameters.',
      provider: 'qrserver',
      category: 'utility',
      endpoint: 'https://api.qrserver.com/v1/create-qr-code/',
      method: 'GET',
      price: '$0.001',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'qr'],
    },
    {
      id: 'pdfshift_html_to_pdf',
      name: 'PDFShift HTML to PDF',
      description: 'Convert HTML pages to PDF (API key required).',
      provider: 'pdfshift',
      category: 'utility',
      endpoint: 'https://api.pdfshift.io/v3/convert/pdf',
      method: 'POST',
      price: '$0.02',
      currency: 'USDC',
      network: null,
      payTo: null,
      status: 'active',
      tags: ['external', 'api', 'pdf'],
    },
  ]

  const x402engineSeeds = await fetchX402EngineSeeds()
  const einsteinSeeds = await fetchEinsteinAiSeeds()

  const disabledSeedProviders = new Set(['ouchanip', 'snack.money', 'firecrawl'])
  const normalizedExternalSeeds = externalSeeds.map((seed) => {
    if (!disabledSeedProviders.has(seed.provider)) return seed
    return { ...seed, status: 'disabled' }
  })

  const allSeeds = [...crossfinSeeds, ...normalizedExternalSeeds, ...x402engineSeeds, ...einsteinSeeds]

  const statements = allSeeds.map((seed) => {
    const tags = seed.tags ? JSON.stringify(seed.tags) : null
    const inputSchema = seed.inputSchema ? JSON.stringify(seed.inputSchema) : null
    const outputExample = seed.outputExample ? JSON.stringify(seed.outputExample) : null
    const isCrossfin = seed.isCrossfin ? 1 : 0

    return db.prepare(
      `INSERT OR IGNORE INTO services
        (id, name, description, provider, category, endpoint, method, price, currency, network, pay_to, tags, input_schema, output_example, status, is_crossfin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      seed.id,
      seed.name,
      seed.description,
      seed.provider,
      seed.category,
      seed.endpoint,
      normalizeMethod(seed.method),
      seed.price,
      seed.currency,
      seed.network,
      seed.payTo,
      tags,
      inputSchema,
      outputExample,
      seed.status,
      isCrossfin,
    )
  })

  await db.batch(statements)
}

app.get('/api/registry', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const category = (c.req.query('category') ?? '').trim()
  const provider = (c.req.query('provider') ?? '').trim()
  const isCrossfin = (c.req.query('isCrossfin') ?? '').trim()
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? '100')))
  const offset = Math.max(0, Number(c.req.query('offset') ?? '0'))

  const where: string[] = ["status = 'active'"]
  const params: unknown[] = []

  if (category) {
    where.push('category = ?')
    params.push(category)
  }

  if (provider) {
    where.push('provider = ?')
    params.push(provider)
  }

  if (isCrossfin) {
    const flag = isCrossfin === 'true' || isCrossfin === '1' ? 1 : 0
    where.push('is_crossfin = ?')
    params.push(flag)
  }

  const whereSql = where.join(' AND ')

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM services WHERE ${whereSql}`
  ).bind(...params).first<{ count: number | string }>()

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM services WHERE ${whereSql}
     ORDER BY is_crossfin DESC, created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all<Record<string, unknown>>()

  return c.json({
    data: (results ?? []).map((row) => applyCrossfinDocs(mapServiceRow(row))),
    total: countRow ? Number(countRow.count) : 0,
    limit,
    offset,
    at: new Date().toISOString(),
  })
})

app.get('/api/registry/search', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const qRaw = (c.req.query('q') ?? '').trim()
  if (!qRaw) throw new HTTPException(400, { message: 'q is required' })

  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50')))
  const offset = Math.max(0, Number(c.req.query('offset') ?? '0'))
  const q = `%${qRaw.replace(/%/g, '')}%`

  const whereSql = "status = 'active' AND (name LIKE ? OR description LIKE ? OR provider LIKE ? OR category LIKE ? OR endpoint LIKE ? OR tags LIKE ?)"
  const params = [q, q, q, q, q, q]

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM services WHERE ${whereSql}`
  ).bind(...params).first<{ count: number | string }>()

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM services WHERE ${whereSql}
     ORDER BY is_crossfin DESC, created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all<Record<string, unknown>>()

  return c.json({
    q: qRaw,
    data: (results ?? []).map((row) => applyCrossfinDocs(mapServiceRow(row))),
    total: countRow ? Number(countRow.count) : 0,
    limit,
    offset,
    at: new Date().toISOString(),
  })
})

app.get('/api/registry/categories', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const { results } = await c.env.DB.prepare(
    "SELECT category, COUNT(*) as count FROM services WHERE status = 'active' GROUP BY category ORDER BY count DESC"
  ).all<{ category: string; count: number }>()

  return c.json({
    data: (results ?? []).map((r) => ({ category: r.category, count: Number(r.count) })),
    at: new Date().toISOString(),
  })
})

app.get('/api/registry/stats', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const results = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active'"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active' AND is_crossfin = 1"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active' AND is_crossfin = 0"),
  ])

  const total = results[0]?.results?.[0] as { count?: number | string } | undefined
  const crossfin = results[1]?.results?.[0] as { count?: number | string } | undefined
  const external = results[2]?.results?.[0] as { count?: number | string } | undefined

  return c.json({
    services: {
      total: Number(total?.count ?? 0),
      crossfin: Number(crossfin?.count ?? 0),
      external: Number(external?.count ?? 0),
    },
    at: new Date().toISOString(),
  })
})

app.get('/api/registry/sync', async (c) => {
  requireAdmin(c)

  const confirm = (c.req.query('confirm') ?? '').trim().toLowerCase()
  if (confirm !== 'yes') {
    throw new HTTPException(400, { message: 'Add ?confirm=yes to sync new registry seeds (insert-only)' })
  }

  const before = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM services'),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active'"),
  ])

  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS, { force: true })

  const after = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM services'),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active'"),
  ])

  const beforeTotal = Number(((before[0]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
  const beforeActive = Number(((before[1]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
  const afterTotal = Number(((after[0]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))
  const afterActive = Number(((after[1]?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0))

  await audit(
    c.env.DB,
    null,
    'admin.registry.sync',
    'services',
    null,
    'success',
    `before_total=${beforeTotal} before_active=${beforeActive} after_total=${afterTotal} after_active=${afterActive}`,
  )

  return c.json({
    ok: true,
    services: {
      before: { total: beforeTotal, active: beforeActive },
      after: { total: afterTotal, active: afterActive },
      added: { total: Math.max(0, afterTotal - beforeTotal), active: Math.max(0, afterActive - beforeActive) },
    },
    at: new Date().toISOString(),
  })
})

app.get('/api/registry/reseed', async (c) => {
  requireAdmin(c)

  const confirm = (c.req.query('confirm') ?? '').trim().toLowerCase()
  if (confirm !== 'yes') {
    throw new HTTPException(400, { message: 'Add ?confirm=yes to reseed the registry' })
  }

  await c.env.DB.prepare('DELETE FROM services').run()
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const row = await c.env.DB.prepare('SELECT COUNT(*) as count FROM services').first<{ count: number | string }>()
  const count = row ? Number(row.count) : 0

  await audit(
    c.env.DB,
    null,
    'admin.registry.reseed',
    'services',
    null,
    'success',
    `services_total=${count}`,
  )

  return c.json({
    ok: true,
    services: { total: count },
    at: new Date().toISOString(),
  })
})

app.get('/api/registry/:id', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const id = c.req.param('id')
  const row = await c.env.DB.prepare(
    'SELECT * FROM services WHERE id = ?'
  ).bind(id).first<Record<string, unknown>>()

  if (!row) throw new HTTPException(404, { message: 'Service not found' })

  return c.json({ data: applyCrossfinDocs(mapServiceRow(row)) })
})

app.post('/api/registry', agentAuth, async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

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
  const provider = body.provider?.trim() ?? ''
  const category = (body.category?.trim() ?? 'other') || 'other'
  const endpoint = body.endpoint ? requirePublicHttpsUrl(body.endpoint) : ''
  const price = body.price?.trim() ?? ''
  const currency = (body.currency?.trim() ?? 'USDC') || 'USDC'

  if (!name) throw new HTTPException(400, { message: 'name is required' })
  if (!provider) throw new HTTPException(400, { message: 'provider is required' })
  if (!endpoint) throw new HTTPException(400, { message: 'endpoint is required' })
  if (!price) throw new HTTPException(400, { message: 'price is required' })

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === 'string').slice(0, 20)
    : []

  const id = crypto.randomUUID()
  const method = normalizeMethod(body.method)
  const status: ServiceStatus = 'active'

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

  await audit(c.env.DB, agentId, 'service.create', 'services', id, 'success')

  const created = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(id).first<Record<string, unknown>>()
  return c.json({ data: created ? applyCrossfinDocs(mapServiceRow(created)) : { id } }, 201)
})

async function proxyToService(c: Context<Env>, method: 'GET' | 'POST'): Promise<Response> {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const agentId = c.get('agentId')
  if (!agentId) throw new HTTPException(401, { message: 'Missing X-Agent-Key header' })

  const serviceId = c.req.param('serviceId')
  const row = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(serviceId).first<Record<string, unknown>>()
  if (!row) throw new HTTPException(404, { message: 'Service not found' })

  const service = mapServiceRow(row)

  if (service.method !== 'UNKNOWN' && service.method !== method) {
    throw new HTTPException(405, { message: `Method not allowed (expected ${service.method})` })
  }

  const PROXY_MAX_BODY_BYTES = 512 * 1024
  const PROXY_RATE_LIMIT_PER_MINUTE_PER_SERVICE = 60
  const PROXY_RATE_LIMIT_PER_MINUTE_PER_AGENT = 240

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
  if (countService >= PROXY_RATE_LIMIT_PER_MINUTE_PER_SERVICE || countAgent >= PROXY_RATE_LIMIT_PER_MINUTE_PER_AGENT) {
    throw new HTTPException(429, { message: 'Rate limited' })
  }

  let upstreamUrl: URL
  try {
    upstreamUrl = new URL(service.endpoint)
  } catch {
    throw new HTTPException(500, { message: 'Service endpoint is not a valid URL' })
  }

  try {
    assertPublicHostname(upstreamUrl)
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

    const init: RequestInit = { method, headers, redirect: 'manual' }
    if (method === 'POST') {
      const contentLength = Number(c.req.header('content-length') ?? '0')
      if (contentLength > PROXY_MAX_BODY_BYTES) {
        throw new HTTPException(413, { message: 'Payload too large' })
      }
      const contentType = c.req.header('content-type')
      if (contentType) headers['content-type'] = contentType
      const body = await c.req.arrayBuffer()
      if (body.byteLength > PROXY_MAX_BODY_BYTES) {
        throw new HTTPException(413, { message: 'Payload too large' })
      }
      init.body = body
    }

    const upstreamRes = await fetch(upstreamUrl.toString(), init)
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

    const outHeaders = buildProxyResponseHeaders(upstreamRes.headers)
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

    console.error('Proxy upstream request failed', err)
    return c.json({ error: 'Upstream request failed' }, 502)
  }
}

app.get('/api/proxy/:serviceId', agentAuth, async (c) => proxyToService(c, 'GET'))

app.post('/api/proxy/:serviceId', agentAuth, async (c) => proxyToService(c, 'POST'))

app.get('/api/analytics/overview', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const [callsCountRes, servicesCountRes, crossfinCountRes] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM service_calls'),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active'"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM services WHERE status = 'active' AND is_crossfin = 1"),
  ])

  const totalCalls = Number((callsCountRes?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
  const totalServices = Number((servicesCountRes?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)
  const crossfinServices = Number((crossfinCountRes?.results?.[0] as { count?: number | string } | undefined)?.count ?? 0)

  const top = await c.env.DB.prepare(
    `SELECT s.id as serviceId, s.name as serviceName, COUNT(sc.id) as calls
     FROM services s
     LEFT JOIN service_calls sc ON sc.service_id = s.id
     WHERE s.status = 'active'
     GROUP BY s.id
     ORDER BY calls DESC
     LIMIT 10`
  ).all<{ serviceId: string; serviceName: string; calls: number | string }>()

  const recent = await c.env.DB.prepare(
    `SELECT sc.service_id as serviceId, s.name as serviceName, sc.status as status, sc.response_time_ms as responseTimeMs, sc.created_at as createdAt
     FROM service_calls sc
     JOIN services s ON s.id = sc.service_id
     ORDER BY datetime(sc.created_at) DESC
     LIMIT 20`
  ).all<{ serviceId: string; serviceName: string; status: string; responseTimeMs: number | string | null; createdAt: string }>()

  return c.json({
    totalCalls,
    totalServices,
    crossfinServices,
    topServices: (top.results ?? []).map((r) => ({
      serviceId: String(r.serviceId ?? ''),
      serviceName: String(r.serviceName ?? ''),
      calls: Number(r.calls ?? 0),
    })),
    recentCalls: (recent.results ?? []).map((r) => ({
      serviceId: String(r.serviceId ?? ''),
      serviceName: String(r.serviceName ?? ''),
      status: String(r.status ?? 'unknown'),
      responseTimeMs: r.responseTimeMs === null || r.responseTimeMs === undefined ? null : Number(r.responseTimeMs),
      createdAt: String(r.createdAt ?? ''),
    })),
    at: new Date().toISOString(),
  })
})

app.get('/api/analytics/services/:serviceId', async (c) => {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const serviceId = c.req.param('serviceId')
  const row = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(serviceId).first<Record<string, unknown>>()
  if (!row) throw new HTTPException(404, { message: 'Service not found' })

  const statsRow = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as totalCalls,
       SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successCalls,
       AVG(response_time_ms) as avgResponseTimeMs,
       SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) as callsLast24h,
       SUM(CASE WHEN created_at >= datetime('now', '-7 day') THEN 1 ELSE 0 END) as callsLast7d
     FROM service_calls
     WHERE service_id = ?`
  ).bind(serviceId).first<{
    totalCalls: number | string
    successCalls: number | string | null
    avgResponseTimeMs: number | string | null
    callsLast24h: number | string | null
    callsLast7d: number | string | null
  }>()

  const totalCalls = Number(statsRow?.totalCalls ?? 0)
  const successCalls = Number(statsRow?.successCalls ?? 0)
  const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 1000) / 10 : 0
  const avgResponseTimeMs = statsRow?.avgResponseTimeMs === null || statsRow?.avgResponseTimeMs === undefined
    ? null
    : Math.round(Number(statsRow.avgResponseTimeMs))

  return c.json({
    service: applyCrossfinDocs(mapServiceRow(row)),
    stats: {
      totalCalls,
      successRate,
      avgResponseTimeMs,
      callsLast24h: Number(statsRow?.callsLast24h ?? 0),
      callsLast7d: Number(statsRow?.callsLast7d ?? 0),
    },
    at: new Date().toISOString(),
  })
})

// === Korean Arbitrage Data Helpers ===

const TRACKED_PAIRS: Record<string, string> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', XRP: 'XRPUSDT',
  SOL: 'SOLUSDT', DOGE: 'DOGEUSDT', ADA: 'ADAUSDT',
  DOT: 'DOTUSDT', LINK: 'LINKUSDT', AVAX: 'AVAXUSDT',
  EOS: 'EOSUSDT', TRX: 'TRXUSDT', MATIC: 'MATICUSDT',
}

const DEFAULT_CROSS_EXCHANGE_COINS = ['BTC', 'ETH', 'XRP', 'DOGE', 'ADA', 'SOL'] as const

const BITHUMB_FEES_PCT = 0.25 // Bithumb maker/taker fee
const BINANCE_FEES_PCT = 0.10 // Binance spot fee

async function fetchKrwRate(): Promise<number> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD')
    const data = await res.json() as { rates?: Record<string, number> }
    return data.rates?.KRW ?? 1450
  } catch {
    return 1450
  }
}

async function fetchBithumbAll(): Promise<Record<string, Record<string, string>>> {
  const res = await fetch('https://api.bithumb.com/public/ticker/ALL_KRW')
  const data = await res.json() as { status: string; data: Record<string, unknown> }
  if (data.status !== '0000') throw new HTTPException(502, { message: 'Bithumb API unavailable' })
  return data.data as Record<string, Record<string, string>>
}

async function fetchGlobalPrices(): Promise<Record<string, number>> {
  const coins = Object.keys(TRACKED_PAIRS).join(',')
  const res = await fetch(
    `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${coins}&tsyms=USD`,
  )
  if (!res.ok) throw new HTTPException(502, { message: 'Price feed unavailable' })
  const data = await res.json() as Record<string, { USD?: number }>
  const prices: Record<string, number> = {}
  for (const [coin, binanceSymbol] of Object.entries(TRACKED_PAIRS)) {
    if (data[coin]?.USD) prices[binanceSymbol] = data[coin].USD
  }
  return prices
}

async function fetchBithumbOrderbook(pair: string): Promise<{ bids: unknown[]; asks: unknown[] }> {
  const res = await fetch(`https://api.bithumb.com/public/orderbook/${pair}_KRW`)
  const data = await res.json() as { status: string; data: { bids: unknown[]; asks: unknown[] } }
  if (data.status !== '0000') throw new HTTPException(400, { message: `Invalid pair: ${pair}` })
  return data.data
}

function requireSymbol(value: string, label: string): string {
  const raw = value.trim().toUpperCase()
  if (!raw) throw new HTTPException(400, { message: `${label} is required` })
  if (!/^[A-Z0-9]{2,16}$/.test(raw)) throw new HTTPException(400, { message: `${label} is invalid` })
  return raw
}

function requireUpbitMarket(value: string): string {
  const raw = value.trim().toUpperCase()
  if (!raw) throw new HTTPException(400, { message: 'market is required' })
  if (!/^[A-Z]{3,4}-[A-Z0-9]{2,16}$/.test(raw)) throw new HTTPException(400, { message: 'market is invalid (expected like KRW-BTC)' })
  return raw
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function parseCoinsQueryParam(raw: string | undefined): string[] {
  const allowed = new Set(Object.keys(TRACKED_PAIRS))
  const source = raw
    ? raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [...DEFAULT_CROSS_EXCHANGE_COINS]

  const filtered: string[] = []
  for (const coin of source) {
    if (!allowed.has(coin)) continue
    if (filtered.includes(coin)) continue
    filtered.push(coin)
  }

  return filtered.length > 0 ? filtered : [...DEFAULT_CROSS_EXCHANGE_COINS]
}

type DomesticExchangeId = 'bithumb' | 'upbit' | 'coinone'

type DomesticExchangeData = {
  priceKrw: number
  priceUsd: number
  volume24hKrw: number
  volume24hUsd: number
  change24hPct: number
}

type BinanceExchangeData = {
  priceUsd: number
}

type CrossExchangeExchanges = {
  bithumb: DomesticExchangeData | null
  upbit: DomesticExchangeData | null
  coinone: DomesticExchangeData | null
  binance: BinanceExchangeData | null
}

type CrossExchangeKimchiPremium = {
  bithumb: number | null
  upbit: number | null
  coinone: number | null
  average: number | null
}

type CrossExchangeDomesticArbitrage = {
  lowestExchange: DomesticExchangeId
  lowestPriceKrw: number
  highestExchange: DomesticExchangeId
  highestPriceKrw: number
  spreadKrw: number
  spreadPct: number
} | null

async function fetchUpbitTicker(market: string) {
  const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(market)}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Upbit API unavailable' })
  const data: unknown = await res.json()
  if (!Array.isArray(data) || data.length === 0 || !isRecord(data[0])) {
    throw new HTTPException(502, { message: 'Upbit API invalid response' })
  }
  return data[0]
}

async function fetchUpbitOrderbook(market: string) {
  const res = await fetch(`https://api.upbit.com/v1/orderbook?markets=${encodeURIComponent(market)}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Upbit API unavailable' })
  const data: unknown = await res.json()
  if (!Array.isArray(data) || data.length === 0 || !isRecord(data[0])) {
    throw new HTTPException(502, { message: 'Upbit API invalid response' })
  }
  return data[0]
}

async function fetchCoinoneTicker(currency: string) {
  const res = await fetch(`https://api.coinone.co.kr/public/v2/ticker_new/KRW/${encodeURIComponent(currency)}`)
  if (!res.ok) throw new HTTPException(502, { message: 'Coinone API unavailable' })
  const data: unknown = await res.json()
  if (!isRecord(data) || data.result !== 'success' || !Array.isArray(data.tickers) || data.tickers.length === 0) {
    throw new HTTPException(502, { message: 'Coinone API invalid response' })
  }
  const first = data.tickers[0]
  if (!isRecord(first)) throw new HTTPException(502, { message: 'Coinone API invalid response' })
  return first
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

function extractXmlTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)
  const m = re.exec(xml)
  if (!m || typeof m[1] !== 'string') return null
  return stripCdata(m[1]).trim()
}

function parseIsoDate(value: string): string {
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d.toISOString() : value
}

function splitPublisherFromTitle(title: string): { title: string; publisher: string | null } {
  const idx = title.lastIndexOf(' - ')
  if (idx === -1) return { title, publisher: null }
  const head = title.slice(0, idx).trim()
  const pub = title.slice(idx + 3).trim()
  if (!head || !pub) return { title, publisher: null }
  return { title: head, publisher: pub }
}

function calcPremiums(
  bithumbData: Record<string, Record<string, string>>,
  binancePrices: Record<string, number>,
  krwRate: number,
) {
  const premiums = []
  for (const [coin, binanceSymbol] of Object.entries(TRACKED_PAIRS)) {
    const bithumb = bithumbData[coin]
    const binancePrice = binancePrices[binanceSymbol]
    if (!bithumb?.closing_price || !binancePrice) continue

    const bithumbKrw = parseFloat(bithumb.closing_price)
    const bithumbUsd = bithumbKrw / krwRate
    const premiumPct = ((bithumbUsd - binancePrice) / binancePrice) * 100
    const volume24hKrw = parseFloat(bithumb.acc_trade_value_24H || '0')
    const change24hPct = parseFloat(bithumb.fluctate_rate_24H || '0')

    premiums.push({
      coin,
      bithumbKrw,
      bithumbUsd: Math.round(bithumbUsd * 100) / 100,
      binanceUsd: binancePrice,
      premiumPct: Math.round(premiumPct * 100) / 100,
      volume24hKrw,
      volume24hUsd: Math.round(volume24hKrw / krwRate),
      change24hPct,
    })
  }
  return premiums.sort((a, b) => Math.abs(b.premiumPct) - Math.abs(a.premiumPct))
}

// === Kimchi Premium (paid $0.05) ===

app.get('/api/premium/arbitrage/kimchi', async (c) => {
  const [bithumbData, binancePrices, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchGlobalPrices(),
    fetchKrwRate(),
  ])

  const premiums = calcPremiums(bithumbData, binancePrices, krwRate)
  const avg = premiums.length > 0
    ? Math.round(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length * 100) / 100
    : 0

  return c.json({
    paid: true,
    service: 'crossfin-kimchi-premium',
    krwUsdRate: krwRate,
    pairsTracked: premiums.length,
    avgPremiumPct: avg,
    topPremium: premiums[0] ?? null,
    premiums,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/arbitrage/kimchi/history', async (c) => {
  const coinRaw = c.req.query('coin')
  const coin = coinRaw ? requireSymbol(coinRaw, 'coin') : null

  const hoursRaw = c.req.query('hours')
  const hoursValue = hoursRaw ? Number(hoursRaw) : 24
  if (!Number.isFinite(hoursValue) || !Number.isInteger(hoursValue)) {
    throw new HTTPException(400, { message: 'hours must be an integer' })
  }

  const hours = Math.min(168, Math.max(1, hoursValue))

  const rangeArg = `-${hours} hours`
  const sql = `
    WITH ranked AS (
      SELECT
        id,
        coin,
        bithumb_krw AS bithumbKrw,
        binance_usd AS binanceUsd,
        premium_pct AS premiumPct,
        krw_usd_rate AS krwUsdRate,
        volume_24h_usd AS volume24hUsd,
        created_at AS createdAt,
        strftime('%Y-%m-%dT%H:00:00Z', created_at) AS hour,
        ROW_NUMBER() OVER (
          PARTITION BY coin, strftime('%Y-%m-%d %H', created_at)
          ORDER BY datetime(created_at) DESC
        ) AS rn
      FROM kimchi_snapshots
      WHERE datetime(created_at) >= datetime('now', ?)
        AND (? IS NULL OR coin = ?)
    )
    SELECT id, coin, bithumbKrw, binanceUsd, premiumPct, krwUsdRate, volume24hUsd, createdAt, hour
    FROM ranked
    WHERE rn = 1
    ORDER BY datetime(createdAt) DESC
  `

  let results: Array<Record<string, unknown>> = []
  try {
    const res = await c.env.DB.prepare(sql).bind(rangeArg, coin, coin).all<Record<string, unknown>>()
    results = res.results ?? []
  } catch (err) {
    console.error(err)
    throw new HTTPException(500, { message: 'DB schema not migrated (kimchi_snapshots table missing)' })
  }

  const snapshots = results.map((r) => ({
    id: String(r.id ?? ''),
    coin: String(r.coin ?? ''),
    bithumbKrw: r.bithumbKrw === null || r.bithumbKrw === undefined ? null : Number(r.bithumbKrw),
    binanceUsd: r.binanceUsd === null || r.binanceUsd === undefined ? null : Number(r.binanceUsd),
    premiumPct: r.premiumPct === null || r.premiumPct === undefined ? null : Number(r.premiumPct),
    krwUsdRate: r.krwUsdRate === null || r.krwUsdRate === undefined ? null : Number(r.krwUsdRate),
    volume24hUsd: r.volume24hUsd === null || r.volume24hUsd === undefined ? null : Number(r.volume24hUsd),
    createdAt: String(r.createdAt ?? ''),
    hour: String(r.hour ?? ''),
  }))

  const now = Date.now()
  return c.json({
    paid: true,
    service: 'crossfin-kimchi-premium-history',
    coin,
    hours,
    groupedBy: 'hour',
    range: {
      from: new Date(now - hours * 60 * 60 * 1000).toISOString(),
      to: new Date(now).toISOString(),
    },
    snapshots,
    count: snapshots.length,
    at: new Date().toISOString(),
  })
})

// === Arbitrage Opportunities (paid $0.10) ===

app.get('/api/premium/arbitrage/opportunities', async (c) => {
  const [bithumbData, binancePrices, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchGlobalPrices(),
    fetchKrwRate(),
  ])

  const premiums = calcPremiums(bithumbData, binancePrices, krwRate)
  const totalFeesPct = BITHUMB_FEES_PCT + BINANCE_FEES_PCT

  const opportunities = premiums
    .map((p) => {
      const netProfitPct = Math.abs(p.premiumPct) - totalFeesPct
      const direction = p.premiumPct > 0 ? 'buy-global-sell-korea' : 'buy-korea-sell-global'
      const riskScore = p.volume24hUsd < 100000 ? 'high' : p.volume24hUsd < 1000000 ? 'medium' : 'low'
      const profitPer10kUsd = Math.round(netProfitPct * 100) // cents per $10,000 traded

      return {
        coin: p.coin,
        direction,
        grossPremiumPct: p.premiumPct,
        estimatedFeesPct: totalFeesPct,
        netProfitPct: Math.round(netProfitPct * 100) / 100,
        profitPer10kUsd,
        volume24hUsd: p.volume24hUsd,
        riskScore,
        profitable: netProfitPct > 0,
        bithumbKrw: p.bithumbKrw,
        binanceUsd: p.binanceUsd,
      }
    })
    .sort((a, b) => b.netProfitPct - a.netProfitPct)

  const profitable = opportunities.filter((o) => o.profitable)

  return c.json({
    paid: true,
    service: 'crossfin-arbitrage-opportunities',
    krwUsdRate: krwRate,
    totalOpportunities: opportunities.length,
    profitableCount: profitable.length,
    estimatedFeesNote: `Bithumb ${BITHUMB_FEES_PCT}% + Binance ${BINANCE_FEES_PCT}% = ${totalFeesPct}% total`,
    bestOpportunity: profitable[0] ?? null,
    opportunities,
    at: new Date().toISOString(),
  })
})

// === Bithumb Orderbook (paid $0.02) ===

app.get('/api/premium/bithumb/orderbook', async (c) => {
  const pair = (c.req.query('pair') ?? 'BTC').toUpperCase()
  const [orderbook, krwRate] = await Promise.all([
    fetchBithumbOrderbook(pair),
    fetchKrwRate(),
  ])

  const bids = (orderbook.bids as Array<{ price: string; quantity: string }>).slice(0, 30)
  const asks = (orderbook.asks as Array<{ price: string; quantity: string }>).slice(0, 30)

  const bestBid = bids[0] ? parseFloat(bids[0].price) : 0
  const bestAsk = asks[0] ? parseFloat(asks[0].price) : 0
  const spreadKrw = bestAsk - bestBid
  const spreadPct = bestBid > 0 ? Math.round((spreadKrw / bestBid) * 10000) / 100 : 0

  return c.json({
    paid: true,
    service: 'crossfin-bithumb-orderbook',
    pair: `${pair}/KRW`,
    exchange: 'Bithumb',
    bestBidKrw: bestBid,
    bestAskKrw: bestAsk,
    spreadKrw,
    spreadPct,
    bestBidUsd: Math.round(bestBid / krwRate * 100) / 100,
    bestAskUsd: Math.round(bestAsk / krwRate * 100) / 100,
    depth: { bids, asks },
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/bithumb/volume-analysis', async (c) => {
  const [bithumbData, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchKrwRate(),
  ])

  const coins: Array<{ coin: string; volume24hKrw: number; change24hPct: number }> = []
  for (const [coin, data] of Object.entries(bithumbData)) {
    if (coin === 'date' || typeof data !== 'object' || !data) continue
    const d = data as Record<string, string>
    if (!d.closing_price) continue

    const volume24hKrw = parseFloat(d.acc_trade_value_24H || '0')
    if (!Number.isFinite(volume24hKrw) || volume24hKrw <= 0) continue

    const change24hPct = parseFloat(d.fluctate_rate_24H || '0')
    coins.push({
      coin,
      volume24hKrw,
      change24hPct: Number.isFinite(change24hPct) ? change24hPct : 0,
    })
  }

  const totalVolume24hKrw = coins.reduce((s, c) => s + c.volume24hKrw, 0)
  const totalCoins = coins.length
  const avgVolume24hKrw = totalCoins > 0 ? totalVolume24hKrw / totalCoins : 0

  const volumeWeightedChangePct = totalVolume24hKrw > 0
    ? round2(coins.reduce((s, c) => s + (c.change24hPct * c.volume24hKrw), 0) / totalVolume24hKrw)
    : 0

  const sortedByVolume = [...coins].sort((a, b) => b.volume24hKrw - a.volume24hKrw)
  const withShare = (row: { coin: string; volume24hKrw: number; change24hPct: number }) => {
    const sharePct = totalVolume24hKrw > 0 ? (row.volume24hKrw / totalVolume24hKrw) * 100 : 0
    return {
      coin: row.coin,
      volume24hKrw: row.volume24hKrw,
      volume24hUsd: round2(row.volume24hKrw / krwRate),
      change24hPct: round2(row.change24hPct),
      volumeSharePct: round2(sharePct),
    }
  }

  const top5 = sortedByVolume.slice(0, 5)
  const top5Volume = top5.reduce((s, c) => s + c.volume24hKrw, 0)
  const top5Pct = totalVolume24hKrw > 0 ? round2((top5Volume / totalVolume24hKrw) * 100) : 0

  const unusualVolume = avgVolume24hKrw > 0
    ? sortedByVolume
        .filter((c) => c.volume24hKrw > avgVolume24hKrw * 2)
        .slice(0, 50)
        .map((c) => ({
          ...withShare(c),
          multipleOfAvg: round2(c.volume24hKrw / avgVolume24hKrw),
        }))
    : []

  return c.json({
    paid: true,
    service: 'crossfin-bithumb-volume',
    totalVolume24hKrw: round2(totalVolume24hKrw),
    totalVolume24hUsd: round2(totalVolume24hKrw / krwRate),
    totalCoins,
    volumeConcentration: {
      top5Pct,
      top5Coins: top5.map((c) => withShare(c)),
    },
    volumeWeightedChangePct,
    unusualVolume,
    topByVolume: sortedByVolume.slice(0, 15).map((c) => withShare(c)),
    at: new Date().toISOString(),
  })
})

// === Korea Market Sentiment (paid $0.03) ===

app.get('/api/premium/market/korea', async (c) => {
  const [bithumbData, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchKrwRate(),
  ])

  const coins: Array<{
    coin: string; priceKrw: number; priceUsd: number;
    change24hPct: number; volume24hKrw: number; volume24hUsd: number;
  }> = []

  for (const [coin, data] of Object.entries(bithumbData)) {
    if (coin === 'date' || typeof data !== 'object' || !data) continue
    const d = data as Record<string, string>
    if (!d.closing_price) continue

    const priceKrw = parseFloat(d.closing_price)
    const volume24hKrw = parseFloat(d.acc_trade_value_24H || '0')
    coins.push({
      coin,
      priceKrw,
      priceUsd: Math.round(priceKrw / krwRate * 100) / 100,
      change24hPct: parseFloat(d.fluctate_rate_24H || '0'),
      volume24hKrw,
      volume24hUsd: Math.round(volume24hKrw / krwRate),
    })
  }

  const topGainers = [...coins].sort((a, b) => b.change24hPct - a.change24hPct).slice(0, 10)
  const topLosers = [...coins].sort((a, b) => a.change24hPct - b.change24hPct).slice(0, 10)
  const topVolume = [...coins].sort((a, b) => b.volume24hUsd - a.volume24hUsd).slice(0, 10)
  const totalVolumeUsd = coins.reduce((s, c) => s + c.volume24hUsd, 0)
  const avgChange = coins.length > 0
    ? Math.round(coins.reduce((s, c) => s + c.change24hPct, 0) / coins.length * 100) / 100
    : 0

  return c.json({
    paid: true,
    service: 'crossfin-korea-sentiment',
    exchange: 'Bithumb',
    totalCoins: coins.length,
    totalVolume24hUsd: totalVolumeUsd,
    avgChange24hPct: avgChange,
    marketMood: avgChange > 1 ? 'bullish' : avgChange < -1 ? 'bearish' : 'neutral',
    topGainers,
    topLosers,
    topVolume,
    krwUsdRate: krwRate,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/fx/usdkrw', async (c) => {
  const krwRate = await fetchKrwRate()
  return c.json({
    paid: true,
    service: 'crossfin-usdkrw',
    usdKrw: krwRate,
    source: 'open.er-api.com',
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/upbit/ticker', async (c) => {
  const market = requireUpbitMarket(c.req.query('market') ?? 'KRW-BTC')
  const [ticker, krwRate] = await Promise.all([
    fetchUpbitTicker(market),
    fetchKrwRate(),
  ])

  const tradePriceKrw = typeof ticker.trade_price === 'number' ? ticker.trade_price : Number(ticker.trade_price ?? 0)
  const changeRate = typeof ticker.signed_change_rate === 'number' ? ticker.signed_change_rate : Number(ticker.signed_change_rate ?? 0)
  const highPriceKrw = typeof ticker.high_price === 'number' ? ticker.high_price : Number(ticker.high_price ?? 0)
  const lowPriceKrw = typeof ticker.low_price === 'number' ? ticker.low_price : Number(ticker.low_price ?? 0)
  const volume24hKrw = typeof ticker.acc_trade_price_24h === 'number' ? ticker.acc_trade_price_24h : Number(ticker.acc_trade_price_24h ?? 0)

  return c.json({
    paid: true,
    service: 'crossfin-upbit-ticker',
    market,
    tradePriceKrw,
    tradePriceUsd: Math.round(tradePriceKrw / krwRate * 100) / 100,
    change24hPct: Math.round(changeRate * 10000) / 100,
    highPriceKrw,
    lowPriceKrw,
    volume24hKrw,
    volume24hUsd: Math.round(volume24hKrw / krwRate),
    krwUsdRate: krwRate,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/upbit/orderbook', async (c) => {
  const market = requireUpbitMarket(c.req.query('market') ?? 'KRW-BTC')
  const [orderbook, krwRate] = await Promise.all([
    fetchUpbitOrderbook(market),
    fetchKrwRate(),
  ])

  const unitsRaw = orderbook.orderbook_units
  const units = Array.isArray(unitsRaw)
    ? unitsRaw
        .filter((u): u is Record<string, unknown> => isRecord(u))
        .slice(0, 20)
        .map((u) => ({
          bidPrice: Number(u.bid_price ?? 0),
          bidSize: Number(u.bid_size ?? 0),
          askPrice: Number(u.ask_price ?? 0),
          askSize: Number(u.ask_size ?? 0),
        }))
    : []

  const bestBidKrw = units[0]?.bidPrice ?? 0
  const bestAskKrw = units[0]?.askPrice ?? 0
  const spreadKrw = bestAskKrw - bestBidKrw
  const spreadPct = bestBidKrw > 0 ? Math.round((spreadKrw / bestBidKrw) * 10000) / 100 : 0

  return c.json({
    paid: true,
    service: 'crossfin-upbit-orderbook',
    market,
    bestBidKrw,
    bestAskKrw,
    spreadKrw,
    spreadPct,
    bestBidUsd: Math.round(bestBidKrw / krwRate * 100) / 100,
    bestAskUsd: Math.round(bestAskKrw / krwRate * 100) / 100,
    units,
    krwUsdRate: krwRate,
    at: new Date().toISOString(),
  })
})

type UpbitVolumeSignal = 'high' | 'normal' | 'low'
type UpbitMomentum = 'strong-up' | 'up' | 'neutral' | 'down' | 'strong-down'
type UpbitTradingSignal = 'bullish' | 'bearish' | 'neutral'
type UpbitSignalConfidence = 'high' | 'medium' | 'low'

function upbitMomentumBucket(change24hPct: number): UpbitMomentum {
  if (change24hPct >= 4) return 'strong-up'
  if (change24hPct >= 1) return 'up'
  if (change24hPct <= -4) return 'strong-down'
  if (change24hPct <= -1) return 'down'
  return 'neutral'
}

function upbitVolumeBucket(volume24hKrw: number, avgVolume24hKrw: number): UpbitVolumeSignal {
  if (!(avgVolume24hKrw > 0)) return 'normal'
  if (volume24hKrw >= avgVolume24hKrw * 1.5) return 'high'
  if (volume24hKrw <= avgVolume24hKrw * 0.5) return 'low'
  return 'normal'
}

function upbitSignalFrom(
  change24hPct: number,
  momentum: UpbitMomentum,
  volumeSignal: UpbitVolumeSignal,
  volatilityPct: number,
): { signal: UpbitTradingSignal; confidence: UpbitSignalConfidence } {
  let signal: UpbitTradingSignal = 'neutral'
  if ((momentum === 'up' || momentum === 'strong-up') && change24hPct > 1 && volumeSignal !== 'low') {
    signal = 'bullish'
  } else if ((momentum === 'down' || momentum === 'strong-down') && change24hPct < -1 && volumeSignal !== 'low') {
    signal = 'bearish'
  }

  const absChange = Math.abs(change24hPct)
  let confidence: UpbitSignalConfidence = 'low'
  if (signal !== 'neutral') {
    if (absChange >= 4 && volumeSignal === 'high' && volatilityPct <= 10) confidence = 'high'
    else if (absChange >= 2 && volumeSignal !== 'low' && volatilityPct <= 15) confidence = 'medium'
  }
  return { signal, confidence }
}

app.get('/api/premium/market/upbit/signals', async (c) => {
  const markets = ['KRW-BTC', 'KRW-ETH', 'KRW-XRP', 'KRW-SOL', 'KRW-DOGE', 'KRW-ADA'] as const

  const tickers = await Promise.all(
    markets.map(async (market) => ({ market, ticker: await fetchUpbitTicker(market) })),
  )

  const base = tickers.map(({ market, ticker }) => {
    const tradePriceKrw = typeof ticker.trade_price === 'number' ? ticker.trade_price : Number(ticker.trade_price ?? 0)
    const changeRate = typeof ticker.signed_change_rate === 'number' ? ticker.signed_change_rate : Number(ticker.signed_change_rate ?? 0)
    const highPriceKrw = typeof ticker.high_price === 'number' ? ticker.high_price : Number(ticker.high_price ?? 0)
    const lowPriceKrw = typeof ticker.low_price === 'number' ? ticker.low_price : Number(ticker.low_price ?? 0)
    const volume24hKrw = typeof ticker.acc_trade_price_24h === 'number' ? ticker.acc_trade_price_24h : Number(ticker.acc_trade_price_24h ?? 0)

    const change24hPct = round2((Number.isFinite(changeRate) ? changeRate : 0) * 100)
    const price = Number.isFinite(tradePriceKrw) ? tradePriceKrw : 0
    const hi = Number.isFinite(highPriceKrw) ? highPriceKrw : 0
    const lo = Number.isFinite(lowPriceKrw) ? lowPriceKrw : 0
    const vol = Number.isFinite(volume24hKrw) ? volume24hKrw : 0
    const volatilityPct = price > 0 ? round2(((Math.max(hi, lo) - Math.min(hi, lo)) / price) * 100) : 0

    return {
      market,
      priceKrw: round2(price),
      change24hPct,
      volume24hKrw: round2(vol),
      volatilityPct,
    }
  })

  const avgVolume24hKrw = base.length > 0 ? base.reduce((s, r) => s + r.volume24hKrw, 0) / base.length : 0

  const signals = base.map((row) => {
    const volumeSignal = upbitVolumeBucket(row.volume24hKrw, avgVolume24hKrw)
    const momentum = upbitMomentumBucket(row.change24hPct)
    const derived = upbitSignalFrom(row.change24hPct, momentum, volumeSignal, row.volatilityPct)
    return {
      market: row.market,
      priceKrw: row.priceKrw,
      change24hPct: row.change24hPct,
      volume24hKrw: row.volume24hKrw,
      volatilityPct: row.volatilityPct,
      volumeSignal,
      momentum,
      signal: derived.signal,
      confidence: derived.confidence,
    }
  })

  const bullishCount = signals.filter((s) => s.signal === 'bullish').length
  const bearishCount = signals.filter((s) => s.signal === 'bearish').length
  const neutralCount = signals.length - bullishCount - bearishCount

  const overallSentiment: UpbitTradingSignal = bullishCount >= bearishCount + 2
    ? 'bullish'
    : bearishCount >= bullishCount + 2
      ? 'bearish'
      : 'neutral'

  return c.json({
    paid: true,
    service: 'crossfin-upbit-signals',
    signals,
    marketSummary: {
      bullishCount,
      bearishCount,
      neutralCount,
      overallSentiment,
    },
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/coinone/ticker', async (c) => {
  const currency = requireSymbol(c.req.query('currency') ?? 'BTC', 'currency')
  const [ticker, krwRate] = await Promise.all([
    fetchCoinoneTicker(currency),
    fetchKrwRate(),
  ])

  const lastKrw = Number(ticker.last ?? 0)
  const highKrw = Number(ticker.high ?? 0)
  const lowKrw = Number(ticker.low ?? 0)
  const firstKrw = Number(ticker.first ?? 0)
  const volume24hKrw = Number(ticker.quote_volume ?? 0)

  return c.json({
    paid: true,
    service: 'crossfin-coinone-ticker',
    currency,
    lastKrw,
    lastUsd: Math.round(lastKrw / krwRate * 100) / 100,
    highKrw,
    lowKrw,
    firstKrw,
    volume24hKrw,
    volume24hUsd: Math.round(volume24hKrw / krwRate),
    krwUsdRate: krwRate,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/news/korea/headlines', async (c) => {
  const limit = Math.min(20, Math.max(1, Number(c.req.query('limit') ?? '10')))
  const feedUrl = 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko'

  const res = await fetch(feedUrl, { headers: { 'User-Agent': 'crossfin-news/1.0' } })
  if (!res.ok) throw new HTTPException(502, { message: 'News feed unavailable' })
  const xml = await res.text()

  const items: Array<{ title: string; publisher: string | null; link: string; publishedAt: string }> = []
  const re = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null
  while (items.length < limit) {
    match = re.exec(xml)
    if (!match) break
    const block = match[1] ?? ''
    const rawTitle = extractXmlTag(block, 'title')
    const link = extractXmlTag(block, 'link')
    const pubDate = extractXmlTag(block, 'pubDate')
    if (!rawTitle || !link || !pubDate) continue
    const { title, publisher } = splitPublisherFromTitle(rawTitle)
    items.push({ title, publisher, link, publishedAt: parseIsoDate(pubDate) })
  }

  return c.json({
    paid: true,
    service: 'crossfin-korea-headlines',
    feed: 'google-news-rss',
    url: feedUrl,
    items,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/market/cross-exchange', async (c) => {
  const coins = parseCoinsQueryParam(c.req.query('coins'))

  const [bithumbSet, binanceSet, krwSet] = await Promise.allSettled([
    fetchBithumbAll(),
    fetchGlobalPrices(),
    fetchKrwRate(),
  ])

  const bithumbData: Record<string, Record<string, string>> = bithumbSet.status === 'fulfilled' ? bithumbSet.value : {}
  const binancePrices: Record<string, number> = binanceSet.status === 'fulfilled' ? binanceSet.value : {}
  const krwRate = krwSet.status === 'fulfilled' ? krwSet.value : 1450

  const rows = await Promise.all(
    coins.map(async (coin) => {
      const binanceSymbol = TRACKED_PAIRS[coin]
      const binancePriceRaw = binanceSymbol ? binancePrices[binanceSymbol] : undefined
      const binance: BinanceExchangeData | null = typeof binancePriceRaw === 'number' && Number.isFinite(binancePriceRaw)
        ? { priceUsd: round2(binancePriceRaw) }
        : null

      const bithumbRaw = bithumbData[coin]
      const bithumbKrw = bithumbRaw?.closing_price ? parseFloat(bithumbRaw.closing_price) : 0
      const bithumbVolumeKrw = bithumbRaw?.acc_trade_value_24H ? parseFloat(bithumbRaw.acc_trade_value_24H) : 0
      const bithumbChangePct = bithumbRaw?.fluctate_rate_24H ? parseFloat(bithumbRaw.fluctate_rate_24H) : 0
      const bithumb: DomesticExchangeData | null = Number.isFinite(bithumbKrw) && bithumbKrw > 0
        ? {
          priceKrw: bithumbKrw,
          priceUsd: round2(bithumbKrw / krwRate),
          volume24hKrw: Number.isFinite(bithumbVolumeKrw) ? bithumbVolumeKrw : 0,
          volume24hUsd: round2((Number.isFinite(bithumbVolumeKrw) ? bithumbVolumeKrw : 0) / krwRate),
          change24hPct: round2(Number.isFinite(bithumbChangePct) ? bithumbChangePct : 0),
        }
        : null

      const market = `KRW-${coin}`
      const [upbitRes, coinoneRes] = await Promise.allSettled([
        fetchUpbitTicker(market),
        fetchCoinoneTicker(coin),
      ])

      let upbit: DomesticExchangeData | null = null
      if (upbitRes.status === 'fulfilled') {
        const ticker = upbitRes.value
        const tradePriceKrw = typeof ticker.trade_price === 'number' ? ticker.trade_price : Number(ticker.trade_price ?? 0)
        const changeRate = typeof ticker.signed_change_rate === 'number' ? ticker.signed_change_rate : Number(ticker.signed_change_rate ?? 0)
        const volume24hKrw = typeof ticker.acc_trade_price_24h === 'number' ? ticker.acc_trade_price_24h : Number(ticker.acc_trade_price_24h ?? 0)

        if (Number.isFinite(tradePriceKrw) && tradePriceKrw > 0) {
          const volumeKrw = Number.isFinite(volume24hKrw) ? volume24hKrw : 0
          const changePct = Number.isFinite(changeRate) ? changeRate * 100 : 0
          upbit = {
            priceKrw: tradePriceKrw,
            priceUsd: round2(tradePriceKrw / krwRate),
            volume24hKrw: volumeKrw,
            volume24hUsd: round2(volumeKrw / krwRate),
            change24hPct: round2(changePct),
          }
        }
      }

      let coinone: DomesticExchangeData | null = null
      if (coinoneRes.status === 'fulfilled') {
        const ticker = coinoneRes.value
        const lastKrw = Number(ticker.last ?? 0)
        const firstKrw = Number(ticker.first ?? 0)
        const volume24hKrw = Number(ticker.quote_volume ?? 0)

        if (Number.isFinite(lastKrw) && lastKrw > 0) {
          const open = Number.isFinite(firstKrw) ? firstKrw : 0
          const changePct = open > 0 ? ((lastKrw - open) / open) * 100 : 0
          const volumeKrw = Number.isFinite(volume24hKrw) ? volume24hKrw : 0
          coinone = {
            priceKrw: lastKrw,
            priceUsd: round2(lastKrw / krwRate),
            volume24hKrw: volumeKrw,
            volume24hUsd: round2(volumeKrw / krwRate),
            change24hPct: round2(changePct),
          }
        }
      }

      const exchanges: CrossExchangeExchanges = { bithumb, upbit, coinone, binance }

      const kimchiPremium: CrossExchangeKimchiPremium = { bithumb: null, upbit: null, coinone: null, average: null }
      if (binance?.priceUsd && binance.priceUsd > 0) {
        const premiums: number[] = []
        const compute = (ex: DomesticExchangeData | null): number | null => {
          if (!ex) return null
          const pct = ((ex.priceUsd - binance.priceUsd) / binance.priceUsd) * 100
          const rounded = round2(pct)
          premiums.push(rounded)
          return rounded
        }
        kimchiPremium.bithumb = compute(bithumb)
        kimchiPremium.upbit = compute(upbit)
        kimchiPremium.coinone = compute(coinone)
        kimchiPremium.average = premiums.length > 0 ? round2(premiums.reduce((s, p) => s + p, 0) / premiums.length) : null
      }

      const domesticPrices: Array<{ exchange: DomesticExchangeId; priceKrw: number }> = []
      if (bithumb?.priceKrw) domesticPrices.push({ exchange: 'bithumb', priceKrw: bithumb.priceKrw })
      if (upbit?.priceKrw) domesticPrices.push({ exchange: 'upbit', priceKrw: upbit.priceKrw })
      if (coinone?.priceKrw) domesticPrices.push({ exchange: 'coinone', priceKrw: coinone.priceKrw })

      let domesticArbitrage: CrossExchangeDomesticArbitrage = null
      if (domesticPrices.length >= 2) {
        domesticPrices.sort((a, b) => a.priceKrw - b.priceKrw)
        const low = domesticPrices[0]
        const high = domesticPrices[domesticPrices.length - 1]
        if (low !== undefined && high !== undefined) {
          const spreadKrw = high.priceKrw - low.priceKrw
          const spreadPct = low.priceKrw > 0 ? round2((spreadKrw / low.priceKrw) * 100) : 0
          domesticArbitrage = {
            lowestExchange: low.exchange,
            lowestPriceKrw: low.priceKrw,
            highestExchange: high.exchange,
            highestPriceKrw: high.priceKrw,
            spreadKrw,
            spreadPct,
          }
        }
      }

      return {
        coin,
        exchanges,
        kimchiPremium,
        domesticArbitrage,
      }
    }),
  )

  const avgPremiums = rows
    .map((r) => r.kimchiPremium.average)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const avgKimchiPremium = avgPremiums.length > 0
    ? round2(avgPremiums.reduce((s, p) => s + p, 0) / avgPremiums.length)
    : 0

  const arbitrageCandidates = rows
    .filter((r) => r.domesticArbitrage !== null)
    .map((r) => ({
      coin: r.coin,
      buy: r.domesticArbitrage!.lowestExchange,
      sell: r.domesticArbitrage!.highestExchange,
      spreadPct: r.domesticArbitrage!.spreadPct,
    }))
    .sort((a, b) => b.spreadPct - a.spreadPct)

  return c.json({
    paid: true,
    service: 'crossfin-cross-exchange',
    coinsCompared: coins.length,
    krwUsdRate: round2(krwRate),
    coins: rows,
    summary: {
      avgKimchiPremium,
      bestDomesticArbitrage: arbitrageCandidates[0] ?? null,
    },
    at: new Date().toISOString(),
  })
})

// === Free Demo — delayed kimchi premium (no paywall) ===

app.get('/api/arbitrage/demo', async (c) => {
  const [bithumbData, binancePrices, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchGlobalPrices(),
    fetchKrwRate(),
  ])

  const premiums = calcPremiums(bithumbData, binancePrices, krwRate)
  // Demo: only show top 3, hide detailed numbers
  const preview = premiums.slice(0, 3).map((p) => ({
    coin: p.coin,
    premiumPct: p.premiumPct,
    direction: p.premiumPct > 0 ? 'Korea premium' : 'Korea discount',
  }))

  return c.json({
    demo: true,
    note: 'Free preview — limited to top 3 pairs. Pay $0.05 USDC via x402 for full real-time data on all pairs.',
    paidEndpoint: '/api/premium/arbitrage/kimchi',
    pairsShown: preview.length,
    totalPairsAvailable: premiums.length,
    preview,
    avgPremiumPct: premiums.length > 0
      ? Math.round(premiums.reduce((s, p) => s + p.premiumPct, 0) / premiums.length * 100) / 100
      : 0,
    at: new Date().toISOString(),
  })
})

app.get('/api/cron/snapshot-kimchi', async (c) => {
  requireAdmin(c)

  const [bithumbData, binancePrices, krwRate] = await Promise.all([
    fetchBithumbAll(),
    fetchGlobalPrices(),
    fetchKrwRate(),
  ])

  const premiums = calcPremiums(bithumbData, binancePrices, krwRate)

  const insertSql = 'INSERT INTO kimchi_snapshots (id, coin, bithumb_krw, binance_usd, premium_pct, krw_usd_rate, volume_24h_usd) VALUES (?, ?, ?, ?, ?, ?, ?)'
  const statements = premiums.map((p) => c.env.DB.prepare(insertSql).bind(
    crypto.randomUUID(),
    p.coin,
    p.bithumbKrw,
    p.binanceUsd,
    p.premiumPct,
    krwRate,
    p.volume24hUsd,
  ))

  if (statements.length > 0) {
    try {
      await c.env.DB.batch(statements)
    } catch (err) {
      console.error(err)
      throw new HTTPException(500, { message: 'DB schema not migrated (kimchi_snapshots table missing)' })
    }
  }

  await audit(
    c.env.DB,
    null,
    'admin.cron.snapshot_kimchi',
    'kimchi_snapshots',
    null,
    'success',
    `snapshots=${statements.length}`,
  )

  return c.json({ ok: true, snapshots: statements.length })
})

// === Existing Premium Endpoints ===

app.get('/api/premium/report', async (c) => {
  const results = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'active'"),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM wallets'),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM transactions'),
  ])

  const agents = results[0]
  const wallets = results[1]
  const txns = results[2]

  const blocked = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM audit_logs WHERE result = 'blocked'"
  ).first<{ count: number }>()

  const { results: recentTransactions } = await c.env.DB.prepare(
    'SELECT id, rail, amount_cents, currency, memo, status, created_at FROM transactions ORDER BY created_at DESC LIMIT 10'
  ).all()

  return c.json({
    paid: true,
    network: requireCaip2(c.env.X402_NETWORK),
    stats: {
      agents: (agents?.results?.[0] as { count: number } | undefined)?.count ?? 0,
      wallets: (wallets?.results?.[0] as { count: number } | undefined)?.count ?? 0,
      transactions: (txns?.results?.[0] as { count: number } | undefined)?.count ?? 0,
      blocked: blocked?.count ?? 0,
    },
    recentTransactions,
    at: new Date().toISOString(),
  })
})

app.get('/api/premium/enterprise', async (c) => {
  const now = new Date().toISOString()
  return c.json({
    paid: true,
    tier: 'enterprise',
    priceUsd: 20,
    network: requireCaip2(c.env.X402_NETWORK),
    receiptId: crypto.randomUUID(),
    at: now,
  })
})

const api = new Hono<Env>()

api.get('/survival/status', async (c) => {
  const now = new Date()
  const day = now.toISOString().slice(0, 10)
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString()

  const [totalCalls, todayCalls, recentCalls, weekCalls] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM service_calls').first<{ cnt: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM service_calls WHERE created_at >= ?').bind(day).first<{ cnt: number }>(),
    c.env.DB.prepare(
      "SELECT sc.id, sc.service_id, s.name as service_name, sc.status, sc.response_time_ms, sc.created_at FROM service_calls sc LEFT JOIN services s ON sc.service_id = s.id ORDER BY sc.created_at DESC LIMIT 20"
    ).all<{ id: string; service_id: string; service_name: string | null; status: string; response_time_ms: number; created_at: string }>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM service_calls WHERE created_at >= ?').bind(weekAgo).first<{ cnt: number }>(),
  ])

  const activeServices = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM services WHERE status = 'active'"
  ).first<{ cnt: number }>()

  const agents = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM agents WHERE status = 'active'"
  ).first<{ cnt: number }>()

  const callsToday = todayCalls?.cnt ?? 0
  const callsWeek = weekCalls?.cnt ?? 0
  const alive = true

  return c.json({
    alive,
    state: alive ? 'ALIVE' : 'STOPPED',
    version: '1.4.1',
    metrics: {
      totalCalls: totalCalls?.cnt ?? 0,
      callsToday,
      callsThisWeek: callsWeek,
      activeServices: activeServices?.cnt ?? 0,
      registeredAgents: agents?.cnt ?? 0,
    },
    recentEvents: (recentCalls?.results ?? []).map((r) => ({
      id: r.id,
      serviceId: r.service_id,
      serviceName: r.service_name,
      status: r.status,
      responseTimeMs: r.response_time_ms,
      at: r.created_at,
    })),
    at: now.toISOString(),
  })
})

api.use('*', agentAuth)

api.get('/me', async (c) => {
  const agentId = c.get('agentId')
  const agent = await c.env.DB.prepare(
    'SELECT id, name, status, created_at FROM agents WHERE id = ?'
  ).bind(agentId).first()
  return c.json({ data: agent })
})

api.post('/wallets', async (c) => {
  const agentId = c.get('agentId')
  const body = await c.req.json<{ label: string; initialBalanceCents?: number }>()
  if (!body.label?.trim()) throw new HTTPException(400, { message: 'label is required' })

  const id = crypto.randomUUID()
  const balance = Math.max(0, Math.round(body.initialBalanceCents ?? 0))

  await c.env.DB.prepare(
    'INSERT INTO wallets (id, agent_id, label, balance_cents) VALUES (?, ?, ?, ?)'
  ).bind(id, agentId, body.label.trim(), balance).run()

  if (balance > 0) {
    const txId = crypto.randomUUID()
    await c.env.DB.prepare(
      "INSERT INTO transactions (id, to_wallet_id, amount_cents, rail, memo, status) VALUES (?, ?, ?, 'manual', 'Initial deposit', 'completed')"
    ).bind(txId, id, balance).run()
  }

  await audit(c.env.DB, agentId, 'wallet.create', 'wallets', id, 'success')
  return c.json({ id, label: body.label.trim(), balanceCents: balance }, 201)
})

api.get('/wallets', async (c) => {
  const agentId = c.get('agentId')
  const { results } = await c.env.DB.prepare(
    'SELECT id, label, balance_cents, currency, created_at FROM wallets WHERE agent_id = ?'
  ).bind(agentId).all()
  return c.json({ data: results })
})

api.get('/wallets/:id/balance', async (c) => {
  const agentId = c.get('agentId')
  const walletId = c.req.param('id')
  const wallet = await c.env.DB.prepare(
    'SELECT id, balance_cents, currency FROM wallets WHERE id = ? AND agent_id = ?'
  ).bind(walletId, agentId).first()
  if (!wallet) throw new HTTPException(404, { message: 'Wallet not found' })
  return c.json({ data: wallet })
})

api.post('/transfers', async (c) => {
  const agentId = c.get('agentId')
  const body = await c.req.json<{
    fromWalletId: string
    toWalletId: string
    amountCents: number
    rail?: string
    memo?: string
  }>()

  if (!body.fromWalletId || !body.toWalletId) {
    throw new HTTPException(400, { message: 'fromWalletId and toWalletId required' })
  }
  const amount = Math.round(body.amountCents ?? 0)
  if (amount <= 0) throw new HTTPException(400, { message: 'amountCents must be positive' })

  if (body.fromWalletId === body.toWalletId) {
    throw new HTTPException(400, { message: 'Cannot transfer to same wallet' })
  }

  const from = await c.env.DB.prepare(
    'SELECT id FROM wallets WHERE id = ? AND agent_id = ?'
  ).bind(body.fromWalletId, agentId).first<{ id: string }>()
  if (!from) throw new HTTPException(404, { message: 'Source wallet not found' })

  const to = await c.env.DB.prepare(
    'SELECT id FROM wallets WHERE id = ?'
  ).bind(body.toWalletId).first()
  if (!to) throw new HTTPException(404, { message: 'Destination wallet not found' })

  const budget = await c.env.DB.prepare(
    'SELECT daily_limit_cents, monthly_limit_cents FROM budgets WHERE agent_id = ?'
  ).bind(agentId).first<{ daily_limit_cents: number | null; monthly_limit_cents: number | null }>()

  if (budget) {
    const spentToday = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions WHERE from_wallet_id IN (SELECT id FROM wallets WHERE agent_id = ?) AND status = 'completed' AND created_at >= date('now')"
    ).bind(agentId).first<{ total: number }>()

    if (budget.daily_limit_cents !== null && spentToday && (spentToday.total + amount) > budget.daily_limit_cents) {
      await audit(c.env.DB, agentId, 'transfer.blocked', 'transactions', null, 'blocked', `Daily budget exceeded: spent ${spentToday.total} + ${amount} > limit ${budget.daily_limit_cents}`)
      throw new HTTPException(429, { message: `CIRCUIT_BREAKER: Daily budget exceeded. Spent: ${spentToday.total}, Limit: ${budget.daily_limit_cents}` })
    }

    if (budget.monthly_limit_cents !== null) {
      const spentMonth = await c.env.DB.prepare(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions WHERE from_wallet_id IN (SELECT id FROM wallets WHERE agent_id = ?) AND status = 'completed' AND created_at >= date('now', 'start of month')"
      ).bind(agentId).first<{ total: number }>()

      if (spentMonth && (spentMonth.total + amount) > budget.monthly_limit_cents) {
        await audit(c.env.DB, agentId, 'transfer.blocked', 'transactions', null, 'blocked', `Monthly budget exceeded: spent ${spentMonth.total} + ${amount} > limit ${budget.monthly_limit_cents}`)
        throw new HTTPException(429, { message: `CIRCUIT_BREAKER: Monthly budget exceeded. Spent: ${spentMonth.total}, Limit: ${budget.monthly_limit_cents}` })
      }
    }
  }

  const txId = crypto.randomUUID()
  const rail = body.rail ?? 'internal'

  const debit = await c.env.DB.prepare(
    'UPDATE wallets SET balance_cents = balance_cents - ?, updated_at = datetime("now") WHERE id = ? AND agent_id = ? AND balance_cents >= ?'
  ).bind(amount, body.fromWalletId, agentId, amount).run()

  const debitChanges = Number(debit.meta.changes ?? 0)
  if (debitChanges === 0) {
    await audit(c.env.DB, agentId, 'transfer.blocked', 'transactions', null, 'blocked', 'Insufficient balance')
    throw new HTTPException(400, { message: 'Insufficient balance' })
  }

  try {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = datetime("now") WHERE id = ?').bind(amount, body.toWalletId),
      c.env.DB.prepare(
        "INSERT INTO transactions (id, from_wallet_id, to_wallet_id, amount_cents, rail, memo, status) VALUES (?, ?, ?, ?, ?, ?, 'completed')"
      ).bind(txId, body.fromWalletId, body.toWalletId, amount, rail, body.memo ?? ''),
    ])
  } catch (error) {
    try {
      await c.env.DB.prepare(
        'UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = datetime("now") WHERE id = ? AND agent_id = ?'
      ).bind(amount, body.fromWalletId, agentId).run()
    } catch (rollbackError) {
      console.error('Transfer rollback failed', rollbackError)
    }
    console.error('Transfer finalization failed', error)
    throw new HTTPException(500, { message: 'Transfer failed' })
  }

  await audit(c.env.DB, agentId, 'transfer.execute', 'transactions', txId, 'success')

  return c.json({
    transactionId: txId,
    amountCents: amount,
    rail,
    status: 'completed',
  }, 201)
})

api.get('/transactions', async (c) => {
  const agentId = c.get('agentId')
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50')))
  const walletId = c.req.query('walletId')

  let query: string
  let params: unknown[]

  if (walletId) {
    query = 'SELECT t.* FROM transactions t JOIN wallets w ON (t.from_wallet_id = w.id OR t.to_wallet_id = w.id) WHERE w.agent_id = ? AND (t.from_wallet_id = ? OR t.to_wallet_id = ?) ORDER BY t.created_at DESC LIMIT ?'
    params = [agentId, walletId, walletId, limit]
  } else {
    query = 'SELECT t.* FROM transactions t LEFT JOIN wallets w1 ON t.from_wallet_id = w1.id LEFT JOIN wallets w2 ON t.to_wallet_id = w2.id WHERE w1.agent_id = ? OR w2.agent_id = ? ORDER BY t.created_at DESC LIMIT ?'
    params = [agentId, agentId, limit]
  }

  const stmt = c.env.DB.prepare(query)
  const { results } = await stmt.bind(...params).all()
  return c.json({ data: results })
})

api.post('/budgets', async (c) => {
  const agentId = c.get('agentId')
  const body = await c.req.json<{ dailyLimitCents?: number | null; monthlyLimitCents?: number | null }>()

  const daily = body.dailyLimitCents === null ? null : (body.dailyLimitCents ? Math.round(body.dailyLimitCents) : null)
  const monthly = body.monthlyLimitCents === null ? null : (body.monthlyLimitCents ? Math.round(body.monthlyLimitCents) : null)

  await c.env.DB.prepare(
    `INSERT INTO budgets (id, agent_id, daily_limit_cents, monthly_limit_cents)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET daily_limit_cents = excluded.daily_limit_cents, monthly_limit_cents = excluded.monthly_limit_cents, updated_at = datetime('now')`
  ).bind(crypto.randomUUID(), agentId, daily, monthly).run()

  await audit(c.env.DB, agentId, 'budget.set', 'budgets', agentId, 'success')

  return c.json({ dailyLimitCents: daily, monthlyLimitCents: monthly })
})

api.get('/budgets', async (c) => {
  const agentId = c.get('agentId')
  const budget = await c.env.DB.prepare(
    'SELECT daily_limit_cents, monthly_limit_cents FROM budgets WHERE agent_id = ?'
  ).bind(agentId).first()
  return c.json({ data: budget ?? { daily_limit_cents: null, monthly_limit_cents: null } })
})

api.get('/audit', async (c) => {
  const agentId = c.get('agentId')
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50')))
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM audit_logs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(agentId, limit).all()
  return c.json({ data: results })
})

app.get('/api/stats', async (c) => {
  const results = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'active'"),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM wallets'),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM transactions'),
  ])

  const agents = results[0]
  const wallets = results[1]
  const txns = results[2]

  const blocked = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM audit_logs WHERE result = 'blocked'"
  ).first<{ count: number }>()

  return c.json({
    agents: (agents?.results?.[0] as { count: number } | undefined)?.count ?? 0,
    wallets: (wallets?.results?.[0] as { count: number } | undefined)?.count ?? 0,
    transactions: (txns?.results?.[0] as { count: number } | undefined)?.count ?? 0,
    blocked: blocked?.count ?? 0,
  })
})

app.route('/api', api)

async function audit(
  db: D1Database,
  agentId: string | null,
  action: string,
  resource: string,
  resourceId: string | null,
  result: 'success' | 'blocked' | 'error',
  detail?: string,
) {
  await db.prepare(
    'INSERT INTO audit_logs (id, agent_id, action, resource, resource_id, detail, result) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), agentId, action, resource, resourceId, detail ?? null, result).run()
}

export default app
