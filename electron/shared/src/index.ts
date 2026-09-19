/**
 * The contract between the Electron main process and the renderer.
 *
 * Both sides import from here, so a channel rename or a payload change is a
 * type error rather than a runtime surprise. Nothing in this package may
 * import `electron` — it is bundled into the renderer as well.
 */

export const IpcChannel = {
  GetAppInfo: 'app:get-info',
} as const

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel]

export interface AppInfo {
  name: string
  version: string
  /** `process.platform`, e.g. `darwin`, `win32`, `linux`. */
  platform: string
  arch: string
  isPackaged: boolean
  versions: {
    electron: string
    chrome: string
    node: string
    v8: string
  }
}

/** The surface `preload` exposes on `window.adamant`. */
export interface AdamantApi {
  getAppInfo(): Promise<AppInfo>
}

declare global {
  interface Window {
    adamant: AdamantApi
  }
}
