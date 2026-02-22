import { Hono } from 'hono'
import { CROSSFIN_API_VERSION, CROSSFIN_MCP_TOOLS } from '../catalog'
import { CROSSFIN_DISCLAIMER } from '../constants'
import type { Env } from '../types'

const discovery = new Hono<Env>()

discovery.get('/', (c) => c.json({ name: 'crossfin-api', version: CROSSFIN_API_VERSION, status: 'ok' }))
discovery.get('/api/health', (c) => c.json({ name: 'crossfin-api', version: CROSSFIN_API_VERSION, status: 'ok' }))

discovery.get('/.well-known/crossfin.json', (c) => {
  const origin = new URL(c.req.url).origin
  return c.json({
    name: 'CrossFin',
    version: CROSSFIN_API_VERSION,
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
      package: 'crossfin-mcp',
      run: 'npx -y crossfin-mcp',
      repo: 'https://github.com/bubilife1202/crossfin/tree/main/apps/mcp-server',
      env: { CROSSFIN_API_URL: origin },
      tools: CROSSFIN_MCP_TOOLS,
    },
    _disclaimer: CROSSFIN_DISCLAIMER,
    updatedAt: new Date().toISOString(),
  })
})

discovery.get('/.well-known/x402.json', (c) => {
  const origin = new URL(c.req.url).origin
  const payTo = c.env.PAYMENT_RECEIVER_ADDRESS
  const network = c.env.X402_NETWORK || 'eip155:8453'
  const usdcAsset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

  return c.json({
    x402Version: 2,
    provider: {
      name: 'CrossFin',
      description: 'Cross-border crypto routing engine for AI agents. Routes capital across 13 Korean/Japan/India/Indonesia/Thailand/global exchanges (Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, bitbank, Indodax, Bitkub, Binance, OKX, Bybit, KuCoin). Real-time spread and route signals with 11 bridge coins.',
      url: 'https://crossfin.dev',
      docs: 'https://docs.crossfin.dev',
      github: 'https://github.com/bubilife1202/crossfin',
      categories: ['crypto-routing', 'korean-market-data', 'arbitrage', 'exchange-data', 'defi'],
      tags: ['route-spread', 'cross-exchange', 'korean-crypto', 'bithumb', 'upbit', 'binance', 'okx', 'bybit', 'mcp', 'ai-agent'],
    },
    payment: {
      network,
      asset: usdcAsset,
      currency: 'USDC',
      payTo,
      facilitator: c.env.FACILITATOR_URL || 'https://facilitator.payai.network',
      scheme: 'exact',
      maxTimeoutSeconds: 300,
    },
    endpoints: [
      { resource: `${origin}/api/premium/arbitrage/kimchi`, method: 'GET', price: '$0.05', description: 'Real-time Route Spread Index — Korean vs global exchange price spread for 11 crypto pairs' },
      { resource: `${origin}/api/premium/arbitrage/opportunities`, method: 'GET', price: '$0.10', description: 'AI-ready market condition indicators: POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD with signal strength scores' },
      { resource: `${origin}/api/premium/route/find`, method: 'GET', price: '$0.10', description: 'Optimal crypto transfer route across 13 exchanges using 11 bridge coins' },
      { resource: `${origin}/api/premium/bithumb/orderbook`, method: 'GET', price: '$0.02', description: 'Live Bithumb orderbook depth (30 levels)' },
      { resource: `${origin}/api/premium/market/upbit/ticker`, method: 'GET', price: '$0.02', description: 'Upbit real-time ticker' },
      { resource: `${origin}/api/premium/market/upbit/orderbook`, method: 'GET', price: '$0.02', description: 'Upbit orderbook depth' },
      { resource: `${origin}/api/premium/market/coinone/ticker`, method: 'GET', price: '$0.02', description: 'Coinone real-time ticker' },
      { resource: `${origin}/api/premium/market/fx/usdkrw`, method: 'GET', price: '$0.01', description: 'USD/KRW exchange rate' },
      { resource: `${origin}/api/premium/market/korea`, method: 'GET', price: '$0.03', description: 'Korean market sentiment overview' },
      { resource: `${origin}/api/premium/crypto/korea/5exchange`, method: 'GET', price: '$0.08', description: '4-exchange Korean crypto price comparison' },
      { resource: `${origin}/api/premium/morning/brief`, method: 'GET', price: '$0.20', description: 'Morning Brief bundle: route spread + FX + headlines' },
      { resource: `${origin}/api/premium/crypto/snapshot`, method: 'GET', price: '$0.15', description: 'Crypto Snapshot: 4-exchange prices + route spread + volume + FX' },
    ],
    free: [
      { resource: `${origin}/api/arbitrage/demo`, method: 'GET', description: 'Free route spread preview (top 3 pairs)' },
      { resource: `${origin}/api/route/exchanges`, method: 'GET', description: 'Supported exchanges and coins' },
      { resource: `${origin}/api/route/fees`, method: 'GET', description: 'Fee comparison table' },
      { resource: `${origin}/api/route/pairs`, method: 'GET', description: 'Trading pairs with live prices' },
      { resource: `${origin}/api/route/status`, method: 'GET', description: 'Exchange health check' },
      { resource: `${origin}/api/registry`, method: 'GET', description: 'Full service registry (184 services)' },
      { resource: `${origin}/api/docs/guide`, method: 'GET', description: 'Structured agent onboarding guide' },
      { resource: `${origin}/api/openapi.json`, method: 'GET', description: 'OpenAPI 3.1 spec' },
    ],
    mcp: {
      package: 'crossfin-mcp',
      install: 'npx -y crossfin-mcp',
      tools: 16,
      repo: 'https://github.com/bubilife1202/crossfin/tree/main/apps/mcp-server',
    },
    updatedAt: new Date().toISOString(),
  })
})

discovery.get('/.well-known/agent.json', (c) => {
  const origin = new URL(c.req.url).origin
  return c.json({
    name: 'CrossFin',
    url: origin,
    version: CROSSFIN_API_VERSION,
    description: 'Cross-border crypto routing engine for AI agents. Routes capital across 13 Korean and global exchanges with 11 bridge coins. Pay-per-request via x402 USDC micropayments.',
    provider: {
      organization: 'CrossFin',
      url: 'https://crossfin.dev',
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    skills: [
      {
        id: 'crypto-routing',
        name: 'Cross-Exchange Crypto Routing',
        description: 'Find the cheapest path to move crypto between Korean exchanges (Bithumb, Upbit, Coinone, GoPax), regional exchanges (bitFlyer, WazirX, bitbank, Indodax, Bitkub), and global exchanges (Binance, OKX, Bybit, KuCoin) using 11 bridge coins.',
        tags: ['crypto', 'routing', 'arbitrage', 'korea'],
        examples: ['Find cheapest route from Bithumb KRW to Binance USDC for 5,000,000 KRW'],
      },
      {
        id: 'route-spread',
        name: 'Route Spread / Kimchi Premium Index',
        description: 'Real-time price spread between Korean and global crypto exchanges for 11 pairs with POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD indicators.',
        tags: ['arbitrage', 'spread', 'kimchi-premium', 'signals'],
        examples: ['What is the current kimchi premium?', 'Show route spread for BTC'],
      },
      {
        id: 'korean-market-data',
        name: 'Korean Market Data',
        description: 'Korean stock market (KOSPI/KOSDAQ), 1070+ ETFs, investor flow, crypto exchange data, USD/KRW rate, and news headlines.',
        tags: ['korea', 'stocks', 'crypto', 'market-data', 'fx'],
        examples: ['Get KOSPI index', 'Show Korean crypto headlines', 'USD/KRW rate'],
      },
      {
        id: 'agent-finance',
        name: 'Agent Financial Management',
        description: 'Local ledger for AI agents: create wallets, transfer funds, set daily budgets, track transactions.',
        tags: ['wallet', 'budget', 'ledger', 'agent-finance'],
        examples: ['Create a wallet for Agent A with 500,000 KRW', 'Set daily budget to 200,000 KRW'],
      },
    ],
    securitySchemes: {
      x402: {
        type: 'http',
        scheme: 'x402',
        description: 'x402 USDC micropayment on Base mainnet. Free endpoints work without payment.',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Agent-Key',
        description: 'Agent API key for authenticated endpoints (registration, deposits, guardian).',
      },
    },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    interfaces: {
      openapi: `${origin}/api/openapi.json`,
      mcp: {
        package: 'crossfin-mcp',
        install: 'npx -y crossfin-mcp',
      },
      guide: `${origin}/api/docs/guide`,
    },
  })
})

discovery.get('/.well-known/glama.json', () => {
  return Response.json({
    name: 'CrossFin',
    maintainer: {
      email: 'bubilife1202@gmail.com',
    },
    repository: 'https://github.com/bubilife1202/crossfin',
  })
})

discovery.get('/.well-known/ai-plugin.json', (c) => {
  const origin = new URL(c.req.url).origin
  return c.json({
    schema_version: 'v1',
    name_for_human: 'CrossFin',
    name_for_model: 'crossfin',
    description_for_human: 'Korean and global crypto exchange routing, arbitrage signals, and market data for AI agents.',
    description_for_model: 'CrossFin provides: (1) optimal crypto routing across 13 exchanges (Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, bitbank, Indodax, Bitkub, Binance, OKX, Bybit, KuCoin) with 11 bridge coins, (2) real-time route spread (kimchi premium) index with POSITIVE_SPREAD/NEUTRAL/NEGATIVE_SPREAD indicators, (3) Korean market data including KOSPI/KOSDAQ, ETFs, investor flow, and crypto prices, (4) USD/KRW exchange rates. Free endpoints available. Paid endpoints use x402 USDC micropayments on Base.',
    auth: { type: 'none' },
    api: {
      type: 'openapi',
      url: `${origin}/api/openapi.json`,
    },
    logo_url: 'https://crossfin.dev/logos/crossfin.png',
    contact_email: 'hello@crossfin.dev',
    legal_info_url: 'https://crossfin.dev',
  })
})

discovery.get('/llms.txt', (c) => {
  const origin = new URL(c.req.url).origin
  const text = `# CrossFin

> Cross-border crypto routing engine for AI agents. Routes capital across 13 Korean and global exchanges with x402 USDC micropayments.

## Docs

- [Agent Guide](${origin}/api/docs/guide): Complete onboarding guide for AI agents
- [API Reference](https://docs.crossfin.dev/api): Full endpoint documentation
- [OpenAPI Spec](${origin}/api/openapi.json): Machine-readable API specification
- [MCP Server](https://www.npmjs.com/package/crossfin-mcp): 16 tools for any MCP client

## Free Endpoints

- [Route Spread Demo](${origin}/api/arbitrage/demo): Top 3 Korean-vs-global price spreads
- [Exchange List](${origin}/api/route/exchanges): 13 supported exchanges and coins
- [Fee Table](${origin}/api/route/fees): Trading and withdrawal fees
- [Exchange Prices](${origin}/api/route/pairs): Live bridge coin prices
- [Exchange Status](${origin}/api/route/status): Network health
- [Optimal Route](${origin}/api/routing/optimal): Free routing graph data
- [Service Registry](${origin}/api/registry): 184+ discoverable services
- [ACP Quote](${origin}/api/acp/quote): Free routing quote (POST)

## Paid Endpoints (x402 USDC on Base)

- Optimal Route Finding: $0.10
- Route Spread Index (11 pairs): $0.05
- Arbitrage Opportunities: $0.10
- Bithumb/Upbit/Coinone Orderbooks: $0.02
- USD/KRW Rate: $0.01
- KOSPI/KOSDAQ Indices: $0.03
- Morning Brief Bundle: $0.20
- Crypto Snapshot Bundle: $0.15

## Discovery

- [\`.well-known/crossfin.json\`](${origin}/.well-known/crossfin.json): CrossFin discovery
- [\`.well-known/x402.json\`](${origin}/.well-known/x402.json): Payment discovery
- [\`.well-known/agent.json\`](${origin}/.well-known/agent.json): A2A Agent Card
- [\`.well-known/ai-plugin.json\`](${origin}/.well-known/ai-plugin.json): OpenAI plugin manifest
- [\`.well-known/glama.json\`](${origin}/.well-known/glama.json): Glama.ai ownership verification

## Quick Start

1. Check health: GET ${origin}/api/health
2. See exchanges: GET ${origin}/api/route/exchanges
3. Get spread: GET ${origin}/api/arbitrage/demo
4. Find route: GET ${origin}/api/routing/optimal?from=bithumb:KRW&to=binance:USDC&amount=5000000
5. Install MCP: npx -y crossfin-mcp
`
  return c.text(text)
})

export default discovery
