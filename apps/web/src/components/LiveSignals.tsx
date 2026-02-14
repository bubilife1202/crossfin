import { useEffect, useState, useCallback } from 'react'
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

export default function LiveSignals() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now())

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchArbitrageDemo(signal)
      setState({ status: 'success', data })
      setLastRefresh(Date.now())
    } catch (e) {
      if (signal?.aborted) return
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to fetch data' })
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    const interval = window.setInterval(() => void load(ctrl.signal), 30_000)
    return () => {
      ctrl.abort()
      window.clearInterval(interval)
    }
  }, [load])

  if (state.status === 'loading') {
    return (
      <div className="livePanel">
        <div className="livePanelHeader">
          <div className="livePanelTitle">Live Kimchi Premium</div>
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
          <div className="livePanelTitle">Live Kimchi Premium</div>
        </div>
        <div className="liveError">{state.message}</div>
        <button className="liveRetry" onClick={() => { setState({ status: 'loading' }); void load() }}>
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
        <div className="livePanelTitle">Live Kimchi Premium</div>
        <div className="livePulse">
          <span className="pulseOrb" />
          Updated {formatTime(data.at)}
        </div>
      </div>

      <div className="liveAvg">
        <div className="liveAvgLabel">Average Premium</div>
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
