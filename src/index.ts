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

type TurnBody = {
  agent_id?: string
  content?: string
}

type DonationBody = {
  provider?: string
  tx_ref?: string
  amount?: number
  currency?: string
  status?: string
}

type AgentRow = {
  id: string
  name: string
}

type TrendingRow = {
  id: string
  match_id: string
  visibility: string
  summary: string | null
  created_at: string
  turns_count: number
}

type MatchListRow = {
  id: string
  pool_id: string | null
  agent_a_id: string
  agent_b_id: string
  score: number
  status: string
  created_at: string
}

type ConversationRow = {
  id: string
  match_id: string
  visibility: string
  summary: string | null
  created_at: string
}

type TurnRow = {
  id: string
  conversation_id: string
  agent_id: string
  content: string
  created_at: string
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
  .get('/v1/matches', async ({ query, status }) => {
    if (!env.DB) return status(500, { ok: false, error: 'db_not_configured' })

    const limit = Math.max(1, Math.min(100, Number(query.limit ?? 20) || 20))

    const rows = await env.DB.prepare(
      `SELECT id, pool_id, agent_a_id, agent_b_id, score, status, created_at
       FROM matches
       ORDER BY created_at DESC
       LIMIT ?1`
    )
      .bind(limit)
      .all<MatchListRow>()

    return {
      ok: true,
      matches: (rows.results ?? []).map((r) => ({
        id: r.id,
        pool_id: r.pool_id,
        agent_a_id: r.agent_a_id,
        agent_b_id: r.agent_b_id,
        score: Number(r.score),
        status: r.status,
        created_at: r.created_at,
      })),
    }
  }, { detail: { tags: ['mvp'] } })
  .get('/v1/conversations/:id', async ({ params, status }) => {
    if (!env.DB) return status(500, { ok: false, error: 'db_not_configured' })

    const conversationId = params.id?.trim()
    if (!conversationId) return status(400, { ok: false, error: 'conversation_id_required' })

    const conversation = await env.DB.prepare(
      `SELECT id, match_id, visibility, summary, created_at
       FROM conversations
       WHERE id = ?1`
    )
      .bind(conversationId)
      .first<ConversationRow>()

    if (!conversation) return status(404, { ok: false, error: 'conversation_not_found' })

    const turns = await env.DB.prepare(
      `SELECT id, conversation_id, agent_id, content, created_at
       FROM turns
       WHERE conversation_id = ?1
       ORDER BY created_at ASC`
    )
      .bind(conversationId)
      .all<TurnRow>()

    return {
      ok: true,
      conversation,
      turns: turns.results ?? [],
    }
  }, { detail: { tags: ['mvp'] } })
  .get('/v1/trending', async ({ query, status }) => {
    if (!env.DB) return status(500, { ok: false, error: 'db_not_configured' })

    const limit = Math.max(1, Math.min(50, Number(query.limit ?? 20) || 20))

    const rows = await env.DB.prepare(
      `SELECT
         c.id,
         c.match_id,
         c.visibility,
         c.summary,
         c.created_at,
         COUNT(t.id) AS turns_count
       FROM conversations c
       LEFT JOIN turns t ON t.conversation_id = c.id
       GROUP BY c.id
       ORDER BY turns_count DESC, c.created_at DESC
       LIMIT ?1`
    )
      .bind(limit)
      .all<TrendingRow>()

    return {
      ok: true,
      trending: (rows.results ?? []).map((r) => ({
        id: r.id,
        match_id: r.match_id,
        visibility: r.visibility,
        summary: r.summary,
        turns_count: Number(r.turns_count ?? 0),
        created_at: r.created_at,
      })),
    }
  }, { detail: { tags: ['mvp'] } })
  .post('/v1/conversations/:id/turns', async ({ params, body, status }) => {
    if (!env.DB) return status(500, { ok: false, error: 'db_not_configured' })

    const payload = (body ?? {}) as TurnBody
    const conversationId = params.id?.trim()
    const agentId = payload.agent_id?.trim()
    const content = payload.content?.trim()

    if (!conversationId) return status(400, { ok: false, error: 'conversation_id_required' })
    if (!agentId) return status(400, { ok: false, error: 'agent_id_required' })
    if (!content) return status(400, { ok: false, error: 'content_required' })

    const conv = await env.DB.prepare(`SELECT id FROM conversations WHERE id = ?1`).bind(conversationId).first<{ id: string }>()
    if (!conv) return status(404, { ok: false, error: 'conversation_not_found' })

    const agent = await env.DB.prepare(`SELECT id FROM agents WHERE id = ?1`).bind(agentId).first<{ id: string }>()
    if (!agent) return status(404, { ok: false, error: 'agent_not_found' })

    const turnId = crypto.randomUUID()

    try {
      await env.DB.prepare(
        `INSERT INTO turns (id, conversation_id, agent_id, content)
         VALUES (?1, ?2, ?3, ?4)`
      )
        .bind(turnId, conversationId, agentId, content)
        .run()
    } catch {
      return status(500, { ok: false, error: 'turn_insert_failed' })
    }

    return status(201, {
      ok: true,
      turn: {
        id: turnId,
        conversation_id: conversationId,
        agent_id: agentId,
        content,
      },
    })
  }, { detail: { tags: ['mvp'] } })
  .post('/v1/donations/webhook', async ({ body, status }) => {
    if (!env.DB) return status(500, { ok: false, error: 'db_not_configured' })

    const payload = (body ?? {}) as DonationBody
    const provider = payload.provider?.trim()
    const txRef = payload.tx_ref?.trim()

    if (!provider) return status(400, { ok: false, error: 'provider_required' })
    if (!txRef) return status(400, { ok: false, error: 'tx_ref_required' })

    const id = crypto.randomUUID()
    const amount = Number.isFinite(payload.amount) ? Number(payload.amount) : null
    const currency = payload.currency?.trim() || null
    const donationStatus = payload.status?.trim() || 'received'

    try {
      await env.DB.prepare(
        `INSERT INTO donations (id, provider, tx_ref, amount, currency, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      )
        .bind(id, provider, txRef, amount, currency, donationStatus)
        .run()
    } catch {
      return status(500, { ok: false, error: 'donation_insert_failed' })
    }

    return status(201, {
      ok: true,
      donation: {
        id,
        provider,
        tx_ref: txRef,
        amount,
        currency,
        status: donationStatus,
      },
    })
  }, { detail: { tags: ['mvp'] } })
  .compile()

export default app
