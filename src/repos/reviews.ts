export type VerificationReviewRow = {
  id: string
  challenge_id: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  assigned_to: string | null
  created_at: string
  resolved_at: string | null
}

export type ReportRow = {
  id: string
  conversation_id: string
  turn_id: string | null
  reason: string
  status: 'open' | 'resolved' | 'dismissed'
  created_at: string
  resolved_at: string | null
}

export const createReport = async (
  db: D1Database,
  payload: {
    id: string
    conversationId: string
    turnId: string | null
    reason: string
  }
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO reports (id, conversation_id, turn_id, reason, status)
       VALUES (?1, ?2, ?3, ?4, 'open')`
    )
    .bind(payload.id, payload.conversationId, payload.turnId, payload.reason)
    .run()
}

export const listPendingVerificationReviews = async (db: D1Database): Promise<VerificationReviewRow[]> => {
  const rows = await db
    .prepare(
      `SELECT id, challenge_id, reason, status, assigned_to, created_at, resolved_at
       FROM verification_reviews
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 200`
    )
    .all<VerificationReviewRow>()

  return rows.results ?? []
}

export const listOpenReports = async (db: D1Database): Promise<ReportRow[]> => {
  const rows = await db
    .prepare(
      `SELECT id, conversation_id, turn_id, reason, status, created_at, resolved_at
       FROM reports
       WHERE status = 'open'
       ORDER BY created_at ASC
       LIMIT 200`
    )
    .all<ReportRow>()

  return rows.results ?? []
}

export const resolveVerificationReview = async (
  db: D1Database,
  payload: { id: string; status: 'approved' | 'rejected'; assignedTo: string | null }
): Promise<void> => {
  await db
    .prepare(
      `UPDATE verification_reviews
       SET
         status = ?2,
         assigned_to = COALESCE(?3, assigned_to),
         resolved_at = ?4
       WHERE id = ?1`
    )
    .bind(payload.id, payload.status, payload.assignedTo, new Date().toISOString())
    .run()
}

export const resolveReport = async (
  db: D1Database,
  payload: { id: string; status: 'resolved' | 'dismissed' }
): Promise<void> => {
  await db
    .prepare(
      `UPDATE reports
       SET status = ?2,
           resolved_at = ?3
       WHERE id = ?1`
    )
    .bind(payload.id, payload.status, new Date().toISOString())
    .run()
}
