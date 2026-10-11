'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 5 — Search → Normalize → Validate → Quote Pipeline
 *
 * Read-only.
 * No orders.
 * No fake market data.
 */

const instrumentSearch = require('./angel-instrument-search');
const normalizer = require('./instrument-normalizer');
const quoteAdapter = require('./angel-market-data');
const twelveDataAdapter = require('./twelve-data-market-data');
const angelSession = require('./angel-session');
const runtime = require('./smartapi-runtime');
const { getConfig, validateMarketDataConfig } = require('./config');

const MAX_QUOTE_AGE_MS = 60 * 1000;
const MAX_FUTURE_TIMESTAMP_MS = 5 * 1000;

function isTwelveDataProviderActive(env = process.env) {
  const cfg = getConfig(env);
  return cfg.provider === 'TWELVE_DATA';
}

function validateMarketDataProviderReadiness(env = process.env) {
  const cfg = getConfig(env);
  const provider = String(cfg.provider || 'UNCONFIGURED').trim().toUpperCase();
  const validation = validateMarketDataConfig(cfg);

  if (provider === 'ANGEL_ONE') {
    const missingEnvVars = Array.isArray(validation.missing) ? [...validation.missing] : [];
    const safeSession = angelSession.getSafeStatus();
    const mockSdkLoaded = Boolean(runtime.getMockSmartAPI());
    const sessionAuthenticated = Boolean(safeSession.authenticated);
    const credentialsConfigured = missingEnvVars.length === 0;
    const ready = credentialsConfigured || sessionAuthenticated || mockSdkLoaded;

    return {
      ready,
      provider: 'ANGEL_ONE',
      credentialsConfigured,
      sessionAuthenticated,
      status: sessionAuthenticated ? 'CONNECTED' : safeSession.status || 'DISCONNECTED',
      missingEnvVars,
      code: !credentialsConfigured
        ? 'ANGEL_CREDENTIALS_MISSING'
        : !sessionAuthenticated
          ? 'ANGEL_SESSION_NOT_READY'
          : 'READY',
      message: !credentialsConfigured
        ? `Angel One credentials are not configured. Missing environment variables: ${missingEnvVars.join(', ')}.`
        : !sessionAuthenticated
          ? 'Angel One credentials are configured, but the SmartAPI session is currently DISCONNECTED.'
          : 'Angel One provider is configured and authenticated.'
    };
  }

  if (provider === 'TWELVE_DATA') {
    const missingEnvVars = Array.isArray(validation.missing) ? [...validation.missing] : [];
    const credentialsConfigured = missingEnvVars.length === 0;
    return {
      ready: credentialsConfigured,
      provider: 'TWELVE_DATA',
      credentialsConfigured,
      sessionAuthenticated: credentialsConfigured,
      status: credentialsConfigured ? 'CONNECTED' : 'DISCONNECTED',
      missingEnvVars,
      code: credentialsConfigured ? 'READY' : 'TWELVE_DATA_CREDENTIALS_MISSING',
      message: credentialsConfigured
        ? 'Twelve Data provider is configured.'
        : `Twelve Data API key is not configured. Missing environment variables: ${missingEnvVars.join(', ')}.`,
      planRestrictions:
        'Twelve Data Basic/Free tier restricts real-time NSE/BSE (XNSE/XBOM) equities and indices to Grow/Pro plans and does not support NFO/BFO options or futures.'
    };
  }

  // Default / UNCONFIGURED provider fallback to Angel One check if session/mock is active, otherwise report unconfigured
  const safeSession = angelSession.getSafeStatus();
  const mockSdkLoaded = Boolean(runtime.getMockSmartAPI());
  const angelMissing = [];
  if (!cfg.angel.apiKey) angelMissing.push('ANGEL_API_KEY');
  if (!cfg.angel.clientId) angelMissing.push('ANGEL_CLIENT_ID');
  if (!cfg.angel.pin) angelMissing.push('ANGEL_PIN');
  if (!cfg.angel.totpSecret) angelMissing.push('ANGEL_TOTP_SECRET');

  if (safeSession.authenticated || mockSdkLoaded || angelMissing.length === 0) {
    return {
      ready: true,
      provider: 'ANGEL_ONE',
      credentialsConfigured: angelMissing.length === 0,
      sessionAuthenticated: Boolean(safeSession.authenticated),
      status: safeSession.authenticated ? 'CONNECTED' : 'DISCONNECTED',
      missingEnvVars: angelMissing,
      code: 'READY',
      message: 'Angel One session is active.'
    };
  }

  return {
    ready: false,
    provider,
    credentialsConfigured: false,
    sessionAuthenticated: false,
    status: 'DISCONNECTED',
    missingEnvVars: angelMissing,
    code: 'ANGEL_CREDENTIALS_MISSING',
    message: `Market data provider (${provider}) is not configured. Missing Angel One environment variables: ${angelMissing.join(', ')}.`
  };
}

function assertMarketDataProviderReady(env = process.env) {
  const cfg = getConfig(env);
  const provider = String(cfg.provider || 'UNCONFIGURED').trim().toUpperCase();
  if (provider === 'UNCONFIGURED') {
    return validateMarketDataProviderReadiness(env);
  }
  const readiness = validateMarketDataProviderReadiness(env);
  if (!readiness.ready) {
    const err = new Error(readiness.message);
    err.code = readiness.code || 'MARKET_DATA_PROVIDER_NOT_READY';
    err.provider = readiness.provider;
    err.missingEnvVars = readiness.missingEnvVars;
    throw err;
  }
  return readiness;
}

function validateQuoteFreshness(quote, nowMs = Date.now()) {
  if (!quote || quote.dataReady !== true) {
    const err = new Error('Quote data is not ready.');
    err.code = 'INVALID_MARKET_DATA';
    throw err;
  }

  const price = Number(quote.price);
  if (!Number.isFinite(price) || price <= 0) {
    const err = new Error('Quote price must be a positive number.');
    err.code = 'INVALID_MARKET_DATA_PRICE';
    throw err;
  }

  if (!quote.timestamp) {
    const err = new Error('Quote timestamp is missing.');
    err.code = 'MISSING_QUOTE_TIMESTAMP';
    throw err;
  }

  const timestampMs = Date.parse(quote.timestamp);
  if (!Number.isFinite(timestampMs)) {
    const err = new Error('Quote timestamp is not a valid ISO-8601 date.');
    err.code = 'INVALID_QUOTE_TIMESTAMP';
    throw err;
  }

  const ageMs = nowMs - timestampMs;
  if (ageMs < -MAX_FUTURE_TIMESTAMP_MS) {
    const err = new Error('Quote timestamp is in the future beyond tolerance.');
    err.code = 'FUTURE_QUOTE_TIMESTAMP';
    throw err;
  }

  if (ageMs > MAX_QUOTE_AGE_MS) {
    const err = new Error('Quote is stale and exceeds maximum allowed age.');
    err.code = 'STALE_MARKET_DATA';
    throw err;
  }

  return quote;
}

async function resolveInstrument(exchange, searchText, exactSymbol) {
  if (!isTwelveDataProviderActive()) {
    assertMarketDataProviderReady();
  }

  const searchResponse = isTwelveDataProviderActive()
    ? await twelveDataAdapter.searchScrip(exchange, searchText)
    : await instrumentSearch.searchScrip(exchange, searchText);

  const results = normalizer.normalizeSearchResults(searchResponse);

  if (!results.length) {
    const error = new Error('No valid broker instruments found.');
    error.code = 'INSTRUMENT_NOT_FOUND';
    throw error;
  }

  if (exactSymbol) {
    const exact = normalizer.findExact(results, exactSymbol);

    if (!exact) {
      const error = new Error('Exact trading symbol was not found.');
      error.code = 'EXACT_INSTRUMENT_NOT_FOUND';
      throw error;
    }

    return exact;
  }

  return results[0];
}

async function getQuoteBySearch(
  exchange,
  searchText,
  exactSymbol,
  options = {}
) {
  assertMarketDataProviderReady(options.env || process.env);

  const instrument = await resolveInstrument(exchange, searchText, exactSymbol);

  normalizer.assertValidOptionContract(instrument);

  const quoteResponse = isTwelveDataProviderActive(options.env || process.env)
    ? await twelveDataAdapter.getQuote(instrument, options)
    : await quoteAdapter.getQuote(instrument);

  const validatedQuote = validateQuoteFreshness(
    quoteResponse.quote,
    options.nowMs ?? Date.now()
  );

  return {
    ok: true,
    instrument,
    provider: quoteResponse.provider,
    quote: validatedQuote
  };
}

async function getCandlesBySearch(
  exchange,
  searchText,
  exactSymbol,
  options = {}
) {
  assertMarketDataProviderReady(options.env || process.env);

  const instrument = await resolveInstrument(exchange, searchText, exactSymbol);

  normalizer.assertValidOptionContract(instrument);

  const candleResponse = isTwelveDataProviderActive(options.env || process.env)
    ? await twelveDataAdapter.getCandles(instrument, options)
    : await quoteAdapter.getCandles(instrument, options);

  return {
    ok: true,
    instrument,
    provider: candleResponse.provider,
    interval: candleResponse.interval,
    fromdate: candleResponse.fromdate,
    todate: candleResponse.todate,
    candles: candleResponse.candles
  };
}

module.exports = {
  MAX_QUOTE_AGE_MS,
  MAX_FUTURE_TIMESTAMP_MS,
  isTwelveDataProviderActive,
  validateMarketDataProviderReadiness,
  assertMarketDataProviderReady,
  resolveInstrument,
  getQuoteBySearch,
  getCandlesBySearch,
  validateQuoteFreshness
};
