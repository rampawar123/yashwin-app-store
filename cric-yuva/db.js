"use strict";

const path = require("path");
const fs = require("fs");

let sqlInstance = null;
let initPromise = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  mobile TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  player_id TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);
CREATE INDEX IF NOT EXISTS idx_users_player_id ON users(player_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS otp_codes (
  id SERIAL PRIMARY KEY,
  mobile TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts INTEGER DEFAULT 0,
  used BOOLEAN DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_mobile ON otp_codes(mobile);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER DEFAULT 1,
  reset_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  mobile TEXT,
  jersey_name TEXT,
  jersey_number INTEGER,
  jersey_size TEXT,
  role TEXT,
  batting_style TEXT,
  bowling_style TEXT,
  email TEXT,
  birthdate TEXT,
  date_of_birth TEXT,
  photo_url TEXT,
  profile_photo TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_player_id_unique ON players(player_id);
CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_players_mobile ON players(mobile);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);

CREATE TABLE IF NOT EXISTS teams (
  team_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  short_name TEXT,
  captain_id TEXT,
  city TEXT,
  logo_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS team_players (
  id SERIAL PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  is_captain BOOLEAN DEFAULT FALSE,
  is_vice_captain BOOLEAN DEFAULT FALSE,
  playing_xi BOOLEAN DEFAULT TRUE,
  jersey_number INTEGER,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(team_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_team_players_team ON team_players(team_id);
CREATE INDEX IF NOT EXISTS idx_team_players_player ON team_players(player_id);

CREATE TABLE IF NOT EXISTS tournaments (
  tournament_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  short_name TEXT,
  logo_url TEXT,
  city TEXT,
  start_date TEXT,
  end_date TEXT,
  format TEXT DEFAULT 'T20',
  status TEXT DEFAULT 'upcoming',
  is_active BOOLEAN DEFAULT TRUE,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournament_teams (
  id SERIAL PRIMARY KEY,
  tournament_id TEXT REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
  team_id TEXT REFERENCES teams(team_id) ON DELETE CASCADE,
  group_name TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE(tournament_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_tournament_teams_tour ON tournament_teams(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_teams_team ON tournament_teams(team_id);

CREATE TABLE IF NOT EXISTS tournament_players (
  id SERIAL PRIMARY KEY,
  tournament_id TEXT REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
  team_id TEXT REFERENCES teams(team_id) ON DELETE CASCADE,
  player_id TEXT REFERENCES players(player_id) ON DELETE CASCADE,
  role TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE(tournament_id, team_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_tournament_players_tour ON tournament_players(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_players_player ON tournament_players(player_id);

CREATE TABLE IF NOT EXISTS chats (
  id SERIAL PRIMARY KEY,
  room_type TEXT NOT NULL,
  room_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT,
  message TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chats_room ON chats(room_type, room_id);

CREATE TABLE IF NOT EXISTS youtube_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  channel_id TEXT,
  channel_title TEXT,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expiry BIGINT,
  scope TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_youtube_connections_channel ON youtube_connections(channel_id);

CREATE TABLE IF NOT EXISTS streams (
  match_id TEXT PRIMARY KEY,
  tournament_id TEXT,
  started_by TEXT,
  camera_id TEXT,
  status TEXT DEFAULT 'live',
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at BIGINT NOT NULL,
  stopped_at BIGINT
);

CREATE TABLE IF NOT EXISTS live_matches (
  match_id TEXT PRIMARY KEY,
  tournament_id TEXT,
  status TEXT DEFAULT 'live',
  title TEXT,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_matches_updated ON live_matches(updated_at DESC);

CREATE TABLE IF NOT EXISTS join_requests (
  id SERIAL PRIMARY KEY, kind TEXT NOT NULL, target_id TEXT NOT NULL, requester_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'PENDING', created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_join_requests_target ON join_requests(kind, target_id, status);

CREATE TABLE IF NOT EXISTS player_requests (
  id SERIAL PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE, requester_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'PENDING', created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL, tournament_id TEXT REFERENCES tournaments(tournament_id) ON DELETE SET NULL, team_a_id TEXT REFERENCES teams(team_id) ON DELETE SET NULL, team_b_id TEXT REFERENCES teams(team_id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'scheduled', venue TEXT, scheduled_at TEXT, winner_team_id TEXT REFERENCES teams(team_id) ON DELETE SET NULL, data_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

CREATE TABLE IF NOT EXISTS match_players (
  id SERIAL PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE, team_id TEXT REFERENCES teams(team_id) ON DELETE SET NULL, player_id TEXT REFERENCES players(player_id) ON DELETE SET NULL, playing_xi BOOLEAN DEFAULT FALSE, captain BOOLEAN DEFAULT FALSE, wicketkeeper BOOLEAN DEFAULT FALSE, position_no INTEGER, created_at BIGINT NOT NULL, UNIQUE(match_id, player_id)
);

CREATE TABLE IF NOT EXISTS innings (
  innings_id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE, innings_no INTEGER NOT NULL, batting_team_id TEXT REFERENCES teams(team_id) ON DELETE SET NULL, runs INTEGER NOT NULL DEFAULT 0, wickets INTEGER NOT NULL DEFAULT 0, legal_balls INTEGER NOT NULL DEFAULT 0, target_runs INTEGER, status TEXT NOT NULL DEFAULT 'in_progress', data_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, UNIQUE(match_id, innings_no)
);

CREATE TABLE IF NOT EXISTS balls (
  ball_id TEXT PRIMARY KEY, innings_id TEXT NOT NULL REFERENCES innings(innings_id) ON DELETE CASCADE, over_no INTEGER NOT NULL, ball_no INTEGER NOT NULL, batter_id TEXT REFERENCES players(player_id) ON DELETE SET NULL, bowler_id TEXT REFERENCES players(player_id) ON DELETE SET NULL, runs INTEGER NOT NULL DEFAULT 0, extras INTEGER NOT NULL DEFAULT 0, wide BOOLEAN NOT NULL DEFAULT FALSE, no_ball BOOLEAN NOT NULL DEFAULT FALSE, bye BOOLEAN NOT NULL DEFAULT FALSE, leg_bye BOOLEAN NOT NULL DEFAULT FALSE, wicket BOOLEAN NOT NULL DEFAULT FALSE, dismissal TEXT, data_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_balls_innings ON balls(innings_id, over_no, ball_no);

CREATE TABLE IF NOT EXISTS friendships (
  id SERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, friend_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'ACCEPTED', created_at BIGINT NOT NULL, UNIQUE(user_id, friend_user_id)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id SERIAL PRIMARY KEY, from_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, to_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'PENDING', created_at BIGINT NOT NULL, UNIQUE(from_user_id, to_user_id)
);

CREATE TABLE IF NOT EXISTS admins (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'ADMIN', permissions JSONB NOT NULL DEFAULT '{}'::jsonb, enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, resource_type TEXT, resource_id TEXT, ip TEXT, data_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS plans (
  plan_id TEXT PRIMARY KEY, name TEXT NOT NULL, amount_paise INTEGER NOT NULL DEFAULT 0, duration_days INTEGER NOT NULL DEFAULT 180, active BOOLEAN NOT NULL DEFAULT TRUE, data_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, plan_id TEXT NOT NULL REFERENCES plans(plan_id), status TEXT NOT NULL DEFAULT 'TRIAL', provider TEXT, provider_payment_id TEXT, starts_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, data_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS awards (
  id SERIAL PRIMARY KEY, match_id TEXT REFERENCES matches(match_id) ON DELETE CASCADE, player_id TEXT REFERENCES players(player_id) ON DELETE SET NULL, award_type TEXT NOT NULL, data_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY, user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT, body TEXT, read_at BIGINT, data_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_runs (
  backup_id TEXT PRIMARY KEY, requested_by TEXT REFERENCES users(user_id) ON DELETE SET NULL, status TEXT NOT NULL, started_at BIGINT NOT NULL, finished_at BIGINT, location TEXT, checksum TEXT, data_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS broadcast_destinations (
  id SERIAL PRIMARY KEY, match_id TEXT REFERENCES matches(match_id) ON DELETE CASCADE, destination_type TEXT NOT NULL, target TEXT, status TEXT NOT NULL DEFAULT 'READY', created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_officials (
  id BIGSERIAL PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, role TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at BIGINT NOT NULL, UNIQUE(match_id,user_id,role)
);
CREATE INDEX IF NOT EXISTS idx_match_officials_match ON match_officials(match_id,enabled);

CREATE TABLE IF NOT EXISTS grounds (
  ground_id TEXT PRIMARY KEY, tournament_id TEXT REFERENCES tournaments(tournament_id) ON DELETE CASCADE, name TEXT NOT NULL, location TEXT, map_url TEXT, capacity INTEGER, data_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grounds_tournament ON grounds(tournament_id);

CREATE TABLE IF NOT EXISTS match_highlights (
  id BIGSERIAL PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE, innings_id TEXT REFERENCES innings(innings_id) ON DELETE SET NULL, ball_id TEXT REFERENCES balls(ball_id) ON DELETE SET NULL, highlight_type TEXT NOT NULL, title TEXT, video_url TEXT, timestamp_seconds INTEGER, data_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_match_highlights_match ON match_highlights(match_id,created_at);
`;

async function getDatabase() {
  if (sqlInstance) return sqlInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let sql;

    if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("memory")) {
      const postgres = require("postgres");
      sql = postgres(process.env.DATABASE_URL, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10
      });
      sql.exec = async function (raw) {
        return await sql.unsafe(raw);
      };
    } else {
      const { PGlite } = require("@electric-sql/pglite");
      const dataDir = process.env.CRIC_YUVA_DATA_DIR
        ? path.join(process.env.CRIC_YUVA_DATA_DIR, "pgdata")
        : path.resolve(__dirname, "../pgdata");
      fs.mkdirSync(dataDir, { recursive: true });

      // Clean up stale pid or socket files if present
      const pidFile = path.join(dataDir, "postmaster.pid");
      if (fs.existsSync(pidFile)) {
        try { fs.unlinkSync(pidFile); } catch (e) {}
      }
      try {
        const entries = fs.readdirSync(dataDir);
        for (const f of entries) {
          if (f.startsWith(".s.PGSQL")) {
            try { fs.unlinkSync(path.join(dataDir, f)); } catch (e) {}
          }
        }
      } catch (e) {}

      let pglite;
      try {
        pglite = new PGlite(dataDir);
        await pglite.waitReady;
      } catch (err) {
        console.warn("PGlite recovery triggered:", err?.message || err);
        const backupDir = dataDir + ".bak." + Date.now();
        try {
          fs.renameSync(dataDir, backupDir);
        } catch (renameErr) {
          console.warn("Could not rename dataDir:", renameErr);
        }
        fs.mkdirSync(dataDir, { recursive: true });
        pglite = new PGlite(dataDir);
        await pglite.waitReady;
      }

      sql = async function (strings, ...values) {
        let query = strings[0];
        const params = [];
        for (let i = 0; i < values.length; i++) {
          params.push(values[i]);
          query += "$" + (i + 1) + strings[i + 1];
        }
        const res = await pglite.query(query, params);
        return res.rows;
      };

      sql.exec = async function (raw) {
        return await pglite.exec(raw);
      };

      sql.unsafe = async function (query, params = []) {
        const res = await pglite.query(query, params);
        return res.rows;
      };
    }

    await sql.exec(SCHEMA_SQL);

    // Run safe column migrations for existing tables
    const migrations = [
      "ALTER TABLE matches ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL;",
      "ALTER TABLE players ADD COLUMN IF NOT EXISTS birthdate TEXT;",
      "ALTER TABLE players ADD COLUMN IF NOT EXISTS photo_url TEXT;",
      "ALTER TABLE players ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;",
      "ALTER TABLE teams ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL;",
      "ALTER TABLE teams ADD COLUMN IF NOT EXISTS city TEXT;",
      "ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo_url TEXT;",
      "ALTER TABLE teams ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;",
      "CREATE INDEX IF NOT EXISTS idx_teams_user_id ON teams(user_id);",
      "CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);",
      "CREATE INDEX IF NOT EXISTS idx_teams_short_name ON teams(short_name);",
      "CREATE TABLE IF NOT EXISTS team_players (id SERIAL PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE, player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE, is_captain BOOLEAN DEFAULT FALSE, is_vice_captain BOOLEAN DEFAULT FALSE, playing_xi BOOLEAN DEFAULT TRUE, jersey_number INTEGER, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, UNIQUE(team_id, player_id));",
      "CREATE INDEX IF NOT EXISTS idx_team_players_team ON team_players(team_id);",
      "CREATE INDEX IF NOT EXISTS idx_team_players_player ON team_players(player_id);",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL;",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS short_name TEXT;",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS logo_url TEXT;",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS city TEXT;",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS start_date TEXT;",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS end_date TEXT;",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS format TEXT DEFAULT 'T20';",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'upcoming';",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;",
      "CREATE INDEX IF NOT EXISTS idx_tournaments_user_id ON tournaments(user_id);",
      "CREATE INDEX IF NOT EXISTS idx_tournaments_name ON tournaments(name);",
      "CREATE INDEX IF NOT EXISTS idx_tournaments_short_name ON tournaments(short_name);",
      "CREATE INDEX IF NOT EXISTS idx_tournaments_city ON tournaments(city);",
      "CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);",
      "CREATE TABLE IF NOT EXISTS tournament_teams (id SERIAL PRIMARY KEY, tournament_id TEXT REFERENCES tournaments(tournament_id) ON DELETE CASCADE, team_id TEXT REFERENCES teams(team_id) ON DELETE CASCADE, group_name TEXT, created_at BIGINT NOT NULL, UNIQUE(tournament_id, team_id));",
      "CREATE INDEX IF NOT EXISTS idx_tournament_teams_tour ON tournament_teams(tournament_id);",
      "CREATE INDEX IF NOT EXISTS idx_tournament_teams_team ON tournament_teams(team_id);",
      "CREATE TABLE IF NOT EXISTS tournament_players (id SERIAL PRIMARY KEY, tournament_id TEXT REFERENCES tournaments(tournament_id) ON DELETE CASCADE, team_id TEXT REFERENCES teams(team_id) ON DELETE CASCADE, player_id TEXT REFERENCES players(player_id) ON DELETE CASCADE, role TEXT, created_at BIGINT NOT NULL, UNIQUE(tournament_id, team_id, player_id));",
      "CREATE INDEX IF NOT EXISTS idx_tournament_players_tour ON tournament_players(tournament_id);",
      "CREATE INDEX IF NOT EXISTS idx_tournament_players_player ON tournament_players(player_id);"
    ];

    for (const statement of migrations) {
      try {
        await sql.exec(statement);
      } catch (err) {
        // Safe skip if already migrated or unsupported in current state
      }
    }

    // No demo teams/tournaments/live matches are seeded. Production data must
    // originate from authenticated users and the central database.
    // Clean only the exact legacy demo records created by earlier Cric Yuva builds.
    try {
      await sql`DELETE FROM tournament_teams WHERE team_id IN ('CYT-2026-1001-INDYUVA','CYT-2026-1002-GLOBXI')`;
      await sql`DELETE FROM teams WHERE team_id IN ('CYT-2026-1001-INDYUVA','CYT-2026-1002-GLOBXI') AND user_id IS NULL`;
      await sql`DELETE FROM tournaments WHERE tournament_id='CYTR-2026-1001-YUVACUP' AND user_id IS NULL`;
      await sql`DELETE FROM live_matches WHERE match_id IN ('MATCH-001','MATCH-002')`;
    } catch (_) {}

    try {
      await sql`INSERT INTO plans(plan_id,name,amount_paise,duration_days,active,data_json) VALUES('FREE_TRIAL','Cric Yuva Free Trial',0,180,TRUE,'{"type":"trial"}'::jsonb) ON CONFLICT(plan_id) DO NOTHING`;
    } catch {}

    sqlInstance = sql;
    return sqlInstance;
  })();

  return initPromise;
}

module.exports = {
  getDatabase,
  SCHEMA_SQL
};
