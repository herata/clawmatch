import type { Elysia } from 'elysia'
import type { RuntimeEnv, BotExecutionMode } from '../types/runtime'
import { requireIdempotencyKey, runIdempotent } from '../middleware/idempotency'
import { ensureBotOwnership, requireBotAuth } from '../middleware/auth'
import { createBot, getBotById, insertBotApiKey, revokeApiKeysForBot, updateBotById } from '../repos/bots'
import { getVerifiedChallengeIdentity, getChallengeById } from '../repos/challenges'
import { generateBotApiKey, sha256Hex } from '../services/crypto'
import { takeRateLimit } from '../services/rate-limit'
import { validateCallbackUrl } from '../services/callback-security'
import { asString, asNullableString, parseTags } from '../utils/validation'
import { getClientIp } from '../utils/http'

type CreateBotBody = {
  challenge_id?: unknown
  slug?: unknown
  display_name?: unknown
  bio?: unknown
  tags?: unknown
  execution_mode?: unknown
  callback_url?: unknown
}

type UpdateBotBody = {
  display_name?: unknown
  bio?: unknown
  tags?: unknown
  callback_url?: unknown
  status?: unknown
}

export const registerBotRoutes = (app: Elysia, env: RuntimeEnv): void => {
  app.post('/v1/bots', async ({ request, body, status }) => {
    const ip = getClientIp(request)
    const rate = takeRateLimit(`bot-create:${ip}`, 20, 60_000)
    if (!rate.ok) {
      return status(429, { ok: false, error: 'rate_limited', retry_after_sec: rate.retryAfterSec })
    }

    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return status(400, { ok: false, error: 'idempotency_key_required' })

    const payload = (body ?? {}) as CreateBotBody
    const challengeId = asString(payload.challenge_id)
    const slug = asString(payload.slug)
    const displayName = asString(payload.display_name)
    const executionMode = asString(payload.execution_mode) as BotExecutionMode | null

    if (!challengeId) return status(400, { ok: false, error: 'challenge_id_required' })
    if (!slug) return status(400, { ok: false, error: 'slug_required' })
    if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(slug)) {
      return status(400, { ok: false, error: 'invalid_slug' })
    }
    if (!displayName) return status(400, { ok: false, error: 'display_name_required' })
    if (!executionMode || !['push', 'callback', 'hybrid'].includes(executionMode)) {
      return status(400, { ok: false, error: 'invalid_execution_mode' })
    }

    const callbackUrl = asNullableString(payload.callback_url)
    if ((executionMode === 'callback' || executionMode === 'hybrid') && !callbackUrl) {
      return status(400, { ok: false, error: 'callback_url_required' })
    }

    if (callbackUrl) {
      const validation = validateCallbackUrl(callbackUrl)
      if (!validation.ok) {
        return status(400, { ok: false, error: validation.reason })
      }
    }

    const result = await runIdempotent(env.DB, `create_bot:${challengeId}`, idempotencyKey, async () => {
      const challenge = await getChallengeById(env.DB, challengeId)
      if (!challenge) return { status: 404, body: { ok: false, error: 'challenge_not_found' } }
      if (challenge.status !== 'verified') {
        return {
          status: 409,
          body: {
            ok: false,
            error: 'challenge_not_verified',
            challenge_status: challenge.status,
          },
        }
      }

      const owner = await getVerifiedChallengeIdentity(env.DB, challengeId)
      if (!owner) {
        return { status: 409, body: { ok: false, error: 'challenge_owner_not_found' } }
      }

      const botId = crypto.randomUUID()
      const tags = parseTags(payload.tags)
      const bio = asNullableString(payload.bio)

      try {
        await createBot(env.DB, {
          id: botId,
          ownerIdentityId: owner.id,
          slug,
          displayName,
          bio,
          tagsJson: JSON.stringify(tags),
          executionMode,
          callbackUrl,
        })
      } catch (error) {
        const message = String(error)
        if (message.includes('UNIQUE') || message.includes('constraint')) {
          return { status: 409, body: { ok: false, error: 'slug_already_exists' } }
        }
        throw error
      }

      const key = generateBotApiKey()
      const keyHash = await sha256Hex(key.plain)
      await insertBotApiKey(env.DB, {
        id: crypto.randomUUID(),
        botId,
        keyPrefix: key.prefix,
        keyHash,
      })

      return {
        status: 201,
        body: {
          ok: true,
          bot: {
            id: botId,
            slug,
            display_name: displayName,
            execution_mode: executionMode,
            callback_url: callbackUrl,
            tags,
          },
          owner: {
            provider: owner.provider,
            subject: owner.subject,
            handle: owner.handle,
          },
          api_key: key.plain,
        },
      }
    })

    return status(result.status, {
      ...result.body,
      replayed: result.replayed,
    })
  })

  app.patch('/v1/bots/:bot_id', async ({ request, body, params, status }) => {
    const auth = await requireBotAuth(env, request)
    if (!auth.ok) return status(auth.status, { ok: false, error: auth.error })

    const botId = asString(params.bot_id)
    if (!botId) return status(400, { ok: false, error: 'bot_id_required' })

    const ownership = ensureBotOwnership(auth.bot, botId)
    if (ownership !== true) return status(ownership.status, { ok: false, error: ownership.error })

    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return status(400, { ok: false, error: 'idempotency_key_required' })

    const payload = (body ?? {}) as UpdateBotBody
    const displayName = asNullableString(payload.display_name)
    const bio = asNullableString(payload.bio)
    const tags = parseTags(payload.tags)
    const callbackUrl = asNullableString(payload.callback_url)
    const statusValue = asNullableString(payload.status) as 'active' | 'paused' | 'banned' | null

    if (callbackUrl) {
      const validation = validateCallbackUrl(callbackUrl)
      if (!validation.ok) {
        return status(400, { ok: false, error: validation.reason })
      }
    }

    const hasUpdate =
      displayName !== null ||
      bio !== null ||
      callbackUrl !== null ||
      tags.length > 0 ||
      (statusValue !== null && ['active', 'paused', 'banned'].includes(statusValue))

    if (!hasUpdate) return status(400, { ok: false, error: 'no_updatable_fields' })

    const result = await runIdempotent(env.DB, `update_bot:${botId}`, idempotencyKey, async () => {
      const existing = await getBotById(env.DB, botId)
      if (!existing) return { status: 404, body: { ok: false, error: 'bot_not_found' } }

      await updateBotById(env.DB, botId, {
        displayName: displayName ?? undefined,
        bio,
        callbackUrl,
        tagsJson: tags.length > 0 ? JSON.stringify(tags) : undefined,
        status: statusValue && ['active', 'paused', 'banned'].includes(statusValue) ? statusValue : undefined,
      })

      return {
        status: 200,
        body: {
          ok: true,
          updated: true,
          bot_id: botId,
        },
      }
    })

    return status(result.status, {
      ...result.body,
      replayed: result.replayed,
    })
  })

  app.post('/v1/bots/:bot_id/keys/rotate', async ({ request, params, status }) => {
    const auth = await requireBotAuth(env, request)
    if (!auth.ok) return status(auth.status, { ok: false, error: auth.error })

    const botId = asString(params.bot_id)
    if (!botId) return status(400, { ok: false, error: 'bot_id_required' })

    const ownership = ensureBotOwnership(auth.bot, botId)
    if (ownership !== true) return status(ownership.status, { ok: false, error: ownership.error })

    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) return status(400, { ok: false, error: 'idempotency_key_required' })

    const result = await runIdempotent(env.DB, `rotate_key:${botId}`, idempotencyKey, async () => {
      await revokeApiKeysForBot(env.DB, botId)
      const key = generateBotApiKey()
      const keyHash = await sha256Hex(key.plain)
      await insertBotApiKey(env.DB, {
        id: crypto.randomUUID(),
        botId,
        keyPrefix: key.prefix,
        keyHash,
      })

      return {
        status: 201,
        body: {
          ok: true,
          bot_id: botId,
          api_key: key.plain,
        },
      }
    })

    return status(result.status, {
      ...result.body,
      replayed: result.replayed,
    })
  })

  app.get('/v1/bots/:bot_id/assignments', async ({ request, params, status }) => {
    const auth = await requireBotAuth(env, request)
    if (!auth.ok) return status(auth.status, { ok: false, error: auth.error })

    const botId = asString(params.bot_id)
    if (!botId) return status(400, { ok: false, error: 'bot_id_required' })

    const ownership = ensureBotOwnership(auth.bot, botId)
    if (ownership !== true) return status(ownership.status, { ok: false, error: ownership.error })

    const assignment = await env.DB.prepare(
      `SELECT
         j.conversation_id,
         j.seq_no,
         j.deadline_at,
         c.match_id
       FROM turn_jobs j
       JOIN conversations c ON c.id = j.conversation_id
       JOIN matches m ON m.id = c.match_id
       WHERE j.expected_bot_id = ?1
         AND j.status = 'pending'
         AND m.status = 'running'
         AND c.status = 'live'
       ORDER BY j.seq_no ASC
       LIMIT 1`
    )
      .bind(botId)
      .first<{ conversation_id: string; seq_no: number; deadline_at: string; match_id: string }>()

    if (!assignment) {
      return {
        ok: true,
        assignment: null,
      }
    }

    return {
      ok: true,
      assignment: {
        conversation_id: assignment.conversation_id,
        match_id: assignment.match_id,
        seq_no: Number(assignment.seq_no),
        deadline_at: assignment.deadline_at,
      },
    }
  })
}
