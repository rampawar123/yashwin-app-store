'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 4 — Instrument Search Normalizer & Option Validator
 *
 * No fake tokens.
 * No guessed instruments.
 */

const MONTH_MAP = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11
};

function parseExpiryDate(rawExpiry) {
  const str = String(rawExpiry || '').trim();
  if (!str) return null;

  const directMs = Date.parse(str);
  if (Number.isFinite(directMs)) {
    return new Date(directMs).toISOString();
  }

  // Angel One format e.g. "28NOV2024" or "28-NOV-2024" or "28NOV24"
  const m = str.toUpperCase().match(/^(\d{1,2})[\s\-]?([A-Z]{3})[\s\-]?(\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = MONTH_MAP[m[2]];
    let year = Number(m[3]);
    if (year < 100) year += 2000;

    if (month !== undefined && day >= 1 && day <= 31) {
      const dt = new Date(Date.UTC(year, month, day, 15, 30, 0));
      if (!Number.isNaN(dt.getTime())) {
        return dt.toISOString();
      }
    }
  }

  return null;
}

function inferInstrumentType(item = {}) {
  const explicit = String(item.instrumentType || item.type || '').trim().toUpperCase();
  if (['INDEX', 'EQUITY', 'FUTURES', 'OPTION'].includes(explicit)) {
    return explicit;
  }

  const exchange = String(item.exchange || '').trim().toUpperCase();
  const symbol = String(item.tradingsymbol || '').trim().toUpperCase();
  const optType = String(item.optionType || '').trim().toUpperCase();

  if (['NFO', 'BFO'].includes(exchange)) {
    if (optType === 'CE' || optType === 'PE' || symbol.endsWith('CE') || symbol.endsWith('PE')) {
      return 'OPTION';
    }
    if (symbol.endsWith('FUT') || optType === 'FUT' || optType === 'FF') {
      return 'FUTURES';
    }
    return 'OPTION';
  }

  if (/^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY)/.test(symbol) && !symbol.endsWith('-EQ')) {
    return 'INDEX';
  }

  return 'EQUITY';
}

function normalizeInstrument(item = {}) {
  const rawStrike = item.strikePrice ?? item.strike ?? null;
  const parsedStrike =
    rawStrike !== null && rawStrike !== '' && Number.isFinite(Number(rawStrike))
      ? Number(rawStrike)
      : null;

  const rawLotSize = item.lotSize ?? item.lotsize ?? null;
  const parsedLotSize =
    rawLotSize !== null && rawLotSize !== '' && Number.isFinite(Number(rawLotSize))
      ? Number(rawLotSize)
      : null;

  const instrumentType = inferInstrumentType(item);

  return {
    exchange: item.exchange ? String(item.exchange).trim().toUpperCase() : null,
    tradingsymbol: item.tradingsymbol ? String(item.tradingsymbol).trim() : null,
    symboltoken: item.symboltoken ? String(item.symboltoken).trim() : null,
    name: item.name ? String(item.name).trim() : (item.tradingsymbol ? String(item.tradingsymbol).trim() : null),
    instrumentType,
    optionType: item.optionType
      ? String(item.optionType).trim().toUpperCase()
      : null,
    strikePrice: parsedStrike,
    expiry: item.expiry ? String(item.expiry).trim() : null,
    lotSize: parsedLotSize
  };
}

function validateOptionContract(instrument = {}) {
  const exchange = String(instrument.exchange || '').trim().toUpperCase();
  const instType = inferInstrumentType(instrument);
  const hasOptionFields =
    Boolean(instrument.optionType) ||
    (instrument.strikePrice !== null && instrument.strikePrice !== undefined);

  if (!['NFO', 'BFO'].includes(exchange) && !hasOptionFields && instType !== 'OPTION' && instType !== 'FUTURES') {
    return {
      valid: true,
      reasons: []
    };
  }

  const reasons = [];

  if (!['NFO', 'BFO'].includes(exchange)) {
    reasons.push('Option contract must belong to a derivatives exchange (NFO or BFO).');
  }

  // Futures contract validation (NFO / BFO FUT)
  if (instType === 'FUTURES' && !instrument.optionType && (instrument.strikePrice === null || instrument.strikePrice === undefined)) {
    const expiry = String(instrument.expiry || '').trim();
    if (!expiry) {
      reasons.push('Futures expiry is required.');
    } else if (!parseExpiryDate(expiry)) {
      reasons.push('Futures expiry is not a valid date.');
    }
    return {
      valid: reasons.length === 0,
      reasons
    };
  }

  const optionType = String(instrument.optionType || '').trim().toUpperCase();
  const strikePrice = Number(instrument.strikePrice);
  const expiry = String(instrument.expiry || '').trim();

  if (optionType !== 'CE' && optionType !== 'PE') {
    reasons.push('Option type must be CE or PE.');
  }

  if (!Number.isFinite(strikePrice) || strikePrice <= 0) {
    reasons.push('Option strike price must be a positive number.');
  }

  if (!expiry) {
    reasons.push('Option expiry is required.');
  } else if (!parseExpiryDate(expiry)) {
    reasons.push('Option expiry is not a valid date.');
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function assertValidOptionContract(instrument = {}) {
  const result = validateOptionContract(instrument);

  if (!result.valid) {
    const error = new Error(
      `Invalid option contract: ${result.reasons.join(' ')}`
    );

    error.code = 'INVALID_OPTION_CONTRACT';
    error.reasons = result.reasons;

    throw error;
  }

  return instrument;
}

function normalizeSearchResults(response = {}) {
  const source = Array.isArray(response)
    ? response
    : Array.isArray(response.results)
      ? response.results
      : [];

  return source
    .map(normalizeInstrument)
    .filter(
      (item) =>
        item.exchange &&
        item.tradingsymbol &&
        item.symboltoken
    );
}

function findExact(results = [], tradingsymbol = '') {
  const target = String(tradingsymbol || '')
    .trim()
    .toUpperCase();

  if (!target) return null;

  return (
    results.find(
      (item) =>
        String(item.tradingsymbol || '').toUpperCase() === target ||
        String(item.symboltoken || '') === target
    ) || null
  );
}

module.exports = {
  inferInstrumentType,
  normalizeInstrument,
  normalizeSearchResults,
  findExact,
  validateOptionContract,
  assertValidOptionContract,
  parseExpiryDate
};
