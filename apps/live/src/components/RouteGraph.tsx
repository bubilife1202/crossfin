import { useEffect, useMemo } from 'react'
import type { RoutingResponse, Route } from '../routing'
import { formatExchange, parseExchange, INITIAL_SCENARIO, sumStepFees } from '../routing'

/* ── Local types ── */

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

/* ── Constants ── */

const GRAPH_WIDTH = 760
const GRAPH_HEIGHT = 240
const SOURCE_X = 118
const COIN_X = 380
const DEST_X = 642
const EMPTY_ROUTES: Route[] = []
const NW: Record<GraphNode['type'], number> = { source: 112, coin: 74, dest: 112 }
const NH: Record<GraphNode['type'], number> = { source: 40, coin: 28, dest: 40 }

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cp = (x2 - x1) * 0.4
  return `M${x1},${y1} C${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`
}

/* ── Scoped CSS (graph-only) ── */

const CSS = `
@keyframes rgFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes rgDash{to{stroke-dashoffset:-24}}
@keyframes rgPulse{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes rgDraw{from{stroke-dashoffset:400}to{stroke-dashoffset:0}}
@keyframes rgGlowIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}
@keyframes rgScanPulse{0%{opacity:0;stroke-dashoffset:400}30%{opacity:1;stroke-dashoffset:0}70%{opacity:1}100%{opacity:0}}
@keyframes rgDataRiver{0%{stroke-dashoffset:100;opacity:0}10%{opacity:1}90%{opacity:1}100%{stroke-dashoffset:-100;opacity:0}}
@keyframes rgGuardianPop{0%{opacity:0;transform:scale(0.8) translateY(2px)}60%{opacity:1;transform:scale(1.05) translateY(0)}100%{opacity:1;transform:scale(1) translateY(0)}}

.rg-wrap{animation:rgFadeIn .5s cubic-bezier(.4,0,.2,1) both}
.rg-gw{margin:0 auto;border-radius:10px;overflow:hidden;border:1px solid var(--border);background:var(--bg);transition:opacity .5s cubic-bezier(.4,0,.2,1);width:100%}
.rg-svg{display:block;width:100%;height:auto}
.rg-svg text{font-family:var(--sans)}
.rg-dash{animation:rgDash 1.6s linear infinite}
.rg-draw{stroke-dasharray:400;stroke-dashoffset:400;animation:rgDraw 0.8s cubic-bezier(0.4, 0, 0.2, 1) 1.2s forwards}
.rg-draw2{stroke-dasharray:400;stroke-dashoffset:400;animation:rgDraw 0.8s cubic-bezier(0.4, 0, 0.2, 1) 1.5s forwards}
.rg-glow-in{animation:rgGlowIn 0.5s cubic-bezier(0.4, 0, 0.2, 1) 1.2s forwards;opacity:0}
.rg-glow-in2{animation:rgGlowIn 0.5s cubic-bezier(0.4, 0, 0.2, 1) 1.5s forwards;opacity:0}
.rg-scan{stroke-dasharray:400;stroke-dashoffset:400;animation:rgScanPulse 1.2s cubic-bezier(0.4, 0, 0.2, 1) forwards}
.rg-guardian-text{animation:rgGuardianPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 1.6s forwards;opacity:0}
`

let cssInjected = false
function injectCSS() {
  if (cssInjected) return
  cssInjected = true
  const el = document.createElement('style')
  el.setAttribute('data-rg-styles', '')
  el.textContent = CSS
  document.head.appendChild(el)
}

/* ── Component ── */

type RouteGraphProps = {
  data: RoutingResponse | null
  loading: boolean
  highlightBridge?: string | null
}

export default function RouteGraph({ data, loading, highlightBridge }: RouteGraphProps) {
  useEffect(() => { injectCSS() }, [])

  // Derive a version key that changes when data changes (for animation triggers)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const version = useMemo(() => Date.now(), [data])

  const rawOptimal = data?.optimal ?? null
  const rawAlts = data?.alternatives ?? EMPTY_ROUTES

  const optimal = useMemo(() => {
    if (!rawOptimal) return null
    if (!highlightBridge || highlightBridge === 'auto') return rawOptimal
    const coin = highlightBridge.toUpperCase()
    if (rawOptimal.bridgeCoin.toUpperCase() === coin) return rawOptimal
    return rawAlts.find(r => r.bridgeCoin.toUpperCase() === coin) ?? rawOptimal
  }, [rawOptimal, rawAlts, highlightBridge])

  const alternatives = useMemo(() => {
    const pool = [rawOptimal, ...rawAlts].filter((r): r is Route => r !== null)
    if (optimal) return pool.filter(r => r.bridgeCoin.toUpperCase() !== optimal.bridgeCoin.toUpperCase())
    return pool
  }, [rawOptimal, rawAlts, optimal])

  const requestFrom = data?.request.from ?? INITIAL_SCENARIO.from
  const requestTo = data?.request.to ?? INITIAL_SCENARIO.to
  const fromCurrency = requestFrom.split(':')[1] ?? ''
  const toCurrency = requestTo.split(':')[1] ?? ''
  const optimalCoin = optimal?.bridgeCoin?.toUpperCase() ?? null

  /* ── Graph computation ── */
  const graph = useMemo(() => {
    const fromEx = parseExchange(requestFrom)
    const toEx = parseExchange(requestTo)

    const routePool = [optimal, ...alternatives].filter((r): r is Route => Boolean(r)).slice(0, 6)
    const coins = Array.from(new Set(routePool.map(r => r.bridgeCoin.toUpperCase())))
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
        id: coin, label: coin, x: COIN_X, y: startY + idx * gap, type: 'coin' as const,
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
        if (!prev) { byKey.set(key, edge); return }
        if (!prev.isOptimal && edge.isOptimal) { byKey.set(key, edge); return }
        if (prev.isOptimal === edge.isOptimal && edge.cost < prev.cost) { byKey.set(key, edge) }
      })
    })

    return { nodes, edges: Array.from(byKey.values()), fromEx, toEx }
  }, [data, optimal, alternatives, requestFrom, requestTo])

  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))

  /* ── Render helpers ── */

  const isFirstLeg = (edge: GraphEdge) => nodeById.get(edge.from)?.type === 'source'

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
      const delayOffset = first ? 1.6 : 1.9

      return (
        <g key={`oe-${idx}-${version}`}>
          <path d={d} fill="none" stroke="#00ff88" strokeWidth={4} opacity={0.08} className={glowClass} />
          <path d={d} fill="none" stroke="url(#rgGrad)" strokeWidth={2} strokeLinecap="round" className={drawClass} />
          <path
            d={d} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={2} strokeLinecap="round"
            strokeDasharray="1 12" filter="url(#rgPulseGlow)"
            style={{
              animation: `rgDataRiver 1.2s linear infinite ${delayOffset}s, rgGlowIn 0.3s forwards ${delayOffset}s`,
              opacity: 0
            }}
          />
        </g>
      )
    }

    return (
      <g key={`de-${idx}`}>
        <path d={d} fill="none" stroke="rgba(0, 212, 255, 0.4)" strokeWidth={1} className="rg-scan" />
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
    const nodeDelay = node.type === 'source' ? '0s' : node.type === 'dest' ? '0.6s' : (optimalCoin === node.id ? '0.3s' : '0s')
    const needsReveal = isOnPath && data

    return (
      <g key={`${node.id}-${version}`} style={needsReveal ? { opacity: 0, animation: `rgGlowIn 0.5s cubic-bezier(.4,0,.2,1) ${nodeDelay} forwards` } : undefined}>
        <rect x={node.x - w / 2} y={node.y - h / 2} width={w} height={h} rx={rx}
          style={{ fill, stroke }} strokeWidth={isOnPath ? 1 : 0.5} filter={glow} />
        {node.type === 'coin' ? (
          <>
            <text x={node.x} y={node.y + 4} textAnchor="middle" style={{ fill: txt, fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)' }}>{node.label}</text>
            {optimalCoin === node.id && (
              <text x={node.x} y={node.y - 18} textAnchor="middle" className="rg-guardian-text" style={{ fill: '#00ff88', fontSize: 8, fontWeight: 750, letterSpacing: '0.06em', fontFamily: 'var(--sans)' }}>
                ✓ OPTIMAL
              </text>
            )}
          </>
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

  /* ── JSX ── */
  return (
    <div className="rg-wrap">
      <div className="rg-gw" style={{ opacity: loading ? 0.55 : 1 }}>
        <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} className="rg-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Route graph visualization">
          <defs>
            <filter id="rgGG" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#00ff88" floodOpacity="0.5" />
            </filter>
            <filter id="rgGC" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#00d4ff" floodOpacity="0.5" />
            </filter>
            <filter id="rgPulseGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#ffffff" floodOpacity="0.8" />
            </filter>
            <linearGradient id="rgGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00d4ff" />
              <stop offset="100%" stopColor="#00ff88" />
            </linearGradient>
            <pattern id="rgDots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="12" cy="12" r="0.55" fill="rgba(255,255,255,0.03)" />
            </pattern>
          </defs>

          <rect width={GRAPH_WIDTH} height={GRAPH_HEIGHT} style={{ fill: 'var(--bg)' }} />
          <rect width={GRAPH_WIDTH} height={GRAPH_HEIGHT} fill="url(#rgDots)" />
          <rect x={COIN_X - 46} y={34} width={92} height={GRAPH_HEIGHT - 68} rx="8" fill="rgba(255,170,0,0.018)" stroke="rgba(255,170,0,0.04)" strokeWidth={0.5} />

          <text x={SOURCE_X} y={24} textAnchor="middle" style={{ fill: 'var(--muted2)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>SOURCE</text>
          <text x={COIN_X} y={24} textAnchor="middle" style={{ fill: 'var(--muted2)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>BRIDGE</text>
          <text x={DEST_X} y={24} textAnchor="middle" style={{ fill: 'var(--muted2)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>DESTINATION</text>

          {graph.edges.filter(e => !e.isOptimal).map(renderEdge)}
          {graph.edges.filter(e => e.isOptimal).map(renderEdge)}
          {graph.nodes.map(renderNode)}
        </svg>
      </div>
    </div>
  )
}
