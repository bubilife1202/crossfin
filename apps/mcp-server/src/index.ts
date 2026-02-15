import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'

import {
  createWallet,
  defaultLedgerPath,
  getBalance,
  listTransactions,
  setBudget,
  transfer,
  type Rail,
} from './ledgerStore.js'


const LEDGER_PATH = process.env.CROSSFIN_LEDGER_PATH?.trim() || defaultLedgerPath()
const API_BASE = (process.env.CROSSFIN_API_URL?.trim() || 'https://crossfin.dev').replace(/\/$/, '')

const server = new McpServer({ name: 'crossfin', version: '0.0.0' })

const railSchema = z.enum(['manual', 'kakaopay', 'toss', 'stripe', 'x402'])

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text().catch(() => res.statusText)}`)
  }
  return res.json() as Promise<T>
}

server.registerTool(
  'create_wallet',
  {
    title: 'Create wallet',
    description: 'Create a wallet in the local CrossFin ledger',
    inputSchema: z.object({
      label: z.string().min(1).describe('Wallet label'),
      initialDepositKrw: z.number().optional().describe('Optional initial deposit (KRW)'),
    }),
    outputSchema: z.object({
      walletId: z.string(),
      label: z.string(),
      balanceKrw: z.number(),
    }),
  },
  async ({ label, initialDepositKrw }): Promise<CallToolResult> => {
    const wallet = await createWallet(LEDGER_PATH, label, initialDepositKrw ?? 0)
    const out = { walletId: wallet.id, label: wallet.label, balanceKrw: wallet.balanceKrw }
    return {
      content: [{ type: 'text', text: JSON.stringify(out) }],
      structuredContent: out,
    }
  }
)

server.registerTool(
  'get_balance',
  {
    title: 'Get balance',
    description: 'Get the balance (KRW) of a wallet',
    inputSchema: z.object({ walletId: z.string().min(1) }),
    outputSchema: z.object({ walletId: z.string(), balanceKrw: z.number() }),
  },
  async ({ walletId }): Promise<CallToolResult> => {
    const balance = await getBalance(LEDGER_PATH, walletId)
    if (balance === null) {
      return {
        content: [{ type: 'text', text: `Wallet not found: ${walletId}` }],
        structuredContent: { walletId, balanceKrw: -1 },
      }
    }

    const out = { walletId, balanceKrw: balance }
    return {
      content: [{ type: 'text', text: JSON.stringify(out) }],
      structuredContent: out,
    }
  }
)

server.registerTool(
  'transfer',
  {
    title: 'Transfer',
    description: 'Transfer funds between wallets (KRW)',
    inputSchema: z.object({
      fromWalletId: z.string().min(1),
      toWalletId: z.string().min(1),
      amountKrw: z.number().describe('Transfer amount in KRW'),
      rail: railSchema.optional().describe('Payment rail'),
      memo: z.string().optional().describe('Memo'),
    }),
    outputSchema: z.object({
      transactionId: z.string(),
      fromBalanceKrw: z.number(),
      toBalanceKrw: z.number(),
    }),
  },
  async ({ fromWalletId, toWalletId, amountKrw, rail, memo }): Promise<CallToolResult> => {
    const result = await transfer(LEDGER_PATH, {
      fromWalletId,
      toWalletId,
      amountKrw,
      rail: (rail ?? 'manual') as Rail,
      memo: memo ?? '',
    })

    if (!result) {
      return {
        content: [{ type: 'text', text: 'Transfer failed (check wallet ids / balance / amount)' }],
        structuredContent: {
          transactionId: '',
          fromBalanceKrw: -1,
          toBalanceKrw: -1,
        },
      }
    }

    const out = {
      transactionId: result.tx.id,
      fromBalanceKrw: result.fromBalanceKrw,
      toBalanceKrw: result.toBalanceKrw,
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(out) }],
      structuredContent: out,
    }
  }
)

server.registerTool(
  'list_transactions',
  {
    title: 'List transactions',
    description: 'List transactions (optionally filtered by wallet)',
    inputSchema: z.object({
      walletId: z.string().optional(),
      limit: z.number().optional().describe('Max items (1..200). Default 50'),
    }),
  },
  async ({ walletId, limit }): Promise<CallToolResult> => {
    const trimmedWalletId = walletId?.trim()
    const txs = await listTransactions(
      LEDGER_PATH,
      trimmedWalletId ? { walletId: trimmedWalletId, limit: limit ?? 50 } : { limit: limit ?? 50 }
    )
    return {
      content: [{ type: 'text', text: JSON.stringify({ transactions: txs }) }],
      structuredContent: { transactions: txs },
    }
  }
)

server.registerTool(
  'set_budget',
  {
    title: 'Set budget',
    description: 'Set a daily spend limit for the local ledger (KRW)',
    inputSchema: z.object({
      dailyLimitKrw: z.number().nullable().describe('Daily budget limit (KRW). Use null to clear.'),
    }),
    outputSchema: z.object({ dailyLimitKrw: z.number().nullable() }),
  },
  async ({ dailyLimitKrw }): Promise<CallToolResult> => {
    const out = await setBudget(LEDGER_PATH, dailyLimitKrw)
    return {
      content: [{ type: 'text', text: JSON.stringify(out) }],
      structuredContent: out,
    }
  }
)

server.registerTool(
  'search_services',
  {
    title: 'Search services',
    description: 'Search the CrossFin service registry for x402 services by keyword',
    inputSchema: z.object({
      query: z.string().describe('Search keyword (e.g. "crypto", "translate", "korea")'),
    }),
  },
  async ({ query }): Promise<CallToolResult> => {
    try {
      const qs = new URLSearchParams({ q: query })
      const data = await apiFetch<unknown>(`/api/registry/search?${qs.toString()}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : 'Unknown error'}` }],
        isError: true,
      }
    }
  }
)

server.registerTool(
  'list_services',
  {
    title: 'List services',
    description: 'List services from the CrossFin registry with optional category filter',
    inputSchema: z.object({
      category: z.string().optional().describe('Category filter (e.g. "crypto-data", "ai", "tools")'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20, max 100)'),
    }),
  },
  async ({ category, limit }): Promise<CallToolResult> => {
    try {
      const qs = new URLSearchParams()
      const trimmedCategory = category?.trim()
      if (trimmedCategory) qs.set('category', trimmedCategory)
      if (typeof limit === 'number') qs.set('limit', String(limit))
      const path = qs.size ? `/api/registry?${qs.toString()}` : '/api/registry'
      const data = await apiFetch<unknown>(path)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : 'Unknown error'}` }],
        isError: true,
      }
    }
  }
)

server.registerTool(
  'get_service',
  {
    title: 'Get service',
    description: 'Get detailed information about a specific service by ID',
    inputSchema: z.object({
      serviceId: z.string().describe('Service ID (e.g. "svc_kimchi_premium")'),
    }),
  },
  async ({ serviceId }): Promise<CallToolResult> => {
    try {
      const encodedId = encodeURIComponent(serviceId)
      const data = await apiFetch<unknown>(`/api/registry/${encodedId}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : 'Unknown error'}` }],
        isError: true,
      }
    }
  }
)

server.registerTool(
  'list_categories',
  {
    title: 'List categories',
    description: 'List all service categories with counts',
    inputSchema: z.object({}),
  },
  async (_params): Promise<CallToolResult> => {
    try {
      const data = await apiFetch<unknown>('/api/registry/categories')
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : 'Unknown error'}` }],
        isError: true,
      }
    }
  }
)

server.registerTool(
  'get_kimchi_premium',
  {
    title: 'Get kimchi premium',
    description:
      'Get free preview of the Kimchi Premium index — real-time price spread between Korean and global crypto exchanges (top 3 pairs)',
    inputSchema: z.object({}),
  },
  async (_params): Promise<CallToolResult> => {
    try {
      const data = await apiFetch<unknown>('/api/arbitrage/demo')
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : 'Unknown error'}` }],
        isError: true,
      }
    }
  }
)

server.registerTool(
  'get_analytics',
  {
    title: 'Get analytics',
    description: 'Get CrossFin gateway usage analytics — total calls, top services, recent activity',
    inputSchema: z.object({}),
  },
  async (_params): Promise<CallToolResult> => {
    try {
      const data = await apiFetch<unknown>('/api/analytics/overview')
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : 'Unknown error'}` }],
        isError: true,
      }
    }
  }
)

server.registerTool(
  'get_guide',
  {
    title: 'Get CrossFin guide',
    description:
      'Get the complete CrossFin API guide — what services are available, how to search, pricing, x402 payment flow, and code examples',
    inputSchema: z.object({}),
  },
  async (_params): Promise<CallToolResult> => {
    try {
      const data = await apiFetch<unknown>('/api/docs/guide')
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : 'Unknown error'}` }],
        isError: true,
      }
    }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
