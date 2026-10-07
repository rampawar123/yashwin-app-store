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

const { config } = require("./config");
const adapter = require("./angel-smartapi");

let session = {
  status: "DISCONNECTED",
  accessToken: null,
  refreshToken: null,
  feedToken: null,
  createdAt: null
};

function clearSession() {
  session = {
    status: "DISCONNECTED",
    accessToken: null,
    refreshToken: null,
    feedToken: null,
    createdAt: null
  };
}

function getSafeStatus() {
  return {
    provider: config.provider,
    status: session.status,
    authenticated: Boolean(session.accessToken),
    createdAt: session.createdAt
  };
}

function requireCredentials() {
  const missing = [];

  if (!config.angel.apiKey) missing.push("ANGEL_API_KEY");
  if (!config.angel.clientId) missing.push("ANGEL_CLIENT_ID");
  if (!config.angel.pin) missing.push("ANGEL_PIN");
  if (!config.angel.totpSecret) missing.push("ANGEL_TOTP_SECRET");

  if (missing.length) {
    const error = new Error(
      "Angel One credentials are not configured."
    );

    error.code = "ANGEL_CREDENTIALS_MISSING";
    error.missing = missing;

    throw error;
  }
}

async function login() {
  requireCredentials();

  const api = adapter.createAngelSmartAPI({
    apiKey: config.angel.apiKey
  });

  if (!api || typeof api.generateSession !== "function") {
    const error = new Error(
      "SmartAPI generateSession is not available."
    );

    error.code = "ANGEL_GENERATE_SESSION_UNAVAILABLE";
    throw error;
  }

  session.status = "AUTHENTICATION_PENDING";

  try {
    const response = await api.generateSession(
      config.angel.clientId,
      config.angel.pin,
      config.angel.totpSecret
    );

    if (!response || response.status !== true || !response.data) {
      session.status = "AUTHENTICATION_FAILED";

      return {
        ok: false,
        code: "ANGEL_AUTH_FAILED",
        status: getSafeStatus()
      };
    }

    session.status = "CONNECTED";
    session.accessToken = response.data.jwtToken || null;
    session.refreshToken = response.data.refreshToken || null;
    session.feedToken = response.data.feedToken || null;
    session.createdAt = new Date().toISOString();

    return {
      ok: true,
      code: "ANGEL_AUTHENTICATED",
      status: getSafeStatus()
    };
  } catch (error) {
    session.status = "AUTHENTICATION_FAILED";

    const safeError = new Error(
      "Angel One authentication request failed."
    );

    safeError.code = "ANGEL_AUTH_REQUEST_FAILED";
    safeError.cause = error;

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

module.exports = {
  login,
  logout,
  getSession,
  getSafeStatus,
  clearSession,
  requireCredentials
};
