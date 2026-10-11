'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Task 202 — Safe, Read-Only Twelve Data Market-Data Adapter
 *
 * Strictly enforces:
 * - Read-only access to official Twelve Data REST endpoints (/symbol_search, /quote, /time_series)
 * - Uses TWELVE_DATA_API_KEY from server environment ONLY
 * - Never exposes API keys in browser responses, error messages, logs, or URLs
 * - Never scrapes websites or calls undocumented endpoints
 * - Explicitly rejects NFO/BFO derivatives, options, and futures
 * - Explicitly detects Twelve Data plan/tier restrictions (e.g., Basic/Free plan XNSE Grow/Pro gate)
 *   and returns TWELVE_DATA_PLAN_RESTRICTED without fabricating prices or candles
 * - Preserves original exchange timestamps in Asia/Kolkata (+05:30) or UTC; never substitutes Date.now()
 * - Enforces positive finite prices and strict OHLC consistency (high >= max(open,close,low), low <= min(open,close,high))
 * - Enforces bounded LRU caching and sliding-window rate limiting (8 requests/min, 800 requests/day)
 */

const { getConfig } = require('./config');

const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com';

const SUPPORTED_EXCHANGES = Object.freeze(['NSE', 'BSE']);
const UNSUPPORTED_DERIVATIVE_EXCHANGES = Object.freeze(['NFO', 'BFO', 'MCX', 'CDS']);

const VALID_CANDLE_INTERVALS = Object.freeze({
  ONE_MINUTE: '1min',
  FIVE_MINUTE: '5min',
  FIFTEEN_MINUTE: '15min',
  THIRTY_MINUTE: '30min',
  ONE_HOUR: '1h',
  ONE_DAY: '1day'
});

const INTERVAL_ALIAS_MAP = Object.freeze({
  '1m': 'ONE_MINUTE',
  '1min': 'ONE_MINUTE',
  'one_minute': 'ONE_MINUTE',
  '5m': 'FIVE_MINUTE',
  '5min': 'FIVE_MINUTE',
  'five_minute': 'FIVE_MINUTE',
  '15m': 'FIFTEEN_MINUTE',
  '15min': 'FIFTEEN_MINUTE',
  'fifteen_minute': 'FIFTEEN_MINUTE',
  '30m': 'THIRTY_MINUTE',
  '30min': 'THIRTY_MINUTE',
  'thirty_minute': 'THIRTY_MINUTE',
  '1h': 'ONE_HOUR',
  '60m': 'ONE_HOUR',
  'one_hour': 'ONE_HOUR',
  '1d': 'ONE_DAY',
  '1day': 'ONE_DAY',
  'day': 'ONE_DAY',
  'daily': 'ONE_DAY',
  'one_day': 'ONE_DAY'
});

// Verified Indian benchmark index & NSE/BSE symbol catalog for deterministic read-only resolution
const VERIFIED_INDIAN_INSTRUMENTS = Object.freeze([
  {
    key: 'NIFTY50',
    exchange: 'NSE',
    tradingsymbol: 'NIFTY 50',
    symboltoken: 'TD:NSE:NIFTY_50',
    twelveDataSymbol: 'NIFTY_50',
    name: 'NIFTY 50',
    instrumentType: 'INDEX',
    aliases: ['NIFTY 50', 'NIFTY50', 'NIFTY', 'NIFTY_50']
  },
  {
    key: 'BANKNIFTY',
    exchange: 'NSE',
    tradingsymbol: 'BANK NIFTY',
    symboltoken: 'TD:NSE:NIFTY_BANK',
    twelveDataSymbol: 'NIFTY_BANK',
    name: 'BANK NIFTY',
    instrumentType: 'INDEX',
    aliases: ['BANK NIFTY', 'BANKNIFTY', 'NIFTY BANK', 'NIFTY_BANK']
  },
  {
    key: 'SENSEX',
    exchange: 'BSE',
    tradingsymbol: 'SENSEX',
    symboltoken: 'TD:BSE:SENSEX',
    twelveDataSymbol: 'SENSEX',
    name: 'BSE SENSEX',
    instrumentType: 'INDEX',
    aliases: ['SENSEX', 'BSE SENSEX', 'BSESN']
  },
  {
    key: 'RELIANCE',
    exchange: 'NSE',
    tradingsymbol: 'RELIANCE-EQ',
    symboltoken: 'TD:NSE:RELIANCE',
    twelveDataSymbol: 'RELIANCE',
    name: 'Reliance Industries Ltd',
    instrumentType: 'EQUITY',
    aliases: ['RELIANCE', 'RELIANCE-EQ']
  },
  {
    key: 'TCS',
    exchange: 'NSE',
    tradingsymbol: 'TCS-EQ',
    symboltoken: 'TD:NSE:TCS',
    twelveDataSymbol: 'TCS',
    name: 'Tata Consultancy Services Ltd',
    instrumentType: 'EQUITY',
    aliases: ['TCS', 'TCS-EQ']
  },
  {
    key: 'INFY',
    exchange: 'NSE',
    tradingsymbol: 'INFY-EQ',
    symboltoken: 'TD:NSE:INFY',
    twelveDataSymbol: 'INFY',
    name: 'Infosys Ltd',
    instrumentType: 'EQUITY',
    aliases: ['INFY', 'INFY-EQ', 'INFOSYS']
  },
  {
    key: 'HDFCBANK',
    exchange: 'NSE',
    tradingsymbol: 'HDFCBANK-EQ',
    symboltoken: 'TD:NSE:HDFCBANK',
    twelveDataSymbol: 'HDFCBANK',
    name: 'HDFC Bank Ltd',
    instrumentType: 'EQUITY',
    aliases: ['HDFCBANK', 'HDFCBANK-EQ', 'HDFC BANK']
  },
  {
    key: 'ICICIBANK',
    exchange: 'NSE',
    tradingsymbol: 'ICICIBANK-EQ',
    symboltoken: 'TD:NSE:ICICIBANK',
    twelveDataSymbol: 'ICICIBANK',
    name: 'ICICI Bank Ltd',
    instrumentType: 'EQUITY',
    aliases: ['ICICIBANK', 'ICICIBANK-EQ', 'ICICI BANK']
  },
  {
    key: 'SBIN',
    exchange: 'NSE',
    tradingsymbol: 'SBIN-EQ',
    symboltoken: 'TD:NSE:SBIN',
    twelveDataSymbol: 'SBIN',
    name: 'State Bank of India',
    instrumentType: 'EQUITY',
    aliases: ['SBIN', 'SBIN-EQ', 'SBI']
  }
]);

const RATE_LIMIT_PER_MINUTE = 8;
const RATE_LIMIT_PER_DAY = 800;
const MINUTE_WINDOW_MS = 60 * 1000;
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;

const MAX_CACHE_ENTRIES = 100;
const QUOTE_CACHE_TTL_MS = 15 * 1000;
const CANDLE_CACHE_TTL_MS = 60 * 1000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

let minuteRequestTimestamps = [];
let dayRequestTimestamps = [];
const responseCache = new Map();
let customHttpFetcher = null;

function setHttpFetcherForTest(fn) {
  customHttpFetcher = typeof fn === 'function' ? fn : null;
}

function resetStateForTest() {
  minuteRequestTimestamps = [];
  dayRequestTimestamps = [];
  responseCache.clear();
  customHttpFetcher = null;
}

function redactSecretsFromString(rawText, apiKey = '') {
  let text = String(rawText || '');
  const cfgKey = getConfig()?.twelveData?.apiKey || process.env.TWELVE_DATA_API_KEY || '';
  const secrets = [apiKey, cfgKey].filter((s) => typeof s === 'string' && s.trim().length >= 4);
  for (const secret of secrets) {
    const clean = secret.trim();
    if (text.includes(clean)) {
      text = text.split(clean).join('[REDACTED]');
    }
  }
  text = text.replace(/apikey=[^&\s"']+/gi, 'apikey=[REDACTED]');
  return text;
}

function getCachedEntry(key, nowMs = Date.now()) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (nowMs >= entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  // Refresh LRU order
  responseCache.delete(key);
  responseCache.set(key, entry);
  return entry.value;
}

function setCachedEntry(key, value, ttlMs, nowMs = Date.now()) {
  if (responseCache.has(key)) {
    responseCache.delete(key);
  }
  while (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey === undefined) break;
    responseCache.delete(oldestKey);
  }
  responseCache.set(key, {
    value,
    storedAt: nowMs,
    expiresAt: nowMs + ttlMs
  });
}

function checkAndRecordQuota(nowMs = Date.now(), cfg = getConfig()) {
  const maxPerMin = Number(cfg?.twelveData?.rateLimitPerMinute || RATE_LIMIT_PER_MINUTE);
  const maxPerDay = Number(cfg?.twelveData?.rateLimitPerDay || RATE_LIMIT_PER_DAY);

  minuteRequestTimestamps = minuteRequestTimestamps.filter((ts) => nowMs - ts < MINUTE_WINDOW_MS);
  dayRequestTimestamps = dayRequestTimestamps.filter((ts) => nowMs - ts < DAY_WINDOW_MS);

  if (minuteRequestTimestamps.length >= maxPerMin) {
    const oldest = minuteRequestTimestamps[0] || nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((MINUTE_WINDOW_MS - (nowMs - oldest)) / 1000));
    const err = new Error(
      `Twelve Data rate limit reached (${maxPerMin} requests/minute). Please retry after ${retryAfterSeconds}s.`
    );
    err.code = 'TWELVE_DATA_RATE_LIMITED';
    err.retryAfterSeconds = retryAfterSeconds;
    throw err;
  }

  if (dayRequestTimestamps.length >= maxPerDay) {
    const oldest = dayRequestTimestamps[0] || nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((DAY_WINDOW_MS - (nowMs - oldest)) / 1000));
    const err = new Error(
      `Twelve Data daily quota reached (${maxPerDay} requests/day).`
    );
    err.code = 'TWELVE_DATA_DAILY_QUOTA_EXCEEDED';
    err.retryAfterSeconds = retryAfterSeconds;
    throw err;
  }

  minuteRequestTimestamps.push(nowMs);
  dayRequestTimestamps.push(nowMs);

  return {
    minuteRemaining: Math.max(0, maxPerMin - minuteRequestTimestamps.length),
    dayRemaining: Math.max(0, maxPerDay - dayRequestTimestamps.length)
  };
}

function requireApiKey(cfg = getConfig()) {
  const apiKey = String(cfg?.twelveData?.apiKey || process.env.TWELVE_DATA_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('Twelve Data API key (TWELVE_DATA_API_KEY) is not configured on the server.');
    err.code = 'TWELVE_DATA_CREDENTIALS_MISSING';
    throw err;
  }
  return apiKey;
}

function assertSupportedExchangeAndInstrument(exchange, instrumentOrSymbol = {}) {
  const normExchange = String(
    exchange || instrumentOrSymbol?.exchange || ''
  ).trim().toUpperCase();

  if (!normExchange) {
    const err = new Error('Instrument exchange is required.');
    err.code = 'INVALID_INSTRUMENT_EXCHANGE';
    throw err;
  }

  if (UNSUPPORTED_DERIVATIVE_EXCHANGES.includes(normExchange)) {
    const err = new Error(
      `Twelve Data read-only adapter does not support Indian derivative exchange '${normExchange}' (options/futures).`
    );
    err.code = 'TWELVE_DATA_UNSUPPORTED_INSTRUMENT';
    throw err;
  }

  if (!SUPPORTED_EXCHANGES.includes(normExchange)) {
    const err = new Error(`Unsupported exchange '${normExchange}' for Twelve Data adapter.`);
    err.code = 'INVALID_EXCHANGE';
    throw err;
  }

  const instType = String(
    instrumentOrSymbol?.instrumentType || instrumentOrSymbol?.type || ''
  ).trim().toUpperCase();
  const optType = String(instrumentOrSymbol?.optionType || '').trim().toUpperCase();
  const rawSym = String(
    instrumentOrSymbol?.tradingsymbol || instrumentOrSymbol?.symbol || instrumentOrSymbol?.query || ''
  ).trim().toUpperCase();

  const looksLikeOptionOrFuture =
    instType === 'OPTION' ||
    instType === 'FUTURES' ||
    optType === 'CE' ||
    optType === 'PE' ||
    optType === 'FUT' ||
    (instrumentOrSymbol?.strikePrice !== null && instrumentOrSymbol?.strikePrice !== undefined) ||
    Boolean(instrumentOrSymbol?.expiry) ||
    /\d{2}[A-Z]{3}\d{0,4}\d+(?:CE|PE)$/i.test(rawSym) ||
    /\d{2}[A-Z]{3}\d{0,4}FUT$/i.test(rawSym);

  if (looksLikeOptionOrFuture) {
    const err = new Error(
      'Twelve Data read-only adapter does not support NFO/BFO options or futures contracts.'
    );
    err.code = 'TWELVE_DATA_UNSUPPORTED_INSTRUMENT';
    throw err;
  }

  return normExchange;
}

function normalizeCandleInterval(rawInterval = 'FIVE_MINUTE') {
  const cleaned = String(rawInterval || 'FIVE_MINUTE').trim();
  const upper = cleaned.toUpperCase();
  if (VALID_CANDLE_INTERVALS[upper]) {
    return {
      canonicalInterval: upper,
      twelveDataInterval: VALID_CANDLE_INTERVALS[upper]
    };
  }
  const mappedKey = INTERVAL_ALIAS_MAP[cleaned.toLowerCase()];
  if (mappedKey && VALID_CANDLE_INTERVALS[mappedKey]) {
    return {
      canonicalInterval: mappedKey,
      twelveDataInterval: VALID_CANDLE_INTERVALS[mappedKey]
    };
  }
  const err = new Error(
    `Unsupported candle interval for Twelve Data adapter: ${cleaned}`
  );
  err.code = 'TWELVE_DATA_UNSUPPORTED_INTERVAL';
  throw err;
}

function normalizeExchangeTimestampToISO(rawDatetime, rawUnixTimestamp = null, exchangeTimezone = 'Asia/Kolkata') {
  // 1. Prefer explicit Unix epoch seconds/milliseconds when provided by Twelve Data quote response
  if (rawUnixTimestamp !== null && rawUnixTimestamp !== undefined && rawUnixTimestamp !== '') {
    const numericTs = Number(rawUnixTimestamp);
    if (Number.isFinite(numericTs) && numericTs > 0) {
      const ms = numericTs < 1e12 ? numericTs * 1000 : numericTs;
      const dt = new Date(ms);
      if (!Number.isNaN(dt.getTime())) {
        return dt.toISOString();
      }
    }
  }

  if (rawDatetime === null || rawDatetime === undefined) {
    return null;
  }

  if (typeof rawDatetime === 'number' && Number.isFinite(rawDatetime) && rawDatetime > 0) {
    const ms = rawDatetime < 1e12 ? rawDatetime * 1000 : rawDatetime;
    const dt = new Date(ms);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  const str = String(rawDatetime).trim();
  if (!str) return null;

  const tzOffset =
    String(exchangeTimezone || 'Asia/Kolkata').includes('Kolkata') ||
    String(exchangeTimezone || '').includes('Calcutta') ||
    String(exchangeTimezone || '').toUpperCase() === 'IST'
      ? '+05:30'
      : 'Z';

  // Twelve Data intraday format: "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD HH:mm"
  const intradayMatch = str.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?$/);
  if (intradayMatch) {
    const datePart = intradayMatch[1];
    const timePart = intradayMatch[2];
    const secPart = intradayMatch[3] || '00';
    const isoCandidate = `${datePart}T${timePart}:${secPart}${tzOffset}`;
    const parsed = Date.parse(isoCandidate);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  // Twelve Data daily candle/quote format: "YYYY-MM-DD" (NSE/BSE session close 15:30 IST)
  const dateOnlyMatch = str.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnlyMatch) {
    const closeTime = tzOffset === '+05:30' ? '15:30:00+05:30' : '00:00:00Z';
    const parsed = Date.parse(`${dateOnlyMatch[1]}T${closeTime}`);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  // Standard ISO-8601 string with explicit timezone
  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(str)) {
    const parsed = Date.parse(str);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return null;
}

function resolveTwelveDataSymbol(instrument = {}) {
  const exchange = assertSupportedExchangeAndInstrument(instrument.exchange || 'NSE', instrument);
  const rawSym = String(
    instrument.tradingsymbol || instrument.name || instrument.key || ''
  ).trim().toUpperCase();
  const rawToken = String(instrument.symboltoken || '').trim();

  if (!rawSym) {
    const err = new Error('Instrument trading symbol is required.');
    err.code = 'INVALID_INSTRUMENT_SYMBOL';
    throw err;
  }

  if (rawToken.startsWith('TD:')) {
    const parts = rawToken.split(':');
    if (parts.length >= 3 && parts[2]) {
      return {
        exchange,
        twelveDataSymbol: parts[2].trim().toUpperCase(),
        tradingsymbol: instrument.tradingsymbol,
        symboltoken: rawToken
      };
    }
  }

  const catalogMatch = VERIFIED_INDIAN_INSTRUMENTS.find(
    (entry) =>
      entry.exchange === exchange &&
      (entry.tradingsymbol.toUpperCase() === rawSym ||
        entry.key.toUpperCase() === rawSym ||
        entry.twelveDataSymbol.toUpperCase() === rawSym ||
        entry.aliases.includes(rawSym))
  );

  if (catalogMatch) {
    return {
      exchange,
      twelveDataSymbol: catalogMatch.twelveDataSymbol,
      tradingsymbol: catalogMatch.tradingsymbol,
      symboltoken: instrument.symboltoken || catalogMatch.symboltoken
    };
  }

  const cleanSymbol = rawSym.replace(/-(EQ|BE|BL|BZ)$/i, '');
  if (!/^[A-Z0-9_&.-]{1,24}$/.test(cleanSymbol)) {
    const err = new Error(`Unsupported symbol format for Twelve Data: '${rawSym}'.`);
    err.code = 'TWELVE_DATA_UNSUPPORTED_INSTRUMENT';
    throw err;
  }

  return {
    exchange,
    twelveDataSymbol: cleanSymbol,
    tradingsymbol: instrument.tradingsymbol || `${cleanSymbol}-EQ`,
    symboltoken: instrument.symboltoken || `TD:${exchange}:${cleanSymbol}`
  };
}

async function executeTwelveDataRequest(endpointPath, queryParams = {}, options = {}) {
  const cfg = getConfig();
  const apiKey = requireApiKey(cfg);
  const nowMs = options.nowMs ?? Date.now();

  checkAndRecordQuota(nowMs, cfg);

  const url = new URL(endpointPath, TWELVE_DATA_BASE_URL);
  for (const [k, v] of Object.entries(queryParams)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const fetcher = customHttpFetcher || global.fetch;
  if (typeof fetcher !== 'function') {
    const err = new Error('Server HTTP fetch client is unavailable.');
    err.code = 'TWELVE_DATA_HTTP_UNAVAILABLE';
    throw err;
  }

  let response;
  try {
    response = await fetcher(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `apikey ${apiKey}`,
        Accept: 'application/json'
      }
    });
  } catch (networkErr) {
    const err = new Error(
      `Twelve Data network request failed: ${redactSecretsFromString(networkErr?.message || 'Network error', apiKey)}`
    );
    err.code = 'TWELVE_DATA_NETWORK_ERROR';
    throw err;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    const err = new Error('Twelve Data returned a non-JSON response.');
    err.code = 'TWELVE_DATA_INVALID_RESPONSE';
    throw err;
  }

  // Handle explicit Twelve Data error payloads ({ status: 'error', code: 403/404/429/..., message: '...' })
  const apiErrorCode = Number(payload?.code || response?.status || 200);
  const isApiError =
    payload?.status === 'error' ||
    (response && response.ok === false) ||
    apiErrorCode >= 400;

  if (isApiError) {
    const safeMsg = redactSecretsFromString(
      payload?.message || `Twelve Data error (HTTP ${apiErrorCode})`,
      apiKey
    );

    if (apiErrorCode === 401) {
      const err = new Error(`Twelve Data authentication failed: ${safeMsg}`);
      err.code = 'TWELVE_DATA_AUTH_FAILED';
      throw err;
    }

    if (apiErrorCode === 429) {
      const err = new Error(`Twelve Data API rate limit exceeded: ${safeMsg}`);
      err.code = 'TWELVE_DATA_RATE_LIMITED';
      throw err;
    }

    if (
      apiErrorCode === 403 ||
      / exclusively available on grow|pro plan|upgrade your plan|not available on your plan|plan does not support/i.test(
        safeMsg
      )
    ) {
      const err = new Error(
        `Twelve Data plan restriction for requested Indian exchange/symbol: ${safeMsg}`
      );
      err.code = 'TWELVE_DATA_PLAN_RESTRICTED';
      throw err;
    }

    if (apiErrorCode === 404 || /not found|invalid symbol|symbol.*missing/i.test(safeMsg)) {
      const err = new Error(`Twelve Data symbol not found or unsupported: ${safeMsg}`);
      err.code = 'TWELVE_DATA_UNSUPPORTED_INSTRUMENT';
      throw err;
    }

    const err = new Error(`Twelve Data API error: ${safeMsg}`);
    err.code = 'TWELVE_DATA_PROVIDER_ERROR';
    throw err;
  }

  return payload;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapTwelveDataQuoteResponse(payload, instrument) {
  if (!payload || typeof payload !== 'object' || payload.status === 'error') {
    const err = new Error('Twelve Data returned an empty or invalid quote payload.');
    err.code = 'TWELVE_DATA_MARKET_DATA_EMPTY';
    throw err;
  }

  const rawPrice = payload.close ?? payload.price ?? payload.last;
  const price = Number(rawPrice);
  if (!Number.isFinite(price) || price <= 0) {
    const err = new Error('Twelve Data quote is missing a positive finite price.');
    err.code = 'TWELVE_DATA_INVALID_PRICE';
    throw err;
  }

  const open = numberOrNull(payload.open);
  const high = numberOrNull(payload.high);
  const low = numberOrNull(payload.low);
  const previousClose = numberOrNull(payload.previous_close);
  const volume = numberOrNull(payload.volume);

  if (
    (open !== null && open <= 0) ||
    (high !== null && high <= 0) ||
    (low !== null && low <= 0) ||
    (previousClose !== null && previousClose <= 0)
  ) {
    const err = new Error('Twelve Data quote contains non-positive OHLC values.');
    err.code = 'TWELVE_DATA_INVALID_OHLC';
    throw err;
  }

  if (high !== null && low !== null && high < low) {
    const err = new Error('Twelve Data quote violated OHLC consistency (high < low).');
    err.code = 'TWELVE_DATA_INVALID_OHLC';
    throw err;
  }

  if (high !== null && open !== null && high < open) {
    const err = new Error('Twelve Data quote violated OHLC consistency (high < open).');
    err.code = 'TWELVE_DATA_INVALID_OHLC';
    throw err;
  }

  if (high !== null && high < price) {
    const err = new Error('Twelve Data quote violated OHLC consistency (high < close).');
    err.code = 'TWELVE_DATA_INVALID_OHLC';
    throw err;
  }

  if (low !== null && open !== null && low > open) {
    const err = new Error('Twelve Data quote violated OHLC consistency (low > open).');
    err.code = 'TWELVE_DATA_INVALID_OHLC';
    throw err;
  }

  if (low !== null && low > price) {
    const err = new Error('Twelve Data quote violated OHLC consistency (low > close).');
    err.code = 'TWELVE_DATA_INVALID_OHLC';
    throw err;
  }

  // Strictly preserve original exchange timestamp; NEVER replace with Date.now()
  const exchangeTz = payload.exchange_timezone || 'Asia/Kolkata';
  const timestamp = normalizeExchangeTimestampToISO(
    payload.datetime || null,
    payload.timestamp ?? null,
    exchangeTz
  );

  if (!timestamp) {
    const err = new Error('Twelve Data quote is missing a valid original exchange timestamp.');
    err.code = 'TWELVE_DATA_INVALID_TIMESTAMP';
    throw err;
  }

  return {
    instrument: instrument.tradingsymbol || instrument.key || payload.symbol || null,
    exchange: String(instrument.exchange || payload.exchange || 'NSE').trim().toUpperCase(),
    tradingSymbol: instrument.tradingsymbol || payload.symbol || null,
    symbolToken: instrument.symboltoken || `TD:${instrument.exchange || 'NSE'}:${payload.symbol}`,
    price,
    open,
    high,
    low,
    previousClose,
    volume: volume !== null && volume >= 0 ? volume : null,
    timestamp,
    isMarketOpen: typeof payload.is_market_open === 'boolean' ? payload.is_market_open : null,
    dataReady: true
  };
}

function mapTwelveDataCandleResponse(payload) {
  const values = payload?.values;
  if (!Array.isArray(values)) {
    const err = new Error('Twelve Data returned an invalid historical candle array.');
    err.code = 'TWELVE_DATA_CANDLE_DATA_INVALID';
    throw err;
  }

  const exchangeTz = payload?.meta?.exchange_timezone || 'Asia/Kolkata';
  const candles = [];

  for (const row of values) {
    if (!row || typeof row !== 'object') continue;

    const timestamp = normalizeExchangeTimestampToISO(
      row.datetime || row.timestamp || null,
      null,
      exchangeTz
    );
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const rawVol = row.volume !== undefined && row.volume !== null && row.volume !== '' ? Number(row.volume) : 0;
    const volume = Number.isFinite(rawVol) && rawVol >= 0 ? rawVol : 0;

    if (
      !timestamp ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0
    ) {
      continue;
    }

    const maxBody = Math.max(open, close, low);
    const minBody = Math.min(open, close, high);
    if (high < maxBody || low > minBody) {
      continue;
    }

    candles.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume
    });
  }

  // Twelve Data returns newest first; sort chronologically ascending for deterministic charting & indicators
  candles.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  return candles;
}

async function searchScrip(exchange, searchText, options = {}) {
  const normExchange = assertSupportedExchangeAndInstrument(exchange, { query: searchText });
  const query = String(searchText || '').trim();
  if (!query) {
    const err = new Error('Search text is required.');
    err.code = 'SEARCH_TEXT_REQUIRED';
    throw err;
  }

  // Require configured API key so unconfigured servers never pretend Twelve Data is active
  requireApiKey();

  const upperQuery = query.toUpperCase();
  const nowMs = options.nowMs ?? Date.now();
  const cacheKey = `search:${normExchange}:${upperQuery}`;
  const cached = getCachedEntry(cacheKey, nowMs);
  if (cached) {
    return cached;
  }

  // 1. Check verified Indian catalog first to avoid unnecessary API quota consumption
  const catalogMatches = VERIFIED_INDIAN_INSTRUMENTS.filter((item) => {
    if (item.exchange !== normExchange) return false;
    const symUpper = item.tradingsymbol.toUpperCase();
    const tdUpper = item.twelveDataSymbol.toUpperCase();
    const keyUpper = item.key.toUpperCase();

    if (
      symUpper === upperQuery ||
      tdUpper === upperQuery ||
      keyUpper === upperQuery ||
      item.aliases.some((alias) => alias.toUpperCase() === upperQuery)
    ) {
      return true;
    }

    if (
      symUpper.startsWith(upperQuery) ||
      tdUpper.startsWith(upperQuery) ||
      item.aliases.some((alias) => alias.toUpperCase().startsWith(upperQuery))
    ) {
      return true;
    }

    if (upperQuery.length >= 4 && item.name.toUpperCase().includes(upperQuery)) {
      return true;
    }

    return false;
  }).map((item) => ({
    exchange: item.exchange,
    tradingsymbol: item.tradingsymbol,
    symboltoken: item.symboltoken,
    name: item.name,
    instrumentType: item.instrumentType,
    optionType: null,
    strikePrice: null,
    expiry: null,
    lotSize: 1
  }));

  if (catalogMatches.length > 0 && !options.forceRemoteSearch) {
    const response = {
      ok: true,
      provider: 'TWELVE_DATA',
      exchange: normExchange,
      query,
      results: catalogMatches
    };
    setCachedEntry(cacheKey, response, SEARCH_CACHE_TTL_MS, nowMs);
    return response;
  }

  // 2. Query official Twelve Data /symbol_search endpoint for additional NSE/BSE cash equities
  const payload = await executeTwelveDataRequest(
    '/symbol_search',
    {
      symbol: query,
      exchange: normExchange,
      outputsize: 20
    },
    { nowMs }
  );

  const rawList = Array.isArray(payload?.data) ? payload.data : [];
  const results = [];

  for (const item of rawList) {
    const itemExchange = String(item?.exchange || '').trim().toUpperCase();
    if (itemExchange !== normExchange) continue;

    const rawSymbol = String(item?.symbol || '').trim().toUpperCase();
    if (!rawSymbol || !/^[A-Z0-9_&.-]{1,24}$/.test(rawSymbol)) continue;

    const instTypeRaw = String(item?.instrument_type || '').trim().toUpperCase();
    if (/OPTION|FUTURE|WARRANT|RIGHT/i.test(instTypeRaw)) continue;

    const isIndex = /INDEX/i.test(instTypeRaw) || /^(NIFTY|BANKNIFTY|SENSEX)/.test(rawSymbol);
    const tradingsymbol = isIndex ? rawSymbol : `${rawSymbol}-EQ`;

    results.push({
      exchange: normExchange,
      tradingsymbol,
      symboltoken: `TD:${normExchange}:${rawSymbol}`,
      name: String(item?.instrument_name || rawSymbol).trim(),
      instrumentType: isIndex ? 'INDEX' : 'EQUITY',
      optionType: null,
      strikePrice: null,
      expiry: null,
      lotSize: 1
    });
  }

  const out = {
    ok: true,
    provider: 'TWELVE_DATA',
    exchange: normExchange,
    query,
    results
  };
  setCachedEntry(cacheKey, out, SEARCH_CACHE_TTL_MS, nowMs);
  return out;
}

async function getQuote(instrument = {}, options = {}) {
  const resolved = resolveTwelveDataSymbol(instrument);
  requireApiKey();

  const nowMs = options.nowMs ?? Date.now();
  const cacheKey = `quote:${resolved.exchange}:${resolved.twelveDataSymbol}`;
  if (!options.bypassCache) {
    const cached = getCachedEntry(cacheKey, nowMs);
    if (cached) {
      return cached;
    }
  }

  const payload = await executeTwelveDataRequest(
    '/quote',
    {
      symbol: resolved.twelveDataSymbol,
      exchange: resolved.exchange,
      timezone: 'Asia/Kolkata'
    },
    { nowMs }
  );

  const normalizedInstrument = {
    exchange: resolved.exchange,
    symboltoken: resolved.symboltoken,
    tradingsymbol: resolved.tradingsymbol,
    optionType: null,
    strikePrice: null,
    expiry: null
  };

  const quote = mapTwelveDataQuoteResponse(payload, normalizedInstrument);
  const result = {
    ok: true,
    provider: 'TWELVE_DATA',
    instrument: normalizedInstrument,
    quote
  };

  setCachedEntry(cacheKey, result, QUOTE_CACHE_TTL_MS, nowMs);
  return result;
}

async function getCandles(instrument = {}, options = {}) {
  const resolved = resolveTwelveDataSymbol(instrument);
  const intervalInfo = normalizeCandleInterval(options.interval || 'FIVE_MINUTE');
  requireApiKey();

  const nowMs = options.nowMs ?? Date.now();
  const outputsize = Math.min(500, Math.max(10, Number(options.outputsize || 120)));
  const cacheKey = `candles:${resolved.exchange}:${resolved.twelveDataSymbol}:${intervalInfo.canonicalInterval}:${options.fromdate || ''}:${options.todate || ''}`;

  if (!options.bypassCache) {
    const cached = getCachedEntry(cacheKey, nowMs);
    if (cached) {
      return cached;
    }
  }

  const queryParams = {
    symbol: resolved.twelveDataSymbol,
    exchange: resolved.exchange,
    interval: intervalInfo.twelveDataInterval,
    outputsize,
    timezone: 'Asia/Kolkata'
  };

  if (options.fromdate || options.fromDate) {
    queryParams.start_date = String(options.fromdate || options.fromDate).trim();
  }
  if (options.todate || options.toDate) {
    queryParams.end_date = String(options.todate || options.toDate).trim();
  }

  const payload = await executeTwelveDataRequest('/time_series', queryParams, { nowMs });
  const candles = mapTwelveDataCandleResponse(payload);

  const normalizedInstrument = {
    exchange: resolved.exchange,
    symboltoken: resolved.symboltoken,
    tradingsymbol: resolved.tradingsymbol,
    optionType: null,
    strikePrice: null,
    expiry: null
  };

  const result = {
    ok: true,
    provider: 'TWELVE_DATA',
    instrument: normalizedInstrument,
    interval: intervalInfo.canonicalInterval,
    fromdate: queryParams.start_date || (candles[0]?.timestamp ?? null),
    todate: queryParams.end_date || (candles[candles.length - 1]?.timestamp ?? null),
    candles
  };

  setCachedEntry(cacheKey, result, CANDLE_CACHE_TTL_MS, nowMs);
  return result;
}

function getSafeStatus(cfg = getConfig()) {
  const apiKeyConfigured = Boolean(
    String(cfg?.twelveData?.apiKey || process.env.TWELVE_DATA_API_KEY || '').trim()
  );
  return {
    provider: 'TWELVE_DATA',
    mode: 'READ_ONLY',
    credentialsConfigured: apiKeyConfigured,
    authenticated: apiKeyConfigured,
    status: apiKeyConfigured ? 'CONNECTED' : 'DISCONNECTED',
    supportedExchanges: SUPPORTED_EXCHANGES,
    unsupportedExchanges: UNSUPPORTED_DERIVATIVE_EXCHANGES,
    supportedIntervals: Object.keys(VALID_CANDLE_INTERVALS),
    rateLimitPerMinute: Number(cfg?.twelveData?.rateLimitPerMinute || RATE_LIMIT_PER_MINUTE),
    rateLimitPerDay: Number(cfg?.twelveData?.rateLimitPerDay || RATE_LIMIT_PER_DAY),
    planNote:
      'NSE/BSE (XNSE/XBOM) symbols on Twelve Data require an eligible plan tier; free/Basic keys return explicit TWELVE_DATA_PLAN_RESTRICTED errors without fabricating data.'
  };
}

module.exports = {
  TWELVE_DATA_BASE_URL,
  SUPPORTED_EXCHANGES,
  UNSUPPORTED_DERIVATIVE_EXCHANGES,
  VALID_CANDLE_INTERVALS,
  VERIFIED_INDIAN_INSTRUMENTS,
  RATE_LIMIT_PER_MINUTE,
  RATE_LIMIT_PER_DAY,
  searchScrip,
  getQuote,
  getCandles,
  getSafeStatus,
  resolveTwelveDataSymbol,
  normalizeCandleInterval,
  normalizeExchangeTimestampToISO,
  mapTwelveDataQuoteResponse,
  mapTwelveDataCandleResponse,
  assertSupportedExchangeAndInstrument,
  checkAndRecordQuota,
  redactSecretsFromString,
  setHttpFetcherForTest,
  resetStateForTest
};
