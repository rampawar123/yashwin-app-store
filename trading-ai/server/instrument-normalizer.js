'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — Step 23
 *
 * Normalizes broker instrument-search results.
 *
 * No fake tokens.
 * No guessed instruments.
 */

function normalizeInstrument(item = {}) {
  return {
    exchange: item.exchange
      ? String(item.exchange).trim().toUpperCase()
      : null,

    tradingsymbol: item.tradingsymbol
      ? String(item.tradingsymbol).trim()
      : null,

    symboltoken: item.symboltoken
      ? String(item.symboltoken).trim()
      : null,

    optionType: item.optionType
      ? String(item.optionType).trim().toUpperCase()
      : null,

    strikePrice: Number.isFinite(Number(item.strikePrice))
      ? Number(item.strikePrice)
      : null,

    expiry: item.expiry
      ? String(item.expiry).trim()
      : null
  };
}

function validateOptionContract(instrument = {}) {
  const exchange = String(instrument.exchange || '').trim().toUpperCase();

  // Non-derivative instruments keep the existing validation flow.
  if (!['NFO', 'BFO'].includes(exchange)) {
    return {
      valid: true,
      reasons: []
    };
  }

  const reasons = [];
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
  } else if (Number.isNaN(Date.parse(expiry))) {
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
  const source = Array.isArray(response.results)
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

function findExact(results, tradingsymbol) {
  const target = String(tradingsymbol || '')
    .trim()
    .toUpperCase();

  return results.find(
    (item) =>
      item.tradingsymbol.toUpperCase() === target
  ) || null;
}

module.exports = {
  normalizeInstrument,
  normalizeSearchResults,
  findExact,
  validateOptionContract,
  assertValidOptionContract
};
