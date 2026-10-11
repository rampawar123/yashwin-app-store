'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 5 — Server-Side Angel One Read-Only Market-Data Adapter
 *
 * No orders.
 * No trading decisions.
 * No fake prices.
 */

const runtime = require('./smartapi-runtime');
const session = require('./angel-session');
const { getConfig } = require('./config');

const MONTH_MAP = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12'
};

function normalizeTimestampToISO(rawTimestamp) {
  if (!rawTimestamp) {
    return null;
  }

  if (typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp)) {
    const dt = new Date(rawTimestamp);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  const str = String(rawTimestamp).trim();
  if (!str) return null;

  // Check Angel One format: "21-Oct-2024 14:35:10" or "21-OCT-2024 14:35:10"
  const angelMatch = str.match(
    /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/
  );
  if (angelMatch) {
    const day = angelMatch[1].padStart(2, '0');
    const month = MONTH_MAP[angelMatch[2].toUpperCase()];
    const year = angelMatch[3];
    const hh = angelMatch[4];
    const mm = angelMatch[5];
    const ss = angelMatch[6];

    if (month) {
      // IST (+05:30) exchange timestamp
      const isoCandidate = `${year}-${month}-${day}T${hh}:${mm}:${ss}+05:30`;
      const ms = Date.parse(isoCandidate);
      if (Number.isFinite(ms)) {
        return new Date(ms).toISOString();
      }
    }
  }

  const parsedMs = Date.parse(str);
  if (Number.isFinite(parsedMs)) {
    return new Date(parsedMs).toISOString();
  }

  return null;
}

function requireAuthenticatedAPI() {
  const current = session.getSession();

  if (current.status !== 'CONNECTED' || !current.accessToken) {
    const error = new Error('Angel One session is not authenticated.');
    error.code = 'ANGEL_SESSION_NOT_READY';
    throw error;
  }

  const sdk = runtime.loadSmartAPI();
  const cfg = getConfig();

  const api = new sdk.SmartAPI({
    api_key: cfg.angel.apiKey
  });

  api.setAccessToken(current.accessToken);

  return api;
}

function validateInstrument(instrument = {}) {
  if (!instrument.exchange) {
    const err = new Error('Instrument exchange is required.');
    err.code = 'INVALID_INSTRUMENT_EXCHANGE';
    throw err;
  }

  if (!instrument.symboltoken) {
    const err = new Error('Instrument symbol token is required.');
    err.code = 'INVALID_INSTRUMENT_TOKEN';
    throw err;
  }

  if (!instrument.tradingsymbol) {
    const err = new Error('Instrument trading symbol is required.');
    err.code = 'INVALID_INSTRUMENT_SYMBOL';
    throw err;
  }

  return {
    exchange: String(instrument.exchange).trim().toUpperCase(),
    symboltoken: String(instrument.symboltoken).trim(),
    tradingsymbol: String(instrument.tradingsymbol).trim(),
    optionType: instrument.optionType || null,
    strikePrice: instrument.strikePrice ?? null,
    expiry: instrument.expiry || null
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapAngelQuoteResponse(response, instrument) {
  const fetched = response?.data?.fetched;

  if (!Array.isArray(fetched) || fetched.length === 0) {
    const error = new Error('Angel One returned no fetched market quote.');
    error.code = 'ANGEL_MARKET_DATA_EMPTY';
    throw error;
  }

  const row =
    fetched.find(
      (item) =>
        String(item?.exchange || '').toUpperCase() ===
          String(instrument.exchange).toUpperCase() &&
        String(item?.symbolToken || '') === String(instrument.symboltoken)
    ) || fetched[0];

  const price = Number(row?.ltp);
  if (!Number.isFinite(price) || price <= 0) {
    const error = new Error('Angel One returned an invalid LTP.');
    error.code = 'ANGEL_MARKET_DATA_INVALID_PRICE';
    throw error;
  }

  const rawTime = row?.exchTradeTime || row?.exchFeedTime || row?.timestamp || null;
  const timestamp = normalizeTimestampToISO(rawTime);

  if (!timestamp) {
    const error = new Error('Angel One quote is missing a valid timestamp.');
    error.code = 'ANGEL_MARKET_DATA_INVALID_TIMESTAMP';
    throw error;
  }

  return {
    instrument: instrument.tradingsymbol || instrument.key || null,
    exchange: row?.exchange || instrument.exchange,
    tradingSymbol: row?.tradingSymbol || instrument.tradingsymbol,
    symbolToken: row?.symbolToken || instrument.symboltoken,
    price,
    open: numberOrNull(row?.open),
    high: numberOrNull(row?.high),
    low: numberOrNull(row?.low),
    previousClose: numberOrNull(row?.close),
    volume: numberOrNull(row?.tradeVolume),
    timestamp,
    dataReady: true
  };
}

async function getQuote(instrument) {
  const normalized = validateInstrument(instrument);
  const api = requireAuthenticatedAPI();

  const exchangeTokens = {
    [normalized.exchange]: [normalized.symboltoken]
  };

  let response;
  if (typeof api.marketData === 'function') {
    response = await api.marketData({
      mode: 'FULL',
      exchangeTokens
    });
  } else if (typeof api.getMarketData === 'function') {
    response = await api.getMarketData('FULL', exchangeTokens);
  } else {
    const err = new Error('SmartAPI marketData method is unavailable.');
    err.code = 'ANGEL_MARKET_DATA_UNAVAILABLE';
    throw err;
  }

  if (!response || response.status !== true) {
    const error = new Error('Angel One returned an invalid market-data response.');
    error.code = 'ANGEL_MARKET_DATA_INVALID';
    throw error;
  }

  const quote = mapAngelQuoteResponse(response, normalized);

  return {
    ok: true,
    provider: 'ANGEL_ONE',
    instrument: normalized,
    quote
  };
}

const VALID_CANDLE_INTERVALS = new Set([
  'ONE_MINUTE',
  'THREE_MINUTE',
  'FIVE_MINUTE',
  'TEN_MINUTE',
  'FIFTEEN_MINUTE',
  'THIRTY_MINUTE',
  'ONE_HOUR',
  'ONE_DAY'
]);

const INTERVAL_ALIAS_MAP = {
  '1m': 'ONE_MINUTE',
  '1min': 'ONE_MINUTE',
  '3m': 'THREE_MINUTE',
  '3min': 'THREE_MINUTE',
  '5m': 'FIVE_MINUTE',
  '5min': 'FIVE_MINUTE',
  '10m': 'TEN_MINUTE',
  '10min': 'TEN_MINUTE',
  '15m': 'FIFTEEN_MINUTE',
  '15min': 'FIFTEEN_MINUTE',
  '30m': 'THIRTY_MINUTE',
  '30min': 'THIRTY_MINUTE',
  '1h': 'ONE_HOUR',
  '60m': 'ONE_HOUR',
  '1d': 'ONE_DAY',
  'day': 'ONE_DAY',
  'daily': 'ONE_DAY'
};

function normalizeCandleInterval(rawInterval = 'FIVE_MINUTE') {
  const cleaned = String(rawInterval || 'FIVE_MINUTE').trim();
  const upper = cleaned.toUpperCase();
  if (VALID_CANDLE_INTERVALS.has(upper)) {
    return upper;
  }
  const alias = INTERVAL_ALIAS_MAP[cleaned.toLowerCase()];
  if (alias) {
    return alias;
  }
  const err = new Error(`Unsupported candle interval: ${cleaned}`);
  err.code = 'INVALID_CANDLE_INTERVAL';
  throw err;
}

function formatAngelDateString(dateInput) {
  if (!dateInput) return null;
  if (
    typeof dateInput === 'string' &&
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(dateInput.trim())
  ) {
    return dateInput.trim();
  }
  const ms = typeof dateInput === 'number' ? dateInput : Date.parse(String(dateInput));
  if (!Number.isFinite(ms)) return null;
  // Format in IST (+05:30) as "YYYY-MM-DD HH:mm"
  const istMs = ms + (5 * 60 + 30) * 60 * 1000;
  const d = new Date(istMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function mapAngelCandleResponse(response) {
  const rows = response?.data;
  if (!Array.isArray(rows)) {
    const err = new Error('Angel One returned an invalid candle data array.');
    err.code = 'ANGEL_CANDLE_DATA_INVALID';
    throw err;
  }

  const candles = [];
  for (const row of rows) {
    let rawTime;
    let open;
    let high;
    let low;
    let close;
    let volume;

    if (Array.isArray(row)) {
      rawTime = row[0];
      open = Number(row[1]);
      high = Number(row[2]);
      low = Number(row[3]);
      close = Number(row[4]);
      volume = Number(row[5] ?? 0);
    } else if (row && typeof row === 'object') {
      rawTime = row.timestamp || row.time || row.date;
      open = Number(row.open);
      high = Number(row.high);
      low = Number(row.low);
      close = Number(row.close ?? row.price);
      volume = Number(row.volume ?? 0);
    } else {
      continue;
    }

    const timestamp = normalizeTimestampToISO(rawTime);
    if (
      !timestamp ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      high < low
    ) {
      continue;
    }

    candles.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) && volume >= 0 ? volume : 0
    });
  }

  return candles;
}

async function getCandles(instrument, options = {}) {
  const normalized = validateInstrument(instrument);
  const interval = normalizeCandleInterval(options.interval || 'FIVE_MINUTE');
  const nowMs = options.nowMs ?? Date.now();
  const defaultFromMs = nowMs - 5 * 24 * 60 * 60 * 1000;

  const fromdate =
    formatAngelDateString(options.fromdate || options.fromDate || defaultFromMs);
  const todate =
    formatAngelDateString(options.todate || options.toDate || nowMs);

  if (!fromdate || !todate) {
    const err = new Error('Valid fromdate and todate are required for historical candles.');
    err.code = 'INVALID_CANDLE_DATES';
    throw err;
  }

  const api = requireAuthenticatedAPI();

  if (typeof api.getCandleData !== 'function') {
    const err = new Error('SmartAPI getCandleData method is unavailable.');
    err.code = 'ANGEL_CANDLE_DATA_UNAVAILABLE';
    throw err;
  }

  const response = await api.getCandleData({
    exchange: normalized.exchange,
    symboltoken: normalized.symboltoken,
    interval,
    fromdate,
    todate
  });

  if (!response || response.status !== true) {
    const err = new Error('Angel One returned an invalid historical candle response.');
    err.code = 'ANGEL_CANDLE_DATA_INVALID';
    throw err;
  }

  const candles = mapAngelCandleResponse(response);

  return {
    ok: true,
    provider: 'ANGEL_ONE',
    instrument: normalized,
    interval,
    fromdate,
    todate,
    candles
  };
}

module.exports = {
  getQuote,
  getCandles,
  validateInstrument,
  mapAngelQuoteResponse,
  mapAngelCandleResponse,
  normalizeCandleInterval,
  formatAngelDateString,
  normalizeTimestampToISO
};
