'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — Step 22
 *
 * Angel One read-only instrument search.
 *
 * No orders.
 * No trading decisions.
 * No fake symbol tokens.
 */

const runtime = require('./smartapi-runtime');
const session = require('./angel-session');
const { config } = require('./config');

function requireAuthenticatedAPI() {
  const current = session.getSession();

  if (
    current.status !== 'CONNECTED' ||
    !current.accessToken
  ) {
    const error = new Error(
      'Angel One session is not authenticated.'
    );

    error.code = 'ANGEL_SESSION_NOT_READY';
    throw error;
  }

  const { SmartAPI } = runtime.loadSmartAPI();

  const api = new SmartAPI({
    api_key: config.angel.apiKey
  });

  api.setAccessToken(current.accessToken);

  return api;
}

function validateSearch(exchange, searchText) {
  const allowedExchanges = ['NSE', 'BSE', 'NFO', 'BFO'];

  const normalizedExchange =
    String(exchange || '').trim().toUpperCase();

  const normalizedSearch =
    String(searchText || '').trim();

  if (!allowedExchanges.includes(normalizedExchange)) {
    const error = new Error(
      'Unsupported Angel One exchange.'
    );

    error.code = 'INVALID_EXCHANGE';
    throw error;
  }

  if (!normalizedSearch) {
    const error = new Error(
      'Search text is required.'
    );

    error.code = 'SEARCH_TEXT_REQUIRED';
    throw error;
  }

  return {
    exchange: normalizedExchange,
    searchscrip: normalizedSearch
  };
}

async function searchScrip(exchange, searchText) {
  const params = validateSearch(exchange, searchText);
  const api = requireAuthenticatedAPI();

  if (typeof api.searchScrip !== 'function') {
    const error = new Error(
      'SmartAPI searchScrip method is unavailable.'
    );

    error.code = 'ANGEL_SEARCH_SCRIP_UNAVAILABLE';
    throw error;
  }

  const response = await api.searchScrip(
    params.exchange,
    params.searchscrip
  );

  if (!response || response.status !== true) {
    const error = new Error(
      'Angel One returned an invalid instrument-search response.'
    );

    error.code = 'ANGEL_SEARCH_SCRIP_FAILED';
    throw error;
  }

  const results = Array.isArray(response.data)
    ? response.data.map((item) => ({
        exchange: item.exchange || null,
        tradingsymbol: item.tradingsymbol || null,
        symboltoken: item.symboltoken || null,
        optionType: item.optionType || null,
        strikePrice: item.strikePrice ?? null,
        expiry: item.expiry || null
      }))
    : [];

  return {
    ok: true,
    provider: 'ANGEL_ONE',
    exchange: params.exchange,
    query: params.searchscrip,
    results
  };
}

module.exports = {
  searchScrip,
  validateSearch
};
