"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const Database = require("better-sqlite3");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR =
  process.env.CRIC_YUVA_DATA_DIR ||
  (fs.existsSync("/data") ? "/data" : path.join(__dirname, "data"));

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "cric-yuva.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  mobile TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Cric Yuva Player',
  player_id TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teams (
  team_id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  name TEXT UNIQUE NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournaments (
  tournament_id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS live_matches (
  match_id TEXT PRIMARY KEY,
  tournament_id TEXT,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS streams (
  match_id TEXT PRIMARY KEY,
  tournament_id TEXT,
  started_by TEXT,
  started_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_type TEXT NOT NULL,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chats_room
ON chats(room_type, room_id, id);
`);

const app = express();

app.use(express.json({ limit: "4mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function hashPassword(
  password,
  salt = crypto.randomBytes(16).toString("hex")
) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;

  const candidate = crypto
    .scryptSync(String(password), salt, 64)
    .toString("hex");

  const candidateBuffer = Buffer.from(candidate, "hex");
  const storedBuffer = Buffer.from(hash, "hex");

  if (candidateBuffer.length !== storedBuffer.length) return false;

  return crypto.timingSafeEqual(candidateBuffer, storedBuffer);
}

function cleanMobile(v) {
  return String(v || "")
    .replace(/\D/g, "")
    .slice(-10);
}

function authUser(req) {
  const token = String(req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!token) return null;

  const row = db
    .prepare(
      "SELECT u.* FROM sessions s JOIN users u ON u.user_id=s.user_id WHERE s.token=?"
    )
    .get(token);

  return row || null;
}

function requireAuth(req, res, next) {
  const user = authUser(req);

  if (!user) {
    return res.status(401).json({ error: "Login required" });
  }

  req.user = user;
  next();
}

function makeIds(mobile) {
  const suffix =
    mobile.slice(-4) ||
    String(Math.floor(1000 + Math.random() * 9000));

  return {
    userId: `CYU-${suffix}-${crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase()}`,
    playerId: `CY2026-${suffix}`,
  };
}

function issueSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");

  db.prepare(
    "INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)"
  ).run(token, userId, new Date().toISOString());

  return token;
}

function safeUser(row) {
  return {
    userId: row.user_id,
    mobile: row.mobile,
    name: row.name,
    playerId: row.player_id,
    createdAt: row.created_at,
  };
}

function sanitizePlayer(p) {
  if (!p || typeof p !== "object") return p;

  const out = { ...p };
  delete out.mobile;
  delete out.email;
  delete out.password;

  return out;
}

function publicTeam(data) {
  const out = { ...(data || {}) };

  if (Array.isArray(out.players)) {
    out.players = out.players.map(sanitizePlayer);
  }

  delete out.ownerUserId;
  delete out.owner_user_id;

  return out;
}

function publicTournament(data) {
  const out = JSON.parse(JSON.stringify(data || {}));

  (out.teams || []).forEach((team) => {
    if (team && Array.isArray(team.players)) {
      team.players = team.players.map(sanitizePlayer);
    }
  });

  (out.groups || []).forEach((group) => {
    (group.teams || []).forEach((team) => {
      if (
        team &&
        typeof team === "object" &&
        Array.isArray(team.players)
      ) {
        team.players = team.players.map(sanitizePlayer);
      }
    });
  });

  delete out.ownerUserId;
  delete out.owner_user_id;

  return out;
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "cric-yuva",
    time: new Date().toISOString(),
  });
});

app.post("/api/auth/register", (req, res) => {
  const mobile = cleanMobile(req.body.mobile);
  const password = String(req.body.password || "");
  const name =
    String(req.body.name || "Cric Yuva Player")
      .trim()
      .slice(0, 80) || "Cric Yuva Player";

  if (mobile.length !== 10) {
    return res
      .status(400)
      .json({ error: "Valid 10 digit mobile number required" });
  }

  if (password.length < 4) {
    return res
      .status(400)
      .json({ error: "Password must be at least 4 characters" });
  }

  if (db.prepare("SELECT 1 FROM users WHERE mobile=?").get(mobile)) {
    return res
      .status(409)
      .json({ error: "Mobile number already registered" });
  }

  const { userId, playerId } = makeIds(mobile);
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO users(user_id,mobile,password_hash,name,player_id,created_at) VALUES(?,?,?,?,?,?)"
  ).run(
    userId,
    mobile,
    hashPassword(password),
    name,
    playerId,
    now
  );

  db.prepare(
    "INSERT INTO profiles(user_id,data_json,updated_at) VALUES(?,?,?)"
  ).run(
    userId,
    JSON.stringify({ name, mobile, playerId }),
    now
  );

  const user = db
    .prepare("SELECT * FROM users WHERE user_id=?")
    .get(userId);

  res.json({
    success: true,
    token: issueSession(userId),
    user: safeUser(user),
  });
});

app.post("/api/auth/login", (req, res) => {
  const mobile = cleanMobile(req.body.mobile);
  const password = String(req.body.password || "");

  const user = db
    .prepare("SELECT * FROM users WHERE mobile=?")
    .get(mobile);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res
      .status(401)
      .json({ error: "Invalid mobile number or password" });
  }

  res.json({
    success: true,
    token: issueSession(user.user_id),
    user: safeUser(user),
  });
});

app.get("/api/profile", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT data_json FROM profiles WHERE user_id=?")
    .get(req.user.user_id);

  res.json({
    profile: row ? JSON.parse(row.data_json) : safeUser(req.user),
  });
});

app.put("/api/profile", requireAuth, (req, res) => {
  const data = {
    ...(req.body || {}),
    userId: req.user.user_id,
    mobile: req.user.mobile,
    playerId: req.user.player_id,
  };

  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO profiles(user_id,data_json,updated_at)
     VALUES(?,?,?)
     ON CONFLICT(user_id)
     DO UPDATE SET
       data_json=excluded.data_json,
       updated_at=excluded.updated_at`
  ).run(
    req.user.user_id,
    JSON.stringify(data),
    now
  );

  if (data.name) {
    db.prepare("UPDATE users SET name=? WHERE user_id=?").run(
      String(data.name).slice(0, 80),
      req.user.user_id
    );
  }

  res.json({ success: true });
});

app.post("/api/teams", requireAuth, (req, res) => {
  const name = String(req.body.name || "").trim();

  if (!name) {
    return res.status(400).json({ error: "Team name required" });
  }

  const id = String(
    req.body.id ||
      `team_${crypto.randomBytes(8).toString("hex")}`
  ).slice(0, 80);

  const existing = db
    .prepare("SELECT owner_user_id FROM teams WHERE team_id=?")
    .get(id);

  if (
    existing &&
    existing.owner_user_id !== req.user.user_id
  ) {
    return res.status(403).json({
      error: "Only the team owner can update this team",
    });
  }

  const data = {
    ...req.body,
    id,
    name,
    ownerUserId: req.user.user_id,
  };

  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO teams(team_id,owner_user_id,name,data_json,updated_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(team_id)
     DO UPDATE SET
       name=excluded.name,
       data_json=excluded.data_json,
       updated_at=excluded.updated_at`
  ).run(
    id,
    req.user.user_id,
    name,
    JSON.stringify(data),
    now
  );

  res.json({
    success: true,
    team: publicTeam(data),
  });
});

app.get("/api/teams", (req, res) => {
  const q = String(req.query.search || "").trim();

  const rows = q
    ? db
        .prepare(
          "SELECT data_json FROM teams WHERE name LIKE ? ORDER BY name LIMIT 50"
        )
        .all(`%${q}%`)
    : db
        .prepare(
          "SELECT data_json FROM teams ORDER BY name LIMIT 100"
        )
        .all();

  res.json({
    teams: rows.map((r) =>
      publicTeam(JSON.parse(r.data_json))
    ),
  });
});

app.get("/api/teams/:id", (req, res) => {
  const row = db
    .prepare(
      "SELECT data_json FROM teams WHERE team_id=? OR lower(name)=lower(?)"
    )
    .get(req.params.id, req.params.id);

  if (!row) {
    return res.status(404).json({ error: "Team not found" });
  }

  res.json({
    success: true,
    team: publicTeam(JSON.parse(row.data_json)),
  });
});

app.post("/api/tournaments", requireAuth, (req, res) => {
  const t = req.body || {};

  const id = String(
    t.id ||
      `tourney_${crypto.randomBytes(8).toString("hex")}`
  ).slice(0, 100);

  const name =
    String(t.name || "Untitled Tournament").trim();

  const existing = db
    .prepare(
      "SELECT owner_user_id FROM tournaments WHERE tournament_id=?"
    )
    .get(id);

  if (
    existing &&
    existing.owner_user_id !== req.user.user_id
  ) {
    return res.status(403).json({
      error: "Only the tournament owner can update this tournament",
    });
  }

  const data = {
    ...t,
    id,
    name,
    ownerUserId: req.user.user_id,
  };

  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO tournaments(tournament_id,owner_user_id,name,data_json,updated_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(tournament_id)
     DO UPDATE SET
       name=excluded.name,
       data_json=excluded.data_json,
       updated_at=excluded.updated_at`
  ).run(
    id,
    req.user.user_id,
    name,
    JSON.stringify(data),
    now
  );

  res.json({
    success: true,
    tournament: publicTournament(data),
  });
});

app.get("/api/tournaments", (req, res) => {
  const q = String(req.query.search || "").trim();

  const rows = q
    ? db
        .prepare(
          "SELECT data_json FROM tournaments WHERE name LIKE ? ORDER BY updated_at DESC LIMIT 50"
        )
        .all(`%${q}%`)
    : db
        .prepare(
          "SELECT data_json FROM tournaments ORDER BY updated_at DESC LIMIT 100"
        )
        .all();

  res.json({
    tournaments: rows.map((r) =>
      publicTournament(JSON.parse(r.data_json))
    ),
  });
});

app.get("/api/tournaments/:id", (req, res) => {
  const row = db
    .prepare(
      "SELECT data_json FROM tournaments WHERE tournament_id=? OR lower(name)=lower(?)"
    )
    .get(req.params.id, req.params.id);

  if (!row) {
    return res
      .status(404)
      .json({ error: "Tournament not found" });
  }

  res.json({
    success: true,
    tournament: publicTournament(
      JSON.parse(row.data_json)
    ),
  });
});

function resolveTeamId(id) {
  const key = String(id || "").trim();

  const row = db
    .prepare(
      "SELECT team_id FROM teams WHERE team_id=? OR lower(name)=lower(?)"
    )
    .get(key, key);

  return row ? row.team_id : null;
}

function resolveTournamentId(id) {
  const key = String(id || "").trim();

  const row = db
    .prepare(
      "SELECT tournament_id FROM tournaments WHERE tournament_id=? OR lower(name)=lower(?)"
    )
    .get(key, key);

  return row ? row.tournament_id : null;
}

app.get("/api/join-requests", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT jr.*, t.owner_user_id
       FROM join_requests jr
       LEFT JOIN teams t
         ON jr.kind='TEAM'
        AND jr.target_id=t.team_id
       WHERE t.owner_user_id=?
         AND jr.status='PENDING'
       ORDER BY jr.id DESC`
    )
    .all(req.user.user_id);

  res.json({
    success: true,
    requests: rows,
  });
});

app.post(
  "/api/join-requests/:id/accept",
  requireAuth,
  (req, res) => {
    const row = db
      .prepare(
        `SELECT jr.*, t.owner_user_id
         FROM join_requests jr
         LEFT JOIN teams t
           ON jr.kind='TEAM'
          AND jr.target_id=t.team_id
         WHERE jr.id=?`
      )
      .get(req.params.id);

    if (
      !row ||
      row.owner_user_id !== req.user.user_id
    ) {
      return res.status(403).json({
        error: "Not authorized",
      });
    }

    db.prepare(
      "UPDATE join_requests SET status='ACCEPTED' WHERE id=?"
    ).run(req.params.id);

    res.json({ success: true });
  }
);

app.post("/api/join/team", requireAuth, (req, res) => {
  const target = resolveTeamId(
    req.body.teamId || req.body.teamName
  );

  if (!target) {
    return res.status(404).json({
      error: "Team not found on central server",
    });
  }

  db.prepare(
    `INSERT INTO join_requests(
      kind,target_id,requester_id,status,created_at
    ) VALUES('TEAM',?,?, 'PENDING',?)`
  ).run(
    target,
    req.user.user_id,
    new Date().toISOString()
  );

  res.json({
    success: true,
    status: "PENDING",
  });
});

app.post(
  "/api/join/tournament",
  requireAuth,
  (req, res) => {
    const target = resolveTournamentId(
      req.body.tournamentId ||
        req.body.tournamentName
    );

    if (!target) {
      return res.status(404).json({
        error: "Tournament not found on central server",
      });
    }

    db.prepare(
      `INSERT INTO join_requests(
        kind,target_id,requester_id,status,created_at
      ) VALUES('TOURNAMENT',?,?, 'PENDING',?)`
    ).run(
      target,
      req.user.user_id,
      new Date().toISOString()
    );

    res.json({
      success: true,
      status: "PENDING",
    });
  }
);

app.post("/api/player/request", requireAuth, (req, res) => {
  const playerId = String(
    req.body.playerId || ""
  ).trim();

  if (!playerId) {
    return res
      .status(400)
      .json({ error: "Player ID required" });
  }

  db.prepare(
    `INSERT INTO player_requests(
      player_id,requester_id,status,created_at
    ) VALUES(?,?,'PENDING',?)`
  ).run(
    playerId,
    req.user.user_id,
    new Date().toISOString()
  );

  res.json({
    success: true,
    status: "PENDING",
  });
});

app.get(
  "/api/chat/:roomType/:roomId",
  requireAuth,
  (req, res) => {
    const roomType = String(
      req.params.roomType || ""
    ).toUpperCase();

    if (!["TEAM", "TOURNAMENT"].includes(roomType)) {
      return res.status(400).json({
        error: "Invalid room",
      });
    }

    const rows = db
      .prepare(
        `SELECT
          user_id as userId,
          message,
          created_at as createdAt
         FROM chats
         WHERE room_type=? AND room_id=?
         ORDER BY id DESC
         LIMIT 100`
      )
      .all(roomType, req.params.roomId)
      .reverse();

    res.json({
      success: true,
      messages: rows,
    });
  }
);

app.get(
  "/api/chat/team/:tournamentId/:teamName",
  requireAuth,
  (req, res) => {
    const roomId =
      `${req.params.tournamentId}:${decodeURIComponent(
        req.params.teamName
      )}`;

    const rows = db
      .prepare(
        `SELECT
          user_id as userId,
          message,
          created_at as createdAt
         FROM chats
         WHERE room_type='TEAM' AND room_id=?
         ORDER BY id DESC
         LIMIT 100`
      )
      .all(roomId)
      .reverse();

    res.json({
      success: true,
      messages: rows,
    });
  }
);

app.post(
  "/api/chat/team/:tournamentId/:teamName",
  requireAuth,
  (req, res) => {
    const roomId =
      `${req.params.tournamentId}:${decodeURIComponent(
        req.params.teamName
      )}`;

    const message = String(
      req.body.message || ""
    ).trim();

    if (!message) {
      return res.status(400).json({
        error: "Invalid chat message",
      });
    }

    const now = new Date().toISOString();
    const cleanMessage = message.slice(0, 1000);

    db.prepare(
      `INSERT INTO chats(
        room_type,room_id,user_id,message,created_at
      ) VALUES('TEAM',?,?,?,?)`
    ).run(
      roomId,
      req.user.user_id,
      cleanMessage,
      now
    );

    const item = {
      roomType: "TEAM",
      roomId,
      userId: req.user.user_id,
      message: cleanMessage,
      createdAt: now,
    };

    broadcastRoom("TEAM", roomId, {
      type: "TEAM_CHAT_MESSAGE",
      message: item,
    });

    res.json({
      success: true,
      message: item,
    });
  }
);

app.post(
  "/api/chat/:roomType/:roomId",
  requireAuth,
  (req, res) => {
    const roomType = String(
      req.params.roomType || ""
    ).toUpperCase();

    const message = String(
      req.body.message || ""
    ).trim();

    if (
      !message ||
      !["TEAM", "TOURNAMENT"].includes(roomType)
    ) {
      return res.status(400).json({
        error: "Invalid chat message",
      });
    }

    const now = new Date().toISOString();
    const cleanMessage = message.slice(0, 1000);

    db.prepare(
      `INSERT INTO chats(
        room_type,room_id,user_id,message,created_at
      ) VALUES(?,?,?,?,?)`
    ).run(
      roomType,
      req.params.roomId,
      req.user.user_id,
      cleanMessage,
      now
    );

    const item = {
      roomType,
      roomId: req.params.roomId,
      userId: req.user.user_id,
      message: cleanMessage,
      createdAt: now,
    };

    broadcastRoom(
      roomType,
      req.params.roomId,
      {
        type:
          roomType === "TEAM"
            ? "TEAM_CHAT_MESSAGE"
            : "TOURNAMENT_CHAT_MESSAGE",
        message: item,
      }
    );

    res.json({
      success: true,
      message: item,
    });
  }
);

app.post(
  "/api/live/stream/authorize",
  requireAuth,
  (req, res) => {
    const matchId = String(
      req.body.matchId || ""
    ).trim();

    if (!matchId) {
      return res.status(400).json({
        error: "Match ID required",
      });
    }

    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO streams(
        match_id,tournament_id,started_by,started_at,active
      )
      VALUES(?,?,?,?,1)
      ON CONFLICT(match_id)
      DO UPDATE SET
        tournament_id=excluded.tournament_id,
        started_by=excluded.started_by,
        started_at=excluded.started_at,
        active=1`
    ).run(
      matchId,
      req.body.tournamentId || null,
      req.user.user_id,
      now
    );

    res.json({
      success: true,
      streamActive: true,
      matchId,
    });
  }
);

app.post(
  "/api/live/stream/stop",
  requireAuth,
  (req, res) => {
    const matchId = String(
      req.body.matchId || ""
    ).trim();

    if (matchId) {
      db.prepare(
        "UPDATE streams SET active=0 WHERE match_id=?"
      ).run(matchId);

      broadcastRoom(
        "MATCH",
        matchId,
        {
          type: "STREAM_STOPPED",
          matchId,
        }
      );
    }

    res.json({ success: true });
  }
);

app.get(
  "/api/live/stream/:matchId",
  (req, res) => {
    const row = db
      .prepare(
        `SELECT
          match_id,
          tournament_id,
          started_by,
          started_at,
          active
         FROM streams
         WHERE match_id=?`
      )
      .get(req.params.matchId);

    res.json({
      streamActive: !!(row && row.active),
      stream: row || null,
    });
  }
);

app.post(
  "/api/live/match/:matchId",
  requireAuth,
  (req, res) => {
    const matchId = String(
      req.params.matchId || ""
    ).trim();

    if (!matchId) {
      return res.status(400).json({
        error: "Match ID required",
      });
    }

    const payload =
      req.body?.matchData ||
      req.body ||
      {};

    const tournamentId =
      req.body?.tournamentId ||
      payload.tournamentId ||
      null;

    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO live_matches(
        match_id,tournament_id,data_json,updated_at
      )
      VALUES(?,?,?,?)
      ON CONFLICT(match_id)
      DO UPDATE SET
        tournament_id=excluded.tournament_id,
        data_json=excluded.data_json,
        updated_at=excluded.updated_at`
    ).run(
      matchId,
      tournamentId,
      JSON.stringify(payload),
      now
    );

    broadcastRoom(
      "MATCH",
      matchId,
      {
        type: "MATCH_SCORE_UPDATE",
        data: payload,
      }
    );

    res.json({
      success: true,
      match: payload,
    });
  }
);

app.get(
  "/api/live/match/:matchId",
  (req, res) => {
    const row = db
      .prepare(
        "SELECT data_json,updated_at FROM live_matches WHERE match_id=?"
      )
      .get(req.params.matchId);

    if (!row) {
      return res.status(404).json({
        error: "Match not found",
      });
    }

    res.json({
      match: JSON.parse(row.data_json),
      updatedAt: row.updated_at,
    });
  }
);

app.get("/api/live/matches", (req, res) => {
  const q = String(
    req.query.search || ""
  )
    .trim()
    .toLowerCase();

  const rows = db
    .prepare(
      "SELECT match_id,data_json,updated_at FROM live_matches ORDER BY updated_at DESC LIMIT 100"
    )
    .all();

  const matches = rows
    .map((r) => ({
      ...JSON.parse(r.data_json),
      matchId: r.match_id,
      updatedAt: r.updated_at,
    }))
    .filter(
      (m) =>
        !q ||
        JSON.stringify(m)
          .toLowerCase()
          .includes(q)
    );

  res.json({ matches });
});

app.use(
  express.static(__dirname, {
    extensions: ["html"],
  })
);

app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/") ||
    req.path.startsWith("/ws/")
  ) {
    return res.status(404).json({
      error: "Not found",
    });
  }

  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

const server = http.createServer(app);
const wss = new WebSocketServer({
  noServer: true,
});

const rooms = new Map();

function roomKey(type, id) {
  return `${type}:${id}`;
}

function joinRoom(ws, type, id) {
  const key = roomKey(type, id);

  if (!rooms.has(key)) {
    rooms.set(key, new Set());
  }

  rooms.get(key).add(ws);

  ws._rooms = ws._rooms || new Set();
  ws._rooms.add(key);
}

function leaveRoom(ws, type, id) {
  const key = roomKey(type, id);
  const set = rooms.get(key);

  if (set) {
    set.delete(ws);

    if (!set.size) {
      rooms.delete(key);
    }
  }

  if (ws._rooms) {
    ws._rooms.delete(key);
  }
}

function broadcastRoom(type, id, msg) {
  const set = rooms.get(roomKey(type, id));

  if (!set) return;

  const raw = JSON.stringify(msg);

  set.forEach((ws) => {
    if (ws.readyState === 1) {
      ws.send(raw);
    }
  });
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (
      msg.type === "JOIN_MATCH" &&
      msg.matchId
    ) {
      const matchId = String(msg.matchId);

      joinRoom(ws, "MATCH", matchId);

      broadcastRoom(
        "MATCH",
        matchId,
        {
          type: "VIEWER_JOINED",
          matchId,
          viewerSessionId:
            msg.sessionId || null,
          sessionId:
            msg.sessionId || null,
        }
      );
    } else if (
      msg.type === "LEAVE_MATCH" &&
      msg.matchId
    ) {
      leaveRoom(
        ws,
        "MATCH",
        String(msg.matchId)
      );
    } else if (
      msg.type === "SUBSCRIBE_CHAT" &&
      msg.room
    ) {
      const room = String(msg.room);

      if (room.startsWith("team:")) {
        joinRoom(
          ws,
          "TEAM",
          room.slice(5)
        );
      } else if (
        room.startsWith("tournament:")
      ) {
        joinRoom(
          ws,
          "TOURNAMENT",
          room.slice(11)
        );
      }
    } else if (
      msg.type === "MATCH_SCORE_UPDATE" &&
      msg.matchId
    ) {
      broadcastRoom(
        "MATCH",
        String(msg.matchId),
        {
          type: "MATCH_SCORE_UPDATE",
          data:
            msg.matchData ||
            msg.data ||
            msg,
        }
      );
    } else if (
      msg.type === "START_BROADCAST" &&
      msg.matchId
    ) {
      broadcastRoom(
        "MATCH",
        String(msg.matchId),
        {
          ...msg,
          type: "STREAM_STARTED",
        }
      );
    } else if (
      msg.type === "STOP_BROADCAST" &&
      msg.matchId
    ) {
      broadcastRoom(
        "MATCH",
        String(msg.matchId),
        {
          ...msg,
          type: "STREAM_STOPPED",
        }
      );
    } else if (
      msg.type === "WEBRTC_OFFER" &&
      msg.matchId
    ) {
      broadcastRoom(
        "MATCH",
        String(msg.matchId),
        msg
      );
    } else if (
      msg.type === "WEBRTC_ANSWER" &&
      msg.matchId
    ) {
      broadcastRoom(
        "MATCH",
        String(msg.matchId),
        msg
      );
    } else if (
      msg.type === "WEBRTC_ICE_CANDIDATE" &&
      msg.matchId
    ) {
      broadcastRoom(
        "MATCH",
        String(msg.matchId),
        msg
      );
    } else if (
      msg.type === "JOIN_TEAM" &&
      msg.teamId
    ) {
      joinRoom(
        ws,
        "TEAM",
        String(msg.teamId)
      );
    } else if (
      msg.type === "JOIN_TOURNAMENT" &&
      msg.tournamentId
    ) {
      joinRoom(
        ws,
        "TOURNAMENT",
        String(msg.tournamentId)
      );
    } else if (
      msg.type === "TOURNAMENT_CHAT_MESSAGE" &&
      (msg.tourneyId ||
        msg.tournamentId)
    ) {
      broadcastRoom(
        "TOURNAMENT",
        String(
          msg.tourneyId ||
            msg.tournamentId
        ),
        msg
      );
    } else if (
      msg.type === "TEAM_CHAT_MESSAGE" &&
      msg.teamId
    ) {
      broadcastRoom(
        "TEAM",
        `${
          msg.tourneyId ||
          msg.tournamentId ||
          "general"
        }:${msg.teamId}`,
        msg
      );
    }
  });

  ws.on("close", () => {
    if (ws._rooms) {
      [...ws._rooms].forEach((key) => {
        const separator = key.indexOf(":");

        if (separator === -1) return;

        const type = key.slice(0, separator);
        const id = key.slice(separator + 1);

        leaveRoom(ws, type, id);
      });
    }
  });
});

server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/ws/live")) {
    wss.handleUpgrade(
      req,
      socket,
      head,
      (ws) => {
        wss.emit(
          "connection",
          ws,
          req
        );
      }
    );
  } else {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `Cric Yuva server listening on ${HOST}:${PORT}`
  );
});
