const state = {
  nifty: null,
  bank: null,
  pnl: 0,
  signal: "DATA WAITING",
  confidence: null
};

const pageTitles = {
  dashboard: ["Dashboard", "AI-powered market monitoring"],
  scanner: ["Market Scanner", "Scan market conditions"],
  analysis: ["AI Analysis", "Market intelligence and signals"],
  strategy: ["Strategy", "Build and test trading rules"],
  paper: ["Paper Trading", "Virtual trading environment"],
  positions: ["Positions", "Open paper positions"],
  orders: ["Orders", "Paper order history"],
  risk: ["Risk Controls", "Protect the trading account"],
  history: ["Trade History", "Historical paper trades"]
};

function money(value) {
  return "₹" + Number(value).toFixed(2);
}

function updateDashboard() {
  document.getElementById("niftyValue").textContent =
    state.nifty === null
      ? "--"
      : Number(state.nifty).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });

  document.getElementById("bankValue").textContent =
    state.bank === null
      ? "--"
      : Number(state.bank).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });

  document.getElementById("pnl").textContent = money(state.pnl);
  document.getElementById("signal").textContent = state.signal;
  document.getElementById("bigSignal").textContent = state.signal;
  document.getElementById("confidence").textContent =
    state.confidence === null ? "--%" : state.confidence + "%";

  document.getElementById("meterFill").style.width =
    state.confidence === null
      ? "0%"
      : Math.max(0, Math.min(100, Number(state.confidence) || 0)) + "%";
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

  for (const [key, query] of requests) {
    try {
      const result = await MarketAPI.quote("NSE", query);

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
          state[key] = Number(validation.quote.price);
        }
      }
    } catch (error) {
      /*
       * Quote failures must never create fake prices or trading signals.
       * Keep the last validated value, or "--" when no validated quote exists.
       */
    }
  }

  updateDashboard();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item")
      .forEach(item => item.classList.remove("active"));

    button.classList.add("active");

    const page = button.dataset.page;
    const info = pageTitles[page];

    document.getElementById("pageTitle").textContent = info[0];
    document.getElementById("pageSubtitle").textContent = info[1];

    if (page !== "dashboard") {
      showToast(info[0] + " module selected");
    }
  });
});

document.getElementById("emergencyBtn").addEventListener("click", () => {
  showToast("Emergency Stop activated — live trading is disabled.");
});

document.getElementById("timeframe").addEventListener("change", event => {
  showToast("Timeframe changed to " + event.target.value);
});

function simulateMarket() {
  /*
   * Simulation is NOT allowed to create AI trading signals.
   * Until validated real market data is connected:
   *
   * DATA WAITING
   * NO TRADE
   *
   * Paper-trading simulation remains separate.
   */

  state.signal = "DATA WAITING";
  state.confidence = null;

  const trendElement = document.getElementById("trend");
  const analysisElement = document.getElementById("analysisText");

  if (trendElement) {
    trendElement.textContent = "Waiting";
  }

  if (analysisElement) {
    analysisElement.textContent =
      "Waiting for validated market data. No AI trading signal is generated.";
  }

  updateDashboard();
}

updateDashboard();
refreshDashboardQuotes();

setInterval(simulateMarket, 4000);
setInterval(refreshDashboardQuotes, 15000);

/* Mobile navigation */
document.querySelectorAll(".mobile-nav-item").forEach(button => {
  button.addEventListener("click", () => {

    document.querySelectorAll(".mobile-nav-item")
      .forEach(item => item.classList.remove("active"));

    button.classList.add("active");

    const page = button.dataset.page;
    const info = pageTitles[page];

    if (info) {
      document.getElementById("pageTitle").textContent = info[0];
      document.getElementById("pageSubtitle").textContent = info[1];

      if (page !== "dashboard") {
        showToast(info[0] + " module selected");
      }
    }
  });
});

/* =====================================================
   PAPER TRADING UI CONTROLLER
   Virtual trading only - NO broker orders
===================================================== */

(() => {
  const $ = id => document.getElementById(id);

  if (typeof PaperTrading === "undefined" || !$("paperPage")) {
    console.warn("Paper Trading UI not ready");
    return;
  }

  let direction = "BUY";

  const money = value =>
    "₹" + Number(value || 0).toLocaleString("en-IN", {
      maximumFractionDigits: 2
    });

  function values() {
    const assetType = String($("paperAssetType")?.value || "EQUITY").toUpperCase();

    const qty = Number($("paperQty")?.value);
    const lotSize = Number($("paperLotSize")?.value);
    const lots = Number($("paperLots")?.value);

    const effectiveQuantity = assetType === "OPTION"
      ? lotSize * lots
      : qty;

    const selectedInstrument =
      window.YashwinSelectedInstrument || {};

    const optionType = String(
      selectedInstrument.optionType || ""
    ).trim().toUpperCase();

    return {
      entry: Number($("paperEntry").value),
      qty,
      stop: Number($("paperStop").value),
      target: Number($("paperTarget").value),
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

    $("paperEquityQuantityGroup").hidden = option;
    $("paperOptionQuantityGroup").hidden = !option;

    if ($("paperQty")) {
      $("paperQty").disabled = option;
    }

    if ($("paperLotSize")) {
      $("paperLotSize").disabled = !option;
    }

    if ($("paperLots")) {
      $("paperLots").disabled = !option;
    }

    $("paperEffectiveQty").textContent =
      Number.isFinite(v.effectiveQuantity) && v.effectiveQuantity > 0
        ? v.effectiveQuantity
        : "0";

    updatePreview();
  }

  function updatePreview() {
    const v = values();

    const quantityValid = v.assetType === "OPTION"
      ? Number.isInteger(v.lotSize) &&
        v.lotSize > 0 &&
        Number.isInteger(v.lots) &&
        v.lots > 0
      : Number.isFinite(v.qty) && v.qty > 0;

    if (
      !Number.isFinite(v.entry) ||
      !Number.isFinite(v.stop) ||
      !Number.isFinite(v.target) ||
      v.entry <= 0 ||
      v.stop <= 0 ||
      v.target <= 0 ||
      !quantityValid
    ) {
      $("paperRisk").textContent = "₹0";
      $("paperReward").textContent = "₹0";
      $("paperRR").textContent = "0.00";
      return;
    }

    const preview = PaperTrading.preview(
      v.entry,
      v.stop,
      v.target,
      v.qty,
      {
        assetType: v.assetType,
        lotSize: v.lotSize,
        lots: v.lots
      }
    );

    $("paperRisk").textContent = money(preview.risk);
    $("paperReward").textContent = money(preview.reward);
    $("paperRR").textContent =
      Number.isFinite(preview.rr) ? preview.rr.toFixed(2) : "0.00";

    if ($("paperEffectiveQty")) {
      $("paperEffectiveQty").textContent =
        preview.effectiveQuantity || "0";
    }
  }

  [
    "paperAssetType",
    "paperEntry",
    "paperQty",
    "paperLotSize",
    "paperLots",
    "paperStop",
    "paperTarget"
  ].forEach(id => {
    const element = $(id);
    if (element) {
      element.addEventListener("input", updatePreview);
      element.addEventListener("change", updatePreview);
    }
  });

  $("paperAssetType").addEventListener("change", updateAssetTypeUI);

  document.querySelectorAll(".trade-direction").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".trade-direction")
        .forEach(b => b.classList.remove("active"));

      button.classList.add("active");
      direction = button.dataset.direction;

      updatePreview();
    });
  });

  function renderState() {
    const state = PaperTrading.getState();

    $("paperDailyPnl").textContent = money(state.dailyPnl);
    $("paperTradesToday").textContent =
      `${state.tradesToday} / ${state.maxTradesPerDay}`;

    if (!state.position) {
      $("paperNoPosition").hidden = false;
      $("paperPosition").hidden = true;
      $("paperPositionStatus").textContent = "NO POSITION";
      return;
    }

    const p = state.position;
    const effectiveQty = Number(p.effectiveQty || p.qty || 0);

    $("paperNoPosition").hidden = true;
    $("paperPosition").hidden = false;

    $("paperPositionStatus").textContent = "OPEN";
    $("paperPositionSide").textContent = p.direction;
    $("paperPositionSymbol").textContent = p.symbol;
    $("paperPositionEntry").textContent = money(p.entry);
    $("paperPositionCurrent").textContent = money(p.current);

    $("paperPositionQty").textContent = effectiveQty;

    $("paperPositionValue").textContent =
      money(p.positionValue || (p.entry * effectiveQty));

    $("paperProfitMilestone").textContent =
      money(p.profitStep || 0);

    $("paperLockedProfit").textContent =
      money(p.lockedProfit || 0);

    $("paperNextMilestone").textContent =
      money(p.nextProfitMilestone || 0);

    const pnl = p.direction === "BUY"
      ? (p.current - p.entry) * effectiveQty
      : (p.entry - p.current) * effectiveQty;

    $("paperPositionPnl").textContent = money(pnl);
  }

  $("openPaperTrade").addEventListener("click", () => {
    const v = values();

    const quantityValid = v.assetType === "OPTION"
      ? Number.isInteger(v.lotSize) &&
        v.lotSize > 0 &&
        Number.isInteger(v.lots) &&
        v.lots > 0
      : Number.isFinite(v.qty) && v.qty > 0;

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

    const riskCheck = RiskEngine.evaluate({
      side: direction,
      entry: v.entry,
      stop: v.stop,
      quantity: v.qty,
      assetType: v.assetType,
      lotSize: v.lotSize,
      lots: v.lots,
      dailyPnl: paperState.dailyPnl,
      tradesToday: paperState.tradesToday,
      openPositions: paperState.position ? 1 : 0,
      averaging: false,
      emergencyStop: false
    });

    if (!riskCheck.allowed) {
      showToast(
        "TRADE BLOCKED • " + riskCheck.reasons.join(" ")
      );
      return;
    }

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
      riskCheck,
      optionType: v.optionType,
      emergencyStop: false,
      averaging: false
    });

    if (!aiGate.allowed) {
      showToast(
        "AI SAFETY BLOCKED • " + aiGate.reasons.join(" ")
      );
      return;
    }

    const result = PaperTrading.openPosition({
      symbol: $("paperSymbol").value,
      direction,
      entry: v.entry,
      stop: v.stop,
      target: v.target,
      qty: v.qty,
      assetType: v.assetType,
      lotSize: v.lotSize,
      lots: v.lots
    });

    if (!result.ok) {
      showToast(result.reason);
      return;
    }

    showToast(
      `${direction} ${v.assetType} paper trade opened • ` +
      `Qty ${result.preview.effectiveQuantity} • ` +
      `Risk ${money(result.preview.risk)}`
    );

    renderState();
  });

  $("closePaperTrade").addEventListener("click", () => {
    const state = PaperTrading.getState();

    if (!state.position) return;

    const result = PaperTrading.closePosition(
      state.position.current,
      "MANUAL"
    );

    if (result.ok) {
      showToast(`Paper trade closed • P&L ${money(result.pnl)}`);
      renderState();
    }
  });

  /* Dynamic paper price + profit protection */
  setInterval(() => {
    const state = PaperTrading.getState();

    if (!state.position) return;

    const p = state.position;

    const movement =
      (Math.random() - 0.5) *
      Math.max(Math.abs(p.entry * 0.002), 1);

    const price = Math.max(0.05, p.current + movement);
    const result = PaperTrading.updatePrice(price);

    renderState();

    if (!result) return;

    if (result.action === "PROFIT_LOCK") {
      const closed = PaperTrading.closePosition(
        p.current,
        "PROFIT_LOCK"
      );

      if (closed.ok) {
        showToast(
          `PROFIT LOCK • Locked ${money(result.lockedProfit)} • P&L ${money(closed.pnl)}`
        );
        renderState();
      }

      return;
    }

    if (result.action === "STOP_LOSS") {
      const closed = PaperTrading.closePosition(
        p.current,
        "STOP_LOSS"
      );

      if (closed.ok) {
        showToast(`STOP LOSS • ${money(closed.pnl)}`);
        renderState();
      }

      return;
    }

    if (result.action === "TARGET_ACTIVATED") {
      showToast(
        `TARGET REACHED • Holding for stronger move • P&L ${money(result.pnl)}`
      );
      renderState();
      return;
    }

    if (result.action === "AI_REANALYZE") {
      showToast(
        `AI RE-ANALYSIS • Profit ${money(result.pnl)} • ` +
        `Next milestone ${money(result.nextProfitMilestone)}`
      );
      renderState();
      return;
    }

    if (result.action === "HOLD" && result.lockedProfit > 0) {
      showToast(
        `Profit protected • ${money(result.lockedProfit)} locked`
      );
    }
  }, 1500);

  updateAssetTypeUI();
  renderState();
})();

/* =====================================================
   REAL PAGE SWITCHING
===================================================== */

(() => {
  const dashboardPage = document.querySelector(".content");
  const paperPage = document.getElementById("paperPage");

  function switchPage(page) {
    if (!dashboardPage || !paperPage) return;

    if (page === "paper") {
      dashboardPage.hidden = true;
      paperPage.hidden = false;
    } else {
      paperPage.hidden = true;
      dashboardPage.hidden = false;
    }

    const info = pageTitles[page];

    if (info) {
      document.getElementById("pageTitle").textContent = info[0];
      document.getElementById("pageSubtitle").textContent = info[1];
    }
  }

  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
      const page = button.dataset.page;

      document.querySelectorAll(".nav-item")
        .forEach(item => item.classList.remove("active"));

      button.classList.add("active");

      switchPage(page);
    });
  });

  document.querySelectorAll(".mobile-nav-item").forEach(button => {
    button.addEventListener("click", () => {
      const page = button.dataset.page;

      document.querySelectorAll(".mobile-nav-item")
        .forEach(item => item.classList.remove("active"));

      button.classList.add("active");

      switchPage(page);
    });
  });

  switchPage("dashboard");
})();

/* =========================
   MARKET SEARCH CONTROLLER
========================= */

(function initMarketSearch() {
  if (typeof MarketSearch === "undefined") return;

  const topInput = document.getElementById("marketSearch");
  const topResults = document.getElementById("marketSearchResults");

  const pageInput = document.getElementById("marketSearchPage");
  const pageResults = document.getElementById("marketSearchPageResults");

  function selectInstrument(item) {
    if (topInput) topInput.value = item.name;

    if (topResults) {
      topResults.hidden = true;
    }

    if (pageInput) {
      pageInput.value = item.name;
    }

    if (pageResults) {
      MarketSearch.render(
        [item],
        pageResults,
        selectInstrument
      );
    }

    if (typeof window.showToast === "function") {
      window.showToast(
        `${item.name} • ${item.exchange} • ${item.type}`
      );
    }
  }

  async function bindSearch(input, results, hideAfterSelect = false) {
    if (!input || !results) return;

    async function update() {
      const query = input.value;
      const localFound = MarketSearch.search(query);

      MarketSearch.render(localFound, results, item => {
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

      const brokerFound = await MarketSearch.searchAsync(
        query,
        exchange
      );

      if (String(input.value || "").trim() !== String(query || "").trim()) {
        return;
      }

      MarketSearch.render(brokerFound, results, item => {
        selectInstrument(item);

        if (hideAfterSelect) {
          results.hidden = true;
        }
      });

      results.hidden = false;
    }

    input.addEventListener("input", update);
    input.addEventListener("focus", update);

    input.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        results.hidden = true;
      }
    });
  }

  bindSearch(topInput, topResults, true);
  bindSearch(pageInput, pageResults, false);

  document.querySelectorAll(".instrument-chip").forEach(button => {
    button.addEventListener("click", () => {
      const key = button.dataset.instrument;
      const item = MarketData.getInstrument(key);

      if (item) {
        selectInstrument(item);
      }
    });
  });

  document.addEventListener("click", event => {
    if (
      topResults &&
      topInput &&
      !topResults.contains(event.target) &&
      event.target !== topInput
    ) {
      topResults.hidden = true;
    }
  });

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


/* =========================
   SELECTED INSTRUMENT BRIDGE
========================= */

(function initSelectedInstrumentBridge() {

  window.addEventListener("market:instrument-selected", event => {

    const item = event.detail;

    if (!item) return;

    window.YashwinSelectedInstrument = item;

    /* Create a clean market-data snapshot.
       No fake prices or trading decisions. */
    if (typeof MarketData !== "undefined") {
      try {
        window.YashwinMarketSnapshot =
          MarketData.emptySnapshot(item.key);
      } catch (error) {
        console.warn(
          "[YASHWIN] Market snapshot unavailable:",
          error
        );
        window.YashwinMarketSnapshot = null;
      }
    }

    try {
      localStorage.setItem(
        "yashwin_selected_instrument",
        JSON.stringify(item)
      );
    } catch (_) {}

    window.dispatchEvent(
      new CustomEvent("market:instrument-ready", {
        detail: {
          instrument: item,
          snapshot: window.YashwinMarketSnapshot || null
        }
      })
    );

    const title = document.getElementById("pageTitle");
    const subtitle = document.getElementById("pageSubtitle");

    if (title) {
      title.textContent = item.name;
    }

    if (subtitle) {
      subtitle.textContent =
        `${item.exchange} • ${item.type} • Market data ready`;
    }

    console.log(
      "[YASHWIN] Selected instrument:",
      item
    );
  });

})();


/* =========================
   SELECTED MARKET -> AI VIEW
========================= */

(function initSelectedMarketAI() {

  function updateAIFromSnapshot(snapshot, instrument) {
    const signal = document.getElementById("signal");
    const bigSignal = document.getElementById("bigSignal");
    const confidence = document.getElementById("confidence");
    const trend = document.getElementById("trend");
    const risk = document.getElementById("riskLevel");
    const analysisText = document.getElementById("analysisText");
    const meter = document.getElementById("meterFill");

    if (!snapshot || snapshot.dataReady !== true) {
      state.signal = "DATA WAITING";
      state.confidence = null;

      if (signal) signal.textContent = "DATA WAITING";
      if (bigSignal) bigSignal.textContent = "DATA WAITING";
      if (confidence) confidence.textContent = "--%";
      if (trend) trend.textContent = "Waiting";
      if (risk) risk.textContent = "HIGH";
      if (analysisText) {
        analysisText.textContent =
          `${instrument?.name || "Selected market"} selected. ` +
          `Waiting for validated market data before AI analysis.`;
      }
      if (meter) meter.style.width = "0%";
      return;
    }

    const input = {
      dataReady: true,
      trendScore: snapshot.indicators?.trendScore,
      momentumScore: snapshot.indicators?.momentumScore,
      volumeScore: snapshot.indicators?.volumeScore,
      vwapScore: snapshot.indicators?.vwapScore,
      supportResistanceScore:
        snapshot.indicators?.supportResistanceScore,
      volatilityScore:
        snapshot.indicators?.volatilityScore,
      optionsScore:
        typeof MarketAnalysis.calculateOptionScore === "function" &&
        snapshot.options?.available === true
          ? MarketAnalysis.calculateOptionScore(snapshot.options)
          : null,
      newsScore: snapshot.newsContext?.available
        ? snapshot.newsContext.score
        : null,
      breadthScore: snapshot.breadth?.available
        ? 0
        : null
    };

    if (typeof MarketAnalysis === "undefined") {
      return;
    }

    const result = MarketAnalysis.analyze(input);

    state.signal = result.signal;
    state.confidence = result.confidence;

    if (signal) signal.textContent = result.signal;
    if (bigSignal) bigSignal.textContent = result.signal;
    if (confidence) confidence.textContent =
      `${result.confidence}%`;
    if (trend) trend.textContent = result.trend;
    if (risk) risk.textContent = result.risk;

    if (meter) {
      meter.style.width =
        `${Math.max(0, Math.min(100, result.confidence))}%`;
    }

    if (analysisText) {
      analysisText.textContent =
        result.reasons.length
          ? result.reasons.join(" ")
          : "Market data analysed by the AI decision framework.";
    }
  }

  window.addEventListener(
    "market:instrument-ready",
    event => {
      const detail = event.detail || {};

      updateAIFromSnapshot(
        detail.snapshot,
        detail.instrument
      );
    }
  );

})();
