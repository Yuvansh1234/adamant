import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * The main process is bundled to CommonJS: Electron's entry point stays CJS so
 * that it can sit alongside the sandboxed (CJS-only) preload script.
 */
export default defineConfig({
  // Anchored to this package so `outDir` never follows the caller's cwd
  // (`scripts/dev.mjs` drives these builds from the repo root).
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@adamant/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  build: {
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL('src/index.ts', import.meta.url)),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
})
