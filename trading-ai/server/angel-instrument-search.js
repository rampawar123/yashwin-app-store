'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 4 — Angel One Read-Only Instrument Search
 *
 * No orders.
 * No trading decisions.
 * No fake symbol tokens.
 */

const runtime = require('./smartapi-runtime');
const session = require('./angel-session');
const { getConfig } = require('./config');

const ALLOWED_EXCHANGES = ['NSE', 'BSE', 'NFO', 'BFO'];

function requireAuthenticatedAPI() {
  const current = session.getSession();

  if (current.status !== 'CONNECTED' || !current.accessToken) {
    const error = new Error('Angel One session is not authenticated.');
    error.code = 'ANGEL_SESSION_NOT_READY';
    throw error;
  }

  const { SmartAPI } = runtime.loadSmartAPI();
  const cfg = getConfig();

  const api = new SmartAPI({
    api_key: cfg.angel.apiKey
  });

  api.setAccessToken(current.accessToken);

  return api;
}

function validateSearch(exchange, searchText) {
  const normalizedExchange = String(exchange || '').trim().toUpperCase();
  const normalizedSearch = String(searchText || '').trim();

  if (!ALLOWED_EXCHANGES.includes(normalizedExchange)) {
    const error = new Error('Unsupported Angel One exchange.');
    error.code = 'INVALID_EXCHANGE';
    throw error;
  }

  if (!normalizedSearch) {
    const error = new Error('Search text is required.');
    error.code = 'SEARCH_TEXT_REQUIRED';
    throw error;
  }

  return {
    exchange: normalizedExchange,
    searchscrip: normalizedSearch,
    query: normalizedSearch
  };
}

function extractOptionMetadata(item = {}) {
  let optionType = item.optionType || item.optiontype || null;
  let strikePrice = item.strikePrice ?? item.strike ?? null;
  let expiry = item.expiry || item.expirydate || null;
  let instrumentType = item.instrumentType || item.instrumenttype || null;

  const symbol = String(item.tradingsymbol || '').trim().toUpperCase();
  const exchange = String(item.exchange || '').trim().toUpperCase();

  if (['NFO', 'BFO'].includes(exchange)) {
    if (!optionType && (symbol.endsWith('CE') || symbol.endsWith('PE'))) {
      optionType = symbol.slice(-2);
    }

    if ((strikePrice === null || expiry === null) && symbol) {
      // Match option patterns like NIFTY24OCT25000CE, NIFTY28NOV2425000CE, NIFTY28NOV202425000CE
      const match =
        symbol.match(/^([A-Z]+)(\d{2}[A-Z]{3}\d{2})(\d{3,6}(?:\.\d+)?)(CE|PE)$/) ||
        symbol.match(/^([A-Z]+)(\d{2}[A-Z]{3})(\d+(?:\.\d+)?)(CE|PE)$/) ||
        symbol.match(/^([A-Z]+)(\d{2}[A-Z]{3}\d{0,4}?)(\d+(?:\.\d+)?)(CE|PE)$/);
      if (match) {
        if (!expiry && match[2]) {
          expiry = match[2];
        }
        if (strikePrice === null && match[3]) {
          strikePrice = Number(match[3]);
        }
      } else {
        // Match futures patterns like NIFTY28NOV24FUT or RELIANCE28NOV2024FUT
        const futMatch = symbol.match(/^([A-Z]+)(\d{2}[A-Z]{3}\d{0,4})FUT$/);
        if (futMatch && !expiry && futMatch[2]) {
          expiry = futMatch[2];
        }
      }
    }

    const normOpt = optionType ? String(optionType).trim().toUpperCase() : null;
    if (!instrumentType) {
      if (normOpt === 'CE' || normOpt === 'PE') {
        instrumentType = 'OPTION';
      } else if (symbol.endsWith('FUT') || normOpt === 'FUT' || normOpt === 'FF') {
        instrumentType = 'FUTURES';
      } else {
        instrumentType = 'OPTION';
      }
    }
  } else if (!instrumentType) {
    instrumentType = /^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY)/.test(symbol) && !symbol.endsWith('-EQ')
      ? 'INDEX'
      : 'EQUITY';
  }

  return {
    instrumentType: instrumentType ? String(instrumentType).trim().toUpperCase() : null,
    optionType: optionType ? String(optionType).trim().toUpperCase() : null,
    strikePrice:
      strikePrice !== null && strikePrice !== '' && Number.isFinite(Number(strikePrice))
        ? Number(strikePrice)
        : null,
    expiry: expiry ? String(expiry).trim() : null
  };
}

async function searchScrip(exchange, searchText) {
  const params = validateSearch(exchange, searchText);
  const api = requireAuthenticatedAPI();

  if (typeof api.searchScrip !== 'function') {
    const error = new Error('SmartAPI searchScrip method is unavailable.');
    error.code = 'ANGEL_SEARCH_SCRIP_UNAVAILABLE';
    throw error;
  }

  const response =
    api.searchScrip.length >= 2
      ? await api.searchScrip(params.exchange, params.searchscrip)
      : await api.searchScrip({
          exchange: params.exchange,
          searchscrip: params.searchscrip
        });

  if (!response || response.status !== true) {
    const error = new Error('Angel One returned an invalid instrument-search response.');
    error.code = 'ANGEL_SEARCH_SCRIP_FAILED';
    throw error;
  }

  const results = Array.isArray(response.data)
    ? response.data.map((item) => {
        const meta = extractOptionMetadata({
          ...item,
          exchange: item.exchange || params.exchange
        });
        return {
          exchange: item.exchange || params.exchange,
          tradingsymbol: item.tradingsymbol || null,
          symboltoken: item.symboltoken || null,
          name: item.name || item.companyname || item.tradingsymbol || null,
          instrumentType: meta.instrumentType,
          optionType: meta.optionType,
          strikePrice: meta.strikePrice,
          expiry: meta.expiry,
          lotSize:
            item.lotsize !== undefined && Number.isFinite(Number(item.lotsize))
              ? Number(item.lotsize)
              : null
        };
      })
    : [];

  return {
    ok: true,
    provider: 'ANGEL_ONE',
    exchange: params.exchange,
    query: params.query,
    results
  };
}

module.exports = {
  ALLOWED_EXCHANGES,
  searchScrip,
  validateSearch,
  extractOptionMetadata
};
