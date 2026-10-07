/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — Risk Engine
 *
 * Mandatory safety gate before any trade decision reaches execution.
 *
 * No broker orders.
 * No live trading.
 * No profit guarantee.
 */

const RiskEngine = (() => {

  const DEFAULTS = {
    maxLossPerTrade: 500,
    maxDailyLoss: 1000,
    maxTradesPerDay: 3,
    maxQuantity: 100000,
    maxOpenPositions: 1
  };

  function number(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function evaluate(input = {}) {
    const limits = {
      ...DEFAULTS,
      ...(input.limits || {})
    };

    const result = {
      allowed: false,
      status: "BLOCKED",
      reasons: [],
      riskAmount: 0,
      dailyPnl: number(input.dailyPnl),
      tradesToday: number(input.tradesToday),
      openPositions: number(input.openPositions),
      quantity: number(input.quantity),
      timestamp: new Date().toISOString()
    };

    /*
     * Risk must be calculated from entry -> stop -> quantity.
     */
    const entry = number(input.entry);
    const stop = number(input.stop);
    const qty = number(input.quantity);
    const lotSize = number(input.lotSize, 1);
    const lots = number(input.lots, 1);
    const assetType = String(input.assetType || "EQUITY").toUpperCase();
    const side = String(input.side || "").toUpperCase();

    if (entry <= 0) {
      result.reasons.push("Invalid entry price.");
    }

    if (stop <= 0) {
      result.reasons.push("Invalid stop-loss price.");
    }

    if (assetType === "OPTION") {
      if (lotSize <= 0) {
        result.reasons.push("Invalid option lot size.");
      }

      if (lots <= 0) {
        result.reasons.push("Invalid option lot count.");
      }

      if (!Number.isInteger(lotSize)) {
        result.reasons.push("Option lot size must be a whole number.");
      }

      if (!Number.isInteger(lots)) {
        result.reasons.push("Option lot count must be a whole number.");
      }
    } else if (qty <= 0) {
      result.reasons.push("Invalid quantity.");
    }

    if (side !== "BUY" && side !== "SELL") {
      result.reasons.push("Invalid trade side. Use BUY or SELL.");
    }

    if (result.reasons.length > 0) {
      return result;
    }

    /*
     * Stop-loss direction is mandatory:
     * BUY  -> stop must be below entry.
     * SELL -> stop must be above entry.
     */
    if (side === "BUY" && stop >= entry) {
      result.reasons.push(
        "Invalid BUY stop-loss. Stop-loss must be below entry price."
      );
    }

    if (side === "SELL" && stop <= entry) {
      result.reasons.push(
        "Invalid SELL stop-loss. Stop-loss must be above entry price."
      );
    }

    if (result.reasons.length > 0) {
      return result;
    }

    const effectiveQuantity =
      assetType === "OPTION"
        ? lotSize * lots
        : qty;

    if (!Number.isFinite(effectiveQuantity) || effectiveQuantity <= 0) {
      result.reasons.push("Invalid effective quantity.");
      return result;
    }

    result.riskAmount =
      Math.abs(entry - stop) * effectiveQuantity;

    result.effectiveQuantity = effectiveQuantity;
    result.assetType = assetType;
    result.lotSize = lotSize;
    result.lots = lots;

    /*
     * Mandatory risk limits.
     */
    if (result.riskAmount > limits.maxLossPerTrade) {
      result.reasons.push(
        "Risk per trade exceeds the maximum allowed loss."
      );
    }

    if (result.dailyPnl <= -limits.maxDailyLoss) {
      result.reasons.push(
        "Daily loss limit has been reached."
      );
    }

    if (result.tradesToday >= limits.maxTradesPerDay) {
      result.reasons.push(
        "Maximum daily trade count has been reached."
      );
    }

    if (effectiveQuantity > limits.maxQuantity) {
      result.reasons.push(
        "Order quantity exceeds the maximum quantity limit."
      );
    }

    if (result.openPositions >= limits.maxOpenPositions) {
      result.reasons.push(
        "Maximum open-position limit has been reached."
      );
    }

    /*
     * No averaging / no unsafe position increase.
     */
    if (input.averaging === true) {
      result.reasons.push(
        "Averaging into an existing position is blocked."
      );
    }

    /*
     * Emergency stop.
     */
    if (input.emergencyStop === true) {
      result.reasons.push(
        "Emergency stop is active."
      );
    }

    /*
     * Every safety condition must pass.
     */
    if (result.reasons.length === 0) {
      result.allowed = true;
      result.status = "APPROVED";
    }

    return result;
  }

  function canTrade(input = {}) {
    return evaluate(input);
  }

  return {
    DEFAULTS,
    evaluate,
    canTrade
  };

})();
