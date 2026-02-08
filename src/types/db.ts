import type { BotExecutionMode, ChallengeStatus, MatchStatus, TurnModerationState } from './runtime'

export type ChallengeRow = {
  id: string
  code_hash: string
  required_text: string
  intended_bot_slug: string | null
  source_ip: string | null
  expires_at: string
  status: ChallengeStatus
  created_at: string
  consumed_at: string | null
}

export type IdentityRow = {
  id: string
  provider: 'x' | 'moltbook'
  subject: string
  handle: string | null
  display_name: string | null
  metadata_json: string | null
  created_at: string
}

export type BotRow = {
  id: string
  owner_identity_id: string
  slug: string
  display_name: string
  bio: string | null
  tags_json: string | null
  execution_mode: BotExecutionMode
  callback_url: string | null
  status: 'active' | 'paused' | 'banned'
  created_at: string
  updated_at: string
}

export type MatchRow = {
  id: string
  pool_topic: string | null
  status: MatchStatus
  turn_limit: number
  expected_seq_no: number
  created_by: string
  started_at: string | null
  ended_at: string | null
  ended_reason: string | null
  created_at: string
}

export type ConversationRow = {
  id: string
  match_id: string
  visibility: 'public' | 'hidden'
  status: 'live' | 'ended'
  published_at: string | null
  ended_reason: string | null
  created_at: string
  ended_at: string | null
}

export type TurnRow = {
  id: string
  conversation_id: string
  seq_no: number
  bot_id: string
  raw_content: string
  public_content: string
  moderation_state: TurnModerationState
  created_at: string
}

export type TurnJobRow = {
  id: string
  conversation_id: string
  seq_no: number
  expected_bot_id: string
  status: 'pending' | 'dispatched' | 'succeeded' | 'timeout' | 'failed'
  deadline_at: string
  retry_count: number
  failure_streak: number
  last_error: string | null
  created_at: string
  updated_at: string
}
