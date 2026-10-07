'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — Step 20
 * Server-side Angel One read-only market-data adapter.
 *
 * No orders.
 * No trading decisions.
 * No fake prices.
 */

const runtime = require('./smartapi-runtime');
const session = require('./angel-session');

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

  const sdk = runtime.loadSmartAPI();

  const api = new sdk.SmartAPI({
    api_key: require('./config').config.angel.apiKey
  });

  api.setAccessToken(current.accessToken);

  return api;
}

function validateInstrument(instrument = {}) {
  if (!instrument.exchange) {
    throw new Error('Instrument exchange is required.');
  }

  if (!instrument.symboltoken) {
    throw new Error('Instrument symbol token is required.');
  }

  if (!instrument.tradingsymbol) {
    throw new Error('Instrument trading symbol is required.');
  }

  return {
    exchange: String(instrument.exchange).toUpperCase(),
    symboltoken: String(instrument.symboltoken),
    tradingsymbol: String(instrument.tradingsymbol)
  };
}

async function getQuote(instrument) {
  const normalized = validateInstrument(instrument);
  const api = requireAuthenticatedAPI();

  /*
   * READ-ONLY quote request.
   *
   * SmartAPI quote API:
   * getMarketData(mode, exchangeTokens)
   *
   * No placeOrder / modifyOrder / cancelOrder calls exist here.
   */

  const response = await api.getMarketData(
    'FULL',
    {
      [normalized.exchange]: [normalized.symboltoken]
    }
  );

  if (!response || response.status !== true) {
    const error = new Error(
      'Angel One returned an invalid market-data response.'
    );

    error.code = 'ANGEL_MARKET_DATA_INVALID';
    throw error;
  }

  return {
    ok: true,
    provider: 'ANGEL_ONE',
    instrument: normalized,
    raw: response
  };
}

module.exports = {
  getQuote,
  validateInstrument
};
