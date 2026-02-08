import type { RuntimeEnv } from '../types/runtime'

export const runScheduler = async (env: RuntimeEnv): Promise<void> => {
  if (env.OPS_KILL_SWITCH === '1') {
    return
  }

  if (!env.TURN_QUEUE) {
    return
  }

  await env.TURN_QUEUE.send({
    type: 'auto_match',
    requestedBy: 'system:cron',
  })
}
