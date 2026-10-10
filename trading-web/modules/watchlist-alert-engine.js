/*
 * YASHWIN AI Trading Assistant
 * Task 14 — Complete Watchlist & Market Alerts Engine
 *
 * Pure deterministic, zero-fabrication engine for:
 * - Watchlist item normalization, validation (NSE, BSE, NFO, BFO + Option CE/PE, strike, expiry),
 *   and quote enrichment (Price, Change, % Change, Freshness, Stale/Unavailable states).
 * - Market Alert validation & creation across all 8 required alert types:
 *   1. PRICE_ABOVE
 *   2. PRICE_BELOW
 *   3. PERCENT_CHANGE_UP
 *   4. PERCENT_CHANGE_DOWN
 *   5. SUPPORT_BREAKDOWN
 *   6. RESISTANCE_BREAKOUT
 *   7. RSI_OVERBOUGHT_OVERSOLD
 *   8. STRATEGY_SIGNAL_CHANGE
 * - Trigger modes: ONCE, COOLDOWN
 * - Alert lifecycle states: ACTIVE, TRIGGERED, COOLDOWN, PAUSED, DISABLED, EXPIRED, INVALID_DATA_BLOCKED
 * - Strict zero-fabrication evaluation:
 *   * Never evaluates on missing, non-positive, NaN, future, or stale market quotes.
 *   * Never fabricates RSI, support/resistance, or strategy signals when candles/indicators are insufficient.
 *   * Never places live or paper orders automatically when an alert triggers.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const RiskEngine = require('./risk-engine');
    const StrategyEngine = require('./strategy-engine');
    const MarketData = require('./market-data');
    module.exports = factory(RiskEngine, StrategyEngine, MarketData);
  } else {
    root.WatchlistAlertEngine = factory(
      root.RiskEngine,
      root.StrategyEngine,
      root.MarketData
    );
  }
})(typeof self !== 'undefined' ? self : this, function (
  RiskEngine,
  StrategyEngine,
  MarketData
) {
  'use strict';

  const ENGINE_VERSION = '1.0.0-DETERMINISTIC-TASK14';

  const SUPPORTED_EXCHANGES = ['NSE', 'BSE', 'NFO', 'BFO'];
  const SUPPORTED_INSTRUMENT_TYPES = ['INDEX', 'EQUITY', 'FUTURES', 'OPTION'];

  const SUPPORTED_ALERT_TYPES = [
    'PRICE_ABOVE',
    'PRICE_BELOW',
    'PERCENT_CHANGE_UP',
    'PERCENT_CHANGE_DOWN',
    'SUPPORT_BREAKDOWN',
    'RESISTANCE_BREAKOUT',
    'RSI_OVERBOUGHT_OVERSOLD',
    'STRATEGY_SIGNAL_CHANGE'
  ];

  const SUPPORTED_TRIGGER_MODES = ['ONCE', 'COOLDOWN'];

  const ALERT_LIFECYCLE_STATES = [
    'ACTIVE',
    'TRIGGERED',
    'COOLDOWN',
    'PAUSED',
    'DISABLED',
    'EXPIRED',
    'INVALID_DATA_BLOCKED'
  ];

  const DEFAULT_MAX_QUOTE_AGE_MS = 5 * 60 * 1000; // 5 minutes max freshness window for alerts
  const MAX_FUTURE_DRIFT_MS = 10 * 1000; // 10s clock skew tolerance
  const DEFAULT_COOLDOWN_MINUTES = 15;

  const MONTH_MAP = {
    JAN: 0,
    FEB: 1,
    MAR: 2,
    APR: 3,
    MAY: 4,
    JUN: 5,
    JUL: 6,
    AUG: 7,
    SEP: 8,
    OCT: 9,
    NOV: 10,
    DEC: 11
  };

  const DOCUMENTED_WATCHLIST_ALERT_RULES = {
    version: ENGINE_VERSION,
    tradingMode: 'PAPER',
    liveTradingEnabled: false,
    autoOrderExecutionOnAlert: false,
    supportedExchanges: SUPPORTED_EXCHANGES,
    supportedInstrumentTypes: SUPPORTED_INSTRUMENT_TYPES,
    supportedAlertTypes: SUPPORTED_ALERT_TYPES,
    supportedTriggerModes: SUPPORTED_TRIGGER_MODES,
    lifecycleStates: ALERT_LIFECYCLE_STATES,
    governance: [
      'Alerts are strictly informational notifications and workspace staging helpers.',
      'Triggering an alert NEVER places a live order or bypasses StrategyEngine, AISafetyGate, RiskEngine, or Emergency Stop.',
      'Alerts NEVER evaluate or trigger on missing, zero, negative, NaN, future-dated, or stale market quotes.',
      'Indicator-based alerts (SUPPORT_BREAKDOWN, RESISTANCE_BREAKOUT, RSI_OVERBOUGHT_OVERSOLD, STRATEGY_SIGNAL_CHANGE) require validated candle/indicator data and block cleanly with INVALID_DATA_BLOCKED when insufficient.'
    ]
  };

  function round2(n) {
    const num = Number(n);
    return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
  }

  function parseExpiryDate(rawExpiry) {
    const str = String(rawExpiry || '').trim();
    if (!str) return null;

    const directMs = Date.parse(str);
    if (Number.isFinite(directMs)) {
      return new Date(directMs).toISOString();
    }

    const m = str.toUpperCase().match(/^(\d{1,2})[\s\-]?([A-Z]{3})[\s\-]?(\d{2,4})$/);
    if (m) {
      const day = Number(m[1]);
      const month = MONTH_MAP[m[2]];
      let year = Number(m[3]);
      if (year < 100) year += 2000;

      if (month !== undefined && day >= 1 && day <= 31) {
        const dt = new Date(Date.UTC(year, month, day, 15, 30, 0));
        if (!Number.isNaN(dt.getTime())) {
          return dt.toISOString();
        }
      }
    }

    return null;
  }

  function inferInstrumentType(item = {}) {
    const explicit = String(item.instrumentType || item.type || '').trim().toUpperCase();
    if (SUPPORTED_INSTRUMENT_TYPES.includes(explicit)) {
      return explicit;
    }

    const exchange = String(item.exchange || '').trim().toUpperCase();
    const symbol = String(item.tradingsymbol || item.symbolKey || item.key || item.symbol || item.name || '')
      .trim()
      .toUpperCase();
    const optType = String(item.optionType || '').trim().toUpperCase();

    if (['NFO', 'BFO'].includes(exchange)) {
      if (optType === 'CE' || optType === 'PE' || symbol.endsWith('CE') || symbol.endsWith('PE')) {
        return 'OPTION';
      }
      if (symbol.endsWith('FUT') || optType === 'FUT' || optType === 'FF') {
        return 'FUTURES';
      }
      return 'OPTION';
    }

    if (/^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY|BANKEX)/.test(symbol) && !symbol.endsWith('-EQ')) {
      return 'INDEX';
    }

    return 'EQUITY';
  }

  function validateAndNormalizeWatchlistInstrument(input = {}) {
    if (!input || typeof input !== 'object') {
      const err = new Error('Watchlist instrument payload must be an object.');
      err.code = 'INVALID_WATCHLIST_ITEM';
      throw err;
    }

    const exchange = String(input.exchange || 'NSE').trim().toUpperCase();
    if (!SUPPORTED_EXCHANGES.includes(exchange)) {
      const err = new Error(
        `Unsupported exchange '${exchange}'. Supported exchanges: ${SUPPORTED_EXCHANGES.join(', ')}.`
      );
      err.code = 'INVALID_WATCHLIST_EXCHANGE';
      throw err;
    }

    const rawSymbolKey = String(
      input.key || input.symbolKey || input.tradingsymbol || input.symbol || input.name || ''
    )
      .trim()
      .toUpperCase();

    if (!rawSymbolKey) {
      const err = new Error('Instrument symbol or key is required for watchlist.');
      err.code = 'INVALID_WATCHLIST_ITEM';
      throw err;
    }

    const instrumentType = inferInstrumentType({ ...input, exchange, key: rawSymbolKey });
    const optionType = input.optionType ? String(input.optionType).trim().toUpperCase() : null;
    const strikePrice =
      input.strikePrice !== null &&
      input.strikePrice !== undefined &&
      input.strikePrice !== '' &&
      Number.isFinite(Number(input.strikePrice))
        ? Number(input.strikePrice)
        : null;
    const expiry = input.expiry ? String(input.expiry).trim() : null;
    const lotSize =
      input.lotSize !== null &&
      input.lotSize !== undefined &&
      input.lotSize !== '' &&
      Number.isFinite(Number(input.lotSize))
        ? Math.max(1, Math.trunc(Number(input.lotSize)))
        : null;

    const hasOptionFields = Boolean(optionType) || strikePrice !== null;

    if (instrumentType === 'OPTION' || hasOptionFields) {
      const reasons = [];
      if (!['NFO', 'BFO'].includes(exchange)) {
        reasons.push('Option contract must belong to NFO or BFO exchange.');
      }
      if (optionType !== 'CE' && optionType !== 'PE') {
        reasons.push('Option type must be CE or PE.');
      }
      if (strikePrice === null || strikePrice <= 0) {
        reasons.push('Option strike price must be a positive number.');
      }
      if (!expiry) {
        reasons.push('Option expiry date is required.');
      } else if (!parseExpiryDate(expiry)) {
        reasons.push('Option expiry is not a valid date.');
      }

      if (reasons.length > 0) {
        const err = new Error(`Invalid option contract for watchlist: ${reasons.join(' ')}`);
        err.code = 'INVALID_OPTION_CONTRACT';
        err.reasons = reasons;
        throw err;
      }
    } else if (instrumentType === 'FUTURES') {
      const reasons = [];
      if (!['NFO', 'BFO'].includes(exchange)) {
        reasons.push('Futures contract must belong to NFO or BFO exchange.');
      }
      if (!expiry) {
        reasons.push('Futures expiry date is required.');
      } else if (!parseExpiryDate(expiry)) {
        reasons.push('Futures expiry is not a valid date.');
      }
      if (reasons.length > 0) {
        const err = new Error(`Invalid futures contract for watchlist: ${reasons.join(' ')}`);
        err.code = 'INVALID_FUTURES_CONTRACT';
        err.reasons = reasons;
        throw err;
      }
    }

    const tradingsymbol = input.tradingsymbol
      ? String(input.tradingsymbol).trim().toUpperCase()
      : rawSymbolKey;
    const name = String(input.name || tradingsymbol || rawSymbolKey).trim();
    const companyName = input.companyName
      ? String(input.companyName).trim()
      : name;
    const symboltoken =
      input.symboltoken && String(input.symboltoken).trim() !== ''
        ? String(input.symboltoken).trim()
        : null;

    return {
      key: rawSymbolKey,
      symbolKey: rawSymbolKey,
      tradingsymbol,
      name,
      companyName,
      exchange,
      type: instrumentType,
      instrumentType,
      symboltoken,
      optionType: instrumentType === 'OPTION' ? optionType : null,
      strikePrice: instrumentType === 'OPTION' ? strikePrice : null,
      expiry: instrumentType === 'OPTION' || instrumentType === 'FUTURES' ? expiry : null,
      lotSize
    };
  }

  function enrichWatchlistItemWithQuote(item = {}, snapshotOrQuote = null, options = {}) {
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const maxQuoteAgeMs = Number.isFinite(Number(options.maxQuoteAgeMs))
      ? Number(options.maxQuoteAgeMs)
      : DEFAULT_MAX_QUOTE_AGE_MS;

    const rawSnap = snapshotOrQuote?.snapshot || snapshotOrQuote?.quote || snapshotOrQuote || null;
    const rawPrice =
      rawSnap && rawSnap.price !== null && rawSnap.price !== undefined
        ? Number(rawSnap.price)
        : snapshotOrQuote?.price !== null && snapshotOrQuote?.price !== undefined
          ? Number(snapshotOrQuote.price)
          : NaN;

    const quoteTimestamp =
      rawSnap?.timestamp ||
      rawSnap?.quoteTimestamp ||
      snapshotOrQuote?.quoteTimestamp ||
      snapshotOrQuote?.timestamp ||
      null;

    const tsMs = quoteTimestamp ? Date.parse(quoteTimestamp) : NaN;
    const ageMs = Number.isFinite(tsMs) ? nowMs - tsMs : null;
    const isFuture = ageMs !== null && ageMs < -MAX_FUTURE_DRIFT_MS;
    const isStale =
      Boolean(rawSnap?.stale) ||
      snapshotOrQuote?.status === 'STALE_MARKET_DATA' ||
      (ageMs !== null && ageMs > maxQuoteAgeMs);

    const hasValidPrice = Number.isFinite(rawPrice) && rawPrice > 0 && !isFuture;
    const prevClose =
      rawSnap?.previousClose !== null &&
      rawSnap?.previousClose !== undefined &&
      Number.isFinite(Number(rawSnap.previousClose)) &&
      Number(rawSnap.previousClose) > 0
        ? Number(rawSnap.previousClose)
        : rawSnap?.open !== null &&
            rawSnap?.open !== undefined &&
            Number.isFinite(Number(rawSnap.open)) &&
            Number(rawSnap.open) > 0
          ? Number(rawSnap.open)
          : null;

    const changeAbs =
      hasValidPrice && prevClose !== null ? round2(rawPrice - prevClose) : null;
    const changePct =
      hasValidPrice && prevClose !== null && prevClose > 0
        ? round2(((rawPrice - prevClose) / prevClose) * 100)
        : null;

    let quoteStatus = 'DATA_UNAVAILABLE';
    let freshnessLabel = 'WAITING FOR QUOTE';

    if (isFuture) {
      quoteStatus = 'INVALID_FUTURE_TIMESTAMP';
      freshnessLabel = 'INVALID TIMESTAMP';
    } else if (hasValidPrice && isStale) {
      quoteStatus = 'STALE_MARKET_DATA';
      freshnessLabel = 'STALE QUOTE';
    } else if (hasValidPrice) {
      quoteStatus = 'LIVE_VALIDATED';
      freshnessLabel = 'FRESH QUOTE';
    }

    return {
      ...item,
      price: hasValidPrice ? round2(rawPrice) : null,
      previousClose: prevClose !== null ? round2(prevClose) : null,
      changeAbs,
      changePct,
      quoteTimestamp: hasValidPrice ? quoteTimestamp : null,
      quoteAgeMs: ageMs !== null && ageMs >= 0 ? Math.round(ageMs) : null,
      quoteStatus,
      freshnessLabel,
      dataReady: Boolean(hasValidPrice && !isStale),
      isStale: Boolean(hasValidPrice && isStale)
    };
  }

  function validateAlertDefinition(input = {}, options = {}) {
    if (!input || typeof input !== 'object') {
      const err = new Error('Alert configuration payload is required.');
      err.code = 'INVALID_ALERT_PAYLOAD';
      throw err;
    }

    const inst = validateAndNormalizeWatchlistInstrument({
      key: input.symbolKey || input.symbol || input.key || input.tradingsymbol || input.name,
      tradingsymbol: input.tradingsymbol || input.symbol,
      name: input.name || input.symbol || input.tradingsymbol,
      exchange: input.exchange || 'NSE',
      instrumentType: input.instrumentType || input.type,
      symboltoken: input.symboltoken,
      optionType: input.optionType,
      strikePrice: input.strikePrice,
      expiry: input.expiry,
      lotSize: input.lotSize
    });

    const alertType = String(input.alertType || input.type || '').trim().toUpperCase();
    if (!SUPPORTED_ALERT_TYPES.includes(alertType)) {
      const err = new Error(
        `Unsupported alertType '${alertType}'. Supported types: ${SUPPORTED_ALERT_TYPES.join(', ')}.`
      );
      err.code = 'INVALID_ALERT_TYPE';
      throw err;
    }

    const triggerMode = String(input.triggerMode || 'ONCE').trim().toUpperCase();
    if (!SUPPORTED_TRIGGER_MODES.includes(triggerMode)) {
      const err = new Error(
        `Unsupported triggerMode '${triggerMode}'. Supported modes: ${SUPPORTED_TRIGGER_MODES.join(', ')}.`
      );
      err.code = 'INVALID_TRIGGER_MODE';
      throw err;
    }

    const cooldownMinutes =
      input.cooldownMinutes !== undefined && input.cooldownMinutes !== null && input.cooldownMinutes !== ''
        ? Number(input.cooldownMinutes)
        : DEFAULT_COOLDOWN_MINUTES;

    if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 0 || cooldownMinutes > 10080) {
      const err = new Error('Alert cooldownMinutes must be between 0 and 10080 minutes.');
      err.code = 'INVALID_ALERT_COOLDOWN';
      throw err;
    }

    let expiresAt = null;
    if (input.expiresAt) {
      const expMs = Date.parse(String(input.expiresAt));
      if (!Number.isFinite(expMs)) {
        const err = new Error('Alert expiresAt must be a valid ISO-8601 timestamp.');
        err.code = 'INVALID_ALERT_EXPIRY';
        throw err;
      }
      const nowCheck = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
      if (expMs <= nowCheck) {
        const err = new Error('Alert expiresAt timestamp must be in the future.');
        err.code = 'PAST_ALERT_EXPIRY';
        throw err;
      }
      expiresAt = new Date(expMs).toISOString();
    }

    const rawThreshold =
      input.thresholdValue !== undefined && input.thresholdValue !== null && input.thresholdValue !== ''
        ? Number(input.thresholdValue)
        : input.threshold !== undefined && input.threshold !== null && input.threshold !== ''
          ? Number(input.threshold)
          : null;

    let thresholdValue = null;
    let baselinePrice =
      input.baselinePrice !== undefined &&
      input.baselinePrice !== null &&
      input.baselinePrice !== '' &&
      Number.isFinite(Number(input.baselinePrice)) &&
      Number(input.baselinePrice) > 0
        ? round2(Number(input.baselinePrice))
        : null;

    const conditionParams =
      input.conditionParams && typeof input.conditionParams === 'object'
        ? { ...input.conditionParams }
        : {};

    if (alertType === 'PRICE_ABOVE' || alertType === 'PRICE_BELOW') {
      if (rawThreshold === null || !Number.isFinite(rawThreshold) || rawThreshold <= 0) {
        const err = new Error(`${alertType} requires a positive finite threshold price.`);
        err.code = 'INVALID_ALERT_THRESHOLD';
        throw err;
      }
      thresholdValue = round2(rawThreshold);
    } else if (alertType === 'PERCENT_CHANGE_UP' || alertType === 'PERCENT_CHANGE_DOWN') {
      if (rawThreshold === null || !Number.isFinite(rawThreshold) || rawThreshold <= 0 || rawThreshold > 500) {
        const err = new Error(
          `${alertType} requires a positive percentage threshold between 0.01% and 500%.`
        );
        err.code = 'INVALID_ALERT_THRESHOLD';
        throw err;
      }
      thresholdValue = round2(Math.abs(rawThreshold));
    } else if (alertType === 'SUPPORT_BREAKDOWN' || alertType === 'RESISTANCE_BREAKOUT') {
      if (rawThreshold !== null) {
        if (!Number.isFinite(rawThreshold) || rawThreshold <= 0) {
          const err = new Error(
            `${alertType} level must be a positive number when explicitly specified.`
          );
          err.code = 'INVALID_ALERT_THRESHOLD';
          throw err;
        }
        thresholdValue = round2(rawThreshold);
      }
    } else if (alertType === 'RSI_OVERBOUGHT_OVERSOLD') {
      const rsiMode = String(
        conditionParams.rsiMode || input.rsiMode || (rawThreshold !== null && rawThreshold <= 45 ? 'OVERSOLD' : 'OVERBOUGHT')
      )
        .trim()
        .toUpperCase();

      if (!['OVERBOUGHT', 'OVERSOLD', 'EITHER'].includes(rsiMode)) {
        const err = new Error('RSI alert mode must be OVERBOUGHT, OVERSOLD, or EITHER.');
        err.code = 'INVALID_RSI_ALERT_MODE';
        throw err;
      }

      const defaultThresh = rsiMode === 'OVERSOLD' ? 30 : 70;
      const rsiThreshold = rawThreshold !== null ? rawThreshold : defaultThresh;
      if (!Number.isFinite(rsiThreshold) || rsiThreshold <= 0 || rsiThreshold >= 100) {
        const err = new Error('RSI threshold must be a finite number strictly between 0 and 100.');
        err.code = 'INVALID_ALERT_THRESHOLD';
        throw err;
      }

      thresholdValue = round2(rsiThreshold);
      conditionParams.rsiMode = rsiMode;
      conditionParams.overboughtLevel =
        Number.isFinite(Number(conditionParams.overboughtLevel)) && Number(conditionParams.overboughtLevel) > 50
          ? Number(conditionParams.overboughtLevel)
          : rsiMode === 'OVERBOUGHT'
            ? thresholdValue
            : 70;
      conditionParams.oversoldLevel =
        Number.isFinite(Number(conditionParams.oversoldLevel)) && Number(conditionParams.oversoldLevel) < 50
          ? Number(conditionParams.oversoldLevel)
          : rsiMode === 'OVERSOLD'
            ? thresholdValue
            : 30;
    } else if (alertType === 'STRATEGY_SIGNAL_CHANGE') {
      const targetSignal = String(
        conditionParams.targetSignal || input.targetSignal || 'ANY_EXECUTABLE'
      )
        .trim()
        .toUpperCase();

      const allowedSignals = ['ANY_CHANGE', 'ANY_EXECUTABLE', 'BUY', 'SELL', 'HOLD', 'NO_TRADE'];
      if (!allowedSignals.includes(targetSignal)) {
        const err = new Error(
          `Unsupported targetSignal '${targetSignal}' for STRATEGY_SIGNAL_CHANGE. Allowed: ${allowedSignals.join(', ')}.`
        );
        err.code = 'INVALID_STRATEGY_SIGNAL_TARGET';
        throw err;
      }
      conditionParams.targetSignal = targetSignal;
      if (input.lastKnownSignal) {
        conditionParams.lastKnownSignal = String(input.lastKnownSignal).trim().toUpperCase();
      }
    }

    const requestedStatus = input.status
      ? String(input.status).trim().toUpperCase()
      : 'ACTIVE';
    const validInitStatuses = ['ACTIVE', 'PAUSED', 'DISABLED'];
    const status = validInitStatuses.includes(requestedStatus) ? requestedStatus : 'ACTIVE';

    return {
      symbolKey: inst.symbolKey,
      symbol: inst.name,
      tradingsymbol: inst.tradingsymbol,
      name: inst.name,
      exchange: inst.exchange,
      instrumentType: inst.instrumentType,
      symboltoken: inst.symboltoken,
      optionType: inst.optionType,
      strikePrice: inst.strikePrice,
      expiry: inst.expiry,
      lotSize: inst.lotSize,
      alertType,
      thresholdValue,
      baselinePrice,
      conditionParams,
      triggerMode,
      cooldownMinutes: Math.round(cooldownMinutes),
      status,
      expiresAt,
      notes: input.notes ? String(input.notes).trim().slice(0, 240) : null
    };
  }

  function formatConditionSummary(alert = {}) {
    const type = String(alert.alertType || '').toUpperCase();
    const sym = `${alert.symbol || alert.tradingsymbol || alert.symbolKey} (${alert.exchange || 'NSE'})`;
    const thresh =
      alert.thresholdValue !== null && alert.thresholdValue !== undefined
        ? Number(alert.thresholdValue)
        : null;
    const params = alert.conditionParams || {};

    switch (type) {
      case 'PRICE_ABOVE':
        return `${sym} Price ≥ ₹${thresh !== null ? thresh.toFixed(2) : '--'}`;
      case 'PRICE_BELOW':
        return `${sym} Price ≤ ₹${thresh !== null ? thresh.toFixed(2) : '--'}`;
      case 'PERCENT_CHANGE_UP':
        return `${sym} Change ≥ +${thresh !== null ? thresh.toFixed(2) : '--'}%`;
      case 'PERCENT_CHANGE_DOWN':
        return `${sym} Change ≤ -${thresh !== null ? thresh.toFixed(2) : '--'}%`;
      case 'SUPPORT_BREAKDOWN':
        return thresh !== null
          ? `${sym} Breakdown below Support ₹${thresh.toFixed(2)}`
          : `${sym} Breakdown below Validated Support`;
      case 'RESISTANCE_BREAKOUT':
        return thresh !== null
          ? `${sym} Breakout above Resistance ₹${thresh.toFixed(2)}`
          : `${sym} Breakout above Validated Resistance`;
      case 'RSI_OVERBOUGHT_OVERSOLD': {
        const mode = params.rsiMode || 'OVERBOUGHT';
        if (mode === 'OVERSOLD') {
          return `${sym} RSI(14) ≤ ${thresh !== null ? thresh : 30} (Oversold)`;
        }
        if (mode === 'EITHER') {
          return `${sym} RSI(14) ≥ ${params.overboughtLevel || 70} or ≤ ${params.oversoldLevel || 30}`;
        }
        return `${sym} RSI(14) ≥ ${thresh !== null ? thresh : 70} (Overbought)`;
      }
      case 'STRATEGY_SIGNAL_CHANGE': {
        const target = params.targetSignal || 'ANY_EXECUTABLE';
        return `${sym} Strategy Signal → ${target}`;
      }
      default:
        return `${sym} ${type}`;
    }
  }

  /**
   * Evaluates a single alert against validated market snapshot/quote/indicators/strategy.
   * Never triggers on missing, stale, future, or unvalidated market data.
   */
  function evaluateSingleAlert(alert, marketContext = {}, options = {}) {
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const maxQuoteAgeMs = Number.isFinite(Number(options.maxQuoteAgeMs))
      ? Number(options.maxQuoteAgeMs)
      : DEFAULT_MAX_QUOTE_AGE_MS;

    const currentStatus = String(alert.status || 'ACTIVE').toUpperCase();

    // 1. Check Pause / Disabled / One-time already triggered
    if (currentStatus === 'PAUSED' || currentStatus === 'DISABLED') {
      return {
        alertId: alert.alertId || alert.id,
        triggered: false,
        nextStatus: currentStatus,
        reasonCode: `ALERT_${currentStatus}`,
        reason: `Alert is ${currentStatus.toLowerCase()} and skipped during evaluation.`,
        evaluatedAt: nowIso
      };
    }

    if (currentStatus === 'TRIGGERED' && String(alert.triggerMode || 'ONCE').toUpperCase() === 'ONCE') {
      return {
        alertId: alert.alertId || alert.id,
        triggered: false,
        nextStatus: 'TRIGGERED',
        reasonCode: 'ONCE_ALREADY_TRIGGERED',
        reason: 'One-time alert has already triggered.',
        evaluatedAt: nowIso
      };
    }

    // 2. Check Expiration
    if (alert.expiresAt) {
      const expMs = Date.parse(String(alert.expiresAt));
      if (Number.isFinite(expMs) && expMs <= nowMs) {
        return {
          alertId: alert.alertId || alert.id,
          triggered: false,
          nextStatus: 'EXPIRED',
          statusChanged: currentStatus !== 'EXPIRED',
          reasonCode: 'ALERT_EXPIRED',
          reason: `Alert expired at ${alert.expiresAt}.`,
          evaluatedAt: nowIso
        };
      }
    }

    // 3. Check Cooldown window for COOLDOWN alerts
    if (
      String(alert.triggerMode || 'ONCE').toUpperCase() === 'COOLDOWN' &&
      alert.lastTriggeredAt
    ) {
      const lastTrigMs = Date.parse(String(alert.lastTriggeredAt));
      const cooldownMs = Math.max(0, Number(alert.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES)) * 60 * 1000;
      if (Number.isFinite(lastTrigMs) && cooldownMs > 0 && nowMs - lastTrigMs < cooldownMs) {
        const remainingSec = Math.ceil((cooldownMs - (nowMs - lastTrigMs)) / 1000);
        return {
          alertId: alert.alertId || alert.id,
          triggered: false,
          nextStatus: 'COOLDOWN',
          statusChanged: currentStatus !== 'COOLDOWN',
          reasonCode: 'COOLDOWN_ACTIVE',
          reason: `Alert is in cooldown (${remainingSec}s remaining).`,
          evaluatedAt: nowIso
        };
      }
    }

    // 4. Validate Market Data Quote & Freshness
    const snap = marketContext.snapshot || marketContext.quote || marketContext || null;
    if (!snap || typeof snap !== 'object') {
      return {
        alertId: alert.alertId || alert.id,
        triggered: false,
        nextStatus: 'INVALID_DATA_BLOCKED',
        statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
        reasonCode: 'MARKET_DATA_UNAVAILABLE',
        reason: 'Market quote snapshot is unavailable — alert evaluation blocked without fabrication.',
        evaluatedAt: nowIso
      };
    }

    const price = Number(snap.price);
    if (!Number.isFinite(price) || price <= 0) {
      return {
        alertId: alert.alertId || alert.id,
        triggered: false,
        nextStatus: 'INVALID_DATA_BLOCKED',
        statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
        reasonCode: 'INVALID_MARKET_PRICE',
        reason: 'Market price is missing or non-positive — alert evaluation blocked.',
        evaluatedAt: nowIso
      };
    }

    const quoteTimestamp = snap.timestamp || snap.quoteTimestamp || marketContext.quoteTimestamp || null;
    if (!quoteTimestamp) {
      return {
        alertId: alert.alertId || alert.id,
        triggered: false,
        nextStatus: 'INVALID_DATA_BLOCKED',
        statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
        reasonCode: 'MISSING_QUOTE_TIMESTAMP',
        reason: 'Market quote timestamp is missing — alert evaluation blocked.',
        evaluatedAt: nowIso
      };
    }

    const quoteTsMs = Date.parse(String(quoteTimestamp));
    if (!Number.isFinite(quoteTsMs)) {
      return {
        alertId: alert.alertId || alert.id,
        triggered: false,
        nextStatus: 'INVALID_DATA_BLOCKED',
        statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
        reasonCode: 'INVALID_QUOTE_TIMESTAMP',
        reason: 'Market quote timestamp is malformed — alert evaluation blocked.',
        evaluatedAt: nowIso
      };
    }

    const quoteAgeMs = nowMs - quoteTsMs;
    if (quoteAgeMs < -MAX_FUTURE_DRIFT_MS) {
      return {
        alertId: alert.alertId || alert.id,
        triggered: false,
        nextStatus: 'INVALID_DATA_BLOCKED',
        statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
        reasonCode: 'FUTURE_QUOTE_TIMESTAMP',
        reason: 'Market quote timestamp is in the future — alert evaluation blocked.',
        evaluatedAt: nowIso
      };
    }

    if (
      snap.stale === true ||
      snap.status === 'STALE_MARKET_DATA' ||
      snap.dataReady === false ||
      quoteAgeMs > maxQuoteAgeMs
    ) {
      return {
        alertId: alert.alertId || alert.id,
        triggered: false,
        nextStatus: 'INVALID_DATA_BLOCKED',
        statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
        reasonCode: 'STALE_OR_UNREADY_MARKET_DATA',
        reason: 'Market quote is stale or not ready — alert evaluation blocked.',
        evaluatedAt: nowIso
      };
    }

    // Derive indicators if candles exist and indicators aren't pre-populated
    let indicators = snap.indicators || marketContext.indicators || null;
    const candles = Array.isArray(snap.candles)
      ? snap.candles
      : Array.isArray(marketContext.candles)
        ? marketContext.candles
        : [];

    if ((!indicators || indicators.dataQuality === 'DATA_UNAVAILABLE') && MarketData && typeof MarketData.deriveIndicatorsFromQuote === 'function') {
      indicators = MarketData.deriveIndicatorsFromQuote(snap, candles);
    }

    const alertType = String(alert.alertType || '').toUpperCase();
    const threshold =
      alert.thresholdValue !== null && alert.thresholdValue !== undefined
        ? Number(alert.thresholdValue)
        : null;
    const params = alert.conditionParams || {};

    let triggered = false;
    let observedValue = price;
    let conditionSummary = formatConditionSummary(alert);
    let triggerMessage = '';
    let contextPayload = {
      price: round2(price),
      quoteTimestamp,
      exchange: alert.exchange || snap.exchange || 'NSE',
      instrumentType: alert.instrumentType || snap.type || 'EQUITY'
    };

    if (alertType === 'PRICE_ABOVE') {
      if (threshold === null || !Number.isFinite(threshold) || threshold <= 0) {
        return {
          alertId: alert.alertId || alert.id,
          triggered: false,
          nextStatus: 'INVALID_DATA_BLOCKED',
          statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
          reasonCode: 'INVALID_THRESHOLD',
          reason: 'Invalid price threshold.',
          evaluatedAt: nowIso
        };
      }
      if (price >= threshold) {
        triggered = true;
        observedValue = round2(price);
        triggerMessage = `${alert.symbol} (${alert.exchange}) crossed above ₹${threshold.toFixed(2)} — Validated Price: ₹${price.toFixed(2)}`;
      }
    } else if (alertType === 'PRICE_BELOW') {
      if (threshold === null || !Number.isFinite(threshold) || threshold <= 0) {
        return {
          alertId: alert.alertId || alert.id,
          triggered: false,
          nextStatus: 'INVALID_DATA_BLOCKED',
          statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
          reasonCode: 'INVALID_THRESHOLD',
          reason: 'Invalid price threshold.',
          evaluatedAt: nowIso
        };
      }
      if (price <= threshold) {
        triggered = true;
        observedValue = round2(price);
        triggerMessage = `${alert.symbol} (${alert.exchange}) dropped to/below ₹${threshold.toFixed(2)} — Validated Price: ₹${price.toFixed(2)}`;
      }
    } else if (alertType === 'PERCENT_CHANGE_UP' || alertType === 'PERCENT_CHANGE_DOWN') {
      const refPrice =
        snap.previousClose !== null &&
        snap.previousClose !== undefined &&
        Number.isFinite(Number(snap.previousClose)) &&
        Number(snap.previousClose) > 0
          ? Number(snap.previousClose)
          : alert.baselinePrice !== null &&
              alert.baselinePrice !== undefined &&
              Number.isFinite(Number(alert.baselinePrice)) &&
              Number(alert.baselinePrice) > 0
            ? Number(alert.baselinePrice)
            : snap.open !== null &&
                snap.open !== undefined &&
                Number.isFinite(Number(snap.open)) &&
                Number(snap.open) > 0
              ? Number(snap.open)
              : null;

      if (refPrice === null || refPrice <= 0) {
        return {
          alertId: alert.alertId || alert.id,
          triggered: false,
          nextStatus: 'INVALID_DATA_BLOCKED',
          statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
          reasonCode: 'MISSING_REFERENCE_CLOSE',
          reason: 'Previous close or baseline price is unavailable to compute percentage change.',
          evaluatedAt: nowIso
        };
      }

      const pctChange = round2(((price - refPrice) / refPrice) * 100);
      observedValue = pctChange;
      contextPayload.referencePrice = round2(refPrice);
      contextPayload.percentChange = pctChange;

      if (alertType === 'PERCENT_CHANGE_UP' && pctChange >= threshold) {
        triggered = true;
        triggerMessage = `${alert.symbol} (${alert.exchange}) rose +${pctChange.toFixed(2)}% (Threshold: +${threshold.toFixed(2)}%) from ₹${refPrice.toFixed(2)} to ₹${price.toFixed(2)}`;
      } else if (alertType === 'PERCENT_CHANGE_DOWN' && pctChange <= -Math.abs(threshold)) {
        triggered = true;
        triggerMessage = `${alert.symbol} (${alert.exchange}) fell ${pctChange.toFixed(2)}% (Threshold: -${Math.abs(threshold).toFixed(2)}%) from ₹${refPrice.toFixed(2)} to ₹${price.toFixed(2)}`;
      }
    } else if (alertType === 'SUPPORT_BREAKDOWN') {
      const supportLevel =
        threshold !== null && Number.isFinite(threshold) && threshold > 0
          ? threshold
          : indicators && Number.isFinite(Number(indicators.support)) && Number(indicators.support) > 0
            ? Number(indicators.support)
            : null;

      if (supportLevel === null) {
        return {
          alertId: alert.alertId || alert.id,
          triggered: false,
          nextStatus: 'INVALID_DATA_BLOCKED',
          statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
          reasonCode: 'SUPPORT_LEVEL_UNAVAILABLE',
          reason: 'Validated support level is unavailable from candle history or threshold.',
          evaluatedAt: nowIso
        };
      }

      contextPayload.supportLevel = round2(supportLevel);
      contextPayload.breakoutState = indicators?.breakout || 'NONE';

      if (price < supportLevel || (threshold === null && indicators?.breakout === 'BEARISH_BREAKDOWN' && price <= supportLevel)) {
        triggered = true;
        observedValue = round2(price);
        conditionSummary = `${alert.symbol} (${alert.exchange}) Breakdown < Support ₹${supportLevel.toFixed(2)}`;
        triggerMessage = `${alert.symbol} (${alert.exchange}) broke below support ₹${supportLevel.toFixed(2)} — Validated Price: ₹${price.toFixed(2)}`;
      }
    } else if (alertType === 'RESISTANCE_BREAKOUT') {
      const resistanceLevel =
        threshold !== null && Number.isFinite(threshold) && threshold > 0
          ? threshold
          : indicators && Number.isFinite(Number(indicators.resistance)) && Number(indicators.resistance) > 0
            ? Number(indicators.resistance)
            : null;

      if (resistanceLevel === null) {
        return {
          alertId: alert.alertId || alert.id,
          triggered: false,
          nextStatus: 'INVALID_DATA_BLOCKED',
          statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
          reasonCode: 'RESISTANCE_LEVEL_UNAVAILABLE',
          reason: 'Validated resistance level is unavailable from candle history or threshold.',
          evaluatedAt: nowIso
        };
      }

      contextPayload.resistanceLevel = round2(resistanceLevel);
      contextPayload.breakoutState = indicators?.breakout || 'NONE';

      if (price > resistanceLevel || (threshold === null && indicators?.breakout === 'BULLISH_BREAKOUT' && price >= resistanceLevel)) {
        triggered = true;
        observedValue = round2(price);
        conditionSummary = `${alert.symbol} (${alert.exchange}) Breakout > Resistance ₹${resistanceLevel.toFixed(2)}`;
        triggerMessage = `${alert.symbol} (${alert.exchange}) broke above resistance ₹${resistanceLevel.toFixed(2)} — Validated Price: ₹${price.toFixed(2)}`;
      }
    } else if (alertType === 'RSI_OVERBOUGHT_OVERSOLD') {
      const rsi14 =
        indicators && indicators.rsi14 !== null && indicators.rsi14 !== undefined && Number.isFinite(Number(indicators.rsi14))
          ? Number(indicators.rsi14)
          : null;

      if (rsi14 === null) {
        return {
          alertId: alert.alertId || alert.id,
          triggered: false,
          nextStatus: 'INVALID_DATA_BLOCKED',
          statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
          reasonCode: 'RSI_DATA_INSUFFICIENT',
          reason: 'Validated RSI(14) requires at least 15 historical candles — alert blocked without fabrication.',
          evaluatedAt: nowIso
        };
      }

      observedValue = round2(rsi14);
      contextPayload.rsi14 = observedValue;
      const rsiMode = String(params.rsiMode || 'OVERBOUGHT').toUpperCase();
      const obLevel = Number(params.overboughtLevel || (rsiMode === 'OVERBOUGHT' && threshold ? threshold : 70));
      const osLevel = Number(params.oversoldLevel || (rsiMode === 'OVERSOLD' && threshold ? threshold : 30));

      if (rsiMode === 'OVERBOUGHT' && rsi14 >= obLevel) {
        triggered = true;
        triggerMessage = `${alert.symbol} (${alert.exchange}) RSI(14) reached Overbought ${rsi14.toFixed(2)} (≥ ${obLevel}) at ₹${price.toFixed(2)}`;
      } else if (rsiMode === 'OVERSOLD' && rsi14 <= osLevel) {
        triggered = true;
        triggerMessage = `${alert.symbol} (${alert.exchange}) RSI(14) reached Oversold ${rsi14.toFixed(2)} (≤ ${osLevel}) at ₹${price.toFixed(2)}`;
      } else if (rsiMode === 'EITHER' && (rsi14 >= obLevel || rsi14 <= osLevel)) {
        triggered = true;
        const zone = rsi14 >= obLevel ? `Overbought (≥ ${obLevel})` : `Oversold (≤ ${osLevel})`;
        triggerMessage = `${alert.symbol} (${alert.exchange}) RSI(14) entered ${zone} at ${rsi14.toFixed(2)} (Price ₹${price.toFixed(2)})`;
      }
    } else if (alertType === 'STRATEGY_SIGNAL_CHANGE') {
      let strategyEval = marketContext.strategy || null;
      if (!strategyEval && StrategyEngine && typeof StrategyEngine.evaluate === 'function') {
        strategyEval = StrategyEngine.evaluate({
          dataReady: true,
          snapshot: snap,
          candles,
          indicators,
          price,
          assetType: alert.instrumentType === 'OPTION' ? 'OPTION' : 'EQUITY',
          optionType: alert.optionType || '',
          emergencyStop: Boolean(marketContext.emergencyStop)
        });
      }

      if (
        !strategyEval ||
        strategyEval.dataQuality === 'DATA_UNAVAILABLE' ||
        strategyEval.marketRegime === 'INSUFFICIENT_DATA'
      ) {
        return {
          alertId: alert.alertId || alert.id,
          triggered: false,
          nextStatus: 'INVALID_DATA_BLOCKED',
          statusChanged: currentStatus !== 'INVALID_DATA_BLOCKED',
          reasonCode: 'STRATEGY_DATA_INSUFFICIENT',
          reason: 'Validated strategy signal requires sufficient candle & indicator data — alert blocked.',
          evaluatedAt: nowIso
        };
      }

      const currentAction = String(strategyEval.action || 'NO_TRADE').toUpperCase();
      const targetSignal = String(params.targetSignal || 'ANY_EXECUTABLE').toUpperCase();
      const prevSignal = params.lastKnownSignal ? String(params.lastKnownSignal).toUpperCase() : null;

      contextPayload.strategyAction = currentAction;
      contextPayload.strategyConfidence = Number(strategyEval.confidence || 0);
      contextPayload.marketRegime = strategyEval.marketRegime;
      contextPayload.entry = strategyEval.entry ?? null;
      contextPayload.stopLoss = strategyEval.stopLoss ?? null;
      contextPayload.target = strategyEval.target ?? null;

      observedValue = currentAction;

      if (targetSignal === 'BUY' || targetSignal === 'SELL' || targetSignal === 'HOLD' || targetSignal === 'NO_TRADE') {
        if (currentAction === targetSignal && prevSignal !== currentAction) {
          triggered = true;
          triggerMessage = `${alert.symbol} (${alert.exchange}) Strategy Signal changed to ${currentAction} (${strategyEval.confidence || 0}% confidence) at ₹${price.toFixed(2)}`;
        }
      } else if (targetSignal === 'ANY_EXECUTABLE') {
        if ((currentAction === 'BUY' || currentAction === 'SELL') && prevSignal !== currentAction) {
          triggered = true;
          triggerMessage = `${alert.symbol} (${alert.exchange}) Strategy generated executable ${currentAction} setup (${strategyEval.confidence || 0}% confidence) at ₹${price.toFixed(2)}`;
        }
      } else if (targetSignal === 'ANY_CHANGE') {
        if (prevSignal && prevSignal !== currentAction) {
          triggered = true;
          triggerMessage = `${alert.symbol} (${alert.exchange}) Strategy Signal transitioned ${prevSignal} → ${currentAction} at ₹${price.toFixed(2)}`;
        }
      }
    }

    const triggerMode = String(alert.triggerMode || 'ONCE').toUpperCase();
    if (triggered) {
      const nextStatus = triggerMode === 'ONCE' ? 'TRIGGERED' : 'COOLDOWN';
      return {
        alertId: alert.alertId || alert.id,
        triggered: true,
        nextStatus,
        statusChanged: true,
        reasonCode: 'CONDITION_MET',
        reason: triggerMessage,
        evaluatedAt: nowIso,
        quoteTimestamp,
        observedPrice: round2(price),
        observedValue,
        conditionSummary,
        eventPayload: {
          userId: alert.userId || null,
          alertId: alert.alertId || alert.id,
          symbolKey: alert.symbolKey,
          symbol: alert.symbol,
          tradingsymbol: alert.tradingsymbol || alert.symbol,
          exchange: alert.exchange || 'NSE',
          instrumentType: alert.instrumentType || 'EQUITY',
          alertType,
          triggerMode,
          conditionSummary,
          thresholdValue: threshold,
          observedPrice: round2(price),
          observedValue: typeof observedValue === 'number' ? round2(observedValue) : String(observedValue),
          message: triggerMessage,
          context: contextPayload,
          quoteTimestamp,
          triggeredAt: nowIso
        }
      };
    }

    // Condition not met, but market data was valid: restore ACTIVE if previously INVALID_DATA_BLOCKED or COOLDOWN expired
    const restoredStatus =
      currentStatus === 'INVALID_DATA_BLOCKED' || currentStatus === 'COOLDOWN'
        ? 'ACTIVE'
        : currentStatus;

    return {
      alertId: alert.alertId || alert.id,
      triggered: false,
      nextStatus: restoredStatus,
      statusChanged: restoredStatus !== currentStatus,
      reasonCode: 'CONDITION_NOT_MET',
      reason: 'Market data validated; alert threshold not crossed.',
      evaluatedAt: nowIso,
      quoteTimestamp,
      observedPrice: round2(price),
      observedValue
    };
  }

  function buildWatchlistAndAlertsViewModel(input = {}) {
    const rawWatchlist = Array.isArray(input.watchlist) ? input.watchlist : [];
    const rawAlerts = Array.isArray(input.alerts) ? input.alerts : [];
    const rawHistory = Array.isArray(input.alertHistory) ? input.alertHistory : [];
    const quotesBySymbol = input.quotesBySymbol && typeof input.quotesBySymbol === 'object' ? input.quotesBySymbol : {};
    const openPosition = input.openPosition || null;
    const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();

    const enrichedWatchlist = rawWatchlist.map((item) => {
      const symKey = String(item.key || item.symbolKey || item.tradingsymbol || item.name || '').toUpperCase();
      const exKey = `${String(item.exchange || 'NSE').toUpperCase()}:${symKey}`;
      const snap = quotesBySymbol[exKey] || quotesBySymbol[symKey] || quotesBySymbol[String(item.name || '').toUpperCase()] || null;
      const enriched = enrichWatchlistItemWithQuote(item, snap, { nowMs });

      const activeAlertsForItem = rawAlerts.filter((a) => {
        const aSym = String(a.symbolKey || a.symbol || a.tradingsymbol || '').toUpperCase();
        const aEx = String(a.exchange || 'NSE').toUpperCase();
        return (
          aEx === String(item.exchange || 'NSE').toUpperCase() &&
          (aSym === symKey || aSym === String(item.name || '').toUpperCase()) &&
          ['ACTIVE', 'COOLDOWN', 'INVALID_DATA_BLOCKED'].includes(String(a.status || '').toUpperCase())
        );
      });

      const hasOpenPaperPosition = Boolean(
        openPosition &&
          openPosition.status === 'OPEN' &&
          (String(openPosition.symbol || '').toUpperCase() === symKey ||
            String(openPosition.symbol || '').toUpperCase() === String(item.name || '').toUpperCase())
      );

      return {
        ...enriched,
        activeAlertCount: activeAlertsForItem.length,
        hasOpenPaperPosition
      };
    });

    const formattedAlerts = rawAlerts.map((a) => ({
      ...a,
      conditionSummary: a.conditionSummary || formatConditionSummary(a)
    }));

    const counts = {
      watchlistTotal: enrichedWatchlist.length,
      watchlistLiveQuotes: enrichedWatchlist.filter((w) => w.dataReady).length,
      alertsTotal: formattedAlerts.length,
      alertsActive: formattedAlerts.filter((a) => a.status === 'ACTIVE').length,
      alertsTriggered: formattedAlerts.filter((a) => a.status === 'TRIGGERED').length,
      alertsCooldown: formattedAlerts.filter((a) => a.status === 'COOLDOWN').length,
      alertsPausedOrDisabled: formattedAlerts.filter((a) => a.status === 'PAUSED' || a.status === 'DISABLED').length,
      alertsBlockedByData: formattedAlerts.filter((a) => a.status === 'INVALID_DATA_BLOCKED').length,
      historyTotal: rawHistory.length,
      historyUnread: rawHistory.filter((h) => !h.acknowledged).length
    };

    return {
      ok: true,
      version: ENGINE_VERSION,
      tradingMode: 'PAPER',
      liveTradingEnabled: false,
      counts,
      watchlist: enrichedWatchlist,
      alerts: formattedAlerts,
      alertHistory: rawHistory,
      documentedRules: DOCUMENTED_WATCHLIST_ALERT_RULES
    };
  }

  function buildWatchlistSnapshot(input = {}) {
    const rawItems = Array.isArray(input.items)
      ? input.items
      : Array.isArray(input.watchlist)
        ? input.watchlist
        : [];
    const quotesByKey =
      input.quotesByKey && typeof input.quotesByKey === 'object'
        ? input.quotesByKey
        : input.quotesBySymbol && typeof input.quotesBySymbol === 'object'
          ? input.quotesBySymbol
          : {};
    const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();

    const items = rawItems.map((item, idx) => {
      const symKey = String(
        item.key || item.symbolKey || item.tradingsymbol || item.symbol || item.name || ''
      ).toUpperCase();
      const exKey = `${String(item.exchange || 'NSE').toUpperCase()}:${symKey}`;
      const snap =
        quotesByKey[item.instrumentKey] ||
        quotesByKey[exKey] ||
        quotesByKey[symKey] ||
        (item.tradingsymbol ? quotesByKey[item.tradingsymbol] || quotesByKey[String(item.tradingsymbol).toUpperCase()] : null) ||
        (item.name ? quotesByKey[item.name] || quotesByKey[String(item.name).toUpperCase()] : null) ||
        null;

      const enriched = enrichWatchlistItemWithQuote(item, snap, { nowMs });
      const rawSnapObj = snap?.snapshot || snap?.quote || snap || null;

      return {
        ...enriched,
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : idx + 1,
        optionDetails:
          enriched.instrumentType === 'OPTION' || enriched.optionType
            ? {
                optionType: enriched.optionType,
                strikePrice: enriched.strikePrice,
                expiry: enriched.expiry
              }
            : null,
        quote: {
          available: Boolean(enriched.price !== null && enriched.price > 0),
          dataReady: enriched.dataReady,
          isStale: enriched.isStale,
          status: enriched.quoteStatus,
          freshnessLabel: enriched.freshnessLabel,
          ltp: enriched.price,
          price: enriched.price,
          previousClose: enriched.previousClose,
          change: enriched.changeAbs,
          changePercent: enriched.changePct,
          high: rawSnapObj?.high !== undefined && rawSnapObj?.high !== null ? Number(rawSnapObj.high) : null,
          low: rawSnapObj?.low !== undefined && rawSnapObj?.low !== null ? Number(rawSnapObj.low) : null,
          volume: rawSnapObj?.volume !== undefined && rawSnapObj?.volume !== null ? Number(rawSnapObj.volume) : null,
          source: rawSnapObj?.provider || snap?.provider || (enriched.price !== null ? 'VALIDATED_SNAPSHOT' : 'NO_VALIDATED_SNAPSHOT'),
          timestamp: enriched.quoteTimestamp
        }
      };
    });

    const summary = {
      totalItems: items.length,
      availableQuotes: items.filter((i) => i.quote && i.quote.available).length,
      freshQuotes: items.filter((i) => i.dataReady).length,
      staleQuotes: items.filter((i) => i.isStale).length,
      waitingQuotes: items.filter((i) => !i.quote || !i.quote.available).length
    };

    return {
      ok: true,
      userId: input.userId || null,
      items,
      quotes: quotesByKey,
      summary
    };
  }

  function buildWatchlistViewModel(watchlist = [], quotesMap = {}, options = {}) {
    return buildWatchlistSnapshot({
      items: watchlist,
      quotesByKey: quotesMap,
      nowMs: options.nowMs
    }).items;
  }

  return {
    ENGINE_VERSION,
    SUPPORTED_EXCHANGES,
    SUPPORTED_INSTRUMENT_TYPES,
    SUPPORTED_ALERT_TYPES,
    SUPPORTED_TRIGGER_MODES,
    ALERT_LIFECYCLE_STATES,
    DEFAULT_MAX_QUOTE_AGE_MS,
    DEFAULT_COOLDOWN_MINUTES,
    DOCUMENTED_WATCHLIST_ALERT_RULES,
    parseExpiryDate,
    inferInstrumentType,
    validateAndNormalizeWatchlistInstrument,
    enrichWatchlistItemWithQuote,
    validateAlertDefinition,
    formatConditionSummary,
    evaluateSingleAlert,
    buildWatchlistSnapshot,
    buildWatchlistViewModel,
    buildWatchlistAndAlertsViewModel
  };
});
