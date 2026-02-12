# CrossFin MCP Server

Local MCP server that exposes a minimal agent ledger as tools.

## Tools

- `create_wallet`
- `get_balance`
- `transfer`
- `list_transactions`
- `set_budget`

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

## Claude Desktop config (example)

Point Claude Desktop to the built output:

```json
{
  "mcpServers": {
    "crossfin": {
      "command": "node",
      "args": ["/ABS/PATH/TO/crossfin/apps/mcp-server/dist/index.js"],
      "env": {
        "CROSSFIN_LEDGER_PATH": "/ABS/PATH/TO/ledger.json"
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
