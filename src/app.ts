import { Elysia } from 'elysia'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import type { RuntimeEnv } from './types/runtime'
import { registerHealthRoutes } from './routes/health'
import { registerOpenApiRoutes } from './routes/openapi'
import { registerAuthRoutes } from './routes/auth'
import { registerBotRoutes } from './routes/bots'
import { registerMatchRoutes } from './routes/matches'
import { registerPublicRoutes } from './routes/public'
import { registerDonationRoutes } from './routes/donations'
import { registerAdminRoutes } from './routes/admin'
import { registerUiRoutes } from './routes/ui'

export const buildApp = (env: RuntimeEnv): Elysia => {
  const app = new Elysia({ adapter: CloudflareAdapter })

  registerHealthRoutes(app)
  registerOpenApiRoutes(app)
  registerAuthRoutes(app, env)
  registerBotRoutes(app, env)
  registerMatchRoutes(app, env)
  registerPublicRoutes(app, env)
  registerDonationRoutes(app, env)
  registerAdminRoutes(app, env)
  registerUiRoutes(app)

  return app
}
