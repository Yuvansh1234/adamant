import { serve } from '@hono/node-server'
import { github } from './webhooks/github.js'
import { runs } from './routes/runs.js'
import { activity } from './routes/activity.js'
import { createApp, type ApiType } from './app.js'

const app = createApp()

app.route('/webhooks/github', github)
app.route('/runs', runs)
app.route('/activity', activity)

export type { ApiType }

const port = Number(process.env.PORT ?? 8787)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`@adamant/api listening on http://localhost:${info.port}`)
})
