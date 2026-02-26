import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { RoutingStrategy, RouteScenario } from '../routing'
import {
  EXCHANGE_CONFIG, ROTATING_SCENARIOS, INITIAL_SCENARIO,
  ROTATE_INTERVAL_MS, ROTATE_SECONDS,
  defaultAmountForExchange, formatAmountInput, parseAmountStr,
  formatExchange, parseExchange,
  prefetchAllScenarios, prefetchRoute,
} from '../routing'

type SearchPanelProps = {
  onSearch: (scenario: RouteScenario, strategy: RoutingStrategy) => void
  loading: boolean
  onModeChange?: (mode: 'auto' | 'manual') => void
}

export default function SearchPanel({ onSearch, loading, onModeChange }: SearchPanelProps) {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [manualFrom, setManualFrom] = useState('bithumb')
  const [manualTo, setManualTo] = useState('binance')
  const [manualFromCur, setManualFromCur] = useState('KRW')
  const [manualToCur, setManualToCur] = useState('USDC')
  const [manualAmount, setManualAmount] = useState('1,000,000')
  const [manualStrategy, setManualStrategy] = useState<RoutingStrategy>('cheapest')
  const [countdown, setCountdown] = useState(ROTATE_SECONDS)
  const [scenarioIndex, setScenarioIndex] = useState(0)

  const scenarioIndexRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onSearchRef = useRef(onSearch)
  useEffect(() => { onSearchRef.current = onSearch }, [onSearch])

  const toCurrencies = useMemo(() => {
    const cfg = EXCHANGE_CONFIG.find(e => e.value === manualTo)
    return cfg?.currencies ?? ['USDC']
  }, [manualTo])

  const currentScenario = ROTATING_SCENARIOS[scenarioIndex] ?? INITIAL_SCENARIO

  /* ── Auto-rotation ── */
  useEffect(() => {
    if (mode !== 'auto') {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
      return
    }

    // Fire current scenario
    const currentIdx = scenarioIndexRef.current
    onSearchRef.current(ROTATING_SCENARIOS[currentIdx] ?? INITIAL_SCENARIO, 'cheapest')
    setCountdown(ROTATE_SECONDS) // eslint-disable-line react-hooks/set-state-in-effect -- intentional init on mode switch

    // Prefetch ALL other scenarios immediately (concurrency=3)
    prefetchAllScenarios(currentIdx, 'cheapest', 3)

    intervalRef.current = setInterval(() => {
      const next = (scenarioIndexRef.current + 1) % ROTATING_SCENARIOS.length
      scenarioIndexRef.current = next
      setScenarioIndex(next)
      onSearchRef.current(ROTATING_SCENARIOS[next] ?? INITIAL_SCENARIO, 'cheapest')
      setCountdown(ROTATE_SECONDS)
      // Prefetch the one after next (belt and suspenders)
      const afterNext = (next + 1) % ROTATING_SCENARIOS.length
      prefetchRoute(ROTATING_SCENARIOS[afterNext] ?? INITIAL_SCENARIO, 'cheapest')
    }, ROTATE_INTERVAL_MS)

    countdownRef.current = setInterval(() => {
      setCountdown(c => Math.max(0, c - 1))
    }, 1_000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [mode])

  /* ── Handlers ── */
  const handleFromChange = (ex: string) => {
    setManualFrom(ex)
    const cfg = EXCHANGE_CONFIG.find(e => e.value === ex)
    setManualFromCur(cfg?.currencies[0] ?? 'USDC')
    setManualAmount(defaultAmountForExchange(ex))
  }

  const handleToChange = (ex: string) => {
    setManualTo(ex)
    const cfg = EXCHANGE_CONFIG.find(e => e.value === ex)
    setManualToCur(cfg?.currencies[0] ?? 'USDC')
  }

  const handleSwap = () => {
    const nextFrom = manualTo
    const nextTo = manualFrom
    setManualFrom(nextFrom)
    setManualTo(nextTo)
    const fromCfg = EXCHANGE_CONFIG.find(e => e.value === nextFrom)
    const toCfg = EXCHANGE_CONFIG.find(e => e.value === nextTo)
    setManualFromCur(fromCfg?.currencies[0] ?? 'USDC')
    setManualToCur(toCfg?.currencies[0] ?? 'USDC')
    setManualAmount(defaultAmountForExchange(nextFrom))
  }

  const [amountError, setAmountError] = useState<string | null>(null)

  const handleFindRoute = useCallback(() => {
    const amount = parseAmountStr(manualAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setAmountError('Enter a valid amount')
      return
    }
    setAmountError(null)
    onSearch({
      from: `${manualFrom}:${manualFromCur}`,
      to: `${manualTo}:${manualToCur}`,
      amount,
    }, manualStrategy)
  }, [manualFrom, manualFromCur, manualTo, manualToCur, manualAmount, manualStrategy, onSearch])

  const switchMode = (next: 'auto' | 'manual') => {
    if (next === mode) return
    setMode(next)
    onModeChange?.(next)
  }

  const progressPct = ((ROTATE_SECONDS - countdown) / ROTATE_SECONDS) * 100

  /* ── Render ── */
  return (
    <aside className="searchPanel">
      {/* Logo area */}
      <div className="sp-brand">
        <span className="sp-brandMark">⬡</span>
        <div>
          <div className="sp-brandName">CrossFin</div>
          <div className="sp-brandSub">Skyscanner Sandbox</div>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="sp-modeBar">
        <button type="button" className={`sp-modeBtn ${mode === 'auto' ? 'active' : ''}`} onClick={() => switchMode('auto')}>
          <span className="sp-modeIcon">◎</span> Auto
        </button>
        <button type="button" className={`sp-modeBtn ${mode === 'manual' ? 'active' : ''}`} onClick={() => switchMode('manual')}>
          <span className="sp-modeIcon">⌘</span> Manual
        </button>
      </div>

      {mode === 'auto' ? (
        <div className="sp-autoSection">
          {/* Progress bar */}
          <div className="sp-autoProgress">
            <div className="sp-autoProgressFill" style={{ width: `${progressPct}%` }} />
          </div>

          <div className="sp-autoMeta">
            <span className="sp-liveBadge">
              <span className="sp-liveDot" />
              LIVE
            </span>
            <span className="sp-autoTimer">{countdown}s</span>
          </div>

          <div className="sp-autoScenario">
            <div className="sp-autoRoute">
              <div className="sp-autoEndpoint">
                <span className="sp-autoEndpointLabel">From</span>
                <span className="sp-autoEndpointValue">{formatExchange(parseExchange(currentScenario.from))}</span>
                <span className="sp-autoEndpointCur">{currentScenario.from.split(':')[1]}</span>
              </div>
              <div className="sp-autoArrow">→</div>
              <div className="sp-autoEndpoint">
                <span className="sp-autoEndpointLabel">To</span>
                <span className="sp-autoEndpointValue">{formatExchange(parseExchange(currentScenario.to))}</span>
                <span className="sp-autoEndpointCur">{currentScenario.to.split(':')[1]}</span>
              </div>
            </div>
            <div className="sp-autoAmount">
              <span className="sp-autoAmountLabel">Amount</span>
              <span className="sp-autoAmountValue">{currentScenario.amount.toLocaleString()}</span>
            </div>
          </div>

          <div className="sp-autoInfo">
            Cycling {ROTATING_SCENARIOS.length} routes across 13 exchanges × 11 bridge coins
          </div>

          <div className="sp-scenarioList">
            {ROTATING_SCENARIOS.map((s, i) => (
              <div key={`${s.from}-${s.to}`} className={`sp-scenarioItem ${i === scenarioIndex ? 'active' : ''}`}>
                <span className="sp-scenarioIdx">{String(i + 1).padStart(2, '0')}</span>
                <span className="sp-scenarioRoute">
                  {formatExchange(parseExchange(s.from))} → {formatExchange(parseExchange(s.to))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="sp-form">
          {/* From Exchange */}
          <div className="sp-field">
            <label className="sp-label">From Exchange</label>
            <select className="sp-select" value={manualFrom} onChange={e => handleFromChange(e.target.value)}>
              {EXCHANGE_CONFIG.map(ex => (
                <option key={ex.value} value={ex.value}>{ex.label}</option>
              ))}
            </select>
          </div>

          {/* Swap */}
          <div className="sp-swapRow">
            <button type="button" className="sp-swapBtn" onClick={handleSwap} aria-label="Swap exchanges">
              ⇅
            </button>
          </div>

          {/* To Exchange */}
          <div className="sp-field">
            <label className="sp-label">To Exchange</label>
            <div className="sp-fieldRow">
              <select className="sp-select" value={manualTo} onChange={e => handleToChange(e.target.value)}>
                {EXCHANGE_CONFIG.map(ex => (
                  <option key={ex.value} value={ex.value}>{ex.label}</option>
                ))}
              </select>
              {toCurrencies.length > 1 && (
                <select className="sp-selectSmall" value={manualToCur} onChange={e => setManualToCur(e.target.value)}>
                  {toCurrencies.map(cur => (
                    <option key={cur} value={cur}>{cur}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Amount */}
          <div className={`sp-field ${amountError ? 'sp-field-error' : ''}`}>
            <label className="sp-label">Amount</label>
            <div className="sp-inputWrap">
              <input
                className={`sp-input ${amountError ? 'sp-input-error' : ''}`}
                type="text"
                value={manualAmount}
                onChange={e => { setManualAmount(formatAmountInput(e.target.value)); setAmountError(null) }}
                onKeyDown={e => { if (e.key === 'Enter') handleFindRoute() }}
                placeholder={defaultAmountForExchange(manualFrom)}
              />
              <span className="sp-inputTag">{manualFromCur}</span>
            </div>
            {amountError && <span className="sp-fieldError">{amountError}</span>}
          </div>

          {/* Strategy */}
          <div className="sp-field">
            <label className="sp-label">Strategy</label>
            <div className="sp-stratRow">
              {(['cheapest', 'fastest', 'balanced'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  className={`sp-stratBtn ${manualStrategy === s ? 'active' : ''}`}
                  onClick={() => setManualStrategy(s)}
                >
                  <span className="sp-stratIcon">{s === 'cheapest' ? '💲' : s === 'fastest' ? '⚡' : '⚖️'}</span>
                  <span className="sp-stratLabel">{s}</span>
                  <span className="sp-stratSub">
                    {s === 'cheapest' ? 'Lowest total fee' : s === 'fastest' ? 'Fewest hops' : 'Best of both'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button type="button" className="sp-submitBtn" onClick={handleFindRoute} disabled={loading}>
            {loading ? (
              <>
                <span className="sp-spinner" />
                Analyzing…
              </>
            ) : (
              'Find Optimal Route'
            )}
          </button>
        </div>
      )}
    </aside>
  )
}
