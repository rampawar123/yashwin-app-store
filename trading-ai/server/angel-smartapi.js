'use strict';

const runtime = require('./smartapi-runtime');

function createAngelSmartAPI(config = {}) {
  const { SmartAPI } = runtime.loadSmartAPI();

  const apiKey = String(config.apiKey || '').trim();

  if (!apiKey) {
    throw new Error('Angel One API key is not configured');
  }

  return new SmartAPI({
    api_key: apiKey
  });
}

function getSDKStatus() {
  let sdkLoaded = false;

  try {
    const sdk = runtime.loadSmartAPI();
    sdkLoaded = typeof sdk.SmartAPI === 'function';
  } catch (_) {
    sdkLoaded = false;
  }

  return {
    sdkLoaded,
    provider: 'ANGEL_ONE',
    mode: 'SERVER_ONLY'
  };
}

module.exports = {
  createAngelSmartAPI,
  getSDKStatus
};
