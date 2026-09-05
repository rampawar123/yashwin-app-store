const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "2mb" }));

const matches = new Map();
const clients = new Map();
const players = new Map();

app.post("/api/players", (req, res) => {
  const player = req.body?.player;
  if (!player || typeof player !== "object") return res.status(400).json({ok:false,error:"player is required"});
  const id = String(player.id || "").trim();
  if (!id) return res.status(400).json({ok:false,error:"player.id is required"});
  players.set(id, {...player,id,_updatedAt:Date.now()});
  res.json({ok:true,player:players.get(id)});
});

app.get("/api/players/search", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const result = [...players.values()].filter(p =>
    !q ||
    String(p.name || "").toLowerCase().includes(q) ||
    String(p.id || "").toLowerCase().includes(q) ||
    String(p.mobile || "").includes(q)
  );
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Cric Yuva Server running on port ${PORT}`);
});
