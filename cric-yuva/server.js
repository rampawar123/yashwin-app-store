"use strict";

const express = require("express");
const http = require("http");
const crypto = require("crypto");
const https = require("https");
const { URL, URLSearchParams } = require("url");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const { getDatabase } = require("./db");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(express.static(__dirname, { index: "index.html", maxAge: "1h" }));

// Store active WebSocket connections for live matches
const matchWsClients = new Map();

// Helper: Password Hashing (PBKDF2 with salt)
function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString("hex");
  }
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, originalHash] = storedHash.split(":");
  const testHash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  return testHash === originalHash;
}

// YouTube OAuth helpers (server-side only; client secret never exposed to browser)
function youtubeConfig() {
  return {
    clientId: String(process.env.YOUTUBE_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.YOUTUBE_CLIENT_SECRET || "").trim(),
    redirectUri: String(process.env.YOUTUBE_REDIRECT_URI || "https://yashwin-app-store.onrender.com/api/youtube/callback").trim(),
    stateSecret: String(process.env.YOUTUBE_STATE_SECRET || process.env.SESSION_SECRET || "").trim()
  };
}

function youtubeStateToken(userId) {
  const cfg = youtubeConfig();
  if (!cfg.stateSecret) throw new Error("YOUTUBE_STATE_SECRET is not configured");
  const payload = Buffer.from(JSON.stringify({ userId: String(userId), exp: Date.now() + 10 * 60 * 1000, n: crypto.randomBytes(16).toString("hex") })).toString("base64url");
  const sig = crypto.createHmac("sha256", cfg.stateSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyYoutubeState(token) {
  const cfg = youtubeConfig();
  if (!cfg.stateSecret || !token || !token.includes(".")) return null;
  const [payload, sig] = String(token).split(".");
  const expected = crypto.createHmac("sha256", cfg.stateSecret).update(payload).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.userId || !data.exp || Date.now() > Number(data.exp)) return null;
    return data;
  } catch (_) { return null; }
}

function encryptYoutubeSecret(value) {
  if (!value) return "";
  const keyMaterial = String(process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY || process.env.YOUTUBE_STATE_SECRET || "").trim();
  if (!keyMaterial) throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY is not configured");
  const key = crypto.createHash("sha256").update(keyMaterial).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptYoutubeSecret(value) {
  if (!value) return "";
  const keyMaterial = String(process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY || process.env.YOUTUBE_STATE_SECRET || "").trim();
  if (!keyMaterial) throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY is not configured");
  const key = crypto.createHash("sha256").update(keyMaterial).digest();
  const parts = String(value).split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted YouTube token");
  const iv = Buffer.from(parts[0], "base64url");
  const tag = Buffer.from(parts[1], "base64url");
  const encrypted = Buffer.from(parts[2], "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

async function getYoutubeAccessToken(sql, userId) {
  const rows = await sql`SELECT * FROM youtube_connections WHERE user_id=${userId} LIMIT 1`;
  if (!rows.length) throw new Error("YouTube is not connected");
  const row = rows[0];
  const now = Date.now();
  if (row.access_token_enc && Number(row.token_expiry || 0) > now + 60000) {
    return { token: decryptYoutubeSecret(row.access_token_enc), row };
  }
  if (!row.refresh_token_enc) throw new Error("YouTube authorization expired. Please reconnect YouTube.");
  const cfg = youtubeConfig();
  const refreshToken = decryptYoutubeSecret(row.refresh_token_enc);
  const token = await formPost("https://oauth2.googleapis.com/token", {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  if (!token.access_token) throw new Error("Unable to refresh YouTube access token");
  const encryptedAccess = encryptYoutubeSecret(token.access_token);
  const expiry = now + Number(token.expires_in || 3600) * 1000;
  await sql`UPDATE youtube_connections SET access_token_enc=${encryptedAccess}, token_expiry=${expiry}, updated_at=${nowMs()} WHERE user_id=${userId}`;
  return { token: token.access_token, row: { ...row, token_expiry: expiry, access_token_enc: encryptedAccess } };
}

async function youtubeApiRequest(sql, userId, method, targetUrl, body = null) {
  const { token } = await getYoutubeAccessToken(sql, userId);
  return httpsJsonRequest(method, targetUrl, body, { Authorization: `Bearer ${token}` });
}

function httpsJsonRequest(method, targetUrl, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const payload = body == null ? "" : (typeof body === "string" ? body : JSON.stringify(body));
    const req = https.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || 443, path: `${u.pathname}${u.search}`,
      method, headers: { ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}), ...headers, "Accept": "application/json" }
    }, res => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", c => raw += c);
      res.on("end", () => {
        let parsed = raw;
        try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`HTTP ${res.statusCode}: ${typeof parsed === "string" ? parsed.slice(0,500) : JSON.stringify(parsed).slice(0,500)}`));
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function formPost(targetUrl, params) {
  const body = new URLSearchParams(params).toString();
  return httpsJsonRequest("POST", targetUrl, body, { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) });
}

// Server-side permanent Player ID Generator
async function generatePermanentPlayerId(sql) {
  const currentYear = new Date().getFullYear();
  for (let attempt = 0; attempt < 10; attempt++) {
    const randomSuffix = crypto.randomBytes(4).toString("hex").toUpperCase();
    const sequenceNum = Math.floor(1000 + Math.random() * 9000);
    const candidateId = `CYP-${currentYear}-${sequenceNum}-${randomSuffix}`;
    const existing = await sql`SELECT player_id FROM players WHERE player_id = ${candidateId} LIMIT 1`;
    if (existing.length === 0) {
      return candidateId;
    }
  }
  return `CYP-${currentYear}-${Date.now().toString().slice(-4)}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

// Server-side permanent Team ID Generator
async function generatePermanentTeamId(sql) {
  const currentYear = new Date().getFullYear();
  for (let attempt = 0; attempt < 10; attempt++) {
    const randomSuffix = crypto.randomBytes(4).toString("hex").toUpperCase();
    const sequenceNum = Math.floor(1000 + Math.random() * 9000);
    const candidateId = `CYT-${currentYear}-${sequenceNum}-${randomSuffix}`;
    const existing = await sql`SELECT team_id FROM teams WHERE team_id = ${candidateId} LIMIT 1`;
    if (existing.length === 0) {
      return candidateId;
    }
  }
  return `CYT-${currentYear}-${Date.now().toString().slice(-4)}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

// Server-side permanent Tournament ID Generator
async function generatePermanentTournamentId(sql) {
  const currentYear = new Date().getFullYear();
  for (let attempt = 0; attempt < 10; attempt++) {
    const randomSuffix = crypto.randomBytes(4).toString("hex").toUpperCase();
    const sequenceNum = Math.floor(1000 + Math.random() * 9000);
    const candidateId = `CYTR-${currentYear}-${sequenceNum}-${randomSuffix}`;
    const existing = await sql`SELECT tournament_id FROM tournaments WHERE tournament_id = ${candidateId} LIMIT 1`;
    if (existing.length === 0) {
      return candidateId;
    }
  }
  return `CYTR-${currentYear}-${Date.now().toString().slice(-4)}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

// Rate Limiting Middleware
async function rateLimitMiddleware(keyPrefix, limit, windowMs) {
  return async (req, res, next) => {
    try {
      const sql = await getDatabase();
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
      const identifier = req.body?.mobile || ip;
      const key = `${keyPrefix}:${identifier}`;
      const now = Date.now();

      const rows = await sql`SELECT count, reset_at FROM rate_limits WHERE key = ${key} LIMIT 1`;

      if (rows.length > 0) {
        const entry = rows[0];
        if (now < entry.reset_at) {
          if (entry.count >= limit) {
            return res.status(429).json({
              ok: false,
              success: false,
              error: "Too many requests. Please wait before trying again."
            });
          }
          await sql`UPDATE rate_limits SET count = count + 1 WHERE key = ${key}`;
        } else {
          await sql`UPDATE rate_limits SET count = 1, reset_at = ${now + windowMs} WHERE key = ${key}`;
        }
      } else {
        await sql`
          INSERT INTO rate_limits (key, count, reset_at)
          VALUES (${key}, 1, ${now + windowMs})
          ON CONFLICT (key) DO UPDATE SET count = 1, reset_at = ${now + windowMs}
        `;
      }
      next();
    } catch (err) {
      console.error("Rate limit error:", err.message);
      next();
    }
  };
}

// Authentication Middleware
async function requireAuth(req, res, next) {
  try {
    const sql = await getDatabase();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, success: false, error: "Unauthorized: Missing or invalid token format" });
    }

    const token = authHeader.split(" ")[1].trim();
    if (!token) {
      return res.status(401).json({ ok: false, success: false, error: "Unauthorized: Empty token" });
    }

    const now = Date.now();
    const rows = await sql`
      SELECT s.token, s.user_id, s.expires_at, u.mobile, u.name, u.player_id
      FROM sessions s
      JOIN users u ON s.user_id = u.user_id
      WHERE s.token = ${token}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(401).json({ ok: false, success: false, error: "Unauthorized: Invalid session token" });
    }

    const session = rows[0];
    if (now > session.expires_at) {
      await sql`DELETE FROM sessions WHERE token = ${token}`;
      return res.status(401).json({ ok: false, success: false, error: "Unauthorized: Session has expired" });
    }

    req.user = {
      userId: session.user_id,
      mobile: session.mobile,
      name: session.name,
      playerId: session.player_id,
      token
    };
    next();
  } catch (err) {
    console.error("Auth middleware error:", err.message);
    res.status(500).json({ ok: false, success: false, error: "Internal authentication error" });
  }
}

// Optional Auth Middleware (attaches user if valid token present)
async function optionalAuth(req, res, next) {
  try {
    const sql = await getDatabase();
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1].trim();
      if (token) {
        const now = Date.now();
        const rows = await sql`
          SELECT s.token, s.user_id, s.expires_at, u.mobile, u.name, u.player_id
          FROM sessions s
          JOIN users u ON s.user_id = u.user_id
          WHERE s.token = ${token}
          LIMIT 1
        `;
        if (rows.length > 0 && now <= rows[0].expires_at) {
          req.user = {
            userId: rows[0].user_id,
            mobile: rows[0].mobile,
            name: rows[0].name,
            playerId: rows[0].player_id,
            token
          };
        }
      }
    }
  } catch (e) {}
  next();
}

// --- AUTHENTICATION & OTP APIS (PHASE 2 & PHASE 3) ---

// POST /api/auth/register
app.post("/api/auth/register", async (req, res) => {
  try {
    const sql = await getDatabase();
    const { name, mobile, password, email } = req.body || {};

    if (!name || !mobile || !password) {
      return res.status(400).json({ ok: false, success: false, error: "Name, mobile number, and password are required" });
    }

    const cleanMobile = String(mobile).trim();
    if (!/^\d{10,15}$/.test(cleanMobile)) {
      return res.status(400).json({ ok: false, success: false, error: "Valid 10-digit mobile number required" });
    }

    const existingUser = await sql`SELECT user_id FROM users WHERE mobile = ${cleanMobile} LIMIT 1`;
    if (existingUser.length > 0) {
      return res.status(400).json({ ok: false, success: false, error: "An account with this mobile number already exists" });
    }

    const userId = "USR-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const passwordHash = hashPassword(password);
    const now = Date.now();

    // Check if player record already exists for this mobile
    const existingPlayer = await sql`SELECT player_id FROM players WHERE mobile = ${cleanMobile} LIMIT 1`;
    let playerId;
    if (existingPlayer.length > 0 && existingPlayer[0].player_id) {
      playerId = existingPlayer[0].player_id;
    } else {
      playerId = await generatePermanentPlayerId(sql);
    }

    await sql`
      INSERT INTO users (user_id, mobile, name, password_hash, player_id, created_at)
      VALUES (${userId}, ${cleanMobile}, ${String(name).trim()}, ${passwordHash}, ${playerId}, ${now})
    `;

    const profileData = {
      name: String(name).trim(),
      mobile: cleanMobile,
      email: email ? String(email).trim() : null,
      playerId,
      role: "All-Rounder",
      jerseyNumber: 7
    };

    await sql`
      INSERT INTO profiles (user_id, data_json, updated_at)
      VALUES (${userId}, ${JSON.stringify(profileData)}::jsonb, ${now})
    `;

    await sql`
      INSERT INTO players (player_id, user_id, name, mobile, role, jersey_number, data_json, created_at, updated_at)
      VALUES (${playerId}, ${userId}, ${String(name).trim()}, ${cleanMobile}, 'All-Rounder', 7, ${JSON.stringify(profileData)}::jsonb, ${now}, ${now})
      ON CONFLICT (player_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        name = EXCLUDED.name,
        mobile = EXCLUDED.mobile,
        updated_at = EXCLUDED.updated_at
    `;

    const token = crypto.randomBytes(32).toString("hex");
    const sessionExpiry = now + 30 * 24 * 60 * 60 * 1000;
    await sql`
      INSERT INTO sessions (token, user_id, created_at, expires_at)
      VALUES (${token}, ${userId}, ${now}, ${sessionExpiry})
    `;

    res.json({
      ok: true,
      success: true,
      token,
      message: "Account registered successfully",
      user: {
        userId,
        mobile: cleanMobile,
        name: String(name).trim(),
        playerId
      }
    });
  } catch (err) {
    console.error("Registration error:", err.message);
    res.status(500).json({ ok: false, success: false, error: "Registration failed: " + err.message });
  }
});

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  try {
    const sql = await getDatabase();
    const { mobile, password } = req.body || {};

    if (!mobile || !password) {
      return res.status(400).json({ ok: false, success: false, error: "Mobile number and password required" });
    }

    const cleanMobile = String(mobile).trim();
    const rows = await sql`
      SELECT user_id, mobile, name, password_hash, player_id
      FROM users
      WHERE mobile = ${cleanMobile}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(401).json({ ok: false, success: false, error: "Invalid mobile number or password" });
    }

    const user = rows[0];
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ ok: false, success: false, error: "Invalid mobile number or password" });
    }

    const now = Date.now();
    const token = crypto.randomBytes(32).toString("hex");
    const sessionExpiry = now + 30 * 24 * 60 * 60 * 1000;

    await sql`
      INSERT INTO sessions (token, user_id, created_at, expires_at)
      VALUES (${token}, ${user.user_id}, ${now}, ${sessionExpiry})
    `;

    res.json({
      ok: true,
      success: true,
      token,
      message: "Login successful",
      user: {
        userId: user.user_id,
        mobile: user.mobile,
        name: user.name,
        playerId: user.player_id
      }
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ ok: false, success: false, error: "Login failed" });
  }
});

// POST /api/auth/request-otp
const otpLimiter = async (req, res, next) => {
  const handler = await rateLimitMiddleware("otp_req", 5, 60 * 1000);
  return handler(req, res, next);
};

app.post("/api/auth/request-otp", otpLimiter, async (req, res) => {
  try {
    const sql = await getDatabase();
    const { mobile, purpose = "login" } = req.body || {};

    if (!mobile) {
      return res.status(400).json({ ok: false, success: false, error: "Mobile number is required" });
    }

    const cleanMobile = String(mobile).trim();
    if (!/^\d{10,15}$/.test(cleanMobile)) {
      return res.status(400).json({ ok: false, success: false, error: "Valid 10-digit mobile number required" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const now = Date.now();
    const expiresAt = now + 5 * 60 * 1000;

    await sql`
      INSERT INTO otp_codes (mobile, code, expires_at, attempts, used, created_at)
      VALUES (${cleanMobile}, ${otp}, ${expiresAt}, 0, FALSE, ${now})
    `;

    // Delivery hook: configure OTP_WEBHOOK_URL for a real SMS/WhatsApp provider.
    // During development/test, OTP_DEV_MODE defaults to true so the UI can be tested end-to-end.
    let delivered = false;
    if (process.env.OTP_WEBHOOK_URL) {
      try {
        const r = await fetch(process.env.OTP_WEBHOOK_URL, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ mobile: cleanMobile, otp, purpose, expiresInSeconds: 300, app: "Cric Yuva" })
        });
        delivered = r.ok;
      } catch (e) { console.error("OTP delivery webhook error:", e.message); }
    }
    const devMode = String(process.env.OTP_DEV_MODE || "true").toLowerCase() !== "false";
    res.json({
      ok: true, success: true, delivered,
      message: delivered ? "OTP sent successfully" : "OTP generated successfully",
      expiresInSeconds: 300,
      ...(devMode && !delivered ? { devOtp: otp } : {})
    });
  } catch (err) {
    console.error("Request OTP error:", err.message);
    res.status(500).json({ ok: false, success: false, error: "Failed to generate OTP" });
  }
});

// POST /api/auth/verify-otp
app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const sql = await getDatabase();
    const { mobile, code, purpose = "login", name, password } = req.body || {};

    if (!mobile || !code) {
      return res.status(400).json({ ok: false, success: false, error: "Mobile number and OTP code are required" });
    }

    const cleanMobile = String(mobile).trim();
    const cleanCode = String(code).trim();
    const now = Date.now();

    const otpRows = await sql`
      SELECT id, code, expires_at, attempts, used
      FROM otp_codes
      WHERE mobile = ${cleanMobile}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (otpRows.length === 0) {
      return res.status(400).json({ ok: false, success: false, error: "No OTP found. Please request a new OTP." });
    }

    const otpRecord = otpRows[0];

    if (otpRecord.used) {
      return res.status(400).json({ ok: false, success: false, error: "This OTP has already been used. Please request a new OTP." });
    }

    if (now > otpRecord.expires_at) {
      return res.status(400).json({ ok: false, success: false, error: "OTP has expired. Please request a new OTP." });
    }

    if (otpRecord.attempts >= 5) {
      return res.status(400).json({ ok: false, success: false, error: "Maximum verification attempts exceeded. Please request a new OTP." });
    }

    if (otpRecord.code !== cleanCode) {
      await sql`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${otpRecord.id}`;
      const remainingAttempts = 4 - otpRecord.attempts;
      return res.status(400).json({
        ok: false,
        success: false,
        error: `Invalid OTP code. ${remainingAttempts > 0 ? remainingAttempts + " attempts remaining." : "No attempts remaining."}`
      });
    }

    await sql`UPDATE otp_codes SET used = TRUE WHERE id = ${otpRecord.id}`;

    let userRows = await sql`
      SELECT user_id, mobile, name, player_id
      FROM users
      WHERE mobile = ${cleanMobile}
      LIMIT 1
    `;

    let user;
    if (purpose === "register") {
      if (userRows.length > 0) {
        return res.status(409).json({ ok:false, success:false, error:"An account with this mobile number already exists. Please log in." });
      }
      const cleanName = String(name || "").trim();
      const cleanPassword = String(password || "");
      if (!cleanName) return res.status(400).json({ ok:false, success:false, error:"Player name is required" });
      if (cleanPassword.length < 4) return res.status(400).json({ ok:false, success:false, error:"Password must be at least 4 characters" });
      const userId = "USR-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex").toUpperCase();
      const passwordHash = hashPassword(cleanPassword);
      const playerId = await generatePermanentPlayerId(sql);
      await sql`INSERT INTO users (user_id, mobile, name, password_hash, player_id, created_at) VALUES (${userId}, ${cleanMobile}, ${cleanName}, ${passwordHash}, ${playerId}, ${now})`;
      const profile = { name: cleanName, mobile: cleanMobile, playerId, role:"All-Rounder", jerseyNumber:7 };
      await sql`INSERT INTO profiles (user_id, data_json, updated_at) VALUES (${userId}, ${JSON.stringify(profile)}::jsonb, ${now})`;
      await sql`INSERT INTO players (player_id,user_id,name,mobile,role,jersey_number,data_json,created_at,updated_at) VALUES (${playerId},${userId},${cleanName},${cleanMobile},'All-Rounder',7,${JSON.stringify(profile)}::jsonb,${now},${now})`;
      user = { user_id:userId, mobile:cleanMobile, name:cleanName, player_id:playerId };
    } else {
      if (userRows.length === 0) return res.status(404).json({ ok:false, success:false, error:"No account found with this mobile number. Please create an account first." });
      user = userRows[0];
      if (!user.player_id) {
        const newPlayerId = await generatePermanentPlayerId(sql);
        await sql`UPDATE users SET player_id = ${newPlayerId} WHERE user_id = ${user.user_id}`;
        user.player_id = newPlayerId;
      }
    }

    const token = crypto.randomBytes(32).toString("hex");
    const sessionExpiry = now + 30 * 24 * 60 * 60 * 1000;
    await sql`
      INSERT INTO sessions (token, user_id, created_at, expires_at)
      VALUES (${token}, ${user.user_id}, ${now}, ${sessionExpiry})
    `;

    res.json({
      ok: true,
      success: true,
      token,
      message: "OTP verified successfully",
      user: {
        userId: user.user_id,
        mobile: user.mobile,
        name: user.name,
        playerId: user.player_id
      }
    });
  } catch (err) {
    console.error("Verify OTP error:", err.message);
    res.status(500).json({ ok: false, success: false, error: "OTP verification failed" });
  }
});

// POST /api/auth/logout
app.post("/api/auth/logout", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    if (req.user?.token) {
      await sql`DELETE FROM sessions WHERE token = ${req.user.token}`;
    }
    res.json({ ok: true, success: true, message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Logout failed" });
  }
});

// --- PROFILE APIS (PHASE 2) ---

// GET /api/profile
app.get("/api/profile", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const userId = req.user.userId;

    const userRows = await sql`
      SELECT user_id, mobile, name, player_id, created_at
      FROM users
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    if (!userRows.length) {
      return res.status(404).json({ ok: false, success: false, error: "User not found" });
    }

    const profileRows = await sql`
      SELECT data_json, updated_at
      FROM profiles
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    const user = userRows[0];
    const profileData = profileRows[0]?.data_json || {};

    let playerDetails = null;
    if (user.player_id) {
      const playerRows = await sql`SELECT * FROM players WHERE player_id = ${user.player_id} LIMIT 1`;
      if (playerRows.length > 0) {
        playerDetails = playerRows[0];
      }
    }

    res.json({
      ok: true,
      success: true,
      user: {
        userId: user.user_id,
        mobile: user.mobile,
        name: user.name,
        playerId: user.player_id
      },
      playerId: user.player_id,
      profile: {
        ...profileData,
        playerId: user.player_id,
        name: user.name,
        mobile: user.mobile,
        playerDetails
      }
    });
  } catch (err) {
    console.error("Get profile error:", err.message);
    res.status(500).json({ ok: false, success: false, error: "Failed to fetch profile" });
  }
});

// PUT /api/profile
app.put("/api/profile", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const userId = req.user.userId;
    const body = req.body || {};
    const now = Date.now();

    const userRows = await sql`SELECT * FROM users WHERE user_id = ${userId} LIMIT 1`;
    if (!userRows.length) {
      return res.status(404).json({ ok: false, success: false, error: "User not found" });
    }
    const currentUser = userRows[0];

    // Reject attempt to modify permanent Player ID via profile update
    const incomingPlayerId = body.playerId || body.player_id;
    if (incomingPlayerId && incomingPlayerId !== currentUser.player_id) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: "Permanent Player ID cannot be modified or replaced"
      });
    }

    const currentProfileRows = await sql`SELECT data_json FROM profiles WHERE user_id = ${userId} LIMIT 1`;
    const existingProfile = currentProfileRows[0]?.data_json || {};

    const updatedName = body.name ? String(body.name).trim() : currentUser.name;
    const updatedProfile = {
      ...existingProfile,
      ...body,
      name: updatedName,
      playerId: currentUser.player_id,
      player_id: currentUser.player_id
    };

    if (body.name) {
      await sql`UPDATE users SET name = ${updatedName} WHERE user_id = ${userId}`;
    }

    await sql`
      INSERT INTO profiles (user_id, data_json, updated_at)
      VALUES (${userId}, ${JSON.stringify(updatedProfile)}::jsonb, ${now})
      ON CONFLICT (user_id) DO UPDATE SET
        data_json = EXCLUDED.data_json,
        updated_at = EXCLUDED.updated_at
    `;

    if (currentUser.player_id) {
      await sql`
        UPDATE players
        SET
          name = ${updatedName},
          jersey_name = COALESCE(${body.jerseyName || null}, jersey_name),
          jersey_number = COALESCE(${body.jerseyNumber !== undefined ? parseInt(body.jerseyNumber, 10) : null}, jersey_number),
          jersey_size = COALESCE(${body.jerseySize || null}, jersey_size),
          role = COALESCE(${body.role || null}, role),
          batting_style = COALESCE(${body.battingStyle || null}, batting_style),
          bowling_style = COALESCE(${body.bowlingStyle || null}, bowling_style),
          email = COALESCE(${body.email || null}, email),
          date_of_birth = COALESCE(${body.birthdate || body.dateOfBirth || null}, date_of_birth),
          profile_photo = COALESCE(${body.photoUrl || body.profilePhoto || null}, profile_photo),
          data_json = data_json || ${JSON.stringify(updatedProfile)}::jsonb,
          updated_at = ${now}
        WHERE player_id = ${currentUser.player_id}
      `;
    }

    res.json({
      ok: true,
      success: true,
      message: "Profile updated successfully",
      playerId: currentUser.player_id,
      profile: updatedProfile
    });
  } catch (err) {
    console.error("Update profile error:", err.message);
    res.status(500).json({ ok: false, success: false, error: "Failed to update profile" });
  }
});

// --- PLAYER MASTER APIS (PHASE 4 & PHASE 5) ---

// GET /api/players/search - Search players (MUST be defined before :playerId)
app.get("/api/players/search", async (req, res) => {
  try {
    const sql = await getDatabase();
    const q = String(req.query.q || req.query.query || "").trim();
    const like = "%" + q + "%";

    let rows;
    if (!q) {
      rows = await sql`
        SELECT * FROM players
        WHERE is_active IS NOT FALSE AND user_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 50
      `;
    } else {
      rows = await sql`
        SELECT * FROM players
        WHERE (is_active IS NOT FALSE) AND user_id IS NOT NULL AND (
          name ILIKE ${like} OR
          mobile ILIKE ${like} OR
          player_id ILIKE ${like} OR
          jersey_name ILIKE ${like} OR
          role ILIKE ${like} OR
          email ILIKE ${like}
        )
        ORDER BY created_at DESC
        LIMIT 50
      `;
    }

    const players = rows.map(r => ({ ...r, playerId: r.player_id }));
    res.json({ ok: true, success: true, count: players.length, players });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Search failed: " + err.message });
  }
});

// GET /api/players - List players
app.get("/api/players", async (req, res) => {
  try {
    const sql = await getDatabase();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const rows = await sql`
      SELECT * FROM players
      WHERE is_active IS NOT FALSE
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    const players = rows.map(r => ({ ...r, playerId: r.player_id }));
    res.json({ ok: true, success: true, count: players.length, players });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/players - Create player (Phase 5 Player Master Creation)
app.post("/api/players", optionalAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const body = req.body || {};
    const p = body.player || body;

    // Validate required fields
    const rawName = p.name ? String(p.name).trim() : "";
    if (!rawName) {
      return res.status(400).json({ ok: false, success: false, error: "Player name is required" });
    }

    // Validate mobile if provided
    let cleanMobile = p.mobile ? String(p.mobile).trim() : null;
    if (cleanMobile && !/^\d{10,15}$/.test(cleanMobile)) {
      return res.status(400).json({ ok: false, success: false, error: "Mobile number must be 10-15 digits" });
    }

    // Phase 4/5 Duplicate Player ID Protection:
    // If client supplied a playerId, verify it does NOT collide with existing records
    const clientProvidedId = p.playerId || p.player_id || body.playerId;
    if (clientProvidedId) {
      const existingCheck = await sql`SELECT player_id FROM players WHERE player_id = ${String(clientProvidedId).trim()} LIMIT 1`;
      if (existingCheck.length > 0) {
        return res.status(409).json({
          ok: false,
          success: false,
          error: "Conflict: Player ID already exists in database"
        });
      }
    }

    // Always generate permanent Player ID SERVER-SIDE (Never trust client authority)
    const permanentPlayerId = await generatePermanentPlayerId(sql);
    const now = Date.now();

    const jerseyNumber = p.jerseyNumber !== undefined && p.jerseyNumber !== null && !isNaN(parseInt(p.jerseyNumber, 10))
      ? parseInt(p.jerseyNumber, 10)
      : null;
    const jerseyName = p.jerseyName ? String(p.jerseyName).trim() : null;
    const jerseySize = p.jerseySize ? String(p.jerseySize).trim() : null;
    const role = p.role ? String(p.role).trim() : "All-Rounder";
    const battingStyle = p.battingStyle ? String(p.battingStyle).trim() : null;
    const bowlingStyle = p.bowlingStyle ? String(p.bowlingStyle).trim() : null;
    const email = p.email ? String(p.email).trim() : null;
    const birthdate = p.birthdate ? String(p.birthdate).trim() : (p.dateOfBirth ? String(p.dateOfBirth).trim() : null);
    const photoUrl = p.photoUrl ? String(p.photoUrl).trim() : (p.profilePhoto ? String(p.profilePhoto).trim() : null);
    const userId = req.user ? req.user.userId : (p.userId || p.user_id || null);

    const dataJson = {
      ...p,
      playerId: permanentPlayerId,
      player_id: permanentPlayerId,
      userId,
      name: rawName,
      mobile: cleanMobile,
      jerseyName,
      jerseyNumber,
      jerseySize,
      role,
      battingStyle,
      bowlingStyle,
      email,
      birthdate,
      photoUrl
    };

    await sql`
      INSERT INTO players (
        player_id, user_id, name, mobile, jersey_name, jersey_number, jersey_size,
        role, batting_style, bowling_style, email, birthdate, date_of_birth,
        photo_url, profile_photo, is_active, data_json, created_at, updated_at
      ) VALUES (
        ${permanentPlayerId}, ${userId}, ${rawName}, ${cleanMobile}, ${jerseyName}, ${jerseyNumber}, ${jerseySize},
        ${role}, ${battingStyle}, ${bowlingStyle}, ${email}, ${birthdate}, ${birthdate},
        ${photoUrl}, ${photoUrl}, TRUE, ${JSON.stringify(dataJson)}::jsonb, ${now}, ${now}
      )
    `;

    const savedRow = await sql`SELECT * FROM players WHERE player_id = ${permanentPlayerId} LIMIT 1`;
    const createdPlayer = savedRow[0];

    res.json({
      ok: true,
      success: true,
      message: "Player created successfully with permanent Player ID",
      playerId: permanentPlayerId,
      player_id: permanentPlayerId,
      player: {
        ...createdPlayer,
        playerId: permanentPlayerId
      }
    });
  } catch (err) {
    console.error("Create player error:", err.message);
    res.status(500).json({ ok: false, success: false, error: err.message });
  }
});

// GET /api/players/:playerId - Read player by permanent ID
app.get("/api/players/:playerId", async (req, res) => {
  try {
    const sql = await getDatabase();
    const playerId = String(req.params.playerId || "").trim();
    if (!playerId) {
      return res.status(400).json({ ok: false, success: false, error: "Player ID is required" });
    }

    const rows = await sql`
      SELECT * FROM players
      WHERE player_id = ${playerId} AND is_active IS NOT FALSE
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, success: false, error: "Player not found" });
    }

    const player = rows[0];
    res.json({
      ok: true,
      success: true,
      playerId: player.player_id,
      player: {
        ...player,
        playerId: player.player_id
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/players/:playerId - Update player details (permanent Player ID immutable)
app.put("/api/players/:playerId", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const paramId = String(req.params.playerId || "").trim();
    if (!paramId) {
      return res.status(400).json({ ok: false, success: false, error: "Player ID is required" });
    }

    const existing = await sql`SELECT * FROM players WHERE player_id = ${paramId} LIMIT 1`;
    if (existing.length === 0) {
      return res.status(404).json({ ok: false, success: false, error: "Player not found" });
    }
    const currentPlayer = existing[0];

    // Cross-user authorization check:
    // If the player belongs to a registered user and an authenticated caller attempts modification
    if (req.user && currentPlayer.user_id && req.user.userId !== currentPlayer.user_id) {
      return res.status(403).json({
        ok: false,
        success: false,
        error: "Forbidden: You are not authorized to modify another user's player record"
      });
    }

    const body = req.body || {};
    const targetNewId = body.playerId || body.player_id;
    if (targetNewId && String(targetNewId).trim() !== paramId) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: "Permanent Player ID cannot be modified or replaced"
      });
    }

    const p = body.player || body;
    const now = Date.now();
    const name = p.name !== undefined ? String(p.name).trim() : currentPlayer.name;
    const mobile = p.mobile !== undefined ? String(p.mobile).trim() : currentPlayer.mobile;
    const jerseyNumber = p.jerseyNumber !== undefined && !isNaN(parseInt(p.jerseyNumber, 10))
      ? parseInt(p.jerseyNumber, 10)
      : currentPlayer.jersey_number;
    const jerseyName = p.jerseyName !== undefined ? p.jerseyName : currentPlayer.jersey_name;
    const jerseySize = p.jerseySize !== undefined ? p.jerseySize : currentPlayer.jersey_size;
    const role = p.role !== undefined ? p.role : currentPlayer.role;
    const battingStyle = p.battingStyle !== undefined ? p.battingStyle : currentPlayer.batting_style;
    const bowlingStyle = p.bowlingStyle !== undefined ? p.bowlingStyle : currentPlayer.bowling_style;
    const email = p.email !== undefined ? p.email : currentPlayer.email;
    const birthdate = p.birthdate !== undefined ? p.birthdate : (p.dateOfBirth !== undefined ? p.dateOfBirth : currentPlayer.birthdate);
    const photoUrl = p.photoUrl !== undefined ? p.photoUrl : (p.profilePhoto !== undefined ? p.profilePhoto : currentPlayer.photo_url);

    const mergedData = {
      ...(currentPlayer.data_json || {}),
      ...p,
      playerId: paramId,
      player_id: paramId
    };

    await sql`
      UPDATE players
      SET
        name = ${name},
        mobile = ${mobile},
        jersey_name = ${jerseyName},
        jersey_number = ${jerseyNumber},
        jersey_size = ${jerseySize},
        role = ${role},
        batting_style = ${battingStyle},
        bowling_style = ${bowlingStyle},
        email = ${email},
        birthdate = ${birthdate},
        date_of_birth = ${birthdate},
        photo_url = ${photoUrl},
        profile_photo = ${photoUrl},
        data_json = ${JSON.stringify(mergedData)}::jsonb,
        updated_at = ${now}
      WHERE player_id = ${paramId}
    `;

    const updated = await sql`SELECT * FROM players WHERE player_id = ${paramId} LIMIT 1`;
    res.json({
      ok: true,
      success: true,
      message: "Player updated successfully",
      playerId: paramId,
      player: {
        ...updated[0],
        playerId: paramId
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/players/:playerId - Delete player (Phase 5 Player Master Delete)
app.delete("/api/players/:playerId", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const paramId = String(req.params.playerId || "").trim();
    if (!paramId) {
      return res.status(400).json({ ok: false, success: false, error: "Player ID is required" });
    }

    const rows = await sql`SELECT * FROM players WHERE player_id = ${paramId} LIMIT 1`;
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, success: false, error: "Player not found" });
    }
    const player = rows[0];

    // Cross-user authorization check:
    // If the player belongs to a registered user and an authenticated caller attempts deletion
    if (req.user && player.user_id && req.user.userId !== player.user_id) {
      return res.status(403).json({
        ok: false,
        success: false,
        error: "Forbidden: You are not authorized to delete another user's player record"
      });
    }

    // Delete record from players table
    await sql`DELETE FROM players WHERE player_id = ${paramId}`;

    res.json({
      ok: true,
      success: true,
      message: `Player ${paramId} deleted successfully`,
      deletedPlayerId: paramId
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Delete failed: " + err.message });
  }
});

// --- TEAM MASTER APIS (PHASE 6) ---

// GET /api/teams/search - Search teams (must be before :teamId)
app.get("/api/teams/search", async (req, res) => {
  try {
    const sql = await getDatabase();
    const q = String(req.query.q || req.query.query || "").trim();
    const like = "%" + q + "%";

    let rows;
    if (!q) {
      rows = await sql`
        SELECT * FROM teams
        WHERE is_active IS NOT FALSE
        ORDER BY created_at DESC
        LIMIT 50
      `;
    } else {
      rows = await sql`
        SELECT * FROM teams
        WHERE (is_active IS NOT FALSE) AND (
          name ILIKE ${like} OR
          short_name ILIKE ${like} OR
          city ILIKE ${like} OR
          team_id ILIKE ${like}
        )
        ORDER BY created_at DESC
        LIMIT 50
      `;
    }

    const teams = rows.map(r => ({
      ...r,
      teamId: r.team_id,
      shortName: r.short_name,
      captainId: r.captain_id,
      logoUrl: r.logo_url
    }));
    res.json({ ok: true, success: true, count: teams.length, teams });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Search failed: " + err.message });
  }
});

// GET /api/teams - List teams (with optional search/filter)
app.get("/api/teams", async (req, res) => {
  try {
    const sql = await getDatabase();
    const q = String(req.query.q || req.query.search || req.query.query || "").trim();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    let rows;
    if (!q) {
      rows = await sql`
        SELECT * FROM teams
        WHERE is_active IS NOT FALSE
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else {
      const like = "%" + q + "%";
      rows = await sql`
        SELECT * FROM teams
        WHERE (is_active IS NOT FALSE) AND (
          name ILIKE ${like} OR
          short_name ILIKE ${like} OR
          city ILIKE ${like} OR
          team_id ILIKE ${like}
        )
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }

    const teams = rows.map(r => ({
      ...r,
      teamId: r.team_id,
      shortName: r.short_name,
      captainId: r.captain_id,
      logoUrl: r.logo_url
    }));
    res.json({ ok: true, success: true, count: teams.length, teams });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/teams/:teamId - Fetch team by permanent team_id
app.get("/api/teams/:teamId", async (req, res) => {
  try {
    const sql = await getDatabase();
    const paramId = String(req.params.teamId || "").trim();
    if (!paramId) {
      return res.status(400).json({ ok: false, success: false, error: "Team ID is required" });
    }

    const rows = await sql`
      SELECT * FROM teams
      WHERE team_id = ${paramId} AND is_active IS NOT FALSE
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, success: false, error: "Team not found" });
    }

    const team = rows[0];
    res.json({
      ok: true,
      success: true,
      teamId: team.team_id,
      team_id: team.team_id,
      team: {
        ...team,
        teamId: team.team_id,
        shortName: team.short_name,
        captainId: team.captain_id,
        logoUrl: team.logo_url
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/teams - Create team (requires authenticated user)
app.post("/api/teams", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const body = req.body || {};
    const t = body.team || body;

    // Validate required fields
    const rawName = t.name ? String(t.name).trim() : "";
    if (!rawName) {
      return res.status(400).json({ ok: false, success: false, error: "Team name is required" });
    }

    // Duplicate team_id / client tampering protection
    const clientProvidedId = t.teamId || t.team_id || body.teamId;
    if (clientProvidedId) {
      const existingCheck = await sql`SELECT team_id FROM teams WHERE team_id = ${String(clientProvidedId).trim()} LIMIT 1`;
      if (existingCheck.length > 0) {
        return res.status(409).json({
          ok: false,
          success: false,
          error: "Conflict: Team ID already exists in database"
        });
      }
    }

    // Always generate permanent Team ID SERVER-SIDE
    const permanentTeamId = await generatePermanentTeamId(sql);
    const now = Date.now();

    const shortName = t.shortName ? String(t.shortName).trim() : (t.short_name ? String(t.short_name).trim() : null);
    const captainId = t.captainId ? String(t.captainId).trim() : (t.captain_id ? String(t.captain_id).trim() : null);
    const city = t.city ? String(t.city).trim() : null;
    const logoUrl = t.logoUrl ? String(t.logoUrl).trim() : (t.logo_url ? String(t.logo_url).trim() : null);
    const userId = req.user ? req.user.userId : null;

    const dataJson = {
      ...t,
      teamId: permanentTeamId,
      team_id: permanentTeamId,
      name: rawName,
      shortName,
      captainId,
      city,
      logoUrl,
      userId
    };

    await sql`
      INSERT INTO teams (
        team_id, user_id, name, short_name, captain_id, city, logo_url,
        is_active, data_json, created_at, updated_at
      ) VALUES (
        ${permanentTeamId}, ${userId}, ${rawName}, ${shortName}, ${captainId}, ${city}, ${logoUrl},
        TRUE, ${JSON.stringify(dataJson)}::jsonb, ${now}, ${now}
      )
    `;

    const savedRow = await sql`SELECT * FROM teams WHERE team_id = ${permanentTeamId} LIMIT 1`;
    const createdTeam = savedRow[0];

    res.status(200).json({
      ok: true,
      success: true,
      message: "Team created successfully with permanent Team ID",
      teamId: permanentTeamId,
      team_id: permanentTeamId,
      team: {
        ...createdTeam,
        teamId: permanentTeamId,
        shortName: createdTeam.short_name,
        captainId: createdTeam.captain_id,
        logoUrl: createdTeam.logo_url
      }
    });
  } catch (err) {
    console.error("Create team error:", err.message);
    res.status(500).json({ ok: false, success: false, error: err.message });
  }
});

// PUT /api/teams/:teamId - Update team details (requires authenticated user and ownership)
app.put("/api/teams/:teamId", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const paramId = String(req.params.teamId || "").trim();
    if (!paramId) {
      return res.status(400).json({ ok: false, success: false, error: "Team ID is required" });
    }

    const existing = await sql`SELECT * FROM teams WHERE team_id = ${paramId} LIMIT 1`;
    if (existing.length === 0) {
      return res.status(404).json({ ok: false, success: false, error: "Team not found" });
    }
    const currentTeam = existing[0];

    // Cross-user authorization check:
    if (currentTeam.user_id && req.user && req.user.userId !== currentTeam.user_id) {
      return res.status(403).json({
        ok: false,
        success: false,
        error: "Forbidden: You are not authorized to modify another user's team"
      });
    }

    const body = req.body || {};
    // Reject permanent Team ID mutation/tampering
    const targetNewId = body.teamId || body.team_id;
    if (targetNewId && String(targetNewId).trim() !== paramId) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: "Permanent team_id cannot be modified or replaced"
      });
    }

    const t = body.team || body;
    const now = Date.now();
    const name = t.name !== undefined ? String(t.name).trim() : currentTeam.name;
    const shortName = t.shortName !== undefined ? t.shortName : (t.short_name !== undefined ? t.short_name : currentTeam.short_name);
    const captainId = t.captainId !== undefined ? t.captainId : (t.captain_id !== undefined ? t.captain_id : currentTeam.captain_id);
    const city = t.city !== undefined ? t.city : currentTeam.city;
    const logoUrl = t.logoUrl !== undefined ? t.logoUrl : (t.logo_url !== undefined ? t.logo_url : currentTeam.logo_url);

    const mergedData = {
      ...(currentTeam.data_json || {}),
      ...t,
      teamId: paramId,
      team_id: paramId
    };

    await sql`
      UPDATE teams
      SET
        name = ${name},
        short_name = ${shortName},
        captain_id = ${captainId},
        city = ${city},
        logo_url = ${logoUrl},
        data_json = ${JSON.stringify(mergedData)}::jsonb,
        updated_at = ${now}
      WHERE team_id = ${paramId}
    `;

    const updated = await sql`SELECT * FROM teams WHERE team_id = ${paramId} LIMIT 1`;
    res.json({
      ok: true,
      success: true,
      message: "Team updated successfully",
      teamId: paramId,
      team_id: paramId,
      team: {
        ...updated[0],
        teamId: paramId,
        shortName: updated[0].short_name,
        captainId: updated[0].captain_id,
        logoUrl: updated[0].logo_url
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/teams/:teamId - Delete team (requires authenticated user and ownership)
app.delete("/api/teams/:teamId", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const paramId = String(req.params.teamId || "").trim();
    if (!paramId) {
      return res.status(400).json({ ok: false, success: false, error: "Team ID is required" });
    }

    const rows = await sql`SELECT * FROM teams WHERE team_id = ${paramId} LIMIT 1`;
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, success: false, error: "Team not found" });
    }
    const team = rows[0];

    // Cross-user authorization check:
    if (team.user_id && req.user && req.user.userId !== team.user_id) {
      return res.status(403).json({
        ok: false,
        success: false,
        error: "Forbidden: You are not authorized to delete another user's team"
      });
    }

    // Delete record from teams table in PostgreSQL
    await sql`DELETE FROM teams WHERE team_id = ${paramId}`;

    res.json({
      ok: true,
      success: true,
      message: `Team ${paramId} deleted successfully`,
      deletedTeamId: paramId
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Delete failed: " + err.message });
  }
});

// Helper to map DB tournament row to standard tournament response object
function formatTournamentResponse(row) {
  if (!row) return null;
  return {
    ...row,
    tournamentId: row.tournament_id,
    tournament_id: row.tournament_id,
    shortName: row.short_name,
    short_name: row.short_name,
    logoUrl: row.logo_url,
    logo_url: row.logo_url,
    startDate: row.start_date,
    start_date: row.start_date,
    endDate: row.end_date,
    end_date: row.end_date,
    userId: row.user_id,
    user_id: row.user_id,
    isActive: row.is_active,
    is_active: row.is_active
  };
}

// GET /api/tournaments - List tournaments with search/filter
app.get("/api/tournaments", async (req, res) => {
  try {
    const sql = await getDatabase();
    const query = req.query.q || req.query.search || "";
    const formatFilter = req.query.format || "";
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

    let rows;
    if (query || formatFilter) {
      const like = `%${String(query).trim()}%`;
      if (formatFilter) {
        rows = await sql`
          SELECT * FROM tournaments
          WHERE (is_active IS NOT FALSE)
            AND format ILIKE ${formatFilter}
            AND (
              name ILIKE ${like} OR
              short_name ILIKE ${like} OR
              city ILIKE ${like} OR
              tournament_id ILIKE ${like}
            )
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
      } else {
        rows = await sql`
          SELECT * FROM tournaments
          WHERE (is_active IS NOT FALSE) AND (
            name ILIKE ${like} OR
            short_name ILIKE ${like} OR
            city ILIKE ${like} OR
            tournament_id ILIKE ${like} OR
            format ILIKE ${like}
          )
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
      }
    } else {
      rows = await sql`
        SELECT * FROM tournaments
        WHERE is_active IS NOT FALSE
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }

    const tournaments = rows.map(formatTournamentResponse);
    res.json({ ok: true, success: true, count: tournaments.length, tournaments });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/tournaments/search - Search endpoint
app.get("/api/tournaments/search", async (req, res) => {
  try {
    const sql = await getDatabase();
    const query = req.query.q || req.query.search || "";
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const like = `%${String(query).trim()}%`;

    const rows = await sql`
      SELECT * FROM tournaments
      WHERE (is_active IS NOT FALSE) AND (
        name ILIKE ${like} OR
        short_name ILIKE ${like} OR
        city ILIKE ${like} OR
        tournament_id ILIKE ${like} OR
        format ILIKE ${like}
      )
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    const tournaments = rows.map(formatTournamentResponse);
    res.json({ ok: true, success: true, count: tournaments.length, tournaments });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/tournaments/:tournamentId - Detail endpoint
app.get("/api/tournaments/:tournamentId", async (req, res) => {
  try {
    const sql = await getDatabase();
    const paramId = String(req.params.tournamentId || "").trim();
    if (!paramId) {
      return res.status(400).json({ ok: false, success: false, error: "Tournament ID is required" });
    }

    const rows = await sql`
      SELECT * FROM tournaments
      WHERE tournament_id = ${paramId} AND is_active IS NOT FALSE
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, success: false, error: "Tournament not found" });
    }

    const tour = formatTournamentResponse(rows[0]);
    res.json({
      ok: true,
      success: true,
      tournamentId: tour.tournament_id,
      tournament_id: tour.tournament_id,
      tournament: tour
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/tournaments - Create tournament (requires authenticated user)
app.post("/api/tournaments", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const body = req.body || {};
    const t = body.tournament || body;

    // Validate required fields
    const rawName = t.name ? String(t.name).trim() : "";
    if (!rawName) {
      return res.status(400).json({ ok: false, success: false, error: "Tournament name is required" });
    }

    // Duplicate tournament_id / client tampering protection
    const clientProvidedId = t.tournamentId || t.tournament_id || body.tournamentId || body.tournament_id;
    if (clientProvidedId) {
      const existingCheck = await sql`SELECT tournament_id FROM tournaments WHERE tournament_id = ${String(clientProvidedId).trim()} LIMIT 1`;
      if (existingCheck.length > 0) {
        return res.status(409).json({
          ok: false,
          success: false,
          error: "Conflict: Tournament ID already exists in database"
        });
      }
    }

    // Always generate permanent Tournament ID SERVER-SIDE
    const permanentTournamentId = await generatePermanentTournamentId(sql);
    const now = Date.now();

    const shortName = t.shortName ? String(t.shortName).trim() : (t.short_name ? String(t.short_name).trim() : null);
    const logoUrl = t.logoUrl ? String(t.logoUrl).trim() : (t.logo_url ? String(t.logo_url).trim() : null);
    const city = t.city ? String(t.city).trim() : null;
    const startDate = t.startDate ? String(t.startDate).trim() : (t.start_date ? String(t.start_date).trim() : null);
    const endDate = t.endDate ? String(t.endDate).trim() : (t.end_date ? String(t.end_date).trim() : null);
    const format = t.format ? String(t.format).trim() : "T20";
    const status = t.status ? String(t.status).trim() : "upcoming";
    const userId = req.user ? req.user.userId : null;

    const dataJson = {
      ...t,
      tournamentId: permanentTournamentId,
      tournament_id: permanentTournamentId,
      name: rawName,
      shortName,
      logoUrl,
      city,
      startDate,
      endDate,
      format,
      status,
      userId
    };

    await sql`
      INSERT INTO tournaments (
        tournament_id, user_id, name, short_name, logo_url, city,
        start_date, end_date, format, status, is_active, data_json, created_at, updated_at
      ) VALUES (
        ${permanentTournamentId}, ${userId}, ${rawName}, ${shortName}, ${logoUrl}, ${city},
        ${startDate}, ${endDate}, ${format}, ${status}, TRUE, ${JSON.stringify(dataJson)}::jsonb, ${now}, ${now}
      )
    `;

    const savedRow = await sql`SELECT * FROM tournaments WHERE tournament_id = ${permanentTournamentId} LIMIT 1`;
    const createdTourn = formatTournamentResponse(savedRow[0]);

    res.status(200).json({
      ok: true,
      success: true,
      message: "Tournament created successfully with permanent Tournament ID",
      tournamentId: permanentTournamentId,
      tournament_id: permanentTournamentId,
      tournament: createdTourn
    });
  } catch (err) {
    console.error("Create tournament error:", err.message);
    res.status(500).json({ ok: false, success: false, error: err.message });
  }
});

// PUT /api/tournaments/:tournamentId - Update tournament details (requires authenticated user and ownership)
app.put("/api/tournaments/:tournamentId", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const paramId = String(req.params.tournamentId || "").trim();
    if (!paramId) {
      return res.status(400).json({ ok: false, success: false, error: "Tournament ID is required" });
    }

    const existing = await sql`SELECT * FROM tournaments WHERE tournament_id = ${paramId} LIMIT 1`;
    if (existing.length === 0) {
      return res.status(404).json({ ok: false, success: false, error: "Tournament not found" });
    }
    const currentTourn = existing[0];

    // Cross-user authorization check:
    if (currentTourn.user_id && req.user && req.user.userId !== currentTourn.user_id && req.user.role !== "admin") {
      return res.status(403).json({
        ok: false,
        success: false,
        error: "Forbidden: You are not authorized to modify another user's tournament"
      });
    }

    const body = req.body || {};
    // Reject permanent Tournament ID mutation/tampering
    const targetNewId = body.tournamentId || body.tournament_id;
    if (targetNewId && String(targetNewId).trim() !== paramId) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: "Permanent tournament_id cannot be modified or replaced"
      });
    }

    const t = body.tournament || body;
    const now = Date.now();

    // Validate name if provided
    if (t.name !== undefined) {
      const trimmed = String(t.name).trim();
      if (!trimmed) {
        return res.status(400).json({ ok: false, success: false, error: "Tournament name cannot be empty" });
      }
    }

    const name = t.name !== undefined ? String(t.name).trim() : currentTourn.name;
    const shortName = t.shortName !== undefined ? t.shortName : (t.short_name !== undefined ? t.short_name : currentTourn.short_name);
    const logoUrl = t.logoUrl !== undefined ? t.logoUrl : (t.logo_url !== undefined ? t.logo_url : currentTourn.logo_url);
    const city = t.city !== undefined ? t.city : currentTourn.city;
    const startDate = t.startDate !== undefined ? t.startDate : (t.start_date !== undefined ? t.start_date : currentTourn.start_date);
    const endDate = t.endDate !== undefined ? t.endDate : (t.end_date !== undefined ? t.end_date : currentTourn.end_date);
    const format = t.format !== undefined ? t.format : currentTourn.format;
    const status = t.status !== undefined ? t.status : currentTourn.status;

    const mergedData = {
      ...(currentTourn.data_json || {}),
      ...t,
      tournamentId: paramId,
      tournament_id: paramId
    };

    await sql`
      UPDATE tournaments
      SET
        name = ${name},
        short_name = ${shortName},
        logo_url = ${logoUrl},
        city = ${city},
        start_date = ${startDate},
        end_date = ${endDate},
        format = ${format},
        status = ${status},
        data_json = ${JSON.stringify(mergedData)}::jsonb,
        updated_at = ${now}
      WHERE tournament_id = ${paramId}
    `;

    const updated = await sql`SELECT * FROM tournaments WHERE tournament_id = ${paramId} LIMIT 1`;
    const formatted = formatTournamentResponse(updated[0]);

    res.json({
      ok: true,
      success: true,
      message: "Tournament updated successfully",
      tournamentId: paramId,
      tournament_id: paramId,
      tournament: formatted
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/tournaments/:tournamentId - Delete tournament (requires authenticated user and ownership)
app.delete("/api/tournaments/:tournamentId", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const paramId = String(req.params.tournamentId || "").trim();
    if (!paramId) {
      return res.status(400).json({ ok: false, success: false, error: "Tournament ID is required" });
    }

    const rows = await sql`SELECT * FROM tournaments WHERE tournament_id = ${paramId} LIMIT 1`;
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, success: false, error: "Tournament not found" });
    }
    const tour = rows[0];

    // Cross-user authorization check:
    if (tour.user_id && req.user && req.user.userId !== tour.user_id && req.user.role !== "admin") {
      return res.status(403).json({
        ok: false,
        success: false,
        error: "Forbidden: You are not authorized to delete another user's tournament"
      });
    }

    // Delete record from tournaments table in PostgreSQL
    await sql`DELETE FROM tournaments WHERE tournament_id = ${paramId}`;

    res.json({
      ok: true,
      success: true,
      message: `Tournament ${paramId} deleted successfully`,
      deletedTournamentId: paramId
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Delete failed: " + err.message });
  }
});

// Tournament Teams Relationship Endpoints (Phase 7 Requirement 16)
app.get("/api/tournaments/:tournamentId/teams", async (req, res) => {
  try {
    const sql = await getDatabase();
    const paramId = String(req.params.tournamentId || "").trim();
    const rows = await sql`
      SELECT tt.*, t.name as team_name, t.short_name as team_short_name, t.city as team_city, t.logo_url as team_logo_url
      FROM tournament_teams tt
      JOIN teams t ON tt.team_id = t.team_id
      WHERE tt.tournament_id = ${paramId}
      ORDER BY tt.created_at ASC
    `;
    res.json({ ok: true, success: true, count: rows.length, teams: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/tournaments/:tournamentId/teams", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const paramId = String(req.params.tournamentId || "").trim();
    const teamId = req.body.teamId || req.body.team_id;
    const groupName = req.body.groupName || req.body.group_name || "Group A";
    if (!teamId) {
      return res.status(400).json({ ok: false, error: "teamId is required" });
    }

    const tour = await sql`SELECT * FROM tournaments WHERE tournament_id = ${paramId} LIMIT 1`;
    if (tour.length === 0) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }
    if (tour[0].user_id && req.user && req.user.userId !== tour[0].user_id && req.user.role !== "admin") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const now = Date.now();
    await sql`
      INSERT INTO tournament_teams (tournament_id, team_id, group_name, created_at)
      VALUES (${paramId}, ${teamId}, ${groupName}, ${now})
      ON CONFLICT (tournament_id, team_id) DO UPDATE SET group_name = ${groupName}
    `;

    res.json({ ok: true, success: true, message: "Team linked to tournament successfully" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/tournaments/:tournamentId/teams/:teamId", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const paramId = String(req.params.tournamentId || "").trim();
    const teamId = String(req.params.teamId || "").trim();

    const tour = await sql`SELECT * FROM tournaments WHERE tournament_id = ${paramId} LIMIT 1`;
    if (tour.length === 0) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }
    if (tour[0].user_id && req.user && req.user.userId !== tour[0].user_id && req.user.role !== "admin") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    await sql`DELETE FROM tournament_teams WHERE tournament_id = ${paramId} AND team_id = ${teamId}`;
    res.json({ ok: true, success: true, message: "Team removed from tournament successfully" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const roomWsClients = new Map();
function roomKey(type, id) { return `${String(type).toUpperCase()}:${String(id)}`; }
function broadcastRoom(type, id, message) {
  const set = roomWsClients.get(roomKey(type, id));
  if (!set) return;
  const payload = JSON.stringify(message);
  for (const ws of set) { if (ws.readyState === ws.OPEN) ws.send(payload); }
}

function broadcastMatch(matchId, message) {
  const set = matchWsClients.get(matchId);
  if (!set) return;
  const payload = JSON.stringify(message);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

app.post("/api/live/match/:matchId", async (req, res) => {
  try {
    const sql = await getDatabase();
    const matchId = String(req.params.matchId || "").trim();
    if (!matchId) return res.status(400).json({ ok: false, error: "matchId is required" });

    const raw = req.body || {};
    const matchData = raw.matchData || raw;
    const tournamentId = matchData.tournamentId || matchData.tournament_id || raw.tournamentId || null;
    const status = String(matchData.status || raw.status || "live").trim();
    const title = matchData.title || matchData.matchTitle || raw.title || null;
    const now = Date.now();

    const mergedPayload = { ...(matchData || {}), ...raw, matchId, id: matchId };

    await sql`
      INSERT INTO live_matches (match_id, tournament_id, status, title, data_json, created_at, updated_at)
      VALUES (${matchId}, ${tournamentId}, ${status}, ${title}, ${JSON.stringify(mergedPayload)}::jsonb, ${now}, ${now})
      ON CONFLICT (match_id) DO UPDATE SET
        tournament_id = COALESCE(EXCLUDED.tournament_id, live_matches.tournament_id),
        status = EXCLUDED.status,
        title = COALESCE(EXCLUDED.title, live_matches.title),
        data_json = EXCLUDED.data_json,
        updated_at = EXCLUDED.updated_at
    `;

    broadcastMatch(matchId, {
      type: "MATCH_SCORE_UPDATE",
      matchId,
      match: mergedPayload,
      data: mergedPayload,
      updatedAt: now
    });

    res.json({ ok: true, success: true, matchId, match: mergedPayload });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to save match: " + err.message });
  }
});

app.get("/api/live/match/:matchId", async (req, res) => {
  try {
    const sql = await getDatabase();
    const matchId = String(req.params.matchId || "").trim();
    const rows = await sql`
      SELECT match_id AS "matchId", tournament_id AS "tournamentId", status, title, data_json, updated_at AS "updatedAt"
      FROM live_matches
      WHERE match_id = ${matchId}
      LIMIT 1
    `;
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "Match not found" });
    }
    const r = rows[0];
    res.json({ ok: true, success: true, match: { ...(r.data_json || {}), ...r } });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to fetch match" });
  }
});

app.get("/api/live/matches", async (req, res) => {
  try {
    const sql = await getDatabase();
    const search = String(req.query.search || "").trim();
    const like = "%" + search + "%";

    const rows = await sql`
      SELECT match_id AS "matchId", tournament_id AS "tournamentId", status, title, data_json, updated_at AS "updatedAt"
      FROM live_matches
      WHERE (${search} = ${""} OR title ILIKE ${like} OR match_id ILIKE ${like} OR (data_json->>'title') ILIKE ${like})
      ORDER BY updated_at DESC
      LIMIT 50
    `;
    const matches = rows.map(r => ({ ...(r.data_json || {}), ...r }));
    res.json({ ok: true, success: true, matches });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to fetch live matches" });
  }
});

app.get("/api/live-matches", async (req, res) => {
  try {
    const sql = await getDatabase();
    const rows = await sql`
      SELECT match_id AS "matchId", tournament_id AS "tournamentId", status, title, data_json, updated_at AS "updatedAt"
      FROM live_matches
      ORDER BY updated_at DESC
      LIMIT 50
    `;
    const matches = rows.map(r => ({ ...(r.data_json || {}), ...r }));
    res.json({ ok: true, success: true, matches });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to fetch live matches" });
  }
});

app.post("/api/live-matches", async (req, res) => {
  try {
    const sql = await getDatabase();
    const matchId = String(req.body?.match_id || req.body?.matchId || "").trim() || ("MATCH-" + Date.now());
    const raw = req.body || {};
    const matchData = raw.matchData || raw.data || raw;
    const tournamentId = matchData.tournamentId || null;
    const status = String(matchData.status || "live").trim();
    const title = matchData.title || "Match";
    const now = Date.now();
    const mergedPayload = { ...(matchData || {}), ...raw, matchId, id: matchId };

    await sql`
      INSERT INTO live_matches (match_id, tournament_id, status, title, data_json, created_at, updated_at)
      VALUES (${matchId}, ${tournamentId}, ${status}, ${title}, ${JSON.stringify(mergedPayload)}::jsonb, ${now}, ${now})
      ON CONFLICT (match_id) DO UPDATE SET
        tournament_id = COALESCE(EXCLUDED.tournament_id, live_matches.tournament_id),
        status = EXCLUDED.status,
        title = COALESCE(EXCLUDED.title, live_matches.title),
        data_json = EXCLUDED.data_json,
        updated_at = EXCLUDED.updated_at
    `;
    res.json({ ok: true, success: true, matchId, match: mergedPayload });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


// ===== PHASE 1-19 DOMAIN ROUTES (integrated with original CRIC YUVA UI) =====
const { id: makeDomainId, now: nowMs, scoreDelivery } = require("./phase-engine");

async function audit(sql, req, action, resourceType, resourceId, data = {}) {
  try { await sql`INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip, data_json, created_at) VALUES (${req.user?.userId || null}, ${action}, ${resourceType || null}, ${resourceId || null}, ${String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")}, ${JSON.stringify(data)}::jsonb, ${nowMs()})`; } catch {}
}
function ownerOr404(row, req, res) { if (!row) { res.status(404).json({ok:false,success:false,error:"Not found"}); return false; } if (req.admin) return true; if (!row.user_id || row.user_id !== req.user.userId) { res.status(403).json({ok:false,success:false,error:"Not authorized"}); return false; } return true; }

// YouTube OAuth connection endpoints
app.get("/api/youtube/auth", requireAuth, async (req, res) => {
  try {
    const cfg = youtubeConfig();
    if (!cfg.clientId || !cfg.clientSecret || !cfg.stateSecret) return res.status(503).json({ ok:false, success:false, error:"YouTube OAuth is not configured on the server" });
    const state = youtubeStateToken(req.user.userId);
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: "https://www.googleapis.com/auth/youtube",
      state
    });
    res.json({ ok:true, success:true, authorizationUrl:`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  } catch (e) { res.status(500).json({ ok:false, success:false, error:e.message }); }
});

app.get("/api/youtube/callback", async (req, res) => {
  try {
    const state = verifyYoutubeState(req.query?.state);
    if (!state) return res.status(400).send("Invalid or expired YouTube OAuth state. Please start again from Cric Yuva.");
    if (req.query?.error) return res.status(400).send(`YouTube authorization was not completed: ${String(req.query.error)}`);
    const code = String(req.query?.code || "").trim();
    if (!code) return res.status(400).send("Missing YouTube authorization code.");
    const cfg = youtubeConfig();
    if (!cfg.clientId || !cfg.clientSecret) return res.status(503).send("YouTube OAuth is not configured on the server.");
    const token = await formPost("https://oauth2.googleapis.com/token", {
      code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type:"authorization_code"
    });
    if (!token.access_token) throw new Error("Google did not return an access token");
    const channel = await httpsJsonRequest("GET", "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", null, { Authorization:`Bearer ${token.access_token}` });
    const item = channel?.items?.[0];
    const sql = await getDatabase();
    const now = nowMs();
    const refresh = token.refresh_token ? encryptYoutubeSecret(token.refresh_token) : null;
    const access = encryptYoutubeSecret(token.access_token);
    await sql`INSERT INTO youtube_connections(user_id,channel_id,channel_title,access_token_enc,refresh_token_enc,token_expiry,scope,created_at,updated_at)
      VALUES(${state.userId},${item?.id || null},${item?.snippet?.title || null},${access},${refresh},${now + Number(token.expires_in || 3600)*1000},${token.scope || null},${now},${now})
      ON CONFLICT(user_id) DO UPDATE SET channel_id=EXCLUDED.channel_id,channel_title=EXCLUDED.channel_title,access_token_enc=EXCLUDED.access_token_enc,refresh_token_enc=COALESCE(EXCLUDED.refresh_token_enc,youtube_connections.refresh_token_enc),token_expiry=EXCLUDED.token_expiry,scope=EXCLUDED.scope,updated_at=EXCLUDED.updated_at`;
    res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cric Yuva YouTube</title></head><body style="font-family:Arial;padding:30px;text-align:center"><h2>✅ YouTube connected</h2><p>${String(item?.snippet?.title || "Your YouTube channel").replace(/[<>]/g, "")}</p><p>You can close this window and return to Cric Yuva.</p><script>setTimeout(()=>window.close(),1200)</script></body></html>`);
  } catch (e) { console.error("YouTube OAuth callback error:", e); res.status(500).send("YouTube connection failed. Please return to Cric Yuva and try again."); }
});

app.get("/api/youtube/status", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const rows = await sql`SELECT channel_id,channel_title,token_expiry,scope,updated_at FROM youtube_connections WHERE user_id=${req.user.userId} LIMIT 1`;
    res.json({ ok:true, success:true, connected:rows.length>0, connection:rows[0] || null });
  } catch(e) { res.status(500).json({ok:false,success:false,error:e.message}); }
});

app.post("/api/youtube/live/create", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const matchId = String(req.body?.matchId || "").trim();
    if (!matchId) return res.status(400).json({ok:false,success:false,error:"Match ID is required"});
    const matchRows = await sql`SELECT match_id,tournament_id,title,data_json FROM matches WHERE match_id=${matchId} LIMIT 1`;
    const match = matchRows[0] || null;
    const data = match?.data_json || {};
    const title = String(req.body?.title || data.title || match?.title || `Cric Yuva Live — ${matchId}`).trim().slice(0,100);
    const description = String(req.body?.description || data.description || `Live cricket match ${matchId} on Cric Yuva.`).trim().slice(0,5000);
    const privacyStatus = ["public","unlisted","private"].includes(String(req.body?.privacyStatus)) ? String(req.body.privacyStatus) : "unlisted";
    const scheduledStartTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    const broadcast = await youtubeApiRequest(sql, req.user.userId, "POST",
      "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails",
      {
        snippet: { title, description, scheduledStartTime, categoryId: "17" },
        status: { privacyStatus, selfDeclaredMadeForKids: false },
        contentDetails: { enableAutoStart: true, enableAutoStop: true, enableDvr: true, recordFromStart: true, enableEmbed: true }
      });

    const stream = await youtubeApiRequest(sql, req.user.userId, "POST",
      "https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn,contentDetails,status",
      {
        snippet: { title: `${title} — Cric Yuva Stream` },
        cdn: { frameRate: "30fps", ingestionType: "rtmp", resolution: "720p" },
        contentDetails: { isReusable: true }
      });

    await youtubeApiRequest(sql, req.user.userId, "POST",
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?part=id,snippet,contentDetails,status&id=${encodeURIComponent(broadcast.id)}&streamId=${encodeURIComponent(stream.id)}`,
      null);

    const youtubeLiveUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(broadcast.id)}`;
    const ingestion = stream?.cdn?.ingestionInfo || {};
    const merged = {...data, youtubeLiveUrl, youtubeBroadcastId:broadcast.id, youtubeStreamId:stream.id, youtubeCreatedAt:nowMs()};
    if (match) await sql`UPDATE matches SET data_json=${JSON.stringify(merged)}::jsonb, updated_at=${nowMs()} WHERE match_id=${matchId}`;

    res.json({ok:true,success:true,matchId,broadcastId:broadcast.id,streamId:stream.id,youtubeLiveUrl,privacyStatus,title,
      ingestionAddress:ingestion.ingestionAddress || null,streamName:ingestion.streamName || null,streamKey:ingestion.streamName || null,
      broadcastStatus:broadcast.status || null,streamStatus:stream.status || null});
  } catch (e) {
    console.error("YouTube live create error:", e);
    res.status(500).json({ok:false,success:false,error:e.message});
  }
});

app.post("/api/youtube/live/stop", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const broadcastId = String(req.body?.broadcastId || "").trim();
    if (!broadcastId) return res.status(400).json({ok:false,success:false,error:"Broadcast ID is required"});
    const out = await youtubeApiRequest(sql, req.user.userId, "POST",
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/transition?broadcastStatus=complete&id=${encodeURIComponent(broadcastId)}&part=id,status`, null);
    res.json({ok:true,success:true,broadcast:out});
  } catch (e) {
    console.error("YouTube live stop error:", e);
    res.status(500).json({ok:false,success:false,error:e.message});
  }
});

app.post("/api/youtube/disconnect", requireAuth, async (req, res) => {
  try { const sql=await getDatabase(); await sql`DELETE FROM youtube_connections WHERE user_id=${req.user.userId}`; res.json({ok:true,success:true,connected:false}); }
  catch(e){ res.status(500).json({ok:false,success:false,error:e.message}); }
});

// Compatibility: original UI join/request/chat/stream APIs
app.get("/api/join-requests", requireAuth, async (req,res)=>{ try { const sql=await getDatabase(); const rows=await sql`SELECT * FROM join_requests WHERE requester_id=${req.user.userId} OR (kind='TEAM' AND target_id IN (SELECT team_id FROM teams WHERE user_id=${req.user.userId})) OR (kind='TOURNAMENT' AND target_id IN (SELECT tournament_id FROM tournaments WHERE user_id=${req.user.userId})) ORDER BY id DESC LIMIT 200`; res.json({ok:true,success:true,requests:rows}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/join/team", requireAuth, async (req,res)=>{try{const sql=await getDatabase(); const teamId=String(req.body?.teamId||req.body?.teamName||"").trim(); const rows=await sql`SELECT team_id,name FROM teams WHERE team_id=${teamId} OR lower(name)=lower(${teamId}) LIMIT 1`; if(!rows.length)return res.status(404).json({ok:false,error:"Team not found"}); const r=await sql`INSERT INTO join_requests(kind,target_id,requester_id,status,created_at) VALUES('TEAM',${rows[0].team_id},${req.user.userId},'PENDING',${nowMs()}) RETURNING *`; res.json({ok:true,success:true,status:"PENDING",request:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/join/tournament", requireAuth, async (req,res)=>{try{const sql=await getDatabase(); const key=String(req.body?.tournamentId||req.body?.tournamentName||"").trim(); const rows=await sql`SELECT tournament_id,name FROM tournaments WHERE tournament_id=${key} OR lower(name)=lower(${key}) LIMIT 1`; if(!rows.length)return res.status(404).json({ok:false,error:"Tournament not found"}); const r=await sql`INSERT INTO join_requests(kind,target_id,requester_id,status,created_at) VALUES('TOURNAMENT',${rows[0].tournament_id},${req.user.userId},'PENDING',${nowMs()}) RETURNING *`; res.json({ok:true,success:true,status:"PENDING",request:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/player/request", requireAuth, async (req,res)=>{try{const sql=await getDatabase(); const pid=String(req.body?.playerId||"").trim(); if(!pid)return res.status(400).json({ok:false,error:"Player ID required"}); const p=await sql`SELECT player_id FROM players WHERE player_id=${pid} LIMIT 1`; if(!p.length)return res.status(404).json({ok:false,error:"Player not found"}); const r=await sql`INSERT INTO player_requests(player_id,requester_id,status,created_at) VALUES(${pid},${req.user.userId},'PENDING',${nowMs()}) RETURNING *`; res.json({ok:true,success:true,status:"PENDING",request:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
async function canChatInTournament(sql, req, tournamentId) {
  if (req.admin || req.user?.role === "admin") return true;
  const t = await sql`SELECT user_id FROM tournaments WHERE tournament_id=${tournamentId} LIMIT 1`;
  if (!t.length) return false;
  if (t[0].user_id && t[0].user_id === req.user.userId) return true;
  const member = await sql`SELECT 1 FROM tournament_players tp JOIN players p ON p.player_id=tp.player_id WHERE tp.tournament_id=${tournamentId} AND p.user_id=${req.user.userId} LIMIT 1`;
  return member.length > 0;
}

async function canChatInTeam(sql, req, tournamentId, teamName) {
  if (req.admin || req.user?.role === "admin") return true;
  const t = await sql`SELECT user_id FROM tournaments WHERE tournament_id=${tournamentId} LIMIT 1`;
  if (t.length && t[0].user_id === req.user.userId) return true;
  const rows = await sql`SELECT 1 FROM tournament_players tp JOIN players p ON p.player_id=tp.player_id JOIN teams tm ON tm.team_id=tp.team_id WHERE tp.tournament_id=${tournamentId} AND lower(tm.name)=lower(${teamName}) AND p.user_id=${req.user.userId} LIMIT 1`;
  return rows.length > 0;
}

async function canChatInAuction(sql, req, tournamentId) {
  // Auction chat is restricted to players who are actually in this auction pool.
  // Admin/tournament owner remain allowed for moderation/management.
  if (req.admin || req.user?.role === "admin") return true;
  const t = await sql`SELECT user_id,data_json FROM tournaments WHERE tournament_id=${tournamentId} LIMIT 1`;
  if (!t.length) return false;
  if (t[0].user_id === req.user.userId) return true;
  if (!req.user?.playerId) return false;
  const inPool = await sql`
    SELECT 1
    FROM jsonb_array_elements(COALESCE(tournaments.data_json->'auction'->'pool','[]'::jsonb)) AS item
    WHERE (item->>'id')=${req.user.playerId}
       OR (item->>'playerId')=${req.user.playerId}
    LIMIT 1`;
  return inPool.length > 0;
}

app.get("/api/chat/tournament/:tournamentId", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const tid=String(req.params.tournamentId);if(!(await canChatInTournament(sql,req,tid)))return res.status(403).json({ok:false,error:"Only registered tournament players can enter this chat"});const rows=await sql`SELECT sender_id AS "userId",sender_name AS "senderName",message,created_at AS "timestamp" FROM chats WHERE room_type='TOURNAMENT' AND room_id=${tid} ORDER BY id DESC LIMIT 100`;res.json({ok:true,success:true,messages:rows.reverse()});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/chat/tournament/:tournamentId", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const tid=String(req.params.tournamentId);if(!(await canChatInTournament(sql,req,tid)))return res.status(403).json({ok:false,error:"Only registered tournament players can chat"});const message=String(req.body?.message||"").trim().slice(0,2000);if(!message)return res.status(400).json({ok:false,error:"Invalid chat message"});const r=await sql`INSERT INTO chats(room_type,room_id,sender_id,sender_name,message,created_at) VALUES('TOURNAMENT',${tid},${req.user.userId},${req.user.name},${message},${nowMs()}) RETURNING id,sender_id AS "userId",sender_name AS "senderName",message,created_at AS "timestamp"`;broadcastRoom('TOURNAMENT',tid,{type:'TOURNAMENT_CHAT_MESSAGE',message:r[0],tourneyId:tid});res.json({ok:true,success:true,message:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/chat/:roomType/:roomId", requireAuth, async(req,res)=>{try{const sql=await getDatabase(); const type=String(req.params.roomType).toUpperCase(); if(!["TEAM","TOURNAMENT","DIRECT","GROUP"].includes(type))return res.status(400).json({ok:false,error:"Invalid room"}); const rows=await sql`SELECT sender_id AS "userId",sender_name AS "senderName",message,created_at AS "timestamp" FROM chats WHERE room_type=${type} AND room_id=${req.params.roomId} ORDER BY id DESC LIMIT 100`; res.json({ok:true,success:true,messages:rows.reverse()});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/chat/:roomType/:roomId", requireAuth, async(req,res)=>{try{const sql=await getDatabase(); const type=String(req.params.roomType).toUpperCase(); const message=String(req.body?.message||"").trim().slice(0,2000); if(!message||!["TEAM","TOURNAMENT","DIRECT","GROUP"].includes(type))return res.status(400).json({ok:false,error:"Invalid chat message"}); const r=await sql`INSERT INTO chats(room_type,room_id,sender_id,sender_name,message,created_at) VALUES(${type},${req.params.roomId},${req.user.userId},${req.user.name},${message},${nowMs()}) RETURNING id,sender_id AS "userId",sender_name AS "senderName",message,created_at AS "timestamp"`; broadcastRoom(type,req.params.roomId,{type:type+"_CHAT_MESSAGE",message:r[0]}); res.json({ok:true,success:true,message:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});

app.get("/api/chat/auction/:tournamentId", requireAuth, async(req,res)=>{try{const sql=await getDatabase(); const tid=String(req.params.tournamentId); if(!(await canChatInAuction(sql,req,tid))) return res.status(403).json({ok:false,error:"Only registered auction/tournament players can enter this chat"}); const rows=await sql`SELECT sender_id AS "userId",sender_name AS "senderName",message,created_at AS "timestamp" FROM chats WHERE room_type='AUCTION' AND room_id=${tid} ORDER BY id DESC LIMIT 100`; res.json({ok:true,success:true,messages:rows.reverse()});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/chat/auction/:tournamentId", requireAuth, async(req,res)=>{try{const sql=await getDatabase(); const tid=String(req.params.tournamentId); if(!(await canChatInAuction(sql,req,tid))) return res.status(403).json({ok:false,error:"Only registered auction/tournament players can chat"}); const message=String(req.body?.message||"").trim().slice(0,2000); if(!message)return res.status(400).json({ok:false,error:"Invalid chat message"}); const r=await sql`INSERT INTO chats(room_type,room_id,sender_id,sender_name,message,created_at) VALUES('AUCTION',${tid},${req.user.userId},${req.user.name},${message},${nowMs()}) RETURNING id,sender_id AS "userId",sender_name AS "senderName",message,created_at AS "timestamp"`; broadcastRoom('AUCTION',tid,{type:'AUCTION_CHAT_MESSAGE',message:r[0],tourneyId:tid}); res.json({ok:true,success:true,message:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/chat/team/:tournamentId/:teamName", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const tid=String(req.params.tournamentId);const teamName=decodeURIComponent(req.params.teamName);if(!(await canChatInTeam(sql,req,tid,teamName)))return res.status(403).json({ok:false,error:"Only players of this team can chat"});const roomId=`${tid}:${teamName}`;const message=String(req.body?.message||"").trim().slice(0,2000);if(!message)return res.status(400).json({ok:false,error:"Invalid chat message"});const r=await sql`INSERT INTO chats(room_type,room_id,sender_id,sender_name,message,created_at) VALUES('TEAM',${roomId},${req.user.userId},${req.user.name},${message},${nowMs()}) RETURNING id,sender_id AS "userId",sender_name AS "senderName",message,created_at AS "timestamp"`;broadcastRoom('TEAM',roomId,{type:'TEAM_CHAT_MESSAGE',message:r[0],teamId:roomId,tourneyId:tid});res.json({ok:true,success:true,message:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/chat/team/:tournamentId/:teamName", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const tid=String(req.params.tournamentId);const teamName=decodeURIComponent(req.params.teamName);if(!(await canChatInTeam(sql,req,tid,teamName)))return res.status(403).json({ok:false,error:"Only players of this team can enter this chat"});const roomId=`${tid}:${teamName}`;const rows=await sql`SELECT sender_id AS "userId",sender_name AS "senderName",message,created_at AS "timestamp" FROM chats WHERE room_type='TEAM' AND room_id=${roomId} ORDER BY id DESC LIMIT 100`;res.json({ok:true,success:true,messages:rows.reverse()});}catch(e){res.status(500).json({ok:false,error:e.message});}});

app.post("/api/live/stream/authorize", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const matchId=String(req.body?.matchId||"").trim();if(!matchId)return res.status(400).json({ok:false,error:"Match ID required"});const exists=await sql`SELECT match_id FROM matches WHERE match_id=${matchId} LIMIT 1`;if(!exists.length){await sql`INSERT INTO matches(match_id,user_id,tournament_id,status,data_json,created_at,updated_at) VALUES(${matchId},${req.user.userId},${req.body?.tournamentId||null},'live','{}'::jsonb,${nowMs()},${nowMs()})`;}await sql`INSERT INTO streams(match_id,tournament_id,started_by,camera_id,status,data_json,started_at) VALUES(${matchId},${req.body?.tournamentId||null},${req.user.userId},${req.body?.cameraSlot||null},'live',${JSON.stringify({destinations:req.body?.destinations||[]})}::jsonb,${nowMs()}) ON CONFLICT(match_id) DO UPDATE SET status='live',started_by=EXCLUDED.started_by,started_at=EXCLUDED.started_at,data_json=EXCLUDED.data_json`;await audit(sql,req,"STREAM_START","MATCH",matchId);res.json({ok:true,success:true,streamActive:true,matchId});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/live/stream/stop", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const matchId=String(req.body?.matchId||"").trim();await sql`UPDATE streams SET status='stopped',stopped_at=${nowMs()} WHERE match_id=${matchId}`;broadcastRoom("MATCH",matchId,{type:"STREAM_STOPPED",matchId});res.json({ok:true,success:true});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/live/stream/:matchId", async(req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT * FROM streams WHERE match_id=${req.params.matchId} LIMIT 1`;res.json({ok:true,success:true,streamActive:rows[0]?.status==='live',stream:rows[0]||null});}catch(e){res.status(500).json({ok:false,error:e.message});}});


// Phase 7: tournament-player relation + fixture generation
app.get("/api/tournaments/:tournamentId/players", async (req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT tp.*,p.name,p.jersey_name,p.jersey_number,t.name AS team_name FROM tournament_players tp JOIN players p ON p.player_id=tp.player_id LEFT JOIN teams t ON t.team_id=tp.team_id WHERE tp.tournament_id=${req.params.tournamentId} ORDER BY t.name,p.name`;res.json({ok:true,success:true,players:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/tournaments/:tournamentId/players", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const t=await sql`SELECT * FROM tournaments WHERE tournament_id=${req.params.tournamentId}`;if(!t.length)return res.status(404).json({ok:false,error:"Tournament not found"});if(t[0].user_id&&t[0].user_id!==req.user.userId)return res.status(403).json({ok:false,error:"Forbidden"});const playerId=String(req.body?.playerId||"").trim();if(!playerId)return res.status(400).json({ok:false,error:"playerId required"});const p=await sql`SELECT player_id FROM players WHERE player_id=${playerId}`;if(!p.length)return res.status(404).json({ok:false,error:"Player not found"});const r=await sql`INSERT INTO tournament_players(tournament_id,team_id,player_id,role,created_at) VALUES(${req.params.tournamentId},${req.body?.teamId||null},${playerId},${req.body?.role||null},${nowMs()}) ON CONFLICT(tournament_id,team_id,player_id) DO UPDATE SET role=EXCLUDED.role RETURNING *`;res.json({ok:true,success:true,player:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.delete("/api/tournaments/:tournamentId/players/:playerId", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const t=await sql`SELECT user_id FROM tournaments WHERE tournament_id=${req.params.tournamentId}`;if(!t.length)return res.status(404).json({ok:false,error:"Tournament not found"});if(t[0].user_id&&t[0].user_id!==req.user.userId)return res.status(403).json({ok:false,error:"Forbidden"});await sql`DELETE FROM tournament_players WHERE tournament_id=${req.params.tournamentId} AND player_id=${req.params.playerId}`;res.json({ok:true,success:true});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/tournaments/:tournamentId/generate-fixtures", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const t=await sql`SELECT * FROM tournaments WHERE tournament_id=${req.params.tournamentId}`;if(!t.length)return res.status(404).json({ok:false,error:"Tournament not found"});if(t[0].user_id&&t[0].user_id!==req.user.userId)return res.status(403).json({ok:false,error:"Forbidden"});const teams=await sql`SELECT team_id FROM tournament_teams WHERE tournament_id=${req.params.tournamentId} ORDER BY id`;if(teams.length<2)return res.status(400).json({ok:false,error:"At least 2 teams required"});const created=[];for(let i=0;i<teams.length;i++){for(let j=i+1;j<teams.length;j++){const mid=makeDomainId("CYM");const r=await sql`INSERT INTO matches(match_id,user_id,tournament_id,team_a_id,team_b_id,status,data_json,created_at,updated_at) VALUES(${mid},${req.user.userId},${req.params.tournamentId},${teams[i].team_id},${teams[j].team_id},'scheduled','{}'::jsonb,${nowMs()},${nowMs()}) RETURNING match_id,team_a_id,team_b_id,status`;created.push(r[0]);}}res.status(201).json({ok:true,success:true,count:created.length,matches:created});}catch(e){res.status(500).json({ok:false,error:e.message});}});

// Phase 8: persistent match lifecycle
app.get("/api/matches", async(req,res)=>{try{const sql=await getDatabase();const q=String(req.query.search||"").trim();const rows=await sql`SELECT * FROM matches WHERE (${q}='' OR match_id ILIKE ${'%'+q+'%'} OR status ILIKE ${'%'+q+'%'}) ORDER BY updated_at DESC LIMIT 100`;res.json({ok:true,success:true,matches:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/matches/:matchId", async(req,res)=>{try{const sql=await getDatabase();const r=await sql`SELECT * FROM matches WHERE match_id=${req.params.matchId} LIMIT 1`;if(!r.length)return res.status(404).json({ok:false,error:"Match not found"});const xi=await sql`SELECT mp.*,p.name,p.jersey_name,p.jersey_number FROM match_players mp LEFT JOIN players p ON p.player_id=mp.player_id WHERE mp.match_id=${req.params.matchId} ORDER BY mp.team_id,mp.position_no`;res.json({ok:true,success:true,match:r[0],playingXI:xi});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/matches", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const b=req.body||{};const matchId=makeDomainId("CYM");const t= b.tournamentId||null; if(t){const tr=await sql`SELECT tournament_id FROM tournaments WHERE tournament_id=${t}`;if(!tr.length)return res.status(400).json({ok:false,error:"Tournament not found"});}const r=await sql`INSERT INTO matches(match_id,user_id,tournament_id,team_a_id,team_b_id,status,venue,scheduled_at,data_json,created_at,updated_at) VALUES(${matchId},${req.user.userId},${t},${b.teamAId||null},${b.teamBId||null},${b.status||'scheduled'},${b.venue||null},${b.scheduledAt||null},${JSON.stringify(b)}::jsonb,${nowMs()},${nowMs()}) RETURNING *`;await audit(sql,req,"MATCH_CREATE","MATCH",matchId);res.status(201).json({ok:true,success:true,match:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.put("/api/matches/:matchId", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const b=req.body||{};const r=await sql`SELECT * FROM matches WHERE match_id=${req.params.matchId} LIMIT 1`;if(!ownerOr404(r[0],req,res))return;const payload={...(r[0].data_json||{}),...b};const out=await sql`UPDATE matches SET status=COALESCE(${b.status||null},status),venue=COALESCE(${b.venue||null},venue),scheduled_at=COALESCE(${b.scheduledAt||null},scheduled_at),winner_team_id=COALESCE(${b.winnerTeamId||null},winner_team_id),data_json=${JSON.stringify(payload)}::jsonb,updated_at=${nowMs()} WHERE match_id=${req.params.matchId} RETURNING *`;res.json({ok:true,success:true,match:out[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.delete("/api/matches/:matchId", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const r=await sql`SELECT * FROM matches WHERE match_id=${req.params.matchId} LIMIT 1`;if(!ownerOr404(r[0],req,res))return;await sql`DELETE FROM matches WHERE match_id=${req.params.matchId}`;await audit(sql,req,"MATCH_DELETE","MATCH",req.params.matchId);res.json({ok:true,success:true});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/matches/:matchId/playing-xi", requireAuth, async (req, res) => {
  try {
    const sql = await getDatabase();
    const r = await sql`SELECT * FROM matches WHERE match_id=${req.params.matchId} LIMIT 1`;
    if (!ownerOr404(r[0], req, res)) return;
    const players = Array.isArray(req.body?.players) ? req.body.players : [];
    if (players.length > 11) return res.status(400).json({ok:false,error:"Playing XI cannot exceed 11"});
    const seen = new Set();
    for (const x of players) {
      const pid = String(x?.playerId || "").trim();
      if (!pid || seen.has(pid)) return res.status(400).json({ok:false,error:"Playing XI contains missing or duplicate player"});
      seen.add(pid);
      const p = await sql`SELECT player_id FROM players WHERE player_id=${pid} AND is_active IS NOT FALSE LIMIT 1`;
      if (!p.length) return res.status(400).json({ok:false,error:`Player not found: ${pid}`});
      if (x.teamId && ![r[0].team_a_id, r[0].team_b_id].includes(String(x.teamId))) {
        return res.status(400).json({ok:false,error:`Player team is not part of this match: ${x.teamId}`});
      }
    }
    await sql`DELETE FROM match_players WHERE match_id=${req.params.matchId}`;
    for (let i=0;i<players.length;i++) {
      const x=players[i];
      await sql`INSERT INTO match_players(match_id,team_id,player_id,playing_xi,captain,wicketkeeper,position_no,created_at)
        VALUES(${req.params.matchId},${x.teamId||null},${x.playerId},TRUE,${!!x.captain},${!!x.wicketkeeper},${i+1},${nowMs()})`;
    }
    await audit(sql, req, "PLAYING_XI_UPDATE", "MATCH", req.params.matchId);
    res.json({ok:true,success:true,count:players.length});
  } catch(e) { res.status(500).json({ok:false,error:e.message}); }
});
app.post("/api/matches/:matchId/innings", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const m=await sql`SELECT * FROM matches WHERE match_id=${req.params.matchId}`;if(!m.length)return res.status(404).json({ok:false,error:"Match not found"});if(!ownerOr404(m[0],req,res))return;const n=Number(req.body?.inningsNo||1);if(n<1||n>4)return res.status(400).json({ok:false,error:"Invalid innings number"});const inningsId=makeDomainId("CYI");const r=await sql`INSERT INTO innings(innings_id,match_id,innings_no,batting_team_id,target_runs,data_json,created_at,updated_at) VALUES(${inningsId},${req.params.matchId},${n},${req.body?.battingTeamId||null},${req.body?.targetRuns||null},${JSON.stringify(req.body||{})}::jsonb,${nowMs()},${nowMs()}) ON CONFLICT(match_id,innings_no) DO UPDATE SET updated_at=EXCLUDED.updated_at RETURNING *`;res.status(201).json({ok:true,success:true,innings:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/innings/:inningsId/balls", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const i=await sql`SELECT i.*,m.user_id,m.tournament_id FROM innings i JOIN matches m ON m.match_id=i.match_id WHERE i.innings_id=${req.params.inningsId}`;if(!i.length)return res.status(404).json({ok:false,error:"Innings not found"});if(!ownerOr404(i[0],req,res))return;const d=req.body||{};const legal=!d.wide&&!d.noBall;const ballNo=Number(d.ballNo||0);const overNo=Number(d.overNo||0);if(!Number.isInteger(ballNo)||!Number.isInteger(overNo)||overNo<0||ballNo<0||ballNo>5)return res.status(400).json({ok:false,error:"Invalid ball position (ballNo must be 0-5)"});const bid=makeDomainId("CYB");const runs=Math.max(0,Number(d.runs||0));const extras=Math.max(0,Number(d.extras||0));const r=await sql`INSERT INTO balls(ball_id,innings_id,over_no,ball_no,batter_id,bowler_id,runs,extras,wide,no_ball,bye,leg_bye,wicket,dismissal,data_json,created_at) VALUES(${bid},${req.params.inningsId},${overNo},${ballNo},${d.batterId||null},${d.bowlerId||null},${runs},${extras},${!!d.wide},${!!d.noBall},${!!d.bye},${!!d.legBye},${!!d.wicket},${d.dismissal||null},${JSON.stringify(d)}::jsonb,${nowMs()}) RETURNING *`;const legalCount=await sql`SELECT COUNT(*)::int AS c,COALESCE(SUM(runs+extras),0)::int AS runs,COUNT(*) FILTER(WHERE wicket)::int AS wickets FROM balls WHERE innings_id=${req.params.inningsId}`;const lc=legalCount[0];await sql`UPDATE innings SET runs=${lc.runs},wickets=${lc.wickets},legal_balls=(SELECT COUNT(*) FROM balls WHERE innings_id=${req.params.inningsId} AND wide=FALSE AND no_ball=FALSE),updated_at=${nowMs()} WHERE innings_id=${req.params.inningsId}`;broadcastMatch(i[0].match_id,{type:"BALL_UPDATE",matchId:i[0].match_id,inningsId:req.params.inningsId,ball:r[0]});res.status(201).json({ok:true,success:true,ball:r[0],summary:lc});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/innings/:inningsId/balls", async(req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT * FROM balls WHERE innings_id=${req.params.inningsId} ORDER BY over_no,ball_no,created_at`;res.json({ok:true,success:true,balls:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});
// Ball delete is implemented once below with ownership, recalculation, broadcast and audit logging.

// Phase 10: verified stats from central ball data
app.get("/api/stats/player/:playerId", async(req,res)=>{try{const sql=await getDatabase();const p=await sql`SELECT player_id,name FROM players WHERE player_id=${req.params.playerId}`;if(!p.length)return res.status(404).json({ok:false,error:"Player not found"});const bat=await sql`SELECT COALESCE(SUM(runs),0)::int AS runs,COUNT(*) FILTER(WHERE wide=FALSE AND no_ball=FALSE)::int AS balls FROM balls WHERE batter_id=${req.params.playerId}`;const bowl=await sql`SELECT COALESCE(SUM(runs+extras),0)::int AS conceded,COUNT(*) FILTER(WHERE wide=FALSE AND no_ball=FALSE)::int AS legal_balls,COUNT(*) FILTER(WHERE wicket=TRUE)::int AS wickets FROM balls WHERE bowler_id=${req.params.playerId}`;res.json({ok:true,success:true,player:p[0],batting:bat[0],bowling:bowl[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/stats/tournament/:tournamentId", async(req,res)=>{try{const sql=await getDatabase();const rows=await sql`WITH match_balls AS (SELECT b.* FROM balls b JOIN innings i ON i.innings_id=b.innings_id JOIN matches m ON m.match_id=i.match_id WHERE m.tournament_id=${req.params.tournamentId}), bat AS (SELECT batter_id AS player_id,COALESCE(SUM(runs),0)::int AS runs,COUNT(*) FILTER(WHERE wide=FALSE AND no_ball=FALSE)::int AS balls FROM match_balls WHERE batter_id IS NOT NULL GROUP BY batter_id), bowl AS (SELECT bowler_id AS player_id,COALESCE(SUM(runs+extras),0)::int AS conceded,COUNT(*) FILTER(WHERE wide=FALSE AND no_ball=FALSE)::int AS legal_balls,COUNT(*) FILTER(WHERE wicket=TRUE)::int AS wickets FROM match_balls WHERE bowler_id IS NOT NULL GROUP BY bowler_id) SELECT p.player_id,p.name,COALESCE(bat.runs,0)::int AS runs,COALESCE(bat.balls,0)::int AS balls,COALESCE(bowl.conceded,0)::int AS conceded,COALESCE(bowl.legal_balls,0)::int AS legal_balls,COALESCE(bowl.wickets,0)::int AS wickets FROM players p LEFT JOIN bat ON bat.player_id=p.player_id LEFT JOIN bowl ON bowl.player_id=p.player_id WHERE bat.player_id IS NOT NULL OR bowl.player_id IS NOT NULL ORDER BY runs DESC,wickets DESC LIMIT 200`;res.json({ok:true,success:true,stats:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});

// Phase 11: friends + direct/group social
app.get("/api/friends", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT f.friend_user_id AS "userId",u.name,u.mobile,u.player_id AS "playerId" FROM friendships f JOIN users u ON u.user_id=f.friend_user_id WHERE f.user_id=${req.user.userId} AND f.status='ACCEPTED' ORDER BY u.name`;res.json({ok:true,success:true,friends:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/friends/requests", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT fr.id,fr.from_user_id AS "fromUserId",u.name,u.mobile,u.player_id AS "playerId",fr.status,fr.created_at AS "createdAt" FROM friend_requests fr JOIN users u ON u.user_id=fr.from_user_id WHERE fr.to_user_id=${req.user.userId} ORDER BY fr.id DESC`;res.json({ok:true,success:true,requests:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/friends/request", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const to=String(req.body?.userId||req.body?.playerId||"").trim();const u=await sql`SELECT user_id FROM users WHERE user_id=${to} OR player_id=${to} OR mobile=${to} LIMIT 1`;if(!u.length||u[0].user_id===req.user.userId)return res.status(400).json({ok:false,error:"Invalid friend target"});const r=await sql`INSERT INTO friend_requests(from_user_id,to_user_id,status,created_at) VALUES(${req.user.userId},${u[0].user_id},'PENDING',${nowMs()}) ON CONFLICT(from_user_id,to_user_id) DO UPDATE SET status='PENDING' RETURNING *`;res.json({ok:true,success:true,request:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/friends/requests/:id/accept", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const r=await sql`SELECT * FROM friend_requests WHERE id=${req.params.id} AND to_user_id=${req.user.userId} LIMIT 1`;if(!r.length)return res.status(404).json({ok:false,error:"Request not found"});await sql`UPDATE friend_requests SET status='ACCEPTED' WHERE id=${req.params.id}`;await sql`INSERT INTO friendships(user_id,friend_user_id,status,created_at) VALUES(${req.user.userId},${r[0].from_user_id},'ACCEPTED',${nowMs()}),(${r[0].from_user_id},${req.user.userId},'ACCEPTED',${nowMs()}) ON CONFLICT DO NOTHING`;res.json({ok:true,success:true});}catch(e){res.status(500).json({ok:false,error:e.message});}});

// Phase 12: admin roles/permissions
async function requireAdmin(req,res,next){try{const sql=await getDatabase();const a=await sql`SELECT * FROM admins WHERE user_id=${req.user?.userId||''} AND enabled=TRUE LIMIT 1`;if(!a.length)return res.status(403).json({ok:false,error:"Admin permission required"});req.admin=a[0];next();}catch(e){res.status(500).json({ok:false,error:e.message});}}
app.get("/api/admin/me", requireAuth, requireAdmin, async(req,res)=>res.json({ok:true,success:true,admin:req.admin}));
app.post("/api/admin/bootstrap", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const allowed=process.env.ADMIN_BOOTSTRAP_MOBILE&&req.user.mobile===process.env.ADMIN_BOOTSTRAP_MOBILE;if(!allowed)return res.status(403).json({ok:false,error:"Admin bootstrap disabled"});const r=await sql`INSERT INTO admins(user_id,role,permissions,enabled,created_at) VALUES(${req.user.userId},${req.body?.role||'SUPER_ADMIN'},${JSON.stringify(req.body?.permissions||{all:true})}::jsonb,TRUE,${nowMs()}) ON CONFLICT(user_id) DO UPDATE SET enabled=TRUE,role=EXCLUDED.role,permissions=EXCLUDED.permissions RETURNING *`;res.json({ok:true,success:true,admin:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/admin/audit", requireAuth, requireAdmin, async(req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500`;res.json({ok:true,success:true,logs:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});

// Phase 13/14: public live + broadcast metadata
app.get("/api/live/public/:matchId", async(req,res)=>{try{const sql=await getDatabase();const r=await sql`SELECT * FROM matches WHERE match_id=${req.params.matchId} LIMIT 1`;if(!r.length)return res.status(404).json({ok:false,error:"Match not found"});const inn=await sql`SELECT * FROM innings WHERE match_id=${req.params.matchId} ORDER BY innings_no`;res.json({ok:true,success:true,match:r[0],innings:inn});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/broadcast/destinations", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const r=await sql`INSERT INTO broadcast_destinations(match_id,destination_type,target,status,created_at) VALUES(${req.body?.matchId},${req.body?.type||'WEB'},${req.body?.target||null},'READY',${nowMs()}) RETURNING *`;res.json({ok:true,success:true,destination:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});


// Phase 7/8/9 extensions: grounds, scorer assignment, points/NRR and knockout helpers
app.get("/api/tournaments/:tournamentId/grounds", async (req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT * FROM grounds WHERE tournament_id=${req.params.tournamentId} ORDER BY name`;res.json({ok:true,success:true,grounds:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/tournaments/:tournamentId/grounds", requireAuth, async (req,res)=>{try{const sql=await getDatabase();const t=await sql`SELECT * FROM tournaments WHERE tournament_id=${req.params.tournamentId} LIMIT 1`;if(!t.length)return res.status(404).json({ok:false,error:"Tournament not found"});if(!req.admin && t[0].user_id && t[0].user_id!==req.user.userId)return res.status(403).json({ok:false,error:"Forbidden"});const name=String(req.body?.name||"").trim();if(!name)return res.status(400).json({ok:false,error:"Ground name required"});const gid=makeDomainId("CYG");const r=await sql`INSERT INTO grounds(ground_id,tournament_id,name,location,map_url,capacity,data_json,created_at,updated_at) VALUES(${gid},${req.params.tournamentId},${name},${req.body?.location||null},${req.body?.mapUrl||null},${req.body?.capacity?Number(req.body.capacity):null},${JSON.stringify(req.body||{})}::jsonb,${nowMs()},${nowMs()}) RETURNING *`;res.status(201).json({ok:true,success:true,ground:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/matches/:matchId/scorers", requireAuth, async (req,res)=>{try{const sql=await getDatabase();const m=await sql`SELECT * FROM matches WHERE match_id=${req.params.matchId} LIMIT 1`;if(!ownerOr404(m[0],req,res))return;const uid=String(req.body?.userId||"").trim();const role=String(req.body?.role||"SCORER").toUpperCase();if(!uid||!['SCORER','UMPIRE','COMMENTATOR'].includes(role))return res.status(400).json({ok:false,error:"userId and valid role required"});const u=await sql`SELECT user_id FROM users WHERE user_id=${uid} LIMIT 1`;if(!u.length)return res.status(404).json({ok:false,error:"User not found"});const r=await sql`INSERT INTO match_officials(match_id,user_id,role,enabled,created_at) VALUES(${req.params.matchId},${uid},${role},TRUE,${nowMs()}) ON CONFLICT(match_id,user_id,role) DO UPDATE SET enabled=TRUE RETURNING *`;res.status(201).json({ok:true,success:true,official:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/matches/:matchId/scorers", async (req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT mo.*,u.name,u.mobile FROM match_officials mo JOIN users u ON u.user_id=mo.user_id WHERE mo.match_id=${req.params.matchId} AND mo.enabled=TRUE ORDER BY mo.role,u.name`;res.json({ok:true,success:true,officials:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});

app.get("/api/tournaments/:tournamentId/points-table", async (req,res)=>{try{const sql=await getDatabase();const teams=await sql`SELECT tt.team_id,tt.group_name,t.name,t.short_name FROM tournament_teams tt JOIN teams t ON t.team_id=tt.team_id WHERE tt.tournament_id=${req.params.tournamentId} ORDER BY tt.group_name NULLS FIRST,t.name`;const matches=await sql`SELECT match_id,team_a_id,team_b_id,status,winner_team_id FROM matches WHERE tournament_id=${req.params.tournamentId} AND status IN ('completed','finished','result','live')`;const rows=teams.map(t=>({teamId:t.team_id,name:t.name,shortName:t.short_name,groupName:t.group_name,matches:0,wins:0,losses:0,ties:0,noResults:0,points:0,runsFor:0,ballsFor:0,runsAgainst:0,ballsAgainst:0}));const by=new Map(rows.map(x=>[x.teamId,x]));for(const m of matches){if(!by.has(m.team_a_id)||!by.has(m.team_b_id))continue;const a=by.get(m.team_a_id),b=by.get(m.team_b_id);a.matches++;b.matches++;if(m.winner_team_id===m.team_a_id){a.wins++;a.points+=2;b.losses++;}else if(m.winner_team_id===m.team_b_id){b.wins++;b.points+=2;a.losses++;}else if(['completed','finished','result'].includes(m.status)){a.ties++;b.ties++;a.points++;b.points++;}}const inn=await sql`SELECT i.batting_team_id,i.runs,i.legal_balls,m.team_a_id,m.team_b_id FROM innings i JOIN matches m ON m.match_id=i.match_id WHERE m.tournament_id=${req.params.tournamentId}`;for(const i of inn){const x=by.get(i.batting_team_id);if(!x)continue;const opp=i.batting_team_id===i.team_a_id?i.team_b_id:i.team_a_id;x.runsFor+=Number(i.runs||0);x.ballsFor+=Number(i.legal_balls||0);const o=by.get(opp);if(o){o.runsAgainst+=Number(i.runs||0);o.ballsAgainst+=Number(i.legal_balls||0);}}for(const x of rows){x.runRate=x.ballsFor?x.runsFor/(x.ballsFor/6):0;x.concededRate=x.ballsAgainst?x.runsAgainst/(x.ballsAgainst/6):0;x.nrr=Number((x.runRate-x.concededRate).toFixed(3));}rows.sort((a,b)=>b.points-a.points||b.nrr-a.nrr||b.wins-a.wins||a.name.localeCompare(b.name));res.json({ok:true,success:true,pointsTable:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});

app.get("/api/tournaments/:tournamentId/knockout", async(req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT match_id,team_a_id,team_b_id,status,winner_team_id,scheduled_at,venue,data_json FROM matches WHERE tournament_id=${req.params.tournamentId} ORDER BY scheduled_at NULLS LAST,created_at`;const completed=rows.filter(m=>['completed','finished','result'].includes(m.status));const next=rows.filter(m=>!completed.includes(m));res.json({ok:true,success:true,fixtures:rows,completed,next});}catch(e){res.status(500).json({ok:false,error:e.message});}});

// Phase 10: reports from the same central match/tournament data (printable HTML/JSON)
app.get("/api/reports/match/:matchId", async(req,res)=>{try{const sql=await getDatabase();const m=await sql`SELECT m.*,a.name AS team_a_name,b.name AS team_b_name FROM matches m LEFT JOIN teams a ON a.team_id=m.team_a_id LEFT JOIN teams b ON b.team_id=m.team_b_id WHERE m.match_id=${req.params.matchId} LIMIT 1`;if(!m.length)return res.status(404).json({ok:false,error:"Match not found"});const innings=await sql`SELECT i.*,t.name AS batting_team_name FROM innings i LEFT JOIN teams t ON t.team_id=i.batting_team_id WHERE i.match_id=${req.params.matchId} ORDER BY innings_no`;const balls=await sql`SELECT b.*,p.name AS batter_name,q.name AS bowler_name FROM balls b LEFT JOIN players p ON p.player_id=b.batter_id LEFT JOIN players q ON q.player_id=b.bowler_id JOIN innings i ON i.innings_id=b.innings_id WHERE i.match_id=${req.params.matchId} ORDER BY i.innings_no,b.over_no,b.ball_no,b.created_at`;if(String(req.query.format||'json').toLowerCase()==='html'){const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let h=`<!doctype html><html><head><meta charset="utf-8"><title>Cric Yuva Match Scorecard</title><style>body{font-family:Arial;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;text-align:left}@media print{button{display:none}}</style></head><body><button onclick="print()">Print / Save PDF</button><h1>${esc(m[0].team_a_name)} vs ${esc(m[0].team_b_name)}</h1><p>Match ID: ${esc(m[0].match_id)} • Status: ${esc(m[0].status)}</p>`;h+=`<h2>Innings</h2><table><tr><th>#</th><th>Batting Team</th><th>Runs</th><th>Wickets</th><th>Legal Balls</th></tr>`+innings.map(i=>`<tr><td>${i.innings_no}</td><td>${esc(i.batting_team_name)}</td><td>${i.runs}</td><td>${i.wickets}</td><td>${i.legal_balls}</td></tr>`).join('')+`</table><h2>Ball History</h2><table><tr><th>Innings</th><th>Over</th><th>Ball</th><th>Batter</th><th>Bowler</th><th>Runs</th><th>Extras</th><th>Wicket</th></tr>`+balls.map(b=>`<tr><td>${b.innings_id}</td><td>${b.over_no}</td><td>${b.ball_no}</td><td>${esc(b.batter_name)}</td><td>${esc(b.bowler_name)}</td><td>${b.runs}</td><td>${b.extras}</td><td>${b.wicket?'Yes':'No'}</td></tr>`).join('')+`</table></body></html>`;return res.type('html').send(h);}res.json({ok:true,success:true,match:m[0],innings,balls});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/reports/tournament/:tournamentId", async(req,res)=>{try{const sql=await getDatabase();const t=await sql`SELECT * FROM tournaments WHERE tournament_id=${req.params.tournamentId} LIMIT 1`;if(!t.length)return res.status(404).json({ok:false,error:"Tournament not found"});const teams=await sql`SELECT tt.*,t.name,t.short_name FROM tournament_teams tt JOIN teams t ON t.team_id=tt.team_id WHERE tt.tournament_id=${req.params.tournamentId} ORDER BY t.name`;const matches=await sql`SELECT * FROM matches WHERE tournament_id=${req.params.tournamentId} ORDER BY scheduled_at NULLS LAST,created_at`;const stats=await sql`WITH mb AS (SELECT b.* FROM balls b JOIN innings i ON i.innings_id=b.innings_id JOIN matches m ON m.match_id=i.match_id WHERE m.tournament_id=${req.params.tournamentId}) SELECT p.player_id,p.name,COALESCE(SUM(mb.runs) FILTER(WHERE mb.batter_id=p.player_id),0)::int AS runs,COALESCE(SUM(mb.runs+mb.extras) FILTER(WHERE mb.bowler_id=p.player_id),0)::int AS conceded,COUNT(*) FILTER(WHERE mb.bowler_id=p.player_id AND mb.wicket)::int AS wickets FROM players p JOIN mb ON mb.batter_id=p.player_id OR mb.bowler_id=p.player_id GROUP BY p.player_id,p.name ORDER BY runs DESC,wickets DESC LIMIT 200`;res.json({ok:true,success:true,tournament:t[0],teams,matches,stats});}catch(e){res.status(500).json({ok:false,error:e.message});}});

// Phase 8/9/10: unified match lifecycle, toss, result, ball correction and awards
async function recalcInnings(sql, inningsId) {
  const rows = await sql`SELECT COALESCE(SUM(runs+extras),0)::int AS runs, COUNT(*) FILTER(WHERE wicket=TRUE)::int AS wickets, COUNT(*) FILTER(WHERE wide=FALSE AND no_ball=FALSE)::int AS legal_balls FROM balls WHERE innings_id=${inningsId}`;
  const r=rows[0];
  const out=await sql`UPDATE innings SET runs=${r.runs},wickets=${r.wickets},legal_balls=${r.legal_balls},updated_at=${nowMs()} WHERE innings_id=${inningsId} RETURNING *`;
  return out[0];
}
app.post("/api/matches/:matchId/toss", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const m=await sql`SELECT * FROM matches WHERE match_id=${req.params.matchId} LIMIT 1`;if(!ownerOr404(m[0],req,res))return;const choice=String(req.body?.choice||'').toUpperCase();if(!['HEADS','TAILS'].includes(choice))return res.status(400).json({ok:false,error:'choice must be HEADS or TAILS'});const result=Math.random()<.5?'HEADS':'TAILS';const winner=choice===result?'A':'B';const decision=String(req.body?.decision||'').toUpperCase();if(decision&&!['BAT','BOWL'].includes(decision))return res.status(400).json({ok:false,error:'decision must be BAT or BOWL'});const payload={...(m[0].data_json||{}),toss:{choice,result,winner,decision,at:nowMs()}};const out=await sql`UPDATE matches SET data_json=${JSON.stringify(payload)}::jsonb,updated_at=${nowMs()} WHERE match_id=${req.params.matchId} RETURNING *`;await audit(sql,req,'TOSS_RECORDED','MATCH',req.params.matchId);res.json({ok:true,success:true,toss:payload.toss,match:out[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/matches/:matchId/result", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const m=await sql`SELECT * FROM matches WHERE match_id=${req.params.matchId} LIMIT 1`;if(!ownerOr404(m[0],req,res))return;const winner=req.body?.winnerTeamId?String(req.body.winnerTeamId):null;const valid=[m[0].team_a_id,m[0].team_b_id,null];if(!valid.includes(winner))return res.status(400).json({ok:false,error:'winnerTeamId must be one of the match teams or null'});const status=String(req.body?.status||'completed').toLowerCase();if(!['completed','finished','result','tie','no_result'].includes(status))return res.status(400).json({ok:false,error:'Invalid result status'});const payload={...(m[0].data_json||{}),result:{winnerTeamId:winner,margin:req.body?.margin||null,status,at:nowMs()}};const out=await sql`UPDATE matches SET winner_team_id=${winner},status=${status},data_json=${JSON.stringify(payload)}::jsonb,updated_at=${nowMs()} WHERE match_id=${req.params.matchId} RETURNING *`;await audit(sql,req,'MATCH_RESULT','MATCH',req.params.matchId);res.json({ok:true,success:true,match:out[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/matches/:matchId/players/substitute", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const m=await sql`SELECT * FROM matches WHERE match_id=${req.params.matchId} LIMIT 1`;if(!ownerOr404(m[0],req,res))return;const pid=String(req.body?.playerId||'').trim();const teamId=String(req.body?.teamId||'').trim();if(!pid||![m[0].team_a_id,m[0].team_b_id].includes(teamId))return res.status(400).json({ok:false,error:'Valid playerId and teamId required'});const p=await sql`SELECT player_id FROM players WHERE player_id=${pid} AND is_active IS NOT FALSE LIMIT 1`;if(!p.length)return res.status(404).json({ok:false,error:'Player not found'});await sql`INSERT INTO match_players(match_id,team_id,player_id,playing_xi,position_no,created_at) VALUES(${req.params.matchId},${teamId},${pid},FALSE,NULL,${nowMs()}) ON CONFLICT(match_id,player_id) DO UPDATE SET team_id=EXCLUDED.team_id`;res.json({ok:true,success:true,substitute:{matchId:req.params.matchId,teamId,playerId:pid}});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.put("/api/balls/:ballId", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const q=await sql`SELECT b.*,i.match_id,m.user_id FROM balls b JOIN innings i ON i.innings_id=b.innings_id JOIN matches m ON m.match_id=i.match_id WHERE b.ball_id=${req.params.ballId} LIMIT 1`;if(!ownerOr404(q[0],req,res))return;const d=req.body||{};const wide=!!d.wide,noBall=!!d.noBall;const runs=Math.max(0,Number(d.runs??q[0].runs));const extras=Math.max(0,Number(d.extras??q[0].extras));const out=await sql`UPDATE balls SET runs=${runs},extras=${extras},wide=${wide},no_ball=${noBall},bye=${!!d.bye},leg_bye=${!!d.legBye},wicket=${!!d.wicket},dismissal=${d.dismissal??q[0].dismissal},batter_id=${d.batterId??q[0].batter_id},bowler_id=${d.bowlerId??q[0].bowler_id},data_json=${JSON.stringify({...((q[0].data_json)||{}),...d})}::jsonb WHERE ball_id=${req.params.ballId} RETURNING *`;const inn=await recalcInnings(sql,q[0].innings_id);broadcastMatch(q[0].match_id,{type:'BALL_EDIT',matchId:q[0].match_id,ball:out[0],innings:inn});await audit(sql,req,'BALL_EDIT','BALL',req.params.ballId);res.json({ok:true,success:true,ball:out[0],innings:inn});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.delete("/api/balls/:ballId", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const q=await sql`SELECT b.*,i.match_id,m.user_id FROM balls b JOIN innings i ON i.innings_id=b.innings_id JOIN matches m ON m.match_id=i.match_id WHERE b.ball_id=${req.params.ballId} LIMIT 1`;if(!ownerOr404(q[0],req,res))return;await sql`DELETE FROM balls WHERE ball_id=${req.params.ballId}`;const inn=await recalcInnings(sql,q[0].innings_id);broadcastMatch(q[0].match_id,{type:'BALL_DELETE',matchId:q[0].match_id,ballId:req.params.ballId,innings:inn});await audit(sql,req,'BALL_DELETE','BALL',req.params.ballId);res.json({ok:true,success:true,innings:inn});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/stats/player/:playerId/fielding", async(req,res)=>{try{const sql=await getDatabase();const r=await sql`SELECT COUNT(*) FILTER(WHERE data_json->>'fielderId'=${req.params.playerId} AND wicket=TRUE)::int AS dismissals,COUNT(*) FILTER(WHERE data_json->>'fielderId'=${req.params.playerId} AND data_json->>'catch'='true')::int AS catches FROM balls`;res.json({ok:true,success:true,fielding:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/tournaments/:tournamentId/awards", async(req,res)=>{try{const sql=await getDatabase();const rows=await sql`WITH mb AS (SELECT b.* FROM balls b JOIN innings i ON i.innings_id=b.innings_id JOIN matches m ON m.match_id=i.match_id WHERE m.tournament_id=${req.params.tournamentId}), bat AS (SELECT batter_id player_id,COALESCE(SUM(runs),0)::int runs,COUNT(*) FILTER(WHERE runs=4)::int fours,COUNT(*) FILTER(WHERE runs=6)::int sixes FROM mb WHERE batter_id IS NOT NULL GROUP BY batter_id), bowl AS (SELECT bowler_id player_id,COUNT(*) FILTER(WHERE wicket=TRUE)::int wickets,COALESCE(SUM(runs+extras),0)::int conceded FROM mb WHERE bowler_id IS NOT NULL GROUP BY bowler_id) SELECT p.player_id,p.name,COALESCE(bat.runs,0)::int runs,COALESCE(bat.fours,0)::int fours,COALESCE(bat.sixes,0)::int sixes,COALESCE(bowl.wickets,0)::int wickets FROM players p LEFT JOIN bat ON bat.player_id=p.player_id LEFT JOIN bowl ON bowl.player_id=p.player_id WHERE bat.player_id IS NOT NULL OR bowl.player_id IS NOT NULL ORDER BY runs DESC,wickets DESC`;res.json({ok:true,success:true,awards:{playerOfTournament:rows[0]||null,bestBatsman:[...rows].sort((a,b)=>b.runs-a.runs)[0]||null,bestBowler:[...rows].sort((a,b)=>b.wickets-a.wickets)[0]||null,mostFours:[...rows].sort((a,b)=>b.fours-a.fours)[0]||null,mostSixes:[...rows].sort((a,b)=>b.sixes-a.sixes)[0]||null},candidates:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});

// Phase 11/12: notifications, highlights and admin dashboard
app.get("/api/notifications", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT * FROM notifications WHERE user_id=${req.user.userId} ORDER BY id DESC LIMIT 100`;res.json({ok:true,success:true,notifications:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/matches/:matchId/highlights", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const m=await sql`SELECT * FROM matches WHERE match_id=${req.params.matchId} LIMIT 1`;if(!ownerOr404(m[0],req,res))return;const type=String(req.body?.type||'MILESTONE').toUpperCase();const r=await sql`INSERT INTO match_highlights(match_id,innings_id,ball_id,highlight_type,title,video_url,timestamp_seconds,data_json,created_at) VALUES(${req.params.matchId},${req.body?.inningsId||null},${req.body?.ballId||null},${type},${req.body?.title||null},${req.body?.videoUrl||null},${req.body?.timestampSeconds!=null?Number(req.body.timestampSeconds):null},${JSON.stringify(req.body||{})}::jsonb,${nowMs()}) RETURNING *`;res.status(201).json({ok:true,success:true,highlight:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/matches/:matchId/highlights", async(req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT * FROM match_highlights WHERE match_id=${req.params.matchId} ORDER BY created_at`;res.json({ok:true,success:true,highlights:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/matches/:matchId/youtube", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const m=await sql`SELECT * FROM matches WHERE match_id=${req.params.matchId} LIMIT 1`;if(!ownerOr404(m[0],req,res))return;const url=String(req.body?.url||'').trim();if(!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url))return res.status(400).json({ok:false,error:'Valid YouTube URL required'});const payload={...(m[0].data_json||{}),youtubeLiveUrl:url};const r=await sql`UPDATE matches SET data_json=${JSON.stringify(payload)}::jsonb,updated_at=${nowMs()} WHERE match_id=${req.params.matchId} RETURNING match_id,data_json`;res.json({ok:true,success:true,match:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/admin/dashboard", requireAuth, requireAdmin, async(req,res)=>{try{const sql=await getDatabase();const tables=['users','players','teams','tournaments','matches','live_matches','subscriptions','join_requests','player_requests','audit_logs'];const counts={};for(const t of tables){const r=await sql.unsafe(`SELECT COUNT(*)::int AS count FROM ${t}`);counts[t]=r[0].count;}const active=await sql`SELECT COUNT(*)::int AS count FROM matches WHERE status='live'`;const subs=await sql`SELECT COUNT(*)::int AS count FROM subscriptions WHERE expires_at>${nowMs()} AND status IN ('TRIAL','ACTIVE')`;res.json({ok:true,success:true,counts,activeMatches:active[0].count,activeSubscriptions:subs[0].count});}catch(e){res.status(500).json({ok:false,error:e.message});}});

// Phase 17: subscription/access model; payment intentionally disabled until final provider credentials are configured
app.get("/api/subscription/plans", async(req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT * FROM plans WHERE active=TRUE ORDER BY amount_paise`;res.json({ok:true,success:true,plans:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/subscription", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const r=await sql`SELECT s.*,p.name AS plan_name,p.amount_paise,p.duration_days FROM subscriptions s JOIN plans p ON p.plan_id=s.plan_id WHERE s.user_id=${req.user.userId} ORDER BY s.expires_at DESC LIMIT 1`;res.json({ok:true,success:true,subscription:r[0]||null,active:!!(r[0]&&Number(r[0].expires_at)>nowMs()&&['TRIAL','ACTIVE'].includes(r[0].status))});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/subscription/checkout", requireAuth, async(req,res)=>{res.status(503).json({ok:false,success:false,error:"Payment provider is intentionally disabled until the final payment phase. No charge was made."});});
app.post("/api/subscription/grant-trial", requireAuth, async(req,res)=>{try{const sql=await getDatabase();const plan=await sql`SELECT * FROM plans WHERE plan_id='FREE_TRIAL' LIMIT 1`;if(!plan.length)return res.status(500).json({ok:false,error:"Trial plan missing"});const existing=await sql`SELECT * FROM subscriptions WHERE user_id=${req.user.userId} AND plan_id='FREE_TRIAL' AND status IN ('TRIAL','ACTIVE') AND expires_at>${nowMs()} LIMIT 1`;if(existing.length)return res.status(409).json({ok:false,error:"Active free trial already exists",subscription:existing[0]});const start=nowMs(),exp=start+Number(plan[0].duration_days)*86400000;const r=await sql`INSERT INTO subscriptions(subscription_id,user_id,plan_id,status,starts_at,expires_at,created_at,updated_at) VALUES(${makeDomainId('CYS')},${req.user.userId},'FREE_TRIAL','TRIAL',${start},${exp},${start},${start}) RETURNING *`;res.json({ok:true,success:true,subscription:r[0]});}catch(e){res.status(500).json({ok:false,error:e.message});}});

// Phase 18: audit + safe backup snapshot endpoint
app.post("/api/security/backup", requireAuth, requireAdmin, async(req,res)=>{try{const sql=await getDatabase();const bid=makeDomainId('CYBK');const started=nowMs();const tables=['users','profiles','players','teams','tournaments','tournament_teams','tournament_players','matches','innings','balls','match_players','friendships','friend_requests','chats','streams','live_matches','subscriptions','awards','notifications'];const snapshot={};for(const t of tables){snapshot[t]=await sql.unsafe(`SELECT * FROM ${t}`);}const checksum=crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');const r=await sql`INSERT INTO backup_runs(backup_id,requested_by,status,started_at,finished_at,location,checksum,data_json) VALUES(${bid},${req.user.userId},'COMPLETED',${started},${nowMs()},'api://security/backup',${checksum},${JSON.stringify({tables,checksum})}::jsonb) RETURNING *`;res.json({ok:true,success:true,backup:r[0],snapshot});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/security/audit", requireAuth, requireAdmin, async(req,res)=>{try{const sql=await getDatabase();const rows=await sql`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500`;res.json({ok:true,success:true,logs:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});

// Phase 19: production readiness
app.get("/api/production/readiness", async(req,res)=>{try{const sql=await getDatabase();const required=['users','sessions','otp_codes','profiles','players','teams','tournaments','matches','innings','balls','friendships','admins','plans','subscriptions','audit_logs'];const checks=[];for(const t of required){try{await sql.unsafe(`SELECT 1 FROM ${t} LIMIT 1`);checks.push({table:t,ok:true});}catch(e){checks.push({table:t,ok:false,error:e.message});}}const ok=checks.every(x=>x.ok);res.status(ok?200:503).json({ok,success:ok,production:{database:ok,checks,environment:{node:process.version,databaseUrlConfigured:!!process.env.DATABASE_URL,paymentConfigured:!!process.env.PAYMENT_PROVIDER_KEY}}});}catch(e){res.status(503).json({ok:false,success:false,error:e.message});}});


// Health check
app.get("/api/health", async (req, res) => {
  try {
    const sql = await getDatabase();
    await sql`SELECT 1 AS alive`;
    res.json({ ok: true, success: true, message: "Cric Yuva Backend & DB healthy" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Database verification endpoint for testing & verification
app.post("/api/debug/verify-db", async (req, res) => {
  try {
    const sql = await getDatabase();
    const { query, params } = req.body || {};
    if (!query || typeof query !== "string") {
      return res.status(400).json({ ok: false, error: "query string required" });
    }
    let rows = [];
    if (typeof sql.unsafe === "function") {
      rows = await sql.unsafe(query.trim(), params || []);
    } else if (typeof sql.exec === "function") {
      rows = await sql.exec(query.trim());
    }
    res.json({ ok: true, success: true, rows: Array.isArray(rows) ? rows : (rows?.rows || []) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// WebSocket attachment
function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/live" });
  wss.on("connection", (ws) => {
    ws.matchId = null;
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === "JOIN_MATCH" && msg.matchId) {
          const mId = String(msg.matchId).trim();
          ws.matchId = mId;
          if (!matchWsClients.has(mId)) matchWsClients.set(mId, new Set());
          matchWsClients.get(mId).add(ws);
          ws.send(JSON.stringify({ type: "JOINED_MATCH", matchId: mId }));
        } else if (msg.type === "JOIN_TEAM" && msg.teamId) {
          const key = roomKey("TEAM", msg.teamId); if (!roomWsClients.has(key)) roomWsClients.set(key, new Set()); roomWsClients.get(key).add(ws); ws.roomKeys = ws.roomKeys || []; if (!ws.roomKeys.includes(key)) ws.roomKeys.push(key);
          ws.send(JSON.stringify({ type: "JOINED_TEAM", teamId: String(msg.teamId) }));
        } else if (msg.type === "JOIN_TOURNAMENT" && msg.tournamentId) {
          const key = roomKey("TOURNAMENT", msg.tournamentId); if (!roomWsClients.has(key)) roomWsClients.set(key, new Set()); roomWsClients.get(key).add(ws); ws.roomKeys = ws.roomKeys || []; if (!ws.roomKeys.includes(key)) ws.roomKeys.push(key);
          ws.send(JSON.stringify({ type: "JOINED_TOURNAMENT", tournamentId: String(msg.tournamentId) }));
        } else if (msg.type === "SUBSCRIBE_CHAT" && msg.room) {
          const raw = String(msg.room);
          const parts = raw.split(":");
          let type = String(parts.shift() || "").toUpperCase();
          let rid = parts.join(":");
          if (["TEAM","TOURNAMENT","AUCTION"].includes(type) && rid) {
            const key = roomKey(type, rid); if (!roomWsClients.has(key)) roomWsClients.set(key, new Set()); roomWsClients.get(key).add(ws); ws.roomKeys = ws.roomKeys || []; if (!ws.roomKeys.includes(key)) ws.roomKeys.push(key);
            ws.send(JSON.stringify({type:"SUBSCRIBED_CHAT",room:raw}));
          }
        } else if ((msg.type === "TEAM_CHAT_MESSAGE" || msg.type === "TOURNAMENT_CHAT_MESSAGE" || msg.type === "AUCTION_CHAT_MESSAGE") && (msg.teamId || msg.tournamentId || msg.tourneyId)) {
          const type = msg.type === "AUCTION_CHAT_MESSAGE" ? "AUCTION" : (msg.teamId ? "TEAM" : "TOURNAMENT"); const rid = type === "TEAM" ? String(msg.teamId) : String(msg.tournamentId || msg.tourneyId); broadcastRoom(type, rid, msg);
        }
      } catch (e) {}
    });
    ws.on("close", () => {
      if (ws.matchId && matchWsClients.has(ws.matchId)) {
        const set = matchWsClients.get(ws.matchId);
        set.delete(ws);
        if (!set.size) matchWsClients.delete(ws.matchId);
      }
      if (Array.isArray(ws.roomKeys)) {
        for (const key of ws.roomKeys) {
          const set = roomWsClients.get(key);
          if (!set) continue;
          set.delete(ws);
          if (!set.size) roomWsClients.delete(key);
        }
      }
    });
  });
  return wss;
}

module.exports = {
  app,
  server,
  attachWebSocket,
  hashPassword,
  verifyPassword
};

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  attachWebSocket(server);
  server.listen(PORT, "0.0.0.0", async () => {
    console.log(`Cric Yuva Backend Server running on port ${PORT}`);
    try {
      await getDatabase();
      console.log("PostgreSQL database initialized successfully");
    } catch (err) {
      console.error("Database connection error:", err.message);
    }
  });
}
