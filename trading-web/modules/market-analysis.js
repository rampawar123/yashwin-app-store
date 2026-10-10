/*
 * YASHWIN AI Trading Assistant
 * Phase 9 — Deterministic Market Analysis Engine
 *
 * Decision hierarchy:
 * Market Data -> Technical Score -> Options Score -> Context Score
 * -> Confidence -> Risk Gate -> Signal
 *
 * Possible signal states:
 * NO_TRADE
 * HOLD
 * WATCH
 * BUY
 * SELL
 * BUY_CE
 * BUY_PE
 *
 * No broker orders.
 * No guaranteed prediction.
 */

const MarketAnalysis = (() => {

  const LIMITS = {
    minConfidenceForWatch: 55,
    minConfidenceForTrade: 70
  };

  function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function scoreDirection(value) {
    const n = Number(value) || 0;

    if (n >= 20) return "BULLISH";
    if (n <= -20) return "BEARISH";
    return "SIDEWAYS";
  }

  function calculateOptionScore(options = {}) {
    if (options.available !== true) return 0;

    if (
      options.pcr === null ||
      options.pcr === undefined ||
      options.callOIChange === null ||
      options.callOIChange === undefined ||
      options.putOIChange === null ||
      options.putOIChange === undefined
    ) {
      return 0;
    }

    const pcr = Number(options.pcr);
    const callOIChange = Number(options.callOIChange);
    const putOIChange = Number(options.putOIChange);
    const iv = Number(options.iv);

    if (
      !Number.isFinite(pcr) ||
      !Number.isFinite(callOIChange) ||
      !Number.isFinite(putOIChange)
    ) {
      return 0;
    }

    let score = 0;

    if (pcr >= 1.2) score += 35;
    else if (pcr >= 1.0) score += 20;
    else if (pcr <= 0.8) score -= 35;
    else if (pcr < 1.0) score -= 20;

    const oiDelta = putOIChange - callOIChange;

    if (oiDelta > 0) score += 30;
    else if (oiDelta < 0) score -= 30;

    if (Number.isFinite(iv) && iv >= 35) {
      score *= 0.75;
    }

    return clamp(score, -100, 100);
  }

  function hasValidNumber(val) {
    return val !== null && val !== undefined && val !== "" && Number.isFinite(Number(val));
  }

  function analyze(input = {}) {
    const result = {
      dataReady: input.dataReady === true,
      score: 0,
      trend: "UNKNOWN",
      signal: "NO_TRADE",
      action: "HOLD",
      confidence: 0,
      risk: "HIGH",
      reasons: [],
      components: {
        trend: 0,
        momentum: 0,
        volume: 0,
        vwap: 0,
        supportResistance: 0,
        options: 0,
        news: 0,
        breadth: 0
      },
      timestamp: new Date().toISOString()
    };

    if (input.dataReady !== true) {
      result.reasons.push("Validated market data is not available.");
      return result;
    }

    const hasCoreTechnicalInput =
      hasValidNumber(input.trendScore) ||
      hasValidNumber(input.momentumScore) ||
      hasValidNumber(input.vwapScore) ||
      hasValidNumber(input.supportResistanceScore);

    if (!hasCoreTechnicalInput) {
      result.reasons.push("Required technical indicator inputs are unavailable.");
      return result;
    }

    const trend = clamp(input.trendScore, -100, 100);
    const momentum = clamp(input.momentumScore, -100, 100);
    const volume = clamp(input.volumeScore, -100, 100);
    const vwap = clamp(input.vwapScore, -100, 100);
    const supportResistance = clamp(input.supportResistanceScore, -100, 100);

    const hasOptionsInput = hasValidNumber(input.optionsScore);
    const hasNewsInput = hasValidNumber(input.newsScore);
    const hasBreadthInput = hasValidNumber(input.breadthScore);

    const options = hasOptionsInput ? clamp(input.optionsScore, -100, 100) : 0;
    const news = hasNewsInput ? clamp(input.newsScore, -100, 100) : 0;
    const breadth = hasBreadthInput ? clamp(input.breadthScore, -100, 100) : 0;

    result.components.trend = trend;
    result.components.momentum = momentum;
    result.components.volume = volume;
    result.components.vwap = vwap;
    result.components.supportResistance = supportResistance;
    result.components.options = options;
    result.components.news = news;
    result.components.breadth = breadth;

    const weightedSum =
      trend * 0.20 +
      momentum * 0.15 +
      volume * 0.10 +
      vwap * 0.10 +
      supportResistance * 0.10 +
      (hasOptionsInput ? options * 0.15 : 0) +
      (hasNewsInput ? news * 0.05 : 0) +
      (hasBreadthInput ? breadth * 0.15 : 0);

    const activeWeight =
      0.65 +
      (hasOptionsInput ? 0.15 : 0) +
      (hasNewsInput ? 0.05 : 0) +
      (hasBreadthInput ? 0.15 : 0);

    const rawScore = activeWeight > 0 ? weightedSum / activeWeight : 0;

    const direction = scoreDirection(rawScore);
    const confidence = clamp(Math.abs(rawScore));

    result.score = Math.round(rawScore);
    result.trend = direction;
    result.confidence = Math.round(confidence);

    const volatility = Number(input.volatilityScore) || 0;

    if (volatility >= 75) {
      result.risk = "HIGH";
    } else if (volatility >= 45) {
      result.risk = "MEDIUM";
    } else {
      result.risk = "LOW";
    }

    if (result.risk === "HIGH") {
      result.signal = "NO_TRADE";
      result.action = "HOLD";
      result.reasons.push("Volatility risk is too high.");
      return result;
    }

    if (confidence < LIMITS.minConfidenceForWatch) {
      result.signal = "NO_TRADE";
      result.action = "HOLD";
      result.reasons.push("Market conviction is too weak.");
      return result;
    }

    if (confidence < LIMITS.minConfidenceForTrade) {
      result.signal = "WATCH";
      result.action = "HOLD";
      result.reasons.push("Setup is developing; wait for confirmation.");
      return result;
    }

    const assetType = String(input.assetType || "OPTION").trim().toUpperCase();

    if (direction === "BULLISH") {
      result.signal = assetType === "EQUITY" ? "BUY" : "BUY_CE";
      result.action = "BUY";
      result.reasons.push("Strong bullish market structure.");
    } else if (direction === "BEARISH") {
      result.signal = assetType === "EQUITY" ? "SELL" : "BUY_PE";
      result.action = assetType === "EQUITY" ? "SELL" : "BUY";
      result.reasons.push("Strong bearish market structure.");
    } else {
      result.signal = "NO_TRADE";
      result.action = "HOLD";
      result.reasons.push("Market is not directionally clear.");
    }

    return result;
  }

  return {
    LIMITS,
    analyze,
    clamp,
    calculateOptionScore
  };

})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = MarketAnalysis;
}
