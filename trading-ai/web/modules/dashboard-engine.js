/*
 * YASHWIN AI Trading Assistant
 * Task 3 — Main Dashboard State & View Model Builder
 *
 * Pure, deterministic view-model builder for the 18 Main Dashboard sections.
 * Works identically in browser and Node.js test environments.
 *
 * Strictly enforces:
 * - Zero fabricated prices, signals, P&L, or confidence
 * - Confidence only displayed when market data is validated (dataReady === true)
 * - Stale quotes explicitly labeled STALE MARKET DATA (never LIVE / CURRENT)
 * - Authenticated vs Unauthenticated/Session-Expired state isolation
 * - Real server-side RiskEngine limits and Emergency Stop state
 * - Clear INR currency formatting ("₹1,00,000.00")
 */

const DashboardEngine = (() => {
  const REQUIRED_SECTIONS = [
    "marketStatus",
    "selectedInstrument",
    "priceAndChange",
    "aiMarketView",
    "signalBadge",
    "confidence",
    "tradeLevels",
    "riskReward",
    "technicalIndicators",
    "openPositions",
    "availablePaperBalance",
    "todaysRealizedPnl",
    "unrealizedPnl",
    "recentOrders",
    "recentTrades",
    "riskLimitStatus",
    "emergencyStopStatus",
    "marketDataFreshness"
  ];

  const NAVIGATION_TARGETS = [
    { id: "scanner", label: "Market Search", targetPage: "scanner" },
    { id: "analysis", label: "AI Analysis", targetPage: "analysis" },
    { id: "watchlist", label: "Watchlist", targetPage: "scanner" },
    { id: "portfolio", label: "Portfolio", targetPage: "positions" },
    { id: "orders", label: "Orders", targetPage: "orders" },
    { id: "history", label: "Trade History", targetPage: "history" },
    { id: "backtesting", label: "Backtesting", targetPage: "strategy" },
    { id: "risk", label: "Risk Management", targetPage: "risk" },
    { id: "account", label: "Account / Profile", targetPage: "account" },
    { id: "settings", label: "Settings", targetPage: "account" }
  ];

  function formatINR(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    return (
      sign +
      "₹" +
      abs.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    );
  }

  function formatPrice(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "--";
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
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(2)}%`;
  }

  function normalizeMarketStatus(rawStatus, dataReady, emergencyStop, apiError) {
    if (emergencyStop === true) {
      return {
        code: "EMERGENCY_STOP",
        label: "EMERGENCY STOP ACTIVE",
        isLive: false,
        isStale: false,
        tone: "danger"
      };
    }

    if (apiError) {
      return {
        code: "API_ERROR",
        label: "DATA UNAVAILABLE (API ERROR)",
        isLive: false,
        isStale: false,
        tone: "danger"
      };
    }

    const clean = String(rawStatus || "").trim().toUpperCase().replace(/\s+/g, "_");

    if (clean === "TWELVE_DATA_PLAN_RESTRICTED" || clean === "PLAN_RESTRICTED") {
      return {
        code: "TWELVE_DATA_PLAN_RESTRICTED",
        label: "PROVIDER PLAN RESTRICTED",
        isLive: false,
        isStale: false,
        tone: "danger"
      };
    }

    if (clean === "TWELVE_DATA_UNSUPPORTED_INSTRUMENT" || clean === "UNSUPPORTED_INSTRUMENT") {
      return {
        code: "TWELVE_DATA_UNSUPPORTED_INSTRUMENT",
        label: "UNSUPPORTED INSTRUMENT",
        isLive: false,
        isStale: false,
        tone: "warning"
      };
    }

    if (
      clean === "TWELVE_DATA_RATE_LIMITED" ||
      clean === "TWELVE_DATA_DAILY_QUOTA_EXCEEDED" ||
      clean === "RATE_LIMITED"
    ) {
      return {
        code: clean,
        label: "PROVIDER RATE LIMITED",
        isLive: false,
        isStale: false,
        tone: "warning"
      };
    }

    if (clean === "STALE_MARKET_DATA" || clean === "STALE_DATA") {
      return {
        code: "STALE_MARKET_DATA",
        label: "STALE MARKET DATA",
        isLive: false,
        isStale: true,
        tone: "warning"
      };
    }

    if (
      clean === "INVALID_MARKET_DATA" ||
      clean === "FUTURE_MARKET_DATA" ||
      clean === "FUTURE_QUOTE_TIMESTAMP"
    ) {
      return {
        code: "INVALID_MARKET_DATA",
        label: "INVALID MARKET DATA",
        isLive: false,
        isStale: false,
        tone: "danger"
      };
    }

    if (dataReady === true && (clean === "LIVE_DATA" || clean === "OK" || clean === "")) {
      return {
        code: "LIVE_DATA",
        label: "VALIDATED MARKET FEED",
        isLive: true,
        isStale: false,
        tone: "positive"
      };
    }

    return {
      code: "DATA_WAITING",
      label: "DATA WAITING",
      isLive: false,
      isStale: false,
      tone: "neutral"
    };
  }

  function buildDashboardViewModel(input = {}) {
    const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
    const maxQuoteAgeMs = Number(input.maxQuoteAgeMs) > 0 ? Number(input.maxQuoteAgeMs) : 60000;

    const user = input.user || null;
    const sessionExpired = Boolean(input.sessionExpired);
    const loading = Boolean(input.loading);
    const snapshot = input.snapshot || null;
    const apiError = input.apiError
      ? String(input.apiError)
      : snapshot?.errorMessage
        ? String(snapshot.errorMessage)
        : null;

    const emergencyStop = Boolean(
      input.emergencyStop ||
        input.paperState?.emergencyStop ||
        input.serverEmergencyStop?.active
    );
    const instrument = input.instrument || {
      key: snapshot?.instrument || "NIFTY50",
      name: snapshot?.name || "NIFTY 50",
      exchange: snapshot?.exchange || "NSE",
      type: snapshot?.type || "INDEX"
    };

    // Determine quote freshness & timestamp validity
    const rawTimestamp = snapshot?.timestamp || input.quoteTimestamp || null;
    let timestampMs = rawTimestamp ? Date.parse(rawTimestamp) : NaN;
    let quoteAgeMs = Number.isFinite(timestampMs) ? nowMs - timestampMs : null;
    let isStaleByAge =
      quoteAgeMs !== null && Number.isFinite(quoteAgeMs) && quoteAgeMs > maxQuoteAgeMs;

    const rawSnapStatus = isStaleByAge
      ? "STALE_MARKET_DATA"
      : snapshot?.status || input.dataStatus || "DATA_WAITING";

    const dataReady =
      !isStaleByAge &&
      snapshot?.dataReady === true &&
      Number.isFinite(Number(snapshot?.price)) &&
      Number(snapshot?.price) > 0;

    const marketStatus = normalizeMarketStatus(
      rawSnapStatus,
      dataReady,
      emergencyStop,
      apiError
    );

    // 2. Selected Instrument
    const selectedInstrument = {
      key: instrument.key || "NIFTY50",
      name: instrument.name || instrument.tradingsymbol || "NIFTY 50",
      tradingsymbol: instrument.tradingsymbol || instrument.name || "NIFTY 50",
      exchange: String(instrument.exchange || "NSE").toUpperCase(),
      type: String(instrument.type || "INDEX").toUpperCase(),
      optionType: instrument.optionType || snapshot?.optionType || null,
      strikePrice: instrument.strikePrice ?? snapshot?.strikePrice ?? null,
      expiry: instrument.expiry || snapshot?.expiry || null
    };

    // 3. Current Price and Percentage Change (only when validated and not stale)
    let priceValue = null;
    let changeAbs = null;
    let changePct = null;
    let changeDirection = "NEUTRAL";

    if (dataReady) {
      priceValue = Number(snapshot.price);
      const refPrice =
        Number.isFinite(Number(snapshot.previousClose)) && Number(snapshot.previousClose) > 0
          ? Number(snapshot.previousClose)
          : Number.isFinite(Number(snapshot.open)) && Number(snapshot.open) > 0
            ? Number(snapshot.open)
            : null;

      if (refPrice !== null && refPrice > 0) {
        changeAbs = priceValue - refPrice;
        changePct = (changeAbs / refPrice) * 100;
        changeDirection =
          changeAbs > 0 ? "POSITIVE" : changeAbs < 0 ? "NEGATIVE" : "NEUTRAL";
      }
    }

    const priceAndChange = {
      available: dataReady,
      price: priceValue,
      priceFormatted: dataReady ? formatPrice(priceValue) : "--",
      changeAbs,
      changeAbsFormatted:
        changeAbs !== null
          ? `${changeAbs >= 0 ? "+" : ""}${formatINR(changeAbs)}`
          : "--",
      changePct,
      changePctFormatted: changePct !== null ? formatPercent(changePct) : "--",
      changeDirection,
      statusNote: marketStatus.isStale
        ? "STALE QUOTE — Price hidden for safety"
        : dataReady
          ? "VALIDATED QUOTE"
          : "WAITING FOR VALIDATED QUOTE"
    };

    // 4, 5, 6. AI Market View, BUY/SELL/HOLD/NO_TRADE, and Validated Confidence
    const analysis = dataReady ? input.analysis || null : null;
    const aiDecision =
      dataReady && input.aiDecision && input.aiDecision.valid === true
        ? input.aiDecision
        : null;
    const strategy = dataReady ? input.strategy || null : null;

    let displaySignal = "NO_TRADE";
    let actionBadge = "NO_TRADE"; // Strict BUY / SELL / HOLD / NO_TRADE
    let confidenceValue = null;
    let trendLabel = "Waiting";
    let riskClass = "HIGH";
    let aiSummary =
      "Waiting for validated market data. No AI trading signal is generated.";
    let aiSourceLabel = "WAITING";

    if (emergencyStop) {
      displaySignal = "NO_TRADE";
      actionBadge = "NO_TRADE";
      confidenceValue = null;
      trendLabel = "Halted";
      riskClass = "HIGH";
      aiSummary = "Emergency Stop is ACTIVE. All AI and strategy signals are forced to NO_TRADE.";
      aiSourceLabel = "EMERGENCY_STOP";
    } else if (marketStatus.isStale) {
      displaySignal = "NO_TRADE";
      actionBadge = "NO_TRADE";
      confidenceValue = null;
      trendLabel = "Stale Feed";
      riskClass = "HIGH";
      aiSummary = "Quote timestamp is stale (>60s). AI signal generation is blocked until a fresh quote arrives.";
      aiSourceLabel = "STALE_BLOCKED";
    } else if (dataReady && (aiDecision || analysis)) {
      const effectiveSource = aiDecision || analysis;
      const rawSig = String(
        strategy?.action || effectiveSource.signal || "NO_TRADE"
      )
        .trim()
        .toUpperCase();

      displaySignal = rawSig;
      if (rawSig === "BUY" || rawSig === "BUY_CE" || rawSig === "BUY_PE") {
        actionBadge = "BUY";
      } else if (rawSig === "SELL") {
        actionBadge = "SELL";
      } else if (rawSig === "HOLD" || rawSig === "WATCH") {
        actionBadge = "HOLD";
      } else {
        actionBadge = "NO_TRADE";
      }

      const rawConf = Number(effectiveSource.confidence);
      if (Number.isFinite(rawConf) && rawConf >= 0 && rawConf <= 100) {
        confidenceValue = Math.round(rawConf);
      }

      trendLabel = String(effectiveSource.trend || analysis?.trend || "SIDEWAYS").toUpperCase();
      riskClass = String(effectiveSource.risk || analysis?.risk || "HIGH").toUpperCase();
      aiSummary =
        aiDecision?.reasoning ||
        (Array.isArray(analysis?.reasons) && analysis.reasons.length
          ? analysis.reasons.join(" ")
          : "Validated market data analysed by deterministic AI contract.");
      aiSourceLabel = aiDecision?.source || "DETERMINISTIC_ENGINE";
    }

    // 7 & 8. Entry / Stop-loss / Target & Risk/Reward
    const hasLevels =
      dataReady &&
      !emergencyStop &&
      strategy &&
      (strategy.action === "BUY" ||
        strategy.action === "SELL" ||
        strategy.action === "BUY_CE" ||
        strategy.action === "BUY_PE") &&
      Number.isFinite(Number(strategy.entry)) &&
      Number(strategy.entry) > 0 &&
      Number.isFinite(Number(strategy.stopLoss)) &&
      Number(strategy.stopLoss) > 0 &&
      Number.isFinite(Number(strategy.target)) &&
      Number(strategy.target) > 0;

    let entryFormatted = "--";
    let stopLossFormatted = "--";
    let targetFormatted = "--";
    let riskPerUnit = null;
    let rewardPerUnit = null;
    let rrRatio = null;
    let rrFormatted = "--";

    if (hasLevels) {
      const e = Number(strategy.entry);
      const sl = Number(strategy.stopLoss);
      const tg = Number(strategy.target);
      entryFormatted = formatPrice(e);
      stopLossFormatted = formatPrice(sl);
      targetFormatted = formatPrice(tg);
      riskPerUnit = Math.abs(e - sl);
      rewardPerUnit = Math.abs(tg - e);
      rrRatio = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : null;
      rrFormatted = rrRatio !== null ? `1 : ${rrRatio.toFixed(2)}` : "--";
    } else if (
      dataReady &&
      !emergencyStop &&
      aiDecision &&
      Number.isFinite(Number(aiDecision.stopLossSuggestion)) &&
      Number.isFinite(Number(aiDecision.targetSuggestion)) &&
      priceValue > 0
    ) {
      const e = priceValue;
      const sl = Number(aiDecision.stopLossSuggestion);
      const tg = Number(aiDecision.targetSuggestion);
      entryFormatted = formatPrice(e);
      stopLossFormatted = formatPrice(sl);
      targetFormatted = formatPrice(tg);
      riskPerUnit = Math.abs(e - sl);
      rewardPerUnit = Math.abs(tg - e);
      rrRatio = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : null;
      rrFormatted = rrRatio !== null ? `1 : ${rrRatio.toFixed(2)}` : "--";
    }

    const tradeLevels = {
      available: entryFormatted !== "--",
      entry: hasLevels ? Number(strategy.entry) : null,
      stopLoss: hasLevels ? Number(strategy.stopLoss) : null,
      target: hasLevels ? Number(strategy.target) : null,
      entryFormatted,
      stopLossFormatted,
      targetFormatted
    };

    const riskReward = {
      available: rrRatio !== null,
      riskPerUnit,
      rewardPerUnit,
      riskFormatted: riskPerUnit !== null ? formatINR(riskPerUnit) : "--",
      rewardFormatted: rewardPerUnit !== null ? formatINR(rewardPerUnit) : "--",
      ratio: rrRatio,
      ratioFormatted: rrFormatted
    };

    // 9. Technical Indicators Summary
    const ind = dataReady && snapshot?.indicators ? snapshot.indicators : null;
    const bb = ind?.bollingerBands;
    const bbFormatted =
      bb &&
      Number.isFinite(Number(bb.upper)) &&
      Number.isFinite(Number(bb.middle)) &&
      Number.isFinite(Number(bb.lower))
        ? `${formatNumber(bb.upper)} / ${formatNumber(bb.middle)} / ${formatNumber(bb.lower)}`
        : "--";

    const technicalIndicators = {
      available: Boolean(ind && ind.dataQuality !== "DATA_UNAVAILABLE"),
      dataQuality: ind?.dataQuality || "DATA_UNAVAILABLE",
      marketRegime: ind?.marketRegime || "WAITING",
      breakout: ind?.breakout || "NONE",
      ema9: ind?.ema9 !== null && ind?.ema9 !== undefined ? formatNumber(ind.ema9) : "--",
      ema21: ind?.ema21 !== null && ind?.ema21 !== undefined ? formatNumber(ind.ema21) : "--",
      sma20: ind?.sma20 !== null && ind?.sma20 !== undefined ? formatNumber(ind.sma20) : "--",
      sma50: ind?.sma50 !== null && ind?.sma50 !== undefined ? formatNumber(ind.sma50) : "--",
      rsi14: ind?.rsi14 !== null && ind?.rsi14 !== undefined ? formatNumber(ind.rsi14, 1) : "--",
      vwap: ind?.vwap !== null && ind?.vwap !== undefined ? formatPrice(ind.vwap) : "--",
      macdState: ind?.macd?.state || "--",
      macdValue:
        ind?.macd?.macd !== null && ind?.macd?.macd !== undefined
          ? formatNumber(ind.macd.macd)
          : "--",
      bollingerBands: bbFormatted,
      atr14: ind?.atr14 !== null && ind?.atr14 !== undefined ? formatNumber(ind.atr14) : "--",
      adx14: ind?.adx14 !== null && ind?.adx14 !== undefined ? formatNumber(ind.adx14, 1) : "--",
      support:
        ind?.support !== null && ind?.support !== undefined ? formatPrice(ind.support) : "--",
      resistance:
        ind?.resistance !== null && ind?.resistance !== undefined
          ? formatPrice(ind.resistance)
          : "--"
    };

    // 10, 11, 12, 13, 14, 15. User-isolated Paper Account, Open Position, P&L, Orders, Trades
    const pState = input.paperState || {};
    const capital = Number.isFinite(Number(pState.capital)) ? Number(pState.capital) : 100000;
    const realizedDailyPnl = Number.isFinite(Number(pState.dailyPnl))
      ? Number(pState.dailyPnl)
      : 0;
    const totalRealizedPnl = Number.isFinite(Number(pState.realizedPnl))
      ? Number(pState.realizedPnl)
      : 0;

    const rawPos = pState.position || pState.openPosition || null;
    let openPositionModel = null;
    let unrealizedPnlValue = 0;
    let committedMargin = 0;

    if (rawPos && (rawPos.status === "OPEN" || !rawPos.status)) {
      const eq = Number(rawPos.effectiveQty || rawPos.qty || 0);
      const entryP = Number(rawPos.entry || 0);
      const currP = Number(rawPos.current || entryP);
      const side = String(rawPos.direction || "BUY").toUpperCase();
      unrealizedPnlValue =
        side === "BUY" ? (currP - entryP) * eq : (entryP - currP) * eq;
      committedMargin = Math.abs(entryP * eq);

      openPositionModel = {
        id: rawPos.id || null,
        symbol: rawPos.symbol || "NIFTY 50",
        direction: side,
        assetType: rawPos.assetType || "EQUITY",
        quantity: eq,
        entry: entryP,
        current: currP,
        stop: Number(rawPos.stop || 0),
        target: Number(rawPos.target || 0),
        entryFormatted: formatPrice(entryP),
        currentFormatted: formatPrice(currP),
        stopFormatted: formatPrice(rawPos.stop),
        targetFormatted: formatPrice(rawPos.target),
        unrealizedPnl: unrealizedPnlValue,
        unrealizedPnlFormatted: formatINR(unrealizedPnlValue)
      };
    }

    const availableBalanceValue = Math.max(
      0,
      capital + totalRealizedPnl - committedMargin
    );

    const rawOrders = Array.isArray(pState.orders) ? pState.orders : [];
    const rawTrades = Array.isArray(pState.history) ? pState.history : [];

    const recentOrders = rawOrders.slice(0, 5).map((o) => ({
      id: o.id || "--",
      type: o.type || "ENTRY",
      symbol: o.symbol || "--",
      direction: o.direction || "BUY",
      quantity: Number(o.quantity || 0),
      price: Number(o.price || 0),
      priceFormatted: formatPrice(o.price),
      status: o.status || "FILLED",
      timestamp: o.timestamp || "--"
    }));

    const recentTrades = rawTrades.slice(0, 5).map((t) => ({
      id: t.id || "--",
      symbol: t.symbol || "--",
      direction: t.direction || "BUY",
      quantity: Number(t.quantity || 0),
      entryPriceFormatted: formatPrice(t.entryPrice),
      exitPriceFormatted: formatPrice(t.exitPrice),
      pnl: Number(t.pnl || 0),
      pnlFormatted: formatINR(t.pnl),
      reason: t.reason || "MANUAL",
      closedAt: t.closedAt || t.timestamp || "--"
    }));

    const isEmptyAccount =
      !openPositionModel && rawOrders.length === 0 && rawTrades.length === 0;

    // 16 & 17. Risk Limit Status & Emergency Stop Status
    const riskLimits = input.riskLimits || {
      maxLossPerTrade: 500,
      maxDailyLoss: 1000,
      maxTradesPerDay: 3,
      maxOpenPositions: 1,
      allowAveraging: false
    };

    const tradesToday = Number(pState.tradesToday || 0);
    const openPositionsCount = openPositionModel ? 1 : 0;
    const dailyLossLocked = realizedDailyPnl <= -Number(riskLimits.maxDailyLoss || 1000);
    const maxTradesLocked = tradesToday >= Number(riskLimits.maxTradesPerDay || 3);
    const maxPosLocked = openPositionsCount >= Number(riskLimits.maxOpenPositions || 1);

    let riskStatusBadge = "PROTECTED";
    if (emergencyStop) {
      riskStatusBadge = "HALTED (EMERGENCY STOP)";
    } else if (dailyLossLocked) {
      riskStatusBadge = "LOCKED (DAILY LOSS LIMIT)";
    } else if (maxTradesLocked) {
      riskStatusBadge = "LOCKED (MAX DAILY TRADES)";
    } else if (maxPosLocked) {
      riskStatusBadge = "POSITION OPEN (1/1)";
    }

    const riskLimitStatus = {
      badge: riskStatusBadge,
      maxLossPerTrade: Number(riskLimits.maxLossPerTrade || 500),
      maxLossPerTradeFormatted: formatINR(riskLimits.maxLossPerTrade || 500),
      maxDailyLoss: Number(riskLimits.maxDailyLoss || 1000),
      maxDailyLossFormatted: formatINR(riskLimits.maxDailyLoss || 1000),
      maxTradesPerDay: Number(riskLimits.maxTradesPerDay || 3),
      tradesToday,
      tradesTodayFormatted: `${tradesToday} / ${Number(riskLimits.maxTradesPerDay || 3)}`,
      maxOpenPositions: Number(riskLimits.maxOpenPositions || 1),
      openPositionsCount,
      openPositionsFormatted: `${openPositionsCount} / ${Number(riskLimits.maxOpenPositions || 1)}`,
      averaging: "BLOCKED",
      dailyLossLocked,
      maxTradesLocked
    };

    const emergencyStopStatus = {
      active: emergencyStop,
      stateText: emergencyStop ? "ACTIVE — ALL TRADING HALTED" : "INACTIVE — ARMED",
      badgeText: emergencyStop ? "EMERGENCY STOP ACTIVE" : "STANDBY (SAFE)",
      reason:
        input.serverEmergencyStop?.reason ||
        (emergencyStop ? "Activated by operator or safety trigger" : "Normal paper trading operation")
    };

    // 18. Market Data Timestamp & Freshness
    let freshnessBadge = "WAITING FOR FEED";
    let ageFormatted = "--";
    if (quoteAgeMs !== null && Number.isFinite(quoteAgeMs) && quoteAgeMs >= 0) {
      const sec = Math.round(quoteAgeMs / 1000);
      ageFormatted = `${sec}s ago`;
    }

    if (marketStatus.isStale) {
      freshnessBadge = `STALE (${ageFormatted})`;
    } else if (dataReady) {
      freshnessBadge = `FRESH (${ageFormatted})`;
    } else if (marketStatus.code === "INVALID_MARKET_DATA") {
      freshnessBadge = "INVALID TIMESTAMP / PRICE";
    }

    const marketDataFreshness = {
      timestamp: rawTimestamp || "--",
      ageMs: quoteAgeMs,
      ageFormatted,
      isFresh: dataReady && !marketStatus.isStale,
      isStale: marketStatus.isStale,
      badge: freshnessBadge
    };

    return {
      meta: {
        tradingMode: "PAPER",
        liveTradingEnabled: false,
        authenticated: Boolean(user && user.userId),
        userId: user?.userId || null,
        userName: user?.name || "Guest Workspace",
        userEmail: user?.email || null,
        sessionExpired,
        loading,
        apiError,
        isEmptyAccount
      },
      sections: {
        marketStatus,
        selectedInstrument,
        priceAndChange,
        aiMarketView: {
          signal: displaySignal,
          trend: trendLabel,
          risk: riskClass,
          summary: aiSummary,
          source: aiSourceLabel
        },
        signalBadge: {
          action: actionBadge,
          rawSignal: displaySignal
        },
        confidence: {
          validated: dataReady && confidenceValue !== null,
          value: dataReady ? confidenceValue : null,
          formatted:
            dataReady && confidenceValue !== null ? `${confidenceValue}%` : "--%"
        },
        tradeLevels,
        riskReward,
        technicalIndicators,
        openPositions: {
          hasOpenPosition: Boolean(openPositionModel),
          count: openPositionsCount,
          maxAllowed: Number(riskLimits.maxOpenPositions || 1),
          position: openPositionModel
        },
        availablePaperBalance: {
          capital,
          capitalFormatted: formatINR(capital),
          available: availableBalanceValue,
          availableFormatted: formatINR(availableBalanceValue),
          committedMargin,
          committedMarginFormatted: formatINR(committedMargin)
        },
        todaysRealizedPnl: {
          value: realizedDailyPnl,
          formatted: formatINR(realizedDailyPnl),
          tone:
            realizedDailyPnl > 0
              ? "positive"
              : realizedDailyPnl < 0
                ? "negative"
                : "neutral"
        },
        unrealizedPnl: {
          value: unrealizedPnlValue,
          formatted: formatINR(unrealizedPnlValue),
          tone:
            unrealizedPnlValue > 0
              ? "positive"
              : unrealizedPnlValue < 0
                ? "negative"
                : "neutral"
        },
        recentOrders,
        recentTrades,
        riskLimitStatus,
        emergencyStopStatus,
        marketDataFreshness
      },
      navigationTargets: NAVIGATION_TARGETS
    };
  }

  return {
    REQUIRED_SECTIONS,
    NAVIGATION_TARGETS,
    formatINR,
    formatPrice,
    formatNumber,
    formatPercent,
    normalizeMarketStatus,
    buildDashboardViewModel
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = DashboardEngine;
}
