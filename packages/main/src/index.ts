import { app, BrowserWindow, shell } from 'electron'
import { registerIpcHandlers } from './ipc'
import { createMainWindow } from './window'

// A second launch should focus the running window instead of starting a rival
// instance that fights over the same workspace state.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  hardenWebContents()

  app.whenReady().then(() => {
    registerIpcHandlers()
    createMainWindow()

    // macOS keeps the process alive after the last window closes.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

/**
 * Renderer content must never be able to navigate the app frame elsewhere or
 * spawn unaudited windows; external links go to the user's real browser.
 */
function hardenWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (url !== contents.getURL()) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })

    contents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}
