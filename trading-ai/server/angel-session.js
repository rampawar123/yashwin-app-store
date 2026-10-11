'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — Step 16
 * Angel One secure SmartAPI session manager
 *
 * Credentials stay server-side.
 * No browser credentials.
 * No order placement.
 * No fake market data.
 */

const { getConfig } = require('./config');
const adapter = require('./angel-smartapi');
const totp = require('./totp');

let session = {
  status: 'DISCONNECTED',
  accessToken: null,
  refreshToken: null,
  feedToken: null,
  createdAt: null
};

function clearSession() {
  session = {
    status: 'DISCONNECTED',
    accessToken: null,
    refreshToken: null,
    feedToken: null,
    createdAt: null
  };
}

function getSafeStatus() {
  const currentConfig = getConfig();
  return {
    provider: currentConfig.provider,
    status: session.status,
    authenticated: Boolean(session.accessToken && session.status === 'CONNECTED'),
    createdAt: session.createdAt
  };
}

function requireCredentials(cfg = getConfig()) {
  const missing = [];

  if (!cfg.angel.apiKey) missing.push('ANGEL_API_KEY');
  if (!cfg.angel.clientId) missing.push('ANGEL_CLIENT_ID');
  if (!cfg.angel.pin) missing.push('ANGEL_PIN');
  if (!cfg.angel.totpSecret) missing.push('ANGEL_TOTP_SECRET');

  if (missing.length) {
    const error = new Error('Angel One credentials are not configured.');
    error.code = 'ANGEL_CREDENTIALS_MISSING';
    error.missing = missing;
    throw error;
  }

  const totpCheck = totp.validateTOTPSecret(cfg.angel.totpSecret);
  if (!totpCheck.valid) {
    const error = new Error(totpCheck.message || 'Invalid TOTP secret format.');
    error.code = totpCheck.code || 'INVALID_TOTP_SECRET';
    throw error;
  }
}

async function login() {
  const currentConfig = getConfig();

  try {
    requireCredentials(currentConfig);
  } catch (error) {
    clearSession();
    session.status = 'AUTHENTICATION_FAILED';
    throw error;
  }

  let api;
  try {
    api = adapter.createAngelSmartAPI({
      apiKey: currentConfig.angel.apiKey
    });
  } catch (error) {
    clearSession();
    session.status = 'AUTHENTICATION_FAILED';
    throw error;
  }

  if (!api || typeof api.generateSession !== 'function') {
    clearSession();
    session.status = 'AUTHENTICATION_FAILED';
    const error = new Error('SmartAPI generateSession is not available.');
    error.code = 'ANGEL_GENERATE_SESSION_UNAVAILABLE';
    throw error;
  }

  clearSession();
  session.status = 'AUTHENTICATION_PENDING';

  try {
    const otpCode = totp.generateTOTP(currentConfig.angel.totpSecret);

    const response = await api.generateSession(
      currentConfig.angel.clientId,
      currentConfig.angel.pin,
      otpCode
    );

    if (
      !response ||
      response.status !== true ||
      !response.data ||
      !response.data.jwtToken
    ) {
      clearSession();
      session.status = 'AUTHENTICATION_FAILED';

      return {
        ok: false,
        code: 'ANGEL_AUTH_FAILED',
        status: getSafeStatus()
      };
    }

    session.status = 'CONNECTED';
    session.accessToken = String(response.data.jwtToken);
    session.refreshToken = response.data.refreshToken
      ? String(response.data.refreshToken)
      : null;
    session.feedToken = response.data.feedToken
      ? String(response.data.feedToken)
      : null;
    session.createdAt = new Date().toISOString();

    return {
      ok: true,
      code: 'ANGEL_AUTHENTICATED',
      status: getSafeStatus()
    };
  } catch (error) {
    clearSession();
    session.status = 'AUTHENTICATION_FAILED';

    const safeError = new Error('Angel One authentication request failed.');
    safeError.code = error.code || 'ANGEL_AUTH_REQUEST_FAILED';
    throw safeError;
  }
}

async function logout() {
  clearSession();

  return {
    ok: true,
    status: getSafeStatus()
  };
}

function getSession() {
  return {
    ...session
  };
}

function setSessionForTest(customSession = {}) {
  session = {
    status: customSession.status || 'DISCONNECTED',
    accessToken: customSession.accessToken || null,
    refreshToken: customSession.refreshToken || null,
    feedToken: customSession.feedToken || null,
    createdAt: customSession.createdAt || null
  };
}

module.exports = {
  login,
  logout,
  getSession,
  getSafeStatus,
  clearSession,
  requireCredentials,
  setSessionForTest
};
