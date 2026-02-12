# CrossFin

Agent-native finance infrastructure.

- Web: landing + local demo ledger (wallets, transfers, budgets, tx log)
- MCP server: local stdio MCP server exposing a minimal wallet/ledger toolset

## Web

```bash
cd apps/web
npm install
npm run dev
```

Build:

```bash
cd apps/web
npm run build
```

## MCP server

```bash
cd apps/mcp-server
npm install
npm run build
npm run start
```

Default ledger file:

- `~/.crossfin/ledger.json`

Override:

```bash
export CROSSFIN_LEDGER_PATH="/path/to/ledger.json"
```

## Deploy (Cloudflare Pages)

Prereq: authenticate once.

```bash
npx wrangler login
```

Deploy the web build:

```bash
cd apps/web
npm run build
npx wrangler pages deploy dist --project-name crossfin
```
