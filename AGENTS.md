# Adamant: notes for coding agents

Adamant is a desktop app plus a planned backend that fixes failing CI: it diagnoses a red build,
proves a fix in a sandbox, and opens a pull request for a human to review. It never merges.

Read before larger changes:

- [docs/product.md](docs/product.md): what we are building and in what order
- [docs/backend-architecture.md](docs/backend-architecture.md): control plane, security model, run
  states
- [docs/tech-stack.md](docs/tech-stack.md): stack decisions and planned layout
- [docs/performance.md](docs/performance.md): speed rules for the run path

## Layout

```
electron/
  shared/   @adamant/shared   IPC contract; imported by every process; must not import electron
  main/     @adamant/main     Electron main process: windows, lifecycle, IPC handlers
  preload/  @adamant/preload  contextBridge; the only main <-> renderer seam
  adamant/  @adamant/renderer React 19 UI, built by Vite
scripts/                      dev orchestrator, skills sync
docs/                         design docs
```

The backend (`server/*`, `core/*`) is planned; see docs/tech-stack.md before creating it.

## Commands

```bash
pnpm install
pnpm dev            # Vite + watch builds + Electron
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Before saying a change is done, run `pnpm typecheck`, `pnpm lint` and `pnpm build`, plus
`pnpm format:check` on the files you touched. Report failures as they are; don't claim a check
passed if you didn't run it.

## Code conventions

- TypeScript strict mode, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Don't
  use `any`, non-null `!` or `@ts-ignore` to get around them.
- Type-only imports use the inline form: `import { type AppInfo } from '@adamant/shared'`.
- Named exports. Default exports only where a tool requires them (Vite configs).
- Prettier: no semicolons, single quotes, 100 columns, trailing commas.
- Comments explain _why_, not what. Match the density of the surrounding file.
- `@adamant/shared` is source-only; it has no build step.

## Security rules (don't break these)

Electron:

- The renderer is untrusted. Keep `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`.
- Never expose `ipcRenderer`, IPC event objects or arbitrary channel names to the renderer. Every
  bridge method is explicit and typed in `@adamant/shared`. Use the `add-ipc-method` skill.
- Validate arguments in main-process IPC handlers; the renderer can send anything.
- Don't loosen the Content-Security-Policy in `electron/adamant/index.html` or allow remote code.
- The renderer does not call the backend directly; main does, and the session token stays in main.

Backend (from docs/backend-architecture.md):

- The agent never merges, force-pushes, or pushes anywhere except `refs/heads/adamant/{run_id}`.
- Every agent tool is allowlisted, logged to `tool_invocations` / `audit_events` with `run_id`, and
  unknown calls fail closed. Use the `add-agent-tool` skill.
- GitHub installation tokens are minted per call and never stored in Electron, checkpoints, prompts,
  logs or the sandbox.
- No approval without a passing `sandbox_results` row.

## Performance

Changes to the worker, agent or sandbox follow the checklist in
[docs/performance.md](docs/performance.md#checklist-for-changes-to-the-run-path). Use the
`performance-review` skill to check a diff against it.

## Skills

Task-specific instructions live in `.agents/skills/` (read natively by Codex and Cursor).
`.claude/skills/` is a generated copy for Claude Code.

| Skill                | Use when                                                  |
| -------------------- | --------------------------------------------------------- |
| `add-ipc-method`     | Adding or changing a method between the renderer and main |
| `add-agent-tool`     | Adding or changing a tool the agent can call              |
| `performance-review` | Reviewing a change to the run path for speed regressions  |
| `write-pull-request` | Writing commit messages, PR titles and PR descriptions    |

Edit skills only in `.agents/skills/`, then run `pnpm skills:sync`.

## Git and pull requests

- Never commit to `main`. Branch as `feat/…`, `fix/…`, `docs/…` or `chore/…`. `adamant/*` is
  reserved for the agent.
- Follow `.github/pull_request_template.md` and the `write-pull-request` skill: short, specific,
  only claims you verified.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for the review and merge flow.
