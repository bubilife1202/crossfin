import { useEffect, useMemo, useState } from 'react'
import { fetchPremiumPaymentRequired, fetchStats, getApiBaseUrl, type PaymentRequired } from '../lib/api'

type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T }

function formatAddr(addr: string): string {
  const a = addr.trim()
  if (a.length <= 12) return a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function prettyAmountAtomic(amount: string): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return amount
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(6)} USDC` : `${n} (atomic)`
}

export default function LiveSignals() {
  const apiBase = useMemo(() => getApiBaseUrl(), [])
  const [stats, setStats] = useState<LoadState<{ agents: number; wallets: number; transactions: number; blocked: number }>>({
    status: 'idle',
  })
  const [premium, setPremium] = useState<LoadState<PaymentRequired | null>>({ status: 'idle' })

  useEffect(() => {
    const ctrl = new AbortController()

    async function load() {
      setStats({ status: 'loading' })
      setPremium({ status: 'loading' })

      try {
        const s = await fetchStats(ctrl.signal)
        setStats({ status: 'success', data: s })
      } catch (e) {
        setStats({ status: 'error', message: e instanceof Error ? e.message : 'stats_failed' })
      }

      try {
        const pr = await fetchPremiumPaymentRequired(ctrl.signal)
        setPremium({ status: 'success', data: pr })
      } catch (e) {
        setPremium({ status: 'error', message: e instanceof Error ? e.message : 'premium_failed' })
      }
    }

    void load()
    const interval = window.setInterval(() => void load(), 6000)
    return () => {
      ctrl.abort()
      window.clearInterval(interval)
    }
  }, [])

  return (
    <div className="live">
      <div className="liveTop">
        <div className="liveTitle">Live signals</div>
        <div className="liveMeta">API: {apiBase}</div>
      </div>

      <div className="liveGrid">
        <div className="liveCard">
          <div className="liveCardTitle">Public stats</div>
          {stats.status === 'loading' ? <div className="liveMuted">Loading…</div> : null}
          {stats.status === 'error' ? <div className="liveError">{stats.message}</div> : null}
          {stats.status === 'success' ? (
            <div className="liveStats">
              <div className="liveStat">
                <div className="liveK">Agents</div>
                <div className="liveV">{stats.data.agents}</div>
              </div>
              <div className="liveStat">
                <div className="liveK">Wallets</div>
                <div className="liveV">{stats.data.wallets}</div>
              </div>
              <div className="liveStat">
                <div className="liveK">Transactions</div>
                <div className="liveV">{stats.data.transactions}</div>
              </div>
              <div className="liveStat">
                <div className="liveK">Blocked</div>
                <div className="liveV">{stats.data.blocked}</div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="liveCard">
          <div className="liveCardTitle">x402 premium endpoint</div>
          <div className="liveMuted">GET /api/premium/report</div>

          {premium.status === 'loading' ? <div className="liveMuted">Checking paywall…</div> : null}
          {premium.status === 'error' ? <div className="liveError">{premium.message}</div> : null}

          {premium.status === 'success' && premium.data ? (
            <div className="livePaywall">
              <div className="livePaywallRow">
                <div className="liveK">Network</div>
                <div className="liveV">{premium.data.accepts[0]?.network ?? '-'}</div>
              </div>
              <div className="livePaywallRow">
                <div className="liveK">Amount</div>
                <div className="liveV">{prettyAmountAtomic(premium.data.accepts[0]?.amount ?? '-') }</div>
              </div>
              <div className="livePaywallRow">
                <div className="liveK">Pay to</div>
                <div className="liveV">{formatAddr(premium.data.accepts[0]?.payTo ?? '-') }</div>
              </div>
              <div className="liveCmd">
                <div className="liveK">Trigger paid call</div>
                <div className="liveCode">cd apps/api &amp;&amp; npm run x402:wallet</div>
                <div className="liveCode">(Get test USDC on Base Sepolia) https://faucet.circle.com</div>
                <div className="liveCode">EVM_PRIVATE_KEY=&quot;...&quot; npm run x402:paid</div>
              </div>
            </div>
          ) : null}

          {premium.status === 'success' && !premium.data ? (
            <div className="liveMuted">No 402 detected (endpoint may be returning 200 right now).</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
