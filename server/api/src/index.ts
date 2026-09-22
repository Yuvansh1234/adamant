import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono().get('/health', (c) => c.json({ status: 'ok' }))

// The Electron main process imports this type and calls the API through hono/client,
// so a changed route stops the app compiling. See docs/tech-stack.md.
export type ApiType = typeof app

const port = Number(process.env.PORT ?? 8787)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`@adamant/api listening on http://localhost:${info.port}`)
})
