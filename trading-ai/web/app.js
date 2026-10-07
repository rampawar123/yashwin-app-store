const state = {
  nifty: 25000,
  bank: 55000,
  pnl: 0,
  signal: "NEUTRAL",
  confidence: 50
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
    state.nifty.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  document.getElementById("bankValue").textContent =
    state.bank.toLocaleString("en-IN", {
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

setInterval(simulateMarket, 4000);

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
    return {
      entry: Number($("paperEntry").value),
      qty: Number($("paperQty").value),
      stop: Number($("paperStop").value),
      target: Number($("paperTarget").value)
    };
  }

  function updatePreview() {
    const v = values();

    if (!v.entry || !v.qty || !v.stop || !v.target) {
      $("paperRisk").textContent = "₹0";
      $("paperReward").textContent = "₹0";
      $("paperRR").textContent = "0.00";
      return;
    }

    const preview = PaperTrading.preview(
      v.entry,
      v.stop,
      v.target,
      v.qty
    );

    $("paperRisk").textContent = money(preview.risk);
    $("paperReward").textContent = money(preview.reward);
    $("paperRR").textContent = preview.rr.toFixed(2);
  }

  ["paperEntry", "paperQty", "paperStop", "paperTarget"]
    .forEach(id => {
      $(id).addEventListener("input", updatePreview);
    });

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

    $("paperNoPosition").hidden = true;
    $("paperPosition").hidden = false;

    $("paperPositionStatus").textContent = "OPEN";
    $("paperPositionSide").textContent = p.direction;
    $("paperPositionSymbol").textContent = p.symbol;
    $("paperPositionEntry").textContent = money(p.entry);
    $("paperPositionCurrent").textContent = money(p.current);
    $("paperPositionQty").textContent = p.qty;

    $("paperPositionValue").textContent =
      money(p.positionValue || (p.entry * p.qty));

    $("paperProfitMilestone").textContent =
      money(p.profitStep || 0);

    $("paperLockedProfit").textContent =
      money(p.lockedProfit || 0);

    $("paperNextMilestone").textContent =
      money(p.nextProfitMilestone || 0);

    const pnl = p.direction === "BUY"
      ? (p.current - p.entry) * p.qty
      : (p.entry - p.current) * p.qty;

    $("paperPositionPnl").textContent = money(pnl);
  }

  $("openPaperTrade").addEventListener("click", () => {
    const v = values();

    if (
      !Number.isFinite(v.entry) ||
      !Number.isFinite(v.qty) ||
      !Number.isFinite(v.stop) ||
      !Number.isFinite(v.target) ||
      v.entry <= 0 ||
      v.qty <= 0 ||
      v.stop <= 0 ||
      v.target <= 0
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

    const result = PaperTrading.openPosition({
      symbol: $("paperSymbol").value,
      direction,
      entry: v.entry,
      stop: v.stop,
      target: v.target,
      qty: v.qty
    });

    if (!result.ok) {
      showToast(result.reason);
      return;
    }

    showToast(
      `${direction} paper trade opened • Risk ${money(result.preview.risk)}`
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
        `AI RE-ANALYSIS • Profit ${money(result.pnl)} • Next milestone ${money(result.nextProfitMilestone)}`
      );
      renderState();
      return;
    }

    if (result.action === "HOLD" &&
        result.lockedProfit > 0) {
      showToast(
        `Profit protected • ${money(result.lockedProfit)} locked`
      );
    }
  }, 1500);

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

  function bindSearch(input, results, hideAfterSelect = false) {
    if (!input || !results) return;

    function update() {
      const found = MarketSearch.search(input.value);

      MarketSearch.render(found, results, item => {
        selectInstrument(item);

        if (hideAfterSelect) {
          results.hidden = true;
        }
      });

      if (found.length) {
        results.hidden = false;
      } else {
        results.hidden = false;
      }
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
      optionsScore: snapshot.options?.available
        ? 0
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
