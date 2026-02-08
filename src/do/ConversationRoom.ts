import type { RuntimeEnv } from '../types/runtime'
import { moderateContent } from '../services/moderation'
import { addSeconds, nowIso } from '../utils/time'
import { getConversationContext } from '../repos/matches'

type AppendTurnRequest = {
  action: 'append_turn'
  conversation_id: string
  seq_no: number
  bot_id: string
  content: string
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

export class ConversationRoom {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: RuntimeEnv
  ) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return json(405, { ok: false, error: 'method_not_allowed' })
    }

    let payload: AppendTurnRequest
    try {
      payload = (await request.json()) as AppendTurnRequest
    } catch {
      return json(400, { ok: false, error: 'invalid_json' })
    }

    if (payload.action !== 'append_turn') {
      return json(400, { ok: false, error: 'unsupported_action' })
    }

    return this.appendTurn(payload)
  }

  private async appendTurn(payload: AppendTurnRequest): Promise<Response> {
    const context = await getConversationContext(this.env.DB, payload.conversation_id)
    if (!context) return json(404, { ok: false, error: 'conversation_not_found' })

    if (context.match.status !== 'running' || context.conversation.status !== 'live') {
      return json(409, { ok: false, error: 'conversation_not_live' })
    }

    if (context.match.expected_seq_no !== payload.seq_no) {
      return json(409, {
        ok: false,
        error: 'out_of_order_turn',
        expected_seq_no: context.match.expected_seq_no,
      })
    }

    const expectedBotId = payload.seq_no % 2 === 1 ? context.botAId : context.botBId
    if (expectedBotId !== payload.bot_id) {
      return json(409, { ok: false, error: 'unexpected_bot_for_turn' })
    }

    const moderation = moderateContent(payload.content)
    const turnId = crypto.randomUUID()

    try {
      await this.env.DB.prepare(
        `INSERT INTO turns
          (id, conversation_id, seq_no, bot_id, raw_content, public_content, moderation_state)
         VALUES
          (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      )
        .bind(
          turnId,
          payload.conversation_id,
          payload.seq_no,
          payload.bot_id,
          payload.content,
          moderation.publicContent,
          moderation.state
        )
        .run()
    } catch (error) {
      const message = String(error)
      if (message.includes('UNIQUE') || message.includes('constraint')) {
        return json(409, { ok: false, error: 'duplicate_turn' })
      }
      return json(500, { ok: false, error: 'turn_insert_failed' })
    }

    const updateResult = await this.env.DB.prepare(
      `UPDATE matches
       SET expected_seq_no = expected_seq_no + 1
       WHERE id = ?1
         AND expected_seq_no = ?2`
    )
      .bind(context.match.id, payload.seq_no)
      .run()

    if (!updateResult.success || Number(updateResult.meta.changes) !== 1) {
      return json(409, { ok: false, error: 'sequence_race_detected' })
    }

    await this.env.DB.prepare(
      `UPDATE turn_jobs
       SET status = 'succeeded',
           updated_at = ?3
       WHERE conversation_id = ?1 AND seq_no = ?2`
    )
      .bind(payload.conversation_id, payload.seq_no, nowIso())
      .run()

    if (payload.seq_no >= context.match.turn_limit) {
      const now = nowIso()
      await this.env.DB.prepare(`UPDATE matches SET status = 'completed', ended_at = ?2 WHERE id = ?1`).bind(context.match.id, now).run()
      await this.env.DB.prepare(`UPDATE conversations SET status = 'ended', ended_at = ?2 WHERE id = ?1`).bind(payload.conversation_id, now).run()

      return json(200, {
        ok: true,
        completed: true,
        turn: {
          id: turnId,
          seq_no: payload.seq_no,
          moderation_state: moderation.state,
          public_content: moderation.publicContent,
        },
      })
    }

    const nextSeqNo = payload.seq_no + 1
    const nextBotId = nextSeqNo % 2 === 1 ? context.botAId : context.botBId
    const deadlineAt = addSeconds(nowIso(), 30)

    await this.env.DB.prepare(
      `INSERT OR IGNORE INTO turn_jobs
        (id, conversation_id, seq_no, expected_bot_id, status, deadline_at)
       VALUES
        (?1, ?2, ?3, ?4, 'pending', ?5)`
    )
      .bind(crypto.randomUUID(), payload.conversation_id, nextSeqNo, nextBotId, deadlineAt)
      .run()

    return json(200, {
      ok: true,
      completed: false,
      turn: {
        id: turnId,
        seq_no: payload.seq_no,
        moderation_state: moderation.state,
        public_content: moderation.publicContent,
      },
      next: {
        seq_no: nextSeqNo,
        bot_id: nextBotId,
      },
    })
  }
}
