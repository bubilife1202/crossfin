import { useCallback, useEffect, useRef, useState } from 'react'

// ── Types ──
type Node = {
  id: string
  label: string
  x: number
  y: number
  type: 'source' | 'coin' | 'dest'
  color: string
}

type Edge = {
  from: string
  to: string
  cost: number          // total cost in USD
  label: string         // e.g. "BTC via ETH"
  breakdown: string     // fee breakdown
  isOptimal?: boolean
  explored?: boolean
}

type RouteResult = {
  path: string[]
  totalCost: number
  savings: number
  steps: string[]
}

// ── Colors ──
const C = {
  bg: '#0B0F1E',
  card: '#141B2D',
  accent: '#00C2FF',
  green: '#00E68A',
  gold: '#FFB800',
  red: '#FF5252',
  white: '#FFFFFF',
  muted: '#7B8794',
  dim: '#384152',
}

// ── Exchange & Coin Data ──
const KR_EXCHANGES = ['Upbit', 'Bithumb', 'Coinone', 'Gopax']
const INTL_EXCHANGES = ['Binance', 'OKX', 'Bybit']
const COINS = ['BTC', 'ETH', 'XRP', 'USDT', 'SOL']

// ── Simulated Cost Data ──
function generateRoutes(): Edge[] {
  const edges: Edge[] = []
  const random = (min: number, max: number) => Math.random() * (max - min) + min

  KR_EXCHANGES.forEach(kr => {
    COINS.forEach(coin => {
      // KR exchange → coin node
      const tradeFee = random(0.04, 0.25)
      const withdrawFee = random(0.5, 8)
      edges.push({
        from: kr,
        to: coin,
        cost: tradeFee + withdrawFee,
        label: `${tradeFee.toFixed(2)} + ${withdrawFee.toFixed(1)}`,
        breakdown: `거래 $${tradeFee.toFixed(2)} + 출금 $${withdrawFee.toFixed(1)}`,
      })

      INTL_EXCHANGES.forEach(intl => {
        // coin node → intl exchange
        const networkFee = random(0.1, 5)
        const slippage = random(0.05, 1.5)
        const fxSpread = random(0.1, 0.8)
        edges.push({
          from: coin,
          to: intl,
          cost: networkFee + slippage + fxSpread,
          label: `${(networkFee + slippage + fxSpread).toFixed(2)}`,
          breakdown: `네트워크 $${networkFee.toFixed(2)} + 슬리피지 $${slippage.toFixed(2)} + 환율 $${fxSpread.toFixed(2)}`,
        })
      })
    })
  })
  return edges
}

function findOptimalRoute(edges: Edge[]): RouteResult {
  let best: { path: string[], cost: number, steps: string[] } | null = null

  KR_EXCHANGES.forEach(kr => {
    COINS.forEach(coin => {
      INTL_EXCHANGES.forEach(intl => {
        const leg1 = edges.find(e => e.from === kr && e.to === coin)
        const leg2 = edges.find(e => e.from === coin && e.to === intl)
        if (leg1 && leg2) {
          const total = leg1.cost + leg2.cost
          if (!best || total < best.cost) {
            best = {
              path: [kr, coin, intl],
              cost: total,
              steps: [leg1.breakdown, leg2.breakdown],
            }
          }
        }
      })
    })
  })

  // Find worst route for savings comparison
  let worst = 0
  KR_EXCHANGES.forEach(kr => {
    COINS.forEach(coin => {
      INTL_EXCHANGES.forEach(intl => {
        const leg1 = edges.find(e => e.from === kr && e.to === coin)
        const leg2 = edges.find(e => e.from === coin && e.to === intl)
        if (leg1 && leg2) worst = Math.max(worst, leg1.cost + leg2.cost)
      })
    })
  })

  return {
    path: best!.path,
    totalCost: best!.cost,
    savings: worst - best!.cost,
    steps: best!.steps,
  }
}

// ── Component ──
export default function RouteGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [edges, setEdges] = useState<Edge[]>([])
  const [result, setResult] = useState<RouteResult | null>(null)
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'calculating' | 'done'>('idle')
  const [exploredCount, setExploredCount] = useState(0)
  const [hoveredEdge, setHoveredEdge] = useState<Edge | null>(null)
  const animFrameRef = useRef<number>(0)

  // Build node layout
  const nodes: Node[] = [
    ...KR_EXCHANGES.map((ex, i) => ({
      id: ex, label: ex, x: 80,
      y: 80 + i * 90,
      type: 'source' as const, color: C.accent,
    })),
    ...COINS.map((coin, i) => ({
      id: coin, label: coin, x: 380,
      y: 60 + i * 72,
      type: 'coin' as const, color: C.gold,
    })),
    ...INTL_EXCHANGES.map((ex, i) => ({
      id: ex, label: ex, x: 680,
      y: 100 + i * 110,
      type: 'dest' as const, color: C.green,
    })),
  ]

  const getNode = useCallback((id: string) => nodes.find(n => n.id === id)!, [])

  // Draw canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = 800 * dpr
    canvas.height = 440 * dpr
    ctx.scale(dpr, dpr)

    // Background
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, 800, 440)

    // Column labels
    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = C.muted
    ctx.fillText('한국 거래소', 80, 30)
    ctx.fillText('코인 / 체인', 380, 30)
    ctx.fillText('해외 거래소', 680, 30)

    // Draw edges
    edges.forEach(edge => {
      const from = getNode(edge.from)
      const to = getNode(edge.to)
      if (!from || !to) return

      ctx.beginPath()
      ctx.moveTo(from.x + 50, from.y + 18)
      ctx.lineTo(to.x - 50, to.y + 18)

      if (edge.isOptimal) {
        ctx.strokeStyle = C.green
        ctx.lineWidth = 3
        ctx.setLineDash([])
      } else if (edge.explored) {
        ctx.strokeStyle = C.dim
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
      } else {
        ctx.strokeStyle = '#1a1f30'
        ctx.lineWidth = 0.5
        ctx.setLineDash([2, 6])
      }
      ctx.stroke()
      ctx.setLineDash([])

      // Cost label on explored/optimal edges
      if (edge.explored || edge.isOptimal) {
        const mx = (from.x + 50 + to.x - 50) / 2
        const my = (from.y + to.y) / 2 + 18
        ctx.font = '9px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillStyle = edge.isOptimal ? C.green : C.muted
        ctx.fillText(`$${edge.cost.toFixed(1)}`, mx, my - 2)
      }
    })

    // Draw nodes
    nodes.forEach(node => {
      const isOnPath = result?.path.includes(node.id)
      const w = node.type === 'coin' ? 60 : 100
      const h = 36

      // Node box
      ctx.fillStyle = isOnPath ? node.color + '33' : C.card
      ctx.strokeStyle = isOnPath ? node.color : C.dim
      ctx.lineWidth = isOnPath ? 2 : 1
      ctx.beginPath()
      ctx.roundRect(node.x - w / 2, node.y, w, h, 4)
      ctx.fill()
      ctx.stroke()

      // Label
      ctx.font = isOnPath ? 'bold 12px sans-serif' : '11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = isOnPath ? node.color : C.white
      ctx.fillText(node.label, node.x, node.y + 22)
    })

    // Arrow heads on optimal path
    if (result) {
      for (let i = 0; i < result.path.length - 1; i++) {
        const from = getNode(result.path[i])
        const to = getNode(result.path[i + 1])
        const toW = to.type === 'coin' ? 60 : 100
        const ax = to.x - toW / 2 - 8
        const ay = to.y + 18

        ctx.fillStyle = C.green
        ctx.beginPath()
        ctx.moveTo(ax, ay - 5)
        ctx.lineTo(ax + 8, ay)
        ctx.lineTo(ax, ay + 5)
        ctx.fill()
      }
    }
  }, [edges, result, nodes, getNode])

  useEffect(() => { draw() }, [draw, phase, exploredCount])

  // Animation: simulate route scanning
  const startScan = useCallback(() => {
    const newEdges = generateRoutes()
    setEdges(newEdges)
    setResult(null)
    setPhase('scanning')
    setExploredCount(0)

    let idx = 0
    const scanInterval = setInterval(() => {
      if (idx < newEdges.length) {
        newEdges[idx].explored = true
        setExploredCount(prev => prev + 1)
        setEdges([...newEdges])
        idx++
      } else {
        clearInterval(scanInterval)
        setPhase('calculating')

        // Short delay then show result
        setTimeout(() => {
          const optimal = findOptimalRoute(newEdges)

          // Mark optimal edges
          for (let i = 0; i < optimal.path.length - 1; i++) {
            const edge = newEdges.find(
              e => e.from === optimal.path[i] && e.to === optimal.path[i + 1]
            )
            if (edge) edge.isOptimal = true
          }

          setEdges([...newEdges])
          setResult(optimal)
          setPhase('done')
        }, 800)
      }
    }, 30)

    return () => clearInterval(scanInterval)
  }, [])

  const totalRoutes = KR_EXCHANGES.length * COINS.length * INTL_EXCHANGES.length

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
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ color: C.white, fontSize: 18, margin: 0 }}>
            CrossFin Routing Engine
          </h3>
          <p style={{ color: C.muted, fontSize: 12, margin: '4px 0 0' }}>
            {totalRoutes}개 경로 실시간 비교 · 5가지 비용 합산 · 최적 경로 탐색
          </p>
        </div>
        <button
          onClick={startScan}
          disabled={phase === 'scanning' || phase === 'calculating'}
          style={{
            background: phase === 'done' ? C.green : C.accent,
            color: C.bg,
            border: 'none',
            padding: '8px 20px',
            borderRadius: 4,
            fontWeight: 'bold',
            fontSize: 13,
            cursor: phase === 'scanning' || phase === 'calculating' ? 'not-allowed' : 'pointer',
            opacity: phase === 'scanning' || phase === 'calculating' ? 0.5 : 1,
          }}
        >
          {phase === 'idle' ? '경로 탐색 시작' :
           phase === 'scanning' ? `스캔 중... ${exploredCount}/${edges.length}` :
           phase === 'calculating' ? '최적 경로 계산 중...' :
           '다시 탐색'}
        </button>
      </div>

      {/* Status bar */}
      {phase !== 'idle' && (
        <div style={{
          display: 'flex', gap: 16, marginBottom: 12,
          padding: '8px 12px', background: C.card, borderRadius: 4,
        }}>
          <span style={{ fontSize: 11, color: C.muted }}>
            거래소: <b style={{ color: C.accent }}>{KR_EXCHANGES.length + INTL_EXCHANGES.length}</b>
          </span>
          <span style={{ fontSize: 11, color: C.muted }}>
            코인: <b style={{ color: C.gold }}>{COINS.length}</b>
          </span>
          <span style={{ fontSize: 11, color: C.muted }}>
            전체 경로: <b style={{ color: C.white }}>{totalRoutes}</b>
          </span>
          <span style={{ fontSize: 11, color: C.muted }}>
            탐색 완료: <b style={{ color: phase === 'done' ? C.green : C.accent }}>
              {phase === 'done' ? totalRoutes : Math.floor(exploredCount / 2)}
            </b>
          </span>
          {result && (
            <>
              <span style={{ fontSize: 11, color: C.muted }}>
                최적 비용: <b style={{ color: C.green }}>${result.totalCost.toFixed(2)}</b>
              </span>
              <span style={{ fontSize: 11, color: C.muted }}>
                절약: <b style={{ color: C.gold }}>${result.savings.toFixed(2)}</b>
              </span>
            </>
          )}
        </div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{ width: 800, height: 440, borderRadius: 4 }}
      />

      {/* Result panel */}
      {result && phase === 'done' && (
        <div style={{
          marginTop: 12,
          padding: 16,
          background: C.card,
          borderRadius: 4,
          borderLeft: `3px solid ${C.green}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 'bold', color: C.green, marginBottom: 8 }}>
                최적 경로: {result.path.join(' → ')}
              </div>
              {result.steps.map((step, i) => (
                <div key={i} style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>
                  Step {i + 1}: {step}
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: C.green }}>
                ${result.totalCost.toFixed(2)}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>총 비용</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: C.gold, marginTop: 4 }}>
                -${result.savings.toFixed(2)}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>최악 경로 대비 절약</div>
            </div>
          </div>
          <div style={{
            marginTop: 12, paddingTop: 8, borderTop: `1px solid ${C.dim}`,
            fontSize: 10, color: C.dim,
          }}>
            NOW: {totalRoutes}경로 전수비교 (brute-force) → SCALE: 수천 경로 그래프 알고리즘 라우팅 (Dijkstra + 유동성 가중치)
          </div>
        </div>
      )}
    </div>
  )
}
