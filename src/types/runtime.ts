export type Provider = 'x' | 'moltbook'
export type Role = 'owner' | 'moderator' | 'admin'

export type AuthPrincipal = {
  provider: Provider
  subject: string
  role?: Role
  botId?: string
}

export type BotExecutionMode = 'push' | 'callback' | 'hybrid'

export type MatchStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'

export type TurnModerationState = 'clear' | 'masked' | 'blocked'

export type RuntimeEnv = {
  DB: D1Database
  TURN_QUEUE?: Queue<QueueMessage>
  CONVERSATION_ROOM?: DurableObjectNamespace
  X_BEARER_TOKEN?: string
  X_API_BASE?: string
  TURNSTILE_SECRET?: string
  ADMIN_KEY?: string
  MODERATOR_KEY?: string
  X402_WEBHOOK_SECRET?: string
  CALLBACK_SIGNING_SECRET?: string
  OPS_KILL_SWITCH?: string
}

export type QueueMessage =
  | {
      type: 'auto_match'
      requestedBy: string
    }
  | {
      type: 'run_turn'
      conversationId: string
      seqNo: number
      delayedAttempt?: number
    }

export type ChallengeStatus = 'issued' | 'verified' | 'manual_review' | 'expired' | 'failed'

export type IdempotencyResult<T> = {
  replayed: boolean
  status: number
  body: T
}
