'use strict';

const config = require('./config');
const session = require('./angel-session');
const adapter = require('./angel-smartapi');
const googleAI = require('./google-ai-service');

function getAuthStatus() {
  const sdk = adapter.getSDKStatus();
  const currentConfig = config.getConfig();
  const credentials = config.validateMarketDataConfig(currentConfig);
  const aiStatus = googleAI.getGoogleAIStatus();

  const isTwelveData = currentConfig.provider === 'TWELVE_DATA';
  const sessionStatus = isTwelveData
    ? {
        provider: 'TWELVE_DATA',
        mode: 'READ_ONLY',
        status: credentials.ready ? 'CONNECTED' : 'DISCONNECTED',
        authenticated: Boolean(credentials.ready),
        loginTimestamp: null,
        error: null
      }
    : session.getSafeStatus();

  return {
    provider: currentConfig.provider === 'ANGEL_ONE' ? 'ANGEL_ONE' : currentConfig.provider,
    sdkLoaded: sdk.sdkLoaded,
    sdkVersion: sdk.sdkVersion,
    credentialsConfigured: credentials.ready,
    missingEnvVars: Array.isArray(credentials.missing) ? credentials.missing : [],
    googleAIConfigured: aiStatus.credentialsConfigured,
    googleAIModel: aiStatus.model,
    session: sessionStatus
  };
}

function requireAuthenticationReady() {
  const status = getAuthStatus();

  if (!status.sdkLoaded) {
    const err = new Error('SmartAPI SDK is not available');
    err.code = 'SMARTAPI_SDK_UNAVAILABLE';
    throw err;
  }

  if (!status.credentialsConfigured) {
    const missingList =
      Array.isArray(status.missingEnvVars) && status.missingEnvVars.length > 0
        ? ` (${status.missingEnvVars.join(', ')})`
        : '';
    const err = new Error(`Angel One credentials are not configured${missingList}`);
    err.code = 'ANGEL_CREDENTIALS_MISSING';
    err.missingEnvVars = status.missingEnvVars || [];
    throw err;
  }

  return status;
}

function getDiagnosticReport() {
  const status = getAuthStatus();
  const safeSession = status.session || {};
  const aiDiag = googleAI.getGoogleAIDiagnostics();

  return {
    credentialsConfigured: status.credentialsConfigured ? 'YES' : 'NO',
    missingEnvVars: status.missingEnvVars || [],
    sdkLoaded: status.sdkLoaded ? 'YES' : 'NO',
    sessionAuthenticated: safeSession.authenticated ? 'YES' : 'NO',
    googleAIConfigured: aiDiag.googleAIConfigured,
    googleAIModel: aiDiag.googleAIModel,
    marketDataProvider: status.provider || 'ANGEL_ONE',
    liveTrading: 'DISABLED',
    tradingMode: 'PAPER',
    orderEndpoints: 'NONE'
  };
}

async function login() {
  return session.login();
}

async function logout() {
  return session.logout();
}

module.exports = {
  getAuthStatus,
  getDiagnosticReport,
  requireAuthenticationReady,
  login,
  logout
};
