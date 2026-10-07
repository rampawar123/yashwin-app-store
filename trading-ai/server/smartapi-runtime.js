'use strict';

const path = require('path');

const INTERNAL_SERVER_ROOT =
  process.env.YASHWIN_TRADING_SERVER_ROOT ||
  path.join(process.env.HOME || '', 'yashwin-trading-ai-server');

function loadSmartAPI() {
  try {
    return require(path.join(
      INTERNAL_SERVER_ROOT,
      'node_modules',
      'smartapi-javascript'
    ));
  } catch (error) {
    const err = new Error(
      'SmartAPI SDK could not be loaded from internal server runtime'
    );
    err.cause = error;
    throw err;
  }
}

function getRuntimeInfo() {
  const sdk = loadSmartAPI();
  return {
    runtimeRoot: INTERNAL_SERVER_ROOT,
    sdkLoaded: typeof sdk.SmartAPI === 'function',
    sdkVersion: require(path.join(
      INTERNAL_SERVER_ROOT,
      'node_modules',
      'smartapi-javascript',
      'package.json'
    )).version
  };
}

module.exports = {
  loadSmartAPI,
  getRuntimeInfo
};
