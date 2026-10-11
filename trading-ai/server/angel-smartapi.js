'use strict';

const runtime = require('./smartapi-runtime');

function createAngelSmartAPI(config = {}) {
  const { SmartAPI } = runtime.loadSmartAPI();

  const apiKey = String(config.apiKey || '').trim();

  if (!apiKey) {
    const err = new Error('Angel One API key is not configured.');
    err.code = 'ANGEL_API_KEY_MISSING';
    throw err;
  }

  return new SmartAPI({
    api_key: apiKey
  });
}

function getSDKStatus() {
  const info = runtime.getRuntimeInfo();

  return {
    sdkLoaded: info.sdkLoaded,
    sdkVersion: info.sdkVersion,
    provider: 'ANGEL_ONE',
    mode: 'SERVER_ONLY'
  };
}

module.exports = {
  createAngelSmartAPI,
  getSDKStatus
};
