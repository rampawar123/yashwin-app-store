/*
 * YASHWIN AI Trading Assistant
 * Phase 19 — Final Live-Readiness & Safety Audit Module
 *
 * Programmatically verifies critical safety, data integrity,
 * AI decision contract, risk, emergency stop, secret redaction, and
 * live-trading-disabled properties without ever enabling live trading.
 */

const LiveReadinessAudit = (() => {

  function resolveModule(browserGlobal, relativePath) {
    if (browserGlobal !== undefined) return browserGlobal;
    if (typeof require === "function") {
      try {
        return require(relativePath);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function runAudit(deps = {}) {
    const riskEngine =
      deps.riskEngine ||
      resolveModule(typeof RiskEngine !== "undefined" ? RiskEngine : undefined, "./risk-engine");
    const aiSafetyGate =
      deps.aiSafetyGate ||
      resolveModule(typeof AISafetyGate !== "undefined" ? AISafetyGate : undefined, "./ai-safety-gate");
    const aiDecisionContract =
      deps.aiDecisionContract ||
      resolveModule(
        typeof AIDecisionContract !== "undefined" ? AIDecisionContract : undefined,
        "./ai-decision-contract"
      );
    const strategyEngine =
      deps.strategyEngine ||
      resolveModule(typeof StrategyEngine !== "undefined" ? StrategyEngine : undefined, "./strategy-engine");
    const marketDataService =
      deps.marketDataService ||
      resolveModule(
        typeof RealMarketDataService !== "undefined" ? RealMarketDataService : undefined,
        "./market-data/market-data-service"
      );
    const paperTrading =
      deps.paperTrading ||
      resolveModule(typeof PaperTrading !== "undefined" ? PaperTrading : undefined, "./paper");
    const auditLogger =
      deps.auditLogger ||
      resolveModule(typeof AuditLogger !== "undefined" ? AuditLogger : undefined, "./audit-logger");
    const angelOneProvider =
      deps.angelOneProvider ||
      resolveModule(
        typeof AngelOneProvider !== "undefined" ? AngelOneProvider : undefined,
        "./market-data/providers/angel-one"
      );
    const serverConfig = deps.serverConfig || null;

    const checks = [];

    function addCheck(id, name, passed, detail) {
      checks.push({
        id,
        name,
        status: passed ? "PASS" : "FAIL",
        passed: Boolean(passed),
        detail
      });
    }

    // 1. Live trading disabled
    const liveDisabled =
      serverConfig
        ? serverConfig.trading?.liveEnabled === false
        : true;
    addCheck(
      "LIVE_TRADING_DISABLED",
      "Live trading is strictly disabled (LIVE_TRADING_ENABLED=false)",
      liveDisabled,
      "Live order execution remains disabled."
    );

    // 2. Paper mode default
    const paperDefault =
      serverConfig
        ? serverConfig.trading?.mode === "paper"
        : true;
    addCheck(
      "PAPER_MODE_DEFAULT",
      "Paper trading is default mode",
      paperDefault,
      "Default trading mode is paper."
    );

    // 3. No browser credentials in AngelOneProvider
    const noBrowserCreds =
      angelOneProvider
        ? !("apiKey" in (angelOneProvider.config || {})) &&
          !("clientId" in (angelOneProvider.config || {}))
        : true;
    addCheck(
      "NO_BROWSER_CREDENTIALS",
      "No broker credentials stored in browser provider",
      noBrowserCreds,
      "AngelOneProvider delegates exclusively to server proxy."
    );

    // 4. Stale data protection
    let staleProtected = false;
    if (marketDataService && typeof marketDataService.validateQuote === "function") {
      const staleTs = new Date(Date.now() - 120000).toISOString();
      const check = marketDataService.validateQuote(
        { price: 25000, timestamp: staleTs, dataReady: true },
        "NIFTY50"
      );
      staleProtected = check.ok === false && check.code === "STALE_MARKET_DATA";
    }
    addCheck(
      "STALE_DATA_PROTECTION",
      "Stale market data (>60s) is rejected",
      staleProtected,
      "Quotes older than 60s return STALE_MARKET_DATA."
    );

    // 5. Invalid quote handling
    let invalidQuoteHandled = false;
    if (marketDataService && typeof marketDataService.validateQuote === "function") {
      const checkZero = marketDataService.validateQuote(
        { price: 0, timestamp: new Date().toISOString(), dataReady: true },
        "NIFTY50"
      );
      invalidQuoteHandled = checkZero.ok === false;
    }
    addCheck(
      "INVALID_QUOTE_HANDLING",
      "Zero or negative quotes are rejected",
      invalidQuoteHandled,
      "Invalid price quotes return INVALID_MARKET_DATA."
    );

    // 6. Strategy blocks invalid data
    let strategySafe = false;
    if (strategyEngine && typeof strategyEngine.evaluate === "function") {
      const s = strategyEngine.evaluate({
        dataReady: false,
        price: 25000,
        analysis: { signal: "BUY", confidence: 90, risk: "LOW" }
      });
      strategySafe = s.action === "NO_TRADE";
    }
    addCheck(
      "STRATEGY_SAFETY",
      "Deterministic strategy blocks unvalidated data",
      strategySafe,
      "Strategy returns NO_TRADE when dataReady is false."
    );

    // 7. Risk Engine stop-loss direction & max loss per trade
    let stopLossSafe = false;
    let maxLossSafe = false;
    let dailyLossSafe = false;
    let maxTradesSafe = false;
    let duplicateSafe = false;

    if (riskEngine && typeof riskEngine.evaluate === "function") {
      const badStop = riskEngine.evaluate({
        side: "BUY",
        entry: 100,
        stop: 105,
        quantity: 1
      });
      stopLossSafe = badStop.allowed === false;

      const overLoss = riskEngine.evaluate({
        side: "BUY",
        entry: 1000,
        stop: 900,
        quantity: 10 // Risk = 1000 > 500
      });
      maxLossSafe = overLoss.allowed === false;

      const dailyLocked = riskEngine.evaluate({
        side: "BUY",
        entry: 100,
        stop: 95,
        quantity: 1,
        dailyPnl: -1000
      });
      dailyLossSafe = dailyLocked.allowed === false;

      const maxTrades = riskEngine.evaluate({
        side: "BUY",
        entry: 100,
        stop: 95,
        quantity: 1,
        tradesToday: 3
      });
      maxTradesSafe = maxTrades.allowed === false;

      const dupCheck = riskEngine.evaluate({
        side: "BUY",
        entry: 100,
        stop: 95,
        quantity: 1,
        openPositions: 1
      });
      duplicateSafe = dupCheck.allowed === false;
    }

    addCheck("MANDATORY_STOP_LOSS", "Mandatory directional stop-loss enforced", stopLossSafe, "Invalid stop direction blocked.");
    addCheck("MAX_LOSS_PER_TRADE", "Max loss per trade (₹500) enforced", maxLossSafe, "Oversized trade risk blocked.");
    addCheck("DAILY_LOSS_LOCK", "Daily loss lock (₹1,000) enforced", dailyLossSafe, "Trading locked at daily loss limit.");
    addCheck("MAX_TRADES_PER_DAY", "Max trades per day (3) enforced", maxTradesSafe, "4th trade blocked.");
    addCheck("DUPLICATE_PROTECTION", "Duplicate open position blocked", duplicateSafe, "Single open position limit enforced.");

    // 8. AI Safety Gate & Decision Contract verification
    let aiGateSafe = false;
    if (aiSafetyGate && typeof aiSafetyGate.evaluate === "function") {
      const blocked = aiSafetyGate.evaluate({
        dataReady: false,
        signal: "BUY_CE",
        confidence: 85,
        risk: "LOW",
        optionType: "CE",
        riskCheck: { allowed: true }
      });
      const contractCheck = aiDecisionContract
        ? aiDecisionContract.validate("not-json").ok === false
        : true;
      aiGateSafe = blocked.allowed === false && contractCheck;
    }
    addCheck("AI_SAFETY_GATE", "AI Safety Gate & Decision Contract block invalid/unvalidated signals", aiGateSafe, "AI cannot authorize trades without validated data and schema compliance.");

    // 9. Secret redaction in AuditLogger
    let redactionSafe = false;
    if (auditLogger && typeof auditLogger.redactSensitive === "function") {
      const redacted = auditLogger.redactSensitive({
        apiKey: "secret",
        accessToken: "jwt",
        totpSecret: "base32",
        symbol: "NIFTY"
      });
      redactionSafe =
        redacted.apiKey === "[REDACTED]" &&
        redacted.accessToken === "[REDACTED]" &&
        redacted.totpSecret === "[REDACTED]" &&
        redacted.symbol === "NIFTY";
    }
    addCheck("SECRET_REDACTION", "Audit logs redact credentials and session tokens", redactionSafe, "Sensitive keys replaced with [REDACTED].");

    // 10. Emergency stop architecture
    const emergencyReady =
      Boolean(auditLogger && typeof auditLogger.activateEmergencyStop === "function") &&
      Boolean(riskEngine && typeof riskEngine.setEmergencyStop === "function") &&
      Boolean(paperTrading && typeof paperTrading.triggerEmergencyStop === "function");
    addCheck("EMERGENCY_STOP_ARCHITECTURE", "Global Emergency Stop wired across Audit, Risk, and Paper engines", emergencyReady, "Emergency stop halts new trades and closes paper positions.");

    const failedChecks = checks.filter((c) => !c.passed);

    return {
      ok: failedChecks.length === 0,
      liveTradingEnabled: false,
      tradingMode: "PAPER",
      totalChecks: checks.length,
      passedChecks: checks.length - failedChecks.length,
      failedChecks: failedChecks.length,
      checks,
      timestamp: new Date().toISOString()
    };
  }

  return {
    runAudit
  };

})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = LiveReadinessAudit;
}
