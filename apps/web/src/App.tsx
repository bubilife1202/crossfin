import { useCallback, useEffect, useState } from 'react'

import './App.css'
import RouteGraph from './components/RouteGraph'
import {
  fetchAnalytics,
  fetchFunnelOverview,
  fetchRegistryCategories,
  fetchRegistryServices,
  fetchRegistryStats,
  fetchStats,
  getApiBaseUrl,
  searchRegistryServices,
  type AnalyticsOverview,
  type FunnelEventName,
  type FunnelOverview,
  type RegistryCategory,
  type RegistryService,
  trackFunnelEvent,
} from './lib/api'
import { CROSSFIN_PLAYGROUND_ENDPOINTS } from './lib/catalog.generated'

type TabId = 'routing' | 'services' | 'developers' | 'activity'

const TAB_IDS: readonly TabId[] = ['routing', 'services', 'developers', 'activity'] as const
const tabLabels: Record<TabId, string> = { routing: 'Routing', services: 'Services', developers: 'Developers', activity: 'Activity' }
const MCP_NPX_COMMAND = 'npx -y crossfin-mcp'
const MCP_ENV_SNIPPET = `CROSSFIN_API_URL=https://crossfin.dev
EVM_PRIVATE_KEY=0x...`
const MCP_CLAUDE_CONFIG = `{
  "mcpServers": {
    "crossfin": {
      "command": "npx",
      "args": ["-y", "crossfin-mcp"],
      "env": {
        "CROSSFIN_API_URL": "https://crossfin.dev",
        "EVM_PRIVATE_KEY": "0x..."
      }
    }
  }
}`

function parseHash(): TabId {
  const raw = window.location.hash.replace('#', '') as TabId
  return TAB_IDS.includes(raw) ? raw : 'routing'
}

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T }

function truncateMiddle(value: string, max = 56): string {
  const raw = value.trim()
  if (raw.length <= max) return raw
  const head = raw.slice(0, Math.max(0, Math.floor(max * 0.6)))
  const tail = raw.slice(-Math.max(0, Math.floor(max * 0.25)))
  return `${head}…${tail}`
}

function App() {
  const apiBase = getApiBaseUrl()

  const [registryStats, setRegistryStats] = useState<LoadState<{ total: number; crossfin: number; external: number }>>({ status: 'loading' })
  const [agentStats, setAgentStats] = useState<LoadState<{ agents: number; wallets: number; transactions: number; blocked: number }>>({ status: 'loading' })
  const [categories, setCategories] = useState<LoadState<RegistryCategory[]>>({ status: 'loading' })
  const [services, setServices] = useState<LoadState<{ items: RegistryService[]; total: number }>>({ status: 'loading' })
  const [selected, setSelected] = useState<RegistryService | null>(null)

  const [category, setCategory] = useState<string>('')
  const [crossfinOnly, setCrossfinOnly] = useState<boolean>(false)
  const [query, setQuery] = useState<string>('')

  const [analytics, setAnalytics] = useState<LoadState<AnalyticsOverview>>({ status: 'loading' })
  const [funnel, setFunnel] = useState<LoadState<FunnelOverview>>({ status: 'loading' })
  const [codeTab, setCodeTab] = useState<'curl' | 'python' | 'javascript'>('curl')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showMcpConfig, setShowMcpConfig] = useState<boolean>(false)
  const [mcpVerify, setMcpVerify] = useState<LoadState<{ version: string; apiBase: string }> | null>(null)

  const [activeTab, setActiveTab] = useState<TabId>(parseHash)

  useEffect(() => {
    function onHash() { setActiveTab(parseHash()) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const switchTab = useCallback((tab: TabId) => {
    setActiveTab(tab)
    history.replaceState(null, '', `#${tab}`)
    requestAnimationFrame(() => {
      document.querySelector('.tabBar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const [pgEndpoint, setPgEndpoint] = useState<string>('/api/health')
  const [pgLoading, setPgLoading] = useState<boolean>(false)
  const [pgResult, setPgResult] = useState<{
    status: number
    timeMs: number
    body: string
  } | null>(null)
  const [pgError, setPgError] = useState<string | null>(null)

  const pgEndpoints = CROSSFIN_PLAYGROUND_ENDPOINTS

  async function sendPlaygroundRequest() {
    setPgLoading(true)
    setPgResult(null)
    setPgError(null)

    const url = `${apiBase}${pgEndpoint}`
    const t0 = performance.now()

    try {
      const res = await fetch(url)
      const elapsed = Math.round(performance.now() - t0)
      let body: string
      const ct = res.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        const data: unknown = await res.json()
        body = JSON.stringify(data, null, 2)
      } else {
        body = await res.text()
        try {
          const parsed: unknown = JSON.parse(body)
          body = JSON.stringify(parsed, null, 2)
        } catch {
          // not json, keep as-is
        }
      }
      setPgResult({ status: res.status, timeMs: elapsed, body })
    } catch (err) {
      const elapsed = Math.round(performance.now() - t0)
      setPgError(`Request failed after ${elapsed}ms — ${err instanceof Error ? err.message : 'Network error'}`)
    } finally {
      setPgLoading(false)
    }
  }



  useEffect(() => {
    const ctrl = new AbortController()

    void (async () => {
      try {
        const [rs, as] = await Promise.all([
          fetchRegistryStats(ctrl.signal),
          fetchStats(ctrl.signal),
        ])
        setRegistryStats({ status: 'success', data: rs })
        setAgentStats({ status: 'success', data: as })
      } catch (e) {
        if (ctrl.signal.aborted) return
        const msg = e instanceof Error ? e.message : 'Failed to load stats'
        setRegistryStats({ status: 'error', message: msg })
        setAgentStats({ status: 'error', message: msg })
      }
    })()

    void (async () => {
      try {
        const cats = await fetchRegistryCategories(ctrl.signal)
        setCategories({ status: 'success', data: cats })
      } catch (e) {
        if (ctrl.signal.aborted) return
        const msg = e instanceof Error ? e.message : 'Failed to load categories'
        setCategories({ status: 'error', message: msg })
      }
    })()

    void (async () => {
      try {
        const a = await fetchAnalytics(ctrl.signal)
        setAnalytics({ status: 'success', data: a })
      } catch (e) {
        if (ctrl.signal.aborted) return
        const msg = e instanceof Error ? e.message : 'Failed to load analytics'
        setAnalytics({ status: 'error', message: msg })
      }
    })()

    void (async () => {
      try {
        const f = await fetchFunnelOverview(ctrl.signal)
        setFunnel({ status: 'success', data: f })
      } catch (e) {
        if (ctrl.signal.aborted) return
        const msg = e instanceof Error ? e.message : 'Failed to load funnel analytics'
        setFunnel({ status: 'error', message: msg })
      }
    })()

    return () => ctrl.abort()
  }, [])

  const trackFunnel = useCallback((eventName: FunnelEventName, metadata?: Record<string, unknown>) => {
    void trackFunnelEvent({ eventName, source: 'web', metadata }).catch(() => {
      // Ignore tracking failures to avoid breaking UX actions.
    })
  }, [])

  useEffect(() => {
    trackFunnel('mcp_quickstart_view', { section: 'hero' })
  }, [trackFunnel])

  const loadServices = useCallback(async (opts?: { q?: string }) => {
    setServices({ status: 'loading' })
    try {
      const q = (opts?.q ?? '').trim()
      const resp = q
        ? await searchRegistryServices(q, { limit: 200, offset: 0 })
        : await fetchRegistryServices({
            category: category || undefined,
            isCrossfin: crossfinOnly,
            limit: 200,
            offset: 0,
          })

      setServices({ status: 'success', data: { items: resp.data, total: resp.total } })
      setSelected((prev) => {
        if (!prev) return prev
        const next = resp.data.find((s) => s.id === prev.id)
        return next ?? null
      })
    } catch (e) {
      setServices({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load services' })
    }
  }, [category, crossfinOnly])

  useEffect(() => {
    void loadServices({ q: '' })
  }, [loadServices])

  function onSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const q = query.trim()
    void loadServices({ q })
  }



  function relativeTime(dateStr: string): string {
    const now = Date.now()
    const utcStr = dateStr.includes('T') || dateStr.endsWith('Z') ? dateStr : dateStr.replace(' ', 'T') + 'Z'
    const then = new Date(utcStr).getTime()
    const diff = now - then
    if (Number.isNaN(diff) || diff < 0) return 'just now'
    const seconds = Math.floor(diff / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  function responseTimeClass(ms: number): string {
    if (ms < 200) return 'rtFast'
    if (ms < 500) return 'rtMedium'
    return 'rtSlow'
  }

  function copyToClipboard(id: string, text: string) {
    void navigator.clipboard.writeText(text)
      .then(() => {
        setCopiedId(id)
        setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000)
      })
      .catch(() => {
        setCopiedId('copy-failed')
        setTimeout(() => setCopiedId((prev) => (prev === 'copy-failed' ? null : prev)), 2500)
      })
  }

  const analyticsData = analytics.status === 'success' ? analytics.data : null
  const hasAnalyticsData = analyticsData !== null && analyticsData.totalCalls > 0
  const successRate = analyticsData
    ? analyticsData.recentCalls.length > 0
      ? Math.round((analyticsData.recentCalls.filter((c) => c.status === 'success').length / analyticsData.recentCalls.length) * 100)
      : 0
    : 0
  const avgResponseTime = analyticsData
    ? analyticsData.recentCalls.length > 0
      ? Math.round(analyticsData.recentCalls.reduce((sum, c) => sum + c.responseTimeMs, 0) / analyticsData.recentCalls.length)
      : 0
    : 0
  const topServiceName = analyticsData && analyticsData.topServices.length > 0 ? analyticsData.topServices[0].serviceName : '—'
  const maxTopServiceCalls = analyticsData ? Math.max(...analyticsData.topServices.map((s) => s.calls), 1) : 1
  const funnelData = funnel.status === 'success' ? funnel.data : null

  async function verifyMcpSetup() {
    setMcpVerify({ status: 'loading' })
    try {
      const res = await fetch(`${apiBase}/api/health`)
      if (!res.ok) throw new Error(`health_failed:${res.status}`)
      const data = await res.json() as { version?: string }
      const version = String(data?.version ?? '')
      setMcpVerify({ status: 'success', data: { version: version || 'unknown', apiBase } })
      trackFunnel('mcp_install_verify', { method: 'web_verify', ok: true, version: version || null, apiBase })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'verify_failed'
      setMcpVerify({ status: 'error', message: msg })
      trackFunnel('mcp_install_verify', { method: 'web_verify', ok: false, error: msg, apiBase })
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbarInner">
          <button
            type="button"
            className="brand brandButton"
            onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }) }}
          >
            CrossFin
          </button>
          <nav className="nav">
            {TAB_IDS.map((tab) => (
              <a
                key={tab}
                href={`#${tab}`}
                className={activeTab === tab ? 'navActive' : ''}
                onClick={(e) => { e.preventDefault(); switchTab(tab) }}
              >
                {tabLabels[tab]}
              </a>
            ))}
            <a
              href="https://github.com/bubilife1202/crossfin"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a
              href="https://live.crossfin.dev"
              target="_blank"
              rel="noopener noreferrer"
            >
              Live Demo
            </a>
            <a
              href="https://docs.crossfin.dev"
              target="_blank"
              rel="noopener noreferrer"
            >
              Docs
            </a>
          </nav>
        </div>
      </header>

      <main className="content">
        <section className="heroCompact">
          <div className="heroBadge">Cross-Border Crypto Intelligence Layer</div>
          <h1>The only way to <span className="heroAccent">compare every cross-border crypto route</span></h1>
          <p className="heroSub">
            Hundreds of routes exist across exchanges, coins, and chains — but no one compares them all.
            CrossFin aggregates 5 cost layers into a single number per route, finding the optimal path in real-time.
          </p>

          <div className="heroCtas">
            <a className="button primary" href="https://live.crossfin.dev" target="_blank" rel="noopener noreferrer">
              Try Live Demo
            </a>
            <button type="button" className="button" onClick={() => switchTab('developers')}>
              Get Started
            </button>
            <button type="button" className="button" onClick={() => switchTab('services')}>
              Browse Services
            </button>
          </div>

          <div className="heroPills">
            <span className="pill">7 Exchanges</span>
            <span className="pill">11 Bridge Coins</span>
            <span className="pill">x402 Native</span>
            <span className="pill">MCP + ACP</span>
            <span className="pill">35+ APIs</span>
          </div>
        </section>

        <section className="featuresShowcase">
          <div className="featuresGrid">
            <div className="featureCard">
              <div className="featureIcon">&#x21C4;</div>
              <h3>Routing Engine</h3>
              <p>Find the cheapest path across Bithumb, Upbit, Coinone, GoPax, Binance, OKX, and Bybit. Compares 11 bridge coins factoring fees, slippage, and transfer time.</p>
            </div>
            <div className="featureCard">
              <div className="featureIcon">&#x25B2;</div>
              <h3>Kimchi Premium</h3>
              <p>Real-time Korean vs. global price spread for 11 crypto pairs. Arbitrage decisions with EXECUTE/WAIT/SKIP signals and confidence scores.</p>
            </div>
            <div className="featureCard">
              <div className="featureIcon">&#x26A1;</div>
              <h3>x402 Payments</h3>
              <p>No API keys. No subscriptions. Agents pay per call with USDC on Base. $0.01 for FX rates, $0.10 for full routing analysis.</p>
            </div>
            <div className="featureCard">
              <div className="featureIcon">&#x2699;</div>
              <h3>MCP Integration</h3>
              <p>16 tools for Claude Desktop. One command install: npx crossfin-mcp. Works with any MCP-compatible client.</p>
            </div>
          </div>
        </section>

        <section className="mcpLaunch">
          <div className="mcpLaunchHeader">
            <div className="mcpLaunchBadge">MCP Quick Start</div>
            <h2>Add CrossFin MCP in one minute</h2>
            <p>Claude Desktop (and most MCP clients) will launch this command automatically once configured.</p>
          </div>

          <div className="mcpLaunchCommandRow">
            <code className="mcpLaunchCommand">{MCP_NPX_COMMAND}</code>
            <button
              type="button"
              className="miniButton primary"
              onClick={() => {
                copyToClipboard('mcp-command', MCP_NPX_COMMAND)
                trackFunnel('mcp_command_copy', { target: 'mcp_npx' })
              }}
            >
              {copiedId === 'mcp-command' ? '✓ Copied' : 'Copy Command'}
            </button>
            <button
              type="button"
              className="miniButton"
              onClick={() => {
                setShowMcpConfig((prev) => {
                  const next = !prev
                  if (next) {
                    trackFunnel('mcp_config_view', { target: 'claude_config' })
                  }
                  return next
                })
              }}
            >
              {showMcpConfig ? 'Hide Claude Config' : 'View Claude Config'}
            </button>
            <button
              type="button"
              className="miniButton"
              onClick={() => {
                copyToClipboard('mcp-env', MCP_ENV_SNIPPET)
              }}
            >
              {copiedId === 'mcp-env' ? '✓ Copied' : 'Copy Env'}
            </button>
            <button
              type="button"
              className="miniButton"
              onClick={() => void verifyMcpSetup()}
              disabled={mcpVerify?.status === 'loading'}
            >
              {mcpVerify?.status === 'loading' ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              className="miniButton"
              onClick={() => {
                trackFunnel('mcp_guide_open', { target: 'developers_tab' })
                switchTab('developers')
              }}
            >
              Open Full Guide
            </button>
          </div>

          {copiedId === 'copy-failed' ? (
            <div className="analyticsHint">Copy failed. Your browser may block clipboard access.</div>
          ) : null}

          {mcpVerify?.status === 'success' ? (
            <div className="mcpVerifyOk">
              Verified API: <span className="mono">{mcpVerify.data.apiBase}</span> (version {mcpVerify.data.version})
            </div>
          ) : mcpVerify?.status === 'error' ? (
            <div className="mcpVerifyErr">
              Verify failed: {mcpVerify.message}
            </div>
          ) : null}

          {showMcpConfig ? (
            <div className="mcpLaunchConfig">
              <div className="codeBlock">
                <div className="codeBlockHeader">
                  <span className="codeBlockLang">json</span>
                  <button
                    type="button"
                    className="codeBlockCopy"
                    onClick={() => {
                      copyToClipboard('mcp-config', MCP_CLAUDE_CONFIG)
                      trackFunnel('mcp_config_copy', { target: 'claude_config' })
                    }}
                  >
                    {copiedId === 'mcp-config' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="codeBlockPre"><code>{MCP_CLAUDE_CONFIG}</code></pre>
              </div>
            </div>
          ) : null}
        </section>

        <section className="section">
          <div className="statsGrid">
            <div className="statCard">
              <div className="statLabel">Services</div>
              <div className="statValue">
                {registryStats.status === 'success' ? registryStats.data.total : '—'}
              </div>
              <div className="statMeta">
                {registryStats.status === 'success'
                  ? `${registryStats.data.crossfin} CrossFin · ${registryStats.data.external} External`
                  : registryStats.status === 'error'
                    ? registryStats.message
                    : 'Loading…'}
              </div>
            </div>

            <div className="statCard">
              <div className="statLabel">Agents</div>
              <div className="statValue">
                {agentStats.status === 'success' ? agentStats.data.agents : '—'}
              </div>
              <div className="statMeta">
                {agentStats.status === 'success'
                  ? `${agentStats.data.transactions} tx · ${agentStats.data.blocked} blocked`
                  : agentStats.status === 'error'
                    ? agentStats.message
                    : 'Loading…'}
              </div>
            </div>

            <div className="statCard">
              <div className="statLabel">Wallets</div>
              <div className="statValue">
                {agentStats.status === 'success' ? agentStats.data.wallets : '—'}
              </div>
              <div className="statMeta">Budget + circuit breaker supported</div>
            </div>
          </div>
        </section>

        <div className="tabBar">
          {TAB_IDS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`tabBtn ${activeTab === tab ? 'tabBtnActive' : ''}`}
              onClick={() => switchTab(tab)}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>

        {activeTab === 'routing' && (
        <section id="routing" className="section">
          <div className="sectionHeader">
            <h2>Routing Engine</h2>
            <p className="sectionSub">
              Cross-border crypto routing — find the cheapest path across exchanges in real-time
            </p>
          </div>

          <RouteGraph />

          <div style={{
            marginTop: 24,
            padding: '16px 20px',
            background: '#141B2D',
            border: '1px solid #384152',
            borderLeft: '3px solid #FFB800',
            borderRadius: 4,
            maxWidth: 850,
            margin: '24px auto 0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 'bold', color: '#FFB800', letterSpacing: 1 }}>COMING SOON</span>
            </div>
            <div style={{ fontSize: 13, color: '#E2E8F0', lineHeight: 1.6 }}>
              <strong>Graph-based routing algorithm</strong> — Currently scanning 99 routes via brute-force (9 exchanges × 11 coins).
              Next update: Dijkstra shortest-path with liquidity-weighted edges for 1,000+ routes across 20+ exchanges,
              DEX aggregators, and cross-chain bridges. Real-time pruning + predictive timing recommendations.
            </div>
            <div style={{ fontSize: 11, color: '#7B8794', marginTop: 8 }}>
              ETA: March 2025 · Phase 2 of CrossFin Intelligence Layer
            </div>
          </div>
        </section>
        )}

        {activeTab === 'activity' && (
        <section id="activity" className="section">
          <div className="sectionHeader">
            <h2>Activity</h2>
            <p className="sectionSub">API calls and service usage</p>
          </div>

          {analytics.status === 'loading' ? (
            <div className="panelLoading">Loading analytics…</div>
          ) : analytics.status === 'error' ? (
            <div className="activityEmpty">
              <div className="activityEmptyIcon">📊</div>
              <div className="activityEmptyTitle">No API calls yet</div>
              <div className="activityEmptyDesc">Start by calling a service endpoint.</div>
            </div>
          ) : !hasAnalyticsData ? (
            <div className="activityEmpty">
              <div className="activityEmptyIcon">📊</div>
              <div className="activityEmptyTitle">No API calls yet</div>
              <div className="activityEmptyDesc">Start by calling a service endpoint.</div>
            </div>
          ) : (
            <>
              <div className="analyticsStatsGrid">
                <div className="statCard">
                  <div className="statLabel">Total Calls</div>
                  <div className="statValue">{analyticsData.totalCalls.toLocaleString()}</div>
                  <div className="statMeta">{analyticsData.totalServices} services used</div>
                </div>
                <div className="statCard">
                  <div className="statLabel">Success Rate</div>
                  <div className="statValue">{successRate}%</div>
                  <div className="statMeta">{analyticsData.recentCalls.filter((c) => c.status === 'success').length} / {analyticsData.recentCalls.length} recent</div>
                </div>
                <div className="statCard">
                  <div className="statLabel">Top Service</div>
                  <div className="statValue statValueSmall">{topServiceName}</div>
                  <div className="statMeta">{analyticsData.topServices.length > 0 ? `${analyticsData.topServices[0].calls} calls` : '—'}</div>
                </div>
                <div className="statCard">
                  <div className="statLabel">Avg Response</div>
                  <div className="statValue">{avgResponseTime}<span className="statUnit">ms</span></div>
                  <div className="statMeta">across recent calls</div>
                </div>
              </div>

              {funnelData ? (
                <div className="funnelStatsGrid">
                  <div className="statCard">
                    <div className="statLabel">QuickStart Views (7d)</div>
                    <div className="statValue">{funnelData.counts.mcp_quickstart_view.toLocaleString()}</div>
                    <div className="statMeta">{funnelData.uniqueVisitors.toLocaleString()} unique visitors</div>
                  </div>
                  <div className="statCard">
                    <div className="statLabel">Command Copy</div>
                    <div className="statValue">{funnelData.conversion.commandCopyPct}%</div>
                    <div className="statMeta">{funnelData.counts.mcp_command_copy.toLocaleString()} copies</div>
                  </div>
                  <div className="statCard">
                    <div className="statLabel">Config Copy</div>
                    <div className="statValue">{funnelData.conversion.configCopyPct}%</div>
                    <div className="statMeta">{funnelData.counts.mcp_config_copy.toLocaleString()} copies</div>
                  </div>
                  <div className="statCard">
                    <div className="statLabel">Guide Open</div>
                    <div className="statValue">{funnelData.conversion.guideOpenPct}%</div>
                    <div className="statMeta">{funnelData.counts.mcp_guide_open.toLocaleString()} opens</div>
                  </div>
                </div>
              ) : funnel.status === 'error' ? (
                <div className="analyticsHint">Funnel analytics unavailable: {funnel.message}</div>
              ) : (
                <div className="analyticsHint">Loading conversion funnel…</div>
              )}

              <div className="analyticsColumns">
                <div className="analyticsPanel">
                  <div className="analyticsPanelTitle">Recent API Calls</div>
                  <div className="recentCallsList">
                    <div className="recentCallsHeader">
                      <span>Service</span>
                      <span>Status</span>
                      <span>Time</span>
                      <span>When</span>
                    </div>
                    {analyticsData.recentCalls.map((call, i) => (
                      <div key={`${call.serviceId}-${call.createdAt}-${i}`} className="recentCallRow">
                        <span className="recentCallService">{call.serviceName}</span>
                        <span className="recentCallStatus">
                          <span className={`statusDot ${call.status === 'success' ? 'statusSuccess' : 'statusError'}`} />
                          {call.status}
                        </span>
                        <span className={`recentCallTime ${responseTimeClass(call.responseTimeMs)}`}>
                          {call.responseTimeMs}ms
                        </span>
                        <span className="recentCallWhen">{relativeTime(call.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="analyticsPanel">
                  <div className="analyticsPanelTitle">Top Services</div>
                  <div className="topServicesList">
                    {analyticsData.topServices.map((svc) => (
                      <div key={svc.serviceId} className="topServiceRow">
                        <div className="topServiceInfo">
                          <span className="topServiceName">{svc.serviceName}</span>
                          <span className="topServiceCalls">{svc.calls.toLocaleString()} calls</span>
                        </div>
                        <div className="topServiceBar">
                          <div
                            className="topServiceBarFill"
                            style={{ width: `${Math.round((svc.calls / maxTopServiceCalls) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
        )}

        {activeTab === 'services' && (
        <section id="services" className="section">
          <div className="sectionHeader">
            <h2>Services</h2>
            <p className="sectionSub">
              Browse x402 services and Korean market endpoints. Select a service to view details.
            </p>
          </div>

          <div className="serviceControls">
            <form className="serviceSearch" onSubmit={onSearchSubmit}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search (name, provider, category, tags)…"
              />
              <button className="miniButton primary" type="submit">Search</button>
              <button
                className="miniButton"
                type="button"
                onClick={() => {
                  setQuery('')
                  void loadServices({ q: '' })
                }}
              >
                Clear
              </button>
            </form>

            <div className="serviceFilters">
              <label className="filter">
                <span className="filterLabel">Category</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">All</option>
                  {categories.status === 'success'
                    ? categories.data.map((c) => (
                      <option key={c.category} value={c.category}>
                        {c.category} ({c.count})
                      </option>
                    ))
                    : null}
                </select>
              </label>
              <label className="filter toggle">
                <input
                  type="checkbox"
                  checked={crossfinOnly}
                  onChange={(e) => setCrossfinOnly(e.target.checked)}
                />
                <span>CrossFin only</span>
              </label>
              <button className="miniButton" type="button" onClick={() => void loadServices({ q: query.trim() })}>
                Refresh
              </button>
            </div>
          </div>

          <div className="servicesLayout">
            <div className="servicesPanel">
              {services.status === 'loading' ? (
                <div className="panelLoading">Loading services…</div>
              ) : services.status === 'error' ? (
                <div className="panelError">{services.message}</div>
              ) : (
                <div className="servicesGrid">
                  {services.data.items.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`serviceCard ${selected?.id === s.id ? 'active' : ''}`}
                      onClick={() => setSelected(s)}
                    >
                      <div className="serviceCardTop">
                        <div className="serviceName">{s.name}</div>
                        <div className={`servicePrice ${s.isCrossfin ? 'primary' : ''}`}>{s.price}</div>
                      </div>
                      <div className="serviceMeta">
                        <span className="serviceProvider">{s.provider}</span>
                        <span className="dot" aria-hidden>·</span>
                        <span className="serviceCategory">{s.category}</span>
                      </div>
                      <div className="serviceEndpoint">{truncateMiddle(s.endpoint)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <aside className="serviceDetail">
              {selected ? (
                <div className="detailCard">
                  <div className="detailTitle">{selected.name}</div>
                  <div className="detailRow"><span>Provider</span><strong>{selected.provider}</strong></div>
                  <div className="detailRow"><span>Category</span><strong>{selected.category}</strong></div>
                  <div className="detailRow"><span>Price</span><strong>{selected.price} {selected.currency}</strong></div>
                  <div className="detailRow"><span>Network</span><strong>{selected.network ?? '—'}</strong></div>
                  <div className="detailRow"><span>PayTo</span><strong className="mono">{selected.payTo ?? '—'}</strong></div>

                  <div className="detailBlock">
                    <div className="detailBlockLabel">Endpoint</div>
                    <div className="detailEndpoint mono">{selected.endpoint}</div>
                    <div className="detailCtas">
                      <a className="miniButton" href={selected.endpoint} target="_blank" rel="noopener noreferrer">
                        Open
                      </a>
                      <a className="miniButton" href={`${apiBase}/api/openapi.json`} target="_blank" rel="noopener noreferrer">
                        OpenAPI
                      </a>
                    </div>
                  </div>

                  {selected.description ? <div className="detailDesc">{selected.description}</div> : null}

                  {selected.tags.length ? (
                    <div className="tagRow">
                      {selected.tags.map((t) => (
                        <span key={t} className="tag">{t}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="detailEmpty">Select a service to see details.</div>
              )}
            </aside>
          </div>
        </section>
        )}

        {activeTab === 'developers' && (
        <>
        <section id="get-started" className="section">
          <div className="sectionHeader">
            <h2>Get Started</h2>
            <p className="sectionSub">Four steps to start using CrossFin APIs with x402 payments.</p>
          </div>

          <div className="getStartedGrid">
            <div className="stepCard">
              <div className="stepNumber">STEP 01</div>
              <h3 className="stepTitle">Create a Wallet</h3>
              <p className="stepDesc">Generate an EVM wallet to pay for API calls.</p>
              <div className="codeBlock">
                <div className="codeBlockHeader">
                  <span className="codeBlockLang">bash / javascript</span>
                  <button
                    type="button"
                    className="codeBlockCopy"
                    onClick={() => copyToClipboard('step1', "npm install ethers\n\nconst wallet = ethers.Wallet.createRandom()\nconsole.log('Address:', wallet.address)\nconsole.log('Private Key:', wallet.privateKey)")}
                  >
                    {copiedId === 'step1' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="codeBlockPre"><code>{`npm install ethers

const wallet = ethers.Wallet.createRandom()
console.log('Address:', wallet.address)
console.log('Private Key:', wallet.privateKey)`}</code></pre>
              </div>
            </div>

            <div className="stepCard">
              <div className="stepNumber">STEP 02</div>
              <h3 className="stepTitle">Fund with USDC</h3>
              <p className="stepDesc">Send USDC (Base network) to your wallet address.</p>
              <div className="stepDetail">
                <div className="stepDetailRow">
                  <span className="stepDetailLabel">Minimum</span>
                  <span className="stepDetailValue">$0.10 for testing</span>
                </div>
                <div className="stepDetailRow">
                  <span className="stepDetailLabel">Get USDC</span>
                  <span className="stepDetailValue">Coinbase, Binance, or any DEX on Base</span>
                </div>
              </div>
            </div>

            <div className="stepCard stepCardWide">
              <div className="stepNumber">STEP 03</div>
              <h3 className="stepTitle">Call an API</h3>
              <p className="stepDesc">Make your first paid API call using x402.</p>
              <div className="codeTabs">
                <button
                  type="button"
                  className={`codeTabBtn ${codeTab === 'curl' ? 'codeTabActive' : ''}`}
                  onClick={() => setCodeTab('curl')}
                >
                  cURL
                </button>
                <button
                  type="button"
                  className={`codeTabBtn ${codeTab === 'python' ? 'codeTabActive' : ''}`}
                  onClick={() => setCodeTab('python')}
                >
                  Python
                </button>
                <button
                  type="button"
                  className={`codeTabBtn ${codeTab === 'javascript' ? 'codeTabActive' : ''}`}
                  onClick={() => setCodeTab('javascript')}
                >
                  JavaScript
                </button>
              </div>
              {codeTab === 'curl' && (
                <div className="codeBlock">
                  <div className="codeBlockHeader">
                    <span className="codeBlockLang">bash</span>
                    <button
                      type="button"
                      className="codeBlockCopy"
                      onClick={() => copyToClipboard('step3-curl', 'curl https://crossfin.dev/api/premium/market/fx/usdkrw')}
                    >
                      {copiedId === 'step3-curl' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className="codeBlockPre"><code>{`curl https://crossfin.dev/api/premium/market/fx/usdkrw`}</code></pre>
                </div>
              )}
              {codeTab === 'python' && (
                <div className="codeBlock">
                  <div className="codeBlockHeader">
                    <span className="codeBlockLang">python</span>
                    <button
                      type="button"
                      className="codeBlockCopy"
                      onClick={() => copyToClipboard('step3-python', `import os\nfrom eth_account import Account\nfrom x402 import x402ClientSync\nfrom x402.http.clients import x402_requests\nfrom x402.mechanisms.evm import EthAccountSigner\nfrom x402.mechanisms.evm.exact.register import register_exact_evm_client\n\nclient = x402ClientSync()\naccount = Account.from_key(os.environ['EVM_PRIVATE_KEY'])\nregister_exact_evm_client(client, EthAccountSigner(account))\n\nwith x402_requests(client) as session:\n    r = session.get('https://crossfin.dev/api/premium/market/fx/usdkrw')\n    print(r.json())`)}
                    >
                      {copiedId === 'step3-python' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className="codeBlockPre"><code>{`import os
from eth_account import Account
from x402 import x402ClientSync
from x402.http.clients import x402_requests
from x402.mechanisms.evm import EthAccountSigner
from x402.mechanisms.evm.exact.register import register_exact_evm_client

client = x402ClientSync()
account = Account.from_key(os.environ['EVM_PRIVATE_KEY'])
register_exact_evm_client(client, EthAccountSigner(account))

with x402_requests(client) as session:
    r = session.get('https://crossfin.dev/api/premium/market/fx/usdkrw')
    print(r.json())`}</code></pre>
                </div>
              )}
              {codeTab === 'javascript' && (
                <div className="codeBlock">
                  <div className="codeBlockHeader">
                    <span className="codeBlockLang">javascript</span>
                    <button
                      type="button"
                      className="codeBlockCopy"
                      onClick={() => copyToClipboard('step3-js', `import { x402Client, wrapFetchWithPayment } from '@x402/fetch';\nimport { registerExactEvmScheme } from '@x402/evm/exact/client';\nimport { privateKeyToAccount } from 'viem/accounts';\n\nconst signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);\nconst client = new x402Client();\nregisterExactEvmScheme(client, { signer });\n\nconst paidFetch = wrapFetchWithPayment(fetch, client);\nconst res = await paidFetch('https://crossfin.dev/api/premium/market/fx/usdkrw', { method: 'GET' });\nconsole.log(await res.json());`)}
                    >
                      {copiedId === 'step3-js' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className="codeBlockPre"><code>{`import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const client = new x402Client();
registerExactEvmScheme(client, { signer });

const paidFetch = wrapFetchWithPayment(fetch, client);
const res = await paidFetch('https://crossfin.dev/api/premium/market/fx/usdkrw', { method: 'GET' });
console.log(await res.json());`}</code></pre>
                </div>
              )}
            </div>

            <div className="stepCard">
              <div className="stepNumber">STEP 04</div>
              <h3 className="stepTitle">Browse &amp; Discover</h3>
              <p className="stepDesc">
                Search {registryStats.status === 'success' ? registryStats.data.total : '162+'} services in the registry.
              </p>
              <div className="codeBlock">
                <div className="codeBlockHeader">
                  <span className="codeBlockLang">bash</span>
                  <button
                    type="button"
                    className="codeBlockCopy"
                    onClick={() => copyToClipboard('step4', 'curl https://crossfin.dev/api/registry/search?q=crypto')}
                  >
                    {copiedId === 'step4' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="codeBlockPre"><code>{`curl https://crossfin.dev/api/registry/search?q=crypto`}</code></pre>
              </div>
            </div>
          </div>
        </section>

        <section id="playground" className="section">
          <div className="sectionHeader">
            <h2>API Playground</h2>
            <p className="sectionSub">Test free and paid endpoints live — paid routes return 402 until x402 payment is attached</p>
          </div>

          <div className="pgPanel">
            <div className="pgControls">
              <div className="pgSelectWrap">
                <label className="pgLabel" htmlFor="playground-endpoint">Endpoint</label>
                <select
                  id="playground-endpoint"
                  className="pgSelect"
                  value={pgEndpoint}
                  onChange={(e) => setPgEndpoint(e.target.value)}
                >
                  {pgEndpoints.map((ep) => (
                    <option key={ep.path} value={ep.path}>
                      {ep.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="pgSendBtn"
                disabled={pgLoading}
                onClick={() => void sendPlaygroundRequest()}
              >
                {pgLoading ? 'Sending…' : 'Send Request'}
              </button>
            </div>

            <div className="pgUrl">
              <span className="pgUrlMethod">GET</span>
              <span className="pgUrlPath">{apiBase}{pgEndpoint}</span>
            </div>

            <div className="pgResponse">
              {pgLoading ? (
                <div className="pgLoadingState">
                  <div className="pgSpinner" />
                  <span>Waiting for response…</span>
                </div>
              ) : pgError ? (
                <div className="pgErrorState">{pgError}</div>
              ) : pgResult ? (
                <>
                  <div className="pgMeta">
                    <span className={`pgStatus ${pgResult.status < 300 ? 'pgStatus2xx' : pgResult.status < 500 ? 'pgStatus4xx' : 'pgStatus5xx'}`}>
                      {pgResult.status}
                    </span>
                    <span className="pgTime">{pgResult.timeMs}ms</span>
                  </div>
                  <div className="pgBody">
                    <pre className="pgPre"><code>{pgResult.body}</code></pre>
                  </div>
                </>
              ) : (
                <div className="pgEmpty">Select an endpoint and click Send Request</div>
              )}
            </div>
          </div>
        </section>

        <section id="register" className="section">
          <div className="sectionHeader">
            <h2>Register via API</h2>
            <p className="sectionSub">Agents register services programmatically. No forms — just an API call.</p>
          </div>

          <div className="registerGuide">
            <div className="registerStep">
              <div className="registerStepNum">1</div>
              <div className="registerStepContent">
                <h3>POST to the registry</h3>
                <div className="codeBlock">
                  <div className="codeBlockHeader">
                    <span className="codeBlockLang">curl</span>
                  </div>
                  <pre className="codeBlockPre"><code>{`curl -X POST https://crossfin.dev/api/registry \\
  -H "Content-Type: application/json" \\
  -H "X-Agent-Key: your-agent-id" \\
  -d '{
    "name": "My x402 Service",
    "provider": "my-org",
    "category": "ai",
    "endpoint": "https://my-api.com/v1/generate",
    "price": "$0.05",
    "currency": "USDC",
    "network": "eip155:8453",
    "payTo": "0xYourAddress",
    "tags": ["ai", "generation", "x402"]
  }'`}</code></pre>
                </div>
              </div>
            </div>

            <div className="registerStep">
              <div className="registerStepNum">2</div>
              <div className="registerStepContent">
                <h3>Your service is live</h3>
                <p className="registerDesc">Agents worldwide can now discover and pay for your service through CrossFin.</p>
                <div className="codeBlock">
                  <div className="codeBlockHeader">
                    <span className="codeBlockLang">response</span>
                  </div>
                  <pre className="codeBlockPre"><code>{`{
  "data": {
    "id": "svc_abc123",
    "name": "My x402 Service",
    "status": "active",
    "endpoint": "https://my-api.com/v1/generate"
  }
}`}</code></pre>
                </div>
              </div>
            </div>

            <div className="registerStep">
              <div className="registerStepNum">3</div>
              <div className="registerStepContent">
                <h3>Other agents find you</h3>
                <div className="codeBlock">
                  <div className="codeBlockHeader">
                    <span className="codeBlockLang">bash</span>
                  </div>
                  <pre className="codeBlockPre"><code>{`curl "https://crossfin.dev/api/registry/search?q=generation"
# → Your service appears in results`}</code></pre>
                </div>
              </div>
            </div>
          </div>
        </section>
        </>
        )}
      </main>

      <footer className="footer">
        <div className="footerInner">
          <div className="footerTop">
            <span className="footerBrand">CrossFin</span>
            <div className="footerLinks">
              <a
                href="https://github.com/bubilife1202/crossfin"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              <a
                href={`${apiBase}/api/registry`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Registry
              </a>
              <a
                href={`${apiBase}/api/openapi.json`}
                target="_blank"
                rel="noopener noreferrer"
              >
                OpenAPI
              </a>
              <a
                href="https://basescan.org/address/0xe4E79Ce6a1377C58f0Bb99D023908858A4DB5779"
                target="_blank"
                rel="noopener noreferrer"
              >
                BaseScan
              </a>
              <a
                href="https://t.me/crossfinn_bot"
                target="_blank"
                rel="noopener noreferrer"
              >
                Telegram Bot
              </a>
            </div>
          </div>
          <div className="footerBottom">
            Powered by x402 protocol on Base
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App
