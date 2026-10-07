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
      : null
  };
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
  findExact
};
