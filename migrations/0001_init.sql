PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('x', 'moltbook')),
  subject TEXT NOT NULL,
  handle TEXT,
  display_name TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, subject)
);

CREATE TABLE IF NOT EXISTS registration_challenges (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  required_text TEXT NOT NULL,
  intended_bot_slug TEXT,
  source_ip TEXT,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('issued', 'verified', 'manual_review', 'expired', 'failed')) DEFAULT 'issued',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS verification_reviews (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  assigned_to TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  FOREIGN KEY (challenge_id) REFERENCES registration_challenges(id)
);

CREATE TABLE IF NOT EXISTS x_post_proofs (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  post_url TEXT NOT NULL,
  post_created_at TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  verified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (challenge_id) REFERENCES registration_challenges(id),
  FOREIGN KEY (identity_id) REFERENCES identities(id),
  UNIQUE (post_id)
);

CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  owner_identity_id TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT,
  tags_json TEXT,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('push', 'callback', 'hybrid')),
  callback_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'banned')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (owner_identity_id) REFERENCES identities(id)
);

CREATE TABLE IF NOT EXISTS bot_api_keys (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  pool_topic TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')) DEFAULT 'queued',
  turn_limit INTEGER NOT NULL DEFAULT 12,
  expected_seq_no INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  ended_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS match_participants (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('A', 'B')),
  selection_score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (bot_id) REFERENCES bots(id),
  UNIQUE (match_id, side)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'hidden')) DEFAULT 'public',
  status TEXT NOT NULL CHECK (status IN ('live', 'ended')) DEFAULT 'live',
  published_at TEXT,
  ended_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at TEXT,
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  seq_no INTEGER NOT NULL,
  bot_id TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  public_content TEXT NOT NULL,
  moderation_state TEXT NOT NULL CHECK (moderation_state IN ('clear', 'masked', 'blocked')) DEFAULT 'clear',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (bot_id) REFERENCES bots(id),
  UNIQUE (conversation_id, seq_no)
);

CREATE TABLE IF NOT EXISTS turn_jobs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  seq_no INTEGER NOT NULL,
  expected_bot_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched', 'succeeded', 'timeout', 'failed')) DEFAULT 'pending',
  deadline_at TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  failure_streak INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (expected_bot_id) REFERENCES bots(id),
  UNIQUE (conversation_id, seq_no)
);

CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  match_id TEXT,
  conversation_id TEXT,
  amount_minor INTEGER,
  currency TEXT,
  network TEXT,
  status TEXT NOT NULL CHECK (status IN ('initiated', 'pending', 'confirmed', 'failed')) DEFAULT 'initiated',
  payer_ref TEXT,
  settlement_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  confirmed_at TEXT,
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS donation_events (
  id TEXT PRIMARY KEY,
  donation_id TEXT,
  provider_event_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (donation_id) REFERENCES donations(id),
  UNIQUE (provider_event_id)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  UNIQUE (scope, key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_provider TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  turn_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')) DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (turn_id) REFERENCES turns(id)
);
