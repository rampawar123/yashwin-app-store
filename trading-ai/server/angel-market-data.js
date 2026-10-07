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

function mapAngelQuoteResponse(response, instrument) {
  const fetched = response?.data?.fetched;

  if (!Array.isArray(fetched) || fetched.length === 0) {
    const error = new Error('Angel One returned no fetched market quote.');
    error.code = 'ANGEL_MARKET_DATA_EMPTY';
    throw error;
  }

  const row = fetched.find(item =>
    String(item?.exchange || '').toUpperCase() === String(instrument.exchange).toUpperCase() &&
    String(item?.symbolToken || '') === String(instrument.symboltoken)
  ) || fetched[0];

  const price = Number(row?.ltp);
  if (!Number.isFinite(price) || price <= 0) {
    const error = new Error('Angel One returned an invalid LTP.');
    error.code = 'ANGEL_MARKET_DATA_INVALID_PRICE';
    throw error;
  }

  const timestamp = row?.exchTradeTime || row?.exchFeedTime || null;

  return {
    instrument: instrument,
    exchange: row?.exchange || instrument.exchange,
    tradingSymbol: row?.tradingSymbol || instrument.tradingsymbol,
    symbolToken: row?.symbolToken || instrument.symboltoken,
    price,
    open: row?.open ?? null,
    high: row?.high ?? null,
    low: row?.low ?? null,
    previousClose: row?.close ?? null,
    volume: row?.tradeVolume ?? null,
    timestamp,
    dataReady: true
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

  const response = await api.marketData({
    mode: 'FULL',
    exchangeTokens: {
      [normalized.exchange]: [normalized.symboltoken]
    }
  });

  if (!response || response.status !== true) {
    const error = new Error(
      'Angel One returned an invalid market-data response.'
    );

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

module.exports = {
  getQuote,
  validateInstrument,
  mapAngelQuoteResponse
};
