'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 3 & 10 — Secure Server Configuration
 *
 * Real credentials are read only from environment variables.
 * Never expose them to browser JavaScript.
 * Paper Trading is strictly the default mode.
 * Live trading is strictly disabled.
 */

function positiveNumber(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseAllowedOrigins(raw) {
  const rawStr = String(raw || '').trim();
  if (!rawStr) return [];
  return rawStr
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(item));
}

function getConfig(env = process.env) {
  const rawMode = String(env.TRADING_MODE || 'paper').trim().toLowerCase();
  const mode = ['paper', 'pilot'].includes(rawMode) ? rawMode : 'paper';
  const nodeEnv = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';

  const geminiApiKey = String(
    env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY || ''
  ).trim();

  const port = Math.floor(positiveNumber(env.PORT || env.API_PORT, 3000));
  const host = String(env.API_HOST || '0.0.0.0').trim() || '0.0.0.0';
  const dbPath = String(env.YASHWIN_DB_PATH || '').trim() || 'server/data/yashwin-trading.sqlite';
  const rawTrustProxy = String(env.TRUST_PROXY || '').trim().toLowerCase();
  const trustProxy = rawTrustProxy === 'true' || rawTrustProxy === '1';
  const diagnosticsToken = String(env.DIAGNOSTICS_AUTH_TOKEN || '').trim();

  return {
    nodeEnv,
    isProduction,
    server: {
      host,
      port,
      dbPath,
      trustProxy,
      diagnosticsTokenConfigured: Boolean(diagnosticsToken),
      allowedOrigins: parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS),
      publicBaseUrl: String(env.PUBLIC_BASE_URL || '').trim()
    },

    provider: String(env.MARKET_DATA_PROVIDER || 'UNCONFIGURED').trim().toUpperCase(),

    angel: {
      apiKey: String(env.ANGEL_API_KEY || '').trim(),
      clientId: String(env.ANGEL_CLIENT_ID || '').trim(),
      pin: String(env.ANGEL_PIN || '').trim(),
      totpSecret: String(env.ANGEL_TOTP_SECRET || '').trim()
    },

    twelveData: {
      apiKey: String(env.TWELVE_DATA_API_KEY || '').trim(),
      rateLimitPerMinute: Math.floor(positiveNumber(env.TWELVE_DATA_RATE_LIMIT_PER_MIN, 8)),
      rateLimitPerDay: Math.floor(positiveNumber(env.TWELVE_DATA_RATE_LIMIT_PER_DAY, 800))
    },

    googleAI: {
      apiKey: geminiApiKey,
      model: String(env.GOOGLE_AI_MODEL || 'gemini-3.8-flash').trim(),
      configured: Boolean(geminiApiKey)
    },

    marketIntelligence: {
      provider: String(env.MARKET_INTELLIGENCE_PROVIDER || 'AUTO').trim().toUpperCase(),
      finnhubApiKey: String(env.FINNHUB_API_KEY || '').trim(),
      alphaVantageApiKey: String(env.ALPHA_VANTAGE_API_KEY || '').trim(),
      newsApiKey: String(env.NEWS_API_KEY || '').trim(),
      tradingEconomicsApiKey: String(env.TRADING_ECONOMICS_API_KEY || '').trim(),
      indianRssUrl: String(env.INDIAN_MARKET_RSS_URL || '').trim(),
      globalRssUrl: String(env.GLOBAL_MARKET_RSS_URL || '').trim()
    },

    trading: {
      mode,
      liveEnabled: false
    },

    risk: {
      maxLossPerTrade: positiveNumber(env.MAX_LOSS_PER_TRADE, 500),
      maxDailyLoss: positiveNumber(env.MAX_DAILY_LOSS, 1000),
      maxTradesPerDay: Math.floor(positiveNumber(env.MAX_TRADES_PER_DAY, 3)),
      maxOpenPositions: 1
    }
  };
}

const config = getConfig(process.env);

function validateMarketDataConfig(cfg = getConfig(process.env)) {
  if (cfg.provider === 'TWELVE_DATA') {
    const missing = [];
    if (!cfg.twelveData || !cfg.twelveData.apiKey) {
      missing.push('TWELVE_DATA_API_KEY');
    }
    return {
      ready: missing.length === 0,
      provider: 'TWELVE_DATA',
      missing
    };
  }

  if (cfg.provider !== 'ANGEL_ONE') {
    return {
      ready: false,
      reason: 'Angel One is not selected as the provider.',
      missing: []
    };
  }

  const missing = [];

  if (!cfg.angel.apiKey) missing.push('ANGEL_API_KEY');
  if (!cfg.angel.clientId) missing.push('ANGEL_CLIENT_ID');
  if (!cfg.angel.pin) missing.push('ANGEL_PIN');
  if (!cfg.angel.totpSecret) missing.push('ANGEL_TOTP_SECRET');

  return {
    ready: missing.length === 0,
    missing
  };
}

function validateGoogleAIConfig(cfg = getConfig(process.env)) {
  const configured = Boolean(cfg.googleAI && cfg.googleAI.apiKey);
  return {
    ready: configured,
    model: cfg.googleAI?.model || 'gemini-3.8-flash',
    missing: configured ? [] : ['GEMINI_API_KEY']
  };
}

function validateMarketIntelligenceConfig(cfg = getConfig(process.env)) {
  const mi = cfg.marketIntelligence || {};
  const providers = [];
  if (mi.finnhubApiKey) providers.push('FINNHUB');
  if (mi.alphaVantageApiKey) providers.push('ALPHA_VANTAGE');
  if (mi.newsApiKey) providers.push('NEWSAPI');
  if (mi.tradingEconomicsApiKey) providers.push('TRADING_ECONOMICS');
  if (mi.indianRssUrl || mi.globalRssUrl) providers.push('EXCHANGE_RSS');

  return {
    ready: providers.length > 0,
    providers,
    missing: providers.length > 0 ? [] : ['FINNHUB_API_KEY | ALPHA_VANTAGE_API_KEY | INDIAN_MARKET_RSS_URL']
  };
}

function validateProductionEnvironment(env = process.env) {
  const cfg = getConfig(env);
  const warnings = [];
  const errors = [];

  const rawLive = String(env.LIVE_TRADING_ENABLED || 'false').trim().toLowerCase();
  if (rawLive === 'true' || rawLive === '1') {
    warnings.push(
      'LIVE_TRADING_ENABLED was set to true in environment; strictly overridden to false by safety lock.'
    );
  }

  const rawMode = String(env.TRADING_MODE || 'paper').trim().toLowerCase();
  if (rawMode && rawMode !== 'paper' && rawMode !== 'pilot') {
    warnings.push(
      `TRADING_MODE="${rawMode}" is not allowed in paper-only runtime; strictly locked to "paper".`
    );
  }

  if (!Number.isInteger(cfg.server.port) || cfg.server.port < 1 || cfg.server.port > 65535) {
    errors.push('PORT must be a valid TCP port between 1 and 65535.');
  }

  const marketCheck = validateMarketDataConfig(cfg);
  const aiCheck = validateGoogleAIConfig(cfg);
  const intelCheck = validateMarketIntelligenceConfig(cfg);

  if (!marketCheck.ready) {
    warnings.push(
      `Market data provider not fully configured (${marketCheck.missing.join(', ') || marketCheck.reason || 'UNCONFIGURED'}). Server will run in degraded zero-fabrication mode.`
    );
  }

  if (!aiCheck.ready) {
    warnings.push(
      'Google AI API key not configured. AI analysis will use deterministic rule-based fallback.'
    );
  }

  return {
    ok: errors.length === 0,
    nodeEnv: cfg.nodeEnv,
    isProduction: cfg.isProduction,
    host: cfg.server.host,
    port: cfg.server.port,
    canonicalDbPath: 'server/data/yashwin-trading.sqlite',
    configuredDbPath: cfg.server.dbPath,
    tradingMode: cfg.trading.mode,
    liveTradingEnabled: false,
    brokerOrderExecution: 'DISABLED',
    optionalProviders: {
      angelOneReady: cfg.provider === 'ANGEL_ONE' && marketCheck.ready,
      twelveDataReady: cfg.provider === 'TWELVE_DATA' && marketCheck.ready,
      googleAIReady: aiCheck.ready,
      marketIntelligenceReady: intelCheck.ready
    },
    warnings,
    errors
  };
}

function getSafePublicConfig(cfg = getConfig(process.env)) {
  const validation = validateMarketDataConfig(cfg);
  const aiValidation = validateGoogleAIConfig(cfg);
  const intelValidation = validateMarketIntelligenceConfig(cfg);
  return {
    nodeEnv: cfg.nodeEnv || 'development',
    isProduction: Boolean(cfg.isProduction),
    provider: cfg.provider,
    credentialsConfigured: validation.ready,
    twelveDataConfigured: Boolean(cfg.twelveData && cfg.twelveData.apiKey),
    googleAIConfigured: aiValidation.ready,
    googleAIModel: aiValidation.model,
    marketIntelligenceConfigured: intelValidation.ready,
    marketIntelligenceProviders: intelValidation.providers,
    trading: {
      mode: cfg.trading.mode,
      liveEnabled: false
    },
    risk: {
      ...cfg.risk
    }
  };
}

module.exports = {
  config,
  getConfig,
  parseAllowedOrigins,
  validateMarketDataConfig,
  validateGoogleAIConfig,
  validateMarketIntelligenceConfig,
  validateProductionEnvironment,
  getSafePublicConfig
};
