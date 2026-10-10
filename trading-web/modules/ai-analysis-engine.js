/*
 * YASHWIN AI Trading Assistant
 * Task 6 — Complete AI Analysis UI Engine
 *
 * Strictly enforces:
 * - Zero fabricated prices, confidence scores, signals, news, or AI responses
 * - Confidence displayed ONLY when dataReady=true and validated
 * - Entry, Mandatory Stop-Loss, Target, and Risk/Reward displayed ONLY when valid
 * - Explicit Google AI configuration/error states when GEMINI_API_KEY is missing or provider fails
 * - Strict AIDecisionContract and AISafetyGate enforcement
 * - Paper Trading only (LIVE_TRADING_ENABLED=false)
 */

const AIAnalysisEngine = (() => {
  function getMarketDataRef(custom) {
    if (custom) return custom;
    if (typeof MarketData !== "undefined") return MarketData;
    if (typeof require === "function") {
      try {
        return require("./market-data");
      } catch (_) {}
    }
    return null;
  }

  function getMarketAnalysisRef(custom) {
    if (custom) return custom;
    if (typeof MarketAnalysis !== "undefined") return MarketAnalysis;
    if (typeof require === "function") {
      try {
        return require("./market-analysis");
      } catch (_) {}
    }
    return null;
  }

  function getAIDecisionContractRef(custom) {
    if (custom) return custom;
    if (typeof AIDecisionContract !== "undefined") return AIDecisionContract;
    if (typeof require === "function") {
      try {
        return require("./ai-decision-contract");
      } catch (_) {}
    }
    return null;
  }

  function getAISafetyGateRef(custom) {
    if (custom) return custom;
    if (typeof AISafetyGate !== "undefined") return AISafetyGate;
    if (typeof require === "function") {
      try {
        return require("./ai-safety-gate");
      } catch (_) {}
    }
    return null;
  }

  function getStrategyEngineRef(custom) {
    if (custom) return custom;
    if (typeof StrategyEngine !== "undefined") return StrategyEngine;
    if (typeof require === "function") {
      try {
        return require("./strategy-engine");
      } catch (_) {}
    }
    return null;
  }

  function getRiskEngineRef(custom) {
    if (custom) return custom;
    if (typeof RiskEngine !== "undefined") return RiskEngine;
    if (typeof require === "function") {
      try {
        return require("./risk-engine");
      } catch (_) {}
    }
    return null;
  }

  function getChartEngineRef(custom) {
    if (custom) return custom;
    if (typeof ChartEngine !== "undefined") return ChartEngine;
    if (typeof require === "function") {
      try {
        return require("./chart-engine");
      } catch (_) {}
    }
    return null;
  }

  function formatINR(value) {
    const n = Number(value);
    if (value === null || value === undefined || value === "" || !Number.isFinite(n)) {
      return "--";
    }
    return (
      "₹" +
      n.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    );
  }

  function formatNumber(value, decimals = 2) {
    const n = Number(value);
    if (value === null || value === undefined || value === "" || !Number.isFinite(n)) {
      return "--";
    }
    return n.toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function buildAIAnalysisPayload(snapshot, instrument, deterministicAnalysis, options = {}) {
    if (!snapshot || snapshot.dataReady !== true) {
      return {
        ok: false,
        code: "MARKET_DATA_NOT_READY",
        message: "Validated market data (dataReady=true) is required before running AI analysis."
      };
    }

    const price = Number(snapshot.price);
    if (!Number.isFinite(price) || price <= 0) {
      return {
        ok: false,
        code: "INVALID_MARKET_PRICE",
        message: "Valid positive market price is required for AI analysis."
      };
    }

    const rawType = String(
      instrument?.type || instrument?.instrumentType || snapshot.type || "EQUITY"
    )
      .trim()
      .toUpperCase();
    const assetType = rawType === "OPTION" ? "OPTION" : "EQUITY";

    const candles = Array.isArray(snapshot.candles)
      ? snapshot.candles.slice(-60)
      : [];

    return {
      ok: true,
      payload: {
        dataReady: true,
        symbol: String(
          instrument?.name ||
            instrument?.tradingsymbol ||
            snapshot.name ||
            snapshot.instrument ||
            "NIFTY 50"
        ).trim(),
        tradingsymbol: instrument?.tradingsymbol || snapshot.tradingsymbol || null,
        exchange: String(instrument?.exchange || snapshot.exchange || "NSE")
          .trim()
          .toUpperCase(),
        assetType,
        optionType: String(instrument?.optionType || snapshot.optionType || "")
          .trim()
          .toUpperCase(),
        timeframe: String(options.interval || "FIVE_MINUTE").trim().toUpperCase(),
        price,
        open: Number(snapshot.open) || price,
        high: Number(snapshot.high) || price,
        low: Number(snapshot.low) || price,
        previousClose: Number(snapshot.previousClose) || price,
        volume: Number(snapshot.volume) || 0,
        quoteTimestamp: snapshot.timestamp || null,
        candlesCount: candles.length,
        candles,
        indicators: snapshot.indicators && typeof snapshot.indicators === "object"
          ? snapshot.indicators
          : {},
        deterministicAnalysis:
          deterministicAnalysis && typeof deterministicAnalysis === "object"
            ? deterministicAnalysis
            : null,
        marketIntelligenceContext:
          options.marketIntelligence && options.marketIntelligence.available === true
            ? {
                role: "SUPPORTING_CONTEXT_ONLY",
                provider: options.marketIntelligence.provider || options.marketIntelligence.source,
                sentiment: options.marketIntelligence.sentiment?.available
                  ? options.marketIntelligence.sentiment.label
                  : null,
                sentimentScore: options.marketIntelligence.sentiment?.available
                  ? options.marketIntelligence.sentiment.score
                  : null,
                headlines: Array.isArray(options.marketIntelligence.headlines)
                  ? options.marketIntelligence.headlines.slice(0, 5)
                  : []
              }
            : null,
        dataSource: options.dataSource === "MOCK" ? "MOCK" : "REAL"
      }
    };
  }

  function deriveSupportingReasons(dataReady, analysis, aiDecision, indicators, marketIntelligence) {
    if (!dataReady) {
      return [
        "Waiting for validated market quote and historical candles before generating analysis reasons."
      ];
    }

    const reasons = [];

    if (aiDecision && aiDecision.valid === true && aiDecision.reasoning) {
      reasons.push(`[Google AI (${aiDecision.source})]: ${aiDecision.reasoning}`);
    }

    if (analysis && Array.isArray(analysis.reasons) && analysis.reasons.length > 0) {
      analysis.reasons.forEach((r) => {
        if (r && !reasons.includes(r)) {
          reasons.push(`[Deterministic Engine]: ${r}`);
        }
      });
    }

    if (indicators && indicators.dataQuality && indicators.dataQuality !== "DATA_UNAVAILABLE") {
      const compNotes = [];
      if (Number.isFinite(Number(indicators.ema9)) && Number.isFinite(Number(indicators.ema21))) {
        compNotes.push(
          Number(indicators.ema9) >= Number(indicators.ema21)
            ? `EMA 9 (${formatNumber(indicators.ema9)}) is above EMA 21 (${formatNumber(indicators.ema21)})`
            : `EMA 9 (${formatNumber(indicators.ema9)}) is below EMA 21 (${formatNumber(indicators.ema21)})`
        );
      }
      if (Number.isFinite(Number(indicators.rsi14))) {
        compNotes.push(`RSI 14 is at ${formatNumber(indicators.rsi14, 1)}`);
      }
      if (indicators.macd && indicators.macd.state && indicators.macd.state !== "UNAVAILABLE") {
        compNotes.push(`MACD state is ${indicators.macd.state}`);
      }
      if (indicators.marketRegime && indicators.marketRegime !== "UNKNOWN") {
        compNotes.push(`Market Regime classified as ${indicators.marketRegime}`);
      }
      if (compNotes.length > 0) {
        reasons.push(`[Technical Structure]: ${compNotes.join(" • ")}.`);
      }
    }

    if (marketIntelligence && marketIntelligence.available === true) {
      const intelNotes = [];
      const sentObj = marketIntelligence.sentiment;
      if (sentObj && typeof sentObj === "object" && sentObj.available && sentObj.source) {
        intelNotes.push(
          `Verified Sentiment: ${sentObj.label} (${sentObj.score > 0 ? "+" : ""}${sentObj.score} via ${sentObj.source})`
        );
      } else if (
        typeof marketIntelligence.sentiment === "string" &&
        marketIntelligence.sentimentScore !== null &&
        marketIntelligence.source
      ) {
        intelNotes.push(
          `Verified Sentiment: ${marketIntelligence.sentiment} (${marketIntelligence.sentimentScore} via ${marketIntelligence.source})`
        );
      }
      const topHeadline =
        Array.isArray(marketIntelligence.headlines) && marketIntelligence.headlines[0]
          ? typeof marketIntelligence.headlines[0] === "string"
            ? marketIntelligence.headlines[0]
            : marketIntelligence.headlines[0].headline || marketIntelligence.headlines[0].title
          : null;
      if (topHeadline) {
        intelNotes.push(`Top Headline: "${topHeadline}"`);
      }
      if (intelNotes.length > 0) {
        reasons.push(
          `[Market Intelligence (Supporting Context Only — Never Overrides Price/Technicals/Risk)]: ${intelNotes.join(" • ")}`
        );
      }
    }

    if (reasons.length === 0) {
      reasons.push("Deterministic multi-factor analysis completed on validated market data.");
    }

    return reasons;
  }

  function deriveRiskWarningsAndInvalidation({
    dataReady,
    isStale,
    emergencyStop,
    analysis,
    aiDecision,
    aiError,
    gateEval,
    riskEval,
    tradeLevels,
    indicators
  }) {
    const warnings = [];
    const invalidations = [];

    if (emergencyStop) {
      warnings.push("CRITICAL: Global Emergency Stop is ACTIVE. All trade authorizations are halted.");
    }

    if (!dataReady) {
      warnings.push("Validated market data is unavailable (DATA_WAITING). Signals and trade execution are locked.");
    }

    if (isStale) {
      warnings.push("Market quote timestamp is STALE (>5 minutes old). Execution is blocked until a fresh quote arrives.");
    }

    if (aiError) {
      warnings.push(`AI Provider Notice: ${aiError}`);
    }

    if (aiDecision && aiDecision.valid === false) {
      warnings.push(
        `AI Decision Contract rejected provider output (${aiDecision.reasoning || "Schema violation"}). Enforcing safe fallback NO_TRADE / HOLD.`
      );
    }

    const effectiveRisk = aiDecision?.valid
      ? aiDecision.risk
      : analysis?.risk || "HIGH";

    if (effectiveRisk === "HIGH") {
      warnings.push("Risk classification is HIGH. Directional trade signals are automatically suppressed to NO_TRADE / HOLD.");
    }

    if (gateEval && !gateEval.allowed && Array.isArray(gateEval.reasons)) {
      gateEval.reasons.forEach((r) => {
        if (r && !warnings.includes(r)) {
          warnings.push(`Safety Gate: ${r}`);
        }
      });
    }

    if (riskEval && !riskEval.allowed && Array.isArray(riskEval.reasons)) {
      riskEval.reasons.forEach((r) => {
        if (r && !warnings.includes(r)) {
          warnings.push(`Risk Engine: ${r}`);
        }
      });
    }

    // Invalidation Conditions
    if (tradeLevels && tradeLevels.valid) {
      if (tradeLevels.tradeSide === "BUY") {
        invalidations.push(
          `Bullish setup invalidated if price breaches mandatory Stop-Loss at ${tradeLevels.stopLossFormatted}.`
        );
      } else if (tradeLevels.tradeSide === "SELL") {
        invalidations.push(
          `Bearish setup invalidated if price breaches mandatory Stop-Loss at ${tradeLevels.stopLossFormatted}.`
        );
      }
    }

    if (indicators && Number.isFinite(Number(indicators.support)) && Number.isFinite(Number(indicators.resistance))) {
      invalidations.push(
        `Key structure boundaries: Support at ${formatINR(indicators.support)} • Resistance at ${formatINR(indicators.resistance)}.`
      );
    }

    invalidations.push(
      "Any transition to STALE market data, HIGH volatility regime, confidence dropping below 70%, or Emergency Stop activation immediately invalidates setup."
    );

    return {
      warnings,
      invalidations
    };
  }

  function buildAIAnalysisViewModel(input = {}) {
    const md = getMarketDataRef(input.marketDataEngine);
    const ma = getMarketAnalysisRef(input.marketAnalysisEngine);
    const contract = getAIDecisionContractRef(input.aiDecisionContract);
    const gate = getAISafetyGateRef(input.aiSafetyGate);
    const stratEngine = getStrategyEngineRef(input.strategyEngine);
    const riskEngine = getRiskEngineRef(input.riskEngine);
    const chartEngine = getChartEngineRef(input.chartEngine);

    const snapshot = input.snapshot || null;
    const instrument = input.instrument || {};
    const candles = Array.isArray(input.candles)
      ? input.candles
      : Array.isArray(snapshot?.candles)
        ? snapshot.candles
        : [];

    const interval = chartEngine
      ? chartEngine.normalizeInterval(input.interval || "FIVE_MINUTE")
      : String(input.interval || "FIVE_MINUTE").trim().toUpperCase();
    const intervalMeta = chartEngine
      ? chartEngine.getIntervalMeta(interval)
      : { id: interval, shortLabel: interval, label: interval };

    const emergencyStop = Boolean(
      input.emergencyStop ||
        (riskEngine && typeof riskEngine.isEmergencyStopActive === "function" && riskEngine.isEmergencyStopActive())
    );

    // 1. Selected Instrument & Exchange
    const symbolName = String(
      instrument.name ||
        instrument.tradingsymbol ||
        snapshot?.name ||
        snapshot?.instrument ||
        "NIFTY 50"
    ).trim();
    const tradingsymbol = String(
      instrument.tradingsymbol || snapshot?.tradingsymbol || instrument.key || symbolName
    ).trim();
    const exchange = String(instrument.exchange || snapshot?.exchange || "NSE")
      .trim()
      .toUpperCase();
    const rawType = String(
      instrument.type || instrument.instrumentType || snapshot?.type || "EQUITY"
    )
      .trim()
      .toUpperCase();
    const assetType = rawType === "OPTION" ? "OPTION" : "EQUITY";
    const optionType = String(instrument.optionType || snapshot?.optionType || "")
      .trim()
      .toUpperCase();

    // 2. Quote & Data Freshness Validation
    const hasValidPrice =
      Boolean(snapshot && snapshot.dataReady === true) &&
      Number.isFinite(Number(snapshot.price)) &&
      Number(snapshot.price) > 0;

    const quoteTimestamp = snapshot?.timestamp || null;
    let isStale = snapshot?.status === "STALE_MARKET_DATA";
    let ageSeconds = null;

    if (quoteTimestamp) {
      const parsedMs = Date.parse(quoteTimestamp);
      if (Number.isFinite(parsedMs)) {
        ageSeconds = Math.max(0, Math.round((Date.now() - parsedMs) / 1000));
        if (ageSeconds > 300) {
          isStale = true;
        }
      }
    }

    const dataReady = hasValidPrice && !isStale;
    const price = dataReady ? Number(snapshot.price) : null;
    const prevClose =
      dataReady && Number.isFinite(Number(snapshot.previousClose)) && Number(snapshot.previousClose) > 0
        ? Number(snapshot.previousClose)
        : null;
    const changeAbs = dataReady && prevClose !== null ? price - prevClose : null;
    const changePct =
      dataReady && prevClose !== null && prevClose > 0
        ? ((price - prevClose) / prevClose) * 100
        : null;

    let freshnessBadge = "WAITING FOR DATA";
    if (isStale) {
      freshnessBadge = "STALE DATA";
    } else if (dataReady) {
      freshnessBadge = ageSeconds !== null ? `FRESH (${ageSeconds}s ago)` : "FRESH (VALIDATED)";
    } else if (snapshot?.status && snapshot.status !== "DATA_WAITING") {
      freshnessBadge = String(snapshot.status).replace(/_/g, " ");
    }

    // 3. Technical Indicators (Reuse existing calculations, never fabricate)
    let indicators = snapshot?.indicators || null;
    if (
      (!indicators || indicators.dataQuality === "DATA_UNAVAILABLE") &&
      md &&
      (dataReady || candles.length > 0)
    ) {
      const baseQuote = dataReady
        ? snapshot
        : candles.length > 0
          ? {
              price: candles[candles.length - 1].close,
              open: candles[candles.length - 1].open,
              high: candles[candles.length - 1].high,
              low: candles[candles.length - 1].low,
              previousClose:
                candles.length > 1
                  ? candles[candles.length - 2].close
                  : candles[candles.length - 1].open,
              volume: candles[candles.length - 1].volume
            }
          : null;
      if (baseQuote && typeof md.deriveIndicatorsFromQuote === "function") {
        indicators = md.deriveIndicatorsFromQuote(baseQuote, candles);
      }
    }

    const indAvailable = Boolean(
      indicators && indicators.dataQuality && indicators.dataQuality !== "DATA_UNAVAILABLE"
    );
    const bb = indicators?.bollingerBands;
    const bbFormatted =
      bb &&
      Number.isFinite(Number(bb.upper)) &&
      Number.isFinite(Number(bb.middle)) &&
      Number.isFinite(Number(bb.lower))
        ? `${formatNumber(bb.upper)} / ${formatNumber(bb.middle)} / ${formatNumber(bb.lower)}`
        : "--";

    const technicalSummary = {
      available: indAvailable,
      dataQuality: indicators?.dataQuality || "DATA_UNAVAILABLE",
      candlesCount: candles.length,
      ema9Formatted: indAvailable ? formatNumber(indicators.ema9) : "--",
      ema21Formatted: indAvailable ? formatNumber(indicators.ema21) : "--",
      sma20Formatted: indAvailable ? formatNumber(indicators.sma20) : "--",
      sma50Formatted: indAvailable ? formatNumber(indicators.sma50) : "--",
      vwapFormatted: indAvailable ? formatNumber(indicators.vwap) : "--",
      rsi14Formatted: indAvailable ? formatNumber(indicators.rsi14, 1) : "--",
      macdFormatted:
        indAvailable && indicators?.macd && Number.isFinite(Number(indicators.macd.value))
          ? `${formatNumber(indicators.macd.value)} (${indicators.macd.state || "NEUTRAL"})`
          : "--",
      bollingerFormatted: indAvailable ? bbFormatted : "--",
      atr14Formatted: indAvailable ? formatNumber(indicators.atr14) : "--",
      adx14Formatted: indAvailable ? formatNumber(indicators.adx14, 1) : "--",
      supportFormatted: indAvailable ? formatINR(indicators.support) : "--",
      resistanceFormatted: indAvailable ? formatINR(indicators.resistance) : "--",
      breakout: indAvailable && indicators?.breakout ? String(indicators.breakout) : "NONE",
      marketRegime: indAvailable && indicators?.marketRegime ? String(indicators.marketRegime) : "UNKNOWN"
    };

    // 4. Deterministic MarketAnalysis
    let analysis = input.analysis || null;
    if (!analysis && dataReady && ma && typeof ma.analyze === "function") {
      analysis = ma.analyze({
        dataReady: true,
        assetType,
        trendScore: indicators?.trendScore,
        momentumScore: indicators?.momentumScore,
        volumeScore: indicators?.volumeScore,
        vwapScore: indicators?.vwapScore,
        supportResistanceScore: indicators?.supportResistanceScore,
        volatilityScore: indicators?.volatilityScore,
        optionsScore:
          typeof ma.calculateOptionScore === "function" && snapshot?.options?.available === true
            ? ma.calculateOptionScore(snapshot.options)
            : null,
        newsScore: snapshot?.newsContext?.available ? snapshot.newsContext.score : null,
        breadthScore: snapshot?.breadth?.available ? 0 : null
      });
    }

    // 5. AI Decision Contract Validation
    let validatedAIDecision = null;
    let contractValidation = null;
    if (input.aiDecision !== undefined && input.aiDecision !== null) {
      if (
        typeof input.aiDecision === "object" &&
        input.aiDecision.contractVersion &&
        typeof input.aiDecision.valid === "boolean"
      ) {
        validatedAIDecision = input.aiDecision;
        contractValidation = {
          ok: input.aiDecision.valid === true,
          code: input.aiDecision.valid ? "VALID_AI_DECISION" : "AI_CONTRACT_VIOLATION",
          errors: input.aiDecision.valid ? [] : [input.aiDecision.reasoning || "Invalid AI contract"],
          decision: input.aiDecision
        };
      } else if (contract && typeof contract.validate === "function") {
        contractValidation = contract.validate(input.aiDecision);
        validatedAIDecision = contractValidation.decision;
      }
    }

    // 6. Decision, Action, Confidence, Trend & Risk Resolution
    let rawSignal = "NO_TRADE";
    let displayDecision = "NO_TRADE"; // Strictly one of BUY, SELL, HOLD, NO_TRADE
    let confidenceValue = null;
    let confidenceValidated = false;
    let trend = "UNKNOWN";
    let risk = "HIGH";
    let decisionSource = "WAITING_FOR_DATA";
    let analysisTimestamp = snapshot?.timestamp || null;

    if (emergencyStop) {
      rawSignal = "NO_TRADE";
      displayDecision = "NO_TRADE";
      confidenceValue = null;
      confidenceValidated = false;
      trend = "HALTED";
      risk = "HIGH";
      decisionSource = "EMERGENCY_STOP";
    } else if (dataReady) {
      if (validatedAIDecision) {
        if (validatedAIDecision.valid === true) {
          rawSignal = String(validatedAIDecision.signal || "NO_TRADE").toUpperCase();
          confidenceValue = Number.isFinite(Number(validatedAIDecision.confidence))
            ? Math.round(Number(validatedAIDecision.confidence))
            : null;
          confidenceValidated = confidenceValue !== null;
          trend = String(validatedAIDecision.trend || analysis?.trend || "UNKNOWN").toUpperCase();
          risk = String(validatedAIDecision.risk || analysis?.risk || "HIGH").toUpperCase();
          decisionSource = String(validatedAIDecision.source || "REAL_GOOGLE_AI");
          analysisTimestamp = validatedAIDecision.timestamp || analysis?.timestamp || quoteTimestamp;
        } else {
          // Invalid AI contract -> safe fallback NO_TRADE / HOLD
          rawSignal = "NO_TRADE";
          displayDecision = "NO_TRADE";
          confidenceValue = null;
          confidenceValidated = false;
          trend = "UNKNOWN";
          risk = "HIGH";
          decisionSource = "DETERMINISTIC_FALLBACK (INVALID_AI_CONTRACT)";
          analysisTimestamp = validatedAIDecision.timestamp || quoteTimestamp;
        }
      } else if (analysis && analysis.dataReady === true) {
        rawSignal = String(analysis.signal || "NO_TRADE").toUpperCase();
        confidenceValue = Number.isFinite(Number(analysis.confidence))
          ? Math.round(Number(analysis.confidence))
          : null;
        confidenceValidated = confidenceValue !== null;
        trend = String(analysis.trend || "UNKNOWN").toUpperCase();
        risk = String(analysis.risk || "HIGH").toUpperCase();
        decisionSource = "DETERMINISTIC_ENGINE";
        analysisTimestamp = analysis.timestamp || quoteTimestamp;
      }

      if (rawSignal === "BUY" || rawSignal === "BUY_CE" || rawSignal === "BUY_PE") {
        displayDecision = "BUY";
      } else if (rawSignal === "SELL") {
        displayDecision = "SELL";
      } else if (rawSignal === "HOLD" || rawSignal === "WATCH") {
        displayDecision = "HOLD";
      } else {
        displayDecision = "NO_TRADE";
      }
    }

    // 7. Strategy Engine Evaluation (Entry, Mandatory Stop-Loss, Target, Risk/Reward)
    let strategy = input.strategy || null;
    if (
      !strategy &&
      dataReady &&
      price !== null &&
      stratEngine &&
      typeof stratEngine.evaluate === "function"
    ) {
      const stopSuggestion =
        validatedAIDecision?.valid && Number.isFinite(Number(validatedAIDecision.stopLossSuggestion))
          ? Number(validatedAIDecision.stopLossSuggestion)
          : undefined;
      const targetSuggestion =
        validatedAIDecision?.valid && Number.isFinite(Number(validatedAIDecision.targetSuggestion))
          ? Number(validatedAIDecision.targetSuggestion)
          : undefined;

      const effectiveAnalysisForStrategy =
        validatedAIDecision?.valid === true
          ? {
              dataReady: true,
              signal: validatedAIDecision.signal,
              confidence: validatedAIDecision.confidence,
              risk: validatedAIDecision.risk,
              trend: validatedAIDecision.trend
            }
          : analysis;

      strategy = stratEngine.evaluate({
        dataReady: true,
        analysis: effectiveAnalysisForStrategy,
        aiDecision: validatedAIDecision,
        price,
        assetType,
        stopLoss: stopSuggestion,
        target: targetSuggestion,
        emergencyStop
      });
    }

    const levelsValid = Boolean(
      dataReady &&
        !emergencyStop &&
        strategy &&
        strategy.action &&
        strategy.action !== "NO_TRADE" &&
        strategy.action !== "HOLD" &&
        Number.isFinite(Number(strategy.entry)) &&
        Number(strategy.entry) > 0 &&
        Number.isFinite(Number(strategy.stopLoss)) &&
        Number(strategy.stopLoss) > 0 &&
        Number.isFinite(Number(strategy.target)) &&
        Number(strategy.target) > 0
    );

    const entryVal = levelsValid ? Number(strategy.entry) : null;
    const stopVal = levelsValid ? Number(strategy.stopLoss) : null;
    const targetVal = levelsValid ? Number(strategy.target) : null;

    const unitRisk =
      levelsValid && Math.abs(entryVal - stopVal) > 0
        ? Math.abs(entryVal - stopVal)
        : null;
    const unitReward =
      levelsValid && Math.abs(targetVal - entryVal) > 0
        ? Math.abs(targetVal - entryVal)
        : null;
    const rrRatio =
      unitRisk !== null && unitReward !== null && unitRisk > 0
        ? Number((unitReward / unitRisk).toFixed(2))
        : null;

    const tradeLevels = {
      valid: levelsValid,
      tradeSide: levelsValid ? String(strategy.tradeSide || displayDecision) : "HOLD",
      entry: entryVal,
      entryFormatted: levelsValid ? formatINR(entryVal) : "--",
      stopLoss: stopVal,
      stopLossFormatted: levelsValid ? formatINR(stopVal) : "--",
      target: targetVal,
      targetFormatted: levelsValid ? formatINR(targetVal) : "--",
      unitRisk,
      unitRiskFormatted: unitRisk !== null ? formatINR(unitRisk) : "--",
      unitReward,
      unitRewardFormatted: unitReward !== null ? formatINR(unitReward) : "--",
      riskRewardRatio: rrRatio,
      riskRewardFormatted: rrRatio !== null ? `1 : ${rrRatio.toFixed(2)}` : "--"
    };

    // 8. RiskEngine & AISafetyGate Evaluation
    const paperState = input.paperState || {};
    let riskEval = null;
    if (riskEngine && typeof riskEngine.evaluate === "function") {
      if (levelsValid) {
        riskEval = riskEngine.evaluate({
          side: tradeLevels.tradeSide === "SELL" ? "SELL" : "BUY",
          entry: entryVal,
          stop: stopVal,
          quantity: 1,
          assetType,
          lotSize: Number(instrument.lotSize) || 1,
          lots: 1,
          dailyPnl: Number(paperState.dailyPnl) || 0,
          tradesToday: Number(paperState.tradesToday) || 0,
          openPositions: paperState.position ? 1 : 0,
          averaging: false,
          emergencyStop
        });
      } else {
        riskEval = {
          allowed: !emergencyStop && dataReady,
          status: !emergencyStop && dataReady ? "STANDBY" : "BLOCKED",
          reasons: emergencyStop
            ? ["Emergency stop is active."]
            : !dataReady
              ? ["Validated market data is required."]
              : ["No executable trade setup active."]
        };
      }
    }

    let gateEval = {
      allowed: false,
      status: "BLOCKED",
      reasons: ["Validated market data is required before AI trade approval."]
    };

    if (gate && typeof gate.evaluate === "function") {
      gateEval = gate.evaluate({
        dataReady,
        staleData: isStale,
        signal: rawSignal,
        confidence: confidenceValidated ? confidenceValue : NaN,
        risk,
        assetType,
        optionType,
        side: tradeLevels.tradeSide === "SELL" ? "SELL" : "BUY",
        stopLoss: stopVal ?? undefined,
        aiDecision: input.aiDecision !== undefined ? input.aiDecision : undefined,
        riskCheck: { allowed: Boolean(riskEval ? riskEval.allowed : !emergencyStop) },
        tradesToday: paperState.tradesToday,
        maxTradesPerDay: paperState.maxTradesPerDay,
        openPositions: paperState.position ? 1 : 0,
        maxOpenPositions: 1,
        emergencyStop,
        averaging: false
      });
    }

    // 9. AI Provider & Configuration Status
    const aiStatusInput = input.aiStatus || {};
    const credentialsConfigured = Boolean(
      aiStatusInput.credentialsConfigured ?? input.googleAIConfigured
    );
    const providerModel = String(aiStatusInput.model || "gemini-3.8-flash");
    const providerMode = String(aiStatusInput.mode || "SERVER_ONLY");
    const aiLoading = Boolean(input.aiLoading);
    const aiError = input.aiError ? String(input.aiError) : null;

    let providerBadge = "NOT CONFIGURED";
    let providerStateCode = "UNCONFIGURED";
    let providerMessage =
      "Google AI server key (GEMINI_API_KEY) is not configured. Using deterministic multi-factor analysis engine.";

    if (aiLoading) {
      providerBadge = "ANALYZING...";
      providerStateCode = "LOADING";
      providerMessage = `Requesting server-side Google AI (${providerModel}) assessment on validated market data...`;
    } else if (aiError) {
      providerBadge = "PROVIDER ERROR";
      providerStateCode = "ERROR";
      providerMessage = aiError;
    } else if (validatedAIDecision && validatedAIDecision.valid === false) {
      providerBadge = "CONTRACT REJECTED";
      providerStateCode = "CONTRACT_REJECTED";
      providerMessage = `AI output rejected by AIDecisionContract: ${validatedAIDecision.reasoning}`;
    } else if (validatedAIDecision && validatedAIDecision.valid === true) {
      providerBadge =
        validatedAIDecision.source === "MOCK_AI"
          ? "MOCK AI (VALIDATED)"
          : "GOOGLE AI (VALIDATED)";
      providerStateCode = "READY";
      providerMessage = `Server-side ${validatedAIDecision.source} (${providerModel}) output validated by AIDecisionContract v${validatedAIDecision.contractVersion}.`;
    } else if (credentialsConfigured) {
      providerBadge = "CONFIGURED (READY)";
      providerStateCode = "CONFIGURED";
      providerMessage = dataReady
        ? `Google AI (${providerModel}) is configured on server. Click "Run AI Analysis" to request a fresh assessment.`
        : `Google AI (${providerModel}) is configured on server. Waiting for validated market data before querying AI.`;
    }

    // 10. Supporting Reasons, Risk Warnings & Invalidation Conditions
    const supportingReasons = deriveSupportingReasons(
      dataReady,
      analysis,
      validatedAIDecision,
      indicators,
      input.marketIntelligence
    );

    const { warnings, invalidations } = deriveRiskWarningsAndInvalidation({
      dataReady,
      isStale,
      emergencyStop,
      analysis,
      aiDecision: validatedAIDecision,
      aiError,
      gateEval,
      riskEval,
      tradeLevels,
      indicators
    });

    // 11. Persisted Analysis History
    const rawHistory = Array.isArray(input.aiHistory) ? input.aiHistory : [];
    const history = rawHistory.slice(0, 20).map((item) => {
      const sig = String(item.signal || "NO_TRADE").toUpperCase();
      let normAction = "NO_TRADE";
      if (sig === "BUY" || sig === "BUY_CE" || sig === "BUY_PE") normAction = "BUY";
      else if (sig === "SELL") normAction = "SELL";
      else if (sig === "HOLD" || sig === "WATCH") normAction = "HOLD";

      const conf = Number(item.confidence);
      const reasoning =
        item.payload?.reasoning ||
        item.reasoning ||
        `Signal ${sig} (${item.risk || "HIGH"} risk)`;

      return {
        decisionId: item.decisionId || item.id || "--",
        symbol: String(item.symbol || "NIFTY 50"),
        signal: sig,
        decision: normAction,
        confidence: Number.isFinite(conf) ? `${Math.round(conf)}%` : "--%",
        risk: String(item.risk || "HIGH").toUpperCase(),
        trend: String(item.trend || "UNKNOWN").toUpperCase(),
        source: String(item.source || "DETERMINISTIC"),
        reasoning: String(reasoning),
        timestamp: item.timestamp || item.created_at || "--"
      };
    });

    // 12. Paper Trading Staging Eligibility
    const canStageToPaper = Boolean(
      dataReady &&
        !isStale &&
        !emergencyStop &&
        levelsValid &&
        gateEval.allowed === true &&
        (!riskEval || riskEval.allowed === true)
    );

    let stageBlockedReason = null;
    if (!canStageToPaper) {
      if (emergencyStop) {
        stageBlockedReason = "Blocked: Emergency Stop is active.";
      } else if (!dataReady) {
        stageBlockedReason = "Blocked: Validated market data is unavailable.";
      } else if (isStale) {
        stageBlockedReason = "Blocked: Market quote is stale.";
      } else if (!levelsValid) {
        stageBlockedReason = `Blocked: Current decision is ${displayDecision} (${rawSignal}) without an executable entry/stop-loss/target setup.`;
      } else if (!gateEval.allowed) {
        stageBlockedReason = `Blocked by AISafetyGate: ${gateEval.reasons.join(" ")}`;
      } else if (riskEval && !riskEval.allowed) {
        stageBlockedReason = `Blocked by RiskEngine: ${riskEval.reasons.join(" ")}`;
      }
    }

    return {
      instrument: {
        name: symbolName,
        tradingsymbol,
        exchange,
        assetType,
        rawType,
        optionType,
        symboltoken: instrument.symboltoken || snapshot?.symboltoken || null
      },
      quoteAndFreshness: {
        dataReady,
        isStale,
        price,
        priceFormatted: dataReady ? formatINR(price) : "-- (DATA WAITING)",
        changeAbs,
        changePct,
        changeFormatted:
          dataReady && changePct !== null
            ? `${changeAbs >= 0 ? "+" : ""}${formatNumber(changeAbs)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`
            : "Waiting for validated quote",
        timestamp: quoteTimestamp || "--",
        freshnessBadge,
        status: snapshot?.status || "DATA_WAITING"
      },
      timeframe: {
        id: interval,
        shortLabel: intervalMeta.shortLabel,
        label: intervalMeta.label,
        candlesCount: candles.length
      },
      decision: {
        displayDecision, // BUY | SELL | HOLD | NO_TRADE
        rawSignal,       // BUY | SELL | HOLD | NO_TRADE | WATCH | BUY_CE | BUY_PE
        confidence: confidenceValidated ? confidenceValue : null,
        confidenceValidated,
        confidenceFormatted:
          confidenceValidated && confidenceValue !== null
            ? `${confidenceValue}%`
            : "-- (UNVALIDATED)",
        trend,
        marketRegime: technicalSummary.marketRegime,
        risk,
        source: decisionSource,
        analysisTimestamp: analysisTimestamp || "--"
      },
      tradeLevels,
      technicalSummary,
      components: {
        score: dataReady && analysis ? Number(analysis.score) || 0 : 0,
        trend: dataReady && analysis ? Number(analysis.components?.trend) || 0 : 0,
        momentum: dataReady && analysis ? Number(analysis.components?.momentum) || 0 : 0,
        volume: dataReady && analysis ? Number(analysis.components?.volume) || 0 : 0,
        vwap: dataReady && analysis ? Number(analysis.components?.vwap) || 0 : 0,
        supportResistance:
          dataReady && analysis ? Number(analysis.components?.supportResistance) || 0 : 0,
        options: dataReady && analysis ? Number(analysis.components?.options) || 0 : 0
      },
      supportingReasons,
      riskWarnings: warnings,
      invalidationConditions: invalidations,
      safetyGate: {
        allowed: gateEval.allowed,
        status: gateEval.status,
        reasons: gateEval.reasons,
        contractValid: validatedAIDecision ? validatedAIDecision.valid === true : null,
        contractStatusText:
          validatedAIDecision?.valid === true
            ? `VALID (${validatedAIDecision.contractVersion})`
            : validatedAIDecision?.valid === false
              ? "REJECTED (FALLBACK TO HOLD/NO_TRADE)"
              : dataReady
                ? "DETERMINISTIC READY"
                : "WAITING"
      },
      providerStatus: {
        provider: "GOOGLE_GENAI",
        model: providerModel,
        mode: providerMode,
        credentialsConfigured,
        loading: aiLoading,
        error: aiError,
        stateCode: providerStateCode,
        badge: providerBadge,
        message: providerMessage
      },
      paperExecution: {
        canStageToPaper,
        stageBlockedReason,
        tradingMode: "PAPER",
        liveTradingEnabled: false
      },
      history
    };
  }

  return {
    formatINR,
    formatNumber,
    buildAIAnalysisPayload,
    buildAIAnalysisViewModel
  };
})();

if (typeof window !== "undefined") {
  window.AIAnalysisEngine = AIAnalysisEngine;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = AIAnalysisEngine;
}
