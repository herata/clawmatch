import type { RuntimeEnv } from '../types/runtime'
import type { BotRow } from '../types/db'
import { sha256Hex } from '../services/crypto'

export type AuthError = {
  ok: false
  status: number
  error: string
}

export type BotAuthSuccess = {
  ok: true
  bot: BotRow
  keyId: string
}

export const requireBotAuth = async (
  env: RuntimeEnv,
  request: Request
): Promise<BotAuthSuccess | AuthError> => {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'bot_api_key_required' }
  }

  const token = auth.slice('Bearer '.length).trim()
  if (!token.startsWith('ocb_live_')) {
    return { ok: false, status: 401, error: 'invalid_api_key_format' }
  }

  const keyHash = await sha256Hex(token)

  const row = await env.DB.prepare(
    `SELECT
       k.id AS key_id,
       b.id,
       b.owner_identity_id,
       b.slug,
       b.display_name,
       b.bio,
       b.tags_json,
       b.execution_mode,
       b.callback_url,
       b.status,
       b.created_at,
       b.updated_at
     FROM bot_api_keys k
     JOIN bots b ON b.id = k.bot_id
     WHERE k.key_hash = ?1
       AND k.revoked_at IS NULL
       AND b.status = 'active'
     LIMIT 1`
  )
    .bind(keyHash)
    .first<BotRow & { key_id: string }>()

  if (!row) {
    return { ok: false, status: 401, error: 'invalid_or_revoked_api_key' }
  }

  await env.DB.prepare(`UPDATE bot_api_keys SET last_used_at = ?2 WHERE id = ?1`)
    .bind(row.key_id, new Date().toISOString())
    .run()

  return {
    ok: true,
    keyId: row.key_id,
    bot: {
      id: row.id,
      owner_identity_id: row.owner_identity_id,
      slug: row.slug,
      display_name: row.display_name,
      bio: row.bio,
      tags_json: row.tags_json,
      execution_mode: row.execution_mode,
      callback_url: row.callback_url,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  }
}

export const requireAdmin = (env: RuntimeEnv, request: Request): true | AuthError => {
  const key = request.headers.get('x-admin-key')?.trim()
  if (!env.ADMIN_KEY) {
    return { ok: false, status: 500, error: 'admin_key_not_configured' }
  }
  if (!key || key !== env.ADMIN_KEY) {
    return { ok: false, status: 403, error: 'admin_key_invalid' }
  }
  return true
}

export const requireModerator = (env: RuntimeEnv, request: Request): true | AuthError => {
  const key = request.headers.get('x-moderator-key')?.trim() || request.headers.get('x-admin-key')?.trim()
  if (!env.MODERATOR_KEY && !env.ADMIN_KEY) {
    return { ok: false, status: 500, error: 'moderator_key_not_configured' }
  }
  const allowed = [env.MODERATOR_KEY, env.ADMIN_KEY].filter(Boolean)
  if (!key || !allowed.includes(key)) {
    return { ok: false, status: 403, error: 'moderator_key_invalid' }
  }
  return true
}

export const ensureBotOwnership = (authBot: BotRow, targetBotId: string): true | AuthError => {
  if (authBot.id !== targetBotId) {
    return { ok: false, status: 403, error: 'bot_ownership_violation' }
  }
  return true
}
