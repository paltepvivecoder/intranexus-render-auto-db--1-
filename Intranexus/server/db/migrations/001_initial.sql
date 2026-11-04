CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  full_name text NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 120),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'organizer', 'teacher', 'student')),
  account_status text NOT NULL DEFAULT 'pending' CHECK (account_status IN ('pending', 'approved', 'rejected')),
  enrolled_verified boolean NOT NULL DEFAULT false,
  tryout_passed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id),
  CHECK (role <> 'admin' OR account_status = 'approved')
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_sessions_user_expiry_idx ON user_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 140),
  category text NOT NULL CHECK (category IN ('sports', 'esports')),
  event_format text NOT NULL CHECK (event_format IN ('round_robin', 'single_elimination')),
  description text NOT NULL DEFAULT '',
  starts_at timestamptz,
  ends_at timestamptz,
  venue text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'registration', 'ongoing', 'completed', 'cancelled')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  generation_confirmed_at timestamptz,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CHECK ((category = 'sports' AND event_format = 'round_robin') OR (category = 'esports' AND event_format = 'single_elimination'))
);
CREATE INDEX IF NOT EXISTS events_status_start_idx ON events(status, starts_at);

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  category text NOT NULL DEFAULT '',
  camp_leader_id uuid REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);
CREATE INDEX IF NOT EXISTS teams_event_idx ON teams(event_id);

CREATE TABLE IF NOT EXISTS team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_captain boolean NOT NULL DEFAULT false,
  assigned_by uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_members_user_idx ON team_members(user_id);

CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number > 0),
  stage text NOT NULL DEFAULT '',
  match_number integer NOT NULL CHECK (match_number > 0),
  home_team_id uuid REFERENCES teams(id),
  away_team_id uuid REFERENCES teams(id),
  scheduled_at timestamptz,
  venue text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'ongoing', 'finished', 'bye', 'cancelled')),
  home_score integer NOT NULL DEFAULT 0 CHECK (home_score >= 0),
  away_score integer NOT NULL DEFAULT 0 CHECK (away_score >= 0),
  winner_team_id uuid REFERENCES teams(id),
  is_locked boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  next_match_id uuid REFERENCES matches(id),
  next_slot text CHECK (next_slot IS NULL OR next_slot IN ('home', 'away')),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, round_number, match_number),
  CHECK (home_team_id IS NOT NULL OR away_team_id IS NOT NULL OR round_number > 1),
  CHECK (winner_team_id IS NULL OR winner_team_id = home_team_id OR winner_team_id = away_team_id),
  CHECK ((next_match_id IS NULL AND next_slot IS NULL) OR (next_match_id IS NOT NULL AND next_slot IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS matches_event_schedule_idx ON matches(event_id, scheduled_at, round_number, match_number);
CREATE INDEX IF NOT EXISTS matches_status_idx ON matches(status, scheduled_at);

CREATE TABLE IF NOT EXISTS medal_points (
  medal text PRIMARY KEY CHECK (medal IN ('gold', 'silver', 'bronze')),
  points integer NOT NULL CHECK (points >= 0),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO medal_points (medal, points) VALUES ('gold', 3), ('silver', 2), ('bronze', 1)
ON CONFLICT (medal) DO NOTHING;

CREATE TABLE IF NOT EXISTS event_awards (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  medal text NOT NULL REFERENCES medal_points(medal),
  points integer NOT NULL CHECK (points >= 0),
  awarded_by uuid NOT NULL REFERENCES users(id),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, team_id),
  UNIQUE (event_id, medal)
);
CREATE INDEX IF NOT EXISTS event_awards_team_idx ON event_awards(team_id);

CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  content text NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 10000),
  target_audience text[] NOT NULL DEFAULT ARRAY['all']::text[],
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS announcements_created_idx ON announcements(created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS community_posts (
  id uuid PRIMARY KEY,
  event_id uuid REFERENCES events(id),
  author_id uuid NOT NULL REFERENCES users(id),
  caption text NOT NULL DEFAULT '' CHECK (length(caption) <= 2000),
  photo_key text NOT NULL CHECK (length(photo_key) BETWEEN 1 AND 512),
  attendance_status text NOT NULL DEFAULT 'pending' CHECK (attendance_status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS community_posts_feed_idx ON community_posts(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS community_posts_attendance_idx ON community_posts(attendance_status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  changes jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_id, occurred_at DESC);
