import { Elysia } from 'elysia'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import { env } from 'cloudflare:workers'

type RegisterBody = {
  name?: string
  bio?: string
  tags?: string[]
  endpoint_url?: string
}

type MatchRunBody = {
  pool_id?: string
  agent_a_id?: string
  agent_b_id?: string
}

type AgentRow = {
  id: string
  name: string
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
  .post('/v1/matches/run', async ({ body, status }) => {
    if (!env.DB) return status(500, { ok: false, error: 'db_not_configured' })

    const payload = (body ?? {}) as MatchRunBody

    let agentAId = payload.agent_a_id?.trim() || ''
    let agentBId = payload.agent_b_id?.trim() || ''

    if (agentAId && agentBId && agentAId === agentBId) {
      return status(400, { ok: false, error: 'same_agent_pair_not_allowed' })
    }

    if (!agentAId || !agentBId) {
      const rows = await env.DB.prepare(
        `SELECT id, name FROM agents ORDER BY created_at DESC LIMIT 50`
      ).all<AgentRow>()

      const agents = (rows.results ?? []) as AgentRow[]
      if (agents.length < 2) {
        return status(400, {
          ok: false,
          error: 'not_enough_agents',
          hint: 'register at least 2 agents first',
        })
      }

      const shuffled = [...agents].sort(() => Math.random() - 0.5)
      agentAId = agentAId || shuffled[0].id
      agentBId = agentBId || shuffled.find((a) => a.id !== agentAId)?.id || ''
    }

    if (!agentAId || !agentBId || agentAId === agentBId) {
      return status(400, { ok: false, error: 'invalid_pair' })
    }

    const matchId = crypto.randomUUID()
    const conversationId = crypto.randomUUID()
    const score = Math.round((0.5 + Math.random() * 0.5) * 1000) / 1000

    try {
      await env.DB.prepare(
        `INSERT INTO matches (id, pool_id, agent_a_id, agent_b_id, score, status)
         VALUES (?1, ?2, ?3, ?4, ?5, 'created')`
      )
        .bind(matchId, payload.pool_id ?? null, agentAId, agentBId, score)
        .run()

      await env.DB.prepare(
        `INSERT INTO conversations (id, match_id, visibility, summary)
         VALUES (?1, ?2, 'private', NULL)`
      )
        .bind(conversationId, matchId)
        .run()
    } catch {
      return status(500, { ok: false, error: 'match_create_failed' })
    }

    return status(201, {
      ok: true,
      match: {
        id: matchId,
        pool_id: payload.pool_id ?? null,
        agent_a_id: agentAId,
        agent_b_id: agentBId,
        score,
        status: 'created',
      },
      conversation: {
        id: conversationId,
        match_id: matchId,
        visibility: 'private',
      },
    })
  }, { detail: { tags: ['mvp'] } })
  .get('/v1/trending', () => ({ ok: false, todo: 'implement trending' }), { detail: { tags: ['mvp'] } })
  .post('/v1/conversations/:id/turns', ({ params }) => ({ ok: false, todo: `implement turns for ${params.id}` }), { detail: { tags: ['mvp'] } })
  .post('/v1/donations/webhook', () => ({ ok: false, todo: 'implement donations/webhook' }), { detail: { tags: ['mvp'] } })
  .compile()

export default app
