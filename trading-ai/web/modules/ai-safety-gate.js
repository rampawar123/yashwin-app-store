/*
 * YASHWIN AI Trading Assistant
 * Phase 10 — AI Safety Gate
 *
 * Separates AI recommendation from trade authorization.
 * Mandatory path for AI-assisted trades:
 * MarketAnalysis / GoogleAI -> AIDecisionContract -> AISafetyGate -> Strategy -> RiskEngine -> EmergencyStop -> Paper Trading
 *
 * No broker orders.
 * No live trading.
 * No profit guarantee.
 */

const AIDecisionContractRefGate =
  typeof AIDecisionContract !== "undefined"
    ? AIDecisionContract
    : typeof require === "function"
      ? require("./ai-decision-contract")
      : null;

const AISafetyGate = (() => {

  const MIN_CONFIDENCE = 70;
  const APPROVED_SIGNALS = ["BUY", "SELL", "BUY_CE", "BUY_PE"];

  function evaluate(input = {}) {
    const assetType = String(input.assetType || "OPTION").trim().toUpperCase();
    const optionType = String(input.optionType || "").trim().toUpperCase();
    const side = String(input.side || "BUY").trim().toUpperCase();

    const result = {
      allowed: false,
      status: "BLOCKED",
      reasons: [],
      signal: String(input.signal || "").trim().toUpperCase(),
      confidence: Number(input.confidence),
      risk: String(input.risk || "HIGH").trim().toUpperCase(),
      assetType,
      timestamp: new Date().toISOString()
    };

    if (input.aiDecision !== undefined && input.aiDecision !== null && AIDecisionContractRefGate) {
      const contractValidation = AIDecisionContractRefGate.validate(input.aiDecision);
      if (!contractValidation.ok) {
        result.reasons.push(
          `AI Decision Contract rejected payload: ${contractValidation.errors.join(" ")}`
        );
      }
    }

    if (input.dataReady !== true) {
      result.reasons.push(
        "Validated market data is required before AI trade approval."
      );
    }

    if (input.staleData === true) {
      result.reasons.push("Market data is stale.");
    }

    if (!APPROVED_SIGNALS.includes(result.signal)) {
      result.reasons.push(
        "AI signal is not an approved directional trade signal."
      );
    }

    if (
      !Number.isFinite(result.confidence) ||
      result.confidence < MIN_CONFIDENCE
    ) {
      result.reasons.push(
        "AI confidence is below the minimum trade threshold."
      );
    }

    if (assetType === "OPTION" || result.signal === "BUY_CE" || result.signal === "BUY_PE") {
      if (result.signal === "BUY_CE" && optionType !== "CE") {
        result.reasons.push(
          "AI BUY_CE signal does not match the selected option contract."
        );
      }

      if (result.signal === "BUY_PE" && optionType !== "PE") {
        result.reasons.push(
          "AI BUY_PE signal does not match the selected option contract."
        );
      }

      if ((result.signal === "BUY" || result.signal === "SELL") && assetType === "OPTION") {
        result.reasons.push(
          "Option trades require an explicit BUY_CE or BUY_PE signal."
        );
      }
    } else if (assetType === "EQUITY") {
      if (result.signal === "BUY" && side !== "BUY") {
        result.reasons.push(
          "AI BUY signal does not match SELL trade direction."
        );
      }
      if (result.signal === "SELL" && side !== "SELL") {
        result.reasons.push(
          "AI SELL signal does not match BUY trade direction."
        );
      }
    } else {
      result.reasons.push("Unsupported instrument asset type.");
    }

    if (result.risk === "HIGH") {
      result.reasons.push("AI risk level is HIGH.");
    }

    if (!input.riskCheck || input.riskCheck.allowed !== true) {
      result.reasons.push("RiskEngine approval is required.");
    }

    if (
      input.stopLoss !== undefined &&
      (!Number.isFinite(Number(input.stopLoss)) || Number(input.stopLoss) <= 0)
    ) {
      result.reasons.push("Mandatory stop-loss is missing or invalid.");
    }

    if (
      input.maxTradesPerDay !== undefined &&
      input.tradesToday !== undefined &&
      Number(input.tradesToday) >= Number(input.maxTradesPerDay)
    ) {
      result.reasons.push("Maximum daily trades reached.");
    }

    if (
      input.maxOpenPositions !== undefined &&
      input.openPositions !== undefined &&
      Number(input.openPositions) >= Number(input.maxOpenPositions)
    ) {
      result.reasons.push("Maximum open positions reached.");
    }

    if (input.emergencyStop === true) {
      result.reasons.push("Emergency stop is active.");
    }

    if (input.averaging === true) {
      result.reasons.push("Averaging into an existing position is blocked.");
    }

    if (result.reasons.length === 0) {
      result.allowed = true;
      result.status = "APPROVED";
    }

    return result;
  }

  return {
    MIN_CONFIDENCE,
    APPROVED_SIGNALS,
    evaluate
  };

})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = AISafetyGate;
}
