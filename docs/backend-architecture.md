# Architecture

Adamant repairs a repository on a working branch, proves the change in a
sealed container, waits for a human, then opens a pull request. GitHub merges
it. The agent does not.

Electron is a client. PostgreSQL holds Adamant state. GitHub holds git objects,
checks, and merge policy (`adamant-protocols`).

```mermaid
flowchart TB
  subgraph clients [Clients]
    Electron[Electron]
    Hooks[GitHub webhooks]
  end

  subgraph controlPlane [Control plane]
    Api[API]
    GraphWorker[Graph worker]
    SandboxWorker[Sandbox worker]
  end

  subgraph stores [Stores]
    Pg[(PostgreSQL)]
    Artifacts[Artifacts]
  end

  subgraph tools [Agent tools]
    GitCli[git CLI]
    GhApi[GitHub API]
    Actions[GitHub Actions]
  end

  subgraph isolation [Sandbox]
    Box[Ephemeral container]
  end

  Electron -->|session| Api
  Hooks -->|HMAC| Api
  Api --> Pg
  GraphWorker --> Pg
  SandboxWorker --> Pg
  GraphWorker --> Artifacts
  SandboxWorker --> Artifacts
  GraphWorker --> GitCli
  GraphWorker --> GhApi
  GraphWorker --> Actions
  GitCli --> GitHub[GitHub]
  GhApi --> GitHub
  Actions --> GitHub
  SandboxWorker --> Box
```

The API authenticates, accepts commands, and ACKs webhooks. It does not run
models or Docker. Workers pull jobs with `FOR UPDATE SKIP LOCKED`.

## Identity

| Principal | Purpose |
| --- | --- |
| User OAuth session | Who clicked heal / HITL |
| GitHub App installation | What the agent may do on a repo |

A run is allowed only if the session user can access a repo bound to that
installation. Installation tokens are minted per call. They are not stored in
Electron, checkpoints, prompts, or the sandbox.

## Agent tools

LangGraph calls **tools**, not raw `child_process` from the model. Every
invocation is allowlisted, logged on `audit_events`, and attributed to
`run_id`. Unknown commands fail closed.

### git (graph worker)

Runs on the graph worker against a per-run worktree. Credentials are provided
through a one-shot `GIT_ASKPASS` helper, then discarded.

Allowed:

- `git fetch`, `git checkout`, `git switch -c`
- `git status`, `git diff`, `git log`, `git show`, `git rev-parse`
- `git add`, `git commit`, `git push` (agent branch only)

Denied: `push` to the default branch, `push --force`, `reset --hard` of
protected refs, `filter-branch` / `rebase` onto default, credential helpers,
`submodule` from untrusted URLs.

Push refspec is computed by the adapter (`refs/heads/adamant/{run_id}`), not
taken from the model.

### GitHub API

REST/GraphQL through the App. Typical tools: contents, compare, commits,
issues, pull requests, review comments, check runs, files changed.

Denied: merge, delete branch on default, admin/ruleset edits, token minting,
anything outside the bound `repo_id`.

### GitHub Actions

Used to **read and wait**, not to replace the sandbox.

| Tool | Use |
| --- | --- |
| `list_workflow_runs` | CI on the agent branch / PR |
| `get_workflow_run` / jobs / logs | Diagnose a red build |
| `rerun_failed_jobs` | After a patch |
| `workflow_dispatch` | Only workflows tagged `adamant-allowed` in repo settings we store |

Actions is CI evidence. Local sandbox is still required before HITL: GitHub
runners are not under our isolation policy.

### git in the sandbox

The container gets a detached worktree with remotes and credentials stripped.
It may run `git diff` / `git log` for tests that shell out to git. It cannot
`push`, `fetch`, or see `GIT_ASKPASS`.

```mermaid
flowchart LR
  Model[LLM] --> Tools[Tool gateway]
  Tools --> GitCli[git allowlist]
  Tools --> GhApi[GitHub API]
  Tools --> Actions[Actions API]
  Tools --> Sandbox[Sandbox job]
  GitCli --> Audit[audit_events]
  GhApi --> Audit
  Actions --> Audit
  Sandbox --> Audit
```

## Run state

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> running
  running --> sandboxing
  sandboxing --> running: tests failed
  sandboxing --> awaiting_hitl: tests passed
  awaiting_hitl --> running: changes requested
  awaiting_hitl --> opening_pr: approved
  awaiting_hitl --> aborted
  opening_pr --> awaiting_github
  awaiting_github --> merged
  awaiting_github --> failed
  running --> failed
```

`merged` is copied from GitHub (`pull_request.closed`). The agent never merges.

HITL without a passing `sandbox_results` row is rejected.

## Graph

```mermaid
flowchart TD
  retrieve[Clone and inspect with git and API] --> diagnose[Diagnose including Actions logs]
  diagnose --> plan[Plan]
  plan --> patch[Commit and push agent branch]
  patch --> sandbox[Sandbox]
  sandbox --> diagnose: fail retries left
  sandbox --> hitl[HITL interrupt]
  hitl --> patch: request_changes
  hitl --> openPr[Open PR]
  hitl --> stop[Abort]
  openPr --> observe[Watch Actions and checks]
```

`diagnose_attempts` is capped on the run.

## Data

```mermaid
erDiagram
  users ||--o{ sessions : has
  installations ||--o{ repo_bindings : covers
  repo_bindings ||--o{ runs : scopes
  users ||--o{ runs : acts
  webhook_deliveries ||--o| runs : mayCreate
  runs ||--o{ jobs : enqueues
  runs ||--o{ sandbox_results : produces
  runs ||--o{ hitl_decisions : requires
  runs ||--o{ tool_invocations : records
  runs ||--o{ audit_events : emits

  users {
    uuid id PK
    bigint github_id UK
  }
  sessions {
    uuid id PK
    uuid user_id FK
    timestamptz expires_at
  }
  installations {
    uuid id PK
    bigint github_installation_id UK
  }
  repo_bindings {
    uuid id PK
    uuid installation_id FK
    bigint github_repo_id UK
    text full_name
  }
  webhook_deliveries {
    text delivery_id PK
    uuid run_id FK
  }
  runs {
    uuid id PK
    uuid actor_user_id FK
    uuid repo_binding_id FK
    text status
    int version
    int diagnose_attempts
    text base_sha
    text agent_branch
    int pr_number
    text idempotency_key UK
  }
  jobs {
    uuid id PK
    uuid run_id FK
    text kind
    int attempts
    timestamptz available_at
    text locked_by
  }
  sandbox_results {
    uuid id PK
    uuid run_id FK
    text verdict
    text artifact_key
  }
  hitl_decisions {
    uuid id PK
    uuid run_id FK
    uuid actor_user_id FK
    text decision
  }
  tool_invocations {
    uuid id PK
    uuid run_id FK
    text tool
    text name
    jsonb args_redacted
    text result_status
  }
  audit_events {
    bigint id PK
    uuid run_id FK
    text action
    jsonb detail
    timestamptz at
  }
```

- `jobs.kind`: `graph_step` | `sandbox_exec`
- LangGraph checkpoints live in library tables, `thread_id = run_id`
- `runs.idempotency_key`: `webhook:{delivery_id}` or client `Idempotency-Key`
- Tool args are redacted before persist (no tokens, no `Authorization`)

## Heal path

```mermaid
sequenceDiagram
  actor User
  participant Api as API
  participant Pg as Postgres
  participant Graph as Graph worker
  participant Tools as Tool gateway
  participant Sandbox as Sandbox worker
  participant GitHub as GitHub

  User ->> Api: POST /runs
  GitHub ->> Api: webhook
  Api ->> Pg: run plus job
  Api -->> User: 202
  Graph ->> Pg: claim SKIP LOCKED
  Graph ->> Tools: git clone fetch checkout
  Graph ->> Tools: Actions logs if CI red
  Graph ->> Tools: git commit push agent branch
  Graph ->> Pg: sandbox_exec job
  Sandbox -->> Pg: verdict
  Graph ->> Pg: awaiting_hitl
  User ->> Api: HITL
  Graph ->> Tools: create pull request
  GitHub ->> Api: PR and Actions webhooks
  Api ->> Pg: merged or failed
```

## Sandbox

Host clones, strips remotes and credentials, then starts the container.

- network off during tests (registry allowlist only for install)
- no `docker.sock`, dropped caps, memory/CPU/PID/time limits
- one container per job, destroyed on exit
- logs go to the artifact store; `verdict` is `pass` or `fail`

## Failure

| Case | What happens |
| --- | --- |
| Duplicate webhook | `delivery_id` PK, ACK, no second run |
| Worker death | lock TTL; resume checkpoint |
| git/API 403 | fail the run; do not retry from the sandbox |
| Actions timeout | treat as fail evidence; sandbox still required |
| HITL TTL | `aborted`; leave the agent branch |
| Optimistic HITL | `runs.version` mismatch → 409 |

## Ruleset

[`adamant-protocols.json`](../adamant-protocols.json) is active but
`conditions.ref_name.include` is empty, so it currently matches no branches.
Set include to `~DEFAULT_BRANCH` before relying on it for `main`.
