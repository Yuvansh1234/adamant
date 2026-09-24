# adamant

Self-healing codebase AI agent for developers — part of the IT-314 SWE course project.

A cross-platform desktop app: an Electron shell wrapped around a React renderer, organised
as a pnpm workspace.

## Requirements

- Node.js >= 22.12
- pnpm 10+

```bash
pnpm install
```

## Commands

| Command            | What it does                                                              |
| ------------------ | ------------------------------------------------------------------------- |
| `pnpm dev`         | Vite dev server + watch-mode main/preload builds + Electron, all wired up |
| `pnpm build`       | Production bundles for every package                                      |
| `pnpm start`       | Build, then run Electron against the production bundles                   |
| `pnpm package`     | Build installers into `release/` via electron-builder                     |
| `pnpm package:dir` | Unpacked app directory only (faster, for smoke-testing a build)           |
| `pnpm typecheck`   | `tsc --noEmit` across the workspace                                       |
| `pnpm lint`        | ESLint (flat config)                                                      |
| `pnpm format`      | Prettier                                                                  |
| `pnpm clean`       | Remove build output                                                       |

`pnpm dev` forwards extra arguments to Electron, e.g. `pnpm dev --remote-debugging-port=9222`.

## Layout

```
electron/
  shared/    @adamant/shared   — the IPC contract; imported by all three processes
  main/      @adamant/main     — Electron main process (windows, lifecycle, IPC handlers)
  preload/   @adamant/preload  — the contextBridge; the only main <-> renderer seam
  adamant/   @adamant/renderer — React 19 UI, built by Vite
scripts/dev.mjs                — dev orchestrator (dev server, watchers, Electron restarts)
```

## Docs

| Doc                                                          | Covers                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| [docs/product.md](docs/product.md)                           | What we're building, trust features, roadmap             |
| [docs/backend-architecture.md](docs/backend-architecture.md) | Control plane, GitHub App, sandbox, approval, run states |
| [docs/database.md](docs/database.md)                         | Postgres schema, migrations, Compose, what not to build  |
| [docs/tech-stack.md](docs/tech-stack.md)                     | Stack decisions and planned backend layout               |
| [docs/performance.md](docs/performance.md)                   | Local mode, fast cloud loop, targets, measurement        |
| [CONTRIBUTING.md](CONTRIBUTING.md)                           | Branches, commits, PRs, review and merge                 |
| [AGENTS.md](AGENTS.md)                                       | Instructions for Claude Code, Cursor and Codex           |

Coding agents read `AGENTS.md` and the skills in `.agents/skills/`.

### How the processes fit together

`shared` exports the channel names and payload types. `main` registers handlers against
them, `preload` exposes a narrow typed API on `window.adamant`, and `renderer` calls that
API. Renaming a channel or changing a payload is therefore a compile error on every side
rather than a runtime failure.

`shared` is source-only — it has no build step and is inlined by each consumer's bundler.

### Security posture

The renderer is treated as untrusted:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- `ipcRenderer` is never exposed; only the explicit methods in `AdamantApi` cross the bridge
- a Content-Security-Policy meta tag in `index.html` restricts the renderer to local assets
- navigation away from the app frame and `window.open` are blocked in the main process;
  external URLs are handed to the system browser

The preload bundle is emitted as CommonJS because sandboxed preload scripts cannot be ESM.

## Packaging

`electron-builder.yml` targets dmg/zip (macOS), NSIS (Windows) and AppImage/deb (Linux).
Only the built `dist` folders are packed — all dependencies are bundled by Vite, so no
`node_modules` ship inside the asar.

Two things are still placeholders: there is no app icon (drop `icon.icns` / `icon.ico` /
`icon.png` into `build/`), and macOS builds are unsigned — set the usual `CSC_*` environment
variables to sign and notarise.
