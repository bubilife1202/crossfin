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

const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || 'https://crossfin.dev').replace(/\/$/, '')

const C = {
  bg: '#0B0F1E',
  card: '#141B2D',
  accent: '#00C2FF',
  green: '#00E68A',
  gold: '#FFB800',
  white: '#FFFFFF',
  muted: '#7B8794',
  dim: '#384152',
}

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

const ENDPOINT_OPTIONS = [
  { value: 'bithumb:KRW', label: 'Bithumb:KRW' },
  { value: 'upbit:KRW', label: 'Upbit:KRW' },
  { value: 'coinone:KRW', label: 'Coinone:KRW' },
  { value: 'gopax:KRW', label: 'GoPax:KRW' },
  { value: 'bitflyer:JPY', label: 'bitFlyer:JPY' },
  { value: 'wazirx:INR', label: 'WazirX:INR' },
  { value: 'binance:USDC', label: 'Binance:USDC' },
  { value: 'okx:USDC', label: 'OKX:USDC' },
  { value: 'bybit:USDC', label: 'Bybit:USDC' },
] as const

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

function formatTradingFeePct(value: number): string {
  if (!Number.isFinite(value)) return 'n/a'
  return `${value.toFixed(2)}%`
}

function formatWithdrawalFee(value: number | undefined, coin: string | null): string {
  if (!coin || !Number.isFinite(value)) return 'n/a'
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${coin}`
}

export default function RouteGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [from, setFrom] = useState<string>('bithumb:KRW')
  const [to, setTo] = useState<string>('binance:USDC')
  const [amountInput, setAmountInput] = useState<string>('1000000')
  const [strategy, setStrategy] = useState<RoutingStrategy>('cheapest')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<RoutingResponse | null>(null)

  const loadRoute = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)

    const amount = Number(amountInput)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive number')
      setLoading(false)
      return
    }

    try {
      const params = new URLSearchParams({ from, to, amount: String(amount), strategy })
      const res = await fetch(`${API_BASE}/api/routing/optimal?${params.toString()}`, { signal })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`routing_fetch_failed:${res.status} ${text.slice(0, 120)}`)
      }
      const json = await res.json() as RoutingResponse
      setData(json)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Failed to fetch route data')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [amountInput, from, strategy, to])

  // P-05: debounce fetch — wait 400ms after last input change before firing
  useEffect(() => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => { void loadRoute(ctrl.signal) }, 400)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [loadRoute])

  const graph = useMemo(() => {
    const fromEx = parseExchange(data?.request.from ?? from)
    const toEx = parseExchange(data?.request.to ?? to)

    const routePool = [data?.optimal, ...(data?.alternatives ?? [])].filter((r): r is Route => Boolean(r))
    const coinSet = new Set(routePool.map((r) => r.bridgeCoin.toUpperCase()))
    const coins = Array.from(coinSet)

    const coinCount = Math.max(1, coins.length)
    const gap = coinCount === 1 ? 0 : Math.max(28, Math.min(64, 300 / (coinCount - 1)))
    const startY = coinCount === 1 ? 205 : 70

    const nodes: GraphNode[] = [
      { id: fromEx, label: formatExchange(fromEx), x: 90, y: 205, type: 'source' },
      ...coins.map((coin, idx) => ({
        id: coin,
        label: coin,
        x: 390,
        y: startY + idx * gap,
        type: 'coin' as const,
      })),
      { id: toEx, label: formatExchange(toEx), x: 690, y: 205, type: 'dest' },
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
  }, [data, from, to])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.clientWidth || 800
    const height = Math.round(width * (440 / 800))
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)

    const scale = width / 800

    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, width, height)

    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = C.muted
    ctx.fillText('From Exchange', 90 * scale, 28 * scale)
    ctx.fillText('Bridge Coin', 390 * scale, 28 * scale)
    ctx.fillText('To Exchange', 690 * scale, 28 * scale)

    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))

    graph.edges.forEach((edge) => {
      const n1 = nodeById.get(edge.from)
      const n2 = nodeById.get(edge.to)
      if (!n1 || !n2) return

      const x1 = (n1.x + (n1.type === 'source' ? 55 : 34)) * scale
      const y1 = (n1.y + 18) * scale
      const x2 = (n2.x - (n2.type === 'dest' ? 55 : 34)) * scale
      const y2 = (n2.y + 18) * scale

      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.strokeStyle = edge.isOptimal ? C.green : C.dim
      ctx.lineWidth = edge.isOptimal ? 3 : 1
      if (!edge.isOptimal) ctx.setLineDash([4, 4])
      ctx.stroke()
      ctx.setLineDash([])

    })

    graph.nodes.forEach((node) => {
      const w = (node.type === 'coin' ? 68 : 110) * scale
      const h = 36 * scale
      const nx = node.x * scale
      const ny = node.y * scale
      const isPathNode = (data?.optimal?.bridgeCoin?.toUpperCase() === node.id) ||
        node.id === graph.fromEx ||
        node.id === graph.toEx

      const color = node.type === 'source' ? C.accent : node.type === 'coin' ? C.gold : C.green

      ctx.fillStyle = isPathNode ? `${color}33` : C.card
      ctx.strokeStyle = isPathNode ? color : C.dim
      ctx.lineWidth = isPathNode ? 2 : 1
      ctx.beginPath()
      ctx.roundRect(nx - w / 2, ny, w, h, 6)
      ctx.fill()
      ctx.stroke()

      ctx.font = isPathNode ? 'bold 12px sans-serif' : '11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = isPathNode ? color : C.white
      ctx.fillText(node.label, nx, ny + 22 * scale)
    })
  }, [data, graph])

  const optimal = data?.optimal ?? null
  const alternatives = data?.alternatives ?? []
  const tradingFees = data?.fees.trading ?? {}
  const optimalCoin = optimal?.bridgeCoin?.toUpperCase() ?? null
  const withdrawalByExchange = data?.fees.withdrawal ?? {}
  const hasData = Boolean(data)
  const isInitialLoading = loading && !hasData

  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.dim}`,
      borderRadius: 8,
      padding: 24,
      maxWidth: 850,
      margin: '0 auto',
      fontFamily: "'Noto Sans KR', sans-serif",
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ color: C.white, fontSize: 18, margin: 0 }}>CrossFin RouteGraph (Live)</h3>
          <p style={{ color: C.muted, fontSize: 12, margin: '4px 0 0' }}>
            Real orderbook/slippage route data + D1 fee table
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadRoute()}
          disabled={loading}
          style={{
            background: loading ? C.dim : C.accent,
            color: C.bg,
            border: 'none',
            padding: '8px 18px',
            borderRadius: 6,
            fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Loading…' : 'Refresh Live Route'}
        </button>
      </div>

      <div className="rgControlsGrid">
        <label>
          <span className="srOnly">From Exchange</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {ENDPOINT_OPTIONS.map((opt) => <option key={`from-${opt.value}`} value={opt.value}>{opt.label}</option>)}
          </select>
        </label>
        <label>
          <span className="srOnly">To Exchange</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {ENDPOINT_OPTIONS.map((opt) => <option key={`to-${opt.value}`} value={opt.value}>{opt.label}</option>)}
          </select>
        </label>
        <label>
          <span className="srOnly">Amount</span>
          <input value={amountInput} onChange={(e) => setAmountInput(e.target.value)} placeholder="amount" />
        </label>
        <label>
          <span className="srOnly">Strategy</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value as RoutingStrategy)}>
            <option value="cheapest">cheapest</option>
            <option value="fastest">fastest</option>
            <option value="balanced">balanced</option>
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" style={{
          marginBottom: 10,
          padding: '8px 10px',
          background: '#2D1010',
          border: '1px solid #5B1F1F',
          color: '#FFB4B4',
          borderRadius: 6,
          fontSize: 12,
        }}>
          {error}
        </div>
      )}

      <canvas ref={canvasRef} style={{ width: '100%', maxWidth: 800, height: 'auto', aspectRatio: '800/440', borderRadius: 6 }} />

      <div className="rgInfoGrid" style={{ marginTop: 12 }}>
        <div style={{ background: C.card, border: `1px solid ${C.dim}`, borderRadius: 6, padding: 12 }}>
          <div style={{ color: C.white, fontWeight: 700, marginBottom: 8 }}>Optimal</div>
          {isInitialLoading ? (
            <div style={{ color: C.muted, fontSize: 12 }}>Loading live route data…</div>
          ) : optimal ? (
            <>
              <div style={{ color: C.green, fontWeight: 700, marginBottom: 4 }}>
                {formatExchange(parseExchange(data?.request.from ?? from))}
                {' -> '}
                {optimal.bridgeCoin.toUpperCase()}
                {' -> '}
                {formatExchange(parseExchange(data?.request.to ?? to))}
              </div>
              <div style={{ color: C.muted, fontSize: 12 }}>Cost: {optimal.totalCostPct.toFixed(2)}% | Time: ~{optimal.totalTimeMinutes}m</div>
              <div style={{ color: C.muted, fontSize: 12 }}>Action: {optimal.action} ({(optimal.confidence * 100).toFixed(0)}%)</div>
              <div style={{ color: C.white, fontSize: 12, marginTop: 6 }}>{optimal.reason}</div>
            </>
          ) : error ? (
            <div style={{ color: '#FFB4B4', fontSize: 12 }}>
              Route fetch failed. Check endpoint status and retry.
            </div>
          ) : (
            <div style={{ color: C.muted, fontSize: 12 }}>No valid route for current pair/amount.</div>
          )}
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.dim}`, borderRadius: 6, padding: 12 }}>
          <div style={{ color: C.white, fontWeight: 700, marginBottom: 8 }}>Route Data Freshness</div>
          {hasData ? (
            <>
              <div style={{ color: C.muted, fontSize: 12 }}>Evaluated routes: {data?.meta.routesEvaluated ?? 0}</div>
              <div style={{ color: C.muted, fontSize: 12 }}>Global price source: {data?.meta.priceAge?.globalPrices?.source ?? 'n/a'}</div>
              <div style={{ color: C.muted, fontSize: 12 }}>Price age: {data?.meta.priceAge?.globalPrices?.ageMs ?? 0}ms</div>
              <div style={{ color: C.muted, fontSize: 12 }}>Data freshness: {data?.meta.dataFreshness ?? 'n/a'}</div>
              <div style={{ color: C.muted, fontSize: 12 }}>Fees source: {data?.meta.feesSource ?? 'n/a'}</div>
            </>
          ) : (
            <div style={{ color: C.muted, fontSize: 12 }}>Waiting for first live response…</div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 10, background: C.card, border: `1px solid ${C.dim}`, borderRadius: 6, padding: 12 }}>
        <div style={{ color: C.white, fontWeight: 700, marginBottom: 8 }}>Real Exchange Fees (D1)</div>
        {hasData ? (
          <div className="rgInfoGrid">
            <div>
              <div style={{ color: C.gold, fontSize: 12, marginBottom: 6 }}>Trading Fees</div>
              {Object.entries(tradingFees).map(([exchange, fee]) => (
                <div key={`trade-${exchange}`} style={{ color: C.muted, fontSize: 12 }}>
                  {formatExchange(exchange)}: {formatTradingFeePct(fee)}
                </div>
              ))}
            </div>
            <div>
              <div style={{ color: C.gold, fontSize: 12, marginBottom: 6 }}>
                Withdrawal Fees {optimalCoin ? `(${optimalCoin})` : ''}
              </div>
              {Object.entries(withdrawalByExchange).map(([exchange, byCoin]) => (
                <div key={`wd-${exchange}`} style={{ color: C.muted, fontSize: 12 }}>
                  {formatExchange(exchange)}: {formatWithdrawalFee(byCoin[optimalCoin ?? ''], optimalCoin)}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ color: C.muted, fontSize: 12 }}>Loading fee table…</div>
        )}
      </div>

      {alternatives.length > 0 && (
        <div style={{ marginTop: 10, background: C.card, border: `1px solid ${C.dim}`, borderRadius: 6, padding: 12 }}>
          <div style={{ color: C.white, fontWeight: 700, marginBottom: 8 }}>Alternatives</div>
          {alternatives.slice(0, 4).map((alt, idx) => (
            <div key={`${alt.bridgeCoin}-${idx}`} style={{ color: C.muted, fontSize: 12, marginBottom: 3 }}>
              {alt.bridgeCoin.toUpperCase()}: {alt.totalCostPct.toFixed(2)}% | ~{alt.totalTimeMinutes}m | {alt.action}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
