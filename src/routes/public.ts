import type { Elysia } from 'elysia'
import type { RuntimeEnv } from '../types/runtime'
import { listRecentPublicMatches, getConversation, getTurnsSince } from '../repos/matches'
import { totalConfirmedDonationsByConversation } from '../repos/donations'
import { createReport } from '../repos/reviews'
import { takeRateLimit } from '../services/rate-limit'
import { getClientIp } from '../utils/http'
import { asNumber, asString } from '../utils/validation'
import { sleep } from '../utils/time'

type CreateReportBody = {
  reason?: unknown
  turn_id?: unknown
}

const encoder = new TextEncoder()

export const registerPublicRoutes = (app: Elysia, env: RuntimeEnv): void => {
  app.get('/v1/public/matches', async ({ request, query, status }) => {
    const ip = getClientIp(request)
    const limitCheck = takeRateLimit(`public:${ip}`, 600, 60_000)
    if (!limitCheck.ok) {
      return status(429, { ok: false, error: 'rate_limited', retry_after_sec: limitCheck.retryAfterSec })
    }

    const limit = Math.max(1, Math.min(100, asNumber(query.limit) ?? 20))
    const matches = await listRecentPublicMatches(env.DB, limit)

    return {
      ok: true,
      matches: matches.map((row) => ({
        id: row.id,
        conversation_id: row.conversation_id,
        status: row.status,
        bot_a_id: row.bot_a_id,
        bot_b_id: row.bot_b_id,
        turns_count: Number(row.turns_count ?? 0),
        created_at: row.created_at,
      })),
    }
  })

  app.get('/v1/public/conversations/:id', async ({ request, params, query, status }) => {
    const ip = getClientIp(request)
    const limitCheck = takeRateLimit(`public:${ip}`, 600, 60_000)
    if (!limitCheck.ok) {
      return status(429, { ok: false, error: 'rate_limited', retry_after_sec: limitCheck.retryAfterSec })
    }

    const conversationId = asString(params.id)
    if (!conversationId) return status(400, { ok: false, error: 'conversation_id_required' })

    const conversation = await getConversation(env.DB, conversationId)
    if (!conversation || conversation.visibility !== 'public') {
      return status(404, { ok: false, error: 'conversation_not_found' })
    }

    const seqFrom = Math.max(1, asNumber(query.cursor) ?? 1)
    const turns = await getTurnsSince(env.DB, conversationId, seqFrom)
    const donationTotal = await totalConfirmedDonationsByConversation(env.DB, conversationId)

    return {
      ok: true,
      conversation,
      turns: turns.map((turn) => ({
        id: turn.id,
        seq_no: Number(turn.seq_no),
        bot_id: turn.bot_id,
        content: turn.public_content,
        moderation_state: turn.moderation_state,
        created_at: turn.created_at,
      })),
      donations: {
        confirmed_total_minor: donationTotal,
      },
    }
  })

  app.get('/v1/public/conversations/:id/stream', async ({ params, request, status, query }) => {
    const conversationId = asString(params.id)
    if (!conversationId) return status(400, { ok: false, error: 'conversation_id_required' })

    const conversation = await getConversation(env.DB, conversationId)
    if (!conversation || conversation.visibility !== 'public') {
      return status(404, { ok: false, error: 'conversation_not_found' })
    }

    const fromQuery = asNumber(query.cursor)
    const lastEventId = asNumber(request.headers.get('last-event-id'))
    let cursor = Math.max(1, fromQuery ?? (lastEventId ? lastEventId + 1 : 1))

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false
        const close = () => {
          if (closed) return
          closed = true
          controller.close()
        }

        const pushEvent = (event: string, data: unknown, id?: number): void => {
          const payload = [`event: ${event}`]
          if (typeof id === 'number') payload.push(`id: ${id}`)
          payload.push(`data: ${JSON.stringify(data)}`)
          payload.push('\n')
          controller.enqueue(encoder.encode(`${payload.join('\n')}\n`))
        }

        pushEvent('ready', { conversation_id: conversationId, cursor })

        for (let tick = 0; tick < 200 && !closed; tick += 1) {
          const turns = await getTurnsSince(env.DB, conversationId, cursor)
          for (const turn of turns) {
            const seq = Number(turn.seq_no)
            pushEvent(
              'turn',
              {
                id: turn.id,
                conversation_id: turn.conversation_id,
                seq_no: seq,
                bot_id: turn.bot_id,
                content: turn.public_content,
                moderation_state: turn.moderation_state,
                created_at: turn.created_at,
              },
              seq
            )
            cursor = seq + 1
          }

          if (conversation.status === 'ended') {
            pushEvent('end', { conversation_id: conversationId })
            close()
            break
          }

          controller.enqueue(encoder.encode(': keep-alive\n\n'))
          await sleep(1_500)
        }

        close()
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    })
  })

  app.post('/v1/public/conversations/:id/reports', async ({ params, body, status }) => {
    const conversationId = asString(params.id)
    if (!conversationId) return status(400, { ok: false, error: 'conversation_id_required' })

    const payload = (body ?? {}) as CreateReportBody
    const reason = asString(payload.reason)
    if (!reason) return status(400, { ok: false, error: 'reason_required' })

    await createReport(env.DB, {
      id: crypto.randomUUID(),
      conversationId,
      turnId: asString(payload.turn_id),
      reason,
    })

    return status(201, {
      ok: true,
      reported: true,
    })
  })
}
