/*
 * YASHWIN AI Trading Assistant
 * Task 5 — Complete Candlestick Chart, Technical Indicator Series & Overlays Engine
 *
 * Strictly enforces:
 * - Zero fabricated candles, zero synthetic OHLC prices, zero fake indicators
 * - Supports all 8 backend intervals:
 *   ONE_MINUTE, THREE_MINUTE, FIVE_MINUTE, TEN_MINUTE,
 *   FIFTEEN_MINUTE, THIRTY_MINUTE, ONE_HOUR, ONE_DAY
 * - Integrates and displays calculated values & aligned series for:
 *   EMA 9, EMA 21, SMA 20, SMA 50, VWAP, RSI 14, MACD (12,26,9),
 *   ATR 14, Bollinger Bands (20,2), ADX 14, Support & Resistance,
 *   Breakout status, and Market Regime
 * - Interactive Zoom, Pan, and Crosshair/Hover inspection
 * - Chart Overlays for Current Validated Quote, Strategy/AI Entry, Stop-Loss,
 *   Target, and Open Paper Position Entry
 * - Explicit LOADING, EMPTY, DATA_UNAVAILABLE, INSUFFICIENT_CANDLES, and ERROR states
 */

const ChartEngine = (() => {
  const SUPPORTED_INTERVALS = [
    { id: "ONE_MINUTE", alias: "1m", label: "1 Min", description: "1 Minute" },
    { id: "THREE_MINUTE", alias: "3m", label: "3 Min", description: "3 Minutes" },
    { id: "FIVE_MINUTE", alias: "5m", label: "5 Min", description: "5 Minutes" },
    { id: "TEN_MINUTE", alias: "10m", label: "10 Min", description: "10 Minutes" },
    { id: "FIFTEEN_MINUTE", alias: "15m", label: "15 Min", description: "15 Minutes" },
    { id: "THIRTY_MINUTE", alias: "30m", label: "30 Min", description: "30 Minutes" },
    { id: "ONE_HOUR", alias: "1h", label: "1 Hour", description: "1 Hour" },
    { id: "ONE_DAY", alias: "1d", label: "1 Day", description: "1 Day" }
  ];

  const VALID_INTERVAL_SET = new Set(SUPPORTED_INTERVALS.map((i) => i.id));
  const ALIAS_MAP = SUPPORTED_INTERVALS.reduce((acc, item) => {
    acc[item.alias.toLowerCase()] = item.id;
    acc[item.id.toLowerCase()] = item.id;
    return acc;
  }, {});

  const DEFAULT_OVERLAY_TOGGLES = {
    ema9: true,
    ema21: true,
    sma20: false,
    sma50: false,
    vwap: true,
    bollinger: true,
    srLevels: true,
    tradeLevels: true,
    subchart: "RSI" // RSI | MACD | ATR_ADX | NONE
  };

  function normalizeInterval(raw = "FIVE_MINUTE") {
    const clean = String(raw || "FIVE_MINUTE").trim();
    const upper = clean.toUpperCase();
    if (VALID_INTERVAL_SET.has(upper)) return upper;
    const mapped = ALIAS_MAP[clean.toLowerCase()];
    return mapped || "FIVE_MINUTE";
  }

  function getIntervalMeta(intervalId = "FIVE_MINUTE") {
    const norm = normalizeInterval(intervalId);
    return (
      SUPPORTED_INTERVALS.find((i) => i.id === norm) || SUPPORTED_INTERVALS[2]
    );
  }

  function round2(n) {
    const num = Number(n);
    return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
  }

  function formatINR(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num <= 0) return "--";
    return (
      "₹" +
      num.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    );
  }

  function formatNumber(n, decimals = 2) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "--";
    return num.toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatVolume(v) {
    const num = Number(v);
    if (!Number.isFinite(num) || num < 0) return "--";
    if (num >= 10000000) return `${(num / 10000000).toFixed(2)} Cr`;
    if (num >= 100000) return `${(num / 100000).toFixed(2)} L`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)} K`;
    return String(Math.round(num));
  }

  function formatCandleTimestamp(isoStr, interval = "FIVE_MINUTE") {
    if (!isoStr) return "--";
    const ms = Date.parse(isoStr);
    if (!Number.isFinite(ms)) return String(isoStr);
    const d = new Date(ms);
    if (interval === "ONE_DAY") {
      return d.toISOString().slice(0, 10);
    }
    // Display in IST (+05:30)
    const istMs = ms + (5 * 60 + 30) * 60 * 1000;
    const ist = new Date(istMs);
    const dd = String(ist.getUTCDate()).padStart(2, "0");
    const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const hh = String(ist.getUTCHours()).padStart(2, "0");
    const min = String(ist.getUTCMinutes()).padStart(2, "0");
    return `${dd}/${mm} ${hh}:${min} IST`;
  }

  function sanitizeCandles(rawCandles = []) {
    if (!Array.isArray(rawCandles)) return [];
    const valid = [];
    for (let i = 0; i < rawCandles.length; i += 1) {
      const c = rawCandles[i];
      if (!c || typeof c !== "object") continue;
      const open = Number(c.open);
      const high = Number(c.high);
      const low = Number(c.low);
      const close = Number(c.close ?? c.price);
      const volume = Number.isFinite(Number(c.volume)) && Number(c.volume) >= 0 ? Number(c.volume) : 0;
      const timestamp = c.timestamp || c.time || c.date || null;

      if (
        timestamp &&
        Number.isFinite(open) &&
        Number.isFinite(high) &&
        Number.isFinite(low) &&
        Number.isFinite(close) &&
        open > 0 &&
        high > 0 &&
        low > 0 &&
        close > 0 &&
        high >= low &&
        high >= Math.max(open, close) &&
        low <= Math.min(open, close)
      ) {
        valid.push({
          index: valid.length,
          timestamp: String(timestamp),
          open: round2(open),
          high: round2(high),
          low: round2(low),
          close: round2(close),
          volume: Math.round(volume),
          bullish: close >= open
        });
      }
    }
    return valid;
  }

  /**
   * Builds a deterministic, complete Chart & Technical Indicators ViewModel
   * from real validated snapshot, candles, strategy, AI decision, and paper state.
   * Never fabricates candles or indicator values.
   */
  function buildChartViewModel(input = {}) {
    const interval = normalizeInterval(input.interval || "FIVE_MINUTE");
    const intervalMeta = getIntervalMeta(interval);
    const loading = Boolean(input.loading);
    const apiError = input.apiError ? String(input.apiError) : null;
    const snapshot = input.snapshot || null;
    const instrument = input.instrument || {
      key: snapshot?.instrument || "NIFTY50",
      name: snapshot?.name || "NIFTY 50",
      exchange: snapshot?.exchange || "NSE",
      type: snapshot?.type || "INDEX"
    };

    const rawCandles = Array.isArray(input.candles)
      ? input.candles
      : Array.isArray(snapshot?.candles)
        ? snapshot.candles
        : [];

    const candles = sanitizeCandles(rawCandles);
    const totalCandles = candles.length;

    const quoteValidated =
      snapshot?.dataReady === true &&
      Number.isFinite(Number(snapshot?.price)) &&
      Number(snapshot?.price) > 0;

    // Determine chart state
    let status = "DATA_UNAVAILABLE";
    let statusMessage =
      "Waiting for validated Angel One historical candles and market quote. No synthetic candles are generated.";

    if (loading) {
      status = "LOADING";
      statusMessage = `Fetching ${intervalMeta.description} historical candles for ${instrument.name} (${instrument.exchange})...`;
    } else if (apiError) {
      status = "ERROR";
      statusMessage = apiError;
    } else if (totalCandles > 0) {
      status = "READY";
      statusMessage = `${totalCandles} validated ${intervalMeta.label} candles loaded.`;
    } else if (quoteValidated) {
      status = "EMPTY_CANDLES";
      statusMessage =
        "Validated quote is available, but historical candle series is empty or unavailable for this interval.";
    }

    // Compute indicator series and latest summary using MarketData if available
    let md =
      input.marketDataEngine ||
      (typeof MarketData !== "undefined" ? MarketData : null);
    if (!md && typeof require === "function") {
      try {
        md = require("./market-data");
      } catch (_) {}
    }

    let series = {
      candleCount: totalCandles,
      ema9: [],
      ema21: [],
      sma20: [],
      sma50: [],
      vwap: [],
      bollingerBands: [],
      rsi14: [],
      macd: [],
      atr14: [],
      adx14: []
    };

    let latestIndicators = snapshot?.indicators || null;

    if (md && totalCandles > 0) {
      if (typeof md.calculateIndicatorSeries === "function") {
        series = md.calculateIndicatorSeries(candles);
      }
      if (!latestIndicators || latestIndicators.dataQuality === "DATA_UNAVAILABLE") {
        const lastCandle = candles[candles.length - 1];
        const quoteObj = quoteValidated
          ? snapshot
          : {
              price: lastCandle.close,
              open: lastCandle.open,
              high: lastCandle.high,
              low: lastCandle.low,
              previousClose: candles.length > 1 ? candles[candles.length - 2].close : lastCandle.open,
              volume: lastCandle.volume
            };
        if (typeof md.deriveIndicatorsFromQuote === "function") {
          latestIndicators = md.deriveIndicatorsFromQuote(quoteObj, candles);
        }
      }
    }

    // Indicator sufficiency diagnostics (never fake values when candle count is too small)
    const indicatorDiagnostics = {
      ema9Ready: totalCandles >= 9,
      ema21Ready: totalCandles >= 21,
      sma20Ready: totalCandles >= 20,
      sma50Ready: totalCandles >= 50,
      vwapReady: totalCandles >= 1 || quoteValidated,
      rsi14Ready: totalCandles >= 15,
      macdReady: totalCandles >= 26,
      atr14Ready: totalCandles >= 2,
      bollingerReady: totalCandles >= 20,
      adx14Ready: totalCandles >= 15,
      insufficientNote:
        totalCandles === 0
          ? "No historical candles available — indicator series cannot be calculated."
          : totalCandles < 15
            ? `Partial history (${totalCandles} candles): RSI 14, ADX 14, SMA 20, EMA 21, Bollinger 20, MACD 26 require more candles.`
            : totalCandles < 26
              ? `Partial history (${totalCandles} candles): MACD (12,26,9) requires >=26 candles and SMA 50 requires >=50 candles.`
              : totalCandles < 50
                ? `Standard history (${totalCandles} candles): All core indicators ready; SMA 50 requires >=50 candles.`
                : `Full history (${totalCandles} candles): All 10 technical indicators and overlays calculated.`
    };

    const ind = latestIndicators || {};
    const bb = ind.bollingerBands || null;
    const macdObj = ind.macd || null;

    const indicatorsSummary = {
      available: Boolean(totalCandles > 0 || quoteValidated),
      dataQuality: ind.dataQuality || (totalCandles >= 26 ? "FULL_CANDLE_SERIES" : totalCandles >= 14 ? "PARTIAL_CANDLE_SERIES" : quoteValidated ? "QUOTE_OHLC_ONLY" : "DATA_UNAVAILABLE"),
      ema9: ind.ema9 ?? null,
      ema9Formatted: ind.ema9 !== null && ind.ema9 !== undefined ? formatNumber(ind.ema9) : "INSUFFICIENT (<9)",
      ema21: ind.ema21 ?? null,
      ema21Formatted: ind.ema21 !== null && ind.ema21 !== undefined ? formatNumber(ind.ema21) : "INSUFFICIENT (<21)",
      sma20: ind.sma20 ?? null,
      sma20Formatted: ind.sma20 !== null && ind.sma20 !== undefined ? formatNumber(ind.sma20) : "INSUFFICIENT (<20)",
      sma50: ind.sma50 ?? null,
      sma50Formatted: ind.sma50 !== null && ind.sma50 !== undefined ? formatNumber(ind.sma50) : "INSUFFICIENT (<50)",
      vwap: ind.vwap ?? null,
      vwapFormatted: ind.vwap !== null && ind.vwap !== undefined ? formatINR(ind.vwap) : "--",
      rsi14: ind.rsi14 ?? null,
      rsi14Formatted: ind.rsi14 !== null && ind.rsi14 !== undefined ? formatNumber(ind.rsi14, 1) : "INSUFFICIENT (<15)",
      macd: macdObj,
      macdFormatted:
        macdObj && macdObj.macd !== null && macdObj.macd !== undefined
          ? `${formatNumber(macdObj.macd)} / Sig ${formatNumber(macdObj.signal)} / Hist ${formatNumber(macdObj.histogram)} (${macdObj.state})`
          : "INSUFFICIENT (<26)",
      atr14: ind.atr14 ?? null,
      atr14Formatted: ind.atr14 !== null && ind.atr14 !== undefined ? formatNumber(ind.atr14) : "INSUFFICIENT (<2)",
      bollingerBands: bb,
      bollingerFormatted:
        bb && bb.upper !== null && bb.middle !== null && bb.lower !== null
          ? `U ${formatNumber(bb.upper)} • M ${formatNumber(bb.middle)} • L ${formatNumber(bb.lower)}`
          : "INSUFFICIENT (<20)",
      adx14: ind.adx14 ?? null,
      adx14Formatted: ind.adx14 !== null && ind.adx14 !== undefined ? formatNumber(ind.adx14, 1) : "INSUFFICIENT (<15)",
      support: ind.support ?? null,
      supportFormatted: ind.support !== null && ind.support !== undefined ? formatINR(ind.support) : "--",
      resistance: ind.resistance ?? null,
      resistanceFormatted: ind.resistance !== null && ind.resistance !== undefined ? formatINR(ind.resistance) : "--",
      breakout: ind.breakout || "NONE",
      marketRegime: ind.marketRegime || "UNKNOWN"
    };

    if (!indicatorsSummary.available) {
      indicatorsSummary.ema9Formatted = "--";
      indicatorsSummary.ema21Formatted = "--";
      indicatorsSummary.sma20Formatted = "--";
      indicatorsSummary.sma50Formatted = "--";
      indicatorsSummary.vwapFormatted = "--";
      indicatorsSummary.rsi14Formatted = "--";
      indicatorsSummary.macdFormatted = "--";
      indicatorsSummary.atr14Formatted = "--";
      indicatorsSummary.bollingerFormatted = "--";
      indicatorsSummary.adx14Formatted = "--";
    }

    // Horizontal price overlays (validated quote, strategy/AI entry/SL/target, open paper position)
    const strategy = input.strategy || null;
    const aiDecision = input.aiDecision?.valid === true ? input.aiDecision : null;
    const paperPosition = input.paperState?.position || input.paperState?.openPosition || null;

    const currentPrice = quoteValidated
      ? Number(snapshot.price)
      : totalCandles > 0
        ? candles[totalCandles - 1].close
        : null;

    const overlays = {
      currentPrice: Number.isFinite(currentPrice) && currentPrice > 0 ? round2(currentPrice) : null,
      currentPriceFormatted: Number.isFinite(currentPrice) && currentPrice > 0 ? formatINR(currentPrice) : "--",
      support: indicatorsSummary.support,
      resistance: indicatorsSummary.resistance,
      strategyEntry: null,
      stopLoss: null,
      target: null,
      paperPositionEntry: null,
      paperPositionSide: null
    };

    if (
      strategy &&
      ["BUY", "SELL", "BUY_CE", "BUY_PE"].includes(String(strategy.action || "").toUpperCase())
    ) {
      if (Number.isFinite(Number(strategy.entry)) && Number(strategy.entry) > 0) {
        overlays.strategyEntry = round2(strategy.entry);
      }
      if (Number.isFinite(Number(strategy.stopLoss)) && Number(strategy.stopLoss) > 0) {
        overlays.stopLoss = round2(strategy.stopLoss);
      }
      if (Number.isFinite(Number(strategy.target)) && Number(strategy.target) > 0) {
        overlays.target = round2(strategy.target);
      }
    } else if (aiDecision) {
      if (Number.isFinite(Number(aiDecision.stopLossSuggestion)) && Number(aiDecision.stopLossSuggestion) > 0) {
        overlays.stopLoss = round2(aiDecision.stopLossSuggestion);
      }
      if (Number.isFinite(Number(aiDecision.targetSuggestion)) && Number(aiDecision.targetSuggestion) > 0) {
        overlays.target = round2(aiDecision.targetSuggestion);
      }
    }

    // Match open paper position to selected instrument if applicable
    if (paperPosition && (paperPosition.status === "OPEN" || !paperPosition.status)) {
      const posSym = String(paperPosition.symbol || "").trim().toUpperCase();
      const instName = String(instrument.name || "").trim().toUpperCase();
      const instKey = String(instrument.key || "").trim().toUpperCase();
      if (!posSym || posSym === instName || posSym === instKey) {
        if (Number.isFinite(Number(paperPosition.entry)) && Number(paperPosition.entry) > 0) {
          overlays.paperPositionEntry = round2(paperPosition.entry);
          overlays.paperPositionSide = String(paperPosition.direction || "BUY").toUpperCase();
        }
        if (!overlays.stopLoss && Number.isFinite(Number(paperPosition.stop)) && Number(paperPosition.stop) > 0) {
          overlays.stopLoss = round2(paperPosition.stop);
        }
        if (!overlays.target && Number.isFinite(Number(paperPosition.target)) && Number(paperPosition.target) > 0) {
          overlays.target = round2(paperPosition.target);
        }
      }
    }

    // Viewport calculation (Zoom & Pan window)
    const rawVisibleCount = Number(input.visibleCount);
    const defaultVisible = Math.min(totalCandles || 40, 45);
    const visibleCount =
      totalCandles > 0
        ? Math.max(5, Math.min(totalCandles, Number.isFinite(rawVisibleCount) && rawVisibleCount >= 5 ? Math.round(rawVisibleCount) : defaultVisible))
        : 0;

    const maxPanOffset = Math.max(0, totalCandles - visibleCount);
    const rawPanOffset = Number(input.panOffset);
    const panOffset =
      totalCandles > 0
        ? Math.max(0, Math.min(maxPanOffset, Number.isFinite(rawPanOffset) ? Math.round(rawPanOffset) : 0))
        : 0;

    const endIndex = totalCandles - panOffset;
    const startIndex = Math.max(0, endIndex - visibleCount);
    const visibleCandles = candles.slice(startIndex, endIndex);

    // Inspect hovered candle (or latest visible candle by default)
    let inspectedIndex =
      input.hoverIndex !== null &&
      input.hoverIndex !== undefined &&
      Number.isInteger(Number(input.hoverIndex)) &&
      Number(input.hoverIndex) >= 0 &&
      Number(input.hoverIndex) < totalCandles
        ? Number(input.hoverIndex)
        : totalCandles > 0
          ? endIndex - 1
          : null;

    let inspectedCandle = null;
    if (inspectedIndex !== null && candles[inspectedIndex]) {
      const c = candles[inspectedIndex];
      const change = round2(c.close - c.open);
      const changePct = c.open > 0 ? round2(((c.close - c.open) / c.open) * 100) : 0;
      inspectedCandle = {
        index: inspectedIndex,
        timestamp: c.timestamp,
        timestampFormatted: formatCandleTimestamp(c.timestamp, interval),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        openFormatted: formatINR(c.open),
        highFormatted: formatINR(c.high),
        lowFormatted: formatINR(c.low),
        closeFormatted: formatINR(c.close),
        volumeFormatted: formatVolume(c.volume),
        change,
        changePct,
        bullish: c.bullish,
        ema9: series.ema9[inspectedIndex] ?? null,
        ema21: series.ema21[inspectedIndex] ?? null,
        sma20: series.sma20[inspectedIndex] ?? null,
        sma50: series.sma50[inspectedIndex] ?? null,
        vwap: series.vwap[inspectedIndex] ?? null,
        rsi14: series.rsi14[inspectedIndex] ?? null,
        macd: series.macd[inspectedIndex] ?? null,
        atr14: series.atr14[inspectedIndex] ?? null,
        adx14: series.adx14[inspectedIndex] ?? null,
        bollinger: series.bollingerBands[inspectedIndex] ?? null
      };
    }

    return {
      status,
      statusMessage,
      interval,
      intervalMeta,
      instrument: {
        key: instrument.key || "NIFTY50",
        name: instrument.name || "NIFTY 50",
        exchange: String(instrument.exchange || "NSE").toUpperCase(),
        type: String(instrument.type || instrument.instrumentType || "INDEX").toUpperCase()
      },
      totalCandles,
      candles,
      viewport: {
        startIndex,
        endIndex,
        visibleCount,
        panOffset,
        maxPanOffset,
        visibleCandles
      },
      series,
      indicatorsSummary,
      indicatorDiagnostics,
      overlays,
      inspectedCandle
    };
  }

  function svgEl(tag, attrs = {}) {
    if (typeof document === "undefined") return null;
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v !== null && v !== undefined) {
        el.setAttribute(k, String(v));
      }
    });
    return el;
  }

  /**
   * Renders the interactive SVG Candlestick + Volume + Overlays + Subchart into a container.
   */
  function renderInteractiveChart(container, viewModel, options = {}) {
    if (!container || typeof document === "undefined") return;

    const toggles = {
      ...DEFAULT_OVERLAY_TOGGLES,
      ...(options.overlays || {})
    };
    const onHoverCandle = typeof options.onHoverCandle === "function" ? options.onHoverCandle : null;

    container.innerHTML = "";

    if (!viewModel || viewModel.status !== "READY" || !viewModel.viewport.visibleCandles.length) {
      const emptyWrap = document.createElement("div");
      emptyWrap.className = `candlestick-empty-state state-${String(viewModel?.status || "DATA_UNAVAILABLE").toLowerCase()}`;

      const badge = document.createElement("span");
      badge.className = "candlestick-state-badge";
      badge.textContent = viewModel?.status || "DATA_UNAVAILABLE";

      const title = document.createElement("strong");
      title.textContent =
        viewModel?.status === "LOADING"
          ? "Loading Validated Historical Candles..."
          : viewModel?.status === "ERROR"
            ? "Historical Candle Feed Error"
            : viewModel?.status === "EMPTY_CANDLES"
              ? "No Historical Candles Returned for Interval"
              : "Historical Candle Data Unavailable (WAITING)";

      const desc = document.createElement("p");
      desc.textContent =
        viewModel?.statusMessage ||
        "Connect Angel One read-only session or select a supported instrument to load real OHLCV candles.";

      emptyWrap.appendChild(badge);
      emptyWrap.appendChild(title);
      emptyWrap.appendChild(desc);

      if (viewModel?.overlays?.currentPriceFormatted && viewModel.overlays.currentPriceFormatted !== "--") {
        const quoteNote = document.createElement("small");
        quoteNote.className = "tabular-nums";
        quoteNote.textContent = `Validated Quote Price: ${viewModel.overlays.currentPriceFormatted}`;
        emptyWrap.appendChild(quoteNote);
      }

      container.appendChild(emptyWrap);
      return;
    }

    const vis = viewModel.viewport.visibleCandles;
    const startIdx = viewModel.viewport.startIndex;
    const count = vis.length;

    const hasSubchart = toggles.subchart && toggles.subchart !== "NONE";
    const width = 860;
    const height = hasSubchart ? 400 : 310;
    const padLeft = 12;
    const padRight = 78;
    const padTop = 14;
    const priceBottom = hasSubchart ? 225 : 230;
    const volTop = priceBottom + 8;
    const volBottom = hasSubchart ? 282 : 286;
    const subTop = 298;
    const subBottom = 380;

    const plotWidth = width - padLeft - padRight;
    const priceHeight = priceBottom - padTop;
    const volHeight = volBottom - volTop;

    // Determine price min/max across visible candles and active overlays
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVol = 0;

    for (let i = 0; i < count; i += 1) {
      const c = vis[i];
      const gIdx = startIdx + i;
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.volume > maxVol) maxVol = c.volume;

      if (toggles.bollinger) {
        const bb = viewModel.series.bollingerBands[gIdx];
        if (bb) {
          if (Number.isFinite(bb.lower) && bb.lower < minPrice) minPrice = bb.lower;
          if (Number.isFinite(bb.upper) && bb.upper > maxPrice) maxPrice = bb.upper;
        }
      }
    }

    const ov = viewModel.overlays;
    if (toggles.srLevels) {
      if (Number.isFinite(ov.support) && ov.support > 0) {
        minPrice = Math.min(minPrice, ov.support);
        maxPrice = Math.max(maxPrice, ov.support);
      }
      if (Number.isFinite(ov.resistance) && ov.resistance > 0) {
        minPrice = Math.min(minPrice, ov.resistance);
        maxPrice = Math.max(maxPrice, ov.resistance);
      }
    }

    if (toggles.tradeLevels) {
      [ov.currentPrice, ov.strategyEntry, ov.stopLoss, ov.target, ov.paperPositionEntry].forEach((lvl) => {
        if (Number.isFinite(lvl) && lvl > 0) {
          minPrice = Math.min(minPrice, lvl);
          maxPrice = Math.max(maxPrice, lvl);
        }
      });
    }

    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || maxPrice <= minPrice) {
      minPrice = (vis[0]?.low || 100) * 0.99;
      maxPrice = (vis[0]?.high || 100) * 1.01;
    }

    const pricePadding = (maxPrice - minPrice) * 0.06 || 1;
    minPrice -= pricePadding;
    maxPrice += pricePadding;
    const priceRange = Math.max(0.01, maxPrice - minPrice);

    const yForPrice = (p) =>
      padTop + priceHeight - ((Number(p) - minPrice) / priceRange) * priceHeight;
    const yForVol = (v) =>
      maxVol > 0
        ? volBottom - (Math.max(0, Number(v)) / maxVol) * volHeight
        : volBottom;

    const slotWidth = plotWidth / Math.max(1, count);
    const bodyWidth = Math.max(3, Math.min(18, slotWidth * 0.62));
    const xForLocalIndex = (i) => padLeft + (i + 0.5) * slotWidth;

    const svg = svgEl("svg", {
      class: "candlestick-svg",
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "none",
      role: "img",
      "aria-label": `${viewModel.instrument.name} (${viewModel.intervalMeta.label}) Candlestick Chart`
    });

    // Horizontal grid lines & right-axis price labels
    const gridSteps = 4;
    for (let s = 0; s <= gridSteps; s += 1) {
      const ratio = s / gridSteps;
      const y = round2(padTop + ratio * priceHeight);
      const pVal = maxPrice - ratio * priceRange;

      svg.appendChild(
        svgEl("line", {
          x1: padLeft,
          y1: y,
          x2: width - padRight,
          y2: y,
          stroke: "rgba(120, 170, 220, 0.10)",
          "stroke-width": "1"
        })
      );

      const label = svgEl("text", {
        x: width - padRight + 6,
        y: y + 3,
        fill: "#7c93ad",
        "font-size": "10",
        "font-family": "monospace"
      });
      label.textContent = formatNumber(pVal, 2);
      svg.appendChild(label);
    }

    // Separator between Price and Volume
    svg.appendChild(
      svgEl("line", {
        x1: padLeft,
        y1: volTop - 4,
        x2: width - padRight,
        y2: volTop - 4,
        stroke: "rgba(120, 170, 220, 0.16)",
        "stroke-width": "1"
      })
    );

    const volAxisLabel = svgEl("text", {
      x: width - padRight + 6,
      y: volTop + 12,
      fill: "#627b96",
      "font-size": "9",
      "font-family": "monospace"
    });
    volAxisLabel.textContent = `VOL ${formatVolume(maxVol)}`;
    svg.appendChild(volAxisLabel);

    // Helper to draw a polyline for an aligned indicator series
    function drawIndicatorLine(fullSeries, color, dashArray = null, widthPx = 1.5, extractor = (v) => v) {
      const points = [];
      for (let i = 0; i < count; i += 1) {
        const raw = fullSeries[startIdx + i];
        const val = extractor(raw);
        if (val !== null && val !== undefined && Number.isFinite(Number(val))) {
          const x = round2(xForLocalIndex(i));
          const y = round2(yForPrice(Number(val)));
          points.push(`${x},${y}`);
        }
      }
      if (points.length >= 2) {
        svg.appendChild(
          svgEl("polyline", {
            fill: "none",
            stroke: color,
            "stroke-width": widthPx,
            "stroke-dasharray": dashArray,
            points: points.join(" ")
          })
        );
      }
    }

    // Bollinger Bands (20, 2)
    if (toggles.bollinger) {
      drawIndicatorLine(
        viewModel.series.bollingerBands,
        "rgba(167, 139, 250, 0.65)",
        "3,3",
        1.2,
        (b) => b?.upper
      );
      drawIndicatorLine(
        viewModel.series.bollingerBands,
        "rgba(167, 139, 250, 0.40)",
        "2,2",
        1,
        (b) => b?.middle
      );
      drawIndicatorLine(
        viewModel.series.bollingerBands,
        "rgba(167, 139, 250, 0.65)",
        "3,3",
        1.2,
        (b) => b?.lower
      );
    }

    // Moving Averages & VWAP
    if (toggles.sma50) {
      drawIndicatorLine(viewModel.series.sma50, "#f472b6", null, 1.4);
    }
    if (toggles.sma20) {
      drawIndicatorLine(viewModel.series.sma20, "#a78bfa", null, 1.4);
    }
    if (toggles.vwap) {
      drawIndicatorLine(viewModel.series.vwap, "#38bdf8", "4,2", 1.6);
    }
    if (toggles.ema21) {
      drawIndicatorLine(viewModel.series.ema21, "#f59e0b", null, 1.6);
    }
    if (toggles.ema9) {
      drawIndicatorLine(viewModel.series.ema9, "#22d3ee", null, 1.7);
    }

    // Horizontal Level Overlays (Support, Resistance, Entry, Stop-Loss, Target, Open Position, Current Price)
    function drawHorizontalPriceLevel(priceVal, labelText, color, dashed = "4,4") {
      if (!Number.isFinite(Number(priceVal)) || Number(priceVal) <= 0) return;
      const y = round2(yForPrice(Number(priceVal)));
      if (y < padTop - 4 || y > priceBottom + 4) return;

      svg.appendChild(
        svgEl("line", {
          x1: padLeft,
          y1: y,
          x2: width - padRight,
          y2: y,
          stroke: color,
          "stroke-width": "1.2",
          "stroke-dasharray": dashed
        })
      );

      const tag = svgEl("text", {
        x: padLeft + 6,
        y: Math.max(padTop + 10, y - 4),
        fill: color,
        "font-size": "9.5",
        "font-weight": "600",
        "font-family": "monospace"
      });
      tag.textContent = `${labelText}: ${formatNumber(priceVal, 2)}`;
      svg.appendChild(tag);
    }

    if (toggles.srLevels) {
      drawHorizontalPriceLevel(ov.support, "SUP", "#32d59b", "2,4");
      drawHorizontalPriceLevel(ov.resistance, "RES", "#ff6179", "2,4");
    }

    if (toggles.tradeLevels) {
      drawHorizontalPriceLevel(ov.strategyEntry, "STRAT ENTRY", "#36b9ff", "5,3");
      drawHorizontalPriceLevel(ov.stopLoss, "STOP LOSS", "#ff6179", "4,2");
      drawHorizontalPriceLevel(ov.target, "TARGET", "#32d59b", "4,2");
      if (ov.paperPositionEntry) {
        drawHorizontalPriceLevel(
          ov.paperPositionEntry,
          `PAPER ${ov.paperPositionSide || "POS"}`,
          "#ffc857",
          null
        );
      }
      drawHorizontalPriceLevel(ov.currentPrice, "LTP", "#e2e8f0", "1,2");
    }

    // Candlesticks & Volume Bars
    for (let i = 0; i < count; i += 1) {
      const c = vis[i];
      const cx = round2(xForLocalIndex(i));
      const yHigh = round2(yForPrice(c.high));
      const yLow = round2(yForPrice(c.low));
      const yOpen = round2(yForPrice(c.open));
      const yClose = round2(yForPrice(c.close));
      const color = c.bullish ? "#32d59b" : "#ff6179";

      // High-Low Wick
      svg.appendChild(
        svgEl("line", {
          x1: cx,
          y1: yHigh,
          x2: cx,
          y2: yLow,
          stroke: color,
          "stroke-width": "1.3"
        })
      );

      // Open-Close Body
      const bodyTop = Math.min(yOpen, yClose);
      const rawBodyH = Math.abs(yClose - yOpen);
      const bodyH = Math.max(2, rawBodyH);

      svg.appendChild(
        svgEl("rect", {
          x: round2(cx - bodyWidth / 2),
          y: bodyTop,
          width: round2(bodyWidth),
          height: round2(bodyH),
          fill: color,
          rx: "1"
        })
      );

      // Volume Bar
      const vy = round2(yForVol(c.volume));
      const vh = Math.max(1, round2(volBottom - vy));
      svg.appendChild(
        svgEl("rect", {
          x: round2(cx - bodyWidth / 2),
          y: vy,
          width: round2(bodyWidth),
          height: vh,
          fill: c.bullish ? "rgba(50, 213, 155, 0.42)" : "rgba(255, 97, 121, 0.42)"
        })
      );
    }

    // Oscillator Subchart (RSI 14, MACD 12,26,9, or ATR 14 / ADX 14)
    if (hasSubchart) {
      svg.appendChild(
        svgEl("line", {
          x1: padLeft,
          y1: subTop - 6,
          x2: width - padRight,
          y2: subTop - 6,
          stroke: "rgba(120, 170, 220, 0.18)",
          "stroke-width": "1"
        })
      );

      const subHeight = subBottom - subTop;

      if (toggles.subchart === "RSI") {
        const yForRsi = (r) => subTop + subHeight - (Math.max(0, Math.min(100, Number(r))) / 100) * subHeight;
        // 70 / 30 reference lines
        [70, 50, 30].forEach((lvl) => {
          const ry = round2(yForRsi(lvl));
          svg.appendChild(
            svgEl("line", {
              x1: padLeft,
              y1: ry,
              x2: width - padRight,
              y2: ry,
              stroke: lvl === 50 ? "rgba(120, 170, 220, 0.10)" : "rgba(255, 200, 87, 0.25)",
              "stroke-dasharray": "3,3",
              "stroke-width": "1"
            })
          );
          const lbl = svgEl("text", {
            x: width - padRight + 6,
            y: ry + 3,
            fill: "#627b96",
            "font-size": "9",
            "font-family": "monospace"
          });
          lbl.textContent = `RSI ${lvl}`;
          svg.appendChild(lbl);
        });

        const rsiPts = [];
        for (let i = 0; i < count; i += 1) {
          const rVal = viewModel.series.rsi14[startIdx + i];
          if (rVal !== null && rVal !== undefined && Number.isFinite(Number(rVal))) {
            rsiPts.push(`${round2(xForLocalIndex(i))},${round2(yForRsi(rVal))}`);
          }
        }
        if (rsiPts.length >= 2) {
          svg.appendChild(
            svgEl("polyline", {
              fill: "none",
              stroke: "#ffc857",
              "stroke-width": "1.6",
              points: rsiPts.join(" ")
            })
          );
        }
      } else if (toggles.subchart === "MACD") {
        let maxAbs = 0.5;
        for (let i = 0; i < count; i += 1) {
          const m = viewModel.series.macd[startIdx + i];
          if (m) {
            maxAbs = Math.max(
              maxAbs,
              Math.abs(Number(m.macd) || 0),
              Math.abs(Number(m.signal) || 0),
              Math.abs(Number(m.histogram) || 0)
            );
          }
        }
        const zeroY = round2(subTop + subHeight / 2);
        const yForMacd = (v) =>
          subTop + subHeight / 2 - (Number(v) / maxAbs) * (subHeight * 0.44);

        svg.appendChild(
          svgEl("line", {
            x1: padLeft,
            y1: zeroY,
            x2: width - padRight,
            y2: zeroY,
            stroke: "rgba(120, 170, 220, 0.22)",
            "stroke-width": "1"
          })
        );

        const macdPts = [];
        const sigPts = [];
        for (let i = 0; i < count; i += 1) {
          const m = viewModel.series.macd[startIdx + i];
          if (m) {
            const cx = round2(xForLocalIndex(i));
            const hy = round2(yForMacd(m.histogram));
            const barTop = Math.min(zeroY, hy);
            const barH = Math.max(1, Math.abs(hy - zeroY));
            svg.appendChild(
              svgEl("rect", {
                x: round2(cx - bodyWidth / 2),
                y: barTop,
                width: round2(bodyWidth),
                height: round2(barH),
                fill: m.histogram >= 0 ? "rgba(50, 213, 155, 0.45)" : "rgba(255, 97, 121, 0.45)"
              })
            );
            macdPts.push(`${cx},${round2(yForMacd(m.macd))}`);
            sigPts.push(`${cx},${round2(yForMacd(m.signal))}`);
          }
        }
        if (macdPts.length >= 2) {
          svg.appendChild(
            svgEl("polyline", {
              fill: "none",
              stroke: "#36b9ff",
              "stroke-width": "1.5",
              points: macdPts.join(" ")
            })
          );
        }
        if (sigPts.length >= 2) {
          svg.appendChild(
            svgEl("polyline", {
              fill: "none",
              stroke: "#f97316",
              "stroke-width": "1.3",
              points: sigPts.join(" ")
            })
          );
        }
      } else if (toggles.subchart === "ATR_ADX") {
        const yForAdx = (a) =>
          subTop + subHeight - (Math.max(0, Math.min(100, Number(a))) / 100) * subHeight;
        const adxPts = [];
        for (let i = 0; i < count; i += 1) {
          const aVal = viewModel.series.adx14[startIdx + i];
          if (aVal !== null && aVal !== undefined && Number.isFinite(Number(aVal))) {
            adxPts.push(`${round2(xForLocalIndex(i))},${round2(yForAdx(aVal))}`);
          }
        }
        if (adxPts.length >= 2) {
          svg.appendChild(
            svgEl("polyline", {
              fill: "none",
              stroke: "#32d59b",
              "stroke-width": "1.5",
              points: adxPts.join(" ")
            })
          );
        }
      }
    }

    // Crosshair vertical line & interactive hover capture targets
    const crosshairLine = svgEl("line", {
      x1: 0,
      y1: padTop,
      x2: 0,
      y2: height - 12,
      stroke: "rgba(226, 232, 240, 0.45)",
      "stroke-width": "1",
      "stroke-dasharray": "3,3",
      visibility: "hidden"
    });
    svg.appendChild(crosshairLine);

    for (let i = 0; i < count; i += 1) {
      const globalIdx = startIdx + i;
      const cx = round2(xForLocalIndex(i));
      const hitRect = svgEl("rect", {
        x: round2(padLeft + i * slotWidth),
        y: padTop,
        width: round2(slotWidth),
        height: height - padTop,
        fill: "transparent",
        class: "candlestick-hit-col",
        "data-candle-index": String(globalIdx)
      });

      hitRect.addEventListener("mouseenter", () => {
        crosshairLine.setAttribute("x1", String(cx));
        crosshairLine.setAttribute("x2", String(cx));
        crosshairLine.setAttribute("visibility", "visible");
        if (onHoverCandle) {
          onHoverCandle(globalIdx);
        }
      });

      hitRect.addEventListener("click", () => {
        if (onHoverCandle) {
          onHoverCandle(globalIdx);
        }
      });

      svg.appendChild(hitRect);
    }

    svg.addEventListener("mouseleave", () => {
      crosshairLine.setAttribute("visibility", "hidden");
      if (onHoverCandle) {
        onHoverCandle(null);
      }
    });

    container.appendChild(svg);
  }

  return {
    SUPPORTED_INTERVALS,
    DEFAULT_OVERLAY_TOGGLES,
    normalizeInterval,
    getIntervalMeta,
    sanitizeCandles,
    formatCandleTimestamp,
    formatINR,
    formatNumber,
    formatVolume,
    buildChartViewModel,
    renderInteractiveChart
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ChartEngine;
}
