import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type RoutingStrategy = 'cheapest' | 'fastest' | 'balanced'

type RouteStep = {
  type: 'buy' | 'sell' | 'transfer'
  from: { exchange: string; currency: string }
  to: { exchange: string; currency: string }
  estimatedCost: {
    feePct: number
    feeAbsolute: number
    slippagePct: number
    timeMinutes: number
  }
  amountIn: number
  amountOut: number
}

type Route = {
  bridgeCoin: string
  steps: RouteStep[]
  totalCostPct: number
  totalTimeMinutes: number
  estimatedInput: number
  estimatedOutput: number
  action: 'EXECUTE' | 'WAIT' | 'SKIP'
  confidence: number
  reason: string
}

type RouteMeta = {
  routesEvaluated: number
  bridgeCoinsTotal: number
  evaluatedCoins?: string[]
  skippedCoins?: string[]
  priceAge?: {
    globalPrices?: { ageMs: number; source: string; cacheTtlMs: number }
    koreanPrices?: { source: string }
  }
  feesSource?: 'd1' | 'hardcoded-fallback'
  dataFreshness?: 'live' | 'cached' | 'stale'
}

type RoutingResponse = {
  request: {
    from: string
    to: string
    amount: number
    strategy: RoutingStrategy
  }
  optimal: Route | null
  alternatives: Route[]
  meta: RouteMeta
  fees: {
    trading: Record<string, number>
    withdrawal: Record<string, Record<string, number>>
  }
  at: string
}

type GraphNode = {
  id: string
  label: string
  x: number
  y: number
  type: 'source' | 'coin' | 'dest'
}

type GraphEdge = {
  from: string
  to: string
  cost: number
  isOptimal: boolean
}

type RouteScenario = {
  from: string
  to: string
  amount: number
}

const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || 'https://crossfin.dev').replace(/\/$/, '')
const ROTATE_INTERVAL_MS = 10_000
const ROTATE_SECONDS = ROTATE_INTERVAL_MS / 1000
const GRAPH_WIDTH = 760
const GRAPH_HEIGHT = 320
const SOURCE_X = 118
const COIN_X = 380
const DEST_X = 642

const EXCHANGE_LABELS: Record<string, string> = {
  bithumb: 'Bithumb',
  upbit: 'Upbit',
  coinone: 'Coinone',
  gopax: 'GoPax',
  bitflyer: 'bitFlyer',
  wazirx: 'WazirX',
  binance: 'Binance',
  okx: 'OKX',
  bybit: 'Bybit',
}

const ROTATING_SCENARIOS: readonly RouteScenario[] = [
  { from: 'bithumb:KRW', to: 'binance:USDC', amount: 1_000_000 },
  { from: 'upbit:KRW', to: 'okx:USDC', amount: 1_000_000 },
  { from: 'coinone:KRW', to: 'bybit:USDC', amount: 1_000_000 },
  { from: 'bitflyer:JPY', to: 'binance:USDC', amount: 100_000 },
  { from: 'wazirx:INR', to: 'okx:USDC', amount: 100_000 },
  { from: 'binance:USDC', to: 'bithumb:KRW', amount: 1_000 },
  { from: 'bybit:USDC', to: 'upbit:KRW', amount: 1_000 },
  { from: 'okx:USDC', to: 'wazirx:INR', amount: 1_000 },
] as const

const INITIAL_SCENARIO: RouteScenario = ROTATING_SCENARIOS[0] ?? { from: 'bithumb:KRW', to: 'binance:USDC', amount: 1_000_000 }

function formatExchange(exchange: string): string {
  const key = exchange.trim().toLowerCase()
  return EXCHANGE_LABELS[key] ?? exchange.trim()
}

function sumStepFees(steps: RouteStep[], type: RouteStep['type']): number {
  return steps.filter((s) => s.type === type).reduce((sum, s) => sum + (Number.isFinite(s.estimatedCost.feeAbsolute) ? s.estimatedCost.feeAbsolute : 0), 0)
}

function parseExchange(endpoint: string): string {
  const [exchange] = endpoint.split(':')
  return (exchange ?? '').toLowerCase()
}

function formatTradingFeePercent(fee: number): string {
  if (!Number.isFinite(fee)) return 'N/A'
  return `${fee.toFixed(2)}%`
}

function formatWithdrawalFee(value: number | undefined, coin: string | null): string {
  if (!coin || !Number.isFinite(value)) return 'N/A'
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${coin}`
}

/* ── SVG layout helpers ──────────────────────────── */

const NW: Record<GraphNode['type'], number> = { source: 112, coin: 74, dest: 112 }
const NH: Record<GraphNode['type'], number> = { source: 40, coin: 28, dest: 40 }

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cp = (x2 - x1) * 0.4
  return `M${x1},${y1} C${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`
}

/* ── Scoped CSS ──────────────────────────────────── */

const CSS = `
@keyframes rgFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes rgDash{to{stroke-dashoffset:-24}}
@keyframes rgPulse{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes rgDraw{from{stroke-dashoffset:400}to{stroke-dashoffset:0}}
@keyframes rgGlowIn{from{opacity:0}to{opacity:1}}

.rg-wrap{animation:rgFadeIn .45s ease both}

.rg-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border);gap:12px}
.rg-title{margin:0;font-size:1.05rem;font-weight:700;letter-spacing:-.01em;color:var(--ink)}
.rg-sub{margin:3px 0 0;font-size:.86rem;color:var(--muted);font-weight:500;line-height:1.45}
.rg-badge{display:inline-flex;align-items:center;gap:6px;font-size:.78rem;font-weight:600;color:var(--green);padding:4px 11px;border-radius:999px;border:1px solid rgba(0,255,136,.15);background:rgba(0,255,136,.04)}
.rg-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px rgba(0,255,136,.5);animation:rgPulse 2s ease-in-out infinite}

.rg-controls{display:flex;flex-direction:column;gap:10px;margin-bottom:16px}
.rg-row{display:flex;align-items:center;gap:8px}

.rg-sel,.rg-inp{background:var(--bg2);border:1px solid var(--border);border-radius:8px;color:var(--ink);font-family:var(--sans);font-size:.92rem;padding:10px 12px;outline:none;transition:border-color .2s,box-shadow .2s;flex:1;min-width:0}
.rg-sel:hover,.rg-inp:hover{border-color:var(--border-hover)}
.rg-sel:focus,.rg-inp:focus{border-color:var(--cyan);box-shadow:0 0 0 2px rgba(0,212,255,.08)}
.rg-sel option{background:var(--bg2);color:var(--ink)}

.rg-swap{display:flex;align-items:center;justify-content:center;width:40px;height:40px;flex-shrink:0;border-radius:8px;border:1px solid var(--border);background:var(--bg2);color:var(--muted);cursor:pointer;transition:all .2s}
.rg-swap:hover{border-color:var(--cyan);color:var(--cyan);background:rgba(0,212,255,.06)}

.rg-strats{display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;flex-shrink:0}
.rg-sb{padding:9px 14px;font-size:.82rem;font-weight:600;font-family:var(--sans);border:none;background:var(--bg2);color:var(--muted);cursor:pointer;transition:all .2s;border-right:1px solid var(--border);white-space:nowrap;text-transform:capitalize}
.rg-sb:last-child{border-right:none}
.rg-sb:hover{color:var(--ink);background:var(--card-hover)}
.rg-sb.on{background:var(--cyan-dim);color:var(--cyan)}

.rg-go{padding:10px 18px;font-size:.9rem;font-weight:700;font-family:var(--sans);border:none;border-radius:8px;background:var(--cyan);color:var(--bg);cursor:pointer;transition:all .2s;white-space:nowrap;flex-shrink:0}
.rg-go:hover{box-shadow:0 0 20px rgba(0,212,255,.3)}
.rg-go:disabled{opacity:.5;cursor:not-allowed}

.rg-err{margin-bottom:12px;padding:10px 14px;background:var(--red-dim);border:1px solid rgba(255,68,102,.2);color:var(--red);border-radius:8px;font-size:.88rem;font-weight:500}

.rg-gw{margin:0 auto 14px;max-width:980px;border-radius:10px;overflow:hidden;border:1px solid var(--border);background:var(--bg);transition:opacity .2s;width:100%}
.rg-svg{display:block;width:100%;height:auto}
.rg-svg text{font-family:var(--sans)}

.rg-dash{animation:rgDash 1s linear infinite}
.rg-draw{stroke-dasharray:400;animation:rgDraw .45s ease-out forwards}
.rg-draw2{stroke-dasharray:400;stroke-dashoffset:400;animation:rgDraw .45s ease-out .16s forwards}
.rg-glow-in{animation:rgGlowIn .18s ease-out forwards}
.rg-glow-in2{animation:rgGlowIn .18s ease-out .14s forwards;opacity:0}
.rg-label-in{animation:rgGlowIn .2s ease-out .12s forwards;opacity:0}
.rg-label-in2{animation:rgGlowIn .2s ease-out .26s forwards;opacity:0}

.rg-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px}
.rg-card{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:16px;transition:border-color .2s}
.rg-card:hover{border-color:var(--border-hover)}
.rg-lbl{font-size:.76rem;font-weight:650;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:10px}
.rg-full{grid-column:1/-1}

.rg-at{width:100%;border-collapse:collapse}
.rg-at th{text-align:left;padding:6px 10px;font-size:.74rem;font-weight:650;text-transform:uppercase;letter-spacing:.04em;color:var(--muted2);border-bottom:1px solid var(--border)}
.rg-at td{padding:8px 10px;font-size:.9rem;border-bottom:1px solid rgba(255,255,255,.03);color:var(--muted)}
.rg-at tbody tr:hover{background:rgba(255,255,255,.02)}
.rg-action-guide{margin-top:10px;color:var(--muted);font-size:.82rem;line-height:1.5}
.rg-action-guide b{color:var(--ink)}

.rg-foot{margin-top:8px;font-size:.78rem;color:var(--muted2);text-align:right;font-family:var(--mono)}

@media(max-width:980px){
  .rg-grid{grid-template-columns:1fr}
}

@media(max-width:640px){
  .rg-header{align-items:flex-start}
  .rg-title{font-size:.96rem}
  .rg-sub{font-size:.8rem}
  .rg-row{flex-wrap:wrap}
  .rg-sel,.rg-inp{flex:1 1 100%}
  .rg-grid{grid-template-columns:1fr}
  .rg-strats{flex:1 1 100%}
  .rg-strats .rg-sb{flex:1}
  .rg-gw{max-width:100%;margin:0 0 12px}
  .rg-foot{text-align:left}
}
`

/* ── Component ───────────────────────────────────── */

export default function RouteGraph() {
  const strategy: RoutingStrategy = 'cheapest'
  const scenarioIndexRef = useRef<number>(0)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<RoutingResponse | null>(null)
  const [dataVersion, setDataVersion] = useState<number>(0)
  const [countdown, setCountdown] = useState<number>(ROTATE_SECONDS)
  const [isRotating, setIsRotating] = useState<boolean>(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const requestSeqRef = useRef<number>(0)

  const loadRoute = useCallback(async (scenario: RouteScenario) => {
    const requestSeq = ++requestSeqRef.current
    setLoading(true)
    setIsRotating(true)
    setError(null)

    const amount = Number(scenario.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive number')
      setLoading(false)
      setIsRotating(false)
      return
    }

    try {
      const params = new URLSearchParams({ from: scenario.from, to: scenario.to, amount: String(amount), strategy })
      const res = await fetch(`${API_BASE}/api/routing/optimal?${params.toString()}`)
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`routing_fetch_failed:${res.status} ${text.slice(0, 120)}`)
      }
      const json = await res.json() as RoutingResponse
      if (requestSeq !== requestSeqRef.current) return
      setData(json)
      setDataVersion((v) => v + 1)
    } catch (e) {
      if (requestSeq !== requestSeqRef.current) return
      setError(e instanceof Error ? e.message : 'Failed to fetch route data')
      setData(null)
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false)
        setIsRotating(false)
      }
    }
  }, [])

  /* ── auto-refresh every 10s ────────────────────── */
  useEffect(() => {
    void loadRoute(INITIAL_SCENARIO)
    setCountdown(ROTATE_SECONDS)

    if (intervalRef.current) clearInterval(intervalRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    scenarioIndexRef.current = 0

    intervalRef.current = setInterval(() => {
      const next = (scenarioIndexRef.current + 1) % ROTATING_SCENARIOS.length
      scenarioIndexRef.current = next
      void loadRoute(ROTATING_SCENARIOS[next] ?? INITIAL_SCENARIO)
      setCountdown(ROTATE_SECONDS)
    }, ROTATE_INTERVAL_MS)

    countdownRef.current = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1))
    }, 1_000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [loadRoute])

  /* ── build graph model ─────────────────────────── */

  const graph = useMemo(() => {
    const requestFrom = data?.request.from ?? INITIAL_SCENARIO.from
    const requestTo = data?.request.to ?? INITIAL_SCENARIO.to
    const fromEx = parseExchange(requestFrom)
    const toEx = parseExchange(requestTo)

    // Keep the graph readable: render optimal + top alternatives only.
    const routePool = [data?.optimal, ...(data?.alternatives ?? [])]
      .filter((r): r is Route => Boolean(r))
      .slice(0, 6)
    const coins = Array.from(new Set(routePool.map((r) => r.bridgeCoin.toUpperCase())))
    if (coins.length === 0) coins.push('N/A')

    const coinCount = Math.max(1, coins.length)
    const usableH = GRAPH_HEIGHT - 84
    const gap = coinCount <= 1 ? 0 : Math.min(34, usableH / (coinCount - 1))
    const totalH = (coinCount - 1) * gap
    const midY = GRAPH_HEIGHT / 2
    const startY = midY - totalH / 2

    const nodes: GraphNode[] = [
      { id: fromEx, label: formatExchange(fromEx), x: SOURCE_X, y: midY, type: 'source' },
      ...coins.map((coin, idx) => ({
        id: coin,
        label: coin,
        x: COIN_X,
        y: startY + idx * gap,
        type: 'coin' as const,
      })),
      { id: toEx, label: formatExchange(toEx), x: DEST_X, y: midY, type: 'dest' },
    ]

    const byKey = new Map<string, GraphEdge>()

    routePool.forEach((route, idx) => {
      const isOptimal = idx === 0 && Boolean(data?.optimal)
      const coin = route.bridgeCoin.toUpperCase()
      const buyFee = sumStepFees(route.steps, 'buy')
      const transferAndSell = sumStepFees(route.steps, 'transfer') + sumStepFees(route.steps, 'sell')

      const edgeA: GraphEdge = { from: fromEx, to: coin, cost: buyFee, isOptimal }
      const edgeB: GraphEdge = { from: coin, to: toEx, cost: transferAndSell, isOptimal }

      ;[edgeA, edgeB].forEach((edge) => {
        const key = `${edge.from}->${edge.to}`
        const prev = byKey.get(key)
        if (!prev) {
          byKey.set(key, edge)
          return
        }
        if (!prev.isOptimal && edge.isOptimal) {
          byKey.set(key, edge)
          return
        }
        if (prev.isOptimal === edge.isOptimal && edge.cost < prev.cost) {
          byKey.set(key, edge)
        }
      })
    })

    return { nodes, edges: Array.from(byKey.values()), fromEx, toEx }
  }, [data])

  /* ── derived values ────────────────────────────── */

  const optimal = data?.optimal ?? null
  const alternatives = data?.alternatives ?? []
  const tradingFees = data?.fees.trading ?? {}
  const optimalCoin = optimal?.bridgeCoin?.toUpperCase() ?? null
  const withdrawalByExchange = data?.fees.withdrawal ?? {}
  const requestFrom = data?.request.from ?? INITIAL_SCENARIO.from
  const requestTo = data?.request.to ?? INITIAL_SCENARIO.to
  const fromCurrency = requestFrom.split(':')[1] ?? ''
  const toCurrency = requestTo.split(':')[1] ?? ''

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))



  /* ── render helpers ────────────────────────────── */

  const isFirstLeg = (edge: GraphEdge) => {
    const n1 = nodeById.get(edge.from)
    return n1?.type === 'source'
  }

  const renderEdge = (edge: GraphEdge, idx: number) => {
    const n1 = nodeById.get(edge.from)
    const n2 = nodeById.get(edge.to)
    if (!n1 || !n2) return null
    const x1 = n1.x + NW[n1.type] / 2
    const y1 = n1.y
    const x2 = n2.x - NW[n2.type] / 2
    const y2 = n2.y
    const d = bezierPath(x1, y1, x2, y2)
    if (edge.isOptimal) {
      const first = isFirstLeg(edge)
      const drawClass = first ? 'rg-draw' : 'rg-draw2'
      const glowClass = first ? 'rg-glow-in' : 'rg-glow-in2'

      return (
        <g key={`oe-${idx}-${dataVersion}`}>
          <path d={d} fill="none" stroke="#00ff88" strokeWidth={3} opacity={0.06} className={glowClass} />
          <path d={d} fill="none" stroke="url(#rgGrad)" strokeWidth={1.7} strokeLinecap="round" className={drawClass} />
          <path d={d} fill="none" stroke="rgba(0,255,136,0.35)" strokeWidth={1} strokeLinecap="round" strokeDasharray="4 10"
            style={{ animationDelay: first ? '0.25s' : '0.45s', opacity: 0, animationFillMode: 'forwards', animationName: 'rgDash', animationDuration: '1.1s', animationIterationCount: 'infinite' }} />
        </g>
      )
    }
    return (
      <g key={`de-${idx}`}>
        <path d={d} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={0.7} strokeDasharray="3 5" />
      </g>
    )
  }

  const renderNode = (node: GraphNode) => {
    const w = NW[node.type]
    const h = NH[node.type]
    const isOnPath = node.id === graph.fromEx || node.id === graph.toEx || optimalCoin === node.id

    let fill: string, stroke: string, txt: string, glow: string | undefined
    if (node.type === 'source') {
      fill = 'rgba(0,212,255,0.06)'; stroke = isOnPath ? 'rgba(0,212,255,0.5)' : 'rgba(255,255,255,0.08)'
      txt = isOnPath ? '#00d4ff' : 'var(--ink)'; glow = isOnPath ? 'url(#rgGC)' : undefined
    } else if (node.type === 'dest') {
      fill = 'rgba(0,255,136,0.06)'; stroke = isOnPath ? 'rgba(0,255,136,0.5)' : 'rgba(255,255,255,0.08)'
      txt = isOnPath ? '#00ff88' : 'var(--ink)'; glow = isOnPath ? 'url(#rgGG)' : undefined
    } else {
      const isBridge = optimalCoin === node.id
      fill = isBridge ? 'rgba(0,255,136,0.08)' : 'rgba(255,255,255,0.02)'
      stroke = isBridge ? 'rgba(0,255,136,0.4)' : 'rgba(255,255,255,0.08)'
      txt = isBridge ? '#00ff88' : 'var(--muted)'; glow = isBridge ? 'url(#rgGG)' : undefined
    }

    const rx = node.type === 'coin' ? 8 : 10
    const nodeDelay = node.type === 'source' ? '0s' : node.type === 'dest' ? '1.2s' : (optimalCoin === node.id ? '0.5s' : '0s')
    const needsReveal = isOnPath && data

    return (
      <g key={`${node.id}-${dataVersion}`} style={needsReveal ? { opacity: 0, animation: `rgGlowIn 0.3s ease-out ${nodeDelay} forwards` } : undefined}>
        <rect x={node.x - w / 2} y={node.y - h / 2} width={w} height={h} rx={rx}
          style={{ fill, stroke }} strokeWidth={isOnPath ? 1 : 0.5} filter={glow} />
        {node.type === 'coin' ? (
          <text x={node.x} y={node.y + 4} textAnchor="middle" style={{ fill: txt, fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)' }}>{node.label}</text>
        ) : (
          <>
            <text x={node.x} y={node.y - 1} textAnchor="middle" style={{ fill: txt, fontSize: 12, fontWeight: 700 }}>{node.label}</text>
            <text x={node.x} y={node.y + 12} textAnchor="middle" style={{ fill: 'var(--muted2)', fontSize: 10, fontFamily: 'var(--mono)' }}>
              {node.type === 'source' ? fromCurrency : toCurrency}
            </text>
          </>
        )}
      </g>
    )
  }

  const actionColor = (action: string) =>
    action === 'EXECUTE' ? 'var(--green)' : action === 'SKIP' ? 'var(--red)' : 'var(--amber)'
  const actionMeaning = (action: Route['action']) =>
    action === 'EXECUTE'
      ? 'Low routing cost now'
      : action === 'WAIT'
        ? 'Moderate cost, monitor market'
        : 'Cost too high for now'

  /* ── JSX ───────────────────────────────────────── */

  return (
    <div className="rg-wrap">
      <style>{CSS}</style>

      {/* ── Header ───────────────────────────────── */}
      <div className="rg-header">
        <div>
          <h2 className="rg-title">Route Graph</h2>
          <p className="rg-sub">Real-time orderbook data + D1 fee table</p>
          <p className="rg-sub">
            {requestFrom} {'\u2192'} {requestTo}
            {isRotating ? ' · updating…' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--muted2)' }}>next {countdown}s</span>
          <span className="rg-badge"><span className="rg-dot" /> LIVE</span>
        </div>
      </div>



      {/* ── Error ────────────────────────────────── */}
      {error && <div className="rg-err">{error}</div>}

      {/* ── SVG Graph ────────────────────────────── */}
      <div className="rg-gw" style={{ opacity: loading ? 0.55 : 1 }}>
        <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} className="rg-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Route graph visualization">
          <defs>
            <filter id="rgGG" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#00ff88" floodOpacity="0.5" />
            </filter>
            <filter id="rgGC" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#00d4ff" floodOpacity="0.5" />
            </filter>
            <linearGradient id="rgGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00d4ff" />
              <stop offset="100%" stopColor="#00ff88" />
            </linearGradient>
            <pattern id="rgDots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="12" cy="12" r="0.55" fill="rgba(255,255,255,0.03)" />
            </pattern>
          </defs>

          {/* background */}
          <rect width={GRAPH_WIDTH} height={GRAPH_HEIGHT} style={{ fill: 'var(--bg)' }} />
          <rect width={GRAPH_WIDTH} height={GRAPH_HEIGHT} fill="url(#rgDots)" />

          {/* bridge column highlight */}
          <rect x={COIN_X - 46} y={34} width={92} height={GRAPH_HEIGHT - 68} rx="8" fill="rgba(255,170,0,0.018)" stroke="rgba(255,170,0,0.04)" strokeWidth={0.5} />

          {/* column labels */}
          <text x={SOURCE_X} y={24} textAnchor="middle" style={{ fill: 'var(--muted2)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>SOURCE</text>
          <text x={COIN_X} y={24} textAnchor="middle" style={{ fill: 'var(--muted2)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>BRIDGE</text>
          <text x={DEST_X} y={24} textAnchor="middle" style={{ fill: 'var(--muted2)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>DESTINATION</text>

          {/* non-optimal edges (behind) */}
          {graph.edges.filter((e) => !e.isOptimal).map(renderEdge)}
          {/* optimal edges (on top) */}
          {graph.edges.filter((e) => e.isOptimal).map(renderEdge)}
          {/* nodes */}
          {graph.nodes.map(renderNode)}
        </svg>
      </div>

      {/* ── Info Grid ────────────────────────────── */}
      <div className="rg-grid">
        {/* Optimal Route */}
        <div className="rg-card" style={{ borderLeft: '3px solid var(--green)' }}>
          <div className="rg-lbl">Optimal Route</div>
          {optimal ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--cyan)', fontWeight: 700, fontFamily: 'var(--mono)', fontSize: '0.94rem' }}>
                  {formatExchange(parseExchange(requestFrom))}
                </span>
                <span style={{ color: 'var(--muted2)' }}>{'\u2192'}</span>
                <span style={{ color: 'var(--amber)', fontWeight: 700, fontFamily: 'var(--mono)', fontSize: '0.94rem' }}>
                  {optimal.bridgeCoin.toUpperCase()}
                </span>
                <span style={{ color: 'var(--muted2)' }}>{'\u2192'}</span>
                <span style={{ color: 'var(--green)', fontWeight: 700, fontFamily: 'var(--mono)', fontSize: '0.94rem' }}>
                  {formatExchange(parseExchange(requestTo))}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                <div>
                  <div style={{ color: 'var(--muted2)', fontSize: '0.74rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cost</div>
                  <div style={{ color: 'var(--green)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '0.96rem' }}>{optimal.totalCostPct.toFixed(2)}%</div>
                </div>
                <div>
                  <div style={{ color: 'var(--muted2)', fontSize: '0.74rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Time</div>
                  <div style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '0.96rem' }}>~{optimal.totalTimeMinutes}m</div>
                </div>
                <div>
                  <div style={{ color: 'var(--muted2)', fontSize: '0.74rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Action</div>
                  <div style={{ color: actionColor(optimal.action), fontWeight: 700, fontSize: '0.94rem' }}>{optimal.action}</div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: 3 }}>{actionMeaning(optimal.action)}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--muted2)', fontSize: '0.74rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Confidence</div>
                  <div style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '0.96rem' }}>{(optimal.confidence * 100).toFixed(0)}%</div>
                </div>
              </div>
              <p style={{ margin: '10px 0 0', fontSize: '0.86rem', color: 'var(--muted)', lineHeight: 1.55 }}>{optimal.reason}</p>
            </>
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>No route found</div>
          )}
        </div>

        {/* Data Freshness */}
        <div className="rg-card" style={{ borderLeft: '3px solid var(--cyan)' }}>
          <div className="rg-lbl">Data Freshness</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {([
              ['Routes evaluated', String(data?.meta.routesEvaluated ?? 0)],
              ['Price source', data?.meta.priceAge?.globalPrices?.source ?? 'n/a'],
              ['Price age', `${data?.meta.priceAge?.globalPrices?.ageMs ?? 0}ms`],
              ['Data status', data?.meta.dataFreshness ?? 'n/a'],
              ['Fee source', data?.meta.feesSource ?? 'n/a'],
            ] as const).map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--muted)', fontSize: '0.86rem' }}>{label}</span>
                <span style={{ color: 'var(--ink)', fontSize: '0.86rem', fontFamily: 'var(--mono)', fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Exchange Fees */}
        <div className="rg-card rg-full">
          <div className="rg-lbl">Exchange Fees (D1)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: '0.76rem', fontWeight: 650, color: 'var(--amber)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Trading</div>
              {Object.entries(tradingFees).map(([exchange, fee]) => (
                <div key={`tf-${exchange}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.88rem' }}>
                  <span style={{ color: 'var(--muted)' }}>{formatExchange(exchange)}</span>
                  <span style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontWeight: 600 }}>{formatTradingFeePercent(fee)}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: '0.76rem', fontWeight: 650, color: 'var(--amber)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Withdrawal{optimalCoin ? ` (${optimalCoin})` : ''}
              </div>
              {Object.entries(withdrawalByExchange).map(([exchange, byCoin]) => (
                <div key={`wd-${exchange}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.88rem' }}>
                  <span style={{ color: 'var(--muted)' }}>{formatExchange(exchange)}</span>
                  <span style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                    {formatWithdrawalFee(byCoin[optimalCoin ?? ''], optimalCoin)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Alternatives */}
        {alternatives.length > 0 && (
          <div className="rg-card rg-full">
            <div className="rg-lbl">Alternatives</div>
            <table className="rg-at">
              <thead>
                <tr><th>Coin</th><th>Cost</th><th>Time</th><th>Action</th><th>Why</th></tr>
              </thead>
              <tbody>
                {alternatives.slice(0, 5).map((alt, idx) => (
                  <tr key={`${alt.bridgeCoin}-${idx}`}>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--ink)' }}>{alt.bridgeCoin.toUpperCase()}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{alt.totalCostPct.toFixed(2)}%</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>~{alt.totalTimeMinutes}m</td>
                    <td style={{ color: actionColor(alt.action), fontWeight: 600 }}>{alt.action}</td>
                    <td style={{ color: 'var(--muted)', fontSize: '0.84rem' }}>{alt.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="rg-action-guide">
              <b>Action guide:</b> EXECUTE = route now, WAIT = acceptable but monitor, SKIP = cost/risk too high.
            </p>
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────── */}
      {data && (
        <div className="rg-foot">
          {data.meta.routesEvaluated} routes / {data.meta.bridgeCoinsTotal} coins evaluated
        </div>
      )}
    </div>
  )
}
