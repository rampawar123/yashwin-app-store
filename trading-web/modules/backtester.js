/*
 * YASHWIN AI Trading Assistant
 * Phase 16 & Task 13 — Complete Deterministic Historical Backtesting Engine
 *
 * Architecture:
 * Historical Data -> Normalizer & Validator -> Chronological Step (0..i) ->
 * Indicators (Zero Look-Ahead) -> MarketAnalysis -> StrategyEngine ->
 * RiskEngine -> AISafetyGate -> EmergencyStop -> Simulated Fill & Exit Engine ->
 * Performance Analytics & Reproducible SQLite Run Record
 *
 * Strictly step-by-step chronological iteration (index 0..i only).
 * Zero look-ahead bias. Zero future candle leakage. Zero live broker orders.
 */

const MarketDataMod =
  typeof MarketData !== "undefined"
    ? MarketData
    : typeof require === "function"
      ? (() => {
          try {
            return require("./market-data");
          } catch (_) {
            return null;
          }
        })()
      : null;

const MarketAnalysisMod =
  typeof MarketAnalysis !== "undefined"
    ? MarketAnalysis
    : typeof require === "function"
      ? (() => {
          try {
            return require("./market-analysis");
          } catch (_) {
            return null;
          }
        })()
      : null;

const StrategyEngineMod =
  typeof StrategyEngine !== "undefined"
    ? StrategyEngine
    : typeof require === "function"
      ? (() => {
          try {
            return require("./strategy-engine");
          } catch (_) {
            return null;
          }
        })()
      : null;

const RiskEngineMod =
  typeof RiskEngine !== "undefined"
    ? RiskEngine
    : typeof require === "function"
      ? (() => {
          try {
            return require("./risk-engine");
          } catch (_) {
            return null;
          }
        })()
      : null;

const AISafetyGateMod =
  typeof AISafetyGate !== "undefined"
    ? AISafetyGate
    : typeof require === "function"
      ? (() => {
          try {
            return require("./ai-safety-gate");
          } catch (_) {
            return null;
          }
        })()
      : null;

const AuditLoggerMod =
  typeof AuditLogger !== "undefined"
    ? AuditLogger
    : typeof require === "function"
      ? (() => {
          try {
            return require("./audit-logger");
          } catch (_) {
            return null;
          }
        })()
      : null;

const ServerDbRefBacktest = (() => {
  if (typeof window !== "undefined") return null;
  if (typeof require === "function") {
    try {
      return require("../../server/database");
    } catch (_) {
      return null;
    }
  }
  return null;
})();

const Backtester = (() => {
  const BACKTESTER_VERSION = "2.0.0-DETERMINISTIC-TASK13";

  const SUPPORTED_TIMEFRAMES = Object.freeze({
    ONE_MINUTE: 60 * 1000,
    THREE_MINUTE: 3 * 60 * 1000,
    FIVE_MINUTE: 5 * 60 * 1000,
    TEN_MINUTE: 10 * 60 * 1000,
    FIFTEEN_MINUTE: 15 * 60 * 1000,
    THIRTY_MINUTE: 30 * 60 * 1000,
    ONE_HOUR: 60 * 60 * 1000,
    ONE_DAY: 24 * 60 * 60 * 1000
  });

  const TIMEFRAME_ALIASES = Object.freeze({
    "1m": "ONE_MINUTE",
    "1min": "ONE_MINUTE",
    "3m": "THREE_MINUTE",
    "3min": "THREE_MINUTE",
    "5m": "FIVE_MINUTE",
    "5min": "FIVE_MINUTE",
    "10m": "TEN_MINUTE",
    "10min": "TEN_MINUTE",
    "15m": "FIFTEEN_MINUTE",
    "15min": "FIFTEEN_MINUTE",
    "30m": "THIRTY_MINUTE",
    "30min": "THIRTY_MINUTE",
    "1h": "ONE_HOUR",
    "60m": "ONE_HOUR",
    "1d": "ONE_DAY",
    day: "ONE_DAY",
    daily: "ONE_DAY"
  });

  const SUPPORTED_EXCHANGES = new Set(["NSE", "NFO", "BSE", "BFO", "MCX", "CDS"]);
  const SUPPORTED_ENTRY_MODELS = new Set(["SIGNAL_CANDLE_CLOSE", "NEXT_CANDLE_OPEN"]);
  const SUPPORTED_EXIT_MODELS = new Set(["CONSERVATIVE_GAP_AWARE", "LEVEL_EXACT"]);

  const DEFAULTS = Object.freeze({
    initialCapital: 100000,
    maxLossPerTrade: 500,
    maxDailyLoss: 1000,
    maxTradesPerDay: 3,
    maxOpenPositions: 1,
    feePerTrade: 0,
    slippagePerUnit: 0,
    maxCandlesLimit: 5000,
    maxDateRangeDays: 365,
    maxRuntimeMs: 5000,
    futureTimestampToleranceMs: 5000,
    entryFillModel: "SIGNAL_CANDLE_CLOSE",
    exitFillModel: "CONSERVATIVE_GAP_AWARE"
  });

  const DOCUMENTED_BACKTEST_RULES = Object.freeze({
    version: BACKTESTER_VERSION,
    tradingMode: "paper",
    liveTradingEnabled: false,
    brokerExecution: "NONE",
    supportedTimeframes: Object.keys(SUPPORTED_TIMEFRAMES),
    supportedExchanges: Array.from(SUPPORTED_EXCHANGES),
    lookAheadPrevention: {
      chronologicalSliceOnly: true,
      description:
        "At simulation index i, only candles[0..i] are visible to technical indicators, MarketAnalysis, and StrategyEngine. Future candles (index > i) are never accessed.",
      warmupPeriods: {
        EMA_9: 9,
        RSI_14: 15,
        ATR_14: 15,
        ADX_14: 15,
        SMA_20_BOLLINGER: 20,
        EMA_21: 21,
        MACD_12_26_9: 26,
        SMA_50: 50
      }
    },
    executionAssumptions: {
      entryModels: {
        SIGNAL_CANDLE_CLOSE:
          "Entry order triggers on completed signal candle i at strategy.entry (derived from candle i close), and exits are evaluated strictly starting from subsequent candle i+1.",
        NEXT_CANDLE_OPEN:
          "Signal generated on completed candle i executes at the open price of candle i+1, shifting stop-loss and target levels by the overnight/intrabar open gap to preserve unit risk."
      },
      sameCandleStopAndTargetAmbiguity:
        "CONSERVATIVE_STOP_LOSS_FIRST: If a single candle breaches both stop-loss and target levels (low <= stop and high >= target), intra-candle tick sequence is unknown; the engine deterministically assumes STOP_LOSS was hit first and increments ambiguousExecutionsCount.",
      gapThroughStopLossOrTarget:
        "CONSERVATIVE_GAP_AWARE: If a candle opens beyond the stop-loss (BUY open < stop, or SELL open > stop), the stop exit fills at the adverse candle.open price rather than the better stop level. Target exits fill conservatively at target price.",
      costDisclosure:
        "Simulated costs include user-configured feePerTrade (₹ per round-turn trade) and slippagePerUnit (₹ per unit per fill leg, applied on both entry and exit: 2 * slippagePerUnit * effectiveQty). Exchange STT, SEBI turnover charges, stamp duty, and GST are NOT automatically modeled unless included in feePerTrade."
    },
    riskLimitsEnforced: {
      maxLossPerTrade: 500,
      maxDailyLoss: 1000,
      maxTradesPerDay: 3,
      maxOpenPositions: 1,
      mandatoryDirectionalStopLoss: true,
      averagingDownAllowed: false,
      emergencyStopHaltsSimulation: true
    },
    disclaimer:
      "SIMULATED HISTORICAL BACKTEST ONLY — Backtest results are hypothetical, do not represent actual live trading, and do not guarantee future performance."
  });

  function round2(val) {
    const n = Number(val);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  function normalizeTimeframe(rawTimeframe = "FIVE_MINUTE") {
    const cleaned = String(rawTimeframe || "FIVE_MINUTE").trim();
    const upper = cleaned.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(SUPPORTED_TIMEFRAMES, upper)) {
      return upper;
    }
    const alias = TIMEFRAME_ALIASES[cleaned.toLowerCase()];
    if (alias) {
      return alias;
    }
    const err = new Error(
      `Unsupported backtest timeframe '${cleaned}'. Supported: ${Object.keys(SUPPORTED_TIMEFRAMES).join(", ")}`
    );
    err.code = "INVALID_BACKTEST_TIMEFRAME";
    throw err;
  }

  function normalizeCandle(raw = {}, index = 0, options = {}) {
    if (!raw || typeof raw !== "object") {
      const err = new Error(`Invalid historical candle at index ${index}.`);
      err.code = "INVALID_BACKTEST_CANDLE";
      throw err;
    }

    const open = Number(raw.open);
    const high = Number(raw.high);
    const low = Number(raw.low);
    const close = Number(raw.close ?? raw.price);
    const volume = raw.volume !== undefined && raw.volume !== null ? Number(raw.volume) : 0;

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      high < low ||
      high < open ||
      high < close ||
      low > open ||
      low > close ||
      !Number.isFinite(volume) ||
      volume < 0
    ) {
      const err = new Error(
        `Invalid historical candle OHLCV relationships at index ${index} (O:${open} H:${high} L:${low} C:${close} V:${volume}).`
      );
      err.code = "INVALID_BACKTEST_CANDLE";
      throw err;
    }

    const tsMs = raw.timestamp ? Date.parse(raw.timestamp) : NaN;
    if (!Number.isFinite(tsMs)) {
      const err = new Error(`Invalid timestamp in candle at index ${index}.`);
      err.code = "INVALID_BACKTEST_TIMESTAMP";
      throw err;
    }

    const maxFutureReferenceMs = Number(options.nowMs);
    if (
      Number.isFinite(maxFutureReferenceMs) &&
      options.rejectFutureTimestamps === true &&
      tsMs > maxFutureReferenceMs + DEFAULTS.futureTimestampToleranceMs
    ) {
      const err = new Error(
        `Future-dated candle timestamp detected at index ${index}: ${new Date(tsMs).toISOString()}`
      );
      err.code = "FUTURE_BACKTEST_TIMESTAMP";
      throw err;
    }

    return {
      timestamp: new Date(tsMs).toISOString(),
      timestampMs: tsMs,
      open,
      high,
      low,
      close,
      volume,
      indicators: raw.indicators || null,
      aiDecision: raw.aiDecision || null,
      emergencyStop: raw.emergencyStop === true
    };
  }

  function normalizeHistoricalSeries(rawCandles = [], options = {}) {
    if (!Array.isArray(rawCandles) || rawCandles.length === 0) {
      const err = new Error("Historical candle array is required.");
      err.code = "EMPTY_BACKTEST_SERIES";
      throw err;
    }

    const maxCandles = Number(options.maxCandles) || DEFAULTS.maxCandlesLimit;
    if (rawCandles.length > maxCandles) {
      const err = new Error(
        `Historical candle count (${rawCandles.length}) exceeds maximum permitted limit (${maxCandles}).`
      );
      err.code = "BACKTEST_CANDLE_LIMIT_EXCEEDED";
      throw err;
    }

    const normalized = rawCandles.map((c, idx) => normalizeCandle(c, idx, options));

    for (let i = 1; i < normalized.length; i += 1) {
      if (normalized[i].timestampMs < normalized[i - 1].timestampMs) {
        const err = new Error(
          "Historical candles must be sorted in ascending chronological order."
        );
        err.code = "UNSORTED_BACKTEST_SERIES";
        throw err;
      }
      if (normalized[i].timestampMs === normalized[i - 1].timestampMs) {
        const err = new Error(
          `Duplicate candle timestamp detected at index ${i} (${normalized[i].timestamp}).`
        );
        err.code = "DUPLICATE_BACKTEST_CANDLE_TIMESTAMP";
        throw err;
      }
    }

    return normalized;
  }

  function inspectDataQualityAndGaps(candles = [], timeframe = "FIVE_MINUTE", config = {}) {
    const tfMs = SUPPORTED_TIMEFRAMES[timeframe] || SUPPORTED_TIMEFRAMES.FIVE_MINUTE;
    const gaps = [];

    for (let i = 1; i < candles.length; i += 1) {
      const prev = candles[i - 1];
      const cur = candles[i];
      const deltaMs = cur.timestampMs - prev.timestampMs;
      const sameDay = prev.timestamp.slice(0, 10) === cur.timestamp.slice(0, 10);

      // Flag intra-session gaps (> 1.5x interval on same day) or multi-day gaps (> 5 days for ONE_DAY)
      if (timeframe === "ONE_DAY") {
        if (deltaMs > 5 * tfMs) {
          gaps.push({
            fromIndex: i - 1,
            toIndex: i,
            fromTimestamp: prev.timestamp,
            toTimestamp: cur.timestamp,
            missingBarsEstimate: Math.max(1, Math.round(deltaMs / tfMs) - 1)
          });
        }
      } else if (sameDay && deltaMs > tfMs * 1.5) {
        gaps.push({
          fromIndex: i - 1,
          toIndex: i,
          fromTimestamp: prev.timestamp,
          toTimestamp: cur.timestamp,
          missingBarsEstimate: Math.max(1, Math.round(deltaMs / tfMs) - 1)
        });
      }
    }

    const hasPrecomputedIndicators = candles.some(
      (c) => c.indicators && typeof c.indicators === "object"
    );

    const warmupStatus = {
      ema9Ready: candles.length >= 9 || hasPrecomputedIndicators,
      rsi14Ready: candles.length >= 15 || hasPrecomputedIndicators,
      atr14Ready: candles.length >= 15 || hasPrecomputedIndicators,
      adx14Ready: candles.length >= 15 || hasPrecomputedIndicators,
      bollinger20Ready: candles.length >= 20 || hasPrecomputedIndicators,
      ema21Ready: candles.length >= 21 || hasPrecomputedIndicators,
      macd26Ready: candles.length >= 26 || hasPrecomputedIndicators,
      sma50Ready: candles.length >= 50 || hasPrecomputedIndicators
    };

    const qualityTier =
      candles.length >= 26
        ? "FULL_HISTORICAL_SERIES"
        : candles.length >= 15
          ? "PARTIAL_WARMUP_SERIES"
          : hasPrecomputedIndicators
            ? "PRECOMPUTED_INDICATOR_SERIES"
            : "INSUFFICIENT_WARMUP_HISTORY";

    const dataSource = String(
      config.dataSource ||
        (config.provider === "ANGEL_ONE" ? "ANGEL_ONE_HISTORICAL_API" : "SUPPLIED_VALIDATED_CANDLES")
    );

    return {
      dataSource,
      provider: config.provider || null,
      retrievalTimestamp: config.retrievalTimestamp || new Date().toISOString(),
      usedRealHistoricalSource: dataSource === "ANGEL_ONE_HISTORICAL_API",
      candlesCount: candles.length,
      firstCandleTimestamp: candles.length ? candles[0].timestamp : null,
      lastCandleTimestamp: candles.length ? candles[candles.length - 1].timestamp : null,
      timeframe,
      timeframeMs: tfMs,
      qualityTier,
      missingCandlesFilledWithSyntheticPrices: false,
      gapsDetectedCount: gaps.length,
      gaps: gaps.slice(0, 25),
      warmupStatus,
      limitations: [
        gaps.length > 0
          ? `${gaps.length} timestamp gap(s) detected in candle series; missing candles are never filled with fabricated prices.`
          : "No intra-session timestamp gaps detected.",
        dataSource !== "ANGEL_ONE_HISTORICAL_API"
          ? "Candles were supplied directly to Backtester rather than fetched live from Angel One getCandleData."
          : "Candles fetched from Angel One historical candle adapter and validated."
      ]
    };
  }

  function validateBacktestConfig(config = {}) {
    const symbol = String(config.symbol || config.tradingsymbol || "NIFTY 50").trim();
    if (!symbol) {
      const err = new Error("Backtest instrument symbol is required.");
      err.code = "INVALID_BACKTEST_SYMBOL";
      throw err;
    }

    const exchange = String(config.exchange || "NSE").trim().toUpperCase();
    if (!SUPPORTED_EXCHANGES.has(exchange)) {
      const err = new Error(
        `Unsupported exchange '${exchange}'. Supported: ${Array.from(SUPPORTED_EXCHANGES).join(", ")}`
      );
      err.code = "INVALID_BACKTEST_EXCHANGE";
      throw err;
    }

    const timeframe = normalizeTimeframe(config.timeframe || config.interval || "FIVE_MINUTE");
    const assetType = String(config.assetType || "EQUITY").trim().toUpperCase();
    if (assetType !== "EQUITY" && assetType !== "OPTION") {
      const err = new Error("Backtest assetType must be EQUITY or OPTION.");
      err.code = "INVALID_BACKTEST_ASSET_TYPE";
      throw err;
    }

    const initialCapital =
      config.initialCapital !== undefined && config.initialCapital !== null
        ? Number(config.initialCapital)
        : DEFAULTS.initialCapital;
    if (!Number.isFinite(initialCapital) || initialCapital < 1000 || initialCapital > 100000000) {
      const err = new Error("Initial virtual capital must be between ₹1,000 and ₹10,00,00,000.");
      err.code = "INVALID_BACKTEST_CAPITAL";
      throw err;
    }

    const quantity = config.quantity !== undefined ? Number(config.quantity) : 1;
    const lotSize = config.lotSize !== undefined ? Number(config.lotSize) : 1;
    const lots = config.lots !== undefined ? Number(config.lots) : 1;

    if (assetType === "EQUITY") {
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
        const err = new Error("Equity quantity must be a positive whole integer.");
        err.code = "INVALID_BACKTEST_QUANTITY";
        throw err;
      }
    } else {
      if (
        !Number.isFinite(lotSize) ||
        lotSize <= 0 ||
        !Number.isInteger(lotSize) ||
        !Number.isFinite(lots) ||
        lots <= 0 ||
        !Number.isInteger(lots)
      ) {
        const err = new Error("Option lotSize and lots must be positive whole integers.");
        err.code = "INVALID_BACKTEST_OPTION_LOTS";
        throw err;
      }
    }

    const feePerTrade =
      config.feePerTrade !== undefined && config.feePerTrade !== null
        ? Number(config.feePerTrade)
        : DEFAULTS.feePerTrade;
    const slippagePerUnit =
      config.slippagePerUnit !== undefined && config.slippagePerUnit !== null
        ? Number(config.slippagePerUnit)
        : DEFAULTS.slippagePerUnit;

    if (!Number.isFinite(feePerTrade) || feePerTrade < 0) {
      const err = new Error("feePerTrade must be a non-negative number.");
      err.code = "INVALID_BACKTEST_FEE";
      throw err;
    }
    if (!Number.isFinite(slippagePerUnit) || slippagePerUnit < 0) {
      const err = new Error("slippagePerUnit must be a non-negative number.");
      err.code = "INVALID_BACKTEST_SLIPPAGE";
      throw err;
    }

    const maxLossPerTrade =
      config.maxLossPerTrade !== undefined
        ? Math.min(DEFAULTS.maxLossPerTrade, Number(config.maxLossPerTrade))
        : DEFAULTS.maxLossPerTrade;
    const maxDailyLoss =
      config.maxDailyLoss !== undefined
        ? Math.min(DEFAULTS.maxDailyLoss, Number(config.maxDailyLoss))
        : DEFAULTS.maxDailyLoss;
    const maxTradesPerDay =
      config.maxTradesPerDay !== undefined
        ? Math.min(DEFAULTS.maxTradesPerDay, Number(config.maxTradesPerDay))
        : DEFAULTS.maxTradesPerDay;

    if (
      !Number.isFinite(maxLossPerTrade) ||
      maxLossPerTrade <= 0 ||
      !Number.isFinite(maxDailyLoss) ||
      maxDailyLoss <= 0 ||
      !Number.isFinite(maxTradesPerDay) ||
      maxTradesPerDay <= 0
    ) {
      const err = new Error("Risk configuration limits must be positive numbers.");
      err.code = "INVALID_BACKTEST_RISK_LIMITS";
      throw err;
    }

    let fromMs = null;
    let toMs = null;
    const rawFrom = config.fromDate || config.fromdate || config.startDate || null;
    const rawTo = config.toDate || config.todate || config.endDate || null;

    if (rawFrom) {
      fromMs = Date.parse(String(rawFrom));
      if (!Number.isFinite(fromMs)) {
        const err = new Error(`Invalid backtest start date: ${rawFrom}`);
        err.code = "INVALID_BACKTEST_DATE_RANGE";
        throw err;
      }
    }
    if (rawTo) {
      toMs = Date.parse(String(rawTo));
      if (!Number.isFinite(toMs)) {
        const err = new Error(`Invalid backtest end date: ${rawTo}`);
        err.code = "INVALID_BACKTEST_DATE_RANGE";
        throw err;
      }
    }
    if (fromMs !== null && toMs !== null) {
      if (fromMs > toMs) {
        const err = new Error("Backtest start date must not be after end date.");
        err.code = "INVALID_BACKTEST_DATE_RANGE";
        throw err;
      }
      const rangeDays = (toMs - fromMs) / (24 * 60 * 60 * 1000);
      if (rangeDays > (Number(config.maxDateRangeDays) || DEFAULTS.maxDateRangeDays)) {
        const err = new Error(
          `Backtest date range (${Math.round(rangeDays)} days) exceeds maximum permitted (${DEFAULTS.maxDateRangeDays} days).`
        );
        err.code = "BACKTEST_DATE_RANGE_EXCEEDED";
        throw err;
      }
    }

    const entryFillModel = String(config.entryFillModel || DEFAULTS.entryFillModel)
      .trim()
      .toUpperCase();
    if (!SUPPORTED_ENTRY_MODELS.has(entryFillModel)) {
      const err = new Error(
        `Unsupported entryFillModel '${entryFillModel}'. Supported: ${Array.from(SUPPORTED_ENTRY_MODELS).join(", ")}`
      );
      err.code = "INVALID_BACKTEST_ENTRY_MODEL";
      throw err;
    }

    const exitFillModel = String(config.exitFillModel || DEFAULTS.exitFillModel)
      .trim()
      .toUpperCase();
    if (!SUPPORTED_EXIT_MODELS.has(exitFillModel)) {
      const err = new Error(
        `Unsupported exitFillModel '${exitFillModel}'. Supported: ${Array.from(SUPPORTED_EXIT_MODELS).join(", ")}`
      );
      err.code = "INVALID_BACKTEST_EXIT_MODEL";
      throw err;
    }

    return {
      symbol,
      tradingsymbol: config.tradingsymbol ? String(config.tradingsymbol).trim() : symbol,
      symboltoken: config.symboltoken ? String(config.symboltoken).trim() : null,
      exchange,
      timeframe,
      assetType,
      optionType: config.optionType ? String(config.optionType).toUpperCase() : null,
      strikePrice:
        config.strikePrice !== undefined && config.strikePrice !== null
          ? Number(config.strikePrice)
          : null,
      expiry: config.expiry ? String(config.expiry) : null,
      initialCapital: round2(initialCapital),
      quantity: assetType === "EQUITY" ? quantity : lotSize * lots,
      lotSize: assetType === "OPTION" ? lotSize : 1,
      lots: assetType === "OPTION" ? lots : 1,
      autoSizeByRisk: config.autoSizeByRisk === true,
      feePerTrade: round2(feePerTrade),
      slippagePerUnit: round2(slippagePerUnit),
      entryFillModel,
      exitFillModel,
      exitOnTarget: config.exitOnTarget !== false,
      customStopLoss:
        config.customStopLoss !== undefined && config.customStopLoss !== null && config.customStopLoss !== ""
          ? Number(config.customStopLoss)
          : undefined,
      customTarget:
        config.customTarget !== undefined && config.customTarget !== null && config.customTarget !== ""
          ? Number(config.customTarget)
          : undefined,
      minConfidence:
        config.minConfidence !== undefined && config.minConfidence !== null
          ? Number(config.minConfidence)
          : 70,
      rewardRiskMultiple:
        config.rewardRiskMultiple !== undefined && config.rewardRiskMultiple !== null
          ? Number(config.rewardRiskMultiple)
          : 2.0,
      fromDate: fromMs !== null ? new Date(fromMs).toISOString() : null,
      toDate: toMs !== null ? new Date(toMs).toISOString() : null,
      strategyVersion: StrategyEngineMod?.STRATEGY_VERSION || "1.0.0-DETERMINISTIC",
      backtesterVersion: BACKTESTER_VERSION,
      limits: {
        maxLossPerTrade: round2(maxLossPerTrade),
        maxDailyLoss: round2(maxDailyLoss),
        maxTradesPerDay,
        maxOpenPositions: 1
      }
    };
  }

  function formatDurationLabel(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "0s";
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  }

  /**
   * Deterministic Chronological Backtest Engine
   * Preserves backward compatibility with all Tasks 1-12 tests while adding complete
   * Task 13 chronological simulation, look-ahead safeguards, gap/ambiguity handling,
   * risk enforcement, and performance metrics.
   */
  function run(config = {}) {
    const startWallMs = Date.now();
    const maxRuntimeMs = Number(config.maxRuntimeMs) || DEFAULTS.maxRuntimeMs;

    const validatedConfig = validateBacktestConfig(config);
    const candles = normalizeHistoricalSeries(config.candles || [], {
      maxCandles: config.maxCandles || DEFAULTS.maxCandlesLimit,
      nowMs: config.nowMs,
      rejectFutureTimestamps: config.rejectFutureTimestamps === true
    });

    const dataQualityReport = inspectDataQualityAndGaps(
      candles,
      validatedConfig.timeframe,
      config
    );

    const {
      symbol,
      exchange,
      timeframe,
      assetType,
      initialCapital,
      quantity,
      lotSize,
      lots,
      slippagePerUnit,
      feePerTrade,
      entryFillModel,
      exitFillModel,
      limits
    } = validatedConfig;

    let openPosition = null;
    let pendingSignalOrder = null;
    let dailyPnl = 0;
    let tradesToday = 0;
    let currentDayKey = null;

    let availableBalance = initialCapital;
    let reservedCapital = 0;
    let cumulativeGrossPnl = 0;
    let cumulativeNetPnl = 0;
    let cumulativeFees = 0;
    let cumulativeSlippage = 0;

    let peakPnlEquity = 0;
    let maxDrawdown = 0;
    let peakCapitalEquity = initialCapital;
    let maxDrawdownPct = 0;

    let riskViolations = 0;
    let safetyGateRejections = 0;
    let ambiguousExecutionsCount = 0;
    let gapExecutionsCount = 0;
    let emergencyStopHalted = Boolean(
      config.emergencyStop === true ||
        (AuditLoggerMod &&
          typeof AuditLoggerMod.isEmergencyStopActive === "function" &&
          AuditLoggerMod.isEmergencyStopActive() &&
          config.respectGlobalEmergencyStop === true)
    );

    const closedTrades = [];
    const simulatedFills = [];
    const simulatedOrders = [];
    const equityCurve = [0];
    const detailedEquityCurve = [
      {
        index: 0,
        timestamp: candles[0].timestamp,
        equity: initialCapital,
        cumulativeNetPnl: 0,
        cumulativeGrossPnl: 0,
        drawdown: 0,
        drawdownPct: 0,
        event: "INITIAL_CAPITAL"
      }
    ];
    const dailyPnlMap = new Map();

    function recordDailyEntry(dayKey) {
      if (!dailyPnlMap.has(dayKey)) {
        dailyPnlMap.set(dayKey, {
          date: dayKey,
          tradesOpened: 0,
          tradesClosed: 0,
          grossPnl: 0,
          feesAndSlippage: 0,
          netPnl: 0,
          dailyLossLocked: false,
          maxTradesReached: false
        });
      }
      return dailyPnlMap.get(dayKey);
    }

    function executeCloseOnCandle(pos, currentCandle, candleIndex, rawExitPrice, exitReason, meta = {}) {
      const effQty = pos.effectiveQty;
      const entrySlippageCost = slippagePerUnit * effQty;
      const exitSlippageCost = slippagePerUnit * effQty;
      const totalSlippageCost = round2(entrySlippageCost + exitSlippageCost);
      const totalFeeCost = round2(feePerTrade);
      const tradeCost = round2(totalSlippageCost + totalFeeCost);

      const grossPnl =
        pos.direction === "BUY"
          ? (rawExitPrice - pos.entry) * effQty
          : (pos.entry - rawExitPrice) * effQty;
      const pnl = grossPnl - tradeCost;

      dailyPnl = round2(dailyPnl + pnl);
      cumulativeGrossPnl = round2(cumulativeGrossPnl + grossPnl);
      cumulativeNetPnl = round2(cumulativeNetPnl + pnl);
      cumulativeFees = round2(cumulativeFees + totalFeeCost);
      cumulativeSlippage = round2(cumulativeSlippage + totalSlippageCost);

      reservedCapital = 0;
      availableBalance = round2(initialCapital + cumulativeNetPnl);

      equityCurve.push(round2(cumulativeNetPnl));

      if (cumulativeNetPnl > peakPnlEquity) {
        peakPnlEquity = cumulativeNetPnl;
      }
      const dd = round2(peakPnlEquity - cumulativeNetPnl);
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
      }

      const currentTotalEquity = round2(initialCapital + cumulativeNetPnl);
      if (currentTotalEquity > peakCapitalEquity) {
        peakCapitalEquity = currentTotalEquity;
      }
      const capitalDd = Math.max(0, peakCapitalEquity - currentTotalEquity);
      const capitalDdPct =
        peakCapitalEquity > 0 ? round2((capitalDd / peakCapitalEquity) * 100) : 0;
      if (capitalDdPct > maxDrawdownPct) {
        maxDrawdownPct = capitalDdPct;
      }

      const dayKey = currentCandle.timestamp.slice(0, 10);
      const dayStats = recordDailyEntry(dayKey);
      dayStats.tradesClosed += 1;
      dayStats.grossPnl = round2(dayStats.grossPnl + grossPnl);
      dayStats.feesAndSlippage = round2(dayStats.feesAndSlippage + tradeCost);
      dayStats.netPnl = round2(dayStats.netPnl + pnl);
      if (dailyPnl <= -limits.maxDailyLoss) {
        dayStats.dailyLossLocked = true;
      }

      const exitOrderId = `BT-ORD-EXIT-${closedTrades.length + 1}`;
      const exitFillId = `BT-FILL-EXIT-${closedTrades.length + 1}`;
      const tradeId = `BT-TRD-${closedTrades.length + 1}`;
      const exitSide = pos.direction === "BUY" ? "SELL" : "BUY";

      simulatedOrders.push({
        orderId: exitOrderId,
        fillId: exitFillId,
        tradeId,
        symbol,
        exchange,
        direction: exitSide,
        orderRole: "EXIT",
        orderType: "MARKET",
        status: "FILLED_BACKTEST",
        quantity: effQty,
        fillPrice: round2(rawExitPrice),
        timestamp: currentCandle.timestamp,
        reason: exitReason
      });

      simulatedFills.push({
        fillId: exitFillId,
        orderId: exitOrderId,
        tradeId,
        symbol,
        exchange,
        side: exitSide,
        fillRole: "EXIT",
        quantity: effQty,
        fillPrice: round2(rawExitPrice),
        slippage: round2(exitSlippageCost),
        fee: round2(totalFeeCost),
        timestamp: currentCandle.timestamp
      });

      const holdingDurationMs = Math.max(
        0,
        currentCandle.timestampMs - pos.openedAtMs
      );

      const tradeRecord = {
        tradeId,
        entryOrderId: pos.entryOrderId,
        exitOrderId,
        entryFillId: pos.entryFillId,
        exitFillId,
        symbol,
        exchange,
        assetType,
        direction: pos.direction,
        quantity: effQty,
        lotSize: pos.lotSize,
        lots: pos.lots,
        entry: round2(pos.entry),
        exit: round2(rawExitPrice),
        exitPrice: round2(rawExitPrice),
        stop: round2(pos.stop),
        target: round2(pos.target),
        grossPnl: round2(grossPnl),
        fees: round2(totalFeeCost),
        slippage: round2(totalSlippageCost),
        totalCosts: round2(tradeCost),
        pnl: round2(pnl),
        returnPct:
          pos.positionValue > 0 ? round2((pnl / pos.positionValue) * 100) : 0,
        outcome: pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN",
        reason: exitReason,
        ambiguousCandle: Boolean(meta.ambiguous),
        gapExecution: Boolean(meta.gapExecution),
        ambiguityNote: meta.ambiguityNote || null,
        openedAt: pos.openedAt,
        closedAt: currentCandle.timestamp,
        entryBarIndex: pos.entryBarIndex,
        exitBarIndex: candleIndex,
        holdingDurationMs,
        holdingDurationLabel: formatDurationLabel(holdingDurationMs)
      };

      closedTrades.push(tradeRecord);

      detailedEquityCurve.push({
        index: closedTrades.length,
        barIndex: candleIndex,
        timestamp: currentCandle.timestamp,
        equity: currentTotalEquity,
        cumulativeNetPnl: round2(cumulativeNetPnl),
        cumulativeGrossPnl: round2(cumulativeGrossPnl),
        tradePnl: round2(pnl),
        drawdown: round2(dd),
        drawdownPct: capitalDdPct,
        event: exitReason,
        tradeId
      });
    }

    // Strictly iterate through candles with slice(0, i + 1) so future candles are inaccessible
    for (let i = 0; i < candles.length; i += 1) {
      if (Date.now() - startWallMs > maxRuntimeMs) {
        const err = new Error(
          `Backtest execution exceeded maximum allowed runtime (${maxRuntimeMs}ms).`
        );
        err.code = "BACKTEST_TIMEOUT_EXCEEDED";
        throw err;
      }

      const visibleHistory = candles.slice(0, i + 1);
      const current = visibleHistory[visibleHistory.length - 1];
      const previous =
        visibleHistory.length > 1 ? visibleHistory[visibleHistory.length - 2] : null;

      const dayKey = current.timestamp.slice(0, 10);
      if (dayKey !== currentDayKey) {
        currentDayKey = dayKey;
        dailyPnl = 0;
        tradesToday = 0;
      }
      const dayStats = recordDailyEntry(dayKey);

      if (current.emergencyStop === true) {
        emergencyStopHalted = true;
      }

      // If NEXT_CANDLE_OPEN model queued a signal on candle i-1, execute entry at current candle open
      if (!openPosition && pendingSignalOrder && !emergencyStopHalted) {
        const fillEntryPrice = current.open;
        const entryGap = fillEntryPrice - pendingSignalOrder.plannedEntry;
        const adjustedStop = round2(pendingSignalOrder.plannedStop + entryGap);
        const adjustedTarget = round2(pendingSignalOrder.plannedTarget + entryGap);

        const riskEval = RiskEngineMod.evaluate({
          side: pendingSignalOrder.side,
          symbol,
          entry: fillEntryPrice,
          stop: adjustedStop,
          target: adjustedTarget,
          quantity: assetType === "OPTION" ? undefined : pendingSignalOrder.requestedQty,
          assetType,
          lotSize,
          lots: pendingSignalOrder.requestedLots,
          dailyPnl,
          tradesToday,
          openPositions: 0,
          availableBalance,
          limits,
          averaging: false,
          emergencyStop: emergencyStopHalted
        });

        if (!riskEval.allowed) {
          riskViolations += 1;
          simulatedOrders.push({
            orderId: `BT-ORD-REJ-${simulatedOrders.length + 1}`,
            symbol,
            exchange,
            direction: pendingSignalOrder.side,
            orderRole: "ENTRY",
            orderType: "MARKET",
            status: "REJECTED",
            quantity: pendingSignalOrder.requestedQty,
            timestamp: current.timestamp,
            rejectionReason: riskEval.reasons.join(" ")
          });
        } else {
          const effQty = riskEval.effectiveQuantity;
          const posVal = round2(fillEntryPrice * effQty);
          const entryOrdId = `BT-ORD-ENTRY-${simulatedOrders.length + 1}`;
          const entryFillId = `BT-FILL-ENTRY-${simulatedFills.length + 1}`;

          openPosition = {
            symbol,
            direction: pendingSignalOrder.side,
            entry: fillEntryPrice,
            stop: adjustedStop,
            target: adjustedTarget,
            effectiveQty: effQty,
            lotSize,
            lots: pendingSignalOrder.requestedLots,
            positionValue: posVal,
            openedAt: current.timestamp,
            openedAtMs: current.timestampMs,
            entryBarIndex: i,
            entryOrderId: entryOrdId,
            entryFillId
          };

          reservedCapital = posVal;
          availableBalance = round2(Math.max(0, availableBalance - posVal));
          tradesToday += 1;
          dayStats.tradesOpened += 1;
          if (tradesToday >= limits.maxTradesPerDay) {
            dayStats.maxTradesReached = true;
          }

          simulatedOrders.push({
            orderId: entryOrdId,
            fillId: entryFillId,
            symbol,
            exchange,
            direction: pendingSignalOrder.side,
            orderRole: "ENTRY",
            orderType: "MARKET",
            status: "FILLED_BACKTEST",
            quantity: effQty,
            fillPrice: round2(fillEntryPrice),
            stopLoss: adjustedStop,
            target: adjustedTarget,
            timestamp: current.timestamp
          });

          simulatedFills.push({
            fillId: entryFillId,
            orderId: entryOrdId,
            symbol,
            exchange,
            side: pendingSignalOrder.side,
            fillRole: "ENTRY",
            quantity: effQty,
            fillPrice: round2(fillEntryPrice),
            slippage: round2(slippagePerUnit * effQty),
            fee: 0,
            timestamp: current.timestamp
          });
        }
        pendingSignalOrder = null;
      }

      // 1. If a position is open, evaluate exits on current candle
      if (openPosition) {
        const effQty = openPosition.effectiveQty;
        let exitPrice = null;
        let exitReason = null;
        let ambiguous = false;
        let gapExecution = false;
        let ambiguityNote = null;

        // Priority 1: Emergency Stop
        if (emergencyStopHalted) {
          exitPrice = current.open;
          exitReason = "EMERGENCY_STOP";
        } else if (openPosition.direction === "BUY") {
          const hitStop = current.low <= openPosition.stop;
          const hitTarget = current.high >= openPosition.target;

          if (hitStop && hitTarget) {
            // Same-candle SL + Target ambiguity -> conservative STOP_LOSS first
            ambiguous = true;
            ambiguousExecutionsCount += 1;
            exitReason = "STOP_LOSS";
            if (
              exitFillModel === "CONSERVATIVE_GAP_AWARE" &&
              current.open < openPosition.stop
            ) {
              exitPrice = current.open;
              gapExecution = true;
              gapExecutionsCount += 1;
            } else {
              exitPrice = openPosition.stop;
            }
            ambiguityNote =
              "Candle reached both stop-loss and target; resolved conservatively as STOP_LOSS first.";
          } else if (hitStop) {
            exitReason = "STOP_LOSS";
            if (
              exitFillModel === "CONSERVATIVE_GAP_AWARE" &&
              current.open < openPosition.stop
            ) {
              exitPrice = current.open;
              gapExecution = true;
              gapExecutionsCount += 1;
            } else {
              exitPrice = openPosition.stop;
            }
          } else {
            // Check Priority 3: Intraday Risk Lock (-₹1,000 daily loss) at candle low
            const worstCaseUnrealized = (current.low - openPosition.entry) * effQty;
            if (dailyPnl + worstCaseUnrealized <= -limits.maxDailyLoss) {
              const lockDist = (-limits.maxDailyLoss - dailyPnl) / effQty;
              const lockPrice = round2(openPosition.entry + lockDist);
              exitPrice = Math.max(current.low, Math.min(current.high, lockPrice));
              exitReason = "RISK_LOCK";
            } else if (hitTarget && validatedConfig.exitOnTarget) {
              exitPrice = openPosition.target;
              exitReason = "TARGET";
            }
          }
        } else {
          // SELL position
          const hitStop = current.high >= openPosition.stop;
          const hitTarget = current.low <= openPosition.target;

          if (hitStop && hitTarget) {
            ambiguous = true;
            ambiguousExecutionsCount += 1;
            exitReason = "STOP_LOSS";
            if (
              exitFillModel === "CONSERVATIVE_GAP_AWARE" &&
              current.open > openPosition.stop
            ) {
              exitPrice = current.open;
              gapExecution = true;
              gapExecutionsCount += 1;
            } else {
              exitPrice = openPosition.stop;
            }
            ambiguityNote =
              "Candle reached both stop-loss and target; resolved conservatively as STOP_LOSS first.";
          } else if (hitStop) {
            exitReason = "STOP_LOSS";
            if (
              exitFillModel === "CONSERVATIVE_GAP_AWARE" &&
              current.open > openPosition.stop
            ) {
              exitPrice = current.open;
              gapExecution = true;
              gapExecutionsCount += 1;
            } else {
              exitPrice = openPosition.stop;
            }
          } else {
            const worstCaseUnrealized = (openPosition.entry - current.high) * effQty;
            if (dailyPnl + worstCaseUnrealized <= -limits.maxDailyLoss) {
              const lockDist = (-limits.maxDailyLoss - dailyPnl) / effQty;
              const lockPrice = round2(openPosition.entry - lockDist);
              exitPrice = Math.max(current.low, Math.min(current.high, lockPrice));
              exitReason = "RISK_LOCK";
            } else if (hitTarget && validatedConfig.exitOnTarget) {
              exitPrice = openPosition.target;
              exitReason = "TARGET";
            }
          }
        }

        // Force close on final candle of series
        if (exitPrice === null && i === candles.length - 1) {
          exitPrice = current.close;
          exitReason = "END_OF_SERIES";
        }

        if (exitPrice !== null) {
          executeCloseOnCandle(openPosition, current, i, exitPrice, exitReason, {
            ambiguous,
            gapExecution,
            ambiguityNote
          });
          openPosition = null;
          continue;
        }
      }

      // 2. If no position is open, not halted by Emergency Stop, and not on the last candle, evaluate Strategy -> RiskEngine -> AISafetyGate
      if (!openPosition && !pendingSignalOrder && !emergencyStopHalted && i < candles.length - 1) {
        const quoteObj = {
          price: current.close,
          open: current.open,
          high: current.high,
          low: current.low,
          previousClose: previous ? previous.close : current.open,
          volume: current.volume,
          timestamp: current.timestamp,
          dataReady: true
        };

        // Strictly pass visibleHistory (candles[0..i]) so zero future candles are visible
        const derived =
          current.indicators ||
          (MarketDataMod
            ? MarketDataMod.deriveIndicatorsFromQuote(quoteObj, visibleHistory)
            : {});

        const analysis = MarketAnalysisMod.analyze({
          dataReady: true,
          assetType,
          ...derived
        });

        const aiDecision = current.aiDecision || config.aiDecision || null;

        const strategy = StrategyEngineMod.evaluate({
          dataReady: true,
          symbol,
          exchange,
          analysis,
          indicators: derived,
          candles: visibleHistory,
          aiDecision,
          price: current.close,
          assetType,
          optionType: validatedConfig.optionType,
          strikePrice: validatedConfig.strikePrice,
          expiry: validatedConfig.expiry,
          lotSize,
          stopLoss: validatedConfig.customStopLoss,
          target: validatedConfig.customTarget,
          minConfidence: validatedConfig.minConfidence,
          rewardRiskMultiple: validatedConfig.rewardRiskMultiple,
          emergencyStop: emergencyStopHalted
        });

        if (
          strategy &&
          strategy.action !== "NO_TRADE" &&
          strategy.action !== "HOLD" &&
          Number.isFinite(Number(strategy.entry)) &&
          Number(strategy.entry) > 0 &&
          Number.isFinite(Number(strategy.stopLoss)) &&
          Number(strategy.stopLoss) > 0 &&
          Number.isFinite(Number(strategy.target)) &&
          Number(strategy.target) > 0
        ) {
          const side =
            strategy.tradeSide === "SELL" || strategy.action === "SELL"
              ? "SELL"
              : "BUY";

          let reqQty = validatedConfig.quantity;
          let reqLots = lots;

          if (validatedConfig.autoSizeByRisk && RiskEngineMod?.calculateSafePositionSize) {
            const safeSize = RiskEngineMod.calculateSafePositionSize({
              side,
              assetType,
              entry: strategy.entry,
              stop: strategy.stopLoss,
              lotSize,
              dailyPnl,
              availableBalance,
              limits
            });
            if (safeSize && safeSize.ok) {
              reqQty = safeSize.recommendedQuantity;
              reqLots = safeSize.recommendedLots || 1;
            }
          }

          const riskEval = RiskEngineMod.evaluate({
            side,
            symbol,
            entry: strategy.entry,
            stop: strategy.stopLoss,
            target: strategy.target,
            quantity: assetType === "OPTION" ? undefined : reqQty,
            assetType,
            lotSize,
            lots: reqLots,
            dailyPnl,
            tradesToday,
            openPositions: openPosition ? 1 : 0,
            availableBalance,
            limits,
            averaging: false,
            emergencyStop: emergencyStopHalted
          });

          const safetyEval = AISafetyGateMod
            ? AISafetyGateMod.evaluate({
                dataReady: true,
                signal: strategy.signal || analysis.signal,
                confidence: strategy.confidence,
                risk: strategy.risk || analysis.risk,
                assetType,
                optionType: validatedConfig.optionType,
                side,
                stopLoss: strategy.stopLoss,
                riskCheck: riskEval,
                emergencyStop: emergencyStopHalted,
                liveTradingEnabled: false
              })
            : { allowed: riskEval.allowed, reasons: riskEval.reasons || [] };

          if (!riskEval.allowed) {
            riskViolations += 1;
            if (dailyPnl <= -limits.maxDailyLoss) {
              dayStats.dailyLossLocked = true;
            }
            if (tradesToday >= limits.maxTradesPerDay) {
              dayStats.maxTradesReached = true;
            }
            simulatedOrders.push({
              orderId: `BT-ORD-REJ-${simulatedOrders.length + 1}`,
              symbol,
              exchange,
              direction: side,
              orderRole: "ENTRY",
              orderType: "MARKET",
              status: "REJECTED",
              quantity: assetType === "OPTION" ? reqLots * lotSize : reqQty,
              stopLoss: strategy.stopLoss,
              target: strategy.target,
              timestamp: current.timestamp,
              rejectionReason: riskEval.reasons.join(" ")
            });
          } else if (!safetyEval.allowed) {
            safetyGateRejections += 1;
            simulatedOrders.push({
              orderId: `BT-ORD-REJ-${simulatedOrders.length + 1}`,
              symbol,
              exchange,
              direction: side,
              orderRole: "ENTRY",
              orderType: "MARKET",
              status: "REJECTED",
              quantity: riskEval.effectiveQuantity,
              stopLoss: strategy.stopLoss,
              target: strategy.target,
              timestamp: current.timestamp,
              rejectionReason: (safetyEval.reasons || []).join(" ")
            });
          } else if (entryFillModel === "NEXT_CANDLE_OPEN") {
            pendingSignalOrder = {
              side,
              plannedEntry: strategy.entry,
              plannedStop: strategy.stopLoss,
              plannedTarget: strategy.target,
              requestedQty: reqQty,
              requestedLots: reqLots,
              signalTimestamp: current.timestamp
            };
          } else {
            const effQty = riskEval.effectiveQuantity;
            const posVal = round2(strategy.entry * effQty);
            const entryOrdId = `BT-ORD-ENTRY-${simulatedOrders.length + 1}`;
            const entryFillId = `BT-FILL-ENTRY-${simulatedFills.length + 1}`;

            openPosition = {
              symbol,
              direction: side,
              entry: strategy.entry,
              stop: strategy.stopLoss,
              target: strategy.target,
              effectiveQty: effQty,
              lotSize,
              lots: reqLots,
              positionValue: posVal,
              openedAt: current.timestamp,
              openedAtMs: current.timestampMs,
              entryBarIndex: i,
              entryOrderId: entryOrdId,
              entryFillId
            };

            reservedCapital = posVal;
            availableBalance = round2(Math.max(0, availableBalance - posVal));
            tradesToday += 1;
            dayStats.tradesOpened += 1;
            if (tradesToday >= limits.maxTradesPerDay) {
              dayStats.maxTradesReached = true;
            }

            simulatedOrders.push({
              orderId: entryOrdId,
              fillId: entryFillId,
              symbol,
              exchange,
              direction: side,
              orderRole: "ENTRY",
              orderType: "MARKET",
              status: "FILLED_BACKTEST",
              quantity: effQty,
              fillPrice: round2(strategy.entry),
              stopLoss: round2(strategy.stopLoss),
              target: round2(strategy.target),
              timestamp: current.timestamp
            });

            simulatedFills.push({
              fillId: entryFillId,
              orderId: entryOrdId,
              symbol,
              exchange,
              side,
              fillRole: "ENTRY",
              quantity: effQty,
              fillPrice: round2(strategy.entry),
              slippage: round2(slippagePerUnit * effQty),
              fee: 0,
              timestamp: current.timestamp
            });
          }
        }
      }
    }

    const totalTrades = closedTrades.length;
    const winningTrades = closedTrades.filter((t) => t.pnl > 0);
    const losingTrades = closedTrades.filter((t) => t.pnl <= 0);
    const strictlyLosingTrades = closedTrades.filter((t) => t.pnl < 0);
    const breakevenTrades = closedTrades.filter((t) => t.pnl === 0);

    const wins = winningTrades.length;
    const losses = losingTrades.length;
    const breakevenCount = breakevenTrades.length;
    const winRate =
      totalTrades > 0 ? Math.round((wins / totalTrades) * 10000) / 100 : 0;

    const grossProfit = round2(winningTrades.reduce((sum, t) => sum + t.pnl, 0));
    const grossLoss = round2(
      Math.abs(strictlyLosingTrades.reduce((sum, t) => sum + t.pnl, 0))
    );

    const profitFactor =
      grossLoss > 0
        ? Math.round((grossProfit / grossLoss) * 100) / 100
        : grossProfit > 0
          ? Infinity
          : 0;

    const profitFactorValid = grossLoss > 0;
    const profitFactorDisplay =
      totalTrades === 0
        ? "N/A (No Closed Trades)"
        : grossLoss > 0
          ? String(profitFactor)
          : grossProfit > 0
            ? "N/A (No Losing Trades)"
            : "0.00";

    const averageWin =
      wins > 0 ? Math.round((grossProfit / wins) * 100) / 100 : 0;
    const averageLoss =
      strictlyLosingTrades.length > 0
        ? Math.round((grossLoss / strictlyLosingTrades.length) * 100) / 100
        : 0;

    const expectancy =
      totalTrades > 0
        ? Math.round((cumulativeNetPnl / totalTrades) * 100) / 100
        : 0;

    // Longest winning and losing streaks
    let longestWinningStreak = 0;
    let longestLosingStreak = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    for (const tr of closedTrades) {
      if (tr.pnl > 0) {
        currentWinStreak += 1;
        currentLossStreak = 0;
        if (currentWinStreak > longestWinningStreak) {
          longestWinningStreak = currentWinStreak;
        }
      } else if (tr.pnl < 0) {
        currentLossStreak += 1;
        currentWinStreak = 0;
        if (currentLossStreak > longestLosingStreak) {
          longestLosingStreak = currentLossStreak;
        }
      } else {
        currentWinStreak = 0;
        currentLossStreak = 0;
      }
    }

    const totalHoldingMs = closedTrades.reduce(
      (sum, t) => sum + Number(t.holdingDurationMs || 0),
      0
    );
    const averageHoldingDurationMs =
      totalTrades > 0 ? Math.round(totalHoldingMs / totalTrades) : 0;

    // Exit-reason breakdown
    const exitReasonMap = new Map();
    for (const tr of closedTrades) {
      const rKey = tr.reason || "OTHER";
      if (!exitReasonMap.has(rKey)) {
        exitReasonMap.set(rKey, {
          reason: rKey,
          count: 0,
          wins: 0,
          losses: 0,
          grossPnl: 0,
          netPnl: 0
        });
      }
      const bucket = exitReasonMap.get(rKey);
      bucket.count += 1;
      if (tr.pnl > 0) bucket.wins += 1;
      else if (tr.pnl < 0) bucket.losses += 1;
      bucket.grossPnl = round2(bucket.grossPnl + tr.grossPnl);
      bucket.netPnl = round2(bucket.netPnl + tr.pnl);
    }

    const finalEquity = round2(initialCapital + cumulativeNetPnl);
    const returnPct =
      initialCapital > 0 ? round2((cumulativeNetPnl / initialCapital) * 100) : 0;

    const runStatus =
      totalTrades > 0
        ? "COMPLETED"
        : dataQualityReport.qualityTier === "INSUFFICIENT_WARMUP_HISTORY"
          ? "INSUFFICIENT_DATA"
          : "NO_TRADES_GENERATED";

    const result = {
      ok: true,
      mode: "PAPER",
      liveTradingEnabled: false,
      brokerExecution: "NONE",
      runStatus,
      symbol,
      exchange,
      timeframe,
      assetType,
      strategyVersion: validatedConfig.strategyVersion,
      backtesterVersion: BACKTESTER_VERSION,
      candlesProcessed: candles.length,
      configuration: validatedConfig,
      assumptions: DOCUMENTED_BACKTEST_RULES.executionAssumptions,
      dataQuality: dataQualityReport,
      metrics: {
        runStatus,
        initialCapital,
        finalEquity,
        returnPct,
        totalTrades,
        wins,
        losses,
        strictlyLosingTrades: strictlyLosingTrades.length,
        breakevenTrades: breakevenCount,
        winRate,
        grossProfit,
        grossLoss,
        grossPnl: round2(cumulativeGrossPnl),
        netPnl: round2(cumulativeNetPnl),
        totalFees: round2(cumulativeFees),
        totalSlippage: round2(cumulativeSlippage),
        totalCosts: round2(cumulativeFees + cumulativeSlippage),
        maxDrawdown: round2(maxDrawdown),
        maxDrawdownPct: round2(maxDrawdownPct),
        profitFactor,
        profitFactorValid,
        profitFactorDisplay,
        expectancy,
        expectancyValid: totalTrades > 0,
        averageWin,
        averageLoss,
        averageHoldingDurationMs,
        averageHoldingDurationLabel: formatDurationLabel(averageHoldingDurationMs),
        longestWinningStreak,
        longestLosingStreak,
        riskViolations,
        safetyGateRejections,
        ambiguousExecutionsCount,
        gapExecutionsCount,
        emergencyStopHalted
      },
      trades: closedTrades,
      fills: simulatedFills,
      orders: simulatedOrders,
      dailyPnlBreakdown: Array.from(dailyPnlMap.values()),
      exitReasonBreakdown: Array.from(exitReasonMap.values()),
      equityCurve,
      detailedEquityCurve,
      disclaimer: DOCUMENTED_BACKTEST_RULES.disclaimer,
      completedAt: new Date().toISOString()
    };

    if (ServerDbRefBacktest && config.persist !== false) {
      try {
        const persistedId = ServerDbRefBacktest.insertBacktestRun(
          result,
          config.userId || null,
          { clientRunKey: config.clientRunKey || null }
        );
        if (persistedId) {
          result.runId = persistedId;
        }
      } catch (_) {}
    }

    return result;
  }

  return {
    BACKTESTER_VERSION,
    SUPPORTED_TIMEFRAMES,
    DEFAULTS,
    DOCUMENTED_BACKTEST_RULES,
    normalizeTimeframe,
    normalizeCandle,
    normalizeHistoricalSeries,
    inspectDataQualityAndGaps,
    validateBacktestConfig,
    run
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = Backtester;
}
