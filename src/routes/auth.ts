import type { Elysia } from 'elysia'
import type { RuntimeEnv } from '../types/runtime'
import { requireIdempotencyKey, runIdempotent } from '../middleware/idempotency'
import { insertChallenge, getChallengeById, updateChallengeStatus, createVerificationReview, upsertIdentityFromX, insertXProof } from '../repos/challenges'
import { randomCode, sha256Hex } from '../services/crypto'
import { verifyTurnstile } from '../services/turnstile'
import { verifyXPost } from '../services/x-verifier'
import { takeRateLimit } from '../services/rate-limit'
import { getClientIp } from '../utils/http'
import { addMinutes, isExpired, nowIso } from '../utils/time'
import { asString } from '../utils/validation'

type CreateChallengeBody = {
  bot_slug?: unknown
  turnstile_token?: unknown
}

type VerifyChallengeBody = {
  x_post_url?: unknown
}

export const registerAuthRoutes = (app: Elysia, env: RuntimeEnv): void => {
  app.post('/v1/auth/challenges', async ({ request, body, status }) => {
    const ip = getClientIp(request)
    const rate = takeRateLimit(`register:${ip}`, 30, 60_000)
    if (!rate.ok) {
      return status(429, { ok: false, error: 'rate_limited', retry_after_sec: rate.retryAfterSec })
    }

    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) {
      return status(400, { ok: false, error: 'idempotency_key_required' })
    }

    const payload = (body ?? {}) as CreateChallengeBody
    const botSlug = asString(payload.bot_slug)
    const turnstileToken = asString(payload.turnstile_token) ?? request.headers.get('cf-turnstile-response')
    const turnstile = await verifyTurnstile(env, turnstileToken, ip)
    if (!turnstile.ok) {
      return status(403, { ok: false, error: turnstile.reason })
    }

    const result = await runIdempotent(env.DB, `auth_challenge:${ip}`, idempotencyKey, async () => {
      const challengeId = crypto.randomUUID()
      const code = randomCode(8)
      const requiredText = `openclaw verify ${code}`
      const codeHash = await sha256Hex(code)
      const createdAt = nowIso()
      const expiresAt = addMinutes(createdAt, 15)

      await insertChallenge(env.DB, {
        id: challengeId,
        codeHash,
        requiredText,
        intendedBotSlug: botSlug,
        sourceIp: ip,
        expiresAt,
      })

      return {
        status: 201,
        body: {
          ok: true,
          challenge_id: challengeId,
          code,
          required_text: requiredText,
          expires_at: expiresAt,
        },
      }
    })

    return status(result.status, {
      ...result.body,
      replayed: result.replayed,
    })
  })

  app.post('/v1/auth/challenges/:id/verify', async ({ request, body, params, status }) => {
    const idempotencyKey = requireIdempotencyKey(request)
    if (!idempotencyKey) {
      return status(400, { ok: false, error: 'idempotency_key_required' })
    }

    const challengeId = asString(params.id)
    if (!challengeId) return status(400, { ok: false, error: 'challenge_id_required' })

    const payload = (body ?? {}) as VerifyChallengeBody
    const postUrl = asString(payload.x_post_url)
    if (!postUrl) return status(400, { ok: false, error: 'x_post_url_required' })

    const result = await runIdempotent(env.DB, `auth_verify:${challengeId}`, idempotencyKey, async () => {
      const challenge = await getChallengeById(env.DB, challengeId)
      if (!challenge) return { status: 404, body: { ok: false, error: 'challenge_not_found' } }

      if (challenge.status === 'verified') {
        return { status: 200, body: { ok: true, challenge_id: challengeId, status: 'verified' as const } }
      }

      if (challenge.status !== 'issued') {
        return { status: 409, body: { ok: false, error: 'challenge_not_issuable', status: challenge.status } }
      }

      if (isExpired(challenge.expires_at)) {
        await updateChallengeStatus(env.DB, challenge.id, 'expired', null)
        return { status: 410, body: { ok: false, error: 'challenge_expired' } }
      }

      const verification = await verifyXPost(env, postUrl, challenge.required_text)
      if (!verification.ok) {
        if (verification.kind === 'temporary') {
          await updateChallengeStatus(env.DB, challenge.id, 'manual_review', null)
          await createVerificationReview(env.DB, {
            id: crypto.randomUUID(),
            challengeId: challenge.id,
            reason: verification.reason,
          })

          return {
            status: 202,
            body: {
              ok: true,
              challenge_id: challenge.id,
              status: 'manual_review' as const,
              reason: verification.reason,
            },
          }
        }

        await updateChallengeStatus(env.DB, challenge.id, 'failed', null)
        return {
          status: 400,
          body: {
            ok: false,
            error: 'x_verification_failed',
            reason: verification.reason,
          },
        }
      }

      const identity = await upsertIdentityFromX(env.DB, {
        provider: 'x',
        subject: verification.subject,
        handle: verification.handle,
        displayName: verification.displayName,
        metadataJson: JSON.stringify({ source: 'x', verified_at: nowIso() }),
      })

      await insertXProof(env.DB, {
        id: crypto.randomUUID(),
        challengeId: challenge.id,
        identityId: identity.id,
        postId: verification.postId,
        postUrl,
        postCreatedAt: verification.postCreatedAt,
        rawJson: JSON.stringify(verification.raw),
      })

      await updateChallengeStatus(env.DB, challenge.id, 'verified', nowIso())

      return {
        status: 200,
        body: {
          ok: true,
          challenge_id: challenge.id,
          status: 'verified' as const,
          owner: {
            provider: 'x',
            subject: identity.subject,
            handle: identity.handle,
            display_name: identity.display_name,
          },
        },
      }
    })

    return status(result.status, {
      ...result.body,
      replayed: result.replayed,
    })
  })
}
