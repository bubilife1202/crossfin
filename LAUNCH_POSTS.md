# CrossFin Launch Posts

시시포스가 복사해서 올릴 수 있도록 준비한 런칭 포스트 모음.

---

## 1. X (Twitter) — 메인 런칭 스레드

### Tweet 1 (Hook)

I built the only MCP server that gives AI agents access to Korean crypto exchanges.

5 exchanges. 11 bridge coins. Real-time routing.
Your agent can now find the cheapest path to move money across Asia — in Korean.

🔗 live.crossfin.dev

### Tweet 2 (Problem)

Korean exchanges trade at different prices than global markets (김치 프리미엄).

The same ETH costs ~3% more on Bithumb than Binance right now.

CrossFin finds which bridge coin minimizes your total transfer cost — across all 5 exchanges simultaneously.

### Tweet 3 (How it works)

How it works:

1. Agent asks "빗썸→바이낸스 500만원 USDC 최적 경로?"
2. CrossFin evaluates 11 bridge coins × 5 exchanges
3. Returns optimal route: AVAX bridge, 0.07% cost, 3 min

All via MCP protocol. Works in Claude Desktop.

### Tweet 4 (Install)

Install in 30 seconds:

```json
{
  "mcpServers": {
    "crossfin": {
      "command": "npx",
      "args": ["-y", "crossfin-mcp"]
    }
  }
}
```

Free tools: routing, kimchi premium, exchange status
Paid tools: $0.01–$0.10 via x402 (USDC on Base)

### Tweet 5 (Links)

📦 npm: crossfin-mcp
🔗 GitHub: github.com/bubilife1202/crossfin
📡 Live demo: live.crossfin.dev
🏛 Anthropic MCP Registry: ✅ registered
🏪 Smithery.ai: ✅ listed

Built solo. Open to feedback.

---

## 2. Reddit r/mcp Post

### Title
I built an MCP server for Korean crypto exchanges — real-time routing across 5 exchanges

### Body

Hey everyone,

I built CrossFin, an MCP server that gives AI agents access to Korean crypto markets.

**The problem:** Korean exchanges (Bithumb, Upbit, Coinone, GoPax) are walled gardens — Korean-language interfaces, IP restrictions, no unified API. If you want to move money from Korea to Binance, you have to manually compare prices across exchanges and pick the right bridge coin.

**What CrossFin does:**
- Evaluates 11 bridge coins × 5 exchanges simultaneously
- Finds the cheapest/fastest route (e.g., "Buy AVAX on Bithumb → transfer to Binance → sell for USDC")
- Real-time kimchi premium tracking
- Works entirely through MCP — your Claude agent can query it in Korean

**Install:**
```json
{
  "mcpServers": {
    "crossfin": {
      "command": "npx",
      "args": ["-y", "crossfin-mcp"]
    }
  }
}
```

**Free tools:** find_optimal_route, get_kimchi_premium, get_exchange_status, get_bridge_coins
**Paid tools (x402):** 35 premium endpoints at $0.01–$0.10/call via USDC on Base

**Links:**
- Live demo: https://live.crossfin.dev
- npm: https://www.npmjs.com/package/crossfin-mcp
- GitHub: https://github.com/bubilife1202/crossfin

Registered on Anthropic MCP Registry + Smithery.ai.

Built this solo. Would love feedback on the routing logic or the MCP tool design.

---

## 3. Reddit r/cryptocurrency Post

### Title
Built a routing engine that finds the cheapest path across Korean exchanges — "kimchi premium" arbitrage for AI agents

### Body

Korean crypto exchanges consistently trade at different prices from global markets — this is called the "kimchi premium" (김치 프리미엄). Right now, ETH on Bithumb is ~3% higher than Binance.

I built CrossFin, a routing engine that:

1. Pulls real-time prices from 5 exchanges (Bithumb, Upbit, Coinone, GoPax, Binance)
2. Evaluates 11 bridge coins (XRP, SOL, AVAX, TRX, etc.)
3. Calculates total cost (trading fees + withdrawal fees + spread)
4. Returns the optimal route

Example: ₩5,000,000 from Bithumb → Binance USDC
- Best route: AVAX bridge → $3,452 USDC (0.07% cost, 3 min)
- Worst route: BTC bridge → $3,421 USDC (0.97% cost, 21 min)
- **Difference: $31** just by picking the right coin

It's built as an MCP server so AI agents (Claude, etc.) can query it directly. Free to try:

🔗 https://live.crossfin.dev (live routing demo)
📦 npm install: `npx crossfin-mcp`

Paid APIs use x402 protocol (USDC micropayments on Base chain).

---

## 4. Discord (MCP / AI Agent communities)

### Message

**CrossFin MCP Server — Korean Crypto Exchange Router**

Just shipped an MCP server that connects AI agents to Korean crypto markets.

🔑 **What it does:**
→ Routes money across 5 Korean exchanges + Binance
→ Evaluates 11 bridge coins to find cheapest path
→ Real-time kimchi premium data
→ Korean language support (agents can query in 한국어)

⚡ **Quick install:**
```
npx crossfin-mcp
```

💰 **Pricing:**
→ Free: routing, premium data, exchange status
→ Paid ($0.01–$0.10): 35 premium endpoints via x402/USDC

📡 **Try it live:** https://live.crossfin.dev

Registered on Anthropic MCP Registry + Smithery.ai. Feedback welcome!

---

## 5. x402 커뮤니티 등록 방법

### A. awesome-x402 GitHub PR (2개 레포)

**레포 1:** https://github.com/xpaysh/awesome-x402
**레포 2:** https://github.com/Merit-Systems/awesome-x402

두 레포 모두에 PR을 올려서 CrossFin을 추가.

추가할 내용 (README.md의 적절한 섹션에):

```markdown
- [CrossFin](https://crossfin.dev) — AI agent router for Korean crypto exchanges. Routes across 5 exchanges × 11 bridge coins with real-time kimchi premium data. MCP + x402 native. ([npm](https://www.npmjs.com/package/crossfin-mcp))
```

### B. x402.org/ecosystem 등록

x402.org 공식 에코시스템 페이지에 등록 요청.
방법: x402 Foundation에 직접 연락 또는 Coinbase x402 GitHub에 이슈/PR.

**x402 Foundation 연락처 확인 필요** — x402.org 사이트에서 submit/contact 찾아보기.

### C. GitHub Topics

CrossFin 레포에 아래 토픽 태그 추가:
`x402`, `mcp`, `crypto`, `korean-exchange`, `arbitrage`, `ai-agent`, `usdc`, `base-chain`

시시포스가 Settings → Topics에서 추가 가능.
