import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type AdamantApi, type AppInfo } from '@adamant/shared'

/**
 * The only bridge between the renderer and Node. Each method is an explicit,
 * typed call — `ipcRenderer` itself is deliberately never handed across.
 */
const api: AdamantApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.GetAppInfo) as Promise<AppInfo>,
}

contextBridge.exposeInMainWorld('adamant', api)
