import type { BotRow, TurnRow } from '../types/db'
import type { RuntimeEnv } from '../types/runtime'
import { hmacSha256Hex } from './crypto'
import { validateCallbackUrl } from './callback-security'

const MAX_RESPONSE_SIZE = 16 * 1024

export type CallbackResult =
  | { ok: true; content: string }
  | { ok: false; retryable: boolean; reason: string }

export const callBotCallback = async (
  env: RuntimeEnv,
  payload: {
    bot: BotRow
    conversationId: string
    matchId: string
    seqNo: number
    opponentBotId: string
    lastTurns: TurnRow[]
  }
): Promise<CallbackResult> => {
  if (!payload.bot.callback_url) {
    return { ok: false, retryable: false, reason: 'callback_url_missing' }
  }

  const validation = validateCallbackUrl(payload.bot.callback_url)
  if (!validation.ok) {
    return { ok: false, retryable: false, reason: validation.reason }
  }

  const body = {
    match_id: payload.matchId,
    conversation_id: payload.conversationId,
    turn_index: payload.seqNo,
    you_are_bot_id: payload.bot.id,
    opponent_bot_id: payload.opponentBotId,
    last_turns: payload.lastTurns.map((turn) => ({
      seq: turn.seq_no,
      bot_id: turn.bot_id,
      content: turn.public_content,
    })),
    constraints: {
      max_chars: 800,
      timeout_ms: 8000,
    },
  }

  const serialized = JSON.stringify(body)
  const timestamp = Date.now().toString()
  const secret = env.CALLBACK_SIGNING_SECRET || 'openclaw-dev-secret'
  const signature = await hmacSha256Hex(secret, `${timestamp}.${serialized}`)

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 8_000)

  try {
    const response = await fetch(payload.bot.callback_url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-openclaw-timestamp': timestamp,
        'x-openclaw-signature': signature,
      },
      body: serialized,
      signal: abortController.signal,
    })

    if (!response.ok) {
      return {
        ok: false,
        retryable: response.status >= 500 || response.status === 429,
        reason: `callback_status_${response.status}`,
      }
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      return { ok: false, retryable: false, reason: 'callback_invalid_content_type' }
    }

    const text = await response.text()
    if (text.length > MAX_RESPONSE_SIZE) {
      return { ok: false, retryable: false, reason: 'callback_response_too_large' }
    }

    const parsed = JSON.parse(text) as { content?: string }
    const content = parsed.content?.trim()
    if (!content) {
      return { ok: false, retryable: false, reason: 'callback_empty_content' }
    }

    return { ok: true, content }
  } catch {
    return { ok: false, retryable: true, reason: 'callback_timeout_or_network' }
  } finally {
    clearTimeout(timeout)
  }
}
