# Changelog

## [1.7.0] - 2026-02-16

### Added

**12 New Premium API Endpoints — Massive data expansion**

Batch 1 — Deep Korean Market Data:
- `GET /api/premium/market/korea/investor-flow` ($0.05) — 10-day foreign/institutional/individual net buying per stock
- `GET /api/premium/market/korea/index-flow` ($0.03) — KOSPI/KOSDAQ investor flow (foreign/institutional/individual in billion KRW)
- `GET /api/premium/crypto/korea/5exchange` ($0.08) — Compare crypto prices across all 5 Korean exchanges (Upbit, Bithumb, Korbit, Coinone, GoPax)
- `GET /api/premium/crypto/korea/exchange-status` ($0.03) — Bithumb deposit/withdrawal status for all coins
- `GET /api/premium/market/korea/stock-detail` ($0.05) — Comprehensive stock analysis (PER, PBR, EPS, consensus, industry peers)

Batch 2 — News, Themes, Disclosure, FX, ETF:
- `GET /api/premium/market/korea/stock-news` ($0.03) — Stock-specific news from Naver Finance
- `GET /api/premium/market/korea/themes` ($0.05) — Korean stock market themes/sectors with rise/fall counts
- `GET /api/premium/market/korea/disclosure` ($0.03) — Corporate disclosure filings
- `GET /api/premium/crypto/korea/fx-rate` ($0.01) — Real-time KRW/USD rate from Upbit CRIX (52-week high/low)
- `GET /api/premium/market/korea/etf` ($0.03) — 1,070+ Korean ETFs with NAV, price, 3-month returns

Batch 3 — Candles & Global Indices:
- `GET /api/premium/crypto/korea/upbit-candles` ($0.02) — Upbit OHLCV candles (1min to monthly, up to 200)
- `GET /api/premium/market/global/indices-chart` ($0.02) — Global index chart (Dow .DJI, NASDAQ .IXIC, Hang Seng .HSI, Nikkei .N225)

### Changed

- Total premium endpoints: 18 → 30 (all with Bazaar discovery metadata)
- Version bump to 1.7.0
- Updated README with all 30 endpoints

## [1.6.0] - 2026-02-16

### Added

**Korean Stock Market APIs — KOSPI/KOSDAQ data from Naver Finance**

- `GET /api/premium/market/korea/indices` ($0.03) — Real-time KOSPI & KOSDAQ index values (price, change, direction, market status)
- `GET /api/premium/market/korea/indices/history` ($0.05) — Daily OHLC history for KOSPI or KOSDAQ (up to 60 trading days)
- `GET /api/premium/market/korea/stocks/momentum` ($0.05) — Top 10 by market cap, top 5 gainers, top 5 losers on KOSPI/KOSDAQ

**Bazaar Discovery — All 18 premium endpoints now discoverable by x402 agents**

- Added `declareDiscoveryExtension` with input/output schemas to remaining 5 endpoints (report, enterprise, fx/usdkrw, cross-exchange, headlines)
- Total: 18/18 premium endpoints have Bazaar discovery metadata

**Community Listings**

- Submitted to xpaysh/awesome-x402 (PR #22)
- Submitted to Merit-Systems/awesome-x402 (PR #37)

### Changed

- Version bump to 1.6.0
- Improved descriptions for all premium endpoints (more specific, agent-friendly language)

## [1.5.1] - 2026-02-16

### Changed

- Switched x402 facilitator to v2 Base-mainnet compatible endpoint: `https://facilitator.payai.network`
- Removed temporary v1 fallback path for `/api/premium/market/fx/usdkrw`; route is now handled by the shared v2 payment middleware like all premium endpoints
- Updated API-discovery metadata (`x-x402.facilitator`) and public API version strings to `1.5.1`

## [1.5.0] - 2026-02-16

### Added

**x402 v1 Payment Fallback — First real on-chain payment achieved**

- v1 payment fallback for `/api/premium/market/fx/usdkrw` — bypasses broken v2 facilitator, handles verify/settle directly
- `encodeBase64Json()` / `decodeBase64Json()` helper functions for v1 payment header encoding
- Constants: `BASE_MAINNET_V1_NETWORK`, `BASE_USDC_ADDRESS`, `USDKRW_PRICE_ATOMIC`
- Proven on-chain: [basescan tx 0xd8a054...](https://basescan.org/tx/0xd8a05544c6ada7f6eab84675a15dcdb0eeecd38b0d6df4c1e5f42bf26e3226f9)

**Decision Layer — Arbitrage & Cross-Exchange APIs upgraded from data feeds to decision services**

- **Arbitrage Decision Service** (`/api/premium/arbitrage/opportunities` $0.10)
  - `action`: EXECUTE / WAIT / SKIP recommendation per opportunity
  - `confidence`: 0–1 score based on adjusted profit vs risk
  - `slippageEstimatePct`: Real-time slippage estimate from live Bithumb orderbook depth
  - `transferTimeMin`: Per-coin transfer time between exchanges (BTC 20min, XRP 30sec, etc.)
  - `premiumTrend`: rising / falling / stable based on 6-hour kimchi_snapshots history
  - `reason`: Human-readable explanation of the recommendation
  - `executeCandidates`: Top-level count of EXECUTE opportunities
  - `marketCondition`: favorable / neutral / unfavorable overall assessment

- **Cross-Exchange Decision Service** (`/api/premium/market/cross-exchange` $0.08)
  - `action`: ARBITRAGE / HOLD / MONITOR signal per coin
  - `bestBuyExchange`: Cheapest domestic exchange for each coin
  - `bestSellExchange`: Most expensive domestic exchange for each coin
  - `spreadPct`: Domestic exchange spread per coin
  - `arbitrageCandidateCount`: Top-level count of ARBITRAGE signals

### Changed
- OpenAPI spec updated with new decision layer fields and enums
- Service registry descriptions updated to reflect decision service positioning
- Agent guide (`/api/docs/guide`) updated with new output examples and usage instructions

## [1.4.1] - 2026-02-16

### Fixed
- `/api/survival/status` returning 401 — moved route before `agentAuth` middleware on the `api` sub-router so it's publicly accessible
- Wallet transfer race condition (TOCTOU) in `POST /api/transfers` — switched to conditional debit update (`balance_cents >= amount`) and rollback-safe finalization to prevent concurrent overdraw
- Proxy response hardening in `/api/proxy/:serviceId` — block upstream redirects and allowlist passthrough response headers to prevent header injection
- Admin token auth now uses constant-time comparison to reduce timing side-channel risk
- Added public endpoint rate limiting middleware (per-IP + per-route window) to reduce unauthenticated D1 abuse risk
- `ensureRegistrySeeded()` now uses in-memory TTL + in-flight lock to avoid repeated seed checks/fetch bursts on concurrent requests
- Agent API keys are now stored as SHA-256 hashes; legacy plaintext keys auto-migrate to hashed form on first successful auth
- `/api/survival/status` now returns aggregate-only public metrics (removed agent counts and per-call event feed)
- `/api/stats` now returns rounded counters for privacy instead of exact internal totals
- `/api/registry/search` now escapes `%`, `_`, and `\` in LIKE queries (`ESCAPE '\\'`) to prevent wildcard abuse
- CORS allow-methods removed unused `DELETE`
- Corrected SQL `ESCAPE` clause in `/api/registry/search` to keep search endpoint functional after wildcard hardening

### Added
- **Live Dashboard — Agent Survival panel** (`live.crossfin.dev`)
  - ALIVE/STOPPED status badge with pulsing indicator
  - Mini metric cards: Calls Today, Calls This Week, Active Services
  - Scrollable recent events feed (service name, status, response time, relative timestamp)
  - Responsive layout matching existing dark trading-terminal theme

## [1.4.0] - 2026-02-16

### Added

**MCP — paid call execution**
- `call_paid_service` tool (13th MCP tool) — agents can call any CrossFin paid endpoint with automatic x402 USDC payment on Base
- Supports `serviceId` (registry lookup) or direct `url`
- Returns API response + payment proof (`txHash`, `basescan` link, `payer` address)
- Dependencies: `@x402/fetch`, `@x402/evm`, `@x402/core`, `viem`
- Requires `EVM_PRIVATE_KEY` env var (graceful error if missing)

**PRD**
- Rewritten for Guardian Autonomous Growth strategy (v1.4.0)
- Three-engine architecture: Execution (unattended cron), Guardian (ALLOW/SKIP/BLOCK), Growth (flywheel)
- Staged rollout plan: Shadow → Low-risk → Full → Scale

## [1.3.4] - 2026-02-16

### Changed

**Proxy hardening**
- `/api/proxy/:serviceId` now requires `X-Agent-Key` (prevents public abuse and enables per-agent call attribution)
- Added basic per-agent rate limiting for proxy calls (per-agent and per-service per-minute caps)
- Block proxying to IP-literal and private/localhost endpoints (best-effort SSRF mitigation)

**Admin auth**
- Admin token no longer accepted via query string (header/bearer only)

## [1.3.3] - 2026-02-15

### Changed

**Security hardening**
- Protected admin-only endpoints with `CROSSFIN_ADMIN_TOKEN` (header `X-CrossFin-Admin-Token` or `Authorization: Bearer ...`)
- Disabled admin endpoints by default when no admin token is configured
- Removed hardcoded cron key from `/api/cron/snapshot-kimchi`

## [1.3.2] - 2026-02-15

### Changed

**x402 client examples**
- Fixed agent onboarding snippets to use official x402 wrappers: `@x402/fetch` + `wrapFetchWithPayment` (JS) and `x402_requests` / `x402HttpxClient` (Python)
- Removed incorrect `@x402/client`, `payForResponse`, and `pay_for_response` references

**Frontend copy**
- Wallets stat now says "Budget + circuit breaker supported" (avoids implying it's already active)
- Get Started service-count fallback updated to "162+"

**Versioning**
- Bumped public API version to 1.3.2 (health, OpenAPI, agent guide, discovery metadata)

## [1.3.1] - 2026-02-15

### Changed

**Versioning + doc sync**
- Bumped public API version to 1.3.1 (health, OpenAPI, agent guide, discovery metadata)
- Refreshed PRD to match shipped functionality and current service counts
- Updated VISION x402 transaction count (3,500만 → 7,541만)

**Frontend onboarding**
- Developers tab snippets synced with the agent guide
- Get Started copy now uses live registry stats (no hardcoded "60+")

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
- Replaced linear 7-section scroll with 3-tab layout: Services (default), Developers, Activity (Live moved to external link)
- Compact hero: single-line title, removed pills, CTAs now switch tabs
- Stats ribbon always visible above tabs for at-a-glance metrics
- Nav bar simplified: 6 links → 3 tab switches + GitHub + Live Demo link
- Developers tab combines Get Started, Playground, and Register sections
- URL hash sync (#services, #developers, #activity) with browser back/forward support

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
