# MCP Integration

16 tools for any MCP client. Routes across 9 exchanges with 11 bridge coins.

## Install

```bash
npx -y crossfin-mcp
```

npm: [crossfin-mcp](https://www.npmjs.com/package/crossfin-mcp)

## MCP client config

```json
{
  "mcpServers": {
    "crossfin": {
      "command": "npx",
      "args": ["-y", "crossfin-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

No EVM key? Free tools work without one. Paid tools require a Base wallet with USDC.

---

## All 16 Tools

<ToolGrid :tools="[
  { name: 'find_optimal_route', description: 'Optimal path across 9 exchanges', price: '$0.10' },
  { name: 'list_exchange_fees', description: 'Trading + withdrawal fees', price: 'Free' },
  { name: 'compare_exchange_prices', description: 'Bithumb KRW vs Binance USD', price: 'Free' },
  { name: 'get_kimchi_premium', description: 'Route spread data — Korean vs. global price spread (top 3 pairs)', price: 'Free' },
  { name: 'call_paid_service', description: 'Call any paid API with x402', price: 'Varies' },
  { name: 'search_services', description: 'Search registered services', price: 'Free' },
  { name: 'list_services', description: 'Browse service catalog', price: 'Free' },
  { name: 'get_service', description: 'Service details', price: 'Free' },
  { name: 'list_categories', description: 'Service categories', price: 'Free' },
  { name: 'get_guide', description: 'Full agent guide', price: 'Free' },
  { name: 'get_analytics', description: 'Gateway usage stats', price: 'Free' },
  { name: 'create_wallet', description: 'Local ledger wallet', price: 'Free' },
  { name: 'get_balance', description: 'Check wallet balance', price: 'Free' },
  { name: 'transfer', description: 'Transfer between wallets', price: 'Free' },
  { name: 'list_transactions', description: 'Transaction history', price: 'Free' },
  { name: 'set_budget', description: 'Daily spend limit', price: 'Free' },
]" />

---

## Example prompts

> 빗썸에서 바이낸스로 500만원 USDC 만들려면 가장 싼 방법이 뭐야?

> 지금 한국-글로벌 스프레드 얼마야?

> 거래소별 XRP 가격 비교해줘

> 오늘 한국 시장 브리핑해줘
