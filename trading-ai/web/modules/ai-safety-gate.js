/*
 * YASHWIN AI Trading Assistant
 * Phase 4 — AI Safety Gate
 *
 * Mandatory path:
 * Validated AI signal -> AI Safety Gate -> RiskEngine -> Paper Trading
 *
 * No broker orders.
 * No live trading.
 * No profit guarantee.
 */

const AISafetyGate = (() => {

  const MIN_CONFIDENCE = 70;

  function evaluate(input = {}) {
    const result = {
      allowed: false,
      status: "BLOCKED",
      reasons: [],
      signal: String(input.signal || "").toUpperCase(),
      confidence: Number(input.confidence),
      risk: String(input.risk || "HIGH").toUpperCase(),
      timestamp: new Date().toISOString()
    };

    /*
     * Validated AI data is mandatory.
     */
    if (input.dataReady !== true) {
      result.reasons.push(
        "Validated market data is required before AI trade approval."
      );
    }

    /*
     * Only explicit directional AI signals may pass.
     */
    if (
      result.signal !== "BUY_CE" &&
      result.signal !== "BUY_PE"
    ) {
      result.reasons.push(
        "AI signal is not an approved directional trade signal."
      );
    }

    /*
     * Confidence threshold is mandatory.
     */
    if (
      !Number.isFinite(result.confidence) ||
      result.confidence < MIN_CONFIDENCE
    ) {
      result.reasons.push(
        "AI confidence is below the minimum trade threshold."
      );
    }

    /*
     * AI option signal must match the selected option contract.
     * BUY_CE -> CE only
     * BUY_PE -> PE only
     */
    const optionType = String(input.optionType || "").trim().toUpperCase();

    if (
      result.signal === "BUY_CE" &&
      optionType !== "CE"
    ) {
      result.reasons.push(
        "AI BUY_CE signal does not match the selected option contract."
      );
    }

    if (
      result.signal === "BUY_PE" &&
      optionType !== "PE"
    ) {
      result.reasons.push(
        "AI BUY_PE signal does not match the selected option contract."
      );
    }

    /*
     * High AI risk always blocks the trade.
     */
    if (result.risk === "HIGH") {
      result.reasons.push(
        "AI risk level is HIGH."
      );
    }

    /*
     * RiskEngine must approve the complete trade.
     */
    if (!input.riskCheck || input.riskCheck.allowed !== true) {
      result.reasons.push(
        "RiskEngine approval is required."
      );
    }

    /*
     * Explicit emergency stop.
     */
    if (input.emergencyStop === true) {
      result.reasons.push(
        "Emergency stop is active."
      );
    }

    /*
     * Averaging is never allowed.
     */
    if (input.averaging === true) {
      result.reasons.push(
        "Averaging into an existing position is blocked."
      );
    }

    if (result.reasons.length === 0) {
      result.allowed = true;
      result.status = "APPROVED";
    }

    return result;
  }

  return {
    MIN_CONFIDENCE,
    evaluate
  };

})();
