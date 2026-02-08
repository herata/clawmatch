import type { BotExecutionMode } from '../types/runtime'
import type { BotRow } from '../types/db'

export const createBot = async (
  db: D1Database,
  payload: {
    id: string
    ownerIdentityId: string
    slug: string
    displayName: string
    bio: string | null
    tagsJson: string
    executionMode: BotExecutionMode
    callbackUrl: string | null
  }
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO bots
        (id, owner_identity_id, slug, display_name, bio, tags_json, execution_mode, callback_url, status)
       VALUES
        (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active')`
    )
    .bind(
      payload.id,
      payload.ownerIdentityId,
      payload.slug,
      payload.displayName,
      payload.bio,
      payload.tagsJson,
      payload.executionMode,
      payload.callbackUrl
    )
    .run()
}

export const getBotById = async (db: D1Database, botId: string): Promise<BotRow | null> => {
  return (
    (await db
      .prepare(
        `SELECT
           id,
           owner_identity_id,
           slug,
           display_name,
           bio,
           tags_json,
           execution_mode,
           callback_url,
           status,
           created_at,
           updated_at
         FROM bots
         WHERE id = ?1`
      )
      .bind(botId)
      .first<BotRow>()) ?? null
  )
}

export const updateBotById = async (
  db: D1Database,
  botId: string,
  payload: {
    displayName?: string
    bio?: string | null
    tagsJson?: string
    callbackUrl?: string | null
    status?: 'active' | 'paused' | 'banned'
  }
): Promise<void> => {
  await db
    .prepare(
      `UPDATE bots
       SET
         display_name = COALESCE(?2, display_name),
         bio = COALESCE(?3, bio),
         tags_json = COALESCE(?4, tags_json),
         callback_url = COALESCE(?5, callback_url),
         status = COALESCE(?6, status),
         updated_at = ?7
       WHERE id = ?1`
    )
    .bind(
      botId,
      payload.displayName ?? null,
      payload.bio ?? null,
      payload.tagsJson ?? null,
      payload.callbackUrl ?? null,
      payload.status ?? null,
      new Date().toISOString()
    )
    .run()
}

export const insertBotApiKey = async (
  db: D1Database,
  payload: {
    id: string
    botId: string
    keyPrefix: string
    keyHash: string
  }
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO bot_api_keys (id, bot_id, key_prefix, key_hash)
       VALUES (?1, ?2, ?3, ?4)`
    )
    .bind(payload.id, payload.botId, payload.keyPrefix, payload.keyHash)
    .run()
}

export const revokeApiKeysForBot = async (db: D1Database, botId: string): Promise<void> => {
  await db
    .prepare(
      `UPDATE bot_api_keys
       SET revoked_at = ?2
       WHERE bot_id = ?1
         AND revoked_at IS NULL`
    )
    .bind(botId, new Date().toISOString())
    .run()
}

export const listActiveBots = async (db: D1Database, limit = 100): Promise<BotRow[]> => {
  const rows = await db
    .prepare(
      `SELECT
         id,
         owner_identity_id,
         slug,
         display_name,
         bio,
         tags_json,
         execution_mode,
         callback_url,
         status,
         created_at,
         updated_at
       FROM bots
       WHERE status = 'active'
       ORDER BY updated_at DESC
       LIMIT ?1`
    )
    .bind(limit)
    .all<BotRow>()

  return rows.results ?? []
}
