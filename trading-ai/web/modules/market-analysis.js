/*
 * YASHWIN AI Trading Assistant
 * Market Analysis Engine
 *
 * Decision hierarchy:
 * Market Data -> Technical Score -> Options Score -> Context Score
 * -> Confidence -> Risk Gate -> Signal
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

  /*
   * Option-chain directional score.
   *
   * PCR:
   * - Higher PCR can support a bullish bias.
   * - Lower PCR can support a bearish bias.
   *
   * OI change:
   * - Positive put OI change relative to call OI change supports bullish bias.
   * - Positive call OI change relative to put OI change supports bearish bias.
   *
   * IV is used only as a volatility/context adjustment.
   *
   * Missing or invalid option metrics return 0.
   * No option metric is allowed to create a trading decision by itself.
   */
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

    if (pcr >= 1.20) score += 35;
    else if (pcr >= 1.00) score += 20;
    else if (pcr <= 0.80) score -= 35;
    else if (pcr <= 1.00) score -= 20;

    const oiDelta = putOIChange - callOIChange;

    if (oiDelta > 0) score += 30;
    else if (oiDelta < 0) score -= 30;

    /*
     * High IV should reduce conviction rather than create direction.
     */
    if (Number.isFinite(iv) && iv >= 35) {
      score *= 0.75;
    }

    return clamp(score, -100, 100);
  }

  function analyze(input = {}) {
    const result = {
      score: 0,
      trend: "UNKNOWN",
      signal: "NO_TRADE",
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

    /*
     * Never create a trading decision without validated data.
     */
    if (input.dataReady !== true) {
      result.reasons.push("Validated market data is not available.");
      return result;
    }

    /*
     * Inputs are intentionally explicit.
     * Real data connectors will populate these values later.
     */
    const trend = clamp(input.trendScore, -100, 100);
    const momentum = clamp(input.momentumScore, -100, 100);
    const volume = clamp(input.volumeScore, -100, 100);
    const vwap = clamp(input.vwapScore, -100, 100);
    const supportResistance =
      clamp(input.supportResistanceScore, -100, 100);

    const options = clamp(input.optionsScore, -100, 100);
    const news = clamp(input.newsScore, -100, 100);
    const breadth = clamp(input.breadthScore, -100, 100);

    result.components.trend = trend;
    result.components.momentum = momentum;
    result.components.volume = volume;
    result.components.vwap = vwap;
    result.components.supportResistance = supportResistance;
    result.components.options = options;
    result.components.news = news;
    result.components.breadth = breadth;

    /*
     * Weighted score.
     * Technical structure has more weight than news.
     */
    const rawScore =
      trend * 0.20 +
      momentum * 0.15 +
      volume * 0.10 +
      vwap * 0.10 +
      supportResistance * 0.10 +
      options * 0.15 +
      news * 0.05 +
      breadth * 0.15;

    const direction = scoreDirection(rawScore);
    const confidence = clamp(Math.abs(rawScore));

    result.score = Math.round(rawScore);
    result.trend = direction;
    result.confidence = Math.round(confidence);

    /*
     * Basic risk classification.
     */
    const volatility = Number(input.volatilityScore) || 0;

    if (volatility >= 75) {
      result.risk = "HIGH";
    } else if (volatility >= 45) {
      result.risk = "MEDIUM";
    } else {
      result.risk = "LOW";
    }

    /*
     * No-trade gates.
     */
    if (result.risk === "HIGH") {
      result.signal = "NO_TRADE";
      result.reasons.push("Volatility risk is too high.");
      return result;
    }

    if (confidence < LIMITS.minConfidenceForWatch) {
      result.signal = "NO_TRADE";
      result.reasons.push("Market conviction is too weak.");
      return result;
    }

    if (confidence < LIMITS.minConfidenceForTrade) {
      result.signal = "WATCH";
      result.reasons.push("Setup is developing; wait for confirmation.");
      return result;
    }

    /*
     * Strong directional setup.
     * CE/PE selection will later require actual option-chain validation.
     */
    if (direction === "BULLISH") {
      result.signal = "BUY_CE";
      result.reasons.push("Strong bullish market structure.");
    } else if (direction === "BEARISH") {
      result.signal = "BUY_PE";
      result.reasons.push("Strong bearish market structure.");
    } else {
      result.signal = "NO_TRADE";
      result.reasons.push("Market is not directionally clear.");
    }

    return result;
  }

  return {
    analyze,
    clamp,
    calculateOptionScore
  };

})();
