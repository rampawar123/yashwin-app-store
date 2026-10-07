'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — Step 21
 *
 * Canonical instrument mapping.
 *
 * IMPORTANT:
 * symboltoken values must come from the official
 * Angel One instrument master.
 *
 * Never guess or hard-code an unverified token.
 */

const instruments = {
  NIFTY50: {
    key: 'NIFTY50',
    name: 'NIFTY 50',
    exchange: 'NSE',
    type: 'INDEX',
    tradingsymbol: null,
    symboltoken: null
  },

  BANKNIFTY: {
    key: 'BANKNIFTY',
    name: 'BANK NIFTY',
    exchange: 'NSE',
    type: 'INDEX',
    tradingsymbol: null,
    symboltoken: null
  },

  SENSEX: {
    key: 'SENSEX',
    name: 'SENSEX',
    exchange: 'BSE',
    type: 'INDEX',
    tradingsymbol: null,
    symboltoken: null
  }
};

function getInstrument(key) {
  return instruments[String(key || '').toUpperCase()] || null;
}

function listInstruments() {
  return Object.values(instruments);
}

function validateBrokerMapping(instrument) {
  if (!instrument) {
    return {
      valid: false,
      code: 'INSTRUMENT_NOT_FOUND'
    };
  }

  if (!instrument.tradingsymbol || !instrument.symboltoken) {
    return {
      valid: false,
      code: 'BROKER_MAPPING_NOT_READY'
    };
  }

  return {
    valid: true,
    code: 'OK',
    instrument
  };
}

module.exports = {
  instruments,
  getInstrument,
  listInstruments,
  validateBrokerMapping
};
