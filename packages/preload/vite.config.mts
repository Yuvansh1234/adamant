import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * A sandboxed preload script must be CommonJS and may only pull in `electron`
 * — no Node built-ins, no bare npm imports. Everything else is inlined here.
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
    target: 'chrome140',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: 'inline',
    lib: {
      entry: fileURLToPath(new URL('src/index.ts', import.meta.url)),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
})
