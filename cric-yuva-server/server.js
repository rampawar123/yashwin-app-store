const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "2mb" }));

const matches = new Map();
const clients = new Map();
const players = new Map();
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("./cric-yuva.db");
db.exec("CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT UNIQUE NOT NULL, user_id TEXT, name TEXT NOT NULL, mobile TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
function savePlayerToDb(player) { const now=Date.now(); db.prepare("INSERT INTO players (player_id,user_id,name,mobile,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET user_id=excluded.user_id,name=excluded.name,mobile=excluded.mobile,updated_at=excluded.updated_at").run(String(player.id),player.userId||player.user_id||null,String(player.name||""),player.mobile?String(player.mobile):null,now,now); }


app.post("/api/players", (req, res) => {
  const player = req.body?.player;
  if (!player || typeof player !== "object") return res.status(400).json({ok:false,error:"player is required"});
  const id = String(player.id || "").trim();
  if (!id) return res.status(400).json({ok:false,error:"player.id is required"});
  players.set(id, {...player,id,_updatedAt:Date.now()});
  savePlayerToDb(player);
  res.json({ok:true,player:players.get(id)});
});

app.get("/api/players/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  const like = "%" + q + "%";
  const result = db.prepare("SELECT player_id AS id, user_id AS userId, name, mobile, created_at AS createdAt, updated_at AS updatedAt FROM players WHERE ? = ? OR name LIKE ? OR player_id LIKE ? OR mobile LIKE ? ORDER BY name").all(q, "", like, like, like);
  res.json({ok:true,players:result});
});
const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  path: "/ws/live"
});

function sendJson(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastToMatch(matchId, message) {
  const room = clients.get(matchId);
  if (!room) return;

  for (const ws of room) {
    sendJson(ws, message);
  }
}

wss.on("connection", (ws) => {
  ws.matchId = null;

  sendJson(ws, {
    type: "CONNECTION_OK",
    message: "Cric Yuva Live Server Connected"
  });

  ws.on("message", (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return sendJson(ws, {
        type: "ERROR",
        error: "Invalid JSON"
      });
    }

    if (msg.type === "JOIN_MATCH") {
      const matchId = String(msg.matchId || "").trim();

      if (!matchId) {
        return sendJson(ws, {
          type: "ERROR",
          error: "matchId is required"
        });
      }

      if (ws.matchId && clients.has(ws.matchId)) {
        clients.get(ws.matchId).delete(ws);
      }

      ws.matchId = matchId;

      if (!clients.has(matchId)) {
        clients.set(matchId, new Set());
      }

      clients.get(matchId).add(ws);

      sendJson(ws, {
        type: "MATCH_JOINED",
        matchId
      });

      const existingMatch = matches.get(matchId);

      if (existingMatch) {
        sendJson(ws, {
          type: "MATCH_SCORE_UPDATE",
          data: existingMatch
        });
      }

      return;
    }

    if (msg.type === "LEAVE_MATCH") {
      const matchId = ws.matchId;

      if (matchId && clients.has(matchId)) {
        clients.get(matchId).delete(ws);

        if (clients.get(matchId).size === 0) {
          clients.delete(matchId);
        }
      }

      ws.matchId = null;

      sendJson(ws, {
        type: "MATCH_LEFT"
      });
    }
  });

  ws.on("close", () => {
    const matchId = ws.matchId;

    if (matchId && clients.has(matchId)) {
      clients.get(matchId).delete(ws);

      if (clients.get(matchId).size === 0) {
        clients.delete(matchId);
      }
    }
  });
});

app.post("/api/auth/register", (req,res) => {
  const crypto = require("crypto");
  const mobile = String(req.body?.mobile || "").trim();
  const password = String(req.body?.password || "");
  if(!mobile || !password) return res.status(400).json({ok:false,error:"mobile and password are required"});
  const existing = db.prepare("SELECT user_id,mobile,name FROM users WHERE mobile=?").get(mobile);
  if(existing) return res.status(409).json({ok:false,error:"Mobile already registered"});
  const userId = "YUVA-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2,7).toUpperCase();
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = salt + ":" + crypto.scryptSync(password, salt, 64).toString("hex");
  db.prepare("INSERT INTO users (user_id,mobile,name,created_at,password_hash) VALUES (?,?,?,?,?)").run(userId,mobile,null,Date.now(),passwordHash);
  res.json({ok:true,user:{userId,mobile,name:null}});
});

app.post("/api/auth/login", (req,res) => {
  const crypto = require("crypto");
  const mobile = String(req.body?.mobile || "").trim();
  const password = String(req.body?.password || "");
  if(!mobile || !password) return res.status(400).json({ok:false,error:"mobile and password are required"});
  const user = db.prepare("SELECT user_id,mobile,name,password_hash FROM users WHERE mobile=?").get(mobile);
  if(!user || !user.password_hash) return res.status(401).json({ok:false,error:"Invalid mobile or password"});
  const parts = String(user.password_hash).split(":");
  if(parts.length !== 2) return res.status(401).json({ok:false,error:"Invalid mobile or password"});
  const salt = parts[0];
  const storedHash = parts[1];
  const checkHash = crypto.scryptSync(password, salt, 64).toString("hex");
  const valid = checkHash.length === storedHash.length && crypto.timingSafeEqual(Buffer.from(checkHash), Buffer.from(storedHash));
  if(!valid) return res.status(401).json({ok:false,error:"Invalid mobile or password"});
  res.json({ok:true,user:{userId:user.user_id,mobile:user.mobile,name:user.name}});
});

app.get("/api/health", (req, res) => res.json({ ok: true, service: "cric-yuva-server" }));
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Cric Yuva Server running on port ${PORT}`);
});
