# Tech stack

The backend is planned, not built yet. This records what we chose and why, so the team doesn't
re-argue it. The design it implements is [backend-architecture.md](backend-architecture.md).

## TypeScript everywhere

The desktop app, API, workers and agent are all TypeScript in one pnpm workspace.

- **Types shared from app to server.** Renaming an IPC channel is already a compile error in every
  Electron process. A TypeScript backend extends that to the HTTP API: schemas are written once and
  imported by the API, the workers and the app.
- **The backend is mostly plumbing, not machine learning.** Adamant calls a hosted model. The hard
  parts are webhooks, GitHub App auth, git, job queues and containers, all well served on Node.
  GitHub's own SDK, Octokit, is TypeScript.
- **One toolchain.** One ESLint/Prettier/tsc setup and one CI job, so anyone can work on any part.

The cost: LangGraph's Python version gets features and docs first. Our graph is small and only
needs the core (state graph, interrupts, Postgres checkpoints), which LangGraph.js has. If it gets
in the way, we run the graph as our own state machine on `runs.status`, which is already designed.

We would reconsider only if most of the team were much stronger in Python than TypeScript.

## Components

| Piece                 | Choice                                                              | Notes                                                                 |
| --------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| HTTP API              | [Hono](https://hono.dev) on `@hono/node-server`                     | Typed client for the app; raw body for webhooks; built-in SSE         |
| Validation / contract | `zod`, via `@hono/zod-validator`                                    | One schema package shared by API, workers and app                     |
| GitHub App + webhooks | `@octokit/app`, `@octokit/webhooks`                                 | Installation tokens minted per call; webhook signature checks         |
| Database              | PostgreSQL with Drizzle ORM                                         | Migrations checked in                                                 |
| Job queue             | `graphile-worker`                                                   | Postgres `SKIP LOCKED` plus `LISTEN/NOTIFY` for instant pickup        |
| Agent graph           | `@langchain/langgraph` + `@langchain/langgraph-checkpoint-postgres` | `thread_id = run_id`; `interrupt()` for the approval step             |
| LLM                   | `@anthropic-ai/sdk`, Claude Opus 5                                  | Effort set per step; see [performance.md](performance.md#model-calls) |
| Sandbox               | `dockerode`                                                         | One container per job, as in the architecture doc                     |

`graphile-worker` manages its own job tables, so it replaces the hand-designed `jobs` table in the
architecture doc. Run state stays in `runs`.

### Why Hono

Its RPC mode lets the Electron app import the API's _type_ and call it like a function. A changed
route or payload stops the app compiling, with no code generation:

```ts
// server/api
const app = new Hono().post('/runs', zValidator('json', CreateRunSchema), async (c) => {
  const run = await createRun(c.req.valid('json'))
  return c.json({ runId: run.id }, 202)
})
export type ApiType = typeof app

// electron/main
const api = hc<ApiType>(API_URL)
const res = await api.runs.$post({ json: { repoId, prNumber } })
```

It also reads the raw request body (needed to verify GitHub webhook signatures), streams
Server-Sent Events for the live run view, and is small enough to learn quickly.

**Fastify** is the fallback if we need its plugin ecosystem (auth, rate limiting, OpenAPI docs).
We skip **NestJS** (too heavy for a thin API) and **Express** (older, weaker TypeScript support).

The framework does not affect how fast Adamant fixes things: the API only checks auth, accepts
commands and acknowledges webhooks. The real work happens in the workers.

## Planned layout

```
electron/          existing desktop app (shared, main, preload, adamant)
server/
  api/     @adamant/api       Hono: login, webhooks, commands, live updates
  worker/  @adamant/worker    graphile-worker: graph steps and sandbox jobs
core/
  agent/   @adamant/agent     LangGraph graph + tool gateway; no HTTP code
  contract/ @adamant/contract zod schemas shared by API, worker and app
```

Add `server/*` and `core/*` to `pnpm-workspace.yaml` when these are created.

Two rules keep this layout useful:

1. **`core/agent` must not import the web framework.** The cloud worker and the desktop app's
   local mode both run it.
2. **The app calls the API from the Electron main process**, not the renderer. The session token
   stays in main (stored with Electron's `safeStorage`), and the renderer's Content-Security-Policy
   stays local-only. The renderer reaches the API through a typed IPC method.
