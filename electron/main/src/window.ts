import { join } from 'node:path'
import { BrowserWindow } from 'electron'

/** Vite's dev server URL, injected by `scripts/dev.mjs`; unset in production. */
const devServerUrl = process.env.VITE_DEV_SERVER_URL

const preloadScript = join(__dirname, '../../preload/dist/index.js')
const rendererEntry = join(__dirname, '../../renderer/dist/index.html')

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0d12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: preloadScript,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  // Showing only once the first frame is painted avoids a white flash.
  window.once('ready-to-show', () => window.show())

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
    window.webContents.openDevTools({ mode: 'detach' })
  } else {
    void window.loadFile(rendererEntry)
  }

  return window
}
