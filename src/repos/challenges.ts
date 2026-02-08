import type { ChallengeRow, IdentityRow } from '../types/db'

export const insertChallenge = async (
  db: D1Database,
  payload: {
    id: string
    codeHash: string
    requiredText: string
    intendedBotSlug: string | null
    sourceIp: string
    expiresAt: string
  }
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO registration_challenges
        (id, code_hash, required_text, intended_bot_slug, source_ip, expires_at, status)
       VALUES
        (?1, ?2, ?3, ?4, ?5, ?6, 'issued')`
    )
    .bind(payload.id, payload.codeHash, payload.requiredText, payload.intendedBotSlug, payload.sourceIp, payload.expiresAt)
    .run()
}

export const getChallengeById = async (db: D1Database, id: string): Promise<ChallengeRow | null> => {
  return (
    (await db
      .prepare(
        `SELECT
           id,
           code_hash,
           required_text,
           intended_bot_slug,
           source_ip,
           expires_at,
           status,
           created_at,
           consumed_at
         FROM registration_challenges
         WHERE id = ?1`
      )
      .bind(id)
      .first<ChallengeRow>()) ?? null
  )
}

export const updateChallengeStatus = async (
  db: D1Database,
  id: string,
  status: ChallengeRow['status'],
  consumedAt: string | null
): Promise<void> => {
  await db
    .prepare(
      `UPDATE registration_challenges
       SET status = ?2,
           consumed_at = COALESCE(?3, consumed_at)
       WHERE id = ?1`
    )
    .bind(id, status, consumedAt)
    .run()
}

export const createVerificationReview = async (
  db: D1Database,
  payload: { id: string; challengeId: string; reason: string }
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO verification_reviews (id, challenge_id, reason, status)
       VALUES (?1, ?2, ?3, 'pending')`
    )
    .bind(payload.id, payload.challengeId, payload.reason)
    .run()
}

export const upsertIdentityFromX = async (
  db: D1Database,
  payload: {
    provider: 'x'
    subject: string
    handle: string
    displayName: string
    metadataJson: string
  }
): Promise<IdentityRow> => {
  const existing = await db
    .prepare(`SELECT id FROM identities WHERE provider = ?1 AND subject = ?2`)
    .bind(payload.provider, payload.subject)
    .first<{ id: string }>()

  if (existing?.id) {
    await db
      .prepare(
        `UPDATE identities
         SET handle = ?2,
             display_name = ?3,
             metadata_json = ?4
         WHERE id = ?1`
      )
      .bind(existing.id, payload.handle, payload.displayName, payload.metadataJson)
      .run()

    const updated = await db
      .prepare(
        `SELECT id, provider, subject, handle, display_name, metadata_json, created_at
         FROM identities
         WHERE id = ?1`
      )
      .bind(existing.id)
      .first<IdentityRow>()

    if (!updated) throw new Error('identity_update_failed')
    return updated
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO identities (id, provider, subject, handle, display_name, metadata_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    )
    .bind(id, payload.provider, payload.subject, payload.handle, payload.displayName, payload.metadataJson)
    .run()

  const inserted = await db
    .prepare(
      `SELECT id, provider, subject, handle, display_name, metadata_json, created_at
       FROM identities
       WHERE id = ?1`
    )
    .bind(id)
    .first<IdentityRow>()

  if (!inserted) throw new Error('identity_insert_failed')
  return inserted
}

export const insertXProof = async (
  db: D1Database,
  payload: {
    id: string
    challengeId: string
    identityId: string
    postId: string
    postUrl: string
    postCreatedAt: string
    rawJson: string
  }
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO x_post_proofs
        (id, challenge_id, identity_id, post_id, post_url, post_created_at, raw_json)
       VALUES
        (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    )
    .bind(payload.id, payload.challengeId, payload.identityId, payload.postId, payload.postUrl, payload.postCreatedAt, payload.rawJson)
    .run()
}

export const getVerifiedChallengeIdentity = async (
  db: D1Database,
  challengeId: string
): Promise<IdentityRow | null> => {
  return (
    (await db
      .prepare(
        `SELECT i.id, i.provider, i.subject, i.handle, i.display_name, i.metadata_json, i.created_at
         FROM x_post_proofs p
         JOIN identities i ON i.id = p.identity_id
         WHERE p.challenge_id = ?1
         LIMIT 1`
      )
      .bind(challengeId)
      .first<IdentityRow>()) ?? null
  )
}
