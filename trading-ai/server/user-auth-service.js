'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Task 2 — Complete User Account & Session Security Service
 *
 * Strictly enforces:
 * - Server-side registration validation (name, email, password strength)
 * - Duplicate email rejection (case-insensitive normalized email)
 * - Secure password hashing with bcrypt (10 rounds, never stores plain-text password)
 * - Immutable unique user ID (USR-<UUID>)
 * - Server-managed sessions with SHA-256 hashed session tokens in SQLite
 * - Secure HttpOnly SameSite=Lax cookies (Secure flag in production)
 * - Session expiry & logout invalidation
 * - Login rate limiting per IP / normalized email
 * - CSRF token generation & constant-time validation for cookie-authenticated mutations
 * - Profile management (view, edit name/settings, email change with verification if delivery service configured, password change with current-password verification)
 * - Completely separate from Angel One read-only broker authentication
 */

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('./database');
const AuditLogger = require('../web/modules/audit-logger');

const SESSION_COOKIE_NAME = 'yashwin_sid';
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const EMAIL_VERIFY_TTL_MS = 30 * 60 * 1000; // 30 minutes
const BCRYPT_ROUNDS = 10;

// Rate limiter configuration: max 5 failed login attempts per 15-minute window
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const loginAttempts = new Map();

// Optional pluggable email delivery service for email change verification
let emailDeliveryProvider = null;

function setEmailDeliveryProvider(provider) {
  emailDeliveryProvider =
    provider && typeof provider.sendEmailChangeVerification === 'function'
      ? provider
      : null;
}

function isEmailDeliveryConfigured() {
  return Boolean(
    emailDeliveryProvider ||
      String(process.env.EMAIL_DELIVERY_ENABLED || '').toLowerCase() === 'true'
  );
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function generateSecureToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateImmutableUserId() {
  return `USR-${crypto.randomUUID()}`;
}

function validateName(name) {
  const clean = String(name || '').trim();
  if (!clean || clean.length < 2) {
    const err = new Error('Name must be at least 2 characters long.');
    err.code = 'INVALID_NAME';
    throw err;
  }
  if (clean.length > 80) {
    const err = new Error('Name cannot exceed 80 characters.');
    err.code = 'INVALID_NAME';
    throw err;
  }
  return clean;
}

function validateEmail(email) {
  const clean = String(email || '').trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!clean || clean.length > 160 || !emailRegex.test(clean)) {
    const err = new Error('Please enter a valid email address.');
    err.code = 'INVALID_EMAIL';
    throw err;
  }
  return clean;
}

function validatePassword(password) {
  const raw = String(password ?? '');
  if (raw.length < 8) {
    const err = new Error('Password must be at least 8 characters long.');
    err.code = 'WEAK_PASSWORD';
    throw err;
  }
  if (raw.length > 128) {
    const err = new Error('Password cannot exceed 128 characters.');
    err.code = 'INVALID_PASSWORD';
    throw err;
  }
  const hasLetter = /[A-Za-z]/.test(raw);
  const hasNumber = /\d/.test(raw);
  if (!hasLetter || !hasNumber) {
    const err = new Error('Password must contain at least one letter and one number.');
    err.code = 'WEAK_PASSWORD';
    throw err;
  }
  return raw;
}

async function hashPassword(plainPassword) {
  const valid = validatePassword(plainPassword);
  return bcrypt.hash(valid, BCRYPT_ROUNDS);
}

async function verifyPassword(plainPassword, passwordHash) {
  if (!plainPassword || !passwordHash) return false;
  try {
    return await bcrypt.compare(String(plainPassword), String(passwordHash));
  } catch (_) {
    return false;
  }
}

/* =====================================================
   LOGIN RATE LIMITER
===================================================== */

function getRateLimitKey(ip, email) {
  const normIp = String(ip || '127.0.0.1').trim();
  const normEmail = db.normalizeEmail(email);
  return `${normIp}|${normEmail || 'unknown'}`;
}

function checkLoginRateLimit(ip, email, nowMs = Date.now()) {
  const key = getRateLimitKey(ip, email);
  const entry = loginAttempts.get(key);
  if (!entry) {
    return { allowed: true, remaining: RATE_LIMIT_MAX_ATTEMPTS };
  }

  if (nowMs - entry.firstAttemptMs >= RATE_LIMIT_WINDOW_MS) {
    loginAttempts.delete(key);
    return { allowed: true, remaining: RATE_LIMIT_MAX_ATTEMPTS };
  }

  if (entry.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil(
      (RATE_LIMIT_WINDOW_MS - (nowMs - entry.firstAttemptMs)) / 1000
    );
    const err = new Error(
      `Too many failed login attempts. Please wait ${retryAfterSec}s before trying again.`
    );
    err.code = 'LOGIN_RATE_LIMITED';
    err.statusCode = 429;
    err.retryAfterSeconds = retryAfterSec;
    throw err;
  }

  return {
    allowed: true,
    remaining: Math.max(0, RATE_LIMIT_MAX_ATTEMPTS - entry.count)
  };
}

function recordFailedLoginAttempt(ip, email, nowMs = Date.now()) {
  const key = getRateLimitKey(ip, email);
  const existing = loginAttempts.get(key);
  if (!existing || nowMs - existing.firstAttemptMs >= RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(key, {
      count: 1,
      firstAttemptMs: nowMs,
      lastAttemptMs: nowMs
    });
  } else {
    existing.count += 1;
    existing.lastAttemptMs = nowMs;
  }
}

function clearLoginRateLimit(ip, email) {
  const key = getRateLimitKey(ip, email);
  loginAttempts.delete(key);
}

function resetRateLimitsForTest() {
  loginAttempts.clear();
}

/* =====================================================
   COOKIE & CSRF HELPERS
===================================================== */

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return list;

  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) return;
    try {
      list[key] = decodeURIComponent(val);
    } catch (_) {
      list[key] = val;
    }
  });
  return list;
}

function isProductionEnv(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function buildSessionSetCookieHeader(rawToken, options = {}) {
  const maxAgeSec = Math.max(
    0,
    Math.floor((options.ttlMs ?? DEFAULT_SESSION_TTL_MS) / 1000)
  );
  const secure =
    options.secure !== undefined ? Boolean(options.secure) : isProductionEnv();

  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`
  ];

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function buildClearSessionCookieHeader(options = {}) {
  const secure =
    options.secure !== undefined ? Boolean(options.secure) : isProductionEnv();

  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function verifyCsrfToken(expectedToken, providedToken) {
  if (!expectedToken || !providedToken) return false;
  const a = Buffer.from(String(expectedToken), 'utf8');
  const b = Buffer.from(String(providedToken), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extractRequestSession(req, nowMs = Date.now()) {
  const cookies = parseCookies(req?.headers?.cookie || '');
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;

  const tokenHash = sha256Hex(rawToken);
  const active = db.getActiveSessionByTokenHash(tokenHash, nowMs);
  if (!active) return null;

  db.touchSession(active.session.sessionId);
  return {
    ...active,
    rawToken,
    tokenHash
  };
}

function assertCsrfForMutation(req, sessionContext) {
  if (!sessionContext || !sessionContext.session) {
    const err = new Error('Authentication required.');
    err.code = 'UNAUTHENTICATED';
    err.statusCode = 401;
    throw err;
  }

  const headerToken =
    req?.headers?.['x-csrf-token'] || req?.headers?.['X-CSRF-Token'] || '';
  if (!verifyCsrfToken(sessionContext.session.csrfToken, headerToken)) {
    const err = new Error('Invalid or missing CSRF token.');
    err.code = 'CSRF_TOKEN_INVALID';
    err.statusCode = 403;
    throw err;
  }
}

/* =====================================================
   CORE USER OPERATIONS (REGISTER, LOGIN, LOGOUT, PROFILE)
===================================================== */

async function registerUser(input = {}, reqMeta = {}) {
  const name = validateName(input.name);
  const email = validateEmail(input.email);
  const password = validatePassword(input.password);

  const existing = db.getUserByEmail(email, false);
  if (existing) {
    const err = new Error('An account with this email already exists.');
    err.code = 'DUPLICATE_EMAIL';
    err.statusCode = 409;
    throw err;
  }

  const userId = generateImmutableUserId();
  const passwordHash = await hashPassword(password);
  const nowIso = new Date().toISOString();

  const user = db.createUserRecord({
    userId,
    name,
    email,
    passwordHash,
    passwordAlgo: 'bcrypt',
    emailVerified: true,
    settings: {
      theme: 'dark',
      notifications: true
    },
    createdAt: nowIso
  });

  const sessionData = createSessionForUser(user.userId, reqMeta);

  AuditLogger.record(
    'AUTH_EVENT',
    `YASHWIN user registered: ${user.emailNormalized}`,
    {
      userId: user.userId,
      email: user.emailNormalized,
      authDomain: 'YASHWIN_USER_ACCOUNT'
    }
  );
  db.insertAuditEvent(
    {
      category: 'AUTH_EVENT',
      message: `YASHWIN user registered: ${user.emailNormalized}`,
      details: { userId: user.userId, email: user.emailNormalized }
    },
    user.userId
  );

  return {
    ok: true,
    user,
    session: sessionData.session,
    csrfToken: sessionData.session.csrfToken,
    rawSessionToken: sessionData.rawToken,
    cookieHeader: sessionData.cookieHeader
  };
}

function createSessionForUser(userId, reqMeta = {}) {
  const rawToken = generateSecureToken(32);
  const tokenHash = sha256Hex(rawToken);
  const csrfToken = generateSecureToken(24);
  const sessionId = `SES-${crypto.randomUUID()}`;
  const nowMs = reqMeta.nowMs || Date.now();
  const ttlMs = reqMeta.ttlMs || DEFAULT_SESSION_TTL_MS;
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlMs).toISOString();

  const session = db.createSessionRecord({
    sessionId,
    userId,
    tokenHash,
    csrfToken,
    ipAddress: reqMeta.ipAddress || null,
    userAgent: reqMeta.userAgent || null,
    createdAt,
    expiresAt
  });

  const cookieHeader = buildSessionSetCookieHeader(rawToken, {
    ttlMs,
    secure: reqMeta.secure
  });

  return {
    session,
    rawToken,
    cookieHeader
  };
}

async function loginUser(input = {}, reqMeta = {}) {
  const email = validateEmail(input.email);
  const password = String(input.password ?? '');
  const ip = reqMeta.ipAddress || '127.0.0.1';
  const nowMs = reqMeta.nowMs || Date.now();

  checkLoginRateLimit(ip, email, nowMs);

  const userWithSecrets = db.getUserByEmail(email, true);
  if (!userWithSecrets) {
    recordFailedLoginAttempt(ip, email, nowMs);
    const err = new Error('Invalid email or password.');
    err.code = 'INVALID_CREDENTIALS';
    err.statusCode = 401;
    throw err;
  }

  const matched = await verifyPassword(password, userWithSecrets.passwordHash);
  if (!matched) {
    recordFailedLoginAttempt(ip, email, nowMs);
    const err = new Error('Invalid email or password.');
    err.code = 'INVALID_CREDENTIALS';
    err.statusCode = 401;
    throw err;
  }

  clearLoginRateLimit(ip, email);

  const user = db.getUserById(userWithSecrets.userId, false);
  const sessionData = createSessionForUser(user.userId, reqMeta);

  db.insertAuditEvent(
    {
      category: 'AUTH_EVENT',
      message: `YASHWIN user logged in: ${user.emailNormalized}`,
      details: { userId: user.userId, authDomain: 'YASHWIN_USER_ACCOUNT' }
    },
    user.userId
  );

  return {
    ok: true,
    user,
    session: sessionData.session,
    csrfToken: sessionData.session.csrfToken,
    rawSessionToken: sessionData.rawToken,
    cookieHeader: sessionData.cookieHeader
  };
}

function logoutSession(req, options = {}) {
  const cookies = parseCookies(req?.headers?.cookie || '');
  const rawToken = options.rawToken || cookies[SESSION_COOKIE_NAME];
  let revoked = false;
  let userId = null;

  if (rawToken) {
    const tokenHash = sha256Hex(rawToken);
    const active = db.getActiveSessionByTokenHash(tokenHash);
    if (active?.user?.userId) {
      userId = active.user.userId;
    }
    revoked = db.revokeSessionByTokenHash(tokenHash);
  }

  if (userId) {
    db.insertAuditEvent(
      {
        category: 'AUTH_EVENT',
        message: 'YASHWIN user logged out and session invalidated',
        details: { userId, revoked }
      },
      userId
    );
  }

  return {
    ok: true,
    revoked,
    clearCookieHeader: buildClearSessionCookieHeader(options)
  };
}

function getProfile(userId) {
  const user = db.getUserById(userId, false);
  if (!user) {
    const err = new Error('User not found.');
    err.code = 'USER_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  const pendingEmailChange = db.getPendingEmailChangeForUser(userId);
  const paperAccount = db.getPaperAccount(userId);

  return {
    ok: true,
    user,
    pendingEmailChange,
    emailDeliveryConfigured: isEmailDeliveryConfigured(),
    paperAccount
  };
}

async function updateProfile(userId, payload = {}) {
  const userWithSecrets = db.getUserById(userId, true);
  if (!userWithSecrets) {
    const err = new Error('User not found.');
    err.code = 'USER_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  // Immutable userId enforcement: reject attempts to mutate userId
  if (
    payload.userId !== undefined &&
    String(payload.userId) !== String(userWithSecrets.userId)
  ) {
    const err = new Error('User ID is immutable and cannot be changed.');
    err.code = 'IMMUTABLE_USER_ID';
    err.statusCode = 400;
    throw err;
  }

  let updatedUser = db.getUserById(userId, false);
  let emailChangeResult = null;

  if (payload.name !== undefined || payload.settings !== undefined) {
    const nextName =
      payload.name !== undefined ? validateName(payload.name) : updatedUser.name;
    updatedUser = db.updateUserNameAndSettings(userId, {
      name: nextName,
      settings: payload.settings
    });
  }

  if (
    payload.email !== undefined &&
    db.normalizeEmail(payload.email) !== userWithSecrets.emailNormalized
  ) {
    const newEmail = validateEmail(payload.email);

    if (isEmailDeliveryConfigured() || payload.requireVerification === true) {
      const rawVerifyToken = generateSecureToken(24);
      const tokenHash = sha256Hex(rawVerifyToken);
      const verificationId = `EMV-${crypto.randomUUID()}`;
      const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS).toISOString();

      const pending = db.createEmailChangeVerification({
        verificationId,
        userId,
        newEmail,
        tokenHash,
        expiresAt
      });

      if (emailDeliveryProvider) {
        await emailDeliveryProvider.sendEmailChangeVerification({
          userId,
          oldEmail: userWithSecrets.email,
          newEmail,
          verificationToken: rawVerifyToken,
          expiresAt
        });
      }

      emailChangeResult = {
        status: 'VERIFICATION_REQUIRED',
        pendingEmailChange: pending,
        verificationTokenSent: Boolean(emailDeliveryProvider)
      };
    } else {
      updatedUser = db.updateUserEmailDirect(userId, newEmail);
      emailChangeResult = {
        status: 'UPDATED_DIRECTLY',
        email: updatedUser.email
      };
    }
  }

  db.insertAuditEvent(
    {
      category: 'AUTH_EVENT',
      message: 'YASHWIN user profile updated',
      details: {
        userId,
        emailChangeStatus: emailChangeResult?.status || 'NONE'
      }
    },
    userId
  );

  return {
    ok: true,
    user: updatedUser,
    emailChange: emailChangeResult,
    pendingEmailChange: db.getPendingEmailChangeForUser(userId)
  };
}

function verifyEmailChangeToken(rawToken, userId = null) {
  if (!rawToken || typeof rawToken !== 'string') {
    const err = new Error('Verification token is required.');
    err.code = 'INVALID_VERIFICATION_TOKEN';
    err.statusCode = 400;
    throw err;
  }

  const tokenHash = sha256Hex(rawToken.trim());
  const updatedUser = db.confirmEmailChangeByTokenHash(tokenHash, userId);

  db.insertAuditEvent(
    {
      category: 'AUTH_EVENT',
      message: `YASHWIN user email verified and updated to ${updatedUser.emailNormalized}`,
      details: { userId: updatedUser.userId }
    },
    updatedUser.userId
  );

  return {
    ok: true,
    user: updatedUser
  };
}

async function changePassword(userId, payload = {}, currentSessionId = null) {
  const currentPassword = String(payload.currentPassword ?? '');
  const newPassword = String(payload.newPassword ?? '');

  if (!currentPassword) {
    const err = new Error('Current password is required.');
    err.code = 'CURRENT_PASSWORD_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  const userWithSecrets = db.getUserById(userId, true);
  if (!userWithSecrets) {
    const err = new Error('User not found.');
    err.code = 'USER_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  const matchesCurrent = await verifyPassword(
    currentPassword,
    userWithSecrets.passwordHash
  );
  if (!matchesCurrent) {
    const err = new Error('Current password is incorrect.');
    err.code = 'INVALID_CURRENT_PASSWORD';
    err.statusCode = 401;
    throw err;
  }

  validatePassword(newPassword);
  if (currentPassword === newPassword) {
    const err = new Error('New password must be different from current password.');
    err.code = 'SAME_PASSWORD';
    err.statusCode = 400;
    throw err;
  }

  const newHash = await hashPassword(newPassword);
  const updatedUser = db.updateUserPasswordHash(userId, newHash, 'bcrypt');

  // Revoke other active sessions for this user while keeping current session active
  if (currentSessionId) {
    db.revokeAllUserSessions(userId, currentSessionId);
  }

  db.insertAuditEvent(
    {
      category: 'AUTH_EVENT',
      message: 'YASHWIN user changed account password',
      details: { userId }
    },
    userId
  );

  return {
    ok: true,
    user: updatedUser
  };
}

module.exports = {
  SESSION_COOKIE_NAME,
  DEFAULT_SESSION_TTL_MS,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  setEmailDeliveryProvider,
  isEmailDeliveryConfigured,
  sha256Hex,
  generateSecureToken,
  generateImmutableUserId,
  validateName,
  validateEmail,
  validatePassword,
  hashPassword,
  verifyPassword,
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  clearLoginRateLimit,
  resetRateLimitsForTest,
  parseCookies,
  buildSessionSetCookieHeader,
  buildClearSessionCookieHeader,
  verifyCsrfToken,
  extractRequestSession,
  assertCsrfForMutation,
  registerUser,
  createSessionForUser,
  loginUser,
  logoutSession,
  getProfile,
  updateProfile,
  verifyEmailChangeToken,
  changePassword
};
