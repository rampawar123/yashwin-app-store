require("dotenv").config({quiet:true});
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL);
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "2mb" }));

const matches = new Map();
const clients = new Map();
const players = new Map();
async function savePlayerToDb(player) { const now=Date.now(); await sql`INSERT INTO players (player_id,user_id,name,mobile,jersey_name,jersey_number,jersey_size,email,birthdate,photo_url,role,created_at,updated_at) VALUES (${String(player.id)},${player.userId||player.user_id||null},${String(player.name||"")},${player.mobile?String(player.mobile):null},${player.jerseyName||player.jersey_name||null},${player.jerseyNumber||player.jersey_number||null},${player.jerseySize||player.jersey_size||null},${player.email||null},${player.birthdate||null},${player.photoUrl||player.photo_url||null},${player.role||null},${now},${now}) ON CONFLICT (player_id) DO UPDATE SET user_id=EXCLUDED.user_id,name=EXCLUDED.name,mobile=EXCLUDED.mobile,jersey_name=EXCLUDED.jersey_name,jersey_number=EXCLUDED.jersey_number,jersey_size=EXCLUDED.jersey_size,email=EXCLUDED.email,birthdate=EXCLUDED.birthdate,photo_url=EXCLUDED.photo_url,role=EXCLUDED.role,updated_at=EXCLUDED.updated_at`; }


app.post("/api/players", async (req, res) => {
  const player = req.body?.player;
  if (!player || typeof player !== "object") return res.status(400).json({ok:false,error:"player is required"});
  const id = String(player.id || "").trim() || ("PLY-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2,7).toUpperCase());
  const savedPlayer = {...player,id,_updatedAt:Date.now()};
  players.set(id, savedPlayer);
  await savePlayerToDb(savedPlayer);
  res.json({ok:true,player:players.get(id)});
});

app.get("/api/players/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const like = "%" + q + "%";
  const result = await sql`SELECT player_id AS id, user_id AS "userId", name, mobile, created_at AS "createdAt", updated_at AS "updatedAt" FROM players WHERE ${q} = ${""} OR name ILIKE ${like} OR player_id ILIKE ${like} OR mobile ILIKE ${like} ORDER BY name`;
  res.json({ok:true,players:result});
});
app.get("/api/teams", async (req,res) => {
  try {
    const q = String(req.query.q || "").trim();
    const like = "%" + q + "%";
    const teams = await sql`SELECT team_id AS "teamId",name,owner_user_id AS "ownerUserId",logo_url AS "logoUrl",short_name AS "shortName",city,created_at AS "createdAt",updated_at AS "updatedAt" FROM teams WHERE ${q} = ${""} OR name ILIKE ${like} OR team_id ILIKE ${like} OR short_name ILIKE ${like} OR city ILIKE ${like} ORDER BY name`;
    res.json({ok:true,teams});
  } catch(e) {
    res.status(500).json({ok:false,error:"Team list failed"});
  }
});

app.get("/api/teams/:teamId", async (req,res) => {
  try {
    const teamId = String(req.params.teamId || "").trim();
    const rows = await sql`SELECT team_id AS "teamId",name,owner_user_id AS "ownerUserId",logo_url AS "logoUrl",short_name AS "shortName",city,created_at AS "createdAt",updated_at AS "updatedAt" FROM teams WHERE team_id=${teamId} LIMIT 1`;
    if (!rows.length) return res.status(404).json({ok:false,error:"Team not found"});
    res.json({ok:true,team:rows[0]});
  } catch(e) {
    res.status(500).json({ok:false,error:"Team fetch failed"});
  }
});

app.put("/api/teams/:teamId", async (req,res) => {
  try {
    const teamId = String(req.params.teamId || "").trim();
    const team = req.body?.team;
    if (!team || typeof team !== "object") return res.status(400).json({ok:false,error:"team is required"});
    const name = team.name ?? null;
    const ownerUserId = team.ownerUserId ?? team.owner_user_id ?? null;
    const logoUrl = team.logoUrl ?? team.logo_url ?? null;
    const shortName = team.shortName ?? team.short_name ?? null;
    const city = team.city ?? null;
    const now = Date.now();
    const rows = await sql`UPDATE teams SET name=COALESCE(${name},name),owner_user_id=COALESCE(${ownerUserId},owner_user_id),logo_url=COALESCE(${logoUrl},logo_url),short_name=COALESCE(${shortName},short_name),city=COALESCE(${city},city),updated_at=${now} WHERE team_id=${teamId} RETURNING team_id AS "teamId",name,owner_user_id AS "ownerUserId",logo_url AS "logoUrl",short_name AS "shortName",city,created_at AS "createdAt",updated_at AS "updatedAt"`;
    if (!rows.length) return res.status(404).json({ok:false,error:"Team not found"});
    res.json({ok:true,team:rows[0]});
  } catch(e) {
    console.error("Team update error:",e);
    res.status(500).json({ok:false,error:"Team update failed"});
  }
});

app.delete("/api/teams/:teamId", async (req,res) => {
  try {
    const teamId = String(req.params.teamId || "").trim();
    const rows = await sql`DELETE FROM teams WHERE team_id=${teamId} RETURNING team_id AS "teamId",name`;
    if (!rows.length) return res.status(404).json({ok:false,error:"Team not found"});
    res.json({ok:true,deletedTeam:rows[0]});
  } catch(e) {
    console.error("Team delete error:",e);
    res.status(500).json({ok:false,error:"Team delete failed"});
  }
});

app.get("/api/tournaments", async (req,res) => {
  try {
    const q = String(req.query.q || "").trim();
    const like = "%" + q + "%";
    const tournaments = await sql`SELECT tournament_id AS "tournamentId",name,owner_user_id AS "ownerUserId",short_name AS "shortName",logo_url AS "logoUrl",city,start_date AS "startDate",end_date AS "endDate",format,created_at AS "createdAt",updated_at AS "updatedAt" FROM tournaments WHERE ${q} = ${""} OR name ILIKE ${like} OR tournament_id ILIKE ${like} OR short_name ILIKE ${like} OR city ILIKE ${like} ORDER BY name`;
    res.json({ok:true,tournaments});
  } catch(e) {
    console.error("Tournament list error:",e);
    res.status(500).json({ok:false,error:"Tournament list failed"});
  }
});

app.get("/api/tournaments/:tournamentId", async (req,res) => {
  try {
    const tournamentId=String(req.params.tournamentId||"").trim();
    const rows=await sql`SELECT tournament_id AS "tournamentId",name,owner_user_id AS "ownerUserId",short_name AS "shortName",logo_url AS "logoUrl",city,start_date AS "startDate",end_date AS "endDate",format,created_at AS "createdAt",updated_at AS "updatedAt" FROM tournaments WHERE tournament_id=${tournamentId} LIMIT 1`;
    if(!rows.length)return res.status(404).json({ok:false,error:"Tournament not found"});
    res.json({ok:true,tournament:rows[0]});
  }catch(e){console.error("Tournament fetch error:",e);res.status(500).json({ok:false,error:"Tournament fetch failed"});}
});

app.put("/api/tournaments/:tournamentId", async (req,res) => {
  try {
    const tournamentId=String(req.params.tournamentId||"").trim();
    const t=req.body?.tournament;
    if(!t||typeof t!=="object")return res.status(400).json({ok:false,error:"tournament is required"});
    const name=t.name??null, ownerUserId=t.ownerUserId??t.owner_user_id??null, shortName=t.shortName??t.short_name??null, logoUrl=t.logoUrl??t.logo_url??null, city=t.city??null, startDate=t.startDate??t.start_date??null, endDate=t.endDate??t.end_date??null, format=t.format??null, now=Date.now();
    const rows=await sql`UPDATE tournaments SET name=COALESCE(${name},name),owner_user_id=COALESCE(${ownerUserId},owner_user_id),short_name=COALESCE(${shortName},short_name),logo_url=COALESCE(${logoUrl},logo_url),city=COALESCE(${city},city),start_date=COALESCE(${startDate},start_date),end_date=COALESCE(${endDate},end_date),format=COALESCE(${format},format),updated_at=${now} WHERE tournament_id=${tournamentId} RETURNING tournament_id AS "tournamentId",name,owner_user_id AS "ownerUserId",short_name AS "shortName",logo_url AS "logoUrl",city,start_date AS "startDate",end_date AS "endDate",format,created_at AS "createdAt",updated_at AS "updatedAt"`;
    if(!rows.length)return res.status(404).json({ok:false,error:"Tournament not found"});
    res.json({ok:true,tournament:rows[0]});
  }catch(e){console.error("Tournament update error:",e);res.status(500).json({ok:false,error:"Tournament update failed"});}
});

app.put("/api/auction-tournaments/:auctionId", async (req,res) => {
  try {
    const auctionId=String(req.params.auctionId||"").trim();
    const a=req.body?.auctionTournament;
    if(!a||typeof a!=="object")return res.status(400).json({ok:false,error:"auctionTournament is required"});
    const tournamentId=a.tournamentId??a.tournament_id??null;
    const name=a.name??null;
    const ownerUserId=a.ownerUserId??a.owner_user_id??null;
    const basePrice=a.basePrice??a.base_price??null;
    const status=a.status??null;
    const auctionState=a.auctionState??a.auction_state??null;
    const now=Date.now();
    const rows=await sql`UPDATE auction_tournaments SET tournament_id=COALESCE(${tournamentId},tournament_id),name=COALESCE(${name},name),owner_user_id=COALESCE(${ownerUserId},owner_user_id),base_price=COALESCE(${basePrice},base_price),status=COALESCE(${status},status),auction_state=COALESCE(${auctionState},auction_state),updated_at=${now} WHERE auction_id=${auctionId} RETURNING auction_id AS "auctionId",tournament_id AS "tournamentId",name,owner_user_id AS "ownerUserId",base_price AS "basePrice",status,auction_state AS "auctionState",created_at AS "createdAt",updated_at AS "updatedAt"`;
    if(!rows.length)return res.status(404).json({ok:false,error:"Auction tournament not found"});
    res.json({ok:true,auctionTournament:rows[0]});
  }catch(e){console.error("Auction tournament update error:",e);res.status(500).json({ok:false,error:"Auction tournament update failed"});}
});

app.delete("/api/auction-tournaments/:auctionId", async (req,res) => {
  try {
    const auctionId=String(req.params.auctionId||"").trim();
    const rows=await sql`DELETE FROM auction_tournaments WHERE auction_id=${auctionId} RETURNING auction_id AS "auctionId",name`;
    if(!rows.length)return res.status(404).json({ok:false,error:"Auction tournament not found"});
    res.json({ok:true,deletedAuctionTournament:rows[0]});
  }catch(e){console.error("Auction tournament delete error:",e);res.status(500).json({ok:false,error:"Auction tournament delete failed"});}
});

app.get("/api/auction-tournaments/:auctionId", async (req,res) => {
  try {
    const auctionId=String(req.params.auctionId||"").trim();
    const rows=await sql`SELECT auction_id AS "auctionId",tournament_id AS "tournamentId",name,owner_user_id AS "ownerUserId",base_price AS "basePrice",status,auction_state AS "auctionState",created_at AS "createdAt",updated_at AS "updatedAt" FROM auction_tournaments WHERE auction_id=${auctionId} LIMIT 1`;
    if(!rows.length)return res.status(404).json({ok:false,error:"Auction tournament not found"});
    res.json({ok:true,auctionTournament:rows[0]});
  }catch(e){console.error("Auction tournament fetch error:",e);res.status(500).json({ok:false,error:"Auction tournament fetch failed"});}
});

app.get("/api/auction-tournaments", async (req,res) => {
  try {
    const q=String(req.query.q||"").trim();
    const like="%"+q+"%";
    const auctions=await sql`SELECT auction_id AS "auctionId",tournament_id AS "tournamentId",name,owner_user_id AS "ownerUserId",base_price AS "basePrice",status,auction_state AS "auctionState",created_at AS "createdAt",updated_at AS "updatedAt" FROM auction_tournaments WHERE ${q}=${""} OR name ILIKE ${like} OR auction_id ILIKE ${like} OR tournament_id ILIKE ${like} ORDER BY created_at DESC`;
    res.json({ok:true,auctionTournaments:auctions});
  }catch(e){console.error("Auction tournament list error:",e);res.status(500).json({ok:false,error:"Auction tournament list failed"});}
});

app.post("/api/auction-tournaments", async (req,res) => {
  try {
    const a=req.body?.auctionTournament;
    if(!a||typeof a!=="object")return res.status(400).json({ok:false,error:"auctionTournament is required"});
    const auctionId=String(a.auctionId||a.auction_id||"").trim()||("AUCT-"+Date.now().toString(36).toUpperCase()+"-"+Math.random().toString(36).slice(2,7).toUpperCase());
    const tournamentId=String(a.tournamentId||a.tournament_id||"").trim();
    const name=String(a.name||"").trim();
    if(!tournamentId)return res.status(400).json({ok:false,error:"tournamentId is required"});
    if(!name)return res.status(400).json({ok:false,error:"name is required"});
    const now=Date.now();
    const ownerUserId=a.ownerUserId??a.owner_user_id??null;
    const basePrice=a.basePrice??a.base_price??null;
    const status=a.status??"draft";
    const rows=await sql`INSERT INTO auction_tournaments (auction_id,tournament_id,name,owner_user_id,base_price,status,created_at,updated_at) VALUES (${auctionId},${tournamentId},${name},${ownerUserId},${basePrice},${status},${now},${now}) RETURNING auction_id AS "auctionId",tournament_id AS "tournamentId",name,owner_user_id AS "ownerUserId",base_price AS "basePrice",status,auction_state AS "auctionState",created_at AS "createdAt",updated_at AS "updatedAt"`;
    res.json({ok:true,auctionTournament:rows[0]});
  }catch(e){console.error("Auction tournament create error:",e);res.status(500).json({ok:false,error:"Auction tournament creation failed"});}
});

app.delete("/api/tournaments/:tournamentId", async (req,res) => {
  try {
    const tournamentId=String(req.params.tournamentId||"").trim();
    const rows=await sql`DELETE FROM tournaments WHERE tournament_id=${tournamentId} RETURNING tournament_id AS "tournamentId",name`;
    if(!rows.length)return res.status(404).json({ok:false,error:"Tournament not found"});
    res.json({ok:true,deletedTournament:rows[0]});
  }catch(e){console.error("Tournament delete error:",e);res.status(500).json({ok:false,error:"Tournament delete failed"});}
});

app.post("/api/tournaments", async (req,res) => {
  try {
    const t = req.body?.tournament;
    if (!t || typeof t !== "object") return res.status(400).json({ok:false,error:"tournament is required"});
    const tournamentId = String(t.tournamentId || t.tournament_id || "").trim() || ("TOUR-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2,7).toUpperCase());
    const name = String(t.name || "").trim();
    if (!name) return res.status(400).json({ok:false,error:"tournament.name is required"});
    const now = Date.now();
    const ownerUserId = t.ownerUserId ?? t.owner_user_id ?? null;
    const shortName = t.shortName ?? t.short_name ?? null;
    const logoUrl = t.logoUrl ?? t.logo_url ?? null;
    const city = t.city ?? null;
    const startDate = t.startDate ?? t.start_date ?? null;
    const endDate = t.endDate ?? t.end_date ?? null;
    const format = t.format ?? null;
    const rows = await sql`INSERT INTO tournaments (tournament_id,name,owner_user_id,short_name,logo_url,city,start_date,end_date,format,created_at,updated_at) VALUES (${tournamentId},${name},${ownerUserId},${shortName},${logoUrl},${city},${startDate},${endDate},${format},${now},${now}) RETURNING tournament_id AS "tournamentId",name,owner_user_id AS "ownerUserId",short_name AS "shortName",logo_url AS "logoUrl",city,start_date AS "startDate",end_date AS "endDate",format,created_at AS "createdAt",updated_at AS "updatedAt"`;
    res.json({ok:true,tournament:rows[0]});
  } catch(e) {
    console.error("Tournament create error:",e);
    res.status(500).json({ok:false,error:"Tournament creation failed"});
  }
});

app.post("/api/teams", async (req,res) => {
  try {
    const team = req.body?.team;
    if (!team || typeof team !== "object") return res.status(400).json({ok:false,error:"team is required"});
    const teamId = String(team.teamId || team.team_id || "").trim() || ("TEAM-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2,7).toUpperCase());
    const now = Date.now();
    const savedTeam = {teamId,name:String(team.name||"").trim(),ownerUserId:team.ownerUserId||team.owner_user_id||null,logoUrl:team.logoUrl||team.logo_url||null,shortName:team.shortName||team.short_name||null,city:team.city||null};
    if (!savedTeam.name) return res.status(400).json({ok:false,error:"team.name is required"});
    await sql`INSERT INTO teams (team_id,name,owner_user_id,logo_url,short_name,city,created_at,updated_at) VALUES (${teamId},${savedTeam.name},${savedTeam.ownerUserId},${savedTeam.logoUrl},${savedTeam.shortName},${savedTeam.city},${now},${now})`;
    res.json({ok:true,team:{...savedTeam,teamId,createdAt:now,updatedAt:now}});
  } catch(e) {
    res.status(500).json({ok:false,error:"Team creation failed"});
  }
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

app.post("/api/auth/register", async (req,res) => {
  const crypto = require("crypto");
  const mobile = String(req.body?.mobile || "").trim();
  const password = String(req.body?.password || "");
  if(!mobile || !password) return res.status(400).json({ok:false,error:"mobile and password are required"});
  const existingRows = await sql`SELECT user_id,mobile,name FROM users WHERE mobile=${mobile} LIMIT 1`;
  const existing = existingRows[0];
  if(existing) return res.status(409).json({ok:false,error:"Mobile already registered"});
  const userId = "YUVA-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2,7).toUpperCase();
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = salt + ":" + crypto.scryptSync(password, salt, 64).toString("hex");
  await sql`INSERT INTO users (user_id,mobile,name,created_at,password_hash) VALUES (${userId},${mobile},${null},${Date.now()},${passwordHash})`;
  res.json({ok:true,user:{userId,mobile,name:null}});
});
app.post("/api/auth/request-otp", async (req,res) => {
  try {
    const crypto = require("crypto");
    const mobile = String(req.body?.mobile || "").trim();
    const purpose = String(req.body?.purpose || "login").trim();

    if (!mobile) return res.status(400).json({ok:false,error:"mobile is required"});

    const code = String(crypto.randomInt(100000,1000000));
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    const now = Date.now();

    await sql`UPDATE otp_codes SET used=true WHERE mobile=${mobile} AND purpose=${purpose} AND used=false`;

    await sql`INSERT INTO otp_codes
      (mobile,code_hash,purpose,expires_at,attempts,used,created_at)
      VALUES (${mobile},${hash},${purpose},${now+300000},0,false,${now})`;

    res.json(process.env.NODE_ENV === "production" ? {ok:true,expiresIn:300} : {ok:true,expiresIn:300,devCode:code});
  } catch(e) {
    res.status(500).json({ok:false,error:"OTP generation failed"});
  }
});

app.post("/api/auth/verify-otp", async (req,res) => {
  try {
    const crypto = require("crypto");
    const mobile = String(req.body?.mobile || "").trim();
    const code = String(req.body?.code || "").trim();
    const purpose = String(req.body?.purpose || "login").trim();

    if (!mobile || !code)
      return res.status(400).json({ok:false,error:"mobile and code are required"});

    const rows = await sql`SELECT id,code_hash,expires_at,attempts
      FROM otp_codes
      WHERE mobile=${mobile} AND purpose=${purpose} AND used=false
      ORDER BY id DESC LIMIT 1`;

    const otp = rows[0];

    if (!otp || otp.attempts >= 5 || Number(otp.expires_at) < Date.now())
      return res.status(401).json({ok:false,error:"Invalid or expired OTP"});

    const hash = crypto.createHash("sha256").update(code).digest("hex");

    if (hash !== otp.code_hash) {
      await sql`UPDATE otp_codes SET attempts=attempts+1 WHERE id=${otp.id}`;
      return res.status(401).json({ok:false,error:"Invalid OTP"});
    }

    await sql`UPDATE otp_codes SET used=true WHERE id=${otp.id}`;

    res.json({ok:true,verified:true});
  } catch(e) {
    res.status(500).json({ok:false,error:"OTP verification failed"});
  }
});
app.post("/api/auth/login", async (req,res) => {
  const crypto = require("crypto");
  const mobile = String(req.body?.mobile || "").trim();
  const password = String(req.body?.password || "");
  if(!mobile || !password) return res.status(400).json({ok:false,error:"mobile and password are required"});
  const userRows = await sql`SELECT user_id,mobile,name,password_hash FROM users WHERE mobile=${mobile} LIMIT 1`;
  const user = userRows[0];
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
