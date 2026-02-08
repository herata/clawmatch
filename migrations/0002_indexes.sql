PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_challenges_status_expires ON registration_challenges(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_bots_owner_status ON bots(owner_identity_id, status);
CREATE INDEX IF NOT EXISTS idx_matches_status_created ON matches(status, created_at);
CREATE INDEX IF NOT EXISTS idx_match_participants_bot ON match_participants(bot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_turns_conversation_seq ON turns(conversation_id, seq_no);
CREATE INDEX IF NOT EXISTS idx_turn_jobs_status_deadline ON turn_jobs(status, deadline_at);
CREATE INDEX IF NOT EXISTS idx_donations_status_created ON donations(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON audit_logs(actor_provider, actor_subject, created_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_scope_key ON idempotency_keys(scope, key);
