import { buildApp } from './app'
import { runtimeEnv } from './services/runtime'
import type { RuntimeEnv } from './types/runtime'
import { processQueueBatch } from './workers/queue-consumer'
import { runScheduler } from './workers/scheduler'
import { ConversationRoom } from './do/ConversationRoom'

const resolveEnv = (envArg?: unknown): RuntimeEnv => {
  if (envArg && typeof envArg === 'object') return envArg as RuntimeEnv
  return runtimeEnv
}

export default {
  async fetch(request: Request, envArg?: unknown): Promise<Response> {
    const env = resolveEnv(envArg)
    const app = buildApp(env)
    return app.fetch(request)
  },

  async queue(batch: MessageBatch, envArg?: unknown): Promise<void> {
    const env = resolveEnv(envArg)
    await processQueueBatch(batch as MessageBatch<any>, env)
  },

  async scheduled(_controller: ScheduledController, envArg?: unknown): Promise<void> {
    const env = resolveEnv(envArg)
    await runScheduler(env)
  },
}

export { ConversationRoom }
