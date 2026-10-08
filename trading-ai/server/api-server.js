'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 4 — Step 30
 *
 * Read-only browser/server API bridge.
 * No browser credentials.
 * No order placement.
 * No BUY/SELL execution.
 */

const http = require('http');
const { URL } = require('url');

const auth = require('./angel-auth-service');
const search = require('./angel-instrument-search');
const pipeline = require('./market-data-pipeline');

const HOST = process.env.API_HOST || '127.0.0.1';
const PORT = Number(process.env.API_PORT || 8787);

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  const requestOrigin = String(res.req?.headers?.origin || '').trim();
  const allowedOrigins = new Set([
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8787',
    'http://127.0.0.1:8787'
  ]);

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': allowedOrigins.has(requestOrigin)
      ? requestOrigin
      : 'http://localhost:8787',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });

  res.end(payload);
}

function safeError(error) {
  return {
    code: error?.code || 'API_ERROR',
    message: error?.message || 'API request failed.'
  };
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    return json(res, 204, {});
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/auth/login') {
    if (req.method !== 'POST') {
      return json(res, 405, {
        ok: false,
        code: 'METHOD_NOT_ALLOWED'
      });
    }

    try {
      const result = await auth.login();
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (req.method !== 'GET') {
    return json(res, 405, {
      ok: false,
      code: 'METHOD_NOT_ALLOWED'
    });
  }

  if (url.pathname === '/api/health') {
    const status = auth.getAuthStatus();

    return json(res, 200, {
      ok: true,
      service: 'YASHWIN_AI_TRADING_ASSISTANT',
      mode: 'READ_ONLY',
      provider: status.provider,
      sdkLoaded: status.sdkLoaded,
      credentialsConfigured: status.credentialsConfigured,
      session: status.session
    });
  }

  if (url.pathname === '/api/auth/status') {
    const status = auth.getAuthStatus();

    return json(res, 200, {
      ok: true,
      provider: status.provider,
      sdkLoaded: status.sdkLoaded,
      credentialsConfigured: status.credentialsConfigured,
      session: status.session
    });
  }

  if (url.pathname === '/api/instruments/search') {
    const exchange = url.searchParams.get('exchange') || '';
    const query = url.searchParams.get('q') || '';

    try {
      const validated = search.validateSearch(exchange, query);

      const results = await search.searchScrip(
        validated.exchange,
        validated.searchscrip
      );

      return json(res, 200, {
        ok: true,
        exchange: validated.exchange,
        query: validated.query,
        results
      });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  if (url.pathname === '/api/market/quote') {
    const exchange = url.searchParams.get('exchange') || '';
    const query = url.searchParams.get('q') || '';

    try {
      const exactSymbol = url.searchParams.get('symbol') || '';

      const quote = await pipeline.getQuoteBySearch(
        exchange,
        query,
        exactSymbol || undefined
      );

      return json(res, 200, quote);
    } catch (error) {
      return json(res, 400, {
        ok: false,
        ...safeError(error)
      });
    }
  }

  return json(res, 404, {
    ok: false,
    code: 'NOT_FOUND'
  });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    json(res, 500, {
      ok: false,
      ...safeError(error)
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`YASHWIN API SERVER listening on http://${HOST}:${PORT}`);
  console.log('MODE=READ_ONLY');
  console.log('ORDER_ENDPOINTS=NONE');
});
