'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Standardized Error Categories & Safe Error Normalization
 *
 * Categories:
 * - AUTH_ERROR
 * - DATA_UNAVAILABLE
 * - STALE_DATA
 * - INVALID_DATA
 * - PROVIDER_NOT_CONNECTED
 * - AI_UNAVAILABLE
 * - AI_INVALID_RESPONSE
 * - RISK_REJECTED
 * - PAPER_EXECUTION_ERROR
 * - DATABASE_ERROR
 * - CONFIG_ERROR
 * - INTERNAL_ERROR
 *
 * Never exposes secret values.
 */

const CATEGORIES = Object.freeze({
  AUTH_ERROR: 'AUTH_ERROR',
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
  STALE_DATA: 'STALE_DATA',
  INVALID_DATA: 'INVALID_DATA',
  PROVIDER_NOT_CONNECTED: 'PROVIDER_NOT_CONNECTED',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
  RISK_REJECTED: 'RISK_REJECTED',
  PAPER_EXECUTION_ERROR: 'PAPER_EXECUTION_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  CONFIG_ERROR: 'CONFIG_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
});

function classifyErrorCategory(code = '') {
  const c = String(code || '').toUpperCase();

  if (
    c.includes('ANGEL_CREDENTIALS_MISSING') ||
    c.includes('ANGEL_API_KEY_MISSING') ||
    c.includes('CONFIG')
  ) {
    return CATEGORIES.CONFIG_ERROR;
  }

  if (
    c.includes('AUTH') ||
    c.includes('LOGIN') ||
    c.includes('TOTP') ||
    c.includes('SESSION_EXPIRED')
  ) {
    return CATEGORIES.AUTH_ERROR;
  }

  if (
    c.includes('SESSION_NOT_CONNECTED') ||
    c.includes('PROVIDER_NOT_CONNECTED') ||
    c.includes('SMARTAPI_SDK_UNAVAILABLE')
  ) {
    return CATEGORIES.PROVIDER_NOT_CONNECTED;
  }

  if (c.includes('STALE')) {
    return CATEGORIES.STALE_DATA;
  }

  if (
    c.includes('FUTURE') ||
    c.includes('INVALID_PRICE') ||
    c.includes('INVALID_TIMESTAMP') ||
    c.includes('INVALID_EXCHANGE') ||
    c.includes('INVALID_OPTION') ||
    c.includes('INVALID_MARKET_DATA') ||
    c.includes('INVALID_DATA') ||
    c.includes('INVALID_JSON') ||
    c.includes('INVALID_BACKTEST') ||
    c.includes('UNSORTED_BACKTEST')
  ) {
    return CATEGORIES.INVALID_DATA;
  }

  if (
    c.includes('DATA_UNAVAILABLE') ||
    c.includes('DATA_REQUIRED') ||
    c.includes('EMPTY_BACKTEST') ||
    c.includes('NOT_FOUND') ||
    c.includes('MARKET_DATA_NOT_READY')
  ) {
    return CATEGORIES.DATA_UNAVAILABLE;
  }

  if (
    c.includes('GOOGLE_AI_CREDENTIALS_MISSING') ||
    c.includes('AI_UNAVAILABLE')
  ) {
    return CATEGORIES.AI_UNAVAILABLE;
  }

  if (
    c.includes('AI_CONTRACT_VIOLATION') ||
    c.includes('INVALID_AI') ||
    c.includes('AI_INVALID_RESPONSE')
  ) {
    return CATEGORIES.AI_INVALID_RESPONSE;
  }

  if (
    c.includes('RISK_REJECTED') ||
    c.includes('AI_SAFETY_REJECTED') ||
    c.includes('EMERGENCY_STOP')
  ) {
    return CATEGORIES.RISK_REJECTED;
  }

  if (c.includes('PAPER')) {
    return CATEGORIES.PAPER_EXECUTION_ERROR;
  }

  if (c.includes('DATABASE') || c.includes('SQLITE')) {
    return CATEGORIES.DATABASE_ERROR;
  }

  return CATEGORIES.INTERNAL_ERROR;
}

function createTypedError(category, code, message, status = 400) {
  const err = new Error(String(message || 'Operation failed.'));
  err.category = CATEGORIES[category] || classifyErrorCategory(code);
  err.code = String(code || err.category);
  err.status = Number(status) || 400;
  return err;
}

function normalizeErrorResponse(error) {
  const code = String(error?.code || 'INTERNAL_ERROR');
  const category =
    error?.category && CATEGORIES[error.category]
      ? error.category
      : classifyErrorCategory(code);

  return {
    ok: false,
    category,
    code,
    message: String(error?.message || 'An unexpected error occurred.')
  };
}

module.exports = {
  CATEGORIES,
  classifyErrorCategory,
  createTypedError,
  normalizeErrorResponse
};
