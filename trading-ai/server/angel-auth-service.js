'use strict';

const config = require('./config');
const session = require('./angel-session');
const adapter = require('./angel-smartapi');

function getAuthStatus() {
  const sdk = adapter.getSDKStatus();
  const credentials = config.validateMarketDataConfig();

  return {
    provider: 'ANGEL_ONE',
    sdkLoaded: sdk.sdkLoaded,
    sdkVersion: sdk.sdkLoaded
      ? require(require('path').join(
          process.env.YASHWIN_TRADING_SERVER_ROOT ||
            require('os').homedir() + '/yashwin-trading-ai-server',
          'node_modules',
          'smartapi-javascript',
          'package.json'
        )).version
      : null,
    credentialsConfigured: credentials.ready,
    session: session.getSafeStatus()
  };
}

function requireAuthenticationReady() {
  const status = getAuthStatus();

  if (!status.sdkLoaded) {
    throw new Error('SmartAPI SDK is not available');
  }

  if (!status.credentialsConfigured) {
    throw new Error('Angel One credentials are not configured');
  }

  return status;
}

module.exports = {
  getAuthStatus,
  requireAuthenticationReady
};
