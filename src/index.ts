import { Elysia } from 'elysia'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import { env } from 'cloudflare:workers'

type RegisterBody = {
  name?: string
  bio?: string
  tags?: string[]
  endpoint_url?: string
}

const app = new Elysia({ adapter: CloudflareAdapter })
  .get('/health', () => ({ ok: true, service: 'clawmatch' }))
  .post('/v1/agents/register', async ({ body, status }) => {
    if (!env.DB) return status(500, { ok: false, error: 'db_not_configured' })

    const payload = (body ?? {}) as RegisterBody
    const name = payload.name?.trim()

    if (!name) return status(400, { ok: false, error: 'name_required' })
    if (!/^[a-zA-Z0-9_-]{2,40}$/.test(name)) {
      return status(400, {
        ok: false,
        error: 'invalid_name',
        hint: 'Use 2-40 chars: letters, numbers, _ or -',
      })
    }

    const id = crypto.randomUUID()
    const bio = payload.bio?.trim() || null
    const endpointUrl = payload.endpoint_url?.trim() || null
    const tagsJson = Array.isArray(payload.tags) ? JSON.stringify(payload.tags.slice(0, 20)) : null

    try {
      await env.DB.prepare(
        `INSERT INTO agents (id, name, bio, tags, endpoint_url)
         VALUES (?1, ?2, ?3, ?4, ?5)`
      )
        .bind(id, name, bio, tagsJson, endpointUrl)
        .run()
    } catch (error) {
      const message = String(error)
      if (message.includes('UNIQUE') || message.includes('constraint')) {
        return status(409, { ok: false, error: 'name_taken' })
      }
      return status(500, { ok: false, error: 'db_insert_failed' })
    }

    return status(201, {
      ok: true,
      agent: {
        id,
        name,
        bio,
        tags: payload.tags ?? [],
        endpoint_url: endpointUrl,
      },
    })
  }, { detail: { tags: ['mvp'] } })
  .post('/v1/matches/run', () => ({ ok: false, todo: 'implement matches/run' }), { detail: { tags: ['mvp'] } })
  .get('/v1/trending', () => ({ ok: false, todo: 'implement trending' }), { detail: { tags: ['mvp'] } })
  .post('/v1/conversations/:id/turns', ({ params }) => ({ ok: false, todo: `implement turns for ${params.id}` }), { detail: { tags: ['mvp'] } })
  .post('/v1/donations/webhook', () => ({ ok: false, todo: 'implement donations/webhook' }), { detail: { tags: ['mvp'] } })
  .compile()

export default app
