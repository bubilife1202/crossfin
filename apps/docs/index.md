---
layout: home
hero:
  name: CrossFin
  text: Documentation
  tagline: Route capital across Korean and global exchanges, call paid APIs over x402, and integrate with agents through ACP and MCP.
  actions:
    - theme: brand
      text: Quickstart
      link: /quickstart
    - theme: alt
      text: API Reference
      link: /api
features:
  - title: Routing Engine
    details: Cheapest regional-fiat→stablecoin route across 9 exchanges with 11 bridge coins
  - title: Asian Premium Index
    details: Real-time crypto premium across Korea, Japan, Indonesia, Thailand vs global markets
  - title: MCP Integration
    details: 16 tools for any MCP client — routing, pricing, wallet management
  - title: Telegram Bot
    details: Chat-based access to all CrossFin data via @crossfinn_bot
---

## Core Endpoints

<ApiTable :endpoints="[
  { method: 'GET', path: '/api/route/status', description: 'Exchange network health (live status across 9 exchanges)', price: 'Free' },
  { method: 'GET', path: '/api/route/fees', description: 'Trading + withdrawal fee table', price: 'Free' },
  { method: 'GET', path: '/api/arbitrage/demo', description: 'Top 3 route spread decisions', price: 'Free' },
  { method: 'GET', path: '/api/premium/route/find', description: 'Full optimal route analysis', price: '$0.10' },
]" />

## Base URLs

| Resource | URL |
|----------|-----|
| API | `https://crossfin.dev/api` |
| Live demo | `https://live.crossfin.dev` |
| MCP package | `crossfin-mcp` |

## Supported Exchanges

| Region | Exchanges |
|--------|-----------|
| **Korea** | Bithumb, Upbit, Coinone, GoPax |
| **Regional Fiat** | bitFlyer (JPY), WazirX (INR) |
| **Asian Premium** | bitbank (JPY), Indodax (IDR), Bitkub (THB) |
| **Global** | Binance, OKX, Bybit |
| **Bridge coins** | BTC, ETH, XRP, SOL, DOGE, ADA, DOT, LINK, AVAX, TRX, KAIA |
