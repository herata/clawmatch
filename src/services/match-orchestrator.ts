import { getBotById, listActiveBots } from '../repos/bots'
import { createMatchWithConversation, createTurnJob, failMatchAndConversation, getConversationContext, getTurnJob, getTurnsSince, updateTurnJobStatus } from '../repos/matches'
import { pickMatchPair } from './matching'
import type { QueueMessage, RuntimeEnv } from '../types/runtime'
import { addSeconds, nowIso } from '../utils/time'
import { callBotCallback } from './callback'

const RETRY_DELAYS_SECONDS = [0, 5, 30, 120]

const enqueue = async (env: RuntimeEnv, message: QueueMessage, delaySeconds = 0): Promise<void> => {
  if (!env.TURN_QUEUE) return
  await (env.TURN_QUEUE as Queue<QueueMessage>).send(message, delaySeconds > 0 ? ({ delaySeconds } as any) : undefined)
}

const hasRecentPair = async (db: D1Database, botAId: string, botBId: string): Promise<boolean> => {
  const row = await db
    .prepare(
      `SELECT m.id
       FROM matches m
       JOIN match_participants pa ON pa.match_id = m.id AND pa.side = 'A'
       JOIN match_participants pb ON pb.match_id = m.id AND pb.side = 'B'
       WHERE (
           (pa.bot_id = ?1 AND pb.bot_id = ?2)
           OR (pa.bot_id = ?2 AND pb.bot_id = ?1)
       )
       AND m.created_at >= datetime('now', '-24 hours')
       LIMIT 1`
    )
    .bind(botAId, botBId)
    .first<{ id: string }>()

  return Boolean(row?.id)
}

export const createMatch = async (
  env: RuntimeEnv,
  payload: {
    requestedBy: string
    botAId?: string
    botBId?: string
    poolTopic?: string | null
    turnLimit?: number
  }
): Promise<{ ok: true; matchId: string; conversationId: string; botAId: string; botBId: string } | { ok: false; error: string }> => {
  const bots = await listActiveBots(env.DB, 100)
  if (bots.length < 2) return { ok: false, error: 'not_enough_active_bots' }

  let botAId = payload.botAId
  let botBId = payload.botBId
  let score = 0

  if (!botAId || !botBId) {
    const pair = pickMatchPair(bots)
    if (!pair) return { ok: false, error: 'no_pair_available' }
    botAId = pair.botAId
    botBId = pair.botBId
    score = pair.score
  }

  if (!botAId || !botBId || botAId === botBId) {
    return { ok: false, error: 'invalid_pair' }
  }

  const botA = bots.find((bot) => bot.id === botAId) ?? (await getBotById(env.DB, botAId))
  const botB = bots.find((bot) => bot.id === botBId) ?? (await getBotById(env.DB, botBId))

  if (!botA || !botB || botA.status !== 'active' || botB.status !== 'active') {
    return { ok: false, error: 'bot_not_active' }
  }

  if (await hasRecentPair(env.DB, botAId, botBId)) {
    return { ok: false, error: 'pair_cooldown_24h' }
  }

  const matchId = crypto.randomUUID()
  const conversationId = crypto.randomUUID()

  await createMatchWithConversation(env.DB, {
    matchId,
    conversationId,
    poolTopic: payload.poolTopic ?? null,
    createdBy: payload.requestedBy,
    turnLimit: payload.turnLimit ?? 12,
    pair: { botAId, botBId, score },
  })

  await createTurnJob(env.DB, {
    conversationId,
    seqNo: 1,
    expectedBotId: botAId,
    deadlineAt: addSeconds(nowIso(), 30),
  })

  await enqueue(env, {
    type: 'run_turn',
    conversationId,
    seqNo: 1,
  })

  return { ok: true, matchId, conversationId, botAId, botBId }
}

const countRecentFailuresForBot = async (db: D1Database, conversationId: string, botId: string): Promise<number> => {
  const rows = await db
    .prepare(
      `SELECT status
       FROM turn_jobs
       WHERE conversation_id = ?1
         AND expected_bot_id = ?2
       ORDER BY seq_no DESC
       LIMIT 2`
    )
    .bind(conversationId, botId)
    .all<{ status: string }>()

  const statuses = rows.results ?? []
  return statuses.filter((row) => row.status === 'failed' || row.status === 'timeout').length
}

const markFailure = async (
  env: RuntimeEnv,
  payload: {
    conversationId: string
    seqNo: number
    botId: string
    reason: string
    retryable: boolean
  }
): Promise<void> => {
  const job = await getTurnJob(env.DB, payload.conversationId, payload.seqNo)
  if (!job) return

  const attempt = Number(job.retry_count ?? 0)
  if (payload.retryable && attempt < RETRY_DELAYS_SECONDS.length - 1) {
    const nextAttempt = attempt + 1
    await updateTurnJobStatus(env.DB, {
      conversationId: payload.conversationId,
      seqNo: payload.seqNo,
      status: 'pending',
      retryCount: nextAttempt,
      lastError: payload.reason,
      deadlineAt: addSeconds(nowIso(), 30),
    })

    await enqueue(
      env,
      {
        type: 'run_turn',
        conversationId: payload.conversationId,
        seqNo: payload.seqNo,
        delayedAttempt: nextAttempt,
      },
      RETRY_DELAYS_SECONDS[nextAttempt]
    )
    return
  }

  await updateTurnJobStatus(env.DB, {
    conversationId: payload.conversationId,
    seqNo: payload.seqNo,
    status: 'failed',
    lastError: payload.reason,
  })

  const context = await getConversationContext(env.DB, payload.conversationId)
  if (!context) return

  const failureCount = await countRecentFailuresForBot(env.DB, payload.conversationId, payload.botId)
  if (failureCount >= 2) {
    await failMatchAndConversation(env.DB, {
      conversationId: payload.conversationId,
      matchId: context.match.id,
      reason: 'consecutive_bot_failures',
    })
  }
}

export const processRunTurn = async (
  env: RuntimeEnv,
  payload: { conversationId: string; seqNo: number }
): Promise<void> => {
  const context = await getConversationContext(env.DB, payload.conversationId)
  if (!context) return
  if (context.match.status !== 'running' || context.conversation.status !== 'live') return

  const turnJob = await getTurnJob(env.DB, payload.conversationId, payload.seqNo)
  if (!turnJob || turnJob.status === 'succeeded') return

  const expectedBotId = payload.seqNo % 2 === 1 ? context.botAId : context.botBId
  if (expectedBotId !== turnJob.expected_bot_id) {
    await markFailure(env, {
      conversationId: payload.conversationId,
      seqNo: payload.seqNo,
      botId: turnJob.expected_bot_id,
      reason: 'turn_job_expected_bot_mismatch',
      retryable: false,
    })
    return
  }

  const bot = await getBotById(env.DB, expectedBotId)
  if (!bot || bot.status !== 'active') {
    await markFailure(env, {
      conversationId: payload.conversationId,
      seqNo: payload.seqNo,
      botId: expectedBotId,
      reason: 'bot_unavailable',
      retryable: false,
    })
    return
  }

  const now = new Date().getTime()
  const deadline = new Date(turnJob.deadline_at).getTime()
  if (now > deadline && bot.execution_mode === 'push') {
    await markFailure(env, {
      conversationId: payload.conversationId,
      seqNo: payload.seqNo,
      botId: expectedBotId,
      reason: 'push_timeout',
      retryable: false,
    })
    return
  }

  if (bot.execution_mode === 'push') {
    return
  }

  if ((bot.execution_mode === 'callback' || bot.execution_mode === 'hybrid') && !bot.callback_url) {
    if (bot.execution_mode === 'hybrid') return
    await markFailure(env, {
      conversationId: payload.conversationId,
      seqNo: payload.seqNo,
      botId: expectedBotId,
      reason: 'callback_url_missing',
      retryable: false,
    })
    return
  }

  const turns = await getTurnsSince(env.DB, payload.conversationId, Math.max(1, payload.seqNo - 4))
  const callback = await callBotCallback(env, {
    bot,
    conversationId: payload.conversationId,
    matchId: context.match.id,
    seqNo: payload.seqNo,
    opponentBotId: payload.seqNo % 2 === 1 ? context.botBId : context.botAId,
    lastTurns: turns,
  })

  if (!callback.ok) {
    await markFailure(env, {
      conversationId: payload.conversationId,
      seqNo: payload.seqNo,
      botId: expectedBotId,
      reason: callback.reason,
      retryable: callback.retryable,
    })
    return
  }

  if (!env.CONVERSATION_ROOM) {
    await markFailure(env, {
      conversationId: payload.conversationId,
      seqNo: payload.seqNo,
      botId: expectedBotId,
      reason: 'conversation_room_missing',
      retryable: true,
    })
    return
  }

  const stubId = env.CONVERSATION_ROOM.idFromName(payload.conversationId)
  const stub = env.CONVERSATION_ROOM.get(stubId)
  const response = await stub.fetch('https://conversation.internal/append', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'append_turn',
      conversation_id: payload.conversationId,
      seq_no: payload.seqNo,
      bot_id: expectedBotId,
      content: callback.content,
    }),
  })

  if (!response.ok) {
    await markFailure(env, {
      conversationId: payload.conversationId,
      seqNo: payload.seqNo,
      botId: expectedBotId,
      reason: `conversation_do_${response.status}`,
      retryable: response.status >= 500,
    })
    return
  }

  const json = (await response.json()) as { completed?: boolean; next?: { seq_no: number; bot_id: string } }

  if (!json.completed && json.next) {
    await enqueue(env, {
      type: 'run_turn',
      conversationId: payload.conversationId,
      seqNo: json.next.seq_no,
    })
  }
}
