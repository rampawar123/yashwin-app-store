/*
 * YASHWIN AI Trading Assistant
 * Task 17 — Complete Web App & PWA Engine (web/modules/pwa-engine.js)
 *
 * Responsibilities:
 * - Service Worker registration, update lifecycle, and cache hygiene
 * - Clear all dynamic/user state on logout (zero cross-user leakage)
 * - In-app PWA install prompt management (beforeinstallprompt, appinstalled, standalone detection, iOS guide)
 * - Offline / Online network connectivity state & safe offline action guards
 * - Responsive navigation state synchronization across all 12 workspace modules
 */

const PWAEngine = (() => {
  const SUPPORTED_PAGES = [
    'dashboard',
    'scanner',
    'watchlist',
    'analysis',
    'intelligence',
    'strategy',
    'paper',
    'positions',
    'orders',
    'risk',
    'history',
    'account'
  ];

  const state = {
    online: typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true,
    swSupported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    swRegistered: false,
    swRegistration: null,
    swUpdateAvailable: false,
    deferredInstallPrompt: null,
    isStandalone: false,
    isIOS: false,
    lastSyncTimestamp: null,
    lastOfflineTimestamp: null
  };

  function detectDisplayAndPlatform(win = typeof window !== 'undefined' ? window : null) {
    if (!win) {
      return {
        isStandalone: false,
        isIOS: false
      };
    }

    let standaloneMatch = false;
    try {
      if (typeof win.matchMedia === 'function') {
        standaloneMatch = Boolean(win.matchMedia('(display-mode: standalone)').matches);
      }
    } catch (_) {}

    const navStandalone = Boolean(win.navigator && win.navigator.standalone === true);
    const ua = String(win.navigator?.userAgent || '').toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const isAndroidAPK = /yashwinandroidapk/i.test(ua);

    state.isStandalone = standaloneMatch || navStandalone || isAndroidAPK;
    state.isIOS = isIOS;
    state.isAndroidAPK = isAndroidAPK;

    return {
      isStandalone: state.isStandalone,
      isIOS: state.isIOS,
      isAndroidAPK: state.isAndroidAPK
    };
  }

  function validateBackendEndpointForAndroid(baseUrl = '', options = {}) {
    const raw = String(baseUrl || '').trim();
    const isPhysicalAndroidDevice = Boolean(options.isPhysicalAndroidDevice);
    const isProduction = options.isProduction !== false;

    if (!raw) {
      return {
        valid: true,
        mode: 'SAME_ORIGIN',
        https: true,
        warning: null
      };
    }

    let parsed;
    try {
      parsed = new URL(raw);
    } catch (_) {
      return {
        valid: false,
        code: 'INVALID_BACKEND_URL',
        reason: 'Configured backend URL is not a valid URL.'
      };
    }

    const host = String(parsed.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') {
      return {
        valid: false,
        code: 'ANDROID_LOCALHOST_FORBIDDEN',
        reason:
          'On an Android phone, localhost (127.0.0.1) refers to the phone itself, not the hosted server. Use the deployed HTTPS URL or 10.0.2.2 in the Android Emulator.'
      };
    }

    if (isProduction && parsed.protocol !== 'https:' && host !== '10.0.2.2') {
      return {
        valid: false,
        code: 'INSECURE_HTTP_FORBIDDEN',
        reason: 'Deployed Android builds require an HTTPS backend endpoint with valid TLS.'
      };
    }

    if (isPhysicalAndroidDevice && host === '10.0.2.2') {
      return {
        valid: false,
        code: 'EMULATOR_LOOPBACK_ON_PHYSICAL_DEVICE',
        reason: '10.0.2.2 only works inside the Android Emulator. Use a deployed HTTPS endpoint on physical Android devices.'
      };
    }

    return {
      valid: true,
      code: 'BACKEND_URL_OK',
      https: parsed.protocol === 'https:',
      host
    };
  }

  function isOnline() {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      state.online = navigator.onLine;
    }
    return Boolean(state.online);
  }

  function setOnlineStatus(onlineFlag) {
    const next = Boolean(onlineFlag);
    state.online = next;
    if (next) {
      state.lastSyncTimestamp = new Date().toISOString();
    } else {
      state.lastOfflineTimestamp = new Date().toISOString();
    }
    return getStatusSnapshot();
  }

  function guardOnlineAction(actionType = 'ACTION', options = {}) {
    const online = options.online !== undefined ? Boolean(options.online) : isOnline();
    const normalizedAction = String(actionType || 'ACTION').trim().toUpperCase();

    if (!online) {
      return {
        allowed: false,
        code: 'OFFLINE_ACTION_BLOCKED',
        actionType: normalizedAction,
        tradingMode: 'PAPER',
        liveTradingEnabled: false,
        reason:
          `Cannot execute ${normalizedAction} while offline. Live/validated market data and server verification are required. No synthetic prices, signals, or fake fills are generated.`
      };
    }

    return {
      allowed: true,
      code: 'ONLINE_READY',
      actionType: normalizedAction,
      tradingMode: 'PAPER',
      liveTradingEnabled: false,
      reason: null
    };
  }

  function captureInstallPrompt(event) {
    if (!event) return false;
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    state.deferredInstallPrompt = event;
    return true;
  }

  async function triggerInstallPrompt() {
    if (!state.deferredInstallPrompt) {
      return {
        ok: false,
        code: state.isIOS ? 'IOS_MANUAL_INSTALL_REQUIRED' : 'INSTALL_PROMPT_UNAVAILABLE',
        outcome: 'unavailable'
      };
    }

    const promptEvent = state.deferredInstallPrompt;
    try {
      if (typeof promptEvent.prompt === 'function') {
        await promptEvent.prompt();
      }
      const choice = promptEvent.userChoice ? await promptEvent.userChoice : { outcome: 'accepted' };
      const outcome = choice?.outcome || 'dismissed';
      if (outcome === 'accepted') {
        state.isStandalone = true;
        state.deferredInstallPrompt = null;
      }
      return {
        ok: outcome === 'accepted',
        code: outcome === 'accepted' ? 'INSTALLED' : 'DISMISSED',
        outcome
      };
    } catch (err) {
      return {
        ok: false,
        code: 'INSTALL_PROMPT_ERROR',
        outcome: 'error',
        message: err?.message || 'Could not trigger install prompt.'
      };
    }
  }

  async function registerServiceWorker(options = {}) {
    const nav = options.navigator || (typeof navigator !== 'undefined' ? navigator : null);
    const swUrl = options.swUrl || './sw.js';

    if (!nav || !nav.serviceWorker || typeof nav.serviceWorker.register !== 'function') {
      state.swSupported = false;
      state.swRegistered = false;
      return {
        ok: false,
        supported: false,
        registered: false,
        reason: 'Service Worker API is not supported in this environment.'
      };
    }

    state.swSupported = true;
    try {
      const reg = await nav.serviceWorker.register(swUrl, { scope: options.scope || './' });
      state.swRegistration = reg;
      state.swRegistered = true;

      if (reg && reg.waiting) {
        state.swUpdateAvailable = true;
      }

      if (reg && typeof reg.addEventListener === 'function') {
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (installing && typeof installing.addEventListener === 'function') {
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && nav.serviceWorker.controller) {
                state.swUpdateAvailable = true;
                if (typeof options.onUpdateAvailable === 'function') {
                  options.onUpdateAvailable(reg);
                }
              }
            });
          }
        });
      }

      return {
        ok: true,
        supported: true,
        registered: true,
        scope: reg?.scope || '/'
      };
    } catch (err) {
      state.swRegistered = false;
      return {
        ok: false,
        supported: true,
        registered: false,
        reason: err?.message || 'Service Worker registration failed.'
      };
    }
  }

  async function clearSensitiveClientStorage(options = {}) {
    const storage = options.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const sessStorage = options.sessionStorage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    const removedKeys = [];

    if (storage && typeof storage.removeItem === 'function') {
      const sensitivePatterns = [
        /^yashwin_paper_state_v1__/i,
        /^yashwin_user_/i,
        /^yashwin_session/i,
        /^yashwin_csrf/i,
        /^yashwin_auth/i
      ];

      try {
        const len = Number(storage.length || 0);
        const keysToInspect = [];
        for (let i = 0; i < len; i++) {
          const k = storage.key(i);
          if (k) keysToInspect.push(k);
        }
        for (const k of keysToInspect) {
          if (sensitivePatterns.some((rx) => rx.test(k))) {
            storage.removeItem(k);
            removedKeys.push(k);
          }
        }
      } catch (_) {}
    }

    if (sessStorage && typeof sessStorage.clear === 'function') {
      try {
        sessStorage.clear();
      } catch (_) {}
    }

    return {
      ok: true,
      removedKeys
    };
  }

  function getStatusSnapshot() {
    detectDisplayAndPlatform();
    const online = isOnline();
    const canPromptInstall = Boolean(state.deferredInstallPrompt) && !state.isStandalone;

    return {
      online,
      connectionBadge: online ? 'ONLINE' : 'OFFLINE (CACHED SHELL)',
      swSupported: state.swSupported,
      swRegistered: state.swRegistered,
      swUpdateAvailable: state.swUpdateAvailable,
      isStandalone: state.isStandalone,
      isIOS: state.isIOS,
      isAndroidAPK: Boolean(state.isAndroidAPK),
      canPromptInstall,
      showInstallUI: !state.isStandalone && (canPromptInstall || state.isIOS),
      tradingMode: 'PAPER',
      liveTradingEnabled: false,
      supportedPages: [...SUPPORTED_PAGES]
    };
  }

  return {
    SUPPORTED_PAGES,
    detectDisplayAndPlatform,
    validateBackendEndpointForAndroid,
    isOnline,
    setOnlineStatus,
    guardOnlineAction,
    captureInstallPrompt,
    triggerInstallPrompt,
    registerServiceWorker,
    clearSensitiveClientStorage,
    getStatusSnapshot
  };
})();

if (typeof window !== 'undefined') {
  window.PWAEngine = PWAEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PWAEngine;
}

