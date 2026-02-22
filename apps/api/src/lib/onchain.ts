import { HTTPException } from 'hono/http-exception'
import { isRecord } from '../types'

const BASE_RPC_URLS = [
  'https://mainnet.base.org',
  'https://base.llamarpc.com',
  'https://base-rpc.publicnode.com',
] as const

const BASE_RPC_TIMEOUT_MS = 4_000
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
export const USDC_DECIMALS = 6

type RpcLog = {
  address?: string
  topics?: string[]
  data?: string
  blockNumber?: string
  transactionHash?: string
  logIndex?: string
}

export type UsdcTransfer = {
  hash: string
  from: string
  to: string
  value: string
  tokenDecimal: string
  timeStamp: string
}

function toTopicAddress(address: string): string {
  const normalized = address.trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new HTTPException(500, { message: 'Invalid PAYMENT_RECEIVER_ADDRESS (expected 0x + 40 hex chars)' })
  }
  return `0x${normalized.slice(2).padStart(64, '0')}`
}

export function topicToAddress(topic: string): string {
  const raw = topic.trim().toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(raw)) return ''
  return `0x${raw.slice(-40)}`
}

async function baseRpc<T>(method: string, params: unknown[]): Promise<T> {
  for (const url of BASE_RPC_URLS) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), BASE_RPC_TIMEOUT_MS)

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`Base RPC unavailable (${res.status})`)
        const data: unknown = await res.json()
        if (!isRecord(data)) throw new Error('Base RPC invalid response')
        if (data.error) throw new Error('Base RPC error')
        if (!('result' in data)) throw new Error('Base RPC missing result')
        return data.result as T
      } finally {
        clearTimeout(timeoutId)
      }
    } catch {
      continue
    }
  }

  throw new HTTPException(502, { message: 'Base RPC unavailable' })
}

export async function fetchRecentUsdcTransfers(walletAddress: string, limit: number): Promise<UsdcTransfer[]> {
  const latestHex = await baseRpc<string>('eth_blockNumber', [])
  const latest = typeof latestHex === 'string' ? parseInt(latestHex, 16) : NaN
  if (!Number.isFinite(latest) || latest <= 0) throw new HTTPException(502, { message: 'Base RPC unavailable' })

  const toTopic = toTopicAddress(walletAddress)
  const ranges = [8_000, 40_000]

  let logs: RpcLog[] = []
  for (const span of ranges) {
    const fromBlock = Math.max(0, latest - span)
    const filter = {
      address: BASE_USDC_ADDRESS,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${latest.toString(16)}`,
      topics: [ERC20_TRANSFER_TOPIC, null, toTopic],
    }
    const out = await baseRpc<RpcLog[]>('eth_getLogs', [filter])
    logs = Array.isArray(out) ? out : []
    if (logs.length >= limit) break
  }

  const sorted = logs
    .filter((l) => Boolean(l && typeof l.transactionHash === 'string' && typeof l.blockNumber === 'string'))
    .sort((a, b) => {
      const aBlock = Number.parseInt(a.blockNumber ?? '0x0', 16) || 0
      const bBlock = Number.parseInt(b.blockNumber ?? '0x0', 16) || 0
      if (aBlock !== bBlock) return bBlock - aBlock
      const aIdx = Number.parseInt(a.logIndex ?? '0x0', 16) || 0
      const bIdx = Number.parseInt(b.logIndex ?? '0x0', 16) || 0
      return bIdx - aIdx
    })
    .slice(0, limit)

  const blockNums = Array.from(
    new Set(sorted.map((l) => parseInt(l.blockNumber ?? '0x0', 16)).filter((n) => Number.isFinite(n) && n >= 0)),
  )
  const blockTs = new Map<number, string>()
  await Promise.all(blockNums.map(async (n) => {
    const block = await baseRpc<unknown>('eth_getBlockByNumber', [`0x${n.toString(16)}`, false])
    if (!isRecord(block) || typeof block.timestamp !== 'string') return
    const ts = parseInt(block.timestamp, 16)
    if (!Number.isFinite(ts) || ts <= 0) return
    blockTs.set(n, String(ts))
  }))

  const transfers: UsdcTransfer[] = []
  for (const log of sorted) {
    const topics = Array.isArray(log.topics) ? log.topics : []
    const from = typeof topics[1] === 'string' ? topicToAddress(topics[1]) : ''
    const to = typeof topics[2] === 'string' ? topicToAddress(topics[2]) : ''
    const hash = typeof log.transactionHash === 'string' ? log.transactionHash : ''
    const data = typeof log.data === 'string' ? log.data : ''
    const blockNumber = typeof log.blockNumber === 'string' ? parseInt(log.blockNumber, 16) : NaN

    if (!hash || !from || !to || !data.startsWith('0x') || data.length < 3) continue

    let valueAtomic = 0n
    try {
      valueAtomic = BigInt(data)
    } catch {
      continue
    }

    const timeStamp = Number.isFinite(blockNumber) ? (blockTs.get(blockNumber) ?? '') : ''
    if (!timeStamp) continue

    transfers.push({
      hash,
      from,
      to,
      value: valueAtomic.toString(),
      tokenDecimal: String(USDC_DECIMALS),
      timeStamp,
    })
  }

  return transfers
}
