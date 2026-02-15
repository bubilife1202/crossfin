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

const app = new Hono<Env>()

app.use('*', cors({
  origin: ['http://localhost:5173', 'https://crossfin.pages.dev', 'https://crossfin.dev', 'https://www.crossfin.dev'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Agent-Key', 'PAYMENT-SIGNATURE'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
}))

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/', (c) => c.json({ name: 'crossfin-api', version: '1.0.0', status: 'ok' }))
app.get('/api/health', (c) => c.json({ name: 'crossfin-api', version: '1.0.0', status: 'ok' }))

// === OpenAPI Spec ===

app.get('/api/openapi.json', (c) => {
  return c.json({
    openapi: '3.1.0',
    info: {
      title: 'CrossFin — x402 Agent Services Gateway (Korea)',
      version: '1.0.0',
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
          summary: 'Proxy GET to a registered service (free; adds 5% fee)',
          description: 'Looks up the service by id in the registry and forwards the request to its endpoint, passing through query params. Logs the call to service_calls.',
          tags: ['Free'],
          parameters: [{ name: 'serviceId', in: 'path', required: true, schema: { type: 'string' } }],
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
            '502': { description: 'Upstream request failed' },
          },
        },
        post: {
          operationId: 'proxyPost',
          summary: 'Proxy POST to a registered service (free; adds 5% fee)',
          description: 'Looks up the service by id in the registry and forwards the request to its endpoint, passing through query params and request body. Logs the call to service_calls.',
          tags: ['Free'],
          parameters: [{ name: 'serviceId', in: 'path', required: true, schema: { type: 'string' } }],
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
        '/api/premium/arbitrage/opportunities': '$0.10',
        '/api/premium/bithumb/orderbook': '$0.02',
        '/api/premium/market/korea': '$0.03',
        '/api/premium/market/fx/usdkrw': '$0.01',
        '/api/premium/market/upbit/ticker': '$0.02',
        '/api/premium/market/upbit/orderbook': '$0.02',
        '/api/premium/market/coinone/ticker': '$0.02',
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

      seeds.push({
        id: `x402engine_${id}`,
        name,
        description: null,
        provider: 'x402engine',
        category: `x402engine:${cat}`,
        endpoint,
        method: 'UNKNOWN',
        price,
        currency,
        network,
        payTo: null,
        status: 'active',
        tags: ['x402', 'external', 'x402engine', cat],
      })
    }
  }

  return seeds
}

async function ensureRegistrySeeded(db: D1Database, receiverAddress: string): Promise<void> {
  let row: { count: number | string } | null
  try {
    row = await db.prepare('SELECT COUNT(*) as count FROM services').first<{ count: number | string }>()
  } catch {
    throw new HTTPException(500, { message: 'DB schema not migrated (services table missing)' })
  }

  const count = row ? Number(row.count) : 0
  if (Number.isFinite(count) && count > 0) return

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
  const allSeeds = [...crossfinSeeds, ...externalSeeds, ...x402engineSeeds]

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
    data: (results ?? []).map(mapServiceRow),
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
    data: (results ?? []).map(mapServiceRow),
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

app.get('/api/registry/reseed', async (c) => {
  const confirm = (c.req.query('confirm') ?? '').trim().toLowerCase()
  if (confirm !== 'yes') {
    throw new HTTPException(400, { message: 'Add ?confirm=yes to reseed the registry' })
  }

  await c.env.DB.prepare('DELETE FROM services').run()
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const row = await c.env.DB.prepare('SELECT COUNT(*) as count FROM services').first<{ count: number | string }>()
  const count = row ? Number(row.count) : 0

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

  return c.json({ data: mapServiceRow(row) })
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
  const endpoint = body.endpoint ? requireHttpsUrl(body.endpoint) : ''
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
  return c.json({ data: created ? mapServiceRow(created) : { id } }, 201)
})

async function proxyToService(c: Context<Env>, method: 'GET' | 'POST'): Promise<Response> {
  await ensureRegistrySeeded(c.env.DB, c.env.PAYMENT_RECEIVER_ADDRESS)

  const serviceId = c.req.param('serviceId')
  const row = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(serviceId).first<Record<string, unknown>>()
  if (!row) throw new HTTPException(404, { message: 'Service not found' })

  const service = mapServiceRow(row)

  let upstreamUrl: URL
  try {
    upstreamUrl = new URL(service.endpoint)
  } catch {
    throw new HTTPException(500, { message: 'Service endpoint is not a valid URL' })
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

    const init: RequestInit = { method, headers }
    if (method === 'POST') {
      const contentType = c.req.header('content-type')
      if (contentType) headers['content-type'] = contentType
      init.body = await c.req.arrayBuffer()
    }

    const upstreamRes = await fetch(upstreamUrl.toString(), init)
    const responseTimeMs = Date.now() - start
    const status = upstreamRes.ok ? 'success' : 'error'

    try {
      await c.env.DB.prepare(
        'INSERT INTO service_calls (id, service_id, agent_id, status, response_time_ms) VALUES (?, ?, ?, ?, ?)'
      ).bind(callId, service.id, null, status, responseTimeMs).run()
    } catch (err) {
      console.error('Failed to log service call', err)
    }

    const body = await upstreamRes.arrayBuffer()
    const outHeaders = new Headers(upstreamRes.headers)
    outHeaders.set('X-CrossFin-Proxy', 'true')
    outHeaders.set('X-CrossFin-Fee', '5%')
    return new Response(body, { status: upstreamRes.status, headers: outHeaders })
  } catch (err) {
    const responseTimeMs = Date.now() - start

    try {
      await c.env.DB.prepare(
        'INSERT INTO service_calls (id, service_id, agent_id, status, response_time_ms) VALUES (?, ?, ?, ?, ?)'
      ).bind(callId, service.id, null, 'error', responseTimeMs).run()
    } catch (logErr) {
      console.error('Failed to log service call', logErr)
    }

    console.error('Proxy upstream request failed', err)
    return c.json({ error: 'Upstream request failed' }, 502)
  }
}

app.get('/api/proxy/:serviceId', async (c) => {
  return proxyToService(c, 'GET')
})

app.post('/api/proxy/:serviceId', async (c) => {
  return proxyToService(c, 'POST')
})

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
    service: mapServiceRow(row),
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
  while ((match = re.exec(xml)) && items.length < limit) {
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
    'SELECT id, balance_cents FROM wallets WHERE id = ? AND agent_id = ?'
  ).bind(body.fromWalletId, agentId).first<{ id: string; balance_cents: number }>()
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

  if (from.balance_cents < amount) {
    await audit(c.env.DB, agentId, 'transfer.blocked', 'transactions', null, 'blocked', 'Insufficient balance')
    throw new HTTPException(400, { message: 'Insufficient balance' })
  }

  const txId = crypto.randomUUID()
  const rail = body.rail ?? 'internal'

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents - ?, updated_at = datetime("now") WHERE id = ?').bind(amount, body.fromWalletId),
    c.env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = datetime("now") WHERE id = ?').bind(amount, body.toWalletId),
    c.env.DB.prepare(
      "INSERT INTO transactions (id, from_wallet_id, to_wallet_id, amount_cents, rail, memo, status) VALUES (?, ?, ?, ?, ?, ?, 'completed')"
    ).bind(txId, body.fromWalletId, body.toWalletId, amount, rail, body.memo ?? ''),
  ])

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
