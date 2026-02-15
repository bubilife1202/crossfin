# Changelog

## [1.3.0] - 2026-02-15

### Added

**Agent onboarding + discovery**
- `GET /api/docs/guide` — Structured JSON guide for agents (search, pricing, x402 payment flow, MCP usage)
- Service details for CrossFin services now include `guide`, plus richer `inputSchema` and `outputExample`
- `/.well-known/crossfin.json` — CrossFin discovery metadata for agents and tools

**Registry growth (verified only)**
- Import Einstein AI (emc2ai.io) x402 catalog (104 endpoints) via `.well-known/x402.json`
- `GET /api/registry/sync?confirm=yes` — Insert-only seed sync for adding new providers without wiping the DB

### Changed

**Registry hygiene**
- Disabled 58 dead external services (providers: ouchanip, snack.money, firecrawl, and non-functional x402engine endpoints)
- x402engine seeding now marks known-dead categories/endpoints as `disabled` by default

## [1.2.0] - 2026-02-15

### Changed

**Frontend — Tab-based navigation redesign**
- Replaced linear 7-section scroll with 4-tab layout: Services (default), Live, Developers, Activity
- Compact hero: single-line title, removed pills, CTAs now switch tabs
- Stats ribbon always visible above tabs for at-a-glance metrics
- Nav bar simplified: 6 links → 4 tab switches + GitHub
- Developers tab combines Get Started, Playground, and Register sections
- URL hash sync (#services, #live, #developers, #activity) with browser back/forward support

## [1.1.0] - 2026-02-15

### Added

**Backend — 3 new paid endpoints + cron**
- `GET /api/premium/arbitrage/kimchi/history` ($0.05) — Historical kimchi premium with hourly snapshots, up to 7 days
- `GET /api/premium/bithumb/volume-analysis` ($0.03) — 24h volume distribution, concentration, unusual volume detection
- `GET /api/premium/market/upbit/signals` ($0.05) — Trading signals with momentum, volatility, volume analysis for 6 markets
- `GET /api/cron/snapshot-kimchi` — Cron endpoint to store kimchi premium snapshots to D1
- D1 migration `0003_kimchi_history.sql` — kimchi_snapshots table with indexes

**Frontend**
- API Playground — Interactive endpoint tester with syntax-highlighted JSON responses, status codes, response times
- Navigation link to playground section

**Live Demo Dashboard** (live.crossfin.dev)
- Standalone React app for real-time monitoring
- Auto-refreshing kimchi premium, gateway metrics, service health (15s interval)
- Dark trading-terminal aesthetic with CSS-only charts
- Deployed to Cloudflare Pages (crossfin-live)

### Changed
- Registry: 113 → 116 services (13 CrossFin + 103 external)
- Paid endpoints: 10 → 13
- OpenAPI spec updated with all new endpoints
- README updated with new endpoints, live demo link, project structure

## [1.0.0] - 2026-02-14

### Added

**Backend — 10 paid endpoints + registry + proxy + analytics**
- Kimchi Premium index ($0.05) — 12 pairs across Bithumb vs Binance
- Arbitrage opportunities ($0.10) — Routes with risk scores and net profit calculation
- Bithumb orderbook ($0.02) — 30-level depth with spread analysis
- Korea market sentiment ($0.03) — Top gainers, losers, volume leaders
- USD/KRW exchange rate ($0.01)
- Upbit ticker ($0.02) and orderbook ($0.02)
- Coinone ticker ($0.02)
- Cross-exchange comparison ($0.08) — Bithumb vs Upbit vs Coinone vs Binance
- Korean headlines ($0.03) — Google News RSS feed
- Service Registry — 113 x402 services (search, categories, register)
- Proxy layer — Forward requests with 5% fee + call logging
- Analytics — Overview + per-service stats

**Frontend**
- Gateway dashboard with service browser, analytics, Get Started onboarding
- LiveSignals component for real-time data
- Service registration form

**Infrastructure**
- Cloudflare Workers + D1 + Pages
- crossfin.dev domain
- x402 protocol with USDC on Base mainnet
- Bazaar discovery extension
- OpenAPI 3.1 spec
- GitHub public repo

**Ecosystem**
- x402 ecosystem PR: https://github.com/coinbase/x402/pull/1187
- BlockRun listing: https://github.com/BlockRunAI/awesome-blockrun/issues/5
