import { Hono } from 'hono'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod/v4'
import type { Env } from '../types'
import { CROSSFIN_API_VERSION } from '../catalog'
import { CORS_ALLOWED_ORIGINS } from '../constants'

const mcp = new Hono<Env>()

mcp.all('/', async (c) => {
  const requestOrigin = (c.req.header('origin') ?? '').trim()
  const allowedOrigin = CORS_ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : ''
  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, mcp-session-id, Last-Event-ID, mcp-protocol-version',
      'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
    }})
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  const server = new McpServer({ name: 'crossfin', version: CROSSFIN_API_VERSION })
  const BASE = new URL(c.req.url).origin

  async function proxy(path: string): Promise<{ content: Array<{ type: 'text'; text: string }>, isError?: boolean }> {
    try {
      const res = await fetch(`${BASE}${path}`)
      if (!res.ok) throw new Error(`API ${res.status}`)
      return { content: [{ type: 'text', text: await res.text() }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }
    }
  }

  const LOCAL_ONLY = { content: [{ type: 'text' as const, text: 'This tool requires local installation. Run: npx crossfin-mcp (set EVM_PRIVATE_KEY for paid tools). See: https://crossfin.dev/api/docs/guide' }] }

  server.registerTool('get_kimchi_premium', { description: 'Free preview of Route Spread — real-time price spread between Korean and global crypto exchanges (top 3 pairs)', inputSchema: z.object({}) }, async () => proxy('/api/arbitrage/demo'))
  server.registerTool('list_exchange_fees', { description: 'Trading fees, withdrawal fees, and transfer times for all supported exchanges (Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, Binance, OKX, Bybit)', inputSchema: z.object({}) }, async () => proxy('/api/route/fees'))
  server.registerTool('compare_exchange_prices', { description: 'Compare Bithumb KRW prices vs Binance USD prices for tracked coins with transfer-time estimates', inputSchema: z.object({ coin: z.string().optional().describe('Coin symbol (e.g. BTC, XRP). Omit for all.') }) }, async ({ coin }) => {
    const qs = coin?.trim() ? `?coin=${encodeURIComponent(coin.trim().toUpperCase())}` : ''
    return proxy(`/api/route/pairs${qs}`)
  })
  server.registerTool('search_services', { description: 'Search the CrossFin service registry (184 services) by keyword', inputSchema: z.object({ query: z.string().describe('Search keyword') }) }, async ({ query }) => proxy(`/api/registry/search?q=${encodeURIComponent(query)}`))
  server.registerTool('list_services', { description: 'List services from the CrossFin registry with optional category filter', inputSchema: z.object({ category: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }) }, async ({ category, limit }) => {
    const qs = new URLSearchParams()
    if (category?.trim()) qs.set('category', category.trim())
    if (typeof limit === 'number') qs.set('limit', String(limit))
    return proxy(`/api/registry${qs.size ? `?${qs}` : ''}`)
  })
  server.registerTool('get_service', { description: 'Get detailed information about a specific service by ID', inputSchema: z.object({ serviceId: z.string() }) }, async ({ serviceId }) => proxy(`/api/registry/${encodeURIComponent(serviceId)}`))
  server.registerTool('list_categories', { description: 'List all service categories with counts', inputSchema: z.object({}) }, async () => proxy('/api/registry/categories'))
  server.registerTool('get_analytics', { description: 'CrossFin gateway usage analytics — total calls, top services, recent activity', inputSchema: z.object({}) }, async () => proxy('/api/analytics/overview'))
  server.registerTool('get_guide', { description: 'Complete CrossFin API guide — services, pricing, x402 payment flow, code examples', inputSchema: z.object({}) }, async () => proxy('/api/docs/guide'))
  server.registerTool('find_optimal_route', { description: 'Find cheapest/fastest path across 9 exchanges using 11 bridge coins. Paid: $0.10 via x402. Requires local install with EVM_PRIVATE_KEY.', inputSchema: z.object({ from: z.string().describe('Source (e.g. bithumb:KRW)'), to: z.string().describe('Destination (e.g. binance:USDC)'), amount: z.number(), strategy: z.enum(['cheapest', 'fastest', 'balanced']).optional() }) }, async () => LOCAL_ONLY)
  server.registerTool('call_paid_service', { description: 'Call any CrossFin paid API with automatic x402 USDC payment. Requires local install with EVM_PRIVATE_KEY.', inputSchema: z.object({ serviceId: z.string().optional(), url: z.string().optional(), params: z.record(z.string(), z.string()).optional() }) }, async () => LOCAL_ONLY)
  server.registerTool('create_wallet', { description: 'Create a wallet in the local CrossFin ledger. Requires local install.', inputSchema: z.object({ label: z.string(), initialDepositKrw: z.number().optional() }) }, async () => LOCAL_ONLY)
  server.registerTool('get_balance', { description: 'Get wallet balance (KRW). Requires local install.', inputSchema: z.object({ walletId: z.string() }) }, async () => LOCAL_ONLY)
  server.registerTool('transfer', { description: 'Transfer funds between wallets (KRW). Requires local install.', inputSchema: z.object({ fromWalletId: z.string(), toWalletId: z.string(), amountKrw: z.number() }) }, async () => LOCAL_ONLY)
  server.registerTool('list_transactions', { description: 'List transactions. Requires local install.', inputSchema: z.object({ walletId: z.string().optional(), limit: z.number().optional() }) }, async () => LOCAL_ONLY)
  server.registerTool('set_budget', { description: 'Set daily spend limit (KRW). Requires local install.', inputSchema: z.object({ dailyLimitKrw: z.number().nullable() }) }, async () => LOCAL_ONLY)

  await server.server.connect(transport)
  const res = await transport.handleRequest(c.req.raw)
  return new Response(res.body, { status: res.status, headers: {
    ...Object.fromEntries(res.headers.entries()),
    ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
    'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
  }})
})

export default mcp
