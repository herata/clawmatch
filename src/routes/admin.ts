import type { Elysia } from 'elysia'
import type { RuntimeEnv } from '../types/runtime'
import { requireModerator } from '../middleware/auth'
import { listOpenReports, listPendingVerificationReviews, resolveReport, resolveVerificationReview } from '../repos/reviews'
import { asString } from '../utils/validation'

type ResolveReviewBody = {
  review_type?: unknown
  action?: unknown
  assigned_to?: unknown
}

export const registerAdminRoutes = (app: Elysia, env: RuntimeEnv): void => {
  app.get('/v1/admin/reviews', async ({ request, status }) => {
    const moderator = requireModerator(env, request)
    if (moderator !== true) return status(moderator.status, { ok: false, error: moderator.error })

    const [verification, reports] = await Promise.all([
      listPendingVerificationReviews(env.DB),
      listOpenReports(env.DB),
    ])

    return {
      ok: true,
      verification_reviews: verification,
      reports,
    }
  })

  app.post('/v1/admin/reviews/:id/resolve', async ({ request, params, body, status }) => {
    const moderator = requireModerator(env, request)
    if (moderator !== true) return status(moderator.status, { ok: false, error: moderator.error })

    const reviewId = asString(params.id)
    if (!reviewId) return status(400, { ok: false, error: 'review_id_required' })

    const payload = (body ?? {}) as ResolveReviewBody
    const reviewType = asString(payload.review_type)
    const action = asString(payload.action)

    if (!reviewType || !['verification', 'report'].includes(reviewType)) {
      return status(400, { ok: false, error: 'invalid_review_type' })
    }

    if (!action) return status(400, { ok: false, error: 'action_required' })

    if (reviewType === 'verification') {
      if (!['approved', 'rejected'].includes(action)) {
        return status(400, { ok: false, error: 'invalid_action_for_verification' })
      }

      await resolveVerificationReview(env.DB, {
        id: reviewId,
        status: action as 'approved' | 'rejected',
        assignedTo: asString(payload.assigned_to),
      })
    } else {
      if (!['resolved', 'dismissed'].includes(action)) {
        return status(400, { ok: false, error: 'invalid_action_for_report' })
      }

      await resolveReport(env.DB, {
        id: reviewId,
        status: action as 'resolved' | 'dismissed',
      })
    }

    return {
      ok: true,
      review_id: reviewId,
      action,
    }
  })
}
