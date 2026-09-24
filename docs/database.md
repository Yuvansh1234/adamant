# Database execution

How we stand up Postgres for Adamant. The _why_ is in
[backend-architecture.md](backend-architecture.md). The stack choice is in
[tech-stack.md](tech-stack.md). This file is the _do this_ list for R1/R2.

**Owner:** R2 (schema, migrations, run state). R1 owns `docker-compose` and `DATABASE_URL`.
**Done when:** empty DB migrates; `runs.status` is a Postgres enum; `runs.version` exists; someone
can insert a `queued` run. That unblocks `POST /runs` (R3), worker claim (R1), checkpoints (R7),
and `sandbox_results` (R8).

Do not wait for OAuth, LangGraph nodes, or Electron. Do not invent tables that are not below.

---

## What we use

| Piece             | Choice                                     | Notes                                                 |
| ----------------- | ------------------------------------------ | ----------------------------------------------------- |
| Database          | PostgreSQL 16                              | One local instance via Compose                        |
| ORM               | Drizzle                                    | Schema in TypeScript; SQL migrations checked in       |
| Driver            | `pg`                                       | Same pool for API, worker, and LangGraph checkpointer |
| Job queue         | `graphile-worker`                          | **Replaces** the `jobs` table in the architecture ERD |
| Graph checkpoints | `@langchain/langgraph-checkpoint-postgres` | Library tables; `thread_id = run_id`                  |

Run state lives in `runs`. Queue state lives in graphile-worker's own schema. Do not create
`jobs`.

---

## What not to build

- A hand-rolled `jobs` table (`kind`, `locked_by`, `available_at`, …). graphile-worker already
  does `SKIP LOCKED` + `LISTEN/NOTIFY`.
- Columns for GitHub installation tokens, OAuth access tokens, or `Authorization` headers. Mint
  tokens per call; never persist them. Session rows store only `id` + `user_id` + `expires_at`.
- Failure fingerprints, monthly budgets, `.adamant.yml` settings, or review-memory tables. Those
  are post mid-eval (see [mid-eval-backend-plan.md](mid-eval-backend-plan.md) P2).
- Soft-delete. We do not delete runs in v1.
- A second database for the agent. API, worker, and checkpointer share one `DATABASE_URL`.

---

## Package layout

`@adamant/api` must not be the home of the schema. The worker would then import the Hono package.

Add `server/db` as `@adamant/db`. API and worker depend on it. It must not import `hono` or
`@adamant/agent`.

```
server/db/                 @adamant/db
  package.json
  tsconfig.json
  drizzle.config.ts
  src/
    client.ts              getDb(DATABASE_URL) — one Pool
    schema/
      index.ts             re-export every table + enums
      enums.ts             run_status, hitl_decision, sandbox_verdict, …
      users.ts
      sessions.ts
      installations.ts
      repo-bindings.ts
      webhook-deliveries.ts
      runs.ts
      sandbox-results.ts
      hitl-decisions.ts
      tool-invocations.ts
      audit-events.ts
  drizzle/                 generated SQL — commit this
```

`server/*` is already in `pnpm-workspace.yaml`. After creating the package:

```bash
pnpm --filter @adamant/db add drizzle-orm pg
pnpm --filter @adamant/db add -D drizzle-kit @types/pg
pnpm --filter @adamant/api add @adamant/db@workspace:*
```

Scripts on `@adamant/db` (and/or the repo root):

| Script        | Command                           |
| ------------- | --------------------------------- |
| `db:generate` | `drizzle-kit generate`            |
| `db:migrate`  | `drizzle-kit migrate`             |
| `db:studio`   | `drizzle-kit studio` (local only) |

`drizzle.config.ts` points at `src/schema/index.ts`, `drizzle/`, and `process.env.DATABASE_URL`.
Fail closed if the URL is missing.

---

## Local Postgres

R1 lands this first so R2 can migrate. Root `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: adamant
      POSTGRES_PASSWORD: adamant
      POSTGRES_DB: adamant
    ports:
      - '5432:5432'
    volumes:
      - adamant-pg:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U adamant -d adamant']
      interval: 2s
      timeout: 5s
      retries: 10

volumes:
  adamant-pg:
```

Env (`.env` is gitignored; commit `.env.example` at the repo root):

```
DATABASE_URL=postgres://adamant:adamant@localhost:5432/adamant
```

Do not put secrets in `server/api/.env` that are not needed for the API. One root `DATABASE_URL`
is enough for local work.

```bash
docker compose up -d postgres
pnpm --filter @adamant/db db:migrate
```

Done when `psql "$DATABASE_URL" -c '\dt'` lists the Adamant tables below.

---

## Enums

Use Drizzle `pgEnum` so the database rejects illegal values. R10 copies these strings into
`@adamant/contract` zod enums — do not invent a second set.

### `run_status`

From the [run state machine](backend-architecture.md#run-state):

| Value             | Who writes it                  | Meaning                                        |
| ----------------- | ------------------------------ | ---------------------------------------------- |
| `queued`          | API on `POST /runs` or webhook | Job not yet claimed                            |
| `running`         | Graph worker                   | Retrieve / triage / diagnose / plan / patch    |
| `sandboxing`      | Graph worker                   | Waiting on a `sandbox_exec` job                |
| `awaiting_hitl`   | Graph worker                   | Only after a **passing** `sandbox_results` row |
| `opening_pr`      | Graph worker                   | HITL approved; creating the PR                 |
| `awaiting_github` | Graph worker                   | PR open; watching checks / merge               |
| `merged`          | API from `pull_request.closed` | Copied from GitHub. Agent never merges         |
| `failed`          | Worker or API                  | Terminal error (403, attempts exhausted, …)    |
| `aborted`         | API                            | HITL abort or HITL TTL                         |

Legal transitions (enforce in application code, not CHECK constraints beyond the enum):

```
queued → running
running → sandboxing | failed
sandboxing → running | awaiting_hitl | failed
awaiting_hitl → running | opening_pr | aborted
opening_pr → awaiting_github | failed
awaiting_github → merged | failed
```

### `hitl_decision`

`approve` | `request_changes` | `abort`

### `sandbox_verdict`

`pass` | `fail`

Timeouts are `fail`. There is no `error` verdict — treat infra failure as `fail` and fail the run.

### `tool_result_status`

`ok` | `error` | `denied`

`denied` is the fail-closed path (unknown tool, out-of-repo, force-push).

---

## Tables

Types match the architecture ERD. Extra columns are marked **(exec)** — they are for migrate /
debug / the agreed timing work, not a new product idea.

UUID primary keys: `uuid().primaryKey().defaultRandom()`.
Timestamps: `timestamptz`.
Never store secrets in `jsonb`.

### `users`

| Column       | Type        | Constraints                        |
| ------------ | ----------- | ---------------------------------- |
| `id`         | uuid        | PK                                 |
| `github_id`  | bigint      | unique, not null                   |
| `created_at` | timestamptz | not null, default now() **(exec)** |

### `sessions`

The browser/Electron cookie is the session `id`. No token column.

| Column       | Type        | Constraints                                 |
| ------------ | ----------- | ------------------------------------------- |
| `id`         | uuid        | PK                                          |
| `user_id`    | uuid        | not null, FK → `users.id` on delete cascade |
| `expires_at` | timestamptz | not null                                    |
| `created_at` | timestamptz | not null, default now() **(exec)**          |

Index: `sessions_expires_at_idx` on `expires_at` (expiry sweep).

### `installations`

GitHub App installation. Tokens are minted per call and **must not** appear here.

| Column                   | Type        | Constraints                        |
| ------------------------ | ----------- | ---------------------------------- |
| `id`                     | uuid        | PK                                 |
| `github_installation_id` | bigint      | unique, not null                   |
| `created_at`             | timestamptz | not null, default now() **(exec)** |

### `repo_bindings`

A run is allowed only if the session user can access a repo bound to that installation.

| Column            | Type        | Constraints                                |
| ----------------- | ----------- | ------------------------------------------ |
| `id`              | uuid        | PK                                         |
| `installation_id` | uuid        | not null, FK → `installations.id` restrict |
| `github_repo_id`  | bigint      | unique, not null                           |
| `full_name`       | text        | not null (`owner/repo`)                    |
| `created_at`      | timestamptz | not null, default now() **(exec)**         |

Index: `repo_bindings_installation_id_idx` on `installation_id`.

### `runs`

| Column              | Type         | Constraints                                                     |
| ------------------- | ------------ | --------------------------------------------------------------- |
| `id`                | uuid         | PK                                                              |
| `actor_user_id`     | uuid         | not null, FK → `users.id` restrict                              |
| `repo_binding_id`   | uuid         | not null, FK → `repo_bindings.id` restrict                      |
| `status`            | `run_status` | not null, default `queued`                                      |
| `version`           | integer      | not null, default `0`                                           |
| `diagnose_attempts` | integer      | not null, default `0`                                           |
| `base_sha`          | text         | not null (failing commit)                                       |
| `agent_branch`      | text         | not null, `adamant/{run_id}` — adapter sets this, not the model |
| `pr_number`         | integer      | nullable until a PR exists                                      |
| `idempotency_key`   | text         | unique, not null                                                |
| `created_at`        | timestamptz  | not null, default now() **(exec)**                              |
| `updated_at`        | timestamptz  | not null, default now() **(exec)**                              |

`idempotency_key` is `webhook:{delivery_id}` or the client `Idempotency-Key`.

Optimistic HITL: `UPDATE runs SET version = version + 1, … WHERE id = $1 AND version = $2`.
Zero rows → HTTP 409.

HITL without a passing `sandbox_results` row is rejected in the API/worker, not by a DB trigger.

Indexes:

- unique `runs_idempotency_key_uidx` on `idempotency_key`
- `runs_repo_binding_id_idx` on `repo_binding_id`
- `runs_status_idx` on `status`

Cap `diagnose_attempts` in the worker (product default: small integer, e.g. 3). The column is a
counter, not the cap.

### `webhook_deliveries`

Duplicate GitHub deliveries ACK and do not start a second run.

| Column        | Type        | Constraints                                 |
| ------------- | ----------- | ------------------------------------------- |
| `delivery_id` | text        | PK (GitHub `X-GitHub-Delivery`)             |
| `run_id`      | uuid        | nullable, FK → `runs.id` on delete set null |
| `received_at` | timestamptz | not null, default now() **(exec)**          |

`run_id` is null when we ACK a delivery we do not turn into a run (ping, ignored event). Insert
the delivery row **before** creating the run; on unique-violation, return the existing row and
stop.

### `sandbox_results`

| Column         | Type              | Constraints                                 |
| -------------- | ----------------- | ------------------------------------------- |
| `id`           | uuid              | PK                                          |
| `run_id`       | uuid              | not null, FK → `runs.id` restrict           |
| `verdict`      | `sandbox_verdict` | not null                                    |
| `artifact_key` | text              | not null (log object key; not the log body) |
| `created_at`   | timestamptz       | not null, default now() **(exec)**          |

A run may have many rows (one per attempt). HITL is allowed only when the **latest** row is
`pass`. Index: `sandbox_results_run_id_idx` on `run_id`.

Do not put sandbox stdout in this table. Artifacts are files (or object storage later).

### `hitl_decisions`

| Column          | Type            | Constraints                        |
| --------------- | --------------- | ---------------------------------- |
| `id`            | uuid            | PK                                 |
| `run_id`        | uuid            | not null, FK → `runs.id` restrict  |
| `actor_user_id` | uuid            | not null, FK → `users.id` restrict |
| `decision`      | `hitl_decision` | not null                           |
| `created_at`    | timestamptz     | not null, default now() **(exec)** |

Index: `hitl_decisions_run_id_idx` on `run_id`. Keep history; the latest row is the current
decision.

### `tool_invocations`

Written by the tool gateway. Args are redacted **before** insert (no tokens, no `Authorization`,
no `GIT_ASKPASS` output).

| Column          | Type                 | Constraints                                             |
| --------------- | -------------------- | ------------------------------------------------------- |
| `id`            | uuid                 | PK                                                      |
| `run_id`        | uuid                 | not null, FK → `runs.id` restrict                       |
| `tool`          | text                 | not null (`git` / `github` / `actions` / `sandbox`)     |
| `name`          | text                 | not null (allowlisted name, e.g. `get_failed_job_logs`) |
| `args_redacted` | jsonb                | not null                                                |
| `result_status` | `tool_result_status` | not null                                                |
| `created_at`    | timestamptz          | not null, default now() **(exec)**                      |

Index: `tool_invocations_run_id_idx` on `run_id`.

### `audit_events`

Append-only. Every graph step and sandbox job also records timings here
([performance.md](performance.md#measuring)).

| Column       | Type        | Constraints                                                        |
| ------------ | ----------- | ------------------------------------------------------------------ |
| `id`         | bigint      | PK, identity / `bigserial`                                         |
| `run_id`     | uuid        | not null, FK → `runs.id` restrict                                  |
| `action`     | text        | not null (`graph.retrieve`, `sandbox.exec`, `hitl.approve`, …)     |
| `detail`     | jsonb       | not null, default `{}` — redacted; include `attempt` when relevant |
| `at`         | timestamptz | not null, default now() — event time from the ERD                  |
| `started_at` | timestamptz | nullable **(exec, agreed timing)**                                 |
| `ended_at`   | timestamptz | nullable **(exec, agreed timing)**                                 |

Index: `audit_events_run_id_at_idx` on `(run_id, at)`.

SSE (`GET /runs/:id/events`) reads this table (and/or `LISTEN`). Do not put tokens in `detail`.

---

## Tables we do not own

### graphile-worker

Install with the library's own migrate (see its docs). Default schema is `graphile_worker`.
Leave it alone in Drizzle.

Enqueue from `createRun`:

- task name: `graph_step` or `sandbox_exec` (the old `jobs.kind` values)
- payload: `{ runId }` only — no tokens
- `jobKey` / uniqueness: prefer `runId` + kind so a retry does not double-enqueue

Worker death: graphile-worker lock TTL. Resume the LangGraph checkpoint for that `run_id`.

### LangGraph checkpoints

`PostgresSaver.fromConnString(DATABASE_URL)` then `await saver.setup()` once on worker boot.
Library tables (`checkpoints`, …). `thread_id = run_id`. Do not model these in Drizzle. Do not
write tokens into checkpoint state.

---

## Client rules

```ts
// server/db/src/client.ts — sketch
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema/index.ts'

export function createDb(url: string) {
  const pool = new Pool({ connectionString: url })
  return drizzle(pool, { schema })
}
```

- One `Pool` per process (API process, worker process).
- Read `DATABASE_URL` in the process entrypoint; pass it in. Do not import `process.env` from
  random schema files.
- `core/agent` may take a `PostgresSaver` or a connection string from the worker. It still must
  not import Hono.

---

## Application invariants (not DB triggers)

Implement these next to the writes, with tests. Do not encode them as triggers in the first PR.

1. Unknown / out-of-scope tool → `tool_result_status = denied`, run may go `failed`. No retry
   from the sandbox on git/API 403.
2. `awaiting_hitl` only if the latest `sandbox_results.verdict` is `pass`.
3. HITL `UPDATE` must include `version` (409 on mismatch).
4. `agent_branch` is always `adamant/{run_id}`.
5. `merged` is only written from `pull_request.closed`. No code path calls GitHub merge.
6. Redact before persist. A test inserts a fake token in tool args and asserts the stored jsonb
   does not contain it.

---

## How other seats use this

| Seat | After migrate they can                                                 |
| ---- | ---------------------------------------------------------------------- |
| R3   | `insert` `runs` (`queued`) and return 202; later HITL `UPDATE` + 409   |
| R4   | `insert` `webhook_deliveries`; unique `delivery_id` stops double runs  |
| R7   | `PostgresSaver.setup()`; update `runs.status` at each stub node        |
| R8   | `insert` `sandbox_results`                                             |
| R10  | `insert` `tool_invocations` / `audit_events`; zod enums match `pgEnum` |
| R1   | Enqueue `graph_step` after the run row exists                          |

R9 (eval repo) does not need this package.

---

## First PRs (do not combine)

### PR 1 — Compose + `@adamant/db` + Adamant tables

1. Root `docker-compose.yml` + `.env.example`.
2. Create `@adamant/db` with the enums and tables above (no `jobs`).
3. `drizzle-kit generate` and commit `drizzle/`.
4. README / this doc: `docker compose up -d postgres && pnpm --filter @adamant/db db:migrate`.
5. Verify on a throwaway volume: migrate twice (second time is a no-op).

**Out of this PR:** graphile-worker, `POST /runs`, seeds, SSE.

### PR 2 — graphile-worker

On `@adamant/worker` (create the package if needed): depend on `graphile-worker` and
`@adamant/db`. Run the worker's migrate against the same `DATABASE_URL`. Register a no-op
`graph_step` task. Prove: insert a run, enqueue, worker claims in &lt;1s.

### PR 3 — `POST /runs` writes `queued`

R3. Dev user can be a seeded `users` row. No model. Returns 202 + `runId`. Same
`Idempotency-Key` returns the same run.

---

## Seed (later — Phase D)

A small `src/seed.ts` that upserts: one user, one installation, one `repo_bindings` row for the
eval repo. Do **not** block PR 1 on this. Phase D needs `compose down/up` + seed to restore the
demo.

---

## CI

The existing workflow does not need a database job in PR 1. Adding `services: postgres` and
`pnpm --filter @adamant/db db:migrate` as a later CI step is good; it is not the first merge
gate. `pnpm typecheck` must pass on `@adamant/db` as soon as the package exists.

---

## Checklist

- [ ] `docker compose up -d postgres` is documented and healthy
- [ ] `@adamant/db` exists; `@adamant/api` depends on `workspace:*`
- [ ] All enums and tables in this file exist; `jobs` does not
- [ ] First SQL migration is committed
- [ ] `db:migrate` on an empty DB succeeds; a second run is a no-op
- [ ] No token-shaped columns
- [ ] R10's zod enums will use the same string unions
- [ ] graphile-worker and `PostgresSaver` are **not** modeled in Drizzle
- [ ] Someone can `insert` a `queued` run (PR 3)

Grounded in [backend-architecture.md](backend-architecture.md) (ERD, run states, failure table),
[tech-stack.md](tech-stack.md) (Drizzle, graphile-worker), and
[performance.md](performance.md) (`audit_events` timings).
