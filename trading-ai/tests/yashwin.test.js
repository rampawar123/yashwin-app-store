'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Comprehensive Automated Test Suite (Phases 1–19, 36 Tests)
 *
 * Uses built-in Node.js test runner (`node --test`).
 * Zero real credentials required — uses deterministic mocks & stubs.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// Server modules
const serverConfig = require('../server/config');
const totp = require('../server/totp');
const runtime = require('../server/smartapi-runtime');
const angelSmartAPI = require('../server/angel-smartapi');
const angelSession = require('../server/angel-session');
const angelAuthService = require('../server/angel-auth-service');
const instrumentSearch = require('../server/angel-instrument-search');
const instrumentNormalizer = require('../server/instrument-normalizer');
const instrumentMap = require('../server/instrument-map');
const angelMarketData = require('../server/angel-market-data');
const marketDataPipeline = require('../server/market-data-pipeline');
const googleAIService = require('../server/google-ai-service');
const serverDb = require('../server/database');
const userAuthService = require('../server/user-auth-service');
const apiServer = require('../server/api-server');

// Browser/shared modules
const MarketDataProvider = require('../web/modules/market-data/providers/provider');
const MarketDataProviders = require('../web/modules/market-data/provider-registry');
const AngelOneProvider = require('../web/modules/market-data/providers/angel-one');
const RealMarketDataService = require('../web/modules/market-data/market-data-service');
const MarketData = require('../web/modules/market-data');
const MarketIntelligence = require('../web/modules/market-intelligence');
const MarketAPI = require('../web/modules/market-api');
const MarketSearch = require('../web/modules/market-search');
const MarketAnalysis = require('../web/modules/market-analysis');
const AIDecisionContract = require('../web/modules/ai-decision-contract');
const AISafetyGate = require('../web/modules/ai-safety-gate');
const StrategyEngine = require('../web/modules/strategy-engine');
const RiskEngine = require('../web/modules/risk-engine');
const PaperTrading = require('../web/modules/paper');
const OptionChain = require('../web/modules/option-chain');
const Backtester = require('../web/modules/backtester');
const AuditLogger = require('../web/modules/audit-logger');
const PilotApproval = require('../web/modules/pilot-approval');
const LiveReadinessAudit = require('../web/modules/live-readiness-audit');
const DashboardEngine = require('../web/modules/dashboard-engine');
const PortfolioEngine = require('../web/modules/portfolio-engine');
const OrderTradeHistoryEngine = require('../web/modules/order-trade-history-engine');
const WatchlistAlertEngine = require('../web/modules/watchlist-alert-engine');

process.env.YASHWIN_DB_PATH = ':memory:';
serverDb.getDb(':memory:');
MarketDataProviders.register('ANGEL_ONE', AngelOneProvider);

function requestServer(server, reqPath, options = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: reqPath,
        method: options.method || 'GET',
        headers: options.headers || {}
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (_) {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: raw,
            json
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe('YASHWIN AI Trading Assistant — Complete Verification Suite', () => {
  const originalEnv = { ...process.env };
  let server = null;

  beforeEach(() => {
    process.env.YASHWIN_DB_PATH = ':memory:';
    serverDb.getDb(':memory:');
    serverDb.resetAllTablesForTest();
    userAuthService.resetRateLimitsForTest();
    userAuthService.setEmailDeliveryProvider(null);
    MarketIntelligence.clearProvider();
    angelSession.clearSession();
    runtime.setMockSmartAPI(null);
    googleAIService.setMockAIClient(null);
    RiskEngine.resetLimits();
    RiskEngine.setEmergencyStop(false);
    PaperTrading.resetState();
    AuditLogger.resetEmergencyStop('Reset for test');
    AuditLogger.clearLogs();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    angelSession.clearSession();
    runtime.setMockSmartAPI(null);
    googleAIService.setMockAIClient(null);
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  test('1. Config: default paper mode, live trading disabled, and risk limits loaded safely', () => {
    const cfg = serverConfig.getConfig({
      TRADING_MODE: 'live',
      LIVE_TRADING_ENABLED: 'true',
      MAX_LOSS_PER_TRADE: '500',
      MAX_DAILY_LOSS: '1000',
      MAX_TRADES_PER_DAY: '3'
    });
    assert.equal(cfg.trading.mode, 'paper');
    assert.equal(cfg.trading.liveEnabled, false);
    assert.equal(cfg.risk.maxLossPerTrade, 500);
    assert.equal(cfg.risk.maxDailyLoss, 1000);
    assert.equal(cfg.risk.maxTradesPerDay, 3);
  });

  test('2. TOTP Generation: produces RFC 6238 6-digit OTP from Base32 secret and rejects invalid secrets', () => {
    const otp1 = totp.generateTOTP('JBSWY3DPEHPK3PXP', { timestampMs: 1700000000000 });
    const otp2 = totp.generateTOTP('JBSWY3DPEHPK3PXP', { timestampMs: 1700000000000 });
    assert.match(otp1, /^\d{6}$/);
    assert.equal(otp1, otp2);
    assert.throws(
      () => totp.generateTOTP('INVALID_BASE32_999!'),
      (err) => err.code === 'INVALID_TOTP_SECRET'
    );
  });

  test('3. Authentication: server login generates 6-digit TOTP and creates authenticated session with mocked SmartAPI', async () => {
    process.env.MARKET_DATA_PROVIDER = 'ANGEL_ONE';
    process.env.ANGEL_API_KEY = 'key_test';
    process.env.ANGEL_CLIENT_ID = 'client_test';
    process.env.ANGEL_PIN = '1234';
    process.env.ANGEL_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

    let passedOtp = null;
    runtime.setMockSmartAPI({
      version: '2.0.0-mock',
      SmartAPI: class {
        async generateSession(clientId, pin, otp) {
          passedOtp = otp;
          return {
            status: true,
            data: {
              jwtToken: 'JWT_SECRET_VAL',
              refreshToken: 'REFRESH_SECRET_VAL',
              feedToken: 'FEED_SECRET_VAL'
            }
          };
        }
      }
    });

    const result = await angelAuthService.login();
    assert.equal(result.ok, true);
    assert.match(passedOtp, /^\d{6}$/);
    assert.equal(result.status.authenticated, true);
  });

  test('4. Session State: failed login or logout resets session state and clears stale tokens', async () => {
    angelSession.setSessionForTest({
      status: 'CONNECTED',
      accessToken: 'STALE_JWT'
    });
    await angelSession.logout();
    assert.equal(angelSession.getSession().accessToken, null);
    assert.equal(angelSession.getSafeStatus().authenticated, false);
  });

  test('5. Secret Redaction: session status, public config, and audit logger never expose credentials or tokens', () => {
    angelSession.setSessionForTest({
      status: 'CONNECTED',
      accessToken: 'TOP_SECRET_JWT',
      refreshToken: 'TOP_SECRET_REFRESH',
      feedToken: 'TOP_SECRET_FEED'
    });
    const safeStatus = angelSession.getSafeStatus();
    assert.equal('accessToken' in safeStatus, false);
    assert.equal('refreshToken' in safeStatus, false);
    assert.equal('feedToken' in safeStatus, false);

    const redacted = AuditLogger.redactSensitive({
      apiKey: 'secret1',
      accessToken: 'secret2',
      totpSecret: 'secret3',
      instrument: 'NIFTY'
    });
    assert.equal(redacted.apiKey, '[REDACTED]');
    assert.equal(redacted.accessToken, '[REDACTED]');
    assert.equal(redacted.totpSecret, '[REDACTED]');
    assert.equal(redacted.instrument, 'NIFTY');
  });

  test('6. Instrument Search: validates NSE, BSE, NFO, BFO and rejects unsupported exchanges or empty query', () => {
    for (const ex of ['NSE', 'BSE', 'NFO', 'BFO']) {
      const res = instrumentSearch.validateSearch(ex, 'SBIN');
      assert.equal(res.exchange, ex);
      assert.equal(res.query, 'SBIN');
    }
    assert.throws(
      () => instrumentSearch.validateSearch('CRYPTO', 'BTC'),
      (err) => err.code === 'INVALID_EXCHANGE'
    );
  });

  test('7. Instrument Normalization: normalizes exchange, tradingsymbol, symboltoken, optionType, strikePrice, expiry', () => {
    const normalized = instrumentNormalizer.normalizeSearchResults({
      results: [
        {
          exchange: 'nfo',
          tradingsymbol: 'NIFTY28NOV2425000CE',
          symboltoken: '9911',
          optionType: 'ce',
          strikePrice: '25000',
          expiry: '28NOV2024'
        }
      ]
    });
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].exchange, 'NFO');
    assert.equal(normalized[0].optionType, 'CE');
    assert.equal(normalized[0].strikePrice, 25000);
  });

  test('8. Option Validation: enforces CE/PE, positive strike, valid expiry, and NFO/BFO exchange', () => {
    const valid = instrumentNormalizer.validateOptionContract({
      exchange: 'NFO',
      optionType: 'PE',
      strikePrice: 24800,
      expiry: '28NOV2024'
    });
    assert.equal(valid.valid, true);

    assert.throws(
      () =>
        instrumentNormalizer.assertValidOptionContract({
          exchange: 'NFO',
          optionType: 'INVALID',
          strikePrice: 0,
          expiry: ''
        }),
      (err) => err.code === 'INVALID_OPTION_CONTRACT'
    );
  });

  test('9. Market-Data Mapping: maps Angel One quote response and normalizes Angel timestamp to ISO-8601', () => {
    const mapped = angelMarketData.mapAngelQuoteResponse(
      {
        data: {
          fetched: [
            {
              exchange: 'NSE',
              tradingSymbol: 'SBIN-EQ',
              symbolToken: '3045',
              ltp: 820.25,
              open: 810,
              high: 825,
              low: 808,
              close: 809,
              tradeVolume: 1200000,
              exchTradeTime: '21-Oct-2024 14:35:10'
            }
          ]
        }
      },
      { exchange: 'NSE', symboltoken: '3045', tradingsymbol: 'SBIN-EQ' }
    );
    assert.equal(mapped.price, 820.25);
    assert.equal(mapped.dataReady, true);
    assert.ok(mapped.timestamp.endsWith('Z'));
    assert.ok(Number.isFinite(Date.parse(mapped.timestamp)));
  });

  test('10. Stale Quote Rejection: rejects quotes older than 60s in both server pipeline and browser service', () => {
    const now = Date.now();
    const staleIso = new Date(now - 90000).toISOString();

    assert.throws(
      () =>
        marketDataPipeline.validateQuoteFreshness(
          { dataReady: true, price: 25000, timestamp: staleIso },
          now
        ),
      (err) => err.code === 'STALE_MARKET_DATA'
    );

    const browserCheck = RealMarketDataService.validateQuote(
      { dataReady: true, price: 25000, timestamp: staleIso },
      'NIFTY50',
      'ANGEL_ONE',
      now
    );
    assert.equal(browserCheck.ok, false);
    assert.equal(browserCheck.code, 'STALE_MARKET_DATA');
  });

  test('11. Future Timestamp Rejection: rejects quotes with timestamp >5s in the future', () => {
    const now = Date.now();
    const futureIso = new Date(now + 25000).toISOString();

    assert.throws(
      () =>
        marketDataPipeline.validateQuoteFreshness(
          { dataReady: true, price: 25000, timestamp: futureIso },
          now
        ),
      (err) => err.code === 'FUTURE_QUOTE_TIMESTAMP'
    );

    const browserCheck = RealMarketDataService.validateQuote(
      { dataReady: true, price: 25000, timestamp: futureIso },
      'NIFTY50',
      'ANGEL_ONE',
      now
    );
    assert.equal(browserCheck.ok, false);
    assert.equal(browserCheck.code, 'FUTURE_MARKET_DATA');
  });

  test('12. API Health: GET /api/health returns 200 READ_ONLY status with liveTradingEnabled=false', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const res = await requestServer(server, '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.mode, 'READ_ONLY');
    assert.equal(res.json.liveTradingEnabled, false);
  });

  test('13. API Auth Status: GET /api/auth/status returns safe session status without tokens', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const res = await requestServer(server, '/api/auth/status');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal('accessToken' in res.json.session, false);
  });

  test('14. API Login Failure: POST /api/auth/login returns 400 when credentials are unconfigured', async () => {
    delete process.env.ANGEL_API_KEY;
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const res = await requestServer(server, '/api/auth/login', { method: 'POST' });
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.code, 'ANGEL_CREDENTIALS_MISSING');
  });

  test('15. API Search: GET /api/instruments/search returns { ok, provider, exchange, query, results: [] }', async () => {
    angelSession.setSessionForTest({ status: 'CONNECTED', accessToken: 'JWT' });
    runtime.setMockSmartAPI({
      SmartAPI: class {
        setAccessToken() {}
        async searchScrip() {
          return {
            status: true,
            data: [{ exchange: 'NSE', tradingsymbol: 'INFY-EQ', symboltoken: '1594' }]
          };
        }
      }
    });

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const res = await requestServer(server, '/api/instruments/search?exchange=NSE&q=INFY');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.query, 'INFY');
    assert.ok(Array.isArray(res.json.results));
    assert.equal(res.json.results[0].tradingsymbol, 'INFY-EQ');
  });

  test('16. API Quote: GET /api/market/quote returns normalized and validated quote', async () => {
    const nowIso = new Date().toISOString();
    angelSession.setSessionForTest({ status: 'CONNECTED', accessToken: 'JWT' });
    runtime.setMockSmartAPI({
      SmartAPI: class {
        setAccessToken() {}
        async searchScrip() {
          return {
            status: true,
            data: [{ exchange: 'NSE', tradingsymbol: 'INFY-EQ', symboltoken: '1594' }]
          };
        }
        async marketData() {
          return {
            status: true,
            data: {
              fetched: [
                {
                  exchange: 'NSE',
                  tradingSymbol: 'INFY-EQ',
                  symbolToken: '1594',
                  ltp: 1850,
                  open: 1840,
                  high: 1860,
                  low: 1835,
                  close: 1838,
                  tradeVolume: 100000,
                  exchTradeTime: nowIso
                }
              ]
            }
          };
        }
      }
    });

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const res = await requestServer(server, '/api/market/quote?exchange=NSE&q=INFY');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.quote.price, 1850);
  });

  test('17. HTTP 404: returns 404 for non-existent API routes and missing static files (no order endpoints)', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const api404 = await requestServer(server, '/api/order/place');
    assert.equal(api404.status, 404);

    const static404 = await requestServer(server, '/missing-page-xyz.html');
    assert.equal(static404.status, 404);
  });

  test('18. HTTP 405: returns 405 Method Not Allowed for invalid HTTP verbs', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const res1 = await requestServer(server, '/api/health', { method: 'POST' });
    assert.equal(res1.status, 405);

    const res2 = await requestServer(server, '/api/auth/login', { method: 'GET' });
    assert.equal(res2.status, 405);
  });

  test('19. OPTIONS / CORS: allows trusted localhost and same-origin requests with 204', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const res = await requestServer(server, '/api/health', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000' }
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:3000');
  });

  test('20. Untrusted Origin: blocks cross-origin requests from external origins with 403', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const res = await requestServer(server, '/api/health', {
      headers: { Origin: 'https://evil-attacker.example.org' }
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'UNTRUSTED_ORIGIN');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  test('21. Market Analysis: deterministic scoring across NO_TRADE, WATCH, BUY, BUY_CE, BUY_PE', () => {
    assert.equal(MarketAnalysis.analyze({ dataReady: false }).signal, 'NO_TRADE');

    const watchRes = MarketAnalysis.analyze({
      dataReady: true,
      trendScore: 70,
      momentumScore: 70,
      volumeScore: 60,
      vwapScore: 60,
      supportResistanceScore: 60,
      optionsScore: 50,
      newsScore: 50,
      breadthScore: 50,
      volatilityScore: 20
    });
    assert.equal(watchRes.signal, 'WATCH');

    const buyCe = MarketAnalysis.analyze({
      dataReady: true,
      assetType: 'OPTION',
      trendScore: 95,
      momentumScore: 95,
      volumeScore: 90,
      vwapScore: 90,
      supportResistanceScore: 90,
      optionsScore: 85,
      newsScore: 80,
      breadthScore: 85,
      volatilityScore: 20
    });
    assert.equal(buyCe.signal, 'BUY_CE');
  });

  test('22. AI Safety Gate: enforces dataReady, confidence >= 70, risk != HIGH, CE/PE match, and supports EQUITY', () => {
    const eqApproved = AISafetyGate.evaluate({
      dataReady: true,
      signal: 'BUY',
      confidence: 82,
      risk: 'LOW',
      assetType: 'EQUITY',
      side: 'BUY',
      stopLoss: 24900,
      riskCheck: { allowed: true }
    });
    assert.equal(eqApproved.allowed, true);

    const optRejected = AISafetyGate.evaluate({
      dataReady: true,
      signal: 'BUY_CE',
      confidence: 82,
      risk: 'LOW',
      assetType: 'OPTION',
      optionType: 'PE',
      riskCheck: { allowed: true }
    });
    assert.equal(optRejected.allowed, false);
  });

  test('23. Strategy Engine: computes deterministic entry, stopLoss, target and blocks high-risk or low-confidence inputs', () => {
    const valid = StrategyEngine.evaluate({
      dataReady: true,
      price: 25000,
      assetType: 'EQUITY',
      analysis: { dataReady: true, signal: 'BUY', confidence: 85, risk: 'LOW' }
    });
    assert.equal(valid.action, 'BUY');
    assert.equal(valid.entry, 25000);
    assert.equal(valid.stopLoss, 24875);
    assert.equal(valid.target, 25250);

    const blocked = StrategyEngine.evaluate({
      dataReady: true,
      price: 25000,
      analysis: { dataReady: true, signal: 'BUY', confidence: 60, risk: 'LOW' }
    });
    assert.equal(blocked.action, 'NO_TRADE');
  });

  test('24. Risk Engine: enforces ₹500 max trade loss, ₹1,000 daily loss, 3 trades/day, 1 open position, and averaging off', () => {
    const valid = RiskEngine.evaluate({
      side: 'BUY',
      entry: 1000,
      stop: 950,
      quantity: 10
    });
    assert.equal(valid.allowed, true);

    const overRisk = RiskEngine.evaluate({
      side: 'BUY',
      entry: 1000,
      stop: 900,
      quantity: 10
    });
    assert.equal(overRisk.allowed, false);

    const avgBlocked = RiskEngine.evaluate({
      side: 'BUY',
      entry: 1000,
      stop: 990,
      quantity: 1,
      averaging: true
    });
    assert.equal(avgBlocked.allowed, false);
  });

  test('25. Emergency Stop: sets global state, halts RiskEngine & AISafetyGate, closes open paper positions, and requires reset', () => {
    PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24900,
      target: 25200,
      qty: 1
    });
    assert.ok(PaperTrading.getState().position);

    AuditLogger.activateEmergencyStop('Emergency test');
    assert.equal(AuditLogger.isEmergencyStopActive(), true);
    assert.equal(RiskEngine.isEmergencyStopActive(), true);
    assert.equal(PaperTrading.getState().position, null);

    const riskDuringEm = RiskEngine.evaluate({
      side: 'BUY',
      entry: 25000,
      stop: 24950,
      quantity: 1
    });
    assert.equal(riskDuringEm.allowed, false);

    AuditLogger.resetEmergencyStop('Reset after test');
    assert.equal(AuditLogger.isEmergencyStopActive(), false);
  });

  test('26. Paper Trading: preview, openPosition, duplicate position block, and order book recording', () => {
    const prev = PaperTrading.preview(25000, 24900, 25200, 2, { assetType: 'EQUITY' });
    assert.equal(prev.risk, 200);
    assert.equal(prev.reward, 400);
    assert.equal(prev.rr, 2);

    const openRes = PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24900,
      target: 25200,
      qty: 2
    });
    assert.equal(openRes.ok, true);
    assert.equal(PaperTrading.getState().orders.length, 1);
  });

  test('27. P&L Calculation: accurate BUY and SELL realized and unrealized P&L and daily P&L accumulation', () => {
    PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'SELL',
      entry: 25000,
      stop: 25100,
      target: 24800,
      qty: 3
    });
    const closed = PaperTrading.closePosition(24900, 'MANUAL');
    assert.equal(closed.ok, true);
    assert.equal(closed.pnl, 300);
    assert.equal(PaperTrading.getState().dailyPnl, 300);
  });

  test('28. Stop Loss: hard stop-loss triggers STOP_LOSS action immediately on adverse price move', () => {
    PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24900,
      target: 25200,
      qty: 2
    });
    const update = PaperTrading.updatePrice(24895);
    assert.equal(update.action, 'STOP_LOSS');
    assert.equal(update.pnl, -210);
  });

  test('29. Target Handling: reaching target triggers TARGET_ACTIVATED (or TARGET_EXIT when configured)', () => {
    PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24900,
      target: 25200,
      qty: 2
    });
    const update = PaperTrading.updatePrice(25210);
    assert.equal(update.action, 'TARGET_ACTIVATED');
  });

  test('30. Trailing Profit Lock: milestones lock profit and trigger PROFIT_LOCK on pullback', () => {
    PaperTrading.openPosition({
      symbol: 'RELIANCE',
      direction: 'BUY',
      entry: 1000,
      stop: 900,
      target: 1500,
      qty: 1
    });
    const step = PaperTrading.updatePrice(1250);
    assert.equal(step.action, 'AI_REANALYZE');
    assert.equal(step.lockedProfit, 100);

    const pullback = PaperTrading.updatePrice(1090);
    assert.equal(pullback.action, 'PROFIT_LOCK');
  });

  test('31. Option Chain: normalizes chain, calculates PCR & IV, and selects expiry & ATM strike', () => {
    const chain = OptionChain.normalizeChain(
      [
        {
          exchange: 'NFO',
          tradingsymbol: 'NIFTY28NOV2425000CE',
          symboltoken: '101',
          optionType: 'CE',
          strikePrice: 25000,
          expiry: '2026-11-28',
          ltp: 150,
          oi: 100000,
          oiChange: 5000,
          iv: 18
        },
        {
          exchange: 'NFO',
          tradingsymbol: 'NIFTY28NOV2425000PE',
          symboltoken: '102',
          optionType: 'PE',
          strikePrice: 25000,
          expiry: '2026-11-28',
          ltp: 140,
          oi: 125000,
          oiChange: 12000,
          iv: 20
        }
      ],
      25005
    );
    assert.equal(chain.available, true);
    assert.equal(chain.summary.pcr, 1.25);
    assert.equal(OptionChain.selectExpiry(chain), '2026-11-28');
    assert.equal(
      OptionChain.selectStrike(chain, { optionType: 'CE', underlyingPrice: 25005 })
        .strikePrice,
      25000
    );
  });

  test('32. Backtesting: deterministic execution without look-ahead bias and accurate metrics', () => {
    const candles = [
      {
        timestamp: '2026-10-01T09:15:00.000Z',
        open: 25000,
        high: 25040,
        low: 24990,
        close: 25020,
        volume: 10000
      },
      {
        timestamp: '2026-10-01T09:20:00.000Z',
        open: 25020,
        high: 25150,
        low: 25010,
        close: 25120,
        volume: 50000,
        indicators: {
          trendScore: 95,
          momentumScore: 90,
          volumeScore: 85,
          vwapScore: 85,
          supportResistanceScore: 85,
          optionsScore: 80,
          newsScore: 70,
          breadthScore: 80,
          volatilityScore: 20
        }
      },
      {
        timestamp: '2026-10-01T09:25:00.000Z',
        open: 25120,
        high: 25450,
        low: 25100,
        close: 25400,
        volume: 60000
      }
    ];
    const res = Backtester.run({ symbol: 'NIFTY 50', assetType: 'EQUITY', quantity: 1, candles });
    assert.equal(res.ok, true);
    assert.equal(res.metrics.totalTrades, 1);
    assert.equal(res.metrics.wins, 1);
    assert.equal(res.metrics.winRate, 100);
    assert.ok(res.metrics.netPnl > 0);
  });

  test('33. Audit Logging: records trade decisions, risk rejections, and emergency events with secret redaction', () => {
    AuditLogger.logTradeDecision('Test trade opened', {
      symbol: 'NIFTY 50',
      apiKey: 'SENSITIVE_KEY'
    });
    AuditLogger.logRiskRejection('Test risk blocked', { reason: 'Max loss' });

    const allLogs = AuditLogger.getLogs();
    assert.equal(allLogs.length, 2);
    assert.equal(allLogs[1].details.apiKey, '[REDACTED]');
  });

  test('34. Human Approval Gate: queues proposal, requires explicit human approval, and executes in PAPER_SANDBOX_ONLY', () => {
    const prop = PilotApproval.createProposal({
      instrument: 'NIFTY 50',
      direction: 'BUY',
      assetType: 'EQUITY',
      quantity: 1,
      entry: 25000,
      stop: 24900,
      target: 25200,
      dataReady: true,
      signal: 'BUY',
      confidence: 85,
      risk: 'LOW',
      reason: 'Breakout'
    });
    assert.equal(prop.ok, true);
    assert.equal(PaperTrading.getState().position, null);

    const exec = PilotApproval.approveProposal(prop.proposal.proposalId);
    assert.equal(exec.ok, true);
    assert.equal(exec.executionMode, 'PAPER_SANDBOX_ONLY');
    assert.ok(PaperTrading.getState().position);
  });

  test('35. Final Safety Regression: LiveReadinessAudit verifies all 14 safety invariants pass with liveTradingEnabled=false', () => {
    const audit = LiveReadinessAudit.runAudit({
      serverConfig: serverConfig.getConfig({})
    });
    assert.equal(audit.ok, true);
    assert.equal(audit.liveTradingEnabled, false);
    assert.equal(audit.failedChecks, 0);
    assert.equal(audit.totalChecks, 14);
  });

  test('36. Codebase Safety Scan: zero live order placement calls and zero Math.random in paper trading or app controller', () => {
    const serverFiles = fs.readdirSync(path.join(__dirname, '../server')).filter((f) => f.endsWith('.js'));
    for (const file of serverFiles) {
      const content = fs.readFileSync(path.join(__dirname, '../server', file), 'utf8');
      assert.equal(/\.placeOrder\s*\(/.test(content), false, `Forbidden placeOrder in ${file}`);
      assert.equal(/\.modifyOrder\s*\(/.test(content), false, `Forbidden modifyOrder in ${file}`);
      assert.equal(/\.cancelOrder\s*\(/.test(content), false, `Forbidden cancelOrder in ${file}`);
    }

    const appJs = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
    const paperJs = fs.readFileSync(path.join(__dirname, '../web/modules/paper.js'), 'utf8');
    assert.equal(appJs.includes('Math.random'), false, 'Math.random must not exist in web/app.js');
    assert.equal(paperJs.includes('Math.random'), false, 'Math.random must not exist in web/modules/paper.js');
  });

  test('37. SmartAPI SDK Loading: handles missing SDK safely and loads mocked SDK cleanly without hardcoded HOME paths', () => {
    runtime.setMockSmartAPI(null);
    const statusWithoutSdk = angelSmartAPI.getSDKStatus();
    assert.equal(typeof statusWithoutSdk.sdkLoaded, 'boolean');
    assert.equal(statusWithoutSdk.provider, 'ANGEL_ONE');
    assert.equal(statusWithoutSdk.mode, 'SERVER_ONLY');

    runtime.setMockSmartAPI({
      version: '1.5.0-test',
      SmartAPI: class {
        constructor(cfg) {
          this.apiKey = cfg.api_key;
        }
      }
    });

    const statusWithMock = angelSmartAPI.getSDKStatus();
    assert.equal(statusWithMock.sdkLoaded, true);
    assert.equal(statusWithMock.sdkVersion, '1.5.0-test');
  });

  test('38. Exact Instrument Resolution: resolves exact tradingsymbol from multiple search matches and rejects when missing', async () => {
    angelSession.setSessionForTest({ status: 'CONNECTED', accessToken: 'JWT' });
    runtime.setMockSmartAPI({
      SmartAPI: class {
        setAccessToken() {}
        async searchScrip(exchange, query) {
          assert.equal(exchange, 'NSE');
          assert.equal(query, 'SBIN');
          return {
            status: true,
            data: [
              { exchange: 'NSE', tradingsymbol: 'SBIN-BL', symboltoken: '3046' },
              { exchange: 'NSE', tradingsymbol: 'SBIN-EQ', symboltoken: '3045' }
            ]
          };
        }
      }
    });

    const resolved = await marketDataPipeline.resolveInstrument('NSE', 'SBIN', 'SBIN-EQ');
    assert.equal(resolved.tradingsymbol, 'SBIN-EQ');
    assert.equal(resolved.symboltoken, '3045');

    await assert.rejects(
      () => marketDataPipeline.resolveInstrument('NSE', 'SBIN', 'SBIN-UNKNOWN'),
      (err) => err.code === 'EXACT_INSTRUMENT_NOT_FOUND'
    );
  });

  test('39. Invalid Price & Missing Timestamp: rejects zero/negative LTP and missing exchange timestamps', () => {
    assert.throws(
      () =>
        angelMarketData.mapAngelQuoteResponse(
          { data: { fetched: [{ ltp: 0, exchTradeTime: new Date().toISOString() }] } },
          { exchange: 'NSE', symboltoken: '3045', tradingsymbol: 'SBIN-EQ' }
        ),
      (err) => err.code === 'ANGEL_MARKET_DATA_INVALID_PRICE'
    );

    assert.throws(
      () =>
        angelMarketData.mapAngelQuoteResponse(
          { data: { fetched: [{ ltp: -10, exchTradeTime: new Date().toISOString() }] } },
          { exchange: 'NSE', symboltoken: '3045', tradingsymbol: 'SBIN-EQ' }
        ),
      (err) => err.code === 'ANGEL_MARKET_DATA_INVALID_PRICE'
    );

    assert.throws(
      () =>
        angelMarketData.mapAngelQuoteResponse(
          { data: { fetched: [{ ltp: 800, exchTradeTime: '' }] } },
          { exchange: 'NSE', symboltoken: '3045', tradingsymbol: 'SBIN-EQ' }
        ),
      (err) => err.code === 'ANGEL_MARKET_DATA_INVALID_TIMESTAMP'
    );
  });

  test('40. Dashboard Snapshot Creation: snapshotFromValidatedQuote transitions cleanly between DATA_WAITING, STALE_MARKET_DATA, INVALID_MARKET_DATA, and LIVE_DATA', () => {
    const now = Date.now();
    const validRaw = {
      instrument: 'RELIANCE-EQ',
      exchange: 'NSE',
      price: 2950,
      open: 2920,
      high: 2960,
      low: 2910,
      previousClose: 2900,
      volume: 500000,
      timestamp: new Date(now - 1000).toISOString(),
      dataReady: true
    };

    const validCheck = RealMarketDataService.validateQuote(validRaw, 'RELIANCE', 'ANGEL_ONE', now);
    const liveSnap = MarketData.snapshotFromValidatedQuote(
      { key: 'RELIANCE', name: 'RELIANCE', exchange: 'NSE', type: 'EQUITY' },
      validCheck
    );
    assert.equal(liveSnap.status, 'LIVE_DATA');
    assert.equal(liveSnap.dataReady, true);
    assert.equal(liveSnap.price, 2950);
    assert.ok(Number.isFinite(liveSnap.indicators.trendScore));

    const staleCheck = RealMarketDataService.validateQuote(
      { ...validRaw, timestamp: new Date(now - 90000).toISOString() },
      'RELIANCE',
      'ANGEL_ONE',
      now
    );
    const staleSnap = MarketData.snapshotFromValidatedQuote('RELIANCE', staleCheck);
    assert.equal(staleSnap.status, 'STALE_MARKET_DATA');
    assert.equal(staleSnap.dataReady, false);
    assert.equal(staleSnap.price, null);
  });

  test('41. Real-Credential Diagnostic Support: reports YES/NO diagnostic flags in /api/health and /api/auth/status without exposing secret values', async () => {
    process.env.MARKET_DATA_PROVIDER = 'ANGEL_ONE';
    process.env.ANGEL_API_KEY = 'SUPER_SECRET_KEY';
    process.env.ANGEL_CLIENT_ID = 'SUPER_SECRET_CLIENT';
    process.env.ANGEL_PIN = '9999';
    process.env.ANGEL_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const res = await requestServer(server, '/api/auth/status');
    assert.equal(res.status, 200);
    assert.equal(res.json.diagnostics.credentialsConfigured, 'YES');
    assert.equal(res.json.diagnostics.sessionAuthenticated, 'NO');
    assert.equal(res.json.diagnostics.marketDataProvider, 'ANGEL_ONE');
    assert.equal(res.json.diagnostics.liveTrading, 'DISABLED');
    assert.equal(res.json.diagnostics.orderEndpoints, 'NONE');

    // Verify no secret values appear anywhere in serialized response
    assert.equal(res.text.includes('SUPER_SECRET_KEY'), false);
    assert.equal(res.text.includes('SUPER_SECRET_CLIENT'), false);
    assert.equal(res.text.includes('JBSWY3DPEHPK3PXP'), false);
  });

  test('42. End-to-End Browser Flow (Search -> Select -> Quote -> Validate -> Snapshot -> Paper Price Update)', async () => {
    const nowIso = new Date().toISOString();
    angelSession.setSessionForTest({ status: 'CONNECTED', accessToken: 'MOCK_TOKEN' });

    runtime.setMockSmartAPI({
      SmartAPI: class {
        setAccessToken() {}
        async searchScrip(exchange, query) {
          return {
            status: true,
            data: [
              {
                exchange: exchange || 'NSE',
                tradingsymbol: 'HDFCBANK-EQ',
                symboltoken: '1333'
              }
            ]
          };
        }
        async getMarketData(mode, tokens) {
          assert.equal(mode, 'FULL');
          assert.deepEqual(tokens, { NSE: ['1333'] });
          return {
            status: true,
            data: {
              fetched: [
                {
                  exchange: 'NSE',
                  tradingSymbol: 'HDFCBANK-EQ',
                  symbolToken: '1333',
                  ltp: 1680.5,
                  open: 1660,
                  high: 1690,
                  low: 1655,
                  close: 1650,
                  tradeVolume: 850000,
                  exchTradeTime: nowIso
                }
              ]
            }
          };
        }
      }
    });

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    // 1. User searches instrument via MarketSearch -> MarketAPI
    const searchResults = await MarketSearch.searchAsync('HDFCBANK', 'NSE', {
      searchInstruments: (ex, q) => MarketAPI.searchInstruments(ex, q, { baseUrl })
    });
    assert.equal(searchResults.length, 1);
    const selected = searchResults[0];
    assert.equal(selected.tradingsymbol, 'HDFCBANK-EQ');

    // 2. User selects instrument -> fetches quote via MarketAPI.quote
    const quoteRes = await MarketAPI.quote(
      selected.exchange,
      selected.name,
      selected.tradingsymbol,
      { baseUrl }
    );
    assert.equal(quoteRes.ok, true);

    // 3. Browser validates quote & creates snapshot
    const validation = RealMarketDataService.validateQuote(
      quoteRes.quote,
      selected.key,
      quoteRes.provider
    );
    assert.equal(validation.ok, true);

    const snapshot = MarketData.snapshotFromValidatedQuote(selected, validation);
    assert.equal(snapshot.status, 'LIVE_DATA');
    assert.equal(snapshot.price, 1680.5);

    // 4. Validated real quote updates isolated Paper Trading position
    PaperTrading.openPosition({
      symbol: 'HDFCBANK-EQ',
      direction: 'BUY',
      entry: 1670,
      stop: 1650,
      target: 1710,
      qty: 2
    });
    const paperUpdate = PaperTrading.updatePrice(snapshot.price);
    assert.equal(paperUpdate.pnl, 21);
  });

  test('43. AI Decision Contract Validation: validates BUY, SELL, HOLD, BUY_CE, BUY_PE and normalizes actions', () => {
    const buyCheck = AIDecisionContract.validate({
      signal: 'BUY',
      confidence: 88,
      risk: 'LOW',
      trend: 'BULLISH',
      reasoning: 'Bullish breakout above VWAP with strong volume.',
      stopLossSuggestion: 24900,
      targetSuggestion: 25200
    });
    assert.equal(buyCheck.ok, true);
    assert.equal(buyCheck.decision.action, 'BUY');
    assert.equal(buyCheck.decision.executable, true);

    const sellCheck = AIDecisionContract.validate({
      signal: 'SELL',
      confidence: 84,
      risk: 'MEDIUM',
      trend: 'BEARISH',
      reasoning: 'Bearish breakdown below support.'
    });
    assert.equal(sellCheck.ok, true);
    assert.equal(sellCheck.decision.action, 'SELL');
    assert.equal(sellCheck.decision.executable, true);

    const holdCheck = AIDecisionContract.validate({
      signal: 'HOLD',
      confidence: 50,
      risk: 'MEDIUM',
      trend: 'SIDEWAYS',
      reasoning: 'Rangebound consolidation.'
    });
    assert.equal(holdCheck.ok, true);
    assert.equal(holdCheck.decision.action, 'HOLD');
    assert.equal(holdCheck.decision.executable, false);
  });

  test('44. Invalid AI Response Handling: rejects malformed JSON, missing fields, out-of-range confidence, and forces safe HOLD/NO_TRADE fallback', () => {
    const badJson = AIDecisionContract.validate('{{{not-valid-json');
    assert.equal(badJson.ok, false);
    assert.equal(badJson.code, 'INVALID_AI_JSON');
    assert.equal(badJson.decision.signal, 'NO_TRADE');
    assert.equal(badJson.decision.action, 'HOLD');

    const badSchema = AIDecisionContract.validate({
      signal: 'YOLO_BUY_ALL',
      confidence: 150,
      risk: 'EXTREME',
      reasoning: ''
    });
    assert.equal(badSchema.ok, false);
    assert.equal(badSchema.code, 'AI_CONTRACT_VIOLATION');
    assert.equal(badSchema.decision.action, 'HOLD');
  });

  test('45. Server-Side Google AI Service & Endpoints: reports safe status, rejects unconfigured credentials without faking, and validates mocked AI output', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const statusRes = await requestServer(server, '/api/ai/status');
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.json.ok, true);
    assert.equal(statusRes.json.credentialsConfigured, false);
    assert.equal(statusRes.json.diagnostics.googleAIConfigured, 'NO');

    // Without credentials and without mock, /api/ai/analyze must fail safely (never fake AI output)
    const missingKeyRes = await requestServer(server, '/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataReady: true,
        symbol: 'NIFTY 50',
        price: 25000
      })
    });
    assert.equal(missingKeyRes.status, 400);
    assert.equal(missingKeyRes.json.ok, false);
    assert.equal(missingKeyRes.json.code, 'GOOGLE_AI_CREDENTIALS_MISSING');

    // Inject controlled test mock for server-side Google AI
    googleAIService.setMockAIClient(async (marketInput) => ({
      signal: 'BUY',
      confidence: 86,
      risk: 'LOW',
      trend: 'BULLISH',
      reasoning: `Mocked AI analysis for ${marketInput.symbol} at ${marketInput.price}`
    }));

    const mockedRes = await requestServer(server, '/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataReady: true,
        symbol: 'NIFTY 50',
        price: 25000,
        dataSource: 'MOCK'
      })
    });
    assert.equal(mockedRes.status, 200);
    assert.equal(mockedRes.json.ok, true);
    assert.equal(mockedRes.json.dataSource, 'MOCK_AI');
    assert.equal(mockedRes.json.decision.action, 'BUY');
  });

  test('46. Deterministic BUY / SELL / HOLD Strategy: generates BUY on bullish equity, SELL on bearish equity, and HOLD on sideways/contradictory AI', () => {
    const bearishAnalysis = MarketAnalysis.analyze({
      dataReady: true,
      assetType: 'EQUITY',
      trendScore: -90,
      momentumScore: -85,
      volumeScore: -80,
      vwapScore: -85,
      supportResistanceScore: -80,
      optionsScore: -75,
      newsScore: -70,
      breadthScore: -80,
      volatilityScore: 25
    });
    assert.equal(bearishAnalysis.signal, 'SELL');
    assert.equal(bearishAnalysis.action, 'SELL');

    const sellStrat = StrategyEngine.evaluate({
      dataReady: true,
      price: 1000,
      assetType: 'EQUITY',
      analysis: bearishAnalysis
    });
    assert.equal(sellStrat.action, 'SELL');
    assert.equal(sellStrat.tradeSide, 'SELL');
    assert.equal(sellStrat.entry, 1000);
    assert.equal(sellStrat.stopLoss, 1005);
    assert.equal(sellStrat.target, 990);

    // Contradictory AI decision must force strategy to block trade
    const contradicted = StrategyEngine.evaluate({
      dataReady: true,
      price: 1000,
      assetType: 'EQUITY',
      analysis: bearishAnalysis,
      aiDecision: {
        valid: true,
        signal: 'BUY',
        confidence: 85,
        risk: 'LOW'
      }
    });
    assert.equal(contradicted.action, 'NO_TRADE');
  });

  test('47. Automatic Paper BUY & Automatic Exit: executes PAPER BUY automatically and closes position on SL/Target', () => {
    const bullishSnapshot = {
      name: 'RELIANCE',
      exchange: 'NSE',
      type: 'EQUITY',
      dataReady: true,
      price: 2000,
      indicators: {
        trendScore: 90,
        momentumScore: 88,
        volumeScore: 85,
        vwapScore: 85,
        supportResistanceScore: 85,
        optionsScore: 80,
        volatilityScore: 20
      }
    };

    const autoBuy = PaperTrading.autoEvaluateAndExecute({
      dataReady: true,
      snapshot: bullishSnapshot,
      price: 2000,
      symbol: 'RELIANCE',
      assetType: 'EQUITY',
      quantity: 2,
      exitOnTarget: true
    });

    assert.equal(autoBuy.ok, true);
    assert.equal(autoBuy.executed, true);
    assert.equal(autoBuy.action, 'BUY');
    assert.equal(PaperTrading.getState().position.symbol, 'RELIANCE');
    assert.equal(PaperTrading.getState().position.mode, 'AUTO_PAPER');

    // Subsequent tick hits target (2000 + 20 = 2020) and automatically exits
    const autoTargetExit = PaperTrading.autoEvaluateAndExecute({
      dataReady: true,
      snapshot: { ...bullishSnapshot, price: 2025 },
      price: 2025,
      symbol: 'RELIANCE',
      assetType: 'EQUITY',
      exitOnTarget: true
    });

    assert.equal(autoTargetExit.ok, true);
    assert.equal(autoTargetExit.action, 'TARGET_EXIT');
    assert.equal(PaperTrading.getState().position, null);
    assert.equal(PaperTrading.getState().dailyPnl, 50);
    assert.equal(PaperTrading.getState().history.length, 1);
  });

  test('48. Automatic Paper SELL & Duplicate Order Protection: executes PAPER SELL automatically and blocks duplicate open positions', () => {
    const bearishAnalysis = MarketAnalysis.analyze({
      dataReady: true,
      assetType: 'EQUITY',
      trendScore: -92,
      momentumScore: -90,
      volumeScore: -85,
      vwapScore: -85,
      supportResistanceScore: -85,
      optionsScore: -80,
      newsScore: -75,
      breadthScore: -85,
      volatilityScore: 20
    });

    const autoSell = PaperTrading.autoEvaluateAndExecute({
      dataReady: true,
      price: 1500,
      symbol: 'TCS',
      assetType: 'EQUITY',
      quantity: 2,
      analysis: bearishAnalysis
    });

    assert.equal(autoSell.ok, true);
    assert.equal(autoSell.executed, true);
    assert.equal(autoSell.action, 'SELL');
    assert.equal(PaperTrading.getState().position.direction, 'SELL');

    // Attempt to open another trade on a different symbol while TCS is open
    const duplicateBlocked = PaperTrading.autoEvaluateAndExecute({
      dataReady: true,
      price: 1800,
      symbol: 'INFY',
      assetType: 'EQUITY',
      quantity: 1,
      analysis: bearishAnalysis
    });
    assert.equal(duplicateBlocked.ok, false);
    assert.equal(duplicateBlocked.executed, false);
  });

  test('49. Daily Loss Lock & Max Trades Lock: blocks automatic paper trading once daily loss (-₹1000) or max trades (3/day) is reached', () => {
    const analysis = {
      dataReady: true,
      signal: 'BUY',
      confidence: 90,
      risk: 'LOW'
    };

    // Execute and close 3 trades to hit maxTradesPerDay = 3
    for (let i = 0; i < 3; i++) {
      const open = PaperTrading.autoEvaluateAndExecute({
        dataReady: true,
        price: 1000,
        symbol: 'SBIN',
        assetType: 'EQUITY',
        quantity: 1,
        analysis
      });
      assert.equal(open.executed, true);
      PaperTrading.closePosition(1005, 'MANUAL');
    }

    assert.equal(PaperTrading.getState().tradesToday, 3);

    const fourthTrade = PaperTrading.autoEvaluateAndExecute({
      dataReady: true,
      price: 1000,
      symbol: 'SBIN',
      assetType: 'EQUITY',
      quantity: 1,
      analysis
    });
    assert.equal(fourthTrade.ok, false);
    assert.equal(fourthTrade.code, 'RISK_REJECTED');

    // Verify Daily Loss Lock (-₹1,000)
    PaperTrading.resetState();
    PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24500,
      target: 26000,
      qty: 1
    });
    // Adverse gap causes ₹1,000 loss
    PaperTrading.closePosition(24000, 'STOP_LOSS');
    assert.equal(PaperTrading.getState().dailyPnl, -1000);

    const lockedAfterLoss = PaperTrading.autoEvaluateAndExecute({
      dataReady: true,
      price: 1000,
      symbol: 'SBIN',
      assetType: 'EQUITY',
      quantity: 1,
      analysis
    });
    assert.equal(lockedAfterLoss.ok, false);
    assert.equal(lockedAfterLoss.code, 'RISK_REJECTED');
  });

  test('50. Complete AI Architecture Pipeline E2E: Market Data -> Validation -> MarketAnalysis -> Google AI -> Contract -> Strategy -> Risk -> Paper BUY -> Exit -> P&L -> Audit', async () => {
    const nowIso = new Date().toISOString();
    angelSession.setSessionForTest({ status: 'CONNECTED', accessToken: 'MOCK_TOKEN' });

    runtime.setMockSmartAPI({
      SmartAPI: class {
        setAccessToken() {}
        async searchScrip() {
          return {
            status: true,
            data: [{ exchange: 'NSE', tradingsymbol: 'ICICIBANK-EQ', symboltoken: '4963' }]
          };
        }
        async getMarketData() {
          return {
            status: true,
            data: {
              fetched: [
                {
                  exchange: 'NSE',
                  tradingSymbol: 'ICICIBANK-EQ',
                  symbolToken: '4963',
                  ltp: 1200,
                  open: 1170,
                  high: 1200.5,
                  low: 1165,
                  close: 1160,
                  tradeVolume: 950000,
                  exchTradeTime: nowIso
                }
              ]
            }
          };
        }
      }
    });

    googleAIService.setMockAIClient(async () => ({
      signal: 'BUY',
      confidence: 88,
      risk: 'LOW',
      trend: 'BULLISH',
      reasoning: 'Strong institutional volume breakout above previous close.'
    }));

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    // 1. Fetch & validate quote
    const quoteRes = await MarketAPI.quote('NSE', 'ICICIBANK', 'ICICIBANK-EQ', { baseUrl });
    const validation = RealMarketDataService.validateQuote(quoteRes.quote, 'ICICIBANK', quoteRes.provider);
    const snapshot = MarketData.snapshotFromValidatedQuote(
      { key: 'ICICIBANK', name: 'ICICIBANK-EQ', exchange: 'NSE', type: 'EQUITY' },
      validation
    );
    assert.equal(snapshot.dataReady, true);

    // 2. Deterministic Market Analysis
    const analysis = MarketAnalysis.analyze({
      dataReady: true,
      assetType: 'EQUITY',
      ...snapshot.indicators
    });
    assert.equal(analysis.signal, 'BUY');

    // 3. Server-side Google AI Analysis + Strict Contract
    const aiRes = await MarketAPI.aiAnalyze(
      {
        dataReady: true,
        symbol: 'ICICIBANK-EQ',
        exchange: 'NSE',
        assetType: 'EQUITY',
        price: snapshot.price,
        indicators: snapshot.indicators,
        deterministicAnalysis: analysis,
        dataSource: 'MOCK'
      },
      { baseUrl }
    );
    assert.equal(aiRes.ok, true);
    assert.equal(aiRes.decision.valid, true);
    assert.equal(aiRes.decision.action, 'BUY');

    // 4. Automatic Paper Execution through Strategy -> RiskEngine -> AISafetyGate -> PaperTrading
    const exec = PaperTrading.autoEvaluateAndExecute({
      dataReady: true,
      snapshot,
      price: snapshot.price,
      symbol: 'ICICIBANK-EQ',
      assetType: 'EQUITY',
      quantity: 5,
      analysis,
      aiDecision: aiRes.decision,
      exitOnTarget: true
    });
    assert.equal(exec.ok, true);
    assert.equal(exec.executed, true);
    assert.equal(exec.action, 'BUY');

    // 5. Price reaches target (1200 -> 1215) -> Automatic Exit -> Realized P&L -> Audit Log
    const exitUpdate = PaperTrading.updatePrice(1215, { autoExit: true, exitOnTarget: true });
    assert.equal(exitUpdate.action, 'TARGET_EXIT');
    assert.equal(exitUpdate.closed, true);
    assert.equal(PaperTrading.getState().dailyPnl, 75);
    assert.ok(AuditLogger.getLogs().length >= 1);
  });

  test('51. Single SQLite Database Persistence: schema migrations, atomic paper transactions, state reload, and secret redaction', () => {
    const dbStatus = serverDb.getDatabaseStatus();
    assert.equal(dbStatus.connected, true);
    assert.ok(dbStatus.tables.includes('paper_orders'));
    assert.ok(dbStatus.tables.includes('paper_fills'));
    assert.ok(dbStatus.tables.includes('paper_positions'));
    assert.ok(dbStatus.tables.includes('paper_trade_results'));
    assert.ok(dbStatus.tables.includes('audit_events'));
    assert.ok(dbStatus.tables.includes('emergency_stop_state'));

    // Open and close a paper position and verify SQLite records
    const open = PaperTrading.openPosition({
      symbol: 'SBIN-EQ',
      direction: 'BUY',
      entry: 800,
      stop: 790,
      target: 820,
      qty: 5
    });
    assert.equal(open.ok, true);
    assert.ok(serverDb.getOpenPosition());
    assert.equal(serverDb.getOpenPosition().symbol, 'SBIN-EQ');

    const close = PaperTrading.closePosition(815, 'TARGET_EXIT');
    assert.equal(close.ok, true);
    assert.equal(serverDb.getOpenPosition(), null);
    assert.equal(serverDb.listPaperOrders().length, 2);
    assert.equal(serverDb.listPaperFills().length, 2);
    assert.equal(serverDb.listTradeHistory().length, 1);
    assert.equal(serverDb.getPaperAccount().dailyPnl, 75);
    assert.equal(serverDb.getPaperAccount().wins, 1);

    // Reload PaperTrading state from SQLite and verify persistence
    const reloaded = PaperTrading.loadState();
    assert.equal(reloaded.dailyPnl, 75);
    assert.equal(reloaded.history.length, 1);
    assert.equal(reloaded.orders.length, 2);
  });

  test('52. Technical Analysis Engine: computes EMA, SMA, RSI, MACD, ATR, Bollinger Bands, ADX, VWAP and handles insufficient candles gracefully', () => {
    const insufficient = MarketData.deriveIndicatorsFromQuote({});
    assert.equal(insufficient.dataQuality, 'DATA_UNAVAILABLE');
    assert.equal(insufficient.rsi14, null);
    assert.equal(insufficient.macd, null);

    // Generate 30 deterministic ascending candles
    const candles = [];
    for (let i = 0; i < 30; i += 1) {
      const base = 1000 + i * 5;
      candles.push({
        timestamp: new Date(1700000000000 + i * 300000).toISOString(),
        open: base - 2,
        high: base + 6,
        low: base - 4,
        close: base + 3,
        volume: 10000 + i * 500
      });
    }

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const indicators = MarketData.deriveIndicatorsFromQuote(
      {
        price: last.close,
        open: last.open,
        high: last.high,
        low: last.low,
        previousClose: prev.close,
        volume: last.volume
      },
      candles
    );

    assert.equal(indicators.dataQuality, 'FULL_CANDLE_SERIES');
    assert.ok(Number.isFinite(indicators.ema9));
    assert.ok(Number.isFinite(indicators.ema21));
    assert.ok(Number.isFinite(indicators.sma20));
    assert.ok(Number.isFinite(indicators.rsi14));
    assert.ok(indicators.macd && Number.isFinite(indicators.macd.macd));
    assert.ok(Number.isFinite(indicators.atr14));
    assert.ok(indicators.bollingerBands && Number.isFinite(indicators.bollingerBands.upper));
    assert.ok(Number.isFinite(indicators.adx14));
    assert.ok(Number.isFinite(indicators.vwap));
    assert.equal(indicators.breakout, 'BULLISH_BREAKOUT');
  });

  test('53. Market Intelligence Abstraction: returns DATA_UNAVAILABLE when unconfigured and normalizes verified fresh/stale feeds', async () => {
    const unconfigured = await MarketIntelligence.getIntelligence({ market: 'NSE' });
    assert.equal(unconfigured.status, 'DATA_UNAVAILABLE');
    assert.equal(unconfigured.available, false);

    const nowMs = Date.now();
    MarketIntelligence.registerProvider({
      async fetchIntelligence() {
        return {
          available: true,
          timestamp: new Date(nowMs - 30000).toISOString(),
          source: 'TEST_FEED',
          market: 'NSE',
          headlines: ['RBI holds policy rate steady'],
          sentiment: 'BULLISH',
          sentimentScore: 68,
          macroFactors: ['Stable yields'],
          confidence: 78
        };
      }
    });

    const fresh = await MarketIntelligence.getIntelligence({ market: 'NSE' });
    assert.equal(fresh.status, 'AVAILABLE');
    assert.equal(fresh.available, true);
    assert.equal(fresh.sentiment, 'BULLISH');
    assert.equal(fresh.sentimentScore, 68);

    const stale = MarketIntelligence.normalize(
      {
        available: true,
        timestamp: new Date(nowMs - 3600000).toISOString(),
        sentiment: 'BULLISH'
      },
      { nowMs, maxAgeMs: 60000 }
    );
    assert.equal(stale.status, 'STALE_DATA');
    assert.equal(stale.available, false);
  });

  test('54. Server Persistence & Safety Endpoints: /api/paper/state, /api/audit/logs, /api/emergency/*, /api/backtest/*, /api/readiness/audit', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    // 1. Check initial paper state
    const pState = await MarketAPI.paperState({ baseUrl });
    assert.equal(pState.ok, true);
    assert.equal(pState.liveTradingEnabled, false);
    assert.equal(pState.account.capital, 100000);

    // 2. Activate & Reset Emergency Stop via server API
    const emAct = await MarketAPI.activateEmergencyStop('API test halt', { baseUrl });
    assert.equal(emAct.ok, true);
    assert.equal(emAct.active, true);
    assert.equal(serverDb.getEmergencyStop().active, true);

    const emReset = await MarketAPI.resetEmergencyStop('API test resume', { baseUrl });
    assert.equal(emReset.ok, true);
    assert.equal(emReset.active, false);
    assert.equal(serverDb.getEmergencyStop().active, false);

    // 3. Run backtest via server API and verify it persists in SQLite
    const btRun = await MarketAPI.runBacktest(
      {
        symbol: 'NIFTY 50',
        assetType: 'EQUITY',
        quantity: 1,
        candles: [
          {
            timestamp: '2026-10-01T09:15:00.000Z',
            open: 25000,
            high: 25040,
            low: 24990,
            close: 25020,
            volume: 10000
          },
          {
            timestamp: '2026-10-01T09:20:00.000Z',
            open: 25020,
            high: 25150,
            low: 25010,
            close: 25120,
            volume: 50000,
            indicators: {
              trendScore: 95,
              momentumScore: 90,
              volumeScore: 85,
              vwapScore: 85,
              supportResistanceScore: 85,
              optionsScore: 80,
              volatilityScore: 20
            }
          },
          {
            timestamp: '2026-10-01T09:25:00.000Z',
            open: 25120,
            high: 25450,
            low: 25100,
            close: 25400,
            volume: 60000
          }
        ]
      },
      { baseUrl }
    );
    assert.equal(btRun.ok, true);
    assert.equal(btRun.metrics.totalTrades, 1);

    const btList = await MarketAPI.backtestRuns({ baseUrl });
    assert.equal(btList.ok, true);
    assert.equal(btList.runs.length, 1);

    // 4. Readiness audit endpoint
    const auditRes = await MarketAPI.readinessAudit({ baseUrl });
    assert.equal(auditRes.ok, true);
    assert.equal(auditRes.liveTradingEnabled, false);
  });

  test('55. Angel One Historical Candle Adapter & /api/market/candles Pipeline: normalizes getCandleData array rows, rejects unauthenticated/invalid responses, and feeds Technical Indicator Engine', async () => {
    // 1. Rejects when session is not authenticated
    angelSession.clearSession();
    await assert.rejects(
      () =>
        angelMarketData.getCandles({
          exchange: 'NSE',
          symboltoken: '3045',
          tradingsymbol: 'SBIN-EQ'
        }),
      (err) => err.code === 'ANGEL_SESSION_NOT_READY'
    );

    // 2. Normalizes Angel One [timestamp, open, high, low, close, volume] rows via /api/market/candles
    angelSession.setSessionForTest({ status: 'CONNECTED', accessToken: 'MOCK_TOKEN' });

    const rawCandleRows = [];
    for (let i = 0; i < 30; i += 1) {
      const base = 800 + i * 2;
      const ts = new Date(1700000000000 + i * 300000).toISOString();
      rawCandleRows.push([ts, base - 1, base + 4, base - 3, base + 2, 15000 + i * 200]);
    }

    runtime.setMockSmartAPI({
      SmartAPI: class {
        setAccessToken() {}
        async searchScrip(exchange, query) {
          assert.equal(exchange, 'NSE');
          assert.equal(query, 'SBIN');
          return {
            status: true,
            data: [{ exchange: 'NSE', tradingsymbol: 'SBIN-EQ', symboltoken: '3045' }]
          };
        }
        async getCandleData(params) {
          assert.equal(params.exchange, 'NSE');
          assert.equal(params.symboltoken, '3045');
          assert.equal(params.interval, 'FIVE_MINUTE');
          return {
            status: true,
            data: rawCandleRows
          };
        }
      }
    });

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const candleRes = await MarketAPI.candles('NSE', 'SBIN', 'SBIN-EQ', {
      baseUrl,
      interval: '5m'
    });
    assert.equal(candleRes.ok, true);
    assert.equal(candleRes.interval, 'FIVE_MINUTE');
    assert.equal(candleRes.candles.length, 30);
    assert.equal(candleRes.candles[0].open, 799);
    assert.equal(candleRes.candles[29].close, 860);

    // 3. Feed normalized candles + validated quote into Snapshot & Technical Analysis Engine
    const nowMs = Date.now();
    const validation = RealMarketDataService.validateQuote(
      {
        instrument: 'SBIN-EQ',
        exchange: 'NSE',
        price: 860,
        open: 855,
        high: 862,
        low: 853,
        previousClose: 850,
        volume: 250000,
        timestamp: new Date(nowMs - 1000).toISOString(),
        dataReady: true
      },
      'SBIN',
      'ANGEL_ONE',
      nowMs
    );

    const snapshot = MarketData.snapshotFromValidatedQuote(
      { key: 'SBIN', name: 'SBIN-EQ', exchange: 'NSE', type: 'EQUITY' },
      validation,
      candleRes.candles
    );
    assert.equal(snapshot.dataReady, true);
    assert.equal(snapshot.candles.length, 30);
    assert.equal(snapshot.indicators.dataQuality, 'FULL_CANDLE_SERIES');
    assert.ok(Number.isFinite(snapshot.indicators.ema9));
    assert.ok(Number.isFinite(snapshot.indicators.rsi14));
    assert.ok(Number.isFinite(snapshot.indicators.atr14));
    assert.ok(Number.isFinite(snapshot.indicators.vwap));
  });

  /* =====================================================
     TASK 2 — COMPLETE USER ACCOUNT SYSTEM VERIFICATION
  ===================================================== */

  function extractCookiePair(setCookieHeader) {
    const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
    if (!raw) return '';
    return String(raw).split(';')[0].trim();
  }

  test('56. User Registration: creates user with valid name, email, password, unique immutable userId, and isolated paper account', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const res = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Yashwin Trader',
        email: 'Trader.One@Example.com',
        password: 'StrongPassword123'
      })
    });

    assert.equal(res.status, 201);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.authenticated, true);
    assert.equal(res.json.authDomain, 'YASHWIN_USER_ACCOUNT');
    assert.match(res.json.user.userId, /^USR-[0-9a-f-]{36}$/i);
    assert.equal(res.json.user.name, 'Yashwin Trader');
    assert.equal(res.json.user.email, 'Trader.One@Example.com');
    assert.equal(res.json.user.emailNormalized, 'trader.one@example.com');
    assert.ok(res.json.csrfToken);
    assert.ok(res.headers['set-cookie']);

    // Verify isolated paper account created for user
    const userAcct = serverDb.getPaperAccount(res.json.user.userId);
    assert.ok(userAcct);
    assert.equal(userAcct.userId, res.json.user.userId);
    assert.equal(userAcct.capital, 100000);
  });

  test('57. Duplicate Email Rejection: rejects duplicate email registration regardless of case or whitespace', async () => {
    await userAuthService.registerUser({
      name: 'First User',
      email: 'duplicate@example.com',
      password: 'Password123'
    });

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const dupRes = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Second User',
        email: '  DUPLICATE@Example.com ',
        password: 'AnotherPassword123'
      })
    });

    assert.equal(dupRes.status, 409);
    assert.equal(dupRes.json.ok, false);
    assert.equal(dupRes.json.code, 'DUPLICATE_EMAIL');
  });

  test('58. Weak/Invalid Password & Input Validation: rejects short passwords, missing numbers/letters, invalid emails, and short names', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const shortPass = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Valid Name',
        email: 'valid@example.com',
        password: 'short1'
      })
    });
    assert.equal(shortPass.status, 400);
    assert.equal(shortPass.json.code, 'WEAK_PASSWORD');

    const noDigitsPass = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Valid Name',
        email: 'valid@example.com',
        password: 'OnlyLettersPassword'
      })
    });
    assert.equal(noDigitsPass.status, 400);
    assert.equal(noDigitsPass.json.code, 'WEAK_PASSWORD');

    const badEmail = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Valid Name',
        email: 'not-an-email',
        password: 'ValidPassword123'
      })
    });
    assert.equal(badEmail.status, 400);
    assert.equal(badEmail.json.code, 'INVALID_EMAIL');

    const badName = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'A',
        email: 'valid2@example.com',
        password: 'ValidPassword123'
      })
    });
    assert.equal(badName.status, 400);
    assert.equal(badName.json.code, 'INVALID_NAME');
  });

  test('59. Password Hashing & Zero Plain-Text Storage: stores bcrypt hash in SQLite and never stores or returns plain-text password', async () => {
    const plainPassword = 'UltraSecretPassword99!';
    const reg = await userAuthService.registerUser({
      name: 'Hash Check User',
      email: 'hashcheck@example.com',
      password: plainPassword
    });

    assert.equal('password' in reg.user, false);
    assert.equal('passwordHash' in reg.user, false);

    const dbUserWithSecrets = serverDb.getUserById(reg.user.userId, true);
    assert.ok(dbUserWithSecrets.passwordHash.startsWith('$2'));
    assert.notEqual(dbUserWithSecrets.passwordHash, plainPassword);
    assert.equal(dbUserWithSecrets.passwordAlgo, 'bcrypt');

    // Scan entire users table and audit_events table to verify plainPassword does not exist anywhere
    const rawUsers = JSON.stringify(serverDb.getDb().prepare('SELECT * FROM users').all());
    const rawAudits = JSON.stringify(serverDb.getDb().prepare('SELECT * FROM audit_events').all());
    assert.equal(rawUsers.includes(plainPassword), false);
    assert.equal(rawAudits.includes(plainPassword), false);
  });

  test('60. Login Success & Wrong Password Rejection: authenticates valid credentials and rejects wrong password or unknown email with 401', async () => {
    await userAuthService.registerUser({
      name: 'Login User',
      email: 'loginuser@example.com',
      password: 'CorrectPassword123'
    });

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const badPassRes = await requestServer(server, '/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'loginuser@example.com',
        password: 'WrongPassword999'
      })
    });
    assert.equal(badPassRes.status, 401);
    assert.equal(badPassRes.json.ok, false);
    assert.equal(badPassRes.json.code, 'INVALID_CREDENTIALS');

    const goodLoginRes = await requestServer(server, '/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'LOGINUSER@example.com',
        password: 'CorrectPassword123'
      })
    });
    assert.equal(goodLoginRes.status, 200);
    assert.equal(goodLoginRes.json.ok, true);
    assert.equal(goodLoginRes.json.authenticated, true);
    assert.equal(goodLoginRes.json.user.emailNormalized, 'loginuser@example.com');
  });

  test('61. Secure HttpOnly Session Cookie & Production Secure Flag: sets HttpOnly SameSite=Lax cookie and adds Secure in production', async () => {
    const devHeader = userAuthService.buildSessionSetCookieHeader('tok123', { secure: false });
    assert.equal(devHeader.includes('HttpOnly'), true);
    assert.equal(devHeader.includes('SameSite=Lax'), true);
    assert.equal(devHeader.includes('Secure'), false);

    process.env.NODE_ENV = 'production';
    const prodHeader = userAuthService.buildSessionSetCookieHeader('tok123');
    assert.equal(prodHeader.includes('HttpOnly'), true);
    assert.equal(prodHeader.includes('SameSite=Lax'), true);
    assert.equal(prodHeader.includes('Secure'), true);
  });

  test('62. Session Persistence, Expiry & Logout Invalidation: maintains session via cookie, rejects expired sessions, and invalidates on logout', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const regRes = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Session User',
        email: 'session@example.com',
        password: 'SessionPassword123'
      })
    });
    const cookie = extractCookiePair(regRes.headers['set-cookie']);
    const csrfToken = regRes.json.csrfToken;

    // 1. Session active
    const sessCheck1 = await requestServer(server, '/api/user/session', {
      headers: { Cookie: cookie }
    });
    assert.equal(sessCheck1.status, 200);
    assert.equal(sessCheck1.json.authenticated, true);
    assert.equal(sessCheck1.json.user.emailNormalized, 'session@example.com');

    // 2. Logout invalidates session in database
    const logoutRes = await requestServer(server, '/api/user/logout', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': csrfToken
      }
    });
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.json.revoked, true);

    // 3. Reusing old cookie after logout is rejected
    const sessCheckAfterLogout = await requestServer(server, '/api/user/session', {
      headers: { Cookie: cookie }
    });
    assert.equal(sessCheckAfterLogout.json.authenticated, false);
    assert.equal(sessCheckAfterLogout.json.user, null);

    // 4. Expired session is rejected
    const expiredSession = userAuthService.createSessionForUser(regRes.json.user.userId, {
      nowMs: Date.now() - 120000,
      ttlMs: 60000
    });
    const tokenHash = userAuthService.sha256Hex(expiredSession.rawToken);
    assert.equal(serverDb.getActiveSessionByTokenHash(tokenHash, Date.now()), null);
  });

  test('63. Login Rate Limiting: blocks brute-force login after 5 failed attempts with 429 LOGIN_RATE_LIMITED and Retry-After header', async () => {
    await userAuthService.registerUser({
      name: 'Rate Limit User',
      email: 'ratelimit@example.com',
      password: 'CorrectPassword123'
    });

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    for (let i = 0; i < 5; i += 1) {
      const failRes = await requestServer(server, '/api/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ratelimit@example.com',
          password: `WrongAttempt${i}`
        })
      });
      assert.equal(failRes.status, 401);
    }

    // 6th attempt must be blocked with 429 even if password is correct
    const blockedRes = await requestServer(server, '/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ratelimit@example.com',
        password: 'CorrectPassword123'
      })
    });
    assert.equal(blockedRes.status, 429);
    assert.equal(blockedRes.json.code, 'LOGIN_RATE_LIMITED');
    assert.ok(blockedRes.headers['retry-after']);
  });

  test('64. CSRF Protection for Cookie-Authenticated Mutations: blocks POST mutations with missing/invalid X-CSRF-Token', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const regRes = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'CSRF User',
        email: 'csrf@example.com',
        password: 'CsrfPassword123'
      })
    });
    const cookie = extractCookiePair(regRes.headers['set-cookie']);
    const csrfToken = regRes.json.csrfToken;

    // Attempt profile mutation without CSRF token -> 403 CSRF_TOKEN_INVALID
    const noCsrfRes = await requestServer(server, '/api/user/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({ name: 'Hacked Name' })
    });
    assert.equal(noCsrfRes.status, 403);
    assert.equal(noCsrfRes.json.code, 'CSRF_TOKEN_INVALID');

    // Attempt profile mutation with valid CSRF token -> 200 OK
    const validCsrfRes = await requestServer(server, '/api/user/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ name: 'Authorized Name' })
    });
    assert.equal(validCsrfRes.status, 200);
    assert.equal(validCsrfRes.json.user.name, 'Authorized Name');
  });

  test('65. Profile View, Name Update, Settings Update & Immutable User ID Protection', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const regRes = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Original Name',
        email: 'profile@example.com',
        password: 'ProfilePassword123'
      })
    });
    const cookie = extractCookiePair(regRes.headers['set-cookie']);
    const csrfToken = regRes.json.csrfToken;
    const originalUserId = regRes.json.user.userId;

    const getProf = await requestServer(server, '/api/user/profile', {
      headers: { Cookie: cookie }
    });
    assert.equal(getProf.status, 200);
    assert.equal(getProf.json.user.userId, originalUserId);
    assert.ok(getProf.json.user.createdAt);
    assert.ok(getProf.json.user.updatedAt);

    // Attempt to mutate userId must fail with 400 IMMUTABLE_USER_ID
    const mutateIdRes = await requestServer(server, '/api/user/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        userId: 'USR-SPOOFED-ID',
        name: 'Should Fail'
      })
    });
    assert.equal(mutateIdRes.status, 400);
    assert.equal(mutateIdRes.json.code, 'IMMUTABLE_USER_ID');

    // Valid name and settings update
    const updateRes = await requestServer(server, '/api/user/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        name: 'Updated Trader Name',
        settings: { notifications: false }
      })
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.json.user.userId, originalUserId);
    assert.equal(updateRes.json.user.name, 'Updated Trader Name');
    assert.equal(updateRes.json.user.settings.notifications, false);
  });

  test('66. Email Change with Verification Service Configured vs Direct Update', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const regRes = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Email User',
        email: 'initial@example.com',
        password: 'EmailPassword123'
      })
    });
    const cookie = extractCookiePair(regRes.headers['set-cookie']);
    const csrfToken = regRes.json.csrfToken;

    // Configure email delivery provider to capture verification token
    let capturedVerification = null;
    userAuthService.setEmailDeliveryProvider({
      async sendEmailChangeVerification(payload) {
        capturedVerification = payload;
      }
    });

    const reqChange = await requestServer(server, '/api/user/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ email: 'verified.new@example.com' })
    });
    assert.equal(reqChange.status, 200);
    assert.equal(reqChange.json.emailChange.status, 'VERIFICATION_REQUIRED');
    // Email remains initial until verified
    assert.equal(reqChange.json.user.emailNormalized, 'initial@example.com');
    assert.ok(capturedVerification && capturedVerification.verificationToken);

    // Confirm verification token
    const confirmRes = await requestServer(server, '/api/user/email/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ token: capturedVerification.verificationToken })
    });
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.json.user.emailNormalized, 'verified.new@example.com');
  });

  test('67. Password Change with Current-Password Verification: rejects wrong current password and updates hash when valid', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const regRes = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Password User',
        email: 'pwchange@example.com',
        password: 'OldPassword123'
      })
    });
    const cookie = extractCookiePair(regRes.headers['set-cookie']);
    const csrfToken = regRes.json.csrfToken;

    // 1. Wrong current password -> 401 INVALID_CURRENT_PASSWORD
    const wrongCurr = await requestServer(server, '/api/user/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        currentPassword: 'WrongCurrentPassword1',
        newPassword: 'NewStrongPassword456'
      })
    });
    assert.equal(wrongCurr.status, 401);
    assert.equal(wrongCurr.json.code, 'INVALID_CURRENT_PASSWORD');

    // 2. Correct current password -> 200 OK
    const validChange = await requestServer(server, '/api/user/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        newPassword: 'NewStrongPassword456'
      })
    });
    assert.equal(validChange.status, 200);
    assert.equal(validChange.json.ok, true);

    // 3. Old password can no longer log in; new password succeeds
    const oldLogin = await requestServer(server, '/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pwchange@example.com',
        password: 'OldPassword123'
      })
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await requestServer(server, '/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pwchange@example.com',
        password: 'NewStrongPassword456'
      })
    });
    assert.equal(newLogin.status, 200);
  });

  test('68. Angel One Auth Separation: YASHWIN user login does not authenticate Angel One session, and Angel One login does not create a YASHWIN user session', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const regRes = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Separated User',
        email: 'separated@example.com',
        password: 'SeparatePassword123'
      })
    });
    const cookie = extractCookiePair(regRes.headers['set-cookie']);

    // YASHWIN user is logged in, but Angel One broker session must remain disconnected
    const angelStatus = await requestServer(server, '/api/auth/status', {
      headers: { Cookie: cookie }
    });
    assert.equal(angelStatus.status, 200);
    assert.equal(angelStatus.json.session.authenticated, false);

    // Conversely, connecting Angel One session without user cookie must leave /api/user/session unauthenticated
    angelSession.setSessionForTest({ status: 'CONNECTED', accessToken: 'ANGEL_JWT' });
    const userSessionWithoutCookie = await requestServer(server, '/api/user/session');
    assert.equal(userSessionWithoutCookie.status, 200);
    assert.equal(userSessionWithoutCookie.json.authenticated, false);
  });

  test('69. Multi-User Ownership Isolation & Legacy Record Protection: isolates paper accounts, positions, orders, fills, and trades between User A, User B, and Legacy (NULL) records', async () => {
    // 1. Create a legacy unowned position (user_id IS NULL) before users register
    PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24900,
      target: 25200,
      qty: 1
    });
    PaperTrading.closePosition(25100, 'MANUAL');
    assert.equal(serverDb.listTradeHistory(50, null).length, 1);

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // 2. Register User A and User B
    const regA = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Trader Alpha',
        email: 'alpha@example.com',
        password: 'AlphaPassword123'
      })
    });
    const cookieA = extractCookiePair(regA.headers['set-cookie']);
    const csrfA = regA.json.csrfToken;
    const userIdA = regA.json.user.userId;

    const regB = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Trader Beta',
        email: 'beta@example.com',
        password: 'BetaPassword123'
      })
    });
    const cookieB = extractCookiePair(regB.headers['set-cookie']);
    const csrfB = regB.json.csrfToken;
    const userIdB = regB.json.user.userId;

    // 3. Verify neither User A nor User B inherits the legacy unowned trade
    const stateAInitial = await requestServer(server, '/api/paper/state', {
      headers: { Cookie: cookieA }
    });
    assert.equal(stateAInitial.json.history.length, 0);
    assert.equal(stateAInitial.json.orders.length, 0);

    // 4. User A opens a paper position on RELIANCE via /api/paper/open
    const openA = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        symbol: 'RELIANCE',
        direction: 'BUY',
        entry: 2900,
        stop: 2880,
        target: 2950,
        qty: 5
      })
    });
    assert.equal(openA.status, 200);
    assert.equal(openA.json.ok, true);
    const posIdA = openA.json.positionId;

    // 5. User B queries /api/paper/state -> must NOT see User A's open position or orders
    const stateB = await requestServer(server, '/api/paper/state', {
      headers: { Cookie: cookieB }
    });
    assert.equal(stateB.status, 200);
    assert.equal(stateB.json.openPosition, null);
    assert.equal(stateB.json.orders.length, 0);

    // 6. User B attempts to query User A's paper state via ?userId= -> 403 FORBIDDEN_OWNERSHIP
    const crossRead = await requestServer(
      server,
      `/api/paper/state?userId=${encodeURIComponent(userIdA)}`,
      { headers: { Cookie: cookieB } }
    );
    assert.equal(crossRead.status, 403);
    assert.equal(crossRead.json.code, 'FORBIDDEN_OWNERSHIP');

    // 7. User B attempts to close User A's position by positionId -> 403 FORBIDDEN_OWNERSHIP
    const crossClose = await requestServer(server, '/api/paper/close', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieB,
        'X-CSRF-Token': csrfB
      },
      body: JSON.stringify({
        positionId: posIdA,
        exitPrice: 2940
      })
    });
    assert.equal(crossClose.status, 403);
    assert.equal(crossClose.json.code, 'FORBIDDEN_OWNERSHIP');

    // 8. User A closes their own position -> 200 OK and P&L credited only to User A
    const closeA = await requestServer(server, '/api/paper/close', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        positionId: posIdA,
        exitPrice: 2920
      })
    });
    assert.equal(closeA.status, 200);
    assert.equal(closeA.json.pnl, 100);
    assert.equal(closeA.json.account.dailyPnl, 100);
    assert.equal(serverDb.getPaperAccount(userIdB).dailyPnl, 0);
  });

  test('70. Main Dashboard All 18 Sections & Authenticated vs Unauthenticated/Session-Expired States', () => {
    // 1. Unauthenticated / Guest empty state
    const guestVm = DashboardEngine.buildDashboardViewModel({});
    assert.equal(guestVm.meta.tradingMode, 'PAPER');
    assert.equal(guestVm.meta.liveTradingEnabled, false);
    assert.equal(guestVm.meta.authenticated, false);
    assert.equal(guestVm.meta.isEmptyAccount, true);

    for (const secKey of DashboardEngine.REQUIRED_SECTIONS) {
      assert.ok(secKey in guestVm.sections, `Dashboard view model missing section: ${secKey}`);
    }

    // 2. Authenticated state with active user
    const authVm = DashboardEngine.buildDashboardViewModel({
      user: {
        userId: 'USR-DASH-01',
        name: 'Yashwin Trader',
        email: 'trader@example.com'
      },
      paperState: {
        capital: 100000,
        dailyPnl: 0,
        realizedPnl: 0,
        orders: [],
        history: []
      }
    });
    assert.equal(authVm.meta.authenticated, true);
    assert.equal(authVm.meta.userId, 'USR-DASH-01');
    assert.equal(authVm.meta.userName, 'Yashwin Trader');
    assert.equal(authVm.sections.availablePaperBalance.availableFormatted, '₹1,00,000.00');

    // 3. Session expired handling
    const expiredVm = DashboardEngine.buildDashboardViewModel({
      user: null,
      sessionExpired: true
    });
    assert.equal(expiredVm.meta.authenticated, false);
    assert.equal(expiredVm.meta.sessionExpired, true);
  });

  test('71. Dashboard Market Data Available vs Unavailable & Stale Quote Protection: never labels stale quote as LIVE and hides unvalidated confidence', () => {
    const nowMs = 1760000000000;

    // 1. Unavailable / Waiting state -> no fake price, no fake confidence, NO_TRADE
    const waitingVm = DashboardEngine.buildDashboardViewModel({
      nowMs,
      snapshot: MarketData.emptySnapshot('NIFTY50')
    });
    assert.equal(waitingVm.sections.marketStatus.code, 'DATA_WAITING');
    assert.equal(waitingVm.sections.marketStatus.isLive, false);
    assert.equal(waitingVm.sections.priceAndChange.available, false);
    assert.equal(waitingVm.sections.priceAndChange.priceFormatted, '--');
    assert.equal(waitingVm.sections.confidence.validated, false);
    assert.equal(waitingVm.sections.confidence.formatted, '--%');
    assert.equal(waitingVm.sections.signalBadge.action, 'NO_TRADE');

    // 2. Validated fresh quote -> shows INR price, % change, FRESH timestamp, and validated confidence
    const freshIso = new Date(nowMs - 5000).toISOString();
    const validCheck = RealMarketDataService.validateQuote(
      {
        instrument: 'RELIANCE-EQ',
        exchange: 'NSE',
        price: 3030,
        open: 3000,
        high: 3045,
        low: 2990,
        previousClose: 3000,
        volume: 420000,
        timestamp: freshIso,
        dataReady: true
      },
      'RELIANCE',
      'ANGEL_ONE',
      nowMs
    );
    const liveSnap = MarketData.snapshotFromValidatedQuote(
      { key: 'RELIANCE', name: 'RELIANCE', exchange: 'NSE', type: 'EQUITY' },
      validCheck
    );
    const analysis = MarketAnalysis.analyze({
      dataReady: true,
      assetType: 'EQUITY',
      trendScore: 85,
      momentumScore: 80,
      volumeScore: 75,
      vwapScore: 80,
      supportResistanceScore: 75,
      volatilityScore: 20
    });

    const liveVm = DashboardEngine.buildDashboardViewModel({
      nowMs,
      snapshot: liveSnap,
      instrument: { key: 'RELIANCE', name: 'RELIANCE', exchange: 'NSE', type: 'EQUITY' },
      analysis
    });
    assert.equal(liveVm.sections.marketStatus.code, 'LIVE_DATA');
    assert.equal(liveVm.sections.marketStatus.isLive, true);
    assert.equal(liveVm.sections.priceAndChange.available, true);
    assert.equal(liveVm.sections.priceAndChange.priceFormatted, '₹3,030.00');
    assert.equal(liveVm.sections.priceAndChange.changePctFormatted, '+1.00%');
    assert.equal(liveVm.sections.marketDataFreshness.isFresh, true);
    assert.equal(liveVm.sections.marketDataFreshness.isStale, false);
    assert.equal(liveVm.sections.confidence.validated, true);
    assert.equal(liveVm.sections.confidence.formatted, `${analysis.confidence}%`);

    // 3. Stale quote (>60s old) -> must NEVER be labeled LIVE/CURRENT, forces NO_TRADE and hides confidence
    const staleVm = DashboardEngine.buildDashboardViewModel({
      nowMs: nowMs + 95000, // 100s after freshIso
      snapshot: liveSnap,
      instrument: { key: 'RELIANCE', name: 'RELIANCE', exchange: 'NSE', type: 'EQUITY' },
      analysis
    });
    assert.equal(staleVm.sections.marketStatus.code, 'STALE_MARKET_DATA');
    assert.equal(staleVm.sections.marketStatus.label, 'STALE MARKET DATA');
    assert.equal(staleVm.sections.marketStatus.isLive, false);
    assert.equal(staleVm.sections.marketStatus.isStale, true);
    assert.equal(staleVm.sections.priceAndChange.available, false);
    assert.equal(staleVm.sections.priceAndChange.priceFormatted, '--');
    assert.equal(staleVm.sections.signalBadge.action, 'NO_TRADE');
    assert.equal(staleVm.sections.confidence.validated, false);
    assert.equal(staleVm.sections.confidence.formatted, '--%');
    assert.equal(staleVm.sections.marketDataFreshness.isStale, true);
  });

  test('72. Dashboard AI Decision Contract, Trade Levels (Entry/SL/Target), Risk/Reward & Technical Indicators Summary', () => {
    const nowMs = Date.now();
    const candles = [];
    for (let i = 0; i < 30; i += 1) {
      const base = 24800 + i * 10;
      candles.push({
        timestamp: new Date(nowMs - (30 - i) * 300000).toISOString(),
        open: base - 5,
        high: base + 15,
        low: base - 10,
        close: base + 8,
        volume: 100000 + i * 2000
      });
    }

    const validCheck = RealMarketDataService.validateQuote(
      {
        instrument: 'NIFTY 50',
        exchange: 'NSE',
        price: 25100,
        open: 24950,
        high: 25120,
        low: 24920,
        previousClose: 24900,
        volume: 950000,
        timestamp: new Date(nowMs - 2000).toISOString(),
        dataReady: true
      },
      'NIFTY50',
      'ANGEL_ONE',
      nowMs
    );
    const snap = MarketData.snapshotFromValidatedQuote('NIFTY50', validCheck, candles);

    const analysis = {
      dataReady: true,
      signal: 'BUY',
      action: 'BUY',
      confidence: 86,
      risk: 'LOW',
      trend: 'BULLISH',
      reasons: ['Bullish trend and momentum alignment.']
    };

    const aiContract = AIDecisionContract.validate({
      signal: 'BUY',
      confidence: 88,
      risk: 'LOW',
      trend: 'BULLISH',
      reasoning: 'Validated breakout above VWAP.',
      stopLossSuggestion: 24974.5,
      targetSuggestion: 25351
    });
    assert.equal(aiContract.ok, true);

    const strategy = StrategyEngine.evaluate({
      dataReady: true,
      price: 25100,
      assetType: 'EQUITY',
      analysis,
      aiDecision: aiContract.decision
    });
    assert.equal(strategy.action, 'BUY');

    const vm = DashboardEngine.buildDashboardViewModel({
      nowMs,
      snapshot: snap,
      analysis,
      aiDecision: aiContract.decision,
      strategy
    });

    assert.equal(vm.sections.signalBadge.action, 'BUY');
    assert.equal(vm.sections.aiMarketView.signal, 'BUY');
    assert.equal(vm.sections.aiMarketView.trend, 'BULLISH');
    assert.equal(vm.sections.aiMarketView.risk, 'LOW');
    assert.equal(vm.sections.confidence.validated, true);
    assert.equal(vm.sections.confidence.formatted, '88%');

    // Section 7 & 8: Entry / Stop-loss / Target & Risk/Reward
    assert.equal(vm.sections.tradeLevels.available, true);
    assert.equal(vm.sections.tradeLevels.entryFormatted, '₹25,100.00');
    assert.equal(vm.sections.tradeLevels.stopLossFormatted, '₹24,974.50');
    assert.equal(vm.sections.tradeLevels.targetFormatted, '₹25,351.00');
    assert.equal(vm.sections.riskReward.available, true);
    assert.equal(vm.sections.riskReward.ratioFormatted, '1 : 2.00');

    // Section 9: Technical Indicators Summary
    assert.equal(vm.sections.technicalIndicators.available, true);
    assert.equal(vm.sections.technicalIndicators.dataQuality, 'FULL_CANDLE_SERIES');
    assert.notEqual(vm.sections.technicalIndicators.ema9, '--');
    assert.notEqual(vm.sections.technicalIndicators.ema21, '--');
    assert.notEqual(vm.sections.technicalIndicators.sma20, '--');
    assert.notEqual(vm.sections.technicalIndicators.rsi14, '--');
    assert.notEqual(vm.sections.technicalIndicators.vwap, '--');
    assert.notEqual(vm.sections.technicalIndicators.atr14, '--');
  });

  test('73. Dashboard Populated vs Empty Paper Account & Multi-User Isolation E2E', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // Register User A and User B
    const regA = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dashboard User A',
        email: 'dash.a@example.com',
        password: 'DashPassword123'
      })
    });
    const cookieA = regA.headers['set-cookie'][0].split(';')[0];
    const csrfA = regA.json.csrfToken;

    const regB = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dashboard User B',
        email: 'dash.b@example.com',
        password: 'DashPassword123'
      })
    });
    const cookieB = regB.headers['set-cookie'][0].split(';')[0];

    // User A opens a position on TCS, closes it for +₹200 realized profit, then opens a second position on SBIN
    const open1 = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        symbol: 'TCS',
        direction: 'BUY',
        entry: 4000,
        stop: 3950,
        target: 4100,
        qty: 4
      })
    });
    assert.equal(open1.status, 200);

    const close1 = await requestServer(server, '/api/paper/close', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        positionId: open1.json.positionId,
        exitPrice: 4050
      })
    });
    assert.equal(close1.status, 200);
    assert.equal(close1.json.pnl, 200);

    const open2 = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        symbol: 'SBIN',
        direction: 'BUY',
        entry: 800,
        stop: 780,
        target: 840,
        qty: 10
      })
    });
    assert.equal(open2.status, 200);

    // Fetch User A paper state and build User A Dashboard View Model
    const stateARes = await requestServer(server, '/api/paper/state', {
      headers: { Cookie: cookieA }
    });
    const pStateA = {
      capital: stateARes.json.account.capital,
      dailyPnl: stateARes.json.account.dailyPnl,
      realizedPnl: stateARes.json.account.realizedPnl,
      tradesToday: stateARes.json.account.tradesToday,
      position: { ...stateARes.json.openPosition, current: 815 }, // +₹150 unrealized P&L
      orders: stateARes.json.orders,
      history: stateARes.json.history
    };

    const vmA = DashboardEngine.buildDashboardViewModel({
      user: regA.json.user,
      paperState: pStateA,
      riskLimits: stateARes.json.riskLimits
    });

    assert.equal(vmA.meta.isEmptyAccount, false);
    assert.equal(vmA.sections.todaysRealizedPnl.formatted, '₹200.00');
    assert.equal(vmA.sections.unrealizedPnl.formatted, '₹150.00');
    assert.equal(vmA.sections.openPositions.hasOpenPosition, true);
    assert.equal(vmA.sections.openPositions.position.symbol, 'SBIN');
    assert.equal(vmA.sections.recentOrders.length, 3);
    assert.equal(vmA.sections.recentTrades.length, 1);
    assert.equal(vmA.sections.recentTrades[0].symbol, 'TCS');
    assert.equal(vmA.sections.riskLimitStatus.tradesTodayFormatted, '2 / 3');
    assert.equal(vmA.sections.riskLimitStatus.openPositionsFormatted, '1 / 1');

    // Fetch User B paper state and build User B Dashboard View Model -> strictly empty & isolated
    const stateBRes = await requestServer(server, '/api/paper/state', {
      headers: { Cookie: cookieB }
    });
    const vmB = DashboardEngine.buildDashboardViewModel({
      user: regB.json.user,
      paperState: {
        capital: stateBRes.json.account.capital,
        dailyPnl: stateBRes.json.account.dailyPnl,
        realizedPnl: stateBRes.json.account.realizedPnl,
        tradesToday: stateBRes.json.account.tradesToday,
        position: stateBRes.json.openPosition,
        orders: stateBRes.json.orders,
        history: stateBRes.json.history
      },
      riskLimits: stateBRes.json.riskLimits
    });

    assert.equal(vmB.meta.isEmptyAccount, true);
    assert.equal(vmB.sections.todaysRealizedPnl.formatted, '₹0.00');
    assert.equal(vmB.sections.unrealizedPnl.formatted, '₹0.00');
    assert.equal(vmB.sections.openPositions.hasOpenPosition, false);
    assert.equal(vmB.sections.recentOrders.length, 0);
    assert.equal(vmB.sections.recentTrades.length, 0);
  });

  test('74. Dashboard Risk Limit Status, Emergency Stop Status & API Error Handling', () => {
    // 1. Default risk limits display (₹500 / ₹1,000 / 3 trades / 1 open pos)
    const normalVm = DashboardEngine.buildDashboardViewModel({
      riskLimits: RiskEngine.getLimits()
    });
    assert.equal(normalVm.sections.riskLimitStatus.maxLossPerTradeFormatted, '₹500.00');
    assert.equal(normalVm.sections.riskLimitStatus.maxDailyLossFormatted, '₹1,000.00');
    assert.equal(normalVm.sections.riskLimitStatus.maxTradesPerDay, 3);
    assert.equal(normalVm.sections.riskLimitStatus.maxOpenPositions, 1);
    assert.equal(normalVm.sections.riskLimitStatus.averaging, 'BLOCKED');
    assert.equal(normalVm.sections.emergencyStopStatus.active, false);

    // 2. Emergency Stop active -> forces NO_TRADE, hides confidence, shows HALTED
    const emVm = DashboardEngine.buildDashboardViewModel({
      emergencyStop: true,
      serverEmergencyStop: { active: true, reason: 'Operator kill switch' }
    });
    assert.equal(emVm.sections.emergencyStopStatus.active, true);
    assert.equal(emVm.sections.marketStatus.code, 'EMERGENCY_STOP');
    assert.equal(emVm.sections.signalBadge.action, 'NO_TRADE');
    assert.equal(emVm.sections.confidence.validated, false);
    assert.equal(emVm.sections.riskLimitStatus.badge, 'HALTED (EMERGENCY STOP)');

    // 3. API Error state -> explicit API_ERROR status without fabricating data
    const errVm = DashboardEngine.buildDashboardViewModel({
      apiError: 'Network timeout while fetching market quote.'
    });
    assert.equal(errVm.meta.apiError, 'Network timeout while fetching market quote.');
    assert.equal(errVm.sections.marketStatus.code, 'API_ERROR');
    assert.equal(errVm.sections.priceAndChange.available, false);
  });

  test('75. Dashboard DOM Structure, Navigation Hub & Responsive Layout Verification', () => {
    const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../web/style.css'), 'utf8');

    // Verify all 18 dashboard DOM element IDs exist in web/index.html
    const requiredDomIds = [
      'dashMarketStatusLabel',
      'dashSelectedSymbol',
      'dashSelectedPrice',
      'dashSelectedChange',
      'bigSignal',
      'dashActionBadge',
      'dashValidatedConfidence',
      'dashLevelEntry',
      'dashLevelStop',
      'dashLevelTarget',
      'dashRiskRewardRatio',
      'dashIndicatorsGrid',
      'dashOpenPosBadge',
      'dashAvailableBalance',
      'dashRealizedPnl',
      'dashUnrealizedPnl',
      'dashRecentOrdersList',
      'dashRecentTradesList',
      'dashMaxLossTrade',
      'dashMaxDailyLoss',
      'dashMaxTradesDay',
      'dashMaxOpenPositions',
      'dashEmergencyBadge',
      'dashQuoteFreshness',
      'dashQuoteTimestamp'
    ];
    for (const id of requiredDomIds) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Dashboard element id="${id}"`
      );
    }

    // Verify navigation links to all 10 required destinations
    const requiredNavLabels = [
      'Market Search',
      'AI Analysis',
      'Watchlist',
      'Portfolio',
      'Orders',
      'Trade History',
      'Backtesting',
      'Risk Management',
      'Account / Profile',
      'Settings'
    ];
    for (const label of requiredNavLabels) {
      assert.equal(
        html.includes(label),
        true,
        `web/index.html missing quick navigation link: ${label}`
      );
    }

    // Verify responsive mobile & desktop breakpoints in web/style.css
    assert.equal(css.includes('.dash-instrument-strip'), true);
    assert.equal(css.includes('.dash-three-col-grid'), true);
    assert.equal(css.includes('@media (max-width: 1100px)'), true);
    assert.equal(css.includes('@media (max-width: 700px)'), true);
    assert.equal(css.includes('.mobile-nav'), true);
  });

  /* =====================================================
     TASK 4 — COMPLETE MARKET SEARCH VERIFICATION (TESTS 76–81)
  ===================================================== */

  test('76. Market Search Catalog, Input Validation, Company Name Search & Exchange/Type Filters (NSE, BSE, NFO, BFO, Index, Equity, Futures, Option)', () => {
    // 1. Input validation
    assert.equal(MarketSearch.validateSearchInput('RELIANCE', { exchange: 'NSE', type: 'EQUITY' }).valid, true);
    assert.equal(MarketSearch.validateSearchInput('NIFTY 50', { exchange: 'ALL', type: 'INDEX' }).valid, true);
    const badChars = MarketSearch.validateSearchInput('<script>alert(1)</script>');
    assert.equal(badChars.valid, false);
    assert.equal(badChars.code, 'INVALID_SEARCH_CHARACTERS');

    const badEx = MarketSearch.validateSearchInput('SBIN', { exchange: 'FOREX' });
    assert.equal(badEx.valid, false);
    assert.equal(badEx.code, 'INVALID_EXCHANGE_FILTER');

    const badType = MarketSearch.validateSearchInput('SBIN', { type: 'CRYPTO' });
    assert.equal(badType.valid, false);
    assert.equal(badType.code, 'INVALID_INSTRUMENT_TYPE_FILTER');

    // 2. Search by symbol, trading symbol, and company name
    const bySymbol = MarketSearch.search('RELIANCE');
    assert.ok(bySymbol.length >= 2); // NSE and BSE RELIANCE
    assert.equal(bySymbol[0].name, 'RELIANCE');

    const byCompany = MarketSearch.search('Tata Consultancy');
    assert.ok(byCompany.length >= 1);
    assert.equal(byCompany[0].name, 'TCS');

    const byTradingSymbol = MarketSearch.search('SBIN-EQ');
    assert.ok(byTradingSymbol.length >= 1);
    assert.equal(byTradingSymbol[0].key, 'SBIN');

    // 3. Filter by NSE vs BSE and INDEX vs EQUITY
    const nseEquities = MarketSearch.search('', { exchange: 'NSE', type: 'EQUITY' });
    assert.ok(nseEquities.length > 0);
    assert.equal(nseEquities.every((i) => i.exchange === 'NSE' && i.type === 'EQUITY'), true);

    const bseEquities = MarketSearch.search('', { exchange: 'BSE', type: 'EQUITY' });
    assert.ok(bseEquities.length > 0);
    assert.equal(bseEquities.every((i) => i.exchange === 'BSE' && i.type === 'EQUITY'), true);

    const indices = MarketSearch.search('', { exchange: 'ALL', type: 'INDEX' });
    assert.ok(indices.some((i) => i.key === 'NIFTY50' && i.exchange === 'NSE'));
    assert.ok(indices.some((i) => i.key === 'BANKNIFTY' && i.exchange === 'NSE'));
    assert.ok(indices.some((i) => i.key === 'SENSEX' && i.exchange === 'BSE'));

    // 4. Verify zero fabricated symboltokens in reference catalog
    for (const item of MarketSearch.allInstruments()) {
      assert.equal(item.symboltoken, null, `Catalog item ${item.key} must not have a fabricated symboltoken`);
    }
  });

  test('77. Exact vs Ambiguous Instrument Resolution & Broker F&O Mapping (Futures & Options on NFO/BFO)', async () => {
    // 1. Ambiguous query ("RELIANCE" across NSE and BSE)
    const relAll = MarketSearch.search('RELIANCE', { exchange: 'ALL' });
    const ambigRes = MarketSearch.resolveExactOrAmbiguous(relAll, 'RELIANCE', { exchange: 'ALL' });
    assert.equal(ambigRes.status, 'AMBIGUOUS');
    assert.equal(ambigRes.ambiguous, true);
    assert.ok(ambigRes.candidates.length >= 2);

    // 2. Exact trading symbol resolution ("RELIANCE-EQ" on NSE)
    const exactRes = MarketSearch.resolveExactOrAmbiguous(relAll, 'RELIANCE-EQ', { exchange: 'NSE' });
    assert.equal(exactRes.status, 'EXACT');
    assert.equal(exactRes.exactMatch.tradingsymbol, 'RELIANCE-EQ');
    assert.equal(exactRes.exactMatch.exchange, 'NSE');

    // 3. Broker F&O search via /api/instruments/search (Futures + CE/PE Options)
    angelSession.setSessionForTest({ status: 'CONNECTED', accessToken: 'JWT_TOKEN' });
    runtime.setMockSmartAPI({
      SmartAPI: class {
        setAccessToken() {}
        async searchScrip(exchange, query) {
          return {
            status: true,
            data: [
              {
                exchange: 'NFO',
                tradingsymbol: 'NIFTY28NOV24FUT',
                symboltoken: '55001',
                lotsize: '25'
              },
              {
                exchange: 'NFO',
                tradingsymbol: 'NIFTY28NOV2425000CE',
                symboltoken: '55002',
                lotsize: '25'
              },
              {
                exchange: 'NFO',
                tradingsymbol: 'NIFTY28NOV2425000PE',
                symboltoken: '55003',
                lotsize: '25'
              }
            ]
          };
        }
      }
    });

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const client = {
      searchInstruments: (ex, q) => MarketAPI.searchInstruments(ex, q, { baseUrl })
    };

    const fnoDiag = await MarketSearch.searchWithDiagnostics('NIFTY', {
      exchange: 'NFO',
      type: 'ALL',
      apiClient: client
    });
    assert.equal(fnoDiag.ok, true);
    assert.equal(fnoDiag.source, 'ANGEL_ONE_API');
    assert.equal(fnoDiag.results.length, 3);

    const futItem = fnoDiag.results.find((r) => r.tradingsymbol === 'NIFTY28NOV24FUT');
    assert.ok(futItem);
    assert.equal(futItem.type, 'FUTURES');
    assert.equal(futItem.expiry, '28NOV24');
    assert.equal(futItem.symboltoken, '55001');
    assert.equal(futItem.lotSize, 25);

    const ceItem = fnoDiag.results.find((r) => r.tradingsymbol === 'NIFTY28NOV2425000CE');
    assert.ok(ceItem);
    assert.equal(ceItem.type, 'OPTION');
    assert.equal(ceItem.optionType, 'CE');
    assert.equal(ceItem.strikePrice, 25000);
    assert.equal(ceItem.expiry, '28NOV24');
    assert.equal(ceItem.symboltoken, '55002');

    // Verify filter by FUTURES only
    const futOnlyDiag = await MarketSearch.searchWithDiagnostics('NIFTY', {
      exchange: 'NFO',
      type: 'FUTURES',
      apiClient: client
    });
    assert.equal(futOnlyDiag.results.length, 1);
    assert.equal(futOnlyDiag.results[0].tradingsymbol, 'NIFTY28NOV24FUT');

    // Verify filter by OPTION + PE only
    const peOnlyDiag = await MarketSearch.searchWithDiagnostics('NIFTY', {
      exchange: 'NFO',
      type: 'OPTION',
      optionType: 'PE',
      apiClient: client
    });
    assert.equal(peOnlyDiag.results.length, 1);
    assert.equal(peOnlyDiag.results[0].tradingsymbol, 'NIFTY28NOV2425000PE');

    // Verify broker search results were cached in SQLite broker_instruments_cache
    const cached = serverDb.searchCachedBrokerInstruments('NFO', 'NIFTY28NOV24');
    assert.equal(cached.length, 3);
  });

  test('78. Option & Futures Contract Validation: enforces expiry, positive strike price, CE/PE, and NFO/BFO exchange', () => {
    // 1. Valid NFO CE option
    const validCe = MarketSearch.validateContractSelection({
      exchange: 'NFO',
      type: 'OPTION',
      optionType: 'CE',
      strikePrice: 25000,
      expiry: '28NOV2026'
    });
    assert.equal(validCe.valid, true);
    assert.equal(validCe.instrumentType, 'OPTION');

    // 2. Valid BFO PE option
    const validPe = MarketSearch.validateContractSelection({
      exchange: 'BFO',
      type: 'OPTION',
      optionType: 'PE',
      strikePrice: 82000,
      expiry: '28NOV2026'
    });
    assert.equal(validPe.valid, true);

    // 3. Valid NFO Futures contract
    const validFut = MarketSearch.validateContractSelection({
      exchange: 'NFO',
      type: 'FUTURES',
      tradingsymbol: 'NIFTY28NOV26FUT',
      expiry: '28NOV2026'
    });
    assert.equal(validFut.valid, true);
    assert.equal(validFut.instrumentType, 'FUTURES');

    // 4. Reject option with invalid optionType, non-positive strike, or missing/invalid expiry
    const invalidOpt = MarketSearch.validateContractSelection({
      exchange: 'NFO',
      type: 'OPTION',
      optionType: 'CALL_INVALID',
      strikePrice: -100,
      expiry: 'NOT_A_DATE'
    });
    assert.equal(invalidOpt.valid, false);
    assert.equal(invalidOpt.code, 'INVALID_OPTION_CONTRACT');
    assert.equal(invalidOpt.reasons.length, 3);

    // 5. Reject option contract on cash exchange (NSE instead of NFO/BFO)
    const wrongExOpt = MarketSearch.validateContractSelection({
      exchange: 'NSE',
      type: 'OPTION',
      optionType: 'CE',
      strikePrice: 25000,
      expiry: '28NOV2026'
    });
    assert.equal(wrongExOpt.valid, false);
    assert.ok(wrongExOpt.reasons.some((r) => r.includes('NFO or BFO')));

    // 6. Server-side pipeline also supports valid FUTURES and rejects invalid OPTIONS
    assert.doesNotThrow(() =>
      instrumentNormalizer.assertValidOptionContract({
        exchange: 'NFO',
        instrumentType: 'FUTURES',
        tradingsymbol: 'NIFTY28NOV26FUT',
        expiry: '28NOV2026'
      })
    );
  });

  test('79. Selected Instrument Integration with Quote, Historical Candles, Dashboard & AI Analysis (Available vs WAITING/DATA_UNAVAILABLE)', async () => {
    const nowIso = new Date().toISOString();
    angelSession.setSessionForTest({ status: 'CONNECTED', accessToken: 'JWT_TOKEN' });
    runtime.setMockSmartAPI({
      SmartAPI: class {
        setAccessToken() {}
        async searchScrip() {
          return {
            status: true,
            data: [
              {
                exchange: 'NSE',
                tradingsymbol: 'TCS-EQ',
                symboltoken: '11536',
                name: 'Tata Consultancy Services'
              }
            ]
          };
        }
        async marketData() {
          return {
            status: true,
            data: {
              fetched: [
                {
                  exchange: 'NSE',
                  tradingSymbol: 'TCS-EQ',
                  symbolToken: '11536',
                  ltp: 4125.5,
                  open: 4080,
                  high: 4140,
                  low: 4070,
                  close: 4065,
                  tradeVolume: 850000,
                  exchTradeTime: nowIso
                }
              ]
            }
          };
        }
        async getCandleData() {
          const rows = [];
          const nowMs = Date.now();
          for (let i = 0; i < 30; i += 1) {
            const base = 4050 + i * 2.5;
            rows.push([
              new Date(nowMs - (30 - i) * 300000).toISOString(),
              base - 2,
              base + 5,
              base - 4,
              base + 2,
              25000 + i * 500
            ]);
          }
          return { status: true, data: rows };
        }
      }
    });

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    // 1. Search -> Select -> Quote -> Candles -> Snapshot -> Dashboard + AI Analysis
    const searchRes = await MarketAPI.searchInstruments('NSE', 'TCS', { baseUrl });
    assert.equal(searchRes.ok, true);
    const selected = MarketSearch.mapBrokerResultItem(searchRes.results[0], 'NSE');
    assert.equal(selected.symboltoken, '11536');

    const quoteRes = await MarketAPI.quote(selected.exchange, selected.tradingsymbol, selected.tradingsymbol, { baseUrl });
    assert.equal(quoteRes.ok, true);
    const quoteCheck = RealMarketDataService.validateQuote(quoteRes.quote, selected.key, 'ANGEL_ONE');
    assert.equal(quoteCheck.ok, true);

    const candleRes = await MarketAPI.candles(selected.exchange, selected.tradingsymbol, selected.tradingsymbol, {
      baseUrl,
      interval: 'FIVE_MINUTE'
    });
    assert.equal(candleRes.ok, true);
    assert.equal(candleRes.candles.length, 30);

    const snapshot = MarketData.snapshotFromValidatedQuote(selected, quoteCheck, candleRes.candles);
    assert.equal(snapshot.dataReady, true);
    assert.equal(snapshot.price, 4125.5);
    assert.equal(snapshot.indicators.dataQuality, 'FULL_CANDLE_SERIES');

    const analysis = MarketAnalysis.analyze({
      dataReady: true,
      assetType: 'EQUITY',
      trendScore: snapshot.indicators.trendScore,
      momentumScore: snapshot.indicators.momentumScore,
      volumeScore: snapshot.indicators.volumeScore,
      vwapScore: snapshot.indicators.vwapScore,
      supportResistanceScore: snapshot.indicators.supportResistanceScore,
      volatilityScore: snapshot.indicators.volatilityScore
    });

    const dashVm = DashboardEngine.buildDashboardViewModel({
      snapshot,
      instrument: selected,
      analysis
    });
    assert.equal(dashVm.sections.selectedInstrument.name, 'Tata Consultancy Services');
    assert.equal(dashVm.sections.priceAndChange.priceFormatted, '₹4,125.50');
    assert.equal(dashVm.sections.marketStatus.code, 'LIVE_DATA');

    // 2. When broker is disconnected -> clear WAITING / DATA_UNAVAILABLE state without fake prices
    angelSession.clearSession();
    const offlineQuote = await MarketAPI.quote('NSE', 'TCS-EQ', 'TCS-EQ', { baseUrl });
    assert.equal(offlineQuote.ok, false);
    const offlineCheck = RealMarketDataService.validateQuote(offlineQuote.quote, 'TCS', 'ANGEL_ONE');
    const waitingSnap = MarketData.snapshotFromValidatedQuote(selected, offlineCheck, []);
    assert.equal(waitingSnap.dataReady, false);
    assert.equal(waitingSnap.price, null);
    assert.equal(waitingSnap.indicators.dataQuality, 'DATA_UNAVAILABLE');
  });

  test('80. Watchlist & Recent Searches Multi-User Isolation, CSRF Protection & Persistence E2E', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // Register User A and User B
    const regA = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Search User A',
        email: 'search.a@example.com',
        password: 'SearchPassword123'
      })
    });
    const cookieA = regA.headers['set-cookie'][0].split(';')[0];
    const csrfA = regA.json.csrfToken;
    const userIdA = regA.json.user.userId;

    const regB = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Search User B',
        email: 'search.b@example.com',
        password: 'SearchPassword123'
      })
    });
    const cookieB = regB.headers['set-cookie'][0].split(';')[0];
    const csrfB = regB.json.csrfToken;

    // 1. User A adds RELIANCE and NIFTY 50 to Watchlist and records a recent search
    const addWlA = await requestServer(server, '/api/watchlist/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        key: 'RELIANCE',
        name: 'RELIANCE',
        tradingsymbol: 'RELIANCE-EQ',
        exchange: 'NSE',
        type: 'EQUITY',
        symboltoken: '2885'
      })
    });
    assert.equal(addWlA.status, 200);
    assert.equal(addWlA.json.watchlist.length, 1);
    assert.equal(addWlA.json.watchlist[0].symboltoken, '2885');
    const wlIdA = addWlA.json.watchlist[0].id;

    const recA = await requestServer(server, '/api/search/recent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        key: 'TCS',
        name: 'TCS',
        tradingsymbol: 'TCS-EQ',
        exchange: 'NSE',
        type: 'EQUITY',
        queryText: 'TCS'
      })
    });
    assert.equal(recA.status, 200);
    assert.equal(recA.json.recent.length, 1);

    // 2. User B's watchlist and recent searches must be completely empty
    const getWlB = await requestServer(server, '/api/watchlist', {
      headers: { Cookie: cookieB }
    });
    assert.equal(getWlB.status, 200);
    assert.equal(getWlB.json.watchlist.length, 0);

    const getRecB = await requestServer(server, '/api/search/recent', {
      headers: { Cookie: cookieB }
    });
    assert.equal(getRecB.status, 200);
    assert.equal(getRecB.json.recent.length, 0);

    // 3. Cross-user query or removal attempt by User B -> 403 FORBIDDEN_OWNERSHIP
    const crossWlRead = await requestServer(
      server,
      `/api/watchlist?userId=${encodeURIComponent(userIdA)}`,
      { headers: { Cookie: cookieB } }
    );
    assert.equal(crossWlRead.status, 403);
    assert.equal(crossWlRead.json.code, 'FORBIDDEN_OWNERSHIP');

    const crossWlRemove = await requestServer(server, '/api/watchlist/remove', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieB,
        'X-CSRF-Token': csrfB
      },
      body: JSON.stringify({ id: wlIdA })
    });
    assert.equal(crossWlRemove.status, 403);
    assert.equal(crossWlRemove.json.code, 'FORBIDDEN_OWNERSHIP');

    // 4. User A removes their own watchlist item and clears recent searches
    const rmWlA = await requestServer(server, '/api/watchlist/remove', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({ id: wlIdA })
    });
    assert.equal(rmWlA.status, 200);
    assert.equal(rmWlA.json.watchlist.length, 0);

    const clearRecA = await requestServer(server, '/api/search/recent/clear', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({})
    });
    assert.equal(clearRecA.status, 200);
    assert.equal(clearRecA.json.recent.length, 0);
  });

  test('81. Market Search Network Failure, Retry & DOM Structure Verification', async () => {
    // 1. Network failure handling in searchWithDiagnostics falls back gracefully and reports apiError
    const failingClient = {
      searchInstruments: async () => {
        const err = new Error('Socket hang up');
        err.code = 'API_UNREACHABLE';
        throw err;
      }
    };

    const failedDiag = await MarketSearch.searchWithDiagnostics('SBIN', {
      exchange: 'NSE',
      type: 'EQUITY',
      apiClient: failingClient
    });
    assert.equal(failedDiag.ok, false);
    assert.equal(failedDiag.code, 'API_UNREACHABLE');
    assert.ok(failedDiag.apiError);
    assert.ok(failedDiag.results.length >= 1); // Reference catalog fallback still available

    // 2. Verify all Task 4 Market Search DOM elements exist in web/index.html
    const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
    const requiredSearchIds = [
      'scannerSearchForm',
      'scannerSearchInput',
      'scannerExchangeFilters',
      'scannerTypeFilters',
      'scannerOptionSideFilters',
      'scannerSearchResultsList',
      'scannerLoadingBanner',
      'scannerErrorBanner',
      'scannerAmbiguousBanner',
      'scannerInstName',
      'scannerInstToken',
      'scannerInstMeta',
      'scannerContractValidation',
      'scannerInstPrice',
      'scannerCandlesStatus',
      'scannerOptionCheckForm',
      'scannerWatchlistContainer',
      'scannerRecentSearchesContainer'
    ];
    for (const id of requiredSearchIds) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Market Search element id="${id}"`
      );
    }
  });

  /* =====================================================
     TASK 5 — COMPLETE CHARTS & TECHNICAL INDICATORS SUITE (TESTS 82–87)
  ===================================================== */

  const ChartEngine = require('../web/modules/chart-engine');

  function buildSampleCandles(count = 60, startPrice = 25000) {
    const candles = [];
    const baseMs = Date.parse('2026-10-08T09:15:00.000Z');
    for (let i = 0; i < count; i += 1) {
      const open = Number((startPrice + i * 3.5 + (i % 3 === 0 ? -4 : 2)).toFixed(2));
      const close = Number((open + (i % 2 === 0 ? 8.5 : -3.2)).toFixed(2));
      const high = Number((Math.max(open, close) + 6.0).toFixed(2));
      const low = Number((Math.min(open, close) - 5.0).toFixed(2));
      const volume = 50000 + i * 1200;
      candles.push({
        timestamp: new Date(baseMs + i * 300000).toISOString(),
        open,
        high,
        low,
        close,
        volume
      });
    }
    return candles;
  }

  test('82. All 8 Backend Timeframes Normalization, Switching & API Integration', async () => {
    const expectedIntervals = [
      ['1m', 'ONE_MINUTE'],
      ['3m', 'THREE_MINUTE'],
      ['5m', 'FIVE_MINUTE'],
      ['10m', 'TEN_MINUTE'],
      ['15m', 'FIFTEEN_MINUTE'],
      ['30m', 'THIRTY_MINUTE'],
      ['1h', 'ONE_HOUR'],
      ['1d', 'ONE_DAY']
    ];

    assert.equal(ChartEngine.SUPPORTED_INTERVALS.length, 8);

    for (const [alias, canonical] of expectedIntervals) {
      assert.equal(ChartEngine.normalizeInterval(alias), canonical);
      assert.equal(ChartEngine.normalizeInterval(canonical), canonical);
      assert.equal(angelMarketData.normalizeCandleInterval(alias), canonical);
      assert.equal(angelMarketData.normalizeCandleInterval(canonical), canonical);
    }

    // Verify API endpoint GET /api/market/candles accepts all 8 intervals when session is connected
    process.env.ANGEL_API_KEY = 'test_key';
    angelSession.setSessionForTest({
      status: 'CONNECTED',
      accessToken: 'jwt_token'
    });

    const requestedIntervals = [];
    runtime.setMockSmartAPI({
      SmartAPI: class {
        setAccessToken() {}
        async searchScrip() {
          return {
            status: true,
            data: [
              {
                exchange: 'NSE',
                tradingsymbol: 'RELIANCE-EQ',
                symboltoken: '2885',
                name: 'Reliance Industries'
              }
            ]
          };
        }
        async getCandleData(params) {
          requestedIntervals.push(params.interval);
          return {
            status: true,
            data: [
              ['2026-10-08T09:15:00.000Z', 2950, 2965, 2945, 2960, 120000],
              ['2026-10-08T09:20:00.000Z', 2960, 2975, 2955, 2970, 145000]
            ]
          };
        }
      }
    });

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    for (const [, canonical] of expectedIntervals) {
      const res = await MarketAPI.candles('NSE', 'RELIANCE-EQ', 'RELIANCE-EQ', {
        baseUrl,
        interval: canonical
      });
      assert.equal(res.ok, true);
      assert.equal(res.interval, canonical);
      assert.equal(res.candles.length, 2);
    }

    assert.deepEqual(
      requestedIntervals,
      expectedIntervals.map(([, c]) => c)
    );
  });

  test('83. Candle Mapping, Sanitization & Rejection of Invalid/Corrupt OHLCV Rows', () => {
    const rawCandles = [
      {
        timestamp: '2026-10-08T09:15:00.000Z',
        open: 25000,
        high: 25080,
        low: 24980,
        close: 25050,
        volume: 150000
      },
      // Invalid: high < low
      {
        timestamp: '2026-10-08T09:20:00.000Z',
        open: 25050,
        high: 24900,
        low: 25000,
        close: 25020,
        volume: 100000
      },
      // Invalid: negative or zero price
      {
        timestamp: '2026-10-08T09:25:00.000Z',
        open: 0,
        high: 25100,
        low: 25000,
        close: 25050,
        volume: 80000
      },
      // Invalid: missing timestamp
      {
        open: 25050,
        high: 25100,
        low: 25000,
        close: 25080,
        volume: 90000
      },
      // Valid bearish candle
      {
        timestamp: '2026-10-08T09:30:00.000Z',
        open: 25060,
        high: 25090,
        low: 24990,
        close: 25010,
        volume: 175000
      }
    ];

    const sanitized = ChartEngine.sanitizeCandles(rawCandles);
    assert.equal(sanitized.length, 2);
    assert.equal(sanitized[0].bullish, true);
    assert.equal(sanitized[0].open, 25000);
    assert.equal(sanitized[0].close, 25050);
    assert.equal(sanitized[1].bullish, false);
    assert.equal(sanitized[1].open, 25060);
    assert.equal(sanitized[1].close, 25010);
  });

  test('84. Complete 12 Technical Indicators & Aligned Series Calculation on Validated Candles', () => {
    const candles = buildSampleCandles(60, 25000);
    const series = MarketData.calculateIndicatorSeries(candles);

    assert.equal(series.candleCount, 60);
    assert.equal(series.ema9.length, 60);
    assert.equal(series.ema21.length, 60);
    assert.equal(series.sma20.length, 60);
    assert.equal(series.sma50.length, 60);
    assert.equal(series.vwap.length, 60);
    assert.equal(series.bollingerBands.length, 60);
    assert.equal(series.rsi14.length, 60);
    assert.equal(series.macd.length, 60);
    assert.equal(series.atr14.length, 60);
    assert.equal(series.adx14.length, 60);

    // Warmup periods must be null before period length and numeric once period is reached
    assert.equal(series.ema9[7], null);
    assert.equal(typeof series.ema9[8], 'number');
    assert.equal(series.ema21[19], null);
    assert.equal(typeof series.ema21[20], 'number');
    assert.equal(series.sma20[18], null);
    assert.equal(typeof series.sma20[19], 'number');
    assert.equal(series.sma50[48], null);
    assert.equal(typeof series.sma50[49], 'number');
    assert.equal(typeof series.vwap[0], 'number');
    assert.equal(series.bollingerBands[18], null);
    assert.equal(typeof series.bollingerBands[19].upper, 'number');
    assert.equal(typeof series.bollingerBands[19].middle, 'number');
    assert.equal(typeof series.bollingerBands[19].lower, 'number');
    assert.equal(series.rsi14[13], null);
    assert.equal(typeof series.rsi14[14], 'number');
    assert.equal(series.macd[24], null);
    assert.equal(typeof series.macd[25].macd, 'number');
    assert.equal(typeof series.macd[25].signal, 'number');
    assert.equal(typeof series.macd[25].histogram, 'number');
    assert.equal(typeof series.atr14[14], 'number');
    assert.equal(typeof series.adx14[14], 'number');

    const last = candles[candles.length - 1];
    const snapshot = MarketData.snapshotFromValidatedQuote(
      { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
      {
        ok: true,
        dataReady: true,
        quote: {
          price: last.close,
          open: candles[0].open,
          high: Math.max(...candles.map((c) => c.high)),
          low: Math.min(...candles.map((c) => c.low)),
          previousClose: candles[0].open - 20,
          volume: 2500000,
          timestamp: new Date().toISOString()
        }
      },
      candles
    );

    const chartVm = ChartEngine.buildChartViewModel({
      interval: 'FIVE_MINUTE',
      snapshot,
      candles
    });

    assert.equal(chartVm.status, 'READY');
    assert.equal(chartVm.totalCandles, 60);
    assert.equal(chartVm.indicatorDiagnostics.ema9Ready, true);
    assert.equal(chartVm.indicatorDiagnostics.ema21Ready, true);
    assert.equal(chartVm.indicatorDiagnostics.sma20Ready, true);
    assert.equal(chartVm.indicatorDiagnostics.sma50Ready, true);
    assert.equal(chartVm.indicatorDiagnostics.vwapReady, true);
    assert.equal(chartVm.indicatorDiagnostics.rsi14Ready, true);
    assert.equal(chartVm.indicatorDiagnostics.macdReady, true);
    assert.equal(chartVm.indicatorDiagnostics.atr14Ready, true);
    assert.equal(chartVm.indicatorDiagnostics.bollingerReady, true);
    assert.equal(chartVm.indicatorDiagnostics.adx14Ready, true);
    assert.notEqual(chartVm.indicatorsSummary.ema9Formatted, '--');
    assert.notEqual(chartVm.indicatorsSummary.sma50Formatted, 'INSUFFICIENT (<50)');
    assert.notEqual(chartVm.indicatorsSummary.bollingerFormatted, 'INSUFFICIENT (<20)');
    assert.ok(['NONE', 'BULLISH_BREAKOUT', 'BEARISH_BREAKDOWN'].includes(chartVm.indicatorsSummary.breakout));
    assert.ok(
      ['BULLISH_TREND', 'BEARISH_TREND', 'RANGEBOUND', 'HIGH_VOLATILITY'].includes(
        chartVm.indicatorsSummary.marketRegime
      )
    );
  });

  test('85. Insufficient Candle History & Unavailable Data Handling (Zero Fake Indicators)', () => {
    // 1. Only 5 candles supplied -> long-period indicators must explicitly report INSUFFICIENT, never fake numbers
    const shortCandles = buildSampleCandles(5, 25000);
    const shortVm = ChartEngine.buildChartViewModel({
      interval: 'FIVE_MINUTE',
      candles: shortCandles
    });

    assert.equal(shortVm.status, 'READY');
    assert.equal(shortVm.totalCandles, 5);
    assert.equal(shortVm.indicatorDiagnostics.ema9Ready, false);
    assert.equal(shortVm.indicatorDiagnostics.sma20Ready, false);
    assert.equal(shortVm.indicatorDiagnostics.sma50Ready, false);
    assert.equal(shortVm.indicatorDiagnostics.rsi14Ready, false);
    assert.equal(shortVm.indicatorDiagnostics.macdReady, false);
    assert.equal(shortVm.indicatorsSummary.ema9, null);
    assert.equal(shortVm.indicatorsSummary.sma20, null);
    assert.equal(shortVm.indicatorsSummary.sma50, null);
    assert.equal(shortVm.indicatorsSummary.rsi14, null);
    assert.equal(shortVm.indicatorsSummary.macd, null);
    assert.equal(shortVm.indicatorsSummary.ema9Formatted, 'INSUFFICIENT (<9)');
    assert.equal(shortVm.indicatorsSummary.sma50Formatted, 'INSUFFICIENT (<50)');
    assert.equal(shortVm.indicatorsSummary.macdFormatted, 'INSUFFICIENT (<26)');

    // 2. Zero candles & no quote -> DATA_UNAVAILABLE state, zero fake candles or indicators
    const emptyVm = ChartEngine.buildChartViewModel({
      interval: 'FIFTEEN_MINUTE',
      candles: [],
      snapshot: null
    });
    assert.equal(emptyVm.status, 'DATA_UNAVAILABLE');
    assert.equal(emptyVm.totalCandles, 0);
    assert.equal(emptyVm.indicatorsSummary.available, false);
    assert.equal(emptyVm.indicatorsSummary.ema9Formatted, '--');
    assert.equal(emptyVm.inspectedCandle, null);
  });

  test('86. Chart Overlays (Validated Quote, Strategy Entry/SL/Target, Open Paper Position) & Viewport Zoom/Pan/Hover', () => {
    const candles = buildSampleCandles(50, 25000);
    const last = candles[candles.length - 1];

    const snapshot = MarketData.snapshotFromValidatedQuote(
      { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
      {
        ok: true,
        dataReady: true,
        quote: {
          price: last.close,
          open: candles[0].open,
          high: last.high + 20,
          low: candles[0].low - 10,
          previousClose: candles[0].open - 15,
          volume: 980000,
          timestamp: new Date().toISOString()
        }
      },
      candles
    );

    const strategy = {
      action: 'BUY',
      entry: 25150,
      stopLoss: 25020,
      target: 25410,
      confidence: 82
    };

    const paperState = {
      position: {
        status: 'OPEN',
        symbol: 'NIFTY 50',
        direction: 'BUY',
        entry: 25140,
        current: last.close,
        stop: 25020,
        target: 25410,
        qty: 1,
        effectiveQty: 1
      }
    };

    const chartVm = ChartEngine.buildChartViewModel({
      interval: 'FIFTEEN_MINUTE',
      snapshot,
      instrument: { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
      candles,
      strategy,
      paperState,
      visibleCount: 20,
      panOffset: 5,
      hoverIndex: 30
    });

    // Verify overlays
    assert.equal(chartVm.overlays.currentPrice, last.close);
    assert.equal(chartVm.overlays.strategyEntry, 25150);
    assert.equal(chartVm.overlays.stopLoss, 25020);
    assert.equal(chartVm.overlays.target, 25410);
    assert.equal(chartVm.overlays.paperPositionEntry, 25140);
    assert.equal(chartVm.overlays.paperPositionSide, 'BUY');
    assert.equal(typeof chartVm.overlays.support, 'number');
    assert.equal(typeof chartVm.overlays.resistance, 'number');

    // Verify Zoom & Pan window
    assert.equal(chartVm.viewport.visibleCount, 20);
    assert.equal(chartVm.viewport.panOffset, 5);
    assert.equal(chartVm.viewport.endIndex, 45);
    assert.equal(chartVm.viewport.startIndex, 25);
    assert.equal(chartVm.viewport.visibleCandles.length, 20);

    // Verify Crosshair / Hover inspection on candle #30
    assert.ok(chartVm.inspectedCandle);
    assert.equal(chartVm.inspectedCandle.index, 30);
    assert.equal(chartVm.inspectedCandle.open, candles[30].open);
    assert.equal(chartVm.inspectedCandle.close, candles[30].close);
    assert.equal(typeof chartVm.inspectedCandle.ema9, 'number');
    assert.equal(typeof chartVm.inspectedCandle.ema21, 'number');
    assert.equal(typeof chartVm.inspectedCandle.vwap, 'number');
    assert.equal(typeof chartVm.inspectedCandle.rsi14, 'number');
  });

  test('87. Indicator Integration with MarketAnalysis, StrategyEngine & DOM Verification', () => {
    const candles = buildSampleCandles(45, 25000);
    const last = candles[candles.length - 1];

    const snapshot = MarketData.snapshotFromValidatedQuote(
      { key: 'RELIANCE', name: 'RELIANCE', exchange: 'NSE', type: 'EQUITY' },
      {
        ok: true,
        dataReady: true,
        quote: {
          price: last.close,
          open: candles[0].open,
          high: Math.max(...candles.map((c) => c.high)),
          low: Math.min(...candles.map((c) => c.low)),
          previousClose: candles[0].open - 35,
          volume: 1400000,
          timestamp: new Date().toISOString()
        }
      },
      candles
    );

    const analysis = MarketAnalysis.analyze({
      dataReady: snapshot.dataReady,
      assetType: 'EQUITY',
      trendScore: snapshot.indicators.trendScore,
      momentumScore: snapshot.indicators.momentumScore,
      volumeScore: snapshot.indicators.volumeScore,
      vwapScore: snapshot.indicators.vwapScore,
      supportResistanceScore: snapshot.indicators.supportResistanceScore,
      volatilityScore: snapshot.indicators.volatilityScore
    });

    assert.equal(analysis.dataReady, true);
    assert.ok(typeof analysis.confidence === 'number');

    const strategy = StrategyEngine.evaluate({
      dataReady: true,
      analysis,
      price: snapshot.price,
      assetType: 'EQUITY',
      emergencyStop: false
    });
    assert.ok(['BUY', 'SELL', 'HOLD', 'NO_TRADE'].includes(strategy.action));

    // Verify all Task 5 Chart & Indicator DOM elements exist in web/index.html
    const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
    const requiredChartIds = [
      'timeframe',
      'chartTimeframePills',
      'chartPanLeftBtn',
      'chartZoomInBtn',
      'chartZoomOutBtn',
      'chartPanRightBtn',
      'chartResetViewBtn',
      'chartSubchartSelect',
      'chartCrosshairBar',
      'chartHoverTime',
      'chartHoverOpen',
      'chartHoverHigh',
      'chartHoverLow',
      'chartHoverClose',
      'chartHoverVolume',
      'candlestickChartContainer',
      'dashIndEma',
      'dashIndSma20',
      'dashIndVwap',
      'dashIndRsi',
      'dashIndMacd',
      'dashIndBollinger',
      'dashIndAtrAdx',
      'dashIndSr',
      'dashIndBreakout',
      'dashIndRegime'
    ];

    for (const id of requiredChartIds) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Task 5 Chart element id="${id}"`
      );
    }
  });

  /* =====================================================
     TASK 6 — COMPLETE AI ANALYSIS UI SUITE (TESTS 88–93)
  ===================================================== */

  const AIAnalysisEngine = require('../web/modules/ai-analysis-engine');
  const googleAIService = require('../server/google-ai-service');

  test('88. AIAnalysisEngine — Missing / Stale Market Data Protection & Zero Fabrication', () => {
    // 1. Missing / Waiting snapshot -> NO_TRADE, unvalidated confidence, no entry/SL/target
    const waitingSnap = MarketData.emptySnapshot({
      key: 'RELIANCE',
      name: 'RELIANCE',
      exchange: 'NSE',
      type: 'EQUITY'
    });

    const vmWaiting = AIAnalysisEngine.buildAIAnalysisViewModel({
      snapshot: waitingSnap,
      instrument: { key: 'RELIANCE', name: 'RELIANCE', exchange: 'NSE', type: 'EQUITY' },
      interval: 'FIVE_MINUTE'
    });

    assert.equal(vmWaiting.quoteAndFreshness.dataReady, false);
    assert.equal(vmWaiting.decision.displayDecision, 'NO_TRADE');
    assert.equal(vmWaiting.decision.confidenceValidated, false);
    assert.equal(vmWaiting.decision.confidence, null);
    assert.equal(vmWaiting.decision.confidenceFormatted, '-- (UNVALIDATED)');
    assert.equal(vmWaiting.tradeLevels.valid, false);
    assert.equal(vmWaiting.tradeLevels.entry, null);
    assert.equal(vmWaiting.tradeLevels.stopLoss, null);
    assert.equal(vmWaiting.tradeLevels.target, null);
    assert.equal(vmWaiting.tradeLevels.riskRewardRatio, null);
    assert.equal(vmWaiting.safetyGate.allowed, false);
    assert.equal(vmWaiting.safetyGate.status, 'BLOCKED');
    assert.equal(vmWaiting.paperExecution.canStageToPaper, false);

    // Payload builder rejects unvalidated snapshot
    const payloadAttempt = AIAnalysisEngine.buildAIAnalysisPayload(waitingSnap, {
      name: 'RELIANCE',
      exchange: 'NSE'
    });
    assert.equal(payloadAttempt.ok, false);
    assert.equal(payloadAttempt.code, 'MARKET_DATA_NOT_READY');

    // 2. Stale quote (>5 minutes old) -> blocked & STALE DATA badge
    const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const staleSnap = {
      ...waitingSnap,
      dataReady: true,
      price: 2950,
      previousClose: 2920,
      timestamp: staleIso
    };

    const vmStale = AIAnalysisEngine.buildAIAnalysisViewModel({
      snapshot: staleSnap,
      instrument: { key: 'RELIANCE', name: 'RELIANCE', exchange: 'NSE', type: 'EQUITY' },
      interval: 'FIFTEEN_MINUTE'
    });

    assert.equal(vmStale.quoteAndFreshness.isStale, true);
    assert.equal(vmStale.quoteAndFreshness.dataReady, false);
    assert.equal(vmStale.quoteAndFreshness.freshnessBadge, 'STALE DATA');
    assert.equal(vmStale.decision.displayDecision, 'NO_TRADE');
    assert.equal(vmStale.decision.confidenceValidated, false);
    assert.equal(vmStale.safetyGate.allowed, false);
    assert.equal(vmStale.paperExecution.canStageToPaper, false);
  });

  test('89. AIAnalysisEngine — Validated Market Data, Technical Summary, Entry/SL/Target & R:R Calculation', () => {
    const candles = buildSampleCandles(55, 25000);
    const last = candles[candles.length - 1];
    const snapshot = MarketData.snapshotFromValidatedQuote(
      { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
      {
        ok: true,
        dataReady: true,
        quote: {
          price: last.close,
          open: candles[0].open,
          high: Math.max(...candles.map((c) => c.high)),
          low: Math.min(...candles.map((c) => c.low)),
          previousClose: candles[0].open - 40,
          volume: 2200000,
          timestamp: new Date().toISOString()
        }
      },
      candles
    );

    const validAIDecision = AIDecisionContract.validate({
      signal: 'BUY',
      confidence: 84,
      risk: 'LOW',
      trend: 'BULLISH',
      reasoning: 'Bullish EMA alignment with positive MACD momentum and institutional volume.',
      stopLossSuggestion: Number((last.close - 80).toFixed(2)),
      targetSuggestion: Number((last.close + 160).toFixed(2))
    }).decision;

    const vm = AIAnalysisEngine.buildAIAnalysisViewModel({
      snapshot,
      instrument: { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX', symboltoken: '99926000' },
      candles,
      interval: 'FIFTEEN_MINUTE',
      aiDecision: validAIDecision,
      googleAIConfigured: true,
      aiStatus: {
        provider: 'GOOGLE_GENAI',
        model: 'gemini-3.8-flash',
        credentialsConfigured: true,
        mode: 'SERVER_ONLY'
      },
      paperState: {
        dailyPnl: 0,
        tradesToday: 0,
        maxTradesPerDay: 3,
        position: null
      }
    });

    assert.equal(vm.instrument.name, 'NIFTY 50');
    assert.equal(vm.instrument.exchange, 'NSE');
    assert.equal(vm.timeframe.id, 'FIFTEEN_MINUTE');
    assert.equal(vm.timeframe.candlesCount, 55);
    assert.equal(vm.quoteAndFreshness.dataReady, true);
    assert.equal(vm.decision.displayDecision, 'BUY');
    assert.equal(vm.decision.rawSignal, 'BUY');
    assert.equal(vm.decision.confidenceValidated, true);
    assert.equal(vm.decision.confidence, 84);
    assert.equal(vm.decision.confidenceFormatted, '84%');
    assert.equal(vm.decision.trend, 'BULLISH');
    assert.equal(vm.decision.risk, 'LOW');

    // Trade levels & R:R validated
    assert.equal(vm.tradeLevels.valid, true);
    assert.equal(vm.tradeLevels.entry, last.close);
    assert.equal(vm.tradeLevels.stopLoss, Number((last.close - 80).toFixed(2)));
    assert.equal(vm.tradeLevels.target, Number((last.close + 160).toFixed(2)));
    assert.equal(vm.tradeLevels.riskRewardRatio, 2);
    assert.equal(vm.tradeLevels.riskRewardFormatted, '1 : 2.00');

    // Technical indicators summary populated
    assert.equal(vm.technicalSummary.available, true);
    assert.notEqual(vm.technicalSummary.ema9Formatted, '--');
    assert.notEqual(vm.technicalSummary.sma50Formatted, '--');
    assert.notEqual(vm.technicalSummary.rsi14Formatted, '--');
    assert.notEqual(vm.technicalSummary.bollingerFormatted, '--');

    // Safety Gate & Paper Staging approved
    assert.equal(vm.safetyGate.allowed, true);
    assert.equal(vm.safetyGate.status, 'APPROVED');
    assert.equal(vm.paperExecution.canStageToPaper, true);
    assert.equal(vm.paperExecution.tradingMode, 'PAPER');
    assert.equal(vm.paperExecution.liveTradingEnabled, false);
    assert.ok(vm.supportingReasons.some((r) => r.includes('Bullish EMA alignment')));
  });

  test('90. AIAnalysisEngine — Invalid AI Contract Output & High-Risk Safe Fallback to HOLD / NO_TRADE', () => {
    const candles = buildSampleCandles(40, 25000);
    const last = candles[candles.length - 1];
    const snapshot = MarketData.snapshotFromValidatedQuote(
      { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
      {
        ok: true,
        dataReady: true,
        quote: {
          price: last.close,
          open: candles[0].open,
          high: Math.max(...candles.map((c) => c.high)),
          low: Math.min(...candles.map((c) => c.low)),
          previousClose: candles[0].open - 20,
          volume: 1000000,
          timestamp: new Date().toISOString()
        }
      },
      candles
    );

    // Malformed / invalid AI payload
    const vmInvalid = AIAnalysisEngine.buildAIAnalysisViewModel({
      snapshot,
      instrument: { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
      candles,
      aiDecision: { signal: 'GUARANTEED_PROFIT_MOON', confidence: 999, risk: 'NONE' }
    });

    assert.equal(vmInvalid.decision.displayDecision, 'NO_TRADE');
    assert.equal(vmInvalid.decision.confidenceValidated, false);
    assert.equal(vmInvalid.decision.confidence, null);
    assert.equal(vmInvalid.tradeLevels.valid, false);
    assert.equal(vmInvalid.safetyGate.allowed, false);
    assert.equal(vmInvalid.safetyGate.status, 'BLOCKED');
    assert.equal(vmInvalid.providerStatus.stateCode, 'CONTRACT_REJECTED');
    assert.equal(vmInvalid.paperExecution.canStageToPaper, false);
    assert.ok(
      vmInvalid.riskWarnings.some((w) => w.includes('AI Decision Contract rejected'))
    );
  });

  test('91. AIAnalysisEngine — Missing Google AI Credentials & Emergency Stop Enforcement', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const savedKey = process.env.GEMINI_API_KEY;
    const savedAltKey = process.env.GOOGLE_AI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    googleAIService.setMockAIClient(null);

    try {
      const statusRes = await requestServer(server, '/api/ai/status');
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.json.ok, true);
      assert.equal(statusRes.json.credentialsConfigured, false);

      // Calling POST /api/ai/analyze without GEMINI_API_KEY returns explicit GOOGLE_AI_CREDENTIALS_MISSING
      const analyzeRes = await requestServer(server, '/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataReady: true,
          symbol: 'NIFTY 50',
          exchange: 'NSE',
          assetType: 'EQUITY',
          price: 25100
        })
      });
      assert.equal(analyzeRes.status, 400);
      assert.equal(analyzeRes.json.ok, false);
      assert.equal(analyzeRes.json.code, 'GOOGLE_AI_CREDENTIALS_MISSING');

      // ViewModel reflects unconfigured state clearly
      const candles = buildSampleCandles(35, 25000);
      const last = candles[candles.length - 1];
      const snapshot = MarketData.snapshotFromValidatedQuote(
        { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
        {
          ok: true,
          dataReady: true,
          quote: {
            price: last.close,
            open: candles[0].open,
            high: Math.max(...candles.map((c) => c.high)),
            low: Math.min(...candles.map((c) => c.low)),
            previousClose: candles[0].open - 15,
            volume: 900000,
            timestamp: new Date().toISOString()
          }
        },
        candles
      );

      const vmUnconf = AIAnalysisEngine.buildAIAnalysisViewModel({
        snapshot,
        instrument: { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
        googleAIConfigured: false,
        aiStatus: statusRes.json
      });
      assert.equal(vmUnconf.providerStatus.credentialsConfigured, false);
      assert.equal(vmUnconf.providerStatus.badge, 'NOT CONFIGURED');

      // Emergency Stop active -> blocks all decisions and staging
      const vmEmergency = AIAnalysisEngine.buildAIAnalysisViewModel({
        snapshot,
        instrument: { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
        emergencyStop: true
      });
      assert.equal(vmEmergency.decision.displayDecision, 'NO_TRADE');
      assert.equal(vmEmergency.tradeLevels.valid, false);
      assert.equal(vmEmergency.safetyGate.allowed, false);
      assert.equal(vmEmergency.paperExecution.canStageToPaper, false);
      assert.ok(vmEmergency.riskWarnings.some((w) => w.includes('Emergency Stop is ACTIVE')));
    } finally {
      if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
      if (savedAltKey !== undefined) process.env.GOOGLE_AI_API_KEY = savedAltKey;
    }
  });

  test('92. Real POST /api/ai/analyze Integration & Multi-User Persisted History Isolation', async () => {
    serverDb.resetAllTablesForTest();
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // Register User A & User B
    const regA = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'AI Trader Alpha',
        email: 'ai.alpha@example.com',
        password: 'AlphaPass123'
      })
    });
    assert.equal(regA.status, 201);
    const cookieA = regA.headers['set-cookie'][0].split(';')[0];
    const csrfA = regA.json.csrfToken;

    const regB = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'AI Trader Beta',
        email: 'ai.beta@example.com',
        password: 'BetaPass123'
      })
    });
    assert.equal(regB.status, 201);
    const cookieB = regB.headers['set-cookie'][0].split(';')[0];
    const csrfB = regB.json.csrfToken;

    googleAIService.setMockAIClient(async (marketInput) => ({
      signal: 'BUY',
      confidence: 86,
      risk: 'LOW',
      trend: 'BULLISH',
      reasoning: `Validated bullish breakout for ${marketInput.symbol}.`,
      stopLossSuggestion: Number((marketInput.price * 0.995).toFixed(2)),
      targetSuggestion: Number((marketInput.price * 1.01).toFixed(2))
    }));

    try {
      // User A runs AI Analysis on RELIANCE
      const aiResA = await requestServer(server, '/api/ai/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieA,
          'X-CSRF-Token': csrfA
        },
        body: JSON.stringify({
          dataReady: true,
          symbol: 'RELIANCE',
          exchange: 'NSE',
          assetType: 'EQUITY',
          price: 2980
        })
      });
      assert.equal(aiResA.status, 200);
      assert.equal(aiResA.json.ok, true);
      assert.equal(aiResA.json.decision.signal, 'BUY');
      assert.equal(aiResA.json.decision.confidence, 86);

      // User B runs AI Analysis on TCS
      const aiResB = await requestServer(server, '/api/ai/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieB,
          'X-CSRF-Token': csrfB
        },
        body: JSON.stringify({
          dataReady: true,
          symbol: 'TCS',
          exchange: 'NSE',
          assetType: 'EQUITY',
          price: 4120
        })
      });
      assert.equal(aiResB.status, 200);
      assert.equal(aiResB.json.ok, true);

      // Verify User A's persisted AI history only contains RELIANCE
      const logsA = await requestServer(server, '/api/audit/logs', {
        headers: { Cookie: cookieA }
      });
      assert.equal(logsA.status, 200);
      assert.equal(logsA.json.aiDecisions.length, 1);
      assert.equal(logsA.json.aiDecisions[0].symbol, 'RELIANCE');

      // Verify User B's persisted AI history only contains TCS
      const logsB = await requestServer(server, '/api/audit/logs', {
        headers: { Cookie: cookieB }
      });
      assert.equal(logsB.status, 200);
      assert.equal(logsB.json.aiDecisions.length, 1);
      assert.equal(logsB.json.aiDecisions[0].symbol, 'TCS');

      // Cross-user audit log query is forbidden
      const crossLogs = await requestServer(
        server,
        `/api/audit/logs?userId=${encodeURIComponent(regA.json.user.userId)}`,
        { headers: { Cookie: cookieB } }
      );
      assert.equal(crossLogs.status, 403);
    } finally {
      googleAIService.setMockAIClient(null);
    }
  });

  test('93. Task 6 AI Analysis UI DOM Elements & Structural Completeness Verification', () => {
    const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
    const requiredAIElementIds = [
      'analysisPage',
      'analysisPageSignalBadge',
      'aiRunAnalysisBtn',
      'aiRefreshHistoryBtn',
      'aiAnalysisLoadingBanner',
      'aiAnalysisErrorBanner',
      'aiAnalysisConfigBanner',
      'aiInstName',
      'aiInstExchangeMeta',
      'aiQuotePrice',
      'aiQuoteChange',
      'aiTimeframeLabel',
      'aiCandlesLoadedCount',
      'aiFreshnessBadge',
      'aiQuoteTimestamp',
      'aiProviderBadge',
      'aiAnalysisTimestamp',
      'aiDecisionActionPill',
      'aiDecisionDisplay',
      'aiRawSignalDisplay',
      'aiValidatedConfidence',
      'aiTrendAndRegime',
      'aiRiskClassification',
      'aiEntryPrice',
      'aiStopLossPrice',
      'aiTargetPrice',
      'aiRiskRewardRatio',
      'aiUnitRiskReward',
      'aiStageToPaperBtn',
      'aiSafetyStatusPill',
      'aiGateDataReady',
      'aiContractStatus',
      'aiAnalysisSource',
      'aiProviderModelLabel',
      'aiGateConfidence',
      'aiGateRisk',
      'aiGateReasonsText',
      'aiTechQualityBadge',
      'aiIndEma',
      'aiIndSma',
      'aiIndVwap',
      'aiIndRsi',
      'aiIndMacd',
      'aiIndBollinger',
      'aiIndAtrAdx',
      'aiIndSr',
      'aiIndBreakoutRegime',
      'aiCompositeScorePill',
      'compTrend',
      'compMomentum',
      'compVolume',
      'compVwap',
      'compSR',
      'compOptions',
      'aiSupportingReasonsList',
      'aiRiskWarningsList',
      'aiInvalidationList',
      'aiHistoryCountBadge',
      'aiAnalysisHistoryContainer'
    ];

    for (const id of requiredAIElementIds) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Task 6 AI Analysis element id="${id}"`
      );
    }
  });

  /* =====================================================
     TASK 7 — COMPLETE MARKET INTELLIGENCE VERIFICATION (TESTS 94–100)
  ===================================================== */

  test('94. Market Intelligence — Unconfigured Provider State & Zero Fake Data Guarantee', async () => {
    const intelService = require('../server/market-intelligence-service');
    intelService.clearCustomProviderAdapter();
    intelService.clearIntelligenceCache();

    const savedFh = process.env.FINNHUB_API_KEY;
    const savedAv = process.env.ALPHA_VANTAGE_API_KEY;
    const savedRss = process.env.INDIAN_MARKET_RSS_URL;
    delete process.env.FINNHUB_API_KEY;
    delete process.env.ALPHA_VANTAGE_API_KEY;
    delete process.env.INDIAN_MARKET_RSS_URL;

    try {
      server = apiServer.createServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

      const res = await requestServer(server, '/api/intelligence/feed?market=NSE&symbol=RELIANCE');
      assert.equal(res.status, 200);
      assert.equal(res.json.ok, true);
      assert.equal(res.json.intelligence.status, 'DATA_UNAVAILABLE');
      assert.equal(res.json.intelligence.available, false);
      assert.equal(res.json.intelligence.provider, 'UNCONFIGURED');
      assert.equal(res.json.intelligence.indianMarketNews.length, 0);
      assert.equal(res.json.intelligence.globalMarketNews.length, 0);
      assert.equal(res.json.intelligence.companyNews.length, 0);
      assert.equal(res.json.intelligence.economicEvents.length, 0);
      assert.equal(res.json.intelligence.globalIndices.length, 0);
      assert.equal(res.json.intelligence.sentiment.available, false);
      assert.equal(res.json.intelligence.sentiment.label, 'UNAVAILABLE');
      assert.equal(res.json.intelligence.sentiment.score, null);
    } finally {
      if (savedFh !== undefined) process.env.FINNHUB_API_KEY = savedFh;
      if (savedAv !== undefined) process.env.ALPHA_VANTAGE_API_KEY = savedAv;
      if (savedRss !== undefined) process.env.INDIAN_MARKET_RSS_URL = savedRss;
    }
  });

  test('95. Market Intelligence — Field Preservation, Deduplication, Malformed Rejection & Stale Marking', () => {
    const intelService = require('../server/market-intelligence-service');
    const nowMs = Date.now();
    const freshIso = new Date(nowMs - 15 * 60 * 1000).toISOString();
    const staleIso = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString(); // 48 hours old

    const rawItems = [
      // 1. Valid fresh Indian market news
      {
        headline: 'RBI MPC keeps repo rate unchanged at 6.50% with neutral stance',
        source: 'NSE Financial Wire',
        provider: 'FINNHUB',
        publishedAt: freshIso,
        url: 'https://example.com/news/rbi-mpc-rate#section1',
        relatedSymbol: 'NIFTY50',
        category: 'INDIAN_MARKET',
        sentiment: 'BULLISH',
        sentimentScore: 64
      },
      // 2. Duplicate URL (even with different hash fragment) -> must be deduplicated
      {
        headline: 'RBI MPC keeps repo rate unchanged at 6.50% - Duplicate copy',
        source: 'NSE Financial Wire',
        provider: 'FINNHUB',
        publishedAt: freshIso,
        url: 'https://example.com/news/rbi-mpc-rate#section2',
        category: 'INDIAN_MARKET'
      },
      // 3. Duplicate Headline -> must be deduplicated
      {
        headline: 'RBI MPC keeps repo rate unchanged at 6.50% with neutral stance!',
        source: 'Secondary Feed',
        provider: 'ALPHA_VANTAGE',
        publishedAt: freshIso,
        url: 'https://another.example.com/rbi',
        category: 'INDIAN_MARKET'
      },
      // 4. Stale news item -> preserved with freshness="STALE" and isStale=true
      {
        headline: 'Global central banks signal cautious policy path last week',
        source: 'Global Macro Wire',
        provider: 'FINNHUB',
        publishedAt: staleIso,
        url: 'https://example.com/news/global-central-banks',
        category: 'GLOBAL_MARKET'
      },
      // 5. Malformed item (missing headline) -> rejected
      {
        headline: '',
        source: 'Broken Feed'
      },
      // 6. Malformed item (missing source) -> rejected
      {
        headline: 'Orphan headline without any source or provider',
        source: ''
      }
    ];

    const dedup = intelService.deduplicateAndValidateNews(rawItems, {
      nowMs,
      retrievalTimestamp: new Date(nowMs).toISOString(),
      staleThresholdMs: 24 * 60 * 60 * 1000
    });

    assert.equal(dedup.items.length, 2);
    assert.equal(dedup.duplicatesRemoved, 2);
    assert.equal(dedup.malformedRejected, 2);

    const first = dedup.items[0];
    assert.equal(first.headline, 'RBI MPC keeps repo rate unchanged at 6.50% with neutral stance');
    assert.equal(first.source, 'NSE Financial Wire');
    assert.equal(first.provider, 'FINNHUB');
    assert.equal(first.publicationTimestamp, freshIso);
    assert.ok(first.retrievalTimestamp);
    assert.equal(first.url, 'https://example.com/news/rbi-mpc-rate');
    assert.equal(first.relatedSymbol, 'NIFTY50');
    assert.equal(first.freshness, 'FRESH');
    assert.equal(first.isStale, false);

    const second = dedup.items[1];
    assert.equal(second.freshness, 'STALE');
    assert.equal(second.isStale, true);
    assert.equal(second.status, 'STALE');
  });

  test('96. Market Intelligence — Indian News, Global News, Company News, Economic Events, Global Indices & Backed Sentiment via API', async () => {
    const intelService = require('../server/market-intelligence-service');
    intelService.clearIntelligenceCache();
    serverDb.resetAllTablesForTest();

    const nowMs = Date.now();
    const freshIso = new Date(nowMs - 5 * 60 * 1000).toISOString();

    intelService.setCustomProviderAdapter({
      name: 'LICENSED_MARKET_WIRE',
      async fetchIntelligence(query) {
        return {
          indianMarketNews: [
            {
              headline: 'NSE Nifty 50 sees strong institutional inflows in banking and IT',
              source: 'India Market Wire',
              publishedAt: freshIso,
              url: 'https://example.com/india/nifty-inflows',
              relatedSymbol: 'NIFTY50',
              sentiment: 'BULLISH',
              sentimentScore: 72
            }
          ],
          globalMarketNews: [
            {
              headline: 'US Treasury yields stabilize ahead of FOMC minutes',
              source: 'Global Macro Desk',
              publishedAt: freshIso,
              url: 'https://example.com/global/us-yields',
              sentiment: 'NEUTRAL',
              sentimentScore: 10
            }
          ],
          companyNews: [
            {
              headline: 'Reliance Industries expands new energy gigafactory capacity in Jamnagar',
              source: 'Corporate Filing Exchange',
              publishedAt: freshIso,
              url: 'https://example.com/company/reliance-energy',
              relatedSymbol: query.symbol || 'RELIANCE',
              companyName: 'Reliance Industries Ltd',
              sentiment: 'BULLISH',
              sentimentScore: 80
            }
          ],
          economicEvents: [
            {
              title: 'India CPI Inflation YoY',
              country: 'IN',
              impact: 'HIGH',
              actual: '4.85%',
              forecast: '4.90%',
              previous: '5.08%',
              eventTimestamp: freshIso,
              source: 'MOSPI / Economic Calendar',
              url: 'https://example.com/calendar/india-cpi'
            }
          ],
          globalIndices: [
            {
              symbol: 'SPX',
              name: 'S&P 500',
              region: 'US',
              price: 5820.5,
              change: 24.3,
              changePercent: 0.42,
              currency: 'USD',
              timestamp: freshIso,
              source: 'Global Index Feed'
            }
          ]
        };
      }
    });

    try {
      server = apiServer.createServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

      const res = await requestServer(
        server,
        '/api/intelligence/feed?market=NSE&symbol=RELIANCE&category=ALL'
      );
      assert.equal(res.status, 200);
      assert.equal(res.json.ok, true);

      const intel = res.json.intelligence;
      assert.equal(intel.status, 'AVAILABLE');
      assert.equal(intel.available, true);
      assert.equal(intel.indianMarketNews.length, 1);
      assert.equal(intel.globalMarketNews.length, 1);
      assert.equal(intel.companyNews.length, 1);
      assert.equal(intel.economicEvents.length, 1);
      assert.equal(intel.globalIndices.length, 1);

      // Sentiment is backed by genuine provider-scored items
      assert.equal(intel.sentiment.available, true);
      assert.equal(intel.sentiment.label, 'BULLISH');
      assert.equal(intel.sentiment.score, 54); // avg(72, 10, 80) = 54
      assert.ok(intel.sentiment.source.includes('India Market Wire'));

      // Verify single SQLite database cached the validated items
      const cachedRows = serverDb.listCachedMarketIntelligence('ALL', '', 10);
      assert.equal(cachedRows.length, 3);
      const relCached = serverDb.listCachedMarketIntelligence('', 'RELIANCE', 10);
      assert.equal(relCached.length, 1);
      assert.equal(relCached[0].relatedSymbol, 'RELIANCE');
    } finally {
      intelService.clearCustomProviderAdapter();
      intelService.clearIntelligenceCache();
    }
  });

  test('97. Market Intelligence — Bounded Caching, Rate Limiting, Provider Timeout & Secret Non-Exposure', async () => {
    const intelService = require('../server/market-intelligence-service');
    intelService.clearCustomProviderAdapter();
    intelService.clearIntelligenceCache();

    // 1. Secret non-exposure in getSafeIntelligenceStatus & /api/health
    const savedKey = process.env.FINNHUB_API_KEY;
    process.env.FINNHUB_API_KEY = 'SUPER_SECRET_FINNHUB_TOKEN_999';
    try {
      const safeStatus = intelService.getSafeIntelligenceStatus(process.env);
      const serialized = JSON.stringify(safeStatus);
      assert.equal(serialized.includes('SUPER_SECRET_FINNHUB_TOKEN_999'), false);
      assert.equal(safeStatus.configured, true);
      assert.ok(safeStatus.configuredProviders.includes('FINNHUB'));
    } finally {
      if (savedKey === undefined) delete process.env.FINNHUB_API_KEY;
      else process.env.FINNHUB_API_KEY = savedKey;
    }

    // 2. Bounded cache hit vs refresh=true bypass
    let providerCallCount = 0;
    const nowIso = new Date().toISOString();
    intelService.setCustomProviderAdapter({
      name: 'CACHE_TEST_PROVIDER',
      async fetchIntelligence() {
        providerCallCount += 1;
        return {
          indianMarketNews: [
            {
              headline: `Cached Market Update #${providerCallCount}`,
              source: 'Cache Wire',
              publishedAt: nowIso
            }
          ]
        };
      }
    });

    try {
      const firstCall = await intelService.fetchMarketIntelligence({ market: 'NSE', symbol: 'TCS' });
      assert.equal(firstCall.cached, false);
      assert.equal(providerCallCount, 1);

      const secondCall = await intelService.fetchMarketIntelligence({ market: 'NSE', symbol: 'TCS' });
      assert.equal(secondCall.cached, true);
      assert.equal(providerCallCount, 1);

      const forcedRefresh = await intelService.fetchMarketIntelligence({
        market: 'NSE',
        symbol: 'TCS',
        refresh: true
      });
      assert.equal(forcedRefresh.cached, false);
      assert.equal(providerCallCount, 2);

      // 3. Rate limit enforcement (20 requests per window)
      const nowMs = Date.now();
      for (let i = 0; i < 20; i += 1) {
        const rl = intelService.checkRateLimit('RL_PROVIDER', nowMs);
        assert.equal(rl.allowed, true);
      }
      const blocked = intelService.checkRateLimit('RL_PROVIDER', nowMs);
      assert.equal(blocked.allowed, false);
      assert.ok(blocked.retryAfterSec >= 1);
    } finally {
      intelService.clearCustomProviderAdapter();
      intelService.clearIntelligenceCache();
    }
  });

  test('98. Market Intelligence Governance — Supporting Context Only: NEVER Overrides Price Action, Technicals, AISafetyGate, RiskEngine, or Emergency Stop', () => {
    const nowMs = Date.now();
    const freshIso = new Date(nowMs - 5000).toISOString();

    // Create a BEARISH price & technical snapshot on RELIANCE
    const validCheck = RealMarketDataService.validateQuote(
      {
        instrument: 'RELIANCE-EQ',
        exchange: 'NSE',
        price: 2800,
        open: 2900,
        high: 2910,
        low: 2790,
        previousClose: 2920,
        volume: 850000,
        timestamp: freshIso,
        dataReady: true
      },
      'RELIANCE',
      'ANGEL_ONE',
      nowMs
    );
    const bearishSnap = MarketData.snapshotFromValidatedQuote(
      { key: 'RELIANCE', name: 'RELIANCE', exchange: 'NSE', type: 'EQUITY' },
      validCheck
    );

    // Extremely bullish external news & sentiment (+100 score)
    const extremeBullishIntelligence = {
      status: 'AVAILABLE',
      available: true,
      provider: 'FINNHUB',
      source: 'Financial Wire',
      sentiment: {
        available: true,
        status: 'AVAILABLE',
        label: 'BULLISH',
        score: 100,
        source: 'Financial Wire'
      },
      headlines: ['Record-breaking bullish headline for market']
    };

    // 1. Even with +100 newsScore, bearish technicals (-90 across trend/momentum/volume/vwap/SR) MUST remain BEARISH / SELL
    const detAnalysis = MarketAnalysis.analyze({
      dataReady: true,
      assetType: 'EQUITY',
      trendScore: -90,
      momentumScore: -85,
      volumeScore: -80,
      vwapScore: -85,
      supportResistanceScore: -80,
      volatilityScore: 20,
      newsScore: 100 // Max possible positive news score (only 5% weight)
    });
    assert.equal(detAnalysis.trend, 'BEARISH');
    assert.equal(detAnalysis.signal, 'SELL');
    assert.equal(detAnalysis.action, 'SELL');

    // 2. When market data is NOT ready (DATA_WAITING), bullish news NEVER creates a BUY signal
    const noDataVm = AIAnalysisEngine.buildAIAnalysisViewModel({
      snapshot: MarketData.emptySnapshot('RELIANCE'),
      instrument: { key: 'RELIANCE', name: 'RELIANCE', exchange: 'NSE', type: 'EQUITY' },
      marketIntelligence: extremeBullishIntelligence
    });
    assert.equal(noDataVm.decision.displayDecision, 'NO_TRADE');
    assert.equal(noDataVm.safetyGate.allowed, false);
    assert.equal(noDataVm.paperExecution.canStageToPaper, false);

    // 3. When Emergency Stop is active, bullish news + bullish technicals NEVER bypass Emergency Stop
    const emergencyVm = AIAnalysisEngine.buildAIAnalysisViewModel({
      snapshot: bearishSnap,
      instrument: { key: 'RELIANCE', name: 'RELIANCE', exchange: 'NSE', type: 'EQUITY' },
      emergencyStop: true,
      marketIntelligence: extremeBullishIntelligence
    });
    assert.equal(emergencyVm.decision.displayDecision, 'NO_TRADE');
    assert.equal(emergencyVm.safetyGate.allowed, false);
    assert.equal(emergencyVm.paperExecution.canStageToPaper, false);
  });

  test('99. MarketIntelligence.buildIntelligenceViewModel — Category Filtering & Unverified Sentiment Suppression', () => {
    const nowIso = new Date().toISOString();
    const payload = {
      status: 'AVAILABLE',
      available: true,
      provider: 'FINNHUB',
      retrievalTimestamp: nowIso,
      indianMarketNews: [
        {
          itemId: 'N1',
          category: 'INDIAN_MARKET',
          headline: 'Nifty 50 closes higher',
          source: 'NSE Wire',
          provider: 'FINNHUB',
          publicationTimestamp: nowIso,
          retrievalTimestamp: nowIso,
          freshness: 'FRESH'
        }
      ],
      globalMarketNews: [
        {
          itemId: 'N2',
          category: 'GLOBAL_MARKET',
          headline: 'ECB leaves rates unchanged',
          source: 'Global Wire',
          provider: 'FINNHUB',
          publicationTimestamp: nowIso,
          retrievalTimestamp: nowIso,
          freshness: 'FRESH'
        }
      ],
      companyNews: [
        {
          itemId: 'N3',
          category: 'COMPANY_NEWS',
          headline: 'TCS wins cloud transformation deal',
          relatedSymbol: 'TCS',
          source: 'Company Wire',
          provider: 'FINNHUB',
          publicationTimestamp: nowIso,
          retrievalTimestamp: nowIso,
          freshness: 'FRESH'
        }
      ],
      economicEvents: [],
      globalIndices: [],
      sentiment: {
        available: false,
        status: 'UNAVAILABLE',
        label: 'UNAVAILABLE',
        score: null,
        source: null,
        reason: 'No verified sentiment score from provider.'
      }
    };

    const allVm = MarketIntelligence.buildIntelligenceViewModel(payload, {
      category: 'ALL',
      symbol: 'TCS',
      exchange: 'NSE'
    });
    assert.equal(allVm.counts.totalNews, 3);
    assert.equal(allVm.filteredNews.length, 3);
    assert.equal(allVm.sentiment.available, false);
    assert.equal(allVm.sentiment.label, 'UNAVAILABLE');
    assert.equal(allVm.sentiment.scoreFormatted, '-- (UNVERIFIED)');

    const companyVm = MarketIntelligence.buildIntelligenceViewModel(payload, {
      category: 'COMPANY_NEWS',
      symbol: 'TCS',
      exchange: 'NSE'
    });
    assert.equal(companyVm.filteredNews.length, 1);
    assert.equal(companyVm.filteredNews[0].relatedSymbol, 'TCS');
  });

  test('100. Task 7 Market Intelligence UI DOM Elements & Structural Completeness Verification', () => {
    const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
    const requiredIntelIds = [
      'intelligencePage',
      'intelHeroStatusBadge',
      'intelRefreshBtn',
      'intelLoadingBanner',
      'intelErrorBanner',
      'intelRetryBtn',
      'intelConfigBanner',
      'intelProviderBadge',
      'intelRetrievalTimestamp',
      'intelSelectedSymbol',
      'intelSelectedExchange',
      'intelSentimentLabel',
      'intelSentimentMeta',
      'intelValidatedCountBadge',
      'intelDedupDiagnostics',
      'intelCategoryFilters',
      'intelGlobalIndicesCountPill',
      'intelGlobalIndicesContainer',
      'intelEconomicEventsCountPill',
      'intelEconomicEventsContainer',
      'intelIndianNewsCountPill',
      'intelIndianNewsContainer',
      'intelGlobalNewsCountPill',
      'intelGlobalNewsContainer',
      'intelCompanyNewsCountPill',
      'intelCompanyNewsContainer'
    ];

    for (const id of requiredIntelIds) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Task 7 Market Intelligence element id="${id}"`
      );
    }
  });

  /* =====================================================
     TASK 8 — COMPLETE STRATEGY ENGINE & SIGNAL GENERATION TESTS
  ===================================================== */

  test('101. Task 8 Deterministic BUY, SELL, HOLD & NO_TRADE Signal Generation with Entry, Mandatory Stop-Loss, Target & Risk/Reward', () => {
    assert.ok(StrategyEngine.DOCUMENTED_STRATEGY_RULES);
    assert.equal(StrategyEngine.DOCUMENTED_STRATEGY_RULES.tradingMode, 'paper');
    assert.equal(StrategyEngine.DOCUMENTED_STRATEGY_RULES.liveTradingEnabled, false);

    // 1. Deterministic BUY signal
    const buyStrat = StrategyEngine.evaluate({
      dataReady: true,
      price: 2000,
      assetType: 'EQUITY',
      indicators: {
        trendScore: 85,
        momentumScore: 80,
        vwap: 1985,
        ema9: 1995,
        ema21: 1980,
        adx14: 32,
        volatilityScore: 25,
        support: 1975,
        resistance: 2040,
        marketRegime: 'BULLISH_TREND',
        dataQuality: 'FULL_CANDLE_SERIES'
      },
      analysis: {
        dataReady: true,
        signal: 'BUY',
        confidence: 86,
        risk: 'LOW'
      }
    });
    assert.equal(buyStrat.action, 'BUY');
    assert.equal(buyStrat.tradeSide, 'BUY');
    assert.equal(buyStrat.executable, true);
    assert.equal(buyStrat.entry, 2000);
    assert.equal(buyStrat.stopLoss, 1990); // 0.5% below 2000
    assert.equal(buyStrat.target, 2020);   // 2.0R above 2000
    assert.equal(buyStrat.unitRisk, 10);
    assert.equal(buyStrat.unitReward, 20);
    assert.equal(buyStrat.riskRewardRatio, 2);
    assert.equal(buyStrat.marketRegime, 'BULLISH_TREND');
    assert.ok(buyStrat.entryConditions.length >= 3);
    assert.ok(buyStrat.invalidationConditions.length >= 3);
    assert.equal(buyStrat.exitRules.length, 5);

    // 2. Deterministic SELL signal
    const sellStrat = StrategyEngine.evaluate({
      dataReady: true,
      price: 1500,
      assetType: 'EQUITY',
      indicators: {
        trendScore: -88,
        momentumScore: -84,
        vwap: 1515,
        ema9: 1502,
        ema21: 1518,
        adx14: 30,
        volatilityScore: 30,
        support: 1470,
        resistance: 1520,
        marketRegime: 'BEARISH_TREND',
        dataQuality: 'FULL_CANDLE_SERIES'
      },
      analysis: {
        dataReady: true,
        signal: 'SELL',
        confidence: 84,
        risk: 'LOW'
      }
    });
    assert.equal(sellStrat.action, 'SELL');
    assert.equal(sellStrat.tradeSide, 'SELL');
    assert.equal(sellStrat.executable, true);
    assert.equal(sellStrat.entry, 1500);
    assert.equal(sellStrat.stopLoss, 1507.5); // 0.5% above 1500
    assert.equal(sellStrat.target, 1485);     // 2.0R below 1500
    assert.equal(sellStrat.riskRewardRatio, 2);
    assert.equal(sellStrat.marketRegime, 'BEARISH_TREND');

    // 3. Deterministic HOLD signal
    const holdStrat = StrategyEngine.evaluate({
      dataReady: true,
      price: 1500,
      assetType: 'EQUITY',
      indicators: {
        trendScore: 5,
        volatilityScore: 20,
        marketRegime: 'RANGEBOUND'
      },
      analysis: {
        dataReady: true,
        signal: 'HOLD',
        confidence: 62,
        risk: 'LOW'
      }
    });
    assert.equal(holdStrat.action, 'HOLD');
    assert.equal(holdStrat.tradeSide, 'HOLD');
    assert.equal(holdStrat.executable, false);
    assert.equal(holdStrat.entry, null);
    assert.equal(holdStrat.stopLoss, null);
    assert.equal(holdStrat.target, null);
    assert.equal(holdStrat.marketRegime, 'RANGEBOUND');

    // 4. Deterministic NO_TRADE signal
    const noTradeStrat = StrategyEngine.evaluate({
      dataReady: true,
      price: 1500,
      assetType: 'EQUITY',
      analysis: {
        dataReady: true,
        signal: 'NO_TRADE',
        confidence: 35,
        risk: 'MEDIUM'
      }
    });
    assert.equal(noTradeStrat.action, 'NO_TRADE');
    assert.equal(noTradeStrat.executable, false);
  });

  test('102. Task 8 Market Regime Classification (BULLISH_TREND, BEARISH_TREND, RANGEBOUND, HIGH_VOLATILITY, UNKNOWN / INSUFFICIENT_DATA)', () => {
    const bull = StrategyEngine.classifyMarketRegime({
      dataReady: true,
      indicators: { trendScore: 75, adx14: 32, volatilityScore: 25 }
    });
    assert.equal(bull.regime, 'BULLISH_TREND');

    const bear = StrategyEngine.classifyMarketRegime({
      dataReady: true,
      indicators: { trendScore: -72, adx14: 29, volatilityScore: 30 }
    });
    assert.equal(bear.regime, 'BEARISH_TREND');

    const range = StrategyEngine.classifyMarketRegime({
      dataReady: true,
      indicators: { trendScore: 8, adx14: 16, volatilityScore: 22 }
    });
    assert.equal(range.regime, 'RANGEBOUND');

    const highVol = StrategyEngine.classifyMarketRegime({
      dataReady: true,
      indicators: { trendScore: 60, adx14: 35, volatilityScore: 82 }
    });
    assert.equal(highVol.regime, 'HIGH_VOLATILITY');

    const insufficient = StrategyEngine.classifyMarketRegime({
      dataReady: false,
      indicators: { dataQuality: 'DATA_UNAVAILABLE' }
    });
    assert.equal(insufficient.regime, 'INSUFFICIENT_DATA');

    const unknown = StrategyEngine.classifyMarketRegime({
      dataReady: true,
      indicators: {}
    });
    assert.equal(unknown.regime, 'UNKNOWN');
  });

  test('103. Task 8 Stop-Loss Direction Validation, Invalid Target Rejection & Minimum R:R Enforcement', () => {
    // BUY with stopLoss >= entry must be rejected
    const invalidBuySL = StrategyEngine.evaluate({
      dataReady: true,
      price: 1000,
      assetType: 'EQUITY',
      stopLoss: 1010,
      analysis: { dataReady: true, signal: 'BUY', confidence: 88, risk: 'LOW' }
    });
    assert.equal(invalidBuySL.action, 'NO_TRADE');
    assert.equal(invalidBuySL.executable, false);
    assert.equal(invalidBuySL.entry, null);
    assert.ok(invalidBuySL.reason.includes('stop-loss is invalid'));

    // SELL with stopLoss <= entry must be rejected
    const invalidSellSL = StrategyEngine.evaluate({
      dataReady: true,
      price: 1000,
      assetType: 'EQUITY',
      stopLoss: 990,
      analysis: { dataReady: true, signal: 'SELL', confidence: 88, risk: 'LOW' }
    });
    assert.equal(invalidSellSL.action, 'NO_TRADE');
    assert.equal(invalidSellSL.executable, false);

    // BUY with target <= entry must be rejected
    const invalidBuyTarget = StrategyEngine.evaluate({
      dataReady: true,
      price: 1000,
      assetType: 'EQUITY',
      stopLoss: 990,
      target: 995,
      analysis: { dataReady: true, signal: 'BUY', confidence: 88, risk: 'LOW' }
    });
    assert.equal(invalidBuyTarget.action, 'NO_TRADE');
    assert.equal(invalidBuyTarget.executable, false);
    assert.ok(invalidBuyTarget.reason.includes('Target price is invalid'));

    // Sub-threshold R:R rejection when minRewardRiskRatio is specified
    const lowRR = StrategyEngine.evaluate({
      dataReady: true,
      price: 1000,
      assetType: 'EQUITY',
      stopLoss: 990,
      target: 1005, // 0.5R
      minRewardRiskRatio: 1.5,
      analysis: { dataReady: true, signal: 'BUY', confidence: 88, risk: 'LOW' }
    });
    assert.equal(lowRR.action, 'NO_TRADE');
    assert.equal(lowRR.executable, false);
    assert.ok(lowRR.reason.includes('Risk/Reward ratio'));
  });

  test('104. Task 8 Insufficient Data, Stale Data & Conflicting Signal Handling (AI, Regime, Breakout & Option Contract Mismatch)', () => {
    // 1. Stale data must force NO_TRADE
    const staleEval = StrategyEngine.evaluate({
      dataReady: true,
      staleData: true,
      price: 25000,
      analysis: { dataReady: true, signal: 'BUY', confidence: 90, risk: 'LOW' }
    });
    assert.equal(staleEval.action, 'NO_TRADE');
    assert.equal(staleEval.executable, false);
    assert.equal(staleEval.marketRegime, 'INSUFFICIENT_DATA');

    // 2. Insufficient historical candles when minCandlesRequired is set
    const insufficientCandles = StrategyEngine.evaluate({
      dataReady: true,
      price: 25000,
      candles: [{ open: 25000, high: 25010, low: 24990, close: 25000 }],
      minCandlesRequired: 14,
      analysis: { dataReady: true, signal: 'BUY', confidence: 90, risk: 'LOW' }
    });
    assert.equal(insufficientCandles.action, 'NO_TRADE');
    assert.equal(insufficientCandles.dataQuality, 'INSUFFICIENT_CANDLES');

    // 3. Conflicting regime (BUY signal during explicit BEARISH_TREND)
    const regimeConflict = StrategyEngine.evaluate({
      dataReady: true,
      price: 25000,
      marketRegime: 'BEARISH_TREND',
      explicitRegimeCheck: true,
      analysis: { dataReady: true, signal: 'BUY', confidence: 85, risk: 'LOW' }
    });
    assert.equal(regimeConflict.action, 'NO_TRADE');
    assert.equal(regimeConflict.conflicts.length, 1);

    // 4. Conflicting breakout (BUY signal during BEARISH_BREAKDOWN)
    const breakoutConflict = StrategyEngine.evaluate({
      dataReady: true,
      price: 25000,
      indicators: { breakout: 'BEARISH_BREAKDOWN', trendScore: 60, volatilityScore: 20 },
      analysis: { dataReady: true, signal: 'BUY', confidence: 85, risk: 'LOW' }
    });
    assert.equal(breakoutConflict.action, 'NO_TRADE');
    assert.equal(breakoutConflict.conflicts.length, 1);

    // 5. Option contract mismatch (BUY_CE on PE option)
    const optionConflict = StrategyEngine.evaluate({
      dataReady: true,
      price: 150,
      assetType: 'OPTION',
      optionType: 'PE',
      analysis: { dataReady: true, signal: 'BUY_CE', confidence: 88, risk: 'LOW' }
    });
    assert.equal(optionConflict.action, 'NO_TRADE');
    assert.equal(optionConflict.conflicts.length, 1);

    // 6. Supporting Market Intelligence context cannot override HIGH risk or low confidence
    const intelCannotOverride = StrategyEngine.evaluate({
      dataReady: true,
      price: 25000,
      marketIntelligence: {
        sentiment: { available: true, label: 'BULLISH', score: 95, source: 'FINNHUB' }
      },
      analysis: { dataReady: true, signal: 'BUY', confidence: 55, risk: 'HIGH' }
    });
    assert.equal(intelCannotOverride.action, 'NO_TRADE');
    assert.equal(intelCannotOverride.executable, false);
  });

  test('105. Task 8 Safety Pipeline Integration (StrategyEngine -> RiskEngine -> AISafetyGate -> EmergencyStop -> PaperTrading) & Server Endpoints', async () => {
    // 1. Build strategy view model when all gates pass
    const validSnap = {
      instrument: 'RELIANCE',
      name: 'RELIANCE',
      exchange: 'NSE',
      type: 'EQUITY',
      dataReady: true,
      status: 'LIVE_DATA',
      price: 2000,
      indicators: {
        trendScore: 90,
        momentumScore: 88,
        volumeScore: 85,
        vwapScore: 85,
        supportResistanceScore: 85,
        vwap: 1985,
        ema9: 1995,
        ema21: 1980,
        volatilityScore: 20,
        marketRegime: 'BULLISH_TREND',
        dataQuality: 'FULL_CANDLE_SERIES'
      }
    };
    const validAnalysis = MarketAnalysis.analyze({
      dataReady: true,
      assetType: 'EQUITY',
      ...validSnap.indicators
    });

    const vmApproved = StrategyEngine.buildStrategyViewModel({
      snapshot: validSnap,
      analysis: validAnalysis,
      paperState: { dailyPnl: 0, tradesToday: 0, maxTradesPerDay: 3, position: null },
      emergencyStop: false
    });
    assert.equal(vmApproved.strategy.action, 'BUY');
    assert.equal(vmApproved.riskCheck.allowed, true);
    assert.equal(vmApproved.safetyGate.allowed, true);
    assert.equal(vmApproved.canExecutePaper, true);

    // 2. Emergency Stop blocks strategy & view model immediately
    const vmEmergency = StrategyEngine.buildStrategyViewModel({
      snapshot: validSnap,
      analysis: validAnalysis,
      paperState: { dailyPnl: 0, tradesToday: 0, maxTradesPerDay: 3, position: null },
      emergencyStop: true
    });
    assert.equal(vmEmergency.strategy.action, 'NO_TRADE');
    assert.equal(vmEmergency.canExecutePaper, false);

    // 3. Server API endpoints POST /api/strategy/evaluate and GET /api/strategy/history
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const evalRes = await MarketAPI.strategyEvaluate(
      {
        dataReady: true,
        symbol: 'RELIANCE',
        price: 2000,
        assetType: 'EQUITY',
        indicators: validSnap.indicators,
        analysis: validAnalysis
      },
      { baseUrl }
    );
    assert.equal(evalRes.ok, true);
    assert.equal(evalRes.strategy.action, 'BUY');
    assert.equal(evalRes.strategy.entry, 2000);
    assert.equal(evalRes.strategy.stopLoss, 1990);
    assert.equal(evalRes.strategy.target, 2020);

    const histRes = await MarketAPI.strategyHistory({ baseUrl });
    assert.equal(histRes.ok, true);
    assert.ok(Array.isArray(histRes.strategyDecisions));
    assert.ok(histRes.strategyDecisions.length >= 1);
    assert.equal(histRes.strategyDecisions[0].symbol, 'RELIANCE');
    assert.equal(histRes.strategyDecisions[0].action, 'BUY');
  });

  test('106. Task 8 Backtesting Compatibility & Strategy Page UI DOM Verification', () => {
    // 1. Verify Backtester.run works seamlessly with upgraded StrategyEngine
    const candles = [
      {
        timestamp: '2026-10-01T09:15:00.000Z',
        open: 1000,
        high: 1005,
        low: 998,
        close: 1002,
        volume: 15000
      },
      {
        timestamp: '2026-10-01T09:20:00.000Z',
        open: 1002,
        high: 1012,
        low: 1001,
        close: 1010,
        volume: 45000,
        indicators: {
          trendScore: 90,
          momentumScore: 88,
          volumeScore: 80,
          vwapScore: 85,
          supportResistanceScore: 80,
          volatilityScore: 20,
          marketRegime: 'BULLISH_TREND'
        }
      },
      {
        timestamp: '2026-10-01T09:25:00.000Z',
        open: 1010,
        high: 1030,
        low: 1009,
        close: 1025,
        volume: 50000
      }
    ];
    const bt = Backtester.run({
      symbol: 'INFY',
      assetType: 'EQUITY',
      quantity: 2,
      candles,
      persist: false
    });
    assert.equal(bt.ok, true);
    assert.equal(bt.metrics.totalTrades, 1);
    assert.equal(bt.trades[0].reason, 'TARGET');
    assert.ok(bt.metrics.netPnl > 0);

    // 2. Verify all required Task 8 Strategy DOM elements exist in web/index.html
    const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
    const requiredStrategyIds = [
      'strategyPage',
      'strategyVersionBadge',
      'stratReevaluateBtn',
      'stratKpiSignal',
      'stratKpiInstrument',
      'stratKpiRegime',
      'stratKpiDataQuality',
      'stratKpiRR',
      'stratKpiConfidence',
      'stratKpiSafetyGate',
      'strategyActionPill',
      'stratAction',
      'stratTradeSideExecutable',
      'stratRegimeDisplay',
      'stratDataQualityDisplay',
      'stratEntry',
      'stratStop',
      'stratTarget',
      'stratRRDisplay',
      'stratUnitRiskReward',
      'stratConfidence',
      'stratReasonText',
      'stratStagePilotBtn',
      'stratStagePaperBtn',
      'stratRiskEngineStatus',
      'stratAISafetyGateStatus',
      'stratEmergencyStopStatus',
      'stratConflictCheckStatus',
      'stratEntryConditionsList',
      'stratDocumentedRulesList',
      'stratInvalidationConditionsList',
      'stratExitRulesList',
      'stratHistoryCountBadge',
      'stratHistoryContainer'
    ];

    for (const id of requiredStrategyIds) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Task 8 Strategy element id="${id}"`
      );
    }
  });

  /* =====================================================
     TASK 9 — COMPLETE RISK MANAGEMENT ENGINE TESTS
  ===================================================== */

  test('107. Task 9 Per-Trade Risk Control, Mandatory Directional Stop-Loss, Target Validation & Position Sizing Calculator', () => {
    assert.ok(RiskEngine.DOCUMENTED_RISK_RULES);
    assert.equal(RiskEngine.DOCUMENTED_RISK_RULES.tradingMode, 'paper');
    assert.equal(RiskEngine.DOCUMENTED_RISK_RULES.liveTradingEnabled, false);
    assert.equal(RiskEngine.DEFAULTS.maxLossPerTrade, 500);
    assert.equal(RiskEngine.DEFAULTS.maxDailyLoss, 1000);
    assert.equal(RiskEngine.DEFAULTS.maxTradesPerDay, 3);
    assert.equal(RiskEngine.DEFAULTS.maxOpenPositions, 1);

    // 1. Valid BUY trade within ₹500 risk limit
    const validBuy = RiskEngine.evaluate({
      side: 'BUY',
      entry: 2000,
      stop: 1980,
      target: 2040,
      quantity: 25
    });
    assert.equal(validBuy.allowed, true);
    assert.equal(validBuy.status, 'APPROVED');
    assert.equal(validBuy.riskAmount, 500);
    assert.equal(validBuy.unitRisk, 20);
    assert.equal(validBuy.unitReward, 40);
    assert.equal(validBuy.rewardAmount, 1000);
    assert.equal(validBuy.riskRewardRatio, 2);

    // 2. Trade exceeding ₹500 risk limit blocked
    const overRisk = RiskEngine.evaluate({
      side: 'BUY',
      entry: 2000,
      stop: 1980,
      target: 2040,
      quantity: 26 // 26 * 20 = ₹520 > ₹500
    });
    assert.equal(overRisk.allowed, false);
    assert.equal(overRisk.riskAmount, 520);
    assert.ok(overRisk.reasons.some((r) => r.includes('Risk per trade exceeds')));

    // 3. Missing or invalid stop-loss blocked
    const missingStop = RiskEngine.evaluate({
      side: 'BUY',
      entry: 2000,
      stop: null,
      quantity: 1
    });
    assert.equal(missingStop.allowed, false);
    assert.ok(missingStop.reasons.some((r) => r.includes('Invalid stop-loss price')));

    // 4. Invalid BUY stop-loss (stop >= entry) blocked
    const invalidBuyStop = RiskEngine.evaluate({
      side: 'BUY',
      entry: 2000,
      stop: 2000,
      quantity: 1
    });
    assert.equal(invalidBuyStop.allowed, false);
    assert.ok(invalidBuyStop.reasons.some((r) => r.includes('Invalid BUY stop-loss')));

    // 5. Invalid SELL stop-loss (stop <= entry) blocked
    const invalidSellStop = RiskEngine.evaluate({
      side: 'SELL',
      entry: 2000,
      stop: 1995,
      quantity: 1
    });
    assert.equal(invalidSellStop.allowed, false);
    assert.ok(invalidSellStop.reasons.some((r) => r.includes('Invalid SELL stop-loss')));

    // 6. Invalid target direction blocked
    const invalidBuyTarget = RiskEngine.evaluate({
      side: 'BUY',
      entry: 2000,
      stop: 1980,
      target: 1990,
      quantity: 1
    });
    assert.equal(invalidBuyTarget.allowed, false);
    assert.ok(invalidBuyTarget.reasons.some((r) => r.includes('Invalid BUY target')));

    // 7. Invalid fractional quantity or option lot blocked
    const fractionalQty = RiskEngine.evaluate({
      side: 'BUY',
      entry: 2000,
      stop: 1980,
      quantity: 1.5
    });
    assert.equal(fractionalQty.allowed, false);
    assert.ok(fractionalQty.reasons.some((r) => r.includes('whole number')));

    const invalidOptionLot = RiskEngine.evaluate({
      side: 'BUY',
      assetType: 'OPTION',
      entry: 150,
      stop: 145,
      lotSize: 50,
      lots: 0
    });
    assert.equal(invalidOptionLot.allowed, false);

    // 8. Safe Position Sizing Calculator (Equity & Option)
    const eqSize = RiskEngine.calculateSafePositionSize({
      side: 'BUY',
      assetType: 'EQUITY',
      entry: 1000,
      stop: 975, // unitRisk = 25 -> max 20 shares for ₹500
      dailyPnl: 0,
      availableBalance: 100000
    });
    assert.equal(eqSize.ok, true);
    assert.equal(eqSize.recommendedQuantity, 20);
    assert.equal(eqSize.riskAmount, 500);
    assert.equal(eqSize.capitalRequired, 20000);

    const optSize = RiskEngine.calculateSafePositionSize({
      side: 'BUY',
      assetType: 'OPTION',
      entry: 100,
      stop: 95, // unitRisk = 5, lotSize = 50 => ₹250 risk per lot => 2 lots max
      lotSize: 50,
      dailyPnl: 0,
      availableBalance: 100000
    });
    assert.equal(optSize.ok, true);
    assert.equal(optSize.recommendedLots, 2);
    assert.equal(optSize.effectiveQuantity, 100);
    assert.equal(optSize.riskAmount, 500);
  });

  test('108. Task 9 Daily Loss Lock Enforcement (Realized + Unrealized P&L) & Automatic RISK_LOCK Position Exit', () => {
    // 1. Realized daily loss at -₹1,000 locks new trades
    const realizedLocked = RiskEngine.evaluate({
      side: 'BUY',
      entry: 1000,
      stop: 990,
      quantity: 1,
      dailyPnl: -1000
    });
    assert.equal(realizedLocked.allowed, false);
    assert.equal(realizedLocked.dailyLossLocked, true);
    assert.equal(realizedLocked.remainingDailyLossBuffer, 0);
    assert.ok(realizedLocked.reasons.some((r) => r.includes('Daily loss limit has been reached')));

    // 2. Combined realized (-₹600) + unrealized (-₹450) = -₹1,050 locks new trades
    const combinedLocked = RiskEngine.evaluate({
      side: 'BUY',
      entry: 1000,
      stop: 990,
      quantity: 1,
      realizedDailyPnl: -600,
      unrealizedPnl: -450
    });
    assert.equal(combinedLocked.allowed, false);
    assert.equal(combinedLocked.effectiveDailyPnl, -1050);
    assert.equal(combinedLocked.dailyLossLocked, true);

    // 3. Enforce remaining daily risk budget when daily loss is -₹700 (only ₹300 buffer left)
    const bufferExceeded = RiskEngine.evaluate({
      side: 'BUY',
      entry: 1000,
      stop: 960, // ₹400 risk > ₹300 remaining daily buffer
      quantity: 10,
      realizedDailyPnl: -700,
      enforceRemainingDailyBudget: true
    });
    assert.equal(bufferExceeded.allowed, false);
    assert.ok(bufferExceeded.reasons.some((r) => r.includes('remaining daily loss buffer')));

    // 4. PaperTrading automatic RISK_LOCK exit when cumulative daily loss reaches -₹1,000
    PaperTrading.resetState();
    // Trade 1 loses ₹500
    PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24900,
      target: 25200,
      qty: 5
    });
    PaperTrading.closePosition(24900, 'STOP_LOSS');
    assert.equal(PaperTrading.getState().dailyPnl, -500);

    // Trade 2 loses ₹400 -> cumulative dailyPnl = -₹900
    PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24900,
      target: 25300,
      qty: 5
    });
    PaperTrading.closePosition(24920, 'MANUAL');
    assert.equal(PaperTrading.getState().dailyPnl, -900);

    // Trade 3 has stop at 24900, and when price moves to 24980 (unrealized -₹100), cumulative daily P&L reaches -₹1,000 -> RISK_LOCK triggers before hard stop
    const open3 = PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24900,
      target: 25300,
      qty: 5
    });
    assert.equal(open3.ok, true);
    const lockRes = PaperTrading.updatePrice(24980, { autoExit: true });
    assert.equal(lockRes.action, 'RISK_LOCK');
    assert.equal(lockRes.closed, true);
    assert.equal(PaperTrading.getState().dailyPnl, -1000);
    assert.equal(PaperTrading.getState().position, null);

    // Subsequent trade must now be blocked by Daily Loss Lock / Trade Frequency Lock
    const blockedAfterLock = RiskEngine.evaluate({
      side: 'BUY',
      entry: 25000,
      stop: 24990,
      target: 25050,
      quantity: 1,
      dailyPnl: PaperTrading.getState().dailyPnl
    });
    assert.equal(blockedAfterLock.allowed, false);
    assert.ok(blockedAfterLock.reasons.some((r) => r.includes('Daily loss limit')));
  });

  test('109. Task 9 Trade Frequency (Max 3/Day), Single Open Position, Duplicate Symbol & Averaging Protection', () => {
    PaperTrading.resetState();

    // 1. Open 1st position
    const pos1 = PaperTrading.openPosition({
      symbol: 'RELIANCE',
      direction: 'BUY',
      entry: 2000,
      stop: 1990,
      target: 2020,
      qty: 10
    });
    assert.equal(pos1.ok, true);

    // 2. Attempt 2nd concurrent position (same or different symbol) -> blocked
    const dupPos = PaperTrading.openPosition({
      symbol: 'TCS',
      direction: 'BUY',
      entry: 3500,
      stop: 3490,
      target: 3520,
      qty: 5
    });
    assert.equal(dupPos.ok, false);
    assert.ok(dupPos.reason.includes('open paper position already exists'));

    // 3. RiskEngine blocks duplicate symbol averaging explicitly
    const avgEval = RiskEngine.evaluate({
      side: 'BUY',
      symbol: 'RELIANCE',
      existingSymbol: 'RELIANCE',
      openPositions: 1,
      entry: 1995,
      stop: 1985,
      quantity: 5
    });
    assert.equal(avgEval.allowed, false);
    assert.ok(avgEval.reasons.some((r) => r.includes('Averaging into an existing position is blocked')));

    // Close Trade 1
    PaperTrading.closePosition(2005, 'MANUAL');
    assert.equal(PaperTrading.getState().tradesToday, 1);

    // Open & Close Trade 2
    PaperTrading.openPosition({
      symbol: 'TCS',
      direction: 'BUY',
      entry: 3500,
      stop: 3490,
      target: 3520,
      qty: 5
    });
    PaperTrading.closePosition(3505, 'MANUAL');
    assert.equal(PaperTrading.getState().tradesToday, 2);

    // Open & Close Trade 3
    PaperTrading.openPosition({
      symbol: 'INFY',
      direction: 'BUY',
      entry: 1500,
      stop: 1490,
      target: 1520,
      qty: 5
    });
    PaperTrading.closePosition(1505, 'MANUAL');
    assert.equal(PaperTrading.getState().tradesToday, 3);

    // 4th Trade of the day must be blocked
    const trade4 = PaperTrading.openPosition({
      symbol: 'HDFCBANK',
      direction: 'BUY',
      entry: 1600,
      stop: 1590,
      target: 1620,
      qty: 5
    });
    assert.equal(trade4.ok, false);
    assert.ok(trade4.reason.includes('Maximum daily trades reached'));
  });

  test('110. Task 9 Emergency Stop Control (Immediate Block, No Auto-Reset, Explicit Reset Required)', () => {
    PaperTrading.resetState();
    AuditLogger.resetEmergencyStop('Init test');

    // Activate Emergency Stop
    AuditLogger.activateEmergencyStop('Task 9 Emergency Test');
    assert.equal(RiskEngine.isEmergencyStopActive(), true);
    assert.equal(AuditLogger.isEmergencyStopActive(), true);

    // RiskEngine blocks valid trade during Emergency Stop
    const blockedByEm = RiskEngine.evaluate({
      side: 'BUY',
      entry: 1000,
      stop: 990,
      target: 1020,
      quantity: 5
    });
    assert.equal(blockedByEm.allowed, false);
    assert.ok(blockedByEm.reasons.includes('Emergency stop is active.'));

    // PaperTrading.openPosition blocks during Emergency Stop even if state.emergencyStop wasn't manually passed
    const paperBlocked = PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24950,
      target: 25100,
      qty: 1
    });
    assert.equal(paperBlocked.ok, false);
    assert.ok(paperBlocked.reason.includes('Emergency stop is active'));

    // Re-evaluating RiskEngine or configuring limits must NOT auto-reset Emergency Stop
    RiskEngine.configureLimits({ maxLossPerTrade: 500 });
    assert.equal(RiskEngine.isEmergencyStopActive(), true);

    // Explicit reset restores normal operation
    AuditLogger.resetEmergencyStop('Explicit user reset');
    assert.equal(RiskEngine.isEmergencyStopActive(), false);
    const allowedAfterReset = RiskEngine.evaluate({
      side: 'BUY',
      entry: 1000,
      stop: 990,
      target: 1020,
      quantity: 5
    });
    assert.equal(allowedAfterReset.allowed, true);
  });

  test('111. Task 9 Available Paper Balance Check, Multi-User SQLite Risk Isolation, CSRF Protection & Server Risk APIs', async () => {
    // 1. Order exceeding available paper balance is rejected
    const overBalance = RiskEngine.evaluate({
      side: 'BUY',
      entry: 25000,
      stop: 24995, // risk = ₹50 <= ₹500
      target: 25020,
      quantity: 10, // capitalRequired = ₹250,000 > ₹100,000 available
      availableBalance: 100000
    });
    assert.equal(overBalance.allowed, false);
    assert.ok(overBalance.reasons.some((r) => r.includes('Order value exceeds available paper balance')));

    // 2. Start API server and verify User A vs User B risk state isolation + CSRF protection
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // Register User A
    const regA = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Risk Trader A',
        email: 'risk.trader.a@example.com',
        password: 'StrongPassword123!'
      })
    });
    assert.equal(regA.status, 201);
    const cookieA = regA.headers['set-cookie'][0].split(';')[0];
    const csrfA = regA.json.csrfToken;

    // Register User B
    const regB = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Risk Trader B',
        email: 'risk.trader.b@example.com',
        password: 'StrongPassword123!'
      })
    });
    assert.equal(regB.status, 201);
    const cookieB = regB.headers['set-cookie'][0].split(';')[0];
    const csrfB = regB.json.csrfToken;

    // CSRF protection on POST /api/risk/evaluate
    const missingCsrf = await requestServer(server, '/api/risk/evaluate', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ side: 'BUY', entry: 1000, stop: 990, quantity: 5 })
    });
    assert.equal(missingCsrf.status, 403);

    // Valid POST /api/risk/evaluate for User A (rejected trade > ₹500 risk)
    const evalA = await requestServer(server, '/api/risk/evaluate', {
      method: 'POST',
      headers: {
        Cookie: cookieA,
        'X-CSRF-Token': csrfA,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        symbol: 'RELIANCE',
        side: 'BUY',
        entry: 2000,
        stop: 1900,
        target: 2200,
        quantity: 10 // Risk = ₹1,000 > ₹500
      })
    });
    assert.equal(evalA.status, 200);
    assert.equal(evalA.json.ok, true);
    assert.equal(evalA.json.riskCheck.allowed, false);
    assert.equal(evalA.json.riskCheck.riskAmount, 1000);
    assert.equal(evalA.json.positionSizing.ok, true);
    assert.equal(evalA.json.positionSizing.recommendedQuantity, 5); // 5 * 100 = ₹500

    // User A opens a valid paper position
    const openA = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        Cookie: cookieA,
        'X-CSRF-Token': csrfA,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        symbol: 'RELIANCE',
        direction: 'BUY',
        assetType: 'EQUITY',
        entry: 2000,
        stop: 1980,
        target: 2040,
        qty: 10 // Risk = ₹200 <= ₹500
      })
    });
    assert.equal(openA.status, 200);
    assert.equal(openA.json.ok, true);

    // Check GET /api/risk/status for User A
    const statusA = await requestServer(server, '/api/risk/status', {
      headers: { Cookie: cookieA }
    });
    assert.equal(statusA.status, 200);
    assert.equal(statusA.json.riskStatus.counters.tradesToday, 1);
    assert.equal(statusA.json.riskStatus.counters.openPositionsCount, 1);
    assert.equal(statusA.json.riskStatus.counters.openPositionRiskAmount, 200);
    assert.equal(statusA.json.riskStatus.canOpenNewTrade, false);

    // Check GET /api/risk/status for User B -> completely isolated (0 trades, 0 open positions)
    const statusB = await requestServer(server, '/api/risk/status', {
      headers: { Cookie: cookieB }
    });
    assert.equal(statusB.status, 200);
    assert.equal(statusB.json.riskStatus.counters.tradesToday, 0);
    assert.equal(statusB.json.riskStatus.counters.openPositionsCount, 0);
    assert.equal(statusB.json.riskStatus.canOpenNewTrade, true);

    // Cross-user risk status query must be forbidden (403)
    const crossRisk = await requestServer(
      server,
      `/api/risk/status?userId=${encodeURIComponent(regA.json.user.userId)}`,
      { headers: { Cookie: cookieB } }
    );
    assert.equal(crossRisk.status, 403);
    assert.equal(crossRisk.json.code, 'FORBIDDEN_OWNERSHIP');
  });

  test('112. Task 9 Risk View Model & Risk Management UI DOM Verification', () => {
    const vm = RiskEngine.buildRiskViewModel({
      account: {
        capital: 100000,
        realizedPnl: -400,
        dailyPnl: -400,
        tradesToday: 2,
        maxDailyLoss: 1000,
        maxLossPerTrade: 500,
        maxTradesPerDay: 3
      },
      openPosition: {
        symbol: 'NIFTY 50',
        direction: 'BUY',
        entry: 25000,
        stop: 24900,
        target: 25200,
        effectiveQty: 2,
        unrealizedPnl: -150
      },
      emergencyStop: false,
      riskEvents: [
        {
          symbol: 'NIFTY 50',
          side: 'BUY',
          allowed: true,
          riskAmount: 200,
          reasons: [],
          timestamp: new Date().toISOString()
        }
      ]
    });

    assert.equal(vm.tradingMode, 'paper');
    assert.equal(vm.liveTradingEnabled, false);
    assert.equal(vm.capitalAndPnl.realizedDailyPnl, -400);
    assert.equal(vm.capitalAndPnl.unrealizedPnl, -150);
    assert.equal(vm.capitalAndPnl.effectiveDailyPnl, -550);
    assert.equal(vm.capitalAndPnl.remainingDailyLossBuffer, 450);
    assert.equal(vm.counters.tradesToday, 2);
    assert.equal(vm.counters.remainingTradesToday, 1);
    assert.equal(vm.counters.openPositionsCount, 1);
    assert.equal(vm.counters.openPositionRiskAmount, 200);
    assert.equal(vm.canOpenNewTrade, false);

    const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
    const requiredRiskIds = [
      'riskPage',
      'riskPageSafetyStatus',
      'riskRefreshStatusBtn',
      'riskKpiMaxLossTrade',
      'riskKpiOpenTradeRisk',
      'riskKpiDailyBuffer',
      'riskKpiEffectiveDailyPnl',
      'riskKpiTradesCounter',
      'riskKpiTradesRemaining',
      'riskKpiOpenPositionCounter',
      'riskKpiAvailableBalance',
      'riskEmergencyPill',
      'riskRuleMaxLossPerTrade',
      'riskRuleMaxDailyLoss',
      'riskRuleDailyPnlBreakdown',
      'riskRuleRemainingDailyBuffer',
      'riskRuleTradesToday',
      'riskRuleOpenPositions',
      'riskEmergencyStateText',
      'triggerEmergencyPageBtn',
      'resetEmergencyPageBtn',
      'riskSimStatusBadge',
      'riskSimSide',
      'riskSimAssetType',
      'riskSimEntry',
      'riskSimStop',
      'riskSimTarget',
      'riskSimQty',
      'riskSimLotSize',
      'riskSimEvaluateBtn',
      'riskSimRiskAmount',
      'riskSimRR',
      'riskSimRecommendedSize',
      'riskSimVerdictText',
      'riskEventsCountBadge',
      'riskActiveRejectionBox',
      'riskEventsHistoryList',
      'liveAuditStatusPill',
      'liveAuditChecksList'
    ];

    for (const id of requiredRiskIds) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Task 9 Risk UI element id="${id}"`
      );
    }
  });

  /* =====================================================
     TASK 10 — COMPLETE PAPER TRADING ENGINE VERIFICATION
     (Tests 113–118)
  ===================================================== */

  test('113. Task 10 Paper Account Capital, Reserved Margin, Available Balance & Net Equity Accounting', () => {
    PaperTrading.resetState();
    const initial = PaperTrading.getState();

    // 1. Default initial virtual capital is ₹1,00,000.00
    assert.equal(PaperTrading.DOCUMENTED_PAPER_TRADING_RULES.defaultInitialCapital, 100000);
    assert.equal(initial.capital, 100000);
    assert.equal(initial.reservedCapital, 0);
    assert.equal(initial.availableBalance, 100000);
    assert.equal(initial.totalEquity, 100000);
    assert.equal(initial.realizedPnl, 0);
    assert.equal(initial.unrealizedPnl, 0);

    // 2. Rejects order whose value exceeds available paper balance even if risk <= ₹500
    const overBalance = PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24995, // risk = 5 * 10 = ₹50 <= ₹500
      target: 25050,
      qty: 10, // position value = ₹2,50,000 > ₹1,00,000 available
      enforceAvailableBalance: true
    });
    assert.equal(overBalance.ok, false);
    assert.equal(overBalance.code, 'INSUFFICIENT_PAPER_BALANCE');
    assert.ok(overBalance.reason.includes('exceeds available paper balance'));

    // 3. Open valid position -> reserves capital and reduces available balance
    const opened = PaperTrading.openPosition({
      symbol: 'RELIANCE',
      direction: 'BUY',
      entry: 2000,
      stop: 1980,
      target: 2050,
      qty: 10 // position value = ₹20,000, risk = ₹200
    });
    assert.equal(opened.ok, true);

    const openState = PaperTrading.getState();
    assert.equal(openState.reservedCapital, 20000);
    assert.equal(openState.availableBalance, 80000);
    assert.equal(openState.totalEquity, 100000);

    // 4. Mark-to-market price update -> updates unrealized P&L and net equity
    PaperTrading.updatePrice(2015);
    const mtmState = PaperTrading.getState();
    assert.equal(mtmState.unrealizedPnl, 150);
    assert.equal(mtmState.totalEquity, 100150);
    assert.equal(mtmState.reservedCapital, 20000);
    assert.equal(mtmState.availableBalance, 80000);

    // 5. Close position -> releases reserved capital, adds realized P&L to available balance
    const closed = PaperTrading.closePosition(2025, 'MANUAL');
    assert.equal(closed.ok, true);
    assert.equal(closed.pnl, 250);

    const closedState = PaperTrading.getState();
    assert.equal(closedState.reservedCapital, 0);
    assert.equal(closedState.realizedPnl, 250);
    assert.equal(closedState.unrealizedPnl, 0);
    assert.equal(closedState.availableBalance, 100250);
    assert.equal(closedState.totalEquity, 100250);
    assert.equal(closedState.wins, 1);
  });

  test('114. Task 10 Order Lifecycle, Virtual Fills, Option Lot Multipliers & Validation Rejections', () => {
    PaperTrading.resetState();

    // 1. Stale or unvalidated market data is rejected
    const staleBlocked = PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24900,
      target: 25200,
      qty: 1,
      staleData: true
    });
    assert.equal(staleBlocked.ok, false);
    assert.equal(staleBlocked.code, 'STALE_OR_UNVALIDATED_DATA');

    // 2. Non-integer equity quantity is rejected
    const fracBlocked = PaperTrading.openPosition({
      symbol: 'SBIN',
      direction: 'BUY',
      entry: 800,
      stop: 790,
      target: 820,
      qty: 2.5
    });
    assert.equal(fracBlocked.ok, false);
    assert.equal(fracBlocked.code, 'INVALID_QUANTITY');

    // 3. Invalid SELL stop-loss (stop <= entry) is rejected
    const badSellStop = PaperTrading.openPosition({
      symbol: 'TCS',
      direction: 'SELL',
      entry: 4000,
      stop: 3980,
      target: 3940,
      qty: 1
    });
    assert.equal(badSellStop.ok, false);
    assert.equal(badSellStop.code, 'INVALID_SELL_STOP');

    // 4. Valid OPTION paper trade with lotSize=25, lots=2 -> effectiveQty=50, records ENTRY order + fill
    const optOpen = PaperTrading.openPosition({
      symbol: 'NIFTY28NOV2425000CE',
      exchange: 'NFO',
      direction: 'BUY',
      assetType: 'OPTION',
      lotSize: 25,
      lots: 2,
      entry: 150,
      stop: 142, // risk = 8 * 50 = ₹400 <= ₹500
      target: 170,
      exitOnTarget: true
    });
    assert.equal(optOpen.ok, true);
    assert.equal(optOpen.position.effectiveQty, 50);
    assert.equal(optOpen.order.type, 'ENTRY');
    assert.equal(optOpen.order.status, 'FILLED_PAPER');
    assert.equal(optOpen.fill.quantity, 50);
    assert.equal(optOpen.fill.fillPrice, 150);

    // 5. Close option position -> records EXIT order + fill + closed trade record
    const optClose = PaperTrading.closePosition(164, 'MANUAL');
    assert.equal(optClose.ok, true);
    assert.equal(optClose.pnl, 700); // (164 - 150) * 50 = ₹700
    assert.equal(optClose.exitOrder.type, 'EXIT');
    assert.equal(optClose.exitOrder.direction, 'SELL');
    assert.equal(optClose.exitFill.fillPrice, 164);

    const pState = PaperTrading.getState();
    assert.equal(pState.orders.length, 2);
    assert.equal(pState.fills.length, 2);
    assert.equal(pState.history.length, 1);
    assert.equal(pState.history[0].pnl, 700);
  });

  test('115. Task 10 5-Tier Deterministic Exit Priority Order (EMERGENCY_STOP -> STOP_LOSS -> RISK_LOCK -> TARGET_EXIT -> PROFIT_LOCK)', () => {
    // Priority 1: EMERGENCY_STOP overrides everything
    PaperTrading.resetState();
    PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24900,
      target: 25200,
      qty: 2
    });
    const emExit = PaperTrading.updatePrice(25050, {
      autoExit: true,
      emergencyStop: true
    });
    assert.equal(emExit.action, 'EMERGENCY_STOP');
    assert.equal(emExit.closed, true);
    assert.equal(PaperTrading.getState().position, null);

    // Priority 2: STOP_LOSS triggers on SELL when price >= stop
    PaperTrading.resetState();
    PaperTrading.openPosition({
      symbol: 'BANK NIFTY',
      direction: 'SELL',
      entry: 51000,
      stop: 51100,
      target: 50700,
      qty: 2
    });
    const slExit = PaperTrading.updatePrice(51105, { autoExit: true });
    assert.equal(slExit.action, 'STOP_LOSS');
    assert.equal(slExit.closed, true);
    assert.equal(slExit.pnl, -210);

    // Priority 3: RISK_LOCK triggers when realized dailyPnl (-₹800) + unrealizedPnl (-₹200) <= -₹1,000 before hard stop
    PaperTrading.resetState();
    // Trade 1 loses ₹450
    PaperTrading.openPosition({
      symbol: 'SBIN',
      direction: 'BUY',
      entry: 800,
      stop: 755,
      target: 900,
      qty: 10
    });
    PaperTrading.closePosition(755, 'STOP_LOSS'); // -₹450
    // Trade 2 loses ₹450 -> cumulative realized dailyPnl = -₹900
    PaperTrading.openPosition({
      symbol: 'SBIN',
      direction: 'BUY',
      entry: 800,
      stop: 755,
      target: 900,
      qty: 10
    });
    PaperTrading.closePosition(755, 'STOP_LOSS'); // -₹900 total
    // Trade 3 has hard stop at 780 (-₹200 risk), but at 790 unrealizedPnl = -₹100 -> -900 + -100 = -₹1,000 RISK_LOCK!
    PaperTrading.openPosition({
      symbol: 'SBIN',
      direction: 'BUY',
      entry: 800,
      stop: 780,
      target: 850,
      qty: 10
    });
    const riskLockExit = PaperTrading.updatePrice(790, { autoExit: true });
    assert.equal(riskLockExit.action, 'RISK_LOCK');
    assert.equal(riskLockExit.closed, true);
    assert.equal(PaperTrading.getState().dailyPnl, -1000);

    // Priority 4: TARGET_EXIT when exitOnTarget=true
    PaperTrading.resetState();
    PaperTrading.openPosition({
      symbol: 'TCS',
      direction: 'SELL',
      entry: 4000,
      stop: 4020,
      target: 3950,
      qty: 5,
      exitOnTarget: true
    });
    const targetExit = PaperTrading.updatePrice(3945, { autoExit: true });
    assert.equal(targetExit.action, 'TARGET_EXIT');
    assert.equal(targetExit.closed, true);
    assert.equal(targetExit.pnl, 275);

    // Priority 5: PROFIT_LOCK trailing stop after reaching 2 profit milestones
    PaperTrading.resetState();
    PaperTrading.openPosition({
      symbol: 'INFY',
      direction: 'BUY',
      entry: 1000,
      stop: 990,
      target: 1500,
      qty: 10, // positionValue = 10,000 -> profitStep = ₹1,000
      exitOnTarget: false
    });
    // Price rises to 1220 -> pnl = +₹2,200 (crosses 1000 and 2000 milestones -> lockedProfit = ₹1,000 -> lockedStopPrice = 1100)
    const trailUp = PaperTrading.updatePrice(1220, { autoExit: true });
    assert.equal(trailUp.action, 'AI_REANALYZE');
    assert.equal(trailUp.lockedProfit, 1000);
    assert.equal(PaperTrading.lockedStopPrice(), 1100);

    // Price pulls back to 1095 (<= 1100 lockedStopPrice) -> PROFIT_LOCK exit
    const profitLockExit = PaperTrading.updatePrice(1095, { autoExit: true });
    assert.equal(profitLockExit.action, 'PROFIT_LOCK');
    assert.equal(profitLockExit.closed, true);
    assert.equal(profitLockExit.pnl, 950);
  });

  test('116. Task 10 Multi-User SQLite Paper Persistence, Ownership Isolation, CSRF Protection & Server Endpoints (/api/paper/open, /api/paper/price-update, /api/paper/close, /api/emergency/activate)', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // Register User A & User B
    const regA = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Paper Trader A',
        email: 'paper.trader.a@example.com',
        password: 'StrongPassword123!'
      })
    });
    assert.equal(regA.status, 201);
    const cookieA = regA.headers['set-cookie'][0].split(';')[0];
    const csrfA = regA.json.csrfToken;
    const userIdA = regA.json.user.userId;

    const regB = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Paper Trader B',
        email: 'paper.trader.b@example.com',
        password: 'StrongPassword123!'
      })
    });
    assert.equal(regB.status, 201);
    const cookieB = regB.headers['set-cookie'][0].split(';')[0];
    const csrfB = regB.json.csrfToken;

    // 1. CSRF check on POST /api/paper/open
    const noCsrfOpen = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'RELIANCE', direction: 'BUY', entry: 2000, stop: 1980, target: 2040, qty: 5 })
    });
    assert.equal(noCsrfOpen.status, 403);

    // 2. User A opens a paper position via POST /api/paper/open
    const openA = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        Cookie: cookieA,
        'X-CSRF-Token': csrfA,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        symbol: 'RELIANCE',
        direction: 'BUY',
        assetType: 'EQUITY',
        entry: 2000,
        stop: 1980,
        target: 2040,
        qty: 10,
        exitOnTarget: true
      })
    });
    assert.equal(openA.status, 200);
    assert.equal(openA.json.ok, true);
    assert.equal(openA.json.account.reservedCapital, 20000);
    assert.equal(openA.json.account.availableBalance, 80000);
    const posIdA = openA.json.positionId;

    // 3. User B cannot update or close User A's position (403 FORBIDDEN_OWNERSHIP)
    const hijackUpdate = await requestServer(server, '/api/paper/price-update', {
      method: 'POST',
      headers: {
        Cookie: cookieB,
        'X-CSRF-Token': csrfB,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ positionId: posIdA, price: 2010 })
    });
    assert.equal(hijackUpdate.status, 403);
    assert.equal(hijackUpdate.json.code, 'FORBIDDEN_OWNERSHIP');

    const hijackClose = await requestServer(server, '/api/paper/close', {
      method: 'POST',
      headers: {
        Cookie: cookieB,
        'X-CSRF-Token': csrfB,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ positionId: posIdA, exitPrice: 2010 })
    });
    assert.equal(hijackClose.status, 403);
    assert.equal(hijackClose.json.code, 'FORBIDDEN_OWNERSHIP');

    // 4. User A updates price via POST /api/paper/price-update (HOLD state)
    const updHold = await requestServer(server, '/api/paper/price-update', {
      method: 'POST',
      headers: {
        Cookie: cookieA,
        'X-CSRF-Token': csrfA,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ positionId: posIdA, price: 2015, autoExit: true })
    });
    assert.equal(updHold.status, 200);
    assert.equal(updHold.json.action, 'HOLD');
    assert.equal(updHold.json.closed, false);
    assert.equal(updHold.json.pnl, 150);
    assert.equal(updHold.json.account.unrealizedPnl, 150);
    assert.equal(updHold.json.account.totalEquity, 100150);

    // 5. User A updates price to 2045 (>= target 2040) with autoExit=true -> auto-closes on TARGET_EXIT
    const updTarget = await requestServer(server, '/api/paper/price-update', {
      method: 'POST',
      headers: {
        Cookie: cookieA,
        'X-CSRF-Token': csrfA,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ positionId: posIdA, price: 2045, autoExit: true })
    });
    assert.equal(updTarget.status, 200);
    assert.equal(updTarget.json.action, 'TARGET_EXIT');
    assert.equal(updTarget.json.closed, true);
    assert.equal(updTarget.json.pnl, 450);
    assert.equal(updTarget.json.openPosition, null);
    assert.equal(updTarget.json.account.realizedPnl, 450);
    assert.equal(updTarget.json.account.availableBalance, 100450);

    // 6. User A opens a 2nd position and activates Emergency Stop via POST /api/emergency/activate -> immediately closes User A's open position
    const openA2 = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        Cookie: cookieA,
        'X-CSRF-Token': csrfA,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        symbol: 'TCS',
        direction: 'SELL',
        assetType: 'EQUITY',
        entry: 4000,
        stop: 4020,
        target: 3950,
        qty: 5
      })
    });
    assert.equal(openA2.status, 200);
    assert.ok(openA2.json.openPosition);

    const emAct = await requestServer(server, '/api/emergency/activate', {
      method: 'POST',
      headers: {
        Cookie: cookieA,
        'X-CSRF-Token': csrfA,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason: 'Task 10 Server Emergency Stop Test' })
    });
    assert.equal(emAct.status, 200);
    assert.equal(emAct.json.active, true);
    assert.ok(emAct.json.userClosedPosition);
    assert.equal(emAct.json.openPosition, null);

    // Verify GET /api/paper/state for User A has 4 orders (2 ENTRY + 2 EXIT), 4 fills, and 2 closed trades
    const stateA = await requestServer(server, '/api/paper/state', {
      headers: { Cookie: cookieA }
    });
    assert.equal(stateA.status, 200);
    assert.equal(stateA.json.userId, userIdA);
    assert.equal(stateA.json.orders.length, 4);
    assert.equal(stateA.json.fills.length, 4);
    assert.equal(stateA.json.history.length, 2);

    // Reset emergency stop
    await requestServer(server, '/api/emergency/reset', {
      method: 'POST',
      headers: {
        Cookie: cookieA,
        'X-CSRF-Token': csrfA,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason: 'Reset after test' })
    });
  });

  test('117. Task 10 PaperTrading View Model & UI DOM Verification', () => {
    PaperTrading.resetState();
    PaperTrading.openPosition({
      symbol: 'NIFTY 50',
      direction: 'BUY',
      entry: 25000,
      stop: 24900,
      target: 25200,
      qty: 2,
      exitOnTarget: true
    });
    PaperTrading.updatePrice(25040);

    const vm = PaperTrading.buildPaperTradingViewModel();
    assert.equal(vm.tradingMode, 'paper');
    assert.equal(vm.liveTradingEnabled, false);
    assert.equal(vm.account.capital, 100000);
    assert.equal(vm.account.reservedCapital, 50000);
    assert.equal(vm.account.availableBalance, 50000);
    assert.equal(vm.account.unrealizedPnl, 80);
    assert.equal(vm.account.totalEquity, 100080);
    assert.ok(vm.openPosition);
    assert.equal(vm.openPosition.symbol, 'NIFTY 50');
    assert.equal(vm.orders.length, 1);
    assert.equal(vm.fills.length, 1);

    const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
    const requiredPaperIds = [
      'paperPage',
      'paperModeBadge',
      'paperSyncBtn',
      'paperAccountCapital',
      'paperTotalEquityText',
      'paperAvailableBalance',
      'paperReservedCapital',
      'paperTotalRealizedPnl',
      'paperOpenUnrealizedPnl',
      'paperWinRateStats',
      'paperAutoExecBadge',
      'paperFillFromMarketBtn',
      'paperAuthMode',
      'paperSymbol',
      'paperAssetType',
      'paperQty',
      'paperLotSize',
      'paperLots',
      'paperEffectiveQty',
      'paperEntry',
      'paperStop',
      'paperTarget',
      'paperExitOnTarget',
      'paperRisk',
      'paperReward',
      'paperRR',
      'paperPreviewCapital',
      'paperPreviewVerdict',
      'openPaperTrade',
      'paperPositionStatus',
      'paperNoPosition',
      'paperPosition',
      'paperPositionSide',
      'paperPositionSymbol',
      'paperPositionModePill',
      'paperPositionEntry',
      'paperPositionCurrent',
      'paperPositionStop',
      'paperPositionTarget',
      'paperPositionQty',
      'paperPositionValue',
      'paperPositionPnl',
      'paperProfitMilestone',
      'paperLockedProfit',
      'paperNextMilestone',
      'paperUpdatePriceInput',
      'paperApplyPriceUpdateBtn',
      'closePaperTrade',
      'paperDailyPnl',
      'paperTradesToday',
      'positionsPage',
      'positionsOpenCount',
      'positionsStateBadge',
      'posViewSymbol',
      'posViewPrices',
      'posViewStops',
      'posViewTrailing',
      'posViewTrailingStop',
      'posViewMargin',
      'posViewPnl',
      'ordersPage',
      'ordersCountPill',
      'ordersListContainer',
      'fillsCountPill',
      'fillsListContainer',
      'historyPage',
      'historyTradesCount',
      'tradeHistoryContainer',
      'auditLogContainer'
    ];

    for (const id of requiredPaperIds) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Task 10 Paper Trading UI element id="${id}"`
      );
    }
  });

  /* =====================================================
     TASK 11 — COMPLETE PORTFOLIO MANAGEMENT TESTS
     (Tests 118–122)
  ===================================================== */

  test('118. Task 11 Portfolio Summary, Available Balance, Reserved Capital & Accounting Consistency', () => {
    // 1. Empty portfolio state — distinguishes ₹0 from INSUFFICIENT_DATA
    const emptySnap = PortfolioEngine.buildPortfolioSnapshot({
      account: {
        capital: 100000,
        realizedPnl: 0,
        unrealizedPnl: 0,
        dailyPnl: 0,
        tradesToday: 0,
        wins: 0,
        losses: 0
      },
      openPosition: null,
      closedTrades: []
    });

    assert.equal(emptySnap.ok, true);
    assert.equal(emptySnap.mode, 'PAPER');
    assert.equal(emptySnap.liveTradingEnabled, false);
    assert.equal(emptySnap.summary.initialCapital, 100000);
    assert.equal(emptySnap.summary.availableBalance, 100000);
    assert.equal(emptySnap.summary.reservedCapital, 0);
    assert.equal(emptySnap.summary.totalEquity, 100000);
    assert.equal(emptySnap.summary.realizedPnl, 0);
    assert.equal(emptySnap.summary.unrealizedPnl, 0);
    assert.equal(emptySnap.summary.overallReturnPct, 0);
    assert.equal(emptySnap.summary.openPositionCount, 0);
    assert.equal(emptySnap.summary.closedTradeCount, 0);
    assert.equal(emptySnap.summary.isEmptyPortfolio, true);
    assert.equal(emptySnap.summary.dataAvailability, 'EMPTY_PORTFOLIO');
    assert.equal(emptySnap.summary.winRate, null);
    assert.equal(emptySnap.summary.winRateStatus, 'INSUFFICIENT_DATA');
    assert.equal(emptySnap.summary.profitFactor, null);
    assert.equal(emptySnap.summary.profitFactorStatus, 'INSUFFICIENT_DATA');
    assert.equal(emptySnap.summary.expectancy, null);
    assert.equal(emptySnap.summary.expectancyStatus, 'INSUFFICIENT_DATA');
    assert.equal(emptySnap.summary.maxDrawdown, null);
    assert.equal(emptySnap.summary.drawdownStatus, 'INSUFFICIENT_DATA');
    assert.equal(emptySnap.summary.accountingConsistent, true);

    // 2. Active portfolio with open position + closed trade history (open position is NEVER double-counted as closed)
    const activeSnap = PortfolioEngine.buildPortfolioSnapshot({
      account: {
        capital: 100000,
        realizedPnl: 1200,
        unrealizedPnl: 300,
        dailyPnl: 1200,
        tradesToday: 2,
        wins: 1,
        losses: 0,
        sessionDate: '2026-10-09'
      },
      openPosition: {
        id: 'POS-1',
        symbol: 'RELIANCE',
        exchange: 'NSE',
        direction: 'BUY',
        assetType: 'EQUITY',
        qty: 10,
        effectiveQty: 10,
        entry: 2500,
        current: 2530,
        stop: 2475,
        target: 2580,
        status: 'OPEN',
        openedAt: '2026-10-09T09:30:00.000Z',
        updatedAt: '2026-10-09T09:35:00.000Z'
      },
      closedTrades: [
        {
          id: 'TRD-1',
          symbol: 'TCS',
          direction: 'BUY',
          assetType: 'EQUITY',
          quantity: 10,
          entry: 4000,
          exit: 4120,
          stop: 3960,
          target: 4120,
          pnl: 1200,
          reason: 'TARGET_EXIT',
          openedAt: '2026-10-09T09:15:00.000Z',
          closedAt: '2026-10-09T09:25:00.000Z'
        }
      ],
      nowIso: '2026-10-09T09:36:00.000Z'
    });

    assert.equal(activeSnap.summary.initialCapital, 100000);
    assert.equal(activeSnap.summary.realizedPnl, 1200);
    assert.equal(activeSnap.summary.reservedCapital, 25000); // 2500 * 10
    assert.equal(activeSnap.summary.availableBalance, 76200); // 100000 + 1200 - 25000
    assert.equal(activeSnap.summary.unrealizedPnl, 300); // (2530 - 2500) * 10
    assert.equal(activeSnap.summary.totalEquity, 101500); // 100000 + 1200 + 300
    assert.equal(activeSnap.summary.overallReturnPct, 1.5); // (1500 / 100000) * 100
    assert.equal(activeSnap.summary.openPositionCount, 1);
    assert.equal(activeSnap.summary.closedTradeCount, 1);
    assert.equal(activeSnap.summary.accountingConsistent, true);
  });

  test('119. Task 11 Open Position Valuation, Option Details, Stale Quote & Unavailable Quote Handling', () => {
    const nowMs = Date.parse('2026-10-09T10:00:00.000Z');

    // 1. Fresh live validated option position valuation
    const optVal = PortfolioEngine.evaluateOpenPositionValuation(
      {
        id: 'POS-OPT-1',
        symbol: 'NIFTY28NOV2425000CE',
        exchange: 'NFO',
        direction: 'BUY',
        assetType: 'OPTION',
        lotSize: 25,
        lots: 2,
        qty: 2,
        effectiveQty: 50,
        entry: 120,
        current: 135,
        stop: 112,
        target: 145,
        status: 'OPEN',
        openedAt: '2026-10-09T09:50:00.000Z',
        updatedAt: '2026-10-09T09:59:30.000Z'
      },
      {
        quoteContext: {
          price: 135,
          timestamp: '2026-10-09T09:59:30.000Z',
          dataReady: true,
          stale: false
        },
        nowMs
      }
    );

    assert.equal(optVal.assetType, 'OPTION');
    assert.equal(optVal.optionDetails.lotSize, 25);
    assert.equal(optVal.optionDetails.lots, 2);
    assert.equal(optVal.optionDetails.optionType, 'CE');
    assert.equal(optVal.effectiveQty, 50);
    assert.equal(optVal.reservedCapital, 6000); // 120 * 50
    assert.equal(optVal.marketValue, 6750); // 135 * 50
    assert.equal(optVal.unrealizedGrossPnl, 750); // (135 - 120) * 50
    assert.equal(optVal.unrealizedNetPnl, 750);
    assert.equal(optVal.pnlPercentage, 12.5); // (750 / 6000) * 100
    assert.equal(optVal.isStale, false);
    assert.equal(optVal.valuationStatus, 'LIVE_VALIDATED');

    // 2. Stale quote (older than 5 minutes or explicitly stale) -> marks valuation as STALE, shows last valid price and timestamp
    const staleVal = PortfolioEngine.evaluateOpenPositionValuation(
      {
        id: 'POS-EQ-1',
        symbol: 'SBIN',
        exchange: 'NSE',
        direction: 'SELL',
        assetType: 'EQUITY',
        qty: 10,
        effectiveQty: 10,
        entry: 800,
        current: 790,
        stop: 815,
        target: 770,
        status: 'OPEN',
        openedAt: '2026-10-09T09:10:00.000Z',
        updatedAt: '2026-10-09T09:20:00.000Z'
      },
      {
        quoteContext: {
          price: 790,
          timestamp: '2026-10-09T09:20:00.000Z', // 40 minutes old relative to nowMs
          dataReady: true
        },
        nowMs
      }
    );

    assert.equal(staleVal.isStale, true);
    assert.equal(staleVal.freshness, 'STALE');
    assert.equal(staleVal.valuationStatus, 'STALE_QUOTE');
    assert.equal(staleVal.lastValidPrice, 790);
    assert.equal(staleVal.quoteTimestamp, '2026-10-09T09:20:00.000Z');
    assert.equal(staleVal.unrealizedNetPnl, 100); // (800 - 790) * 10
    assert.equal(staleVal.riskStatus, 'STALE_VALUATION');

    // 3. Unavailable quote -> marks QUOTE_UNAVAILABLE, preserves last valid price on position without inventing synthetic price
    const unavailVal = PortfolioEngine.evaluateOpenPositionValuation(
      {
        id: 'POS-EQ-2',
        symbol: 'INFY',
        exchange: 'NSE',
        direction: 'BUY',
        assetType: 'EQUITY',
        qty: 5,
        effectiveQty: 5,
        entry: 1800,
        current: 1810,
        stop: 1780,
        target: 1850,
        status: 'OPEN',
        updatedAt: '2026-10-09T09:40:00.000Z'
      },
      {
        quoteContext: {
          price: null,
          status: 'QUOTE_UNAVAILABLE',
          priceUnavailable: true,
          timestamp: '2026-10-09T09:40:00.000Z'
        },
        nowMs
      }
    );

    assert.equal(unavailVal.isQuoteUnavailable, true);
    assert.equal(unavailVal.isStale, true);
    assert.equal(unavailVal.valuationStatus, 'QUOTE_UNAVAILABLE');
    assert.equal(unavailVal.validatedPrice, null);
    assert.equal(unavailVal.lastValidPrice, 1810);
    assert.equal(unavailVal.riskStatus, 'QUOTE_UNAVAILABLE');
  });

  test('120. Task 11 Performance Analytics, Profit Factor Edge Cases, Expectancy, Drawdown, Exit-Reason Attribution & Filters', () => {
    // 1. Insufficient history (0 closed trades) -> returns null / INSUFFICIENT_DATA, never fabricated metrics
    const noHistory = PortfolioEngine.calculatePerformanceAnalytics([], {
      initialCapital: 100000
    });
    assert.equal(noHistory.status, 'INSUFFICIENT_DATA');
    assert.equal(noHistory.hasSufficientHistory, false);
    assert.equal(noHistory.winRate, null);
    assert.equal(noHistory.profitFactor, null);
    assert.equal(noHistory.expectancy, null);
    assert.equal(noHistory.maxDrawdown, null);
    assert.equal(noHistory.equityCurve.length, 0);

    // 2. Only winning trades (grossLoss = 0) -> profitFactor is null with status NO_LOSING_TRADES (no division by zero or Infinity)
    const onlyWins = PortfolioEngine.calculatePerformanceAnalytics(
      [
        {
          id: 'T1',
          symbol: 'NIFTY 50',
          direction: 'BUY',
          quantity: 5,
          entry: 25000,
          exit: 25040,
          pnl: 200,
          reason: 'TARGET_EXIT',
          closedAt: '2026-10-08T10:00:00.000Z'
        }
      ],
      { initialCapital: 100000 }
    );
    assert.equal(onlyWins.winRate, 100);
    assert.equal(onlyWins.profitFactor, null);
    assert.equal(onlyWins.profitFactorStatus, 'NO_LOSING_TRADES');
    assert.equal(onlyWins.expectancy, 200);
    assert.equal(onlyWins.maxDrawdown, 0);

    // 3. Full chronological closed-trade sequence with wins, losses, drawdown, streaks & all exit reasons
    const sampleTrades = [
      {
        id: 'T1',
        symbol: 'NIFTY 50',
        direction: 'BUY',
        quantity: 5,
        entry: 25000,
        exit: 25100,
        stop: 24950,
        target: 25100,
        pnl: 500, // Equity -> 100,500 (Peak = 100,500)
        reason: 'TARGET_EXIT',
        closedAt: '2026-10-07T10:00:00.000Z'
      },
      {
        id: 'T2',
        symbol: 'RELIANCE',
        direction: 'BUY',
        quantity: 10,
        entry: 2000,
        exit: 1970,
        stop: 1970,
        target: 2060,
        pnl: -300, // Equity -> 100,200 (DD = 300)
        reason: 'STOP_LOSS',
        closedAt: '2026-10-07T11:00:00.000Z'
      },
      {
        id: 'T3',
        symbol: 'SBIN',
        direction: 'SELL',
        quantity: 10,
        entry: 800,
        exit: 820,
        stop: 820,
        target: 760,
        pnl: -200, // Equity -> 100,000 (DD = 500 from peak 100,500)
        reason: 'RISK_LOCK',
        closedAt: '2026-10-08T10:00:00.000Z'
      },
      {
        id: 'T4',
        symbol: 'TCS',
        direction: 'BUY',
        quantity: 5,
        entry: 4000,
        exit: 4100,
        stop: 3960,
        target: 4120,
        pnl: 500, // Equity -> 100,500
        reason: 'PROFIT_LOCK',
        closedAt: '2026-10-08T14:00:00.000Z'
      },
      {
        id: 'T5',
        symbol: 'INFY',
        direction: 'BUY',
        quantity: 5,
        entry: 1800,
        exit: 1840,
        stop: 1780,
        target: 1860,
        pnl: 200, // Equity -> 100,700
        reason: 'MANUAL',
        closedAt: '2026-10-09T09:30:00.000Z'
      }
    ];

    const perf = PortfolioEngine.calculatePerformanceAnalytics(sampleTrades, {
      initialCapital: 100000
    });

    assert.equal(perf.status, 'READY');
    assert.equal(perf.closedTradeCount, 5);
    assert.equal(perf.winningTrades, 3);
    assert.equal(perf.losingTrades, 2);
    assert.equal(perf.winRate, 60); // 3 / 5 = 60%
    assert.equal(perf.grossProfit, 1200); // 500 + 500 + 200
    assert.equal(perf.grossLoss, -500); // -300 + -200
    assert.equal(perf.profitFactor, 2.4); // 1200 / 500 = 2.40
    assert.equal(perf.profitFactorStatus, 'VALID');
    assert.equal(perf.averageWin, 400); // 1200 / 3
    assert.equal(perf.averageLoss, -250); // -500 / 2
    assert.equal(perf.expectancy, 140); // 700 / 5
    assert.equal(perf.maxDrawdown, 500); // 100,500 -> 100,000
    assert.equal(perf.maxConsecutiveWins, 2);
    assert.equal(perf.maxConsecutiveLosses, 2);
    assert.equal(perf.exitReasonBreakdown.TARGET_EXIT.count, 1);
    assert.equal(perf.exitReasonBreakdown.STOP_LOSS.count, 1);
    assert.equal(perf.exitReasonBreakdown.RISK_LOCK.count, 1);
    assert.equal(perf.exitReasonBreakdown.PROFIT_LOCK.count, 1);
    assert.equal(perf.exitReasonBreakdown.MANUAL.count, 1);
    assert.equal(perf.dailyPnlHistory.length, 3); // 2026-10-07, 2026-10-08, 2026-10-09

    // 4. Filter by symbol, outcome, reason, and date range
    const bySymbol = PortfolioEngine.filterTrades(sampleTrades, { symbol: 'RELIANCE' });
    assert.equal(bySymbol.length, 1);
    assert.equal(bySymbol[0].id, 'T2');

    const winsOnly = PortfolioEngine.filterTrades(sampleTrades, { status: 'WIN' });
    assert.equal(winsOnly.length, 3);

    const byDate = PortfolioEngine.filterTrades(sampleTrades, {
      fromDate: '2026-10-08',
      toDate: '2026-10-08'
    });
    assert.equal(byDate.length, 2);
  });

  test('121. Task 11 Multi-User Portfolio Isolation, Authoritative Server Endpoints, Duplicate Close Protection & CSRF', async () => {
    serverDb.resetAllTablesForTest();
    AuditLogger.resetEmergencyStop('Clean state for Test 121');
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // Register User A and User B
    const regA = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000'
      },
      body: JSON.stringify({
        name: 'Portfolio Trader A',
        email: 'port-a@example.com',
        password: 'Password123'
      })
    });
    assert.equal(regA.status, 201);
    const cookieA = regA.headers['set-cookie'][0].split(';')[0];
    const csrfA = regA.json.csrfToken;
    const userIdA = regA.json.user.userId;

    const regB = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000'
      },
      body: JSON.stringify({
        name: 'Portfolio Trader B',
        email: 'port-b@example.com',
        password: 'Password123'
      })
    });
    assert.equal(regB.status, 201);
    const cookieB = regB.headers['set-cookie'][0].split(';')[0];
    const csrfB = regB.json.csrfToken;
    const userIdB = regB.json.user.userId;

    // 1. User A opens a position on RELIANCE and closes it for +₹400 profit
    const openA1 = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        symbol: 'RELIANCE',
        exchange: 'NSE',
        direction: 'BUY',
        entry: 2000,
        stop: 1960,
        target: 2080,
        qty: 10
      })
    });
    assert.equal(openA1.status, 200);
    const posIdA1 = openA1.json.positionId;

    const closeA1 = await requestServer(server, '/api/paper/close', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        positionId: posIdA1,
        exitPrice: 2040,
        reason: 'TARGET_EXIT'
      })
    });
    assert.equal(closeA1.status, 200);
    assert.equal(closeA1.json.pnl, 400);

    // 2. Duplicate close attempt on already-closed position is rejected (never double-counts P&L)
    const dupClose = await requestServer(server, '/api/paper/close', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        positionId: posIdA1,
        exitPrice: 2040,
        reason: 'MANUAL'
      })
    });
    assert.ok(dupClose.status === 404 || dupClose.status === 400);
    assert.equal(dupClose.json.ok, false);

    assert.throws(
      () =>
        serverDb.recordClosePositionTransaction({
          userId: userIdA,
          positionId: posIdA1,
          symbol: 'RELIANCE',
          direction: 'BUY',
          effectiveQty: 10,
          entry: 2000,
          exitPrice: 2040,
          stop: 1960,
          target: 2080,
          pnl: 400,
          reason: 'MANUAL'
        }),
      (err) => err.code === 'POSITION_ALREADY_CLOSED'
    );

    // 3. User A opens a second position on SBIN (remains OPEN)
    const openA2 = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        symbol: 'SBIN',
        exchange: 'NSE',
        direction: 'BUY',
        entry: 800,
        stop: 780,
        target: 840,
        qty: 10
      })
    });
    assert.equal(openA2.status, 200);

    // Update SBIN price to 815 (+₹150 unrealized P&L)
    await requestServer(server, '/api/paper/price-update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        price: 815,
        autoExit: false
      })
    });

    // 4. Verify User A's Portfolio Summary, Positions, Performance & History endpoints
    const sumA = await requestServer(server, '/api/portfolio/summary', {
      method: 'GET',
      headers: { Cookie: cookieA }
    });
    assert.equal(sumA.status, 200);
    assert.equal(sumA.json.ok, true);
    assert.equal(sumA.json.userId, userIdA);
    assert.equal(sumA.json.summary.initialCapital, 100000);
    assert.equal(sumA.json.summary.realizedPnl, 400);
    assert.equal(sumA.json.summary.reservedCapital, 8000); // 800 * 10
    assert.equal(sumA.json.summary.availableBalance, 92400); // 100000 + 400 - 8000
    assert.equal(sumA.json.summary.unrealizedPnl, 150); // (815 - 800) * 10
    assert.equal(sumA.json.summary.totalEquity, 100550); // 100000 + 400 + 150
    assert.equal(sumA.json.summary.openPositionCount, 1);
    assert.equal(sumA.json.summary.closedTradeCount, 1);
    assert.equal(sumA.json.summary.accountingConsistent, true);

    const posResA = await requestServer(server, '/api/portfolio/positions', {
      method: 'GET',
      headers: { Cookie: cookieA }
    });
    assert.equal(posResA.status, 200);
    assert.equal(posResA.json.openPositionCount, 1);
    assert.equal(posResA.json.openPosition.symbol, 'SBIN');
    assert.equal(posResA.json.openPosition.unrealizedNetPnl, 150);

    const perfResA = await requestServer(server, '/api/portfolio/performance', {
      method: 'GET',
      headers: { Cookie: cookieA }
    });
    assert.equal(perfResA.status, 200);
    assert.equal(perfResA.json.performance.closedTradeCount, 1);
    assert.equal(perfResA.json.performance.cumulativeRealizedPnl, 400);

    const histResA = await requestServer(server, '/api/portfolio/history?symbol=RELIANCE', {
      method: 'GET',
      headers: { Cookie: cookieA }
    });
    assert.equal(histResA.status, 200);
    assert.equal(histResA.json.filteredCount, 1);
    assert.equal(histResA.json.history[0].symbol, 'RELIANCE');

    // 5. User B's portfolio is 100% isolated (empty portfolio, ₹100,000 balance)
    const sumB = await requestServer(server, '/api/portfolio/summary', {
      method: 'GET',
      headers: { Cookie: cookieB }
    });
    assert.equal(sumB.status, 200);
    assert.equal(sumB.json.userId, userIdB);
    assert.equal(sumB.json.summary.realizedPnl, 0);
    assert.equal(sumB.json.summary.unrealizedPnl, 0);
    assert.equal(sumB.json.summary.reservedCapital, 0);
    assert.equal(sumB.json.summary.availableBalance, 100000);
    assert.equal(sumB.json.summary.openPositionCount, 0);
    assert.equal(sumB.json.summary.closedTradeCount, 0);
    assert.equal(sumB.json.summary.isEmptyPortfolio, true);

    // 6. Cross-user query param access is blocked with 403 FORBIDDEN_OWNERSHIP
    const crossRead = await requestServer(
      server,
      `/api/portfolio/summary?userId=${encodeURIComponent(userIdA)}`,
      {
        method: 'GET',
        headers: { Cookie: cookieB }
      }
    );
    assert.equal(crossRead.status, 403);
    assert.equal(crossRead.json.code, 'FORBIDDEN_OWNERSHIP');
  });

  test('122. Task 11 Portfolio View Model & UI DOM Verification', () => {
    const vm = PortfolioEngine.buildPortfolioViewModel({
      account: {
        capital: 100000,
        realizedPnl: 350,
        unrealizedPnl: -50,
        dailyPnl: 350,
        tradesToday: 2,
        wins: 1,
        losses: 0
      },
      openPosition: {
        id: 'POS-VM-1',
        symbol: 'NIFTY 50',
        exchange: 'NSE',
        direction: 'BUY',
        assetType: 'EQUITY',
        qty: 5,
        effectiveQty: 5,
        entry: 25000,
        current: 24990,
        stop: 24950,
        target: 25150,
        status: 'OPEN'
      },
      closedTrades: [
        {
          id: 'TRD-VM-1',
          symbol: 'TCS',
          direction: 'BUY',
          quantity: 5,
          entry: 4000,
          exit: 4070,
          stop: 3960,
          target: 4080,
          pnl: 350,
          reason: 'TARGET_EXIT',
          closedAt: '2026-10-09T09:30:00.000Z'
        }
      ]
    });

    assert.equal(vm.mode, 'PAPER');
    assert.equal(vm.liveTradingEnabled, false);
    assert.equal(vm.kpis.initialCapital, '₹1,00,000.00');
    assert.equal(vm.kpis.realizedPnl, '+₹350.00');
    assert.equal(vm.kpis.unrealizedPnl, '-₹50.00');
    assert.equal(vm.kpis.totalEquity, '₹1,00,300.00');

    const htmlPath = path.resolve(__dirname, '../web/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    const requiredPortfolioIds = [
      'positionsPage',
      'portfolioRefreshBtn',
      'portKpiInitialCapital',
      'portKpiTotalEquity',
      'portKpiAvailableBalance',
      'portKpiReservedCapital',
      'portKpiRealizedPnl',
      'portKpiOverallReturnPct',
      'portKpiTodayPnl',
      'portKpiClosedTrades',
      'portKpiWinRate',
      'portKpiProfitFactor',
      'portKpiExpectancy',
      'portKpiAvgWinLoss',
      'portKpiMaxDrawdown',
      'portKpiDataAvailability',
      'positionsDetailPanel',
      'posViewQuoteFreshness',
      'posViewRiskStatus',
      'portfolioHoldingsTableContainer',
      'portfolioEquityChartEmpty',
      'portfolioEquityChartContainer',
      'portfolioEquitySvg',
      'portfolioExitReasonList',
      'portfolioFilterSymbol',
      'portfolioFilterStatus',
      'portfolioFilterReason',
      'portfolioFilterFromDate',
      'portfolioFilterToDate',
      'portfolioApplyFilterBtn',
      'portfolioResetFilterBtn',
      'portfolioDailyPnlList',
      'portfolioClosedTradesList'
    ];

    for (const id of requiredPortfolioIds) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Task 11 Portfolio Management UI element id="${id}"`
      );
    }
  });

  /* =====================================================
     TASK 12 — COMPLETE ORDERS, VIRTUAL FILLS & TRADE HISTORY TESTS
     (Tests 123–128)
  ===================================================== */

  test('123. Task 12 Order Lifecycle, Virtual Fill-to-Order Linking, Closed Trade Entry/Exit Linking & Option Contract Enrichment', () => {
    PaperTrading.resetState();

    // 1. Open an OPTION paper position (NIFTY28NOV2425000CE, NFO, lotSize=25, lots=2 -> effectiveQty=50)
    const opened = PaperTrading.openPosition({
      clientOrderKey: 'CLIENT-ORD-KEY-OPT-1',
      symbol: 'NIFTY28NOV2425000CE',
      exchange: 'NFO',
      direction: 'BUY',
      assetType: 'OPTION',
      lotSize: 25,
      lots: 2,
      entry: 150,
      stop: 142, // risk = 8 * 50 = ₹400 <= ₹500
      target: 170,
      exitOnTarget: true
    });
    assert.equal(opened.ok, true);
    assert.ok(opened.orderId);
    assert.ok(opened.fillId);
    assert.ok(opened.positionId);

    // 2. While position is OPEN, closed trade history must NOT include open position
    const openState = PaperTrading.getState();
    const openSnap = OrderTradeHistoryEngine.buildOrderTradeHistorySnapshot({
      orders: openState.orders,
      fills: openState.fills,
      trades: openState.history,
      openPosition: openState.position
    });
    assert.equal(openSnap.ok, true);
    assert.equal(openSnap.summary.totalOrders, 1);
    assert.equal(openSnap.summary.totalFills, 1);
    assert.equal(openSnap.summary.totalClosedTrades, 0);
    assert.equal(openSnap.trades.length, 0);

    // Verify ENTRY order & fill enrichment and option contract details
    const entryOrd = openSnap.orders[0];
    assert.equal(entryOrd.orderId, opened.orderId);
    assert.equal(entryOrd.fillId, opened.fillId);
    assert.equal(entryOrd.positionId, opened.positionId);
    assert.equal(entryOrd.status, 'FILLED_PAPER');
    assert.equal(entryOrd.brokerExecution, 'NONE (SIMULATED_PAPER)');
    assert.equal(entryOrd.isOption, true);
    assert.equal(entryOrd.optionType, 'CE');
    assert.equal(entryOrd.strikePrice, 25000);
    assert.equal(entryOrd.expiry, '28NOV24');
    assert.equal(entryOrd.lotSize, 25);
    assert.equal(entryOrd.lots, 2);
    assert.equal(entryOrd.quantity, 50);

    const entryFill = openSnap.fills[0];
    assert.equal(entryFill.fillId, opened.fillId);
    assert.equal(entryFill.orderId, opened.orderId);
    assert.equal(entryFill.positionId, opened.positionId);
    assert.equal(entryFill.entryOrExit, 'ENTRY');
    assert.equal(entryFill.fillPrice, 150);
    assert.equal(entryFill.brokerExecution, 'NONE (SIMULATED_PAPER)');

    // 3. Close the option position at 166 -> +₹800 profit (2.0R)
    const closed = PaperTrading.closePosition(166, 'TARGET_EXIT');
    assert.equal(closed.ok, true);
    assert.equal(closed.pnl, 800);

    const closedState = PaperTrading.getState();
    const closedSnap = OrderTradeHistoryEngine.buildOrderTradeHistorySnapshot({
      orders: closedState.orders,
      fills: closedState.fills,
      trades: closedState.history,
      openPosition: closedState.position
    });
    assert.equal(closedSnap.summary.totalOrders, 2);
    assert.equal(closedSnap.summary.totalFills, 2);
    assert.equal(closedSnap.summary.totalClosedTrades, 1);

    const trd = closedSnap.trades[0];
    assert.equal(trd.positionId, opened.positionId);
    assert.equal(trd.entryOrderId, opened.orderId);
    assert.equal(trd.exitOrderId, closed.exitOrder.orderId);
    assert.equal(trd.entryFillId, opened.fillId);
    assert.equal(trd.exitFillId, closed.exitFill.fillId);
    assert.equal(trd.grossPnl, 800);
    assert.equal(trd.fees, 0);
    assert.equal(trd.netPnl, 800);
    assert.equal(trd.initialRiskAmount, 400);
    assert.equal(trd.rMultiple, 2);
    assert.equal(trd.rMultipleFormatted, '+2.00R');
    assert.equal(trd.exitReason, 'TARGET_EXIT');
    assert.equal(trd.brokerExecution, 'NONE');
  });

  test('124. Task 12 Rejected Orders Excluded from Executed Fills/Trades, Duplicate Order Prevention & Duplicate Close Prevention', () => {
    PaperTrading.resetState();

    // 1. Submit an order that violates ₹500 per-trade risk limit with recordRejectedOrder=true
    const rejected = PaperTrading.openPosition({
      symbol: 'RELIANCE',
      exchange: 'NSE',
      direction: 'BUY',
      entry: 2500,
      stop: 2400, // risk = 100 * 10 = ₹1,000 > ₹500
      target: 2700,
      qty: 10,
      recordRejectedOrder: true
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'MAX_LOSS_PER_TRADE_EXCEEDED');

    const pStateAfterRej = PaperTrading.getState();
    assert.equal(pStateAfterRej.position, null);
    assert.equal(pStateAfterRej.orders.length, 1);
    assert.equal(pStateAfterRej.orders[0].status, 'REJECTED');
    assert.equal(pStateAfterRej.fills.length, 0); // Rejected order NEVER creates a virtual fill
    assert.equal(pStateAfterRej.history.length, 0); // Rejected order NEVER creates a closed trade

    // 2. Valid order with clientOrderKey='IDEMPOTENT-KEY-1'
    const valid1 = PaperTrading.openPosition({
      clientOrderKey: 'IDEMPOTENT-KEY-1',
      symbol: 'TCS',
      exchange: 'NSE',
      direction: 'BUY',
      entry: 4000,
      stop: 3960,
      target: 4080,
      qty: 5
    });
    assert.equal(valid1.ok, true);
    PaperTrading.closePosition(4050, 'MANUAL');

    // 3. Duplicate clientOrderKey is rejected and never creates duplicate orders or positions
    const dupOrderAttempt = PaperTrading.openPosition({
      clientOrderKey: 'IDEMPOTENT-KEY-1',
      symbol: 'TCS',
      exchange: 'NSE',
      direction: 'BUY',
      entry: 4000,
      stop: 3960,
      target: 4080,
      qty: 5
    });
    assert.equal(dupOrderAttempt.ok, false);
    assert.equal(dupOrderAttempt.code, 'DUPLICATE_ORDER_REQUEST');

    // 4. Closing when no open position exists is rejected and does not double-count realized P&L
    const secondCloseAttempt = PaperTrading.closePosition(4050, 'MANUAL');
    assert.equal(secondCloseAttempt.ok, false);
    assert.equal(secondCloseAttempt.code, 'NO_OPEN_POSITION');
    assert.equal(PaperTrading.getState().realizedPnl, 250);
  });

  test('125. Task 12 Search, Filters, Pagination, Stable Chronological Sorting & Parameter Validation', () => {
    const sampleOrders = [
      {
        orderId: 'ORD-101',
        type: 'ENTRY',
        symbol: 'RELIANCE',
        exchange: 'NSE',
        direction: 'BUY',
        quantity: 10,
        price: 2000,
        stop: 1980,
        target: 2040,
        status: 'FILLED_PAPER',
        timestamp: '2026-10-08T10:00:00.000Z'
      },
      {
        orderId: 'ORD-102',
        type: 'EXIT',
        symbol: 'RELIANCE',
        exchange: 'NSE',
        direction: 'SELL',
        quantity: 10,
        price: 2040,
        stop: 1980,
        target: 2040,
        status: 'FILLED_PAPER',
        reason: 'TARGET_EXIT',
        timestamp: '2026-10-08T10:30:00.000Z'
      },
      {
        orderId: 'ORD-103',
        type: 'ENTRY',
        symbol: 'BANKNIFTY28NOV2451000PE',
        exchange: 'NFO',
        direction: 'BUY',
        assetType: 'OPTION',
        quantity: 15,
        price: 300,
        stop: 250,
        target: 400,
        status: 'REJECTED',
        rejectionReason: 'Trade risk exceeds ₹500 limit.',
        timestamp: '2026-10-09T09:15:00.000Z'
      },
      {
        orderId: 'ORD-104',
        type: 'ENTRY',
        symbol: 'TCS',
        exchange: 'NSE',
        direction: 'SELL',
        quantity: 5,
        price: 4000,
        stop: 4040,
        target: 3920,
        status: 'FILLED_PAPER',
        timestamp: '2026-10-09T09:15:00.000Z' // Same timestamp as ORD-103 -> deterministic tie-breaker on orderId
      }
    ];

    const sampleTrades = [
      {
        id: 'TRD-201',
        positionId: 'POS-1',
        entryOrderId: 'ORD-101',
        exitOrderId: 'ORD-102',
        symbol: 'RELIANCE',
        exchange: 'NSE',
        direction: 'BUY',
        quantity: 10,
        entry: 2000,
        exit: 2040,
        stop: 1980,
        target: 2040,
        grossPnl: 400,
        fees: 10,
        pnl: 390,
        reason: 'TARGET_EXIT',
        openedAt: '2026-10-08T10:00:00.000Z',
        closedAt: '2026-10-08T10:30:00.000Z'
      },
      {
        id: 'TRD-202',
        positionId: 'POS-2',
        symbol: 'TCS',
        exchange: 'NSE',
        direction: 'SELL',
        quantity: 5,
        entry: 4000,
        exit: 4040,
        stop: 4040,
        target: 3920,
        grossPnl: -200,
        fees: 5,
        pnl: -205,
        reason: 'STOP_LOSS',
        openedAt: '2026-10-09T09:15:00.000Z',
        closedAt: '2026-10-09T09:45:00.000Z'
      }
    ];

    // 1. Stable tie-breaker sorting (timestamp DESC, orderId DESC)
    const snapAll = OrderTradeHistoryEngine.buildOrderTradeHistorySnapshot({
      orders: sampleOrders,
      fills: [],
      trades: sampleTrades
    });
    assert.equal(snapAll.ok, true);
    assert.equal(snapAll.orders[0].orderId, 'ORD-104');
    assert.equal(snapAll.orders[1].orderId, 'ORD-103');
    assert.equal(snapAll.summary.totalGrossPnl, 200); // 400 - 200
    assert.equal(snapAll.summary.totalFees, 15); // 10 + 5
    assert.equal(snapAll.summary.totalNetPnl, 185); // 390 - 205
    assert.equal(snapAll.summary.accountingConsistent, true);

    // 2. Filter orders by status=REJECTED
    const snapRej = OrderTradeHistoryEngine.buildOrderTradeHistorySnapshot({
      orders: sampleOrders,
      trades: sampleTrades,
      query: { status: 'REJECTED' }
    });
    assert.equal(snapRej.orders.length, 1);
    assert.equal(snapRej.orders[0].orderId, 'ORD-103');
    assert.equal(snapRej.orders[0].rejectionReason, 'Trade risk exceeds ₹500 limit.');

    // 3. Filter closed trades by outcome=LOSS and exitReason=STOP_LOSS
    const snapLoss = OrderTradeHistoryEngine.buildOrderTradeHistorySnapshot({
      orders: sampleOrders,
      trades: sampleTrades,
      query: { pnlResult: 'LOSS', exitReason: 'STOP_LOSS' }
    });
    assert.equal(snapLoss.trades.length, 1);
    assert.equal(snapLoss.trades[0].tradeId, 'TRD-202');

    // 4. Pagination (pageSize=2, page=2)
    const snapPage2 = OrderTradeHistoryEngine.buildOrderTradeHistorySnapshot({
      orders: sampleOrders,
      trades: sampleTrades,
      query: { page: 2, pageSize: 2 }
    });
    assert.equal(snapPage2.ordersPagination.page, 2);
    assert.equal(snapPage2.ordersPagination.totalPages, 2);
    assert.equal(snapPage2.orders.length, 2);
    assert.equal(snapPage2.orders[0].orderId, 'ORD-102');
    assert.equal(snapPage2.orders[1].orderId, 'ORD-101');

    // 5. Invalid query parameters (negative page, pageSize > 100, fromDate > toDate, invalid status)
    const badPage = OrderTradeHistoryEngine.validateAndNormalizeQuery({ page: 0 });
    assert.equal(badPage.ok, false);
    assert.equal(badPage.code, 'INVALID_QUERY_PARAMETERS');

    const badPageSize = OrderTradeHistoryEngine.validateAndNormalizeQuery({ pageSize: 500 });
    assert.equal(badPageSize.ok, false);

    const badDateRange = OrderTradeHistoryEngine.validateAndNormalizeQuery({
      fromDate: '2026-10-10',
      toDate: '2026-10-01'
    });
    assert.equal(badDateRange.ok, false);

    const badStatus = OrderTradeHistoryEngine.validateAndNormalizeQuery({
      status: 'LIVE_ANGEL_FILL'
    });
    assert.equal(badStatus.ok, false);
  });

  test('126. Task 12 Server Endpoints (/api/orders, /api/orders/fills, /api/trades/history), Multi-User Isolation & Invalid Filter Rejection', async () => {
    serverDb.resetAllTablesForTest();
    AuditLogger.resetEmergencyStop('Clean state for Test 126');
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // Register User A & User B
    const regA = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        name: 'Order History Trader A',
        email: 'orders-a@example.com',
        password: 'Password123'
      })
    });
    assert.equal(regA.status, 201);
    const cookieA = regA.headers['set-cookie'][0].split(';')[0];
    const csrfA = regA.json.csrfToken;
    const userIdA = regA.json.user.userId;

    const regB = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        name: 'Order History Trader B',
        email: 'orders-b@example.com',
        password: 'Password123'
      })
    });
    assert.equal(regB.status, 201);
    const cookieB = regB.headers['set-cookie'][0].split(';')[0];
    const csrfB = regB.json.csrfToken;

    // 1. User A submits a risk-violating order -> persisted as REJECTED order, 0 fills, 0 positions
    const rejRes = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        symbol: 'INFY',
        exchange: 'NSE',
        direction: 'BUY',
        entry: 1800,
        stop: 1700, // risk = 100 * 10 = ₹1,000 > ₹500
        target: 2000,
        qty: 10
      })
    });
    assert.equal(rejRes.status, 400);
    assert.equal(rejRes.json.orderStatus, 'REJECTED');
    assert.ok(rejRes.json.orderId);

    // 2. User A opens a valid position with clientOrderKey and closes it
    const openA = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        clientOrderKey: 'SRV-KEY-A-1',
        symbol: 'RELIANCE',
        exchange: 'NSE',
        direction: 'BUY',
        entry: 2000,
        stop: 1960,
        target: 2080,
        qty: 10
      })
    });
    assert.equal(openA.status, 200);
    const posIdA = openA.json.positionId;
    const entryOrderIdA = openA.json.orderId;
    const entryFillIdA = openA.json.fillId;

    // Duplicate clientOrderKey via /api/paper/open is rejected with 409 DUPLICATE_ORDER_REQUEST
    const closeA = await requestServer(server, '/api/paper/close', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        positionId: posIdA,
        exitPrice: 2050,
        reason: 'TARGET_EXIT'
      })
    });
    assert.equal(closeA.status, 200);
    const exitOrderIdA = closeA.json.exitOrderId;
    const exitFillIdA = closeA.json.fillId;
    const tradeIdA = closeA.json.tradeId;

    const dupKeyRes = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        clientOrderKey: 'SRV-KEY-A-1',
        symbol: 'RELIANCE',
        exchange: 'NSE',
        direction: 'BUY',
        entry: 2000,
        stop: 1960,
        target: 2080,
        qty: 10
      })
    });
    assert.equal(dupKeyRes.status, 409);
    assert.equal(dupKeyRes.json.code, 'DUPLICATE_ORDER_REQUEST');

    // 3. Query GET /api/orders for User A -> 3 orders (1 REJECTED + 1 ENTRY FILLED_PAPER + 1 EXIT FILLED_PAPER)
    const ordResA = await requestServer(server, '/api/orders', {
      headers: { Cookie: cookieA }
    });
    assert.equal(ordResA.status, 200);
    assert.equal(ordResA.json.ok, true);
    assert.equal(ordResA.json.summary.totalOrders, 3);
    assert.equal(ordResA.json.summary.filledOrdersCount, 2);
    assert.equal(ordResA.json.summary.rejectedOrdersCount, 1);

    // Filter GET /api/orders?status=REJECTED
    const ordRejA = await requestServer(server, '/api/orders?status=REJECTED', {
      headers: { Cookie: cookieA }
    });
    assert.equal(ordRejA.status, 200);
    assert.equal(ordRejA.json.orders.length, 1);
    assert.equal(ordRejA.json.orders[0].symbol, 'INFY');
    assert.equal(ordRejA.json.orders[0].status, 'REJECTED');

    // 4. Query GET /api/orders/fills for User A -> 2 virtual fills (strictly excludes rejected order)
    const fillsResA = await requestServer(server, '/api/orders/fills', {
      headers: { Cookie: cookieA }
    });
    assert.equal(fillsResA.status, 200);
    assert.equal(fillsResA.json.fills.length, 2);
    assert.ok(fillsResA.json.fills.some((f) => f.fillId === entryFillIdA && f.orderId === entryOrderIdA));
    assert.ok(fillsResA.json.fills.some((f) => f.fillId === exitFillIdA && f.orderId === exitOrderIdA));

    // 5. Query GET /api/trades/history for User A -> 1 closed trade with full entry/exit order & fill links
    const trdResA = await requestServer(server, '/api/trades/history', {
      headers: { Cookie: cookieA }
    });
    assert.equal(trdResA.status, 200);
    assert.equal(trdResA.json.trades.length, 1);
    const tA = trdResA.json.trades[0];
    assert.equal(tA.tradeId, tradeIdA);
    assert.equal(tA.positionId, posIdA);
    assert.equal(tA.entryOrderId, entryOrderIdA);
    assert.equal(tA.exitOrderId, exitOrderIdA);
    assert.equal(tA.entryFillId, entryFillIdA);
    assert.equal(tA.exitFillId, exitFillIdA);
    assert.equal(tA.netPnl, 500);
    assert.equal(tA.rMultiple, 1.25); // 500 / 400 = 1.25R

    // 6. User B sees 0 orders, 0 fills, 0 closed trades (strict multi-user isolation)
    const ordResB = await requestServer(server, '/api/orders', {
      headers: { Cookie: cookieB }
    });
    assert.equal(ordResB.status, 200);
    assert.equal(ordResB.json.orders.length, 0);

    const fillsResB = await requestServer(server, '/api/orders/fills', {
      headers: { Cookie: cookieB }
    });
    assert.equal(fillsResB.status, 200);
    assert.equal(fillsResB.json.fills.length, 0);

    const trdResB = await requestServer(server, '/api/trades/history', {
      headers: { Cookie: cookieB }
    });
    assert.equal(trdResB.status, 200);
    assert.equal(trdResB.json.trades.length, 0);

    // Cross-user access via ?userId= is forbidden (403)
    const crossOrders = await requestServer(
      server,
      `/api/orders?userId=${encodeURIComponent(userIdA)}`,
      { headers: { Cookie: cookieB } }
    );
    assert.equal(crossOrders.status, 403);
    assert.equal(crossOrders.json.code, 'FORBIDDEN_OWNERSHIP');

    // Invalid pagination/filter query returns 400 INVALID_QUERY_PARAMETERS
    const badFilter = await requestServer(server, '/api/orders?page=-1&pageSize=999', {
      headers: { Cookie: cookieA }
    });
    assert.equal(badFilter.status, 400);
    assert.equal(badFilter.json.code, 'INVALID_QUERY_PARAMETERS');
  });

  test('127. Task 12 Persistence Across Database Reconnect / Server Restart Simulation', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yashwin-task12-persist-'));
    const tmpDbFile = path.join(tmpDir, 'persist-test.sqlite');

    try {
      serverDb.closeDb();
      process.env.YASHWIN_DB_PATH = tmpDbFile;
      serverDb.getDb(tmpDbFile);

      const userId = 'USR-PERSIST-TASK12';
      serverDb.createUserRecord({
        userId,
        name: 'Persist Trader',
        email: 'persist-t12@example.com',
        passwordHash: '$2b$10$dummyhashvalueforpersistenctest1234567890'
      });

      const opened = serverDb.recordOpenPositionTransaction({
        id: 'POS-PERSIST-1',
        userId,
        orderId: 'ORD-PERSIST-ENTRY-1',
        fillId: 'FILL-PERSIST-ENTRY-1',
        clientOrderKey: 'PERSIST-KEY-1',
        symbol: 'SBIN',
        exchange: 'NSE',
        direction: 'BUY',
        assetType: 'EQUITY',
        qty: 10,
        effectiveQty: 10,
        entry: 800,
        stop: 780,
        target: 840,
        profitStep: 800,
        openedAt: '2026-10-09T09:15:00.000Z'
      });

      serverDb.recordClosePositionTransaction({
        userId,
        positionId: opened.positionId,
        entryOrderId: opened.orderId,
        entryFillId: opened.fillId,
        exitOrderId: 'ORD-PERSIST-EXIT-1',
        exitFillId: 'FILL-PERSIST-EXIT-1',
        tradeId: 'TRD-PERSIST-1',
        symbol: 'SBIN',
        exchange: 'NSE',
        direction: 'BUY',
        assetType: 'EQUITY',
        effectiveQty: 10,
        entry: 800,
        exitPrice: 830,
        stop: 780,
        target: 840,
        grossPnl: 300,
        fees: 0,
        pnl: 300,
        reason: 'TARGET_EXIT',
        openedAt: '2026-10-09T09:15:00.000Z',
        closedAt: '2026-10-09T09:45:00.000Z'
      });

      // Simulate server restart: close SQLite connection and reopen from disk
      serverDb.closeDb();
      serverDb.getDb(tmpDbFile);

      const ordersAfterRestart = serverDb.listPaperOrders(50, userId);
      const fillsAfterRestart = serverDb.listPaperFills(50, userId);
      const tradesAfterRestart = serverDb.listTradeHistory(50, userId);
      const acctAfterRestart = serverDb.getPaperAccount(userId);

      assert.equal(ordersAfterRestart.length, 2);
      assert.equal(fillsAfterRestart.length, 2);
      assert.equal(tradesAfterRestart.length, 1);
      assert.equal(tradesAfterRestart[0].tradeId, 'TRD-PERSIST-1');
      assert.equal(tradesAfterRestart[0].entryOrderId, 'ORD-PERSIST-ENTRY-1');
      assert.equal(tradesAfterRestart[0].exitOrderId, 'ORD-PERSIST-EXIT-1');
      assert.equal(tradesAfterRestart[0].entryFillId, 'FILL-PERSIST-ENTRY-1');
      assert.equal(tradesAfterRestart[0].exitFillId, 'FILL-PERSIST-EXIT-1');
      assert.equal(acctAfterRestart.realizedPnl, 300);
      assert.equal(acctAfterRestart.availableBalance, 100300);
    } finally {
      serverDb.closeDb();
      process.env.YASHWIN_DB_PATH = ':memory:';
      serverDb.getDb(':memory:');
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  test('128. Task 12 Orders, Virtual Fills & Trade History UI DOM Verification', () => {
    const htmlPath = path.resolve(__dirname, '../web/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    const requiredTask12Ids = [
      'ordersPage',
      'ordersBrokerExecBadge',
      'ordersRefreshBtn',
      'ordersLoadingBanner',
      'ordersErrorBanner',
      'ordersRetryBtn',
      'ordersKpiTotalOrders',
      'ordersKpiFilledVsRejected',
      'ordersKpiTotalFills',
      'ordersKpiTotalFees',
      'ordersFilterSymbol',
      'ordersFilterExchange',
      'ordersFilterDirection',
      'ordersFilterStatus',
      'ordersFilterType',
      'ordersFilterFromDate',
      'ordersFilterToDate',
      'ordersApplyFilterBtn',
      'ordersResetFilterBtn',
      'ordersCountPill',
      'ordersListContainer',
      'ordersPrevPageBtn',
      'ordersNextPageBtn',
      'ordersPaginationMeta',
      'fillsCountPill',
      'fillsListContainer',
      'historyPage',
      'historyTradesCount',
      'historyRefreshBtn',
      'historyLoadingBanner',
      'historyErrorBanner',
      'historyRetryBtn',
      'historyKpiClosedCount',
      'historyKpiWinLossBreakdown',
      'historyKpiGrossPnl',
      'historyKpiFeesTotal',
      'historyKpiNetPnl',
      'historyFilterSymbol',
      'historyFilterExchange',
      'historyFilterDirection',
      'historyFilterOutcome',
      'historyFilterExitReason',
      'historyFilterFromDate',
      'historyFilterToDate',
      'historyApplyFilterBtn',
      'historyResetFilterBtn',
      'tradeHistoryContainer',
      'historyPrevPageBtn',
      'historyNextPageBtn',
      'historyPaginationMeta',
      'auditLogContainer'
    ];

    for (const id of requiredTask12Ids) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Task 12 Orders/Fills/History UI element id="${id}"`
      );
    }

    assert.equal(
      html.includes('modules/order-trade-history-engine.js'),
      true,
      'web/index.html must load modules/order-trade-history-engine.js'
    );
  });

  /* ==============================================================
     TASK 13 — COMPLETE DETERMINISTIC BACKTESTING ENGINE TESTS
  ============================================================== */

  test('129. Task 13 Backtester Historical Candle & Parameter Validation (Timeframes, OHLC, Duplicates, Future Dates, Date Range)', () => {
    assert.deepEqual(Object.keys(Backtester.SUPPORTED_TIMEFRAMES), [
      'ONE_MINUTE',
      'THREE_MINUTE',
      'FIVE_MINUTE',
      'TEN_MINUTE',
      'FIFTEEN_MINUTE',
      'THIRTY_MINUTE',
      'ONE_HOUR',
      'ONE_DAY'
    ]);

    // 1. Unsupported timeframe rejection
    assert.throws(
      () =>
        Backtester.run({
          symbol: 'NIFTY 50',
          exchange: 'NSE',
          timeframe: 'TWO_MINUTE',
          candles: [
            { timestamp: '2026-10-01T09:15:00.000Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 },
            { timestamp: '2026-10-01T09:20:00.000Z', open: 102, high: 106, low: 100, close: 104, volume: 1200 }
          ]
        }),
      (err) => err.code === 'INVALID_BACKTEST_TIMEFRAME'
    );

    // 2. Reversed date range rejection
    assert.throws(
      () =>
        Backtester.run({
          symbol: 'NIFTY 50',
          exchange: 'NSE',
          timeframe: 'FIVE_MINUTE',
          fromDate: '2026-10-05',
          toDate: '2026-10-01',
          candles: [
            { timestamp: '2026-10-01T09:15:00.000Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 },
            { timestamp: '2026-10-01T09:20:00.000Z', open: 102, high: 106, low: 100, close: 104, volume: 1200 }
          ]
        }),
      (err) => err.code === 'INVALID_BACKTEST_DATE_RANGE'
    );

    // 3. Malformed OHLC (high < low) rejection
    assert.throws(
      () =>
        Backtester.run({
          symbol: 'NIFTY 50',
          exchange: 'NSE',
          timeframe: 'FIVE_MINUTE',
          candles: [
            { timestamp: '2026-10-01T09:15:00.000Z', open: 100, high: 95, low: 98, close: 102, volume: 1000 },
            { timestamp: '2026-10-01T09:20:00.000Z', open: 102, high: 106, low: 100, close: 104, volume: 1200 }
          ]
        }),
      (err) => err.code === 'INVALID_BACKTEST_CANDLE'
    );

    // 4. Duplicate timestamp rejection
    assert.throws(
      () =>
        Backtester.run({
          symbol: 'NIFTY 50',
          exchange: 'NSE',
          timeframe: 'FIVE_MINUTE',
          candles: [
            { timestamp: '2026-10-01T09:15:00.000Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 },
            { timestamp: '2026-10-01T09:15:00.000Z', open: 102, high: 106, low: 100, close: 104, volume: 1200 }
          ]
        }),
      (err) => err.code === 'DUPLICATE_BACKTEST_CANDLE_TIMESTAMP'
    );

    // 5. Out-of-order candle timestamp rejection
    assert.throws(
      () =>
        Backtester.run({
          symbol: 'NIFTY 50',
          exchange: 'NSE',
          timeframe: 'FIVE_MINUTE',
          candles: [
            { timestamp: '2026-10-01T09:20:00.000Z', open: 102, high: 106, low: 100, close: 104, volume: 1200 },
            { timestamp: '2026-10-01T09:15:00.000Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 }
          ]
        }),
      (err) => err.code === 'UNSORTED_BACKTEST_SERIES'
    );

    // 6. Future-dated candle rejection when rejectFutureTimestamps=true
    const nowRef = Date.parse('2026-10-01T12:00:00.000Z');
    assert.throws(
      () =>
        Backtester.run({
          symbol: 'NIFTY 50',
          exchange: 'NSE',
          timeframe: 'ONE_DAY',
          nowMs: nowRef,
          rejectFutureTimestamps: true,
          candles: [
            { timestamp: '2026-10-01T09:15:00.000Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 },
            { timestamp: '2026-10-02T09:15:00.000Z', open: 102, high: 106, low: 100, close: 104, volume: 1200 }
          ]
        }),
      (err) => err.code === 'FUTURE_BACKTEST_TIMESTAMP'
    );
  });

  test('130. Task 13 Chronological Zero Look-Ahead Invariance Proof (Appending Future Candles Never Changes Earlier Decisions)', () => {
    const baseCandles = [
      {
        timestamp: '2026-10-01T09:15:00.000Z',
        open: 25000,
        high: 25040,
        low: 24980,
        close: 25020,
        volume: 100000
      },
      {
        timestamp: '2026-10-01T09:20:00.000Z',
        open: 25020,
        high: 25280,
        low: 25010,
        close: 25260,
        volume: 250000,
        indicators: {
          trendScore: 95,
          momentumScore: 90,
          volumeScore: 85,
          vwapScore: 85,
          supportResistanceScore: 85,
          optionsScore: 80,
          newsScore: 70,
          breadthScore: 80,
          volatilityScore: 20
        }
      },
      {
        timestamp: '2026-10-01T09:25:00.000Z',
        open: 25260,
        high: 25560,
        low: 25240,
        close: 25540,
        volume: 300000
      }
    ];

    const extendedCandles = [
      ...baseCandles,
      {
        timestamp: '2026-10-01T09:30:00.000Z',
        open: 25540,
        high: 25600,
        low: 24100, // huge crash on bar 3 (after trade 1 already closed on bar 2)
        close: 24150,
        volume: 900000
      }
    ];

    const runShort = Backtester.run({
      symbol: 'NIFTY 50',
      exchange: 'NSE',
      timeframe: 'FIVE_MINUTE',
      quantity: 1,
      candles: baseCandles
    });

    const runExtended = Backtester.run({
      symbol: 'NIFTY 50',
      exchange: 'NSE',
      timeframe: 'FIVE_MINUTE',
      quantity: 1,
      candles: extendedCandles
    });

    assert.equal(runShort.ok, true);
    assert.equal(runExtended.ok, true);
    assert.equal(runShort.trades.length, 1);
    assert.ok(runExtended.trades.length >= 1);

    // Trade #1 opened on bar 1 and closed on bar 2 must be 100% identical regardless of bar 3
    assert.equal(runShort.trades[0].openedAt, runExtended.trades[0].openedAt);
    assert.equal(runShort.trades[0].closedAt, runExtended.trades[0].closedAt);
    assert.equal(runShort.trades[0].entry, runExtended.trades[0].entry);
    assert.equal(runShort.trades[0].exitPrice, runExtended.trades[0].exitPrice);
    assert.equal(runShort.trades[0].pnl, runExtended.trades[0].pnl);
    assert.equal(runShort.trades[0].reason, runExtended.trades[0].reason);
    assert.equal(runShort.trades[0].entryBarIndex, 1);
    assert.equal(runShort.trades[0].exitBarIndex, 2);
  });

  test('131. Task 13 Conservative Same-Candle Ambiguity (SL + Target Hit in Same Bar -> STOP_LOSS Wins) & NEXT_CANDLE_OPEN Gap Model', () => {
    const bullishIndicators = {
      trendScore: 95,
      momentumScore: 90,
      volumeScore: 85,
      vwapScore: 85,
      supportResistanceScore: 85,
      optionsScore: 80,
      newsScore: 70,
      breadthScore: 80,
      volatilityScore: 20
    };

    // Bar 1 triggers BUY at ~25000 (SL ~24875, Target ~25250).
    // Bar 2 has a huge range: low=24800 (hits SL) AND high=25400 (hits Target).
    // Conservative rule: STOP_LOSS must win and ambiguousCandle must be true!
    const ambiguousCandles = [
      {
        timestamp: '2026-10-01T09:15:00.000Z',
        open: 24990,
        high: 25010,
        low: 24980,
        close: 25000,
        volume: 100000
      },
      {
        timestamp: '2026-10-01T09:20:00.000Z',
        open: 25000,
        high: 25020,
        low: 24990,
        close: 25000,
        volume: 200000,
        indicators: bullishIndicators
      },
      {
        timestamp: '2026-10-01T09:25:00.000Z',
        open: 25000,
        high: 25400, // breaches Target
        low: 24800,  // breaches Stop-Loss
        close: 25300,
        volume: 300000
      }
    ];

    const ambResult = Backtester.run({
      symbol: 'NIFTY 50',
      exchange: 'NSE',
      timeframe: 'FIVE_MINUTE',
      quantity: 1,
      feePerTrade: 0,
      slippagePerUnit: 0,
      candles: ambiguousCandles
    });

    assert.equal(ambResult.ok, true);
    assert.equal(ambResult.trades.length, 1);
    assert.equal(ambResult.trades[0].reason, 'STOP_LOSS');
    assert.equal(ambResult.trades[0].ambiguousCandle, true);
    assert.equal(ambResult.metrics.ambiguousExecutionsCount, 1);
    assert.ok(ambResult.trades[0].pnl < 0);

    // Test NEXT_CANDLE_OPEN execution model with an opening gap
    const nextOpenCandles = [
      {
        timestamp: '2026-10-01T09:15:00.000Z',
        open: 24990,
        high: 25010,
        low: 24980,
        close: 25000,
        volume: 100000
      },
      {
        timestamp: '2026-10-01T09:20:00.000Z',
        open: 25000,
        high: 25020,
        low: 24990,
        close: 25000,
        volume: 200000,
        indicators: bullishIndicators
      },
      {
        timestamp: '2026-10-01T09:25:00.000Z',
        open: 25050, // gaps up 50 pts from signal close 25000
        high: 25350, // hits gap-adjusted target (25050 + 250 = 25300)
        low: 25040,
        close: 25320,
        volume: 300000
      }
    ];

    const nextOpenRes = Backtester.run({
      symbol: 'NIFTY 50',
      exchange: 'NSE',
      timeframe: 'FIVE_MINUTE',
      entryFillModel: 'NEXT_CANDLE_OPEN',
      quantity: 1,
      feePerTrade: 20,
      slippagePerUnit: 0.5,
      candles: nextOpenCandles
    });

    assert.equal(nextOpenRes.ok, true);
    assert.equal(nextOpenRes.trades.length, 1);
    assert.equal(nextOpenRes.trades[0].entry, 25050);
    assert.equal(nextOpenRes.trades[0].reason, 'TARGET');
    assert.equal(nextOpenRes.trades[0].exitPrice, 25300);
  });

  test('132. Task 13 RiskEngine Enforcement in Backtester (Max ₹500 Loss/Trade, ₹1,000 Daily Loss Lock, Max 3 Trades/Day, Max 1 Open Position)', () => {
    const bullishIndicators = {
      trendScore: 95,
      momentumScore: 90,
      volumeScore: 85,
      vwapScore: 85,
      supportResistanceScore: 85,
      optionsScore: 80,
      newsScore: 70,
      breadthScore: 80,
      volatilityScore: 20
    };

    // 1. Quantity/Lot size exceeding ₹500 max loss per trade must be rejected by RiskEngine
    const oversizeRes = Backtester.run({
      symbol: 'NIFTY 50',
      exchange: 'NSE',
      timeframe: 'FIVE_MINUTE',
      quantity: 10, // 10 * 125 SL distance = ₹1,250 risk > ₹500 maxLossPerTrade
      candles: [
        { timestamp: '2026-10-01T09:15:00.000Z', open: 25000, high: 25020, low: 24980, close: 25000, volume: 100000 },
        { timestamp: '2026-10-01T09:20:00.000Z', open: 25000, high: 25020, low: 24990, close: 25000, volume: 200000, indicators: bullishIndicators },
        { timestamp: '2026-10-01T09:25:00.000Z', open: 25000, high: 25300, low: 24990, close: 25280, volume: 300000 }
      ]
    });
    assert.equal(oversizeRes.ok, true);
    assert.equal(oversizeRes.trades.length, 0);
    assert.ok(oversizeRes.metrics.riskViolations >= 1);
    assert.ok(oversizeRes.orders.some((o) => o.status === 'REJECTED'));

    // 2. Max 3 trades per day cap: build 9 candles that alternate entry & target exit 4 times in 1 day
    const fourSetupsSameDay = [
      { timestamp: '2026-10-01T09:15:00.000Z', open: 25000, high: 25010, low: 24990, close: 25000, volume: 100000 },
      // Setup 1
      { timestamp: '2026-10-01T09:20:00.000Z', open: 25000, high: 25010, low: 24990, close: 25000, volume: 200000, indicators: bullishIndicators },
      { timestamp: '2026-10-01T09:25:00.000Z', open: 25000, high: 25300, low: 24995, close: 25280, volume: 200000 },
      // Setup 2
      { timestamp: '2026-10-01T09:30:00.000Z', open: 25000, high: 25010, low: 24990, close: 25000, volume: 200000, indicators: bullishIndicators },
      { timestamp: '2026-10-01T09:35:00.000Z', open: 25000, high: 25300, low: 24995, close: 25280, volume: 200000 },
      // Setup 3
      { timestamp: '2026-10-01T09:40:00.000Z', open: 25000, high: 25010, low: 24990, close: 25000, volume: 200000, indicators: bullishIndicators },
      { timestamp: '2026-10-01T09:45:00.000Z', open: 25000, high: 25300, low: 24995, close: 25280, volume: 200000 },
      // Setup 4 (must be blocked by maxTradesPerDay = 3)
      { timestamp: '2026-10-01T09:50:00.000Z', open: 25000, high: 25010, low: 24990, close: 25000, volume: 200000, indicators: bullishIndicators },
      { timestamp: '2026-10-01T09:55:00.000Z', open: 25000, high: 25300, low: 24995, close: 25280, volume: 200000 }
    ];

    const capRes = Backtester.run({
      symbol: 'NIFTY 50',
      exchange: 'NSE',
      timeframe: 'FIVE_MINUTE',
      quantity: 1,
      feePerTrade: 0,
      slippagePerUnit: 0,
      candles: fourSetupsSameDay
    });

    assert.equal(capRes.ok, true);
    assert.equal(capRes.trades.length, 3);
    assert.ok(capRes.metrics.riskViolations >= 1);
    assert.ok(
      capRes.orders.some(
        (o) =>
          o.status === 'REJECTED' &&
          String(o.rejectionReason || '').toLowerCase().includes('daily') &&
          String(o.rejectionReason || '').toLowerCase().includes('trade')
      ),
      '4th trade on the same day must be rejected by maxTradesPerDay = 3'
    );
  });

  test('133. Task 13 Emergency Stop Mid-Backtest Halts New Entries & Exits Open Position Immediately', () => {
    const bullishIndicators = {
      trendScore: 95,
      momentumScore: 90,
      volumeScore: 85,
      vwapScore: 85,
      supportResistanceScore: 85,
      optionsScore: 80,
      newsScore: 70,
      breadthScore: 80,
      volatilityScore: 20
    };

    const candlesWithMidEmergency = [
      { timestamp: '2026-10-01T09:15:00.000Z', open: 25000, high: 25010, low: 24990, close: 25000, volume: 100000 },
      // Bar 1 opens BUY at 25000
      { timestamp: '2026-10-01T09:20:00.000Z', open: 25000, high: 25010, low: 24990, close: 25000, volume: 200000, indicators: bullishIndicators },
      // Bar 2 triggers emergencyStop! Position must close with EMERGENCY_STOP
      { timestamp: '2026-10-01T09:25:00.000Z', open: 25000, high: 25050, low: 24990, close: 25030, volume: 200000, emergencyStop: true },
      // Bar 3 attempts another entry while emergency stop is active -> must be blocked
      { timestamp: '2026-10-01T09:30:00.000Z', open: 25030, high: 25060, low: 25010, close: 25040, volume: 200000, emergencyStop: true, indicators: bullishIndicators }
    ];

    const emRes = Backtester.run({
      symbol: 'NIFTY 50',
      exchange: 'NSE',
      timeframe: 'FIVE_MINUTE',
      quantity: 1,
      feePerTrade: 0,
      slippagePerUnit: 0,
      candles: candlesWithMidEmergency
    });

    assert.equal(emRes.ok, true);
    assert.equal(emRes.trades.length, 1);
    assert.equal(emRes.trades[0].reason, 'EMERGENCY_STOP');
  });

  test('134. Task 13 Performance Analytics, Gross vs Net P&L, Drawdown, Streaks & Exit-Reason Breakdown Verification', () => {
    const bullishIndicators = {
      trendScore: 95,
      momentumScore: 90,
      volumeScore: 85,
      vwapScore: 85,
      supportResistanceScore: 85,
      optionsScore: 80,
      newsScore: 70,
      breadthScore: 80,
      volatilityScore: 20
    };

    const twoTradesMixedCandles = [
      { timestamp: '2026-10-01T09:15:00.000Z', open: 25000, high: 25010, low: 24990, close: 25000, volume: 100000 },
      // Trade 1: Win (hits target ~25250)
      { timestamp: '2026-10-01T09:20:00.000Z', open: 25000, high: 25010, low: 24990, close: 25000, volume: 200000, indicators: bullishIndicators },
      { timestamp: '2026-10-01T09:25:00.000Z', open: 25000, high: 25300, low: 24995, close: 25280, volume: 200000 },
      // Trade 2: Loss (hits SL ~24875)
      { timestamp: '2026-10-01T09:30:00.000Z', open: 25000, high: 25010, low: 24990, close: 25000, volume: 200000, indicators: bullishIndicators },
      { timestamp: '2026-10-01T09:35:00.000Z', open: 25000, high: 25010, low: 24800, close: 24820, volume: 200000 }
    ];

    const res = Backtester.run({
      symbol: 'NIFTY 50',
      exchange: 'NSE',
      timeframe: 'FIVE_MINUTE',
      initialCapital: 100000,
      quantity: 1,
      feePerTrade: 20,
      slippagePerUnit: 1, // 2 pts total slippage + 20 fee = 22 cost per trade
      candles: twoTradesMixedCandles
    });

    assert.equal(res.ok, true);
    assert.equal(res.metrics.totalTrades, 2);
    assert.equal(res.metrics.wins, 1);
    assert.equal(res.metrics.losses, 1);
    assert.equal(res.metrics.winRate, 50);
    assert.equal(res.metrics.totalCosts, 44);
    assert.equal(
      Number((res.metrics.grossPnl - res.metrics.totalCosts).toFixed(2)),
      res.metrics.netPnl
    );
    assert.ok(res.metrics.profitFactor !== null && res.metrics.profitFactor > 0);
    assert.equal(res.metrics.profitFactorValid, true);
    assert.equal(res.metrics.longestWinningStreak, 1);
    assert.equal(res.metrics.longestLosingStreak, 1);
    assert.ok(res.exitReasonBreakdown.some((r) => r.reason === 'TARGET' && r.count === 1));
    assert.ok(res.exitReasonBreakdown.some((r) => r.reason === 'STOP_LOSS' && r.count === 1));
    assert.ok(res.metrics.maxDrawdown > 0);
    assert.equal(res.detailedEquityCurve.length, 3); // INITIAL_CAPITAL + 2 trade closes
  });

  test('135. Task 13 SQLite Backtest Run Persistence, Multi-User Isolation, Duplicate Prevention & Restart Recovery', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yashwin-task13-bt-persist-'));
    const tmpDbFile = path.join(tmpDir, 'yashwin_task13_test.sqlite');

    try {
      serverDb.closeDb();
      process.env.YASHWIN_DB_PATH = tmpDbFile;
      serverDb.getDb(tmpDbFile);

      const userA = 'USR-BT-A';
      const userB = 'USR-BT-B';

      const sampleCandles = [
        { timestamp: '2026-10-01T09:15:00.000Z', open: 25000, high: 25020, low: 24980, close: 25010, volume: 100000 },
        {
          timestamp: '2026-10-01T09:20:00.000Z',
          open: 25010,
          high: 25280,
          low: 25000,
          close: 25260,
          volume: 250000,
          indicators: {
            trendScore: 95,
            momentumScore: 90,
            volumeScore: 85,
            vwapScore: 85,
            supportResistanceScore: 85,
            optionsScore: 80,
            newsScore: 70,
            breadthScore: 80,
            volatilityScore: 20
          }
        },
        { timestamp: '2026-10-01T09:25:00.000Z', open: 25260, high: 25560, low: 25240, close: 25540, volume: 300000 }
      ];

      const reportA = Backtester.run({
        symbol: 'NIFTY 50',
        exchange: 'NSE',
        timeframe: 'FIVE_MINUTE',
        quantity: 1,
        candles: sampleCandles,
        persist: false
      });
      reportA.runId = 'BT-USER-A-RUN-1';

      const savedId1 = serverDb.insertBacktestRun(reportA, userA);
      // Duplicate insert with same runId must be idempotent and not duplicate rows
      const savedId2 = serverDb.insertBacktestRun(reportA, userA);
      assert.equal(savedId1, 'BT-USER-A-RUN-1');
      assert.equal(savedId2, 'BT-USER-A-RUN-1');

      const runsUserA = serverDb.listBacktestRuns(50, userA);
      const runsUserB = serverDb.listBacktestRuns(50, userB);
      assert.equal(runsUserA.length, 1);
      assert.equal(runsUserB.length, 0);

      // User B must be strictly forbidden from reading User A's run detail or trades
      assert.throws(
        () => serverDb.getBacktestRunById('BT-USER-A-RUN-1', userB),
        (err) => err.code === 'FORBIDDEN_OWNERSHIP'
      );
      assert.throws(
        () => serverDb.getBacktestRunTrades('BT-USER-A-RUN-1', userB),
        (err) => err.code === 'FORBIDDEN_OWNERSHIP'
      );

      // Simulate server restart
      serverDb.closeDb();
      serverDb.getDb(tmpDbFile);

      const detailAfterRestart = serverDb.getBacktestRunById('BT-USER-A-RUN-1', userA);
      assert.ok(detailAfterRestart);
      assert.equal(detailAfterRestart.runId, 'BT-USER-A-RUN-1');
      assert.equal(detailAfterRestart.symbol, 'NIFTY 50');
      assert.equal(detailAfterRestart.timeframe, 'FIVE_MINUTE');
      assert.equal(detailAfterRestart.totalTrades, 1);
      assert.equal(Array.isArray(detailAfterRestart.trades), true);
      assert.equal(detailAfterRestart.trades.length, 1);
      assert.equal(Array.isArray(detailAfterRestart.equityCurve), true);
      assert.equal(detailAfterRestart.equityCurve.length, 2);

      // Verify paper account and live orders were NEVER touched by backtest persistence
      const paperOrdersA = serverDb.listPaperOrders(50, userA);
      assert.equal(paperOrdersA.length, 0);
    } finally {
      serverDb.closeDb();
      process.env.YASHWIN_DB_PATH = ':memory:';
      serverDb.getDb(':memory:');
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  test('136. Task 13 Backtesting Engine UI DOM & API Endpoint Verification', async () => {
    const htmlPath = path.resolve(__dirname, '../web/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    const requiredTask13Ids = [
      'backtestingSection',
      'btDisclaimerText',
      'btModeSafetyBadge',
      'btUseSelectedInstrumentBtn',
      'runBacktestBtn',
      'btSessionBanner',
      'btLoadingBanner',
      'btErrorBanner',
      'btRetryBtn',
      'btSymbolInput',
      'btExchangeSelect',
      'btAssetTypeSelect',
      'btTimeframeSelect',
      'btFromDateInput',
      'btToDateInput',
      'btDataModeSelect',
      'btInitialCapitalInput',
      'btQuantityInput',
      'btLotSizeInput',
      'btMaxLossPerTradeInput',
      'btMaxDailyLossInput',
      'btMaxTradesPerDayInput',
      'btFeePerTradeInput',
      'btSlippageInput',
      'btEntryModelSelect',
      'btMinConfidenceInput',
      'btRunStatusBadge',
      'btFinalEquity',
      'btNetPnl',
      'btTotalTrades',
      'btWinRate',
      'btProfitFactor',
      'btExpectancy',
      'btAvgWinLoss',
      'btMaxDD',
      'btAvgHoldDuration',
      'btLosingStreak',
      'btRiskRejectionsCount',
      'btAmbiguousGapCount',
      'btEquityCurveContainer',
      'btExitReasonContainer',
      'btDailyPnlContainer',
      'btTradesListContainer',
      'btRunHistoryContainer'
    ];

    for (const id of requiredTask13Ids) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Task 13 Backtesting UI element id="${id}"`
      );
    }

    assert.equal(
      html.includes('modules/backtester.js'),
      true,
      'web/index.html must load modules/backtester.js'
    );
  });

  // =========================================================================
  // PHASE 20: TASK 14 — COMPLETE WATCHLIST & MARKET ALERTS
  // =========================================================================

  test('137. Task 14 Watchlist Management: Persistence, User Isolation, Duplicate Prevention, Reorder & Removal', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yashwin-task14-wl-'));
    const tmpDbFile = path.join(tmpDir, 'yashwin_task14_wl.sqlite');

    try {
      serverDb.closeDb();
      process.env.YASHWIN_DB_PATH = tmpDbFile;
      serverDb.getDb(tmpDbFile);

      const userA = 'USR-WL-A';
      const userB = 'USR-WL-B';

      // Add instruments for User A (addWatchlistItem returns updated watchlist array)
      const listAfter1 = serverDb.addWatchlistItem(
        {
          key: 'NIFTY',
          name: 'NIFTY 50',
          symbol: 'NIFTY 50',
          tradingsymbol: 'NIFTY 50',
          exchange: 'NSE',
          instrumentType: 'INDEX',
          symboltoken: '99926000',
          lotSize: 75
        },
        userA
      );
      assert.equal(listAfter1.length, 1);
      assert.equal(listAfter1[0].name, 'NIFTY 50');

      const listAfter2 = serverDb.addWatchlistItem(
        {
          key: 'BANKNIFTY',
          name: 'NIFTY BANK',
          symbol: 'NIFTY BANK',
          tradingsymbol: 'NIFTY BANK',
          exchange: 'NSE',
          instrumentType: 'INDEX',
          symboltoken: '99926009',
          lotSize: 30
        },
        userA
      );
      assert.equal(listAfter2.length, 2);

      // Duplicate add for same user must update in place without creating duplicates
      serverDb.addWatchlistItem(
        {
          key: 'NIFTY',
          name: 'NIFTY 50',
          symbol: 'NIFTY 50',
          tradingsymbol: 'NIFTY 50',
          exchange: 'NSE',
          instrumentType: 'INDEX',
          symboltoken: '99926000',
          lotSize: 75
        },
        userA
      );

      const listA = serverDb.listWatchlist(userA);
      const listB = serverDb.listWatchlist(userB);
      assert.equal(listA.length, 2, 'Duplicate add must not create duplicate watchlist entries');
      assert.equal(listB.length, 0, 'User B watchlist must be isolated from User A');

      // Reorder User A's watchlist
      const reordered = serverDb.reorderWatchlist(
        {
          orderedItems: [
            { key: 'BANKNIFTY', symbol: 'NIFTY BANK', exchange: 'NSE' },
            { key: 'NIFTY', symbol: 'NIFTY 50', exchange: 'NSE' }
          ]
        },
        userA
      );
      assert.equal(reordered.length, 2);
      assert.equal(reordered[0].key, 'BANKNIFTY');
      assert.equal(reordered[1].key, 'NIFTY');

      // Remove item from User A
      const afterRemove = serverDb.removeWatchlistItem({ key: 'BANKNIFTY', symbol: 'NIFTY BANK', exchange: 'NSE' }, userA);
      assert.equal(afterRemove.length, 1);
      assert.equal(afterRemove[0].key, 'NIFTY');
    } finally {
      serverDb.closeDb();
      process.env.YASHWIN_DB_PATH = ':memory:';
      serverDb.getDb(':memory:');
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  test('138. Task 14 Watchlist Quote Enrichment: Fresh vs Stale vs Unavailable Honesty', () => {
    const nowMs = Date.parse('2026-10-09T10:00:00.000Z');
    const freshTs = new Date(nowMs - 15 * 1000).toISOString(); // 15s old (FRESH)
    const staleTs = new Date(nowMs - 10 * 60 * 1000).toISOString(); // 10m old (STALE)

    const items = [
      {
        id: 'WL-1',
        key: 'NIFTY',
        name: 'NIFTY 50',
        tradingsymbol: 'NIFTY 50',
        exchange: 'NSE',
        instrumentType: 'INDEX',
        symboltoken: '99926000',
        lotSize: 75,
        sortOrder: 1
      },
      {
        id: 'WL-2',
        key: 'RELIANCE',
        name: 'RELIANCE INDUSTRIES',
        tradingsymbol: 'RELIANCE-EQ',
        exchange: 'NSE',
        instrumentType: 'EQUITY',
        symboltoken: '2885',
        lotSize: 1,
        sortOrder: 2
      },
      {
        id: 'WL-3',
        key: 'SENSEX',
        name: 'BSE SENSEX',
        tradingsymbol: 'SENSEX',
        exchange: 'BSE',
        instrumentType: 'INDEX',
        symboltoken: '99919000',
        lotSize: 20,
        sortOrder: 3
      }
    ];

    const quotesByKey = {
      'NSE:NIFTY': {
        price: 25120.5,
        open: 25000,
        high: 25150,
        low: 24980,
        previousClose: 25020,
        change: 100.5,
        changePercent: 0.4,
        volume: 1250000,
        vwap: 25085.2,
        timestamp: freshTs,
        provider: 'ANGEL_SMARTAPI_LIVE'
      },
      'NSE:RELIANCE': {
        price: 2950.0,
        open: 2960,
        high: 2975,
        low: 2940,
        previousClose: 2955,
        change: -5,
        changePercent: -0.17,
        volume: 840000,
        vwap: 2952.1,
        timestamp: staleTs,
        provider: 'SQLITE_SNAPSHOT'
      }
      // SENSEX quote intentionally missing -> UNAVAILABLE
    };

    const snap = WatchlistAlertEngine.buildWatchlistSnapshot({
      items,
      quotesByKey,
      nowMs
    });

    assert.equal(snap.ok, true);
    assert.equal(snap.summary.totalItems, 3);
    assert.equal(snap.summary.freshQuotes, 1);
    assert.equal(snap.summary.staleQuotes, 1);
    assert.equal(snap.summary.waitingQuotes, 1);

    const niftyRow = snap.items.find((r) => r.key === 'NIFTY');
    const relRow = snap.items.find((r) => r.key === 'RELIANCE');
    const sensexRow = snap.items.find((r) => r.key === 'SENSEX');

    assert.equal(niftyRow.dataReady, true);
    assert.equal(niftyRow.isStale, false);
    assert.equal(niftyRow.quote.ltp, 25120.5);

    assert.equal(relRow.isStale, true);
    assert.equal(relRow.dataReady, false);

    assert.equal(sensexRow.quote.available, false);
    assert.equal(sensexRow.quote.ltp, null, 'Unavailable quote must never fabricate LTP');
  });

  test('139. Task 14 Market Alert Rule Validation: All Alert Types & Strict Rejection of Invalid Inputs', () => {
    // 1. Valid PRICE_ABOVE rule
    const validAbove = WatchlistAlertEngine.validateAlertDefinition({
      symbol: 'NIFTY 50',
      exchange: 'NSE',
      instrumentType: 'INDEX',
      alertType: 'PRICE_ABOVE',
      thresholdValue: 25200,
      triggerMode: 'ONCE'
    });
    assert.equal(validAbove.alertType, 'PRICE_ABOVE');
    assert.equal(validAbove.thresholdValue, 25200);
    assert.equal(validAbove.status, 'ACTIVE');

    // 2. Reject negative threshold for PRICE_BELOW
    assert.throws(
      () =>
        WatchlistAlertEngine.validateAlertDefinition({
          symbol: 'NIFTY 50',
          exchange: 'NSE',
          alertType: 'PRICE_BELOW',
          thresholdValue: -10
        }),
      (err) => err.code === 'INVALID_ALERT_THRESHOLD'
    );

    // 3. Reject unsupported alert type
    assert.throws(
      () =>
        WatchlistAlertEngine.validateAlertDefinition({
          symbol: 'NIFTY 50',
          exchange: 'NSE',
          alertType: 'AUTO_EXECUTE_ORDER',
          thresholdValue: 100
        }),
      (err) => String(err.message || '').includes('Unsupported alertType')
    );

    // 4. Reject missing symbol
    assert.throws(
      () =>
        WatchlistAlertEngine.validateAlertDefinition({
          symbol: '',
          exchange: 'NSE',
          alertType: 'PRICE_ABOVE',
          thresholdValue: 25000
        }),
      (err) => String(err.message || '').includes('symbol or key is required')
    );

    // 5. Valid STRATEGY_SIGNAL_CHANGE rule with COOLDOWN
    const validStrategy = WatchlistAlertEngine.validateAlertDefinition({
      symbol: 'NIFTY BANK',
      exchange: 'NSE',
      alertType: 'STRATEGY_SIGNAL_CHANGE',
      conditionParams: { targetSignal: 'BUY' },
      triggerMode: 'COOLDOWN',
      cooldownMinutes: 15
    });
    assert.equal(validStrategy.alertType, 'STRATEGY_SIGNAL_CHANGE');
    assert.equal(validStrategy.triggerMode, 'COOLDOWN');
    assert.equal(validStrategy.cooldownMinutes, 15);
  });

  test('140. Task 14 Deterministic Alert Evaluation: Price, Change%, Support/Resistance, RSI & Strategy Signal', () => {
    const nowMs = Date.parse('2026-10-09T10:30:00.000Z');
    const freshTs = new Date(nowMs - 5000).toISOString();

    const quote = {
      symbol: 'NIFTY 50',
      exchange: 'NSE',
      price: 25250,
      open: 25000,
      high: 25260,
      low: 24990,
      previousClose: 25000,
      change: 250,
      changePercent: 1.0,
      volume: 300000,
      vwap: 25100,
      timestamp: freshTs,
      indicators: {
        rsi14: 74.5,
        support: 24950,
        resistance: 25200,
        breakout: 'BULLISH_BREAKOUT'
      }
    };

    // 1. PRICE_ABOVE (25250 >= 25200 -> triggers)
    const evalAbove = WatchlistAlertEngine.evaluateSingleAlert(
      {
        alertId: 'ALT-1',
        symbol: 'NIFTY 50',
        exchange: 'NSE',
        alertType: 'PRICE_ABOVE',
        thresholdValue: 25200,
        status: 'ACTIVE',
        triggerMode: 'ONCE'
      },
      { snapshot: quote },
      { nowMs }
    );
    assert.equal(evalAbove.triggered, true);
    assert.equal(evalAbove.nextStatus, 'TRIGGERED');

    // 2. PERCENT_CHANGE_UP (+1.0% >= 0.8% -> triggers)
    const evalPctUp = WatchlistAlertEngine.evaluateSingleAlert(
      {
        alertId: 'ALT-2',
        symbol: 'NIFTY 50',
        exchange: 'NSE',
        alertType: 'PERCENT_CHANGE_UP',
        thresholdValue: 0.8,
        status: 'ACTIVE',
        triggerMode: 'ONCE'
      },
      { snapshot: quote },
      { nowMs }
    );
    assert.equal(evalPctUp.triggered, true);

    // 3. RESISTANCE_BREAKOUT (price 25250 > resistance 25200 -> triggers)
    const evalResBreak = WatchlistAlertEngine.evaluateSingleAlert(
      {
        alertId: 'ALT-3',
        symbol: 'NIFTY 50',
        exchange: 'NSE',
        alertType: 'RESISTANCE_BREAKOUT',
        thresholdValue: 25200,
        status: 'ACTIVE',
        triggerMode: 'ONCE'
      },
      { snapshot: quote },
      { nowMs }
    );
    assert.equal(evalResBreak.triggered, true);

    // 4. RSI_OVERBOUGHT_OVERSOLD (rsi14 74.5 >= 70 -> triggers)
    const evalRsi = WatchlistAlertEngine.evaluateSingleAlert(
      {
        alertId: 'ALT-4',
        symbol: 'NIFTY 50',
        exchange: 'NSE',
        alertType: 'RSI_OVERBOUGHT_OVERSOLD',
        thresholdValue: 70,
        conditionParams: { rsiMode: 'OVERBOUGHT', overboughtLevel: 70 },
        status: 'ACTIVE',
        triggerMode: 'ONCE'
      },
      { snapshot: quote },
      { nowMs }
    );
    assert.equal(evalRsi.triggered, true);

    // 5. STRATEGY_SIGNAL_CHANGE (BUY with 84% confidence -> triggers)
    const strategyEval = {
      action: 'BUY',
      confidence: 84,
      marketRegime: 'TRENDING_BULLISH',
      dataQuality: 'VALIDATED'
    };
    const evalStrat = WatchlistAlertEngine.evaluateSingleAlert(
      {
        alertId: 'ALT-5',
        symbol: 'NIFTY 50',
        exchange: 'NSE',
        alertType: 'STRATEGY_SIGNAL_CHANGE',
        conditionParams: { targetSignal: 'BUY', lastKnownSignal: 'NO_TRADE' },
        status: 'ACTIVE',
        triggerMode: 'COOLDOWN',
        cooldownMinutes: 15
      },
      { snapshot: quote, strategy: strategyEval },
      { nowMs }
    );
    assert.equal(evalStrat.triggered, true);
    assert.equal(evalStrat.nextStatus, 'COOLDOWN');
  });

  test('141. Task 14 Stale Quote Rejection & Cooldown/Once Deduplication', () => {
    const nowMs = Date.parse('2026-10-09T11:00:00.000Z');
    const staleTs = new Date(nowMs - 15 * 60 * 1000).toISOString(); // 15m old -> STALE
    const freshTs = new Date(nowMs - 5000).toISOString();

    // 1. Stale quote MUST NOT trigger an alert
    const staleEval = WatchlistAlertEngine.evaluateSingleAlert(
      {
        alertId: 'ALT-STALE',
        symbol: 'NIFTY 50',
        exchange: 'NSE',
        alertType: 'PRICE_ABOVE',
        thresholdValue: 25000,
        status: 'ACTIVE',
        triggerMode: 'ONCE'
      },
      {
        snapshot: {
          symbol: 'NIFTY 50',
          exchange: 'NSE',
          price: 25500,
          timestamp: staleTs
        }
      },
      { nowMs }
    );
    assert.equal(staleEval.triggered, false);
    assert.equal(staleEval.reasonCode, 'STALE_OR_UNREADY_MARKET_DATA');
    assert.equal(staleEval.nextStatus, 'INVALID_DATA_BLOCKED');

    // 2. Unavailable quote MUST NOT trigger an alert
    const unavailEval = WatchlistAlertEngine.evaluateSingleAlert(
      {
        alertId: 'ALT-UNAVAIL',
        symbol: 'NIFTY 50',
        exchange: 'NSE',
        alertType: 'PRICE_ABOVE',
        thresholdValue: 25000,
        status: 'ACTIVE',
        triggerMode: 'ONCE'
      },
      {},
      { nowMs }
    );
    assert.equal(unavailEval.triggered, false);
    assert.equal(unavailEval.nextStatus, 'INVALID_DATA_BLOCKED');

    // 3. Cooldown active MUST block duplicate firing until cooldown expires
    const recentTriggeredAt = new Date(nowMs - 2 * 60 * 1000).toISOString(); // 2 mins ago, cooldown is 10 mins
    const cooldownEval = WatchlistAlertEngine.evaluateSingleAlert(
      {
        alertId: 'ALT-COOLDOWN',
        symbol: 'NIFTY 50',
        exchange: 'NSE',
        alertType: 'PRICE_ABOVE',
        thresholdValue: 25000,
        status: 'COOLDOWN',
        triggerMode: 'COOLDOWN',
        cooldownMinutes: 10,
        triggerCount: 1,
        lastTriggeredAt: recentTriggeredAt
      },
      {
        snapshot: {
          symbol: 'NIFTY 50',
          exchange: 'NSE',
          price: 25500,
          timestamp: freshTs
        }
      },
      { nowMs }
    );
    assert.equal(cooldownEval.triggered, false);
    assert.equal(cooldownEval.reasonCode, 'COOLDOWN_ACTIVE');
  });

  test('142. Task 14 SQLite Alert Lifecycle, Event History, Acknowledgement, Multi-User Isolation & Zero Auto-Orders', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yashwin-task14-alerts-'));
    const tmpDbFile = path.join(tmpDir, 'yashwin_task14_alerts.sqlite');

    try {
      serverDb.closeDb();
      process.env.YASHWIN_DB_PATH = tmpDbFile;
      serverDb.getDb(tmpDbFile);

      const userA = 'USR-ALT-A';
      const userB = 'USR-ALT-B';

      // Create alert for User A
      const created = serverDb.createMarketAlert(
        {
          symbol: 'NIFTY 50',
          exchange: 'NSE',
          name: 'NIFTY 50',
          instrumentType: 'INDEX',
          symboltoken: '99926000',
          alertType: 'PRICE_ABOVE',
          thresholdValue: 25100,
          triggerMode: 'ONCE',
          cooldownMinutes: 5,
          notes: 'Breakout above 25100'
        },
        userA
      );
      assert.ok(created.alertId);
      assert.equal(created.status, 'ACTIVE');

      // User B cannot see or mutate User A's alert
      assert.equal(serverDb.listMarketAlerts({}, userB).length, 0);
      assert.throws(
        () => serverDb.updateMarketAlertStatus(created.alertId, { status: 'PAUSED' }, userB),
        (err) => err.code === 'FORBIDDEN_OWNERSHIP'
      );

      // Pause -> Resume lifecycle for User A
      const paused = serverDb.updateMarketAlertStatus(created.alertId, { status: 'PAUSED' }, userA);
      assert.equal(paused.status, 'PAUSED');

      const resumed = serverDb.updateMarketAlertStatus(created.alertId, { status: 'ACTIVE' }, userA);
      assert.equal(resumed.status, 'ACTIVE');

      // Evaluate and record trigger event
      const nowMs = Date.now();
      const freshQuote = {
        symbol: 'NIFTY 50',
        exchange: 'NSE',
        price: 25180,
        open: 25000,
        high: 25190,
        low: 24990,
        previousClose: 25020,
        change: 160,
        changePercent: 0.64,
        volume: 150000,
        vwap: 25090,
        timestamp: new Date(nowMs - 2000).toISOString()
      };

      const evalRes = WatchlistAlertEngine.evaluateSingleAlert(
        resumed,
        { snapshot: freshQuote },
        { nowMs }
      );
      assert.equal(evalRes.triggered, true);

      const recorded = serverDb.recordTriggeredAlertEvent(evalRes.eventPayload, userA);
      assert.ok(recorded.event.eventId);
      assert.equal(recorded.event.acknowledged, false);
      assert.equal(recorded.alert.status, 'TRIGGERED');
      assert.equal(recorded.alert.triggerCount, 1);

      // Verify event history & user isolation
      const eventsA = serverDb.listAlertEventsHistory({}, userA);
      const eventsB = serverDb.listAlertEventsHistory({}, userB);
      assert.equal(eventsA.length, 1);
      assert.equal(eventsB.length, 0);

      // Acknowledge event
      const acked = serverDb.acknowledgeAlertEvent(recorded.event.eventId, userA);
      assert.equal(acked.acknowledged, true);
      assert.ok(acked.acknowledgedAt);

      // Reset alert back to ACTIVE
      const resetAlert = serverDb.updateMarketAlertStatus(created.alertId, { status: 'ACTIVE' }, userA);
      assert.equal(resetAlert.status, 'ACTIVE');

      // Disable alert
      const disabledAlert = serverDb.updateMarketAlertStatus(created.alertId, { status: 'DISABLED' }, userA);
      assert.equal(disabledAlert.status, 'DISABLED');

      // CRITICAL SAFETY CHECK: Alert triggers must NEVER place any paper or live orders
      const ordersA = serverDb.listPaperOrders(50, userA);
      assert.equal(ordersA.length, 0, 'Market alerts must never automatically open paper or live orders');
    } finally {
      serverDb.closeDb();
      process.env.YASHWIN_DB_PATH = ':memory:';
      serverDb.getDb(':memory:');
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  test('143. Task 14 Watchlist & Market Alerts UI DOM & Module Wiring Verification', () => {
    const htmlPath = path.resolve(__dirname, '../web/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    const requiredTask14Ids = [
      'watchlistPage',
      'wlHeroModeBadge',
      'wlEvaluateAlertsNowBtn',
      'wlRefreshAllBtn',
      'wlLoadingBanner',
      'wlErrorBanner',
      'wlRetrySyncBtn',
      'wlTriggeredNotificationBanner',
      'wlAcknowledgeLatestBtn',
      'wlKpiTotalItems',
      'wlKpiQuoteCoverage',
      'wlKpiActiveAlerts',
      'wlKpiPausedAlerts',
      'wlKpiTriggeredEvents',
      'wlKpiUnackCount',
      'wlKpiSafetyState',
      'wlAddCurrentInstBtn',
      'wlWatchlistTable',
      'wlWatchlistTableBody',
      'wlCreateAlertForm',
      'wlAlertSymbolInput',
      'wlAlertExchangeSelect',
      'wlAlertInstTypeSelect',
      'wlAlertTypeSelect',
      'wlAlertThresholdInput',
      'wlAlertNotesInput',
      'wlAlertCooldownInput',
      'wlCreateAlertSubmitBtn',
      'wlUseSelectedInstForAlertBtn',
      'wlAlertStatusFilterGroup',
      'wlAlertsListContainer',
      'wlHistorySymbolFilter',
      'wlHistoryTypeFilter',
      'wlHistoryFilterApplyBtn',
      'wlAlertEventsHistoryContainer'
    ];

    for (const id of requiredTask14Ids) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Task 14 Watchlist & Alerts DOM element id="${id}"`
      );
    }

    assert.equal(
      html.includes('modules/watchlist-alert-engine.js'),
      true,
      'web/index.html must load modules/watchlist-alert-engine.js'
    );
  });

  /* =====================================================
     TASK 15 — COMPLETE ALERT NOTIFICATIONS SYSTEM TESTS (TESTS 144–150)
  ===================================================== */

  test('144. Task 15 NotificationEngine: Alert Event Transformation, Category Mapping, Deduplication Key & Preferences Validation', () => {
    const NotificationEngine = require('../web/modules/notification-engine');

    assert.ok(NotificationEngine.DOCUMENTED_NOTIFICATION_RULES);
    assert.equal(NotificationEngine.DOCUMENTED_NOTIFICATION_RULES.tradingMode, 'paper');
    assert.equal(NotificationEngine.DOCUMENTED_NOTIFICATION_RULES.liveTradingEnabled, false);
    assert.equal(NotificationEngine.DOCUMENTED_NOTIFICATION_RULES.autoOrderPlacement, false);

    // 1. Transform a Task 14 triggered alert event into a structured notification
    const alertEvent = {
      eventId: 'AEV-T15-1001',
      alertId: 'ALT-T15-1',
      userId: 'USR-T15-1',
      symbol: 'NIFTY 50',
      tradingsymbol: 'NIFTY 50',
      exchange: 'NSE',
      instrumentType: 'INDEX',
      alertType: 'PRICE_ABOVE',
      conditionSummary: 'NIFTY 50 price >= 25200',
      thresholdValue: 25200,
      observedPrice: 25245.5,
      observedValue: '25245.50',
      quoteTimestamp: '2026-10-09T10:15:00.000Z',
      triggeredAt: '2026-10-09T10:15:01.000Z'
    };

    const built = NotificationEngine.buildNotificationFromAlertEvent(alertEvent, 'USR-T15-1');
    assert.equal(built.userId, 'USR-T15-1');
    assert.equal(built.sourceEventId, 'AEV-T15-1001');
    assert.equal(built.dedupKey, 'ALERT_EVENT:AEV-T15-1001');
    assert.equal(built.category, 'PRICE_ALERT');
    assert.equal(built.symbol, 'NIFTY 50');
    assert.equal(built.exchange, 'NSE');
    assert.equal(built.observedPrice, 25245.5);
    assert.equal(built.thresholdValue, 25200);
    assert.ok(built.title.includes('NIFTY 50'));
    assert.ok(built.message.includes('25245.5'));

    // 2. Validate preferences normalization & invalid quiet-hours rejection
    const validPrefs = NotificationEngine.validateAndNormalizePreferences({
      inAppEnabled: true,
      browserNotificationsEnabled: true,
      soundEnabled: false,
      quietHoursEnabled: true,
      quietHoursStart: '22:30',
      quietHoursEnd: '07:30',
      categories: {
        PRICE_ALERT: true,
        VOLUME_SPIKE_ALERT: false
      }
    });
    assert.equal(validPrefs.ok, true);
    assert.equal(validPrefs.preferences.browserNotificationsEnabled, true);
    assert.equal(validPrefs.preferences.quietHoursStart, '22:30');
    assert.equal(validPrefs.preferences.quietHoursEnd, '07:30');
    assert.equal(validPrefs.preferences.categories.PRICE_ALERT, true);
    assert.equal(validPrefs.preferences.categories.VOLUME_SPIKE_ALERT, false);
    assert.equal(validPrefs.preferences.categories.EMERGENCY_STOP, true);

    const invalidPrefs = NotificationEngine.validateAndNormalizePreferences({
      quietHoursStart: '25:99',
      quietHoursEnd: 'bad-time'
    });
    assert.equal(invalidPrefs.ok, false);
    assert.equal(invalidPrefs.code, 'INVALID_NOTIFICATION_PREFERENCES');
  });

  test('145. Task 15 Quiet Hours Window Calculation & Channel Dispatch Planning (Emergency Stop Override)', () => {
    const NotificationEngine = require('../web/modules/notification-engine');

    // Overnight quiet window 22:00 -> 08:00
    assert.equal(NotificationEngine.isWithinQuietHours('23:15', '22:00', '08:00'), true);
    assert.equal(NotificationEngine.isWithinQuietHours('06:45', '22:00', '08:00'), true);
    assert.equal(NotificationEngine.isWithinQuietHours('14:30', '22:00', '08:00'), false);

    const prefs = NotificationEngine.getDefaultPreferences();
    prefs.browserNotificationsEnabled = true;
    prefs.soundEnabled = true;
    prefs.telegramEnabled = true;
    prefs.quietHoursEnabled = true;
    prefs.quietHoursStart = '22:00';
    prefs.quietHoursEnd = '08:00';

    // 1. Standard PRICE_ALERT during quiet hours (23:30) suppresses BROWSER, SOUND & TELEGRAM, but keeps IN_APP
    const quietPlan = NotificationEngine.evaluateChannelDispatchPlan(
      { category: 'PRICE_ALERT', severity: 'INFO' },
      prefs,
      {
        nowTime: '23:30',
        externalChannelStatus: {
          TELEGRAM: { configured: true }
        }
      }
    );
    assert.equal(quietPlan.inQuietHours, true);
    assert.equal(quietPlan.channels.IN_APP.shouldSend, true);
    assert.equal(quietPlan.channels.BROWSER.shouldSend, false);
    assert.equal(quietPlan.channels.BROWSER.status, 'SKIPPED_QUIET_HOURS');
    assert.equal(quietPlan.channels.SOUND.shouldSend, false);
    assert.equal(quietPlan.channels.SOUND.status, 'SKIPPED_QUIET_HOURS');
    assert.equal(quietPlan.channels.TELEGRAM.shouldSend, false);
    assert.equal(quietPlan.channels.TELEGRAM.status, 'SKIPPED_QUIET_HOURS');

    // 2. EMERGENCY_STOP overrides quiet hours and disabled category preferences
    const emergencyPlan = NotificationEngine.evaluateChannelDispatchPlan(
      { category: 'EMERGENCY_STOP', severity: 'CRITICAL' },
      { ...prefs, inAppEnabled: false },
      {
        nowTime: '23:30',
        externalChannelStatus: {
          TELEGRAM: { configured: false }
        }
      }
    );
    assert.equal(emergencyPlan.isEmergency, true);
    assert.equal(emergencyPlan.channels.IN_APP.shouldSend, true);
    assert.equal(emergencyPlan.channels.BROWSER.shouldSend, true);
    assert.equal(emergencyPlan.channels.TELEGRAM.shouldSend, false);
    assert.equal(emergencyPlan.channels.TELEGRAM.status, 'UNCONFIGURED');
  });

  test('146. Task 15 Automatic Alert-to-Notification Creation, Deduplication, Read/Unread State & Restart Persistence', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yashwin-task15-notif-'));
    const tmpDbFile = path.join(tmpDir, 'yashwin_task15_notif.sqlite');

    try {
      serverDb.closeDb();
      process.env.YASHWIN_DB_PATH = tmpDbFile;
      serverDb.getDb(tmpDbFile);

      const userA = 'USR-NOTIF-A';

      // Create an active market alert for User A
      const alert = serverDb.createMarketAlert(
        {
          symbol: 'RELIANCE',
          exchange: 'NSE',
          instrumentType: 'EQUITY',
          alertType: 'PRICE_ABOVE',
          thresholdValue: 2950,
          triggerMode: 'ONCE'
        },
        userA
      );

      // Evaluate alert against validated market data -> triggers alert event AND automatically creates notification
      const evalSummary = serverDb.evaluateUserAlertsAgainstMarketData(
        {
          RELIANCE: {
            snapshot: {
              symbol: 'RELIANCE',
              exchange: 'NSE',
              price: 2985,
              timestamp: new Date().toISOString()
            }
          }
        },
        userA
      );
      assert.equal(evalSummary.triggeredCount, 1);
      const triggeredEvent = evalSummary.triggeredEvents[0];
      assert.ok(triggeredEvent.eventId);

      // Verify notification was persisted automatically
      const list1 = serverDb.listUserNotifications({}, userA);
      assert.equal(list1.totalCount, 1);
      assert.equal(list1.unreadCount, 1);
      const notif = list1.notifications[0];
      assert.equal(notif.sourceEventId, triggeredEvent.eventId);
      assert.equal(notif.alertId, alert.alertId);
      assert.equal(notif.symbol, 'RELIANCE');
      assert.equal(notif.category, 'PRICE_ALERT');
      assert.equal(notif.read, false);
      assert.ok(Array.isArray(notif.deliveries));
      assert.equal(notif.deliveries[0].channel, 'IN_APP');
      assert.equal(notif.deliveries[0].status, 'DELIVERED');

      // Duplicate call with same alert event MUST NOT create a second notification
      const dupAttempt = serverDb.createNotificationFromAlertEvent(triggeredEvent, userA);
      assert.equal(dupAttempt.created, false);
      assert.equal(dupAttempt.deduplicated, true);
      assert.equal(serverDb.listUserNotifications({}, userA).totalCount, 1);

      // Mark notification as read -> persists across DB close/reopen (server restart simulation)
      const marked = serverDb.markNotificationRead(notif.notificationId, userA);
      assert.equal(marked.unreadCount, 0);
      assert.equal(marked.notification.read, true);
      assert.ok(marked.notification.readAt);

      // Simulate server restart by closing and reopening the same SQLite file
      serverDb.closeDb();
      serverDb.getDb(tmpDbFile);

      const afterRestart = serverDb.listUserNotifications({}, userA);
      assert.equal(afterRestart.totalCount, 1);
      assert.equal(afterRestart.unreadCount, 0);
      assert.equal(afterRestart.notifications[0].read, true);
    } finally {
      serverDb.closeDb();
      process.env.YASHWIN_DB_PATH = ':memory:';
      serverDb.getDb(':memory:');
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  test('147. Task 15 Multi-User Notification & Preference Isolation + Cross-User 403 Enforcement', async () => {
    serverDb.resetAllTablesForTest();
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // Register User A and User B
    const regA = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Notif User A',
        email: 'notif.a@yashwin.test',
        password: 'PasswordA#1234'
      })
    });
    assert.equal(regA.status, 201);
    const cookieA = regA.headers['set-cookie'][0].split(';')[0];
    const csrfA = regA.json.csrfToken;
    const userIdA = regA.json.user.userId;

    const regB = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Notif User B',
        email: 'notif.b@yashwin.test',
        password: 'PasswordB#1234'
      })
    });
    assert.equal(regB.status, 201);
    const cookieB = regB.headers['set-cookie'][0].split(';')[0];
    const csrfB = regB.json.csrfToken;

    // User A updates notification preferences
    const prefResA = await requestServer(server, '/api/notifications/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        browserNotificationsEnabled: true,
        soundEnabled: true,
        quietHoursEnabled: true,
        quietHoursStart: '21:30',
        quietHoursEnd: '07:00'
      })
    });
    assert.equal(prefResA.status, 200);
    assert.equal(prefResA.json.preferences.browserNotificationsEnabled, true);
    assert.equal(prefResA.json.preferences.quietHoursStart, '21:30');

    // User B preferences remain isolated at default values
    const prefResB = await requestServer(server, '/api/notifications/preferences', {
      headers: { Cookie: cookieB }
    });
    assert.equal(prefResB.status, 200);
    assert.equal(prefResB.json.preferences.browserNotificationsEnabled, false);
    assert.equal(prefResB.json.preferences.quietHoursEnabled, false);

    // Create a notification for User A
    const sysResA = await requestServer(server, '/api/notifications/system', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        'X-CSRF-Token': csrfA
      },
      body: JSON.stringify({
        category: 'RISK_WARNING',
        severity: 'WARNING',
        symbol: 'BANKNIFTY',
        exchange: 'NSE',
        title: 'Daily Loss Approaching Limit',
        message: 'Realized daily loss is ₹800 of ₹1,000 limit.'
      })
    });
    assert.equal(sysResA.status, 201);
    const notifIdA = sysResA.json.notification.notificationId;

    // User B cannot see User A's notifications
    const listB = await requestServer(server, '/api/notifications', {
      headers: { Cookie: cookieB }
    });
    assert.equal(listB.status, 200);
    assert.equal(listB.json.totalCount, 0);

    // User B attempting to query User A's notifications via ?userId= returns 403
    const crossList = await requestServer(
      server,
      `/api/notifications?userId=${encodeURIComponent(userIdA)}`,
      { headers: { Cookie: cookieB } }
    );
    assert.equal(crossList.status, 403);
    assert.equal(crossList.json.code, 'FORBIDDEN_OWNERSHIP');

    // User B attempting to mark User A's notification as read returns 403
    const crossMark = await requestServer(server, '/api/notifications/read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieB,
        'X-CSRF-Token': csrfB
      },
      body: JSON.stringify({ notificationId: notifIdA })
    });
    assert.equal(crossMark.status, 403);
    assert.equal(crossMark.json.code, 'FORBIDDEN_OWNERSHIP');

    // Authenticated mutation without CSRF token is rejected with 403
    const noCsrf = await requestServer(server, '/api/notifications/read-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA
      },
      body: JSON.stringify({})
    });
    assert.equal(noCsrf.status, 403);
  });

  test('148. Task 15 Notification Filtering, Pagination, Mark-One-Read, Mark-All-Read & Emergency Stop Notification', async () => {
    serverDb.resetAllTablesForTest();
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // Create 3 distinct notifications (PRICE_ALERT, STRATEGY_SIGNAL_ALERT, RISK_WARNING)
    serverDb.createNotificationFromAlertEvent({
      eventId: 'EV-F1',
      alertId: 'AL-F1',
      symbol: 'NIFTY 50',
      exchange: 'NSE',
      alertType: 'PRICE_ABOVE',
      thresholdValue: 25000,
      observedPrice: 25100,
      triggeredAt: '2026-10-08T10:00:00.000Z'
    });
    serverDb.createNotificationFromAlertEvent({
      eventId: 'EV-F2',
      alertId: 'AL-F2',
      symbol: 'TCS',
      exchange: 'NSE',
      alertType: 'STRATEGY_SIGNAL',
      observedValue: 'BUY (85%)',
      triggeredAt: '2026-10-09T11:00:00.000Z'
    });
    serverDb.createSystemOrRiskNotification({
      category: 'RISK_WARNING',
      severity: 'WARNING',
      symbol: 'RELIANCE',
      exchange: 'NSE',
      title: 'Per-Trade Risk Limit Check',
      message: 'Position size capped by ₹500 max loss per trade.',
      triggeredAt: '2026-10-09T12:00:00.000Z'
    });

    // 1. Filter by category=STRATEGY_SIGNAL_ALERT
    const catRes = await requestServer(
      server,
      '/api/notifications?category=STRATEGY_SIGNAL_ALERT'
    );
    assert.equal(catRes.status, 200);
    assert.equal(catRes.json.filteredCount, 1);
    assert.equal(catRes.json.notifications[0].symbol, 'TCS');

    // 2. Filter by date=2026-10-08
    const dateRes = await requestServer(server, '/api/notifications?date=2026-10-08');
    assert.equal(dateRes.status, 200);
    assert.equal(dateRes.json.filteredCount, 1);
    assert.equal(dateRes.json.notifications[0].symbol, 'NIFTY 50');

    // 3. Pagination pageSize=2, page=1
    const page1 = await requestServer(server, '/api/notifications?pageSize=2&page=1');
    assert.equal(page1.status, 200);
    assert.equal(page1.json.notifications.length, 2);
    assert.equal(page1.json.pagination.totalPages, 2);
    assert.equal(page1.json.pagination.hasNextPage, true);

    // 4. Mark all notifications as read
    const markAll = await requestServer(server, '/api/notifications/read-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(markAll.status, 200);
    assert.equal(markAll.json.unreadCount, 0);

    // 5. Activating Emergency Stop automatically records a CRITICAL EMERGENCY_STOP notification
    const emRes = await requestServer(server, '/api/emergency/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Task 15 Emergency Notification Test' })
    });
    assert.equal(emRes.status, 200);

    const unreadAfterEm = await requestServer(
      server,
      '/api/notifications?readStatus=UNREAD&category=EMERGENCY_STOP'
    );
    assert.equal(unreadAfterEm.status, 200);
    assert.equal(unreadAfterEm.json.unreadCount, 1);
    assert.equal(unreadAfterEm.json.notifications[0].category, 'EMERGENCY_STOP');
    assert.equal(unreadAfterEm.json.notifications[0].severity, 'CRITICAL');

    // Reset emergency stop for clean state
    await requestServer(server, '/api/emergency/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Reset after test' })
    });
  });

  test('149. Task 15 Server-Only External Delivery Service: Honest Unconfigured State, Secret Redaction & Rate Limiting', async () => {
    const notificationDelivery = require('../server/notification-delivery-service');
    notificationDelivery.clearCustomTransportAdapter();
    notificationDelivery.resetRateLimitState();

    // 1. Honest unconfigured status when env vars are absent
    const unconfStatus = notificationDelivery.getSafeExternalChannelStatus({});
    assert.equal(unconfStatus.TELEGRAM.configured, false);
    assert.equal(unconfStatus.TELEGRAM.status, 'UNCONFIGURED');
    assert.equal(unconfStatus.WEBHOOK.configured, false);
    assert.equal(unconfStatus.EMAIL.configured, false);

    const unconfDispatch = await notificationDelivery.dispatchExternalChannel(
      'TELEGRAM',
      { notificationId: 'N-1', title: 'Test', message: 'Test' },
      { env: {} }
    );
    assert.equal(unconfDispatch.ok, false);
    assert.equal(unconfDispatch.status, 'UNCONFIGURED');

    // 2. Secret non-exposure guarantee
    const mockEnv = {
      TELEGRAM_BOT_TOKEN: 'SECRET_TG_BOT_TOKEN_987654',
      TELEGRAM_CHAT_ID: 'SECRET_TG_CHAT_12345',
      NOTIFICATION_WEBHOOK_URL: 'https://hooks.example.com/secret-webhook-token-xyz'
    };
    const configuredStatus = notificationDelivery.getSafeExternalChannelStatus(mockEnv);
    const serializedStatus = JSON.stringify(configuredStatus);
    assert.equal(configuredStatus.TELEGRAM.configured, true);
    assert.equal(configuredStatus.WEBHOOK.configured, true);
    assert.equal(serializedStatus.includes('SECRET_TG_BOT_TOKEN_987654'), false);
    assert.equal(serializedStatus.includes('SECRET_TG_CHAT_12345'), false);
    assert.equal(serializedStatus.includes('secret-webhook-token-xyz'), false);

    // 3. Custom adapter delivery & secret sanitization on error
    notificationDelivery.setCustomTransportAdapter(async (channel) => {
      if (channel === 'TELEGRAM') {
        return { ok: true, status: 'DELIVERED', reason: 'Delivered via test adapter' };
      }
      throw new Error('Failed connecting to https://hooks.example.com/secret-webhook-token-xyz');
    });

    const tgRes = await notificationDelivery.dispatchExternalChannel(
      'TELEGRAM',
      { notificationId: 'N-2', userId: 'U-1', title: 'Alert', message: 'Body' },
      { env: mockEnv }
    );
    assert.equal(tgRes.ok, true);
    assert.equal(tgRes.status, 'DELIVERED');

    const whRes = await notificationDelivery.dispatchExternalChannel(
      'WEBHOOK',
      { notificationId: 'N-3', userId: 'U-1', title: 'Alert', message: 'Body' },
      { env: mockEnv }
    );
    assert.equal(whRes.ok, false);
    assert.equal(whRes.status, 'FAILED');
    assert.equal(whRes.reason.includes('secret-webhook-token-xyz'), false);
    assert.equal(whRes.reason.includes('[REDACTED]'), true);

    notificationDelivery.clearCustomTransportAdapter();
  });

  test('150. Task 15 Notification Center & Preferences UI DOM Elements & Module Wiring Verification', () => {
    const htmlPath = path.resolve(__dirname, '../web/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    const requiredTask15Ids = [
      'topNotificationBtn',
      'topNotificationBadge',
      'notifCenterSection',
      'notifUnreadCountPill',
      'notifMarkAllReadBtn',
      'notifRefreshBtn',
      'notifReadFilterSelect',
      'notifCategoryFilterSelect',
      'notifSymbolFilterInput',
      'notifDateFilterInput',
      'notifApplyFiltersBtn',
      'notifCenterListContainer',
      'notifPaginationSummary',
      'notifPrevPageBtn',
      'notifNextPageBtn',
      'notifBrowserPermBadge',
      'notifPreferencesForm',
      'notifPrefInApp',
      'notifPrefBrowser',
      'notifRequestBrowserPermBtn',
      'notifPrefSound',
      'notifPrefQuietEnabled',
      'notifPrefQuietStart',
      'notifPrefQuietEnd',
      'notifCatPrice',
      'notifCatPct',
      'notifCatVol',
      'notifCatInd',
      'notifCatStrat',
      'notifCatBreakout',
      'notifCatRisk',
      'notifCatEmergency',
      'notifExtTelegramStatus',
      'notifPrefTelegram',
      'notifExtWebhookStatus',
      'notifPrefWebhook',
      'notifExtEmailStatus',
      'notifPrefEmail',
      'notifSavePrefsBtn'
    ];

    for (const id of requiredTask15Ids) {
      assert.equal(
        html.includes(`id="${id}"`),
        true,
        `web/index.html missing required Task 15 Notification Center DOM element id="${id}"`
      );
    }

    assert.equal(
      html.includes('modules/notification-engine.js'),
      true,
      'web/index.html must load modules/notification-engine.js'
    );
  });

  /* =====================================================
     TASK 16 — COMPLETE DATABASE FINAL AUDIT & HARDENING TESTS
  ===================================================== */

  test('151. Task 16 Database Discovery & Single Source of Truth: Canonical Path Resolution & Zero Rogue SQLite Connections', () => {
    // 1. Verify DEFAULT_DB_PATH points to server/data/yashwin-trading.sqlite
    assert.equal(
      path.basename(serverDb.DEFAULT_DB_PATH),
      'yashwin-trading.sqlite',
      'Default production database filename must be yashwin-trading.sqlite'
    );
    assert.equal(
      serverDb.DEFAULT_DB_PATH,
      path.resolve(__dirname, '../server/data/yashwin-trading.sqlite'),
      'Default production database path must resolve to server/data/yashwin-trading.sqlite'
    );

    // 2. Verify relative paths passed to normalizeSqlitePathInput / resolveDbPath resolve deterministically against PROJECT_ROOT
    const relResolved = serverDb.normalizeSqlitePathInput('server/data/yashwin-trading.sqlite');
    assert.equal(relResolved, serverDb.DEFAULT_DB_PATH);
    assert.equal(serverDb.normalizeSqlitePathInput(':memory:'), ':memory:');

    // 3. Scan all server/ and web/ source files to verify NO module opens DatabaseSync or SQLite independently outside server/database.js
    const scanDirs = [
      path.resolve(__dirname, '../server'),
      path.resolve(__dirname, '../web'),
      path.resolve(__dirname, '../web/modules')
    ];
    for (const dir of scanDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
        const fullPath = path.join(dir, entry.name);
        if (fullPath === path.resolve(__dirname, '../server/database.js')) continue;
        const src = fs.readFileSync(fullPath, 'utf8');
        assert.equal(
          src.includes('new DatabaseSync'),
          false,
          `Module ${entry.name} must not open an independent SQLite connection outside server/database.js`
        );
        assert.equal(
          src.includes("require('node:sqlite')"),
          false,
          `Module ${entry.name} must not import node:sqlite directly outside server/database.js`
        );
      }
    }
  });

  test('152. Task 16 Full Schema, 26 Tables, V1–V9 Idempotent Migrations & Index Audit', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yashwin-t16-schema-'));
    const tmpDbFile = path.join(tmpDir, 'yashwin_task16_schema.sqlite');

    try {
      process.env.YASHWIN_DB_PATH = tmpDbFile;
      serverDb.closeDb();
      const db = serverDb.getDb(tmpDbFile);

      // Run audit check on fresh database initialization
      const audit1 = serverDb.runDatabaseAuditAndIntegrityCheck(tmpDbFile);
      assert.equal(audit1.ok, true);
      assert.equal(audit1.healthy, true);
      assert.equal(audit1.integrityCheck, 'ok');
      assert.equal(audit1.foreignKeyViolationsCount, 0);
      assert.equal(audit1.foreignKeysEnabled, true);
      assert.equal(audit1.journalMode.toLowerCase(), 'wal');
      assert.equal(audit1.schemaVersion, 9);
      assert.equal(audit1.latestExpectedSchemaVersion, 9);
      assert.equal(audit1.migrationsCount, 9);
      assert.equal(audit1.missingTables.length, 0);
      assert.equal(audit1.tablesCount, 26);

      // Verify all 9 migrations V1..V9 are recorded in order
      const versions = audit1.migrations.map((m) => m.version);
      assert.deepEqual(versions, [1, 2, 3, 4, 5, 6, 7, 8, 9]);

      // Re-run initializeSchema / reopen DB multiple times to prove strict idempotency
      serverDb.closeDb();
      serverDb.getDb(tmpDbFile);
      const audit2 = serverDb.runDatabaseAuditAndIntegrityCheck(tmpDbFile);
      assert.equal(audit2.ok, true);
      assert.equal(audit2.migrationsCount, 9);
      assert.equal(audit2.tablesCount, 26);
      assert.ok(audit2.indexesCount >= 35, `Expected at least 35 indexes, found ${audit2.indexesCount}`);

      // Verify key composite indexes exist
      const indexNames = new Set(audit2.indexes.map((i) => i.name));
      const requiredIndexes = [
        'idx_users_email_norm',
        'idx_user_sessions_token',
        'idx_paper_accounts_user_unique',
        'idx_paper_orders_user',
        'idx_paper_positions_user_status_opened',
        'idx_backtest_runs_user_created',
        'idx_user_watchlist_sort',
        'idx_market_alerts_owner_status',
        'idx_alert_events_owner_time',
        'idx_alert_notifications_owner_time',
        'idx_notification_delivery_owner'
      ];
      for (const idxName of requiredIndexes) {
        assert.equal(indexNames.has(idxName), true, `Missing required index ${idxName}`);
      }
    } finally {
      serverDb.closeDb();
      process.env.YASHWIN_DB_PATH = ':memory:';
      serverDb.getDb(':memory:');
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  test('153. Task 16 Atomic Transaction Rollback Verification: Zero Partial Writes on Mid-Transaction Failure', () => {
    serverDb.resetAllTablesForTest();
    const userId = 'USR-T16-TX-ROLLBACK';
    serverDb.createUserRecord({
      userId,
      name: 'Tx User',
      email: 'tx.rollback@yashwin.test',
      passwordHash: '$2b$10$validmockhash123456789012345678901234567890123456',
      passwordAlgo: 'bcrypt'
    });

    const acctBefore = serverDb.getPaperAccount(userId);
    assert.equal(acctBefore.tradesToday, 0);

    // 1. Force a mid-transaction failure inside withTransaction after inserting an order
    assert.throws(() => {
      serverDb.withTransaction((tx) => {
        tx.prepare(`
          INSERT INTO paper_orders (
            order_id, user_id, client_order_key, symbol, exchange, direction,
            order_type, asset_type, quantity, price, status, mode, created_at
          ) VALUES ('ORD-PARTIAL-FAIL', ?, 'KEY-PARTIAL-1', 'RELIANCE', 'NSE', 'BUY', 'ENTRY', 'EQUITY', 10, 2900, 'FILLED_PAPER', 'MANUAL_PAPER', ?)
        `).run(userId, new Date().toISOString());

        // Intentional error mid-transaction
        const err = new Error('Simulated mid-transaction failure');
        err.code = 'SIMULATED_TX_FAILURE';
        throw err;
      });
    }, /Simulated mid-transaction failure/);

    // Verify order was completely rolled back
    const ordersAfterFail = serverDb.listPaperOrders(50, userId);
    assert.equal(ordersAfterFail.length, 0, 'Rolled back transaction must leave zero orphan paper_orders');

    // 2. Open a valid position atomically, then verify duplicate open position attempt is rejected and rolled back cleanly
    const openRes = serverDb.recordOpenPositionTransaction({
      userId,
      clientOrderKey: 'KEY-VALID-OPEN-1',
      symbol: 'TCS',
      exchange: 'NSE',
      direction: 'BUY',
      assetType: 'EQUITY',
      qty: 5,
      effectiveQty: 5,
      entry: 4100,
      stop: 4050,
      target: 4200,
      mode: 'MANUAL_PAPER'
    });
    assert.ok(openRes.positionId);
    assert.equal(serverDb.listPaperOrders(50, userId).length, 1);
    assert.equal(serverDb.listPaperFills(50, userId).length, 1);

    // Attempt second open position -> must throw DUPLICATE_OPEN_POSITION and leave order/fill count unchanged at 1
    assert.throws(() => {
      serverDb.recordOpenPositionTransaction({
        userId,
        clientOrderKey: 'KEY-DUP-OPEN-2',
        symbol: 'INFY',
        exchange: 'NSE',
        direction: 'BUY',
        assetType: 'EQUITY',
        qty: 5,
        effectiveQty: 5,
        entry: 1800,
        stop: 1770,
        target: 1860,
        mode: 'MANUAL_PAPER'
      });
    }, (err) => err.code === 'DUPLICATE_OPEN_POSITION');

    assert.equal(serverDb.listPaperOrders(50, userId).length, 1);
    assert.equal(serverDb.listPaperFills(50, userId).length, 1);
  });

  test('154. Task 16 Foreign Key Cascade & Referential Integrity Verification', () => {
    serverDb.resetAllTablesForTest();
    const db = serverDb.getDb();

    const userId = 'USR-T16-FK-CASCADE';
    serverDb.createUserRecord({
      userId,
      name: 'FK User',
      email: 'fk.cascade@yashwin.test',
      passwordHash: '$2b$10$validmockhash123456789012345678901234567890123456',
      passwordAlgo: 'bcrypt'
    });

    serverDb.createSessionRecord({
      sessionId: 'SES-FK-1',
      userId,
      tokenHash: 'tok_hash_fk_1',
      csrfToken: 'csrf_fk_1',
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    });

    serverDb.createEmailChangeVerification({
      verificationId: 'VER-FK-1',
      userId,
      newEmail: 'fk.new@yashwin.test',
      tokenHash: 'ver_hash_fk_1',
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    });

    // Attempting to insert a session for a non-existent user MUST fail due to PRAGMA foreign_keys = ON
    assert.throws(() => {
      serverDb.createSessionRecord({
        sessionId: 'SES-ORPHAN-1',
        userId: 'NON-EXISTENT-USER-999',
        tokenHash: 'tok_hash_orphan_1',
        csrfToken: 'csrf_orphan_1',
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      });
    });

    // Deleting the user cascades to user_sessions and email_change_verifications
    db.prepare('DELETE FROM users WHERE user_id = ?').run(userId);
    const remSessions = db.prepare('SELECT COUNT(*) AS c FROM user_sessions WHERE user_id = ?').get(userId).c;
    const remVerifications = db.prepare('SELECT COUNT(*) AS c FROM email_change_verifications WHERE user_id = ?').get(userId).c;
    assert.equal(remSessions, 0, 'ON DELETE CASCADE must remove user_sessions when user is deleted');
    assert.equal(remVerifications, 0, 'ON DELETE CASCADE must remove email_change_verifications when user is deleted');

    const audit = serverDb.runDatabaseAuditAndIntegrityCheck();
    assert.equal(audit.foreignKeyViolationsCount, 0);
  });

  test('155. Task 16 Comprehensive Multi-User Isolation Across All User-Owned Tables', () => {
    serverDb.resetAllTablesForTest();
    const userA = 'USR-T16-ISO-A';
    const userB = 'USR-T16-ISO-B';

    serverDb.createUserRecord({
      userId: userA,
      name: 'Isolation User A',
      email: 'iso.a@yashwin.test',
      passwordHash: '$2b$10$validmockhashA23456789012345678901234567890123456'
    });
    serverDb.createUserRecord({
      userId: userB,
      name: 'Isolation User B',
      email: 'iso.b@yashwin.test',
      passwordHash: '$2b$10$validmockhashB23456789012345678901234567890123456'
    });

    // Populate every user-owned domain for User A
    const openA = serverDb.recordOpenPositionTransaction({
      userId: userA,
      clientOrderKey: 'ISO-ORD-A1',
      symbol: 'SBIN',
      exchange: 'NSE',
      direction: 'BUY',
      assetType: 'EQUITY',
      qty: 10,
      effectiveQty: 10,
      entry: 800,
      stop: 785,
      target: 830,
      mode: 'MANUAL_PAPER'
    });
    serverDb.recordClosePositionTransaction({
      userId: userA,
      positionId: openA.positionId,
      symbol: 'SBIN',
      exchange: 'NSE',
      direction: 'BUY',
      assetType: 'EQUITY',
      effectiveQty: 10,
      entry: 800,
      exitPrice: 820,
      stop: 785,
      target: 830,
      pnl: 200,
      reason: 'TARGET_EXIT',
      mode: 'MANUAL_PAPER'
    });

    serverDb.insertAuditEvent({ category: 'TRADE_DECISION', message: 'User A trade' }, userA);
    serverDb.insertAIDecision({ symbol: 'SBIN', signal: 'BULLISH', action: 'BUY', confidence: 82, risk: 'LOW' }, 'SBIN', userA);
    serverDb.insertStrategyDecision({ symbol: 'SBIN', decision: 'TRADE', action: 'BUY', confidence: 84, reason: 'Trend' }, 'SBIN', userA);
    serverDb.insertRiskEvent({ allowed: true, riskAmount: 150, reasons: [] }, 'SBIN', 'BUY', userA);
    const btRunIdA = serverDb.insertBacktestRun(
      {
        ok: true,
        symbol: 'SBIN',
        exchange: 'NSE',
        timeframe: 'FIVE_MINUTE',
        assetType: 'EQUITY',
        candlesProcessed: 40,
        metrics: { totalTrades: 2, winRate: 50, grossPnl: 300, netPnl: 300, maxDrawdown: 50, profitFactor: 2.0 }
      },
      userA
    );
    serverDb.addWatchlistItem({ key: 'SBIN', tradingsymbol: 'SBIN-EQ', name: 'SBIN', exchange: 'NSE', type: 'EQUITY' }, userA);
    serverDb.recordRecentSearch({ key: 'SBIN', tradingsymbol: 'SBIN-EQ', name: 'SBIN', exchange: 'NSE', type: 'EQUITY' }, userA);
    const alertA = serverDb.createMarketAlert(
      { symbol: 'SBIN', exchange: 'NSE', instrumentType: 'EQUITY', alertType: 'PRICE_ABOVE', thresholdValue: 810 },
      userA
    );
    const trigA = serverDb.recordTriggeredAlertEvent(
      { alertId: alertA.alertId, symbol: 'SBIN', exchange: 'NSE', observedPrice: 815, message: 'SBIN > 810' },
      userA
    );
    const notifA = serverDb.createNotificationFromAlertEvent(trigA.event, userA);
    serverDb.updateUserNotificationPreferences({ soundEnabled: true, quietHoursStart: '23:00' }, userA);

    // Verify User B sees ZERO records from User A across all repositories
    const acctB = serverDb.getPaperAccount(userB);
    assert.equal(acctB.realizedPnl, 0);
    assert.equal(acctB.tradesToday, 0);
    assert.equal(serverDb.getOpenPosition(userB), null);
    assert.equal(serverDb.listPaperOrders(50, userB).length, 0);
    assert.equal(serverDb.listPaperFills(50, userB).length, 0);
    assert.equal(serverDb.listTradeHistory(50, userB).length, 0);
    assert.equal(serverDb.listAuditEvents(null, 50, userB).length, 0);
    assert.equal(serverDb.listAIDecisions(50, userB).length, 0);
    assert.equal(serverDb.listStrategyDecisions(50, userB).length, 0);
    assert.equal(serverDb.listRiskEvents(50, userB).length, 0);
    assert.equal(serverDb.listBacktestRuns(20, userB).length, 0);
    assert.equal(serverDb.listWatchlist(userB).length, 0);
    assert.equal(serverDb.listRecentSearches(12, userB).length, 0);
    assert.equal(serverDb.listMarketAlerts({}, userB).length, 0);
    assert.equal(serverDb.listAlertEventsHistory({}, userB).length, 0);
    assert.equal(serverDb.listUserNotifications({}, userB).totalCount, 0);
    assert.equal(serverDb.listNotificationDeliveryLogs(null, userB).length, 0);
    assert.equal(serverDb.getUserNotificationPreferences(userB).soundEnabled, false);

    // Direct cross-user ID lookups or mutations by User B must throw FORBIDDEN_OWNERSHIP
    assert.throws(() => serverDb.getPositionByIdForUser(openA.positionId, userB), (e) => e.code === 'FORBIDDEN_OWNERSHIP');
    assert.throws(() => serverDb.getBacktestRunById(btRunIdA, userB), (e) => e.code === 'FORBIDDEN_OWNERSHIP');
    assert.throws(() => serverDb.getMarketAlertById(alertA.alertId, userB), (e) => e.code === 'FORBIDDEN_OWNERSHIP');
    assert.throws(() => serverDb.updateMarketAlertStatus(alertA.alertId, { status: 'PAUSED' }, userB), (e) => e.code === 'FORBIDDEN_OWNERSHIP');
    assert.throws(() => serverDb.deleteMarketAlert(alertA.alertId, userB), (e) => e.code === 'FORBIDDEN_OWNERSHIP');
    assert.throws(() => serverDb.acknowledgeAlertEvent(trigA.event.eventId, userB), (e) => e.code === 'FORBIDDEN_OWNERSHIP');
    assert.throws(() => serverDb.getNotificationById(notifA.notification.notificationId, userB), (e) => e.code === 'FORBIDDEN_OWNERSHIP');
    assert.throws(() => serverDb.markNotificationRead(notifA.notification.notificationId, userB), (e) => e.code === 'FORBIDDEN_OWNERSHIP');
  });

  test('156. Task 16 Secret Redaction & Credential Non-Persistence Across All Database Payloads', () => {
    serverDb.resetAllTablesForTest();
    const userId = 'USR-T16-REDACT';

    // Attempt to pass sensitive keys into audit events, settings, AI decisions, strategy decisions, risk events, and delivery logs
    const sensitivePayload = {
      angel_api_key: 'RAW_ANGEL_SECRET_KEY_111',
      angel_pin: '9999',
      angel_totp_secret: 'RAW_TOTP_SECRET_222',
      gemini_api_key: 'RAW_GEMINI_SECRET_333',
      finnhub_api_key: 'RAW_FINNHUB_SECRET_444',
      telegram_bot_token: 'RAW_TG_TOKEN_555',
      notification_webhook_url: 'https://hooks.example.com/raw-secret-666',
      password: 'RawPlainPassword#777',
      token_hash: 'RawSessionTokenHash#888',
      csrf_token: 'RawCsrfSecret#999',
      safeField: 'VISIBLE_SAFE_VALUE'
    };

    serverDb.setSetting('test_redaction_setting', sensitivePayload);
    serverDb.insertAuditEvent({ category: 'SYSTEM', message: 'Redaction check', details: sensitivePayload }, userId);
    serverDb.insertAIDecision({ symbol: 'NIFTY 50', signal: 'NO_TRADE', action: 'HOLD', confidence: 50, risk: 'LOW', extra: sensitivePayload }, 'NIFTY 50', userId);
    serverDb.insertStrategyDecision({ symbol: 'NIFTY 50', decision: 'NO_TRADE', action: 'NO_TRADE', confidence: 50, reason: 'Check', extra: sensitivePayload }, 'NIFTY 50', userId);
    serverDb.insertRiskEvent({ allowed: false, riskAmount: 0, reasons: ['Check'], extra: sensitivePayload }, 'NIFTY 50', 'BUY', userId);

    // Inspect raw SQLite storage directly to prove no raw secret string was written to disk/memory
    const db = serverDb.getDb();
    const rawSetting = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'test_redaction_setting'`).get().value_json;
    const rawAudit = db.prepare(`SELECT details_json FROM audit_events WHERE user_id = ?`).get(userId).details_json;
    const rawAi = db.prepare(`SELECT payload_json FROM ai_decisions WHERE user_id = ?`).get(userId).payload_json;
    const rawStrat = db.prepare(`SELECT payload_json FROM strategy_decisions WHERE user_id = ?`).get(userId).payload_json;
    const rawRisk = db.prepare(`SELECT payload_json FROM risk_events WHERE user_id = ?`).get(userId).payload_json;

    for (const rawJson of [rawSetting, rawAudit, rawAi, rawStrat, rawRisk]) {
      assert.equal(rawJson.includes('RAW_ANGEL_SECRET_KEY_111'), false);
      assert.equal(rawJson.includes('RAW_TOTP_SECRET_222'), false);
      assert.equal(rawJson.includes('RAW_GEMINI_SECRET_333'), false);
      assert.equal(rawJson.includes('RAW_FINNHUB_SECRET_444'), false);
      assert.equal(rawJson.includes('RAW_TG_TOKEN_555'), false);
      assert.equal(rawJson.includes('raw-secret-666'), false);
      assert.equal(rawJson.includes('RawPlainPassword#777'), false);
      assert.equal(rawJson.includes('RawSessionTokenHash#888'), false);
      assert.equal(rawJson.includes('RawCsrfSecret#999'), false);
      assert.equal(rawJson.includes('[REDACTED]'), true);
      assert.equal(rawJson.includes('VISIBLE_SAFE_VALUE'), true);
    }

    const auditReport = serverDb.runDatabaseAuditAndIntegrityCheck();
    assert.equal(auditReport.invariants.zeroUnredactedSecretsInJsonOk, true);
  });

  test('157. Task 16 Full Multi-Module Restart Persistence & Reconciliation (Tasks 2–15)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yashwin-t16-restart-'));
    const tmpDbFile = path.join(tmpDir, 'yashwin_task16_restart.sqlite');

    try {
      process.env.YASHWIN_DB_PATH = tmpDbFile;
      serverDb.closeDb();
      serverDb.getDb(tmpDbFile);

      const userId = 'USR-T16-RESTART-1';
      serverDb.createUserRecord({
        userId,
        name: 'Restart Trader',
        email: 'restart@yashwin.test',
        passwordHash: '$2b$10$validmockhashRestart12345678901234567890123456789'
      });

      // 1. Open and close a trade, then open a second active position
      const pos1 = serverDb.recordOpenPositionTransaction({
        userId,
        clientOrderKey: 'RST-ORD-1',
        symbol: 'RELIANCE',
        exchange: 'NSE',
        direction: 'BUY',
        assetType: 'EQUITY',
        qty: 10,
        effectiveQty: 10,
        entry: 2900,
        stop: 2860,
        target: 2980,
        mode: 'MANUAL_PAPER'
      });
      serverDb.recordClosePositionTransaction({
        userId,
        positionId: pos1.positionId,
        symbol: 'RELIANCE',
        exchange: 'NSE',
        direction: 'BUY',
        assetType: 'EQUITY',
        effectiveQty: 10,
        entry: 2900,
        exitPrice: 2950,
        stop: 2860,
        target: 2980,
        pnl: 500,
        reason: 'TARGET_EXIT',
        mode: 'MANUAL_PAPER'
      });

      const pos2 = serverDb.recordOpenPositionTransaction({
        userId,
        clientOrderKey: 'RST-ORD-2',
        symbol: 'HDFCBANK',
        exchange: 'NSE',
        direction: 'BUY',
        assetType: 'EQUITY',
        qty: 20,
        effectiveQty: 20,
        entry: 1600,
        stop: 1580,
        target: 1650,
        mode: 'MANUAL_PAPER'
      });
      serverDb.updateOpenPositionState(
        {
          id: pos2.positionId,
          userId,
          current: 1615,
          trailingStop: 1595,
          lockedProfit: 100,
          nextProfitMilestone: 400,
          targetActivated: false,
          unrealizedPnl: 300
        },
        userId
      );

      // 2. Save watchlist, alert, notification, preference, and backtest run
      serverDb.addWatchlistItem({ key: 'HDFCBANK', tradingsymbol: 'HDFCBANK-EQ', name: 'HDFC Bank', exchange: 'NSE', type: 'EQUITY' }, userId);
      const alert = serverDb.createMarketAlert(
        { symbol: 'HDFCBANK', exchange: 'NSE', instrumentType: 'EQUITY', alertType: 'PRICE_ABOVE', thresholdValue: 1610 },
        userId
      );
      serverDb.evaluateUserAlertsAgainstMarketData(
        { HDFCBANK: { snapshot: { symbol: 'HDFCBANK', exchange: 'NSE', price: 1615, timestamp: new Date().toISOString() } } },
        userId
      );
      serverDb.updateUserNotificationPreferences({ browserNotificationsEnabled: true, soundEnabled: true }, userId);
      const btRunId = serverDb.insertBacktestRun(
        {
          ok: true,
          symbol: 'HDFCBANK',
          exchange: 'NSE',
          timeframe: 'FIFTEEN_MINUTE',
          assetType: 'EQUITY',
          candlesProcessed: 60,
          metrics: { totalTrades: 3, winRate: 66.67, grossPnl: 750, netPnl: 750, maxDrawdown: 120, profitFactor: 3.1 }
        },
        userId
      );

      // 3. Simulate full server restart (close SQLite connection and reopen from disk)
      serverDb.closeDb();
      serverDb.getDb(tmpDbFile);

      // 4. Reconcile all state after restart
      const acct = serverDb.getPaperAccount(userId);
      const openPos = serverDb.getOpenPosition(userId);
      const orders = serverDb.listPaperOrders(50, userId);
      const fills = serverDb.listPaperFills(50, userId);
      const trades = serverDb.listTradeHistory(50, userId);

      assert.equal(acct.capital, 100000);
      assert.equal(acct.realizedPnl, 500);
      assert.equal(acct.unrealizedPnl, 300);
      assert.equal(acct.reservedCapital, 32000); // 20 * 1600
      assert.equal(acct.availableBalance, 100000 + 500 - 32000);
      assert.equal(acct.totalEquity, 100000 + 500 + 300);
      assert.equal(acct.tradesToday, 2);
      assert.equal(acct.wins, 1);
      assert.equal(acct.losses, 0);

      assert.ok(openPos);
      assert.equal(openPos.id, pos2.positionId);
      assert.equal(openPos.current, 1615);
      assert.equal(openPos.unrealizedPnl, 300);

      assert.equal(orders.length, 3); // 2 ENTRY + 1 EXIT
      assert.equal(fills.length, 3);
      assert.equal(trades.length, 1);
      assert.equal(trades[0].entryOrderId, pos1.orderId);
      assert.equal(trades[0].entryFillId, pos1.fillId);

      assert.equal(serverDb.listWatchlist(userId).length, 1);
      assert.equal(serverDb.getMarketAlertById(alert.alertId, userId).status, 'TRIGGERED');
      assert.equal(serverDb.listAlertEventsHistory({}, userId).length, 1);
      assert.equal(serverDb.listUserNotifications({}, userId).unreadCount, 1);
      assert.equal(serverDb.getUserNotificationPreferences(userId).browserNotificationsEnabled, true);
      assert.equal(serverDb.getBacktestRunById(btRunId, userId).netPnl, 750);
    } finally {
      serverDb.closeDb();
      process.env.YASHWIN_DB_PATH = ':memory:';
      serverDb.getDb(':memory:');
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  test('158. Task 16 HTTP /api/database/audit & /api/readiness/audit Endpoint Verification', async () => {
    serverDb.resetAllTablesForTest();
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const dbAuditRes = await requestServer(server, '/api/database/audit');
    assert.equal(dbAuditRes.status, 200);
    assert.equal(dbAuditRes.json.ok, true);
    assert.equal(dbAuditRes.json.mode, 'PAPER');
    assert.equal(dbAuditRes.json.liveTradingEnabled, false);
    assert.equal(dbAuditRes.json.brokerExecution, 'NONE');
    assert.equal(dbAuditRes.json.databaseAudit.healthy, true);
    assert.equal(dbAuditRes.json.databaseAudit.singleSourceOfTruth, true);
    assert.equal(dbAuditRes.json.databaseAudit.schemaVersion, 9);
    assert.equal(dbAuditRes.json.databaseAudit.tablesCount, 26);
    assert.equal(dbAuditRes.json.databaseAudit.integrityCheck, 'ok');
    assert.equal(dbAuditRes.json.databaseAudit.foreignKeyViolationsCount, 0);

    const readinessRes = await requestServer(server, '/api/readiness/audit');
    assert.equal(readinessRes.status, 200);
    assert.ok(readinessRes.json.databaseAudit);
    assert.equal(readinessRes.json.databaseAudit.healthy, true);
  });

  // =========================================================
  // TASK 17 — COMPLETE WEB APP & PWA IMPLEMENTATION TESTS
  // =========================================================

  test('159. Task 17 PWA Manifest & Icons: Valid manifest.webmanifest and PNG/SVG icon files exist and meet PWA specification', () => {
    const manifestPath = path.join(__dirname, '..', 'web', 'manifest.webmanifest');
    assert.ok(fs.existsSync(manifestPath), 'web/manifest.webmanifest must exist');

    const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);

    assert.equal(manifest.name, 'YASHWIN AI Trading Assistant');
    assert.equal(manifest.short_name, 'YASHWIN AI');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.background_color, '#07111f');
    assert.equal(manifest.theme_color, '#07111f');
    assert.ok(Array.isArray(manifest.icons), 'manifest.icons must be an array');
    assert.ok(manifest.icons.length >= 4, 'manifest must declare 192x192, 512x512, maskable, and SVG icons');

    const has192 = manifest.icons.some((i) => i.sizes === '192x192' && i.type === 'image/png');
    const has512 = manifest.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png' && i.purpose === 'any');
    const hasMaskable = manifest.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png' && i.purpose === 'maskable');
    assert.ok(has192, 'Must include 192x192 PNG icon');
    assert.ok(has512, 'Must include 512x512 any PNG icon');
    assert.ok(hasMaskable, 'Must include 512x512 maskable PNG icon');

    // Verify every referenced icon file actually exists on disk and has valid PNG/SVG signature
    for (const icon of manifest.icons) {
      const cleanSrc = icon.src.replace(/^\//, '');
      const iconDiskPath = path.join(__dirname, '..', 'web', cleanSrc);
      assert.ok(fs.existsSync(iconDiskPath), `Icon file ${cleanSrc} must exist on disk`);
      const buf = fs.readFileSync(iconDiskPath);
      assert.ok(buf.length > 100, `Icon file ${cleanSrc} must be non-empty`);
      if (icon.type === 'image/png') {
        // PNG magic header: 89 50 4E 47 0D 0A 1A 0A
        assert.equal(buf[0], 0x89);
        assert.equal(buf[1], 0x50);
        assert.equal(buf[2], 0x4e);
        assert.equal(buf[3], 0x47);
      }
    }

    // Also verify apple-touch-icon
    const appleTouchPath = path.join(__dirname, '..', 'web', 'apple-touch-icon.png');
    assert.ok(fs.existsSync(appleTouchPath), 'apple-touch-icon.png must exist');
  });

  test('160. Task 17 HTTP Static Serving: Server serves manifest.webmanifest, sw.js, and icons with proper MIME types and Service-Worker-Allowed headers', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const manifestRes = await requestServer(server, '/manifest.webmanifest');
    assert.equal(manifestRes.status, 200);
    assert.ok(
      String(manifestRes.headers['content-type'] || '').includes('application/manifest+json'),
      'manifest.webmanifest must be served with application/manifest+json content-type'
    );
    assert.equal(manifestRes.json.short_name, 'YASHWIN AI');

    const swRes = await requestServer(server, '/sw.js');
    assert.equal(swRes.status, 200);
    assert.ok(
      String(swRes.headers['content-type'] || '').includes('application/javascript'),
      'sw.js must be served with application/javascript content-type'
    );
    assert.equal(swRes.headers['service-worker-allowed'], '/');
    assert.ok(
      String(swRes.headers['cache-control'] || '').includes('no-cache'),
      'sw.js must have no-cache Cache-Control header'
    );

    const pwaEngineRes = await requestServer(server, '/modules/pwa-engine.js');
    assert.equal(pwaEngineRes.status, 200);
    assert.ok(pwaEngineRes.text.includes('PWAEngine'));
  });

  test('161. Task 17 Service Worker Security & Cache Hygiene: Strictly precaches static shell ONLY and never caches /api/*, credentials, or live market data', () => {
    const swModule = require('../web/sw.js');
    const PWAEngine = require('../web/modules/pwa-engine.js');

    assert.ok(Array.isArray(swModule.PRECACHE_SHELL_ASSETS));
    assert.ok(swModule.PRECACHE_SHELL_ASSETS.includes('/index.html'));
    assert.ok(swModule.PRECACHE_SHELL_ASSETS.includes('/style.css'));
    assert.ok(swModule.PRECACHE_SHELL_ASSETS.includes('/app.js'));
    assert.ok(swModule.PRECACHE_SHELL_ASSETS.includes('/manifest.webmanifest'));
    assert.ok(swModule.PRECACHE_SHELL_ASSETS.includes('/modules/pwa-engine.js'));

    // Ensure no API route or database file is in PRECACHE_SHELL_ASSETS
    for (const asset of swModule.PRECACHE_SHELL_ASSETS) {
      assert.equal(asset.startsWith('/api/'), false, `Static shell must never include API route: ${asset}`);
      assert.equal(asset.includes('.sqlite') || asset.includes('.db'), false, `Static shell must never include DB file: ${asset}`);
    }

    // Verify isSensitiveOrDynamicRequest blocks all /api/* and auth/trading endpoints
    assert.equal(swModule.isSensitiveOrDynamicRequest('/api/market/ltp?symbol=RELIANCE'), true);
    assert.equal(swModule.isSensitiveOrDynamicRequest('/api/auth/me'), true);
    assert.equal(swModule.isSensitiveOrDynamicRequest('/api/paper/state'), true);
    assert.equal(swModule.isSensitiveOrDynamicRequest('/api/watchlist'), true);
    assert.equal(swModule.isSensitiveOrDynamicRequest('/api/alerts'), true);
    assert.equal(swModule.isSensitiveOrDynamicRequest('/api/notifications'), true);
    assert.equal(swModule.isSensitiveOrDynamicRequest('/order/place', 'POST'), true);
    assert.equal(swModule.isSensitiveOrDynamicRequest('/index.html?csrf=abc123'), true);

    // Static shell assets are allowed to be cached
    assert.equal(swModule.isSensitiveOrDynamicRequest('/style.css'), false);
    assert.equal(swModule.isSensitiveOrDynamicRequest('/modules/market-api.js'), false);
    assert.equal(swModule.isAllowedShellAssetPath('/style.css'), true);
    assert.equal(swModule.isAllowedShellAssetPath('/api/market/ltp'), false);

    // Verify offline API response never fabricates prices or signals
    const offlineResp = swModule.buildOfflineApiResponse('/api/market/ltp');
    let bodyObj = offlineResp;
    if (typeof Response === 'function' && offlineResp instanceof Response) {
      assert.equal(offlineResp.status, 503);
    } else if (offlineResp && typeof offlineResp === 'object') {
      assert.equal(bodyObj.ok, false);
      assert.equal(bodyObj.offline, true);
      assert.equal(bodyObj.tradingMode, 'PAPER');
      assert.equal(bodyObj.liveTradingEnabled, false);
    }

    // Verify PWAEngine status snapshot confirms policy compliance
    const status = PWAEngine.getStatusSnapshot();
    assert.equal(status.tradingMode, 'PAPER');
    assert.equal(status.liveTradingEnabled, false);
    assert.equal(status.supportedPages.length, 12);
  });

  test('162. Task 17 Offline Honesty & Action Guards: Blocks trade/alert/watchlist mutations while offline without fabricating prices or signals', () => {
    const PWAEngine = require('../web/modules/pwa-engine.js');

    // Simulate offline state
    const offlineSnap = PWAEngine.setOnlineStatus(false);
    assert.equal(offlineSnap.online, false);
    assert.equal(offlineSnap.connectionBadge, 'OFFLINE (CACHED SHELL)');

    const paperCheck = PWAEngine.guardOnlineAction('PAPER_ORDER_EXECUTION', { online: false });
    assert.equal(paperCheck.allowed, false);
    assert.equal(paperCheck.code, 'OFFLINE_ACTION_BLOCKED');
    assert.equal(paperCheck.tradingMode, 'PAPER');
    assert.equal(paperCheck.liveTradingEnabled, false);
    assert.ok(paperCheck.reason.includes('offline'));
    assert.ok(paperCheck.reason.includes('No synthetic prices, signals, or fake fills are generated'));

    const quoteCheck = PWAEngine.guardOnlineAction('LIVE_QUOTE_FETCH', { online: false });
    assert.equal(quoteCheck.allowed, false);

    // Restore online state
    const onlineSnap = PWAEngine.setOnlineStatus(true);
    assert.equal(onlineSnap.online, true);
    assert.equal(onlineSnap.connectionBadge, 'ONLINE');

    const onlineCheck = PWAEngine.guardOnlineAction('PAPER_ORDER_EXECUTION', { online: true });
    assert.equal(onlineCheck.allowed, true);
    assert.equal(onlineCheck.code, 'ONLINE_READY');
  });

  test('163. Task 17 Install Prompt & Standalone Detection Lifecycle', async () => {
    const PWAEngine = require('../web/modules/pwa-engine.js');

    let installTriggered = false;
    const fakeEvent = {
      preventDefault() {},
      prompt: async () => {
        installTriggered = true;
      },
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' })
    };

    const captured = PWAEngine.captureInstallPrompt(fakeEvent);
    assert.equal(captured, true);
    assert.equal(PWAEngine.getStatusSnapshot().canPromptInstall, true);

    const promptRes = await PWAEngine.triggerInstallPrompt();
    assert.equal(installTriggered, true);
    assert.equal(promptRes.ok, true);
    assert.equal(promptRes.outcome, 'accepted');
    assert.equal(PWAEngine.getStatusSnapshot().canPromptInstall, false);
  });

  test('164. Task 17 Logout Cache & Storage Hygiene: Clears dynamic user storage keys while preserving non-sensitive theme preferences', async () => {
    const PWAEngine = require('../web/modules/pwa-engine.js');

    const mockStorage = {
      store: {
        'yashwin_theme_v1': 'dark',
        'yashwin_paper_state_v1__usr_123': '{"capital":100000}',
        'yashwin_user_session_cache': 'secret-session',
        'yashwin_csrf_token': 'secret-csrf',
        'yashwin_auth_profile': 'user-1'
      },
      get length() {
        return Object.keys(this.store).length;
      },
      key(idx) {
        return Object.keys(this.store)[idx] || null;
      },
      removeItem(k) {
        delete this.store[k];
      },
      clear() {
        this.store = {};
      }
    };

    const res = await PWAEngine.clearSensitiveClientStorage({ localStorage: mockStorage });
    assert.equal(res.ok, true);
    assert.equal(mockStorage.store['yashwin_theme_v1'], 'dark', 'Theme preference must be preserved');
    assert.equal(mockStorage.store['yashwin_paper_state_v1__usr_123'], undefined, 'User paper cache must be purged');
    assert.equal(mockStorage.store['yashwin_user_session_cache'], undefined, 'Session cache must be purged');
    assert.equal(mockStorage.store['yashwin_csrf_token'], undefined, 'CSRF cache must be purged');
    assert.equal(mockStorage.store['yashwin_auth_profile'], undefined, 'Auth profile must be purged');
  });

  test('165. Task 17 Responsive Web App HTML Structure: Verifies PWA head links, offline banner, install button, and complete 12-module mobile navigation', () => {
    const indexHtmlPath = path.join(__dirname, '..', 'web', 'index.html');
    const html = fs.readFileSync(indexHtmlPath, 'utf8');

    // PWA Head tags
    assert.ok(html.includes('rel="manifest" href="/manifest.webmanifest"'), 'Must link /manifest.webmanifest');
    assert.ok(html.includes('name="theme-color" content="#07111f"'), 'Must include theme-color meta tag');
    assert.ok(html.includes('rel="apple-touch-icon" href="/apple-touch-icon.png"'), 'Must include apple-touch-icon');
    assert.ok(html.includes('modules/pwa-engine.js'), 'Must load modules/pwa-engine.js');

    // Topbar PWA controls & Offline banner
    assert.ok(html.includes('id="pwaInstallBtn"'), 'Must include pwaInstallBtn in topbar');
    assert.ok(html.includes('id="pwaNetworkStatusBadge"'), 'Must include pwaNetworkStatusBadge in topbar');
    assert.ok(html.includes('id="pwaOfflineBanner"'), 'Must include honest pwaOfflineBanner');
    assert.ok(html.includes('id="pwaIosInstallModal"'), 'Must include iOS install instructions modal');

    // All 12 modules accessible in both sidebar and mobile navigation bar
    const requiredPages = [
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

    const mobileNavMatch = html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/);
    assert.ok(mobileNavMatch, 'mobile-nav element must exist in index.html');
    const mobileNavHtml = mobileNavMatch[0];

    for (const pageId of requiredPages) {
      assert.ok(
        mobileNavHtml.includes(`data-page="${pageId}"`),
        `Mobile navigation must include button for data-page="${pageId}"`
      );
      assert.ok(
        html.includes(`data-section="${pageId}"`),
        `Page section data-section="${pageId}" must exist in index.html`
      );
    }

    // Safety mode lock indicators remain intact
    assert.ok(html.includes('PAPER MODE ONLY'));
    assert.ok(html.includes('id="pwaUpdateBanner"'));
  });

  // =========================================================
  // TASK 18 — COMPLETE ANDROID APP & APK IMPLEMENTATION TESTS
  // =========================================================

  test('166. Task 18 Android Project Structure, Application ID, SDK Versions & Paper-Only BuildConfig Verification', () => {
    const androidDir = path.join(__dirname, '..', 'android');
    assert.ok(fs.existsSync(androidDir), 'android/ root directory must exist');
    assert.ok(fs.existsSync(path.join(androidDir, 'settings.gradle.kts')), 'settings.gradle.kts must exist');
    assert.ok(fs.existsSync(path.join(androidDir, 'build.gradle.kts')), 'root build.gradle.kts must exist');
    assert.ok(fs.existsSync(path.join(androidDir, 'gradle.properties')), 'gradle.properties must exist');
    assert.ok(fs.existsSync(path.join(androidDir, 'gradlew')), 'gradlew script must exist');
    assert.ok(fs.existsSync(path.join(androidDir, 'gradlew.bat')), 'gradlew.bat script must exist');
    assert.ok(
      fs.existsSync(path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.properties')),
      'gradle-wrapper.properties must exist'
    );

    const appGradlePath = path.join(androidDir, 'app', 'build.gradle.kts');
    assert.ok(fs.existsSync(appGradlePath), 'app/build.gradle.kts must exist');
    const appGradle = fs.readFileSync(appGradlePath, 'utf8');

    assert.ok(appGradle.includes('namespace = "com.yashwin.aitrading"'), 'Must declare namespace com.yashwin.aitrading');
    assert.ok(appGradle.includes('applicationId = "com.yashwin.aitrading"'), 'Must declare applicationId com.yashwin.aitrading');
    assert.ok(appGradle.includes('compileSdk = 34'), 'Must target compileSdk 34');
    assert.ok(appGradle.includes('minSdk = 26'), 'Must specify minSdk 26');
    assert.ok(appGradle.includes('targetSdk = 34'), 'Must specify targetSdk 34');
    assert.ok(
      appGradle.includes('buildConfigField("String", "TRADING_MODE", "\\"paper\\"")'),
      'BuildConfig must lock TRADING_MODE to paper'
    );
    assert.ok(
      appGradle.includes('buildConfigField("boolean", "LIVE_TRADING_ENABLED", "false")'),
      'BuildConfig must lock LIVE_TRADING_ENABLED to false'
    );
    assert.ok(
      appGradle.includes('JavaVersion.VERSION_17'),
      'Must configure Java 17 compatibility'
    );
  });

  test('167. Task 18 AndroidManifest, Network Security Config & Launcher Resources Verification', () => {
    const mainDir = path.join(__dirname, '..', 'android', 'app', 'src', 'main');
    const manifestPath = path.join(mainDir, 'AndroidManifest.xml');
    assert.ok(fs.existsSync(manifestPath), 'AndroidManifest.xml must exist');
    const manifestXml = fs.readFileSync(manifestPath, 'utf8');

    // Minimal permissions only
    assert.ok(manifestXml.includes('android.permission.INTERNET'), 'Must request INTERNET permission');
    assert.ok(manifestXml.includes('android.permission.ACCESS_NETWORK_STATE'), 'Must request ACCESS_NETWORK_STATE permission');
    assert.equal(manifestXml.includes('READ_EXTERNAL_STORAGE'), false, 'Must not request storage permissions');
    assert.equal(manifestXml.includes('CAMERA'), false, 'Must not request camera permissions');
    assert.equal(manifestXml.includes('ACCESS_FINE_LOCATION'), false, 'Must not request location permissions');

    // Security attributes
    assert.ok(manifestXml.includes('android:allowBackup="false"'), 'Must disable cloud backup of session cookies');
    assert.ok(manifestXml.includes('android:usesCleartextTraffic="false"'), 'Must disable global cleartext traffic');
    assert.ok(manifestXml.includes('android:networkSecurityConfig="@xml/network_security_config"'), 'Must reference network_security_config');
    assert.ok(manifestXml.includes('com.yashwin.aitrading.TRADING_MODE'), 'Must include TRADING_MODE metadata');
    assert.ok(manifestXml.includes('com.yashwin.aitrading.LIVE_TRADING_ENABLED'), 'Must include LIVE_TRADING_ENABLED metadata');

    // Verify network_security_config.xml
    const netSecPath = path.join(mainDir, 'res', 'xml', 'network_security_config.xml');
    assert.ok(fs.existsSync(netSecPath), 'network_security_config.xml must exist');
    const netSecXml = fs.readFileSync(netSecPath, 'utf8');
    assert.ok(netSecXml.includes('cleartextTrafficPermitted="false"'), 'Base config must disallow cleartext HTTP');
    assert.ok(netSecXml.includes('<domain includeSubdomains="false">10.0.2.2</domain>'), 'Emulator loopback 10.0.2.2 allowed for local dev');

    // Verify strings.xml app_name
    const stringsPath = path.join(mainDir, 'res', 'values', 'strings.xml');
    const stringsXml = fs.readFileSync(stringsPath, 'utf8');
    assert.ok(stringsXml.includes('<string name="app_name">YASHWIN AI Trading</string>'), 'App name must be YASHWIN AI Trading');
    assert.ok(stringsXml.includes('PAPER MODE ONLY'), 'Must label Paper Mode Only in strings.xml');

    // Verify launcher mipmap icons across all 5 densities
    const densities = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
    for (const d of densities) {
      const iconFile = path.join(mainDir, 'res', d, 'ic_launcher.png');
      const roundFile = path.join(mainDir, 'res', d, 'ic_launcher_round.png');
      assert.ok(fs.existsSync(iconFile), `${d}/ic_launcher.png must exist`);
      assert.ok(fs.existsSync(roundFile), `${d}/ic_launcher_round.png must exist`);
      const buf = fs.readFileSync(iconFile);
      assert.equal(buf[0], 0x89);
      assert.equal(buf[1], 0x50);
      assert.equal(buf[2], 0x4e);
      assert.equal(buf[3], 0x47);
    }
  });

  test('168. Task 18 MainActivity Kotlin Security Hardening & Zero Secrets Audit across Android Project', () => {
    const activityPath = path.join(
      __dirname,
      '..',
      'android',
      'app',
      'src',
      'main',
      'java',
      'com',
      'yashwin',
      'aitrading',
      'MainActivity.kt'
    );
    assert.ok(fs.existsSync(activityPath), 'MainActivity.kt must exist');
    const kt = fs.readFileSync(activityPath, 'utf8');

    // TLS validation must never call handler.proceed()
    assert.ok(kt.includes('onReceivedSslError'), 'Must implement onReceivedSslError');
    assert.ok(kt.includes('handler?.cancel()'), 'Must cancel invalid SSL/TLS connections');
    assert.equal(/handler\??\.proceed\s*\(/.test(kt), false, 'Must NEVER call SslErrorHandler.proceed()');

    // No unrestricted JS bridge invocation
    assert.equal(/\.addJavascriptInterface\s*\(/.test(kt), false, 'Must not invoke unrestricted addJavascriptInterface()');

    // File access disabled in WebView
    assert.ok(kt.includes('settings.allowFileAccess = false'), 'Must disable WebView file access');
    assert.ok(kt.includes('settings.allowContentAccess = false'), 'Must disable WebView content access');
    assert.ok(kt.includes('WebSettings.MIXED_CONTENT_NEVER_ALLOW'), 'Must block mixed content');

    // Back navigation & session cleanup
    assert.ok(kt.includes('OnBackPressedCallback'), 'Must handle Android back navigation cleanly');
    assert.ok(kt.includes('clearAndroidWebViewSessionOnLogout'), 'Must provide WebView cookie/storage cleanup helper');

    // Scan all files under android/ for any leaked secrets or forbidden keys
    function walkFiles(dir) {
      let results = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(walkFiles(full));
        } else if (!entry.name.endsWith('.png')) {
          results.push(full);
        }
      }
      return results;
    }

    const androidFiles = walkFiles(path.join(__dirname, '..', 'android'));
    const forbiddenSecretPatterns = [
      /ANGEL_API_KEY\s*=\s*["'][^"']+["']/i,
      /ANGEL_CLIENT_ID\s*=\s*["'][^"']+["']/i,
      /ANGEL_PIN\s*=\s*["'][^"']+["']/i,
      /ANGEL_TOTP_SECRET\s*=\s*["'][^"']+["']/i,
      /GEMINI_API_KEY\s*=\s*["'][^"']+["']/i,
      /GOOGLE_AI_API_KEY\s*=\s*["'][^"']+["']/i
    ];

    for (const f of androidFiles) {
      const content = fs.readFileSync(f, 'utf8');
      for (const rx of forbiddenSecretPatterns) {
        assert.equal(rx.test(content), false, `Android file ${f} must never contain embedded credentials`);
      }
    }
  });

  test('169. Task 18 Android Backend URL Validation & Localhost Physical Device Guard', () => {
    const PWAEngine = require('../web/modules/pwa-engine.js');

    // 1. Localhost must be rejected on Android because localhost refers to the phone itself
    const localhostCheck = PWAEngine.validateBackendEndpointForAndroid('http://localhost:3000');
    assert.equal(localhostCheck.valid, false);
    assert.equal(localhostCheck.code, 'ANDROID_LOCALHOST_FORBIDDEN');
    assert.ok(localhostCheck.reason.includes('refers to the phone itself'));

    const loopbackCheck = PWAEngine.validateBackendEndpointForAndroid('http://127.0.0.1:3000');
    assert.equal(loopbackCheck.valid, false);
    assert.equal(loopbackCheck.code, 'ANDROID_LOCALHOST_FORBIDDEN');

    // 2. Insecure HTTP rejected for production external host
    const insecureHttpCheck = PWAEngine.validateBackendEndpointForAndroid('http://example.com', { isProduction: true });
    assert.equal(insecureHttpCheck.valid, false);
    assert.equal(insecureHttpCheck.code, 'INSECURE_HTTP_FORBIDDEN');

    // 3. Emulator alias 10.0.2.2 allowed in emulator, rejected on physical device
    const emuCheck = PWAEngine.validateBackendEndpointForAndroid('http://10.0.2.2:3000', { isPhysicalAndroidDevice: false });
    assert.equal(emuCheck.valid, true);

    const emuOnPhoneCheck = PWAEngine.validateBackendEndpointForAndroid('http://10.0.2.2:3000', { isPhysicalAndroidDevice: true });
    assert.equal(emuOnPhoneCheck.valid, false);
    assert.equal(emuOnPhoneCheck.code, 'EMULATOR_LOOPBACK_ON_PHYSICAL_DEVICE');

    // 4. Deployed HTTPS URL is valid
    const httpsCheck = PWAEngine.validateBackendEndpointForAndroid(
      'https://ais-pre-tuksbxdpaeqeyjl35z77of-346280624125.asia-southeast1.run.app',
      { isProduction: true, isPhysicalAndroidDevice: true }
    );
    assert.equal(httpsCheck.valid, true);
    assert.equal(httpsCheck.https, true);

    // 5. Android APK User-Agent detection
    const platformInfo = PWAEngine.detectDisplayAndPlatform({
      navigator: {
        userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36 YashwinAndroidAPK/1.0.0 (PaperModeOnly)'
      }
    });
    assert.equal(platformInfo.isAndroidAPK, true);
    assert.equal(platformInfo.isStandalone, true);
  });

  test('170. Task 18 Bounded API Request Timeouts & Retry Behavior for Android/Mobile Networks', async () => {
    // 1. Verify GET request automatic retry on transient failure
    let attempts = 0;
    const flakyFetch = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Transient mobile network drop');
      }
      return {
        async json() {
          return { ok: true, mode: 'PAPER', liveTradingEnabled: false };
        }
      };
    };

    const retryRes = await MarketAPI.health({ fetchFn: flakyFetch, retries: 1, timeoutMs: 2000 });
    assert.equal(retryRes.ok, true);
    assert.equal(attempts, 2, 'GET request should retry once after transient failure');

    // 2. Verify POST request never auto-retries to prevent duplicate paper order submissions
    let postAttempts = 0;
    const failingPostFetch = async () => {
      postAttempts += 1;
      throw new Error('Network drop during POST');
    };

    const postRes = await MarketAPI.paperOpen(
      { symbol: 'RELIANCE', side: 'BUY', qty: 1 },
      { fetchFn: failingPostFetch, retries: 2, timeoutMs: 2000 }
    );
    assert.equal(postRes.ok, false);
    assert.equal(postAttempts, 1, 'Mutating POST request must never auto-retry');

    // 3. Verify timeout abort returns API_TIMEOUT code
    const slowFetch = (_url, opts) =>
      new Promise((_resolve, reject) => {
        if (opts && opts.signal) {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });

    const timeoutRes = await MarketAPI.health({ fetchFn: slowFetch, timeoutMs: 40, retries: 0 });
    assert.equal(timeoutRes.ok, false);
    assert.equal(timeoutRes.code, 'API_TIMEOUT');
  });

  // =========================================================
  // TASK 19 — COMPLETE SECURITY AUDIT & HARDENING TESTS
  // =========================================================

  test('171. Task 19 Security Headers, CSP, CORS & Untrusted Origin Rejection', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const {
      SECURITY_HEADERS,
      SECURITY_CSP,
      isTrustedOrigin
    } = require('../server/api-server');

    // 1. Verify security header definitions
    assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
    assert.equal(SECURITY_HEADERS['Referrer-Policy'], 'strict-origin-when-cross-origin');
    assert.equal(SECURITY_HEADERS['Cross-Origin-Opener-Policy'], 'same-origin');
    assert.ok(SECURITY_HEADERS['Permissions-Policy'].includes('camera=()'));
    assert.ok(SECURITY_CSP.includes("default-src 'self'"));
    assert.ok(SECURITY_CSP.includes("script-src 'self'"));
    assert.ok(SECURITY_CSP.includes("object-src 'none'"));

    // 2. Verify API response attaches all security headers & Cache-Control: no-store
    const healthRes = await requestServer(server, '/api/health');
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.headers['x-content-type-options'], 'nosniff');
    assert.equal(healthRes.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(healthRes.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(healthRes.headers['cache-control'], 'no-store');
    assert.ok(String(healthRes.headers['content-security-policy'] || '').includes("default-src 'self'"));

    // 3. Verify static HTML response attaches security headers
    const htmlRes = await requestServer(server, '/index.html');
    assert.equal(htmlRes.status, 200);
    assert.equal(htmlRes.headers['x-content-type-options'], 'nosniff');
    assert.ok(String(htmlRes.headers['content-security-policy'] || '').includes("script-src 'self'"));

    // 4. Verify untrusted Origin is rejected with 403 UNTRUSTED_ORIGIN on API routes
    const untrustedCheck = isTrustedOrigin({
      headers: {
        origin: 'https://evil-attacker.example.com',
        host: 'localhost:3000'
      }
    });
    assert.equal(untrustedCheck.trusted, false);

    const untrustedRes = await requestServer(server, '/api/paper/state', {
      method: 'GET',
      headers: {
        Origin: 'https://evil-attacker.example.com'
      }
    });
    assert.equal(untrustedRes.status, 403);
    assert.equal(untrustedRes.json.code, 'UNTRUSTED_ORIGIN');

    // 5. Verify trusted same-origin is allowed
    const trustedRes = await requestServer(server, '/api/health', {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:3000'
      }
    });
    assert.equal(trustedRes.status, 200);
    assert.equal(trustedRes.headers['access-control-allow-origin'], 'http://localhost:3000');
  });

  test('172. Task 19 Request Payload Size Limit (413 PAYLOAD_TOO_LARGE) & Malformed JSON Handling', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // 1. Oversized payload (> 64KB) must be rejected with HTTP 413 PAYLOAD_TOO_LARGE
    const hugeString = 'A'.repeat(70000);
    const oversizedRes = await requestServer(server, '/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'oversized@example.com', password: hugeString })
    });
    assert.equal(oversizedRes.status, 413);
    assert.equal(oversizedRes.json.ok, false);
    assert.equal(oversizedRes.json.code, 'PAYLOAD_TOO_LARGE');

    // 2. Non-object JSON body (e.g. JSON array) rejected with 400 INVALID_JSON_BODY
    const arrayBodyRes = await requestServer(server, '/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['array', 'not', 'object'])
    });
    assert.equal(arrayBodyRes.status, 400);
    assert.equal(arrayBodyRes.json.code, 'INVALID_JSON_BODY');
  });

  test('173. Task 19 Endpoint Rate Limiting (AI Analysis, Backtest, Auth Mutation & Market Data)', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const {
      checkEndpointRateLimit,
      resetApiRateLimitsForTest
    } = require('../server/api-server');

    resetApiRateLimitsForTest();

    // 1. Verify deterministic rate limiter blocks after max requests in window
    const testClient = 'test-ip-19';
    const baseNow = Date.now();
    for (let i = 0; i < 30; i++) {
      const check = checkEndpointRateLimit('AI_ANALYZE', testClient, baseNow + i * 10);
      assert.equal(check.allowed, true);
    }
    const blockedCheck = checkEndpointRateLimit('AI_ANALYZE', testClient, baseNow + 500);
    assert.equal(blockedCheck.allowed, false);
    assert.ok(blockedCheck.retryAfterSeconds > 0);

    // 2. Verify HTTP 429 + Retry-After header when AI_ANALYZE rate limit is exceeded on /api/ai/analyze
    resetApiRateLimitsForTest();
    for (let i = 0; i < 30; i++) {
      checkEndpointRateLimit('AI_ANALYZE', '127.0.0.1');
    }
    const aiRateLimitedRes = await requestServer(server, '/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'NIFTY 50', price: 22500, dataReady: true })
    });
    assert.equal(aiRateLimitedRes.status, 429);
    assert.equal(aiRateLimitedRes.json.code, 'RATE_LIMITED');
    assert.ok(aiRateLimitedRes.headers['retry-after']);

    resetApiRateLimitsForTest();
  });

  test('174. Task 19 Outbound SSRF Protection & URL Scheme Validation in Notification Delivery', async () => {
    const notificationDelivery = require('../server/notification-delivery-service');

    // 1. Loopback, private network, link-local, and cloud metadata hosts must be blocked
    assert.equal(notificationDelivery.isBlockedSsrfHost('localhost'), true);
    assert.equal(notificationDelivery.isBlockedSsrfHost('127.0.0.1'), true);
    assert.equal(notificationDelivery.isBlockedSsrfHost('0.0.0.0'), true);
    assert.equal(notificationDelivery.isBlockedSsrfHost('10.0.0.1'), true);
    assert.equal(notificationDelivery.isBlockedSsrfHost('172.16.5.4'), true);
    assert.equal(notificationDelivery.isBlockedSsrfHost('192.168.1.10'), true);
    assert.equal(notificationDelivery.isBlockedSsrfHost('169.254.169.254'), true);
    assert.equal(notificationDelivery.isBlockedSsrfHost('metadata.google.internal'), true);
    assert.equal(notificationDelivery.isBlockedSsrfHost('::1'), true);

    // 2. Legitimate public HTTPS endpoint is allowed
    const validPublic = notificationDelivery.validateSafeOutboundUrl('https://hooks.example.com/notify', {
      env: { NODE_ENV: 'production' }
    });
    assert.equal(validPublic.ok, true);

    // 3. Non-HTTP(S) schemes (file://, ftp://, javascript:) are blocked
    const fileScheme = notificationDelivery.validateSafeOutboundUrl('file:///etc/passwd');
    assert.equal(fileScheme.ok, false);
    assert.equal(fileScheme.code, 'FORBIDDEN_URL_SCHEME');

    // 4. Plain HTTP blocked in production
    const httpInProd = notificationDelivery.validateSafeOutboundUrl('http://hooks.example.com/notify', {
      env: { NODE_ENV: 'production' }
    });
    assert.equal(httpInProd.ok, false);
    assert.equal(httpInProd.code, 'HTTPS_REQUIRED_IN_PRODUCTION');

    // 5. SSRF attempt via NOTIFICATION_WEBHOOK_URL to 169.254.169.254 fails safely without leaking URL
    notificationDelivery.resetRateLimitsForTest();
    const ssrfDispatch = await notificationDelivery.dispatchExternalChannel(
      'WEBHOOK',
      {
        notificationId: 'NTF-SSRF-TEST',
        userId: 'USR-SSRF',
        category: 'PRICE_ALERT',
        title: 'Test',
        message: 'Test',
        triggeredAt: new Date().toISOString()
      },
      {
        env: {
          NOTIFICATION_WEBHOOK_URL: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/'
        }
      }
    );
    assert.equal(ssrfDispatch.ok, false);
    assert.equal(ssrfDispatch.delivered, false);
    assert.equal(ssrfDispatch.status, 'FAILED');
    assert.equal(ssrfDispatch.reason.includes('169.254.169.254'), false);
  });

  test('175. Task 19 Static File Path Traversal Prevention & Error Message Secret Sanitization', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const { sanitizeErrorMessage } = require('../server/api-server');

    // 1. Attempted path traversal outside web/ must never leak server files
    const traversalPaths = [
      '/../server/database.js',
      '/..%2fserver%2fconfig.js',
      '/../../package.json',
      '/.env'
    ];
    for (const p of traversalPaths) {
      const res = await requestServer(server, p);
      assert.ok(
        res.status === 403 || res.status === 404,
        `Path ${p} must return 403 or 404 (got ${res.status})`
      );
      assert.equal(String(res.text || '').includes('DatabaseSync'), false);
    }

    // 2. Verify sanitizeErrorMessage strips any accidental secret value from error output
    const prevKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKeyValue999999';
    try {
      const sanitized = sanitizeErrorMessage(
        'Upstream failure with key AIzaSyTestSecretKeyValue999999 on endpoint'
      );
      assert.equal(sanitized.includes('AIzaSyTestSecretKeyValue999999'), false);
      assert.ok(sanitized.includes('[REDACTED]'));
    } finally {
      if (prevKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = prevKey;
      }
    }
  });

  test('176. Task 19 Comprehensive Cross-User Isolation, CSRF Enforcement & SQL Injection Resistance', async () => {
    const userAuthService = require('../server/user-auth-service');
    serverDb.resetAllTablesForTest();
    userAuthService.resetRateLimitsForTest();
    apiServer.resetApiRateLimitsForTest();
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // Register User A and User B
    const regA = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sec User A', email: 'sec_a@example.com', password: 'Password123' })
    });
    assert.equal(regA.status, 201);
    const cookieA = regA.headers['set-cookie'][0].split(';')[0];
    const csrfA = regA.json.csrfToken;
    const userIdA = regA.json.user.userId;

    const regB = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sec User B', email: 'sec_b@example.com', password: 'Password123' })
    });
    assert.equal(regB.status, 201);
    const cookieB = regB.headers['set-cookie'][0].split(';')[0];
    const csrfB = regB.json.csrfToken;

    // 1. Authenticated state-changing requests without CSRF token must be rejected with 403 CSRF_TOKEN_INVALID
    const csrfMissingEndpoints = [
      { path: '/api/paper/open', body: { symbol: 'RELIANCE', side: 'BUY', entry: 2500, stop: 2490, target: 2530, qty: 1 } },
      { path: '/api/watchlist/add', body: { key: 'RELIANCE', name: 'RELIANCE', exchange: 'NSE' } },
      { path: '/api/alerts', body: { symbol: 'RELIANCE', exchange: 'NSE', alertType: 'PRICE_ABOVE', threshold: 2600 } },
      { path: '/api/notifications/preferences', body: { soundEnabled: false } },
      { path: '/api/user/profile', body: { name: 'Hacked Name' } }
    ];

    for (const ep of csrfMissingEndpoints) {
      const noCsrfRes = await requestServer(server, ep.path, {
        method: 'POST',
        headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
        body: JSON.stringify(ep.body)
      });
      assert.equal(noCsrfRes.status, 403, `Missing CSRF on ${ep.path} must return 403`);
      assert.equal(noCsrfRes.json.code, 'CSRF_TOKEN_INVALID');
    }

    // 2. User A creates private position, alert, and notification
    const openA = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: { Cookie: cookieA, 'X-CSRF-Token': csrfA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'TCS', side: 'BUY', entry: 3500, stop: 3480, target: 3560, qty: 5 })
    });
    assert.equal(openA.status, 200);
    const posIdA = openA.json.openPosition.id;

    const alertA = await requestServer(server, '/api/alerts', {
      method: 'POST',
      headers: { Cookie: cookieA, 'X-CSRF-Token': csrfA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'TCS', exchange: 'NSE', instrumentType: 'EQUITY', alertType: 'PRICE_ABOVE', threshold: 3600 })
    });
    assert.equal(alertA.status, 201);
    const alertIdA = alertA.json.alert.alertId;

    // 3. User B cannot read or mutate User A's resources
    const closeByB = await requestServer(server, '/api/paper/close', {
      method: 'POST',
      headers: { Cookie: cookieB, 'X-CSRF-Token': csrfB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionId: posIdA, exitPrice: 3510 })
    });
    assert.equal(closeByB.status, 403);
    assert.equal(closeByB.json.code, 'FORBIDDEN_OWNERSHIP');

    const pauseAlertByB = await requestServer(server, '/api/alerts/pause', {
      method: 'POST',
      headers: { Cookie: cookieB, 'X-CSRF-Token': csrfB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alertId: alertIdA })
    });
    assert.equal(pauseAlertByB.status, 403);
    assert.equal(pauseAlertByB.json.code, 'FORBIDDEN_OWNERSHIP');

    const crossReadEndpoints = [
      `/api/paper/state?userId=${encodeURIComponent(userIdA)}`,
      `/api/portfolio/summary?userId=${encodeURIComponent(userIdA)}`,
      `/api/orders?userId=${encodeURIComponent(userIdA)}`,
      `/api/trades/history?userId=${encodeURIComponent(userIdA)}`,
      `/api/alerts?userId=${encodeURIComponent(userIdA)}`,
      `/api/notifications?userId=${encodeURIComponent(userIdA)}`,
      `/api/audit/logs?userId=${encodeURIComponent(userIdA)}`
    ];
    for (const urlPath of crossReadEndpoints) {
      const crossRes = await requestServer(server, urlPath, {
        method: 'GET',
        headers: { Cookie: cookieB }
      });
      assert.equal(crossRes.status, 403, `Cross-user GET ${urlPath} must return 403`);
      assert.equal(crossRes.json.code, 'FORBIDDEN_OWNERSHIP');
    }

    // 4. SQL Injection payloads in symbol/filter parameters are safely parameterized and do not corrupt tables
    const sqliPayload = "RELIANCE' OR '1'='1'; DROP TABLE users; --";
    const sqliOrdersRes = await requestServer(
      server,
      `/api/orders?symbol=${encodeURIComponent(sqliPayload)}`,
      { method: 'GET', headers: { Cookie: cookieA } }
    );
    assert.equal(sqliOrdersRes.status, 200);
    assert.equal(sqliOrdersRes.json.orders.length, 0);

    const dbAuditAfterSqli = serverDb.runDatabaseAuditAndIntegrityCheck();
    assert.equal(dbAuditAfterSqli.healthy, true);
    assert.ok(dbAuditAfterSqli.tables.includes('users'));
  });

  test('177. Task 19 Zero Live Trading & Zero Client-Side Credential Exposure Verification', () => {
    const config = require('../server/config');
    const parsedCfg = config.getConfig({
      TRADING_MODE: 'live',
      LIVE_TRADING_ENABLED: 'true',
      ANGEL_API_KEY: 'SECRET_ANGEL_KEY',
      GEMINI_API_KEY: 'SECRET_GEMINI_KEY'
    });
    const safeCfg = config.getSafePublicConfig(parsedCfg);

    // Even if env vars attempt to enable live mode, config locks to paper and liveEnabled=false
    assert.equal(safeCfg.trading.mode, 'paper');
    assert.equal(safeCfg.trading.liveEnabled, false);
    const dumped = JSON.stringify(safeCfg);
    assert.equal(dumped.includes('SECRET_ANGEL_KEY'), false);
    assert.equal(dumped.includes('SECRET_GEMINI_KEY'), false);

    // Scan all web/ files to verify no broker or AI credentials exist in frontend assets
    const webDir = path.join(__dirname, '..', 'web');
    function walkWeb(dir) {
      let out = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out = out.concat(walkWeb(full));
        else if (/\.(js|html|css|webmanifest|json)$/i.test(entry.name)) out.push(full);
      }
      return out;
    }
    const webFiles = walkWeb(webDir);
    for (const file of webFiles) {
      const content = fs.readFileSync(file, 'utf8');
      assert.equal(/AIzaSy[0-9A-Za-z_-]{33}/.test(content), false, `No Google API key in ${file}`);
      assert.equal(/ANGEL_TOTP_SECRET\s*=\s*["'][^"']+["']/.test(content), false, `No TOTP secret in ${file}`);
    }
  });

  // =========================================================
  // TASK 20 — PRODUCTION SERVER DEPLOYMENT & HARDENING TESTS
  // =========================================================

  test('178. Task 20 Production Environment Validation & Safety Locks (Paper Mode & Live Disabled)', () => {
    const prodCheck = serverConfig.validateProductionEnvironment({
      NODE_ENV: 'production',
      PORT: '3000',
      API_HOST: '0.0.0.0',
      TRADING_MODE: 'live',
      LIVE_TRADING_ENABLED: 'true',
      CORS_ALLOWED_ORIGINS: 'https://trading.example.com, https://app.example.com'
    });

    assert.equal(prodCheck.ok, true);
    assert.equal(prodCheck.isProduction, true);
    assert.equal(prodCheck.tradingMode, 'paper');
    assert.equal(prodCheck.liveTradingEnabled, false);
    assert.equal(prodCheck.brokerOrderExecution, 'DISABLED');
    assert.equal(prodCheck.canonicalDbPath, 'server/data/yashwin-trading.sqlite');
    assert.ok(prodCheck.warnings.some((w) => w.includes('LIVE_TRADING_ENABLED')));
    assert.ok(prodCheck.warnings.some((w) => w.includes('TRADING_MODE')));

    const origins = serverConfig.parseAllowedOrigins(
      'https://trading.example.com, https://app.example.com, javascript:alert(1)'
    );
    assert.deepEqual(origins, ['https://trading.example.com', 'https://app.example.com']);
  });

  test('179. Task 20 Production Security Headers (HSTS, X-Frame-Options, CSP) & Configured CORS Origins', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'https://prod.yashwin.example.com';
    process.env.PUBLIC_BASE_URL = 'https://public.yashwin.example.com';
    process.env.DIAGNOSTICS_AUTH_TOKEN = 'TEST_DIAG_TOKEN_179_SECRET';

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const allowedOriginRes = await requestServer(server, '/api/health', {
      method: 'GET',
      headers: {
        Origin: 'https://prod.yashwin.example.com'
      }
    });
    assert.equal(allowedOriginRes.status, 200);
    assert.equal(
      allowedOriginRes.headers['access-control-allow-origin'],
      'https://prod.yashwin.example.com'
    );
    assert.equal(allowedOriginRes.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(allowedOriginRes.headers['x-content-type-options'], 'nosniff');
    assert.ok(
      String(allowedOriginRes.headers['strict-transport-security'] || '').includes('max-age=31536000')
    );

    const publicBaseRes = await requestServer(server, '/api/readiness', {
      method: 'GET',
      headers: {
        Origin: 'https://public.yashwin.example.com',
        'X-Diagnostics-Token': 'TEST_DIAG_TOKEN_179_SECRET'
      }
    });
    assert.equal(publicBaseRes.status, 200);
    assert.equal(
      publicBaseRes.headers['access-control-allow-origin'],
      'https://public.yashwin.example.com'
    );
    assert.equal(publicBaseRes.json.liveTradingEnabled, false);
    assert.equal(publicBaseRes.json.productionEnvironment.liveTradingEnabled, false);
    assert.equal(publicBaseRes.json.databaseAudit.ok, true);

    const blockedOriginRes = await requestServer(server, '/api/health', {
      method: 'GET',
      headers: {
        Origin: 'https://untrusted-attacker.example.com'
      }
    });
    assert.equal(blockedOriginRes.status, 403);
    assert.equal(blockedOriginRes.json.code, 'UNTRUSTED_ORIGIN');
  });

  test('180. Task 20 Atomic SQLite Database Backup (`VACUUM INTO`), WAL Checkpoint & Read-Only Integrity Verification', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yashwin-task20-backup-'));
    const sourceDbPath = path.join(tmpDir, 'source-trading.sqlite');
    const backupDbPath = path.join(tmpDir, 'backups', 'snapshot-backup.sqlite');

    try {
      process.env.YASHWIN_DB_PATH = sourceDbPath;
      serverDb.getDb(sourceDbPath);
      const user = serverDb.createUserRecord({
        userId: 'USR_BACKUP_TEST',
        name: 'Backup Verification User',
        email: 'backup_verify@example.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuv1234567890abcdefghijklmnopqrstu'
      });
      assert.equal(user.userId, 'USR_BACKUP_TEST');

      const cp = serverDb.checkpointWal('PASSIVE', sourceDbPath);
      assert.equal(cp.ok, true);

      const backupResult = serverDb.backupDatabase(backupDbPath, sourceDbPath);
      assert.equal(backupResult.ok, true);
      assert.equal(backupResult.integrityCheck, 'ok');
      assert.equal(backupResult.schemaVersion, serverDb.LATEST_SCHEMA_VERSION);
      assert.equal(backupResult.tablesCount, serverDb.EXPECTED_PRODUCTION_TABLES.length);
      assert.ok(fs.existsSync(backupDbPath));
      assert.ok(backupResult.sizeBytes > 0);

      // Reject backing up onto the active source database path itself
      assert.throws(
        () => serverDb.backupDatabase(sourceDbPath, sourceDbPath),
        (err) => err.code === 'BACKUP_SOURCE_COLLISION'
      );

      // Verify backed up SQLite file contains the user record
      process.env.YASHWIN_DB_PATH = backupDbPath;
      serverDb.getDb(backupDbPath);
      const restoredUser = serverDb.getUserByEmail('backup_verify@example.com');
      assert.ok(restoredUser);
      assert.equal(restoredUser.userId, 'USR_BACKUP_TEST');
    } finally {
      process.env.YASHWIN_DB_PATH = ':memory:';
      serverDb.getDb(':memory:');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('181. Task 20 Graceful Server Shutdown & Persistent State Survival Across Restart', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yashwin-task20-restart-'));
    const tempDbFile = path.join(tmpDir, 'restart-persistence.sqlite');

    try {
      process.env.YASHWIN_DB_PATH = tempDbFile;
      serverDb.getDb(tempDbFile);

      const srv1 = apiServer.createServer();
      const lifecycle1 = apiServer.setupGracefulShutdown(srv1, {
        attachProcessSignals: false,
        timeoutMs: 2000
      });
      await new Promise((resolve) => srv1.listen(0, '127.0.0.1', resolve));

      const regRes = await requestServer(srv1, '/api/user/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Restart Persistence User',
          email: 'restart_user@example.com',
          password: 'Password123'
        })
      });
      assert.equal(regRes.status, 201);
      const cookie = regRes.headers['set-cookie'][0].split(';')[0];
      const csrf = regRes.json.csrfToken;

      const openRes = await requestServer(srv1, '/api/paper/open', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrf,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol: 'INFY',
          side: 'BUY',
          entry: 1500,
          stop: 1485,
          target: 1535,
          qty: 4
        })
      });
      assert.equal(openRes.status, 200);

      // Gracefully shut down server 1 (flushes WAL and closes SQLite cleanly)
      const shutdownResult = await lifecycle1.shutdown('SIGTERM');
      assert.equal(shutdownResult.ok, true);

      // Start a brand new server instance pointing to the same SQLite file
      const srv2 = apiServer.createServer();
      const lifecycle2 = apiServer.setupGracefulShutdown(srv2, {
        attachProcessSignals: false,
        timeoutMs: 2000
      });
      await new Promise((resolve) => srv2.listen(0, '127.0.0.1', resolve));

      const stateRes = await requestServer(srv2, '/api/paper/state', {
        method: 'GET',
        headers: { Cookie: cookie }
      });
      assert.equal(stateRes.status, 200);
      assert.ok(stateRes.json.openPosition);
      assert.equal(stateRes.json.openPosition.symbol, 'INFY');
      assert.equal(stateRes.json.openPosition.qty, 4);

      await lifecycle2.shutdown('SIGTERM');
    } finally {
      process.env.YASHWIN_DB_PATH = ':memory:';
      serverDb.getDb(':memory:');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('182. Task 20 Non-Destructive Production Verification Script (`server/production-verify.js`)', async () => {
    const prodVerify = require('../server/production-verify');
    const report = await prodVerify.runProductionVerification({
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: '3000',
        TRADING_MODE: 'paper',
        LIVE_TRADING_ENABLED: 'false'
      }
    });

    assert.equal(report.ok, true);
    assert.equal(report.tradingMode, 'paper');
    assert.equal(report.liveTradingEnabled, false);
    assert.equal(report.orderEndpoints, 'NONE');
    assert.equal(report.canonicalDatabasePath, 'server/data/yashwin-trading.sqlite');
    assert.equal(report.checks.environmentValid, true);
    assert.equal(report.checks.paperModeEnforced, true);
    assert.equal(report.checks.zeroLiveOrderEndpoints, true);
    assert.equal(report.checks.healthEndpointOk, true);
    assert.equal(report.checks.diagnosticsProtectedOk, true);
    assert.equal(report.checks.readinessEndpointOk, true);
    assert.equal(report.checks.databaseAuditOk, true);
    assert.equal(report.checks.pwaShellServedOk, true);
    assert.equal(report.checks.securityHeadersPresent, true);
    assert.equal(report.checks.androidProjectConfigured, true);
  });

  test('183. Task 20 Deployment Artifacts (`Dockerfile`, `.dockerignore`, `docker-compose.yml`, `render.yaml`) & Android Prod URL Audit', () => {
    const rootDir = path.join(__dirname, '..');
    const dockerfile = fs.readFileSync(path.join(rootDir, 'Dockerfile'), 'utf8');
    const dockerignore = fs.readFileSync(path.join(rootDir, '.dockerignore'), 'utf8');
    const compose = fs.readFileSync(path.join(rootDir, 'docker-compose.yml'), 'utf8');
    const renderYaml = fs.readFileSync(path.join(rootDir, 'render.yaml'), 'utf8');
    const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');

    // Dockerfile checks
    assert.ok(dockerfile.includes('ENV TRADING_MODE=paper'));
    assert.ok(dockerfile.includes('ENV LIVE_TRADING_ENABLED=false'));
    assert.ok(dockerfile.includes('YASHWIN_DB_PATH=/app/server/data/yashwin-trading.sqlite'));
    assert.ok(dockerfile.includes('USER node'));
    assert.ok(dockerfile.includes('/api/health'));

    // .dockerignore checks
    assert.ok(dockerignore.includes('.env'));
    assert.ok(dockerignore.includes('*.sqlite'));
    assert.ok(dockerignore.includes('*.jks'));
    assert.ok(dockerignore.includes('*.apk'));

    // docker-compose & render.yaml checks
    assert.ok(compose.includes('yashwin_sqlite_data:/app/server/data'));
    assert.ok(compose.includes('LIVE_TRADING_ENABLED: "false"'));
    assert.ok(renderYaml.includes('healthCheckPath: /api/health'));
    assert.ok(renderYaml.includes('server/data/yashwin-trading.sqlite'));

    // .env.example must contain only placeholders/safe defaults, zero real secrets
    assert.ok(envExample.includes('TRADING_MODE=paper'));
    assert.ok(envExample.includes('LIVE_TRADING_ENABLED=false'));
    assert.ok(envExample.includes('YASHWIN_DB_PATH=server/data/yashwin-trading.sqlite'));
    assert.equal(/AIzaSy[0-9A-Za-z_-]{33}/.test(envExample), false);
  });

  // =========================================================
  // TASK 20.1 — FINAL PRODUCTION DEPLOYMENT VERIFICATION TESTS
  // =========================================================

  test('184. Task 20.1 Trusted-Proxy & Origin Validation: Rejects Forged Host, X-Forwarded-Host, X-Forwarded-Proto & X-Forwarded-For When TRUST_PROXY is Disabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUST_PROXY = 'false';
    process.env.PUBLIC_BASE_URL = 'https://prod.yashwin.example.com';

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // 1. Forged Host header matching attacker Origin MUST be rejected with 403 UNTRUSTED_ORIGIN
    const forgedHostGet = await requestServer(server, '/api/health', {
      method: 'GET',
      headers: {
        Origin: 'https://evil-forged.example.com',
        Host: 'evil-forged.example.com'
      }
    });
    assert.equal(forgedHostGet.status, 403);
    assert.equal(forgedHostGet.json.code, 'UNTRUSTED_ORIGIN');
    assert.equal(forgedHostGet.headers['access-control-allow-origin'], undefined);

    // 2. Forged X-Forwarded-Host header matching attacker Origin on state-changing POST MUST be rejected with 403
    const forgedForwardedHostPost = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        Origin: 'https://evil-proxy-spoof.example.com',
        'X-Forwarded-Host': 'evil-proxy-spoof.example.com',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ symbol: 'TCS', side: 'BUY', entry: 3500, stop: 3480, target: 3550, qty: 1 })
    });
    assert.equal(forgedForwardedHostPost.status, 403);
    assert.equal(forgedForwardedHostPost.json.code, 'UNTRUSTED_ORIGIN');

    // 3. Even when TRUST_PROXY=true, X-Forwarded-Host cannot dynamically whitelist an unconfigured Origin
    process.env.TRUST_PROXY = 'true';
    const spoofWithTrustProxy = apiServer.isTrustedOrigin(
      {
        method: 'POST',
        headers: {
          origin: 'https://evil-proxy-spoof.example.com',
          'x-forwarded-host': 'evil-proxy-spoof.example.com'
        }
      },
      process.env
    );
    assert.equal(spoofWithTrustProxy.trusted, false);

    // 4. HSTS is NOT emitted on plain HTTP when PUBLIC_BASE_URL is not https and TRUST_PROXY is false, even if client spoofs X-Forwarded-Proto: https
    const headersUntrustedProto = apiServer.buildSecurityHeaders(
      {
        socket: { encrypted: false },
        headers: { 'x-forwarded-proto': 'https' }
      },
      { NODE_ENV: 'production', TRUST_PROXY: 'false', PUBLIC_BASE_URL: '' }
    );
    assert.equal(headersUntrustedProto['Strict-Transport-Security'], undefined);

    // 5. HSTS IS emitted when TRUST_PROXY=true and reverse proxy sets X-Forwarded-Proto: https in production
    const headersTrustedProxyProto = apiServer.buildSecurityHeaders(
      {
        socket: { encrypted: false },
        headers: { 'x-forwarded-proto': 'https' }
      },
      { NODE_ENV: 'production', TRUST_PROXY: 'true', PUBLIC_BASE_URL: '' }
    );
    assert.ok(String(headersTrustedProxyProto['Strict-Transport-Security'] || '').includes('max-age=31536000'));

    // 6. getClientIp ignores spoofed X-Forwarded-For when TRUST_PROXY=false, and honors it only when TRUST_PROXY=true
    const fakeReq = {
      headers: { 'x-forwarded-for': '203.0.113.99, 10.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' }
    };
    assert.equal(apiServer.getClientIp(fakeReq, { TRUST_PROXY: 'false' }), '127.0.0.1');
    assert.equal(apiServer.getClientIp(fakeReq, { TRUST_PROXY: 'true' }), '203.0.113.99');
  });

  test('185. Task 20.1 Diagnostic Endpoint Authorization: Minimal Public Health/Readiness vs Authorized Detailed Diagnostics in Production', async () => {
    serverDb.resetAllTablesForTest();
    process.env.NODE_ENV = 'production';
    process.env.DIAGNOSTICS_AUTH_TOKEN = 'PROD_DIAGNOSTICS_SECRET_TOKEN_201';

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // 1. Unauthenticated GET /api/health returns minimal operational status without table lists, file paths, or user emails
    const publicHealth = await requestServer(server, '/api/health');
    assert.equal(publicHealth.status, 200);
    assert.equal(publicHealth.json.ok, true);
    assert.equal(publicHealth.json.liveTradingEnabled, false);
    assert.equal(publicHealth.json.database.connected, true);
    assert.equal('tables' in publicHealth.json.database, false);
    assert.equal('relativePath' in publicHealth.json.database, false);
    assert.equal('diagnostics' in publicHealth.json, false);

    // 2. Unauthenticated GET /api/readiness returns minimal readiness summary without internal databaseAudit or productionEnvironment details
    const publicReadiness = await requestServer(server, '/api/readiness');
    assert.equal(publicReadiness.status, 200);
    assert.equal(publicReadiness.json.ok, true);
    assert.equal(publicReadiness.json.status, 'READY');
    assert.equal('databaseAudit' in publicReadiness.json, false);
    assert.equal('productionEnvironment' in publicReadiness.json, false);
    assert.equal('checks' in publicReadiness.json, false);

    // 3. Unauthenticated GET /api/readiness/audit and /api/database/audit are rejected with 401 DIAGNOSTICS_UNAUTHORIZED in production
    const unauthReadinessAudit = await requestServer(server, '/api/readiness/audit');
    assert.equal(unauthReadinessAudit.status, 401);
    assert.equal(unauthReadinessAudit.json.code, 'DIAGNOSTICS_UNAUTHORIZED');

    const unauthDbAudit = await requestServer(server, '/api/database/audit');
    assert.equal(unauthDbAudit.status, 401);
    assert.equal(unauthDbAudit.json.code, 'DIAGNOSTICS_UNAUTHORIZED');

    // 4. Wrong token is rejected with 401
    const wrongTokenAudit = await requestServer(server, '/api/database/audit', {
      headers: { 'X-Diagnostics-Token': 'WRONG_TOKEN_VALUE' }
    });
    assert.equal(wrongTokenAudit.status, 401);

    // 5. Authorized via X-Diagnostics-Token receives full audit report
    const tokenAuthDbAudit = await requestServer(server, '/api/database/audit', {
      headers: { 'X-Diagnostics-Token': 'PROD_DIAGNOSTICS_SECRET_TOKEN_201' }
    });
    assert.equal(tokenAuthDbAudit.status, 200);
    assert.equal(tokenAuthDbAudit.json.ok, true);
    assert.equal(tokenAuthDbAudit.json.databaseAudit.schemaVersion, 9);
    assert.equal(tokenAuthDbAudit.json.databaseAudit.tablesCount, 26);

    // 6. Authorized via authenticated user session cookie also receives full audit report, and /api/health never leaks user email
    const regUser = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Diag Auth User',
        email: 'diag_auth_user@example.com',
        password: 'Password123'
      })
    });
    assert.equal(regUser.status, 201);
    const sessionCookie = regUser.headers['set-cookie'][0].split(';')[0];

    const sessionReadinessAudit = await requestServer(server, '/api/readiness/audit', {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(sessionReadinessAudit.status, 200);
    assert.equal(sessionReadinessAudit.json.ok, true);
    assert.equal(sessionReadinessAudit.json.databaseAudit.healthy, true);

    const sessionHealth = await requestServer(server, '/api/health', {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(sessionHealth.status, 200);
    assert.equal(sessionHealth.json.userSession.authenticated, true);
    assert.equal('email' in sessionHealth.json.userSession, false);
    assert.equal(sessionHealth.text.includes('diag_auth_user@example.com'), false);
  });

  test('186. Task 20.1 Isolated SQLite Restore Verification & Active Production Database Overwrite Protection', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yashwin-task20-1-restore-'));
    const sourceDbPath = path.join(tmpDir, 'source.sqlite');
    const backupDbPath = path.join(tmpDir, 'backups', 'atomic-backup.sqlite');
    const restoredDbPath = path.join(tmpDir, 'restored', 'restored-target.sqlite');

    try {
      process.env.YASHWIN_DB_PATH = sourceDbPath;
      serverDb.getDb(sourceDbPath);

      // Seed user, paper position, and watchlist item in source DB
      const createdUser = serverDb.createUserRecord({
        userId: 'USR_RESTORE_201',
        name: 'Restore Verification Trader',
        email: 'restore_trader@example.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuv1234567890abcdefghijklmnopqrstu'
      });
      assert.equal(createdUser.userId, 'USR_RESTORE_201');

      serverDb.addWatchlistItem(
        {
          key: 'SBIN',
          tradingsymbol: 'SBIN-EQ',
          name: 'State Bank of India',
          exchange: 'NSE',
          instrumentType: 'EQUITY'
        },
        'USR_RESTORE_201'
      );

      // 1. Create atomic WAL-safe backup
      const backupRes = serverDb.backupDatabase(backupDbPath, sourceDbPath);
      assert.equal(backupRes.ok, true);

      // 2. Attempting to restore over the active database or canonical DEFAULT_DB_PATH must be blocked
      assert.throws(
        () => serverDb.restoreDatabaseFromBackup(backupDbPath, sourceDbPath),
        (err) => err.code === 'ACTIVE_DATABASE_OVERWRITE_FORBIDDEN'
      );
      assert.throws(
        () => serverDb.restoreDatabaseFromBackup(backupDbPath, serverDb.DEFAULT_DB_PATH),
        (err) => err.code === 'ACTIVE_DATABASE_OVERWRITE_FORBIDDEN'
      );
      assert.throws(
        () => serverDb.restoreDatabaseFromBackup(backupDbPath, backupDbPath),
        (err) => err.code === 'RESTORE_SOURCE_COLLISION'
      );

      // 3. Restore into a separate isolated temporary database file via db-backup CLI
      const dbBackupCli = require('../server/db-backup');
      const restoreRes = dbBackupCli.runCli(['--restore', backupDbPath, restoredDbPath]);
      assert.equal(restoreRes.ok, true);
      assert.equal(restoreRes.integrityCheck, 'ok');
      assert.equal(restoreRes.schemaVersion, serverDb.LATEST_SCHEMA_VERSION);
      assert.equal(restoreRes.tablesCount, serverDb.EXPECTED_PRODUCTION_TABLES.length);
      assert.ok(fs.existsSync(restoredDbPath));

      // 4. Open restored DB and verify schema + user + watchlist data consistency
      process.env.YASHWIN_DB_PATH = restoredDbPath;
      serverDb.getDb(restoredDbPath);
      const auditRestored = serverDb.runDatabaseAuditAndIntegrityCheck(restoredDbPath);
      assert.equal(auditRestored.healthy, true);

      const userInRestored = serverDb.getUserByEmail('restore_trader@example.com');
      assert.ok(userInRestored);
      assert.equal(userInRestored.userId, 'USR_RESTORE_201');

      const wlInRestored = serverDb.listWatchlist('USR_RESTORE_201');
      assert.equal(wlInRestored.length, 1);
      assert.equal(wlInRestored[0].tradingsymbol, 'SBIN-EQ');
    } finally {
      process.env.YASHWIN_DB_PATH = ':memory:';
      serverDb.getDb(':memory:');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('187. Task 20.1 Database & Backup Files Are Never Publicly Served over HTTP', async () => {
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const blockedDbPaths = [
      '/server/data/yashwin-trading.sqlite',
      '/server/data/yashwin-trading.sqlite-wal',
      '/server/data/yashwin-trading.sqlite-shm',
      '/data/yashwin-trading.sqlite',
      '/yashwin-trading.sqlite',
      '/../server/data/yashwin-trading.sqlite',
      '/server/data/backups/backup.sqlite'
    ];

    for (const p of blockedDbPaths) {
      const res = await requestServer(server, p);
      assert.ok(
        res.status === 403 || res.status === 404,
        `Database/backup path ${p} must return 403 or 404 (got ${res.status})`
      );
      assert.equal(String(res.text || '').includes('SQLite format 3'), false);
    }
  });

  // =========================================================
  // TASK 21 — FINAL END-TO-END TESTING & RELEASE READINESS
  // =========================================================

  test('188. Task 21 End-to-End Authentication-to-Trading Workflow & Restart Persistence (Isolated SQLite DB)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yashwin-task21-e2e-'));
    const e2eDbPath = path.join(tmpDir, 'e2e-workflow.sqlite');

    try {
      process.env.YASHWIN_DB_PATH = e2eDbPath;
      serverDb.getDb(e2eDbPath);

      const srv1 = apiServer.createServer();
      const lifecycle1 = apiServer.setupGracefulShutdown(srv1, {
        attachProcessSignals: false,
        timeoutMs: 2000
      });
      await new Promise((resolve) => srv1.listen(0, '127.0.0.1', resolve));

      // 1. Register a new user
      const regRes = await requestServer(srv1, '/api/user/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Release Trader',
          email: 'e2e_release_trader@example.com',
          password: 'Password123'
        })
      });
      assert.equal(regRes.status, 201);
      assert.equal(regRes.json.ok, true);
      assert.equal(regRes.json.authenticated, true);
      assert.equal('passwordHash' in regRes.json.user, false);
      const userId = regRes.json.user.userId;

      // 2. Log in with the new user
      const loginRes = await requestServer(srv1, '/api/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'e2e_release_trader@example.com',
          password: 'Password123'
        })
      });
      assert.equal(loginRes.status, 200);
      assert.equal(loginRes.json.authenticated, true);
      const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
      const csrf = loginRes.json.csrfToken;

      const authHeaders = {
        Cookie: cookie,
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json'
      };

      // 3. Verify authenticated profile & session
      const profileRes = await requestServer(srv1, '/api/user/profile', {
        method: 'GET',
        headers: { Cookie: cookie }
      });
      assert.equal(profileRes.status, 200);
      assert.equal(profileRes.json.user.userId, userId);
      assert.equal(profileRes.json.user.email, 'e2e_release_trader@example.com');

      // 4. Search and select an instrument + add to watchlist
      angelSession.setSessionForTest({ status: 'CONNECTED', accessToken: 'MOCK_TOKEN_E2E' });
      runtime.setMockSmartAPI({
        SmartAPI: class {
          setAccessToken() {}
          async searchScrip(ex, q) {
            return {
              status: true,
              data: [
                {
                  exchange: ex || 'NSE',
                  tradingsymbol: `${q}-EQ`,
                  symboltoken: '2885'
                }
              ]
            };
          }
        }
      });

      const searchRes = await requestServer(srv1, '/api/instruments/search?q=RELIANCE&exchange=NSE', {
        method: 'GET',
        headers: { Cookie: cookie }
      });
      assert.equal(searchRes.status, 200);
      assert.equal(searchRes.json.ok, true);
      assert.ok(Array.isArray(searchRes.json.results));
      assert.ok(searchRes.json.results.length >= 1);

      const wlAddRes = await requestServer(srv1, '/api/watchlist/add', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          key: 'RELIANCE',
          tradingsymbol: 'RELIANCE-EQ',
          name: 'Reliance Industries',
          exchange: 'NSE',
          instrumentType: 'EQUITY'
        })
      });
      assert.equal(wlAddRes.status, 200);
      assert.equal(wlAddRes.json.watchlist.length, 1);

      // 5. Evaluate strategy and risk for a paper trade
      const stratRes = await requestServer(srv1, '/api/strategy/evaluate', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          symbol: 'RELIANCE',
          dataReady: true,
          price: 2500,
          assetType: 'EQUITY',
          analysis: {
            dataReady: true,
            signal: 'BUY',
            confidence: 86,
            risk: 'LOW',
            trend: 'BULLISH'
          }
        })
      });
      assert.equal(stratRes.status, 200);
      assert.equal(stratRes.json.ok, true);
      assert.equal(stratRes.json.strategy.action, 'BUY');
      assert.equal(stratRes.json.strategy.executable, true);

      const riskRes = await requestServer(srv1, '/api/risk/evaluate', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          symbol: 'RELIANCE',
          side: 'BUY',
          assetType: 'EQUITY',
          entry: 2500,
          stop: 2480,
          target: 2545,
          quantity: 10,
          dataReady: true
        })
      });
      assert.equal(riskRes.status, 200);
      assert.equal(riskRes.json.riskCheck.allowed, true);

      // 6. Open a paper position
      const openRes = await requestServer(srv1, '/api/paper/open', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          symbol: 'RELIANCE',
          exchange: 'NSE',
          side: 'BUY',
          assetType: 'EQUITY',
          entry: 2500,
          stop: 2480,
          target: 2545,
          qty: 10,
          clientOrderKey: 'E2E_REL_OPEN_1'
        })
      });
      assert.equal(openRes.status, 200);
      assert.equal(openRes.json.ok, true);
      assert.ok(openRes.json.openPosition);
      assert.equal(openRes.json.openPosition.symbol, 'RELIANCE');
      const positionId = openRes.json.openPosition.id;

      // 7. Update price and verify unrealized P&L + portfolio state
      const priceUpdateRes = await requestServer(srv1, '/api/paper/price-update', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          positionId,
          price: 2525,
          autoExit: false
        })
      });
      assert.equal(priceUpdateRes.status, 200);
      assert.equal(priceUpdateRes.json.pnl, 250);

      const portfolioOpenRes = await requestServer(srv1, '/api/portfolio/summary', {
        method: 'GET',
        headers: { Cookie: cookie }
      });
      assert.equal(portfolioOpenRes.status, 200);
      assert.equal(portfolioOpenRes.json.summary.openPositionCount, 1);
      assert.equal(portfolioOpenRes.json.summary.reservedCapital, 25000);
      assert.equal(portfolioOpenRes.json.summary.availableBalance, 75000);

      // 8. Close the paper position and verify realized P&L, order, fill, and trade history
      const closeRes = await requestServer(srv1, '/api/paper/close', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          positionId,
          exitPrice: 2535,
          reason: 'TARGET_REACHED'
        })
      });
      assert.equal(closeRes.status, 200);
      assert.equal(closeRes.json.ok, true);
      assert.equal(closeRes.json.pnl, 350);
      assert.equal(closeRes.json.openPosition, null);

      const ordersRes = await requestServer(srv1, '/api/orders', {
        method: 'GET',
        headers: { Cookie: cookie }
      });
      assert.equal(ordersRes.status, 200);
      assert.equal(ordersRes.json.orders.length, 2); // ENTRY + EXIT orders
      assert.equal(ordersRes.json.brokerExecution, 'NONE');

      const fillsRes = await requestServer(srv1, '/api/orders/fills', {
        method: 'GET',
        headers: { Cookie: cookie }
      });
      assert.equal(fillsRes.status, 200);
      assert.equal(fillsRes.json.fills.length, 2);

      const tradesRes = await requestServer(srv1, '/api/trades/history', {
        method: 'GET',
        headers: { Cookie: cookie }
      });
      assert.equal(tradesRes.status, 200);
      assert.equal(tradesRes.json.trades.length, 1);
      assert.equal(tradesRes.json.trades[0].netPnl, 350);
      assert.ok(tradesRes.json.trades[0].rMultiple > 1);

      // 9. Run a backtest and verify persisted results
      const candles = [];
      let basePrice = 2400;
      const startMs = Date.parse('2026-09-01T09:15:00.000Z');
      for (let i = 0; i < 65; i += 1) {
        const step = i < 35 ? 2.5 : i < 50 ? 4.0 : -3.0;
        const open = basePrice;
        const close = Number((open + step).toFixed(2));
        const high = Number((Math.max(open, close) + 3).toFixed(2));
        const low = Number((Math.min(open, close) - 2).toFixed(2));
        candles.push({
          timestamp: new Date(startMs + i * 5 * 60 * 1000).toISOString(),
          open,
          high,
          low,
          close,
          volume: 15000 + i * 350
        });
        basePrice = close;
      }

      const btRes = await requestServer(srv1, '/api/backtest/run', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          symbol: 'RELIANCE',
          exchange: 'NSE',
          timeframe: 'FIVE_MINUTE',
          initialCapital: 100000,
          candles,
          persist: true
        })
      });
      assert.equal(btRes.status, 200);
      assert.equal(btRes.json.ok, true);
      assert.ok(btRes.json.runId);

      // 10. Create an alert, evaluate it against validated market context, and verify notification creation
      const alertCreateRes = await requestServer(srv1, '/api/alerts', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          symbol: 'RELIANCE',
          tradingsymbol: 'RELIANCE-EQ',
          exchange: 'NSE',
          alertType: 'PRICE_ABOVE',
          threshold: 2520,
          direction: 'ABOVE',
          message: 'RELIANCE broke above 2520'
        })
      });
      assert.equal(alertCreateRes.status, 201);
      assert.equal(alertCreateRes.json.ok, true);

      const alertEvalRes = await requestServer(srv1, '/api/alerts/evaluate', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          symbol: 'RELIANCE',
          marketContext: {
            symbol: 'RELIANCE',
            tradingsymbol: 'RELIANCE-EQ',
            exchange: 'NSE',
            price: 2535,
            previousPrice: 2510,
            dataReady: true,
            stale: false,
            timestamp: new Date().toISOString()
          }
        })
      });
      assert.equal(alertEvalRes.status, 200);
      assert.equal(alertEvalRes.json.triggeredCount, 1);
      assert.equal(alertEvalRes.json.autoOrderTriggered, false);
      assert.equal(alertEvalRes.json.brokerExecution, 'NONE');

      const notifRes = await requestServer(srv1, '/api/notifications', {
        method: 'GET',
        headers: { Cookie: cookie }
      });
      assert.equal(notifRes.status, 200);
      assert.ok(notifRes.json.totalCount >= 1);
      assert.ok(notifRes.json.unreadCount >= 1);

      // 11. Restart server against the same isolated SQLite file and verify all data survived
      const shutdown1 = await lifecycle1.shutdown('SIGTERM');
      assert.equal(shutdown1.ok, true);

      const srv2 = apiServer.createServer();
      const lifecycle2 = apiServer.setupGracefulShutdown(srv2, {
        attachProcessSignals: false,
        timeoutMs: 2000
      });
      await new Promise((resolve) => srv2.listen(0, '127.0.0.1', resolve));

      const postRestartPortfolio = await requestServer(srv2, '/api/portfolio/summary', {
        method: 'GET',
        headers: { Cookie: cookie }
      });
      assert.equal(postRestartPortfolio.status, 200);
      assert.equal(postRestartPortfolio.json.summary.realizedPnl, 350);
      assert.equal(postRestartPortfolio.json.summary.totalEquity, 100350);

      const postRestartBt = await requestServer(srv2, `/api/backtest/runs/${btRes.json.runId}`, {
        method: 'GET',
        headers: { Cookie: cookie }
      });
      assert.equal(postRestartBt.status, 200);
      assert.equal(postRestartBt.json.run.runId, btRes.json.runId);

      // 12. Log out and verify session invalidation
      const logoutRes = await requestServer(srv2, '/api/user/logout', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({})
      });
      assert.equal(logoutRes.status, 200);
      assert.equal(logoutRes.json.authenticated, false);

      const postLogoutProfile = await requestServer(srv2, '/api/user/profile', {
        method: 'GET',
        headers: { Cookie: cookie }
      });
      assert.equal(postLogoutProfile.status, 401);

      await lifecycle2.shutdown('SIGTERM');
    } finally {
      process.env.YASHWIN_DB_PATH = ':memory:';
      serverDb.getDb(':memory:');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('189. Task 21 Multi-User Isolation Verification Across All Private Resources', async () => {
    serverDb.resetAllTablesForTest();
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // Register User A & User B
    const regA = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Trader Alpha',
        email: 'alpha_task21@example.com',
        password: 'Password123'
      })
    });
    const regB = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Trader Beta',
        email: 'beta_task21@example.com',
        password: 'Password123'
      })
    });
    assert.equal(regA.status, 201);
    assert.equal(regB.status, 201);

    const userAId = regA.json.user.userId;
    const cookieA = regA.headers['set-cookie'][0].split(';')[0];
    const csrfA = regA.json.csrfToken;
    const headersA = { Cookie: cookieA, 'X-CSRF-Token': csrfA, 'Content-Type': 'application/json' };

    const cookieB = regB.headers['set-cookie'][0].split(';')[0];
    const csrfB = regB.json.csrfToken;
    const headersB = { Cookie: cookieB, 'X-CSRF-Token': csrfB, 'Content-Type': 'application/json' };

    // User A creates private position, watchlist item, alert, backtest, and notification preference
    const openA = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        symbol: 'TCS',
        side: 'BUY',
        entry: 3500,
        stop: 3480,
        target: 3550,
        qty: 2
      })
    });
    assert.equal(openA.status, 200);
    const posAId = openA.json.openPosition.id;

    await requestServer(server, '/api/watchlist/add', {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        key: 'TCS',
        tradingsymbol: 'TCS-EQ',
        name: 'Tata Consultancy Services',
        exchange: 'NSE',
        instrumentType: 'EQUITY'
      })
    });

    const alertA = await requestServer(server, '/api/alerts', {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        symbol: 'TCS',
        tradingsymbol: 'TCS-EQ',
        exchange: 'NSE',
        alertType: 'PRICE_ABOVE',
        threshold: 3600
      })
    });
    assert.equal(alertA.status, 201);
    const alertAId = alertA.json.alert.alertId;

    const notifA = await requestServer(server, '/api/notifications/system', {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        category: 'SYSTEM_STATUS',
        severity: 'INFO',
        title: 'User A Private Notice',
        message: 'Private to User A'
      })
    });
    assert.equal(notifA.status, 201);
    const notifAId = notifA.json.notification.notificationId;

    // Verify User B cannot read or mutate any of User A's private records
    const bCloseAPos = await requestServer(server, '/api/paper/close', {
      method: 'POST',
      headers: headersB,
      body: JSON.stringify({ positionId: posAId, exitPrice: 3510 })
    });
    assert.equal(bCloseAPos.status, 403);
    assert.equal(bCloseAPos.json.code, 'FORBIDDEN_OWNERSHIP');

    const bPauseAAlert = await requestServer(server, '/api/alerts/pause', {
      method: 'POST',
      headers: headersB,
      body: JSON.stringify({ alertId: alertAId })
    });
    assert.equal(bPauseAAlert.status, 403);
    assert.equal(bPauseAAlert.json.code, 'FORBIDDEN_OWNERSHIP');

    const bDeleteAAlert = await requestServer(server, '/api/alerts/delete', {
      method: 'POST',
      headers: headersB,
      body: JSON.stringify({ alertId: alertAId })
    });
    assert.equal(bDeleteAAlert.status, 403);
    assert.equal(bDeleteAAlert.json.code, 'FORBIDDEN_OWNERSHIP');

    const bReadANotif = await requestServer(server, '/api/notifications/read', {
      method: 'POST',
      headers: headersB,
      body: JSON.stringify({ notificationId: notifAId })
    });
    assert.equal(bReadANotif.status, 403);
    assert.equal(bReadANotif.json.code, 'FORBIDDEN_OWNERSHIP');

    // Verify User B's GET endpoints return only User B's empty state and reject ?userId=UserA
    const bSpyPortfolio = await requestServer(server, `/api/portfolio/summary?userId=${userAId}`, {
      method: 'GET',
      headers: { Cookie: cookieB }
    });
    assert.equal(bSpyPortfolio.status, 403);

    const bSpyOrders = await requestServer(server, `/api/orders?userId=${userAId}`, {
      method: 'GET',
      headers: { Cookie: cookieB }
    });
    assert.equal(bSpyOrders.status, 403);

    const bOwnPortfolio = await requestServer(server, '/api/portfolio/summary', {
      method: 'GET',
      headers: { Cookie: cookieB }
    });
    assert.equal(bOwnPortfolio.status, 200);
    assert.equal(bOwnPortfolio.json.summary.openPositionCount, 0);

    const bOwnWatchlist = await requestServer(server, '/api/watchlist', {
      method: 'GET',
      headers: { Cookie: cookieB }
    });
    assert.equal(bOwnWatchlist.status, 200);
    assert.equal(bOwnWatchlist.json.watchlist.length, 0);
  });

  test('190. Task 21 Trading Safety & Risk Enforcement: Paper-Only Lock, Risk Limits, Emergency Stop & Zero Fabrication', async () => {
    serverDb.resetAllTablesForTest();
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // 1. Attempt to enable live trading in environment is strictly overridden to paper-only with safety warnings
    const invalidEnv = serverConfig.validateProductionEnvironment({
      NODE_ENV: 'production',
      PORT: '3000',
      TRADING_MODE: 'live',
      LIVE_TRADING_ENABLED: 'true',
      YASHWIN_DB_PATH: 'server/data/yashwin-trading.sqlite'
    });
    assert.equal(invalidEnv.tradingMode, 'paper');
    assert.equal(invalidEnv.liveTradingEnabled, false);
    assert.equal(invalidEnv.brokerOrderExecution, 'DISABLED');
    assert.ok(invalidEnv.warnings.some((w) => w.includes('LIVE_TRADING_ENABLED was set to true')));
    assert.ok(invalidEnv.warnings.some((w) => w.includes('TRADING_MODE="live" is not allowed')));

    // 2. Register user for risk & emergency stop verification
    const reg = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Risk Gate Tester',
        email: 'risk_gate_task21@example.com',
        password: 'Password123'
      })
    });
    const cookie = reg.headers['set-cookie'][0].split(';')[0];
    const csrf = reg.json.csrfToken;
    const headers = { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };

    // 3. Reject missing stop-loss or invalid stop geometry
    const badStopRes = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        symbol: 'NIFTY 50',
        side: 'BUY',
        entry: 22500,
        stop: 22550, // invalid BUY stop above entry
        target: 22650,
        qty: 1
      })
    });
    assert.equal(badStopRes.status, 400);
    assert.equal(badStopRes.json.code, 'RISK_REJECTED');

    // 4. Reject per-trade risk exceeding ₹500
    const excessRiskRes = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        symbol: 'NIFTY 50',
        side: 'BUY',
        entry: 22500,
        stop: 22350, // 150 pts * 4 qty = ₹600 risk > ₹500 max
        target: 22850,
        qty: 4
      })
    });
    assert.equal(excessRiskRes.status, 400);
    assert.equal(excessRiskRes.json.code, 'RISK_REJECTED');

    // 5. Reject stale data or averaging down
    const staleRes = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        symbol: 'NIFTY 50',
        side: 'BUY',
        entry: 22500,
        stop: 22480,
        target: 22560,
        qty: 4,
        staleData: true
      })
    });
    assert.equal(staleRes.status, 400);
    assert.equal(staleRes.json.code, 'RISK_REJECTED');

    // 6. Open 1 valid position and verify 2nd concurrent position is blocked
    const validOpen = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        symbol: 'NIFTY 50',
        side: 'BUY',
        entry: 22500,
        stop: 22480,
        target: 22560,
        qty: 4
      })
    });
    assert.equal(validOpen.status, 200);

    const secondOpen = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        symbol: 'BANKNIFTY',
        side: 'BUY',
        entry: 48000,
        stop: 47980,
        target: 48060,
        qty: 1
      })
    });
    assert.equal(secondOpen.status, 400);
    assert.equal(secondOpen.json.code, 'RISK_REJECTED');

    // 7. Emergency Stop immediately closes open position and blocks any new entry
    const emAct = await requestServer(server, '/api/emergency/activate', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ reason: 'Task 21 Emergency Stop Verification' })
    });
    assert.equal(emAct.status, 200);
    assert.equal(emAct.json.active, true);
    assert.equal(emAct.json.openPosition, null);

    const blockedByEm = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        symbol: 'NIFTY 50',
        side: 'BUY',
        entry: 22500,
        stop: 22480,
        target: 22560,
        qty: 5
      })
    });
    assert.equal(blockedByEm.status, 400);
    assert.equal(blockedByEm.json.code, 'EMERGENCY_STOP_ACTIVE');

    // Reset emergency stop
    const emReset = await requestServer(server, '/api/emergency/reset', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ reason: 'Reset after Task 21 test' })
    });
    assert.equal(emReset.status, 200);
    assert.equal(emReset.json.active, false);

    // 8. Verify AI Safety Gate & StrategyEngine never fabricate prices or allow trades when dataReady=false
    const unreadyStrat = StrategyEngine.evaluate({
      symbol: 'NIFTY 50',
      snapshot: { name: 'NIFTY 50', price: null, dataReady: false }
    });
    assert.equal(unreadyStrat.action, 'NO_TRADE');
    assert.equal(unreadyStrat.executable, false);
  });

  test('191. Task 21 Database Integrity, Atomic Backup & Isolated Restore End-to-End Verification', () => {
    // 1. Audit canonical database path resolution & invariants without mutating production data
    const resolvedCanonical = serverDb.resolveDbPath('server/data/yashwin-trading.sqlite');
    assert.equal(resolvedCanonical, serverDb.DEFAULT_DB_PATH);
    assert.equal(serverDb.LATEST_SCHEMA_VERSION, 9);
    assert.equal(serverDb.EXPECTED_PRODUCTION_TABLES.length, 26);

    // 2. Create isolated temporary database, populate records, back up, restore into separate target, and verify
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yashwin-task21-db-'));
    const tempSourceDb = path.join(tmpDir, 'source-task21.sqlite');
    const tempBackupDb = path.join(tmpDir, 'backups', 'task21-backup.sqlite');
    const tempRestoreDb = path.join(tmpDir, 'restored', 'task21-restored.sqlite');

    try {
      process.env.YASHWIN_DB_PATH = tempSourceDb;
      serverDb.getDb(tempSourceDb);

      const sourceAudit = serverDb.runDatabaseAuditAndIntegrityCheck(tempSourceDb);
      assert.equal(sourceAudit.ok, true);
      assert.equal(sourceAudit.healthy, true);
      assert.equal(sourceAudit.integrityCheck, 'ok');
      assert.equal(sourceAudit.schemaVersion, 9);
      assert.equal(sourceAudit.tablesCount, 26);

      serverDb.createUserRecord({
        userId: 'USR_TASK21_DB',
        name: 'Task 21 DB User',
        email: 'task21_db@example.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuv1234567890abcdefghijklmnopqrstu'
      });

      const backupReport = serverDb.backupDatabase(tempBackupDb, tempSourceDb);
      assert.equal(backupReport.ok, true);
      assert.equal(backupReport.integrityCheck, 'ok');
      assert.equal(backupReport.schemaVersion, 9);
      assert.equal(backupReport.tablesCount, 26);

      const restoreReport = serverDb.restoreDatabaseFromBackup(tempBackupDb, tempRestoreDb);
      assert.equal(restoreReport.ok, true);
      assert.equal(restoreReport.integrityCheck, 'ok');
      assert.equal(restoreReport.schemaVersion, 9);
      assert.equal(restoreReport.tablesCount, 26);

      process.env.YASHWIN_DB_PATH = tempRestoreDb;
      serverDb.getDb(tempRestoreDb);
      const restoredUser = serverDb.getUserByEmail('task21_db@example.com');
      assert.ok(restoredUser);
      assert.equal(restoredUser.userId, 'USR_TASK21_DB');
    } finally {
      process.env.YASHWIN_DB_PATH = ':memory:';
      serverDb.getDb(':memory:');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('192. Task 21 Web, PWA Offline Restrictions & Android Client Configuration Verification', async () => {
    const swModule = require('../web/sw');
    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // 1. Web static shell, manifest, and service worker serve cleanly
    const rootRes = await requestServer(server, '/');
    assert.equal(rootRes.status, 200);
    assert.ok(rootRes.text.includes('YASHWIN'));

    const manifestRes = await requestServer(server, '/manifest.webmanifest');
    assert.equal(manifestRes.status, 200);
    assert.equal(manifestRes.json.display, 'standalone');
    assert.ok(Array.isArray(manifestRes.json.icons));
    assert.ok(manifestRes.json.icons.length >= 3);

    const swRes = await requestServer(server, '/sw.js');
    assert.equal(swRes.status, 200);
    assert.equal(swRes.headers['service-worker-allowed'], '/');
    assert.ok(String(swRes.headers['cache-control'] || '').includes('no-cache'));

    // 2. Service worker never caches sensitive/API endpoints and returns non-fabricated offline error
    assert.equal(swModule.isSensitiveOrDynamicRequest('http://localhost:3000/api/market/quote?symbol=NIFTY', 'GET'), true);
    assert.equal(swModule.isSensitiveOrDynamicRequest('http://localhost:3000/api/portfolio/summary', 'GET'), true);
    assert.equal(swModule.isSensitiveOrDynamicRequest('http://localhost:3000/api/paper/open', 'POST'), true);

    const offlineApiPayload = await swModule.buildOfflineApiResponse('/api/market/quote').json();
    assert.equal(offlineApiPayload.ok, false);
    assert.equal(offlineApiPayload.offline, true);
    assert.equal(offlineApiPayload.code, 'OFFLINE_NETWORK_UNAVAILABLE');
    assert.equal(offlineApiPayload.dataReady, false);
    assert.equal(offlineApiPayload.liveTradingEnabled, false);
    assert.equal(offlineApiPayload.brokerExecution, 'NONE');

    // 3. Android project configuration & security verification
    const rootDir = path.join(__dirname, '..');
    const manifestXml = fs.readFileSync(
      path.join(rootDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
      'utf8'
    );
    const mainActivityKt = fs.readFileSync(
      path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'com', 'yashwin', 'aitrading', 'MainActivity.kt'),
      'utf8'
    );
    const appBuildGradle = fs.readFileSync(
      path.join(rootDir, 'android', 'app', 'build.gradle.kts'),
      'utf8'
    );

    assert.ok(manifestXml.includes('android:allowBackup="false"'));
    assert.ok(manifestXml.includes('android:networkSecurityConfig="@xml/network_security_config"'));
    assert.ok(mainActivityKt.includes('allowFileAccess = false'));
    assert.ok(mainActivityKt.includes('allowContentAccess = false'));
    assert.equal(mainActivityKt.includes('addJavascriptInterface('), false);
    assert.ok(mainActivityKt.includes('handler?.cancel()'));
    assert.ok(appBuildGradle.includes('applicationId = "com.yashwin.aitrading"'));
    assert.ok(appBuildGradle.includes('TRADING_MODE'));
    assert.ok(appBuildGradle.includes('LIVE_TRADING_ENABLED'));
  });

  test('193. Task 21 Final Security & Release Hygiene Verification', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUST_PROXY = 'false';
    process.env.PUBLIC_BASE_URL = 'https://prod.yashwin.example.com';
    process.env.DIAGNOSTICS_AUTH_TOKEN = 'TASK21_FINAL_DIAG_SECRET';

    server = apiServer.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    // 1. Untrusted origin & CSRF enforcement on state-changing requests
    const untrustedPost = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        Origin: 'https://malicious-site.example.org',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ symbol: 'RELIANCE', side: 'BUY', entry: 2500, stop: 2480, target: 2540, qty: 1 })
    });
    assert.equal(untrustedPost.status, 403);
    assert.equal(untrustedPost.json.code, 'UNTRUSTED_ORIGIN');

    // Register user and verify missing CSRF token is rejected with 403
    const reg = await requestServer(server, '/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Hygiene Auditor',
        email: 'hygiene_task21@example.com',
        password: 'Password123'
      })
    });
    assert.equal(reg.status, 201);
    const cookie = reg.headers['set-cookie'][0].split(';')[0];

    const missingCsrfPost = await requestServer(server, '/api/paper/open', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ symbol: 'RELIANCE', side: 'BUY', entry: 2500, stop: 2480, target: 2540, qty: 1 })
    });
    assert.equal(missingCsrfPost.status, 403);
    assert.equal(missingCsrfPost.json.code, 'CSRF_TOKEN_INVALID');

    // 2. Detailed diagnostics require authorization in production
    const unauthAudit = await requestServer(server, '/api/database/audit');
    assert.equal(unauthAudit.status, 401);

    const authAudit = await requestServer(server, '/api/database/audit', {
      headers: { 'X-Diagnostics-Token': 'TASK21_FINAL_DIAG_SECRET' }
    });
    assert.equal(authAudit.status, 200);
    assert.equal(authAudit.json.ok, true);

    // 3. Static file server blocks traversal, hidden files, server source code, and SQLite databases
    for (const blockedPath of ['/.env', '/server/config.js', '/server/database.js', '/server/data/yashwin-trading.sqlite']) {
      const blockedRes = await requestServer(server, blockedPath);
      assert.ok(blockedRes.status === 403 || blockedRes.status === 404);
    }

    // 4. Verify .gitignore and .dockerignore protect secrets, SQLite files, backups, keystores, and APKs
    const rootDir = path.join(__dirname, '..');
    const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
    const dockerignore = fs.readFileSync(path.join(rootDir, '.dockerignore'), 'utf8');

    for (const pattern of ['.env', '*.sqlite', '*.sqlite-wal', '*.sqlite-shm', 'server/data/backups/', '*.jks', '*.keystore', '*.apk']) {
      assert.ok(gitignore.includes(pattern), `.gitignore must include ${pattern}`);
      assert.ok(dockerignore.includes(pattern), `.dockerignore must include ${pattern}`);
    }
  });

  test('194. Task 22 Dependency Security Overrides (`package.json`, `server/package.json`) & SmartAPI Runtime Compatibility', () => {
    const rootDir = path.join(__dirname, '..');
    const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const serverPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'server', 'package.json'), 'utf8'));

    for (const pkg of [rootPkg, serverPkg]) {
      assert.ok(pkg.overrides, 'package.json must define security overrides');
      assert.equal(pkg.overrides.axios, '^1.20.0');
      assert.equal(pkg.overrides['serialize-javascript'], '^7.1.2');
      assert.equal(pkg.overrides.chokidar, '^4.0.3');
      assert.equal(pkg.overrides['js-yaml'], '^4.1.1');
      assert.equal(pkg.overrides.argparse, '^2.0.1');
      assert.equal(pkg.overrides.got, '^11.8.6');
      assert.equal(pkg.overrides.uuid, '^11.1.1');
    }

    // Verify upgraded axios and smartapi-javascript load and instantiate cleanly
    const axiosPkg = require('axios/package.json');
    const [axiosMajor, axiosMinor] = String(axiosPkg.version).split('.').map(Number);
    assert.ok(axiosMajor > 1 || (axiosMajor === 1 && axiosMinor >= 20), `Expected axios >= 1.20.0, got ${axiosPkg.version}`);

    const runtimeInfo = runtime.getRuntimeInfo();
    assert.equal(runtimeInfo.sdkLoaded, true);
    assert.equal(runtimeInfo.sdkVersion, '1.0.27');

    const sdk = runtime.loadSmartAPI();
    assert.equal(typeof sdk.SmartAPI, 'function');
  });

  test('195. Task 23 GitHub Actions Android Debug APK Workflow & Mobile-Only Build Security Verification', () => {
    const rootDir = path.join(__dirname, '..');
    const workflowPath = path.join(rootDir, '.github', 'workflows', 'android-debug-apk.yml');
    assert.equal(fs.existsSync(workflowPath), true, 'GitHub Actions workflow .github/workflows/android-debug-apk.yml must exist at repository root');

    const workflowYaml = fs.readFileSync(workflowPath, 'utf8');
    const gradleProps = fs.readFileSync(path.join(rootDir, 'android', 'gradle.properties'), 'utf8');
    const appBuildGradle = fs.readFileSync(path.join(rootDir, 'android', 'app', 'build.gradle.kts'), 'utf8');
    const gradlewPath = path.join(rootDir, 'android', 'gradlew');

    // 1. Manual trigger via workflow_dispatch & minimal permissions
    assert.ok(workflowYaml.includes('workflow_dispatch:'), 'Workflow must support manual execution via workflow_dispatch');
    assert.ok(workflowYaml.includes('permissions:\n  contents: read'), 'Workflow must use minimal read-only permissions (contents: read)');

    // 2. Pinned trusted third-party actions & JDK 17 + Android SDK API 34 + Gradle 8.7 (without obsolete 'tools' package)
    assert.ok(workflowYaml.includes('actions/checkout@v4'));
    assert.ok(workflowYaml.includes('actions/setup-node@v4'));
    assert.ok(workflowYaml.includes('actions/setup-java@v4'));
    assert.ok(workflowYaml.includes('java-version: "17"'));
    assert.equal(workflowYaml.includes('android-actions/setup-android'), false, 'Workflow must not use android-actions/setup-android which requests obsolete SDK package "tools"');
    assert.ok(workflowYaml.includes('ANDROID_HOME='));
    assert.ok(workflowYaml.includes('ANDROID_SDK_ROOT='));
    assert.ok(workflowYaml.includes('cmdline-tools;latest'));
    assert.ok(workflowYaml.includes('platform-tools'));
    assert.ok(workflowYaml.includes('platforms;android-34'));
    assert.ok(workflowYaml.includes('build-tools;34.0.0'));
    assert.ok(workflowYaml.includes('sdkmanager --sdk_root="$SDK_ROOT" --licenses'));
    assert.ok(workflowYaml.includes('gradle/actions/setup-gradle@v4'));
    assert.ok(workflowYaml.includes('gradle-version: "8.7"'));
    assert.ok(workflowYaml.includes('./gradlew --version --no-daemon'));
    assert.ok(workflowYaml.includes('actions/upload-artifact@v4'));

    // 3. Root and server test execution before Android APK build
    const testIdx = workflowYaml.indexOf('npm test');
    const serverTestIdx = workflowYaml.indexOf('npm --prefix server test');
    const assembleIdx = workflowYaml.indexOf('./gradlew :app:assembleDebug');
    assert.ok(testIdx > 0 && serverTestIdx > 0 && assembleIdx > testIdx && assembleIdx > serverTestIdx, 'Workflow must run root and server tests before ./gradlew :app:assembleDebug');

    // 4. Existing Gradle wrapper & module structure preserved
    assert.equal(fs.existsSync(gradlewPath), true, 'android/gradlew must exist');
    assert.ok(workflowYaml.includes('working-directory: android'));
    assert.ok(workflowYaml.includes('-PYASHWIN_BACKEND_URL="$SELECTED_BACKEND_URL"'));
    assert.ok(workflowYaml.includes('-PYASHWIN_PROD_BASE_URL="$SELECTED_BACKEND_URL"'));
    assert.ok(gradleProps.includes('YASHWIN_PROD_BASE_URL=https://'));
    assert.ok(appBuildGradle.includes('project.findProperty("YASHWIN_BACKEND_URL")'));
    assert.ok(appBuildGradle.includes('project.findProperty("YASHWIN_PROD_BASE_URL")'));

    // 5. Paper trading safety locks enforced & zero secrets in workflow
    assert.ok(workflowYaml.includes('TRADING_MODE: paper'));
    assert.ok(workflowYaml.includes('LIVE_TRADING_ENABLED: "false"'));
    assert.equal(workflowYaml.includes('secrets.'), false, 'Workflow must not reference or print repository secrets');
    for (const forbiddenSecret of ['ANGEL_API_KEY', 'ANGEL_CLIENT_CODE', 'ANGEL_PIN', 'ANGEL_TOTP_SECRET', 'GEMINI_API_KEY', 'DIAGNOSTICS_AUTH_TOKEN', 'YASHWIN_RELEASE_STORE_PASSWORD']) {
      assert.equal(workflowYaml.includes(forbiddenSecret), false, `Workflow must not contain or print ${forbiddenSecret}`);
    }

    // 6. APK existence, non-empty size verification, and artifact upload
    assert.ok(workflowYaml.includes('android/app/build/outputs/apk/debug/app-debug.apk'));
    assert.ok(workflowYaml.includes('Verified APK File Name:'));
    assert.ok(workflowYaml.includes('Verified APK Size (bytes):'));
    assert.ok(workflowYaml.includes('name: yashwin-ai-trading-debug-apk'));
    assert.ok(workflowYaml.includes('if-no-files-found: error'));
  });

  test('196. Task 24 Git Repository & Safe GitHub Push Readiness Verification (`rampawar123/yashwin-ai-trading`)', () => {
    const rootDir = path.join(__dirname, '..');
    const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');
    const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');

    // 1. Verify .env.example contains only safe defaults and empty placeholders for secrets
    assert.ok(envExample.includes('TRADING_MODE=paper'));
    assert.ok(envExample.includes('LIVE_TRADING_ENABLED=false'));
    assert.ok(envExample.includes('YASHWIN_DB_PATH=server/data/yashwin-trading.sqlite'));
    for (const secretKey of [
      'DIAGNOSTICS_AUTH_TOKEN=',
      'ANGEL_API_KEY=',
      'ANGEL_CLIENT_ID=',
      'ANGEL_PIN=',
      'ANGEL_TOTP_SECRET=',
      'GEMINI_API_KEY=',
      'GOOGLE_AI_API_KEY=',
      'FINNHUB_API_KEY=',
      'ALPHA_VANTAGE_API_KEY=',
      'NEWS_API_KEY=',
      'TRADING_ECONOMICS_API_KEY=',
      'TELEGRAM_BOT_TOKEN=',
      'TELEGRAM_CHAT_ID='
    ]) {
      const line = envExample.split(/\r?\n/).find((l) => l.startsWith(secretKey));
      assert.equal(line, secretKey, `.env.example must keep ${secretKey} as an empty placeholder`);
    }

    // 2. Verify all required project directories and configuration templates exist
    const requiredPaths = [
      '.dockerignore',
      '.env.example',
      '.gitignore',
      '.github/workflows/android-debug-apk.yml',
      'Dockerfile',
      'README.md',
      'docker-compose.yml',
      'package.json',
      'package-lock.json',
      'render.yaml',
      'server/api-server.js',
      'server/config.js',
      'server/database.js',
      'server/db-backup.js',
      'server/production-verify.js',
      'server/package.json',
      'web/index.html',
      'web/app.js',
      'web/sw.js',
      'web/manifest.webmanifest',
      'android/gradlew',
      'android/build.gradle.kts',
      'android/settings.gradle.kts',
      'android/gradle.properties',
      'android/gradle/wrapper/gradle-wrapper.properties',
      'android/app/build.gradle.kts',
      'android/app/src/main/AndroidManifest.xml',
      'android/app/src/main/java/com/yashwin/aitrading/MainActivity.kt'
    ];
    for (const relPath of requiredPaths) {
      assert.equal(fs.existsSync(path.join(rootDir, relPath)), true, `Required repository file ${relPath} must exist`);
    }

    // 3. Verify .gitignore excludes all sensitive files, databases, WAL/SHM, backups, keystores, and APKs/AABs
    for (const pattern of [
      '.env',
      '.env.*',
      '!.env.example',
      '*.sqlite',
      '*.sqlite-shm',
      '*.sqlite-wal',
      'server/data/*.sqlite*',
      'server/data/backups/',
      '*.jks',
      '*.keystore',
      '*.apk',
      '*.aab',
      'android/local.properties'
    ]) {
      assert.ok(gitignore.includes(pattern), `.gitignore must include ${pattern}`);
    }
  });

  test('197. Regression Audit: RSS IST/Timezone Parsing, Atom <entry>, CDATA Timestamps & News Freshness Validation', () => {
    const marketIntelligenceService = require('../server/market-intelligence-service');
    const nowMs = Date.parse('2026-10-10T10:00:00Z');

    // 1. IST (+05:30) RFC-822 & ISO-like timestamps parse deterministically to UTC
    const istRfc = marketIntelligenceService.normalizeTimestamp('Sat, 10 Oct 2026 14:30:00 IST');
    assert.equal(istRfc.valid, true);
    assert.equal(istRfc.iso, '2026-10-10T09:00:00.000Z');

    const istIso = marketIntelligenceService.normalizeTimestamp('2026-10-10 14:30:00 IST');
    assert.equal(istIso.valid, true);
    assert.equal(istIso.iso, '2026-10-10T09:00:00.000Z');

    const gmtOffset = marketIntelligenceService.normalizeTimestamp('Sat, 10 Oct 2026 14:30:00 GMT+05:30');
    assert.equal(gmtOffset.valid, true);
    assert.equal(gmtOffset.iso, '2026-10-10T09:00:00.000Z');

    const cdataTs = marketIntelligenceService.normalizeTimestamp('<![CDATA[Sat, 10 Oct 2026 09:30:00 GMT]]>');
    assert.equal(cdataTs.valid, true);
    assert.equal(cdataTs.iso, '2026-10-10T09:30:00.000Z');

    // 2. RSS 2.0 (<item> with CDATA & IST) and Atom (<entry> with <published> and href) parse and validate freshness
    const sampleXml = `
      <rss version="2.0">
        <channel>
          <item>
            <title><![CDATA[NSE NIFTY 50 hits intraday high on strong banking flows]]></title>
            <link><![CDATA[https://www.nseindia.com/news/nifty-high]]></link>
            <pubDate><![CDATA[Sat, 10 Oct 2026 15:00:00 IST]]></pubDate>
            <description><![CDATA[Validated Indian market update]]></description>
          </item>
          <entry>
            <title>Global central banks hold rates steady</title>
            <link href="https://example.com/global-rates" />
            <published>2026-10-08T08:00:00Z</published>
            <summary>Global macro update older than 24h</summary>
          </entry>
        </channel>
      </rss>
    `;

    const parsedItems = marketIntelligenceService.parseSimpleRssItems(sampleXml, 'NSE_RSS', 'INDIAN_MARKET');
    assert.equal(parsedItems.length, 2);

    const freshItem = marketIntelligenceService.validateAndNormalizeNewsItem(parsedItems[0], {
      nowMs,
      staleThresholdMs: 24 * 60 * 60 * 1000
    });
    assert.equal(freshItem.valid, true);
    assert.equal(freshItem.freshness, 'FRESH');
    assert.equal(freshItem.isStale, false);
    assert.equal(freshItem.publicationTimestamp, '2026-10-10T09:30:00.000Z');

    const staleItem = marketIntelligenceService.validateAndNormalizeNewsItem(parsedItems[1], {
      nowMs,
      staleThresholdMs: 24 * 60 * 60 * 1000
    });
    assert.equal(staleItem.valid, true);
    assert.equal(staleItem.freshness, 'STALE');
    assert.equal(staleItem.isStale, true);
  });

  test('198. Regression Audit: NIFTY 50 & SENSEX Bullish, Bearish & No-Trade Decisions + Google AI Market Context', async () => {
    // 1. NIFTY 50 Bullish decision on verified market data
    const niftyBullish = StrategyEngine.evaluate({
      symbol: 'NIFTY 50',
      snapshot: {
        name: 'NIFTY 50',
        exchange: 'NSE',
        assetType: 'INDEX',
        price: 22500,
        open: 22400,
        high: 22520,
        low: 22380,
        previousClose: 22350,
        volume: 250000,
        dataReady: true
      },
      indicators: {
        dataQuality: 'VALIDATED',
        marketRegime: 'BULLISH_TREND',
        ema9: 22480,
        ema21: 22420,
        rsi14: 62,
        vwap: 22440,
        atr14: 45,
        volatilityScore: 28,
        trendScore: 78
      },
      analysis: {
        signal: 'BUY',
        confidence: 84,
        risk: 'LOW',
        trend: 'BULLISH',
        dataReady: true
      }
    });
    assert.equal(niftyBullish.action, 'BUY');
    assert.equal(niftyBullish.executable, true);
    assert.ok(niftyBullish.stopLoss < niftyBullish.entry);
    assert.ok(niftyBullish.target > niftyBullish.entry);

    // 2. SENSEX Bearish decision on verified market data
    const sensexBearish = StrategyEngine.evaluate({
      symbol: 'SENSEX',
      snapshot: {
        name: 'SENSEX',
        exchange: 'BSE',
        assetType: 'INDEX',
        price: 74200,
        open: 74600,
        high: 74650,
        low: 74150,
        previousClose: 74700,
        volume: 180000,
        dataReady: true
      },
      indicators: {
        dataQuality: 'VALIDATED',
        marketRegime: 'BEARISH_TREND',
        ema9: 74250,
        ema21: 74480,
        rsi14: 36,
        vwap: 74420,
        atr14: 140,
        volatilityScore: 32,
        trendScore: -80
      },
      analysis: {
        signal: 'SELL',
        confidence: 82,
        risk: 'LOW',
        trend: 'BEARISH',
        dataReady: true
      }
    });
    assert.equal(sensexBearish.action, 'SELL');
    assert.equal(sensexBearish.executable, true);
    assert.ok(sensexBearish.stopLoss > sensexBearish.entry);
    assert.ok(sensexBearish.target < sensexBearish.entry);

    // 3. SENSEX No-Trade when market data is missing/unvalidated
    const sensexNoTrade = StrategyEngine.evaluate({
      symbol: 'SENSEX',
      snapshot: {
        name: 'SENSEX',
        exchange: 'BSE',
        price: null,
        dataReady: false
      }
    });
    assert.equal(sensexNoTrade.action, 'NO_TRADE');
    assert.equal(sensexNoTrade.executable, false);

    // 4. Google AI Service validates Indian & Global market intelligence context without fabricating prices
    const validatedInput = googleAIService.validateMarketInputForAI({
      symbol: 'SENSEX',
      exchange: 'BSE',
      assetType: 'INDEX',
      price: 74200,
      dataReady: true,
      marketIntelligence: {
        available: true,
        sentiment: { label: 'BEARISH', score: -45 },
        indianMarketNews: [{ headline: 'BSE Sensex slips on IT drag' }],
        globalMarketNews: [{ headline: 'US Treasury yields edge higher' }]
      }
    });
    assert.equal(validatedInput.symbol, 'SENSEX');
    assert.equal(validatedInput.exchange, 'BSE');
    assert.equal(validatedInput.marketIntelligence.available, true);
    assert.equal(validatedInput.marketIntelligence.indianHeadlinesCount, 1);
    assert.equal(validatedInput.marketIntelligence.globalHeadlinesCount, 1);
  });

  test('199. Regression Audit: Android MainActivity HTTP 404/5xx Recovery Overlay & Safe HTTPS Endpoint Override', () => {
    const rootDir = path.join(__dirname, '..');
    const mainActivityKt = fs.readFileSync(
      path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'com', 'yashwin', 'aitrading', 'MainActivity.kt'),
      'utf8'
    );

    // 1. Intercepts HTTP >= 400 (e.g. 404 Page Not Found) on main frame and hides raw WebView error HTML
    assert.ok(mainActivityKt.includes('override fun onReceivedHttpError('));
    assert.ok(mainActivityKt.includes('request.isForMainFrame && statusCode >= 400'));
    assert.ok(mainActivityKt.includes('Backend server returned HTTP $statusCode'));
    assert.ok(mainActivityKt.includes('webView.visibility = View.INVISIBLE'));

    // 2. Supports runtime HTTPS endpoint configuration while rejecting localhost/127.0.0.1 and preserving paper-only lock
    assert.ok(mainActivityKt.includes('promptServerUrlOverride()'));
    assert.ok(mainActivityKt.includes('isValidSafeBackendUrl('));
    assert.ok(mainActivityKt.includes('BuildConfig.TRADING_MODE == "paper" && !BuildConfig.LIVE_TRADING_ENABLED'));
    assert.ok(mainActivityKt.includes('handler?.cancel()'));
  });

  test('200. Market-Data Integration Audit: Dashboard Quote & Candle Routes, Render Health ok=true vs DATA_UNAVAILABLE, Missing Angel One Credentials, and RSS Non-Price Separation', async () => {
    const marketIntelligenceService = require('../server/market-intelligence-service');
    const ChartEngine = require('../web/modules/chart-engine');
    const savedEnv = {
      MARKET_DATA_PROVIDER: process.env.MARKET_DATA_PROVIDER,
      ANGEL_API_KEY: process.env.ANGEL_API_KEY,
      ANGEL_CLIENT_ID: process.env.ANGEL_CLIENT_ID,
      ANGEL_PIN: process.env.ANGEL_PIN,
      ANGEL_TOTP_SECRET: process.env.ANGEL_TOTP_SECRET,
      INDIAN_MARKET_RSS_URL: process.env.INDIAN_MARKET_RSS_URL,
      TRADING_MODE: process.env.TRADING_MODE,
      LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED
    };

    try {
      // Simulate default Render environment without Angel One broker credentials configured
      delete process.env.MARKET_DATA_PROVIDER;
      delete process.env.ANGEL_API_KEY;
      delete process.env.ANGEL_CLIENT_ID;
      delete process.env.ANGEL_PIN;
      delete process.env.ANGEL_TOTP_SECRET;
      process.env.TRADING_MODE = 'paper';
      process.env.LIVE_TRADING_ENABLED = 'false';

      angelSession.clearSession();
      apiServer.resetApiRateLimitsForTest();

      // 1. Verify config.validateMarketDataConfig reports ready=false and exact missing credentials
      const defaultCfg = serverConfig.getConfig(process.env);
      assert.equal(defaultCfg.provider, 'UNCONFIGURED');
      assert.equal(defaultCfg.trading.mode, 'paper');
      assert.equal(defaultCfg.trading.liveEnabled, false);

      const unconfiguredCheck = serverConfig.validateMarketDataConfig(defaultCfg);
      assert.equal(unconfiguredCheck.ready, false);
      assert.equal(unconfiguredCheck.reason, 'Angel One is not selected as the provider.');

      const angelSelectedCfg = serverConfig.getConfig({
        ...process.env,
        MARKET_DATA_PROVIDER: 'ANGEL_ONE'
      });
      const missingCredsCheck = serverConfig.validateMarketDataConfig(angelSelectedCfg);
      assert.equal(missingCredsCheck.ready, false);
      assert.deepEqual(missingCredsCheck.missing, [
        'ANGEL_API_KEY',
        'ANGEL_CLIENT_ID',
        'ANGEL_PIN',
        'ANGEL_TOTP_SECRET'
      ]);

      server = apiServer.createServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

      // 2. Verify GET /api/health returns HTTP 200 with ok=true (SQLite connected) while credentialsConfigured=false and session.authenticated=false
      const healthRes = await requestServer(server, '/api/health');
      assert.equal(healthRes.status, 200);
      assert.equal(healthRes.json.ok, true);
      assert.equal(healthRes.json.tradingMode, 'paper');
      assert.equal(healthRes.json.liveTradingEnabled, false);
      assert.equal(healthRes.json.credentialsConfigured, false);
      assert.equal(healthRes.json.session.authenticated, false);
      assert.equal(healthRes.json.session.status, 'DISCONNECTED');

      // 3. Trace exact Dashboard quote & candle routes (/api/market/quote and /api/market/candles) when Angel One session is not authenticated
      const quoteRes = await requestServer(server, '/api/market/quote?exchange=NSE&q=NIFTY%2050');
      assert.equal(quoteRes.status, 400);
      assert.equal(quoteRes.json.ok, false);
      assert.equal(quoteRes.json.code, 'ANGEL_SESSION_NOT_READY');

      const candleRes = await requestServer(
        server,
        '/api/market/candles?exchange=NSE&q=NIFTY%2050&interval=FIVE_MINUTE'
      );
      assert.equal(candleRes.status, 400);
      assert.equal(candleRes.json.ok, false);
      assert.equal(candleRes.json.code, 'ANGEL_SESSION_NOT_READY');

      // 4. Verify Dashboard / Chart / MarketData / Scanner states show DATA_UNAVAILABLE & DATA_WAITING with zero fabricated prices or candles
      const validation = RealMarketDataService.validateQuote(
        quoteRes.json?.quote,
        'NIFTY50',
        'ANGEL_ONE'
      );
      assert.equal(validation.ok, false);
      assert.equal(validation.code, 'INVALID_MARKET_DATA');
      assert.equal(validation.dataReady, false);
      assert.equal(validation.quote, null);

      const snapshot = MarketData.snapshotFromValidatedQuote(
        { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
        validation,
        []
      );
      assert.equal(snapshot.dataReady, false);
      assert.equal(snapshot.price, null);
      assert.equal(snapshot.candles.length, 0);
      assert.equal(snapshot.indicators.dataQuality, 'DATA_UNAVAILABLE');

      const dashVm = DashboardEngine.buildDashboardViewModel({
        snapshot,
        instrument: { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' }
      });
      assert.equal(dashVm.sections.marketStatus.code, 'INVALID_MARKET_DATA');
      assert.equal(dashVm.sections.priceAndChange.available, false);
      assert.equal(dashVm.sections.priceAndChange.priceFormatted, '--');
      assert.equal(dashVm.sections.technicalIndicators.dataQuality, 'DATA_UNAVAILABLE');
      assert.equal(dashVm.sections.signalBadge.action, 'NO_TRADE');
      assert.equal(dashVm.sections.confidence.validated, false);

      const chartVm = ChartEngine.buildChartViewModel({
        interval: 'FIVE_MINUTE',
        snapshot,
        instrument: { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
        candles: []
      });
      assert.equal(chartVm.status, 'DATA_UNAVAILABLE');
      assert.equal(chartVm.totalCandles, 0);

      // 5. Verify RSS headlines (EXCHANGE_RSS) never populate quote prices or candles
      const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel>
          <item>
            <title>NIFTY 50 trades steady in morning session</title>
            <link>https://www.nseindia.com/news/nifty-steady</link>
            <pubDate>${new Date().toUTCString()}</pubDate>
          </item>
        </channel></rss>`;
      const parsedRss = marketIntelligenceService.parseSimpleRssItems(rssXml, 'NSE RSS', 'INDIAN_MARKET');
      assert.equal(parsedRss.length, 1);
      assert.equal(parsedRss[0].price, undefined);
      assert.equal(parsedRss[0].candles, undefined);
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      angelSession.clearSession();
    }
  });

  test('201. Task 202 — Twelve Data Read-Only Adapter: Config, Valid Quote & OHLC Candles, Stale/Invalid/Plan-Restricted Rejection, NFO/BFO Option Rejection, Rate Limiting, Caching, and API Key Redaction', async () => {
    const twelveDataAdapter = require('../server/twelve-data-market-data');
    const TwelveDataProvider = require('../web/modules/market-data/providers/twelve-data');

    const savedEnv = {
      MARKET_DATA_PROVIDER: process.env.MARKET_DATA_PROVIDER,
      TWELVE_DATA_API_KEY: process.env.TWELVE_DATA_API_KEY,
      ANGEL_API_KEY: process.env.ANGEL_API_KEY,
      TRADING_MODE: process.env.TRADING_MODE,
      LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED
    };

    try {
      twelveDataAdapter.resetStateForTest();
      apiServer.resetApiRateLimitsForTest();

      // 1. Verify config validation when MARKET_DATA_PROVIDER=TWELVE_DATA without and with TWELVE_DATA_API_KEY
      delete process.env.TWELVE_DATA_API_KEY;
      process.env.MARKET_DATA_PROVIDER = 'TWELVE_DATA';
      process.env.TRADING_MODE = 'paper';
      process.env.LIVE_TRADING_ENABLED = 'false';

      const missingKeyCfg = serverConfig.getConfig(process.env);
      const missingKeyCheck = serverConfig.validateMarketDataConfig(missingKeyCfg);
      assert.equal(missingKeyCheck.ready, false);
      assert.deepEqual(missingKeyCheck.missing, ['TWELVE_DATA_API_KEY']);
      assert.equal(missingKeyCfg.trading.mode, 'paper');
      assert.equal(missingKeyCfg.trading.liveEnabled, false);

      const secretKey = 'td_live_secret_key_99887766';
      process.env.TWELVE_DATA_API_KEY = secretKey;
      const readyCfg = serverConfig.getConfig(process.env);
      const readyCheck = serverConfig.validateMarketDataConfig(readyCfg);
      assert.equal(readyCheck.ready, true);
      assert.equal(readyCheck.provider, 'TWELVE_DATA');
      assert.deepEqual(readyCheck.missing, []);

      // Verify getSafePublicConfig and AuditLogger never expose TWELVE_DATA_API_KEY
      const safePub = serverConfig.getSafePublicConfig(readyCfg);
      assert.equal(safePub.provider, 'TWELVE_DATA');
      assert.equal(safePub.credentialsConfigured, true);
      assert.equal(safePub.twelveDataConfigured, true);
      assert.equal(JSON.stringify(safePub).includes(secretKey), false);

      const redactedAudit = AuditLogger.redactSensitive({
        twelve_data_api_key: secretKey,
        symbol: 'RELIANCE'
      });
      assert.equal(redactedAudit.twelve_data_api_key, '[REDACTED]');

      // 2. Verify browser provider registry registers TWELVE_DATA without storing browser secrets
      assert.ok(MarketDataProviders.list().includes('TWELVE_DATA'));
      assert.ok(MarketDataProviders.list().includes('ANGEL_ONE'));
      const browserProvider = MarketDataProviders.get('TWELVE_DATA');
      assert.equal(browserProvider.name, 'TWELVE_DATA');
      const browserCfg = browserProvider.configure({ apiKey: secretKey, exchangeDefault: 'NSE' });
      assert.equal(browserCfg.mode, 'SERVER_PROXY_ONLY');
      assert.equal(JSON.stringify(browserProvider).includes(secretKey), false);

      // 3. Verify explicit rejection of NFO/BFO derivative exchanges and option/futures contracts
      await assert.rejects(
        () => twelveDataAdapter.searchScrip('NFO', 'NIFTY24OCT25000CE'),
        (err) => err.code === 'TWELVE_DATA_UNSUPPORTED_INSTRUMENT'
      );
      await assert.rejects(
        () =>
          twelveDataAdapter.getQuote({
            exchange: 'NFO',
            tradingsymbol: 'NIFTY24OCT25000CE',
            symboltoken: '9911',
            optionType: 'CE',
            strikePrice: 25000,
            expiry: '24OCT2024'
          }),
        (err) => err.code === 'TWELVE_DATA_UNSUPPORTED_INSTRUMENT'
      );
      await assert.rejects(
        () => TwelveDataProvider.searchInstrument('BFO', 'SENSEX24OCT80000PE'),
        (err) => err.code === 'TWELVE_DATA_UNSUPPORTED_INSTRUMENT'
      );

      // 4. Verify valid quote & candle normalization, original exchange timestamp preservation, and bounded caching
      const fixedNowMs = Date.parse('2026-10-10T09:50:15.000Z'); // 15:20:15 IST
      let httpCallCount = 0;

      twelveDataAdapter.setHttpFetcherForTest(async (urlStr, init) => {
        httpCallCount += 1;
        assert.equal(init.headers.Authorization, `apikey ${secretKey}`);
        const parsedUrl = new URL(urlStr);

        if (parsedUrl.pathname === '/quote') {
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                symbol: 'RELIANCE',
                name: 'Reliance Industries Ltd',
                exchange: 'NSE',
                mic_code: 'XNSE',
                currency: 'INR',
                datetime: '2026-10-10 15:20:05',
                timestamp: Math.floor(Date.parse('2026-10-10T15:20:05+05:30') / 1000),
                exchange_timezone: 'Asia/Kolkata',
                open: '2940.00',
                high: '2965.50',
                low: '2932.10',
                close: '2958.25',
                volume: '4125000',
                previous_close: '2935.00',
                is_market_open: true
              };
            }
          };
        }

        if (parsedUrl.pathname === '/time_series') {
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                meta: {
                  symbol: 'RELIANCE',
                  interval: '5min',
                  currency: 'INR',
                  exchange_timezone: 'Asia/Kolkata',
                  exchange: 'NSE'
                },
                values: [
                  {
                    datetime: '2026-10-10 15:20:00',
                    open: '2950.00',
                    high: '2965.50',
                    low: '2948.00',
                    close: '2958.25',
                    volume: '150000'
                  },
                  // Malformed candle with high < low must be filtered out automatically
                  {
                    datetime: '2026-10-10 15:15:00',
                    open: '2950.00',
                    high: '2910.00',
                    low: '2945.00',
                    close: '2948.00',
                    volume: '100000'
                  },
                  {
                    datetime: '2026-10-10 15:10:00',
                    open: '2942.00',
                    high: '2952.00',
                    low: '2940.00',
                    close: '2950.00',
                    volume: '120000'
                  }
                ],
                status: 'ok'
              };
            }
          };
        }

        throw new Error(`Unexpected endpoint: ${parsedUrl.pathname}`);
      });

      const quoteRes1 = await marketDataPipeline.getQuoteBySearch(
        'NSE',
        'RELIANCE',
        'RELIANCE-EQ',
        { nowMs: fixedNowMs }
      );
      assert.equal(quoteRes1.ok, true);
      assert.equal(quoteRes1.provider, 'TWELVE_DATA');
      assert.equal(quoteRes1.quote.price, 2958.25);
      assert.equal(quoteRes1.quote.open, 2940);
      assert.equal(quoteRes1.quote.high, 2965.5);
      assert.equal(quoteRes1.quote.low, 2932.1);
      assert.equal(quoteRes1.quote.previousClose, 2935);
      assert.equal(quoteRes1.quote.timestamp, new Date(Date.parse('2026-10-10T15:20:05+05:30')).toISOString());
      assert.equal(httpCallCount, 1);

      // Second call within TTL hits bounded cache without consuming extra API quota
      const quoteRes2 = await marketDataPipeline.getQuoteBySearch(
        'NSE',
        'RELIANCE',
        'RELIANCE-EQ',
        { nowMs: fixedNowMs + 2000 }
      );
      assert.equal(quoteRes2.quote.price, 2958.25);
      assert.equal(httpCallCount, 1);

      // Historical candles via pipeline
      const candleRes = await marketDataPipeline.getCandlesBySearch(
        'NSE',
        'RELIANCE',
        'RELIANCE-EQ',
        { interval: 'FIVE_MINUTE', nowMs: fixedNowMs }
      );
      assert.equal(candleRes.ok, true);
      assert.equal(candleRes.provider, 'TWELVE_DATA');
      assert.equal(candleRes.interval, 'FIVE_MINUTE');
      // Malformed candle was rejected; remaining 2 sorted chronologically ascending
      assert.equal(candleRes.candles.length, 2);
      assert.equal(
        candleRes.candles[0].timestamp,
        new Date(Date.parse('2026-10-10T15:10:00+05:30')).toISOString()
      );
      assert.equal(
        candleRes.candles[1].timestamp,
        new Date(Date.parse('2026-10-10T15:20:00+05:30')).toISOString()
      );

      // 5. Verify stale quote rejection (>60s old) preserves original timestamp and rejects with STALE_MARKET_DATA
      twelveDataAdapter.resetStateForTest();
      process.env.TWELVE_DATA_API_KEY = secretKey;
      twelveDataAdapter.setHttpFetcherForTest(async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            symbol: 'NIFTY_50',
            exchange: 'NSE',
            datetime: '2026-10-10 15:00:00',
            exchange_timezone: 'Asia/Kolkata',
            open: '25000',
            high: '25100',
            low: '24950',
            close: '25050'
          };
        }
      }));

      await assert.rejects(
        () =>
          marketDataPipeline.getQuoteBySearch('NSE', 'NIFTY 50', undefined, {
            nowMs: Date.parse('2026-10-10T15:15:00+05:30')
          }),
        (err) => err.code === 'STALE_MARKET_DATA'
      );

      // 6. Verify invalid price / OHLC inconsistency rejection
      assert.throws(
        () =>
          twelveDataAdapter.mapTwelveDataQuoteResponse(
            {
              symbol: 'INFY',
              exchange: 'NSE',
              datetime: '2026-10-10 15:20:00',
              open: '1850',
              high: '1840', // Invalid: high < open & close
              low: '1830',
              close: '1855'
            },
            { exchange: 'NSE', tradingsymbol: 'INFY-EQ', symboltoken: 'TD:NSE:INFY' }
          ),
        (err) => err.code === 'TWELVE_DATA_INVALID_OHLC'
      );

      assert.throws(
        () =>
          twelveDataAdapter.mapTwelveDataQuoteResponse(
            {
              symbol: 'INFY',
              exchange: 'NSE',
              datetime: '2026-10-10 15:20:00',
              close: '0'
            },
            { exchange: 'NSE', tradingsymbol: 'INFY-EQ', symboltoken: 'TD:NSE:INFY' }
          ),
        (err) => err.code === 'TWELVE_DATA_INVALID_PRICE'
      );

      // 7. Verify Twelve Data Free/Basic plan tier restriction (code 403) & API server redaction
      twelveDataAdapter.resetStateForTest();
      process.env.TWELVE_DATA_API_KEY = secretKey;
      twelveDataAdapter.setHttpFetcherForTest(async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            code: 403,
            message: `This symbol is exclusively available on Grow and Pro plans. Key=${secretKey}`,
            status: 'error'
          };
        }
      }));

      server = apiServer.createServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

      const planRestrictedRes = await requestServer(
        server,
        '/api/market/quote?exchange=NSE&q=NIFTY%2050'
      );
      assert.equal(planRestrictedRes.status, 400);
      assert.equal(planRestrictedRes.json.ok, false);
      assert.equal(planRestrictedRes.json.code, 'TWELVE_DATA_PLAN_RESTRICTED');
      assert.equal(JSON.stringify(planRestrictedRes.json).includes(secretKey), false);
      assert.ok(planRestrictedRes.json.message.includes('[REDACTED]'));

      // 8. Verify rate-limit enforcement (8 requests/minute default)
      twelveDataAdapter.resetStateForTest();
      const quotaNow = Date.now();
      for (let i = 0; i < 8; i += 1) {
        twelveDataAdapter.checkAndRecordQuota(quotaNow + i * 100);
      }
      assert.throws(
        () => twelveDataAdapter.checkAndRecordQuota(quotaNow + 1000),
        (err) => err.code === 'TWELVE_DATA_RATE_LIMITED' && err.retryAfterSeconds > 0
      );
    } finally {
      twelveDataAdapter.resetStateForTest();
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test('202. Task 203 — End-to-End Integration Audit: Provider Routing (/api/instruments/search, /api/market/quote, /api/market/candles), Browser RealMarketDataService Contract, Dashboard Plan-Restriction Banner, and Stale Quote Signal Blocking', async () => {
    const twelveDataAdapter = require('../server/twelve-data-market-data');

    const savedEnv = {
      MARKET_DATA_PROVIDER: process.env.MARKET_DATA_PROVIDER,
      TWELVE_DATA_API_KEY: process.env.TWELVE_DATA_API_KEY,
      ANGEL_API_KEY: process.env.ANGEL_API_KEY,
      TRADING_MODE: process.env.TRADING_MODE,
      LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED
    };

    try {
      twelveDataAdapter.resetStateForTest();
      apiServer.resetApiRateLimitsForTest();

      const testKey = 'td_integration_audit_key_445566';
      process.env.MARKET_DATA_PROVIDER = 'TWELVE_DATA';
      process.env.TWELVE_DATA_API_KEY = testKey;
      process.env.TRADING_MODE = 'paper';
      process.env.LIVE_TRADING_ENABLED = 'false';

      const freshIso = new Date(Date.now() - 5000).toISOString();
      const freshEpochSec = Math.floor((Date.now() - 5000) / 1000);

      twelveDataAdapter.setHttpFetcherForTest(async (urlStr) => {
        const u = new URL(urlStr);
        if (u.pathname === '/symbol_search') {
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                data: [
                  {
                    symbol: 'LT',
                    instrument_name: 'Larsen & Toubro Ltd',
                    exchange: 'NSE',
                    mic_code: 'XNSE',
                    instrument_type: 'Common Stock'
                  }
                ],
                status: 'ok'
              };
            }
          };
        }
        if (u.pathname === '/quote') {
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                symbol: u.searchParams.get('symbol') || 'NIFTY_50',
                exchange: u.searchParams.get('exchange') || 'NSE',
                datetime: freshIso,
                timestamp: freshEpochSec,
                exchange_timezone: 'Asia/Kolkata',
                open: '25010.00',
                high: '25120.00',
                low: '24980.00',
                close: '25085.50',
                previous_close: '24995.00',
                volume: '1850000'
              };
            }
          };
        }
        if (u.pathname === '/time_series') {
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                meta: {
                  symbol: u.searchParams.get('symbol') || 'NIFTY_50',
                  interval: u.searchParams.get('interval') || '5min',
                  exchange_timezone: 'Asia/Kolkata',
                  exchange: u.searchParams.get('exchange') || 'NSE'
                },
                values: [
                  {
                    datetime: '2026-10-10 15:15:00',
                    open: '25050.00',
                    high: '25120.00',
                    low: '25040.00',
                    close: '25085.50',
                    volume: '450000'
                  },
                  {
                    datetime: '2026-10-10 15:10:00',
                    open: '25010.00',
                    high: '25060.00',
                    low: '25000.00',
                    close: '25050.00',
                    volume: '390000'
                  }
                ],
                status: 'ok'
              };
            }
          };
        }
        throw new Error(`Unexpected path: ${u.pathname}`);
      });

      server = apiServer.createServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

      // 1. End-to-end HTTP verification of /api/instruments/search, /api/market/quote, /api/market/candles
      const searchHttp = await requestServer(server, '/api/instruments/search?exchange=NSE&q=LT');
      assert.equal(searchHttp.status, 200);
      assert.equal(searchHttp.json.ok, true);
      assert.equal(searchHttp.json.provider, 'TWELVE_DATA');
      assert.equal(searchHttp.json.results[0].tradingsymbol, 'LT-EQ');
      assert.equal(searchHttp.json.results[0].symboltoken, 'TD:NSE:LT');

      const quoteHttp = await requestServer(server, '/api/market/quote?exchange=NSE&q=NIFTY%2050');
      assert.equal(quoteHttp.status, 200);
      assert.equal(quoteHttp.json.ok, true);
      assert.equal(quoteHttp.json.provider, 'TWELVE_DATA');
      assert.equal(quoteHttp.json.quote.price, 25085.5);
      assert.equal(quoteHttp.json.quote.dataReady, true);

      const candleHttp = await requestServer(
        server,
        '/api/market/candles?exchange=NSE&q=NIFTY%2050&interval=5m'
      );
      assert.equal(candleHttp.status, 200);
      assert.equal(candleHttp.json.ok, true);
      assert.equal(candleHttp.json.provider, 'TWELVE_DATA');
      assert.equal(candleHttp.json.interval, 'FIVE_MINUTE');
      assert.equal(candleHttp.json.candles.length, 2);

      // 2. Verify unsupported NFO/BFO derivative requests over HTTP return explicit error 400 (never empty success)
      const nfoSearchHttp = await requestServer(
        server,
        '/api/instruments/search?exchange=NFO&q=NIFTY24OCT25000CE'
      );
      assert.equal(nfoSearchHttp.status, 400);
      assert.equal(nfoSearchHttp.json.ok, false);
      assert.equal(nfoSearchHttp.json.code, 'TWELVE_DATA_UNSUPPORTED_INSTRUMENT');

      const bfoQuoteHttp = await requestServer(
        server,
        '/api/market/quote?exchange=BFO&q=SENSEX24OCT80000PE'
      );
      assert.equal(bfoQuoteHttp.status, 400);
      assert.equal(bfoQuoteHttp.json.ok, false);
      assert.equal(bfoQuoteHttp.json.code, 'TWELVE_DATA_UNSUPPORTED_INSTRUMENT');

      const badIntervalHttp = await requestServer(
        server,
        '/api/market/candles?exchange=NSE&q=NIFTY%2050&interval=THREE_MINUTE'
      );
      assert.equal(badIntervalHttp.status, 400);
      assert.equal(badIntervalHttp.json.ok, false);
      assert.equal(badIntervalHttp.json.code, 'TWELVE_DATA_UNSUPPORTED_INTERVAL');

      // 3. Verify Browser RealMarketDataService end-to-end with TWELVE_DATA provider
      RealMarketDataService.setProvider('TWELVE_DATA');
      const mockApiClient = {
        async health() {
          return (await requestServer(server, '/api/health')).json;
        },
        async quote(ex, q, sym) {
          return (
            await requestServer(
              server,
              `/api/market/quote?exchange=${encodeURIComponent(ex)}&q=${encodeURIComponent(q)}${sym ? '&symbol=' + encodeURIComponent(sym) : ''}`
            )
          ).json;
        },
        async candles(ex, q, sym, opts = {}) {
          return (
            await requestServer(
              server,
              `/api/market/candles?exchange=${encodeURIComponent(ex)}&q=${encodeURIComponent(q)}&interval=${encodeURIComponent(opts.interval || 'FIVE_MINUTE')}`
            )
          ).json;
        }
      };

      const connectStatus = await RealMarketDataService.connect(mockApiClient);
      assert.equal(connectStatus.connected, true);
      assert.equal(RealMarketDataService.getStatus().provider, 'TWELVE_DATA');

      const browserQuote = await RealMarketDataService.getQuote(
        { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE' },
        mockApiClient
      );
      assert.equal(browserQuote.ok, true);
      assert.equal(browserQuote.provider, 'TWELVE_DATA');
      assert.equal(browserQuote.dataReady, true);
      assert.equal(browserQuote.quote.price, 25085.5);

      const browserCandles = await RealMarketDataService.getCandles(
        { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE' },
        { interval: 'FIVE_MINUTE' },
        mockApiClient
      );
      assert.equal(browserCandles.ok, true);
      assert.equal(browserCandles.provider, 'TWELVE_DATA');
      assert.equal(browserCandles.candles.length, 2);

      // 4. Verify DashboardViewModel produces clear plan-restriction error state (never an empty success state)
      const restrictedSnap = MarketData.emptySnapshot({
        key: 'NIFTY50',
        name: 'NIFTY 50',
        exchange: 'NSE',
        type: 'INDEX'
      });
      restrictedSnap.status = 'TWELVE_DATA_PLAN_RESTRICTED';
      restrictedSnap.errorMessage =
        'TWELVE_DATA_PLAN_RESTRICTED: Twelve Data plan restriction for requested Indian exchange/symbol';

      const dashPlanRestrictedVm = DashboardEngine.buildDashboardViewModel({
        snapshot: restrictedSnap,
        instrument: { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' }
      });
      assert.equal(dashPlanRestrictedVm.meta.apiError, restrictedSnap.errorMessage);
      assert.equal(dashPlanRestrictedVm.sections.marketStatus.code, 'API_ERROR');
      assert.equal(dashPlanRestrictedVm.sections.priceAndChange.available, false);
      assert.equal(dashPlanRestrictedVm.sections.priceAndChange.priceFormatted, '--');
      assert.equal(dashPlanRestrictedVm.sections.signalBadge.action, 'NO_TRADE');
      assert.equal(dashPlanRestrictedVm.sections.confidence.validated, false);

      // Also verify DashboardEngine.normalizeMarketStatus directly for TWELVE_DATA_PLAN_RESTRICTED when apiError is not set
      const directStatus = DashboardEngine.normalizeMarketStatus(
        'TWELVE_DATA_PLAN_RESTRICTED',
        false,
        false,
        null
      );
      assert.equal(directStatus.code, 'TWELVE_DATA_PLAN_RESTRICTED');
      assert.equal(directStatus.label, 'PROVIDER PLAN RESTRICTED');
      assert.equal(directStatus.isLive, false);

      // 5. Verify delayed/stale quote remains strictly ineligible for signals and paper trade execution
      const staleValidation = RealMarketDataService.validateQuote(
        {
          price: 25085.5,
          timestamp: new Date(Date.now() - 180000).toISOString(),
          dataReady: true
        },
        'NIFTY50',
        'TWELVE_DATA'
      );
      assert.equal(staleValidation.ok, false);
      assert.equal(staleValidation.code, 'STALE_MARKET_DATA');
      assert.equal(staleValidation.dataReady, false);

      const staleSnap = MarketData.snapshotFromValidatedQuote(
        { key: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
        staleValidation,
        []
      );
      const staleStrategy = StrategyEngine.evaluate({
        dataReady: staleSnap.dataReady,
        snapshot: staleSnap,
        price: staleSnap.price
      });
      assert.equal(staleStrategy.action, 'NO_TRADE');
      assert.equal(staleStrategy.executable, false);

      const staleRisk = RiskEngine.evaluate({
        side: 'BUY',
        entry: 25085.5,
        stop: 25000,
        quantity: 1,
        staleData: true,
        dataReady: false
      });
      assert.equal(staleRisk.allowed, false);
    } finally {
      RealMarketDataService.setProvider('UNCONFIGURED');
      twelveDataAdapter.resetStateForTest();
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test('203. Final Mobile UI Implementation: YASHWIN AI Auto-Trading Robot Command Center, 5-Tab Bottom Navigation & User Guidance', () => {
    const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../web/style.css'), 'utf8');
    const appJs = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');

    // 1. Verify Robot Mobile Command Center shell & telemetry elements
    const requiredRobotIds = [
      'robotMobileCommandCenter',
      'robotStateBadge',
      'robotModePill',
      'robotActiveSymbol',
      'robotActivePrice',
      'robotAiDecisionLabel',
      'robotAiConfidenceLabel',
      'robotDailyPnlValue',
      'robotTradesCounterLabel',
      'robotSafetyStatusLabel',
      'robotToggleAutoBtn',
      'robotScanNowBtn',
      'robotEmergencyStopBtn',
      'robotLevelEntry',
      'robotLevelStop',
      'robotLevelTarget',
      'robotLevelRR',
      'robotGateVerdictBadge'
    ];
    for (const id of requiredRobotIds) {
      assert.ok(
        html.includes(`id="${id}"`),
        `web/index.html must include Robot Mobile Command Center element id="${id}"`
      );
    }

    // 2. Verify 5 primary mobile bottom navigation tabs (Robot, Markets, AI Brain, Trades, Safety)
    assert.ok(html.includes('class="mobile-nav-item primary-tab active" data-page="dashboard">🤖<span>Robot</span>'));
    assert.ok(html.includes('class="mobile-nav-item primary-tab" data-page="scanner">◈<span>Markets</span>'));
    assert.ok(html.includes('class="mobile-nav-item primary-tab" data-page="analysis">✦<span>AI Brain</span>'));
    assert.ok(html.includes('class="mobile-nav-item primary-tab" data-page="paper">▣<span>Trades</span>'));
    assert.ok(html.includes('class="mobile-nav-item primary-tab" data-page="risk">🛡<span>Safety</span>'));

    // 3. Verify User Guidance card & CSS layout rules
    assert.ok(html.includes('Complete User Guidance &amp; Safety Rules'));
    assert.ok(css.includes('.robot-mobile-shell'));
    assert.ok(css.includes('.robot-command-card'));
    assert.ok(css.includes('grid-template-columns: repeat(5, minmax(0, 1fr))'));
    assert.ok(appJs.includes('robotToggleAutoBtn'));
    assert.ok(appJs.includes('robotScanNowBtn'));
    assert.ok(appJs.includes('robotEmergencyStopBtn'));
  });

  test('204. Final End-to-End Production-Readiness Audit: All 12 Screens, Mobile Overflow & Back Navigation, Real News -> AI -> Strategy -> Risk -> Auto Paper Trade Execution, and Safety Rejection', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../web/style.css'), 'utf8');
    const appJs = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
    const mainActivityKt = fs.readFileSync(
      path.join(__dirname, '../android/app/src/main/java/com/yashwin/aitrading/MainActivity.kt'),
      'utf8'
    );
    const marketIntelligenceService = require('../server/market-intelligence-service');

    // 1. Verify all 12 screens exist as .page-section with matching data-section and navigation links
    const expectedScreens = [
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
    for (const screen of expectedScreens) {
      assert.ok(
        html.includes(`data-section="${screen}"`),
        `web/index.html must include page-section data-section="${screen}"`
      );
      assert.ok(
        html.includes(`data-page="${screen}"`),
        `web/index.html must include navigation trigger data-page="${screen}"`
      );
    }

    // 2. Verify mobile horizontal overflow guards & SPA/Android back-navigation contract
    assert.ok(css.includes('overflow-x: hidden'));
    assert.ok(css.includes('.table-scroll-wrap'));
    assert.ok(appJs.includes('currentPage: "dashboard"'));
    assert.ok(appJs.includes('window.state = state'));
    assert.ok(appJs.includes('window.switchPage = switchPage'));
    assert.ok(appJs.includes('window.history.pushState'));
    assert.ok(appJs.includes('window.addEventListener("popstate"'));
    assert.ok(mainActivityKt.includes('window.state.activePage || window.state.currentPage'));

    // 3. Verify Market Intelligence real RSS news parsing -> source, timestamp, summary, and directional assessment without fake confidence
    const nowMs = Date.now();
    const recentPub = new Date(nowMs - 15 * 60 * 1000).toUTCString();
    const rssFeedXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0"><channel>
        <item>
          <title><![CDATA[NIFTY 50 surges to record high on strong institutional buying and rally]]></title>
          <link>https://www.nseindia.com/news/nifty-record-rally</link>
          <pubDate>${recentPub}</pubDate>
          <description><![CDATA[Broad-based bullish breakout across banking and IT heavyweights lifts benchmark index.]]></description>
        </item>
      </channel></rss>`;

    const parsedRss = marketIntelligenceService.parseSimpleRssItems(
      rssFeedXml,
      'NSE Official RSS',
      'INDIAN_MARKET'
    );
    assert.equal(parsedRss.length, 1);

    const validatedNews = marketIntelligenceService.validateAndNormalizeNewsItem(parsedRss[0], {
      nowMs,
      symbol: 'NIFTY 50'
    });
    assert.equal(validatedNews.valid, true);
    assert.equal(validatedNews.source, 'NSE Official RSS');
    assert.ok(validatedNews.publicationTimestamp);
    assert.ok(validatedNews.summary.includes('Broad-based bullish breakout'));
    assert.equal(validatedNews.sentiment, null, 'Unscored RSS items must not invent sentiment');
    assert.equal(validatedNews.confidence, undefined, 'News items must never fabricate trading confidence scores');

    const providerScoredNews = marketIntelligenceService.validateAndNormalizeNewsItem(
      {
        ...parsedRss[0],
        sentiment: 'BULLISH',
        sentimentScore: 68
      },
      { nowMs, symbol: 'NIFTY 50' }
    );
    assert.equal(providerScoredNews.sentiment, 'BULLISH');
    assert.equal(providerScoredNews.sentimentScore, 68);

    const backedSentiment = marketIntelligenceService.deriveBackedSentiment(
      null,
      [providerScoredNews],
      nowMs
    );
    assert.equal(backedSentiment.available, true);
    assert.equal(backedSentiment.label, 'BULLISH');
    assert.equal(backedSentiment.score, 68);

    const intelVm = MarketIntelligence.buildIntelligenceViewModel({
      available: true,
      status: 'AVAILABLE',
      provider: 'EXCHANGE_RSS',
      retrievalTimestamp: new Date(nowMs).toISOString(),
      symbol: 'NIFTY 50',
      market: 'NSE',
      indianMarketNews: [providerScoredNews],
      globalMarketNews: [],
      companyNews: [providerScoredNews],
      economicEvents: [],
      globalIndices: [],
      sentiment: backedSentiment
    });
    assert.equal(intelVm.available, true);
    assert.equal(intelVm.sentiment.label, 'BULLISH');
    assert.equal(intelVm.indianMarketNews[0].source, 'NSE Official RSS');
    assert.equal(intelVm.indianMarketNews[0].headline, providerScoredNews.headline);

    // 4. Trace complete automation flow: Validated Market Data + News Context -> MarketAnalysis -> AIDecisionContract -> StrategyEngine -> RiskEngine -> AISafetyGate -> PaperTrading -> SQLite Persistence
    PaperTrading.resetState();
    RiskEngine.resetLimits();
    RiskEngine.setEmergencyStop(false);
    AuditLogger.resetEmergencyStop('Test 204 setup');

    const autoUserId = 'USR-AUDIT-204';
    PaperTrading.setCurrentUser(autoUserId);
    PaperTrading.setAutoPaperEnabled(true);

    const quoteCheck = RealMarketDataService.validateQuote(
      {
        instrument: 'RELIANCE-EQ',
        exchange: 'NSE',
        price: 2500,
        open: 2475,
        high: 2510,
        low: 2470,
        previousClose: 2465,
        volume: 1250000,
        timestamp: new Date(nowMs - 3000).toISOString(),
        dataReady: true
      },
      'RELIANCE',
      'TWELVE_DATA',
      nowMs
    );
    assert.equal(quoteCheck.ok, true);

    const candles = [];
    for (let i = 0; i < 30; i += 1) {
      const b = 2440 + i * 2;
      candles.push({
        timestamp: new Date(nowMs - (30 - i) * 300000).toISOString(),
        open: b - 1,
        high: b + 4,
        low: b - 2,
        close: b + 2,
        volume: 50000 + i * 1000
      });
    }

    const snapshot = MarketData.snapshotFromValidatedQuote(
      { key: 'RELIANCE', name: 'RELIANCE', exchange: 'NSE', type: 'EQUITY' },
      quoteCheck,
      candles
    );
    assert.equal(snapshot.dataReady, true);

    const aiContract = AIDecisionContract.validate({
      signal: 'BUY',
      confidence: 86,
      risk: 'LOW',
      trend: 'BULLISH',
      reasoning: 'Bullish breakout supported by volume and positive Indian market news context.',
      stopLossSuggestion: 2487.5,
      targetSuggestion: 2525
    });
    assert.equal(aiContract.ok, true);

    const autoExec = PaperTrading.autoEvaluateAndExecute({
      symbol: 'RELIANCE',
      exchange: 'NSE',
      assetType: 'EQUITY',
      dataReady: true,
      price: 2500,
      quantity: 10, // Risk = |2500 - 2487.5| * 10 = ₹125 <= ₹500 maxLossPerTrade
      snapshot,
      analysis: {
        dataReady: true,
        signal: 'BUY',
        action: 'BUY',
        confidence: 85,
        risk: 'LOW',
        trend: 'BULLISH',
        reasons: ['Validated bullish momentum and VWAP alignment.']
      },
      aiDecision: aiContract.decision,
      exitOnTarget: true
    });

    assert.equal(autoExec.ok, true);
    assert.equal(autoExec.executed, true);
    assert.equal(autoExec.action, 'BUY');
    assert.equal(autoExec.position.symbol, 'RELIANCE');
    assert.equal(autoExec.position.entry, 2500);
    assert.equal(autoExec.position.stop, 2487.5);
    assert.equal(autoExec.position.target, 2525);
    assert.equal(autoExec.position.effectiveQty, 10);

    // Verify open position & entry order/fill persisted in SQLite for this user
    const dbOpenPos = serverDb.getOpenPosition(autoUserId);
    assert.ok(dbOpenPos);
    assert.equal(dbOpenPos.symbol, 'RELIANCE');
    assert.equal(dbOpenPos.entry, 2500);

    // Simulate price reaching target (2525) -> automatic target exit and trade history persistence
    const autoTargetExit = PaperTrading.autoEvaluateAndExecute({
      symbol: 'RELIANCE',
      exchange: 'NSE',
      assetType: 'EQUITY',
      dataReady: true,
      price: 2525,
      snapshot,
      exitOnTarget: true
    });
    assert.equal(autoTargetExit.ok, true);
    assert.equal(autoTargetExit.executed, true);
    assert.equal(autoTargetExit.action, 'TARGET_EXIT');
    assert.equal(autoTargetExit.positionUpdate.pnl, 250);

    const dbHistory = serverDb.listTradeHistory(10, autoUserId);
    assert.equal(dbHistory.length, 1);
    assert.equal(dbHistory[0].symbol, 'RELIANCE');
    assert.equal(dbHistory[0].pnl, 250);
    assert.equal(dbHistory[0].reason, 'TARGET_EXIT');

    const dbOrders = serverDb.listPaperOrders(10, autoUserId);
    assert.equal(dbOrders.length, 2); // ENTRY + EXIT orders

    const dbFills = serverDb.listPaperFills(10, autoUserId);
    assert.equal(dbFills.length, 2); // ENTRY + EXIT fills

    // 5. Verify automatic paper trading rejects invalid, stale, or insufficient data and Emergency Stop
    const rejectMissingData = PaperTrading.autoEvaluateAndExecute({
      symbol: 'RELIANCE',
      dataReady: false,
      price: null
    });
    assert.equal(rejectMissingData.ok, false);
    assert.equal(rejectMissingData.executed, false);
    assert.equal(rejectMissingData.action, 'NO_TRADE');

    const rejectRiskLimit = PaperTrading.autoEvaluateAndExecute({
      symbol: 'RELIANCE',
      exchange: 'NSE',
      assetType: 'EQUITY',
      dataReady: true,
      price: 2500,
      quantity: 100, // Risk = 12.5 * 100 = ₹1,250 > ₹500 maxLossPerTrade -> BLOCKED
      snapshot,
      analysis: {
        dataReady: true,
        signal: 'BUY',
        action: 'BUY',
        confidence: 85,
        risk: 'LOW',
        trend: 'BULLISH'
      },
      aiDecision: aiContract.decision
    });
    assert.equal(rejectRiskLimit.ok, false);
    assert.equal(rejectRiskLimit.executed, false);
    assert.equal(rejectRiskLimit.code, 'RISK_REJECTED');

    RiskEngine.setEmergencyStop(true);
    const rejectEmergency = PaperTrading.autoEvaluateAndExecute({
      symbol: 'RELIANCE',
      dataReady: true,
      price: 2500,
      snapshot
    });
    assert.equal(rejectEmergency.ok, false);
    assert.equal(rejectEmergency.executed, false);
    assert.equal(rejectEmergency.action, 'EMERGENCY_STOP');
    RiskEngine.setEmergencyStop(false);
    PaperTrading.setCurrentUser(null);
  });

  test('205. Priority 1-5 Regression Suite: Indian RSS IST Timestamps, Stale/Future News Filtering, Conservative News Classification, Angel One Missing Env Diagnostics, and Disconnected/Stale Market Data NO_TRADE Blocking', async () => {
    const marketIntelligenceService = require('../server/market-intelligence-service');
    const marketDataPipeline = require('../server/market-data-pipeline');

    // =========================================================================
    // Priority 1: Indian RSS Timestamps (IST conversion, explicit UTC, offsets, future dates)
    // =========================================================================
    const refUtcIso = '2026-10-11T10:00:00.000Z'; // 15:30:00 IST on 2026-10-11
    const refNowMs = Date.parse(refUtcIso);

    // 1a. Timezone-less YYYY-MM-DD HH:mm:ss from Indian RSS source -> parsed as IST (+05:30)
    const istIso1 = marketIntelligenceService.normalizeTimestamp('2026-10-11 15:15:00', {
      source: 'NSE Official RSS',
      category: 'INDIAN_MARKET'
    });
    assert.equal(istIso1.valid, true);
    assert.equal(istIso1.iso, '2026-10-11T09:45:00.000Z');

    // 1b. Timezone-less DD Mon YYYY HH:mm:ss from Indian RSS source -> parsed as IST (+05:30)
    const istIso2 = marketIntelligenceService.normalizeTimestamp('11 Oct 2026 15:00:00', {
      source: 'Economic Times Markets RSS',
      category: 'INDIAN_MARKET'
    });
    assert.equal(istIso2.valid, true);
    assert.equal(istIso2.iso, '2026-10-11T09:30:00.000Z');

    // 1c. Timezone-less DD-MM-YYYY HH:mm:ss from Indian RSS source -> parsed as IST (+05:30)
    const istIso3 = marketIntelligenceService.normalizeTimestamp('11-10-2026 14:30:00', {
      source: 'Moneycontrol Markets RSS',
      category: 'INDIAN_MARKET'
    });
    assert.equal(istIso3.valid, true);
    assert.equal(istIso3.iso, '2026-10-11T09:00:00.000Z');

    // 1d. Non-Indian source with timezone-less timestamp is NOT treated as IST
    const nonIndianSource = marketIntelligenceService.isKnownIndianLocalTimeFeed({
      source: 'Some Global Wire',
      category: 'GLOBAL_MARKET'
    });
    assert.equal(nonIndianSource, false);
    assert.equal(
      marketIntelligenceService.isKnownIndianLocalTimeFeed({
        source: 'NSE Corporate Filings RSS',
        category: 'COMPANY_NEWS'
      }),
      true
    );

    // 1e. Explicit UTC ('Z' / 'GMT') and explicit numeric offsets (+05:30, -04:00) are preserved
    const explicitUtcZ = marketIntelligenceService.normalizeTimestamp('2026-10-11T09:20:00Z', {
      source: 'NSE Official RSS',
      category: 'INDIAN_MARKET'
    });
    assert.equal(explicitUtcZ.iso, '2026-10-11T09:20:00.000Z');

    const explicitGmt = marketIntelligenceService.normalizeTimestamp(
      'Sun, 11 Oct 2026 09:10:00 GMT',
      {
        source: 'NSE Official RSS',
        category: 'INDIAN_MARKET'
      }
    );
    assert.equal(explicitGmt.iso, '2026-10-11T09:10:00.000Z');

    const explicitIstAbbr = marketIntelligenceService.normalizeTimestamp(
      'Sun, 11 Oct 2026 14:40:00 IST',
      {
        source: 'BSE Announcements RSS',
        category: 'INDIAN_MARKET'
      }
    );
    assert.equal(explicitIstAbbr.iso, '2026-10-11T09:10:00.000Z');

    const explicitOffset = marketIntelligenceService.normalizeTimestamp(
      '2026-10-11T05:10:00-04:00',
      {
        source: 'Alpha Vantage News',
        category: 'GLOBAL_MARKET'
      }
    );
    assert.equal(explicitOffset.iso, '2026-10-11T09:10:00.000Z');

    // 1f. Genuine future timestamps remain marked INVALID_FUTURE_TIMESTAMP
    const futureItem = marketIntelligenceService.validateAndNormalizeNewsItem(
      {
        headline: 'Future dated exchange announcement test',
        source: 'NSE Official RSS',
        publicationTimestamp: '2026-10-11 18:00:00', // 18:00 IST = 12:30 UTC (2.5h ahead of refNowMs 10:00 UTC)
        category: 'INDIAN_MARKET',
        url: 'https://www.nseindia.com/future-test'
      },
      { nowMs: refNowMs, staleThresholdMs: 6 * 3600 * 1000 }
    );
    assert.equal(futureItem.valid, true);
    assert.equal(futureItem.isStale, true);
    assert.equal(futureItem.freshness, 'INVALID_FUTURE_TIMESTAMP');

    // =========================================================================
    // Priority 2 & 3: Filter Invalid/Stale News + Conservative Classification & Factual Summary
    // =========================================================================
    const freshFilingRaw = {
      headline: 'RELIANCE: Outcome of Board Meeting under Regulation 30 of SEBI LODR',
      summary: 'Board approved unaudited financial results for the quarter ended September.',
      source: 'NSE Corporate Filings RSS',
      publicationTimestamp: '2026-10-11 15:10:00', // 09:40 UTC (20m old -> FRESH)
      retrievalTimestamp: refUtcIso,
      category: 'COMPANY_NEWS',
      symbol: 'RELIANCE',
      url: 'https://www.nseindia.com/filing-reg30'
    };

    const freshMacroRaw = {
      headline: 'RBI Monetary Policy Committee keeps repo rate unchanged at 6.5%',
      summary: 'Central bank maintains stance focused on inflation alignment and GDP growth.',
      source: 'Economic Times Markets RSS',
      publicationTimestamp: '2026-10-11 14:45:00', // 09:15 UTC (45m old -> FRESH)
      retrievalTimestamp: refUtcIso,
      category: 'INDIAN_MARKET',
      url: 'https://economictimes.indiatimes.com/rbi-mpc'
    };

    const staleCompanyRaw = {
      headline: 'RELIANCE signs new retail distribution agreement in western region',
      summary: '',
      source: 'Moneycontrol Markets RSS',
      publicationTimestamp: '2026-10-09 12:00:00', // 2 days old -> STALE, scored BULLISH by provider
      retrievalTimestamp: refUtcIso,
      category: 'COMPANY_NEWS',
      symbol: 'RELIANCE',
      sentiment: 'BULLISH',
      sentimentScore: 80,
      url: 'https://www.moneycontrol.com/stale-reliance'
    };

    const futureScoredRaw = {
      headline: 'Future spoofed bullish headline that must not influence sentiment',
      summary: 'Spoofed future item',
      source: 'NSE Official RSS',
      publicationTimestamp: '2026-10-11 19:30:00', // 14:00 UTC -> INVALID_FUTURE_TIMESTAMP
      retrievalTimestamp: refUtcIso,
      category: 'INDIAN_MARKET',
      sentiment: 'BULLISH',
      sentimentScore: 95,
      url: 'https://www.nseindia.com/spoof-future'
    };

    const normFiling = marketIntelligenceService.validateAndNormalizeNewsItem(freshFilingRaw, {
      nowMs: refNowMs,
      defaultSymbol: 'RELIANCE'
    });
    assert.equal(normFiling.isStale, false);
    assert.equal(normFiling.freshness, 'FRESH');
    assert.equal(normFiling.classification, 'EXCHANGE_FILING');
    assert.equal(normFiling.sentiment, null, 'Unscored filing must not invent bullish/bearish sentiment');
    assert.equal(normFiling.url, 'https://www.nseindia.com/filing-reg30');
    assert.equal(normFiling.publicationTimestamp, '2026-10-11T09:40:00.000Z');
    assert.equal(normFiling.retrievalTimestamp, refUtcIso);

    const normMacro = marketIntelligenceService.validateAndNormalizeNewsItem(freshMacroRaw, {
      nowMs: refNowMs,
      defaultSymbol: 'RELIANCE'
    });
    assert.equal(normMacro.isStale, false);
    assert.equal(normMacro.freshness, 'FRESH');
    assert.equal(normMacro.classification, 'MACRO_NEWS');
    assert.equal(normMacro.sentiment, null);

    const normStale = marketIntelligenceService.validateAndNormalizeNewsItem(staleCompanyRaw, {
      nowMs: refNowMs,
      defaultSymbol: 'RELIANCE'
    });
    assert.equal(normStale.isStale, true);
    assert.equal(normStale.freshness, 'STALE');
    assert.equal(normStale.classification, 'COMPANY_NEWS');
    assert.ok(normStale.factualSummary.includes('Company news headline reported by Moneycontrol Markets RSS'));

    const normFuture = marketIntelligenceService.validateAndNormalizeNewsItem(futureScoredRaw, {
      nowMs: refNowMs,
      defaultSymbol: 'RELIANCE'
    });
    assert.equal(normFuture.isStale, true);
    assert.equal(normFuture.freshness, 'INVALID_FUTURE_TIMESTAMP');

    // Verify deriveBackedSentiment ignores STALE and INVALID_FUTURE_TIMESTAMP items even if they carry scores
    const sentimentCheck = marketIntelligenceService.deriveBackedSentiment(
      null,
      [normFiling, normMacro, normStale, normFuture],
      refNowMs
    );
    assert.equal(sentimentCheck.available, false);
    assert.equal(sentimentCheck.label, 'UNAVAILABLE');
    assert.equal(sentimentCheck.score, null);

    // Verify client MarketIntelligence.normalize & buildIntelligenceViewModel filter stale/future items
    const clientNorm = MarketIntelligence.normalize(
      {
        available: true,
        status: 'AVAILABLE',
        provider: 'EXCHANGE_RSS',
        retrievalTimestamp: refUtcIso,
        symbol: 'RELIANCE',
        market: 'NSE',
        indianMarketNews: [normMacro, normFuture],
        companyNews: [normFiling, normStale],
        diagnostics: {
          duplicatesRemoved: 0,
          malformedRejected: 1
        }
      },
      { nowMs: refNowMs, symbol: 'RELIANCE' }
    );

    assert.equal(clientNorm.available, true);
    assert.equal(clientNorm.indianMarketNews.length, 1, 'Active Indian news must contain only fresh valid items');
    assert.equal(clientNorm.companyNews.length, 1, 'Active company news must contain only fresh valid items');
    assert.equal(clientNorm.headlines.length, 2, 'Main headlines array must exclude stale and future items');
    assert.equal(
      clientNorm.headlines.some((h) => h.includes('Future spoofed') || h.includes('signs new retail')),
      false
    );
    assert.equal(clientNorm.staleNews.length, 2, 'Stale and future items must be preserved in staleNews');
    assert.equal(clientNorm.diagnostics.freshCount, 2);
    assert.equal(clientNorm.diagnostics.staleCount, 2);
    assert.equal(clientNorm.diagnostics.invalidFutureCount, 1);
    assert.equal(clientNorm.sentiment, 'UNAVAILABLE');
    assert.equal(clientNorm.sentimentScore, null);

    const vm = MarketIntelligence.buildIntelligenceViewModel(clientNorm, {
      nowMs: refNowMs,
      symbol: 'RELIANCE'
    });
    assert.equal(vm.counts.totalNews, 2);
    assert.equal(vm.counts.staleNews, 2);
    assert.equal(vm.counts.invalidFutureNews, 1);
    assert.equal(vm.staleNews.length, 2);

    // Verify AIAnalysisEngine.buildAIAnalysisPayload excludes stale/future headlines from marketIntelligenceContext
    const validSnapForAi = {
      name: 'RELIANCE',
      exchange: 'NSE',
      type: 'EQUITY',
      dataReady: true,
      price: 2500,
      changePct: 1.2,
      volume: 500000,
      indicators: { vwap: 2490, rsi14: 60 }
    };
    const aiPayloadRes = AIAnalysisEngine.buildAIAnalysisPayload(
      validSnapForAi,
      { name: 'RELIANCE', exchange: 'NSE', type: 'EQUITY' },
      { signal: 'BUY', confidence: 82, risk: 'LOW', trend: 'BULLISH', reasons: ['Momentum'] },
      {
        marketIntelligence: {
          available: true,
          status: 'AVAILABLE',
          provider: 'EXCHANGE_RSS',
          sentiment: { available: false, label: 'UNAVAILABLE', score: null },
          headlines: [normFiling, normMacro, normStale, normFuture]
        }
      }
    );
    assert.equal(aiPayloadRes.ok, true);
    assert.equal(aiPayloadRes.payload.marketIntelligenceContext.headlines.length, 2);
    assert.equal(
      aiPayloadRes.payload.marketIntelligenceContext.headlines.some((h) => {
        const text = typeof h === 'string' ? h : h.headline || h.title || '';
        return text.includes('Future spoofed') || text.includes('signs new retail');
      }),
      false
    );

    // =========================================================================
    // Priority 4: Market Data Provider Diagnostics & NO_TRADE Blocking
    // =========================================================================
    const savedEnv = {
      MARKET_DATA_PROVIDER: process.env.MARKET_DATA_PROVIDER,
      ANGEL_API_KEY: process.env.ANGEL_API_KEY,
      ANGEL_CLIENT_ID: process.env.ANGEL_CLIENT_ID,
      ANGEL_PIN: process.env.ANGEL_PIN,
      ANGEL_TOTP_SECRET: process.env.ANGEL_TOTP_SECRET,
      TRADING_MODE: process.env.TRADING_MODE,
      LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED
    };

    try {
      process.env.MARKET_DATA_PROVIDER = 'ANGEL_ONE';
      delete process.env.ANGEL_API_KEY;
      delete process.env.ANGEL_CLIENT_ID;
      delete process.env.ANGEL_PIN;
      delete process.env.ANGEL_TOTP_SECRET;
      process.env.TRADING_MODE = 'paper';
      process.env.LIVE_TRADING_ENABLED = 'false';
      angelSession.clearSession();
      runtime.setMockSmartAPI(null);

      // 4a. Verify validateMarketDataProviderReadiness returns exact missing variable NAMES for ANGEL_ONE
      const readiness = marketDataPipeline.validateMarketDataProviderReadiness();
      assert.equal(readiness.ready, false);
      assert.equal(readiness.provider, 'ANGEL_ONE');
      assert.equal(readiness.credentialsConfigured, false);
      assert.deepEqual(readiness.missingEnvVars, [
        'ANGEL_API_KEY',
        'ANGEL_CLIENT_ID',
        'ANGEL_PIN',
        'ANGEL_TOTP_SECRET'
      ]);
      assert.equal(readiness.code, 'ANGEL_CREDENTIALS_MISSING');

      // 4b. Verify /api/health and /api/market/quote report structured missingEnvVars without exposing secrets
      server = apiServer.createServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

      const healthRes = await requestServer(server, '/api/health');
      assert.equal(healthRes.status, 200);
      assert.equal(healthRes.json.provider, 'ANGEL_ONE');
      assert.equal(healthRes.json.credentialsConfigured, false);
      assert.equal(healthRes.json.session.status, 'DISCONNECTED');
      assert.deepEqual(healthRes.json.missingEnvVars, [
        'ANGEL_API_KEY',
        'ANGEL_CLIENT_ID',
        'ANGEL_PIN',
        'ANGEL_TOTP_SECRET'
      ]);
      assert.equal(healthRes.json.liveTradingEnabled, false);

      const quoteDisconnectedRes = await requestServer(
        server,
        '/api/market/quote?exchange=NSE&q=RELIANCE'
      );
      assert.equal(quoteDisconnectedRes.status, 400);
      assert.equal(quoteDisconnectedRes.json.ok, false);
      assert.equal(quoteDisconnectedRes.json.code, 'ANGEL_CREDENTIALS_MISSING');
      assert.deepEqual(quoteDisconnectedRes.json.missingEnvVars, [
        'ANGEL_API_KEY',
        'ANGEL_CLIENT_ID',
        'ANGEL_PIN',
        'ANGEL_TOTP_SECRET'
      ]);

      // 4c. Verify AI analysis returns NO_TRADE / rejects when market data is disconnected, stale, or invalid
      const aiDisconnectedPayload = AIAnalysisEngine.buildAIAnalysisPayload({
        name: 'RELIANCE',
        exchange: 'NSE',
        dataReady: true,
        status: 'DISCONNECTED',
        price: 2500
      });
      assert.equal(aiDisconnectedPayload.ok, false);
      assert.equal(aiDisconnectedPayload.code, 'MARKET_DATA_NOT_READY');

      const aiDisconnectedVm = AIAnalysisEngine.buildAIAnalysisViewModel({
        snapshot: {
          name: 'RELIANCE',
          exchange: 'NSE',
          dataReady: false,
          status: 'DISCONNECTED',
          price: null
        }
      });
      assert.equal(aiDisconnectedVm.decision.displayDecision, 'NO_TRADE');
      assert.equal(aiDisconnectedVm.paperExecution.canStageToPaper, false);

      const aiStalePayload = AIAnalysisEngine.buildAIAnalysisPayload({
        name: 'RELIANCE',
        exchange: 'NSE',
        dataReady: true,
        staleData: true,
        status: 'STALE_MARKET_DATA',
        price: 2500
      });
      assert.equal(aiStalePayload.ok, false);
      assert.equal(aiStalePayload.code, 'MARKET_DATA_NOT_READY');

      const aiStaleHttp = await requestServer(server, '/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataReady: true,
          staleData: true,
          status: 'STALE_MARKET_DATA',
          symbol: 'RELIANCE',
          price: 2500
        })
      });
      assert.equal(aiStaleHttp.status, 400);
      assert.equal(aiStaleHttp.json.ok, false);
      assert.equal(aiStaleHttp.json.code, 'MARKET_DATA_NOT_READY');

      // 4d. Verify PaperTrading.autoEvaluateAndExecute returns NO_TRADE and creates no position/order/fill
      //     when market data is disconnected, stale, invalid, or required evidence is unavailable
      const testUserId = 'USR-BLOCK-AUDIT-205';
      PaperTrading.setCurrentUser(testUserId);
      PaperTrading.resetState();
      PaperTrading.setAutoPaperEnabled(true);
      RiskEngine.resetLimits();
      RiskEngine.setEmergencyStop(false);

      const ordersBefore = serverDb.listPaperOrders(50, testUserId).length;
      const fillsBefore = serverDb.listPaperFills(50, testUserId).length;

      // Case 1: Disconnected status even if dataReady=true and price is passed
      const blockedDisconnected = PaperTrading.autoEvaluateAndExecute({
        symbol: 'RELIANCE',
        exchange: 'NSE',
        assetType: 'EQUITY',
        dataReady: true,
        status: 'DISCONNECTED',
        price: 2500,
        snapshot: {
          name: 'RELIANCE',
          exchange: 'NSE',
          dataReady: true,
          status: 'DISCONNECTED',
          price: 2500
        }
      });
      assert.equal(blockedDisconnected.ok, false);
      assert.equal(blockedDisconnected.executed, false);
      assert.equal(blockedDisconnected.action, 'NO_TRADE');
      assert.equal(blockedDisconnected.code, 'MARKET_DATA_DISCONNECTED');

      // Case 2: Stale market data even if dataReady=true and price is passed
      const blockedStale = PaperTrading.autoEvaluateAndExecute({
        symbol: 'RELIANCE',
        exchange: 'NSE',
        assetType: 'EQUITY',
        dataReady: true,
        staleData: true,
        price: 2500,
        snapshot: {
          name: 'RELIANCE',
          exchange: 'NSE',
          dataReady: true,
          staleData: true,
          price: 2500
        }
      });
      assert.equal(blockedStale.ok, false);
      assert.equal(blockedStale.executed, false);
      assert.equal(blockedStale.action, 'NO_TRADE');
      assert.equal(blockedStale.code, 'STALE_MARKET_DATA');

      // Case 3: Insufficient evidence (empty snapshot without indicators, analysis, or AI decision)
      const blockedInsufficientEvidence = PaperTrading.autoEvaluateAndExecute({
        symbol: 'RELIANCE',
        exchange: 'NSE',
        assetType: 'EQUITY',
        dataReady: true,
        price: 2500,
        snapshot: {
          name: 'RELIANCE',
          exchange: 'NSE',
          dataReady: true,
          status: 'LIVE_DATA',
          price: 2500,
          indicators: { dataQuality: 'DATA_UNAVAILABLE' }
        }
      });
      assert.equal(blockedInsufficientEvidence.ok, false);
      assert.equal(blockedInsufficientEvidence.executed, false);
      assert.equal(blockedInsufficientEvidence.action, 'NO_TRADE');
      assert.equal(blockedInsufficientEvidence.code, 'INSUFFICIENT_EVIDENCE');

      assert.equal(PaperTrading.getState().position, null);
      assert.equal(serverDb.getOpenPosition(testUserId), null);
      assert.equal(serverDb.listPaperOrders(50, testUserId).length, ordersBefore);
      assert.equal(serverDb.listPaperFills(50, testUserId).length, fillsBefore);
    } finally {
      PaperTrading.setCurrentUser(null);
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
