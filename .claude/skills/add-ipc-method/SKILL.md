---
name: add-ipc-method
description: Add or change a typed method between the Electron renderer and main process (window.adamant). Use when the UI needs data or an action from main, or main needs to push events to the UI. Covers the shared contract, main handler, preload bridge and renderer call, with the security rules.
---

# Adding an IPC method

A method crosses four packages. Change them in this order so the types lead:
`electron/shared` → `electron/main` → `electron/preload` → `electron/adamant`.

## 1. Contract: `electron/shared/src/index.ts`

- Add the channel to `IpcChannel`, named `domain:verb-noun` (e.g. `runs:list`).
- Add payload and result types next to `AppInfo`.
- Add the method to `AdamantApi`.
- This package must not import `electron` or any Node API; the renderer bundles it.

```ts
export const IpcChannel = {
  GetAppInfo: 'app:get-info',
  ListRuns: 'runs:list',
} as const

export interface RunSummary {
  id: string
  status: string
}

export interface AdamantApi {
  getAppInfo(): Promise<AppInfo>
  listRuns(repoId: string): Promise<RunSummary[]>
}
```

## 2. Handler: `electron/main/src/ipc.ts`

- Register with `ipcMain.handle` inside `registerIpcHandlers`.
- **Validate every argument at runtime.** The renderer is untrusted and TypeScript types don't
  exist at runtime.
- Never return secrets (session tokens, installation tokens) to the renderer.
- Throw `Error` with a message that is safe to show in the UI.

```ts
ipcMain.handle(IpcChannel.ListRuns, async (_event, repoId: unknown): Promise<RunSummary[]> => {
  if (typeof repoId !== 'string' || repoId.length === 0) throw new Error('Invalid repo id')
  return listRuns(repoId)
})
```

## 3. Bridge: `electron/preload/src/index.ts`

- Add one explicit method that calls `ipcRenderer.invoke` with a fixed channel.
- Never pass a channel name in from the renderer, and never expose `ipcRenderer` or the IPC event
  object.

```ts
listRuns: (repoId) => ipcRenderer.invoke(IpcChannel.ListRuns, repoId) as Promise<RunSummary[]>,
```

### Events from main to the renderer

Wrap the listener and return an unsubscribe function; don't hand the renderer the raw event:

```ts
onRunUpdate: (callback) => {
  const listener = (_event: IpcRendererEvent, update: RunUpdate) => callback(update)
  ipcRenderer.on(IpcChannel.RunUpdate, listener)
  return () => ipcRenderer.removeListener(IpcChannel.RunUpdate, listener)
},
```

Main sends with `window.webContents.send(IpcChannel.RunUpdate, update)`.

## 4. UI: `electron/adamant/src`

Call `window.adamant.<method>()`. Handle loading and error states, and ignore results after
unmount, as `App.tsx` does with its `cancelled` flag.

## Don't

- Loosen `webPreferences` (`contextIsolation`, `nodeIntegration`, `sandbox`) or the CSP in
  `electron/adamant/index.html`.
- Use Node APIs in the renderer or preload beyond `contextBridge` / `ipcRenderer`.
- Call the backend API from the renderer; add an IPC method that main fulfils instead.

## Check

`pnpm typecheck && pnpm lint && pnpm build`. A missing piece shows up as a type error in the
package you skipped.
