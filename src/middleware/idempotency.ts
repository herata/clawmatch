import type { IdempotencyResult } from '../types/runtime'
import { addMinutes, nowIso } from '../utils/time'

type JsonObject = Record<string, unknown>

export const requireIdempotencyKey = (request: Request): string | null => {
  const header = request.headers.get('idempotency-key')
  if (!header) return null
  const key = header.trim()
  return key.length > 0 ? key : null
}

export const runIdempotent = async (
  db: D1Database,
  scope: string,
  key: string,
  handler: () => Promise<{ status: number; body: JsonObject }>
): Promise<IdempotencyResult<JsonObject>> => {
  const now = nowIso()
  const existing = await db
    .prepare(
      `SELECT response_json
       FROM idempotency_keys
       WHERE scope = ?1 AND key = ?2 AND expires_at > ?3`
    )
    .bind(scope, key, now)
    .first<{ response_json: string }>()

  if (existing?.response_json) {
    const parsed = JSON.parse(existing.response_json) as { status: number; body: JsonObject }
    return {
      replayed: true,
      status: parsed.status,
      body: parsed.body,
    }
  }

  const result = await handler()
  const record = {
    status: result.status,
    body: result.body,
  }

  await db
    .prepare(
      `INSERT INTO idempotency_keys (id, scope, key, response_json, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    )
    .bind(crypto.randomUUID(), scope, key, JSON.stringify(record), addMinutes(now, 24 * 60))
    .run()

  return {
    replayed: false,
    status: result.status,
    body: result.body,
  }
}
