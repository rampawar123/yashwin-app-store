'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 6, 10 & Final Completion — Read-Only Market API + Persistent Paper Trading & Safety Server
 *
 * Strictly enforces:
 * - No browser credentials
 * - ZERO live broker order placement endpoints (/api/order/* returns 404)
 * - Live trading strictly disabled (LIVE_TRADING_ENABLED=false)
 * - Persistent SQLite database integration for paper state, audit trail, emergency stop, backtests
 */

const http = require('http');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const auth = require('./angel-auth-service');
const userAuth = require('./user-auth-service');
const search = require('./angel-instrument-search');
const twelveData = require('./twelve-data-market-data');
const pipeline = require('./market-data-pipeline');
const googleAI = require('./google-ai-service');
const intelService = require('./market-intelligence-service');
const db = require('./database');
const { getConfig, getSafePublicConfig, parseAllowedOrigins, validateProductionEnvironment } = require('./config');

const PaperTrading = require('../web/modules/paper');
const AuditLogger = require('../web/modules/audit-logger');
const RiskEngine = require('../web/modules/risk-engine');
const StrategyEngine = require('../web/modules/strategy-engine');
const Backtester = require('../web/modules/backtester');
const LiveReadinessAudit = require('../web/modules/live-readiness-audit');
const MarketIntelligence = require('../web/modules/market-intelligence');
const PortfolioEngine = require('../web/modules/portfolio-engine');
const OrderTradeHistoryEngine = require('../web/modules/order-trade-history-engine');
const WatchlistAlertEngine = require('../web/modules/watchlist-alert-engine');
const NotificationEngine = require('../web/modules/notification-engine');
const notificationDelivery = require('./notification-delivery-service');

const HOST = process.env.API_HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || process.env.API_PORT || 3000);
const WEB_DIR = path.resolve(__dirname, '../web');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const ALLOWED_DEV_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8787',
  'http://127.0.0.1:8787'
]);

const LOOPBACK_ORIGIN_REGEX = /^http:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}$/i;

function isTrustedProxyEnabled(env = process.env) {
  const raw = String(env.TRUST_PROXY || '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

function isHttpsRequestContext(req, env = process.env) {
  if (req?.socket?.encrypted === true) {
    return true;
  }
  const publicBase = String(env.PUBLIC_BASE_URL || '').trim().toLowerCase();
  if (publicBase.startsWith('https://')) {
    return true;
  }
  if (isTrustedProxyEnabled(env)) {
    const proto = String(req?.headers?.['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (proto === 'https') {
      return true;
    }
  }
  return false;
}

function isTrustedOrigin(req, env = process.env) {
  const origin = String(req?.headers?.origin || '').trim();
  const method = String(req?.method || 'GET').toUpperCase();
  if (!origin) {
    // Non-browser or same-origin requests without Origin header; state-changing requests remain protected by CSRF
    return { trusted: true, allowOriginHeader: null, method };
  }

  const configuredOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);
  if (configuredOrigins.includes(origin)) {
    return { trusted: true, allowOriginHeader: origin };
  }

  const publicBaseUrl = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (publicBaseUrl && origin === publicBaseUrl) {
    return { trusted: true, allowOriginHeader: origin };
  }

  const isProd = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (!isProd) {
    if (ALLOWED_DEV_ORIGINS.has(origin) || LOOPBACK_ORIGIN_REGEX.test(origin)) {
      return { trusted: true, allowOriginHeader: origin };
    }
  } else if (!publicBaseUrl && configuredOrigins.length === 0) {
    // If running locally in production mode without external domain configured, allow strictly local loopback origins only
    if (ALLOWED_DEV_ORIGINS.has(origin) || LOOPBACK_ORIGIN_REGEX.test(origin)) {
      return { trusted: true, allowOriginHeader: origin };
    }
  }

  // Never trust arbitrary client-supplied Host or X-Forwarded-Host headers to dynamically whitelist cross-origin requests.
  return { trusted: false, allowOriginHeader: null };
}

const SECURITY_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': SECURITY_CSP
});

function buildSecurityHeaders(req, env = process.env) {
  const isProd = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (!isProd || !isHttpsRequestContext(req, env)) {
    return SECURITY_HEADERS;
  }
  return {
    ...SECURITY_HEADERS,
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
  };
}

// Per-client API endpoint rate limiting (Task 19 Security Hardening)
const apiRateBuckets = new Map();
const API_RATE_LIMIT_RULES = Object.freeze({
  AUTH_MUTATION: { windowMs: 60 * 1000, max: 30 },
  AI_ANALYZE: { windowMs: 60 * 1000, max: 30 },
  BACKTEST_RUN: { windowMs: 60 * 1000, max: 40 },
  MARKET_DATA: { windowMs: 60 * 1000, max: 120 }
});

function checkEndpointRateLimit(category, clientKey, nowMs = Date.now()) {
  const rule = API_RATE_LIMIT_RULES[category];
  if (!rule) return { allowed: true, retryAfterSeconds: 0 };

  const bucketId = `${category}:${clientKey || '127.0.0.1'}`;
  const existing = apiRateBuckets.get(bucketId) || [];
  const active = existing.filter((ts) => nowMs - ts < rule.windowMs);

  if (active.length >= rule.max) {
    const oldest = active[0] || nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((rule.windowMs - (nowMs - oldest)) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      limit: rule.max
    };
  }

  active.push(nowMs);
  apiRateBuckets.set(bucketId, active);
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, rule.max - active.length)
  };
}

function resetApiRateLimitsForTest() {
  apiRateBuckets.clear();
}

function json(req, res, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  const originCheck = isTrustedOrigin(req);

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...buildSecurityHeaders(req),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-Token',
    'Access-Control-Allow-Credentials': 'true',
    ...extraHeaders
  };

  if (originCheck.allowOriginHeader) {
    headers['Access-Control-Allow-Origin'] = originCheck.allowOriginHeader;
    headers['Vary'] = 'Origin';
  }

  res.writeHead(statusCode, headers);
  res.end(payload);
}

function readJsonBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let byteCount = 0;
    let rejected = false;

    req.on('data', (chunk) => {
      if (rejected) return;
      const chunkBytes = Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(String(chunk), 'utf8');
      byteCount += chunkBytes;

      if (byteCount > maxBytes) {
        rejected = true;
        const err = new Error('Request payload too large.');
        err.code = 'PAYLOAD_TOO_LARGE';
        err.statusCode = 413;
        reject(err);
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (rejected) return;
      if (!raw.trim()) {
        return resolve({});
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const err = new Error('JSON request body must be a JSON object.');
          err.code = 'INVALID_JSON_BODY';
          err.statusCode = 400;
          return reject(err);
        }
        resolve(parsed);
      } catch (_) {
        const err = new Error('Invalid JSON request body.');
        err.code = 'INVALID_JSON_BODY';
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (!rejected) reject(err);
    });
  });
}

function sanitizeErrorMessage(rawMessage) {
  let msg = String(rawMessage || 'API request failed.');
  const sensitiveEnvValues = [
    process.env.ANGEL_API_KEY,
    process.env.ANGEL_CLIENT_ID,
    process.env.ANGEL_PIN,
    process.env.ANGEL_TOTP_SECRET,
    process.env.TWELVE_DATA_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_AI_API_KEY,
    process.env.FINNHUB_API_KEY,
    process.env.ALPHA_VANTAGE_API_KEY,
    process.env.NEWS_API_KEY,
    process.env.TRADING_ECONOMICS_API_KEY,
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_CHAT_ID,
    process.env.NOTIFICATION_WEBHOOK_URL,
    process.env.NOTIFICATION_EMAIL_WEBHOOK_URL,
    process.env.DIAGNOSTICS_AUTH_TOKEN
  ].filter((v) => typeof v === 'string' && v.trim().length >= 4);

  for (const secret of sensitiveEnvValues) {
    const trimmed = secret.trim();
    if (msg.includes(trimmed)) {
      msg = msg.split(trimmed).join('[REDACTED]');
    }
  }
  return msg;
}

function safeError(error) {
  const payload = {
    code: error?.code || 'API_ERROR',
    message: sanitizeErrorMessage(error?.message || 'API request failed.')
  };
  if (Array.isArray(error?.missingEnvVars)) {
    payload.missingEnvVars = error.missingEnvVars.filter((name) => typeof name === 'string');
  }
  return payload;
}

function getClientIp(req, env = process.env) {
  if (isTrustedProxyEnabled(env)) {
    const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req?.socket?.remoteAddress || '127.0.0.1';
}

function isDiagnosticsAuthorized(req, sessionCtx, env = process.env) {
  if (sessionCtx?.user?.userId) {
    return true;
  }

  const configuredToken = String(env.DIAGNOSTICS_AUTH_TOKEN || '').trim();
  if (configuredToken.length >= 8) {
    const headerToken = String(req?.headers?.['x-diagnostics-token'] || '').trim();
    const authHeader = String(req?.headers?.authorization || '').trim();
    const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const candidate = headerToken || bearerToken;
    if (candidate) {
      const a = Buffer.from(candidate, 'utf8');
      const b = Buffer.from(configuredToken, 'utf8');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return true;
      }
    }
  }

  const isProd = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (!isProd) {
    return true;
  }

  return false;
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);
  const originCheck = isTrustedOrigin(req);

  if (url.pathname.startsWith('/api/') && !originCheck.trusted) {
    return json(req, res, 403, {
      ok: false,
      code: 'UNTRUSTED_ORIGIN',
      message: 'Origin is not permitted to access API.'
    });
  }

  if (req.method === 'OPTIONS') {
    if (!originCheck.trusted) {
      return json(req, res, 403, {
        ok: false,
        code: 'UNTRUSTED_ORIGIN'
      });
    }
    return json(req, res, 204, {});
  }

  // Extract optional YASHWIN user session for ownership isolation and CSRF checks
  const sessionCtx = userAuth.extractRequestSession(req);
  const currentUserId = sessionCtx?.user?.userId || null;

  /* =====================================================
     TASK 2 — YASHWIN USER ACCOUNT & SESSION ENDPOINTS
     (Completely separate from Angel One /api/auth/*)
  ===================================================== */

  if (url.pathname === '/api/user/register') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/user/register.'
      });
    }
    const rl = checkEndpointRateLimit('AUTH_MUTATION', getClientIp(req));
    if (!rl.allowed) {
      return json(
        req,
        res,
        429,
        {
          ok: false,
          code: 'RATE_LIMITED',
          message: `Too many registration requests. Please retry after ${rl.retryAfterSeconds}s.`,
          retryAfterSeconds: rl.retryAfterSeconds
        },
        { 'Retry-After': String(rl.retryAfterSeconds) }
      );
    }
    try {
      const body = await readJsonBody(req);
      const reg = await userAuth.registerUser(body, {
        ipAddress: getClientIp(req),
        userAgent: req.headers?.['user-agent'] || null
      });
      return json(
        req,
        res,
        201,
        {
          ok: true,
          authenticated: true,
          authDomain: 'YASHWIN_USER_ACCOUNT',
          user: reg.user,
          csrfToken: reg.csrfToken,
          session: {
            sessionId: reg.session.sessionId,
            expiresAt: reg.session.expiresAt
          }
        },
        { 'Set-Cookie': reg.cookieHeader }
      );
    } catch (error) {
      const status = error.statusCode || (error.code === 'DUPLICATE_EMAIL' ? 409 : 400);
      return json(req, res, status, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname === '/api/user/login') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/user/login.'
      });
    }
    try {
      const body = await readJsonBody(req);
      const loginRes = await userAuth.loginUser(body, {
        ipAddress: getClientIp(req),
        userAgent: req.headers?.['user-agent'] || null
      });
      return json(
        req,
        res,
        200,
        {
          ok: true,
          authenticated: true,
          authDomain: 'YASHWIN_USER_ACCOUNT',
          user: loginRes.user,
          csrfToken: loginRes.csrfToken,
          session: {
            sessionId: loginRes.session.sessionId,
            expiresAt: loginRes.session.expiresAt
          }
        },
        { 'Set-Cookie': loginRes.cookieHeader }
      );
    } catch (error) {
      const status = error.statusCode || 400;
      const extra = error.retryAfterSeconds
        ? { 'Retry-After': String(error.retryAfterSeconds) }
        : {};
      return json(
        req,
        res,
        status,
        {
          ok: false,
          ...safeError(error),
          ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {})
        },
        extra
      );
    }
  }

  if (url.pathname === '/api/user/logout') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/user/logout.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const out = userAuth.logoutSession(req);
      return json(
        req,
        res,
        200,
        {
          ok: true,
          authenticated: false,
          revoked: out.revoked
        },
        { 'Set-Cookie': out.clearCookieHeader }
      );
    } catch (error) {
      return json(req, res, error.statusCode || 403, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname === '/api/user/session') {
    if (req.method !== 'GET') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use GET for /api/user/session.'
      });
    }
    if (!sessionCtx) {
      return json(req, res, 200, {
        ok: true,
        authenticated: false,
        authDomain: 'YASHWIN_USER_ACCOUNT',
        user: null,
        csrfToken: null
      });
    }
    return json(req, res, 200, {
      ok: true,
      authenticated: true,
      authDomain: 'YASHWIN_USER_ACCOUNT',
      user: sessionCtx.user,
      csrfToken: sessionCtx.session.csrfToken,
      session: {
        sessionId: sessionCtx.session.sessionId,
        createdAt: sessionCtx.session.createdAt,
        expiresAt: sessionCtx.session.expiresAt
      }
    });
  }

  if (url.pathname === '/api/user/profile') {
    if (req.method === 'GET') {
      if (!sessionCtx) {
        return json(req, res, 401, {
          ok: false,
          code: 'UNAUTHENTICATED',
          message: 'Please log in to view your YASHWIN profile.'
        });
      }
      try {
        const profile = userAuth.getProfile(currentUserId);
        return json(req, res, 200, {
          ...profile,
          csrfToken: sessionCtx.session.csrfToken
        });
      } catch (error) {
        return json(req, res, error.statusCode || 400, {
          ok: false,
          ...safeError(error)
        });
      }
    }

    if (req.method === 'POST') {
      if (!sessionCtx) {
        return json(req, res, 401, {
          ok: false,
          code: 'UNAUTHENTICATED',
          message: 'Please log in to update your YASHWIN profile.'
        });
      }
      try {
        userAuth.assertCsrfForMutation(req, sessionCtx);
        const body = await readJsonBody(req);
        const result = await userAuth.updateProfile(currentUserId, body);
        return json(req, res, 200, result);
      } catch (error) {
        return json(req, res, error.statusCode || 400, {
          ok: false,
          ...safeError(error)
        });
      }
    }

    return json(req, res, 405, {
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      message: 'Use GET or POST for /api/user/profile.'
    });
  }

  if (url.pathname === '/api/user/email/verify') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/user/email/verify.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      const verified = userAuth.verifyEmailChangeToken(body.token, currentUserId);
      return json(req, res, 200, verified);
    } catch (error) {
      return json(req, res, error.statusCode || 400, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname === '/api/user/password') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/user/password.'
      });
    }
    if (!sessionCtx) {
      return json(req, res, 401, {
        ok: false,
        code: 'UNAUTHENTICATED',
        message: 'Please log in to change your password.'
      });
    }
    try {
      userAuth.assertCsrfForMutation(req, sessionCtx);
      const body = await readJsonBody(req);
      const changed = await userAuth.changePassword(
        currentUserId,
        body,
        sessionCtx.session.sessionId
      );
      return json(req, res, 200, changed);
    } catch (error) {
      return json(req, res, error.statusCode || 400, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  /* =====================================================
     USER-OWNED PAPER TRADING MUTATION ENDPOINTS
  ===================================================== */

  if (url.pathname === '/api/paper/open') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/paper/open.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      const em = db.getEmergencyStop();
      if (em.active) {
        return json(req, res, 400, {
          ok: false,
          code: 'EMERGENCY_STOP_ACTIVE',
          message: 'Emergency stop is active. Cannot open paper position.'
        });
      }

      const acct = db.getPaperAccount(currentUserId);
      const existingOpen = db.getOpenPosition(currentUserId);
      const direction = String(body.direction || body.side || 'BUY').toUpperCase();
      const assetType = String(body.assetType || 'EQUITY').toUpperCase();
      const entry = Number(body.entry);
      const stop = Number(body.stop !== undefined ? body.stop : body.stopLoss);
      const target = Number(body.target);
      const qty = Number(body.qty ?? body.quantity ?? 1);
      const lotSize = body.lotSize ? Number(body.lotSize) : null;
      const lots = body.lots ? Number(body.lots) : null;
      const effectiveQty = assetType === 'OPTION' && lotSize && lots ? lotSize * lots : qty;
      const availableBalance = acct
        ? Math.max(0, Number(acct.capital || 100000) + Number(acct.realizedPnl || 0))
        : 100000;

      const riskCheck = RiskEngine.evaluate({
        side: direction,
        symbol: body.symbol || 'NIFTY 50',
        existingSymbol: existingOpen ? existingOpen.symbol : null,
        entry,
        stop,
        target,
        quantity: qty,
        assetType,
        lotSize,
        lots,
        dailyPnl: acct ? acct.dailyPnl : 0,
        realizedDailyPnl: acct ? acct.dailyPnl : 0,
        unrealizedPnl: existingOpen ? existingOpen.unrealizedPnl : (acct ? acct.unrealizedPnl : 0),
        tradesToday: acct ? acct.tradesToday : 0,
        openPositions: existingOpen ? 1 : 0,
        availableBalance: body.enforceAvailableBalance === false ? undefined : availableBalance,
        averaging: Boolean(body.averaging),
        staleData: Boolean(body.staleData),
        dataReady: body.dataReady !== undefined ? Boolean(body.dataReady) : true,
        emergencyStop: em.active
      });
      db.insertRiskEvent(riskCheck, body.symbol || 'NIFTY 50', direction, currentUserId);

      if (!riskCheck.allowed) {
        const rejOrder = db.recordRejectedPaperOrder(
          {
            symbol: body.symbol || 'NIFTY 50',
            exchange: body.exchange || 'NSE',
            direction,
            assetType,
            lotSize,
            lots,
            effectiveQty,
            entry,
            stop,
            target,
            mode: body.mode || 'MANUAL_PAPER',
            rejectionReason: riskCheck.reasons.join(' ')
          },
          currentUserId
        );
        db.insertAuditEvent(
          {
            category: 'RISK_REJECTION',
            message: `Paper trade blocked by RiskEngine on ${body.symbol || 'NIFTY 50'} (${direction})`,
            details: {
              orderId: rejOrder.orderId,
              symbol: body.symbol || 'NIFTY 50',
              direction,
              reasons: riskCheck.reasons
            }
          },
          currentUserId
        );
        return json(req, res, 400, {
          ok: false,
          code: 'RISK_REJECTED',
          orderId: rejOrder.orderId,
          orderStatus: 'REJECTED',
          message: riskCheck.reasons.join(' '),
          reasons: riskCheck.reasons,
          riskCheck
        });
      }

      const positionValue = Math.abs(entry * effectiveQty);
      const profitStep = Math.max(1, positionValue * 0.1);

      const opened = db.recordOpenPositionTransaction({
        userId: currentUserId,
        clientOrderKey: body.clientOrderKey || null,
        symbol: body.symbol || 'NIFTY 50',
        exchange: body.exchange || 'NSE',
        direction,
        assetType,
        lotSize,
        lots,
        qty,
        effectiveQty,
        entry,
        stop,
        target,
        profitStep,
        exitOnTarget: Boolean(body.exitOnTarget),
        mode: body.mode || 'MANUAL_PAPER'
      });

      db.insertAuditEvent(
        {
          category: 'TRADE_DECISION',
          message: `Opened paper position on ${body.symbol || 'NIFTY 50'} (${direction})`,
          details: { symbol: body.symbol || 'NIFTY 50', direction, entry, stop, target, effectiveQty }
        },
        currentUserId
      );

      return json(req, res, 200, {
        ok: true,
        ...opened,
        account: db.getPaperAccount(currentUserId),
        openPosition: db.getOpenPosition(currentUserId)
      });
    } catch (error) {
      const status =
        error.code === 'DUPLICATE_ORDER_REQUEST' || error.code === 'DUPLICATE_OPEN_POSITION'
          ? 409
          : error.statusCode || 400;
      return json(req, res, status, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname === '/api/paper/close') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/paper/close.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);

      let targetPos = null;
      if (body.positionId) {
        targetPos = db.getPositionByIdForUser(body.positionId, currentUserId);
      } else {
        targetPos = db.getOpenPosition(currentUserId);
      }

      if (!targetPos || targetPos.status !== 'OPEN') {
        return json(req, res, 404, {
          ok: false,
          code: 'NO_OPEN_POSITION',
          message: 'No open paper position found for this account.'
        });
      }

      const exitPrice =
        body.exitPrice !== undefined && Number.isFinite(Number(body.exitPrice)) && Number(body.exitPrice) > 0
          ? Number(body.exitPrice)
          : targetPos.current;
      const pnl =
        targetPos.direction === 'BUY'
          ? (exitPrice - targetPos.entry) * targetPos.effectiveQty
          : (targetPos.entry - exitPrice) * targetPos.effectiveQty;

      const closed = db.recordClosePositionTransaction({
        userId: currentUserId,
        positionId: targetPos.id,
        symbol: targetPos.symbol,
        exchange: targetPos.exchange,
        direction: targetPos.direction,
        assetType: targetPos.assetType,
        effectiveQty: targetPos.effectiveQty,
        entry: targetPos.entry,
        exitPrice,
        stop: targetPos.stop,
        target: targetPos.target,
        pnl,
        reason: body.reason || 'MANUAL',
        mode: targetPos.mode,
        openedAt: targetPos.openedAt
      });

      db.insertAuditEvent(
        {
          category: 'TRADE_DECISION',
          message: `Closed paper position on ${targetPos.symbol}`,
          details: { positionId: targetPos.id, pnl, exitPrice }
        },
        currentUserId
      );

      return json(req, res, 200, {
        ok: true,
        pnl,
        ...closed,
        account: db.getPaperAccount(currentUserId),
        openPosition: db.getOpenPosition(currentUserId)
      });
    } catch (error) {
      const status = error.code === 'FORBIDDEN_OWNERSHIP' ? 403 : error.statusCode || 400;
      return json(req, res, status, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname === '/api/paper/price-update') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/paper/price-update.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      let targetPos = null;
      if (body.positionId) {
        targetPos = db.getPositionByIdForUser(body.positionId, currentUserId);
      } else {
        targetPos = db.getOpenPosition(currentUserId);
      }

      if (!targetPos || targetPos.status !== 'OPEN') {
        return json(req, res, 404, {
          ok: false,
          code: 'NO_OPEN_POSITION',
          message: 'No open paper position found for this account.'
        });
      }

      const numericPrice = Number(body.price);
      if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
        return json(req, res, 400, {
          ok: false,
          code: 'INVALID_PRICE',
          message: 'A positive finite validated price is required.'
        });
      }

      const eq = Number(targetPos.effectiveQty || targetPos.qty || 1);
      const pnl =
        targetPos.direction === 'BUY'
          ? (numericPrice - targetPos.entry) * eq
          : (targetPos.entry - numericPrice) * eq;

      const acct = db.getPaperAccount(currentUserId);
      const em = db.getEmergencyStop();
      const autoExit = body.autoExit === true;
      const exitOnTarget = body.exitOnTarget === true || Boolean(targetPos.exitOnTarget);

      // Update trailing profit milestones
      let lockedProfit = Number(targetPos.lockedProfit || 0);
      let nextProfitMilestone = Number(targetPos.nextProfitMilestone || targetPos.profitStep || 1);
      const profitStep = Number(targetPos.profitStep || Math.max(1, targetPos.positionValue * 0.1));
      let milestoneReached = false;

      while (pnl >= nextProfitMilestone) {
        lockedProfit = Math.max(lockedProfit, nextProfitMilestone - profitStep);
        nextProfitMilestone += profitStep;
        milestoneReached = true;
      }

      const trailingStop =
        lockedProfit > 0
          ? targetPos.direction === 'BUY'
            ? targetPos.entry + lockedProfit / eq
            : targetPos.entry - lockedProfit / eq
          : null;

      let exitAction = 'HOLD';
      let targetActivated = Boolean(targetPos.targetActivated);

      // Priority 1: Emergency Stop
      if (em.active || body.emergencyStop === true) {
        exitAction = 'EMERGENCY_STOP';
      }
      // Priority 2: Hard Stop-Loss
      else if (
        (targetPos.direction === 'BUY' && numericPrice <= targetPos.stop) ||
        (targetPos.direction === 'SELL' && numericPrice >= targetPos.stop)
      ) {
        exitAction = 'STOP_LOSS';
      }
      // Priority 3: Daily Risk Lock
      else if ((acct ? acct.dailyPnl : 0) + pnl <= -Number(acct ? acct.maxDailyLoss : 1000)) {
        exitAction = 'RISK_LOCK';
      }
      // Priority 4: Target
      else if (
        (targetPos.direction === 'BUY' && numericPrice >= targetPos.target) ||
        (targetPos.direction === 'SELL' && numericPrice <= targetPos.target)
      ) {
        if (exitOnTarget) {
          exitAction = 'TARGET_EXIT';
        } else if (!targetActivated) {
          targetActivated = true;
          exitAction = 'TARGET_ACTIVATED';
        }
      }
      // Priority 5: Trailing Profit Lock
      else if (
        trailingStop !== null &&
        ((targetPos.direction === 'BUY' && numericPrice <= trailingStop) ||
          (targetPos.direction === 'SELL' && numericPrice >= trailingStop))
      ) {
        exitAction = 'PROFIT_LOCK';
      } else if (milestoneReached) {
        exitAction = 'AI_REANALYZE';
      }

      const closableActions = ['EMERGENCY_STOP', 'STOP_LOSS', 'RISK_LOCK', 'TARGET_EXIT', 'PROFIT_LOCK'];
      if (autoExit && closableActions.includes(exitAction)) {
        const closed = db.recordClosePositionTransaction({
          userId: currentUserId,
          positionId: targetPos.id,
          symbol: targetPos.symbol,
          exchange: targetPos.exchange,
          direction: targetPos.direction,
          assetType: targetPos.assetType,
          effectiveQty: eq,
          entry: targetPos.entry,
          exitPrice: numericPrice,
          stop: targetPos.stop,
          target: targetPos.target,
          pnl,
          reason: exitAction,
          mode: targetPos.mode,
          openedAt: targetPos.openedAt
        });

        db.insertAuditEvent(
          {
            category: 'TRADE_DECISION',
            message: `Auto Paper Exit (${exitAction}) on ${targetPos.symbol} at ₹${numericPrice}`,
            details: { positionId: targetPos.id, symbol: targetPos.symbol, exitAction, pnl, exitPrice: numericPrice }
          },
          currentUserId
        );

        return json(req, res, 200, {
          ok: true,
          action: exitAction,
          closed: true,
          pnl,
          ...closed,
          account: db.getPaperAccount(currentUserId),
          openPosition: db.getOpenPosition(currentUserId)
        });
      }

      db.updateOpenPositionState(
        {
          id: targetPos.id,
          userId: currentUserId,
          current: numericPrice,
          trailingStop,
          lockedProfit,
          nextProfitMilestone,
          targetActivated,
          unrealizedPnl: pnl
        },
        currentUserId
      );

      return json(req, res, 200, {
        ok: true,
        action: exitAction,
        closed: false,
        pnl,
        lockedProfit,
        nextProfitMilestone,
        trailingStop,
        targetActivated,
        account: db.getPaperAccount(currentUserId),
        openPosition: db.getOpenPosition(currentUserId)
      });
    } catch (error) {
      const status = error.code === 'FORBIDDEN_OWNERSHIP' ? 403 : error.statusCode || 400;
      return json(req, res, status, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  /* =====================================================
     ANGEL ONE BROKER AUTH & EXISTING TRADING ROUTES
  ===================================================== */

  if (url.pathname === '/api/auth/login') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/auth/login.'
      });
    }

    try {
      const result = await auth.login();
      AuditLogger.logAuthEvent(
        result.ok ? 'Angel One read-only session authenticated' : 'Angel One login failed',
        { ok: result.ok }
      );
      return json(req, res, result.ok ? 200 : 401, result);
    } catch (error) {
      AuditLogger.logAuthEvent(`Angel One login error: ${error.code || 'ERROR'}`, {
        code: error.code
      });
      return json(req, res, 400, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname === '/api/ai/analyze') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/ai/analyze.'
      });
    }

    const rl = checkEndpointRateLimit('AI_ANALYZE', currentUserId || getClientIp(req));
    if (!rl.allowed) {
      return json(
        req,
        res,
        429,
        {
          ok: false,
          code: 'RATE_LIMITED',
          message: `Too many AI analysis requests. Please retry after ${rl.retryAfterSeconds}s.`,
          retryAfterSeconds: rl.retryAfterSeconds
        },
        { 'Retry-After': String(rl.retryAfterSeconds) }
      );
    }

    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      const analysisResult = await googleAI.analyzeMarketWithGoogleAI(body);
      if (analysisResult?.decision) {
        db.insertAIDecision(
          analysisResult.decision,
          body?.symbol || 'NIFTY 50',
          currentUserId
        );
      }
      return json(req, res, analysisResult.ok ? 200 : 422, analysisResult);
    } catch (error) {
      return json(req, res, error.statusCode || 400, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname === '/api/emergency/activate') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/emergency/activate.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      const reason = body.reason || 'Activated via server API';
      const result = AuditLogger.activateEmergencyStop(reason);

      let userClosedPosition = null;
      if (currentUserId) {
        const openPos = db.getOpenPosition(currentUserId);
        if (openPos && openPos.status === 'OPEN') {
          const eq = Number(openPos.effectiveQty || openPos.qty || 1);
          const exitPrice = Number(openPos.current || openPos.entry);
          const pnl =
            openPos.direction === 'BUY'
              ? (exitPrice - openPos.entry) * eq
              : (openPos.entry - exitPrice) * eq;
          userClosedPosition = db.recordClosePositionTransaction({
            userId: currentUserId,
            positionId: openPos.id,
            symbol: openPos.symbol,
            exchange: openPos.exchange,
            direction: openPos.direction,
            assetType: openPos.assetType,
            effectiveQty: eq,
            entry: openPos.entry,
            exitPrice,
            stop: openPos.stop,
            target: openPos.target,
            pnl,
            reason: 'EMERGENCY_STOP',
            mode: openPos.mode,
            openedAt: openPos.openedAt
          });
            db.insertAuditEvent(
              {
                category: 'EMERGENCY_STOP',
                message: `Closed open paper position on ${openPos.symbol} due to Emergency Stop`,
                details: { positionId: openPos.id, symbol: openPos.symbol, pnl, exitPrice }
              },
              currentUserId
            );
          }
        }

        try {
          db.createSystemOrRiskNotification(
            {
              category: 'EMERGENCY_STOP',
              severity: 'CRITICAL',
              title: 'EMERGENCY STOP ACTIVATED',
              message: `Emergency Stop engaged (${reason}). All new paper entries and strategy pilots are locked.`,
              dedupKey: `EMERGENCY_STOP:${result.activatedAt || Date.now()}:${currentUserId || 'GLOBAL'}`
            },
            currentUserId
          );
        } catch (_) {}

        return json(req, res, 200, {
          ...result,
          userClosedPosition,
          account: db.getPaperAccount(currentUserId),
          openPosition: db.getOpenPosition(currentUserId)
        });
      } catch (error) {
        return json(req, res, error.statusCode || 400, { ok: false, ...safeError(error) });
      }
    }

  if (url.pathname === '/api/emergency/reset') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/emergency/reset.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      const result = AuditLogger.resetEmergencyStop(
        body.reason || 'Reset via server API'
      );
      return json(req, res, 200, result);
    } catch (error) {
      return json(req, res, error.statusCode || 400, { ok: false, ...safeError(error) });
    }
  }

  if (url.pathname === '/api/strategy/evaluate') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/strategy/evaluate.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      const em = db.getEmergencyStop();
      const strategy = StrategyEngine.evaluate({
        ...body,
        emergencyStop: body.emergencyStop === true || Boolean(em?.active)
      });
      if (body.persist !== false) {
        db.insertStrategyDecision(
          strategy,
          body.symbol || body.snapshot?.name || 'NIFTY 50',
          currentUserId
        );
      }
      return json(req, res, 200, {
        ok: true,
        userId: currentUserId,
        strategy,
        documentedRules: StrategyEngine.DOCUMENTED_STRATEGY_RULES
      });
    } catch (error) {
      return json(req, res, error.statusCode || 400, { ok: false, ...safeError(error) });
    }
  }

  if (url.pathname === '/api/strategy/history') {
    if (req.method !== 'GET') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use GET for /api/strategy/history.'
      });
    }
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user strategy history access is forbidden.'
      });
    }
    return json(req, res, 200, {
      ok: true,
      userId: currentUserId,
      strategyVersion: StrategyEngine.STRATEGY_VERSION,
      documentedRules: StrategyEngine.DOCUMENTED_STRATEGY_RULES,
      strategyDecisions: db.listStrategyDecisions(30, currentUserId)
    });
  }

  /* =====================================================
     TASK 9 — COMPLETE RISK MANAGEMENT ENGINE ROUTES
     (Multi-User Isolated + CSRF Protected Mutations)
  ===================================================== */

  if (url.pathname === '/api/risk/evaluate') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/risk/evaluate.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      const em = db.getEmergencyStop();
      const acct = db.getPaperAccount(currentUserId);
      const existingOpen = db.getOpenPosition(currentUserId);
      const direction = String(body.side || body.direction || 'BUY').toUpperCase();
      const assetType = String(body.assetType || 'EQUITY').toUpperCase();
      const availableBalance =
        body.availableBalance !== undefined
          ? body.availableBalance
          : acct
            ? Math.max(0, Number(acct.capital || 100000) + Number(acct.realizedPnl || 0))
            : 100000;

      const riskCheck = RiskEngine.evaluate({
        ...body,
        side: direction,
        assetType,
        symbol: body.symbol || 'NIFTY 50',
        existingSymbol: existingOpen ? existingOpen.symbol : null,
        dailyPnl: body.dailyPnl !== undefined ? Number(body.dailyPnl) : (acct ? acct.dailyPnl : 0),
        realizedDailyPnl:
          body.realizedDailyPnl !== undefined
            ? Number(body.realizedDailyPnl)
            : body.dailyPnl !== undefined
              ? Number(body.dailyPnl)
              : acct
                ? acct.dailyPnl
                : 0,
        unrealizedPnl:
          body.unrealizedPnl !== undefined
            ? Number(body.unrealizedPnl)
            : existingOpen
              ? existingOpen.unrealizedPnl
              : acct
                ? acct.unrealizedPnl
                : 0,
        tradesToday: body.tradesToday !== undefined ? Number(body.tradesToday) : (acct ? acct.tradesToday : 0),
        openPositions: body.openPositions !== undefined ? Number(body.openPositions) : (existingOpen ? 1 : 0),
        availableBalance: body.enforceAvailableBalance === false ? undefined : availableBalance,
        emergencyStop: body.emergencyStop === true || Boolean(em?.active)
      });

      const sizing = RiskEngine.calculateSafePositionSize({
        side: direction,
        assetType,
        entry: body.entry,
        stop: body.stop !== undefined ? body.stop : body.stopLoss,
        lotSize: body.lotSize,
        dailyPnl: riskCheck.realizedDailyPnl,
        unrealizedPnl: riskCheck.unrealizedPnl,
        availableBalance
      });

      if (body.persist !== false) {
        db.insertRiskEvent(riskCheck, body.symbol || 'NIFTY 50', direction, currentUserId);
        if (!riskCheck.allowed) {
          db.insertAuditEvent(
            {
              category: 'RISK_REJECTION',
              message: `Risk evaluation blocked ${direction} on ${body.symbol || 'NIFTY 50'}`,
              details: { symbol: body.symbol || 'NIFTY 50', direction, reasons: riskCheck.reasons }
            },
            currentUserId
          );
        }
      }

      return json(req, res, 200, {
        ok: true,
        userId: currentUserId,
        riskCheck,
        positionSizing: sizing
      });
    } catch (error) {
      return json(req, res, error.statusCode || 400, { ok: false, ...safeError(error) });
    }
  }

  if (url.pathname === '/api/risk/status') {
    if (req.method !== 'GET') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use GET for /api/risk/status.'
      });
    }
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user risk status access is forbidden.'
      });
    }

    const acct = db.getPaperAccount(currentUserId);
    const openPos = db.getOpenPosition(currentUserId);
    const em = db.getEmergencyStop();
    const riskEvents = db.listRiskEvents(30, currentUserId);
    const riskViewModel = RiskEngine.buildRiskViewModel({
      account: acct,
      openPosition: openPos,
      serverEmergencyStop: em,
      emergencyStop: Boolean(em?.active),
      riskEvents
    });

    return json(req, res, 200, {
      ok: true,
      mode: 'PAPER',
      liveTradingEnabled: false,
      userId: currentUserId,
      riskStatus: riskViewModel,
      documentedRules: RiskEngine.DOCUMENTED_RISK_RULES
    });
  }

  if (url.pathname === '/api/backtest/run') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/backtest/run.'
      });
    }
    const rl = checkEndpointRateLimit('BACKTEST_RUN', currentUserId || getClientIp(req));
    if (!rl.allowed) {
      return json(
        req,
        res,
        429,
        {
          ok: false,
          code: 'RATE_LIMITED',
          message: `Too many backtest execution requests. Please retry after ${rl.retryAfterSeconds}s.`,
          retryAfterSeconds: rl.retryAfterSeconds
        },
        { 'Retry-After': String(rl.retryAfterSeconds) }
      );
    }
    let body = {};
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      body = await readJsonBody(req);

      let candlesToUse = Array.isArray(body.candles) ? body.candles : null;
      let dataSource = body.dataSource || 'SUPPLIED_VALIDATED_CANDLES';
      let provider = body.provider || null;
      let resolvedInstrument = null;

      if ((!candlesToUse || candlesToUse.length === 0) && body.fetchHistoricalCandles === true) {
        const exchange = body.exchange || 'NSE';
        const query = body.query || body.symbol || body.tradingsymbol || 'NIFTY';
        const exactSymbol = body.tradingsymbol || body.exactSymbol || undefined;
        const interval = Backtester.normalizeTimeframe(body.timeframe || body.interval || 'FIVE_MINUTE');

        const candleRes = await pipeline.getCandlesBySearch(exchange, query, exactSymbol, {
          interval,
          fromdate: body.fromDate || body.fromdate,
          todate: body.toDate || body.todate
        });
        candlesToUse = candleRes.candles || [];
        dataSource = 'ANGEL_ONE_HISTORICAL_API';
        provider = candleRes.provider || 'ANGEL_ONE';
        resolvedInstrument = candleRes.instrument || null;
      }

      const em = db.getEmergencyStop();
      const result = Backtester.run({
        ...body,
        symbol: resolvedInstrument?.tradingsymbol || body.symbol || 'NIFTY 50',
        tradingsymbol: resolvedInstrument?.tradingsymbol || body.tradingsymbol || body.symbol || 'NIFTY 50',
        symboltoken: resolvedInstrument?.symboltoken || body.symboltoken || null,
        exchange: resolvedInstrument?.exchange || body.exchange || 'NSE',
        candles: candlesToUse || [],
        dataSource,
        provider,
        retrievalTimestamp: new Date().toISOString(),
        userId: currentUserId,
        emergencyStop: body.emergencyStop === true || Boolean(em?.active),
        persist: false
      });

      if (body.persist !== false) {
        const runId = db.insertBacktestRun(result, currentUserId, {
          clientRunKey: body.clientRunKey || null,
          rejectDuplicateKey: body.rejectDuplicateKey === true
        });
        result.runId = runId;
      }

      return json(req, res, 200, result);
    } catch (error) {
      if (body && body.recordFailedRun === true) {
        try {
          db.insertFailedBacktestRun(
            {
              symbol: body.symbol || 'NIFTY 50',
              exchange: body.exchange || 'NSE',
              timeframe: body.timeframe || body.interval || 'FIVE_MINUTE',
              assetType: body.assetType || 'EQUITY',
              configuration: body,
              code: error.code || 'BACKTEST_EXECUTION_FAILED',
              message: error.message || 'Backtest execution failed.',
              clientRunKey: body.clientRunKey || null
            },
            currentUserId
          );
        } catch (_) {}
      }
      const status =
        error.code === 'DUPLICATE_BACKTEST_RUN'
          ? 409
          : error.code === 'FORBIDDEN_OWNERSHIP'
            ? 403
            : error.statusCode || 400;
      return json(req, res, status, { ok: false, ...safeError(error) });
    }
  }

  /* =====================================================
     TASK 4 — MARKET SEARCH WATCHLIST & RECENT SEARCHES
     (Multi-User Isolated + CSRF Protected Mutations)
  ===================================================== */

  if (url.pathname === '/api/watchlist/add') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/watchlist/add.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      const watchlist = db.addWatchlistItem(body, currentUserId);
      return json(req, res, 200, {
        ok: true,
        userId: currentUserId,
        watchlist
      });
    } catch (error) {
      const status =
        error.code === 'DUPLICATE_WATCHLIST_ITEM'
          ? 409
          : error.code === 'FORBIDDEN_OWNERSHIP'
            ? 403
            : error.statusCode || 400;
      return json(req, res, status, { ok: false, ...safeError(error) });
    }
  }

  if (url.pathname === '/api/watchlist/remove') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/watchlist/remove.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      const watchlist = db.removeWatchlistItem(body, currentUserId);
      return json(req, res, 200, {
        ok: true,
        userId: currentUserId,
        watchlist
      });
    } catch (error) {
      const status = error.code === 'FORBIDDEN_OWNERSHIP' ? 403 : error.statusCode || 400;
      return json(req, res, status, { ok: false, ...safeError(error) });
    }
  }

  if (url.pathname === '/api/watchlist/reorder') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/watchlist/reorder.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      if (body.userId && String(body.userId) !== String(currentUserId || '')) {
        return json(req, res, 403, {
          ok: false,
          code: 'FORBIDDEN_OWNERSHIP',
          message: 'Cross-user watchlist reorder is forbidden.'
        });
      }
      const watchlist = db.reorderWatchlist(body, currentUserId);
      return json(req, res, 200, {
        ok: true,
        userId: currentUserId,
        watchlist
      });
    } catch (error) {
      const status = error.code === 'FORBIDDEN_OWNERSHIP' ? 403 : error.statusCode || 400;
      return json(req, res, status, { ok: false, ...safeError(error) });
    }
  }

  /* =====================================================
     TASK 14 — MARKET ALERTS & ALERT HISTORY MUTATION ROUTES
     (Multi-User Isolated + CSRF Protected + Zero Live Execution)
  ===================================================== */

  if (url.pathname === '/api/alerts' && req.method === 'POST') {
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      if (body.userId && String(body.userId) !== String(currentUserId || '')) {
        return json(req, res, 403, {
          ok: false,
          code: 'FORBIDDEN_OWNERSHIP',
          message: 'Cross-user market alert creation is forbidden.'
        });
      }
      const alert = db.createMarketAlert(body, currentUserId);
      const alerts = db.listMarketAlerts({}, currentUserId);
      return json(req, res, 201, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        brokerExecution: 'NONE',
        userId: currentUserId,
        alert,
        alerts
      });
    } catch (error) {
      const status = error.code === 'FORBIDDEN_OWNERSHIP' ? 403 : error.statusCode || 400;
      return json(req, res, status, {
        ok: false,
        ...safeError(error),
        ...(error.errors ? { errors: error.errors } : {})
      });
    }
  }

  if (
    url.pathname === '/api/alerts/pause' ||
    url.pathname === '/api/alerts/resume' ||
    url.pathname === '/api/alerts/cancel' ||
    url.pathname === '/api/alerts/disable' ||
    url.pathname === '/api/alerts/reset' ||
    url.pathname === '/api/alerts/delete'
  ) {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: `Use POST for ${url.pathname}.`
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      if (body.userId && String(body.userId) !== String(currentUserId || '')) {
        return json(req, res, 403, {
          ok: false,
          code: 'FORBIDDEN_OWNERSHIP',
          message: 'Cross-user market alert modification is forbidden.'
        });
      }
      const alertId = body.alertId || body.id;
      if (url.pathname === '/api/alerts/delete') {
        const delRes = db.deleteMarketAlert(alertId, currentUserId);
        return json(req, res, 200, {
          ok: true,
          mode: 'PAPER',
          liveTradingEnabled: false,
          brokerExecution: 'NONE',
          userId: currentUserId,
          ...delRes,
          alerts: db.listMarketAlerts({}, currentUserId)
        });
      }

      let statusTarget = 'PAUSED';
      let lastTriggeredAtUpdate = undefined;
      if (url.pathname === '/api/alerts/resume') statusTarget = 'ACTIVE';
      if (url.pathname === '/api/alerts/cancel' || url.pathname === '/api/alerts/disable') {
        statusTarget = 'DISABLED';
      }
      if (url.pathname === '/api/alerts/reset') {
        statusTarget = 'ACTIVE';
        lastTriggeredAtUpdate = null;
      }

      const alert = db.updateMarketAlertStatus(
        alertId,
        {
          status: statusTarget,
          lastStatusReason: body.reason || `Manual transition via ${url.pathname}`,
          ...(lastTriggeredAtUpdate !== undefined ? { lastTriggeredAt: lastTriggeredAtUpdate } : {})
        },
        currentUserId
      );
      const alerts = db.listMarketAlerts({}, currentUserId);
      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        brokerExecution: 'NONE',
        userId: currentUserId,
        alert,
        alerts
      });
    } catch (error) {
      const status =
        error.code === 'FORBIDDEN_OWNERSHIP'
          ? 403
          : error.code === 'ALERT_NOT_FOUND'
            ? 404
            : error.statusCode || 400;
      return json(req, res, status, { ok: false, ...safeError(error) });
    }
  }

  if (url.pathname === '/api/alerts/evaluate') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/alerts/evaluate.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      if (body.userId && String(body.userId) !== String(currentUserId || '')) {
        return json(req, res, 403, {
          ok: false,
          code: 'FORBIDDEN_OWNERSHIP',
          message: 'Cross-user market alert evaluation is forbidden.'
        });
      }

      const suppliedContexts = body.contextsByKey || body.marketContexts || body.marketContextsBySymbol || {};
      if (body.marketContext && body.symbol) {
        suppliedContexts[String(body.symbol).toUpperCase()] = body.marketContext;
      }

      const evalSummary = db.evaluateUserAlertsAgainstMarketData(
        suppliedContexts,
        currentUserId,
        {
          nowMs: body.nowMs,
          maxQuoteAgeMs: body.maxQuoteAgeMs,
          useCachedSnapshots: body.useCachedSnapshots !== false
        }
      );

      const events = evalSummary.alertHistory || db.listAlertEventsHistory({}, currentUserId);
      const unacknowledgedCount = events.filter((e) => !e.acknowledged).length;

      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        brokerExecution: 'NONE',
        autoOrderTriggered: false,
        userId: currentUserId,
        evaluatedCount: evalSummary.evaluatedCount,
        triggeredCount: evalSummary.triggeredCount,
        evaluated: evalSummary.evaluations,
        evaluations: evalSummary.evaluations,
        triggeredEvents: evalSummary.triggeredEvents,
        alerts: evalSummary.alerts,
        events,
        unacknowledgedCount
      });
    } catch (error) {
      const status = error.code === 'FORBIDDEN_OWNERSHIP' ? 403 : error.statusCode || 400;
      return json(req, res, status, { ok: false, ...safeError(error) });
    }
  }

  if (url.pathname === '/api/alerts/events/acknowledge') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/alerts/events/acknowledge.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      if (body.userId && String(body.userId) !== String(currentUserId || '')) {
        return json(req, res, 403, {
          ok: false,
          code: 'FORBIDDEN_OWNERSHIP',
          message: 'Cross-user alert event acknowledgment is forbidden.'
        });
      }
      const eventId = body.eventId || body.id || 'ALL';
      const ackResult = db.acknowledgeAlertEvent(eventId, currentUserId);
      const events = db.listAlertEventsHistory({}, currentUserId);
      const unacknowledgedCount = events.filter((e) => !e.acknowledged).length;
      const notifSummary = db.listUserNotifications({}, currentUserId);
      return json(req, res, 200, {
        ok: true,
        userId: currentUserId,
        event: Array.isArray(ackResult) ? null : ackResult,
        events,
        unacknowledgedCount,
        unreadNotificationCount: notifSummary.unreadCount
      });
    } catch (error) {
      const status =
        error.code === 'FORBIDDEN_OWNERSHIP'
          ? 403
          : error.code === 'ALERT_EVENT_NOT_FOUND'
            ? 404
            : error.statusCode || 400;
      return json(req, res, status, { ok: false, ...safeError(error) });
    }
  }

  /* =====================================================
     TASK 15 — ALERT NOTIFICATIONS SYSTEM & PREFERENCES MUTATION ROUTES
     (Multi-User Isolated + CSRF Protected + Zero Secret Exposure)
  ===================================================== */

  if (
    (url.pathname === '/api/notifications/preferences' ||
      url.pathname === '/api/user/notification-preferences') &&
    req.method === 'POST'
  ) {
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      if (body.userId && String(body.userId) !== String(currentUserId || '')) {
        return json(req, res, 403, {
          ok: false,
          code: 'FORBIDDEN_OWNERSHIP',
          message: 'Cross-user notification preference modification is forbidden.'
        });
      }
      const preferences = db.updateUserNotificationPreferences(body, currentUserId);
      const externalChannels = notificationDelivery.getSafeExternalChannelStatus();
      db.insertAuditEvent(
        {
          category: 'USER_AUTH',
          message: 'Updated user notification preferences',
          details: {
            inAppEnabled: preferences.inAppEnabled,
            browserNotificationsEnabled: preferences.browserNotificationsEnabled,
            soundEnabled: preferences.soundEnabled,
            quietHoursEnabled: preferences.quietHoursEnabled
          }
        },
        currentUserId
      );
      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        brokerExecution: 'NONE',
        userId: currentUserId,
        preferences,
        externalChannels,
        documentedRules: NotificationEngine.DOCUMENTED_NOTIFICATION_RULES
      });
    } catch (error) {
      const status = error.code === 'FORBIDDEN_OWNERSHIP' ? 403 : error.statusCode || 400;
      return json(req, res, status, {
        ok: false,
        ...safeError(error),
        ...(error.errors ? { errors: error.errors } : {})
      });
    }
  }

  if (url.pathname === '/api/notifications/read' || url.pathname === '/api/notifications/read-all') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: `Use POST for ${url.pathname}.`
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      if (body.userId && String(body.userId) !== String(currentUserId || '')) {
        return json(req, res, 403, {
          ok: false,
          code: 'FORBIDDEN_OWNERSHIP',
          message: 'Cross-user notification read-state modification is forbidden.'
        });
      }
      const targetId =
        url.pathname === '/api/notifications/read-all'
          ? 'ALL'
          : body.notificationId || body.id || 'ALL';
      const result = db.markNotificationRead(targetId, currentUserId);
      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        brokerExecution: 'NONE',
        userId: currentUserId,
        ...result
      });
    } catch (error) {
      const status =
        error.code === 'FORBIDDEN_OWNERSHIP'
          ? 403
          : error.code === 'NOTIFICATION_NOT_FOUND'
            ? 404
            : error.statusCode || 400;
      return json(req, res, status, { ok: false, ...safeError(error) });
    }
  }

  if (url.pathname === '/api/notifications/delivery' && req.method === 'POST') {
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      if (body.userId && String(body.userId) !== String(currentUserId || '')) {
        return json(req, res, 403, {
          ok: false,
          code: 'FORBIDDEN_OWNERSHIP',
          message: 'Cross-user notification delivery logging is forbidden.'
        });
      }
      const delivery = db.recordNotificationDeliveryAttempt(body, currentUserId);
      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        userId: currentUserId,
        delivery
      });
    } catch (error) {
      const status =
        error.code === 'FORBIDDEN_OWNERSHIP'
          ? 403
          : error.code === 'NOTIFICATION_NOT_FOUND'
            ? 404
            : error.statusCode || 400;
      return json(req, res, status, { ok: false, ...safeError(error) });
    }
  }

  if (url.pathname === '/api/notifications/system' && req.method === 'POST') {
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const body = await readJsonBody(req);
      if (body.userId && String(body.userId) !== String(currentUserId || '')) {
        return json(req, res, 403, {
          ok: false,
          code: 'FORBIDDEN_OWNERSHIP',
          message: 'Cross-user system notification creation is forbidden.'
        });
      }
      const resNotif = db.createSystemOrRiskNotification(body, currentUserId);
      const summary = db.listUserNotifications({}, currentUserId);
      return json(req, res, resNotif.created ? 201 : 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        brokerExecution: 'NONE',
        userId: currentUserId,
        ...resNotif,
        unreadCount: summary.unreadCount
      });
    } catch (error) {
      const status = error.code === 'FORBIDDEN_OWNERSHIP' ? 403 : error.statusCode || 400;
      return json(req, res, status, { ok: false, ...safeError(error) });
    }
  }

  if (url.pathname === '/api/search/recent') {
    if (req.method === 'POST') {
      try {
        if (sessionCtx) {
          userAuth.assertCsrfForMutation(req, sessionCtx);
        }
        const body = await readJsonBody(req);
        const recent = db.recordRecentSearch(body, currentUserId);
        return json(req, res, 200, {
          ok: true,
          userId: currentUserId,
          recent
        });
      } catch (error) {
        return json(req, res, error.statusCode || 400, { ok: false, ...safeError(error) });
      }
    }

    if (req.method !== 'GET') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use GET or POST for /api/search/recent.'
      });
    }
  }

  if (url.pathname === '/api/search/recent/clear') {
    if (req.method !== 'POST') {
      return json(req, res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST for /api/search/recent/clear.'
      });
    }
    try {
      if (sessionCtx) {
        userAuth.assertCsrfForMutation(req, sessionCtx);
      }
      const recent = db.clearRecentSearches(currentUserId);
      return json(req, res, 200, {
        ok: true,
        userId: currentUserId,
        recent
      });
    } catch (error) {
      return json(req, res, error.statusCode || 400, { ok: false, ...safeError(error) });
    }
  }

  if (url.pathname.startsWith('/api/') && req.method !== 'GET') {
    return json(req, res, 405, {
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      message: 'Only GET is allowed for this endpoint.'
    });
  }

  if (url.pathname === '/api/health') {
    const status = auth.getAuthStatus();
    const safeCfg = getSafePublicConfig();
    const diagnostics = auth.getDiagnosticReport();
    const dbStatus = db.getDatabaseStatus();
    const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    const authorizedDiag = isDiagnosticsAuthorized(req, sessionCtx);

    const minimalDatabaseStatus = {
      connected: Boolean(dbStatus.connected),
      healthy: dbStatus.schemaVersion === dbStatus.latestExpectedSchemaVersion,
      schemaVersion: dbStatus.schemaVersion,
      tablesCount: dbStatus.tablesCount
    };

    const minimalPayload = {
      ok: Boolean(dbStatus.connected),
      service: 'YASHWIN_AI_TRADING_ASSISTANT',
      mode: 'READ_ONLY',
      tradingMode: safeCfg.trading.mode,
      liveTradingEnabled: false,
      orderEndpoints: 'NONE',
      provider: status.provider,
      sdkLoaded: status.sdkLoaded,
      credentialsConfigured: status.credentialsConfigured,
      missingEnvVars: Array.isArray(status.missingEnvVars) ? status.missingEnvVars : [],
      googleAIConfigured: status.googleAIConfigured,
      googleAIModel: status.googleAIModel,
      marketIntelligenceConfigured: safeCfg.marketIntelligenceConfigured,
      marketIntelligenceProviders: safeCfg.marketIntelligenceProviders,
      session: {
        authenticated: Boolean(status.session?.authenticated),
        status: status.session?.status || 'DISCONNECTED'
      },
      userSession: sessionCtx
        ? { authenticated: true, userId: sessionCtx.user.userId }
        : { authenticated: false, userId: null },
      database: authorizedDiag && !isProd ? dbStatus : minimalDatabaseStatus,
      emergencyStop: {
        active: Boolean(db.getEmergencyStop()?.active)
      },
      riskLimits: safeCfg.risk
    };

    if (authorizedDiag && !isProd) {
      minimalPayload.diagnostics = diagnostics;
    }

    return json(req, res, 200, minimalPayload);
  }

  if (url.pathname === '/api/auth/status') {
    const status = auth.getAuthStatus();
    const diagnostics = auth.getDiagnosticReport();

    return json(req, res, 200, {
      ok: true,
      provider: status.provider,
      sdkLoaded: status.sdkLoaded,
      credentialsConfigured: status.credentialsConfigured,
      missingEnvVars: Array.isArray(status.missingEnvVars) ? status.missingEnvVars : [],
      googleAIConfigured: status.googleAIConfigured,
      googleAIModel: status.googleAIModel,
      session: status.session,
      diagnostics
    });
  }

  if (url.pathname === '/api/ai/status') {
    const aiStatus = googleAI.getGoogleAIStatus();
    const aiDiagnostics = googleAI.getGoogleAIDiagnostics();

    return json(req, res, 200, {
      ok: true,
      provider: aiStatus.provider,
      model: aiStatus.model,
      credentialsConfigured: aiStatus.credentialsConfigured,
      mode: aiStatus.mode,
      diagnostics: aiDiagnostics
    });
  }

  if (url.pathname === '/api/paper/state') {
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user paper state access is forbidden.'
      });
    }

    return json(req, res, 200, {
      ok: true,
      mode: 'PAPER',
      liveTradingEnabled: false,
      userId: currentUserId,
      account: db.getPaperAccount(currentUserId),
      openPosition: db.getOpenPosition(currentUserId),
      orders: db.listPaperOrders(50, currentUserId),
      fills: db.listPaperFills(50, currentUserId),
      history: db.listTradeHistory(50, currentUserId),
      emergencyStop: db.getEmergencyStop(),
      riskLimits: RiskEngine.getLimits()
    });
  }

  /* =====================================================
     TASK 11 — COMPLETE PORTFOLIO MANAGEMENT ROUTES
     (Authoritative Server Accounting + User Isolation)
  ===================================================== */

  if (
    url.pathname === '/api/portfolio/summary' ||
    url.pathname === '/api/portfolio/positions' ||
    url.pathname === '/api/portfolio/performance' ||
    url.pathname === '/api/portfolio/history'
  ) {
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user portfolio access is forbidden.'
      });
    }

    const account = db.getPaperAccount(currentUserId);
    const openPos = db.getOpenPosition(currentUserId);
    const orders = db.listPaperOrders(200, currentUserId);
    const fills = db.listPaperFills(200, currentUserId);
    const closedTrades = db.listTradeHistory(500, currentUserId);
    const em = db.getEmergencyStop();

    let quoteContext = null;
    if (openPos) {
      const cachedSnap =
        typeof db.getMarketSnapshotCache === 'function'
          ? db.getMarketSnapshotCache(openPos.symbol)
          : null;
      const staleParam =
        url.searchParams.get('quoteStale') === '1' ||
        url.searchParams.get('quoteStale') === 'true';
      const unavailParam =
        url.searchParams.get('quoteUnavailable') === '1' ||
        url.searchParams.get('quoteUnavailable') === 'true';

      quoteContext = {
        price:
          cachedSnap && Number.isFinite(Number(cachedSnap.price)) && Number(cachedSnap.price) > 0
            ? Number(cachedSnap.price)
            : Number(openPos.current || openPos.entry),
        timestamp: cachedSnap?.quoteTimestamp || openPos.updatedAt || openPos.openedAt,
        dataReady: unavailParam ? false : cachedSnap ? cachedSnap.dataReady : true,
        stale: staleParam,
        priceUnavailable: unavailParam,
        status: unavailParam
          ? 'QUOTE_UNAVAILABLE'
          : cachedSnap?.status || 'VALIDATED'
      };
    }

    const filters = {};
    if (url.searchParams.get('symbol') || url.searchParams.get('instrument')) {
      filters.symbol = url.searchParams.get('symbol') || url.searchParams.get('instrument');
    }
    if (url.searchParams.get('status') || url.searchParams.get('outcome')) {
      filters.status = url.searchParams.get('status') || url.searchParams.get('outcome');
    }
    if (url.searchParams.get('reason') || url.searchParams.get('exitReason')) {
      filters.reason = url.searchParams.get('reason') || url.searchParams.get('exitReason');
    }
    if (url.searchParams.get('date')) {
      filters.date = url.searchParams.get('date');
    }
    if (url.searchParams.get('fromDate') || url.searchParams.get('from')) {
      filters.fromDate = url.searchParams.get('fromDate') || url.searchParams.get('from');
    }
    if (url.searchParams.get('toDate') || url.searchParams.get('to')) {
      filters.toDate = url.searchParams.get('toDate') || url.searchParams.get('to');
    }

    const portfolioSnapshot = PortfolioEngine.buildPortfolioSnapshot({
      userId: currentUserId,
      account,
      openPosition: openPos,
      orders,
      fills,
      closedTrades,
      emergencyStop: em,
      quoteContext,
      filters
    });

    if (url.pathname === '/api/portfolio/positions') {
      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        userId: currentUserId,
        openPositionCount: portfolioSnapshot.positions.length,
        openPositionLimit: 1,
        reservedCapital: portfolioSnapshot.summary.reservedCapital,
        availableBalance: portfolioSnapshot.summary.availableBalance,
        unrealizedPnl: portfolioSnapshot.summary.unrealizedPnl,
        positions: portfolioSnapshot.positions,
        openPosition: portfolioSnapshot.openPosition,
        documentedRules: PortfolioEngine.DOCUMENTED_PORTFOLIO_RULES
      });
    }

    if (url.pathname === '/api/portfolio/performance') {
      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        userId: currentUserId,
        performance: portfolioSnapshot.performance,
        filteredPerformance: portfolioSnapshot.filteredPerformance,
        documentedRules: PortfolioEngine.DOCUMENTED_PORTFOLIO_RULES
      });
    }

    if (url.pathname === '/api/portfolio/history') {
      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        userId: currentUserId,
        filtersApplied: filters,
        totalClosedTrades: closedTrades.length,
        filteredCount: portfolioSnapshot.history.length,
        history: portfolioSnapshot.history,
        dailyPnlHistory: portfolioSnapshot.filteredPerformance.dailyPnlHistory,
        equityCurve: portfolioSnapshot.filteredPerformance.equityCurve,
        exitReasonBreakdown: portfolioSnapshot.filteredPerformance.exitReasonBreakdown,
        documentedRules: PortfolioEngine.DOCUMENTED_PORTFOLIO_RULES
      });
    }

    return json(req, res, 200, portfolioSnapshot);
  }

  /* =====================================================
     TASK 12 — COMPLETE ORDERS, VIRTUAL FILLS & TRADE HISTORY ROUTES
     (Strict User Isolation + Validated Filters & Pagination)
  ===================================================== */

  if (
    url.pathname === '/api/orders' ||
    url.pathname === '/api/orders/fills' ||
    url.pathname === '/api/trades/history'
  ) {
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user order or trade history access is forbidden.'
      });
    }

    const rawQuery = {};
    for (const [k, v] of url.searchParams.entries()) {
      rawQuery[k] = v;
    }

    const queryCheck = OrderTradeHistoryEngine.validateAndNormalizeQuery(rawQuery);
    if (!queryCheck.ok) {
      return json(req, res, 400, {
        ok: false,
        code: queryCheck.code,
        message: queryCheck.message,
        errors: queryCheck.errors
      });
    }

    const rawOrders = db.listPaperOrders(1000, currentUserId);
    const rawFills = db.listPaperFills(1000, currentUserId);
    const rawTrades = db.listTradeHistory(1000, currentUserId);
    const openPos = db.getOpenPosition(currentUserId);

    const snapshot = OrderTradeHistoryEngine.buildOrderTradeHistorySnapshot({
      userId: currentUserId,
      orders: rawOrders,
      fills: rawFills,
      trades: rawTrades,
      openPosition: openPos,
      query: rawQuery
    });

    if (url.pathname === '/api/orders') {
      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        brokerExecution: 'NONE',
        userId: currentUserId,
        filtersApplied: snapshot.filtersApplied,
        summary: snapshot.summary,
        orders: snapshot.orders,
        pagination: snapshot.ordersPagination,
        documentedRules: OrderTradeHistoryEngine.DOCUMENTED_ORDER_TRADE_HISTORY_RULES
      });
    }

    if (url.pathname === '/api/orders/fills') {
      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        brokerExecution: 'NONE',
        userId: currentUserId,
        filtersApplied: snapshot.filtersApplied,
        summary: snapshot.summary,
        fills: snapshot.fills,
        pagination: snapshot.fillsPagination,
        documentedRules: OrderTradeHistoryEngine.DOCUMENTED_ORDER_TRADE_HISTORY_RULES
      });
    }

    if (url.pathname === '/api/trades/history') {
      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        brokerExecution: 'NONE',
        userId: currentUserId,
        filtersApplied: snapshot.filtersApplied,
        summary: snapshot.summary,
        trades: snapshot.trades,
        pagination: snapshot.tradesPagination,
        documentedRules: OrderTradeHistoryEngine.DOCUMENTED_ORDER_TRADE_HISTORY_RULES
      });
    }
  }

  if (url.pathname === '/api/audit/logs') {
    const category = url.searchParams.get('category') || null;
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user audit log access is forbidden.'
      });
    }

    return json(req, res, 200, {
      ok: true,
      userId: currentUserId,
      emergencyStop: db.getEmergencyStop(),
      logs: db.listAuditEvents(category, 100, currentUserId),
      aiDecisions: db.listAIDecisions(30, currentUserId),
      strategyDecisions: db.listStrategyDecisions(30, currentUserId),
      riskEvents: db.listRiskEvents(30, currentUserId)
    });
  }

  if (url.pathname === '/api/backtest/runs') {
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user backtest access is forbidden.'
      });
    }

    const limitParam = Number(url.searchParams.get('limit') || 20);
    return json(req, res, 200, {
      ok: true,
      mode: 'PAPER',
      liveTradingEnabled: false,
      userId: currentUserId,
      runs: db.listBacktestRuns(limitParam, currentUserId),
      documentedRules: Backtester.DOCUMENTED_BACKTEST_RULES
    });
  }

  if (url.pathname.startsWith('/api/backtest/runs/')) {
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user backtest access is forbidden.'
      });
    }

    const subPath = url.pathname.slice('/api/backtest/runs/'.length);
    const parts = subPath.split('/').filter(Boolean);
    const runId = parts[0] ? decodeURIComponent(parts[0]) : '';
    const isTradesSubroute = parts.length === 2 && parts[1] === 'trades';

    if (!runId || parts.length > 2 || (parts.length === 2 && !isTradesSubroute)) {
      return json(req, res, 404, {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Backtest route not found.'
      });
    }

    try {
      if (isTradesSubroute) {
        const tradesPayload = db.getBacktestRunTrades(runId, currentUserId);
        if (!tradesPayload) {
          return json(req, res, 404, {
            ok: false,
            code: 'BACKTEST_RUN_NOT_FOUND',
            message: `Backtest run '${runId}' was not found.`
          });
        }
        return json(req, res, 200, {
          ok: true,
          mode: 'PAPER',
          liveTradingEnabled: false,
          ...tradesPayload
        });
      }

      const runRecord = db.getBacktestRunById(runId, currentUserId);
      if (!runRecord) {
        return json(req, res, 404, {
          ok: false,
          code: 'BACKTEST_RUN_NOT_FOUND',
          message: `Backtest run '${runId}' was not found.`
        });
      }

      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        run: runRecord,
        documentedRules: Backtester.DOCUMENTED_BACKTEST_RULES
      });
    } catch (error) {
      const status = error.code === 'FORBIDDEN_OWNERSHIP' ? 403 : error.statusCode || 400;
      return json(req, res, status, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname === '/api/intelligence/status' || url.pathname === '/api/intelligence/feed') {
    const market = url.searchParams.get('market') || url.searchParams.get('exchange') || 'NSE';
    const symbol = url.searchParams.get('symbol') || '';
    const category = url.searchParams.get('category') || 'ALL';
    const refresh = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true';

    try {
      let intelPayload = await intelService.fetchMarketIntelligence({
        market,
        symbol: symbol || null,
        category,
        refresh
      });

      // Preserve backward-compatible MarketIntelligence.registerProvider fallback if used in tests
      if (
        intelPayload.status === 'DATA_UNAVAILABLE' &&
        typeof MarketIntelligence.hasConfiguredProvider === 'function' &&
        MarketIntelligence.hasConfiguredProvider()
      ) {
        const legacyIntel = await MarketIntelligence.getIntelligence({
          market,
          symbol: symbol || null,
          category
        });
        intelPayload = {
          ...intelPayload,
          ...legacyIntel,
          ok: true
        };
      }

      const safeStatus = intelService.getSafeIntelligenceStatus();
      const statusCode = intelPayload.status === 'RATE_LIMITED' ? 429 : 200;

      return json(req, res, statusCode, {
        ok: intelPayload.ok !== false,
        providerStatus: safeStatus,
        intelligence: intelPayload
      });
    } catch (error) {
      return json(req, res, error.statusCode || 500, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname === '/api/readiness') {
    const dbAudit = db.runDatabaseAuditAndIntegrityCheck();
    const envCheck = validateProductionEnvironment();
    const report = LiveReadinessAudit.runAudit({
      serverConfig: getSafePublicConfig()
    });
    const authorizedDiag = isDiagnosticsAuthorized(req, sessionCtx);
    const isReady = Boolean(report.ok && dbAudit.ok && envCheck.ok);

    if (!authorizedDiag) {
      return json(req, res, isReady ? 200 : 503, {
        ok: isReady,
        status: isReady ? 'READY' : 'NOT_READY',
        tradingMode: 'PAPER',
        liveTradingEnabled: false,
        orderEndpoints: 'NONE',
        databaseHealthy: Boolean(dbAudit.healthy),
        environmentValid: Boolean(envCheck.ok),
        totalChecks: report.totalChecks,
        passedChecks: report.passedChecks,
        failedChecks: report.failedChecks,
        timestamp: report.timestamp
      });
    }

    return json(req, res, isReady ? 200 : 503, {
      ...report,
      ok: isReady,
      productionEnvironment: envCheck,
      databaseAudit: dbAudit
    });
  }

  if (url.pathname === '/api/readiness/audit') {
    if (!isDiagnosticsAuthorized(req, sessionCtx)) {
      return json(req, res, 401, {
        ok: false,
        code: 'DIAGNOSTICS_UNAUTHORIZED',
        message: 'Authentication is required to access detailed readiness audit diagnostics.'
      });
    }
    const dbAudit = db.runDatabaseAuditAndIntegrityCheck();
    const envCheck = validateProductionEnvironment();
    const report = LiveReadinessAudit.runAudit({
      serverConfig: getSafePublicConfig()
    });
    const isReady = Boolean(report.ok && dbAudit.ok && envCheck.ok);
    return json(req, res, isReady ? 200 : 503, {
      ...report,
      ok: isReady,
      productionEnvironment: envCheck,
      databaseAudit: dbAudit
    });
  }

  if (url.pathname === '/api/database/audit') {
    if (!isDiagnosticsAuthorized(req, sessionCtx)) {
      return json(req, res, 401, {
        ok: false,
        code: 'DIAGNOSTICS_UNAUTHORIZED',
        message: 'Authentication is required to access detailed database audit diagnostics.'
      });
    }
    const dbAudit = db.runDatabaseAuditAndIntegrityCheck();
    return json(req, res, dbAudit.ok ? 200 : 503, {
      ok: dbAudit.ok,
      mode: 'PAPER',
      liveTradingEnabled: false,
      brokerExecution: 'NONE',
      databaseAudit: dbAudit
    });
  }

  if (url.pathname === '/api/watchlist' || url.pathname === '/api/watchlist/quotes') {
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user watchlist access is forbidden.'
      });
    }
    const rawItems = db.listWatchlist(currentUserId);
    const enrichQuotes =
      url.pathname === '/api/watchlist/quotes' ||
      url.searchParams.get('enrich') === '1' ||
      url.searchParams.get('enrich') === 'true';
    const liveFetch =
      url.searchParams.get('live') === '1' || url.searchParams.get('live') === 'true';

    const quotesByKey = {};
    for (const item of rawItems) {
      let snap =
        typeof db.getMarketSnapshotCache === 'function'
          ? db.getMarketSnapshotCache(item.tradingsymbol) ||
            db.getMarketSnapshotCache(item.symbol)
          : null;

      if (liveFetch && (!snap || url.searchParams.get('refresh') === '1')) {
        try {
          const liveQuote = await pipeline.getQuoteBySearch(
            item.exchange || 'NSE',
            item.symbol || item.tradingsymbol,
            item.tradingsymbol || undefined
          );
          if (liveQuote && liveQuote.ok !== false) {
            snap = {
              symbol: item.tradingsymbol || item.symbol,
              exchange: item.exchange || 'NSE',
              price: liveQuote.ltp ?? liveQuote.price ?? null,
              change: liveQuote.change ?? null,
              changePct: liveQuote.changePct ?? null,
              open: liveQuote.open ?? null,
              high: liveQuote.high ?? null,
              low: liveQuote.low ?? null,
              close: liveQuote.close ?? null,
              volume: liveQuote.volume ?? null,
              provider: liveQuote.provider || 'ANGEL_ONE',
              status: 'VALIDATED',
              dataReady: true,
              quoteTimestamp: liveQuote.timestamp || new Date().toISOString()
            };
          }
        } catch (_) {
          // Zero-fabrication fallback: keep cached or mark QUOTE_UNAVAILABLE
        }
      }

      if (snap) {
        quotesByKey[item.instrumentKey] = snap;
        quotesByKey[item.tradingsymbol] = snap;
        quotesByKey[item.symbol] = snap;
      }
    }

    const enrichedSnapshot = WatchlistAlertEngine.buildWatchlistSnapshot({
      userId: currentUserId,
      items: rawItems,
      quotesByKey
    });

    const itemsOut = enrichQuotes ? enrichedSnapshot.items : rawItems.map((item, idx) => {
      const enriched = enrichedSnapshot.items[idx] || {};
      return {
        ...item,
        quote: enriched.quote || null
      };
    });

    return json(req, res, 200, {
      ok: true,
      mode: 'PAPER',
      liveTradingEnabled: false,
      userId: currentUserId,
      watchlist: itemsOut,
      summary: enrichedSnapshot.summary,
      documentedRules: WatchlistAlertEngine.DOCUMENTED_WATCHLIST_ALERT_RULES
    });
  }

  if (url.pathname === '/api/alerts') {
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user market alerts access is forbidden.'
      });
    }

    const filters = {
      status: url.searchParams.get('status') || 'ALL',
      symbol: url.searchParams.get('symbol') || url.searchParams.get('instrument') || '',
      alertType: url.searchParams.get('alertType') || url.searchParams.get('type') || 'ALL',
      limit: Number(url.searchParams.get('limit') || 200)
    };

    const alerts = db.listMarketAlerts(filters, currentUserId);
    const activeCount = alerts.filter((a) => a.status === 'ACTIVE').length;
    const pausedCount = alerts.filter((a) => a.status === 'PAUSED').length;
    const triggeredCount = alerts.filter((a) => a.status === 'TRIGGERED').length;

    return json(req, res, 200, {
      ok: true,
      mode: 'PAPER',
      liveTradingEnabled: false,
      brokerExecution: 'NONE',
      userId: currentUserId,
      summary: {
        totalAlerts: alerts.length,
        activeCount,
        pausedCount,
        triggeredCount
      },
      alerts,
      documentedRules: WatchlistAlertEngine.DOCUMENTED_WATCHLIST_ALERT_RULES
    });
  }

  if (url.pathname === '/api/alerts/events' || url.pathname === '/api/alerts/history') {
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user alert event history access is forbidden.'
      });
    }

    const filters = {
      symbol: url.searchParams.get('symbol') || url.searchParams.get('instrument') || '',
      alertType: url.searchParams.get('alertType') || url.searchParams.get('type') || 'ALL',
      acknowledged: url.searchParams.get('acknowledged'),
      fromDate: url.searchParams.get('fromDate') || url.searchParams.get('from') || '',
      toDate: url.searchParams.get('toDate') || url.searchParams.get('to') || '',
      limit: Number(url.searchParams.get('limit') || 200)
    };

    const events = db.listAlertEventsHistory(filters, currentUserId);
    const unacknowledgedCount = events.filter((e) => !e.acknowledged).length;

    return json(req, res, 200, {
      ok: true,
      mode: 'PAPER',
      liveTradingEnabled: false,
      brokerExecution: 'NONE',
      userId: currentUserId,
      unacknowledgedCount,
      events,
      documentedRules: WatchlistAlertEngine.DOCUMENTED_WATCHLIST_ALERT_RULES
    });
  }

  /* =====================================================
     TASK 15 — ALERT NOTIFICATIONS CENTER & PREFERENCES GET ROUTES
  ===================================================== */

  if (url.pathname === '/api/notifications') {
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user notifications access is forbidden.'
      });
    }

    const rawQuery = {};
    for (const [k, v] of url.searchParams.entries()) {
      rawQuery[k] = v;
    }

    const listResult = db.listUserNotifications(rawQuery, currentUserId);
    if (!listResult.ok) {
      return json(req, res, 400, {
        ok: false,
        code: listResult.code || 'INVALID_NOTIFICATION_FILTER',
        message: listResult.message || 'Invalid notification query parameters.'
      });
    }

    const preferences = db.getUserNotificationPreferences(currentUserId);
    const externalChannels = notificationDelivery.getSafeExternalChannelStatus();

    return json(req, res, 200, {
      ok: true,
      mode: 'PAPER',
      liveTradingEnabled: false,
      brokerExecution: 'NONE',
      userId: currentUserId,
      unreadCount: listResult.unreadCount,
      totalCount: listResult.totalCount,
      filteredCount: listResult.filteredCount,
      categoryCounts: listResult.categoryCounts,
      pagination: listResult.pagination,
      filtersApplied: listResult.filtersApplied,
      notifications: listResult.notifications,
      preferences,
      externalChannels,
      documentedRules: NotificationEngine.DOCUMENTED_NOTIFICATION_RULES
    });
  }

  if (
    url.pathname === '/api/notifications/preferences' ||
    url.pathname === '/api/user/notification-preferences'
  ) {
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user notification preferences access is forbidden.'
      });
    }

    const preferences = db.getUserNotificationPreferences(currentUserId);
    const externalChannels = notificationDelivery.getSafeExternalChannelStatus();

    return json(req, res, 200, {
      ok: true,
      mode: 'PAPER',
      liveTradingEnabled: false,
      brokerExecution: 'NONE',
      userId: currentUserId,
      preferences,
      externalChannels,
      documentedRules: NotificationEngine.DOCUMENTED_NOTIFICATION_RULES
    });
  }

  if (url.pathname === '/api/notifications/delivery') {
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user notification delivery logs access is forbidden.'
      });
    }
    try {
      const notificationId = url.searchParams.get('notificationId') || null;
      const limit = Number(url.searchParams.get('limit') || 100);
      const deliveries = db.listNotificationDeliveryLogs(notificationId, currentUserId, limit);
      const externalChannels = notificationDelivery.getSafeExternalChannelStatus();
      return json(req, res, 200, {
        ok: true,
        mode: 'PAPER',
        liveTradingEnabled: false,
        userId: currentUserId,
        deliveries,
        externalChannels
      });
    } catch (error) {
      const status = error.code === 'FORBIDDEN_OWNERSHIP' ? 403 : error.statusCode || 400;
      return json(req, res, status, { ok: false, ...safeError(error) });
    }
  }

  if (url.pathname === '/api/search/recent') {
    const requestedOwner = url.searchParams.get('userId');
    if (requestedOwner && String(requestedOwner) !== String(currentUserId || '')) {
      return json(req, res, 403, {
        ok: false,
        code: 'FORBIDDEN_OWNERSHIP',
        message: 'Cross-user recent searches access is forbidden.'
      });
    }
    return json(req, res, 200, {
      ok: true,
      userId: currentUserId,
      recent: db.listRecentSearches(12, currentUserId)
    });
  }

  if (url.pathname === '/api/instruments/search') {
    const rl = checkEndpointRateLimit('MARKET_DATA', currentUserId || getClientIp(req));
    if (!rl.allowed) {
      return json(
        req,
        res,
        429,
        {
          ok: false,
          code: 'RATE_LIMITED',
          message: `Too many instrument search requests. Please retry after ${rl.retryAfterSeconds}s.`,
          retryAfterSeconds: rl.retryAfterSeconds
        },
        { 'Retry-After': String(rl.retryAfterSeconds) }
      );
    }
    const exchange = url.searchParams.get('exchange') || '';
    const query = url.searchParams.get('q') || '';

    try {
      const activeProvider = getConfig().provider;
      const searchResponse =
        activeProvider === 'TWELVE_DATA'
          ? await twelveData.searchScrip(exchange, query)
          : await search.searchScrip(exchange, query);
      const results = Array.isArray(searchResponse.results) ? searchResponse.results : [];
      if (results.length > 0 && typeof db.cacheBrokerSearchResults === 'function') {
        try {
          db.cacheBrokerSearchResults(results, searchResponse.provider || 'ANGEL_ONE');
        } catch (_) {}
      }

      return json(req, res, 200, {
        ok: true,
        provider: searchResponse.provider || 'ANGEL_ONE',
        exchange: searchResponse.exchange,
        query: searchResponse.query,
        results
      });
    } catch (error) {
      return json(req, res, 400, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname === '/api/market/quote') {
    const rl = checkEndpointRateLimit('MARKET_DATA', currentUserId || getClientIp(req));
    if (!rl.allowed) {
      return json(
        req,
        res,
        429,
        {
          ok: false,
          code: 'RATE_LIMITED',
          message: `Too many market quote requests. Please retry after ${rl.retryAfterSeconds}s.`,
          retryAfterSeconds: rl.retryAfterSeconds
        },
        { 'Retry-After': String(rl.retryAfterSeconds) }
      );
    }
    const exchange = url.searchParams.get('exchange') || '';
    const query = url.searchParams.get('q') || '';
    const exactSymbol = url.searchParams.get('symbol') || '';

    try {
      const quote = await pipeline.getQuoteBySearch(
        exchange,
        query,
        exactSymbol || undefined
      );

      return json(req, res, 200, quote);
    } catch (error) {
      return json(req, res, 400, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname === '/api/market/candles') {
    const rl = checkEndpointRateLimit('MARKET_DATA', currentUserId || getClientIp(req));
    if (!rl.allowed) {
      return json(
        req,
        res,
        429,
        {
          ok: false,
          code: 'RATE_LIMITED',
          message: `Too many candle requests. Please retry after ${rl.retryAfterSeconds}s.`,
          retryAfterSeconds: rl.retryAfterSeconds
        },
        { 'Retry-After': String(rl.retryAfterSeconds) }
      );
    }
    const exchange = url.searchParams.get('exchange') || '';
    const query = url.searchParams.get('q') || '';
    const exactSymbol = url.searchParams.get('symbol') || '';
    const interval = url.searchParams.get('interval') || 'FIVE_MINUTE';
    const fromdate = url.searchParams.get('fromdate') || undefined;
    const todate = url.searchParams.get('todate') || undefined;

    try {
      const candlesResult = await pipeline.getCandlesBySearch(
        exchange,
        query,
        exactSymbol || undefined,
        { interval, fromdate, todate }
      );

      return json(req, res, 200, candlesResult);
    } catch (error) {
      return json(req, res, 400, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname.startsWith('/api/')) {
    return json(req, res, 404, {
      ok: false,
      code: 'NOT_FOUND',
      message: 'API route not found.'
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(req, res, 405, {
      ok: false,
      code: 'METHOD_NOT_ALLOWED'
    });
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const safeRelative = path.normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.resolve(WEB_DIR, '.' + (safeRelative.startsWith('/') ? safeRelative : '/' + safeRelative));

  if (!filePath.startsWith(WEB_DIR)) {
    return json(req, res, 403, { ok: false, code: 'FORBIDDEN' });
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      return json(req, res, 404, { ok: false, code: 'NOT_FOUND' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await fs.promises.readFile(filePath);

    const staticHeaders = {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      ...buildSecurityHeaders(req)
    };
    if (safeRelative === '/sw.js') {
      staticHeaders['Service-Worker-Allowed'] = '/';
    }

    res.writeHead(200, staticHeaders);
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (_) {
    return json(req, res, 404, {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Static resource not found.'
    });
  }
}

function createServer() {
  db.getDb();
  const srv = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      json(req, res, 500, {
        ok: false,
        ...safeError(error)
      });
    });
  });
  srv.keepAliveTimeout = 65000;
  srv.headersTimeout = 66000;
  return srv;
}

function setupGracefulShutdown(server, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 5000);
  let shuttingDown = false;

  async function shutdown(signal = 'SIGTERM') {
    if (shuttingDown) return { ok: true, alreadyShuttingDown: true };
    shuttingDown = true;

    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (typeof server.closeAllConnections === 'function') {
          try {
            server.closeAllConnections();
          } catch (_) {}
        }
        resolve();
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      try {
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      } catch (_) {
        clearTimeout(timer);
        resolve();
      }
    });

    try {
      if (typeof db.checkpointWal === 'function') {
        db.checkpointWal('TRUNCATE');
      }
    } catch (_) {}

    try {
      db.closeDb();
    } catch (_) {}

    return { ok: true, signal, closedAt: new Date().toISOString() };
  }

  if (options.attachProcessSignals !== false) {
    const onSigTerm = () => {
      shutdown('SIGTERM').finally(() => process.exit(0));
    };
    const onSigInt = () => {
      shutdown('SIGINT').finally(() => process.exit(0));
    };
    process.once('SIGTERM', onSigTerm);
    process.once('SIGINT', onSigInt);
  }

  return { shutdown };
}

if (require.main === module) {
  const envValidation = validateProductionEnvironment();
  const server = createServer();
  setupGracefulShutdown(server, { attachProcessSignals: true });
  server.listen(PORT, HOST, () => {
    console.log(`YASHWIN API SERVER listening on http://${HOST}:${PORT}`);
    console.log(`NODE_ENV=${envValidation.nodeEnv}`);
    console.log('MODE=READ_ONLY');
    console.log(`TRADING_MODE=${envValidation.tradingMode}`);
    console.log('LIVE_TRADING_ENABLED=false');
    console.log('ORDER_ENDPOINTS=NONE');
  });
}

module.exports = {
  createServer,
  setupGracefulShutdown,
  handle,
  isTrustedOrigin,
  isTrustedProxyEnabled,
  isHttpsRequestContext,
  isDiagnosticsAuthorized,
  getClientIp,
  ALLOWED_DEV_ORIGINS,
  SECURITY_HEADERS,
  SECURITY_CSP,
  buildSecurityHeaders,
  checkEndpointRateLimit,
  resetApiRateLimitsForTest,
  sanitizeErrorMessage
};
