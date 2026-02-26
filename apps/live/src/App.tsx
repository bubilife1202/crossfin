import { useState, useCallback, useRef } from 'react'
import './App.css'
import SearchPanel from './components/SearchPanel'
import ResultsSandbox from './components/ResultsSandbox'
import type { RoutingResponse, RoutingStrategy, RouteScenario } from './routing'
import { getCachedRoute, fetchRoute } from './routing'

export default function App() {
  const [data, setData] = useState<RoutingResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(true)
  const [autoMode, setAutoMode] = useState(true)
  const requestSeqRef = useRef(0)
  const lastSearchRef = useRef<{ scenario: RouteScenario; strategy: RoutingStrategy } | null>(null)

  const handleSearch = useCallback(async (scenario: RouteScenario, strategy: RoutingStrategy) => {
    const seq = ++requestSeqRef.current
    lastSearchRef.current = { scenario, strategy }

    const amount = Number(scenario.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive number')
      return
    }

    // ── Cache-first: show cached data instantly ──
    const cached = getCachedRoute(scenario, strategy)
    if (cached) {
      setData(cached.data)
      setError(null)
      setConnected(true)
      // If cache is fresh enough, skip network entirely
      if (cached.fresh) {
        setLoading(false)
        return
      }
      // Stale cache: show it but refresh in background (no loading spinner)
    } else {
      // No cache at all: show loading spinner
      setLoading(true)
    }
    setError(null)

    // ── Background fetch (SWR refresh or cold fetch) ──
    try {
      const json = await fetchRoute(scenario, strategy)
      if (seq !== requestSeqRef.current) return
      setData(json)
      setError(null)
      setConnected(true)
    } catch (e) {
      if (seq !== requestSeqRef.current) return
      // If we already showed cached data, don't show error
      if (!cached) {
        setError(e instanceof Error ? e.message : 'Failed to fetch route data')
        setConnected(false)
      }
    } finally {
      if (seq === requestSeqRef.current) setLoading(false)
    }
  }, [])

  return (
    <div className="sandbox">
      {/* Header */}
      <header className="sandboxHeader">
        <div className="sandboxHeaderLeft">
          <a href="https://crossfin.dev" className="sandboxLogoLink" target="_blank" rel="noopener noreferrer">
            <span className="sandboxLogo">⬡</span>
            <span className="sandboxLogoText">CrossFin</span>
          </a>
          <span className="sandboxDivider" />
          <span className="sandboxLabel">Skyscanner Sandbox</span>
        </div>
        <div className="sandboxHeaderRight">
          <span className={`sandboxStatus ${connected ? 'online' : 'offline'}`}>
            <span className="sandboxDot" />
            {connected ? 'Connected' : 'Offline'}
          </span>
        </div>
      </header>

      {/* Body */}
      <div className="sandboxBody">
        <SearchPanel onSearch={handleSearch} loading={loading} onModeChange={(m) => setAutoMode(m === 'auto')} />
        <ResultsSandbox data={data} loading={loading} error={error} autoMode={autoMode} onRetry={() => { if (lastSearchRef.current) handleSearch(lastSearchRef.current.scenario, lastSearchRef.current.strategy) }} />
      </div>
    </div>
  )
}
