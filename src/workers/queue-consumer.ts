import { createMatch, processRunTurn } from '../services/match-orchestrator'
import type { QueueMessage, RuntimeEnv } from '../types/runtime'

export const processQueueBatch = async (batch: MessageBatch<QueueMessage>, env: RuntimeEnv): Promise<void> => {
  for (const message of batch.messages) {
    try {
      const body = message.body
      if (body.type === 'auto_match') {
        await createMatch(env, {
          requestedBy: body.requestedBy,
        })
      } else if (body.type === 'run_turn') {
        await processRunTurn(env, {
          conversationId: body.conversationId,
          seqNo: body.seqNo,
        })
      }
      message.ack()
    } catch {
      message.retry()
    }
  }
}
