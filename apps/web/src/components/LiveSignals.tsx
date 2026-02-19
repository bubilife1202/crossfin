import { useEffect, useState } from 'react'
import { fetchArbitrageDemo, type ArbitrageDemoResponse } from '../lib/api'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: ArbitrageDemoResponse }

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

async function doLoad(signal: AbortSignal): Promise<LoadState> {
  try {
    const data = await fetchArbitrageDemo(signal)
    return { status: 'success', data }
  } catch (e) {
    if (signal.aborted) return { status: 'loading' }
    return { status: 'error', message: e instanceof Error ? e.message : 'Failed to fetch data' }
  }
}

export default function LiveSignals() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [lastRefresh, setLastRefresh] = useState<number>(0)

  useEffect(() => {
    const ctrl = new AbortController()
    let mounted = true
    const run = async () => {
      const result = await doLoad(ctrl.signal)
      if (mounted && !ctrl.signal.aborted) {
        setState(result)
        if (result.status === 'success') setLastRefresh(Date.now())
      }
    }
    void run()
    const interval = window.setInterval(() => void run(), 30_000)
    return () => {
      mounted = false
      ctrl.abort()
      window.clearInterval(interval)
    }
  }, [])

  if (state.status === 'loading') {
    return (
      <div className="livePanel">
        <div className="livePanelHeader">
          <div className="livePanelTitle">Live Route Spread</div>
          <div className="livePulse">
            <span className="pulseOrb" />
            Loading...
          </div>
        </div>
        <div className="liveLoading">
          <div className="liveLoadingBar" />
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="livePanel">
        <div className="livePanelHeader">
          <div className="livePanelTitle">Live Route Spread</div>
        </div>
        <div className="liveError">{state.message}</div>
        <button type="button" className="liveRetry" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    )
  }

  const { data } = state
  const avgPositive = data.avgPremiumPct >= 0

  return (
    <div className="livePanel">
      <div className="livePanelHeader">
        <div className="livePanelTitle">Live Route Spread</div>
        <div className="livePulse">
          <span className="pulseOrb" />
          Updated {formatTime(data.at)}
        </div>
      </div>

      <div className="liveAvg">
        <div className="liveAvgLabel">Average Spread</div>
        <div className={`liveAvgValue ${avgPositive ? 'positive' : 'negative'}`}>
          {avgPositive ? '+' : ''}{data.avgPremiumPct.toFixed(2)}%
        </div>
        <div className="liveAvgMeta">
          Across {data.totalPairsAvailable} trading pairs
        </div>
      </div>

      <div className="livePairsGrid">
        {data.preview.map((pair) => {
          const positive = pair.premiumPct >= 0
          return (
            <div key={pair.coin} className="livePairCard">
              <div className="livePairTop">
                <div className="livePairCoin">{pair.coin}</div>
                <div className={`livePairPct ${positive ? 'positive' : 'negative'}`}>
                  {positive ? '+' : ''}{pair.premiumPct.toFixed(2)}%
                </div>
              </div>
              <div className="livePairDirection">{pair.direction}</div>
              <div className="livePairBar">
                <div
                  className={`livePairBarFill ${positive ? 'positive' : 'negative'}`}
                  style={{ width: `${Math.min(Math.abs(pair.premiumPct) * 15, 100)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="liveFootnote">
        Free preview — {data.pairsShown} of {data.totalPairsAvailable}+ pairs shown. Full data via x402 payment.
      </div>

      <div className="liveRefreshMeta" key={lastRefresh}>
        Auto-refreshes every 30s
      </div>
    </div>
  )
}
