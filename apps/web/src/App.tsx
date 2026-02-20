import { useCallback, useEffect, useState } from 'react'

import './App.css'
import {
  fetchRegistryCategories,
  fetchRegistryServices,
  fetchRegistryStats,
  getApiBaseUrl,
  searchRegistryServices,
  type FunnelEventName,
  type RegistryCategory,
  type RegistryService,
  trackFunnelEvent,
} from './lib/api'
import { CROSSFIN_PLAYGROUND_ENDPOINTS } from './lib/catalog.generated'

type TabId = 'routing' | 'services' | 'developers'

const TAB_IDS: readonly TabId[] = ['routing', 'services', 'developers'] as const
const tabLabels: Record<TabId, string> = { routing: 'Routing', services: 'Services', developers: 'Developers' }
const MCP_NPX_COMMAND = 'npx -y crossfin-mcp'
const MCP_ENV_SNIPPET = `CROSSFIN_API_URL=https://crossfin.dev
EVM_PRIVATE_KEY=0x...`
const MCP_CLIENT_CONFIG = `{
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
  const [categories, setCategories] = useState<LoadState<RegistryCategory[]>>({ status: 'loading' })
  const [services, setServices] = useState<LoadState<{ items: RegistryService[]; total: number }>>({ status: 'loading' })
  const [selected, setSelected] = useState<RegistryService | null>(null)

  const [category, setCategory] = useState<string>('')
  const [crossfinOnly, setCrossfinOnly] = useState<boolean>(false)
  const [query, setQuery] = useState<string>('')

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
        const rs = await fetchRegistryStats(ctrl.signal)
        setRegistryStats({ status: 'success', data: rs })
      } catch (e) {
        if (ctrl.signal.aborted) return
        const msg = e instanceof Error ? e.message : 'Failed to load stats'
        setRegistryStats({ status: 'error', message: msg })
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
            <span className="pill">9 Exchanges</span>
            <span className="pill">11 Bridge Coins</span>
            <span className="pill">x402 Native</span>
            <span className="pill">MCP + ACP</span>
            <span className="pill">35+ APIs</span>
          </div>
        </section>

        <section className="featuresShowcase">
          <h2 className="srOnly">Key Features</h2>
          <div className="featuresGrid">
            <div className="featureCard">
              <div className="featureIcon">&#x21C4;</div>
              <h3>Routing Engine</h3>
              <p>Find the cheapest path across Bithumb, Upbit, Coinone, GoPax, Binance, OKX, Bybit, bitFlyer, and WazirX. Compares 11 bridge coins factoring fees, slippage, and transfer time.</p>
            </div>
            <div className="featureCard">
              <div className="featureIcon">&#x25B2;</div>
              <h3>Asia Premium Monitor</h3>
              <p>Real-time price spreads across Korean, Japanese, and Indian exchanges vs. global markets. 11 crypto pairs with EXECUTE/WAIT/SKIP signals.</p>
            </div>
            <div className="featureCard">
              <div className="featureIcon">&#x26A1;</div>
              <h3>x402 Payments</h3>
              <p>No API keys. No subscriptions. Agents pay per call with USDC on Base. $0.01 for FX rates, $0.10 for full routing analysis.</p>
            </div>
            <div className="featureCard">
              <div className="featureIcon">&#x2699;</div>
              <h3>MCP Integration</h3>
              <p>16 tools for any MCP client. One command install: npx crossfin-mcp. Works with any MCP-compatible client.</p>
            </div>
          </div>
        </section>

        <section className="mcpLaunch">
          <div className="mcpLaunchHeader">
            <div className="mcpLaunchBadge">MCP Quick Start</div>
            <h2>Add CrossFin MCP in one minute</h2>
            <p>Most MCP clients will launch this command automatically once configured.</p>
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
              {showMcpConfig ? 'Hide MCP Config' : 'View MCP Config'}
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
                      copyToClipboard('mcp-config', MCP_CLIENT_CONFIG)
                      trackFunnel('mcp_config_copy', { target: 'claude_config' })
                    }}
                  >
                    {copiedId === 'mcp-config' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="codeBlockPre"><code>{MCP_CLIENT_CONFIG}</code></pre>
              </div>
            </div>
          ) : null}
        </section>

        <div className="tabBar" role="tablist">
          {TAB_IDS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
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

          <div className="routeShowcase">
            <div className="routeShowcaseVisual">
              <div className="routeFlowDiagram">
                <div className="routeFlowNode routeFlowNodeSource">
                  <div className="routeFlowNodeLabel">Source</div>
                  <div className="routeFlowNodeExchanges">Bithumb / Upbit / Coinone / GoPax</div>
                </div>
                <div className="routeFlowArrow">
                  <div className="routeFlowArrowLine" />
                  <div className="routeFlowArrowBridge">11 Bridge Coins</div>
                  <div className="routeFlowArrowLine" />
                </div>
                <div className="routeFlowNode routeFlowNodeDest">
                  <div className="routeFlowNodeLabel">Destination</div>
                  <div className="routeFlowNodeExchanges">Binance / OKX / Bybit / bitFlyer / WazirX</div>
                </div>
              </div>

              <div className="routeFlowLayers">
                <div className="routeFlowLayer">Trading Fees</div>
                <div className="routeFlowLayer">Withdrawal Fees</div>
                <div className="routeFlowLayer">Slippage</div>
                <div className="routeFlowLayer">Transfer Time</div>
                <div className="routeFlowLayer">FX Rate</div>
              </div>
            </div>

            <div className="routeShowcaseInfo">
              <h3 className="routeShowcaseTitle">Compare routes across 9 exchanges, 11 bridge coins</h3>
              <p className="routeShowcaseDesc">
                CrossFin evaluates every possible cross-border path in real-time, aggregating 5 cost layers
                into a single comparable number per route. Find the cheapest way to move crypto between
                Korean, Japanese, Indian, and global exchanges.
              </p>
              <div className="routeShowcaseStats">
                <div className="routeShowcaseStat">
                  <span className="routeShowcaseStatValue">99+</span>
                  <span className="routeShowcaseStatLabel">Routes evaluated</span>
                </div>
                <div className="routeShowcaseStat">
                  <span className="routeShowcaseStatValue">5</span>
                  <span className="routeShowcaseStatLabel">Cost layers</span>
                </div>
                <div className="routeShowcaseStat">
                  <span className="routeShowcaseStatValue">&lt;2s</span>
                  <span className="routeShowcaseStatLabel">Analysis time</span>
                </div>
              </div>
              <div className="routeShowcaseCtas">
                <a
                  className="button primary"
                  href="https://live.crossfin.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Live Demo
                </a>
                <button type="button" className="button" onClick={() => switchTab('developers')}>
                  View API Docs
                </button>
              </div>
            </div>
          </div>
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
                <div className="panelLoading" aria-live="polite">Loading services…</div>
              ) : services.status === 'error' ? (
                <div className="panelError" role="alert">{services.message}</div>
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
                Search {registryStats.status === 'success' ? registryStats.data.total : '184+'} services in the registry.
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
