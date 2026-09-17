/**
 * Development orchestrator.
 *
 * Runs the three halves of the app together: Vite's dev server for the React
 * renderer (with HMR), watch-mode bundles for the main and preload processes,
 * and an Electron instance that is relaunched whenever those bundles change.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { build, createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const configFor = (pkg) =>
  fileURLToPath(new URL(`../packages/${pkg}/vite.config.mts`, import.meta.url))

/** @type {import('node:child_process').ChildProcess | null} */
let electronProcess = null
let shuttingDown = false
let restartTimer = null

const server = await createServer({ configFile: configFor('renderer') })
await server.listen()

const devServerUrl = server.resolvedUrls?.local?.[0]
if (!devServerUrl) {
  throw new Error('Vite dev server started without a local URL')
}
server.config.logger.info('')
server.printUrls()

const watchers = await Promise.all([
  watchPackage('preload', scheduleRestart),
  watchPackage('main', scheduleRestart),
])

startElectron()

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))

/**
 * Bundles a Node-side package in watch mode. Resolves once the first build has
 * landed on disk, so Electron never boots against a missing entry point.
 *
 * @param {'main' | 'preload'} pkg
 * @param {() => void} onRebuild
 */
async function watchPackage(pkg, onRebuild) {
  const watcher = await build({
    configFile: configFor(pkg),
    build: { watch: {} },
    logLevel: 'warn',
  })

  let isFirstBuild = true

  await new Promise((resolve, reject) => {
    watcher.on('event', (event) => {
      if (event.code === 'ERROR') {
        console.error(`[${pkg}] build failed\n`, event.error)
        if (isFirstBuild) reject(event.error)
        return
      }
      if (event.code !== 'END') return

      if (isFirstBuild) {
        isFirstBuild = false
        resolve()
      } else {
        console.log(`[${pkg}] rebuilt — restarting Electron`)
        onRebuild()
      }
    })
  })

  return watcher
}

/** Collapses a burst of rebuilds (main + preload) into a single relaunch. */
function scheduleRestart() {
  if (shuttingDown) return
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => void restartElectron(), 120)
}

function startElectron() {
  // Extra CLI args pass straight through, e.g. `pnpm dev --remote-debugging-port=9222`.
  electronProcess = spawn(electronPath, ['.', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development', VITE_DEV_SERVER_URL: devServerUrl },
  })

  const child = electronProcess
  child.on('exit', (code) => {
    // Quitting the app ends the dev session; a restart-kill does not.
    if (child === electronProcess && !shuttingDown) void shutdown(code ?? 0)
  })
}

async function restartElectron() {
  const previous = electronProcess
  electronProcess = null

  if (previous && previous.exitCode === null) {
    previous.kill()
    await once(previous, 'exit')
  }

  if (!shuttingDown) startElectron()
}

/** @param {number} code */
async function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  clearTimeout(restartTimer)

  const previous = electronProcess
  electronProcess = null
  if (previous && previous.exitCode === null) previous.kill()

  await Promise.allSettled([...watchers.map((w) => w.close()), server.close()])
  process.exit(code)
}
