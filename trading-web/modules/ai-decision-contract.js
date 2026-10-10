/*
 * YASHWIN AI Trading Assistant
 * Strict AI Decision Contract Validator
 *
 * Enforces structured schema on all AI analysis output before it reaches
 * AISafetyGate, StrategyEngine, RiskEngine, or PaperTrading.
 *
 * Allowed actions/signals:
 * - BUY
 * - SELL
 * - HOLD
 * - NO_TRADE
 * - WATCH
 * - BUY_CE
 * - BUY_PE
 *
 * Never allows AI output to bypass deterministic strategy or risk rules.
 */

const AIDecisionContract = (() => {
  const CONTRACT_VERSION = "1.0.0-STRICT";

  const ALLOWED_SIGNALS = [
    "BUY",
    "SELL",
    "HOLD",
    "NO_TRADE",
    "WATCH",
    "BUY_CE",
    "BUY_PE"
  ];

  const ALLOWED_RISKS = ["LOW", "MEDIUM", "HIGH"];
  const ALLOWED_TRENDS = ["BULLISH", "BEARISH", "SIDEWAYS", "UNKNOWN"];
  const ALLOWED_SOURCES = ["REAL_GOOGLE_AI", "MOCK_AI", "DETERMINISTIC_FALLBACK"];

  function safeFallbackDecision(reason = "AI decision contract rejected payload.") {
    return {
      contractVersion: CONTRACT_VERSION,
      valid: false,
      signal: "NO_TRADE",
      action: "HOLD",
      confidence: 0,
      risk: "HIGH",
      trend: "UNKNOWN",
      reasoning: String(reason),
      stopLossSuggestion: null,
      targetSuggestion: null,
      source: "DETERMINISTIC_FALLBACK",
      timestamp: new Date().toISOString()
    };
  }

  function validate(rawPayload, options = {}) {
    const errors = [];
    let parsed = rawPayload;

    if (typeof rawPayload === "string") {
      try {
        parsed = JSON.parse(rawPayload);
      } catch (_) {
        return {
          ok: false,
          code: "INVALID_AI_JSON",
          errors: ["AI response is not valid JSON."],
          decision: safeFallbackDecision("AI response is not valid JSON.")
        };
      }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        code: "INVALID_AI_OBJECT",
        errors: ["AI response must be a JSON object."],
        decision: safeFallbackDecision("AI response must be a JSON object.")
      };
    }

    const rawSignal = String(
      parsed.signal || parsed.action || ""
    ).trim().toUpperCase();

    if (!ALLOWED_SIGNALS.includes(rawSignal)) {
      errors.push(`Invalid AI signal/action: "${rawSignal}".`);
    }

    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
      errors.push("AI confidence must be a finite number between 0 and 100.");
    }

    const rawRisk = String(parsed.risk || "").trim().toUpperCase();
    if (!ALLOWED_RISKS.includes(rawRisk)) {
      errors.push(`Invalid AI risk classification: "${rawRisk}".`);
    }

    const rawTrend = String(parsed.trend || "UNKNOWN").trim().toUpperCase();
    const trend = ALLOWED_TRENDS.includes(rawTrend) ? rawTrend : "UNKNOWN";

    const reasoning = String(parsed.reasoning || parsed.reason || "").trim();
    if (!reasoning) {
      errors.push("AI decision must include non-empty reasoning.");
    }

    let stopLossSuggestion = null;
    if (
      parsed.stopLossSuggestion !== undefined &&
      parsed.stopLossSuggestion !== null &&
      parsed.stopLossSuggestion !== ""
    ) {
      const sl = Number(parsed.stopLossSuggestion);
      if (!Number.isFinite(sl) || sl <= 0) {
        errors.push("AI stopLossSuggestion must be a positive number when provided.");
      } else {
        stopLossSuggestion = sl;
      }
    }

    let targetSuggestion = null;
    if (
      parsed.targetSuggestion !== undefined &&
      parsed.targetSuggestion !== null &&
      parsed.targetSuggestion !== ""
    ) {
      const tg = Number(parsed.targetSuggestion);
      if (!Number.isFinite(tg) || tg <= 0) {
        errors.push("AI targetSuggestion must be a positive number when provided.");
      } else {
        targetSuggestion = tg;
      }
    }

    if (errors.length > 0) {
      return {
        ok: false,
        code: "AI_CONTRACT_VIOLATION",
        errors,
        decision: safeFallbackDecision(errors.join(" "))
      };
    }

    // Normalize directional action to BUY / SELL / HOLD
    let normalizedAction = "HOLD";
    if (rawSignal === "BUY" || rawSignal === "BUY_CE" || rawSignal === "BUY_PE") {
      normalizedAction = "BUY";
    } else if (rawSignal === "SELL") {
      normalizedAction = "SELL";
    }

    // If risk is HIGH or confidence < 70, force non-executable HOLD action in contract
    const minConfidence = Number(options.minConfidence) || 70;
    const executable =
      rawRisk !== "HIGH" &&
      confidence >= minConfidence &&
      ["BUY", "SELL", "BUY_CE", "BUY_PE"].includes(rawSignal);

    const source = ALLOWED_SOURCES.includes(String(options.source || parsed.source || "").toUpperCase())
      ? String(options.source || parsed.source).toUpperCase()
      : "REAL_GOOGLE_AI";

    const decision = {
      contractVersion: CONTRACT_VERSION,
      valid: true,
      signal: executable ? rawSignal : rawSignal === "WATCH" ? "WATCH" : "NO_TRADE",
      rawSignal,
      action: executable ? normalizedAction : "HOLD",
      confidence: Math.round(confidence),
      risk: rawRisk,
      trend,
      reasoning,
      stopLossSuggestion,
      targetSuggestion,
      executable,
      source,
      timestamp: new Date().toISOString()
    };

    return {
      ok: true,
      code: "VALID_AI_DECISION",
      errors: [],
      decision
    };
  }

  return {
    CONTRACT_VERSION,
    ALLOWED_SIGNALS,
    ALLOWED_RISKS,
    ALLOWED_TRENDS,
    validate,
    safeFallbackDecision
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = AIDecisionContract;
}
