import { useEffect, useMemo, useReducer, useState, type FormEvent } from 'react'
import {
  defaultLedgerState,
  formatKrw,
  getSpentTodayKrw,
  ledgerReducer,
  loadLedgerState,
  resetLedgerStorage,
  saveLedgerState,
  type Rail,
} from '../lib/ledger'

const RAIL_LABEL: Record<Rail, string> = {
  manual: 'Manual',
  kakaopay: 'KakaoPay',
  toss: 'Toss',
  stripe: 'Stripe',
  x402: 'x402',
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  if (n <= 0) return null
  return Math.round(n)
}

function formatWalletId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`
}

export default function LedgerDemo() {
  const [state, dispatch] = useReducer(ledgerReducer, undefined, () => {
    try {
      return loadLedgerState()
    } catch {
      return defaultLedgerState()
    }
  })

  const [createLabel, setCreateLabel] = useState('')
  const [createDeposit, setCreateDeposit] = useState('')
  const [depositWalletId, setDepositWalletId] = useState<string>('')
  const [depositAmount, setDepositAmount] = useState('')
  const [transferFromId, setTransferFromId] = useState<string>('')
  const [transferToId, setTransferToId] = useState<string>('')
  const [transferAmount, setTransferAmount] = useState('')
  const [rail, setRail] = useState<Rail>('kakaopay')
  const [depositMemo, setDepositMemo] = useState('')
  const [transferMemo, setTransferMemo] = useState('')
  const [budgetLimit, setBudgetLimit] = useState<string>('')

  const [error, setError] = useState<string | null>(null)

  const spentTodayKrw = useMemo(() => getSpentTodayKrw(state), [state])
  const budget = state.budget.dailyLimitKrw
  const budgetPct = useMemo(() => {
    if (!budget) return 0
    return Math.min(1, spentTodayKrw / budget)
  }, [budget, spentTodayKrw])

  const depositWalletIdEffective = useMemo(() => {
    if (depositWalletId && state.wallets.some((w) => w.id === depositWalletId)) return depositWalletId
    return state.wallets[0]?.id ?? ''
  }, [depositWalletId, state.wallets])

  const transferFromIdEffective = useMemo(() => {
    if (transferFromId && state.wallets.some((w) => w.id === transferFromId)) return transferFromId
    return state.wallets[0]?.id ?? ''
  }, [transferFromId, state.wallets])

  const transferToIdEffective = useMemo(() => {
    if (
      transferToId &&
      transferToId !== transferFromIdEffective &&
      state.wallets.some((w) => w.id === transferToId)
    ) {
      return transferToId
    }
    return state.wallets.find((w) => w.id !== transferFromIdEffective)?.id ?? ''
  }, [state.wallets, transferFromIdEffective, transferToId])

  useEffect(() => {
    saveLedgerState(state)
  }, [state])

  function resetErrors() {
    setError(null)
  }

  function onCreateWallet(e: FormEvent) {
    e.preventDefault()
    resetErrors()

    const label = createLabel.trim()
    if (!label) {
      setError('Wallet label is required.')
      return
    }

    const initialDepositKrw = createDeposit.trim() ? parsePositiveInt(createDeposit) : 0
    if (createDeposit.trim() && initialDepositKrw === null) {
      setError('Initial deposit must be a positive number.')
      return
    }

    dispatch({
      type: 'wallet_create',
      label,
      initialDepositKrw: initialDepositKrw ?? undefined,
    })

    setCreateLabel('')
    setCreateDeposit('')
  }

  function onDeposit(e: FormEvent) {
    e.preventDefault()
    resetErrors()
    if (!depositWalletIdEffective) {
      setError('Select a wallet to deposit into.')
      return
    }

    const amountKrw = parsePositiveInt(depositAmount)
    if (amountKrw === null) {
      setError('Deposit amount must be a positive number.')
      return
    }

    dispatch({
      type: 'deposit',
      walletId: depositWalletIdEffective,
      amountKrw,
      rail,
      memo: depositMemo.trim() ? depositMemo : undefined,
    })

    setDepositAmount('')
    setDepositMemo('')
  }

  function onTransfer(e: FormEvent) {
    e.preventDefault()
    resetErrors()

    if (!transferFromIdEffective || !transferToIdEffective) {
      setError('Select both a sender and a receiver wallet.')
      return
    }
    if (transferFromIdEffective === transferToIdEffective) {
      setError('Sender and receiver must be different wallets.')
      return
    }

    const amountKrw = parsePositiveInt(transferAmount)
    if (amountKrw === null) {
      setError('Transfer amount must be a positive number.')
      return
    }

    const from = state.wallets.find((w) => w.id === transferFromIdEffective)
    if (!from) {
      setError('Sender wallet not found.')
      return
    }
    if (from.balanceKrw < amountKrw) {
      setError('Insufficient balance.')
      return
    }

    dispatch({
      type: 'transfer',
      fromWalletId: transferFromIdEffective,
      toWalletId: transferToIdEffective,
      amountKrw,
      rail,
      memo: transferMemo.trim() ? transferMemo : undefined,
    })

    setTransferAmount('')
    setTransferMemo('')
  }

  function onSetBudget(e: FormEvent) {
    e.preventDefault()
    resetErrors()
    const raw = budgetLimit.trim()

    if (!raw) {
      dispatch({ type: 'budget_set', dailyLimitKrw: null })
      return
    }

    const limit = parsePositiveInt(raw)
    if (limit === null) {
      setError('Daily budget must be a positive number.')
      return
    }

    dispatch({ type: 'budget_set', dailyLimitKrw: limit })
  }

  function onReset() {
    resetErrors()
    const ok = window.confirm('Reset local demo data? This cannot be undone.')
    if (!ok) return
    resetLedgerStorage()
    dispatch({ type: 'reset' })
    setBudgetLimit('')
    setDepositMemo('')
    setTransferMemo('')
    setDepositAmount('')
    setTransferAmount('')
    setCreateDeposit('')
    setCreateLabel('')
  }

  function onExport() {
    resetErrors()
    const payload = JSON.stringify(state, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `crossfin-ledger-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="demo">
      <div className="demoTop">
        <div className="budget">
          <div className="budgetHeader">
            <div className="budgetTitle">Daily budget</div>
            <div className="budgetMeta">
              {budget ? `${formatKrw(spentTodayKrw)} / ${formatKrw(budget)}` : 'Not set'}
            </div>
          </div>
          <div className="budgetBar" aria-hidden>
            <div
              className={`budgetFill ${budget && spentTodayKrw > budget ? 'over' : ''}`}
              style={{ width: `${Math.round(budgetPct * 100)}%` }}
            />
          </div>
        </div>

        <div className="demoActions">
          <button className="miniButton" type="button" onClick={onExport}>
            Export JSON
          </button>
          <button className="miniButton danger" type="button" onClick={onReset}>
            Reset
          </button>
        </div>
      </div>

      {error ? <div className="demoError">{error}</div> : null}

      <div className="demoGrid">
        <section className="panel">
          <div className="panelTitle">Wallets</div>
          <form className="form" onSubmit={onCreateWallet}>
            <label className="field">
              <span className="fieldLabel">New wallet label</span>
              <input
                value={createLabel}
                onChange={(e) => setCreateLabel(e.target.value)}
                placeholder="e.g., Agent A"
              />
            </label>
            <label className="field">
              <span className="fieldLabel">Initial deposit (KRW)</span>
              <input
                inputMode="numeric"
                value={createDeposit}
                onChange={(e) => setCreateDeposit(e.target.value)}
                placeholder="e.g., 500000"
              />
            </label>
            <button className="miniButton primary" type="submit">
              Create wallet
            </button>
          </form>

          <div className="walletList">
            {state.wallets.length === 0 ? (
              <div className="empty">No wallets yet.</div>
            ) : (
              state.wallets.map((w) => (
                <div key={w.id} className="walletRow">
                  <div className="walletMain">
                    <div className="walletLabel">{w.label}</div>
                    <div className="walletId">{formatWalletId(w.id)}</div>
                  </div>
                  <div className="walletBal">{formatKrw(w.balanceKrw)}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panelTitle">Actions</div>

          <div className="seg">
            <div className="segTitle">Rail</div>
            <div className="segBody">
              <select value={rail} onChange={(e) => setRail(e.target.value as Rail)}>
                {Object.entries(RAIL_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <form className="form" onSubmit={onDeposit}>
            <div className="formTitle">Deposit</div>
            <label className="field">
              <span className="fieldLabel">Wallet</span>
              <select
                value={depositWalletIdEffective}
                onChange={(e) => setDepositWalletId(e.target.value)}
              >
                <option value="" disabled>
                  Select…
                </option>
                {state.wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="fieldLabel">Amount (KRW)</span>
              <input
                inputMode="numeric"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="e.g., 120000"
              />
            </label>
            <label className="field">
              <span className="fieldLabel">Memo (optional)</span>
              <input
                value={depositMemo}
                onChange={(e) => setDepositMemo(e.target.value)}
                placeholder="e.g., Client payment"
              />
            </label>
            <button className="miniButton" type="submit">
              Deposit
            </button>
          </form>

          <form className="form" onSubmit={onTransfer}>
            <div className="formTitle">Transfer</div>
            <label className="field">
              <span className="fieldLabel">From</span>
              <select
                value={transferFromIdEffective}
                onChange={(e) => setTransferFromId(e.target.value)}
              >
                <option value="" disabled>
                  Select…
                </option>
                {state.wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="fieldLabel">To</span>
              <select value={transferToIdEffective} onChange={(e) => setTransferToId(e.target.value)}>
                <option value="" disabled>
                  Select…
                </option>
                {state.wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="fieldLabel">Amount (KRW)</span>
              <input
                inputMode="numeric"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                placeholder="e.g., 34000"
              />
            </label>
            <label className="field">
              <span className="fieldLabel">Memo (optional)</span>
              <input
                value={transferMemo}
                onChange={(e) => setTransferMemo(e.target.value)}
                placeholder="e.g., API costs"
              />
            </label>
            <button className="miniButton" type="submit">
              Transfer
            </button>
          </form>

          <form className="form" onSubmit={onSetBudget}>
            <div className="formTitle">Budget</div>
            <label className="field">
              <span className="fieldLabel">Daily limit (KRW)</span>
              <input
                inputMode="numeric"
                value={budgetLimit}
                onChange={(e) => setBudgetLimit(e.target.value)}
                placeholder={budget ? String(budget) : 'e.g., 200000'}
              />
            </label>
            <button className="miniButton" type="submit">
              Set budget
            </button>
          </form>
        </section>

        <section className="panel txPanel">
          <div className="panelTitle">Transactions</div>
          <div className="txTable">
            <div className="txHead">
              <div>Time</div>
              <div>Rail</div>
              <div>Flow</div>
              <div className="txAmt">Amount</div>
              <div>Memo</div>
            </div>
            {state.transactions.length === 0 ? (
              <div className="empty">No transactions yet.</div>
            ) : (
              state.transactions.map((tx) => {
                const from = tx.fromWalletId
                  ? state.wallets.find((w) => w.id === tx.fromWalletId)?.label ?? 'Unknown'
                  : 'External'
                const to = tx.toWalletId
                  ? state.wallets.find((w) => w.id === tx.toWalletId)?.label ?? 'Unknown'
                  : 'External'

                return (
                  <div key={tx.id} className="txRow">
                    <div className="txTime">{new Date(tx.at).toLocaleTimeString('ko-KR')}</div>
                    <div className="txRail">{RAIL_LABEL[tx.rail]}</div>
                    <div className="txFlow">
                      {from} → {to}
                    </div>
                    <div className="txAmt">{formatKrw(tx.amountKrw)}</div>
                    <div className="txMemo">{tx.memo}</div>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
