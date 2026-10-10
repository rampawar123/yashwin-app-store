/*
 * YASHWIN AI Trading Assistant
 * Task 11 — Complete Portfolio Management & Performance Analytics Engine
 *
 * Documented Portfolio Accounting & Performance Formulas (DOCUMENTED_PORTFOLIO_RULES):
 * - Trading Mode: Strictly PAPER ('TRADING_MODE=paper', 'LIVE_TRADING_ENABLED=false').
 * - Authoritative Source: Server-persisted SQLite paper_accounts, paper_positions,
 *   paper_orders, paper_fills, and paper_trade_results scoped strictly by user_id.
 *   Client-supplied P&L or balance values are never trusted as authoritative.
 * - Initial Capital (C0): ₹1,00,000.00 default per user paper account.
 * - Reserved Capital (RC): Sum of active open position entry values:
 *     RC = sum_open(abs(entryPrice * effectiveQuantity))
 * - Realized P&L (RPnL): Cumulative closed-trade P&L persisted in paper_accounts / paper_trade_results.
 * - Available Balance (AB):
 *     AB = max(0, C0 + RPnL - RC)
 * - Unrealized P&L (UPnL): Calculated strictly from validated quote prices on open positions:
 *     BUY:  (latestValidatedPrice - entryPrice) * effectiveQuantity
 *     SELL: (entryPrice - latestValidatedPrice) * effectiveQuantity
 *   If quote is stale or unavailable, valuation is explicitly marked STALE or QUOTE_UNAVAILABLE
 *   using the last recorded valid price and its timestamp — never presented as a fresh live quote,
 *   and missing prices never become synthetic values.
 * - Total Equity (TE):
 *     TE = C0 + RPnL + UPnL
 * - Overall Return %:
 *     Denominator = Initial Capital (C0 > 0)
 *     overallReturnPct = ((TE - C0) / C0) * 100
 *     realizedReturnPct = (RPnL / C0) * 100
 * - Position P&L %:
 *     Denominator = Position Entry Notional Value (entryPrice * effectiveQuantity > 0)
 *     positionPnlPct = (UPnL / (entryPrice * effectiveQuantity)) * 100
 * - Win Rate %:
 *     Requires closedTradeCount >= 1; otherwise 'INSUFFICIENT_DATA' (null).
 *     winRatePct = (winningTrades / closedTradeCount) * 100
 * - Profit Factor:
 *     Mathematically valid ONLY when grossProfit > 0 and grossLossAbs > 0:
 *     profitFactor = grossProfit / grossLossAbs
 *     Otherwise null with status 'INSUFFICIENT_DATA' or 'NO_LOSING_TRADES' (never fabricated or Infinity).
 * - Expectancy per Closed Trade:
 *     Requires closedTradeCount >= 1; otherwise null ('INSUFFICIENT_DATA'):
 *     expectancy = totalRealizedPnl / closedTradeCount
 * - Largest / Maximum Drawdown:
 *     Computed from chronological closed-trade equity curve starting at Initial Capital (C0).
 *     Requires at least 1 closed trade snapshot; otherwise null ('INSUFFICIENT_DATA').
 *     maxDrawdownAmount = max(peakEquity - equity_t), maxDrawdownPct = (maxDrawdownAmount / peakEquity) * 100.
 * - Disclaimer: Past paper-trading performance does not guarantee future profits.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PortfolioEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const PORTFOLIO_ENGINE_VERSION = "1.0.0-TASK11-PORTFOLIO";
  const DEFAULT_INITIAL_CAPITAL = 100000;
  const STALE_QUOTE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  const DOCUMENTED_PORTFOLIO_RULES = Object.freeze({
    version: PORTFOLIO_ENGINE_VERSION,
    tradingMode: "paper",
    liveTradingEnabled: false,
    defaultInitialCapital: DEFAULT_INITIAL_CAPITAL,
    maxOpenPositions: 1,
    maxLossPerTrade: 500,
    maxDailyLoss: 1000,
    maxTradesPerDay: 3,
    staleQuoteThresholdMs: STALE_QUOTE_THRESHOLD_MS,
    formulas: Object.freeze({
      reservedCapital: "sum_open(abs(entryPrice * effectiveQuantity))",
      availableBalance: "max(0, initialCapital + realizedPnl - reservedCapital)",
      totalEquity: "initialCapital + realizedPnl + unrealizedPnl",
      overallReturnPct: "((totalEquity - initialCapital) / initialCapital) * 100 (denominator: initialCapital)",
      realizedReturnPct: "(realizedPnl / initialCapital) * 100 (denominator: initialCapital)",
      positionPnlPct: "(unrealizedPnl / (entryPrice * effectiveQuantity)) * 100 (denominator: positionEntryValue)",
      winRatePct: "(winningTrades / closedTradeCount) * 100 when closedTradeCount >= 1 else INSUFFICIENT_DATA",
      profitFactor: "grossProfit / abs(grossLoss) ONLY when grossProfit > 0 and abs(grossLoss) > 0",
      expectancy: "realizedPnl / closedTradeCount when closedTradeCount >= 1 else INSUFFICIENT_DATA",
      maxDrawdown: "max(peakEquity - equity_t) across chronological closed-trade equity curve when closedTradeCount >= 1 else INSUFFICIENT_DATA"
    }),
    accountingAssumptions: Object.freeze([
      "Paper account initial virtual capital defaults to ₹1,00,000.00 unless configured on the persisted account.",
      "Open positions reserve full entry notional value (entryPrice * effectiveQuantity) and are never double-counted as closed trades.",
      "Fees and slippage are included strictly from persisted paper_fills records (₹0.00 default in virtual paper mode unless explicitly recorded).",
      "Unrealized P&L is computed strictly from validated market prices; stale or missing quotes are flagged explicitly and never synthesized.",
      "Past paper-trading performance is simulated and does not guarantee future results."
    ]),
    disclaimer:
      "PAPER TRADING ONLY — Simulated virtual portfolio analytics. Past paper-trading performance does not guarantee future profits."
  });

  const EXIT_REASON_KEYS = Object.freeze([
    "STOP_LOSS",
    "TARGET_EXIT",
    "EMERGENCY_STOP",
    "RISK_LOCK",
    "PROFIT_LOCK",
    "MANUAL"
  ]);

  function round2(n) {
    const val = Number(n);
    if (!Number.isFinite(val)) return 0;
    return Number(val.toFixed(2));
  }

  function formatINR(value, fallback = "INSUFFICIENT_DATA") {
    const num = Number(value);
    if (value === null || value === undefined || !Number.isFinite(num)) {
      return fallback;
    }
    const sign = num < 0 ? "-" : "";
    const abs = Math.abs(num);
    return `${sign}₹${abs.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function formatSignedINR(value, fallback = "INSUFFICIENT_DATA") {
    const num = Number(value);
    if (value === null || value === undefined || !Number.isFinite(num)) {
      return fallback;
    }
    const sign = num > 0 ? "+" : num < 0 ? "-" : "";
    const abs = Math.abs(num);
    return `${sign}₹${abs.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function normalizeExitReason(reason) {
    const raw = String(reason || "MANUAL").trim().toUpperCase();
    if (raw === "STOP_LOSS" || raw === "SL" || raw === "HARD_STOP") return "STOP_LOSS";
    if (raw === "TARGET_EXIT" || raw === "TARGET" || raw === "TP") return "TARGET_EXIT";
    if (raw === "EMERGENCY_STOP" || raw === "KILL_SWITCH") return "EMERGENCY_STOP";
    if (raw === "RISK_LOCK" || raw === "DAILY_LOSS_LOCK") return "RISK_LOCK";
    if (raw === "PROFIT_LOCK" || raw === "TRAILING_STOP") return "PROFIT_LOCK";
    return "MANUAL";
  }

  function evaluateQuoteFreshness(quoteContext = {}, position = null, nowMs = Date.now()) {
    const quotePriceRaw =
      quoteContext && quoteContext.price !== undefined && quoteContext.price !== null
        ? Number(quoteContext.price)
        : null;
    const hasValidLiveQuote =
      Number.isFinite(quotePriceRaw) &&
      quotePriceRaw > 0 &&
      quoteContext.dataReady !== false &&
      quoteContext.stale !== true &&
      quoteContext.status !== "DATA_UNAVAILABLE" &&
      quoteContext.status !== "ERROR";

    const quoteTimestamp =
      quoteContext?.timestamp ||
      quoteContext?.quoteTimestamp ||
      position?.updatedAt ||
      position?.openedAt ||
      null;

    let ageMs = null;
    if (quoteTimestamp) {
      const parsed = Date.parse(quoteTimestamp);
      if (Number.isFinite(parsed)) {
        ageMs = Math.max(0, nowMs - parsed);
      }
    }

    const explicitlyStale =
      quoteContext?.stale === true ||
      quoteContext?.freshness === "STALE" ||
      (ageMs !== null && ageMs > STALE_QUOTE_THRESHOLD_MS);

    const explicitlyUnavailable =
      quoteContext?.status === "DATA_UNAVAILABLE" ||
      quoteContext?.status === "QUOTE_UNAVAILABLE" ||
      quoteContext?.priceUnavailable === true;

    if (hasValidLiveQuote && !explicitlyStale && !explicitlyUnavailable) {
      return {
        valuationStatus: "LIVE_VALIDATED",
        freshness: "FRESH",
        isStale: false,
        isUnavailable: false,
        validatedPrice: round2(quotePriceRaw),
        lastValidPrice: round2(quotePriceRaw),
        quoteTimestamp,
        ageMs,
        statusLabel: "LIVE VALIDATED QUOTE"
      };
    }

    // Fall back to last recorded valid price on the position (never invent a synthetic price)
    const posCurrent = Number(position?.current);
    const posEntry = Number(position?.entry);
    const lastValidPrice =
      Number.isFinite(quotePriceRaw) && quotePriceRaw > 0
        ? round2(quotePriceRaw)
        : Number.isFinite(posCurrent) && posCurrent > 0
          ? round2(posCurrent)
          : Number.isFinite(posEntry) && posEntry > 0
            ? round2(posEntry)
            : null;

    if (explicitlyUnavailable || lastValidPrice === null) {
      return {
        valuationStatus: "QUOTE_UNAVAILABLE",
        freshness: "UNAVAILABLE",
        isStale: true,
        isUnavailable: true,
        validatedPrice: null,
        lastValidPrice,
        quoteTimestamp,
        ageMs,
        statusLabel: lastValidPrice !== null
          ? "QUOTE UNAVAILABLE — USING LAST RECORDED PRICE (STALE)"
          : "QUOTE UNAVAILABLE"
      };
    }

    if (explicitlyStale) {
      return {
        valuationStatus: "STALE_QUOTE",
        freshness: "STALE",
        isStale: true,
        isUnavailable: false,
        validatedPrice: lastValidPrice,
        lastValidPrice,
        quoteTimestamp,
        ageMs,
        statusLabel: "STALE QUOTE — LAST VALID PRICE SHOWN"
      };
    }

    return {
      valuationStatus: "PERSISTED_SNAPSHOT",
      freshness: "VALIDATED",
      isStale: false,
      isUnavailable: false,
      validatedPrice: lastValidPrice,
      lastValidPrice,
      quoteTimestamp,
      ageMs,
      statusLabel: "VALIDATED POSITION PRICE"
    };
  }

  function evaluateOpenPositionValuation(position, options = {}) {
    if (!position || position.status === "CLOSED") return null;

    const direction = String(position.direction || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
    const assetType = String(position.assetType || "EQUITY").toUpperCase();
    const qty = Number(position.qty || position.quantity || 1);
    const lotSize = position.lotSize ? Number(position.lotSize) : 1;
    const lots = position.lots ? Number(position.lots) : 1;
    const effectiveQty = Number(
      position.effectiveQty ||
      (assetType === "OPTION" && lotSize > 0 && lots > 0 ? lotSize * lots : qty)
    );
    const entryPrice = round2(position.entry ?? position.entryPrice ?? 0);
    const averagePrice = round2(position.averagePrice ?? entryPrice);
    const stopLoss = round2(position.stop ?? position.stopLoss ?? 0);
    const target = round2(position.target ?? 0);
    const trailingStop =
      position.trailingStop !== null && position.trailingStop !== undefined && Number.isFinite(Number(position.trailingStop))
        ? round2(position.trailingStop)
        : null;

    const quoteSymbolMap = options.quotesBySymbol || {};
    const symbolKey = String(position.symbol || "").toUpperCase();
    const quoteCtx =
      options.quoteContext ||
      quoteSymbolMap[symbolKey] ||
      quoteSymbolMap[position.symbol] ||
      {};

    const freshnessInfo = evaluateQuoteFreshness(quoteCtx, position, options.nowMs);
    const valuationPrice = freshnessInfo.lastValidPrice;

    const reservedCapital = round2(Math.abs(entryPrice * effectiveQty));
    const marketValue =
      valuationPrice !== null && Number.isFinite(valuationPrice)
        ? round2(Math.abs(valuationPrice * effectiveQty))
        : null;

    const grossUnrealizedPnl =
      valuationPrice !== null && Number.isFinite(valuationPrice)
        ? round2(
            direction === "BUY"
              ? (valuationPrice - entryPrice) * effectiveQty
              : (entryPrice - valuationPrice) * effectiveQty
          )
        : null;

    const fees = round2(Number(position.fees || 0));
    const netUnrealizedPnl =
      grossUnrealizedPnl !== null ? round2(grossUnrealizedPnl - fees) : null;

    // Denominator is entry notional value (reservedCapital)
    const pnlPct =
      netUnrealizedPnl !== null && reservedCapital > 0
        ? round2((netUnrealizedPnl / reservedCapital) * 100)
        : null;

    const unitRisk = Math.abs(entryPrice - stopLoss);
    const openRiskAmount = round2(unitRisk * effectiveQty);
    const maxLossPerTrade = Number(options.maxLossPerTrade) || 500;

    let riskStatus = "PROTECTED";
    if (options.emergencyStop) {
      riskStatus = "EMERGENCY_STOP_ACTIVE";
    } else if (freshnessInfo.isUnavailable) {
      riskStatus = "QUOTE_UNAVAILABLE";
    } else if (freshnessInfo.isStale) {
      riskStatus = "STALE_VALUATION";
    } else if (valuationPrice !== null) {
      const stopBreached =
        (direction === "BUY" && valuationPrice <= stopLoss) ||
        (direction === "SELL" && valuationPrice >= stopLoss);
      if (stopBreached) {
        riskStatus = "STOP_LOSS_TRIGGERED";
      } else if (Number(position.lockedProfit || 0) > 0) {
        riskStatus = "PROFIT_LOCKED";
      } else if (openRiskAmount > maxLossPerTrade) {
        riskStatus = "HIGH_RISK";
      }
    }

    return {
      id: position.id || position.positionId || "PAPER-POS",
      orderId: position.orderId || null,
      instrumentName: position.instrumentName || position.name || position.symbol || "NIFTY 50",
      symbol: position.symbol || "NIFTY 50",
      exchange: position.exchange || "NSE",
      direction,
      assetType,
      optionDetails:
        assetType === "OPTION"
          ? {
              lotSize,
              lots,
              optionType: position.optionType || (String(position.symbol).endsWith("PE") ? "PE" : String(position.symbol).endsWith("CE") ? "CE" : null),
              strikePrice: position.strikePrice ?? null,
              expiry: position.expiry ?? null
            }
          : null,
      quantity: qty,
      lotSize,
      lots,
      effectiveQty,
      averageEntryPrice: averagePrice,
      entryPrice,
      validatedPrice: freshnessInfo.validatedPrice,
      latestValidatedPrice: freshnessInfo.validatedPrice,
      lastValidPrice: freshnessInfo.lastValidPrice,
      marketValue,
      reservedCapital,
      stopLoss,
      target,
      trailingStop,
      lockedProfit: round2(position.lockedProfit || 0),
      nextProfitMilestone: round2(position.nextProfitMilestone || 0),
      exitOnTarget: Boolean(position.exitOnTarget),
      unrealizedGrossPnl: grossUnrealizedPnl,
      unrealizedNetPnl: netUnrealizedPnl,
      unrealizedPnl: netUnrealizedPnl !== null ? netUnrealizedPnl : round2(position.unrealizedPnl || 0),
      pnlPercentage: pnlPct,
      pnlDenominator: reservedCapital,
      pnlDenominatorLabel: "Entry Notional Value (entryPrice × effectiveQty)",
      openRiskAmount,
      quoteTimestamp: freshnessInfo.quoteTimestamp,
      freshness: freshnessInfo.freshness,
      isStale: freshnessInfo.isStale,
      isQuoteUnavailable: freshnessInfo.isUnavailable,
      valuationStatus: freshnessInfo.valuationStatus,
      valuationStatusLabel: freshnessInfo.statusLabel,
      riskStatus,
      mode: position.mode || "MANUAL_PAPER",
      status: "OPEN",
      openedAt: position.openedAt || null,
      updatedAt: position.updatedAt || freshnessInfo.quoteTimestamp || null
    };
  }

  function filterTrades(trades = [], filters = {}) {
    if (!Array.isArray(trades)) return [];
    const symbolFilter = String(filters.symbol || filters.instrument || "").trim().toUpperCase();
    const statusFilter = String(filters.status || filters.outcome || "ALL").trim().toUpperCase();
    const reasonFilter = String(filters.reason || filters.exitReason || "ALL").trim().toUpperCase();
    const fromDate = filters.fromDate || filters.from ? String(filters.fromDate || filters.from).slice(0, 10) : null;
    const toDate = filters.toDate || filters.to ? String(filters.toDate || filters.to).slice(0, 10) : null;
    const dateExact = filters.date ? String(filters.date).slice(0, 10) : null;

    return trades.filter((t) => {
      if (!t) return false;
      const sym = String(t.symbol || "").toUpperCase();
      if (symbolFilter && symbolFilter !== "ALL" && !sym.includes(symbolFilter)) {
        return false;
      }

      const pnl = Number(t.pnl || 0);
      if (statusFilter === "WIN" || statusFilter === "WINNING" || statusFilter === "PROFIT") {
        if (!(pnl > 0)) return false;
      } else if (statusFilter === "LOSS" || statusFilter === "LOSING") {
        if (!(pnl < 0)) return false;
      } else if (statusFilter === "BREAKEVEN" || statusFilter === "FLAT") {
        if (pnl !== 0) return false;
      }

      if (reasonFilter && reasonFilter !== "ALL") {
        const normReason = normalizeExitReason(t.reason || t.exitReason);
        if (normReason !== reasonFilter) return false;
      }

      const tradeDate = String(t.closedAt || t.timestamp || t.openedAt || "").slice(0, 10);
      if (dateExact && tradeDate !== dateExact) {
        return false;
      }
      if (fromDate && tradeDate && tradeDate < fromDate) {
        return false;
      }
      if (toDate && tradeDate && tradeDate > toDate) {
        return false;
      }

      return true;
    });
  }

  function calculatePerformanceAnalytics(closedTrades = [], options = {}) {
    const initialCapital =
      Number.isFinite(Number(options.initialCapital)) && Number(options.initialCapital) > 0
        ? Number(options.initialCapital)
        : DEFAULT_INITIAL_CAPITAL;

    const validClosed = Array.isArray(closedTrades)
      ? closedTrades.filter(
          (t) =>
            t &&
            String(t.status || "CLOSED").toUpperCase() !== "OPEN" &&
            Number.isFinite(Number(t.pnl))
        )
      : [];

    // Sort chronologically ascending by closedAt / timestamp
    const chronological = [...validClosed].sort((a, b) => {
      const ta = Date.parse(a.closedAt || a.timestamp || a.openedAt || 0) || 0;
      const tb = Date.parse(b.closedAt || b.timestamp || b.openedAt || 0) || 0;
      return ta - tb;
    });

    const totalClosedTrades = chronological.length;
    const totalFees = round2(
      chronological.reduce((acc, t) => acc + (Number(t.fees) || 0), 0)
    );

    const exitReasonBreakdown = {
      STOP_LOSS: { count: 0, pnl: 0, pct: 0 },
      TARGET_EXIT: { count: 0, pnl: 0, pct: 0 },
      EMERGENCY_STOP: { count: 0, pnl: 0, pct: 0 },
      RISK_LOCK: { count: 0, pnl: 0, pct: 0 },
      PROFIT_LOCK: { count: 0, pnl: 0, pct: 0 },
      MANUAL: { count: 0, pnl: 0, pct: 0 }
    };

    if (totalClosedTrades === 0) {
      return {
        status: "INSUFFICIENT_DATA",
        hasSufficientHistory: false,
        initialCapital: round2(initialCapital),
        denominatorLabel: `Initial Capital (${formatINR(initialCapital)})`,
        closedTradeCount: 0,
        winningTrades: 0,
        losingTrades: 0,
        breakevenTrades: 0,
        cumulativeRealizedPnl: 0,
        totalFees: 0,
        realizedReturnPct: 0,
        winRate: null,
        winRateStatus: "INSUFFICIENT_DATA",
        averageWin: null,
        averageLoss: null,
        profitFactor: null,
        profitFactorStatus: "INSUFFICIENT_DATA",
        expectancy: null,
        expectancyStatus: "INSUFFICIENT_DATA",
        maxDrawdown: null,
        maxDrawdownPct: null,
        drawdownStatus: "INSUFFICIENT_DATA",
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
        currentStreak: { type: "NONE", count: 0 },
        exitReasonBreakdown,
        dailyPnlHistory: [],
        equityCurve: [],
        disclaimer: DOCUMENTED_PORTFOLIO_RULES.disclaimer
      };
    }

    let winningTrades = 0;
    let losingTrades = 0;
    let breakevenTrades = 0;
    let grossProfit = 0;
    let grossLossAbs = 0;
    let cumulativePnl = 0;

    let currentWinStreak = 0;
    let currentLossStreak = 0;
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;

    let runningEquity = initialCapital;
    let peakEquity = initialCapital;
    let maxDrawdownAmount = 0;
    let maxDrawdownPct = 0;

    const dailyMap = new Map();
    const equityCurve = [
      {
        index: 0,
        tradeId: "INITIAL_CAPITAL",
        symbol: "ACCOUNT_START",
        timestamp: chronological[0]?.openedAt || chronological[0]?.closedAt || null,
        pnl: 0,
        cumulativePnl: 0,
        equity: round2(initialCapital),
        drawdown: 0,
        drawdownPct: 0
      }
    ];

    chronological.forEach((trade, idx) => {
      const pnl = round2(trade.pnl);
      cumulativePnl = round2(cumulativePnl + pnl);
      runningEquity = round2(initialCapital + cumulativePnl);

      if (runningEquity > peakEquity) {
        peakEquity = runningEquity;
      }
      const dd = round2(Math.max(0, peakEquity - runningEquity));
      const ddPct = peakEquity > 0 ? round2((dd / peakEquity) * 100) : 0;
      if (dd > maxDrawdownAmount) {
        maxDrawdownAmount = dd;
      }
      if (ddPct > maxDrawdownPct) {
        maxDrawdownPct = ddPct;
      }

      if (pnl > 0) {
        winningTrades += 1;
        grossProfit = round2(grossProfit + pnl);
        currentWinStreak += 1;
        currentLossStreak = 0;
        if (currentWinStreak > maxConsecutiveWins) {
          maxConsecutiveWins = currentWinStreak;
        }
      } else if (pnl < 0) {
        losingTrades += 1;
        grossLossAbs = round2(grossLossAbs + Math.abs(pnl));
        currentLossStreak += 1;
        currentWinStreak = 0;
        if (currentLossStreak > maxConsecutiveLosses) {
          maxConsecutiveLosses = currentLossStreak;
        }
      } else {
        breakevenTrades += 1;
        currentWinStreak = 0;
        currentLossStreak = 0;
      }

      const normReason = normalizeExitReason(trade.reason || trade.exitReason);
      const bucket = exitReasonBreakdown[normReason] || exitReasonBreakdown.MANUAL;
      bucket.count += 1;
      bucket.pnl = round2(bucket.pnl + pnl);

      const closeTimestamp = trade.closedAt || trade.timestamp || trade.openedAt || "";
      const dateKey = String(closeTimestamp).slice(0, 10) || "UNKNOWN_DATE";
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: dateKey,
          tradesCount: 0,
          wins: 0,
          losses: 0,
          realizedPnl: 0,
          cumulativePnl: 0
        });
      }
      const dayEntry = dailyMap.get(dateKey);
      dayEntry.tradesCount += 1;
      if (pnl > 0) dayEntry.wins += 1;
      if (pnl < 0) dayEntry.losses += 1;
      dayEntry.realizedPnl = round2(dayEntry.realizedPnl + pnl);
      dayEntry.cumulativePnl = cumulativePnl;

      equityCurve.push({
        index: idx + 1,
        tradeId: trade.id || trade.tradeId || `TRD-${idx + 1}`,
        symbol: trade.symbol || "NIFTY 50",
        direction: trade.direction || "BUY",
        reason: normReason,
        timestamp: closeTimestamp || null,
        pnl,
        cumulativePnl,
        equity: runningEquity,
        drawdown: dd,
        drawdownPct: ddPct
      });
    });

    for (const key of EXIT_REASON_KEYS) {
      const b = exitReasonBreakdown[key];
      b.pct = totalClosedTrades > 0 ? round2((b.count / totalClosedTrades) * 100) : 0;
    }

    const winRate = round2((winningTrades / totalClosedTrades) * 100);
    const averageWin = winningTrades > 0 ? round2(grossProfit / winningTrades) : null;
    const averageLoss = losingTrades > 0 ? round2(-grossLossAbs / losingTrades) : null;

    // Profit factor is mathematically valid ONLY when grossLossAbs > 0 and grossProfit > 0
    let profitFactor = null;
    let profitFactorStatus = "INSUFFICIENT_DATA";
    if (grossProfit > 0 && grossLossAbs > 0) {
      profitFactor = round2(grossProfit / grossLossAbs);
      profitFactorStatus = "VALID";
    } else if (grossProfit > 0 && grossLossAbs === 0) {
      profitFactor = null;
      profitFactorStatus = "NO_LOSING_TRADES";
    } else if (grossProfit === 0 && grossLossAbs > 0) {
      profitFactor = 0;
      profitFactorStatus = "ZERO_PROFIT";
    }

    const expectancy = round2(cumulativePnl / totalClosedTrades);
    const realizedReturnPct = initialCapital > 0 ? round2((cumulativePnl / initialCapital) * 100) : 0;

    const currentStreak =
      currentWinStreak > 0
        ? { type: "WIN", count: currentWinStreak }
        : currentLossStreak > 0
          ? { type: "LOSS", count: currentLossStreak }
          : { type: "FLAT", count: 0 };

    const dailyPnlHistory = Array.from(dailyMap.values()).sort((a, b) =>
      String(b.date).localeCompare(String(a.date))
    );

    return {
      status: "READY",
      hasSufficientHistory: true,
      initialCapital: round2(initialCapital),
      denominatorLabel: `Initial Capital (${formatINR(initialCapital)})`,
      closedTradeCount: totalClosedTrades,
      winningTrades,
      losingTrades,
      breakevenTrades,
      grossProfit: round2(grossProfit),
      grossLoss: round2(-grossLossAbs),
      cumulativeRealizedPnl: round2(cumulativePnl),
      totalFees,
      realizedReturnPct,
      winRate,
      winRateStatus: "VALID",
      averageWin,
      averageLoss,
      profitFactor,
      profitFactorStatus,
      expectancy,
      expectancyStatus: "VALID",
      maxDrawdown: round2(maxDrawdownAmount),
      maxDrawdownPct: round2(maxDrawdownPct),
      drawdownStatus: "VALID",
      maxConsecutiveWins,
      maxConsecutiveLosses,
      currentStreak,
      exitReasonBreakdown,
      dailyPnlHistory,
      equityCurve,
      disclaimer: DOCUMENTED_PORTFOLIO_RULES.disclaimer
    };
  }

  function buildPortfolioSnapshot(input = {}) {
    const account = input.account || null;
    const rawOpenPositions = Array.isArray(input.openPositions)
      ? input.openPositions
      : input.openPosition
        ? [input.openPosition]
        : [];
    const closedTradesAll = Array.isArray(input.closedTrades)
      ? input.closedTrades
      : Array.isArray(input.history)
        ? input.history
        : [];
    const fills = Array.isArray(input.fills) ? input.fills : [];
    const orders = Array.isArray(input.orders) ? input.orders : [];
    const filters = input.filters || {};
    const emergencyStop = Boolean(
      input.emergencyStop?.active !== undefined ? input.emergencyStop.active : input.emergencyStop
    );
    const nowIso = input.nowIso || new Date().toISOString();

    const initialCapital = round2(
      account && Number.isFinite(Number(account.capital)) && Number(account.capital) > 0
        ? Number(account.capital)
        : DEFAULT_INITIAL_CAPITAL
    );

    const valuedPositions = rawOpenPositions
      .filter((p) => p && p.status !== "CLOSED")
      .map((p) =>
        evaluateOpenPositionValuation(p, {
          quoteContext: input.quoteContext,
          quotesBySymbol: input.quotesBySymbol,
          emergencyStop,
          maxLossPerTrade: account?.maxLossPerTrade || 500
        })
      )
      .filter(Boolean);

    const reservedCapital = round2(
      valuedPositions.reduce((sum, p) => sum + (Number(p.reservedCapital) || 0), 0)
    );

    const unrealizedPnl = round2(
      valuedPositions.reduce((sum, p) => sum + (Number(p.unrealizedPnl) || 0), 0)
    );

    // Persisted closed-trade realized P&L consistency
    const closedTradesAllClean = closedTradesAll.filter(
      (t) => t && String(t.status || "CLOSED").toUpperCase() !== "OPEN"
    );
    const sumClosedTradesPnl = round2(
      closedTradesAllClean.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0)
    );
    const accountRealizedPnl =
      account && Number.isFinite(Number(account.realizedPnl))
        ? round2(Number(account.realizedPnl))
        : sumClosedTradesPnl;

    // Authoritative realized P&L uses persisted trade records when present, else account ledger
    const realizedPnl =
      closedTradesAllClean.length > 0 ? sumClosedTradesPnl : accountRealizedPnl;

    const totalFees = round2(
      fills.reduce((sum, f) => sum + (Number(f.fees) || 0), 0)
    );

    const availableBalance = round2(
      Math.max(0, initialCapital + realizedPnl - reservedCapital)
    );
    const totalEquity = round2(initialCapital + realizedPnl + unrealizedPnl);
    const overallReturnPct =
      initialCapital > 0 ? round2(((totalEquity - initialCapital) / initialCapital) * 100) : 0;

    // Today's realized P&L
    const sessionDate =
      account?.sessionDate || String(nowIso).slice(0, 10);
    const todaysClosedTrades = closedTradesAllClean.filter((t) => {
      const d = String(t.closedAt || t.timestamp || "").slice(0, 10);
      return d === sessionDate;
    });
    const todayRealizedPnl =
      todaysClosedTrades.length > 0
        ? round2(todaysClosedTrades.reduce((s, t) => s + (Number(t.pnl) || 0), 0))
        : account && Number.isFinite(Number(account.dailyPnl))
          ? round2(Number(account.dailyPnl))
          : 0;
    const todayUnrealizedPnl = unrealizedPnl;
    const todayEffectivePnl = round2(todayRealizedPnl + todayUnrealizedPnl);

    // Apply optional filters for filtered history & analytics
    const filteredClosedTrades = filterTrades(closedTradesAllClean, filters);
    const performance = calculatePerformanceAnalytics(closedTradesAllClean, {
      initialCapital
    });
    const filteredPerformance =
      Object.keys(filters).length > 0
        ? calculatePerformanceAnalytics(filteredClosedTrades, { initialCapital })
        : performance;

    const anyStalePosition = valuedPositions.some((p) => p.isStale);
    const anyUnavailableQuote = valuedPositions.some((p) => p.isQuoteUnavailable);

    let dataAvailability = "AVAILABLE";
    if (anyUnavailableQuote) {
      dataAvailability = "QUOTE_UNAVAILABLE";
    } else if (anyStalePosition) {
      dataAvailability = "STALE_VALUATION";
    } else if (valuedPositions.length === 0 && closedTradesAllClean.length === 0) {
      dataAvailability = "EMPTY_PORTFOLIO";
    }

    const summary = {
      userId: input.userId || account?.userId || null,
      accountId: account?.accountId || "DEFAULT_PAPER",
      tradingMode: "paper",
      liveTradingEnabled: false,
      initialCapital,
      availableBalance,
      reservedCapital,
      totalEquity,
      realizedPnl,
      unrealizedPnl,
      todayRealizedPnl,
      todayUnrealizedPnl,
      todayEffectivePnl,
      totalFees,
      overallReturnPct,
      returnDenominator: initialCapital,
      returnDenominatorLabel: `Initial Virtual Capital (${formatINR(initialCapital)})`,
      openPositionCount: valuedPositions.length,
      openPositionLimit: 1,
      closedTradeCount: performance.closedTradeCount,
      winningTrades: performance.winningTrades,
      losingTrades: performance.losingTrades,
      breakevenTrades: performance.breakevenTrades,
      winRate: performance.winRate,
      winRateStatus: performance.winRateStatus,
      profitFactor: performance.profitFactor,
      profitFactorStatus: performance.profitFactorStatus,
      averageWin: performance.averageWin,
      averageLoss: performance.averageLoss,
      expectancy: performance.expectancy,
      expectancyStatus: performance.expectancyStatus,
      maxDrawdown: performance.maxDrawdown,
      maxDrawdownPct: performance.maxDrawdownPct,
      drawdownStatus: performance.drawdownStatus,
      tradesToday: Number(account?.tradesToday || todaysClosedTrades.length || 0),
      maxTradesPerDay: Number(account?.maxTradesPerDay || 3),
      maxLossPerTrade: Number(account?.maxLossPerTrade || 500),
      maxDailyLoss: Number(account?.maxDailyLoss || 1000),
      emergencyStop,
      dataAvailability,
      hasOpenPosition: valuedPositions.length > 0,
      hasClosedHistory: closedTradesAllClean.length > 0,
      isEmptyPortfolio: valuedPositions.length === 0 && closedTradesAllClean.length === 0,
      lastUpdatedAt: account?.updatedAt || nowIso,
      accountingConsistent:
        Math.abs(availableBalance - Math.max(0, initialCapital + realizedPnl - reservedCapital)) < 0.01 &&
        Math.abs(totalEquity - (initialCapital + realizedPnl + unrealizedPnl)) < 0.01,
      disclaimer: DOCUMENTED_PORTFOLIO_RULES.disclaimer
    };

    return {
      ok: true,
      version: PORTFOLIO_ENGINE_VERSION,
      mode: "PAPER",
      liveTradingEnabled: false,
      userId: summary.userId,
      summary,
      positions: valuedPositions,
      openPosition: valuedPositions[0] || null,
      performance,
      filteredPerformance,
      history: filteredClosedTrades.map((t) => {
        const entryVal = Math.abs(Number(t.entry || 0) * Number(t.quantity || 1));
        const unitRisk = Math.abs(Number(t.entry || 0) - Number(t.stop || 0));
        const tradeRisk = unitRisk * Number(t.quantity || 1);
        const rMultiple =
          tradeRisk > 0 ? round2(Number(t.pnl || 0) / tradeRisk) : null;
        const returnPct =
          entryVal > 0 ? round2((Number(t.pnl || 0) / entryVal) * 100) : null;

        return {
          ...t,
          normalizedReason: normalizeExitReason(t.reason || t.exitReason),
          entryNotional: round2(entryVal),
          tradeRisk: round2(tradeRisk),
          rMultiple,
          returnPct
        };
      }),
      ordersCount: orders.length,
      fillsCount: fills.length,
      documentedRules: DOCUMENTED_PORTFOLIO_RULES
    };
  }

  function buildPortfolioViewModel(input = {}) {
    const snap = input.summary && input.performance ? input : buildPortfolioSnapshot(input);
    const s = snap.summary;
    const p = snap.performance;

    return {
      version: PORTFOLIO_ENGINE_VERSION,
      mode: "PAPER",
      liveTradingEnabled: false,
      userId: s.userId,
      dataAvailability: s.dataAvailability,
      isEmptyPortfolio: s.isEmptyPortfolio,
      hasSufficientHistory: p.hasSufficientHistory,
      lastUpdatedLabel: s.lastUpdatedAt
        ? new Date(s.lastUpdatedAt).toLocaleTimeString("en-IN", { hour12: false })
        : "--",
      lastUpdatedIso: s.lastUpdatedAt,
      kpis: {
        initialCapital: formatINR(s.initialCapital),
        availableBalance: formatINR(s.availableBalance),
        reservedCapital: formatINR(s.reservedCapital),
        totalEquity: formatINR(s.totalEquity),
        realizedPnl: formatSignedINR(s.realizedPnl),
        unrealizedPnl: formatSignedINR(s.unrealizedPnl),
        todayRealizedPnl: formatSignedINR(s.todayRealizedPnl),
        todayUnrealizedPnl: formatSignedINR(s.todayUnrealizedPnl),
        todayEffectivePnl: formatSignedINR(s.todayEffectivePnl),
        overallReturnPct: `${s.overallReturnPct >= 0 ? "+" : ""}${s.overallReturnPct.toFixed(2)}%`,
        openPositionsLabel: `${s.openPositionCount} / ${s.openPositionLimit}`,
        closedTradesLabel: `${s.closedTradeCount}`,
        winLossLabel: `${s.winningTrades}W / ${s.losingTrades}L`,
        winRateLabel:
          p.winRate !== null ? `${p.winRate.toFixed(1)}%` : "INSUFFICIENT_DATA",
        profitFactorLabel:
          p.profitFactor !== null
            ? p.profitFactor.toFixed(2)
            : p.profitFactorStatus === "NO_LOSING_TRADES"
              ? "NO_LOSING_TRADES"
              : "INSUFFICIENT_DATA",
        averageWinLabel:
          p.averageWin !== null ? formatSignedINR(p.averageWin) : "INSUFFICIENT_DATA",
        averageLossLabel:
          p.averageLoss !== null ? formatSignedINR(p.averageLoss) : "INSUFFICIENT_DATA",
        expectancyLabel:
          p.expectancy !== null ? formatSignedINR(p.expectancy) : "INSUFFICIENT_DATA",
        maxDrawdownLabel:
          p.maxDrawdown !== null
            ? `${formatINR(p.maxDrawdown)} (${p.maxDrawdownPct.toFixed(2)}%)`
            : "INSUFFICIENT_DATA"
      },
      summary: s,
      positions: snap.positions,
      performance: p,
      filteredPerformance: snap.filteredPerformance,
      history: snap.history,
      documentedRules: DOCUMENTED_PORTFOLIO_RULES
    };
  }

  return {
    PORTFOLIO_ENGINE_VERSION,
    DOCUMENTED_PORTFOLIO_RULES,
    EXIT_REASON_KEYS,
    formatINR,
    formatSignedINR,
    normalizeExitReason,
    evaluateQuoteFreshness,
    evaluateOpenPositionValuation,
    filterTrades,
    calculatePerformanceAnalytics,
    buildPortfolioSnapshot,
    buildPortfolioViewModel
  };
});
