import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// File-level mutex — prevents concurrent read-modify-write races on the same
// ledger file.  Each file path gets its own queue so independent ledgers
// do not block each other.
// ---------------------------------------------------------------------------
const fileLocks = new Map<string, Promise<void>>()

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(filePath) ?? Promise.resolve()
  let release: () => void
  const next = new Promise<void>((resolve) => { release = resolve })
  fileLocks.set(filePath, next)
  try {
    await prev
    return await fn()
  } finally {
    release!()
    if (fileLocks.get(filePath) === next) fileLocks.delete(filePath)
  }
}

export type Rail = 'kakaopay' | 'toss' | 'stripe' | 'x402' | 'manual'

export type Wallet = {
  id: string
  label: string
  balanceKrw: number
  createdAt: string
}

export type Transaction = {
  id: string
  at: string
  rail: Rail
  fromWalletId: string | null
  toWalletId: string | null
  amountKrw: number
  memo: string
}

export type LedgerDb = {
  version: 1
  wallets: Wallet[]
  transactions: Transaction[]
  budget: { dailyLimitKrw: number | null }
}

export function defaultLedgerPath(): string {
  return path.join(os.homedir(), '.crossfin', 'ledger.json')
}

export async function readDb(filePath: string): Promise<LedgerDb> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (isLedgerDb(parsed)) return parsed
    return emptyDb()
  } catch {
    return emptyDb()
  }
}

export async function writeDb(filePath: string, db: LedgerDb): Promise<void> {
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })

  const tmp = `${filePath}.tmp-${randomUUID()}`
  const payload = JSON.stringify(db, null, 2)
  await writeFile(tmp, payload, 'utf8')
  await rename(tmp, filePath)
}

export async function createWallet(filePath: string, label: string, initialDepositKrw: number): Promise<Wallet> {
  return withFileLock(filePath, async () => {
    const db = await readDb(filePath)
    const now = new Date().toISOString()
    const wallet: Wallet = {
      id: randomUUID(),
      label: label.trim(),
      balanceKrw: 0,
      createdAt: now,
    }

    db.wallets.unshift(wallet)

    if (initialDepositKrw > 0) {
      const amount = Math.round(initialDepositKrw)
      wallet.balanceKrw += amount
      db.transactions.unshift({
        id: randomUUID(),
        at: now,
        rail: 'manual',
        fromWalletId: null,
        toWalletId: wallet.id,
        amountKrw: amount,
        memo: 'Initial deposit',
      })
    }

    await writeDb(filePath, db)
    return wallet
  })
}

export async function getBalance(filePath: string, walletId: string): Promise<number | null> {
  const db = await readDb(filePath)
  const w = db.wallets.find((x) => x.id === walletId)
  return w ? w.balanceKrw : null
}

export type TransferError = { error: string }

export async function transfer(
  filePath: string,
  input: {
    fromWalletId: string
    toWalletId: string
    amountKrw: number
    rail: Rail
    memo: string
  }
): Promise<{ tx: Transaction; fromBalanceKrw: number; toBalanceKrw: number } | TransferError | null> {
  return withFileLock(filePath, async () => {
    const db = await readDb(filePath)
    const from = db.wallets.find((w) => w.id === input.fromWalletId)
    const to = db.wallets.find((w) => w.id === input.toWalletId)
    if (!from || !to) return null

    const amount = Math.round(input.amountKrw)
    if (amount <= 0) return null
    if (from.balanceKrw < amount) return null

    // Budget enforcement: check daily spend limit before executing
    if (db.budget.dailyLimitKrw !== null) {
      const todaySpent = getDailySpent(db, input.fromWalletId)
      if (todaySpent + amount > db.budget.dailyLimitKrw) {
        const remaining = Math.max(0, db.budget.dailyLimitKrw - todaySpent)
        return {
          error: `Daily budget exceeded. Limit: ${db.budget.dailyLimitKrw} KRW, spent today: ${todaySpent} KRW, remaining: ${remaining} KRW, requested: ${amount} KRW`,
        }
      }
    }

    from.balanceKrw -= amount
    to.balanceKrw += amount

    const tx: Transaction = {
      id: randomUUID(),
      at: new Date().toISOString(),
      rail: input.rail,
      fromWalletId: from.id,
      toWalletId: to.id,
      amountKrw: amount,
      memo: input.memo.trim(),
    }
    db.transactions.unshift(tx)

    await writeDb(filePath, db)
    return { tx, fromBalanceKrw: from.balanceKrw, toBalanceKrw: to.balanceKrw }
  })
}

/** Sum all outgoing transfers from a wallet for today (UTC). */
function getDailySpent(db: LedgerDb, walletId: string): number {
  const todayPrefix = new Date().toISOString().slice(0, 10) // "YYYY-MM-DD"
  let total = 0
  for (const tx of db.transactions) {
    if (!tx.at.startsWith(todayPrefix)) continue
    if (tx.fromWalletId === walletId) {
      total += tx.amountKrw
    }
  }
  return total
}

export async function listTransactions(
  filePath: string,
  input: { walletId?: string; limit: number }
): Promise<Transaction[]> {
  const db = await readDb(filePath)
  const limit = Math.max(1, Math.min(200, Math.round(input.limit)))
  const walletId = input.walletId?.trim()
  if (!walletId) return db.transactions.slice(0, limit)
  return db.transactions
    .filter((t) => t.fromWalletId === walletId || t.toWalletId === walletId)
    .slice(0, limit)
}

export async function setBudget(
  filePath: string,
  dailyLimitKrw: number | null
): Promise<{ dailyLimitKrw: number | null }> {
  return withFileLock(filePath, async () => {
    const db = await readDb(filePath)
    if (dailyLimitKrw === null) {
      db.budget.dailyLimitKrw = null
    } else {
      const limit = Math.round(dailyLimitKrw)
      db.budget.dailyLimitKrw = limit > 0 ? limit : null
    }
    await writeDb(filePath, db)
    return { dailyLimitKrw: db.budget.dailyLimitKrw }
  })
}

function emptyDb(): LedgerDb {
  return {
    version: 1,
    wallets: [],
    transactions: [],
    budget: { dailyLimitKrw: null },
  }
}

function isLedgerDb(input: unknown): input is LedgerDb {
  if (!input || typeof input !== 'object') return false
  const s = input as Record<string, unknown>
  if (s.version !== 1) return false
  if (!Array.isArray(s.wallets) || !Array.isArray(s.transactions)) return false
  if (!s.budget || typeof s.budget !== 'object') return false

  const b = s.budget as Record<string, unknown>
  if (b.dailyLimitKrw !== null && typeof b.dailyLimitKrw !== 'number') return false
  return true
}
