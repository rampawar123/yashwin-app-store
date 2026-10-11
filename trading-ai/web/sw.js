/*
 * YASHWIN AI Trading Assistant
 * Task 17 — Progressive Web App (PWA) Service Worker
 *
 * Strictly enforces:
 * - Static app shell precaching ONLY (HTML, CSS, JS, Manifest, Icons)
 * - ZERO caching of /api/* routes, user sessions, CSRF tokens, credentials,
 *   portfolio ledgers, orders, fills, trade history, watchlists, alerts, or notifications
 * - ZERO fabricated market quotes, candles, or trading signals when offline
 * - Versioned cache cleanup and deterministic update lifecycle
 */

const CACHE_VERSION = 'v1.0.0-task17';
const SHELL_CACHE_NAME = `yashwin-pwa-shell-${CACHE_VERSION}`;

const PRECACHE_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.webmanifest',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/app.js',
  '/modules/audit-logger.js',
  '/modules/risk-engine.js',
  '/modules/ai-decision-contract.js',
  '/modules/ai-safety-gate.js',
  '/modules/strategy-engine.js',
  '/modules/paper.js',
  '/modules/portfolio-engine.js',
  '/modules/order-trade-history-engine.js',
  '/modules/watchlist-alert-engine.js',
  '/modules/notification-engine.js',
  '/modules/market-data/providers/provider.js',
  '/modules/market-data/provider-registry.js',
  '/modules/market-data/providers/angel-one.js',
  '/modules/market-data/providers/twelve-data.js',
  '/modules/market-data/market-data-service.js',
  '/modules/market-data.js',
  '/modules/market-intelligence.js',
  '/modules/market-analysis.js',
  '/modules/option-chain.js',
  '/modules/backtester.js',
  '/modules/pilot-approval.js',
  '/modules/live-readiness-audit.js',
  '/modules/dashboard-engine.js',
  '/modules/chart-engine.js',
  '/modules/ai-analysis-engine.js',
  '/modules/market-api.js',
  '/modules/market-search.js',
  '/modules/pwa-engine.js'
];

const NEVER_CACHE_PATH_PREFIXES = [
  '/api/',
  '/auth/',
  '/user/',
  '/order/',
  '/orders/',
  '/portfolio/',
  '/paper/',
  '/watchlist/',
  '/alerts/',
  '/notifications/'
];

function isSensitiveOrDynamicRequest(requestUrl, method = 'GET') {
  const normMethod = String(method || 'GET').toUpperCase();
  if (normMethod !== 'GET' && normMethod !== 'HEAD') {
    return true;
  }

  let parsed;
  try {
    parsed = typeof requestUrl === 'string'
      ? new URL(requestUrl, 'http://localhost:3000')
      : requestUrl;
  } catch (_) {
    return true;
  }

  const pathname = String(parsed.pathname || '/');
  for (const prefix of NEVER_CACHE_PATH_PREFIXES) {
    if (pathname === prefix.slice(0, -1) || pathname.startsWith(prefix)) {
      return true;
    }
  }

  if (parsed.search && /token|csrf|session|password|secret|key|auth/i.test(parsed.search)) {
    return true;
  }

  return false;
}

function isAllowedShellAssetPath(pathname) {
  const clean = String(pathname || '/').split('?')[0];
  if (PRECACHE_SHELL_ASSETS.includes(clean)) {
    return true;
  }
  return /\.(html|css|js|webmanifest|svg|png|ico)$/i.test(clean) && !clean.startsWith('/api/');
}

function buildOfflineApiResponse(pathname = '/api/unknown') {
  const payload = {
    ok: false,
    offline: true,
    code: 'OFFLINE_NETWORK_UNAVAILABLE',
    dataReady: false,
    tradingMode: 'PAPER',
    liveTradingEnabled: false,
    brokerExecution: 'NONE',
    path: pathname,
    message:
      'Network connection is offline. Real-time market quotes, historical candles, AI analysis, and paper order execution require an active server connection. No synthetic prices or signals are generated.'
  };

  if (typeof Response === 'function') {
    return new Response(JSON.stringify(payload), {
      status: 503,
      statusText: 'Service Unavailable (Offline)',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }
  return payload;
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      (async () => {
        if (typeof caches !== 'undefined' && typeof caches.open === 'function') {
          const cache = await caches.open(SHELL_CACHE_NAME);
          await cache.addAll(PRECACHE_SHELL_ASSETS);
        }
        if (typeof self.skipWaiting === 'function') {
          await self.skipWaiting();
        }
      })()
    );
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((k) => k.startsWith('yashwin-pwa-shell-') && k !== SHELL_CACHE_NAME)
              .map((oldKey) => caches.delete(oldKey))
          );
        }
        if (self.clients && typeof self.clients.claim === 'function') {
          await self.clients.claim();
        }
      })()
    );
  });

  self.addEventListener('message', (event) => {
    const data = event?.data || {};
    if (data.type === 'SKIP_WAITING' && typeof self.skipWaiting === 'function') {
      self.skipWaiting();
    }
  });

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (!req) return;

    let url;
    try {
      url = new URL(req.url);
    } catch (_) {
      return;
    }

    if (typeof self.location !== 'undefined' && url.origin !== self.location.origin) {
      return;
    }

    // 1. NEVER cache /api/* or mutating/authenticated requests
    if (isSensitiveOrDynamicRequest(url, req.method)) {
      if (url.pathname.startsWith('/api/')) {
        event.respondWith(
          fetch(req).catch(() => buildOfflineApiResponse(url.pathname))
        );
      }
      return;
    }

    // 2. Navigation requests (HTML shell): Network-first with cached /index.html fallback
    if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
      event.respondWith(
        (async () => {
          try {
            const networkRes = await fetch(req);
            if (networkRes && networkRes.ok && typeof caches !== 'undefined') {
              const cache = await caches.open(SHELL_CACHE_NAME);
              cache.put('/index.html', networkRes.clone()).catch(() => {});
            }
            return networkRes;
          } catch (_) {
            if (typeof caches !== 'undefined') {
              const cached = (await caches.match('/index.html')) || (await caches.match('/'));
              if (cached) return cached;
            }
            throw new Error('Offline and no cached shell available.');
          }
        })()
      );
      return;
    }

    // 3. Static shell assets: Stale-While-Revalidate (never caches /api/*)
    if (isAllowedShellAssetPath(url.pathname)) {
      event.respondWith(
        (async () => {
          const cached = typeof caches !== 'undefined' ? await caches.match(req) : null;
          const fetchPromise = fetch(req)
            .then(async (networkRes) => {
              if (networkRes && networkRes.ok && typeof caches !== 'undefined') {
                const cache = await caches.open(SHELL_CACHE_NAME);
                cache.put(req, networkRes.clone()).catch(() => {});
              }
              return networkRes;
            })
            .catch(() => null);

          if (cached) {
            return cached;
          }
          const net = await fetchPromise;
          if (net) return net;
          throw new Error(`Asset unavailable offline: ${url.pathname}`);
        })()
      );
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CACHE_VERSION,
    SHELL_CACHE_NAME,
    PRECACHE_SHELL_ASSETS,
    NEVER_CACHE_PATH_PREFIXES,
    isSensitiveOrDynamicRequest,
    isAllowedShellAssetPath,
    buildOfflineApiResponse
  };
}
