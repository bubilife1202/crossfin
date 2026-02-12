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

export type LedgerBudget = {
  dailyLimitKrw: number | null
}

export type LedgerState = {
  version: 1
  wallets: Wallet[]
  transactions: Transaction[]
  budget: LedgerBudget
}

export type LedgerAction =
  | {
      type: 'wallet_create'
      label: string
      initialDepositKrw?: number
    }
  | {
      type: 'deposit'
      walletId: string
      amountKrw: number
      rail: Rail
      memo?: string
    }
  | {
      type: 'transfer'
      fromWalletId: string
      toWalletId: string
      amountKrw: number
      rail: Rail
      memo?: string
    }
  | {
      type: 'budget_set'
      dailyLimitKrw: number | null
    }
  | { type: 'reset' }

const STORAGE_KEY = 'crossfin:ledger:v1'

export function defaultLedgerState(): LedgerState {
  return {
    version: 1,
    wallets: [],
    transactions: [],
    budget: { dailyLimitKrw: null },
  }
}

export function loadLedgerState(): LedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultLedgerState()

    const parsed: unknown = JSON.parse(raw)
    if (!isLedgerState(parsed)) return defaultLedgerState()
    return parsed
  } catch {
    return defaultLedgerState()
  }
}

export function saveLedgerState(state: LedgerState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function resetLedgerStorage() {
  localStorage.removeItem(STORAGE_KEY)
}

export function ledgerReducer(state: LedgerState, action: LedgerAction): LedgerState {
  switch (action.type) {
    case 'wallet_create': {
      const label = action.label.trim()
      if (!label) return state

      const now = new Date().toISOString()
      const wallet: Wallet = {
        id: crypto.randomUUID(),
        label,
        balanceKrw: 0,
        createdAt: now,
      }

      let next: LedgerState = {
        ...state,
        wallets: [wallet, ...state.wallets],
      }

      const deposit = action.initialDepositKrw ?? 0
      if (deposit > 0) {
        next = ledgerReducer(next, {
          type: 'deposit',
          walletId: wallet.id,
          amountKrw: deposit,
          rail: 'manual',
          memo: 'Initial deposit',
        })
      }

      return next
    }

    case 'deposit': {
      if (action.amountKrw <= 0 || !Number.isFinite(action.amountKrw)) return state

      const idx = state.wallets.findIndex((w) => w.id === action.walletId)
      if (idx === -1) return state

      const now = new Date().toISOString()
      const tx: Transaction = {
        id: crypto.randomUUID(),
        at: now,
        rail: action.rail,
        fromWalletId: null,
        toWalletId: action.walletId,
        amountKrw: Math.round(action.amountKrw),
        memo: (action.memo ?? '').trim(),
      }

      const wallets = [...state.wallets]
      const wallet = wallets[idx]
      wallets[idx] = {
        ...wallet,
        balanceKrw: wallet.balanceKrw + tx.amountKrw,
      }

      return {
        ...state,
        wallets,
        transactions: [tx, ...state.transactions],
      }
    }

    case 'transfer': {
      if (action.fromWalletId === action.toWalletId) return state
      if (action.amountKrw <= 0 || !Number.isFinite(action.amountKrw)) return state

      const fromIdx = state.wallets.findIndex((w) => w.id === action.fromWalletId)
      const toIdx = state.wallets.findIndex((w) => w.id === action.toWalletId)
      if (fromIdx === -1 || toIdx === -1) return state

      const amount = Math.round(action.amountKrw)
      const from = state.wallets[fromIdx]
      if (from.balanceKrw < amount) return state

      const now = new Date().toISOString()
      const tx: Transaction = {
        id: crypto.randomUUID(),
        at: now,
        rail: action.rail,
        fromWalletId: action.fromWalletId,
        toWalletId: action.toWalletId,
        amountKrw: amount,
        memo: (action.memo ?? '').trim(),
      }

      const wallets = [...state.wallets]
      wallets[fromIdx] = { ...from, balanceKrw: from.balanceKrw - amount }
      const to = wallets[toIdx]
      wallets[toIdx] = { ...to, balanceKrw: to.balanceKrw + amount }

      return {
        ...state,
        wallets,
        transactions: [tx, ...state.transactions],
      }
    }

    case 'budget_set': {
      const limit = action.dailyLimitKrw
      if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) return state
      return {
        ...state,
        budget: {
          dailyLimitKrw: limit === null ? null : Math.round(limit),
        },
      }
    }

    case 'reset': {
      return defaultLedgerState()
    }

    default: {
      return state
    }
  }
}

export function formatKrw(amountKrw: number): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(amountKrw)
}

export function getSpentTodayKrw(state: LedgerState): number {
  const today = new Date().toDateString()
  let total = 0

  for (const tx of state.transactions) {
    if (!tx.fromWalletId) continue
    if (new Date(tx.at).toDateString() !== today) continue
    total += tx.amountKrw
  }

  return total
}

function isLedgerState(input: unknown): input is LedgerState {
  if (!input || typeof input !== 'object') return false
  const s = input as Record<string, unknown>
  if (s.version !== 1) return false
  if (!Array.isArray(s.wallets) || !Array.isArray(s.transactions)) return false
  if (!s.budget || typeof s.budget !== 'object') return false

  const b = s.budget as Record<string, unknown>
  if (b.dailyLimitKrw !== null && typeof b.dailyLimitKrw !== 'number') return false

  for (const w of s.wallets) {
    if (!w || typeof w !== 'object') return false
    const ww = w as Record<string, unknown>
    if (typeof ww.id !== 'string') return false
    if (typeof ww.label !== 'string') return false
    if (typeof ww.balanceKrw !== 'number') return false
    if (typeof ww.createdAt !== 'string') return false
  }

  for (const t of s.transactions) {
    if (!t || typeof t !== 'object') return false
    const tt = t as Record<string, unknown>
    if (typeof tt.id !== 'string') return false
    if (typeof tt.at !== 'string') return false
    if (typeof tt.rail !== 'string') return false
    if (tt.fromWalletId !== null && typeof tt.fromWalletId !== 'string') return false
    if (tt.toWalletId !== null && typeof tt.toWalletId !== 'string') return false
    if (typeof tt.amountKrw !== 'number') return false
    if (typeof tt.memo !== 'string') return false
  }

  return true
}
