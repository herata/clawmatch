import type { Elysia } from 'elysia'
import type { RuntimeEnv } from '../types/runtime'
import { requireAdmin, requireBotAuth } from '../middleware/auth'
import { requireIdempotencyKey, runIdempotent } from '../middleware/idempotency'
import { createMatch } from '../services/match-orchestrator'
import { getTurnJob, updateTurnJobStatus } from '../repos/matches'
import { asNumber, asString } from '../utils/validation'
import { addSeconds, nowIso } from '../utils/time'

type CreateMatchBody = {
  bot_a_id?: unknown
  bot_b_id?: unknown
  pool_topic?: unknown
  turn_limit?: unknown
}

type PostTurnBody = {
  seq_no?: unknown
  content?: unknown
}

export const registerMatchRoutes = (app: Elysia, env: RuntimeEnv): void => {
  app.post('/v1/matches', async ({ request, body, status }) => {
    const admin = requireAdmin(env, request)
    if (admin !== true) return status(admin.status, { ok: false, error: admin.error })

    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return status(400, { ok: false, error: 'idempotency_key_required' })

    const payload = (body ?? {}) as CreateMatchBody

    const result = await runIdempotent(env.DB, 'admin_create_match', idempotencyKey, async () => {
      const created = await createMatch(env, {
        requestedBy: 'admin',
        botAId: asString(payload.bot_a_id) ?? undefined,
        botBId: asString(payload.bot_b_id) ?? undefined,
        poolTopic: asString(payload.pool_topic),
        turnLimit: asNumber(payload.turn_limit) ?? 12,
      })

      if (!created.ok) {
        return { status: 400, body: { ok: false, error: created.error } }
      }

      return {
        status: 201,
        body: {
          ok: true,
          match: {
            id: created.matchId,
            conversation_id: created.conversationId,
            bot_a_id: created.botAId,
            bot_b_id: created.botBId,
            status: 'running',
          },
        },
      }
    })

    return status(result.status, {
      ...result.body,
      replayed: result.replayed,
    })
  })

  app.post('/v1/conversations/:id/turns', async ({ request, body, params, status }) => {
    const auth = await requireBotAuth(env, request)
    if (!auth.ok) return status(auth.status, { ok: false, error: auth.error })

    const conversationId = asString(params.id)
    if (!conversationId) return status(400, { ok: false, error: 'conversation_id_required' })

    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return status(400, { ok: false, error: 'idempotency_key_required' })

    const payload = (body ?? {}) as PostTurnBody
    const seqNo = asNumber(payload.seq_no)
    const content = asString(payload.content)

    if (!seqNo || seqNo < 1) return status(400, { ok: false, error: 'seq_no_required' })
    if (!content) return status(400, { ok: false, error: 'content_required' })

    const result = await runIdempotent(env.DB, `turn_post:${conversationId}:${seqNo}`, idempotencyKey, async () => {
      const job = await getTurnJob(env.DB, conversationId, seqNo)
      if (!job) {
        return {
          status: 409,
          body: {
            ok: false,
            error: 'turn_job_not_found_or_completed',
          },
        }
      }

      if (job.expected_bot_id !== auth.bot.id) {
        return {
          status: 403,
          body: {
            ok: false,
            error: 'not_assigned_bot',
          },
        }
      }

      if (job.status !== 'pending') {
        return {
          status: 409,
          body: {
            ok: false,
            error: 'turn_job_not_pending',
            current_status: job.status,
          },
        }
      }

      if (new Date(job.deadline_at).getTime() < Date.now()) {
        await updateTurnJobStatus(env.DB, {
          conversationId,
          seqNo,
          status: 'timeout',
          lastError: 'push_submission_timeout',
        })
        return {
          status: 409,
          body: {
            ok: false,
            error: 'assignment_expired',
          },
        }
      }

      if (!env.CONVERSATION_ROOM) {
        return { status: 500, body: { ok: false, error: 'conversation_room_not_configured' } }
      }

      await updateTurnJobStatus(env.DB, {
        conversationId,
        seqNo,
        status: 'dispatched',
        deadlineAt: addSeconds(nowIso(), 30),
      })

      const stub = env.CONVERSATION_ROOM.get(env.CONVERSATION_ROOM.idFromName(conversationId))
      const response = await stub.fetch('https://conversation.internal/append', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'append_turn',
          conversation_id: conversationId,
          seq_no: seqNo,
          bot_id: auth.bot.id,
          content,
        }),
      })

      const responseJson = (await response.json()) as {
        ok: boolean
        error?: string
        completed?: boolean
        turn?: { id: string; moderation_state: string; public_content: string }
        next?: { seq_no: number }
      }

      if (!response.ok) {
        await updateTurnJobStatus(env.DB, {
          conversationId,
          seqNo,
          status: 'failed',
          lastError: responseJson.error ?? `conversation_room_${response.status}`,
        })

        return {
          status: response.status,
          body: responseJson,
        }
      }

      if (!responseJson.completed && responseJson.next && env.TURN_QUEUE) {
        await env.TURN_QUEUE.send({
          type: 'run_turn',
          conversationId,
          seqNo: responseJson.next.seq_no,
        })
      }

      return {
        status: 201,
        body: {
          ok: true,
          conversation_id: conversationId,
          seq_no: seqNo,
          turn: responseJson.turn,
          next: responseJson.next ?? undefined,
          completed: Boolean(responseJson.completed),
        },
      }
    })

    return status(result.status, {
      ...result.body,
      replayed: result.replayed,
    })
  })
}
