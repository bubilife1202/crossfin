import './App.css'
import LiveSignals from './components/LiveSignals'

const API_BASE = 'https://crossfin.dev'

const ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/arbitrage/demo',
    price: 'Free',
    priceClass: 'free',
    description: 'Top 3 kimchi premium pairs (preview). No authentication required.',
  },
  {
    method: 'GET',
    path: '/api/premium/arbitrage/kimchi',
    price: '$0.05',
    priceClass: 'paid',
    description: 'Full kimchi premium index with 10+ trading pairs, premium percentages, and directional signals.',
  },
  {
    method: 'GET',
    path: '/api/premium/arbitrage/opportunities',
    price: '$0.10',
    priceClass: 'paid',
    description: 'Profitable arbitrage opportunities with recommended entry/exit points and estimated returns.',
  },
  {
    method: 'GET',
    path: '/api/premium/bithumb/orderbook?pair=BTC',
    price: '$0.02',
    priceClass: 'paid',
    description: 'Real-time Bithumb orderbook depth. Supports BTC, ETH, XRP, DOGE, and 6+ more pairs.',
  },
  {
    method: 'GET',
    path: '/api/premium/market/korea',
    price: '$0.03',
    priceClass: 'paid',
    description: 'Korean crypto market sentiment analysis derived from exchange volume and premium trends.',
  },
] as const

const STEPS = [
  {
    number: '01',
    title: 'Discover',
    description: 'Explore endpoints via our free demo API or browse the documentation below. No signup needed.',
  },
  {
    number: '02',
    title: 'Pay',
    description: 'Your agent sends USDC on Base via x402 protocol. Standard HTTP 402 flow. No API keys, no OAuth.',
  },
  {
    number: '03',
    title: 'Get Data',
    description: 'Receive real-time Korean exchange data as JSON. Parse, analyze, and act on arbitrage signals.',
  },
] as const

const FEATURES = [
  {
    title: 'Exclusive Korean Data',
    description: 'Direct Bithumb API integration. Data not available elsewhere in the x402 ecosystem. Unique alpha for your trading agents.',
  },
  {
    title: 'Built for Agents',
    description: 'x402 native. HTTP 402 paywall. No auth flows, no API keys, no subscriptions. Agents pay and get data in a single request.',
  },
  {
    title: 'Institutional Grade',
    description: 'Real-time orderbook data, 10+ trading pairs, market sentiment analysis, and actionable arbitrage signals.',
  },
] as const

function App() {
  return (
    <div className="page">
      <header className="topbar">
        <div className="topbarInner">
          <div className="brand">CrossFin</div>
          <nav className="nav">
            <a href="#live-data">Live Data</a>
            <a href="#api">API</a>
            <a href="#pricing">Pricing</a>
            <a
              href="https://github.com/bubilife1202/crossfin"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="content">
        {/* ── Hero ── */}
        <section className="hero">
          <div className="heroBadge">Korean Crypto Arbitrage Data API</div>
          <h1>
            Kimchi Premium Data<br />
            <span className="heroAccent">for Autonomous Agents</span>
          </h1>
          <p className="heroSub">
            AI agents pay per-call with USDC via x402. No API keys. No subscriptions.
            Real-time Korean exchange data delivered over HTTP.
          </p>

          <div className="heroCtas">
            <a className="button primary" href="#live-data">
              View Live Data
            </a>
            <a className="button" href="#api">
              API Docs
            </a>
          </div>

          <div className="heroPills">
            <span className="pill">Live on Base mainnet</span>
            <span className="pill">x402 protocol</span>
            <span className="pill">From $0.02/call</span>
          </div>
        </section>

        {/* ── Live Data ── */}
        <section id="live-data" className="section">
          <div className="sectionHeader">
            <h2>Live Kimchi Premium Data</h2>
            <p className="sectionSub">
              Real-time arbitrage data from our free demo endpoint. This is what your agents will consume.
            </p>
          </div>
          <LiveSignals />
        </section>

        {/* ── API Endpoints ── */}
        <section id="api" className="section">
          <div className="sectionHeader">
            <h2>API Endpoints</h2>
            <p className="sectionSub">
              Base URL: <code className="inlineCode">{API_BASE}</code>
            </p>
          </div>

          <div className="endpointsGrid">
            {ENDPOINTS.map((ep) => (
              <div key={ep.path} className="endpointCard">
                <div className="endpointTop">
                  <span className="endpointMethod">{ep.method}</span>
                  <span className={`endpointPrice ${ep.priceClass}`}>{ep.price}</span>
                </div>
                <div className="endpointPath">{ep.path}</div>
                <div className="endpointDesc">{ep.description}</div>
              </div>
            ))}
          </div>

          <div className="apiNote">
            All paid endpoints return HTTP 402 with x402 payment instructions.
            Your agent completes the USDC payment on Base and re-sends the request with a payment proof header.
          </div>
        </section>

        {/* ── How It Works ── */}
        <section id="pricing" className="section">
          <div className="sectionHeader">
            <h2>How It Works</h2>
            <p className="sectionSub">
              Three steps. No dashboard. No signup. Your agent handles everything.
            </p>
          </div>

          <div className="stepsGrid">
            {STEPS.map((step) => (
              <div key={step.number} className="stepCard">
                <div className="stepNumber">{step.number}</div>
                <h3 className="stepTitle">{step.title}</h3>
                <p className="stepDesc">{step.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Why CrossFin ── */}
        <section className="section">
          <div className="sectionHeader">
            <h2>Why CrossFin</h2>
            <p className="sectionSub">
              The only x402-native Korean crypto data provider.
            </p>
          </div>

          <div className="grid">
            {FEATURES.map((feat) => (
              <article key={feat.title} className="card featureCard">
                <h3>{feat.title}</h3>
                <p>{feat.description}</p>
              </article>
            ))}
          </div>
        </section>
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
                href={`${API_BASE}/api/arbitrage/demo`}
                target="_blank"
                rel="noopener noreferrer"
              >
                API
              </a>
              <a
                href="https://basescan.org/address/0xe4E79Ce6a1377C58f0Bb99D023908858A4DB5779"
                target="_blank"
                rel="noopener noreferrer"
              >
                BaseScan
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
