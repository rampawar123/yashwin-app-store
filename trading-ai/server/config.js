/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — Secure Server Configuration
 *
 * Real credentials are read only from environment variables.
 * Never expose them to browser JavaScript.
 */

const config = {
  provider:
    process.env.MARKET_DATA_PROVIDER || "UNCONFIGURED",

  angel: {
    apiKey: process.env.ANGEL_API_KEY || "",
    clientId: process.env.ANGEL_CLIENT_ID || "",
    pin: process.env.ANGEL_PIN || "",
    totpSecret: process.env.ANGEL_TOTP_SECRET || ""
  },

  trading: {
    mode: process.env.TRADING_MODE || "paper",
    liveEnabled:
      String(process.env.LIVE_TRADING_ENABLED).toLowerCase() === "true"
  }
};

function validateMarketDataConfig() {
  if (config.provider !== "ANGEL_ONE") {
    return {
      ready: false,
      reason: "Angel One is not selected as the provider."
    };
  }

  const missing = [];

  if (!config.angel.apiKey) missing.push("ANGEL_API_KEY");
  if (!config.angel.clientId) missing.push("ANGEL_CLIENT_ID");
  if (!config.angel.pin) missing.push("ANGEL_PIN");
  if (!config.angel.totpSecret) missing.push("ANGEL_TOTP_SECRET");

  return {
    ready: missing.length === 0,
    missing
  };
}

module.exports = {
  config,
  validateMarketDataConfig
};
