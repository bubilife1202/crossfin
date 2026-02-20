# A2A Integration Notes

## How to integrate into index.ts

### 1. Import the A2A sub-app

Add this import near the top of `index.ts`:

```typescript
import a2a from './routes/a2a'
```

### 2. Mount the route

Add this line after the app is created (after `const app = new Hono<Env>()`), before or after other routes:

```typescript
app.route('/api/a2a', a2a)
```

This will register:
- `POST /api/a2a/tasks` — Create a new A2A task
- `GET  /api/a2a/tasks/:id` — Get task status/result
- `POST /api/a2a/tasks/:id/cancel` — Cancel a task

### 3. Update agent.json capabilities

In the `/.well-known/agent.json` handler, update `capabilities` to advertise A2A task support:

```typescript
capabilities: {
  streaming: false,
  pushNotifications: false,
  stateTransitionHistory: false,
  a2aTaskEndpoint: '/api/a2a/tasks',  // NEW
},
```

### 4. D1 Migration

Run the migration `0009_a2a_tasks.sql` to create the `a2a_tasks` table.
The route also has a runtime `ensureA2aTable` fallback that creates the table if missing.

### 5. Endpoints Summary

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/a2a/tasks` | Create task: `{ message: string, skill?: string }` |
| GET | `/api/a2a/tasks/:id` | Get task status and result |
| POST | `/api/a2a/tasks/:id/cancel` | Cancel a working task |

### 6. Skill Mapping

| Skill ID | CrossFin API | Description |
|----------|-------------|-------------|
| `crypto-routing` | `GET /api/routing/optimal` | Optimal cross-exchange route |
| `route-spread` | `GET /api/arbitrage/demo` | Kimchi premium / route spread demo |
| `korean-market-data` | `GET /api/route/pairs` | Route pair metadata |
| `agent-finance` | `GET /api/acp/status` | ACP protocol status |

If no `skill` is provided, the system infers it from the message text using keyword matching.
