# CrossFin MCP Server

MCP server for CrossFin — 16 tools for service discovery, local ledger, routing engine, and paid API execution.

## Install (npm)

Use directly with `npx`:

```bash
npx -y crossfin-mcp
```

Or install globally:

```bash
npm i -g crossfin-mcp
crossfin-mcp
```

## Tools

### Local ledger

- `create_wallet`
- `get_balance`
- `transfer`
- `list_transactions`
- `set_budget`

### CrossFin API (live)

- `search_services`
- `list_services`
- `get_service`
- `list_categories`
- `get_kimchi_premium`
- `get_analytics`
- `get_guide`

### Routing engine

- `find_optimal_route` — find optimal crypto transfer route across 6 exchanges
- `list_exchange_fees` — compare trading and withdrawal fees across exchanges
- `compare_exchange_prices` — compare live prices for a coin across Korean exchanges

### Paid execution

- `call_paid_service` — call any CrossFin paid endpoint with automatic x402 USDC payment on Base (requires `EVM_PRIVATE_KEY`)

## Run (dev)

```bash
cd apps/mcp-server
npm install
npm run dev
```

## Ledger storage

By default the server stores data at:

- `~/.crossfin/ledger.json`

Override with:

```bash
export CROSSFIN_LEDGER_PATH="/path/to/ledger.json"
```

## API base URL

By default the server calls the live CrossFin API at `https://crossfin.dev`.

Override with:

```bash
export CROSSFIN_API_URL="https://crossfin.dev"
```

## Claude Desktop config (example)

Use the published npm package:

```json
{
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
}
```

Or point Claude Desktop to the local built output:

```json
{
  "mcpServers": {
    "crossfin": {
      "command": "node",
      "args": ["/ABS/PATH/TO/crossfin/apps/mcp-server/dist/index.js"],
      "env": {
        "CROSSFIN_LEDGER_PATH": "/ABS/PATH/TO/ledger.json",
        "CROSSFIN_API_URL": "https://crossfin.dev",
        "EVM_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Build:

```bash
cd apps/mcp-server
npm run build
```
