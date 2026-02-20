# CrossFin Sample Prompts & Workflows

Ready-to-use prompts for AI agents connected to the CrossFin MCP server (`crossfin-mcp`). Each prompt maps to specific tools and shows expected behavior.

---

## Quick Start (Free Tools)

### Check Route Spread (Kimchi Premium)

```
"What's the Korea premium right now?"
```

Tool: `get_kimchi_premium` | Free | Returns top 3 pairs with premium %, direction, and action signal.

### Compare Exchange Prices

```
"Compare BTC prices between Korean and global exchanges"
```

Tool: `compare_exchange_prices` with `coin: "BTC"` | Free | Shows Bithumb KRW vs Binance USD with transfer time.

```
"Show me all coin prices across exchanges"
```

Tool: `compare_exchange_prices` (no params) | Free | All tracked coins with bridge support indicators.

### Fee Comparison

```
"Compare withdrawal fees for XRP across all exchanges"
```

Tool: `list_exchange_fees` | Free | Trading + withdrawal fees for 9 exchanges (Bithumb, Upbit, Coinone, GoPax, bitFlyer, WazirX, Binance, OKX, Bybit).

### Browse the Service Catalog

```
"What paid services are available?"
```

Tool: `list_categories` | Free | Lists all service categories with counts.

```
"Search for arbitrage-related services"
```

Tool: `search_services` with `query: "arbitrage"` | Free | Returns matching services with pricing and endpoints.

```
"Tell me about the morning brief service"
```

Tool: `get_service` with `serviceId: "crossfin_morning_brief"` | Free | Full details including price, endpoint, and guide.

### Gateway Analytics

```
"How many API calls has CrossFin processed?"
```

Tool: `get_analytics` | Free | Total calls, top services, recent activity.

### Read the Full Guide

```
"Show me the CrossFin API guide"
```

Tool: `get_guide` | Free | Complete agent guide with all endpoints, pricing, and x402 payment flow.

---

## Korean-Language Prompts (한국어 프롬프트)

### 기본 조회 (Free)

```
"김치 프리미엄 얼마야?"
```

도구: `get_kimchi_premium` | 무료 | 상위 3개 코인의 한-글로벌 가격차 표시.

```
"거래소별 XRP 가격 비교해줘"
```

도구: `compare_exchange_prices` (`coin: "XRP"`) | 무료 | 빗썸 KRW vs 바이낸스 USD.

```
"출금 수수료 비교표 보여줘"
```

도구: `list_exchange_fees` | 무료 | 9개 거래소 거래+출금 수수료.

```
"어떤 유료 서비스가 있어?"
```

도구: `list_categories` → `search_services` | 무료 | 카테고리별 서비스 목록.

### 라우팅 (Paid)

```
"빗썸에서 바이낸스로 5000만원 보내는 최적 경로 찾아줘"
```

도구: `find_optimal_route` (`from: "bithumb:KRW"`, `to: "binance:USDC"`, `amount: 50000000`) | $0.10 | 11개 브릿지 코인 비교, 최저비용 경로 추천.

```
"바이낸스에서 업비트로 1000 USDC 보내는 가장 빠른 방법은?"
```

도구: `find_optimal_route` (`from: "binance:USDC"`, `to: "upbit:KRW"`, `amount: 1000`, `strategy: "fastest"`) | $0.10 | XRP/SOL/TRX 등 빠른 코인 우선 추천.

### 유료 서비스 호출

```
"한국 시장 모닝 브리핑 보여줘"
```

도구: `call_paid_service` (`serviceId: "crossfin_morning_brief"`) | $0.20 | 김치프리미엄 + 환율 + KOSPI/KOSDAQ + 주요뉴스.

```
"삼성전자 종합 분석 해줘"
```

도구: `call_paid_service` (`serviceId: "crossfin_stock_brief"`, `params: { "stock": "005930" }`) | $0.10 | 기본분석 + 뉴스 + 투자자 동향 + 공시.

---

## Paid Tool Prompts (Requires EVM_PRIVATE_KEY)

### Optimal Routing

```
"Find the cheapest way to move $50,000 USDC from Bithumb to Binance"
```

Tool: `find_optimal_route` with `from: "bithumb:KRW"`, `to: "binance:USDC"`, `amount: 72500000` (at ~1450 KRW/USD) | $0.10

```
"What's the fastest route from Binance USDC to Coinone KRW?"
```

Tool: `find_optimal_route` with `from: "binance:USDC"`, `to: "coinone:KRW"`, `amount: 1000`, `strategy: "fastest"` | $0.10

### Call Any Paid Service

```
"Get the full kimchi premium data for all coins"
```

Tool: `call_paid_service` with `serviceId: "crossfin_kimchi_premium"` | $0.05

```
"Show me Bithumb's BTC orderbook"
```

Tool: `call_paid_service` with `serviceId: "crossfin_bithumb_orderbook"`, `params: { "pair": "BTC" }` | $0.02

```
"Get today's crypto snapshot"
```

Tool: `call_paid_service` with `serviceId: "crossfin_crypto_snapshot"` | $0.15

---

## Wallet & Budget Management

### Create and Fund a Wallet

```
"Create a trading wallet with 100,000 KRW initial deposit"
```

Tool: `create_wallet` with `label: "trading"`, `initialDepositKrw: 100000` | Free

### Check Balance

```
"What's my wallet balance?"
```

Tool: `get_balance` with `walletId: "<id>"` | Free

### Transfer Funds

```
"Transfer 50,000 KRW from my trading wallet to my savings wallet"
```

Tool: `transfer` with `fromWalletId`, `toWalletId`, `amountKrw: 50000` | Free

### Set Spending Limits

```
"Set a daily budget of 10,000 KRW for API calls"
```

Tool: `set_budget` with `dailyLimitKrw: 10000` | Free

### Review Spending

```
"Show me my recent transactions"
```

Tool: `list_transactions` with optional `walletId`, `limit: 20` | Free

---

## Multi-Step Workflows

### Workflow 1: Daily Arbitrage Scanner

Goal: Identify profitable Korea-Global arbitrage opportunities.

```
"Run a daily arbitrage scan — check the kimchi premium, compare prices,
and if the spread is above 2%, find the optimal transfer route for 10M KRW."
```

Agent steps:
1. `get_kimchi_premium` -- check current spread for top 3 pairs
2. `compare_exchange_prices` -- get full price comparison across all coins
3. If any spread > 2%: `find_optimal_route` with `from: "bithumb:KRW"`, `to: "binance:USDC"`, `amount: 10000000`
4. Agent summarizes: "BTC spread is 3.2%. Route via XRP saves $45 vs BTC direct. Total cost: $12.50."

### Workflow 2: Budget-Controlled Research

Goal: Set up a spending wallet and use paid services within a budget.

```
"Set up a research budget of 5,000 KRW per day, then get the morning
brief and crypto snapshot."
```

Agent steps:
1. `create_wallet` with `label: "research"`, `initialDepositKrw: 50000`
2. `set_budget` with `dailyLimitKrw: 5000`
3. `call_paid_service` with `serviceId: "crossfin_morning_brief"` -- $0.20
4. `call_paid_service` with `serviceId: "crossfin_crypto_snapshot"` -- $0.15
5. `get_analytics` -- verify actual spend

### Workflow 3: Exchange Fee Optimization

Goal: Find the cheapest exchange for a specific coin transfer.

```
"I want to send SOL from Korea to Binance. Compare fees across all
Korean exchanges and recommend the cheapest one."
```

Agent steps:
1. `list_exchange_fees` -- get full fee table
2. `compare_exchange_prices` with `coin: "SOL"` -- check price spread
3. Agent calculates total cost per route (trading fee + withdrawal fee + spread)
4. Agent recommends: "Coinone has the lowest SOL withdrawal fee (0.01 SOL) with 0.20% trading fee."

### Workflow 4: Korean Market Morning Routine

Goal: Complete market overview in one session.

```
"Give me a full Korean market briefing — crypto premium, stock indices,
and top news."
```

Agent steps:
1. `get_kimchi_premium` -- free spread preview
2. `call_paid_service` with `serviceId: "crossfin_morning_brief"` -- $0.20 (KOSPI/KOSDAQ + FX + momentum + headlines)
3. Agent synthesizes: "KOSPI up 1.2%, BTC premium at 2.8% (neutral), USD/KRW at 1,448."

### Workflow 5: Service Discovery and Exploration

Goal: Find and understand available CrossFin services.

```
"What can CrossFin do? Show me all available services organized by category."
```

Agent steps:
1. `list_categories` -- see all categories with counts
2. `list_services` with `category: "crypto-arbitrage"` -- browse specific category
3. `get_service` with `serviceId: "crossfin_kimchi_premium"` -- get details on interesting service
4. `get_guide` -- read the full API guide for advanced usage

---

## Service ID Quick Reference

| Service ID | Price | One-liner |
|---|---|---|
| `crossfin_kimchi_premium` | $0.05 | Route spread for 11 crypto pairs |
| `crossfin_kimchi_premium_history` | $0.05 | Hourly spread snapshots (up to 7 days) |
| `crossfin_arbitrage_opportunities` | $0.10 | FAVORABLE/NEUTRAL/UNFAVORABLE indicators with signalStrength |
| `crossfin_cross_exchange` | $0.08 | 4 Korean exchange price comparison |
| `crossfin_5exchange` | $0.08 | Multi-exchange coin comparison |
| `crossfin_bithumb_orderbook` | $0.02 | Live 30-level orderbook |
| `crossfin_bithumb_volume` | $0.03 | 24h volume analysis |
| `crossfin_upbit_ticker` | $0.02 | Upbit spot ticker |
| `crossfin_upbit_orderbook` | $0.02 | Upbit orderbook snapshot |
| `crossfin_upbit_signals` | $0.05 | Trading signals (momentum, volume, volatility) |
| `crossfin_upbit_candles` | $0.02 | OHLCV candle data |
| `crossfin_coinone_ticker` | $0.02 | Coinone spot ticker |
| `crossfin_exchange_status` | $0.03 | Deposit/withdrawal status |
| `crossfin_korea_sentiment` | $0.03 | Market sentiment (gainers, losers, mood) |
| `crossfin_korea_headlines` | $0.03 | Korean crypto/finance news |
| `crossfin_usdkrw` | $0.01 | USD/KRW exchange rate |
| `crossfin_fx_rate` | $0.01 | KRW/USD with 52-week context |
| `crossfin_korea_indices` | $0.03 | KOSPI & KOSDAQ real-time |
| `crossfin_korea_indices_history` | $0.05 | KOSPI/KOSDAQ daily OHLC (60 days) |
| `crossfin_korea_stocks_momentum` | $0.05 | Top stocks by momentum |
| `crossfin_korea_investor_flow` | $0.05 | Foreign/institutional/individual flow |
| `crossfin_korea_index_flow` | $0.03 | Index-level investor flow |
| `crossfin_korea_stock_detail` | $0.05 | PER, PBR, consensus, peers |
| `crossfin_korea_stock_news` | $0.03 | Stock-specific news |
| `crossfin_korea_themes` | $0.05 | Stock market themes/sectors |
| `crossfin_korea_disclosure` | $0.03 | DART corporate filings |
| `crossfin_korea_etf` | $0.03 | 1,070+ Korean ETFs |
| `crossfin_global_indices_chart` | $0.02 | Global index charts |
| `crossfin_morning_brief` | $0.20 | All-in-one morning market overview |
| `crossfin_crypto_snapshot` | $0.15 | Crypto market snapshot |
| `crossfin_kimchi_stats` | $0.15 | Spread stats + trend + signal |
| `crossfin_stock_brief` | $0.10 | Single stock comprehensive brief |
| `crossfin_route_find` | $0.10 | Optimal cross-exchange route |
