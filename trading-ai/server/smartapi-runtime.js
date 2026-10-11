'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — SmartAPI Runtime Loader
 *
 * Uses standard Node module resolution first, with optional
 * custom server root fallback or test mock injection.
 * No hardcoded HOME paths.
 */

const path = require('path');

let mockSDK = null;

function setMockSmartAPI(sdk) {
  mockSDK = sdk || null;
}

function getMockSmartAPI() {
  return mockSDK;
}

function resolveCandidatePaths() {
  const candidates = ['smartapi-javascript'];
  const customRoot = String(process.env.YASHWIN_TRADING_SERVER_ROOT || '').trim();

  if (customRoot) {
    candidates.push(path.join(customRoot, 'node_modules', 'smartapi-javascript'));
  }

  return candidates;
}

function loadSmartAPI() {
  if (mockSDK) {
    return mockSDK;
  }

  const candidates = resolveCandidatePaths();
  let lastError = null;

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  const err = new Error('SmartAPI SDK could not be loaded from server runtime.');
  err.code = 'SMARTAPI_SDK_UNAVAILABLE';
  err.cause = lastError;
  throw err;
}

function getSDKVersion() {
  if (mockSDK && mockSDK.version) {
    return String(mockSDK.version);
  }

  const candidates = ['smartapi-javascript/package.json'];
  const customRoot = String(process.env.YASHWIN_TRADING_SERVER_ROOT || '').trim();

  if (customRoot) {
    candidates.push(
      path.join(customRoot, 'node_modules', 'smartapi-javascript', 'package.json')
    );
  }

  for (const candidate of candidates) {
    try {
      const pkg = require(candidate);
      if (pkg && pkg.version) return String(pkg.version);
    } catch (_) {
      // ignore and continue
    }
  }

  return null;
}

function getRuntimeInfo() {
  try {
    const sdk = loadSmartAPI();
    const loaded = Boolean(sdk && typeof sdk.SmartAPI === 'function');
    return {
      runtimeRoot: process.env.YASHWIN_TRADING_SERVER_ROOT || process.cwd(),
      sdkLoaded: loaded,
      sdkVersion: loaded ? getSDKVersion() : null
    };
  } catch (_) {
    return {
      runtimeRoot: process.env.YASHWIN_TRADING_SERVER_ROOT || process.cwd(),
      sdkLoaded: false,
      sdkVersion: null
    };
  }
}

module.exports = {
  loadSmartAPI,
  getRuntimeInfo,
  getSDKVersion,
  setMockSmartAPI,
  getMockSmartAPI
};
