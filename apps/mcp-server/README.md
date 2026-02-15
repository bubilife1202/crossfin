# CrossFin MCP Server

Local MCP server that exposes a minimal agent ledger as tools.

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

Point Claude Desktop to the built output:

```json
{
  "mcpServers": {
    "crossfin": {
      "command": "node",
      "args": ["/ABS/PATH/TO/crossfin/apps/mcp-server/dist/index.js"],
      "env": {
        "CROSSFIN_LEDGER_PATH": "/ABS/PATH/TO/ledger.json",
        "CROSSFIN_API_URL": "https://crossfin.dev"
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
