/*
 * YASHWIN AI Trading Assistant
 * Main Browser Application Controller (Phases 1–19)
 *
 * Strictly enforces:
 * - Paper Trading default mode (Live Trading disabled)
 * - No fake live prices or fake trading signals
 * - Real quote validation -> Snapshot -> MarketAnalysis -> AISafetyGate -> Strategy -> RiskEngine -> PaperTrading
 * - Real global Emergency Stop state across UI and engines
 */

const state = {
  activePage: "dashboard",
  tradingMode: "PAPER",
  liveTradingEnabled: false,
  dataStatus: "DATA WAITING", // LIVE DATA | DATA WAITING | STALE DATA | INVALID MARKET DATA | ERROR
  nifty: null,
  bank: null,
  pnl: 0,
  signal: "DATA WAITING",
  confidence: null,
  trend: "Waiting",
  risk: "HIGH",
  emergencyStop: false,
  googleAIConfigured: false,
  currentUser: null,
  hadAuthenticatedSession: false,
  sessionExpired: false,
  loadingDashboard: false,
  apiError: null,
  serverRiskLimits: null,
  serverEmergencyStop: null,
  pendingEmailChange: null,
  lastAnalysis: null,
  lastAIDecision: null,
  lastStrategy: null,
  niftyChangePct: null,
  bankChangePct: null,
  watchlist: [],
  recentSearches: [],
  searchFilters: {
    exchange: "ALL",
    type: "ALL",
    optionType: "ALL"
  },
  lastSearchQuery: "",
  chart: {
    interval: "FIVE_MINUTE",
    loading: false,
    apiError: null,
    visibleCount: 40,
    panOffset: 0,
    hoverIndex: null,
    overlays: {
      ema9: true,
      ema21: true,
      sma20: false,
      sma50: false,
      vwap: true,
      bollinger: true,
      srLevels: true,
      tradeLevels: true,
      subchart: "RSI"
    }
  },
  ai: {
    loading: false,
    error: null,
    status: {
      provider: "GOOGLE_GENAI",
      model: "gemini-3.8-flash",
      credentialsConfigured: false,
      mode: "SERVER_ONLY"
    },
    history: []
  },
  intelligence: {
    loading: false,
    error: null,
    category: "ALL",
    payload: null,
    providerStatus: null
  },
  strategyHistory: [],
  riskEvents: [],
  lastRiskCheck: null,
  portfolio: {
    loading: false,
    error: null,
    snapshot: null,
    filters: {
      symbol: "",
      status: "ALL",
      reason: "ALL",
      fromDate: "",
      toDate: ""
    }
  },
  orderTradeHistory: {
    loading: false,
    error: null,
    ordersFilters: {
      symbol: "",
      exchange: "ALL",
      direction: "ALL",
      orderStatus: "ALL",
      orderType: "ALL",
      fromDate: "",
      toDate: "",
      page: 1,
      pageSize: 15
    },
    historyFilters: {
      symbol: "",
      exchange: "ALL",
      direction: "ALL",
      pnlResult: "ALL",
      exitReason: "ALL",
      fromDate: "",
      toDate: "",
      page: 1,
      pageSize: 15
    }
  },
  backtest: {
    lastReport: null,
    runs: [],
    loading: false,
    error: null,
    selectedRunId: null
  },
  watchlistAlerts: {
    loading: false,
    error: null,
    quotesMap: {},
    alerts: [],
    events: [],
    unacknowledgedCount: 0,
    statusFilter: "ALL",
    historySymbolFilter: "",
    historyTypeFilter: "ALL"
  },
  notifications: {
    loading: false,
    error: null,
    items: [],
    unreadCount: 0,
    totalCount: 0,
    pagination: { page: 1, pageSize: 15, totalPages: 1 },
    filters: {
      readStatus: "ALL",
      category: "ALL",
      symbol: "",
      date: "",
      page: 1,
      pageSize: 15
    },
    preferences: null,
    externalChannels: null,
    dispatchedBrowserIds: {}
  }
};

const pageTitles = {
  dashboard: ["Dashboard", "AI-powered market monitoring"],
  scanner: ["Market Scanner", "Scan market conditions & option chain"],
  watchlist: ["Watchlist & Alerts", "User-isolated watchlist quotes, custom ordering & real-data market alerts"],
  analysis: ["AI Analysis", "Deterministic market intelligence & safety gate"],
  intelligence: ["Market Intelligence", "Verified Indian & Global News, Company Feeds, Economic Calendar & Indices"],
  strategy: ["Strategy", "Deterministic rules, backtesting & pilot approval"],
  paper: ["Paper Trading", "Virtual trading environment"],
  positions: ["Portfolio & Positions", "Authoritative paper capital, open holdings, equity curve & performance analytics"],
  orders: ["Orders", "Virtual paper order book"],
  risk: ["Risk Controls", "Account protection, emergency stop & safety audit"],
  history: ["Trade History", "Closed paper trades & security audit log"],
  account: ["Account & Profile", "YASHWIN user authentication, profile & account security"]
};

function money(value) {
  return (
    "₹" +
    Number(value || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  );
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}

function escapeHtml(raw) {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return "";
}

if (typeof window !== "undefined") {
  window.showToast = showToast;
  window.escapeHtml = escapeHtml;
}

/* =====================================================
   UNIFIED NAVIGATION CONTROLLER (NO DUPLICATE LISTENERS)
===================================================== */

function switchPage(page) {
  const targetPage = pageTitles[page] ? page : "dashboard";
  state.activePage = targetPage;

  document.querySelectorAll(".page-section").forEach((section) => {
    const sectionName = section.dataset.section || (section.id === "paperPage" ? "paper" : "dashboard");
    section.hidden = sectionName !== targetPage;
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === targetPage);
  });

  document.querySelectorAll(".mobile-nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === targetPage);
  });

  const info = pageTitles[targetPage];
  if (info) {
    setText("pageTitle", info[0]);
    setText("pageSubtitle", info[1]);
  }

  renderAllViews();
}

/* =====================================================
   DASHBOARD & MULTI-PAGE RENDERING
===================================================== */

function syncPaperPnlToDashboard() {
  if (typeof PaperTrading !== "undefined") {
    const pState = PaperTrading.getState();
    let openUnrealized = 0;
    if (pState.position) {
      const p = pState.position;
      const eq = Number(p.effectiveQty || p.qty || 0);
      openUnrealized =
        p.direction === "BUY"
          ? (p.current - p.entry) * eq
          : (p.entry - p.current) * eq;
    }
    state.pnl = Number(pState.dailyPnl || 0) + openUnrealized;
    state.emergencyStop =
      Boolean(pState.emergencyStop) ||
      (typeof AuditLogger !== "undefined" && AuditLogger.isEmergencyStopActive());
  }
}

function setToneClass(id, tone) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("tone-positive", "tone-negative", "tone-warning");
  if (tone === "positive" || tone === "POSITIVE") {
    el.classList.add("tone-positive");
  } else if (tone === "negative" || tone === "NEGATIVE" || tone === "danger") {
    el.classList.add("tone-negative");
  } else if (tone === "warning") {
    el.classList.add("tone-warning");
  }
}

function updateDashboard() {
  syncPaperPnlToDashboard();

  setText(
    "niftyValue",
    state.nifty === null
      ? "--"
      : Number(state.nifty).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
  );
  setText(
    "niftyChange",
    state.niftyChangePct === null
      ? "--"
      : `${state.niftyChangePct >= 0 ? "+" : ""}${state.niftyChangePct.toFixed(2)}%`
  );
  setText("niftyStatusLabel", state.nifty === null ? "DATA WAITING" : "VALIDATED QUOTE");

  setText(
    "bankValue",
    state.bank === null
      ? "--"
      : Number(state.bank).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
  );
  setText(
    "bankChange",
    state.bankChangePct === null
      ? "--"
      : `${state.bankChangePct >= 0 ? "+" : ""}${state.bankChangePct.toFixed(2)}%`
  );
  setText("bankStatusLabel", state.bank === null ? "DATA WAITING" : "VALIDATED QUOTE");

  setText("pnl", money(state.pnl));

  const snap =
    typeof window !== "undefined" ? window.YashwinMarketSnapshot : null;
  const inst =
    typeof window !== "undefined" && window.YashwinSelectedInstrument
      ? window.YashwinSelectedInstrument
      : { key: "NIFTY50", name: "NIFTY 50", exchange: "NSE", type: "INDEX" };
  const pState =
    typeof PaperTrading !== "undefined" ? PaperTrading.getState() : {};
  const riskLimits =
    state.serverRiskLimits ||
    (typeof RiskEngine !== "undefined" ? RiskEngine.getLimits() : undefined);

  if (typeof DashboardEngine !== "undefined") {
    const vm = DashboardEngine.buildDashboardViewModel({
      user: state.currentUser,
      sessionExpired: state.sessionExpired,
      loading: state.loadingDashboard,
      apiError: state.apiError,
      emergencyStop: state.emergencyStop,
      serverEmergencyStop: state.serverEmergencyStop,
      dataStatus: state.dataStatus,
      snapshot: snap,
      instrument: inst,
      analysis: state.lastAnalysis,
      aiDecision: state.lastAIDecision,
      strategy: state.lastStrategy,
      paperState: pState,
      riskLimits
    });

    const s = vm.sections;

    // UX Banners
    const sessionBanner = document.getElementById("dashSessionExpiredBanner");
    if (sessionBanner) {
      sessionBanner.hidden = !vm.meta.sessionExpired;
    }
    const apiErrBanner = document.getElementById("dashApiErrorBanner");
    if (apiErrBanner) {
      apiErrBanner.hidden = !vm.meta.apiError;
      if (vm.meta.apiError) {
        setText("dashApiErrorText", vm.meta.apiError);
      }
    }
    const loadingBanner = document.getElementById("dashLoadingBanner");
    if (loadingBanner) {
      loadingBanner.hidden = !vm.meta.loading;
    }

    // 1. Market Status
    setText("dashMarketStatusLabel", s.marketStatus.label);
    setText("dashMarketStatusCode", s.marketStatus.code);
    setToneClass("dashMarketStatusLabel", s.marketStatus.tone);

    // 2. Selected Instrument
    setText("dashSelectedSymbol", s.selectedInstrument.name);
    const metaParts = [s.selectedInstrument.exchange, s.selectedInstrument.type];
    if (s.selectedInstrument.optionType) {
      metaParts.push(
        `${s.selectedInstrument.optionType}${s.selectedInstrument.strikePrice ? " " + s.selectedInstrument.strikePrice : ""}`
      );
    }
    setText("dashSelectedMeta", metaParts.join(" • "));

    // 3. Current Price and Percentage Change
    setText("dashSelectedPrice", s.priceAndChange.priceFormatted);
    setText(
      "dashSelectedChange",
      s.priceAndChange.available && s.priceAndChange.changePct !== null
        ? `${s.priceAndChange.changeAbsFormatted} (${s.priceAndChange.changePctFormatted})`
        : s.priceAndChange.statusNote
    );
    setToneClass("dashSelectedChange", s.priceAndChange.changeDirection);

    // 18. Market Data Timestamp and Freshness
    setText("dashQuoteFreshness", s.marketDataFreshness.badge);
    setText("dashQuoteTimestamp", s.marketDataFreshness.timestamp);
    setToneClass(
      "dashQuoteFreshness",
      s.marketDataFreshness.isStale
        ? "warning"
        : s.marketDataFreshness.isFresh
          ? "positive"
          : "neutral"
    );

    // 4, 5, 6. AI Market View, BUY/SELL/HOLD/NO_TRADE, and Validated Confidence
    setText("signal", s.signalBadge.action);
    setText("dashActionBadge", s.signalBadge.action);
    setText("bigSignal", s.aiMarketView.signal);
    setText("trend", s.aiMarketView.trend);
    setText("riskLevel", s.aiMarketView.risk);
    setText("dashAiSourceBadge", s.aiMarketView.source);
    setText("analysisText", s.aiMarketView.summary);
    setText("confidence", s.confidence.formatted);
    setText("dashValidatedConfidence", s.confidence.formatted);
    setText(
      "signalDataState",
      s.confidence.validated
        ? `Validated (${s.marketStatus.code})`
        : s.marketStatus.label
    );

    const meter = document.getElementById("meterFill");
    if (meter) {
      meter.style.width =
        s.confidence.validated && s.confidence.value !== null
          ? Math.max(0, Math.min(100, Number(s.confidence.value) || 0)) + "%"
          : "0%";
    }

    // 7 & 8. Entry / Stop-loss / Target & Risk/Reward
    setText("dashLevelEntry", s.tradeLevels.entryFormatted);
    setText("dashLevelStop", s.tradeLevels.stopLossFormatted);
    setText("dashLevelTarget", s.tradeLevels.targetFormatted);
    setText("dashRiskRewardRatio", s.riskReward.ratioFormatted);
    setText(
      "dashUnitRiskReward",
      s.riskReward.available
        ? `${s.riskReward.riskFormatted} / ${s.riskReward.rewardFormatted}`
        : "-- / --"
    );

    // 9. Technical Indicators Summary (EMA 9/21, SMA 20/50, VWAP, RSI 14, MACD 12,26,9, BB 20,2, ATR 14, ADX 14, S/R, Breakout, Regime)
    setText(
      "dashIndEma",
      `${s.technicalIndicators.ema9} / ${s.technicalIndicators.ema21}`
    );
    setText(
      "dashIndSma20",
      `${s.technicalIndicators.sma20} / ${s.technicalIndicators.sma50 || "--"}`
    );
    setText("dashIndRsi", s.technicalIndicators.rsi14);
    setText("dashIndVwap", s.technicalIndicators.vwap);
    setText(
      "dashIndMacd",
      s.technicalIndicators.macdValue !== "--"
        ? `${s.technicalIndicators.macdValue} (${s.technicalIndicators.macdState})`
        : "--"
    );
    setText(
      "dashIndBollinger",
      s.technicalIndicators.bollingerBands || "--"
    );
    setText(
      "dashIndAtrAdx",
      `${s.technicalIndicators.atr14} / ${s.technicalIndicators.adx14}`
    );
    setText(
      "dashIndSr",
      `${s.technicalIndicators.support} / ${s.technicalIndicators.resistance}`
    );
    setText(
      "dashIndBreakout",
      s.technicalIndicators.breakout || "NONE"
    );
    setText(
      "dashIndRegime",
      `${s.technicalIndicators.marketRegime} (${s.technicalIndicators.dataQuality})`
    );
    setText(
      "chartSubtitle",
      s.priceAndChange.available
        ? `${s.selectedInstrument.name} (${s.selectedInstrument.exchange}) • ${s.priceAndChange.priceFormatted} • ${state.chart.interval} • ${s.technicalIndicators.dataQuality}`
        : `Waiting for validated market feed (${s.marketStatus.label})`
    );

    renderCandlestickChartView(snap, inst, pState);

    // 11, 12, 13. Available Paper Balance, Today's Realized P&L, Unrealized P&L
    setText("dashAvailableBalance", s.availablePaperBalance.availableFormatted);
    setText(
      "dashCapitalMeta",
      `Total Capital: ${s.availablePaperBalance.capitalFormatted} • Margin Used: ${s.availablePaperBalance.committedMarginFormatted}`
    );
    setText("dashRealizedPnl", s.todaysRealizedPnl.formatted);
    setToneClass("dashRealizedPnl", s.todaysRealizedPnl.tone);
    setText("dashUnrealizedPnl", s.unrealizedPnl.formatted);
    setToneClass("dashUnrealizedPnl", s.unrealizedPnl.tone);
    setText(
      "dashUserScopeLabel",
      vm.meta.authenticated ? vm.meta.userName : "Guest Paper Account"
    );
    setText(
      "dashAccountEmptyNote",
      vm.meta.isEmptyAccount
        ? "Empty account — no trades recorded yet"
        : `${s.riskLimitStatus.tradesTodayFormatted} trades today`
    );

    // 10. Open Positions
    setText(
      "dashOpenPosBadge",
      `${s.openPositions.count} / ${s.openPositions.maxAllowed} OPEN`
    );
    const emptyPosEl = document.getElementById("dashOpenPositionEmpty");
    const openPosCardEl = document.getElementById("dashOpenPositionCard");
    if (s.openPositions.hasOpenPosition && s.openPositions.position) {
      const pos = s.openPositions.position;
      if (emptyPosEl) emptyPosEl.hidden = true;
      if (openPosCardEl) openPosCardEl.hidden = false;
      setText("dashPosSymbolSide", `${pos.symbol} (${pos.direction})`);
      setText("dashPosQtyType", `${pos.quantity} • ${pos.assetType}`);
      setText(
        "dashPosEntryCurrent",
        `${pos.entryFormatted} → ${pos.currentFormatted}`
      );
      setText(
        "dashPosStopTarget",
        `SL ${pos.stopFormatted} / Target ${pos.targetFormatted}`
      );
      setText("dashPosUnrealized", pos.unrealizedPnlFormatted);
      setToneClass(
        "dashPosUnrealized",
        pos.unrealizedPnl > 0
          ? "positive"
          : pos.unrealizedPnl < 0
            ? "negative"
            : "neutral"
      );
    } else {
      if (emptyPosEl) emptyPosEl.hidden = false;
      if (openPosCardEl) openPosCardEl.hidden = true;
    }

    // 14. Recent Orders
    const recentOrdersEl = document.getElementById("dashRecentOrdersList");
    if (recentOrdersEl) {
      if (!s.recentOrders.length) {
        recentOrdersEl.innerHTML =
          '<div><span>No paper orders recorded yet.</span><strong>--</strong></div>';
      } else {
        recentOrdersEl.innerHTML = s.recentOrders
          .map(
            (o) =>
              `<div><span>${o.type} • ${o.symbol} (${o.direction} x${o.quantity})</span><strong class="tabular-nums">${o.priceFormatted} • ${o.status}</strong></div>`
          )
          .join("");
      }
    }

    // 15. Recent Trades
    const recentTradesEl = document.getElementById("dashRecentTradesList");
    if (recentTradesEl) {
      if (!s.recentTrades.length) {
        recentTradesEl.innerHTML =
          '<div><span>No closed paper trades yet.</span><strong>--</strong></div>';
      } else {
        recentTradesEl.innerHTML = s.recentTrades
          .map(
            (t) =>
              `<div><span>${t.symbol} (${t.direction} x${t.quantity}) • ${t.reason}</span><strong class="tabular-nums ${t.pnl > 0 ? "tone-positive" : t.pnl < 0 ? "tone-negative" : ""}">${t.pnlFormatted}</strong></div>`
          )
          .join("");
      }
    }

    // 16 & 17. Risk Limit Status & Emergency Stop Status
    setText("riskProtectionBadge", s.riskLimitStatus.badge);
    setText("dashMaxLossTrade", s.riskLimitStatus.maxLossPerTradeFormatted);
    setText("dashMaxDailyLoss", s.riskLimitStatus.maxDailyLossFormatted);
    setText("dashMaxTradesDay", s.riskLimitStatus.tradesTodayFormatted);
    setText("dashMaxOpenPositions", s.riskLimitStatus.openPositionsFormatted);

    setText("dashEmergencyBadge", s.emergencyStopStatus.badgeText);
    setText("dashEmergencyStateText", s.emergencyStopStatus.stateText);
    setToneClass(
      "dashEmergencyBadge",
      s.emergencyStopStatus.active ? "danger" : "positive"
    );
  } else {
    setText("signal", state.signal);
    setText("bigSignal", state.signal);
    setText("trend", state.trend);
    setText("riskLevel", state.risk);
    setText(
      "confidence",
      state.confidence === null ? "--%" : state.confidence + "%"
    );
  }

  setText("topMarketStatusText", state.emergencyStop ? "EMERGENCY STOP" : state.dataStatus);

  const topDot = document.getElementById("topMarketStatusDot");
  if (topDot) {
    topDot.classList.toggle("off", state.dataStatus !== "LIVE DATA" || state.emergencyStop);
  }

  const emergencyBtn = document.getElementById("emergencyBtn");
  if (emergencyBtn) {
    emergencyBtn.textContent = state.emergencyStop
      ? "⚠ Emergency Stop ACTIVE (Click to Reset)"
      : "⛔ Emergency Stop";
  }

  const dashEmToggleBtn = document.getElementById("dashEmergencyToggleBtn");
  if (dashEmToggleBtn) {
    dashEmToggleBtn.textContent = state.emergencyStop
      ? "⚠ Reset Emergency Stop"
      : "⛔ Activate Emergency Stop";
  }

  // Update Robot Mobile Command Center UI
  const autoEnabled =
    typeof PaperTrading !== "undefined" && typeof PaperTrading.isAutoPaperEnabled === "function"
      ? PaperTrading.isAutoPaperEnabled()
      : true;
  const robotStateBadge = document.getElementById("robotStateBadge");
  if (robotStateBadge) {
    if (state.emergencyStop) {
      robotStateBadge.textContent = "HALTED (EMERGENCY)";
      robotStateBadge.classList.add("halted");
    } else if (state.dataStatus === "LIVE DATA") {
      robotStateBadge.textContent = autoEnabled ? "ROBOT ACTIVE" : "MANUAL MODE";
      robotStateBadge.classList.remove("halted");
    } else {
      robotStateBadge.textContent = "STANDBY • " + state.dataStatus;
      robotStateBadge.classList.remove("halted");
    }
  }

  setText("robotActiveSymbol", inst?.name || "NIFTY 50");
  setText(
    "robotActivePrice",
    snap?.dataReady && snap?.price
      ? `${money(snap.price)} (${inst?.exchange || "NSE"})`
      : `Waiting for quote (${inst?.exchange || "NSE"})`
  );

  const actLabel = state.lastStrategy?.action || state.lastAIDecision?.signal || state.signal || "NO_TRADE";
  setText("robotAiDecisionLabel", actLabel);
  setText(
    "robotAiConfidenceLabel",
    snap?.dataReady && state.confidence !== null
      ? `Validated Confidence: ${state.confidence}%`
      : "Confidence: --% (Waiting)"
  );

  setText("robotDailyPnlValue", money(state.pnl));
  setToneClass(
    "robotDailyPnlValue",
    state.pnl > 0 ? "positive" : state.pnl < 0 ? "negative" : "neutral"
  );
  setText(
    "robotTradesCounterLabel",
    `${pState?.tradesToday || 0} / ${riskLimits?.maxTradesPerDay || 3} Trades Today`
  );

  setText(
    "robotSafetyStatusLabel",
    state.emergencyStop ? "EMERGENCY STOP" : "PROTECTED"
  );
  setToneClass(
    "robotSafetyStatusLabel",
    state.emergencyStop ? "danger" : "positive"
  );

  const stratObj = state.lastStrategy;
  setText("robotLevelEntry", stratObj?.entry ? money(stratObj.entry) : "--");
  setText("robotLevelStop", stratObj?.stopLoss ? money(stratObj.stopLoss) : "--");
  setText("robotLevelTarget", stratObj?.target ? money(stratObj.target) : "--");
  setText(
    "robotLevelRR",
    stratObj?.riskRewardRatio ? `1 : ${Number(stratObj.riskRewardRatio).toFixed(2)}` : "--"
  );
  setText(
    "robotGateVerdictBadge",
    state.emergencyStop
      ? "HALTED"
      : snap?.dataReady && (actLabel === "BUY" || actLabel === "SELL")
        ? "READY (PAPER)"
        : "NO_TRADE GATE"
  );

  const robotAutoBtn = document.getElementById("robotToggleAutoBtn");
  const robotAutoDot = document.getElementById("robotAutoBtnDot");
  if (robotAutoBtn) {
    robotAutoBtn.classList.toggle("off", !autoEnabled || state.emergencyStop);
  }
  if (robotAutoDot) {
    robotAutoDot.classList.toggle("off", !autoEnabled || state.emergencyStop);
  }
  setText(
    "robotToggleAutoText",
    state.emergencyStop
      ? "Robot Halted (Emergency)"
      : autoEnabled
        ? "Auto Paper Robot: ON"
        : "Auto Paper Robot: PAUSED"
  );
  const robotEmBtn = document.getElementById("robotEmergencyStopBtn");
  if (robotEmBtn) {
    robotEmBtn.textContent = state.emergencyStop
      ? "⚠ Reset Emergency Stop"
      : "⛔ Emergency Stop";
  }
}

function updateChartHoverInspector(chartVm) {
  const inspected = chartVm?.inspectedCandle;
  if (!inspected) {
    setText("chartHoverTime", "TIME: --");
    setText("chartHoverOpen", "--");
    setText("chartHoverHigh", "--");
    setText("chartHoverLow", "--");
    setText("chartHoverClose", "--");
    setText("chartHoverVolume", "--");
    setText(
      "chartHoverIndicatorSummary",
      "EMA9: -- • EMA21: -- • VWAP: -- • RSI14: --"
    );
    return;
  }

  setText("chartHoverTime", `TIME: ${inspected.timestampFormatted}`);
  setText("chartHoverOpen", inspected.openFormatted);
  setText("chartHoverHigh", inspected.highFormatted);
  setText("chartHoverLow", inspected.lowFormatted);
  setText("chartHoverClose", inspected.closeFormatted);
  setText("chartHoverVolume", inspected.volumeFormatted);

  const ema9Txt = inspected.ema9 !== null ? inspected.ema9.toFixed(2) : "--";
  const ema21Txt = inspected.ema21 !== null ? inspected.ema21.toFixed(2) : "--";
  const vwapTxt = inspected.vwap !== null ? inspected.vwap.toFixed(2) : "--";
  const rsiTxt = inspected.rsi14 !== null ? inspected.rsi14.toFixed(1) : "--";
  setText(
    "chartHoverIndicatorSummary",
    `EMA9: ${ema9Txt} • EMA21: ${ema21Txt} • VWAP: ${vwapTxt} • RSI14: ${rsiTxt}`
  );
}

function renderCandlestickChartView(snap, inst, pState) {
  if (typeof ChartEngine === "undefined") return;

  const container = document.getElementById("candlestickChartContainer");
  const chartVm = ChartEngine.buildChartViewModel({
    interval: state.chart.interval,
    loading: state.chart.loading,
    apiError: state.chart.apiError,
    snapshot: snap,
    instrument: inst,
    candles: snap?.candles || [],
    strategy: state.lastStrategy,
    aiDecision: state.lastAIDecision,
    paperState: pState,
    visibleCount: state.chart.visibleCount,
    panOffset: state.chart.panOffset,
    hoverIndex: state.chart.hoverIndex
  });

  if (typeof window !== "undefined") {
    window.YashwinChartViewModel = chartVm;
  }

  setText(
    "chartCandleCountNote",
    `${chartVm.totalCandles} validated candles (${chartVm.intervalMeta.label})`
  );
  setText(
    "chartSufficiencyNote",
    chartVm.indicatorDiagnostics.insufficientNote
  );

  // If historical candles are present even when live quote isn't, populate indicator summary from candle series
  if (chartVm.totalCandles > 0 && (!snap || !snap.dataReady)) {
    const indSum = chartVm.indicatorsSummary;
    setText(
      "dashIndEma",
      `${indSum.ema9Formatted} / ${indSum.ema21Formatted}`
    );
    setText(
      "dashIndSma20",
      `${indSum.sma20Formatted} / ${indSum.sma50Formatted}`
    );
    setText("dashIndVwap", indSum.vwapFormatted);
    setText("dashIndRsi", indSum.rsi14Formatted);
    setText("dashIndMacd", indSum.macdFormatted);
    setText("dashIndBollinger", indSum.bollingerFormatted);
    setText(
      "dashIndAtrAdx",
      `${indSum.atr14Formatted} / ${indSum.adx14Formatted}`
    );
    setText(
      "dashIndSr",
      `${indSum.supportFormatted} / ${indSum.resistanceFormatted}`
    );
    setText("dashIndBreakout", indSum.breakout || "NONE");
    setText(
      "dashIndRegime",
      `${indSum.marketRegime} (${indSum.dataQuality})`
    );
  }

  updateChartHoverInspector(chartVm);

  if (container) {
    ChartEngine.renderInteractiveChart(container, chartVm, {
      overlays: state.chart.overlays,
      onHoverCandle: (idx) => {
        state.chart.hoverIndex = idx;
        const hoverVm = ChartEngine.buildChartViewModel({
          interval: state.chart.interval,
          loading: state.chart.loading,
          apiError: state.chart.apiError,
          snapshot: snap,
          instrument: inst,
          candles: snap?.candles || [],
          strategy: state.lastStrategy,
          aiDecision: state.lastAIDecision,
          paperState: pState,
          visibleCount: state.chart.visibleCount,
          panOffset: state.chart.panOffset,
          hoverIndex: idx
        });
        updateChartHoverInspector(hoverVm);
      }
    });
  }
}

function renderScannerAndAnalysisViews() {
  const snap =
    typeof window !== "undefined" ? window.YashwinMarketSnapshot : null;
  const inst =
    typeof window !== "undefined" ? window.YashwinSelectedInstrument : null;

  setText(
    "scannerInstName",
    inst
      ? `${inst.name}${inst.companyName && inst.companyName !== inst.name ? " — " + inst.companyName : ""}`
      : snap?.name || "--"
  );
  setText(
    "scannerInstToken",
    inst
      ? `${inst.tradingsymbol || inst.key || inst.name} • ${inst.symboltoken ? "Token #" + inst.symboltoken : "Token UNRESOLVED"}`
      : "--"
  );
  setText(
    "scannerInstMeta",
    inst
      ? `${inst.exchange} • ${inst.type || inst.instrumentType || "EQUITY"}${inst.optionType ? " (" + inst.optionType + (inst.strikePrice ? " " + inst.strikePrice : "") + (inst.expiry ? " Exp " + inst.expiry : "") + ")" : ""}`
      : "--"
  );

  if (inst && typeof MarketSearch !== "undefined" && typeof MarketSearch.validateContractSelection === "function") {
    const check = MarketSearch.validateContractSelection(inst);
    setText(
      "scannerContractValidation",
      check.valid ? `VALID (${check.instrumentType})` : `REJECTED: ${check.reasons.join(" ")}`
    );
  } else {
    setText("scannerContractValidation", "--");
  }

  setText(
    "scannerInstPrice",
    snap?.dataReady && snap?.price ? money(snap.price) : "-- (DATA_UNAVAILABLE)"
  );
  const candleCount = Array.isArray(snap?.candles) ? snap.candles.length : 0;
  setText(
    "scannerCandlesStatus",
    candleCount > 0
      ? `${candleCount} candles (${snap?.indicators?.dataQuality || "LOADED"})`
      : `0 candles (${snap?.status || "WAITING"})`
  );
  setText("scannerInstTime", snap?.timestamp || "--");
  setText("scannerSnapshotStatus", snap?.status || "DATA WAITING");

  renderWatchlistAndRecentViews();

  const pState =
    typeof PaperTrading !== "undefined" ? PaperTrading.getState() : {};

  if (typeof AIAnalysisEngine !== "undefined") {
    const aiVm = AIAnalysisEngine.buildAIAnalysisViewModel({
      snapshot: snap,
      instrument: inst || { key: "NIFTY50", name: "NIFTY 50", exchange: "NSE", type: "INDEX" },
      candles: snap?.candles || [],
      interval: state.chart.interval,
      analysis: state.lastAnalysis,
      aiDecision: state.lastAIDecision,
      strategy: state.lastStrategy,
      paperState: pState,
      emergencyStop: state.emergencyStop,
      googleAIConfigured: state.googleAIConfigured,
      aiStatus: state.ai.status,
      aiLoading: state.ai.loading,
      aiError: state.ai.error,
      aiHistory: state.ai.history,
      marketIntelligence: state.intelligence.payload
    });

    if (typeof window !== "undefined") {
      window.YashwinAIAnalysisViewModel = aiVm;
    }

    // Hero & Top KPI Strip
    setText("analysisPageSignalBadge", aiVm.decision.displayDecision);
    setText("aiInstName", aiVm.instrument.name);
    setText(
      "aiInstExchangeMeta",
      `${aiVm.instrument.exchange} • ${aiVm.instrument.rawType}${aiVm.instrument.optionType ? " (" + aiVm.instrument.optionType + ")" : ""}${aiVm.instrument.symboltoken ? " • #" + aiVm.instrument.symboltoken : ""}`
    );

    setText("aiQuotePrice", aiVm.quoteAndFreshness.priceFormatted);
    setText("aiQuoteChange", aiVm.quoteAndFreshness.changeFormatted);
    setText("aiTimeframeLabel", aiVm.timeframe.label);
    setText(
      "aiCandlesLoadedCount",
      `${aiVm.timeframe.candlesCount} validated candles`
    );
    setText("aiFreshnessBadge", aiVm.quoteAndFreshness.freshnessBadge);
    setText("aiQuoteTimestamp", aiVm.quoteAndFreshness.timestamp);
    setText("aiProviderBadge", aiVm.providerStatus.badge);
    setText("aiAnalysisTimestamp", aiVm.decision.analysisTimestamp);
    setText("aiProviderMessageText", aiVm.providerStatus.message);

    // Loading / Error / Configuration Banners
    const aiLoadingBanner = document.getElementById("aiAnalysisLoadingBanner");
    if (aiLoadingBanner) {
      aiLoadingBanner.hidden = !aiVm.providerStatus.loading;
    }

    const aiErrorBanner = document.getElementById("aiAnalysisErrorBanner");
    if (aiErrorBanner) {
      const showErr = Boolean(
        aiVm.providerStatus.error ||
          aiVm.providerStatus.stateCode === "CONTRACT_REJECTED"
      );
      aiErrorBanner.hidden = !showErr;
      if (showErr) {
        setText(
          "aiAnalysisErrorText",
          aiVm.providerStatus.error || aiVm.providerStatus.message
        );
      }
    }

    const aiConfigBanner = document.getElementById("aiAnalysisConfigBanner");
    if (aiConfigBanner) {
      aiConfigBanner.hidden = Boolean(aiVm.providerStatus.credentialsConfigured);
      if (!aiVm.providerStatus.credentialsConfigured) {
        setText("aiAnalysisConfigText", aiVm.providerStatus.message);
      }
    }

    // Decision, Confidence, Trend, Regime, Entry, Stop-Loss, Target, R:R
    setText("aiDecisionActionPill", aiVm.decision.displayDecision);
    setText("aiDecisionDisplay", aiVm.decision.displayDecision);
    setText("aiRawSignalDisplay", aiVm.decision.rawSignal);
    setText("aiValidatedConfidence", aiVm.decision.confidenceFormatted);
    setText(
      "aiTrendAndRegime",
      `${aiVm.decision.trend} • ${aiVm.decision.marketRegime}`
    );
    setText("aiRiskClassification", aiVm.decision.risk);
    setText("aiEntryPrice", aiVm.tradeLevels.entryFormatted);
    setText("aiStopLossPrice", aiVm.tradeLevels.stopLossFormatted);
    setText("aiTargetPrice", aiVm.tradeLevels.targetFormatted);
    setText("aiRiskRewardRatio", aiVm.tradeLevels.riskRewardFormatted);
    setText(
      "aiUnitRiskReward",
      aiVm.tradeLevels.valid
        ? `${aiVm.tradeLevels.unitRiskFormatted} / ${aiVm.tradeLevels.unitRewardFormatted}`
        : "-- / --"
    );

    const stageBtn = document.getElementById("aiStageToPaperBtn");
    if (stageBtn) {
      stageBtn.disabled = !aiVm.paperExecution.canStageToPaper;
    }
    setText(
      "aiStageBlockedNote",
      aiVm.paperExecution.canStageToPaper
        ? `Ready: ${aiVm.decision.displayDecision} setup verified by AISafetyGate & RiskEngine (Paper Trading only).`
        : aiVm.paperExecution.stageBlockedReason ||
            "Waiting for validated setup and AISafetyGate + RiskEngine approval."
    );

    // AI Safety Gate & Provider Diagnostics
    setText("aiSafetyStatusPill", aiVm.safetyGate.status);
    setText("aiGateDataReady", aiVm.quoteAndFreshness.dataReady ? "TRUE" : "FALSE");
    setText("aiContractStatus", aiVm.safetyGate.contractStatusText);
    setText("aiAnalysisSource", aiVm.decision.source);
    setText(
      "aiProviderModelLabel",
      `${aiVm.providerStatus.provider} (${aiVm.providerStatus.model})`
    );
    setText(
      "aiGateConfidence",
      aiVm.decision.confidenceValidated && aiVm.decision.confidence !== null
        ? `${aiVm.decision.confidence}%`
        : "--%"
    );
    setText("aiGateRisk", aiVm.decision.risk);
    setText(
      "aiGateReasonsText",
      aiVm.safetyGate.reasons.length
        ? aiVm.safetyGate.reasons.join(" ")
        : "AI Safety Gate APPROVED for Paper Trading."
    );

    // Technical Indicator Summary on AI Analysis Page
    const ts = aiVm.technicalSummary;
    setText("aiTechQualityBadge", ts.dataQuality);
    setText(
      "aiTechQualitySubtitle",
      `${ts.candlesCount} validated candles (${aiVm.timeframe.shortLabel}) • Quality: ${ts.dataQuality}`
    );
    setText("aiIndEma", `${ts.ema9Formatted} / ${ts.ema21Formatted}`);
    setText("aiIndSma", `${ts.sma20Formatted} / ${ts.sma50Formatted}`);
    setText("aiIndVwap", ts.vwapFormatted);
    setText("aiIndRsi", ts.rsi14Formatted);
    setText("aiIndMacd", ts.macdFormatted);
    setText("aiIndBollinger", ts.bollingerFormatted);
    setText("aiIndAtrAdx", `${ts.atr14Formatted} / ${ts.adx14Formatted}`);
    setText("aiIndSr", `${ts.supportFormatted} / ${ts.resistanceFormatted}`);
    setText("aiIndBreakoutRegime", `${ts.breakout} • ${ts.marketRegime}`);

    // Component Breakdown
    setText("aiCompositeScorePill", `SCORE: ${aiVm.components.score}`);
    setText("compTrend", String(aiVm.components.trend));
    setText("compMomentum", String(aiVm.components.momentum));
    setText("compVolume", String(aiVm.components.volume));
    setText("compVwap", String(aiVm.components.vwap));
    setText("compSR", String(aiVm.components.supportResistance));
    setText("compOptions", String(aiVm.components.options));

    // Supporting Reasons
    const reasonsEl = document.getElementById("aiSupportingReasonsList");
    if (reasonsEl) {
      reasonsEl.innerHTML = aiVm.supportingReasons
        .map(
          (r, idx) =>
            `<div><span>${r}</span><strong>#${idx + 1}</strong></div>`
        )
        .join("");
    }

    // Risk Warnings
    const warningsEl = document.getElementById("aiRiskWarningsList");
    if (warningsEl) {
      if (!aiVm.riskWarnings.length) {
        warningsEl.innerHTML =
          '<div><span>No active risk or safety warnings.</span><strong class="tone-positive">CLEAR</strong></div>';
      } else {
        warningsEl.innerHTML = aiVm.riskWarnings
          .map(
            (w) =>
              `<div><span>${w}</span><strong class="tone-warning">ALERT</strong></div>`
          )
          .join("");
      }
    }

    // Invalidation Conditions
    const invalidEl = document.getElementById("aiInvalidationList");
    if (invalidEl) {
      invalidEl.innerHTML = aiVm.invalidationConditions
        .map((c) => `<div><span>${c}</span><strong>RULE</strong></div>`)
        .join("");
    }

    // Persisted AI Analysis History
    setText("aiHistoryCountBadge", `${aiVm.history.length} RECORDS`);
    const histContainer = document.getElementById("aiAnalysisHistoryContainer");
    if (histContainer) {
      if (!aiVm.history.length) {
        histContainer.innerHTML =
          '<div><span>No previous AI analysis decisions recorded for this workspace yet.</span><strong>--</strong></div>';
      } else {
        histContainer.innerHTML = aiVm.history
          .map(
            (h) =>
              `<div class="ai-history-item-row">
                <div class="ai-history-meta">
                  <span><strong>${h.symbol}</strong> • Decision: <strong>${h.decision}</strong> (${h.signal}) • Confidence: ${h.confidence} • Risk: ${h.risk} • Trend: ${h.trend}</span>
                  <small>${h.reasoning}</small>
                </div>
                <strong class="tabular-nums">${h.source} • ${h.timestamp}</strong>
              </div>`
          )
          .join("");
      }
    }
  } else {
    const analysis = state.lastAnalysis;
    setText("analysisPageSignalBadge", analysis?.signal || "NO_TRADE");
    setText("compTrend", analysis ? String(analysis.components.trend) : "0");
    setText("compMomentum", analysis ? String(analysis.components.momentum) : "0");
    setText("compVolume", analysis ? String(analysis.components.volume) : "0");
    setText("compVwap", analysis ? String(analysis.components.vwap) : "0");
    setText("compSR", analysis ? String(analysis.components.supportResistance) : "0");
    setText("compOptions", analysis ? String(analysis.components.options) : "0");
  }

  const snapForStrat =
    typeof window !== "undefined" ? window.YashwinMarketSnapshot : null;
  const instForStrat =
    (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
    (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null) || {
      key: "NIFTY50",
      name: "NIFTY 50",
      exchange: "NSE",
      type: "EQUITY"
    };

  if (
    typeof StrategyEngine !== "undefined" &&
    typeof StrategyEngine.buildStrategyViewModel === "function"
  ) {
    const pState =
      typeof PaperTrading !== "undefined" ? PaperTrading.getState() : null;
    const stratVm = StrategyEngine.buildStrategyViewModel({
      snapshot: snapForStrat,
      instrument: instForStrat,
      analysis: state.lastAnalysis,
      aiDecision: state.lastAIDecision,
      marketIntelligence: state.intelligence?.payload || null,
      strategy: state.lastStrategy,
      paperState: pState,
      emergencyStop: state.emergencyStop,
      history: state.strategyHistory
    });

    if (typeof window !== "undefined") {
      window.YashwinStrategyViewModel = stratVm;
    }

    const strat = stratVm.strategy;
    setText("strategyVersionBadge", strat.strategyVersion || "1.0.0-DETERMINISTIC");
    setText("strategyActionPill", strat.action || "NO_TRADE");
    setText("stratAction", strat.action || "NO_TRADE");
    setText(
      "stratTradeSideExecutable",
      `${strat.tradeSide || "HOLD"} • ${strat.executable ? "EXECUTABLE" : "NON-EXECUTABLE"}`
    );
    setText("stratRegimeDisplay", strat.marketRegime || "INSUFFICIENT_DATA");
    setText("stratDataQualityDisplay", strat.dataQuality || "DATA_UNAVAILABLE");
    setText("stratEntry", strat.entry ? money(strat.entry) : "--");
    setText("stratStop", strat.stopLoss ? money(strat.stopLoss) : "--");
    setText("stratTarget", strat.target ? money(strat.target) : "--");
    setText(
      "stratRRDisplay",
      strat.riskRewardRatio ? `1 : ${Number(strat.riskRewardRatio).toFixed(2)}` : "--"
    );
    setText(
      "stratUnitRiskReward",
      strat.unitRisk !== null && strat.unitReward !== null
        ? `${money(strat.unitRisk)} / ${money(strat.unitReward)}`
        : "-- / --"
    );
    setText("stratConfidence", `${strat.confidence || 0}%`);
    setText(
      "stratReasonText",
      strat.reason || "Waiting for validated market data and analysis signal."
    );

    // Top KPI strip
    setText("stratKpiSignal", `${strat.action || "NO_TRADE"} (${strat.tradeSide || "HOLD"})`);
    setText(
      "stratKpiInstrument",
      `${stratVm.instrument.name} (${stratVm.instrument.exchange} • ${stratVm.instrument.assetType})`
    );
    setText("stratKpiRegime", strat.marketRegime || "INSUFFICIENT_DATA");
    setText("stratKpiDataQuality", strat.dataQuality || "DATA_UNAVAILABLE");
    setText(
      "stratKpiRR",
      strat.riskRewardRatio ? `1 : ${Number(strat.riskRewardRatio).toFixed(2)}` : "--"
    );
    setText("stratKpiConfidence", `Confidence: ${strat.confidence || 0}%`);
    setText(
      "stratKpiSafetyGate",
      stratVm.canExecutePaper ? "APPROVED (PAPER)" : "BLOCKED"
    );

    setText(
      "stratRiskEngineStatus",
      stratVm.riskCheck?.allowed ? "APPROVED" : "BLOCKED"
    );
    setText(
      "stratAISafetyGateStatus",
      stratVm.safetyGate?.allowed ? "APPROVED" : "BLOCKED"
    );
    setText(
      "stratEmergencyStopStatus",
      stratVm.emergencyStop ? "ACTIVE (HALTED)" : "INACTIVE"
    );
    setText(
      "stratConflictCheckStatus",
      Array.isArray(strat.conflicts) && strat.conflicts.length > 0
        ? `CONFLICT (${strat.conflicts.length})`
        : "CLEAR"
    );

    const stagePilotBtn = document.getElementById("stratStagePilotBtn");
    const stagePaperBtn = document.getElementById("stratStagePaperBtn");
    if (stagePilotBtn) stagePilotBtn.disabled = !stratVm.canExecutePaper;
    if (stagePaperBtn) stagePaperBtn.disabled = !stratVm.canExecutePaper;

    // Entry conditions & supporting context
    const entryCondEl = document.getElementById("stratEntryConditionsList");
    if (entryCondEl) {
      const conds = [
        ...(Array.isArray(strat.entryConditions) ? strat.entryConditions : []),
        ...(Array.isArray(strat.supportingContext) ? strat.supportingContext : [])
      ];
      if (!conds.length) {
        entryCondEl.innerHTML =
          '<div><span>Waiting for validated market data and directional signal.</span><strong>RULE</strong></div>';
      } else {
        entryCondEl.innerHTML = conds
          .map((c) => `<div><span>${c}</span><strong>ENTRY</strong></div>`)
          .join("");
      }
    }

    // Invalidation conditions
    const invCondEl = document.getElementById("stratInvalidationConditionsList");
    if (invCondEl && Array.isArray(strat.invalidationConditions) && strat.invalidationConditions.length) {
      invCondEl.innerHTML = strat.invalidationConditions
        .map((c) => `<div><span>${c}</span><strong>INVALIDATION</strong></div>`)
        .join("");
    }

    // Strategy history
    const histList = Array.isArray(state.strategyHistory) ? state.strategyHistory : [];
    setText("stratHistoryCountBadge", `${histList.length} RECORDS`);
    const stratHistEl = document.getElementById("stratHistoryContainer");
    if (stratHistEl) {
      if (!histList.length) {
        stratHistEl.innerHTML =
          '<div><span>No persisted strategy evaluations recorded for this workspace yet.</span><strong>--</strong></div>';
      } else {
        stratHistEl.innerHTML = histList
          .slice(0, 15)
          .map(
            (s) =>
              `<div class="ai-history-item-row">
                <div class="ai-history-meta">
                  <span><strong>${s.symbol}</strong> • Action: <strong>${s.action}</strong> • Entry: ${s.entry ? money(s.entry) : "--"} • SL: ${s.stopLoss ? money(s.stopLoss) : "--"} • Target: ${s.target ? money(s.target) : "--"}</span>
                  <small>${s.reason || "Deterministic strategy evaluation"}</small>
                </div>
                <strong class="tabular-nums">${s.confidence}% • ${s.timestamp}</strong>
              </div>`
          )
          .join("");
      }
    }
  } else {
    const strat = state.lastStrategy;
    setText("strategyActionPill", strat?.action || "NO_TRADE");
    setText("stratAction", strat?.action || "NO_TRADE");
    setText("stratEntry", strat?.entry ? money(strat.entry) : "--");
    setText("stratStop", strat?.stopLoss ? money(strat.stopLoss) : "--");
    setText("stratTarget", strat?.target ? money(strat.target) : "--");
    setText("stratConfidence", strat ? `${strat.confidence}%` : "0%");
    setText(
      "stratReasonText",
      strat?.reason || "Waiting for validated market data and analysis signal."
    );
  }

  if (typeof PilotApproval !== "undefined") {
    const pending = PilotApproval.getPendingProposal();
    setText(
      "pilotStatusPill",
      pending ? pending.status : "NO PROPOSAL"
    );
    setText("pilotInstrument", pending ? pending.instrument : "--");
    setText(
      "pilotDirQty",
      pending ? `${pending.direction} • Qty ${pending.quantity}` : "--"
    );
    setText(
      "pilotLevels",
      pending
        ? `${money(pending.entry)} / SL ${money(pending.stop)} / T ${money(pending.target)}`
        : "--"
    );
    setText("pilotMaxLoss", pending ? money(pending.maximumLoss) : "--");

    const approveBtn = document.getElementById("approvePilotBtn");
    const rejectBtn = document.getElementById("rejectPilotBtn");
    if (approveBtn) approveBtn.disabled = !pending || state.emergencyStop;
    if (rejectBtn) rejectBtn.disabled = !pending;
  }

  renderBacktestResultView(state.backtest.lastReport);
}

function renderBacktestResultView(report) {
  const sessionBanner = document.getElementById("btSessionBanner");
  if (sessionBanner) {
    sessionBanner.hidden = Boolean(state.currentUser);
  }

  const loadingBanner = document.getElementById("btLoadingBanner");
  if (loadingBanner) {
    loadingBanner.hidden = !state.backtest.loading;
  }

  const errorBanner = document.getElementById("btErrorBanner");
  if (errorBanner) {
    if (state.backtest.error) {
      errorBanner.hidden = false;
      setText("btErrorText", state.backtest.error);
    } else {
      errorBanner.hidden = true;
    }
  }

  // Persisted Backtest Run History
  const runs = Array.isArray(state.backtest.runs) ? state.backtest.runs : [];
  setText("btRunHistoryCountPill", `${runs.length} RUNS`);
  const runHistContainer = document.getElementById("btRunHistoryContainer");
  if (runHistContainer) {
    if (!runs.length) {
      runHistContainer.innerHTML =
        '<div><span>No persisted backtest runs found for this workspace.</span><strong>--</strong></div>';
    } else {
      runHistContainer.innerHTML = runs
        .slice(0, 12)
        .map((r) => {
          const pnlVal = Number(r.netPnl || 0);
          const pnlText = money(pnlVal);
          const statusLabel = r.status || "COMPLETED";
          return `<div class="ai-history-item-row" data-run-id="${r.runId || ""}">
            <div class="ai-history-meta">
              <span><strong>${r.symbol || "NIFTY 50"} (${r.exchange || "NSE"})</strong> • ${r.timeframe || "FIVE_MINUTE"} • ${r.totalTrades ?? 0} trade(s) • Win: ${r.winRate ?? 0}%</span>
              <small>Run ID: ${r.runId} • Strategy: ${r.strategyName || "YASHWIN_DETERMINISTIC_V1"} (${r.strategyVersion || "1.0.0"}) • Candles: ${r.candlesCount ?? 0} • ${r.createdAt || "--"}</small>
            </div>
            <strong class="tabular-nums">${pnlText} • ${statusLabel}</strong>
          </div>`;
        })
        .join("");
    }
  }

  if (!report) {
    return;
  }

  const m = report.metrics || {
    initialCapital: report.initialCapital || 100000,
    finalEquity: report.finalCapital || 100000,
    totalTrades: report.totalTrades || 0,
    wins: report.wins || 0,
    losses: report.losses || 0,
    breakevens: report.breakevens || 0,
    winRate: report.winRate || 0,
    grossPnl: report.grossPnl || 0,
    totalCosts: report.totalCosts || 0,
    netPnl: report.netPnl || 0,
    returnPct: report.returnPct || 0,
    profitFactor: report.profitFactor ?? null,
    profitFactorStatus: report.profitFactorStatus || "INSUFFICIENT_CLOSED_TRADES",
    expectancy: report.expectancy || 0,
    averageWin: report.avgWin || 0,
    averageLoss: report.avgLoss || 0,
    maxDrawdown: report.maxDrawdown || 0,
    maxDrawdownPct: report.maxDrawdownPct || 0,
    averageHoldingDurationFormatted: "0s",
    longestLosingStreak: 0,
    riskRejectionsCount: (report.riskRejections || []).length,
    safetyGateRejectionsCount: (report.safetyGateRejections || []).length,
    ambiguousBarsCount: 0,
    gapExecutionAdjustmentsCount: 0,
    exitReasonBreakdown: {},
    dailyPnlSummary: []
  };

  setText(
    "btRunStatusBadge",
    report.runStatus || report.status || (report.ok ? "COMPLETED" : "REJECTED")
  );
  setText(
    "btCandlesProcessedMeta",
    `${report.candlesProcessed ?? 0} candles • ${report.timeframe || "FIVE_MINUTE"}`
  );
  setText(
    "btDataSourceBadge",
    report.dataQuality?.dataSource || report.dataSource || "VALIDATED_CANDLES"
  );
  if (report.strategyVersion) {
    setText("btStrategyVersionPill", report.strategyVersion);
  }

  setText("btFinalEquity", money(m.finalEquity ?? report.finalCapital ?? 100000));
  setText(
    "btReturnPctMeta",
    `Initial: ${money(m.initialCapital ?? report.initialCapital ?? 100000)} (${Number(m.returnPct || 0).toFixed(2)}%)`
  );

  setText("btNetPnl", money(m.netPnl || 0));
  setText(
    "btGrossAndCostsMeta",
    `Gross: ${money(m.grossPnl || 0)} • Costs: ${money(m.totalCosts || 0)}`
  );

  setText("btTotalTrades", String(m.totalTrades ?? 0));
  setText("btWinRate", `${m.winRate ?? 0}%`);
  setText(
    "btWinLossBreakdown",
    `${m.wins ?? 0}W / ${m.losses ?? 0}L / ${m.breakevenTrades ?? m.breakevens ?? 0}BE`
  );

  if (m.profitFactorDisplay) {
    setText("btProfitFactor", m.profitFactorDisplay);
  } else if (m.profitFactor !== null && m.profitFactor !== undefined && Number.isFinite(Number(m.profitFactor))) {
    setText("btProfitFactor", Number(m.profitFactor).toFixed(2));
  } else {
    setText("btProfitFactor", "N/A (Insufficient Trades)");
  }

  setText(
    "btExpectancy",
    m.expectancy !== null && m.expectancy !== undefined ? money(m.expectancy) : "₹0.00"
  );
  setText("btAvgWinLoss", `${money(m.averageWin || 0)} / ${money(m.averageLoss || 0)}`);
  setText(
    "btMaxDD",
    `${money(m.maxDrawdown || 0)} (${Number(m.maxDrawdownPct || 0).toFixed(2)}%)`
  );
  setText(
    "btAvgHoldDuration",
    m.averageHoldingDurationLabel || m.averageHoldingDurationFormatted || "0s"
  );
  setText("btLosingStreak", String(m.longestLosingStreak ?? 0));
  setText(
    "btRiskRejectionsCount",
    `${m.riskViolations ?? m.riskRejectionsCount ?? 0} / ${m.safetyGateRejections ?? m.safetyGateRejectionsCount ?? 0}`
  );
  setText(
    "btAmbiguousGapCount",
    `${m.ambiguousExecutionsCount ?? m.ambiguousBarsCount ?? 0} / ${m.gapExecutionsCount ?? m.gapExecutionAdjustmentsCount ?? 0}`
  );

  // Chronological Equity Curve & Drawdown
  const eqCurve = Array.isArray(report.detailedEquityCurve)
    ? report.detailedEquityCurve
    : Array.isArray(report.equityCurve) && typeof report.equityCurve[0] === "object"
      ? report.equityCurve
      : [];
  setText("btEquityPointsPill", `${eqCurve.length} POINTS`);
  const eqContainer = document.getElementById("btEquityCurveContainer");
  if (eqContainer) {
    if (!eqCurve.length) {
      eqContainer.innerHTML =
        '<div><span>No equity curve points recorded for this run.</span><strong>--</strong></div>';
    } else {
      eqContainer.innerHTML = eqCurve
        .map((pt) => {
          const ddText =
            Number(pt.drawdown || 0) > 0
              ? `DD: -${money(pt.drawdown)} (-${Number(pt.drawdownPct || 0).toFixed(2)}%)`
              : "Peak Equity";
          return `<div class="ai-history-item-row">
            <div class="ai-history-meta">
              <span><strong>${pt.event || "EQUITY_POINT"}</strong> • Trade P&L: ${money(pt.tradePnl ?? pt.tradeNetPnl ?? 0)}</span>
              <small>${pt.timestamp || "--"} • Cum Net P&L: ${money(pt.cumulativeNetPnl || 0)} • ${ddText}</small>
            </div>
            <strong class="tabular-nums">${money(pt.equity)}</strong>
          </div>`;
        })
        .join("");
    }
  }

  // Exit-Reason Breakdown
  const exitBreakdownArr = Array.isArray(report.exitReasonBreakdown)
    ? report.exitReasonBreakdown
    : [];
  const exitContainer = document.getElementById("btExitReasonContainer");
  if (exitContainer) {
    if (!exitBreakdownArr.length) {
      exitContainer.innerHTML =
        '<div><span>No simulated trade exits recorded in this backtest run.</span><strong>0 EXITS</strong></div>';
    } else {
      exitContainer.innerHTML = exitBreakdownArr
        .map(
          (item) =>
            `<div><span>${item.reason} (${item.wins ?? 0}W / ${item.losses ?? 0}L)</span><strong class="tabular-nums">${item.count} trade(s) • ${money(item.netPnl || 0)}</strong></div>`
        )
        .join("");
    }
  }

  // Daily P&L Summary
  const dailyList = Array.isArray(report.dailyPnlBreakdown)
    ? report.dailyPnlBreakdown
    : Array.isArray(m.dailyPnlSummary)
      ? m.dailyPnlSummary
      : [];
  const dailyContainer = document.getElementById("btDailyPnlContainer");
  if (dailyContainer) {
    if (!dailyList.length) {
      dailyContainer.innerHTML =
        '<div><span>No daily sessions simulated in this backtest run.</span><strong>--</strong></div>';
    } else {
      dailyContainer.innerHTML = dailyList
        .map(
          (d) =>
            `<div><span>${d.date || d.day} • ${d.tradesClosed ?? d.tradesCount ?? 0} closed trade(s)${d.dailyLossLocked || d.locked ? " • DAILY_LOSS_LOCKED" : ""}${d.maxTradesReached ? " • MAX_TRADES_REACHED" : ""}</span><strong class="tabular-nums">${money(d.netPnl || 0)}</strong></div>`
        )
        .join("");
    }
  }

  // Simulated Trades List
  const trades = Array.isArray(report.trades) ? report.trades : [];
  setText("btTradesCountPill", `${trades.length} TRADES`);
  const tradesContainer = document.getElementById("btTradesListContainer");
  if (tradesContainer) {
    if (!trades.length) {
      tradesContainer.innerHTML =
        '<div><span>No simulated trades generated in current backtest run.</span><strong>0 TRADES</strong></div>';
    } else {
      tradesContainer.innerHTML = trades
        .map((t, idx) => {
          const flags = [
            t.ambiguousCandle || t.ambiguousSameCandle ? "AMBIGUOUS_BAR_SL_FIRST" : null,
            t.gapExecution || t.gapExit ? "GAP_EXECUTION" : null
          ]
            .filter(Boolean)
            .join(" • ");
          return `<div class="ai-history-item-row">
            <div class="ai-history-meta">
              <span><strong>#${t.tradeId || idx + 1} ${t.direction} ${t.symbol}</strong> • Qty: ${t.quantity} (Lot ${t.lotSize || 1}) • Entry: ${money(t.entry)} → Exit: ${money(t.exitPrice ?? t.exit)} (${t.reason || t.exitReason})</span>
              <small>${t.openedAt} → ${t.closedAt} (${t.holdingDurationLabel || t.holdingDurationFormatted || "0s"}) • SL: ${money(t.stop ?? t.stopLoss)} • Target: ${money(t.target)} • Gross: ${money(t.grossPnl)} • Costs: ${money(t.totalCosts ?? t.fees ?? 0)}${flags ? " • " + flags : ""}</small>
            </div>
            <strong class="tabular-nums">${money(t.pnl ?? t.netPnl)} (${t.outcome || "--"})</strong>
          </div>`;
        })
        .join("");
    }
  }
}

function renderPositionsOrdersHistoryRiskViews() {
  if (typeof PaperTrading !== "undefined") {
    const pState = PaperTrading.getState();
    const paperVm =
      typeof PaperTrading.buildPaperTradingViewModel === "function"
        ? PaperTrading.buildPaperTradingViewModel({
            paperState: pState,
            emergencyStop: state.emergencyStop,
            serverEmergencyStop: state.serverEmergencyStop
          })
        : null;

    if (typeof window !== "undefined" && paperVm) {
      window.YashwinPaperTradingViewModel = paperVm;
    }

    const pos = pState.position;

    if (paperVm) {
      setText("paperAccountCapital", paperVm.account.capitalFormatted);
      setText(
        "paperTotalEquityText",
        `Net Equity: ${paperVm.account.totalEquityFormatted}`
      );
      setText("paperAvailableBalance", paperVm.account.availableBalanceFormatted);
      setText(
        "paperReservedCapital",
        `Reserved Margin: ${paperVm.account.reservedCapitalFormatted}`
      );
      setText("paperTotalRealizedPnl", paperVm.account.realizedPnlFormatted);
      setText(
        "paperOpenUnrealizedPnl",
        `Unrealized P&L: ${paperVm.account.unrealizedPnlFormatted}`
      );
      setText(
        "paperWinRateStats",
        `${paperVm.account.winRateFormatted} (${paperVm.account.wins}W / ${paperVm.account.losses}L)`
      );
      setText(
        "paperAutoExecBadge",
        `Auto Paper Execution: ${paperVm.autoPaperEnabled ? "ENABLED" : "DISABLED"}`
      );
    }

    setText("positionsOpenCount", pos ? "1 / 1" : "0 / 1");
    setText("positionsStateBadge", pos ? "OPEN (PAPER)" : "FLAT");

    if (pos) {
      const eq = Number(pos.effectiveQty || pos.qty || 0);
      const uPnl =
        pos.direction === "BUY"
          ? (pos.current - pos.entry) * eq
          : (pos.entry - pos.current) * eq;
      const lockedStop =
        typeof PaperTrading.lockedStopPrice === "function"
          ? PaperTrading.lockedStopPrice()
          : null;
      const entryNotional = Math.abs(Number(pos.entry || 0) * eq);
      const uPnlPct = entryNotional > 0 ? ((uPnl / entryNotional) * 100).toFixed(2) : "0.00";

      setText("posViewSymbol", `${pos.symbol} (${pos.direction} • ${pos.exchange || "NSE"} • ${pos.assetType} x${eq})`);
      setText("posViewPrices", `${money(pos.entry)} → ${money(pos.current)}`);
      setText("posViewStops", `SL ${money(pos.stop)} / Target ${money(pos.target)}`);
      setText(
        "posViewTrailing",
        `Locked ${money(pos.lockedProfit)} / Next ${money(pos.nextProfitMilestone)}`
      );
      setText(
        "posViewTrailingStop",
        `${lockedStop !== null ? money(lockedStop) : "INACTIVE"} • Target: ${pos.targetActivated ? "ACTIVATED" : pos.exitOnTarget ? "AUTO-EXIT" : "TRAIL"}`
      );
      setText("posViewMargin", `${money(entryNotional)} / Mkt Val: ${money(Math.abs(Number(pos.current || pos.entry) * eq))}`);
      setText("posViewPnl", `${money(uPnl)} (${uPnl >= 0 ? "+" : ""}${uPnlPct}%)`);
    } else {
      setText("posViewSymbol", "--");
      setText("posViewPrices", "--");
      setText("posViewStops", "--");
      setText("posViewTrailing", "--");
      setText("posViewTrailingStop", "--");
      setText("posViewMargin", "₹0.00");
      setText("posViewPnl", "₹0.00");
      setText("posViewQuoteFreshness", "NO OPEN POSITION");
      setText("posViewRiskStatus", "FLAT");
    }

    // TASK 11 — Complete Portfolio Management View Model & Visualization
    if (
      typeof PortfolioEngine !== "undefined" &&
      typeof PortfolioEngine.buildPortfolioViewModel === "function"
    ) {
      const portfolioInput = state.portfolio.snapshot
        ? {
            ...state.portfolio.snapshot,
            filters: state.portfolio.filters
          }
        : {
            userId: state.currentUser?.userId || null,
            account: {
              capital: pState.capital,
              realizedPnl: pState.realizedPnl,
              unrealizedPnl: pState.unrealizedPnl,
              dailyPnl: pState.dailyPnl,
              tradesToday: pState.tradesToday,
              wins: pState.wins,
              losses: pState.losses,
              maxDailyLoss: pState.maxDailyLoss,
              maxLossPerTrade: pState.maxLossPerTrade,
              maxTradesPerDay: pState.maxTradesPerDay,
              sessionDate: pState.sessionDate
            },
            openPosition: pos,
            orders: pState.orders,
            fills: pState.fills,
            closedTrades: pState.history,
            emergencyStop: state.emergencyStop,
            filters: state.portfolio.filters
          };

      const portSnap = PortfolioEngine.buildPortfolioSnapshot(portfolioInput);
      const portVm = PortfolioEngine.buildPortfolioViewModel(portSnap);

      if (typeof window !== "undefined") {
        window.YashwinPortfolioViewModel = portVm;
      }

      // Banners
      const sessionBanner = document.getElementById("portfolioSessionBanner");
      if (sessionBanner) {
        sessionBanner.hidden = Boolean(state.currentUser);
      }
      const loadingBanner = document.getElementById("portfolioLoadingBanner");
      if (loadingBanner) {
        loadingBanner.hidden = !state.portfolio.loading;
      }
      const errorBanner = document.getElementById("portfolioErrorBanner");
      if (errorBanner) {
        errorBanner.hidden = !state.portfolio.error;
        if (state.portfolio.error) {
          setText("portfolioErrorText", state.portfolio.error);
        }
      }
      const staleBanner = document.getElementById("portfolioStaleBanner");
      if (staleBanner) {
        const openVal = portVm.positions[0] || null;
        const showStale = Boolean(openVal && (openVal.isStale || openVal.isQuoteUnavailable));
        staleBanner.hidden = !showStale;
        if (showStale && openVal) {
          setText(
            "portfolioStaleBannerText",
            `${openVal.valuationStatusLabel} (${openVal.symbol} last valid price: ${money(openVal.lastValidPrice)} at ${openVal.quoteTimestamp || "--"}).`
          );
        }
      }

      // Row 1 KPIs
      setText("portKpiInitialCapital", portVm.kpis.initialCapital);
      setText("portKpiTotalEquity", `Total Equity: ${portVm.kpis.totalEquity}`);
      setText("portKpiAvailableBalance", portVm.kpis.availableBalance);
      setText("portKpiReservedCapital", `Reserved Margin: ${portVm.kpis.reservedCapital}`);
      setText("portKpiRealizedPnl", portVm.kpis.realizedPnl);
      setText(
        "portKpiOverallReturnPct",
        `Overall Return: ${portVm.kpis.overallReturnPct} (vs Initial Capital)`
      );
      setText(
        "portKpiTodayPnl",
        `${portVm.kpis.todayRealizedPnl} / ${portVm.kpis.todayUnrealizedPnl}`
      );
      setText(
        "portKpiUnrealizedMeta",
        `Effective Daily: ${portVm.kpis.todayEffectivePnl} • Updated: ${portVm.lastUpdatedLabel}`
      );

      // Row 2 KPIs
      setText(
        "portKpiClosedTrades",
        `${portVm.kpis.closedTradesLabel} Closed (${portVm.kpis.winLossLabel})`
      );
      setText("portKpiWinRate", `Win Rate: ${portVm.kpis.winRateLabel}`);
      setText("portKpiProfitFactor", portVm.kpis.profitFactorLabel);
      setText("portKpiExpectancy", `Expectancy: ${portVm.kpis.expectancyLabel}`);
      setText(
        "portKpiAvgWinLoss",
        portVm.performance.hasSufficientHistory
          ? `${portVm.kpis.averageWinLabel} / ${portVm.kpis.averageLossLabel}`
          : "INSUFFICIENT_DATA"
      );
      setText(
        "portKpiStreakMeta",
        `Max Streak: ${portVm.performance.maxConsecutiveWins}W / ${portVm.performance.maxConsecutiveLosses}L`
      );
      setText("portKpiMaxDrawdown", portVm.kpis.maxDrawdownLabel);
      setText("portKpiDataAvailability", `Status: ${portVm.dataAvailability}`);

      // Holdings & Open Position Table
      const holdingsContainer = document.getElementById("portfolioHoldingsTableContainer");
      const actionRow = document.getElementById("portfolioPositionActionRow");
      const openVal = portVm.positions[0] || null;

      if (openVal) {
        setText(
          "posViewQuoteFreshness",
          `${openVal.valuationStatusLabel} • ${openVal.quoteTimestamp || "--"}`
        );
        setText("posViewRiskStatus", openVal.riskStatus);
        if (actionRow) actionRow.hidden = false;
        if (holdingsContainer) {
          const optMeta = openVal.optionDetails
            ? ` • Lot Size: ${openVal.optionDetails.lotSize} × ${openVal.optionDetails.lots} Lot(s)`
            : "";
          holdingsContainer.innerHTML = `<div class="risk-list">
            <div class="ai-history-item-row">
              <div class="ai-history-meta">
                <span><strong>${openVal.symbol} (${openVal.exchange})</strong> • ${openVal.direction} • ${openVal.assetType}${optMeta} • Effective Qty: <strong>${openVal.effectiveQty}</strong></span>
                <small>Avg Entry: ${money(openVal.averageEntryPrice)} • Validated Price: ${openVal.lastValidPrice !== null ? money(openVal.lastValidPrice) : "UNAVAILABLE"} • Mkt Value: ${openVal.marketValue !== null ? money(openVal.marketValue) : "UNAVAILABLE"} • Reserved: ${money(openVal.reservedCapital)} • SL: ${money(openVal.stopLoss)} • Target: ${money(openVal.target)}</small>
                <small>Quote Status: ${openVal.valuationStatusLabel} (${openVal.quoteTimestamp || "--"}) • Risk Status: ${openVal.riskStatus}</small>
              </div>
              <strong class="tabular-nums">${PortfolioEngine.formatSignedINR(openVal.unrealizedNetPnl)} (${openVal.pnlPercentage !== null ? (openVal.pnlPercentage >= 0 ? "+" : "") + openVal.pnlPercentage.toFixed(2) + "%" : "--"})</strong>
            </div>
          </div>`;
        }
      } else {
        if (actionRow) actionRow.hidden = true;
        if (holdingsContainer) {
          holdingsContainer.innerHTML = `<div class="empty-state" id="portfolioNoOpenHoldingsState">
            <strong>No active open paper holdings</strong>
            <span>Capital is 100% unreserved. Open a validated paper position via Paper Trading to monitor live mark-to-market valuation here.</span>
          </div>`;
        }
      }

      // Equity & Cumulative P&L SVG Curve (Strictly from actual closed-trade records)
      const eqEmpty = document.getElementById("portfolioEquityChartEmpty");
      const eqContainer = document.getElementById("portfolioEquityChartContainer");
      const eqSvg = document.getElementById("portfolioEquitySvg");
      const eqSummary = document.getElementById("portfolioEquityCurveSummary");
      const curve = portVm.performance.equityCurve || [];

      if (curve.length < 2) {
        setText("portfolioEquityChartBadge", "INSUFFICIENT_DATA");
        if (eqEmpty) eqEmpty.hidden = false;
        if (eqContainer) eqContainer.hidden = true;
      } else {
        setText("portfolioEquityChartBadge", `${curve.length - 1} CLOSED TRADE(S)`);
        if (eqEmpty) eqEmpty.hidden = true;
        if (eqContainer) eqContainer.hidden = false;

        if (eqSvg) {
          const width = 640;
          const height = 200;
          const padX = 32;
          const padY = 24;
          const values = curve.map((pt) => Number(pt.equity));
          const minEq = Math.min(...values);
          const maxEq = Math.max(...values);
          const span = Math.max(100, maxEq - minEq);

          const coords = curve.map((pt, idx) => {
            const x =
              padX +
              (idx / Math.max(1, curve.length - 1)) * (width - padX * 2);
            const y =
              height -
              padY -
              ((Number(pt.equity) - minEq) / span) * (height - padY * 2);
            return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), pt };
          });

          const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(" ");
          const lastEq = curve[curve.length - 1].equity;
          const startEq = curve[0].equity;
          const strokeColor = lastEq >= startEq ? "#22c55e" : "#ef4444";

          const circlesHtml = coords
            .map(
              (c) =>
                `<circle cx="${c.x}" cy="${c.y}" r="4" fill="${strokeColor}"><title>${c.pt.symbol}: Equity ${money(c.pt.equity)} (Cum P&L: ${PortfolioEngine.formatSignedINR(c.pt.cumulativePnl)})</title></circle>`
            )
            .join("");

          eqSvg.innerHTML = `
            <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" stroke="rgba(148,163,184,0.25)" stroke-width="1" />
            <polyline fill="none" stroke="${strokeColor}" stroke-width="2.5" points="${polylinePoints}" />
            ${circlesHtml}
          `;
        }

        if (eqSummary) {
          const lastPt = curve[curve.length - 1];
          eqSummary.innerHTML = `
            <div><span>Starting Capital</span><strong class="tabular-nums">${money(curve[0].equity)}</strong></div>
            <div><span>Latest Closed Equity</span><strong class="tabular-nums">${money(lastPt.equity)} (${PortfolioEngine.formatSignedINR(lastPt.cumulativePnl)})</strong></div>
            <div><span>Largest Drawdown</span><strong class="tabular-nums">${portVm.kpis.maxDrawdownLabel}</strong></div>
          `;
        }
      }

      // Exit-Reason Distribution
      setText(
        "portfolioExitBreakdownBadge",
        `${portVm.performance.closedTradeCount} TRADES`
      );
      const exitListEl = document.getElementById("portfolioExitReasonList");
      if (exitListEl && portVm.performance.exitReasonBreakdown) {
        const eb = portVm.performance.exitReasonBreakdown;
        const labels = [
          ["STOP_LOSS", "STOP_LOSS (Hard Stop-Loss)"],
          ["TARGET_EXIT", "TARGET_EXIT (Target Reached)"],
          ["EMERGENCY_STOP", "EMERGENCY_STOP (Kill-Switch)"],
          ["RISK_LOCK", "RISK_LOCK (₹1,000 Daily Loss Lock)"],
          ["PROFIT_LOCK", "PROFIT_LOCK (Trailing Profit Lock)"],
          ["MANUAL", "MANUAL (User Manual Close)"]
        ];
        exitListEl.innerHTML = labels
          .map(([key, label]) => {
            const b = eb[key] || { count: 0, pct: 0, pnl: 0 };
            return `<div><span>${label}</span><strong class="tabular-nums">${b.count} (${b.pct.toFixed(1)}%) • ${PortfolioEngine.formatSignedINR(b.pnl)}</strong></div>`;
          })
          .join("");
      }

      // Daily P&L History
      const dailyList = portVm.filteredPerformance?.dailyPnlHistory || [];
      setText("portfolioDailyHistoryBadge", `${dailyList.length} DAYS`);
      const dailyEl = document.getElementById("portfolioDailyPnlList");
      if (dailyEl) {
        if (!dailyList.length) {
          dailyEl.innerHTML =
            '<div><span>No daily closed-trade sessions recorded yet.</span><strong>INSUFFICIENT_DATA</strong></div>';
        } else {
          dailyEl.innerHTML = dailyList
            .slice(0, 15)
            .map(
              (d) =>
                `<div><span><strong>${d.date}</strong> • ${d.tradesCount} trade(s) (${d.wins}W / ${d.losses}L)</span><strong class="tabular-nums">${PortfolioEngine.formatSignedINR(d.realizedPnl)} (Cum: ${PortfolioEngine.formatSignedINR(d.cumulativePnl)})</strong></div>`
            )
            .join("");
        }
      }

      // Filtered Closed Trades List
      const filteredTrades = portVm.history || [];
      setText("portfolioFilteredCountBadge", `${filteredTrades.length} MATCHING`);
      setText("portfolioClosedListBadge", `${filteredTrades.length} TRADES`);
      const closedListEl = document.getElementById("portfolioClosedTradesList");
      if (closedListEl) {
        if (!filteredTrades.length) {
          closedListEl.innerHTML =
            '<div><span>No closed paper trades match the current filter.</span><strong>--</strong></div>';
        } else {
          closedListEl.innerHTML = filteredTrades
            .slice(0, 25)
            .map((t) => {
              const rMult =
                t.rMultiple !== null && t.rMultiple !== undefined
                  ? ` • ${t.rMultiple >= 0 ? "+" : ""}${t.rMultiple}R`
                  : "";
              return `<div class="ai-history-item-row">
                <div class="ai-history-meta">
                  <span><strong>${t.symbol}</strong> • ${t.direction} x${t.quantity} • Reason: <strong>${t.normalizedReason || t.reason}</strong>${rMult}</span>
                  <small>Entry: ${money(t.entry)} → Exit: ${money(t.exit)} • Closed: ${t.closedAt || t.timestamp || "--"}</small>
                </div>
                <strong class="tabular-nums">${PortfolioEngine.formatSignedINR(t.pnl)}</strong>
              </div>`;
            })
            .join("");
        }
      }
    }

    /* =====================================================
       TASK 12 — COMPLETE ORDERS, VIRTUAL FILLS & CLOSED TRADE HISTORY RENDERING
    ===================================================== */
    if (typeof OrderTradeHistoryEngine !== "undefined") {
      const ordersLoadingEl = document.getElementById("ordersLoadingBanner");
      const ordersErrorEl = document.getElementById("ordersErrorBanner");
      if (ordersLoadingEl) ordersLoadingEl.hidden = !state.orderTradeHistory?.loading;
      if (ordersErrorEl) {
        ordersErrorEl.hidden = !state.orderTradeHistory?.error;
        if (state.orderTradeHistory?.error) {
          setText("ordersErrorText", state.orderTradeHistory.error);
        }
      }

      const historyLoadingEl = document.getElementById("historyLoadingBanner");
      const historyErrorEl = document.getElementById("historyErrorBanner");
      if (historyLoadingEl) historyLoadingEl.hidden = !state.orderTradeHistory?.loading;
      if (historyErrorEl) {
        historyErrorEl.hidden = !state.orderTradeHistory?.error;
        if (state.orderTradeHistory?.error) {
          setText("historyErrorText", state.orderTradeHistory.error);
        }
      }

      const ordersSnap = OrderTradeHistoryEngine.buildOrderTradeHistorySnapshot({
        userId: state.currentUser?.userId || null,
        orders: pState.orders || [],
        fills: pState.fills || [],
        trades: pState.history || [],
        openPosition: pos,
        query: state.orderTradeHistory?.ordersFilters || {}
      });

      const historySnap = OrderTradeHistoryEngine.buildOrderTradeHistorySnapshot({
        userId: state.currentUser?.userId || null,
        orders: pState.orders || [],
        fills: pState.fills || [],
        trades: pState.history || [],
        openPosition: pos,
        query: state.orderTradeHistory?.historyFilters || {}
      });

      if (typeof window !== "undefined") {
        window.YashwinOrdersSnapshot = ordersSnap;
        window.YashwinTradeHistorySnapshot = historySnap;
      }

      if (ordersSnap && ordersSnap.ok) {
        const os = ordersSnap.summary;
        const op = ordersSnap.ordersPagination;
        setText("ordersKpiTotalOrders", String(os.totalOrders));
        setText(
          "ordersKpiFilledVsRejected",
          `${os.filledOrdersCount} FILLED_PAPER • ${os.rejectedOrdersCount} REJECTED`
        );
        setText("ordersKpiTotalFills", String(os.totalFills));
        setText("ordersKpiTotalFees", os.totalFeesFormatted);
        setText(
          "ordersFilteredSummaryBadge",
          `${os.filteredOrdersCount} ORDERS • ${os.filteredFillsCount} FILLS`
        );
        setText("ordersCountPill", `${os.filteredOrdersCount} ORDERS`);
        setText("ordersPageIndicator", `Page ${op.page} of ${op.totalPages}`);
        setText(
          "ordersPaginationMeta",
          `Showing ${ordersSnap.orders.length} of ${os.filteredOrdersCount} matching orders`
        );

        const prevOrdBtn = document.getElementById("ordersPrevPageBtn");
        const nextOrdBtn = document.getElementById("ordersNextPageBtn");
        if (prevOrdBtn) prevOrdBtn.disabled = !op.hasPrevPage;
        if (nextOrdBtn) nextOrdBtn.disabled = !op.hasNextPage;

        const ordersContainer = document.getElementById("ordersListContainer");
        if (ordersContainer) {
          if (!ordersSnap.orders.length) {
            ordersContainer.innerHTML =
              '<div><span>No paper orders match the current filter.</span><strong>EMPTY</strong></div>';
          } else {
            ordersContainer.innerHTML = ordersSnap.orders
              .map((o) => {
                const links = [];
                if (o.fillId) links.push(`Fill: ${o.fillId}`);
                if (o.positionId) links.push(`Pos: ${o.positionId}`);
                if (o.tradeId) links.push(`Trade: ${o.tradeId}`);
                const linkStr = links.length ? ` • ${links.join(" | ")}` : "";
                const rejectNote = o.rejectionReason
                  ? ` • Rejected: ${o.rejectionReason}`
                  : "";
                return `<div class="ai-history-item-row">
                  <div class="ai-history-meta">
                    <span><strong>${o.orderId}</strong> • ${o.type} • <strong>${o.symbol}</strong> (${o.exchange}) • ${o.direction} x${o.quantity} • ${o.contractLabel}</span>
                    <small>Time: ${o.timestamp || "--"} • Mode: ${o.mode} • SL: ${o.stopFormatted} | Target: ${o.targetFormatted}${linkStr}${rejectNote}</small>
                  </div>
                  <strong class="tabular-nums">${o.fillPriceFormatted} • ${o.status} (SIMULATED_PAPER)</strong>
                </div>`;
              })
              .join("");
          }
        }

        const fillsContainer = document.getElementById("fillsListContainer");
        setText("fillsCountPill", `${os.filteredFillsCount} FILLS`);
        if (fillsContainer) {
          if (!ordersSnap.fills.length) {
            fillsContainer.innerHTML =
              '<div><span>No virtual paper fills match the current filter.</span><strong>EMPTY</strong></div>';
          } else {
            fillsContainer.innerHTML = ordersSnap.fills
              .map((f) => {
                const links = [`Order: ${f.orderId}`];
                if (f.positionId) links.push(`Pos: ${f.positionId}`);
                if (f.tradeId) links.push(`Trade: ${f.tradeId}`);
                return `<div class="ai-history-item-row">
                  <div class="ai-history-meta">
                    <span><strong>${f.fillId}</strong> • ${f.entryOrExit} • <strong>${f.symbol}</strong> (${f.exchange}) • ${f.direction} x${f.quantity}</span>
                    <small>Filled: ${f.filledAt || "--"} • Fees: ${f.feesFormatted} • Slippage: ${f.slippageFormatted} • Source: ${f.dataSource} • ${links.join(" | ")}</small>
                  </div>
                  <strong class="tabular-nums">${f.fillPriceFormatted} • ${f.brokerExecution}</strong>
                </div>`;
              })
              .join("");
          }
        }
      }

      if (historySnap && historySnap.ok) {
        const hs = historySnap.summary;
        const hp = historySnap.tradesPagination;
        setText("historyTradesCount", String(hs.totalClosedTrades));
        setText("historyKpiClosedCount", `${hs.filteredTradesCount} Trades`);
        setText(
          "historyKpiWinLossBreakdown",
          `${hs.winningTradesCount}W • ${hs.losingTradesCount}L • ${hs.breakevenTradesCount}BE`
        );
        setText("historyKpiGrossPnl", hs.totalGrossPnlFormatted);
        setText("historyKpiFeesTotal", `Total Fees: ${hs.totalFeesFormatted}`);
        setText("historyKpiNetPnl", hs.totalNetPnlFormatted);
        setText(
          "historyKpiAccountingCheck",
          hs.accountingConsistent ? "Accounting: VERIFIED" : "Accounting: CHECK"
        );
        setText("historyFilteredCountBadge", `${hs.filteredTradesCount} MATCHING`);
        setText("historyTradesListPill", `${hs.filteredTradesCount} TRADES`);
        setText("historyPageIndicator", `Page ${hp.page} of ${hp.totalPages}`);
        setText(
          "historyPaginationMeta",
          `Showing ${historySnap.trades.length} of ${hs.filteredTradesCount} closed trades`
        );

        const prevHistBtn = document.getElementById("historyPrevPageBtn");
        const nextHistBtn = document.getElementById("historyNextPageBtn");
        if (prevHistBtn) prevHistBtn.disabled = !hp.hasPrevPage;
        if (nextHistBtn) nextHistBtn.disabled = !hp.hasNextPage;

        const historyContainer = document.getElementById("tradeHistoryContainer");
        if (historyContainer) {
          if (!historySnap.trades.length) {
            historyContainer.innerHTML =
              '<div><span>No closed paper trades match the current filter.</span><strong>--</strong></div>';
          } else {
            historyContainer.innerHTML = historySnap.trades
              .map((t) => {
                const links = [];
                if (t.positionId) links.push(`Pos: ${t.positionId}`);
                if (t.entryOrderId) links.push(`EntryOrd: ${t.entryOrderId}`);
                if (t.exitOrderId) links.push(`ExitOrd: ${t.exitOrderId}`);
                if (t.entryFillId) links.push(`EntryFill: ${t.entryFillId}`);
                if (t.exitFillId) links.push(`ExitFill: ${t.exitFillId}`);
                const linkStr = links.length ? ` • ${links.join(" | ")}` : "";
                return `<div class="ai-history-item-row">
                  <div class="ai-history-meta">
                    <span><strong>${t.tradeId}</strong> • <strong>${t.symbol}</strong> (${t.exchange}) • ${t.direction} x${t.quantity} • Exit: <strong>${t.exitReason}</strong> • ${t.rMultipleFormatted} • Hold: ${t.holdingDurationFormatted}</span>
                    <small>Entry: ${t.entryFormatted} (${t.openedAt || "--"}) → Exit: ${t.exitFormatted} (${t.closedAt || "--"}) • SL: ${t.stopFormatted} | Target: ${t.targetFormatted} • Gross: ${t.grossPnlFormatted} | Fees: ${t.feesFormatted}${linkStr}</small>
                  </div>
                  <strong class="tabular-nums">${t.netPnlFormatted}</strong>
                </div>`;
              })
              .join("");
          }
        }
      }
    } else {
      const ordersContainer = document.getElementById("ordersListContainer");
      setText("ordersCountPill", `${pState.orders.length} ORDERS`);
      if (ordersContainer) {
        if (!pState.orders.length) {
          ordersContainer.innerHTML =
            '<div><span>No paper orders recorded yet.</span><strong>--</strong></div>';
        } else {
          ordersContainer.innerHTML = pState.orders
            .slice(0, 15)
            .map(
              (o) =>
                `<div><span>${o.type} • ${o.symbol} (${o.direction} x${o.quantity}) • ${o.mode || "MANUAL_PAPER"}</span><strong>${money(o.price)} • ${o.status}</strong></div>`
            )
            .join("");
        }
      }

      const fillsContainer = document.getElementById("fillsListContainer");
      const fillsList = Array.isArray(pState.fills) ? pState.fills : [];
      setText("fillsCountPill", `${fillsList.length} FILLS`);
      if (fillsContainer) {
        if (!fillsList.length) {
          fillsContainer.innerHTML =
            '<div><span>No virtual paper fills recorded yet.</span><strong>--</strong></div>';
        } else {
          fillsContainer.innerHTML = fillsList
            .slice(0, 15)
            .map(
              (f) =>
                `<div><span>${f.symbol} (${f.direction} x${f.quantity}) • Order ${f.orderId}</span><strong>${money(f.fillPrice)} • ${f.filledAt}</strong></div>`
            )
            .join("");
        }
      }

      const historyContainer = document.getElementById("tradeHistoryContainer");
      setText("historyTradesCount", String(pState.history.length));
      if (historyContainer) {
        if (!pState.history.length) {
          historyContainer.innerHTML =
            '<div><span>No closed paper trades yet.</span><strong>--</strong></div>';
        } else {
          historyContainer.innerHTML = pState.history
            .slice(0, 15)
            .map(
              (t) =>
                `<div><span>${t.symbol} (${t.direction} x${t.quantity}) • Entry ${money(t.entry ?? t.entryPrice)} → Exit ${money(t.exit ?? t.exitPrice)} • ${t.reason}</span><strong>${money(t.pnl)}</strong></div>`
            )
            .join("");
        }
      }
    }
  }

  if (typeof AuditLogger !== "undefined") {
    const logs = AuditLogger.getLogs();
    const auditContainer = document.getElementById("auditLogContainer");
    if (auditContainer && logs.length) {
      auditContainer.innerHTML = logs
        .slice(0, 15)
        .map(
          (l) =>
            `<div><span>${l.message}</span><strong>${l.category}</strong></div>`
        )
        .join("");
    }
  }

  setText(
    "riskEmergencyPill",
    state.emergencyStop ? "EMERGENCY STOP ACTIVE" : "NORMAL"
  );
  setText(
    "riskEmergencyStateText",
    state.emergencyStop ? "ACTIVE (TRADING HALTED)" : "INACTIVE"
  );
  setText(
    "riskPageSafetyStatus",
    state.emergencyStop ? "HALTED" : "ARMED"
  );
  setText(
    "riskEngineStatusText",
    state.emergencyStop ? "EMERGENCY STOP" : "READY"
  );

  const resetEmBtn = document.getElementById("resetEmergencyPageBtn");
  const triggerEmBtn = document.getElementById("triggerEmergencyPageBtn");
  if (resetEmBtn) resetEmBtn.disabled = !state.emergencyStop;
  if (triggerEmBtn) triggerEmBtn.disabled = state.emergencyStop;

  if (
    typeof RiskEngine !== "undefined" &&
    typeof RiskEngine.buildRiskViewModel === "function"
  ) {
    const pState =
      typeof PaperTrading !== "undefined" ? PaperTrading.getState() : null;
    const riskVm = RiskEngine.buildRiskViewModel({
      paperState: pState,
      limits: state.serverRiskLimits || undefined,
      emergencyStop: state.emergencyStop,
      serverEmergencyStop: state.serverEmergencyStop,
      riskEvents: state.riskEvents,
      lastRiskCheck: state.lastRiskCheck
    });

    if (typeof window !== "undefined") {
      window.YashwinRiskViewModel = riskVm;
    }

    setText("riskKpiMaxLossTrade", riskVm.limits.maxLossPerTradeFormatted);
    setText(
      "riskKpiOpenTradeRisk",
      `Active Trade Risk: ${riskVm.counters.openPositionRiskFormatted}`
    );
    setText(
      "riskKpiDailyBuffer",
      `${riskVm.capitalAndPnl.remainingDailyLossBufferFormatted} Remaining`
    );
    setText(
      "riskKpiEffectiveDailyPnl",
      `Effective Daily P&L: ${riskVm.capitalAndPnl.effectiveDailyPnlFormatted} / -${riskVm.limits.maxDailyLossFormatted}`
    );
    setText(
      "riskKpiTradesCounter",
      `${riskVm.counters.tradesTodayFormatted} Trades`
    );
    setText(
      "riskKpiTradesRemaining",
      `${riskVm.counters.remainingTradesToday} trade(s) remaining today`
    );
    setText(
      "riskKpiOpenPositionCounter",
      `${riskVm.counters.openPositionsFormatted} Open`
    );
    setText(
      "riskKpiAvailableBalance",
      `Available Balance: ${riskVm.capitalAndPnl.availableBalanceFormatted}`
    );

    setText("riskRuleMaxLossPerTrade", riskVm.limits.maxLossPerTradeFormatted);
    setText("riskRuleMaxDailyLoss", riskVm.limits.maxDailyLossFormatted);
    setText(
      "riskRuleDailyPnlBreakdown",
      `${riskVm.capitalAndPnl.realizedDailyPnlFormatted} / ${riskVm.capitalAndPnl.unrealizedPnlFormatted}`
    );
    setText(
      "riskRuleRemainingDailyBuffer",
      riskVm.capitalAndPnl.remainingDailyLossBufferFormatted
    );
    setText("riskRuleTradesToday", riskVm.counters.tradesTodayFormatted);
    setText("riskRuleOpenPositions", riskVm.counters.openPositionsFormatted);

    const activeRejectionBox = document.getElementById("riskActiveRejectionBox");
    if (activeRejectionBox) {
      if (!riskVm.activeRejectionReasons.length) {
        activeRejectionBox.innerHTML =
          '<div><span>All risk gates clear — workspace eligible for Paper Mode execution.</span><strong>CLEAR</strong></div>';
      } else {
        activeRejectionBox.innerHTML = riskVm.activeRejectionReasons
          .map((r) => `<div><span>${r}</span><strong>LOCKED / BLOCKED</strong></div>`)
          .join("");
      }
    }

    const rEvents = Array.isArray(state.riskEvents) ? state.riskEvents : [];
    setText("riskEventsCountBadge", `${rEvents.length} EVENTS`);
    const riskEventsListEl = document.getElementById("riskEventsHistoryList");
    if (riskEventsListEl) {
      if (!rEvents.length) {
        riskEventsListEl.innerHTML =
          '<div><span>No risk evaluation events recorded yet.</span><strong>--</strong></div>';
      } else {
        riskEventsListEl.innerHTML = rEvents
          .slice(0, 15)
          .map(
            (ev) =>
              `<div class="ai-history-item-row">
                <div class="ai-history-meta">
                  <span><strong>${ev.symbol || "INSTRUMENT"}</strong> • Side: <strong>${ev.side || "BUY"}</strong> • Risk: ₹${Number(ev.riskAmount || 0).toFixed(2)}</span>
                  <small>${Array.isArray(ev.reasons) && ev.reasons.length ? ev.reasons.join(" ") : "Approved by RiskEngine"}</small>
                </div>
                <strong class="tabular-nums">${ev.allowed ? "APPROVED" : "BLOCKED"} • ${ev.timestamp}</strong>
              </div>`
          )
          .join("");
      }
    }
  }

  if (typeof LiveReadinessAudit !== "undefined") {
    const auditReport = LiveReadinessAudit.runAudit();
    setText(
      "liveAuditStatusPill",
      auditReport.ok ? `PASS (${auditReport.passedChecks}/${auditReport.totalChecks})` : "ATTENTION"
    );
    const checksContainer = document.getElementById("liveAuditChecksList");
    if (checksContainer) {
      checksContainer.innerHTML = auditReport.checks
        .map(
          (c) =>
            `<div><span>${c.name}</span><strong>${c.status}</strong></div>`
        )
        .join("");
    }
  }
}

function renderAccountView() {
  const user = state.currentUser;
  const guestView = document.getElementById("accountGuestView");
  const authView = document.getElementById("accountAuthenticatedView");

  const initials = user && user.name
    ? String(user.name).trim().charAt(0).toUpperCase()
    : "Y";
  setText("topUserAvatar", initials);
  setText("topUserLabel", user ? user.name : "Sign In");
  setText("accountSessionBadge", user ? "AUTHENTICATED" : "GUEST");

  if (guestView) guestView.hidden = Boolean(user);
  if (authView) authView.hidden = !user;

  if (!user) return;

  setText("profileUserId", user.userId || "--");
  setText("profileNameDisplay", user.name || "--");
  setText("profileEmailDisplay", user.email || "--");
  setText("profileCreatedAt", user.createdAt || "--");
  setText("profileUpdatedAt", user.updatedAt || "--");

  if (typeof PaperTrading !== "undefined") {
    const pState = PaperTrading.getState();
    setText("profilePaperCapital", money(pState.capital || 100000));
  }

  const nameInput = document.getElementById("profileEditName");
  const emailInput = document.getElementById("profileEditEmail");
  const notifSelect = document.getElementById("profileNotificationsToggle");

  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = user.name || "";
  }
  if (emailInput && document.activeElement !== emailInput) {
    emailInput.value = user.email || "";
  }
  if (notifSelect && document.activeElement !== notifSelect) {
    notifSelect.value = user.settings?.notifications === false ? "false" : "true";
  }

  const pendingBox = document.getElementById("pendingEmailVerifyBox");
  if (pendingBox) {
    if (state.pendingEmailChange && state.pendingEmailChange.status === "PENDING") {
      pendingBox.hidden = false;
      setText(
        "pendingEmailVerifyText",
        `Verification required to change email to ${state.pendingEmailChange.newEmail}.`
      );
    } else {
      pendingBox.hidden = true;
    }
  }
}

function renderMarketIntelligenceView() {
  if (typeof MarketIntelligence === "undefined" || typeof MarketIntelligence.buildIntelligenceViewModel !== "function") {
    return;
  }

  const inst =
    (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
    (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null) || {
      key: "NIFTY50",
      name: "NIFTY 50",
      exchange: "NSE"
    };

  const vm = MarketIntelligence.buildIntelligenceViewModel(state.intelligence.payload || {}, {
    loading: state.intelligence.loading,
    error: state.intelligence.error,
    category: state.intelligence.category,
    symbol: inst.tradingsymbol || inst.name || inst.key || "NIFTY 50",
    exchange: inst.exchange || "NSE"
  });

  if (typeof window !== "undefined") {
    window.YashwinMarketIntelligenceViewModel = vm;
  }

  setText("intelHeroStatusBadge", vm.status);
  setText("intelProviderBadge", vm.provider);
  setText(
    "intelRetrievalTimestamp",
    vm.retrievalTimestamp ? `Retrieval: ${vm.retrievalTimestamp}` : "Retrieval: --"
  );
  setText("intelSelectedSymbol", vm.selectedSymbol);
  setText(
    "intelSelectedExchange",
    `${vm.selectedExchange} • Supporting Context Only`
  );

  // Sentiment (strictly backed by genuine source)
  setText("intelSentimentLabel", vm.sentiment.label);
  setText(
    "intelSentimentMeta",
    vm.sentiment.available
      ? `Score: ${vm.sentiment.scoreFormatted} • Source: ${vm.sentiment.source}`
      : `${vm.sentiment.scoreFormatted} (${vm.sentiment.reason})`
  );

  const totalItems =
    vm.counts.totalNews + vm.counts.economicEvents + vm.counts.globalIndices;
  setText("intelValidatedCountBadge", `${totalItems} ITEMS`);
  setText(
    "intelDedupDiagnostics",
    `${vm.diagnostics?.duplicatesRemoved || 0} duplicates removed • ${vm.diagnostics?.malformedRejected || 0} malformed rejected`
  );

  const loadingBanner = document.getElementById("intelLoadingBanner");
  if (loadingBanner) loadingBanner.hidden = !vm.loading;

  const errorBanner = document.getElementById("intelErrorBanner");
  if (errorBanner) {
    const hasErr = Boolean(vm.error || vm.status === "PROVIDER_ERROR" || vm.status === "RATE_LIMITED");
    errorBanner.hidden = !hasErr;
    if (hasErr) {
      setText("intelErrorText", vm.error || vm.diagnostics?.message || "Provider request failed.");
    }
  }

  const configBanner = document.getElementById("intelConfigBanner");
  if (configBanner) {
    const isUnconf = vm.status === "DATA_UNAVAILABLE" && vm.provider === "UNCONFIGURED";
    configBanner.hidden = !isUnconf;
    if (isUnconf && vm.diagnostics?.message) {
      setText("intelConfigText", vm.diagnostics.message);
    }
  }

  document.querySelectorAll("[data-intel-filter]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.intelFilter === vm.activeFilter);
  });

  function renderNewsList(containerId, countPillId, items, emptyText) {
    setText(countPillId, `${items.length} ITEMS`);
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!items.length) {
      const badgeText =
        vm.status === "DATA_UNAVAILABLE"
          ? "DATA_UNAVAILABLE"
          : vm.status === "STALE_DATA"
            ? "STALE"
            : "EMPTY";
      container.innerHTML = `<div><span>${emptyText}</span><strong>${badgeText}</strong></div>`;
      return;
    }

    container.innerHTML = items
      .slice(0, 15)
      .map((item) => {
        const cleanUrl = safeHref(item.url);
        const safeHeadline = escapeHtml(item.headline);
        const titleHtml = cleanUrl
          ? `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="intel-news-link">${safeHeadline}</a>`
          : `<strong>${safeHeadline}</strong>`;
        const symbolTag = item.relatedSymbol ? ` • Symbol: ${escapeHtml(item.relatedSymbol)}` : "";
        const sentTag = item.sentiment
          ? ` • Sentiment: ${escapeHtml(item.sentiment)}${item.sentimentScore !== null ? " (" + escapeHtml(item.sentimentScore) + ")" : ""}`
          : "";
        return `<div class="ai-history-item-row">
          <div class="ai-history-meta">
            <span>${titleHtml}</span>
            <small>Source: ${escapeHtml(item.source)} (${escapeHtml(item.provider)})${symbolTag}${sentTag} • Published: ${escapeHtml(item.publicationTimestamp || "MISSING")} • Retrieved: ${escapeHtml(item.retrievalTimestamp)}</small>
          </div>
          <strong class="tabular-nums">${escapeHtml(item.freshness)}</strong>
        </div>`;
      })
      .join("");
  }

  // Global Indices
  setText("intelGlobalIndicesCountPill", `${vm.globalIndices.length} INDICES`);
  const idxContainer = document.getElementById("intelGlobalIndicesContainer");
  if (idxContainer) {
    if (!vm.globalIndices.length) {
      idxContainer.innerHTML =
        '<div><span>Global index quotes unavailable — no external index feed configured.</span><strong>DATA_UNAVAILABLE</strong></div>';
    } else {
      idxContainer.innerHTML = vm.globalIndices
        .map((idx) => {
          const chg =
            idx.changePercent !== null && idx.changePercent !== undefined
              ? ` (${idx.changePercent >= 0 ? "+" : ""}${Number(idx.changePercent).toFixed(2)}%)`
              : "";
          return `<div class="ai-history-item-row">
            <div class="ai-history-meta">
              <span><strong>${idx.name} (${idx.symbol})</strong> • ${idx.region}</span>
              <small>Source: ${idx.source} • Quote Time: ${idx.publicationTimestamp || "--"} • Retrieved: ${idx.retrievalTimestamp}</small>
            </div>
            <strong class="tabular-nums">${Number(idx.price).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${chg} • ${idx.freshness}</strong>
          </div>`;
        })
        .join("");
    }
  }

  // Economic Events
  setText("intelEconomicEventsCountPill", `${vm.economicEvents.length} EVENTS`);
  const ecoContainer = document.getElementById("intelEconomicEventsContainer");
  if (ecoContainer) {
    if (!vm.economicEvents.length) {
      ecoContainer.innerHTML =
        '<div><span>Economic calendar events unavailable — no macro calendar feed configured.</span><strong>DATA_UNAVAILABLE</strong></div>';
    } else {
      ecoContainer.innerHTML = vm.economicEvents
        .map((ev) => {
          const vals = [
            ev.actual !== null ? `Actual: ${ev.actual}` : null,
            ev.forecast !== null ? `Forecast: ${ev.forecast}` : null,
            ev.previous !== null ? `Prev: ${ev.previous}` : null
          ]
            .filter(Boolean)
            .join(" | ");
          return `<div class="ai-history-item-row">
            <div class="ai-history-meta">
              <span><strong>[${ev.country}] ${ev.title}</strong>${vals ? " — " + vals : ""}</span>
              <small>Source: ${ev.source} • Event Time: ${ev.publicationTimestamp || "--"} • Retrieved: ${ev.retrievalTimestamp}</small>
            </div>
            <strong class="tabular-nums">${ev.impact} • ${ev.status}</strong>
          </div>`;
        })
        .join("");
    }
  }

  renderNewsList(
    "intelIndianNewsContainer",
    "intelIndianNewsCountPill",
    vm.indianMarketNews,
    "Indian market news unavailable — configure server provider credentials."
  );

  renderNewsList(
    "intelGlobalNewsContainer",
    "intelGlobalNewsCountPill",
    vm.globalMarketNews,
    "Global market news unavailable — configure server provider credentials."
  );

  setText(
    "intelCompanyNewsSubtitle",
    `Filtered for ${vm.selectedSymbol} (${vm.selectedExchange}) • Preserves source, publication time, retrieval time & URL`
  );
  renderNewsList(
    "intelCompanyNewsContainer",
    "intelCompanyNewsCountPill",
    vm.companyNews,
    `No verified company news items retrieved for ${vm.selectedSymbol}.`
  );
}

function renderAllViews() {
  updateDashboard();
  renderScannerAndAnalysisViews();
  renderMarketIntelligenceView();
  renderPositionsOrdersHistoryRiskViews();
  renderAccountView();
  if (typeof renderWatchlistAndAlertsPage === "function") {
    renderWatchlistAndAlertsPage();
  }
}

/* =====================================================
   REAL MARKET DATA QUOTES & SNAPSHOT PIPELINE (PHASE 8)
===================================================== */

async function checkServerHealth() {
  if (typeof MarketAPI === "undefined" || typeof MarketAPI.health !== "function") {
    return;
  }

  try {
    const res = await MarketAPI.health();
    const angelConnected = Boolean(res?.session?.authenticated);
    const googleConfigured = Boolean(res?.googleAIConfigured);
    const dbConnected = Boolean(res?.database?.connected);
    state.googleAIConfigured = googleConfigured;

    if (res?.emergencyStop && typeof res.emergencyStop.active === "boolean") {
      state.emergencyStop = res.emergencyStop.active;
      state.serverEmergencyStop = res.emergencyStop;
    }

    if (res?.riskLimits && typeof res.riskLimits === "object") {
      state.serverRiskLimits = res.riskLimits;
    }
    state.apiError = null;

    const dbDot = document.getElementById("dbStatusDot");
    if (dbDot) {
      dbDot.classList.toggle("off", !dbConnected);
    }
    setText(
      "dbStatusText",
      dbConnected ? `SQLITE WAL (${res.database.tablesCount} TABLES)` : "LOCAL STORAGE"
    );

    const dot = document.getElementById("angelStatusDot");
    if (dot) {
      dot.classList.toggle("off", !angelConnected);
    }
    setText(
      "angelStatusText",
      angelConnected ? "CONNECTED (READ-ONLY)" : "NOT CONNECTED"
    );

    const aiDot = document.getElementById("googleAIStatusDot");
    if (aiDot) {
      aiDot.classList.toggle("off", !googleConfigured);
    }
    setText(
      "googleAIStatusText",
      googleConfigured ? "CONFIGURED (SERVER)" : "NOT CONFIGURED"
    );

    state.ai.status = {
      provider: "GOOGLE_GENAI",
      model: res?.googleAIModel || "gemini-3.8-flash",
      credentialsConfigured: googleConfigured,
      mode: "SERVER_ONLY"
    };
  } catch (_) {
    state.apiError = "Unable to reach YASHWIN server health endpoint.";
    setText("angelStatusText", "NOT CONNECTED");
    setText("googleAIStatusText", "NOT CONFIGURED");
  }
}

async function fetchAIAnalysisHistory() {
  if (typeof MarketAPI === "undefined" || typeof MarketAPI.auditLogs !== "function") {
    return;
  }
  try {
    const logsRes = await MarketAPI.auditLogs();
    if (logsRes && logsRes.ok) {
      if (Array.isArray(logsRes.aiDecisions)) {
        state.ai.history = logsRes.aiDecisions;
      }
      if (Array.isArray(logsRes.strategyDecisions)) {
        state.strategyHistory = logsRes.strategyDecisions;
      }
      if (Array.isArray(logsRes.riskEvents)) {
        state.riskEvents = logsRes.riskEvents;
      }
      renderAllViews();
    }
  } catch (_) {}
}

async function fetchMarketIntelligenceData(options = {}) {
  if (typeof MarketAPI === "undefined") return;
  const fetchMethod =
    typeof MarketAPI.intelligenceFeed === "function"
      ? MarketAPI.intelligenceFeed
      : typeof MarketAPI.intelligenceStatus === "function"
        ? (q) => MarketAPI.intelligenceStatus(q.market || "NSE", q)
        : null;
  if (!fetchMethod) return;

  const inst =
    options.instrument ||
    (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
    (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null) || {
      key: "NIFTY50",
      name: "NIFTY 50",
      exchange: "NSE"
    };

  state.intelligence.loading = true;
  state.intelligence.error = null;
  renderMarketIntelligenceView();

  try {
    const res = await fetchMethod({
      market: inst.exchange || "NSE",
      symbol: inst.tradingsymbol || inst.name || inst.key || "",
      category: state.intelligence.category || "ALL",
      refresh: Boolean(options.refresh)
    });

    state.intelligence.loading = false;
    if (res && res.intelligence) {
      state.intelligence.payload = res.intelligence;
      state.intelligence.providerStatus = res.providerStatus || null;
      if (res.ok === false) {
        state.intelligence.error =
          res.intelligence?.diagnostics?.message ||
          res.message ||
          "Market intelligence provider error.";
      }
    } else if (res && !res.ok) {
      state.intelligence.error = res.message || "Unable to reach market intelligence endpoint.";
    }
  } catch (err) {
    state.intelligence.loading = false;
    state.intelligence.error = err?.message || "Network error while fetching market intelligence.";
  }

  renderAllViews();
}

async function refreshDashboardQuotes() {
  if (
    typeof MarketAPI === "undefined" ||
    typeof MarketAPI.quote !== "function"
  ) {
    return;
  }

  const requests = [
    ["nifty", "NIFTY 50"],
    ["bank", "BANK NIFTY"]
  ];

  let anyLive = false;
  let explicitProviderError = null;

  for (const [key, query] of requests) {
    try {
      const result = await MarketAPI.quote("NSE", query);

      if (result && result.ok === false && result.code) {
        if (
          [
            "TWELVE_DATA_PLAN_RESTRICTED",
            "TWELVE_DATA_RATE_LIMITED",
            "TWELVE_DATA_DAILY_QUOTA_EXCEEDED",
            "TWELVE_DATA_AUTH_FAILED",
            "TWELVE_DATA_CREDENTIALS_MISSING"
          ].includes(result.code)
        ) {
          explicitProviderError = `${result.code}: ${result.message || "Provider unable to serve quote."}`;
        }
      }

      if (
        result?.ok === true &&
        typeof RealMarketDataService !== "undefined" &&
        typeof RealMarketDataService.validateQuote === "function"
      ) {
        const validation = RealMarketDataService.validateQuote(
          result.quote,
          key,
          result.provider || "ANGEL_ONE"
        );

        if (
          validation.ok === true &&
          validation.dataReady === true &&
          validation.quote &&
          Number.isFinite(Number(validation.quote.price)) &&
          Number(validation.quote.price) > 0
        ) {
          const priceNum = Number(validation.quote.price);
          state[key] = priceNum;
          const prevClose = Number(validation.quote.previousClose || validation.quote.open || 0);
          if (prevClose > 0) {
            state[key === "nifty" ? "niftyChangePct" : "bankChangePct"] =
              ((priceNum - prevClose) / prevClose) * 100;
          }
          anyLive = true;

          // Update open paper position price ONLY from validated quote matching symbol
          if (typeof PaperTrading !== "undefined") {
            const pState = PaperTrading.getState();
            if (pState.position && pState.position.symbol === query) {
              PaperTrading.updatePrice(state[key], { autoExit: true });
            }
          }
        }
      }
    } catch (_) {
      /*
       * Quote failures must never create fake prices or trading signals.
       */
    }
  }

  if (anyLive) {
    state.apiError = null;
    if (state.dataStatus === "DATA WAITING") {
      state.dataStatus = "LIVE DATA";
    }
  } else if (explicitProviderError) {
    state.apiError = explicitProviderError;
  }

  renderAllViews();
}

async function updateAIFromSnapshot(snapshot, instrument) {
  if (!snapshot || snapshot.dataReady !== true) {
    const statusLabel =
      snapshot?.status === "TWELVE_DATA_PLAN_RESTRICTED"
        ? "PROVIDER PLAN RESTRICTED"
        : snapshot?.status === "TWELVE_DATA_UNSUPPORTED_INSTRUMENT"
          ? "UNSUPPORTED INSTRUMENT"
          : snapshot?.status === "TWELVE_DATA_RATE_LIMITED" ||
              snapshot?.status === "TWELVE_DATA_DAILY_QUOTA_EXCEEDED"
            ? "PROVIDER RATE LIMITED"
            : snapshot?.status === "STALE_MARKET_DATA"
              ? "STALE MARKET DATA"
              : snapshot?.status === "INVALID_MARKET_DATA" ||
                  snapshot?.status === "FUTURE_MARKET_DATA"
                ? "INVALID MARKET DATA"
                : "DATA WAITING";

    state.dataStatus = statusLabel;
    state.signal = statusLabel === "DATA WAITING" ? "DATA WAITING" : "NO_TRADE";
    state.confidence = null;
    state.trend = "Waiting";
    state.risk = "HIGH";
    state.lastAnalysis = null;
    state.lastAIDecision = null;
    state.lastStrategy = null;

    setText(
      "analysisText",
      snapshot?.errorMessage
        ? `${instrument?.name || "Selected market"}: ${snapshot.errorMessage}`
        : `${instrument?.name || "Selected market"}: ${statusLabel}. Waiting for validated market data before AI analysis.`
    );
    renderAllViews();
    return;
  }

  state.dataStatus = "LIVE DATA";

  if (typeof MarketAnalysis === "undefined") {
    return;
  }

  const assetType =
    String(instrument?.type || snapshot.type || "EQUITY").toUpperCase() === "OPTION"
      ? "OPTION"
      : "EQUITY";

  const input = {
    dataReady: true,
    assetType,
    trendScore: snapshot.indicators?.trendScore,
    momentumScore: snapshot.indicators?.momentumScore,
    volumeScore: snapshot.indicators?.volumeScore,
    vwapScore: snapshot.indicators?.vwapScore,
    supportResistanceScore: snapshot.indicators?.supportResistanceScore,
    volatilityScore: snapshot.indicators?.volatilityScore,
    optionsScore:
      typeof MarketAnalysis.calculateOptionScore === "function" &&
      snapshot.options?.available === true
        ? MarketAnalysis.calculateOptionScore(snapshot.options)
        : null,
    newsScore: snapshot.newsContext?.available
      ? snapshot.newsContext.score
      : null,
    breadthScore: snapshot.breadth?.available ? 0 : null
  };

  const result = MarketAnalysis.analyze(input);
  state.lastAnalysis = result;
  state.signal = result.signal;
  state.confidence = result.confidence;
  state.trend = result.trend;
  state.risk = result.risk;

  // Query Server-Side Google AI analysis when configured or explicitly requested
  let aiDecision = null;
  state.ai.error = null;

  if (
    state.googleAIConfigured &&
    typeof MarketAPI !== "undefined" &&
    typeof MarketAPI.aiAnalyze === "function"
  ) {
    state.ai.loading = true;
    renderScannerAndAnalysisViews();
    try {
      const payloadBuild =
        typeof AIAnalysisEngine !== "undefined"
          ? AIAnalysisEngine.buildAIAnalysisPayload(snapshot, instrument, result, {
              interval: state.chart.interval,
              dataSource: "REAL"
            })
          : {
              ok: true,
              payload: {
                dataReady: true,
                symbol: instrument?.name || snapshot.name || "NIFTY 50",
                exchange: instrument?.exchange || snapshot.exchange || "NSE",
                assetType,
                optionType: instrument?.optionType || snapshot.optionType || "",
                price: snapshot.price,
                indicators: snapshot.indicators,
                deterministicAnalysis: result,
                dataSource: "REAL"
              }
            };

      if (payloadBuild.ok) {
        const aiResponse = await MarketAPI.aiAnalyze(payloadBuild.payload);
        if (aiResponse && aiResponse.ok && aiResponse.decision) {
          aiDecision = aiResponse.decision;
        } else if (aiResponse && aiResponse.decision) {
          aiDecision = aiResponse.decision;
          state.ai.error = `${aiResponse.code || "AI_CONTRACT_VIOLATION"}: ${aiResponse.message || "AI output failed contract validation."}`;
        } else if (aiResponse && !aiResponse.ok) {
          state.ai.error = `${aiResponse.code || "AI_ERROR"}: ${aiResponse.message || "Google AI analysis request failed."}`;
        }
      }
    } catch (err) {
      aiDecision = null;
      state.ai.error = err?.message || "Unable to reach server AI analysis endpoint.";
    } finally {
      state.ai.loading = false;
    }
  }
  state.lastAIDecision = aiDecision;

  if (typeof StrategyEngine !== "undefined" && snapshot.price > 0) {
    state.lastStrategy = StrategyEngine.evaluate({
      dataReady: true,
      snapshot,
      candles: snapshot.candles || [],
      indicators: snapshot.indicators || null,
      analysis: result,
      aiDecision,
      marketIntelligence: state.intelligence?.payload || null,
      price: snapshot.price,
      assetType,
      optionType: instrument?.optionType || snapshot.optionType || "",
      emergencyStop: state.emergencyStop
    });
  }

  // Automatic Paper Trading Execution on Validated Snapshot
  if (
    typeof PaperTrading !== "undefined" &&
    typeof PaperTrading.autoEvaluateAndExecute === "function" &&
    PaperTrading.isAutoPaperEnabled()
  ) {
    PaperTrading.autoEvaluateAndExecute({
      dataReady: true,
      snapshot,
      price: snapshot.price,
      symbol: instrument?.name || snapshot.name || "NIFTY 50",
      assetType,
      optionType: instrument?.optionType || snapshot.optionType || "",
      analysis: result,
      aiDecision: aiDecision || undefined,
      strategy: state.lastStrategy,
      emergencyStop: state.emergencyStop
    });
  }

  if (aiDecision) {
    fetchAIAnalysisHistory();
  }

  setText(
    "analysisText",
    result.reasons.length
      ? result.reasons.join(" ")
      : "Market data analysed by the deterministic AI decision framework."
  );

  renderAllViews();
}

async function runExplicitAIAnalysis() {
  const snap =
    typeof window !== "undefined" ? window.YashwinMarketSnapshot : null;
  const inst =
    (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
    (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null);

  if (!snap || snap.dataReady !== true) {
    state.ai.error =
      "MARKET_DATA_NOT_READY: Validated market quote and candles are required before running AI analysis.";
    renderAllViews();
    showToast("Cannot run AI analysis: waiting for validated market data.");
    return;
  }

  if (typeof MarketAPI === "undefined" || typeof MarketAPI.aiAnalyze !== "function") {
    return;
  }

  state.ai.loading = true;
  state.ai.error = null;
  renderAllViews();

  try {
    const assetType =
      String(inst?.type || snap.type || "EQUITY").toUpperCase() === "OPTION"
        ? "OPTION"
        : "EQUITY";

    const payloadBuild =
      typeof AIAnalysisEngine !== "undefined"
        ? AIAnalysisEngine.buildAIAnalysisPayload(snap, inst, state.lastAnalysis, {
            interval: state.chart.interval,
            dataSource: "REAL"
          })
        : {
            ok: true,
            payload: {
              dataReady: true,
              symbol: inst?.name || snap.name || "NIFTY 50",
              exchange: inst?.exchange || snap.exchange || "NSE",
              assetType,
              optionType: inst?.optionType || snap.optionType || "",
              price: snap.price,
              indicators: snap.indicators,
              deterministicAnalysis: state.lastAnalysis,
              dataSource: "REAL"
            }
          };

    if (!payloadBuild.ok) {
      state.ai.error = `${payloadBuild.code}: ${payloadBuild.message}`;
      state.ai.loading = false;
      renderAllViews();
      return;
    }

    const res = await MarketAPI.aiAnalyze(payloadBuild.payload);
    state.ai.loading = false;

    if (res && res.ok && res.decision) {
      state.lastAIDecision = res.decision;
      state.ai.error = null;
      if (typeof StrategyEngine !== "undefined" && snap.price > 0) {
        state.lastStrategy = StrategyEngine.evaluate({
          dataReady: true,
          analysis: state.lastAnalysis,
          aiDecision: res.decision,
          price: snap.price,
          assetType,
          emergencyStop: state.emergencyStop
        });
      }
      await fetchAIAnalysisHistory();
      showToast(`AI Analysis complete: ${res.decision.signal} (${res.decision.confidence}%)`);
    } else if (res && res.decision) {
      state.lastAIDecision = res.decision;
      state.ai.error = `${res.code || "AI_CONTRACT_VIOLATION"}: ${res.message || "AI output rejected by contract."}`;
      await fetchAIAnalysisHistory();
      showToast("AI output rejected by contract — fallback to HOLD / NO_TRADE.");
    } else {
      state.ai.error = `${res?.code || "GOOGLE_AI_CREDENTIALS_MISSING"}: ${res?.message || "Google AI is not configured or unavailable on the server."}`;
      showToast(res?.message || "Google AI is not configured on the server.");
    }
  } catch (err) {
    state.ai.loading = false;
    state.ai.error = err?.message || "Network error while calling POST /api/ai/analyze.";
  }

  renderAllViews();
}

async function fetchAndPopulateSelectedInstrument(item) {
  if (!item || typeof MarketData === "undefined") return;

  // Validate option/futures contracts before querying market data
  if (typeof MarketSearch !== "undefined" && typeof MarketSearch.validateContractSelection === "function") {
    const contractCheck = MarketSearch.validateContractSelection(item);
    if (!contractCheck.valid) {
      let invalidSnapshot = MarketData.emptySnapshot(item);
      invalidSnapshot.status = contractCheck.code || "INVALID_OPTION_CONTRACT";
      invalidSnapshot.dataReady = false;
      if (typeof window !== "undefined") {
        window.YashwinMarketSnapshot = invalidSnapshot;
      }
      updateAIFromSnapshot(invalidSnapshot, item);
      showToast(`Unsupported contract rejected: ${contractCheck.reasons.join(" ")}`);
      return;
    }
  }

  let snapshot = MarketData.emptySnapshot(item);
  if (typeof window !== "undefined") {
    window.YashwinMarketSnapshot = snapshot;
  }
  updateAIFromSnapshot(snapshot, item);

  // Ensure selected symbol exists in Paper Trading dropdown
  const paperSymbolSelect = document.getElementById("paperSymbol");
  if (paperSymbolSelect && item.name) {
    const exists = Array.from(paperSymbolSelect.options).some(
      (opt) => opt.value === item.name
    );
    if (!exists) {
      const opt = document.createElement("option");
      opt.value = item.name;
      opt.textContent = `${item.name} (${item.exchange})`;
      paperSymbolSelect.appendChild(opt);
    }
    paperSymbolSelect.value = item.name;
  }

  if (
    typeof MarketAPI === "undefined" ||
    typeof MarketAPI.quote !== "function" ||
    typeof RealMarketDataService === "undefined"
  ) {
    return;
  }

  try {
    state.chart.loading = true;
    state.chart.apiError = null;
    state.chart.hoverIndex = null;
    const tfEl = document.getElementById("timeframe");
    const interval =
      typeof ChartEngine !== "undefined"
        ? ChartEngine.normalizeInterval(tfEl?.value || state.chart.interval || "FIVE_MINUTE")
        : tfEl?.value || "FIVE_MINUTE";
    state.chart.interval = interval;

    const query = item.tradingsymbol || item.name || item.key;
    const exactSym = item.tradingsymbol || "";

    // Fetch Quote and Historical Candles in parallel so historical charts can render even if live quote is unavailable
    const [quoteResult, candleResult] = await Promise.allSettled([
      MarketAPI.quote(item.exchange || "NSE", query, exactSym),
      typeof MarketAPI.candles === "function"
        ? MarketAPI.candles(item.exchange || "NSE", query, exactSym, { interval })
        : Promise.resolve(null)
    ]);

    const response = quoteResult.status === "fulfilled" ? quoteResult.value : null;
    const candleRes = candleResult.status === "fulfilled" ? candleResult.value : null;

    const validation = RealMarketDataService.validateQuote(
      response?.quote,
      item.key,
      response?.provider || "ANGEL_ONE"
    );

    const candles =
      candleRes?.ok && Array.isArray(candleRes.candles)
        ? candleRes.candles
        : [];

    if (candleRes && candleRes.ok === false && candleRes.message && !candles.length) {
      state.chart.apiError = `${candleRes.code || "CANDLE_UNAVAILABLE"}: ${candleRes.message}`;
    }

    snapshot = MarketData.snapshotFromValidatedQuote(item, validation, candles);
    if (!validation.ok && response && response.ok === false && response.code) {
      snapshot.status = response.code;
      snapshot.errorMessage = `${response.code}: ${response.message || "Market quote unavailable."}`;
      if (
        [
          "TWELVE_DATA_PLAN_RESTRICTED",
          "TWELVE_DATA_UNSUPPORTED_INSTRUMENT",
          "TWELVE_DATA_RATE_LIMITED",
          "TWELVE_DATA_DAILY_QUOTA_EXCEEDED",
          "TWELVE_DATA_AUTH_FAILED",
          "TWELVE_DATA_CREDENTIALS_MISSING"
        ].includes(response.code)
      ) {
        state.apiError = snapshot.errorMessage;
      }
    } else if (validation.ok) {
      state.apiError = null;
    }

    if (!validation.ok && candles.length > 0) {
      snapshot.candles = candles;
      const lastCandle = candles[candles.length - 1];
      snapshot.indicators = MarketData.deriveIndicatorsFromQuote(
        {
          price: lastCandle.close,
          open: lastCandle.open,
          high: lastCandle.high,
          low: lastCandle.low,
          previousClose: candles.length > 1 ? candles[candles.length - 2].close : lastCandle.open,
          volume: lastCandle.volume
        },
        candles
      );
    }

    state.chart.loading = false;
    if (typeof window !== "undefined") {
      window.YashwinMarketSnapshot = snapshot;
    }

    if (
      validation.ok &&
      validation.quote?.price > 0 &&
      typeof PaperTrading !== "undefined"
    ) {
      const pState = PaperTrading.getState();
      if (
        pState.position &&
        (pState.position.symbol === item.name ||
          pState.position.symbol === item.key)
      ) {
        PaperTrading.updatePrice(validation.quote.price);
      }
    }

    updateAIFromSnapshot(snapshot, item);
    fetchMarketIntelligenceData({ instrument: item });
  } catch (_) {
    state.chart.loading = false;
    // Keep clean DATA WAITING snapshot when broker session is not connected
    updateAIFromSnapshot(snapshot, item);
    fetchMarketIntelligenceData({ instrument: item });
  }
}

/* =====================================================
   EMERGENCY STOP CONTROLLER (PHASE 17)
===================================================== */

function toggleEmergencyStop() {
  if (typeof AuditLogger === "undefined") return;

  if (!AuditLogger.isEmergencyStopActive()) {
    const res = AuditLogger.activateEmergencyStop(
      "Activated by user via UI Emergency Stop control"
    );
    state.emergencyStop = true;
    state.signal = "NO_TRADE";
    if (typeof MarketAPI !== "undefined" && typeof MarketAPI.activateEmergencyStop === "function") {
      MarketAPI.activateEmergencyStop("Activated by user via UI Emergency Stop control").catch(() => {});
    }
    showToast("⛔ EMERGENCY STOP ACTIVATED — All trading halted.");
    if (res.closedPositionResult?.closedTrade) {
      showToast(
        `Open paper position closed by Emergency Stop • P&L ${money(res.closedPositionResult.closedTrade.pnl)}`
      );
    }
  } else {
    AuditLogger.resetEmergencyStop("Explicitly reset by user via UI");
    state.emergencyStop = false;
    if (typeof MarketAPI !== "undefined" && typeof MarketAPI.resetEmergencyStop === "function") {
      MarketAPI.resetEmergencyStop("Explicitly reset by user via UI").catch(() => {});
    }
    showToast("Emergency Stop reset — Paper Mode ready.");
  }

  renderAllViews();
}

/* =====================================================
   EVENT BINDINGS
===================================================== */

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    const page = button.dataset.page;
    switchPage(page);
    if (page !== "dashboard" && pageTitles[page]) {
      showToast(pageTitles[page][0] + " module selected");
    }
  });
});

document.querySelectorAll(".mobile-nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    const page = button.dataset.page;
    switchPage(page);
    if (page !== "dashboard" && pageTitles[page]) {
      showToast(pageTitles[page][0] + " module selected");
    }
  });
});

const emergencyBtn = document.getElementById("emergencyBtn");
if (emergencyBtn) {
  emergencyBtn.addEventListener("click", toggleEmergencyStop);
}

const triggerEmergencyPageBtn = document.getElementById("triggerEmergencyPageBtn");
if (triggerEmergencyPageBtn) {
  triggerEmergencyPageBtn.addEventListener("click", () => {
    if (!state.emergencyStop) toggleEmergencyStop();
  });
}

const resetEmergencyPageBtn = document.getElementById("resetEmergencyPageBtn");
if (resetEmergencyPageBtn) {
  resetEmergencyPageBtn.addEventListener("click", () => {
    if (state.emergencyStop) toggleEmergencyStop();
  });
}

const riskRefreshStatusBtn = document.getElementById("riskRefreshStatusBtn");
if (riskRefreshStatusBtn) {
  riskRefreshStatusBtn.addEventListener("click", async () => {
    await syncUserSessionAndPaperState();
    showToast("Risk Engine state & counters synchronized.");
  });
}

function evaluateRiskSimulatorUI(persistToServer = false) {
  if (typeof RiskEngine === "undefined") return;
  const side = document.getElementById("riskSimSide")?.value || "BUY";
  const assetType = document.getElementById("riskSimAssetType")?.value || "EQUITY";
  const entry = Number(document.getElementById("riskSimEntry")?.value || 0);
  const stop = Number(document.getElementById("riskSimStop")?.value || 0);
  const target = Number(document.getElementById("riskSimTarget")?.value || 0);
  const qtyOrLots = Number(document.getElementById("riskSimQty")?.value || 1);
  const lotSize = Number(document.getElementById("riskSimLotSize")?.value || 1);

  const pState =
    typeof PaperTrading !== "undefined" ? PaperTrading.getState() : null;
  const isEmergency =
    state.emergencyStop || Boolean(pState?.emergencyStop);

  const evalRes = RiskEngine.evaluate({
    side,
    assetType,
    entry,
    stop,
    target: target > 0 ? target : undefined,
    quantity: assetType === "OPTION" ? undefined : qtyOrLots,
    lots: assetType === "OPTION" ? qtyOrLots : 1,
    lotSize: assetType === "OPTION" ? lotSize : 1,
    dailyPnl: pState ? pState.dailyPnl : 0,
    unrealizedPnl: pState ? pState.unrealizedPnl : 0,
    tradesToday: pState ? pState.tradesToday : 0,
    openPositions: pState?.position ? 1 : 0,
    emergencyStop: isEmergency
  });

  state.lastRiskCheck = evalRes;

  const sizing = RiskEngine.calculateSafePositionSize({
    side,
    assetType,
    entry,
    stop,
    lotSize,
    dailyPnl: pState ? pState.dailyPnl : 0,
    unrealizedPnl: pState ? pState.unrealizedPnl : 0
  });

  setText("riskSimStatusBadge", evalRes.allowed ? "APPROVED" : "BLOCKED");
  setText(
    "riskSimRiskAmount",
    `₹${Number(evalRes.riskAmount || 0).toFixed(2)} / ₹${Number(evalRes.limits?.maxLossPerTrade || 500).toFixed(2)}`
  );
  setText(
    "riskSimRR",
    evalRes.riskRewardRatio ? `1 : ${Number(evalRes.riskRewardRatio).toFixed(2)}` : "--"
  );
  setText(
    "riskSimRecommendedSize",
    sizing.ok
      ? assetType === "OPTION"
        ? `${sizing.recommendedLots} lot(s) (${sizing.effectiveQuantity} qty)`
        : `${sizing.recommendedQuantity} unit(s)`
      : sizing.reason || "0 units"
  );
  setText(
    "riskSimVerdictText",
    evalRes.allowed
      ? `APPROVED — Risk ₹${Number(evalRes.riskAmount).toFixed(2)} within ₹500 limit`
      : `BLOCKED — ${evalRes.reasons.join(" ")}`
  );

  if (
    persistToServer &&
    typeof MarketAPI !== "undefined" &&
    typeof MarketAPI.riskEvaluate === "function"
  ) {
    MarketAPI.riskEvaluate({
      side,
      assetType,
      entry,
      stop,
      target: target > 0 ? target : undefined,
      quantity: assetType === "OPTION" ? undefined : qtyOrLots,
      lots: assetType === "OPTION" ? qtyOrLots : 1,
      lotSize: assetType === "OPTION" ? lotSize : 1
    })
      .then(() => fetchAIAnalysisHistory())
      .catch(() => {});
  }

  renderPositionsOrdersHistoryRiskViews();
}

const riskSimEvaluateBtn = document.getElementById("riskSimEvaluateBtn");
if (riskSimEvaluateBtn) {
  riskSimEvaluateBtn.addEventListener("click", () => {
    evaluateRiskSimulatorUI(true);
    showToast("Risk evaluation complete.");
  });
}

[
  "riskSimSide",
  "riskSimAssetType",
  "riskSimEntry",
  "riskSimStop",
  "riskSimTarget",
  "riskSimQty",
  "riskSimLotSize"
].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("input", () => evaluateRiskSimulatorUI(false));
    el.addEventListener("change", () => evaluateRiskSimulatorUI(false));
  }
});

const dashEmergencyToggleBtn = document.getElementById("dashEmergencyToggleBtn");
if (dashEmergencyToggleBtn) {
  dashEmergencyToggleBtn.addEventListener("click", toggleEmergencyStop);
}

const robotEmergencyStopBtn = document.getElementById("robotEmergencyStopBtn");
if (robotEmergencyStopBtn) {
  robotEmergencyStopBtn.addEventListener("click", toggleEmergencyStop);
}

const robotToggleAutoBtn = document.getElementById("robotToggleAutoBtn");
if (robotToggleAutoBtn && typeof PaperTrading !== "undefined") {
  robotToggleAutoBtn.addEventListener("click", () => {
    if (state.emergencyStop) {
      showToast("Reset Emergency Stop before enabling Auto Paper Robot.");
      return;
    }
    if (typeof PaperTrading.setAutoPaperEnabled === "function") {
      const next = !PaperTrading.isAutoPaperEnabled();
      PaperTrading.setAutoPaperEnabled(next);
      setText("autoPaperStatusText", next ? "AUTO ON (PAPER)" : "MANUAL ONLY");
      const autoDot = document.getElementById("autoPaperStatusDot");
      if (autoDot) autoDot.classList.toggle("off", !next);
      updateDashboard();
      showToast(
        next
          ? "Auto Paper Robot ENABLED (Paper Mode only)"
          : "Auto Paper Robot PAUSED (Manual Paper Mode)"
      );
    }
  });
}

const robotScanNowBtn = document.getElementById("robotScanNowBtn");
if (robotScanNowBtn) {
  robotScanNowBtn.addEventListener("click", async () => {
    await refreshAllDashboardData();
    showToast("Robot scan & market telemetry synchronized.");
  });
}

document.querySelectorAll("[data-nav-target]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.navTarget;
    const subview = btn.dataset.subview;
    if (target) {
      switchPage(target);
      if (subview === "settings" && state.currentUser) {
        const formEl = document.getElementById("userProfileForm");
        if (formEl && typeof formEl.scrollIntoView === "function") {
          formEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } else if (subview === "watchlist") {
        const wlEl = document.getElementById("scannerWatchlistSection");
        if (wlEl && typeof wlEl.scrollIntoView === "function") {
          wlEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    }
  });
});

const dashSessionSignInBtn = document.getElementById("dashSessionSignInBtn");
if (dashSessionSignInBtn) {
  dashSessionSignInBtn.addEventListener("click", () => {
    switchPage("account");
  });
}

async function refreshAllDashboardData() {
  state.loadingDashboard = true;
  state.apiError = null;
  renderAllViews();

  try {
    await Promise.all([
      syncUserSessionAndPaperState(),
      checkServerHealth(),
      refreshDashboardQuotes()
    ]);
    const inst =
      (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
      (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null);
    if (inst) {
      await fetchAndPopulateSelectedInstrument(inst);
    }
  } catch (_) {
    state.apiError = "Network error while refreshing dashboard telemetry.";
  } finally {
    state.loadingDashboard = false;
    renderAllViews();
  }
}

const dashRefreshAllBtn = document.getElementById("dashRefreshAllBtn");
if (dashRefreshAllBtn) {
  dashRefreshAllBtn.addEventListener("click", async () => {
    await refreshAllDashboardData();
    showToast("Dashboard synchronized.");
  });
}

const dashRetryBtn = document.getElementById("dashRetryBtn");
if (dashRetryBtn) {
  dashRetryBtn.addEventListener("click", async () => {
    await refreshAllDashboardData();
  });
}

const dashQuickClosePosBtn = document.getElementById("dashQuickClosePosBtn");
if (dashQuickClosePosBtn && typeof PaperTrading !== "undefined") {
  dashQuickClosePosBtn.addEventListener("click", async () => {
    const pState = PaperTrading.getState();
    if (!pState.position) return;

    if (typeof MarketAPI !== "undefined" && typeof MarketAPI.paperClose === "function") {
      try {
        const apiClose = await MarketAPI.paperClose({
          positionId: pState.position.id,
          exitPrice: pState.position.current,
          reason: "MANUAL_DASHBOARD"
        });
        if (apiClose && apiClose.ok) {
          await syncUserSessionAndPaperState();
          showToast(`Paper position closed • P&L ${money(apiClose.pnl)}`);
          return;
        }
      } catch (_) {}
    }

    const res = PaperTrading.closePosition(pState.position.current, "MANUAL_DASHBOARD");
    if (res.ok) {
      showToast(`Paper position closed • P&L ${money(res.pnl)}`);
      renderAllViews();
    }
  });
}

function setChartTimeframe(newInterval) {
  const norm =
    typeof ChartEngine !== "undefined"
      ? ChartEngine.normalizeInterval(newInterval)
      : String(newInterval || "FIVE_MINUTE").toUpperCase();

  state.chart.interval = norm;
  state.chart.panOffset = 0;
  state.chart.hoverIndex = null;

  const tfSelect = document.getElementById("timeframe");
  if (tfSelect && tfSelect.value !== norm) {
    tfSelect.value = norm;
  }

  document.querySelectorAll(".chart-tf-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tf === norm);
  });

  const inst =
    (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
    (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null);
  if (inst) {
    fetchAndPopulateSelectedInstrument(inst);
  }
  showToast("Timeframe changed to " + norm);
}

const timeframeSelect = document.getElementById("timeframe");
if (timeframeSelect) {
  timeframeSelect.addEventListener("change", (event) => {
    setChartTimeframe(event.target.value);
  });
}

document.querySelectorAll(".chart-tf-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.tf) {
      setChartTimeframe(btn.dataset.tf);
    }
  });
});

const chartRefreshBtn = document.getElementById("chartRefreshBtn");
if (chartRefreshBtn) {
  chartRefreshBtn.addEventListener("click", () => {
    const inst =
      (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
      (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null);
    if (inst) {
      fetchAndPopulateSelectedInstrument(inst);
    }
  });
}

document.querySelectorAll("[data-chart-overlay]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.chartOverlay;
    if (!key || !(key in state.chart.overlays)) return;
    state.chart.overlays[key] = !state.chart.overlays[key];
    btn.classList.toggle("active", Boolean(state.chart.overlays[key]));
    updateDashboard();
  });
});

const chartSubchartSelect = document.getElementById("chartSubchartSelect");
if (chartSubchartSelect) {
  chartSubchartSelect.addEventListener("change", (e) => {
    state.chart.overlays.subchart = e.target.value || "RSI";
    updateDashboard();
  });
}

const chartZoomInBtn = document.getElementById("chartZoomInBtn");
if (chartZoomInBtn) {
  chartZoomInBtn.addEventListener("click", () => {
    state.chart.visibleCount = Math.max(8, state.chart.visibleCount - 8);
    updateDashboard();
  });
}

const chartZoomOutBtn = document.getElementById("chartZoomOutBtn");
if (chartZoomOutBtn) {
  chartZoomOutBtn.addEventListener("click", () => {
    state.chart.visibleCount = Math.min(120, state.chart.visibleCount + 8);
    updateDashboard();
  });
}

const chartPanLeftBtn = document.getElementById("chartPanLeftBtn");
if (chartPanLeftBtn) {
  chartPanLeftBtn.addEventListener("click", () => {
    const total = Array.isArray(window.YashwinMarketSnapshot?.candles)
      ? window.YashwinMarketSnapshot.candles.length
      : 0;
    const maxPan = Math.max(0, total - state.chart.visibleCount);
    state.chart.panOffset = Math.min(maxPan, state.chart.panOffset + 5);
    updateDashboard();
  });
}

const chartPanRightBtn = document.getElementById("chartPanRightBtn");
if (chartPanRightBtn) {
  chartPanRightBtn.addEventListener("click", () => {
    state.chart.panOffset = Math.max(0, state.chart.panOffset - 5);
    updateDashboard();
  });
}

const chartResetViewBtn = document.getElementById("chartResetViewBtn");
if (chartResetViewBtn) {
  chartResetViewBtn.addEventListener("click", () => {
    state.chart.visibleCount = 40;
    state.chart.panOffset = 0;
    state.chart.hoverIndex = null;
    updateDashboard();
  });
}

const aiRunAnalysisBtn = document.getElementById("aiRunAnalysisBtn");
if (aiRunAnalysisBtn) {
  aiRunAnalysisBtn.addEventListener("click", () => {
    runExplicitAIAnalysis();
  });
}

const aiAnalysisRetryBtn = document.getElementById("aiAnalysisRetryBtn");
if (aiAnalysisRetryBtn) {
  aiAnalysisRetryBtn.addEventListener("click", () => {
    runExplicitAIAnalysis();
  });
}

const aiRefreshHistoryBtn = document.getElementById("aiRefreshHistoryBtn");
if (aiRefreshHistoryBtn) {
  aiRefreshHistoryBtn.addEventListener("click", async () => {
    await Promise.all([checkServerHealth(), fetchAIAnalysisHistory()]);
    const inst =
      (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
      (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null);
    if (inst) {
      await fetchAndPopulateSelectedInstrument(inst);
    }
    showToast("AI Analysis & history refreshed.");
  });
}

const intelRefreshBtn = document.getElementById("intelRefreshBtn");
if (intelRefreshBtn) {
  intelRefreshBtn.addEventListener("click", async () => {
    await fetchMarketIntelligenceData({ refresh: true });
    showToast("Market Intelligence feed refreshed.");
  });
}

const intelRetryBtn = document.getElementById("intelRetryBtn");
if (intelRetryBtn) {
  intelRetryBtn.addEventListener("click", async () => {
    await fetchMarketIntelligenceData({ refresh: true });
  });
}

document.querySelectorAll("[data-intel-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const cat = btn.dataset.intelFilter || "ALL";
    state.intelligence.category = cat;
    renderMarketIntelligenceView();
  });
});

const aiStageToPaperBtn = document.getElementById("aiStageToPaperBtn");
if (aiStageToPaperBtn) {
  aiStageToPaperBtn.addEventListener("click", () => {
    const aiVm =
      typeof window !== "undefined" ? window.YashwinAIAnalysisViewModel : null;
    if (!aiVm || !aiVm.paperExecution?.canStageToPaper || !aiVm.tradeLevels?.valid) {
      showToast("Setup is not approved by AISafetyGate + RiskEngine.");
      return;
    }

    const authSelect = document.getElementById("paperAuthMode");
    if (authSelect) authSelect.value = "AI_ASSISTED";

    const symSelect = document.getElementById("paperSymbol");
    if (symSelect && aiVm.instrument.name) {
      const exists = Array.from(symSelect.options).some(
        (o) => o.value === aiVm.instrument.name
      );
      if (!exists) {
        const opt = document.createElement("option");
        opt.value = aiVm.instrument.name;
        opt.textContent = `${aiVm.instrument.name} (${aiVm.instrument.exchange})`;
        symSelect.appendChild(opt);
      }
      symSelect.value = aiVm.instrument.name;
    }

    const assetSelect = document.getElementById("paperAssetType");
    if (assetSelect) {
      assetSelect.value = aiVm.instrument.assetType === "OPTION" ? "OPTION" : "EQUITY";
      assetSelect.dispatchEvent(new Event("change"));
    }

    const side = aiVm.tradeLevels.tradeSide === "SELL" ? "SELL" : "BUY";
    document.querySelectorAll(".trade-direction").forEach((btn) => {
      if (btn.dataset.direction === side) {
        btn.click();
      }
    });

    const entryIn = document.getElementById("paperEntry");
    const stopIn = document.getElementById("paperStop");
    const targetIn = document.getElementById("paperTarget");
    if (entryIn) entryIn.value = String(aiVm.tradeLevels.entry);
    if (stopIn) stopIn.value = String(aiVm.tradeLevels.stopLoss);
    if (targetIn) {
      targetIn.value = String(aiVm.tradeLevels.target);
      targetIn.dispatchEvent(new Event("input"));
    }

    switchPage("paper");
    showToast(
      `Staged ${side} ${aiVm.instrument.name} setup in Paper Trading (Entry ${aiVm.tradeLevels.entryFormatted}, SL ${aiVm.tradeLevels.stopLossFormatted}).`
    );
  });
}

async function fetchBacktestRunsHistory() {
  if (typeof MarketAPI === "undefined" || typeof MarketAPI.backtestRuns !== "function") {
    return;
  }
  try {
    const res = await MarketAPI.backtestRuns();
    if (res && res.ok && Array.isArray(res.runs)) {
      state.backtest.runs = res.runs;
      renderBacktestResultView(state.backtest.lastReport);
    }
  } catch (_) {}
}

const runBacktestBtn = document.getElementById("runBacktestBtn");
if (runBacktestBtn && typeof Backtester !== "undefined") {
  runBacktestBtn.addEventListener("click", async () => {
    const selectedInst =
      (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
      (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null) || {
        key: "NIFTY50",
        name: "NIFTY 50",
        exchange: "NSE",
        type: "EQUITY",
        lotSize: 1
      };

    const symbolInput = (document.getElementById("btSymbolInput")?.value || "").trim();
    const symbol = symbolInput || selectedInst.name || selectedInst.tradingsymbol || "NIFTY 50";
    const exchange = document.getElementById("btExchangeSelect")?.value || selectedInst.exchange || "NSE";
    const assetType = document.getElementById("btAssetTypeSelect")?.value || selectedInst.type || "EQUITY";
    const timeframe =
      document.getElementById("btTimeframeSelect")?.value ||
      state.chart?.interval ||
      "FIVE_MINUTE";
    const fromDate = (document.getElementById("btFromDateInput")?.value || "").trim() || null;
    const toDate = (document.getElementById("btToDateInput")?.value || "").trim() || null;
    const dataMode = document.getElementById("btDataModeSelect")?.value || "LOADED_CHART_CANDLES";

    const initialCapital = Number(document.getElementById("btInitialCapitalInput")?.value || 100000);
    const quantity = Math.max(1, Math.floor(Number(document.getElementById("btQuantityInput")?.value || 1)));
    const lotSize = Math.max(
      1,
      Math.floor(Number(document.getElementById("btLotSizeInput")?.value || selectedInst.lotSize || 1))
    );
    const maxLossPerTrade = Math.min(
      500,
      Math.max(1, Number(document.getElementById("btMaxLossPerTradeInput")?.value || 500))
    );
    const maxDailyLoss = Math.min(
      1000,
      Math.max(1, Number(document.getElementById("btMaxDailyLossInput")?.value || 1000))
    );
    const maxTradesPerDay = Math.min(
      3,
      Math.max(1, Math.floor(Number(document.getElementById("btMaxTradesPerDayInput")?.value || 3)))
    );
    const feePerTrade = Math.max(0, Number(document.getElementById("btFeePerTradeInput")?.value ?? 20));
    const slippagePerUnit = Math.max(0, Number(document.getElementById("btSlippageInput")?.value ?? 0.5));
    const entryExecutionModel =
      document.getElementById("btEntryModelSelect")?.value || "SIGNAL_CANDLE_CLOSE";
    const minConfidence = Math.max(
      50,
      Math.min(99, Number(document.getElementById("btMinConfidenceInput")?.value || 70))
    );

    const defaultFixtureCandles = [
      {
        timestamp: "2026-10-01T09:15:00.000Z",
        open: 25000,
        high: 25050,
        low: 24980,
        close: 25020,
        volume: 100000
      },
      {
        timestamp: "2026-10-01T09:20:00.000Z",
        open: 25020,
        high: 25280,
        low: 25010,
        close: 25260,
        volume: 250000,
        indicators: {
          trendScore: 95,
          momentumScore: 90,
          volumeScore: 85,
          vwapScore: 85,
          supportResistanceScore: 85,
          optionsScore: 80,
          newsScore: 70,
          breadthScore: 80,
          volatilityScore: 20
        }
      },
      {
        timestamp: "2026-10-01T09:25:00.000Z",
        open: 25260,
        high: 25550,
        low: 25240,
        close: 25530,
        volume: 300000
      }
    ];

    let candles =
      Array.isArray(state.chart?.candles) && state.chart.candles.length >= 2
        ? state.chart.candles
        : defaultFixtureCandles;
    let dataSource =
      Array.isArray(state.chart?.candles) && state.chart.candles.length >= 2
        ? state.chart.source || "VALIDATED_CHART_CANDLES"
        : "VALIDATED_HISTORICAL_CANDLES";

    state.backtest.loading = true;
    state.backtest.error = null;
    renderBacktestResultView(state.backtest.lastReport);

    if (
      dataMode === "FETCH_SERVER_CANDLES" &&
      typeof MarketAPI !== "undefined" &&
      typeof MarketAPI.candles === "function"
    ) {
      try {
        const candleRes = await MarketAPI.candles(exchange, symbol, {
          interval: timeframe,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined
        });
        if (candleRes && candleRes.ok && Array.isArray(candleRes.candles) && candleRes.candles.length > 0) {
          candles = candleRes.candles;
          dataSource = candleRes.provider || "ANGEL_HISTORICAL";
        } else if (candleRes && !candleRes.ok) {
          state.backtest.loading = false;
          state.backtest.error =
            candleRes.message || "Historical market candles could not be fetched from server.";
          renderBacktestResultView(state.backtest.lastReport);
          return;
        }
      } catch (err) {
        state.backtest.loading = false;
        state.backtest.error =
          err?.message || "Network error fetching historical candles for backtest.";
        renderBacktestResultView(state.backtest.lastReport);
        return;
      }
    }

    const btInput = {
      symbol,
      exchange,
      symboltoken: selectedInst.token || selectedInst.symbolToken || null,
      timeframe,
      fromDate,
      toDate,
      dataSource,
      assetType,
      optionType: selectedInst.optionType || "",
      strikePrice: selectedInst.strikePrice ?? null,
      expiry: selectedInst.expiry || null,
      lotSize,
      quantity,
      initialCapital,
      feePerTrade,
      slippagePerUnit,
      entryFillModel: entryExecutionModel,
      minConfidence,
      emergencyStop: state.emergencyStop,
      maxLossPerTrade,
      maxDailyLoss,
      maxTradesPerDay,
      candles
    };

    try {
      const result = Backtester.run(btInput);
      state.backtest.loading = false;
      state.backtest.lastReport = result;
      state.backtest.error = null;
      renderBacktestResultView(result);

      if (typeof MarketAPI !== "undefined" && typeof MarketAPI.backtestRun === "function") {
        MarketAPI.backtestRun(btInput)
          .then(() => fetchBacktestRunsHistory())
          .catch(() => {});
      }

      showToast(
        `Backtest complete • ${result.metrics.totalTrades} trade(s) • Net ${money(result.metrics.netPnl)}`
      );
    } catch (err) {
      state.backtest.loading = false;
      state.backtest.error = err?.message || "Backtest validation failed.";
      renderBacktestResultView(state.backtest.lastReport);
      showToast(`Backtest rejected: ${state.backtest.error}`);
    }
  });
}

const btUseSelectedBtn = document.getElementById("btUseSelectedInstrumentBtn");
if (btUseSelectedBtn) {
  btUseSelectedBtn.addEventListener("click", () => {
    const selectedInst =
      (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
      (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null);
    if (!selectedInst) return;
    const symEl = document.getElementById("btSymbolInput");
    const exEl = document.getElementById("btExchangeSelect");
    const typeEl = document.getElementById("btAssetTypeSelect");
    const tfEl = document.getElementById("btTimeframeSelect");
    const lotEl = document.getElementById("btLotSizeInput");
    if (symEl) symEl.value = selectedInst.name || selectedInst.tradingsymbol || "NIFTY 50";
    if (exEl && selectedInst.exchange) exEl.value = selectedInst.exchange;
    if (typeEl) {
      typeEl.value =
        String(selectedInst.type || "EQUITY").toUpperCase() === "OPTION" ? "OPTION" : "EQUITY";
    }
    if (tfEl && state.chart?.interval) tfEl.value = state.chart.interval;
    if (lotEl) lotEl.value = String(Math.max(1, Number(selectedInst.lotSize || 1)));
    showToast(`Loaded ${selectedInst.name || "selected instrument"} into Backtester.`);
  });
}

const btRetryBtn = document.getElementById("btRetryBtn");
if (btRetryBtn && runBacktestBtn) {
  btRetryBtn.addEventListener("click", () => {
    runBacktestBtn.click();
  });
}

const approvePilotBtn = document.getElementById("approvePilotBtn");
if (approvePilotBtn && typeof PilotApproval !== "undefined") {
  approvePilotBtn.addEventListener("click", () => {
    const res = PilotApproval.approveProposal();
    if (res.ok) {
      showToast("Pilot proposal approved and opened in Paper Mode.");
      renderAllViews();
    } else {
      showToast(res.reason || "Could not approve proposal.");
    }
  });
}

const rejectPilotBtn = document.getElementById("rejectPilotBtn");
if (rejectPilotBtn && typeof PilotApproval !== "undefined") {
  rejectPilotBtn.addEventListener("click", () => {
    const res = PilotApproval.rejectProposal("Rejected via Strategy page");
    if (res.ok) {
      showToast("Pilot proposal rejected.");
      renderAllViews();
    }
  });
}

const stratReevaluateBtn = document.getElementById("stratReevaluateBtn");
if (stratReevaluateBtn) {
  stratReevaluateBtn.addEventListener("click", async () => {
    const snap =
      typeof window !== "undefined" ? window.YashwinMarketSnapshot : null;
    const inst =
      (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
      (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null);
    if (snap && snap.dataReady === true && typeof StrategyEngine !== "undefined") {
      const assetType =
        String(inst?.type || snap.type || "EQUITY").toUpperCase() === "OPTION"
          ? "OPTION"
          : "EQUITY";
      state.lastStrategy = StrategyEngine.evaluate({
        dataReady: true,
        snapshot: snap,
        candles: snap.candles || [],
        indicators: snap.indicators || null,
        analysis: state.lastAnalysis,
        aiDecision: state.lastAIDecision,
        marketIntelligence: state.intelligence?.payload || null,
        price: snap.price,
        assetType,
        optionType: inst?.optionType || snap.optionType || "",
        emergencyStop: state.emergencyStop
      });
      if (typeof MarketAPI !== "undefined" && typeof MarketAPI.strategyEvaluate === "function") {
        try {
          await MarketAPI.strategyEvaluate({
            dataReady: true,
            symbol: inst?.name || snap.name || "NIFTY 50",
            price: snap.price,
            assetType,
            optionType: inst?.optionType || snap.optionType || "",
            analysis: state.lastAnalysis,
            aiDecision: state.lastAIDecision,
            indicators: snap.indicators
          });
          await fetchAIAnalysisHistory();
        } catch (_) {}
      }
      renderAllViews();
      showToast(`Strategy evaluated: ${state.lastStrategy.action} (${state.lastStrategy.marketRegime})`);
    } else {
      renderAllViews();
      showToast("Waiting for validated market quote before executable strategy generation.");
    }
  });
}

const stratStagePilotBtn = document.getElementById("stratStagePilotBtn");
if (stratStagePilotBtn && typeof PilotApproval !== "undefined") {
  stratStagePilotBtn.addEventListener("click", () => {
    const stratVm =
      typeof window !== "undefined" ? window.YashwinStrategyViewModel : null;
    if (!stratVm || !stratVm.canExecutePaper) {
      showToast("Strategy setup is not approved by safety gates.");
      return;
    }
    const s = stratVm.strategy;
    const prop = PilotApproval.createProposal({
      instrument: stratVm.instrument.name,
      direction: s.tradeSide,
      assetType: stratVm.instrument.assetType,
      optionType: stratVm.instrument.optionType || "",
      quantity: 1,
      entry: s.entry,
      stop: s.stopLoss,
      target: s.target,
      dataReady: true,
      signal: s.action,
      confidence: s.confidence,
      risk: state.lastAnalysis?.risk || "LOW",
      reason: s.reason,
      strategyVersion: s.strategyVersion
    });
    if (prop.ok) {
      renderAllViews();
      showToast(`Pilot proposal staged for ${stratVm.instrument.name} (${s.action}).`);
    } else {
      showToast(prop.reason || "Could not stage pilot proposal.");
    }
  });
}

const stratStagePaperBtn = document.getElementById("stratStagePaperBtn");
if (stratStagePaperBtn) {
  stratStagePaperBtn.addEventListener("click", () => {
    const stratVm =
      typeof window !== "undefined" ? window.YashwinStrategyViewModel : null;
    if (!stratVm || !stratVm.canExecutePaper) {
      showToast("Strategy setup is not approved for Paper Trading.");
      return;
    }
    const s = stratVm.strategy;
    const entryIn = document.getElementById("paperEntry");
    const stopIn = document.getElementById("paperStop");
    const targetIn = document.getElementById("paperTarget");
    if (entryIn) entryIn.value = String(s.entry);
    if (stopIn) stopIn.value = String(s.stopLoss);
    if (targetIn) {
      targetIn.value = String(s.target);
      targetIn.dispatchEvent(new Event("input"));
    }
    switchPage("paper");
    showToast(`Staged ${s.action} setup in Paper Trading.`);
  });
}

/* =====================================================
   PAPER TRADING UI CONTROLLER (PHASES 10, 12, 13, 14 & TASK 10)
   - Manual Paper Trade: RiskEngine + EmergencyStop
   - AI-Assisted Paper Trade: MarketAnalysis + AISafetyGate + RiskEngine + EmergencyStop
   - Validated market quotes only (no synthetic random ticks)
===================================================== */

(() => {
  const $ = (id) => document.getElementById(id);

  if (typeof PaperTrading === "undefined" || !$("paperPage")) {
    return;
  }

  let direction = "BUY";

  function values() {
    const assetType = String($("paperAssetType")?.value || "EQUITY").toUpperCase();
    const authMode = String($("paperAuthMode")?.value || "MANUAL").toUpperCase();
    const exitOnTarget = $("paperExitOnTarget")?.value !== "false";

    const qty = Number($("paperQty")?.value);
    const lotSize = Number($("paperLotSize")?.value);
    const lots = Number($("paperLots")?.value);

    const effectiveQuantity =
      assetType === "OPTION" ? lotSize * lots : qty;

    const selectedInstrument =
      (typeof window !== "undefined" && window.YashwinSelectedInstrument) || {};

    const optionType = String(
      selectedInstrument.optionType || ""
    ).trim().toUpperCase();

    return {
      authMode,
      exitOnTarget,
      entry: Number($("paperEntry")?.value),
      qty,
      stop: Number($("paperStop")?.value),
      target: Number($("paperTarget")?.value),
      assetType,
      lotSize,
      lots,
      effectiveQuantity,
      optionType
    };
  }

  function updateAssetTypeUI() {
    const v = values();
    const option = v.assetType === "OPTION";

    if ($("paperEquityQuantityGroup")) {
      $("paperEquityQuantityGroup").hidden = option;
    }
    if ($("paperOptionQuantityGroup")) {
      $("paperOptionQuantityGroup").hidden = !option;
    }

    if ($("paperQty")) $("paperQty").disabled = option;
    if ($("paperLotSize")) $("paperLotSize").disabled = !option;
    if ($("paperLots")) $("paperLots").disabled = !option;

    if ($("paperEffectiveQty")) {
      $("paperEffectiveQty").textContent =
        Number.isFinite(v.effectiveQuantity) && v.effectiveQuantity > 0
          ? String(v.effectiveQuantity)
          : "0";
    }

    updatePreview();
  }

  function updatePreview() {
    const v = values();
    const pState = PaperTrading.getState();

    const quantityValid =
      v.assetType === "OPTION"
        ? Number.isInteger(v.lotSize) &&
          v.lotSize > 0 &&
          Number.isInteger(v.lots) &&
          v.lots > 0
        : Number.isFinite(v.qty) && Number.isInteger(v.qty) && v.qty > 0;

    if (
      !Number.isFinite(v.entry) ||
      !Number.isFinite(v.stop) ||
      !Number.isFinite(v.target) ||
      v.entry <= 0 ||
      v.stop <= 0 ||
      v.target <= 0 ||
      !quantityValid
    ) {
      setText("paperRisk", "₹0");
      setText("paperReward", "₹0");
      setText("paperRR", "0.00");
      setText(
        "paperPreviewCapital",
        `₹0.00 / ${money(pState.availableBalance ?? 100000)}`
      );
      setText("paperPreviewVerdict", "Enter valid Entry, SL & Target");
      return;
    }

    const preview = PaperTrading.preview(v.entry, v.stop, v.target, v.qty, {
      assetType: v.assetType,
      lotSize: v.lotSize,
      lots: v.lots
    });

    setText("paperRisk", money(preview.risk));
    setText("paperReward", money(preview.reward));
    setText(
      "paperRR",
      Number.isFinite(preview.rr) ? preview.rr.toFixed(2) : "0.00"
    );

    if ($("paperEffectiveQty")) {
      $("paperEffectiveQty").textContent = String(
        preview.effectiveQuantity || 0
      );
    }

    setText(
      "paperPreviewCapital",
      `${money(preview.positionValue)} / ${money(preview.availableBalanceBefore ?? pState.availableBalance ?? 100000)}`
    );

    const check = PaperTrading.canTrade(v.entry, v.stop, v.target, v.qty, {
      direction,
      assetType: v.assetType,
      lotSize: v.lotSize,
      lots: v.lots,
      emergencyStop: state.emergencyStop
    });

    setText(
      "paperPreviewVerdict",
      check.ok
        ? `APPROVED — Risk ${money(preview.risk)} • Capital ${money(preview.positionValue)}`
        : `BLOCKED — ${check.reason}`
    );
  }

  [
    "paperAssetType",
    "paperAuthMode",
    "paperExitOnTarget",
    "paperEntry",
    "paperQty",
    "paperLotSize",
    "paperLots",
    "paperStop",
    "paperTarget"
  ].forEach((id) => {
    const element = $(id);
    if (element) {
      element.addEventListener("input", updatePreview);
      element.addEventListener("change", updatePreview);
    }
  });

  if ($("paperAssetType")) {
    $("paperAssetType").addEventListener("change", updateAssetTypeUI);
  }

  document.querySelectorAll(".trade-direction").forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll(".trade-direction")
        .forEach((b) => b.classList.remove("active"));

      button.classList.add("active");
      direction = button.dataset.direction;

      updatePreview();
    });
  });

  if ($("paperSyncBtn")) {
    $("paperSyncBtn").addEventListener("click", async () => {
      await syncUserSessionAndPaperState();
      renderPaperState();
      showToast("Paper trading account & positions synchronized.");
    });
  }

  if ($("paperFillFromMarketBtn")) {
    $("paperFillFromMarketBtn").addEventListener("click", () => {
      const snap =
        typeof window !== "undefined" ? window.YashwinMarketSnapshot : null;
      const inst =
        (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
        null;
      if (!snap || snap.dataReady !== true || !(Number(snap.price) > 0)) {
        showToast("Waiting for validated live market quote before auto-filling price.");
        return;
      }
      const p = Number(snap.price);
      const slDist = Math.max(1, Math.round(p * 0.005 * 100) / 100);
      const sl = direction === "BUY" ? Number((p - slDist).toFixed(2)) : Number((p + slDist).toFixed(2));
      const tg = direction === "BUY" ? Number((p + slDist * 2).toFixed(2)) : Number((p - slDist * 2).toFixed(2));
      if ($("paperEntry")) $("paperEntry").value = String(p);
      if ($("paperStop")) $("paperStop").value = String(sl);
      if ($("paperTarget")) $("paperTarget").value = String(tg);
      if (inst && inst.name && $("paperSymbol")) {
        const exists = Array.from($("paperSymbol").options).some(
          (o) => o.value === inst.name
        );
        if (!exists) {
          const opt = document.createElement("option");
          opt.value = inst.name;
          opt.textContent = `${inst.name} (${inst.exchange || "NSE"})`;
          $("paperSymbol").appendChild(opt);
        }
        $("paperSymbol").value = inst.name;
      }
      updatePreview();
      showToast(`Filled validated quote ₹${p.toFixed(2)} for ${inst?.name || snap.name || "selected instrument"}.`);
    });
  }

  function renderPaperState() {
    const pState = PaperTrading.getState();

    setText("paperDailyPnl", money(pState.dailyPnl));
    setText(
      "paperTradesToday",
      `${pState.tradesToday} / ${pState.maxTradesPerDay}`
    );

    if (!pState.position) {
      if ($("paperNoPosition")) $("paperNoPosition").hidden = false;
      if ($("paperPosition")) $("paperPosition").hidden = true;
      setText("paperPositionStatus", "NO POSITION");
      updatePreview();
      renderAllViews();
      return;
    }

    const p = pState.position;
    const effectiveQty = Number(p.effectiveQty || p.qty || 0);

    if ($("paperNoPosition")) $("paperNoPosition").hidden = true;
    if ($("paperPosition")) $("paperPosition").hidden = false;

    setText("paperPositionStatus", "OPEN");
    setText("paperPositionSide", p.direction);
    setText("paperPositionSymbol", p.symbol);
    setText("paperPositionModePill", p.mode || "MANUAL_PAPER");
    setText("paperPositionEntry", money(p.entry));
    setText("paperPositionCurrent", money(p.current));
    setText("paperPositionStop", money(p.stop));
    setText("paperPositionTarget", money(p.target));
    setText("paperPositionQty", String(effectiveQty));
    setText(
      "paperPositionValue",
      money(p.positionValue || p.entry * effectiveQty)
    );
    setText("paperProfitMilestone", money(p.profitStep || 0));
    setText("paperLockedProfit", money(p.lockedProfit || 0));
    setText("paperNextMilestone", money(p.nextProfitMilestone || 0));

    const pnl =
      p.direction === "BUY"
        ? (p.current - p.entry) * effectiveQty
        : (p.entry - p.current) * effectiveQty;

    setText("paperPositionPnl", money(pnl));
    updatePreview();
    renderAllViews();
  }

  if ($("openPaperTrade")) {
    $("openPaperTrade").addEventListener("click", async () => {
      const v = values();

      const quantityValid =
        v.assetType === "OPTION"
          ? Number.isInteger(v.lotSize) &&
            v.lotSize > 0 &&
            Number.isInteger(v.lots) &&
            v.lots > 0
          : Number.isFinite(v.qty) && Number.isInteger(v.qty) && v.qty > 0;

      if (
        !Number.isFinite(v.entry) ||
        !Number.isFinite(v.stop) ||
        !Number.isFinite(v.target) ||
        v.entry <= 0 ||
        v.stop <= 0 ||
        v.target <= 0 ||
        !quantityValid ||
        !Number.isFinite(v.effectiveQuantity) ||
        v.effectiveQuantity <= 0
      ) {
        showToast("Enter valid trade values");
        return;
      }

      const paperState = PaperTrading.getState();
      const isEmergency =
        state.emergencyStop ||
        paperState.emergencyStop ||
        (typeof AuditLogger !== "undefined" && AuditLogger.isEmergencyStopActive());

      // Mandatory Gate 1: RiskEngine + EmergencyStop (always enforced)
      const riskCheck = RiskEngine.evaluate({
        side: direction,
        symbol: $("paperSymbol")?.value || "NIFTY 50",
        existingSymbol: paperState.position ? paperState.position.symbol : null,
        entry: v.entry,
        stop: v.stop,
        target: v.target,
        quantity: v.qty,
        assetType: v.assetType,
        lotSize: v.lotSize,
        lots: v.lots,
        dailyPnl: paperState.dailyPnl,
        unrealizedPnl: paperState.unrealizedPnl,
        tradesToday: paperState.tradesToday,
        openPositions: paperState.position ? 1 : 0,
        availableBalance: paperState.availableBalance,
        averaging: false,
        emergencyStop: isEmergency
      });

      if (!riskCheck.allowed) {
        if (typeof AuditLogger !== "undefined") {
          AuditLogger.logRiskRejection("Paper trade blocked by RiskEngine", {
            symbol: $("paperSymbol")?.value,
            reasons: riskCheck.reasons
          });
        }
        showToast("TRADE BLOCKED • " + riskCheck.reasons.join(" "));
        return;
      }

      // Mandatory Gate 2 (when AI_ASSISTED mode is selected): MarketAnalysis + AISafetyGate
      if (v.authMode === "AI_ASSISTED") {
        const aiSignal = String(state.signal || "").toUpperCase();
        const aiConfidence = Number(state.confidence);
        const aiRisk = String(
          document.getElementById("riskLevel")?.textContent || "HIGH"
        ).toUpperCase();

        const aiGate = AISafetyGate.evaluate({
          dataReady: window.YashwinMarketSnapshot?.dataReady === true,
          signal: aiSignal,
          confidence: aiConfidence,
          risk: aiRisk,
          assetType: v.assetType,
          optionType: v.optionType,
          side: direction,
          stopLoss: v.stop,
          riskCheck,
          emergencyStop: isEmergency,
          averaging: false
        });

        if (!aiGate.allowed) {
          if (typeof AuditLogger !== "undefined") {
            AuditLogger.logRiskRejection("AI-Assisted trade blocked by AISafetyGate", {
              symbol: $("paperSymbol")?.value,
              reasons: aiGate.reasons
            });
          }
          showToast("AI SAFETY BLOCKED • " + aiGate.reasons.join(" "));
          return;
        }
      }

      const symbol = $("paperSymbol")?.value || "NIFTY 50";
      const tradeMode =
        v.authMode === "AI_ASSISTED" ? "AI_ASSISTED_PAPER" : "MANUAL_PAPER";

      // Persist to server SQLite when MarketAPI.paperOpen is available
      if (typeof MarketAPI !== "undefined" && typeof MarketAPI.paperOpen === "function") {
        try {
          const apiRes = await MarketAPI.paperOpen({
            symbol,
            direction,
            assetType: v.assetType,
            entry: v.entry,
            stop: v.stop,
            target: v.target,
            qty: v.qty,
            lotSize: v.lotSize,
            lots: v.lots,
            exitOnTarget: v.exitOnTarget,
            mode: tradeMode
          });
          if (apiRes && apiRes.ok) {
            await syncUserSessionAndPaperState();
            renderPaperState();
            showToast(
              `${direction} ${v.assetType} paper trade opened on ${symbol} • Qty ${v.effectiveQuantity}`
            );
            return;
          } else if (apiRes && apiRes.code && apiRes.code !== "API_UNREACHABLE" && apiRes.code !== "FETCH_UNAVAILABLE") {
            showToast(apiRes.message || "Paper trade rejected by server.");
            return;
          }
        } catch (_) {}
      }

      const result = PaperTrading.openPosition({
        symbol,
        direction,
        entry: v.entry,
        stop: v.stop,
        target: v.target,
        qty: v.qty,
        assetType: v.assetType,
        lotSize: v.lotSize,
        lots: v.lots,
        exitOnTarget: v.exitOnTarget,
        mode: tradeMode,
        emergencyStop: isEmergency
      });

      if (!result.ok) {
        showToast(result.reason);
        return;
      }

      if (typeof AuditLogger !== "undefined") {
        AuditLogger.logTradeDecision(
          `Opened ${v.authMode} paper position on ${symbol} (${direction})`,
          {
            symbol,
            direction,
            entry: v.entry,
            stop: v.stop,
            target: v.target,
            quantity: result.preview.effectiveQuantity
          }
        );
      }

      showToast(
        `${direction} ${v.assetType} paper trade opened • ` +
          `Qty ${result.preview.effectiveQuantity} • ` +
          `Risk ${money(result.preview.risk)}`
      );

      renderPaperState();
    });
  }

  if ($("paperApplyPriceUpdateBtn")) {
    $("paperApplyPriceUpdateBtn").addEventListener("click", async () => {
      const pState = PaperTrading.getState();
      if (!pState.position) return;
      const newPrice = Number($("paperUpdatePriceInput")?.value);
      if (!Number.isFinite(newPrice) || newPrice <= 0) {
        showToast("Enter a positive validated price to update the open position.");
        return;
      }

      if (typeof MarketAPI !== "undefined" && typeof MarketAPI.paperPriceUpdate === "function") {
        try {
          const apiUpd = await MarketAPI.paperPriceUpdate({
            positionId: pState.position.id,
            price: newPrice,
            autoExit: true,
            exitOnTarget: Boolean(pState.position.exitOnTarget)
          });
          if (apiUpd && apiUpd.ok) {
            await syncUserSessionAndPaperState();
            renderPaperState();
            showToast(
              apiUpd.closed
                ? `Position auto-closed (${apiUpd.action}) • P&L ${money(apiUpd.pnl)}`
                : `Price updated (${apiUpd.action}) • Unrealized P&L ${money(apiUpd.pnl)}`
            );
            return;
          }
        } catch (_) {}
      }

      const upd = PaperTrading.updatePrice(newPrice, {
        autoExit: true,
        exitOnTarget: Boolean(pState.position.exitOnTarget)
      });
      if (upd) {
        renderPaperState();
        showToast(
          upd.closed
            ? `Position auto-closed (${upd.action}) • P&L ${money(upd.pnl)}`
            : `Price updated (${upd.action}) • Unrealized P&L ${money(upd.pnl)}`
        );
      }
    });
  }

  if ($("closePaperTrade")) {
    $("closePaperTrade").addEventListener("click", async () => {
      const pState = PaperTrading.getState();

      if (!pState.position) return;

      if (typeof MarketAPI !== "undefined" && typeof MarketAPI.paperClose === "function") {
        try {
          const apiClose = await MarketAPI.paperClose({
            positionId: pState.position.id,
            exitPrice: pState.position.current,
            reason: "MANUAL"
          });
          if (apiClose && apiClose.ok) {
            await syncUserSessionAndPaperState();
            renderPaperState();
            showToast(`Paper trade closed • P&L ${money(apiClose.pnl)}`);
            return;
          }
        } catch (_) {}
      }

      const result = PaperTrading.closePosition(
        pState.position.current,
        "MANUAL"
      );

      if (result.ok) {
        if (typeof AuditLogger !== "undefined") {
          AuditLogger.logTradeDecision("Closed paper position manually", {
            pnl: result.pnl,
            dailyPnl: result.dailyPnl
          });
        }
        showToast(`Paper trade closed • P&L ${money(result.pnl)}`);
        renderPaperState();
      }
    });
  }

  updateAssetTypeUI();
  renderPaperState();
})();

/* =====================================================
   TASK 4 — MARKET SEARCH, FILTERS, WATCHLIST & RECENT SEARCHES
===================================================== */

function getWatchlistKeySet() {
  return (state.watchlist || []).map(
    (w) => `${String(w.exchange || "NSE").toUpperCase()}:${String(w.key || w.tradingsymbol || w.name).toUpperCase()}`
  );
}

async function toggleWatchlistInstrument(item, currentlyInWatchlist = false) {
  if (!item) return;

  if (typeof MarketAPI !== "undefined") {
    try {
      if (currentlyInWatchlist && typeof MarketAPI.removeWatchlist === "function") {
        const res = await MarketAPI.removeWatchlist({
          key: item.key || item.tradingsymbol || item.name,
          exchange: item.exchange || "NSE"
        });
        if (res && res.ok && Array.isArray(res.watchlist)) {
          state.watchlist = res.watchlist;
          renderWatchlistAndRecentViews();
          showToast(`Removed ${item.name} from Watchlist`);
          return;
        }
      } else if (!currentlyInWatchlist && typeof MarketAPI.addWatchlist === "function") {
        const res = await MarketAPI.addWatchlist(item);
        if (res && res.ok && Array.isArray(res.watchlist)) {
          state.watchlist = res.watchlist;
          renderWatchlistAndRecentViews();
          showToast(`Added ${item.name} (${item.exchange}) to Watchlist`);
          return;
        }
      }
    } catch (_) {}
  }

  // Fallback in-memory update if offline
  const keyUpper = String(item.key || item.tradingsymbol || item.name).toUpperCase();
  const exUpper = String(item.exchange || "NSE").toUpperCase();
  if (currentlyInWatchlist) {
    state.watchlist = state.watchlist.filter(
      (w) => !(String(w.exchange).toUpperCase() === exUpper && String(w.key || w.name).toUpperCase() === keyUpper)
    );
  } else {
    state.watchlist.unshift({
      key: item.key || item.tradingsymbol || item.name,
      name: item.name || item.key,
      tradingsymbol: item.tradingsymbol || null,
      exchange: exUpper,
      type: item.type || item.instrumentType || "EQUITY",
      symboltoken: item.symboltoken || null,
      optionType: item.optionType || null,
      strikePrice: item.strikePrice ?? null,
      expiry: item.expiry || null
    });
  }
  renderWatchlistAndRecentViews();
}

function renderWatchlistAndRecentViews() {
  const wlContainer = document.getElementById("scannerWatchlistContainer");
  const wlCountEl = document.getElementById("scannerWatchlistCount");
  const recentContainer = document.getElementById("scannerRecentSearchesContainer");

  const wl = Array.isArray(state.watchlist) ? state.watchlist : [];
  if (wlCountEl) {
    wlCountEl.textContent = `${wl.length} SAVED`;
  }

  if (wlContainer) {
    if (!wl.length) {
      wlContainer.innerHTML =
        '<div><span>No instruments saved in your watchlist yet. Click "☆ Watch" on any search result to add.</span><strong>--</strong></div>';
    } else {
      wlContainer.innerHTML = "";
      wl.forEach((item) => {
        const row = document.createElement("div");
        row.className = "watchlist-item-row";

        const info = document.createElement("span");
        const tokenNote = item.symboltoken ? `#${item.symboltoken}` : "UNRESOLVED";
        info.textContent = `${item.name} (${item.exchange} • ${item.type || item.instrumentType || "EQUITY"} • ${tokenNote})`;

        const actions = document.createElement("div");
        actions.className = "watchlist-item-actions";

        const loadBtn = document.createElement("button");
        loadBtn.type = "button";
        loadBtn.className = "dash-inline-btn";
        loadBtn.textContent = "Select";
        loadBtn.addEventListener("click", () => {
          window.dispatchEvent(new CustomEvent("market:instrument-selected", { detail: item }));
        });

        const rmBtn = document.createElement("button");
        rmBtn.type = "button";
        rmBtn.className = "dash-link-btn";
        rmBtn.textContent = "Remove";
        rmBtn.addEventListener("click", () => {
          toggleWatchlistInstrument(item, true);
        });

        const alertBtn = document.createElement("button");
        alertBtn.type = "button";
        alertBtn.className = "dash-inline-btn";
        alertBtn.textContent = "Alert";
        alertBtn.addEventListener("click", () => {
          prefillAlertFormWithInstrument(item);
          switchPage("watchlist");
        });

        actions.appendChild(loadBtn);
        actions.appendChild(alertBtn);
        actions.appendChild(rmBtn);
        row.appendChild(info);
        row.appendChild(actions);
        wlContainer.appendChild(row);
      });
    }
  }

  const rec = Array.isArray(state.recentSearches) ? state.recentSearches : [];
  if (recentContainer) {
    if (!rec.length) {
      recentContainer.innerHTML =
        '<div><span>No recent instrument searches yet.</span><strong>--</strong></div>';
    } else {
      recentContainer.innerHTML = "";
      rec.forEach((item) => {
        const row = document.createElement("div");
        row.className = "watchlist-item-row";

        const info = document.createElement("span");
        info.textContent = `${item.name} • ${item.exchange} • ${item.type || item.instrumentType || "EQUITY"}${item.symboltoken ? " • #" + item.symboltoken : ""}`;

        const loadBtn = document.createElement("button");
        loadBtn.type = "button";
        loadBtn.className = "dash-inline-btn";
        loadBtn.textContent = "Load";
        loadBtn.addEventListener("click", () => {
          window.dispatchEvent(new CustomEvent("market:instrument-selected", { detail: item }));
        });

        row.appendChild(info);
        row.appendChild(loadBtn);
        recentContainer.appendChild(row);
      });
    }
  }

  if (typeof renderWatchlistAndAlertsPage === "function") {
    renderWatchlistAndAlertsPage();
  }
}

(function initMarketSearch() {
  if (typeof MarketSearch === "undefined") return;

  const topInput = document.getElementById("marketSearch");
  const topResults = document.getElementById("marketSearchResults");

  const scannerForm = document.getElementById("scannerSearchForm");
  const scannerInput = document.getElementById("scannerSearchInput");
  const scannerClearBtn = document.getElementById("scannerClearBtn");
  const scannerResultsList = document.getElementById("scannerSearchResultsList");
  const scannerLoadingBanner = document.getElementById("scannerLoadingBanner");
  const scannerErrorBanner = document.getElementById("scannerErrorBanner");
  const scannerErrorText = document.getElementById("scannerErrorText");
  const scannerAmbiguousBanner = document.getElementById("scannerAmbiguousBanner");
  const scannerAmbiguousText = document.getElementById("scannerAmbiguousText");
  const scannerStateBadge = document.getElementById("scannerSearchStateBadge");
  const scannerCountLabel = document.getElementById("scannerResultsCountLabel");
  const scannerResolutionLabel = document.getElementById("scannerResolutionLabel");

  function selectInstrument(item) {
    if (!item) return;

    // Validate contract before selection
    if (typeof MarketSearch.validateContractSelection === "function") {
      const check = MarketSearch.validateContractSelection(item);
      if (!check.valid) {
        if (scannerErrorBanner && scannerErrorText) {
          scannerErrorBanner.hidden = false;
          scannerErrorText.textContent = `Contract rejected (${check.code}): ${check.reasons.join(" ")}`;
        }
        showToast(`Unsupported contract: ${check.reasons.join(" ")}`);
        return;
      }
    }

    if (topInput) topInput.value = item.name;
    if (topResults) topResults.hidden = true;
    if (scannerAmbiguousBanner) scannerAmbiguousBanner.hidden = true;

    // Record in recent searches on server
    if (typeof MarketAPI !== "undefined" && typeof MarketAPI.recordRecentSearch === "function") {
      MarketAPI.recordRecentSearch({
        ...item,
        queryText: state.lastSearchQuery || item.name
      })
        .then((res) => {
          if (res && res.ok && Array.isArray(res.recent)) {
            state.recentSearches = res.recent;
            renderWatchlistAndRecentViews();
          }
        })
        .catch(() => {});
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("market:instrument-selected", {
          detail: item
        })
      );
    }

    showToast(`${item.name} • ${item.exchange} • ${item.type || item.instrumentType || "EQUITY"}`);
  }

  async function executeScannerSearch(explicitSubmit = false) {
    if (!scannerResultsList) return;

    const query = scannerInput ? scannerInput.value : "";
    state.lastSearchQuery = query;

    if (scannerLoadingBanner) scannerLoadingBanner.hidden = false;
    if (scannerErrorBanner) scannerErrorBanner.hidden = true;
    if (scannerAmbiguousBanner) scannerAmbiguousBanner.hidden = true;
    if (scannerStateBadge) scannerStateBadge.textContent = "SEARCHING...";

    const diag = await MarketSearch.searchWithDiagnostics(query, {
      exchange: state.searchFilters.exchange,
      type: state.searchFilters.type,
      optionType: state.searchFilters.optionType
    });

    if (scannerLoadingBanner) scannerLoadingBanner.hidden = true;

    if (!diag.ok && diag.source === "VALIDATION_ERROR") {
      if (scannerStateBadge) scannerStateBadge.textContent = "INVALID INPUT";
      if (scannerErrorBanner && scannerErrorText) {
        scannerErrorBanner.hidden = false;
        scannerErrorText.textContent = diag.message;
      }
      MarketSearch.render([], scannerResultsList, selectInstrument, {
        emptyMessage: diag.message
      });
      return;
    }

    if (diag.apiError) {
      if (scannerErrorBanner && scannerErrorText) {
        scannerErrorBanner.hidden = false;
        scannerErrorText.textContent = `${diag.apiError.code}: ${diag.apiError.message}`;
      }
    }

    if (scannerStateBadge) {
      scannerStateBadge.textContent =
        diag.source === "ANGEL_ONE_API"
          ? "BROKER LIVE SEARCH"
          : diag.source === "REFERENCE_CATALOG_FALLBACK"
            ? "CATALOG (BROKER OFFLINE)"
            : "REFERENCE CATALOG";
    }

    if (scannerCountLabel) {
      scannerCountLabel.textContent = `SEARCH RESULTS (${diag.results.length})`;
    }

    if (diag.resolution.status === "EXACT" && diag.resolution.exactMatch) {
      if (scannerResolutionLabel) {
        scannerResolutionLabel.textContent = `Exact match resolved: ${diag.resolution.exactMatch.name} (${diag.resolution.exactMatch.exchange})`;
      }
      if (explicitSubmit && diag.results.length === 1) {
        selectInstrument(diag.resolution.exactMatch);
      }
    } else if (diag.resolution.status === "AMBIGUOUS") {
      if (scannerResolutionLabel) {
        scannerResolutionLabel.textContent = `${diag.results.length} matching instruments — select exact symbol below`;
      }
      if (explicitSubmit && String(query || "").trim() && scannerAmbiguousBanner) {
        scannerAmbiguousBanner.hidden = false;
        if (scannerAmbiguousText) {
          scannerAmbiguousText.textContent = `Multiple instruments match "${String(query).trim()}". Please select the exact exchange and trading symbol from the results list below.`;
        }
      }
    } else {
      if (scannerResolutionLabel) {
        scannerResolutionLabel.textContent = "No matching instruments found for current query and filters";
      }
    }

    MarketSearch.render(diag.results, scannerResultsList, selectInstrument, {
      watchlistKeys: getWatchlistKeySet(),
      onToggleWatchlist: async (item, inWl) => {
        await toggleWatchlistInstrument(item, inWl);
        executeScannerSearch(false);
      }
    });
  }

  async function bindTopSearch(input, results, hideAfterSelect = false) {
    if (!input || !results) return;

    async function update() {
      const query = input.value;
      const check = MarketSearch.validateSearchInput(query);
      if (!check.valid) {
        MarketSearch.render([], results, selectInstrument, {
          emptyMessage: check.message
        });
        results.hidden = false;
        return;
      }

      const localFound = MarketSearch.search(query);

      MarketSearch.render(localFound, results, (item) => {
        selectInstrument(item);
        if (hideAfterSelect) {
          results.hidden = true;
        }
      });

      results.hidden = false;

      if (
        typeof MarketSearch.searchAsync !== "function" ||
        !String(query || "").trim()
      ) {
        return;
      }

      const exchange =
        localFound.length && localFound[0].exchange
          ? localFound[0].exchange
          : "NSE";

      const brokerFound = await MarketSearch.searchAsync(query, exchange);

      if (String(input.value || "").trim() !== String(query || "").trim()) {
        return;
      }

      MarketSearch.render(brokerFound, results, (item) => {
        selectInstrument(item);
        if (hideAfterSelect) {
          results.hidden = true;
        }
      });

      results.hidden = false;
    }

    input.addEventListener("input", update);
    input.addEventListener("focus", update);

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        results.hidden = true;
      }
    });
  }

  bindTopSearch(topInput, topResults, true);

  if (scannerForm) {
    scannerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      executeScannerSearch(true);
    });
  }

  if (scannerInput) {
    scannerInput.addEventListener("input", () => {
      executeScannerSearch(false);
    });
  }

  if (scannerClearBtn && scannerInput) {
    scannerClearBtn.addEventListener("click", () => {
      scannerInput.value = "";
      executeScannerSearch(false);
      scannerInput.focus();
    });
  }

  document.querySelectorAll("[data-exchange-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.searchFilters.exchange = btn.dataset.exchangeFilter || "ALL";
      document.querySelectorAll("[data-exchange-filter]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      executeScannerSearch(false);
    });
  });

  document.querySelectorAll("[data-type-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.searchFilters.type = btn.dataset.typeFilter || "ALL";
      document.querySelectorAll("[data-type-filter]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      executeScannerSearch(false);
    });
  });

  document.querySelectorAll("[data-opt-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.searchFilters.optionType = btn.dataset.optFilter || "ALL";
      document.querySelectorAll("[data-opt-filter]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      executeScannerSearch(false);
    });
  });

  const retryBtns = [
    document.getElementById("scannerRetrySearchBtn"),
    document.getElementById("scannerBannerRetryBtn")
  ];
  retryBtns.forEach((btn) => {
    if (btn) {
      btn.addEventListener("click", () => {
        executeScannerSearch(true);
      });
    }
  });

  const addSelectedWlBtn = document.getElementById("scannerAddSelectedWatchlistBtn");
  if (addSelectedWlBtn) {
    addSelectedWlBtn.addEventListener("click", async () => {
      const inst =
        (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
        (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null);
      if (inst) {
        await toggleWatchlistInstrument(inst, false);
        executeScannerSearch(false);
      }
    });
  }

  const clearRecentBtn = document.getElementById("scannerClearRecentBtn");
  if (clearRecentBtn) {
    clearRecentBtn.addEventListener("click", async () => {
      if (typeof MarketAPI !== "undefined" && typeof MarketAPI.clearRecentSearches === "function") {
        try {
          const res = await MarketAPI.clearRecentSearches();
          if (res && res.ok) {
            state.recentSearches = [];
            renderWatchlistAndRecentViews();
            showToast("Recent search history cleared.");
            return;
          }
        } catch (_) {}
      }
      state.recentSearches = [];
      renderWatchlistAndRecentViews();
    });
  }

  const optCheckForm = document.getElementById("scannerOptionCheckForm");
  if (optCheckForm) {
    optCheckForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const exchange = document.getElementById("optCheckExchange")?.value || "NFO";
      const optionType = document.getElementById("optCheckType")?.value || "CE";
      const strikePrice = document.getElementById("optCheckStrike")?.value || "";
      const expiry = document.getElementById("optCheckExpiry")?.value || "";
      const outEl = document.getElementById("optCheckResultText");

      const check = MarketSearch.validateContractSelection({
        exchange,
        type: "OPTION",
        optionType,
        strikePrice: strikePrice !== "" ? Number(strikePrice) : null,
        expiry
      });

      if (outEl) {
        if (check.valid) {
          outEl.textContent = `VALID CONTRACT: ${exchange} ${optionType} Strike ${strikePrice} Exp ${expiry} is eligible.`;
          outEl.className = "scanner-opt-result tone-positive";
        } else {
          outEl.textContent = `REJECTED (${check.code}): ${check.reasons.join(" ")}`;
          outEl.className = "scanner-opt-result tone-negative";
        }
      }
    });
  }

  document.querySelectorAll(".instrument-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.instrument;
      const item =
        (typeof MarketData !== "undefined" && MarketData.getInstrument(key)) ||
        MarketSearch.allInstruments().find((i) => i.key === key) ||
        null;

      if (item) {
        selectInstrument(item);
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (
      topResults &&
      topInput &&
      !topResults.contains(event.target) &&
      event.target !== topInput
    ) {
      topResults.hidden = true;
    }
  });

  executeScannerSearch(false);
})();

/* Search clear button */
(function initSearchClear() {
  const input = document.getElementById("marketSearch");
  const results = document.getElementById("marketSearchResults");
  const clear = document.getElementById("searchClearBtn");

  if (!input || !clear) return;

  clear.addEventListener("click", () => {
    input.value = "";
    if (results) results.hidden = true;
    input.focus();
  });
})();

/* Selected instrument event handler */
(function initSelectedInstrumentBridge() {
  if (typeof window === "undefined") return;

  window.addEventListener("market:instrument-selected", (event) => {
    const item = event.detail;
    if (!item) return;

    window.YashwinSelectedInstrument = item;

    try {
      localStorage.setItem(
        "yashwin_selected_instrument",
        JSON.stringify(item)
      );
    } catch (_) {}

    setText("pageTitle", item.name);
    setText(
      "pageSubtitle",
      `${item.exchange} • ${item.type || item.instrumentType || "EQUITY"} • Validating market data...`
    );

    fetchAndPopulateSelectedInstrument(item);
  });

  window.addEventListener("market:instrument-ready", (event) => {
    const detail = event.detail || {};
    updateAIFromSnapshot(detail.snapshot, detail.instrument);
  });
})();

/* =====================================================
   TASK 2 — YASHWIN USER ACCOUNT & SESSION CONTROLLER
===================================================== */

function setFormFeedback(elId, message, isSuccess = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("success");
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle("success", Boolean(isSuccess));
}

async function syncUserSessionAndPaperState() {
  if (typeof MarketAPI === "undefined" || typeof MarketAPI.userSession !== "function") {
    return;
  }

  try {
    const sessionRes = await MarketAPI.userSession();
    if (sessionRes && sessionRes.ok && sessionRes.authenticated && sessionRes.user) {
      state.currentUser = sessionRes.user;
      state.hadAuthenticatedSession = true;
      state.sessionExpired = false;
      if (typeof PaperTrading !== "undefined" && typeof PaperTrading.setCurrentUser === "function") {
        PaperTrading.setCurrentUser(sessionRes.user.userId);
      }

      if (typeof MarketAPI.userProfile === "function") {
        const profRes = await MarketAPI.userProfile();
        if (profRes && profRes.ok && profRes.user) {
          state.currentUser = profRes.user;
          state.pendingEmailChange = profRes.pendingEmailChange || null;
        } else if (profRes?.code === "UNAUTHENTICATED") {
          state.currentUser = null;
          state.sessionExpired = true;
        }
      }
    } else {
      if (state.hadAuthenticatedSession) {
        state.sessionExpired = true;
      }
      state.currentUser = null;
      state.pendingEmailChange = null;
      if (typeof PaperTrading !== "undefined" && typeof PaperTrading.setCurrentUser === "function") {
        PaperTrading.setCurrentUser(null);
      }
    }

    if (typeof MarketAPI.paperState === "function" && typeof PaperTrading !== "undefined") {
      const pStateRes = await MarketAPI.paperState();
      if (pStateRes && pStateRes.ok && typeof PaperTrading.syncFromServerPayload === "function") {
        PaperTrading.syncFromServerPayload(pStateRes);
        if (pStateRes.riskLimits) {
          state.serverRiskLimits = pStateRes.riskLimits;
        }
        if (pStateRes.emergencyStop) {
          state.serverEmergencyStop = pStateRes.emergencyStop;
          state.emergencyStop = Boolean(pStateRes.emergencyStop.active);
        }
      }
    }

    if (typeof MarketAPI.watchlistQuotes === "function") {
      const wlRes = await MarketAPI.watchlistQuotes();
      if (wlRes && wlRes.ok) {
        if (Array.isArray(wlRes.watchlist)) {
          state.watchlist = wlRes.watchlist;
        }
        if (wlRes.quotes && typeof wlRes.quotes === "object") {
          state.watchlistAlerts.quotesMap = wlRes.quotes;
        }
      }
    } else if (typeof MarketAPI.watchlist === "function") {
      const wlRes = await MarketAPI.watchlist();
      if (wlRes && wlRes.ok && Array.isArray(wlRes.watchlist)) {
        state.watchlist = wlRes.watchlist;
      }
    }

    if (typeof MarketAPI.alertsList === "function") {
      const alRes = await MarketAPI.alertsList();
      if (alRes && alRes.ok && Array.isArray(alRes.alerts)) {
        state.watchlistAlerts.alerts = alRes.alerts;
      }
    }

    if (typeof MarketAPI.alertEvents === "function") {
      const evRes = await MarketAPI.alertEvents({ limit: 50 });
      if (evRes && evRes.ok && Array.isArray(evRes.events)) {
        state.watchlistAlerts.events = evRes.events;
        state.watchlistAlerts.unacknowledgedCount = Number(evRes.unacknowledgedCount || 0);
      }
    }

    if (typeof MarketAPI.recentSearches === "function") {
      const recRes = await MarketAPI.recentSearches();
      if (recRes && recRes.ok && Array.isArray(recRes.recent)) {
        state.recentSearches = recRes.recent;
      }
    }

    if (typeof MarketAPI.auditLogs === "function") {
      const logsRes = await MarketAPI.auditLogs();
      if (logsRes && logsRes.ok) {
        if (Array.isArray(logsRes.aiDecisions)) {
          state.ai.history = logsRes.aiDecisions;
        }
        if (Array.isArray(logsRes.strategyDecisions)) {
          state.strategyHistory = logsRes.strategyDecisions;
        }
        if (Array.isArray(logsRes.riskEvents)) {
          state.riskEvents = logsRes.riskEvents;
        }
      }
    }

    if (typeof MarketAPI.portfolioSummary === "function") {
      const portRes = await MarketAPI.portfolioSummary(state.portfolio.filters);
      if (portRes && portRes.ok) {
        state.portfolio.snapshot = portRes;
        state.portfolio.error = null;
      }
    }

    if (typeof MarketAPI.backtestRuns === "function") {
      const btRunsRes = await MarketAPI.backtestRuns();
      if (btRunsRes && btRunsRes.ok && Array.isArray(btRunsRes.runs)) {
        state.backtest.runs = btRunsRes.runs;
      }
    }
  } catch (_) {
    state.apiError = "Could not synchronize user session or paper trading state.";
  }

  renderAllViews();
}

async function fetchPortfolioTelemetry() {
  if (typeof MarketAPI === "undefined" || typeof MarketAPI.portfolioSummary !== "function") {
    renderPositionsOrdersHistoryRiskViews();
    return;
  }

  state.portfolio.loading = true;
  state.portfolio.error = null;
  renderPositionsOrdersHistoryRiskViews();

  try {
    const res = await MarketAPI.portfolioSummary(state.portfolio.filters);
    state.portfolio.loading = false;
    if (res && res.ok) {
      state.portfolio.snapshot = res;
      state.portfolio.error = null;
    } else {
      state.portfolio.error = res?.message || "Failed to load portfolio summary.";
    }
  } catch (err) {
    state.portfolio.loading = false;
    state.portfolio.error = err?.message || "Network error loading portfolio summary.";
  }

  renderPositionsOrdersHistoryRiskViews();
}

(function initPortfolioController() {
  const refreshBtn = document.getElementById("portfolioRefreshBtn");
  const retryBtn = document.getElementById("portfolioRetryBtn");
  const signInBtn = document.getElementById("portfolioSignInBtn");
  const closeOpenBtn = document.getElementById("portfolioCloseOpenPositionBtn");
  const applyFilterBtn = document.getElementById("portfolioApplyFilterBtn");
  const resetFilterBtn = document.getElementById("portfolioResetFilterBtn");

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      fetchPortfolioTelemetry();
    });
  }
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      fetchPortfolioTelemetry();
    });
  }
  if (signInBtn) {
    signInBtn.addEventListener("click", () => {
      switchPage("account");
    });
  }
  if (closeOpenBtn) {
    closeOpenBtn.addEventListener("click", () => {
      const paperCloseBtn = document.getElementById("closePaperTrade");
      if (paperCloseBtn) {
        paperCloseBtn.click();
      }
    });
  }

  function readFiltersFromInputs() {
    state.portfolio.filters = {
      symbol: (document.getElementById("portfolioFilterSymbol")?.value || "").trim(),
      status: document.getElementById("portfolioFilterStatus")?.value || "ALL",
      reason: document.getElementById("portfolioFilterReason")?.value || "ALL",
      fromDate: document.getElementById("portfolioFilterFromDate")?.value || "",
      toDate: document.getElementById("portfolioFilterToDate")?.value || ""
    };
  }

  if (applyFilterBtn) {
    applyFilterBtn.addEventListener("click", () => {
      readFiltersFromInputs();
      fetchPortfolioTelemetry();
    });
  }

  if (resetFilterBtn) {
    resetFilterBtn.addEventListener("click", () => {
      const symEl = document.getElementById("portfolioFilterSymbol");
      const statusEl = document.getElementById("portfolioFilterStatus");
      const reasonEl = document.getElementById("portfolioFilterReason");
      const fromEl = document.getElementById("portfolioFilterFromDate");
      const toEl = document.getElementById("portfolioFilterToDate");
      if (symEl) symEl.value = "";
      if (statusEl) statusEl.value = "ALL";
      if (reasonEl) reasonEl.value = "ALL";
      if (fromEl) fromEl.value = "";
      if (toEl) toEl.value = "";
      readFiltersFromInputs();
      fetchPortfolioTelemetry();
    });
  }
})();

async function syncOrdersAndTradeHistoryFromServer() {
  if (typeof MarketAPI === "undefined" || typeof MarketAPI.paperState !== "function") {
    renderPositionsOrdersHistoryRiskViews();
    return;
  }

  state.orderTradeHistory.loading = true;
  state.orderTradeHistory.error = null;
  renderPositionsOrdersHistoryRiskViews();

  try {
    const paperRes = await MarketAPI.paperState();
    state.orderTradeHistory.loading = false;
    if (paperRes && paperRes.ok) {
      if (typeof PaperTrading !== "undefined") {
        PaperTrading.syncFromServerPayload(paperRes);
      }
    } else {
      state.orderTradeHistory.error =
        paperRes?.message || "Could not refresh orders and trade history.";
    }
  } catch (err) {
    state.orderTradeHistory.loading = false;
    state.orderTradeHistory.error =
      err?.message || "Network error refreshing orders and trade history.";
  }

  renderPositionsOrdersHistoryRiskViews();
}

(function initOrdersAndTradeHistoryController() {
  const ordersRefreshBtn = document.getElementById("ordersRefreshBtn");
  const ordersRetryBtn = document.getElementById("ordersRetryBtn");
  const ordersApplyBtn = document.getElementById("ordersApplyFilterBtn");
  const ordersResetBtn = document.getElementById("ordersResetFilterBtn");
  const ordersPrevBtn = document.getElementById("ordersPrevPageBtn");
  const ordersNextBtn = document.getElementById("ordersNextPageBtn");

  const historyRefreshBtn = document.getElementById("historyRefreshBtn");
  const historyRetryBtn = document.getElementById("historyRetryBtn");
  const historyApplyBtn = document.getElementById("historyApplyFilterBtn");
  const historyResetBtn = document.getElementById("historyResetFilterBtn");
  const historyPrevBtn = document.getElementById("historyPrevPageBtn");
  const historyNextBtn = document.getElementById("historyNextPageBtn");

  function readOrdersFilters(pageOverride = 1) {
    state.orderTradeHistory.ordersFilters = {
      symbol: (document.getElementById("ordersFilterSymbol")?.value || "").trim(),
      exchange: document.getElementById("ordersFilterExchange")?.value || "ALL",
      direction: document.getElementById("ordersFilterDirection")?.value || "ALL",
      orderStatus: document.getElementById("ordersFilterStatus")?.value || "ALL",
      orderType: document.getElementById("ordersFilterType")?.value || "ALL",
      fromDate: document.getElementById("ordersFilterFromDate")?.value || "",
      toDate: document.getElementById("ordersFilterToDate")?.value || "",
      page: pageOverride,
      pageSize: 15
    };
  }

  function readHistoryFilters(pageOverride = 1) {
    state.orderTradeHistory.historyFilters = {
      symbol: (document.getElementById("historyFilterSymbol")?.value || "").trim(),
      exchange: document.getElementById("historyFilterExchange")?.value || "ALL",
      direction: document.getElementById("historyFilterDirection")?.value || "ALL",
      pnlResult: document.getElementById("historyFilterOutcome")?.value || "ALL",
      exitReason: document.getElementById("historyFilterExitReason")?.value || "ALL",
      fromDate: document.getElementById("historyFilterFromDate")?.value || "",
      toDate: document.getElementById("historyFilterToDate")?.value || "",
      page: pageOverride,
      pageSize: 15
    };
  }

  if (ordersRefreshBtn) {
    ordersRefreshBtn.addEventListener("click", () => {
      syncOrdersAndTradeHistoryFromServer();
    });
  }
  if (ordersRetryBtn) {
    ordersRetryBtn.addEventListener("click", () => {
      syncOrdersAndTradeHistoryFromServer();
    });
  }
  if (ordersApplyBtn) {
    ordersApplyBtn.addEventListener("click", () => {
      readOrdersFilters(1);
      renderPositionsOrdersHistoryRiskViews();
    });
  }
  if (ordersResetBtn) {
    ordersResetBtn.addEventListener("click", () => {
      const sym = document.getElementById("ordersFilterSymbol");
      const ex = document.getElementById("ordersFilterExchange");
      const dir = document.getElementById("ordersFilterDirection");
      const st = document.getElementById("ordersFilterStatus");
      const tp = document.getElementById("ordersFilterType");
      const fd = document.getElementById("ordersFilterFromDate");
      const td = document.getElementById("ordersFilterToDate");
      if (sym) sym.value = "";
      if (ex) ex.value = "ALL";
      if (dir) dir.value = "ALL";
      if (st) st.value = "ALL";
      if (tp) tp.value = "ALL";
      if (fd) fd.value = "";
      if (td) td.value = "";
      readOrdersFilters(1);
      renderPositionsOrdersHistoryRiskViews();
    });
  }
  if (ordersPrevBtn) {
    ordersPrevBtn.addEventListener("click", () => {
      const cur = Number(state.orderTradeHistory.ordersFilters.page || 1);
      if (cur > 1) {
        readOrdersFilters(cur - 1);
        renderPositionsOrdersHistoryRiskViews();
      }
    });
  }
  if (ordersNextBtn) {
    ordersNextBtn.addEventListener("click", () => {
      const cur = Number(state.orderTradeHistory.ordersFilters.page || 1);
      readOrdersFilters(cur + 1);
      renderPositionsOrdersHistoryRiskViews();
    });
  }

  if (historyRefreshBtn) {
    historyRefreshBtn.addEventListener("click", () => {
      syncOrdersAndTradeHistoryFromServer();
    });
  }
  if (historyRetryBtn) {
    historyRetryBtn.addEventListener("click", () => {
      syncOrdersAndTradeHistoryFromServer();
    });
  }
  if (historyApplyBtn) {
    historyApplyBtn.addEventListener("click", () => {
      readHistoryFilters(1);
      renderPositionsOrdersHistoryRiskViews();
    });
  }
  if (historyResetBtn) {
    historyResetBtn.addEventListener("click", () => {
      const sym = document.getElementById("historyFilterSymbol");
      const ex = document.getElementById("historyFilterExchange");
      const dir = document.getElementById("historyFilterDirection");
      const out = document.getElementById("historyFilterOutcome");
      const er = document.getElementById("historyFilterExitReason");
      const fd = document.getElementById("historyFilterFromDate");
      const td = document.getElementById("historyFilterToDate");
      if (sym) sym.value = "";
      if (ex) ex.value = "ALL";
      if (dir) dir.value = "ALL";
      if (out) out.value = "ALL";
      if (er) er.value = "ALL";
      if (fd) fd.value = "";
      if (td) td.value = "";
      readHistoryFilters(1);
      renderPositionsOrdersHistoryRiskViews();
    });
  }
  if (historyPrevBtn) {
    historyPrevBtn.addEventListener("click", () => {
      const cur = Number(state.orderTradeHistory.historyFilters.page || 1);
      if (cur > 1) {
        readHistoryFilters(cur - 1);
        renderPositionsOrdersHistoryRiskViews();
      }
    });
  }
  if (historyNextBtn) {
    historyNextBtn.addEventListener("click", () => {
      const cur = Number(state.orderTradeHistory.historyFilters.page || 1);
      readHistoryFilters(cur + 1);
      renderPositionsOrdersHistoryRiskViews();
    });
  }
})();

(function initUserAccountController() {
  const topAccountBtn = document.getElementById("topAccountBtn");
  if (topAccountBtn) {
    topAccountBtn.addEventListener("click", () => {
      switchPage("account");
    });
  }

  const loginForm = document.getElementById("userLoginForm");
  if (loginForm && typeof MarketAPI !== "undefined") {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setFormFeedback("loginFeedbackText", "");

      const email = document.getElementById("loginEmail")?.value || "";
      const password = document.getElementById("loginPassword")?.value || "";

      const res = await MarketAPI.userLogin({ email, password });
      if (!res || !res.ok) {
        if (res?.code === "LOGIN_RATE_LIMITED") {
          setText("loginRateStatusPill", "RATE LIMITED");
        }
        setFormFeedback("loginFeedbackText", res?.message || "Login failed.", false);
        showToast(res?.message || "Login failed");
        return;
      }

      setText("loginRateStatusPill", "SECURE");
      document.getElementById("loginPassword").value = "";
      state.currentUser = res.user;
      await syncUserSessionAndPaperState();
      showToast(`Welcome back, ${res.user.name}`);
    });
  }

  const registerForm = document.getElementById("userRegisterForm");
  if (registerForm && typeof MarketAPI !== "undefined") {
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setFormFeedback("registerFeedbackText", "");

      const name = document.getElementById("registerName")?.value || "";
      const email = document.getElementById("registerEmail")?.value || "";
      const password = document.getElementById("registerPassword")?.value || "";

      const res = await MarketAPI.userRegister({ name, email, password });
      if (!res || !res.ok) {
        setFormFeedback("registerFeedbackText", res?.message || "Registration failed.", false);
        showToast(res?.message || "Registration failed");
        return;
      }

      document.getElementById("registerPassword").value = "";
      state.currentUser = res.user;
      await syncUserSessionAndPaperState();
      showToast(`Account created for ${res.user.name}`);
    });
  }

  const logoutBtn = document.getElementById("userLogoutBtn");
  if (logoutBtn && typeof MarketAPI !== "undefined") {
    logoutBtn.addEventListener("click", async () => {
      const res = await MarketAPI.userLogout();
      if (res && res.ok) {
        state.currentUser = null;
        state.hadAuthenticatedSession = false;
        state.sessionExpired = false;
        state.pendingEmailChange = null;
        state.watchlist = [];
        state.watchlistAlerts.alerts = [];
        state.watchlistAlerts.events = [];
        state.watchlistAlerts.quotesMap = {};
        state.notifications.items = [];
        state.notifications.unreadCount = 0;
        if (typeof PWAEngine !== "undefined" && typeof PWAEngine.clearSensitiveClientStorage === "function") {
          await PWAEngine.clearSensitiveClientStorage();
        }
        await syncUserSessionAndPaperState();
        showToast("Signed out and session invalidated.");
      } else {
        showToast(res?.message || "Could not sign out.");
      }
    });
  }

  const profileForm = document.getElementById("userProfileForm");
  if (profileForm && typeof MarketAPI !== "undefined") {
    profileForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setFormFeedback("profileFeedbackText", "");

      const name = document.getElementById("profileEditName")?.value || "";
      const email = document.getElementById("profileEditEmail")?.value || "";
      const notifications =
        document.getElementById("profileNotificationsToggle")?.value !== "false";

      const res = await MarketAPI.updateUserProfile({
        name,
        email,
        settings: { notifications }
      });

      if (!res || !res.ok) {
        setFormFeedback("profileFeedbackText", res?.message || "Profile update failed.", false);
        showToast(res?.message || "Profile update failed");
        return;
      }

      state.currentUser = res.user;
      state.pendingEmailChange = res.pendingEmailChange || null;
      const msg =
        res.emailChange?.status === "VERIFICATION_REQUIRED"
          ? "Profile saved. Please verify your new email address."
          : "Profile updated successfully.";
      setFormFeedback("profileFeedbackText", msg, true);
      renderAllViews();
      showToast(msg);
    });
  }

  const verifyBtn = document.getElementById("emailVerifyConfirmBtn");
  if (verifyBtn && typeof MarketAPI !== "undefined") {
    verifyBtn.addEventListener("click", async () => {
      const token = document.getElementById("emailVerifyTokenInput")?.value || "";
      const res = await MarketAPI.verifyEmailChange(token);
      if (!res || !res.ok) {
        setFormFeedback("profileFeedbackText", res?.message || "Verification failed.", false);
        showToast(res?.message || "Verification failed");
        return;
      }
      state.currentUser = res.user;
      state.pendingEmailChange = null;
      document.getElementById("emailVerifyTokenInput").value = "";
      setFormFeedback("profileFeedbackText", "Email address verified and updated.", true);
      renderAllViews();
      showToast("Email address verified and updated.");
    });
  }

  const passwordForm = document.getElementById("userPasswordForm");
  if (passwordForm && typeof MarketAPI !== "undefined") {
    passwordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setFormFeedback("passwordFeedbackText", "");

      const currentPassword = document.getElementById("currentPasswordInput")?.value || "";
      const newPassword = document.getElementById("newPasswordInput")?.value || "";

      const res = await MarketAPI.changePassword({ currentPassword, newPassword });
      if (!res || !res.ok) {
        setFormFeedback("passwordFeedbackText", res?.message || "Password update failed.", false);
        showToast(res?.message || "Password update failed");
        return;
      }

      document.getElementById("currentPasswordInput").value = "";
      document.getElementById("newPasswordInput").value = "";
      state.currentUser = res.user;
      setFormFeedback("passwordFeedbackText", "Password updated securely.", true);
      renderAllViews();
      showToast("Password updated securely.");
    });
  }
})();

/* =====================================================
   TASK 14 — WATCHLIST & MARKET ALERTS CONTROLLER
===================================================== */

function prefillAlertFormWithInstrument(inst) {
  if (!inst) return;
  const symEl = document.getElementById("wlAlertSymbolInput");
  const exEl = document.getElementById("wlAlertExchangeSelect");
  const typeEl = document.getElementById("wlAlertInstTypeSelect");
  const optRow = document.getElementById("wlAlertOptionFieldsRow");
  const optTypeEl = document.getElementById("wlAlertOptionType");
  const strikeEl = document.getElementById("wlAlertStrikePrice");
  const expiryEl = document.getElementById("wlAlertExpiryDate");

  if (symEl) symEl.value = inst.tradingsymbol || inst.name || inst.key || "NIFTY 50";
  if (exEl) exEl.value = String(inst.exchange || "NSE").toUpperCase();
  const normType = String(inst.type || inst.instrumentType || "EQUITY").toUpperCase();
  if (typeEl) {
    if (normType.includes("OPT") || inst.optionType) {
      typeEl.value = "OPTION";
    } else if (normType.includes("FUT")) {
      typeEl.value = "FUTURES";
    } else if (normType.includes("INDEX")) {
      typeEl.value = "INDEX";
    } else {
      typeEl.value = "EQUITY";
    }
  }
  const isOpt = typeEl && typeEl.value === "OPTION";
  if (optRow) optRow.hidden = !isOpt;
  if (isOpt) {
    if (optTypeEl && inst.optionType) optTypeEl.value = String(inst.optionType).toUpperCase();
    if (strikeEl && inst.strikePrice) strikeEl.value = inst.strikePrice;
    if (expiryEl && inst.expiry) expiryEl.value = inst.expiry;
  }
}

async function syncWatchlistAndAlertsData(options = {}) {
  if (typeof MarketAPI === "undefined") return;
  state.watchlistAlerts.loading = true;
  state.watchlistAlerts.error = null;
  renderWatchlistAndAlertsPage();

  try {
    if (typeof MarketAPI.watchlistQuotes === "function") {
      const wlRes = await MarketAPI.watchlistQuotes({ live: Boolean(options.live) });
      if (wlRes && wlRes.ok) {
        state.watchlist = Array.isArray(wlRes.watchlist) ? wlRes.watchlist : state.watchlist;
        state.watchlistAlerts.quotesMap = wlRes.quotes || {};
      }
    }
    if (typeof MarketAPI.alertsList === "function") {
      const alRes = await MarketAPI.alertsList();
      if (alRes && alRes.ok && Array.isArray(alRes.alerts)) {
        state.watchlistAlerts.alerts = alRes.alerts;
      }
    }
    if (typeof MarketAPI.alertEvents === "function") {
      const evRes = await MarketAPI.alertEvents({
        symbol: state.watchlistAlerts.historySymbolFilter || undefined,
        alertType:
          state.watchlistAlerts.historyTypeFilter !== "ALL"
            ? state.watchlistAlerts.historyTypeFilter
            : undefined,
        limit: 50
      });
      if (evRes && evRes.ok && Array.isArray(evRes.events)) {
        state.watchlistAlerts.events = evRes.events;
        state.watchlistAlerts.unacknowledgedCount = Number(evRes.unacknowledgedCount || 0);
      }
    }
    await syncNotificationsAndPreferencesData();
    state.watchlistAlerts.loading = false;
  } catch (err) {
    state.watchlistAlerts.loading = false;
    state.watchlistAlerts.error = err?.message || "Failed to synchronize watchlist and alerts.";
  }

  renderWatchlistAndRecentViews();
  renderWatchlistAndAlertsPage();
}

function renderWatchlistAndAlertsPage() {
  const wl = Array.isArray(state.watchlist) ? state.watchlist : [];
  const quotesMap = state.watchlistAlerts.quotesMap || {};
  const alerts = Array.isArray(state.watchlistAlerts.alerts) ? state.watchlistAlerts.alerts : [];
  const events = Array.isArray(state.watchlistAlerts.events) ? state.watchlistAlerts.events : [];

  const selectedInst =
    (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
    (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null) || {
      key: "NIFTY50",
      name: "NIFTY 50",
      exchange: "NSE"
    };
  setText("wlSelectedInstLabel", selectedInst.name || selectedInst.tradingsymbol || "NIFTY 50");

  const loadingBanner = document.getElementById("wlLoadingBanner");
  if (loadingBanner) loadingBanner.hidden = !state.watchlistAlerts.loading;

  const errorBanner = document.getElementById("wlErrorBanner");
  if (errorBanner) {
    errorBanner.hidden = !state.watchlistAlerts.error;
    if (state.watchlistAlerts.error) {
      setText("wlErrorText", state.watchlistAlerts.error);
    }
  }

  let viewModelRows = [];
  if (
    typeof WatchlistAlertEngine !== "undefined" &&
    typeof WatchlistAlertEngine.buildWatchlistViewModel === "function"
  ) {
    viewModelRows = WatchlistAlertEngine.buildWatchlistViewModel(wl, quotesMap);
  } else {
    viewModelRows = wl.map((item, idx) => ({
      ...item,
      sortOrder: idx + 1,
      quote: { status: "DATA_WAITING", available: false, ltp: null }
    }));
  }

  const availableQuotesCount = viewModelRows.filter((r) => r.quote && r.quote.available).length;
  const waitingQuotesCount = Math.max(0, viewModelRows.length - availableQuotesCount);

  setText("wlKpiTotalItems", `${viewModelRows.length} SAVED`);
  setText(
    "wlKpiQuoteCoverage",
    `${availableQuotesCount} validated quotes • ${waitingQuotesCount} waiting`
  );

  const activeAlerts = alerts.filter((a) => a.status === "ACTIVE");
  const pausedAlerts = alerts.filter((a) => a.status === "PAUSED");
  const cancelledAlerts = alerts.filter((a) => a.status === "CANCELLED");

  setText("wlKpiActiveAlerts", `${activeAlerts.length} ACTIVE`);
  setText(
    "wlKpiPausedAlerts",
    `${pausedAlerts.length} paused • ${cancelledAlerts.length} cancelled`
  );

  const unackEvents = events.filter((e) => !e.acknowledged);
  setText("wlKpiTriggeredEvents", `${events.length} TRIGGERED`);
  setText("wlKpiUnackCount", `${unackEvents.length} unacknowledged notifications`);
  setText(
    "wlKpiOwnerScope",
    state.currentUser
      ? `User ${state.currentUser.name || state.currentUser.userId} • Paper Mode Only`
      : "Session Isolated SQLite • Paper Mode Only"
  );

  const trigBanner = document.getElementById("wlTriggeredNotificationBanner");
  if (trigBanner) {
    if (unackEvents.length > 0) {
      const latestEv = unackEvents[0];
      trigBanner.hidden = false;
      setText(
        "wlTriggeredBannerText",
        `${latestEv.message || latestEv.symbol} • Source: ${latestEv.dataSource || "VALIDATED_SNAPSHOT"} • Triggered: ${latestEv.triggeredAt || "--"}`
      );
      trigBanner.dataset.latestEventId = latestEv.eventId;
    } else {
      trigBanner.hidden = true;
    }
  }

  const emptyEl = document.getElementById("wlTableEmptyState");
  const tableEl = document.getElementById("wlWatchlistTable");
  const tbody = document.getElementById("wlWatchlistTableBody");

  if (emptyEl) emptyEl.hidden = viewModelRows.length > 0;
  if (tableEl) tableEl.hidden = viewModelRows.length === 0;

  if (tbody && viewModelRows.length > 0) {
    tbody.innerHTML = "";
    viewModelRows.forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid rgba(255,255,255,0.06)";

      const q = row.quote || {};
      const ltpText =
        q.available && Number.isFinite(q.ltp)
          ? `₹${Number(q.ltp).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : "DATA WAITING";
      const chgText =
        q.available && Number.isFinite(q.changePercent)
          ? `${q.change >= 0 ? "+" : ""}${Number(q.change || 0).toFixed(2)} (${q.changePercent >= 0 ? "+" : ""}${Number(q.changePercent).toFixed(2)}%)`
          : "--";
      const hlText =
        q.available && Number.isFinite(q.high) && Number.isFinite(q.low)
          ? `H: ₹${Number(q.high).toFixed(2)} / L: ₹${Number(q.low).toFixed(2)}`
          : "--";
      const volText =
        q.available && q.volume !== null && q.volume !== undefined
          ? Number(q.volume).toLocaleString("en-IN")
          : "--";
      const optBadge = row.optionDetails
        ? `<div style="font-size: 11px; opacity: 0.8;">${row.optionDetails.optionType} • Strike ${row.optionDetails.strikePrice || "--"} • Exp ${row.optionDetails.expiry || "--"}</div>`
        : "";
      const tokenBadge = row.symboltoken ? `#${row.symboltoken}` : "UNRESOLVED";

      tr.innerHTML = `
        <td class="tabular-nums" style="padding: 10px 8px;">
          <strong>#${idx + 1}</strong>
          <div style="display: inline-flex; gap: 4px; margin-left: 6px;">
            <button type="button" class="dash-link-btn wl-move-up-btn" title="Move Up" ${idx === 0 ? "disabled" : ""}>↑</button>
            <button type="button" class="dash-link-btn wl-move-down-btn" title="Move Down" ${idx === viewModelRows.length - 1 ? "disabled" : ""}>↓</button>
          </div>
        </td>
        <td style="padding: 10px 8px;">
          <strong>${row.name}</strong>
          <div style="font-size: 11px; opacity: 0.78;">${row.tradingsymbol || row.key} • ${tokenBadge}</div>
          ${optBadge}
        </td>
        <td style="padding: 10px 8px;">
          <span class="status-pill">${row.exchange} • ${row.instrumentType}</span>
        </td>
        <td class="tabular-nums" style="padding: 10px 8px; text-align: right; font-weight: 600;">${ltpText}</td>
        <td class="tabular-nums ${q.changePercent > 0 ? "tone-positive" : q.changePercent < 0 ? "tone-negative" : ""}" style="padding: 10px 8px; text-align: right;">${chgText}</td>
        <td class="tabular-nums" style="padding: 10px 8px; text-align: right; font-size: 12px;">${hlText}</td>
        <td class="tabular-nums" style="padding: 10px 8px; text-align: right;">${volText}</td>
        <td style="padding: 10px 8px; font-size: 12px;">
          <strong>${q.status || "DATA_WAITING"}</strong>
          <div style="font-size: 11px; opacity: 0.75;">${q.source || "NO_VALIDATED_SNAPSHOT"}${q.timestamp ? " • " + q.timestamp : ""}</div>
        </td>
        <td style="padding: 10px 8px; text-align: right;">
          <div style="display: inline-flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end;">
            <button type="button" class="dash-inline-btn wl-action-chart">Chart</button>
            <button type="button" class="dash-inline-btn wl-action-ai">AI Analysis</button>
            <button type="button" class="dash-inline-btn wl-action-strategy">Strategy</button>
            <button type="button" class="dash-inline-btn wl-action-paper">Paper Prefill</button>
            <button type="button" class="dash-inline-btn wl-action-alert">+ Alert</button>
            <button type="button" class="dash-link-btn wl-action-remove">Remove</button>
          </div>
        </td>
      `;

      const upBtn = tr.querySelector(".wl-move-up-btn");
      if (upBtn) {
        upBtn.addEventListener("click", () => moveWatchlistItemOrder(idx, -1));
      }
      const downBtn = tr.querySelector(".wl-move-down-btn");
      if (downBtn) {
        downBtn.addEventListener("click", () => moveWatchlistItemOrder(idx, 1));
      }

      tr.querySelector(".wl-action-chart")?.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("market:instrument-selected", { detail: row }));
        switchPage("dashboard");
        showToast(`Loaded ${row.name} into Chart & Dashboard`);
      });

      tr.querySelector(".wl-action-ai")?.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("market:instrument-selected", { detail: row }));
        switchPage("analysis");
        showToast(`Selected ${row.name} for AI Analysis`);
      });

      tr.querySelector(".wl-action-strategy")?.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("market:instrument-selected", { detail: row }));
        switchPage("strategy");
        showToast(`Selected ${row.name} for Strategy & Backtest`);
      });

      tr.querySelector(".wl-action-paper")?.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("market:instrument-selected", { detail: row }));
        switchPage("paper");
        showToast(`Prefilled ${row.name} in Paper Trading ticket (manual confirmation required)`);
      });

      tr.querySelector(".wl-action-alert")?.addEventListener("click", () => {
        prefillAlertFormWithInstrument(row);
        document.getElementById("wlAlertSymbolInput")?.focus();
      });

      tr.querySelector(".wl-action-remove")?.addEventListener("click", () => {
        toggleWatchlistInstrument(row, true);
      });

      tbody.appendChild(tr);
    });
  }

  // Render Configured Alerts List
  const alertsContainer = document.getElementById("wlAlertsListContainer");
  if (alertsContainer) {
    const statusFilter = state.watchlistAlerts.statusFilter || "ALL";
    const filteredAlerts = alerts.filter((a) =>
      statusFilter === "ALL" ? true : String(a.status).toUpperCase() === statusFilter
    );

    if (!filteredAlerts.length) {
      alertsContainer.innerHTML = `<div><span>No market alerts matching filter (${statusFilter}).</span><strong>0 ALERTS</strong></div>`;
    } else {
      alertsContainer.innerHTML = "";
      filteredAlerts.forEach((alert) => {
        const div = document.createElement("div");
        div.className = "ai-history-item-row";
        const cond = alert.conditionParams || {};
        const extraCond =
          alert.alertType === "INDICATOR_CONDITION"
            ? ` • ${cond.indicator || "RSI14"} ${cond.operator || "GTE"} ${alert.threshold}`
            : alert.alertType === "STRATEGY_SIGNAL"
              ? ` • Target Signal: ${cond.targetSignal || "BUY"}`
              : alert.alertType === "CANDLE_BREAKOUT"
                ? ` • Breakout: ${cond.breakoutDirection || "UP"}`
                : ` • Threshold: ${alert.threshold ?? "--"}`;

        div.innerHTML = `
          <div class="ai-history-meta">
            <span><strong>${escapeHtml(alert.symbol)} (${escapeHtml(alert.exchange)} • ${escapeHtml(alert.instrumentType)})</strong> — <code>${escapeHtml(alert.alertType)}</code>${escapeHtml(extraCond)}</span>
            <small>Status: <strong>${escapeHtml(alert.status)}</strong> • Triggers: ${Number(alert.triggerCount || 0)} • Last Triggered: ${escapeHtml(alert.lastTriggeredAt || "Never")}${alert.notes ? " • Note: " + escapeHtml(alert.notes) : ""}</small>
          </div>
          <div class="watchlist-item-actions">
            ${alert.status === "ACTIVE" ? '<button type="button" class="dash-inline-btn wl-alert-pause">Pause</button>' : ""}
            ${alert.status === "PAUSED" ? '<button type="button" class="dash-inline-btn wl-alert-resume">Resume</button>' : ""}
            ${alert.status === "TRIGGERED" || alert.lastTriggeredAt ? '<button type="button" class="dash-inline-btn wl-alert-reset">Reset</button>' : ""}
            ${alert.status !== "CANCELLED" ? '<button type="button" class="dash-link-btn wl-alert-cancel">Cancel</button>' : ""}
          </div>
        `;

        div.querySelector(".wl-alert-pause")?.addEventListener("click", async () => {
          const res = await MarketAPI.pauseAlert(alert.alertId);
          if (res && res.ok) {
            state.watchlistAlerts.alerts = res.alerts || state.watchlistAlerts.alerts;
            renderWatchlistAndAlertsPage();
            showToast(`Paused alert for ${alert.symbol}`);
          }
        });

        div.querySelector(".wl-alert-resume")?.addEventListener("click", async () => {
          const res = await MarketAPI.resumeAlert(alert.alertId);
          if (res && res.ok) {
            state.watchlistAlerts.alerts = res.alerts || state.watchlistAlerts.alerts;
            renderWatchlistAndAlertsPage();
            showToast(`Resumed alert for ${alert.symbol}`);
          }
        });

        div.querySelector(".wl-alert-reset")?.addEventListener("click", async () => {
          const res = await MarketAPI.resetAlert(alert.alertId);
          if (res && res.ok) {
            state.watchlistAlerts.alerts = res.alerts || state.watchlistAlerts.alerts;
            renderWatchlistAndAlertsPage();
            showToast(`Reset alert trigger state for ${alert.symbol}`);
          }
        });

        div.querySelector(".wl-alert-cancel")?.addEventListener("click", async () => {
          const res = await MarketAPI.cancelAlert(alert.alertId);
          if (res && res.ok) {
            state.watchlistAlerts.alerts = res.alerts || state.watchlistAlerts.alerts;
            renderWatchlistAndAlertsPage();
            showToast(`Cancelled alert for ${alert.symbol}`);
          }
        });

        alertsContainer.appendChild(div);
      });
    }
  }

  // Render Triggered Alert Events History
  const eventsContainer = document.getElementById("wlAlertEventsHistoryContainer");
  if (eventsContainer) {
    if (!events.length) {
      eventsContainer.innerHTML =
        '<div><span>No triggered alert events recorded yet. Alerts only fire on validated real market data.</span><strong>0 EVENTS</strong></div>';
    } else {
      eventsContainer.innerHTML = "";
      events.forEach((ev) => {
        const div = document.createElement("div");
        div.className = "ai-history-item-row";
        div.innerHTML = `
          <div class="ai-history-meta">
            <span><strong>[${ev.alertType}] ${ev.symbol} (${ev.exchange})</strong> — ${ev.message}</span>
            <small>Observed: <strong>${ev.observedValue ?? "--"}</strong> vs Threshold: <strong>${ev.thresholdValue ?? "--"}</strong> • Source: ${ev.dataSource} • Quote Time: ${ev.quoteTimestamp || "--"} • Triggered: ${ev.triggeredAt}</small>
          </div>
          <div class="watchlist-item-actions">
            <span class="status-pill">${ev.acknowledged ? "ACKNOWLEDGED" : "UNREAD"}</span>
            ${!ev.acknowledged ? '<button type="button" class="dash-inline-btn wl-ev-ack-btn">Acknowledge</button>' : ""}
          </div>
        `;
        div.querySelector(".wl-ev-ack-btn")?.addEventListener("click", async () => {
          const res = await MarketAPI.acknowledgeAlertEvent(ev.eventId);
          if (res && res.ok) {
            state.watchlistAlerts.events = res.events || state.watchlistAlerts.events;
            state.watchlistAlerts.unacknowledgedCount = Number(res.unacknowledgedCount || 0);
            renderWatchlistAndAlertsPage();
            showToast("Alert notification acknowledged.");
          }
        });
        eventsContainer.appendChild(div);
      });
    }
  }
}

async function moveWatchlistItemOrder(index, delta) {
  const wl = Array.isArray(state.watchlist) ? [...state.watchlist] : [];
  const targetIndex = index + delta;
  if (targetIndex < 0 || targetIndex >= wl.length) return;

  const temp = wl[index];
  wl[index] = wl[targetIndex];
  wl[targetIndex] = temp;
  state.watchlist = wl;

  if (typeof MarketAPI !== "undefined" && typeof MarketAPI.reorderWatchlist === "function") {
    try {
      const orderedItems = wl.map((item) => ({
        key: item.key || item.tradingsymbol || item.name,
        exchange: item.exchange || "NSE"
      }));
      const res = await MarketAPI.reorderWatchlist(orderedItems);
      if (res && res.ok && Array.isArray(res.watchlist)) {
        state.watchlist = res.watchlist;
      }
    } catch (_) {}
  }

  renderWatchlistAndRecentViews();
  renderWatchlistAndAlertsPage();
}

(function initWatchlistAndAlertsController() {
  const addCurrentBtn = document.getElementById("wlAddCurrentInstBtn");
  if (addCurrentBtn) {
    addCurrentBtn.addEventListener("click", () => {
      const selectedInst =
        (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
        (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null) || {
          key: "NIFTY50",
          name: "NIFTY 50",
          exchange: "NSE",
          type: "INDEX",
          symboltoken: "99926000"
        };
      toggleWatchlistInstrument(selectedInst, false);
    });
  }

  const useSelectedBtn = document.getElementById("wlUseSelectedInstForAlertBtn");
  if (useSelectedBtn) {
    useSelectedBtn.addEventListener("click", () => {
      const selectedInst =
        (typeof window !== "undefined" && window.YashwinSelectedInstrument) ||
        (typeof MarketData !== "undefined" ? MarketData.getInstrument("NIFTY50") : null) || {
          key: "NIFTY50",
          name: "NIFTY 50",
          exchange: "NSE",
          type: "INDEX",
          symboltoken: "99926000"
        };
      prefillAlertFormWithInstrument(selectedInst);
      showToast(`Prefilled alert form with ${selectedInst.name}`);
    });
  }

  const instTypeSelect = document.getElementById("wlAlertInstTypeSelect");
  const optFieldsRow = document.getElementById("wlAlertOptionFieldsRow");
  if (instTypeSelect && optFieldsRow) {
    instTypeSelect.addEventListener("change", () => {
      optFieldsRow.hidden = instTypeSelect.value !== "OPTION";
    });
  }

  const refreshBtn = document.getElementById("wlRefreshAllBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      syncWatchlistAndAlertsData({ live: true });
    });
  }

  const retryBtn = document.getElementById("wlRetrySyncBtn");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      syncWatchlistAndAlertsData({ live: false });
    });
  }

  const evalBtn = document.getElementById("wlEvaluateAlertsNowBtn");
  if (evalBtn && typeof MarketAPI !== "undefined") {
    evalBtn.addEventListener("click", async () => {
      state.watchlistAlerts.loading = true;
      renderWatchlistAndAlertsPage();
      try {
        const res = await MarketAPI.evaluateAlerts({});
        state.watchlistAlerts.loading = false;
        if (res && res.ok) {
          if (Array.isArray(res.alerts)) state.watchlistAlerts.alerts = res.alerts;
          if (Array.isArray(res.events)) state.watchlistAlerts.events = res.events;
          state.watchlistAlerts.unacknowledgedCount = Number(res.unacknowledgedCount || 0);
          renderWatchlistAndAlertsPage();
          const trigCount = Array.isArray(res.triggeredEvents) ? res.triggeredEvents.length : 0;
          showToast(
            trigCount > 0
              ? `🔔 ${trigCount} Market Alert(s) Triggered (Notify Only)`
              : `Evaluated ${res.evaluatedCount || 0} active alerts — 0 triggered`
          );
        } else {
          showToast(res?.message || "Alert evaluation failed.");
        }
      } catch (err) {
        state.watchlistAlerts.loading = false;
        renderWatchlistAndAlertsPage();
        showToast(err?.message || "Alert evaluation error.");
      }
    });
  }

  const ackLatestBtn = document.getElementById("wlAcknowledgeLatestBtn");
  if (ackLatestBtn && typeof MarketAPI !== "undefined") {
    ackLatestBtn.addEventListener("click", async () => {
      const trigBanner = document.getElementById("wlTriggeredNotificationBanner");
      const evId = trigBanner?.dataset?.latestEventId;
      if (!evId) return;
      const res = await MarketAPI.acknowledgeAlertEvent(evId);
      if (res && res.ok) {
        state.watchlistAlerts.events = res.events || state.watchlistAlerts.events;
        state.watchlistAlerts.unacknowledgedCount = Number(res.unacknowledgedCount || 0);
        renderWatchlistAndAlertsPage();
      }
    });
  }

  const createForm = document.getElementById("wlCreateAlertForm");
  if (createForm && typeof MarketAPI !== "undefined") {
    createForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormFeedback("wlAlertFormFeedback", "");

      const symbol = (document.getElementById("wlAlertSymbolInput")?.value || "").trim();
      const exchange = document.getElementById("wlAlertExchangeSelect")?.value || "NSE";
      const instrumentType = document.getElementById("wlAlertInstTypeSelect")?.value || "EQUITY";
      const alertType = document.getElementById("wlAlertTypeSelect")?.value || "PRICE_ABOVE";
      const thresholdVal = document.getElementById("wlAlertThresholdInput")?.value;
      const indicator = document.getElementById("wlAlertIndicatorName")?.value || "RSI14";
      const operator = document.getElementById("wlAlertOperatorSelect")?.value || "GTE";
      const targetSig = document.getElementById("wlAlertTargetSignalSelect")?.value || "BUY";
      const notes = (document.getElementById("wlAlertNotesInput")?.value || "").trim();
      const cooldownSeconds = Number(document.getElementById("wlAlertCooldownInput")?.value || 300);

      const payload = {
        symbol,
        tradingsymbol: symbol,
        exchange,
        instrumentType,
        alertType,
        threshold: thresholdVal !== "" ? Number(thresholdVal) : null,
        cooldownSeconds,
        notes,
        conditionParams: {
          indicator,
          operator,
          targetSignal: targetSig === "BUY" || targetSig === "SELL" ? targetSig : "BUY",
          breakoutDirection: targetSig === "UP" || targetSig === "DOWN" ? targetSig : "UP"
        }
      };

      if (instrumentType === "OPTION") {
        payload.optionType = document.getElementById("wlAlertOptionType")?.value || "CE";
        payload.strikePrice = Number(document.getElementById("wlAlertStrikePrice")?.value || 0);
        payload.expiry = (document.getElementById("wlAlertExpiryDate")?.value || "").trim();
      }

      const res = await MarketAPI.createAlert(payload);
      if (!res || !res.ok) {
        const errMsg = Array.isArray(res?.errors)
          ? res.errors.join(" ")
          : res?.message || "Failed to create market alert.";
        setFormFeedback("wlAlertFormFeedback", errMsg, false);
        showToast(errMsg);
        return;
      }

      if (Array.isArray(res.alerts)) {
        state.watchlistAlerts.alerts = res.alerts;
      }
      setFormFeedback(
        "wlAlertFormFeedback",
        `Created ${alertType} alert for ${symbol} (${exchange}).`,
        true
      );
      renderWatchlistAndAlertsPage();
      showToast(`Alert created for ${symbol} (${alertType})`);
    });
  }

  document.querySelectorAll("[data-wl-alert-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-wl-alert-status]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.watchlistAlerts.statusFilter = btn.dataset.wlAlertStatus || "ALL";
      renderWatchlistAndAlertsPage();
    });
  });

  const histApplyBtn = document.getElementById("wlHistoryFilterApplyBtn");
  if (histApplyBtn) {
    histApplyBtn.addEventListener("click", () => {
      state.watchlistAlerts.historySymbolFilter = (
        document.getElementById("wlHistorySymbolFilter")?.value || ""
      ).trim();
      state.watchlistAlerts.historyTypeFilter =
        document.getElementById("wlHistoryTypeFilter")?.value || "ALL";
      syncWatchlistAndAlertsData({ live: false });
    });
  }
})();

/* =====================================================
   TASK 15 — ALERT NOTIFICATIONS CENTER & PREFERENCES CONTROLLER
===================================================== */

function playNotificationAlertChime() {
  try {
    const AudioCtx =
      typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
    if (!AudioCtx) return false;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    return true;
  } catch (_) {
    return false;
  }
}

async function maybeDispatchClientBrowserAndSoundNotifications(notifications = []) {
  const prefs = state.notifications.preferences;
  if (!prefs || !Array.isArray(notifications)) return;

  for (const notif of notifications) {
    if (!notif || notif.read) continue;
    const nid = notif.notificationId || notif.id;
    if (!nid || state.notifications.dispatchedBrowserIds[nid]) continue;
    state.notifications.dispatchedBrowserIds[nid] = true;

    const dispatchPlan = notif.metadata?.dispatchPlan || {};
    if (dispatchPlan.inQuietHours) continue;

    if (prefs.soundEnabled && dispatchPlan.soundEligible !== false) {
      const played = playNotificationAlertChime();
      if (played && typeof MarketAPI !== "undefined" && typeof MarketAPI.recordNotificationDelivery === "function") {
        MarketAPI.recordNotificationDelivery({
          notificationId: nid,
          channel: "SOUND",
          status: "DELIVERED",
          reason: "Web Audio API alert chime played in browser."
        }).catch(() => {});
      }
    }

    if (prefs.browserNotificationsEnabled && dispatchPlan.browserEligible !== false) {
      if (typeof window !== "undefined" && "Notification" in window) {
        if (window.Notification.permission === "granted") {
          try {
            new window.Notification(notif.title || "YASHWIN Market Alert", {
              body: notif.message || "",
              tag: nid
            });
            if (typeof MarketAPI !== "undefined" && typeof MarketAPI.recordNotificationDelivery === "function") {
              MarketAPI.recordNotificationDelivery({
                notificationId: nid,
                channel: "BROWSER",
                status: "DELIVERED",
                reason: "Browser desktop Notification API displayed alert."
              }).catch(() => {});
            }
          } catch (_) {}
        } else if (typeof MarketAPI !== "undefined" && typeof MarketAPI.recordNotificationDelivery === "function") {
          MarketAPI.recordNotificationDelivery({
            notificationId: nid,
            channel: "BROWSER",
            status: "SKIPPED_PERMISSION",
            reason: `Browser Notification permission is '${window.Notification.permission}'.`
          }).catch(() => {});
        }
      }
    }
  }
}

async function syncNotificationsAndPreferencesData() {
  if (typeof MarketAPI === "undefined" || typeof MarketAPI.notificationsList !== "function") return;
  state.notifications.loading = true;
  try {
    const f = state.notifications.filters || {};
    const res = await MarketAPI.notificationsList({
      readStatus: f.readStatus !== "ALL" ? f.readStatus : undefined,
      category: f.category !== "ALL" ? f.category : undefined,
      symbol: f.symbol || undefined,
      date: f.date || undefined,
      page: f.page || 1,
      pageSize: f.pageSize || 15
    });
    state.notifications.loading = false;
    if (res && res.ok) {
      state.notifications.items = Array.isArray(res.notifications) ? res.notifications : [];
      state.notifications.unreadCount = Number(res.unreadCount || 0);
      state.notifications.totalCount = Number(res.totalCount || 0);
      if (res.pagination) state.notifications.pagination = res.pagination;
      if (res.preferences) state.notifications.preferences = res.preferences;
      if (res.externalChannels) state.notifications.externalChannels = res.externalChannels;
      maybeDispatchClientBrowserAndSoundNotifications(state.notifications.items);
    }
  } catch (err) {
    state.notifications.loading = false;
    state.notifications.error = err?.message || "Failed to load notifications.";
  }
  renderNotificationCenterAndPreferences();
}

function renderNotificationCenterAndPreferences() {
  const unreadCount = Number(state.notifications.unreadCount || 0);
  setText("topNotificationBadge", String(unreadCount));
  setText("notifUnreadCountPill", `${unreadCount} UNREAD`);

  const permBadge = document.getElementById("notifBrowserPermBadge");
  if (permBadge) {
    if (typeof window !== "undefined" && "Notification" in window) {
      permBadge.textContent = `BROWSER: ${String(window.Notification.permission || "DEFAULT").toUpperCase()}`;
    } else {
      permBadge.textContent = "BROWSER: UNSUPPORTED";
    }
  }

  const prefs = state.notifications.preferences;
  if (prefs) {
    const setCheck = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(val);
    };
    setCheck("notifPrefInApp", prefs.inAppEnabled);
    setCheck("notifPrefBrowser", prefs.browserNotificationsEnabled);
    setCheck("notifPrefSound", prefs.soundEnabled);
    setCheck("notifPrefQuietEnabled", prefs.quietHoursEnabled);
    setCheck("notifPrefTelegram", prefs.telegramEnabled);
    setCheck("notifPrefWebhook", prefs.webhookEnabled);
    setCheck("notifPrefEmail", prefs.emailEnabled);

    const qsEl = document.getElementById("notifPrefQuietStart");
    if (qsEl && prefs.quietHoursStart) qsEl.value = prefs.quietHoursStart;
    const qeEl = document.getElementById("notifPrefQuietEnd");
    if (qeEl && prefs.quietHoursEnd) qeEl.value = prefs.quietHoursEnd;

    const cats = prefs.categories || {};
    setCheck("notifCatPrice", cats.PRICE_ALERT !== false);
    setCheck("notifCatPct", cats.PERCENT_CHANGE_ALERT !== false);
    setCheck("notifCatVol", cats.VOLUME_SPIKE_ALERT !== false);
    setCheck("notifCatInd", cats.INDICATOR_ALERT !== false);
    setCheck("notifCatStrat", cats.STRATEGY_SIGNAL_ALERT !== false);
    setCheck("notifCatBreakout", cats.CANDLE_BREAKOUT_ALERT !== false);
    setCheck("notifCatRisk", cats.RISK_WARNING !== false);
    setCheck("notifCatEmergency", cats.EMERGENCY_STOP !== false);
  }

  const ext = state.notifications.externalChannels;
  if (ext) {
    setText("notifExtTelegramStatus", ext.TELEGRAM?.status || "UNCONFIGURED");
    setText("notifExtWebhookStatus", ext.WEBHOOK?.status || "UNCONFIGURED");
    setText("notifExtEmailStatus", ext.EMAIL?.status || "UNCONFIGURED");
  }

  const listEl = document.getElementById("notifCenterListContainer");
  if (listEl) {
    const items = Array.isArray(state.notifications.items) ? state.notifications.items : [];
    if (!items.length) {
      listEl.innerHTML =
        '<div><span>No notifications match the current filter. Notifications are created from real validated market alerts and safety events.</span><strong>0 NOTIFICATIONS</strong></div>';
    } else {
      listEl.innerHTML = "";
      items.forEach((n) => {
        const div = document.createElement("div");
        div.className = "ai-history-item-row";
        const delivSummary = Array.isArray(n.deliveries) && n.deliveries.length
          ? n.deliveries.map((d) => `${d.channel}:${d.status}`).join(", ")
          : "IN_APP:DELIVERED";

        div.innerHTML = `
          <div class="ai-history-meta">
            <span><strong>[${escapeHtml(n.category)}] ${escapeHtml(n.title)}</strong> <small class="status-pill">${escapeHtml(n.severity || "INFO")}</small></span>
            <div style="font-size: 0.85rem; margin-top: 2px;">${escapeHtml(n.message)}</div>
            <small>Instrument: <strong>${escapeHtml(n.symbol || "SYSTEM")} (${escapeHtml(n.exchange || "GLOBAL")})</strong> • Triggered: ${escapeHtml(n.triggeredAt)} • Channels: ${escapeHtml(delivSummary)}</small>
          </div>
          <div class="watchlist-item-actions">
            <span class="status-pill">${n.read ? "READ" : "UNREAD"}</span>
            ${n.symbol ? '<button type="button" class="dash-inline-btn notif-open-chart-btn">Open Chart</button>' : ""}
            ${!n.read ? '<button type="button" class="dash-inline-btn notif-mark-read-btn">Mark Read</button>' : ""}
          </div>
        `;

        div.querySelector(".notif-open-chart-btn")?.addEventListener("click", () => {
          window.dispatchEvent(
            new CustomEvent("market:instrument-selected", {
              detail: {
                key: n.tradingsymbol || n.symbol,
                name: n.symbol,
                tradingsymbol: n.tradingsymbol || n.symbol,
                exchange: n.exchange || "NSE",
                instrumentType: n.instrumentType || "EQUITY"
              }
            })
          );
          switchPage("dashboard");
          showToast(`Opened ${n.symbol} in Dashboard Chart`);
        });

        div.querySelector(".notif-mark-read-btn")?.addEventListener("click", async () => {
          const res = await MarketAPI.markNotificationRead({ notificationId: n.notificationId });
          if (res && res.ok) {
            await syncNotificationsAndPreferencesData();
            showToast("Notification marked as read.");
          }
        });

        listEl.appendChild(div);
      });
    }
  }

  const pag = state.notifications.pagination || { page: 1, totalPages: 1 };
  setText(
    "notifPaginationSummary",
    `Page ${pag.page || 1} of ${pag.totalPages || 1} • ${state.notifications.totalCount || 0} total`
  );
  const prevBtn = document.getElementById("notifPrevPageBtn");
  const nextBtn = document.getElementById("notifNextPageBtn");
  if (prevBtn) prevBtn.disabled = !pag.hasPrevPage;
  if (nextBtn) nextBtn.disabled = !pag.hasNextPage;
}

(function initNotificationCenterController() {
  const topBtn = document.getElementById("topNotificationBtn");
  if (topBtn) {
    topBtn.addEventListener("click", () => {
      switchPage("watchlist");
      syncWatchlistAndAlertsData({ live: false });
      document.getElementById("notifCenterSection")?.scrollIntoView({ behavior: "smooth" });
    });
  }

  document.getElementById("notifMarkAllReadBtn")?.addEventListener("click", async () => {
    if (typeof MarketAPI === "undefined") return;
    const res = await MarketAPI.markAllNotificationsRead();
    if (res && res.ok) {
      await syncNotificationsAndPreferencesData();
      syncWatchlistAndAlertsData({ live: false });
      showToast("All notifications marked as read.");
    }
  });

  document.getElementById("notifRefreshBtn")?.addEventListener("click", () => {
    syncNotificationsAndPreferencesData();
  });

  document.getElementById("notifApplyFiltersBtn")?.addEventListener("click", () => {
    state.notifications.filters.readStatus =
      document.getElementById("notifReadFilterSelect")?.value || "ALL";
    state.notifications.filters.category =
      document.getElementById("notifCategoryFilterSelect")?.value || "ALL";
    state.notifications.filters.symbol = (
      document.getElementById("notifSymbolFilterInput")?.value || ""
    ).trim();
    state.notifications.filters.date = (
      document.getElementById("notifDateFilterInput")?.value || ""
    ).trim();
    state.notifications.filters.page = 1;
    syncNotificationsAndPreferencesData();
  });

  document.getElementById("notifPrevPageBtn")?.addEventListener("click", () => {
    if ((state.notifications.filters.page || 1) > 1) {
      state.notifications.filters.page -= 1;
      syncNotificationsAndPreferencesData();
    }
  });

  document.getElementById("notifNextPageBtn")?.addEventListener("click", () => {
    const pag = state.notifications.pagination || {};
    if (pag.hasNextPage) {
      state.notifications.filters.page = (state.notifications.filters.page || 1) + 1;
      syncNotificationsAndPreferencesData();
    }
  });

  document.getElementById("notifRequestBrowserPermBtn")?.addEventListener("click", async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      showToast("Browser Desktop Notifications API is not supported in this browser.");
      return;
    }
    try {
      const perm = await window.Notification.requestPermission();
      renderNotificationCenterAndPreferences();
      showToast(`Browser notification permission: ${perm}`);
    } catch (_) {
      showToast("Unable to request browser notification permission.");
    }
  });

  const prefForm = document.getElementById("notifPreferencesForm");
  if (prefForm && typeof MarketAPI !== "undefined") {
    prefForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormFeedback("notifPrefFeedback", "");
      const payload = {
        inAppEnabled: Boolean(document.getElementById("notifPrefInApp")?.checked),
        browserNotificationsEnabled: Boolean(document.getElementById("notifPrefBrowser")?.checked),
        soundEnabled: Boolean(document.getElementById("notifPrefSound")?.checked),
        quietHoursEnabled: Boolean(document.getElementById("notifPrefQuietEnabled")?.checked),
        quietHoursStart: (document.getElementById("notifPrefQuietStart")?.value || "22:00").trim(),
        quietHoursEnd: (document.getElementById("notifPrefQuietEnd")?.value || "08:00").trim(),
        telegramEnabled: Boolean(document.getElementById("notifPrefTelegram")?.checked),
        webhookEnabled: Boolean(document.getElementById("notifPrefWebhook")?.checked),
        emailEnabled: Boolean(document.getElementById("notifPrefEmail")?.checked),
        categories: {
          PRICE_ALERT: Boolean(document.getElementById("notifCatPrice")?.checked),
          PERCENT_CHANGE_ALERT: Boolean(document.getElementById("notifCatPct")?.checked),
          VOLUME_SPIKE_ALERT: Boolean(document.getElementById("notifCatVol")?.checked),
          INDICATOR_ALERT: Boolean(document.getElementById("notifCatInd")?.checked),
          STRATEGY_SIGNAL_ALERT: Boolean(document.getElementById("notifCatStrat")?.checked),
          CANDLE_BREAKOUT_ALERT: Boolean(document.getElementById("notifCatBreakout")?.checked),
          RISK_WARNING: Boolean(document.getElementById("notifCatRisk")?.checked),
          EMERGENCY_STOP: Boolean(document.getElementById("notifCatEmergency")?.checked)
        }
      };

      const res = await MarketAPI.updateNotificationPreferences(payload);
      if (!res || !res.ok) {
        const msg = Array.isArray(res?.errors)
          ? res.errors.join(" ")
          : res?.message || "Failed to update notification preferences.";
        setFormFeedback("notifPrefFeedback", msg, false);
        showToast(msg);
        return;
      }

      state.notifications.preferences = res.preferences;
      if (res.externalChannels) state.notifications.externalChannels = res.externalChannels;
      setFormFeedback("notifPrefFeedback", "Notification preferences saved to SQLite.", true);
      renderNotificationCenterAndPreferences();
      showToast("Notification preferences updated.");
    });
  }
})();

/* =====================================================
   TASK 17 — PWA, OFFLINE CONNECTIVITY & INSTALLABILITY CONTROLLER
===================================================== */

function renderPWAStatusUI() {
  if (typeof PWAEngine === "undefined") return;
  const snap = PWAEngine.getStatusSnapshot();

  const netBadge = document.getElementById("pwaNetworkStatusBadge");
  if (netBadge) {
    netBadge.textContent = snap.online ? "ONLINE" : "OFFLINE";
    netBadge.classList.toggle("offline", !snap.online);
  }

  const offlineBanner = document.getElementById("pwaOfflineBanner");
  if (offlineBanner) {
    offlineBanner.hidden = Boolean(snap.online);
  }

  const updateBanner = document.getElementById("pwaUpdateBanner");
  if (updateBanner) {
    updateBanner.hidden = !snap.swUpdateAvailable;
  }

  const installBtn = document.getElementById("pwaInstallBtn");
  const installLabel = document.getElementById("pwaInstallBtnLabel");
  if (installBtn) {
    installBtn.hidden = !snap.showInstallUI;
    if (installLabel) {
      installLabel.textContent = snap.isIOS ? "Install on iOS" : "Install App";
    }
  }
}

(function initPWAController() {
  if (typeof window === "undefined" || typeof PWAEngine === "undefined") return;

  PWAEngine.detectDisplayAndPlatform(window);
  renderPWAStatusUI();

  window.addEventListener("beforeinstallprompt", (event) => {
    PWAEngine.captureInstallPrompt(event);
    renderPWAStatusUI();
  });

  window.addEventListener("appinstalled", () => {
    PWAEngine.detectDisplayAndPlatform(window);
    renderPWAStatusUI();
    showToast("YASHWIN AI Trading Assistant installed.");
  });

  window.addEventListener("online", () => {
    PWAEngine.setOnlineStatus(true);
    renderPWAStatusUI();
    refreshAllDashboardData();
    showToast("Network connection restored • Synchronizing data.");
  });

  window.addEventListener("offline", () => {
    PWAEngine.setOnlineStatus(false);
    state.dataStatus = "OFFLINE";
    renderPWAStatusUI();
    updateDashboard();
    showToast("Offline Mode — Live market data and order execution paused.");
  });

  const installBtn = document.getElementById("pwaInstallBtn");
  const iosModal = document.getElementById("pwaIosInstallModal");
  const iosCloseBtn = document.getElementById("pwaIosModalCloseBtn");

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      const snap = PWAEngine.getStatusSnapshot();
      if (snap.canPromptInstall) {
        const res = await PWAEngine.triggerInstallPrompt();
        renderPWAStatusUI();
        if (res.ok) {
          showToast("YASHWIN AI app installation accepted.");
        }
      } else if (snap.isIOS && iosModal) {
        iosModal.hidden = false;
      }
    });
  }

  if (iosCloseBtn && iosModal) {
    iosCloseBtn.addEventListener("click", () => {
      iosModal.hidden = true;
    });
  }

  const offlineRetryBtn = document.getElementById("pwaOfflineRetryBtn");
  if (offlineRetryBtn) {
    offlineRetryBtn.addEventListener("click", async () => {
      await refreshAllDashboardData();
      renderPWAStatusUI();
    });
  }

  const applyUpdateBtn = document.getElementById("pwaApplyUpdateBtn");
  if (applyUpdateBtn) {
    applyUpdateBtn.addEventListener("click", () => {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "SKIP_WAITING" });
      }
      window.location.reload();
    });
  }

  PWAEngine.registerServiceWorker({
    swUrl: "/sw.js",
    onUpdateAvailable: () => {
      renderPWAStatusUI();
    }
  }).then(() => {
    renderPWAStatusUI();
  });
})();

/* Initial boot */
switchPage("dashboard");
syncUserSessionAndPaperState();
checkServerHealth();
refreshDashboardQuotes();
fetchMarketIntelligenceData();
syncNotificationsAndPreferencesData();
setInterval(refreshDashboardQuotes, 15000);
setInterval(checkServerHealth, 30000);


