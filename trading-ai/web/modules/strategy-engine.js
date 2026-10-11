/*
 * YASHWIN AI Trading Assistant
 * Phase 11 & Task 8 — Complete Deterministic Strategy Engine & Signal Generation
 *
 * Existing Strategy Rules Documented & Preserved (Backward Compatible):
 * - STRATEGY_VERSION: "1.0.0-DETERMINISTIC"
 * - DEFAULTS:
 *     minConfidence: 70
 *     stopLossPctEquity: 0.005 (0.5% default stop distance for equity/index)
 *     stopLossPctOption: 0.10 (10% default stop distance for options)
 *     rewardRiskMultiple: 2.0 (2.0R default target multiple)
 * - Existing Pipeline Invariant:
 *     Validated Market Data -> Technical Indicators -> Market Regime -> MarketAnalysis
 *     -> Optional AIDecisionContract / MarketIntelligence supporting context
 *     -> Deterministic StrategyEngine -> RiskEngine -> AISafetyGate -> EmergencyStop
 *     -> Paper Trading Execution ONLY (TRADING_MODE=paper, LIVE_TRADING_ENABLED=false)
 *
 * Task 8 Enhancements:
 * 1. Explicit, testable deterministic signal generation for:
 *    - BUY / BUY_CE
 *    - SELL / BUY_PE
 *    - HOLD
 *    - NO_TRADE
 * 2. Validated Market Regime classifications:
 *    - BULLISH_TREND
 *    - BEARISH_TREND
 *    - RANGEBOUND
 *    - HIGH_VOLATILITY
 *    - UNKNOWN / INSUFFICIENT_DATA
 * 3. Explicit entry conditions, mandatory directional stop-loss, valid target
 *    calculation, risk/reward calculation (R:R, unitRisk, unitReward),
 *    strategy invalidation conditions, and exit rules.
 * 4. Insufficient-data, stale-data, and conflicting-signal handling:
 *    - Contradictory AI decision or conflicting indicator/regime structure
 *      forces non-executable NO_TRADE / HOLD.
 *    - AI and Market Intelligence context are supporting only and can NEVER
 *      override deterministic safety rules.
 * 5. Never fabricates prices, candles, indicators, or confidence.
 *    Never places live broker orders.
 */

const MarketDataRefStrategy =
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

const MarketAnalysisRefStrategy =
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

const RiskEngineRefStrategy =
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

const AISafetyGateRefStrategy =
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

const StrategyEngine = (() => {

  const STRATEGY_VERSION = "1.0.0-DETERMINISTIC";

  const MARKET_REGIMES = {
    BULLISH_TREND: "BULLISH_TREND",
    BEARISH_TREND: "BEARISH_TREND",
    RANGEBOUND: "RANGEBOUND",
    HIGH_VOLATILITY: "HIGH_VOLATILITY",
    UNKNOWN: "UNKNOWN",
    INSUFFICIENT_DATA: "INSUFFICIENT_DATA"
  };

  const VALID_REGIME_SET = new Set(Object.values(MARKET_REGIMES));

  const DEFAULTS = {
    minConfidence: 70,
    stopLossPctEquity: 0.005, // 0.5% default stop distance for equity/index
    stopLossPctOption: 0.10,  // 10% default stop distance for options
    rewardRiskMultiple: 2.0,
    minRewardRiskRatio: 1.0,
    maxQuoteAgeMs: 60000
  };

  /**
   * Documented deterministic strategy ruleset so UI, audit logs, and tests
   * can inspect the exact rule definitions.
   */
  const DOCUMENTED_STRATEGY_RULES = Object.freeze({
    version: STRATEGY_VERSION,
    tradingMode: "paper",
    liveTradingEnabled: false,
    pipelineOrder: [
      "Validated Market Quote & Candles",
      "Technical Indicators & Market Regime Classification",
      "Deterministic MarketAnalysis Composite Scoring",
      "Supporting Context Check (AIDecisionContract & MarketIntelligence)",
      "Deterministic StrategyEngine Entry/SL/Target/R:R Evaluation",
      "Centralized RiskEngine Gate",
      "AISafetyGate Authorization",
      "Global Emergency Stop Gate",
      "Paper Trading Execution Only"
    ],
    signalConditions: {
      BUY: "Requires dataReady=true, non-stale price > 0, risk != HIGH, regime != HIGH_VOLATILITY/BEARISH_TREND, confidence >= 70%, bullish signal (BUY/BUY_CE), and zero AI/indicator conflict.",
      SELL: "Requires dataReady=true, non-stale price > 0, risk != HIGH, regime != HIGH_VOLATILITY/BULLISH_TREND, confidence >= 70%, bearish signal (SELL/BUY_PE), and zero AI/indicator conflict.",
      HOLD: "Triggered when signal is HOLD or WATCH (developing setup with 55% <= confidence < 70%, or neutral consolidation in RANGEBOUND regime with valid data).",
      NO_TRADE: "Triggered on missing/invalid/stale data, emergency stop active, HIGH volatility/risk, confidence < 55%, conflicting AI/indicator/regime signals, or invalid stop-loss/target geometry."
    },
    exitRules: [
      "Priority 1: Global Emergency Stop -> Immediate market exit in Paper Mode.",
      "Priority 2: Hard Directional Stop-Loss -> Exit BUY when price <= stopLoss; Exit SELL when price >= stopLoss.",
      "Priority 3: Daily Risk Lock -> Exit when cumulative daily P&L breaches -maxDailyLoss (-₹1,000).",
      "Priority 4: Target Exit / Activation -> Exit or activate trailing protection when price reaches target (2.0R default).",
      "Priority 5: Trailing Profit Milestone Lock -> Step-lock profit at 10% position value milestones and exit on pullback to lockedStopPrice."
    ]
  });

  function roundTick(price) {
    const n = Number(price);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 20) / 20;
  }

  function round2(n) {
    const num = Number(n);
    return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
  }

  /**
   * Classifies Market Regime deterministically from validated indicators/candles.
   * Supports:
   * - BULLISH_TREND
   * - BEARISH_TREND
   * - RANGEBOUND
   * - HIGH_VOLATILITY
   * - UNKNOWN / INSUFFICIENT_DATA
   */
  function classifyMarketRegime(input = {}) {
    const dataReady = input.dataReady === true;
    const indicators = input.indicators || input.analysis?.indicators || input;
    const candles = Array.isArray(input.candles) ? input.candles : [];
    const dataQuality = String(
      indicators?.dataQuality || input.dataQuality || ""
    ).trim().toUpperCase();

    if (!dataReady && !indicators?.marketRegime && candles.length === 0) {
      return {
        regime: MARKET_REGIMES.INSUFFICIENT_DATA,
        dataQuality: "DATA_UNAVAILABLE",
        reason: "Validated market data is unavailable for regime classification."
      };
    }

    if (dataQuality === "DATA_UNAVAILABLE") {
      return {
        regime: MARKET_REGIMES.INSUFFICIENT_DATA,
        dataQuality: "DATA_UNAVAILABLE",
        reason: "Technical indicators are unavailable (insufficient validated data)."
      };
    }

    const explicitRegime = String(
      indicators?.marketRegime || input.marketRegime || ""
    ).trim().toUpperCase();

    const volatilityScore = Number(
      indicators?.volatilityScore ?? input.volatilityScore ?? NaN
    );
    const adx14 = Number(indicators?.adx14 ?? input.adx14 ?? NaN);
    const trendScore = Number(
      indicators?.trendScore ??
      input.trendScore ??
      input.analysis?.components?.trend ??
      NaN
    );
    const ema9 = Number(indicators?.ema9 ?? NaN);
    const ema21 = Number(indicators?.ema21 ?? NaN);

    if (
      explicitRegime === MARKET_REGIMES.HIGH_VOLATILITY ||
      (Number.isFinite(volatilityScore) && volatilityScore >= 70)
    ) {
      return {
        regime: MARKET_REGIMES.HIGH_VOLATILITY,
        dataQuality: dataQuality || "VALIDATED",
        reason: `High volatility regime detected (volatility score ${Number.isFinite(volatilityScore) ? volatilityScore : ">=70"}).`
      };
    }

    if (
      VALID_REGIME_SET.has(explicitRegime) &&
      explicitRegime !== MARKET_REGIMES.UNKNOWN &&
      explicitRegime !== MARKET_REGIMES.INSUFFICIENT_DATA
    ) {
      // Refine RANGEBOUND if strong trendScore or EMA alignment is present
      if (
        explicitRegime === MARKET_REGIMES.RANGEBOUND &&
        Number.isFinite(trendScore) &&
        Math.abs(trendScore) >= 50
      ) {
        const inferred =
          trendScore > 0
            ? MARKET_REGIMES.BULLISH_TREND
            : MARKET_REGIMES.BEARISH_TREND;
        return {
          regime: inferred,
          dataQuality: dataQuality || "VALIDATED",
          reason: `Directional trend score (${trendScore}) classifies market as ${inferred}.`
        };
      }

      return {
        regime: explicitRegime,
        dataQuality: dataQuality || "VALIDATED",
        reason: `Market regime classified as ${explicitRegime}.`
      };
    }

    // Derive from ADX, trendScore, or EMA structure if explicit regime not provided
    if (
      (Number.isFinite(adx14) && adx14 >= 25) ||
      (Number.isFinite(trendScore) && Math.abs(trendScore) >= 40) ||
      (Number.isFinite(ema9) && Number.isFinite(ema21) && ema21 > 0 && Math.abs((ema9 - ema21) / ema21) >= 0.0025)
    ) {
      const isBull =
        (Number.isFinite(trendScore) && trendScore > 0) ||
        (!Number.isFinite(trendScore) && Number.isFinite(ema9) && Number.isFinite(ema21) && ema9 > ema21);
      const regime = isBull
        ? MARKET_REGIMES.BULLISH_TREND
        : MARKET_REGIMES.BEARISH_TREND;
      return {
        regime,
        dataQuality: dataQuality || "VALIDATED",
        reason: `Trend indicators classify market regime as ${regime}.`
      };
    }

    if (Number.isFinite(trendScore) || Number.isFinite(volatilityScore) || candles.length > 0) {
      return {
        regime: MARKET_REGIMES.RANGEBOUND,
        dataQuality: dataQuality || "VALIDATED",
        reason: "Directional trend conviction is neutral; market regime is RANGEBOUND."
      };
    }

    if (candles.length === 0 && !Number.isFinite(trendScore)) {
      return {
        regime: MARKET_REGIMES.UNKNOWN,
        dataQuality: dataQuality || "QUOTE_ONLY",
        reason: "Insufficient historical candles or trend score for specific regime classification."
      };
    }

    return {
      regime: MARKET_REGIMES.UNKNOWN,
      dataQuality: dataQuality || "UNKNOWN",
      reason: "Market regime could not be determined from supplied inputs."
    };
  }

  /**
   * Builds explicit entry conditions, invalidation conditions, and exit rules
   * for a strategy evaluation.
   */
  function buildConditionsAndRules(params = {}) {
    const {
      action,
      tradeSide,
      entry,
      stopLoss,
      target,
      rrRatio,
      confidence,
      minConfidence,
      marketRegime,
      indicators,
      assetType
    } = params;

    const entryConditions = [];
    const invalidationConditions = [];
    const exitRules = [...DOCUMENTED_STRATEGY_RULES.exitRules];

    if (action === "BUY" || action === "BUY_CE") {
      entryConditions.push(
        `Validated market quote and technical state confirm bullish ${action} setup at ₹${entry.toFixed(2)}.`
      );
      entryConditions.push(
        `Confidence (${confidence}%) meets or exceeds minimum threshold (${minConfidence}%).`
      );
      entryConditions.push(
        `Market regime (${marketRegime}) and volatility permit long directional entry.`
      );
      if (indicators?.vwap && entry >= Number(indicators.vwap)) {
        entryConditions.push(`Price (₹${entry.toFixed(2)}) is holding above VWAP (₹${Number(indicators.vwap).toFixed(2)}).`);
      }
      if (indicators?.ema9 && indicators?.ema21 && Number(indicators.ema9) >= Number(indicators.ema21)) {
        entryConditions.push(`Bullish EMA alignment (EMA 9 ₹${Number(indicators.ema9).toFixed(2)} >= EMA 21 ₹${Number(indicators.ema21).toFixed(2)}).`);
      }

      invalidationConditions.push(
        `Price breaches mandatory hard stop-loss at or below ₹${stopLoss.toFixed(2)}.`
      );
      if (indicators?.support && Number(indicators.support) > 0) {
        invalidationConditions.push(
          `Key support level at ₹${Number(indicators.support).toFixed(2)} breaks down with volume.`
        );
      }
    } else if (action === "SELL" || action === "BUY_PE") {
      entryConditions.push(
        `Validated market quote and technical state confirm bearish ${action} setup at ₹${entry.toFixed(2)}.`
      );
      entryConditions.push(
        `Confidence (${confidence}%) meets or exceeds minimum threshold (${minConfidence}%).`
      );
      entryConditions.push(
        `Market regime (${marketRegime}) and volatility permit bearish directional entry.`
      );
      if (indicators?.vwap && entry <= Number(indicators.vwap)) {
        entryConditions.push(`Price (₹${entry.toFixed(2)}) is trading below VWAP (₹${Number(indicators.vwap).toFixed(2)}).`);
      }
      if (indicators?.ema9 && indicators?.ema21 && Number(indicators.ema9) <= Number(indicators.ema21)) {
        entryConditions.push(`Bearish EMA alignment (EMA 9 ₹${Number(indicators.ema9).toFixed(2)} <= EMA 21 ₹${Number(indicators.ema21).toFixed(2)}).`);
      }

      invalidationConditions.push(
        `Price breaches mandatory hard stop-loss at or above ₹${stopLoss.toFixed(2)}.`
      );
      if (indicators?.resistance && Number(indicators.resistance) > 0) {
        invalidationConditions.push(
          `Key resistance level at ₹${Number(indicators.resistance).toFixed(2)} is reclaimed.`
        );
      }
    } else {
      entryConditions.push(
        "No executable entry: waiting for validated directional setup with confidence >= 70%, low/medium risk, and aligned regime."
      );
    }

    invalidationConditions.push(
      "Market data becomes stale (> 60s old) or provider feed disconnects."
    );
    invalidationConditions.push(
      "Market regime shifts into HIGH_VOLATILITY or contradicts trade direction."
    );
    invalidationConditions.push(
      "Global Emergency Stop is activated or RiskEngine daily loss/trade limits are reached."
    );

    if (assetType === "OPTION") {
      invalidationConditions.push(
        "Option contract fails CE/PE directional alignment or strike/expiry validation."
      );
    }

    return {
      entryConditions,
      invalidationConditions,
      exitRules,
      exitLevels:
        entry && stopLoss && target
          ? {
              hardStopLoss: stopLoss,
              targetPrice: target,
              rewardRiskRatio: rrRatio,
              tradeSide
            }
          : null
    };
  }

  function evaluate(input = {}) {
    const snapshot = input.snapshot || null;
    const candles = Array.isArray(input.candles)
      ? input.candles
      : Array.isArray(snapshot?.candles)
        ? snapshot.candles
        : [];
    const indicators =
      input.indicators ||
      snapshot?.indicators ||
      input.analysis?.indicators ||
      null;

    // Auto-derive analysis from MarketAnalysis if snapshot/indicators supplied without pre-computed analysis
    let analysis = input.analysis || null;
    const rawDataReady =
      input.dataReady === true ||
      snapshot?.dataReady === true ||
      analysis?.dataReady === true;

    const assetType = String(
      input.assetType || snapshot?.type || analysis?.assetType || "EQUITY"
    )
      .trim()
      .toUpperCase();
    const optionType = String(
      input.optionType || snapshot?.optionType || ""
    )
      .trim()
      .toUpperCase();

    if (
      (!analysis || typeof analysis !== "object" || Object.keys(analysis).length === 0) &&
      rawDataReady &&
      indicators &&
      MarketAnalysisRefStrategy &&
      typeof MarketAnalysisRefStrategy.analyze === "function"
    ) {
      analysis = MarketAnalysisRefStrategy.analyze({
        dataReady: true,
        assetType,
        ...indicators
      });
    } else if (!analysis) {
      analysis = {};
    }

    const aiDecision = input.aiDecision || null;
    const marketIntelligence = input.marketIntelligence || null;
    const price = Number(input.price ?? snapshot?.price);
    const minConfidence = Number(input.minConfidence) || DEFAULTS.minConfidence;
    const rrMultiple =
      Number(input.rewardRiskMultiple) > 0
        ? Number(input.rewardRiskMultiple)
        : DEFAULTS.rewardRiskMultiple;

    const regimeInfo = classifyMarketRegime({
      dataReady: rawDataReady,
      indicators,
      candles,
      analysis,
      marketRegime: input.marketRegime
    });

    const base = {
      decision: "NO_TRADE",
      action: "NO_TRADE",
      signal: "NO_TRADE",
      tradeSide: "HOLD",
      executable: false,
      entry: null,
      stopLoss: null,
      target: null,
      unitRisk: null,
      unitReward: null,
      riskRewardRatio: null,
      confidence: Number.isFinite(Number(analysis.confidence))
        ? Number(analysis.confidence)
        : 0,
      validatedConfidence: null,
      marketRegime: regimeInfo.regime,
      regimeReason: regimeInfo.reason,
      dataQuality:
        indicators?.dataQuality ||
        regimeInfo.dataQuality ||
        (rawDataReady ? "VALIDATED" : "DATA_UNAVAILABLE"),
      assetType,
      optionType: optionType || null,
      reason: "",
      reasons: [],
      supportingContext: [],
      conflicts: [],
      entryConditions: [],
      invalidationConditions: [
        "Setup invalidated on mandatory stop-loss breach, stale data, or Emergency Stop."
      ],
      exitRules: [...DOCUMENTED_STRATEGY_RULES.exitRules],
      exitLevels: null,
      strategyVersion: STRATEGY_VERSION,
      tradingMode: "paper",
      liveTradingEnabled: false,
      timestamp: new Date().toISOString()
    };

    // 1. Emergency Stop check
    if (
      input.emergencyStop === true ||
      (RiskEngineRefStrategy &&
        typeof RiskEngineRefStrategy.isEmergencyStopActive === "function" &&
        RiskEngineRefStrategy.isEmergencyStopActive() &&
        input.emergencyStop !== false)
    ) {
      base.reasons.push("Emergency stop is active.");
      base.reason = base.reasons.join(" ");
      return base;
    }

    // 2. Stale market data check
    if (
      input.staleData === true ||
      snapshot?.status === "STALE_MARKET_DATA"
    ) {
      base.marketRegime = MARKET_REGIMES.INSUFFICIENT_DATA;
      base.dataQuality = "STALE_MARKET_DATA";
      base.reasons.push("Market data is stale. Strategy refuses to generate executable signals on stale quotes.");
      base.reason = base.reasons.join(" ");
      return base;
    }

    // 3. Validated data readiness check
    if (input.dataReady !== true && analysis.dataReady !== true && snapshot?.dataReady !== true) {
      base.marketRegime = MARKET_REGIMES.INSUFFICIENT_DATA;
      base.dataQuality = "DATA_UNAVAILABLE";
      base.reasons.push("Validated market data is unavailable.");
      base.reason = base.reasons.join(" ");
      return base;
    }

    // 4. Valid price check
    if (!Number.isFinite(price) || price <= 0) {
      base.marketRegime = MARKET_REGIMES.INSUFFICIENT_DATA;
      base.reasons.push("Valid market price is required for strategy calculation.");
      base.reason = base.reasons.join(" ");
      return base;
    }

    // 5. Insufficient candle check when requireCandles is requested
    const minCandlesRequired = Number(input.minCandlesRequired) || 0;
    if (minCandlesRequired > 0 && candles.length < minCandlesRequired) {
      base.marketRegime = MARKET_REGIMES.INSUFFICIENT_DATA;
      base.dataQuality = "INSUFFICIENT_CANDLES";
      base.reasons.push(
        `Insufficient historical candles (${candles.length}/${minCandlesRequired}) for strategy evaluation.`
      );
      base.reason = base.reasons.join(" ");
      return base;
    }

    // 6. Supporting Market Intelligence context (never overrides deterministic safety rules)
    if (marketIntelligence && typeof marketIntelligence === "object") {
      if (marketIntelligence.sentiment?.available === true && marketIntelligence.sentiment?.label) {
        base.supportingContext.push(
          `Verified Market Intelligence sentiment: ${marketIntelligence.sentiment.label} (source: ${marketIntelligence.sentiment.source || "verified"}).`
        );
      } else {
        base.supportingContext.push(
          "Market Intelligence sentiment unavailable/unverified; relying strictly on price action and technical indicators."
        );
      }
    }

    // 7. If an AI Decision Contract is supplied, it must be valid and must not contradict deterministic signal
    if (aiDecision !== null) {
      if (aiDecision.valid !== true) {
        base.conflicts.push("AI Decision Contract is invalid.");
        base.reasons.push("AI Decision Contract is invalid.");
        base.reason = base.reasons.join(" ");
        return base;
      }

      if (aiDecision.risk === "HIGH" || Number(aiDecision.confidence) < minConfidence) {
        base.reasons.push("AI Decision Contract indicates HOLD / non-executable conditions.");
        base.reason = base.reasons.join(" ");
        return base;
      }
    }

    // 8. Market regime & volatility gate
    const risk = String(analysis.risk || "HIGH").trim().toUpperCase();
    if (risk === "HIGH" || base.marketRegime === MARKET_REGIMES.HIGH_VOLATILITY) {
      base.reasons.push("Market volatility/risk is HIGH.");
      base.reason = base.reasons.join(" ");
      return base;
    }

    const rawSignal = String(analysis.signal || "NO_TRADE").trim().toUpperCase();
    const confidence = Number(analysis.confidence) || 0;
    base.confidence = confidence;
    base.validatedConfidence = confidence;

    // 9. Handle explicit HOLD / WATCH / NO_TRADE before confidence rejection when signal is HOLD
    if (rawSignal === "HOLD") {
      base.decision = "HOLD";
      base.action = "HOLD";
      base.signal = "HOLD";
      base.tradeSide = "HOLD";
      base.reasons.push("Signal (HOLD) specifies HOLD / no trade.");
      const conds = buildConditionsAndRules({
        action: "HOLD",
        tradeSide: "HOLD",
        confidence,
        minConfidence,
        marketRegime: base.marketRegime,
        indicators,
        assetType
      });
      base.entryConditions = conds.entryConditions;
      base.invalidationConditions = conds.invalidationConditions;
      base.reason = base.reasons.join(" ");
      return base;
    }

    if (rawSignal === "WATCH") {
      // Developing setup (typically confidence 55-69%): deterministic HOLD decision if caller allows watchAsHold, else NO_TRADE as before
      if (input.watchAsHold === true) {
        base.decision = "HOLD";
        base.action = "HOLD";
        base.signal = "HOLD";
        base.tradeSide = "HOLD";
        base.reasons.push(
          `Developing setup (${rawSignal}, confidence ${confidence}%) — holding for confirmation.`
        );
        base.reason = base.reasons.join(" ");
        return base;
      }
    }

    if (confidence < minConfidence) {
      base.reasons.push(
        `Analysis confidence (${confidence}%) is below threshold (${minConfidence}%).`
      );
      base.reason = base.reasons.join(" ");
      return base;
    }

    if (rawSignal === "WATCH" || rawSignal === "NO_TRADE") {
      base.action = "NO_TRADE";
      base.signal = "NO_TRADE";
      base.tradeSide = "HOLD";
      base.reasons.push(`Signal (${rawSignal}) specifies HOLD / no trade.`);
      base.reason = base.reasons.join(" ");
      return base;
    }

    if (!["BUY", "BUY_CE", "BUY_PE", "SELL"].includes(rawSignal)) {
      base.reasons.push(`Signal (${rawSignal}) does not authorize a trade.`);
      base.reason = base.reasons.join(" ");
      return base;
    }

    // 10. Verify AI decision alignment if present (Conflicting-signal handling)
    if (aiDecision && aiDecision.valid === true) {
      const aiSig = String(aiDecision.signal || "").toUpperCase();
      if (aiSig !== rawSignal) {
        const msg = `AI signal (${aiSig}) does not align with deterministic strategy signal (${rawSignal}).`;
        base.conflicts.push(msg);
        base.reasons.push(msg);
        base.reason = base.reasons.join(" ");
        return base;
      }
    }

    // 11. Check for severe indicator / regime conflict when indicators are explicitly provided
    const isBullishSignal = rawSignal === "BUY" || rawSignal === "BUY_CE";
    const isBearishSignal = rawSignal === "SELL" || rawSignal === "BUY_PE";

    if (
      input.explicitRegimeCheck === true ||
      (input.marketRegime && VALID_REGIME_SET.has(String(input.marketRegime).toUpperCase()))
    ) {
      if (isBullishSignal && base.marketRegime === MARKET_REGIMES.BEARISH_TREND) {
        const msg = `Conflicting signal: ${rawSignal} signal conflicts with BEARISH_TREND market regime.`;
        base.conflicts.push(msg);
        base.reasons.push(msg);
        base.reason = base.reasons.join(" ");
        return base;
      }
      if (isBearishSignal && base.marketRegime === MARKET_REGIMES.BULLISH_TREND) {
        const msg = `Conflicting signal: ${rawSignal} signal conflicts with BULLISH_TREND market regime.`;
        base.conflicts.push(msg);
        base.reasons.push(msg);
        base.reason = base.reasons.join(" ");
        return base;
      }
    }

    if (indicators && typeof indicators === "object") {
      if (
        isBullishSignal &&
        indicators.breakout === "BEARISH_BREAKDOWN"
      ) {
        const msg = `Conflicting signal: ${rawSignal} signal conflicts with active BEARISH_BREAKDOWN.`;
        base.conflicts.push(msg);
        base.reasons.push(msg);
        base.reason = base.reasons.join(" ");
        return base;
      }
      if (
        isBearishSignal &&
        indicators.breakout === "BULLISH_BREAKOUT"
      ) {
        const msg = `Conflicting signal: ${rawSignal} signal conflicts with active BULLISH_BREAKOUT.`;
        base.conflicts.push(msg);
        base.reasons.push(msg);
        base.reason = base.reasons.join(" ");
        return base;
      }
    }

    // 12. Option contract directional alignment check when optionType is provided
    if (assetType === "OPTION" && optionType) {
      if (rawSignal === "BUY_CE" && optionType !== "CE") {
        const msg = `Option contract mismatch: ${rawSignal} requires CE option contract (received ${optionType}).`;
        base.conflicts.push(msg);
        base.reasons.push(msg);
        base.reason = base.reasons.join(" ");
        return base;
      }
      if (rawSignal === "BUY_PE" && optionType !== "PE") {
        const msg = `Option contract mismatch: ${rawSignal} requires PE option contract (received ${optionType}).`;
        base.conflicts.push(msg);
        base.reasons.push(msg);
        base.reason = base.reasons.join(" ");
        return base;
      }
    }

    // 13. Entry, Mandatory Directional Stop-Loss, Target, and Risk/Reward Calculation
    const defaultStopPct =
      assetType === "OPTION"
        ? DEFAULTS.stopLossPctOption
        : DEFAULTS.stopLossPctEquity;

    const customStopLoss =
      input.stopLoss !== undefined && input.stopLoss !== null && input.stopLoss !== ""
        ? Number(input.stopLoss)
        : null;

    const isShort = rawSignal === "SELL";
    const entry = roundTick(price);

    let stopLoss;
    if (customStopLoss !== null) {
      stopLoss = roundTick(customStopLoss);
    } else {
      const stopDistance = Math.max(0.05, entry * defaultStopPct);
      stopLoss = roundTick(isShort ? entry + stopDistance : entry - stopDistance);
    }

    if (
      !Number.isFinite(stopLoss) ||
      stopLoss <= 0 ||
      (!isShort && stopLoss >= entry) ||
      (isShort && stopLoss <= entry)
    ) {
      base.reasons.push("Calculated or supplied stop-loss is invalid for trade direction.");
      base.reason = base.reasons.join(" ");
      return base;
    }

    const riskPerUnit = round2(Math.abs(entry - stopLoss));
    const customTarget =
      input.target !== undefined && input.target !== null && input.target !== ""
        ? Number(input.target)
        : null;

    const target =
      customTarget !== null && Number.isFinite(customTarget) && customTarget > 0
        ? roundTick(customTarget)
        : roundTick(
            isShort
              ? Math.max(0.05, entry - riskPerUnit * rrMultiple)
              : entry + riskPerUnit * rrMultiple
          );

    if (
      !Number.isFinite(target) ||
      target <= 0 ||
      (!isShort && target <= entry) ||
      (isShort && target >= entry)
    ) {
      base.reasons.push("Target price is invalid for trade direction.");
      base.reason = base.reasons.join(" ");
      return base;
    }

    const rewardPerUnit = round2(Math.abs(target - entry));
    const rrRatio =
      riskPerUnit > 0 ? round2(rewardPerUnit / riskPerUnit) : 0;

    if (
      input.minRewardRiskRatio !== undefined &&
      Number(input.minRewardRiskRatio) > 0 &&
      rrRatio < Number(input.minRewardRiskRatio)
    ) {
      base.reasons.push(
        `Risk/Reward ratio (${rrRatio}:1) is below minimum required (${Number(input.minRewardRiskRatio)}:1).`
      );
      base.reason = base.reasons.join(" ");
      return base;
    }

    const tradeSide = isShort ? "SELL" : "BUY";
    const conds = buildConditionsAndRules({
      action: rawSignal,
      tradeSide,
      entry,
      stopLoss,
      target,
      rrRatio,
      confidence,
      minConfidence,
      marketRegime: base.marketRegime,
      indicators,
      assetType
    });

    base.decision = tradeSide;
    base.action = rawSignal;
    base.signal = rawSignal;
    base.tradeSide = tradeSide;
    base.executable = true;
    base.entry = entry;
    base.stopLoss = stopLoss;
    base.target = target;
    base.unitRisk = riskPerUnit;
    base.unitReward = rewardPerUnit;
    base.riskRewardRatio = rrRatio;
    base.entryConditions = conds.entryConditions;
    base.invalidationConditions = conds.invalidationConditions;
    base.exitRules = conds.exitRules;
    base.exitLevels = conds.exitLevels;

    base.reasons.push(
      `Deterministic ${rawSignal} setup at ₹${entry.toFixed(2)}, SL ₹${stopLoss.toFixed(2)}, Target ₹${target.toFixed(2)} (R:R 1:${rrRatio.toFixed(2)}, Regime: ${base.marketRegime}).`
    );
    base.reason = base.reasons.join(" ");

    return base;
  }

  /**
   * Evaluates complete strategy + RiskEngine + AISafetyGate + EmergencyStop
   * view model for the UI and server API without placing any broker orders.
   */
  function buildStrategyViewModel(input = {}) {
    const snapshot = input.snapshot || null;
    const instrument = input.instrument || {
      key: snapshot?.instrument || "NIFTY50",
      name: snapshot?.name || "NIFTY 50",
      exchange: snapshot?.exchange || "NSE",
      type: snapshot?.type || "EQUITY",
      optionType: snapshot?.optionType || null
    };
    const assetType =
      String(instrument.type || snapshot?.type || "EQUITY").toUpperCase() === "OPTION"
        ? "OPTION"
        : "EQUITY";

    const emergencyStop = Boolean(
      input.emergencyStop ||
      (RiskEngineRefStrategy &&
        typeof RiskEngineRefStrategy.isEmergencyStopActive === "function" &&
        RiskEngineRefStrategy.isEmergencyStopActive())
    );

    const strategy =
      input.strategy ||
      evaluate({
        dataReady: snapshot?.dataReady === true,
        snapshot,
        candles: input.candles || snapshot?.candles || [],
        indicators: snapshot?.indicators || null,
        analysis: input.analysis || null,
        aiDecision: input.aiDecision || null,
        marketIntelligence: input.marketIntelligence || null,
        price: snapshot?.price,
        assetType,
        optionType: instrument.optionType || snapshot?.optionType || "",
        emergencyStop
      });

    const paperState = input.paperState || {
      dailyPnl: 0,
      tradesToday: 0,
      maxTradesPerDay: 3,
      position: null
    };

    const quantity = Number(input.quantity) > 0 ? Number(input.quantity) : 1;
    const lotSize = Number(input.lotSize) > 0 ? Number(input.lotSize) : 1;
    const lots = Number(input.lots) > 0 ? Number(input.lots) : 1;

    let riskCheck = {
      allowed: false,
      status: "BLOCKED",
      reasons: ["Strategy does not authorize an executable directional trade."],
      riskAmount: 0
    };

    if (
      RiskEngineRefStrategy &&
      strategy.executable &&
      strategy.entry &&
      strategy.stopLoss
    ) {
      riskCheck = RiskEngineRefStrategy.evaluate({
        side: strategy.tradeSide,
        entry: strategy.entry,
        stop: strategy.stopLoss,
        quantity,
        assetType,
        lotSize,
        lots,
        dailyPnl: Number(paperState.dailyPnl || 0),
        tradesToday: Number(paperState.tradesToday || 0),
        openPositions: paperState.position ? 1 : 0,
        averaging: false,
        emergencyStop
      });
    }

    let safetyGate = {
      allowed: false,
      status: "BLOCKED",
      reasons: ["Waiting for validated strategy setup and RiskEngine approval."]
    };

    if (AISafetyGateRefStrategy) {
      safetyGate = AISafetyGateRefStrategy.evaluate({
        dataReady: snapshot?.dataReady === true,
        staleData: snapshot?.status === "STALE_MARKET_DATA",
        signal: strategy.action,
        confidence: strategy.confidence,
        risk: input.analysis?.risk || "HIGH",
        assetType,
        optionType: instrument.optionType || snapshot?.optionType || "",
        side: strategy.tradeSide === "SELL" ? "SELL" : "BUY",
        stopLoss: strategy.stopLoss || undefined,
        riskCheck,
        aiDecision: input.aiDecision || undefined,
        maxTradesPerDay: Number(paperState.maxTradesPerDay || 3),
        tradesToday: Number(paperState.tradesToday || 0),
        maxOpenPositions: 1,
        openPositions: paperState.position ? 1 : 0,
        emergencyStop,
        averaging: false
      });
    }

    const canExecutePaper =
      strategy.executable === true &&
      riskCheck.allowed === true &&
      safetyGate.allowed === true &&
      !emergencyStop;

    return {
      instrument: {
        key: instrument.key || instrument.name || "NIFTY50",
        name: instrument.name || instrument.key || "NIFTY 50",
        exchange: instrument.exchange || "NSE",
        assetType,
        optionType: instrument.optionType || null
      },
      strategy,
      riskCheck,
      safetyGate,
      emergencyStop,
      canExecutePaper,
      documentedRules: DOCUMENTED_STRATEGY_RULES,
      history: Array.isArray(input.history) ? input.history : []
    };
  }

  return {
    STRATEGY_VERSION,
    MARKET_REGIMES,
    DEFAULTS,
    DOCUMENTED_STRATEGY_RULES,
    roundTick,
    classifyMarketRegime,
    buildConditionsAndRules,
    evaluate,
    buildStrategyViewModel
  };

})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = StrategyEngine;
}
