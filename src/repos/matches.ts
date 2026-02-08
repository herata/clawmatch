import type { ConversationRow, MatchRow, TurnJobRow, TurnRow } from '../types/db'

export type MatchPair = {
  botAId: string
  botBId: string
  score: number
}

export const createMatchWithConversation = async (
  db: D1Database,
  payload: {
    matchId: string
    conversationId: string
    poolTopic: string | null
    createdBy: string
    turnLimit: number
    pair: MatchPair
  }
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO matches
        (id, pool_topic, status, turn_limit, expected_seq_no, created_by, started_at)
       VALUES
        (?1, ?2, 'running', ?3, 1, ?4, ?5)`
    )
    .bind(payload.matchId, payload.poolTopic, payload.turnLimit, payload.createdBy, new Date().toISOString())
    .run()

  await db
    .prepare(
      `INSERT INTO match_participants (id, match_id, bot_id, side, selection_score)
       VALUES (?1, ?2, ?3, 'A', ?4),
              (?5, ?2, ?6, 'B', ?4)`
    )
    .bind(crypto.randomUUID(), payload.matchId, payload.pair.botAId, payload.pair.score, crypto.randomUUID(), payload.pair.botBId)
    .run()

  await db
    .prepare(
      `INSERT INTO conversations (id, match_id, visibility, status, published_at)
       VALUES (?1, ?2, 'public', 'live', ?3)`
    )
    .bind(payload.conversationId, payload.matchId, new Date().toISOString())
    .run()
}

export const createTurnJob = async (
  db: D1Database,
  payload: {
    conversationId: string
    seqNo: number
    expectedBotId: string
    deadlineAt: string
  }
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO turn_jobs
        (id, conversation_id, seq_no, expected_bot_id, status, deadline_at)
       VALUES
        (?1, ?2, ?3, ?4, 'pending', ?5)`
    )
    .bind(crypto.randomUUID(), payload.conversationId, payload.seqNo, payload.expectedBotId, payload.deadlineAt)
    .run()
}

export const listRecentPublicMatches = async (
  db: D1Database,
  limit: number
): Promise<Array<MatchRow & { conversation_id: string; turns_count: number; bot_a_id: string; bot_b_id: string }>> => {
  const rows = await db
    .prepare(
      `SELECT
         m.id,
         m.pool_topic,
         m.status,
         m.turn_limit,
         m.expected_seq_no,
         m.created_by,
         m.started_at,
         m.ended_at,
         m.ended_reason,
         m.created_at,
         c.id AS conversation_id,
         pa.bot_id AS bot_a_id,
         pb.bot_id AS bot_b_id,
         COUNT(t.id) AS turns_count
       FROM matches m
       JOIN conversations c ON c.match_id = m.id
       JOIN match_participants pa ON pa.match_id = m.id AND pa.side = 'A'
       JOIN match_participants pb ON pb.match_id = m.id AND pb.side = 'B'
       LEFT JOIN turns t ON t.conversation_id = c.id
       WHERE c.visibility = 'public'
       GROUP BY m.id, c.id, pa.bot_id, pb.bot_id
       ORDER BY m.created_at DESC
       LIMIT ?1`
    )
    .bind(limit)
    .all<MatchRow & { conversation_id: string; turns_count: number; bot_a_id: string; bot_b_id: string }>()

  return rows.results ?? []
}

export const getConversation = async (db: D1Database, conversationId: string): Promise<ConversationRow | null> => {
  return (
    (await db
      .prepare(
        `SELECT id, match_id, visibility, status, published_at, ended_reason, created_at, ended_at
         FROM conversations
         WHERE id = ?1`
      )
      .bind(conversationId)
      .first<ConversationRow>()) ?? null
  )
}

export const getTurnsSince = async (db: D1Database, conversationId: string, seqFrom = 1): Promise<TurnRow[]> => {
  const rows = await db
    .prepare(
      `SELECT
         id,
         conversation_id,
         seq_no,
         bot_id,
         raw_content,
         public_content,
         moderation_state,
         created_at
       FROM turns
       WHERE conversation_id = ?1
         AND seq_no >= ?2
       ORDER BY seq_no ASC`
    )
    .bind(conversationId, seqFrom)
    .all<TurnRow>()

  return rows.results ?? []
}

export const getTurnJob = async (
  db: D1Database,
  conversationId: string,
  seqNo: number
): Promise<TurnJobRow | null> => {
  return (
    (await db
      .prepare(
        `SELECT
           id,
           conversation_id,
           seq_no,
           expected_bot_id,
           status,
           deadline_at,
           retry_count,
           failure_streak,
           last_error,
           created_at,
           updated_at
         FROM turn_jobs
         WHERE conversation_id = ?1
           AND seq_no = ?2`
      )
      .bind(conversationId, seqNo)
      .first<TurnJobRow>()) ?? null
  )
}

export const updateTurnJobStatus = async (
  db: D1Database,
  payload: {
    conversationId: string
    seqNo: number
    status: TurnJobRow['status']
    retryCount?: number
    failureStreak?: number
    lastError?: string | null
    deadlineAt?: string
  }
): Promise<void> => {
  await db
    .prepare(
      `UPDATE turn_jobs
       SET
         status = ?3,
         retry_count = COALESCE(?4, retry_count),
         failure_streak = COALESCE(?5, failure_streak),
         last_error = COALESCE(?6, last_error),
         deadline_at = COALESCE(?7, deadline_at),
         updated_at = ?8
       WHERE conversation_id = ?1 AND seq_no = ?2`
    )
    .bind(
      payload.conversationId,
      payload.seqNo,
      payload.status,
      payload.retryCount ?? null,
      payload.failureStreak ?? null,
      payload.lastError ?? null,
      payload.deadlineAt ?? null,
      new Date().toISOString()
    )
    .run()
}

export const getConversationContext = async (
  db: D1Database,
  conversationId: string
): Promise<
  | {
      conversation: ConversationRow
      match: MatchRow
      botAId: string
      botBId: string
      turnLimit: number
    }
  | null
> => {
  const row = await db
    .prepare(
      `SELECT
         c.id AS conversation_id,
         c.match_id,
         c.visibility,
         c.status AS conversation_status,
         c.published_at,
         c.ended_reason AS conversation_ended_reason,
         c.created_at AS conversation_created_at,
         c.ended_at AS conversation_ended_at,
         m.id AS match_id_alias,
         m.pool_topic,
         m.status AS match_status,
         m.turn_limit,
         m.expected_seq_no,
         m.created_by,
         m.started_at,
         m.ended_at,
         m.ended_reason,
         m.created_at,
         pa.bot_id AS bot_a_id,
         pb.bot_id AS bot_b_id
       FROM conversations c
       JOIN matches m ON m.id = c.match_id
       JOIN match_participants pa ON pa.match_id = m.id AND pa.side = 'A'
       JOIN match_participants pb ON pb.match_id = m.id AND pb.side = 'B'
       WHERE c.id = ?1
       LIMIT 1`
    )
    .bind(conversationId)
    .first<
      {
        conversation_id: string
        match_id: string
        visibility: 'public' | 'hidden'
        conversation_status: 'live' | 'ended'
        published_at: string | null
        conversation_ended_reason: string | null
        conversation_created_at: string
        conversation_ended_at: string | null
        match_id_alias: string
        pool_topic: string | null
        match_status: MatchRow['status']
        turn_limit: number
        expected_seq_no: number
        created_by: string
        started_at: string | null
        ended_at: string | null
        ended_reason: string | null
        created_at: string
        bot_a_id: string
        bot_b_id: string
      }
    >()

  if (!row) return null

  return {
    conversation: {
      id: row.conversation_id,
      match_id: row.match_id,
      visibility: row.visibility,
      status: row.conversation_status,
      published_at: row.published_at,
      ended_reason: row.conversation_ended_reason,
      created_at: row.conversation_created_at,
      ended_at: row.conversation_ended_at,
    },
    match: {
      id: row.match_id_alias,
      pool_topic: row.pool_topic,
      status: row.match_status,
      turn_limit: Number(row.turn_limit),
      expected_seq_no: Number(row.expected_seq_no),
      created_by: row.created_by,
      started_at: row.started_at,
      ended_at: row.ended_at,
      ended_reason: row.ended_reason,
      created_at: row.created_at,
    },
    botAId: row.bot_a_id,
    botBId: row.bot_b_id,
    turnLimit: Number(row.turn_limit),
  }
}

export const failMatchAndConversation = async (
  db: D1Database,
  payload: { matchId: string; conversationId: string; reason: string }
): Promise<void> => {
  const now = new Date().toISOString()
  await db
    .prepare(`UPDATE matches SET status = 'failed', ended_reason = ?2, ended_at = ?3 WHERE id = ?1`)
    .bind(payload.matchId, payload.reason, now)
    .run()

  await db
    .prepare(`UPDATE conversations SET status = 'ended', ended_reason = ?2, ended_at = ?3 WHERE id = ?1`)
    .bind(payload.conversationId, payload.reason, now)
    .run()
}
