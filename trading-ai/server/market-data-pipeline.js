'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — Step 24
 *
 * Search → Normalize → Quote pipeline.
 *
 * Read-only.
 * No orders.
 * No fake market data.
 */

const instrumentSearch = require('./angel-instrument-search');
const normalizer = require('./instrument-normalizer');
const quoteAdapter = require('./angel-market-data');

async function resolveInstrument(exchange, searchText, exactSymbol) {
  const searchResponse =
    await instrumentSearch.searchScrip(
      exchange,
      searchText
    );

  const results =
    normalizer.normalizeSearchResults(
      searchResponse
    );

  if (!results.length) {
    const error = new Error(
      'No valid broker instruments found.'
    );

    error.code = 'INSTRUMENT_NOT_FOUND';
    throw error;
  }

  if (exactSymbol) {
    const exact =
      normalizer.findExact(
        results,
        exactSymbol
      );

    if (!exact) {
      const error = new Error(
        'Exact trading symbol was not found.'
      );

      error.code = 'EXACT_INSTRUMENT_NOT_FOUND';
      throw error;
    }

    return exact;
  }

  return results[0];
}

async function getQuoteBySearch(
  exchange,
  searchText,
  exactSymbol
) {
  const instrument =
    await resolveInstrument(
      exchange,
      searchText,
      exactSymbol
    );

  // NFO/BFO contracts must pass strict option metadata validation
  // before any quote request is allowed.
  normalizer.assertValidOptionContract(instrument);

  const quoteResponse =
    await quoteAdapter.getQuote(
      instrument
    );

  return {
    ok: true,
    instrument,
    provider: quoteResponse.provider,
    quote: quoteResponse.quote
  };
}

module.exports = {
  resolveInstrument,
  getQuoteBySearch
};