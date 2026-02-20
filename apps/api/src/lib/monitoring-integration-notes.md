# Error Monitoring Integration Notes

This document explains how to wire the monitoring module into the existing CrossFin API.

## 1. Run the migration

Apply `migrations/0010_error_monitoring.sql` to the D1 database:

```bash
npx wrangler d1 execute crossfin-db --file=migrations/0010_error_monitoring.sql
```

## 2. Add `recordError()` to the global error handler

In `src/index.ts`, import the function and call it inside `app.onError`:

```typescript
import { recordError } from './lib/monitoring'

app.onError(async (err, c) => {
  const statusCode = err instanceof HTTPException ? err.status : 500
  const message = err instanceof Error ? err.message : 'Internal server error'
  const endpoint = c.req.path

  // Fire-and-forget error recording (don't block the response)
  c.executionCtx.waitUntil(
    recordError(c.env.DB, endpoint, statusCode, message, 'api_handler').catch(() => {})
  )

  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})
```

## 3. Add `checkErrorRateAndAlert()` to the cron handler

In the `scheduled()` export, add after the uptime check section:

```typescript
import { checkErrorRateAndAlert } from './lib/monitoring'

// Inside scheduled():
// 4. Error rate alerting
if (botToken && adminChatId) {
  await checkErrorRateAndAlert(env.DB, botToken, adminChatId, 10)  // 10% threshold
}
```

## 4. Register the `/status` route

In `src/index.ts`, import and mount the status route:

```typescript
import statusRoutes from './routes/status'

// Place this BEFORE app.route('/api', api) and AFTER app.onError
app.route('/api/status', statusRoutes)
```

This makes the status page available at `GET /api/status`.

## 5. Optional: record errors in external fetch helpers

In `src/lib/fetchers.ts`, you can also track external API failures:

```typescript
import { recordError } from './monitoring'

// In catch blocks of external fetch calls:
recordError(db, 'external/bithumb', 0, error.message, 'external_fetch').catch(() => {})
```
