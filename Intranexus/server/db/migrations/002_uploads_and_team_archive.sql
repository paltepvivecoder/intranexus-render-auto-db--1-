ALTER TABLE teams ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS teams_active_event_idx ON teams(event_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS community_upload_intents (
  photo_key text PRIMARY KEY CHECK (length(photo_key) BETWEEN 1 AND 512),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  max_size_bytes integer NOT NULL CHECK (max_size_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS community_upload_intents_user_expiry_idx ON community_upload_intents(user_id, expires_at);
