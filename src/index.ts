import { Elysia } from 'elysia'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'

export interface Env {
  DB: D1Database
}

const app = new Elysia({ adapter: CloudflareAdapter })
  .get('/health', () => ({ ok: true, service: 'clawmatch' }))
  .post('/v1/agents/register', () => ({ ok: false, todo: 'implement agents/register' }), { detail: { tags: ['mvp'] } })
  .post('/v1/matches/run', () => ({ ok: false, todo: 'implement matches/run' }), { detail: { tags: ['mvp'] } })
  .get('/v1/trending', () => ({ ok: false, todo: 'implement trending' }), { detail: { tags: ['mvp'] } })
  .post('/v1/conversations/:id/turns', ({ params }) => ({ ok: false, todo: `implement turns for ${params.id}` }), { detail: { tags: ['mvp'] } })
  .post('/v1/donations/webhook', () => ({ ok: false, todo: 'implement donations/webhook' }), { detail: { tags: ['mvp'] } })
  .compile()

export default app
