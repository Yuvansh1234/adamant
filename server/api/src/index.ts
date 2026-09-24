import { serve } from '@hono/node-server'
import { createApp, type ApiType } from './app.ts'

const app = createApp()

export type { ApiType }

const port = Number(process.env.PORT ?? 8787)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`@adamant/api listening on http://localhost:${info.port}`)
})
