/*
 * YASHWIN AI Trading Assistant
 * Phase 13, 14 & Task 10 — Complete Paper Trading, Automatic Paper Execution & Position Manager Engine
 *
 * Documented Paper Trading Architecture & Rules (DOCUMENTED_PAPER_TRADING_RULES):
 * - Trading Mode: Strictly PAPER (TRADING_MODE=paper, LIVE_TRADING_ENABLED=false, zero real Angel One broker orders)
 * - Default Initial Virtual Capital: ₹1,00,000.00 (100000 INR)
 * - Capital Accounting:
 *   - Initial Capital: ₹1,00,000.00
 *   - Reserved Capital (Committed Margin): |entry * effectiveQuantity| while an OPEN position exists, else ₹0
 *   - Available Balance: max(0, capital + realizedPnl - reservedCapital)
 *   - Net Account Equity: capital + realizedPnl + unrealizedPnl
 *   - Effective Daily P&L: dailyPnl (realized today) + unrealizedPnl
 * - Supported Modes:
 *   - MANUAL_PAPER: RiskEngine + EmergencyStop
 *   - AI_ASSISTED_PAPER: MarketAnalysis + AISafetyGate + RiskEngine + EmergencyStop
 *   - AUTO_PAPER: Validated Market Data -> MarketAnalysis -> AIDecisionContract -> StrategyEngine -> RiskEngine -> AISafetyGate -> Paper BUY/SELL
 *   - PILOT_APPROVED_PAPER: Human-approved pilot proposal executed in Paper sandbox
 * - Deterministic Exit Priority Order:
 *   1. EMERGENCY_STOP (Immediate market exit in Paper Mode)
 *   2. STOP_LOSS (Hard directional stop-loss breach)
 *   3. RISK_LOCK (Cumulative daily P&L reaches -₹1,000 daily loss lock)
 *   4. TARGET_EXIT / TARGET_ACTIVATED (Target price reached)
 *   5. PROFIT_LOCK (Trailing profit milestone locked stop price breached)
 * - Persistence:
 *   - Browser: user-scoped localStorage
 *   - Server: Single SQLite database (paper_accounts, paper_positions, paper_orders, paper_fills, paper_trade_results, risk_events, audit_events) with strict multi-user ownership isolation
 */

const RiskEngineRefPaper =
  typeof RiskEngine !== "undefined"
    ? RiskEngine
    : typeof require === "function"
      ? require("./risk-engine")
      : null;

const AISafetyGateRefPaper =
  typeof AISafetyGate !== "undefined"
    ? AISafetyGate
    : typeof require === "function"
      ? require("./ai-safety-gate")
      : null;

const StrategyEngineRefPaper =
  typeof StrategyEngine !== "undefined"
    ? StrategyEngine
    : typeof require === "function"
      ? require("./strategy-engine")
      : null;

const MarketAnalysisRefPaper =
  typeof MarketAnalysis !== "undefined"
    ? MarketAnalysis
    : typeof require === "function"
      ? require("./market-analysis")
      : null;

const AIDecisionContractRefPaper =
  typeof AIDecisionContract !== "undefined"
    ? AIDecisionContract
    : typeof require === "function"
      ? require("./ai-decision-contract")
      : null;

const AuditLoggerRefPaper =
  typeof AuditLogger !== "undefined"
    ? AuditLogger
    : null;

const ServerDbRefPaper = (() => {
  if (typeof window !== "undefined") return null;
  if (typeof require === "function") {
    try {
      return require("../../server/database");
    } catch (_) {
      return null;
    }
  }
  return null;
})();

const PaperTrading = (() => {
  const PAPER_ENGINE_VERSION = "2.0.0-DETERMINISTIC-PAPER";
  const BASE_STORAGE_KEY = "yashwin_paper_trading_state_v1";
  const DEFAULT_INITIAL_CAPITAL = 100000;

  const DOCUMENTED_PAPER_TRADING_RULES = Object.freeze({
    version: PAPER_ENGINE_VERSION,
    tradingMode: "paper",
    liveTradingEnabled: false,
    brokerOrders: "NONE",
    defaultInitialCapital: DEFAULT_INITIAL_CAPITAL,
    maxLossPerTrade: 500,
    maxDailyLoss: 1000,
    maxTradesPerDay: 3,
    maxOpenPositions: 1,
    allowAveraging: false,
    exitPriorityOrder: [
      "1. EMERGENCY_STOP — Immediate market exit in Paper Mode when global Emergency Stop is active",
      "2. STOP_LOSS — Hard directional stop-loss breach (BUY: current <= stop, SELL: current >= stop)",
      "3. RISK_LOCK — Cumulative daily loss lock when (dailyPnl + unrealizedPnl) <= -₹1,000",
      "4. TARGET_EXIT / TARGET_ACTIVATED — Target price reached (BUY: current >= target, SELL: current <= target)",
      "5. PROFIT_LOCK — Trailing protected profit lock stop breached after 10% profit milestones"
    ],
    supportedExecutionModes: [
      "MANUAL_PAPER",
      "AI_ASSISTED_PAPER",
      "AUTO_PAPER",
      "PILOT_APPROVED_PAPER"
    ],
    sqliteTablesReused: [
      "paper_accounts",
      "paper_positions",
      "paper_orders",
      "paper_fills",
      "paper_trade_results",
      "risk_events",
      "audit_events"
    ]
  });

  let currentUserId = null;

  function getStorageKey() {
    return currentUserId
      ? `${BASE_STORAGE_KEY}_user_${currentUserId}`
      : BASE_STORAGE_KEY;
  }

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

  function formatSignedINR(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    if (n > 0) return "+" + formatINR(n);
    return formatINR(n);
  }

  function defaultState() {
    return {
      userId: currentUserId,
      capital: DEFAULT_INITIAL_CAPITAL,
      realizedPnl: 0,
      unrealizedPnl: 0,
      position: null,
      dailyPnl: 0,
      tradesToday: 0,
      wins: 0,
      losses: 0,
      maxDailyLoss: 1000,
      maxLossPerTrade: 500,
      maxTradesPerDay: 3,
      profitStepPct: 0.10,
      lockedProfit: 0,
      nextProfitMilestone: 0,
      emergencyStop: false,
      autoPaperEnabled: true,
      orders: [],
      fills: [],
      history: []
    };
  }

  let state = defaultState();

  function getAuditLogger() {
    if (AuditLoggerRefPaper) return AuditLoggerRefPaper;
    if (typeof AuditLogger !== "undefined") return AuditLogger;
    if (typeof require === "function") {
      try {
        return require("./audit-logger");
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function computeAccountMetrics(rawState = state) {
    const capital = Number.isFinite(Number(rawState?.capital))
      ? Number(rawState.capital)
      : DEFAULT_INITIAL_CAPITAL;
    const realizedPnl = Number.isFinite(Number(rawState?.realizedPnl))
      ? Number(rawState.realizedPnl)
      : 0;
    const dailyPnl = Number.isFinite(Number(rawState?.dailyPnl))
      ? Number(rawState.dailyPnl)
      : 0;

    const pos = rawState?.position || rawState?.openPosition || null;
    let reservedCapital = 0;
    let unrealizedPnl = Number.isFinite(Number(rawState?.unrealizedPnl))
      ? Number(rawState.unrealizedPnl)
      : 0;

    if (pos && (pos.status === "OPEN" || !pos.status)) {
      const eq = Number(pos.effectiveQty || pos.qty || 0);
      const entry = Number(pos.entry || 0);
      const curr = Number(pos.current ?? entry);
      const side = String(pos.direction || "BUY").toUpperCase();
      reservedCapital = Math.abs(entry * eq);
      unrealizedPnl =
        side === "BUY" ? (curr - entry) * eq : (entry - curr) * eq;
    }

    const availableBalance = Math.max(0, capital + realizedPnl - reservedCapital);
    const totalEquity = capital + realizedPnl + unrealizedPnl;
    const effectiveDailyPnl = dailyPnl + unrealizedPnl;
    const maxDailyLoss = Number(rawState?.maxDailyLoss || 1000);
    const remainingDailyLossBuffer = Math.max(0, maxDailyLoss + effectiveDailyPnl);
    const wins = Number(rawState?.wins || 0);
    const losses = Number(rawState?.losses || 0);
    const closedCount = wins + losses;
    const winRate = closedCount > 0 ? Math.round((wins / closedCount) * 100) : 0;

    return {
      capital,
      capitalFormatted: formatINR(capital),
      reservedCapital,
      reservedCapitalFormatted: formatINR(reservedCapital),
      availableBalance,
      availableBalanceFormatted: formatINR(availableBalance),
      totalEquity,
      totalEquityFormatted: formatINR(totalEquity),
      realizedPnl,
      realizedPnlFormatted: formatSignedINR(realizedPnl),
      unrealizedPnl,
      unrealizedPnlFormatted: formatSignedINR(unrealizedPnl),
      dailyPnl,
      dailyPnlFormatted: formatSignedINR(dailyPnl),
      effectiveDailyPnl,
      effectiveDailyPnlFormatted: formatSignedINR(effectiveDailyPnl),
      remainingDailyLossBuffer,
      remainingDailyLossBufferFormatted: formatINR(remainingDailyLossBuffer),
      wins,
      losses,
      closedCount,
      winRate,
      winRateFormatted: `${winRate}%`
    };
  }

  function saveState() {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(getStorageKey(), JSON.stringify(state));
      } catch (_) {}
    }
  }

  function loadState(userIdOverride = undefined) {
    if (userIdOverride !== undefined) {
      currentUserId = userIdOverride ? String(userIdOverride) : null;
    }

    if (ServerDbRefPaper) {
      try {
        const acct = ServerDbRefPaper.getPaperAccount(currentUserId);
        const openPos = ServerDbRefPaper.getOpenPosition(currentUserId);
        const orders = ServerDbRefPaper.listPaperOrders(50, currentUserId);
        const fills = ServerDbRefPaper.listPaperFills(50, currentUserId);
        const history = ServerDbRefPaper.listTradeHistory(50, currentUserId);
        const em = ServerDbRefPaper.getEmergencyStop();

        if (acct) {
          state = {
            ...defaultState(),
            userId: currentUserId,
            capital: acct.capital,
            realizedPnl: acct.realizedPnl,
            unrealizedPnl: openPos ? openPos.unrealizedPnl : acct.unrealizedPnl,
            dailyPnl: acct.dailyPnl,
            tradesToday: acct.tradesToday,
            wins: acct.wins,
            losses: acct.losses,
            maxDailyLoss: acct.maxDailyLoss,
            maxLossPerTrade: acct.maxLossPerTrade,
            maxTradesPerDay: acct.maxTradesPerDay,
            autoPaperEnabled: acct.autoPaperEnabled,
            emergencyStop: Boolean(em?.active),
            position: openPos,
            lockedProfit: openPos ? openPos.lockedProfit : 0,
            nextProfitMilestone: openPos ? openPos.nextProfitMilestone : 0,
            orders,
            fills,
            history
          };
        }
      } catch (_) {}
    }

    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(getStorageKey());
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            state = {
              ...defaultState(),
              ...parsed,
              userId: currentUserId,
              orders: Array.isArray(parsed.orders) ? parsed.orders : [],
              fills: Array.isArray(parsed.fills) ? parsed.fills : [],
              history: Array.isArray(parsed.history) ? parsed.history : []
            };
          }
        } else if (!ServerDbRefPaper) {
          state = defaultState();
        }
      } catch (_) {}
    }
    return getState();
  }

  function setCurrentUser(userId = null) {
    currentUserId = userId ? String(userId) : null;
    return loadState(currentUserId);
  }

  function getCurrentUser() {
    return currentUserId;
  }

  function syncFromServerPayload(serverPaperState = {}) {
    if (!serverPaperState || !serverPaperState.ok) return getState();
    const acct = serverPaperState.account;
    const openPos = serverPaperState.openPosition || null;
    if (acct) {
      state = {
        ...defaultState(),
        userId: serverPaperState.userId || currentUserId,
        capital: Number(acct.capital ?? DEFAULT_INITIAL_CAPITAL),
        realizedPnl: Number(acct.realizedPnl ?? 0),
        unrealizedPnl: openPos
          ? Number(openPos.unrealizedPnl ?? 0)
          : Number(acct.unrealizedPnl ?? 0),
        dailyPnl: Number(acct.dailyPnl ?? 0),
        tradesToday: Number(acct.tradesToday ?? 0),
        wins: Number(acct.wins ?? 0),
        losses: Number(acct.losses ?? 0),
        maxDailyLoss: Number(acct.maxDailyLoss ?? 1000),
        maxLossPerTrade: Number(acct.maxLossPerTrade ?? 500),
        maxTradesPerDay: Number(acct.maxTradesPerDay ?? 3),
        autoPaperEnabled: acct.autoPaperEnabled !== false,
        emergencyStop: Boolean(serverPaperState.emergencyStop?.active),
        position: openPos,
        lockedProfit: openPos ? Number(openPos.lockedProfit || 0) : 0,
        nextProfitMilestone: openPos ? Number(openPos.nextProfitMilestone || 0) : 0,
        orders: Array.isArray(serverPaperState.orders) ? serverPaperState.orders : state.orders,
        fills: Array.isArray(serverPaperState.fills) ? serverPaperState.fills : state.fills,
        history: Array.isArray(serverPaperState.history) ? serverPaperState.history : state.history
      };
      saveState();
    }
    return getState();
  }

  function resetState() {
    currentUserId = null;
    state = defaultState();
    if (ServerDbRefPaper) {
      try {
        ServerDbRefPaper.resetAllTablesForTest();
      } catch (_) {}
    }
    saveState();
    return getState();
  }

  function setAutoPaperEnabled(enabled) {
    state.autoPaperEnabled = Boolean(enabled);
    if (ServerDbRefPaper) {
      try {
        ServerDbRefPaper.setSetting("autoPaperEnabled", state.autoPaperEnabled);
      } catch (_) {}
    }
    saveState();
    return state.autoPaperEnabled;
  }

  function isAutoPaperEnabled() {
    return state.autoPaperEnabled !== false;
  }

  function effectiveQuantity(data = {}) {
    const assetType = String(data.assetType || "EQUITY").toUpperCase();

    if (assetType === "OPTION") {
      const lotSize = Number(data.lotSize);
      const lots = Number(data.lots);

      if (
        !Number.isInteger(lotSize) ||
        lotSize <= 0 ||
        !Number.isInteger(lots) ||
        lots <= 0
      ) {
        return 0;
      }

      return lotSize * lots;
    }

    const qty = Number(data.qty ?? data.quantity);
    return Number.isFinite(qty) && Number.isInteger(qty) && qty > 0 ? qty : 0;
  }

  function risk(entry, stop, qty) {
    return Math.abs(Number(entry) - Number(stop)) * Number(qty);
  }

  function reward(entry, target, qty) {
    return Math.abs(Number(target) - Number(entry)) * Number(qty);
  }

  function positionValue(entry, qty) {
    return Math.abs(Number(entry) * Number(qty));
  }

  function profitStep(entry, qty) {
    return Math.max(1, positionValue(entry, qty) * state.profitStepPct);
  }

  function preview(entry, stop, target, qty, meta = {}) {
    const assetType = String(meta.assetType || "EQUITY").toUpperCase();

    const quantity = effectiveQuantity({
      qty,
      assetType,
      lotSize: meta.lotSize,
      lots: meta.lots
    });

    const r = risk(entry, stop, quantity);
    const rw = reward(entry, target, quantity);
    const value = positionValue(entry, quantity);
    const step = profitStep(entry, quantity);
    const metrics = computeAccountMetrics(state);

    return {
      risk: r,
      reward: rw,
      rr: r > 0 ? rw / r : 0,
      positionValue: value,
      reservedCapitalRequired: value,
      availableBalanceBefore: metrics.availableBalance,
      availableBalanceAfter: Math.max(0, metrics.availableBalance - value),
      exceedsAvailableBalance: value > metrics.availableBalance,
      profitStep: step,
      effectiveQuantity: quantity,
      assetType,
      lotSize: assetType === "OPTION" ? Number(meta.lotSize) : null,
      lots: assetType === "OPTION" ? Number(meta.lots) : null
    };
  }

  function canTrade(entry, stop, target, qty, meta = {}) {
    if (
      state.emergencyStop ||
      meta.emergencyStop === true ||
      Boolean(RiskEngineRefPaper && RiskEngineRefPaper.isEmergencyStopActive())
    ) {
      return {
        ok: false,
        code: "EMERGENCY_STOP_ACTIVE",
        reason: "Emergency stop is active."
      };
    }

    if (meta.staleData === true || meta.dataReady === false) {
      return {
        ok: false,
        code: "STALE_OR_UNVALIDATED_DATA",
        reason: "Cannot open paper position on stale or unvalidated market data."
      };
    }

    const side = String(meta.direction || meta.side || "BUY").toUpperCase();
    if (side !== "BUY" && side !== "SELL") {
      return {
        ok: false,
        code: "INVALID_DIRECTION",
        reason: "Invalid trade direction. Must be BUY or SELL."
      };
    }

    const numEntry = Number(entry);
    const numStop = Number(stop);
    const numTarget = Number(target);

    if (!Number.isFinite(numEntry) || numEntry <= 0) {
      return { ok: false, code: "INVALID_ENTRY", reason: "Invalid entry price." };
    }

    if (!Number.isFinite(numStop) || numStop <= 0) {
      return { ok: false, code: "INVALID_STOP", reason: "Invalid stop-loss price." };
    }

    if (!Number.isFinite(numTarget) || numTarget <= 0) {
      return { ok: false, code: "INVALID_TARGET", reason: "Invalid target price." };
    }

    if (side === "BUY" && numStop >= numEntry) {
      return {
        ok: false,
        code: "INVALID_BUY_STOP",
        reason: "Invalid BUY stop-loss. Stop-loss must be below entry price."
      };
    }

    if (side === "SELL" && numStop <= numEntry) {
      return {
        ok: false,
        code: "INVALID_SELL_STOP",
        reason: "Invalid SELL stop-loss. Stop-loss must be above entry price."
      };
    }

    if (side === "BUY" && numTarget <= numEntry) {
      return {
        ok: false,
        code: "INVALID_BUY_TARGET",
        reason: "Invalid BUY target. Target must be above entry price."
      };
    }

    if (side === "SELL" && numTarget >= numEntry) {
      return {
        ok: false,
        code: "INVALID_SELL_TARGET",
        reason: "Invalid SELL target. Target must be below entry price."
      };
    }

    const p = preview(numEntry, numStop, numTarget, qty, meta);

    if (state.position) {
      return {
        ok: false,
        code: "OPEN_POSITION_EXISTS",
        reason: "An open paper position already exists."
      };
    }

    if (p.effectiveQuantity <= 0) {
      return {
        ok: false,
        code: "INVALID_QUANTITY",
        reason: "Invalid effective quantity."
      };
    }

    if (state.tradesToday >= state.maxTradesPerDay) {
      return {
        ok: false,
        code: "MAX_TRADES_REACHED",
        reason: "Maximum daily trades reached."
      };
    }

    if (p.risk > state.maxLossPerTrade) {
      return {
        ok: false,
        code: "MAX_LOSS_PER_TRADE_EXCEEDED",
        reason: "Trade risk exceeds ₹500 limit."
      };
    }

    if (state.dailyPnl + state.unrealizedPnl <= -state.maxDailyLoss) {
      return {
        ok: false,
        code: "DAILY_LOSS_LOCK_ACTIVE",
        reason: "Daily loss limit reached."
      };
    }

    const metrics = computeAccountMetrics(state);
    const shouldEnforceBalance =
      meta.enforceAvailableBalance === true ||
      (meta.availableBalance !== undefined && meta.availableBalance !== null);
    const effectiveAvailBal =
      meta.availableBalance !== undefined && meta.availableBalance !== null && Number.isFinite(Number(meta.availableBalance))
        ? Number(meta.availableBalance)
        : metrics.availableBalance;

    if (shouldEnforceBalance && p.positionValue > effectiveAvailBal) {
      return {
        ok: false,
        code: "INSUFFICIENT_PAPER_BALANCE",
        reason: `Order value (₹${p.positionValue.toFixed(2)}) exceeds available paper balance (₹${effectiveAvailBal.toFixed(2)}).`
      };
    }

    if (RiskEngineRefPaper && typeof RiskEngineRefPaper.evaluate === "function") {
      const availableBalance = shouldEnforceBalance ? effectiveAvailBal : undefined;
      const riskCheck = RiskEngineRefPaper.evaluate({
        side,
        symbol: meta.symbol || "NIFTY 50",
        existingSymbol: state.position ? state.position.symbol : null,
        entry: numEntry,
        stop: numStop,
        target: numTarget,
        quantity: p.assetType === "OPTION" ? undefined : p.effectiveQuantity,
        assetType: p.assetType,
        lotSize: p.lotSize ?? 1,
        lots: p.lots ?? 1,
        dailyPnl: state.dailyPnl,
        unrealizedPnl: state.unrealizedPnl,
        tradesToday: state.tradesToday,
        openPositions: state.position ? 1 : 0,
        averaging: meta.averaging === true,
        staleData: meta.staleData === true,
        dataReady: meta.dataReady !== false,
        emergencyStop: state.emergencyStop || meta.emergencyStop === true,
        availableBalance,
        limits: {
          maxLossPerTrade: state.maxLossPerTrade,
          maxDailyLoss: state.maxDailyLoss,
          maxTradesPerDay: state.maxTradesPerDay,
          maxOpenPositions: 1
        }
      });

      if (!riskCheck.allowed) {
        return {
          ok: false,
          code: "RISK_REJECTED",
          reason: riskCheck.reasons.join(" "),
          riskCheck
        };
      }
    }

    return {
      ok: true,
      preview: p
    };
  }

  function openPosition(data = {}) {
    if (data.clientOrderKey) {
      const dupOrder = state.orders.find(
        (o) => o && o.clientOrderKey && String(o.clientOrderKey) === String(data.clientOrderKey)
      );
      if (dupOrder) {
        return {
          ok: false,
          code: "DUPLICATE_ORDER_REQUEST",
          reason: "Duplicate order request rejected (clientOrderKey already exists)."
        };
      }
    }

    const check = canTrade(
      data.entry,
      data.stop,
      data.target,
      data.qty,
      data
    );

    if (!check.ok) {
      if (ServerDbRefPaper && check.riskCheck) {
        try {
          ServerDbRefPaper.insertRiskEvent(
            check.riskCheck,
            data.symbol || "NIFTY 50",
            String(data.direction || data.side || "BUY").toUpperCase(),
            currentUserId
          );
        } catch (_) {}
      }
      if (data.recordRejectedOrder === true) {
        const rejNow = new Date().toISOString();
        const rejOrderId = `PAPER-ORD-REJ-${Date.now()}-${state.orders.length + 1}`;
        const rejOrder = {
          orderId: rejOrderId,
          type: "ENTRY",
          symbol: data.symbol || "NIFTY 50",
          exchange: data.exchange || "NSE",
          direction: String(data.direction || data.side || "BUY").toUpperCase(),
          assetType: String(data.assetType || "EQUITY").toUpperCase(),
          lotSize: data.lotSize || null,
          lots: data.lots || null,
          quantity: Number(data.qty || data.quantity || 0),
          price: Number(data.entry || 0),
          stop: Number(data.stop || 0) || null,
          target: Number(data.target || 0) || null,
          mode: data.mode || "MANUAL_PAPER",
          reason: check.reason,
          rejectionReason: check.reason,
          status: "REJECTED",
          positionId: null,
          tradeId: null,
          timestamp: rejNow
        };
        state.orders.unshift(rejOrder);
        if (ServerDbRefPaper && typeof ServerDbRefPaper.recordRejectedPaperOrder === "function") {
          try {
            ServerDbRefPaper.recordRejectedPaperOrder(
              {
                ...data,
                orderId: rejOrderId,
                rejectionReason: check.reason,
                timestamp: rejNow
              },
              currentUserId
            );
          } catch (_) {}
        }
        saveState();
      }
      return check;
    }

    const step = check.preview.profitStep;
    const openedAt = new Date().toISOString();
    const orderId = `PAPER-ORD-${Date.now()}-${state.orders.length + 1}`;
    const fillId = `PAPER-FILL-${Date.now()}-${state.fills.length + 1}`;
    const positionId = `PAPER-POS-${Date.now()}-${state.orders.length + 1}`;
    const direction = String(data.direction || data.side || "BUY").toUpperCase();

    state.position = {
      id: positionId,
      orderId,
      fillId,
      symbol: data.symbol || "NIFTY 50",
      exchange: data.exchange || "NSE",
      direction,
      entry: Number(data.entry),
      averagePrice: Number(data.entry),
      stop: Number(data.stop),
      target: Number(data.target),
      trailingStop: null,
      qty: Number(data.qty || check.preview.effectiveQuantity),
      effectiveQty: check.preview.effectiveQuantity,
      assetType: check.preview.assetType,
      lotSize: check.preview.lotSize,
      lots: check.preview.lots,
      current: Number(data.entry),
      positionValue: check.preview.positionValue,
      profitStep: step,
      lockedProfit: 0,
      nextProfitMilestone: step,
      targetActivated: false,
      exitOnTarget: data.exitOnTarget === true,
      unrealizedPnl: 0,
      realizedPnl: 0,
      status: "OPEN",
      mode: data.mode || "MANUAL_PAPER",
      openedAt
    };

    const orderRecord = {
      orderId,
      clientOrderKey: data.clientOrderKey || null,
      positionId,
      tradeId: null,
      type: "ENTRY",
      symbol: state.position.symbol,
      exchange: state.position.exchange,
      direction,
      assetType: state.position.assetType,
      lotSize: state.position.lotSize,
      lots: state.position.lots,
      quantity: state.position.effectiveQty,
      price: state.position.entry,
      stop: state.position.stop,
      target: state.position.target,
      mode: state.position.mode,
      reason: data.reason || "Paper position entry",
      status: "FILLED_PAPER",
      timestamp: openedAt
    };

    const fillRecord = {
      fillId,
      orderId,
      positionId,
      tradeId: null,
      symbol: state.position.symbol,
      exchange: state.position.exchange,
      direction,
      assetType: state.position.assetType,
      orderType: "ENTRY",
      quantity: state.position.effectiveQty,
      fillPrice: state.position.entry,
      slippage: 0,
      fees: 0,
      dataSource: "VALIDATED_PAPER_QUOTE",
      filledAt: openedAt
    };

    state.orders.unshift(orderRecord);
    state.fills.unshift(fillRecord);

    state.lockedProfit = 0;
    state.nextProfitMilestone = step;
    state.unrealizedPnl = 0;
    state.tradesToday += 1;

    if (ServerDbRefPaper) {
      try {
        ServerDbRefPaper.recordOpenPositionTransaction({
          id: positionId,
          userId: currentUserId,
          orderId,
          fillId,
          clientOrderKey: data.clientOrderKey || null,
          symbol: state.position.symbol,
          exchange: state.position.exchange,
          direction,
          assetType: state.position.assetType,
          lotSize: state.position.lotSize,
          lots: state.position.lots,
          qty: state.position.qty,
          effectiveQty: state.position.effectiveQty,
          entry: state.position.entry,
          stop: state.position.stop,
          target: state.position.target,
          profitStep: step,
          exitOnTarget: state.position.exitOnTarget,
          mode: state.position.mode,
          reason: orderRecord.reason,
          openedAt
        });
      } catch (_) {}
    }

    saveState();

    return {
      ok: true,
      orderId,
      fillId,
      positionId,
      position: { ...state.position },
      order: orderRecord,
      fill: fillRecord,
      preview: check.preview,
      accountMetrics: computeAccountMetrics(state)
    };
  }

  function updateTrailingProfit(pnl) {
    const p = state.position;
    if (!p) return false;

    let milestoneReached = false;

    while (pnl >= p.nextProfitMilestone) {
      p.lockedProfit = Math.max(
        p.lockedProfit,
        p.nextProfitMilestone - p.profitStep
      );

      p.nextProfitMilestone += p.profitStep;
      milestoneReached = true;
    }

    state.lockedProfit = p.lockedProfit;
    state.nextProfitMilestone = p.nextProfitMilestone;

    const lockedStop = lockedStopPrice();
    p.trailingStop = lockedStop;

    return milestoneReached;
  }

  function lockedStopPrice() {
    const p = state.position;
    if (!p || p.lockedProfit <= 0) return null;

    const effectiveQty = Number(p.effectiveQty || p.qty);
    const priceMove = p.lockedProfit / effectiveQty;

    return p.direction === "BUY"
      ? p.entry + priceMove
      : p.entry - priceMove;
  }

  function syncOpenPositionToDb() {
    if (ServerDbRefPaper && state.position) {
      try {
        ServerDbRefPaper.updateOpenPositionState(state.position, currentUserId);
      } catch (_) {}
    }
  }

  /*
   * Priority Order (Phase 14 & Task 10):
   * 1. Emergency stop
   * 2. Hard stop loss
   * 3. Risk lock (daily loss lock)
   * 4. Target
   * 5. Trailing / profit lock
   */
  function updatePrice(price, options = {}) {
    if (!state.position) return null;

    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return null;
    }

    const p = state.position;
    p.current = numericPrice;

    const effectiveQty = Number(p.effectiveQty || p.qty);

    const pnl =
      p.direction === "BUY"
        ? (p.current - p.entry) * effectiveQty
        : (p.entry - p.current) * effectiveQty;

    p.unrealizedPnl = pnl;
    state.unrealizedPnl = pnl;

    const shouldAutoClose = options.autoExit === true;

    // 1. EMERGENCY STOP
    if (
      state.emergencyStop ||
      options.emergencyStop === true ||
      Boolean(RiskEngineRefPaper && RiskEngineRefPaper.isEmergencyStopActive())
    ) {
      if (shouldAutoClose) {
        const closed = closePosition(numericPrice, "EMERGENCY_STOP");
        return {
          action: "EMERGENCY_STOP",
          pnl,
          closed: closed.ok,
          trade: closed.trade || null
        };
      }
      syncOpenPositionToDb();
      saveState();
      return {
        action: "EMERGENCY_STOP",
        pnl
      };
    }

    // 2. HARD STOP LOSS
    if (
      (p.direction === "BUY" && p.current <= p.stop) ||
      (p.direction === "SELL" && p.current >= p.stop)
    ) {
      if (shouldAutoClose) {
        const closed = closePosition(numericPrice, "STOP_LOSS");
        return {
          action: "STOP_LOSS",
          pnl,
          closed: closed.ok,
          trade: closed.trade || null
        };
      }
      syncOpenPositionToDb();
      saveState();
      return {
        action: "STOP_LOSS",
        pnl
      };
    }

    // 3. RISK LOCK (Cumulative Daily Loss Lock)
    if (state.dailyPnl + pnl <= -state.maxDailyLoss) {
      if (shouldAutoClose) {
        const closed = closePosition(numericPrice, "RISK_LOCK");
        return {
          action: "RISK_LOCK",
          pnl,
          projectedDailyPnl: state.dailyPnl,
          closed: closed.ok,
          trade: closed.trade || null
        };
      }
      syncOpenPositionToDb();
      saveState();
      return {
        action: "RISK_LOCK",
        pnl,
        projectedDailyPnl: state.dailyPnl + pnl
      };
    }

    // Update trailing milestones before checking target/trailing lock
    const milestoneReached = updateTrailingProfit(pnl);
    const lockedStop = lockedStopPrice();

    // 4. TARGET
    const targetReached =
      p.direction === "BUY"
        ? p.current >= p.target
        : p.current <= p.target;

    if (targetReached && (p.exitOnTarget || options.exitOnTarget === true)) {
      if (shouldAutoClose) {
        const closed = closePosition(numericPrice, "TARGET_EXIT");
        return {
          action: "TARGET_EXIT",
          pnl,
          target: p.target,
          closed: closed.ok,
          trade: closed.trade || null
        };
      }
      syncOpenPositionToDb();
      saveState();
      return {
        action: "TARGET_EXIT",
        pnl,
        target: p.target
      };
    }

    if (targetReached && !p.targetActivated) {
      p.targetActivated = true;
      syncOpenPositionToDb();
      saveState();

      return {
        action: "TARGET_ACTIVATED",
        pnl,
        target: p.target,
        lockedProfit: p.lockedProfit,
        nextProfitMilestone: p.nextProfitMilestone
      };
    }

    // 5. TRAILING / PROTECTED PROFIT LOCK
    if (
      lockedStop !== null &&
      ((p.direction === "BUY" && p.current <= lockedStop) ||
        (p.direction === "SELL" && p.current >= lockedStop))
    ) {
      if (shouldAutoClose) {
        const closed = closePosition(numericPrice, "PROFIT_LOCK");
        return {
          action: "PROFIT_LOCK",
          pnl,
          lockedProfit: p.lockedProfit,
          lockedStopPrice: lockedStop,
          closed: closed.ok,
          trade: closed.trade || null
        };
      }
      syncOpenPositionToDb();
      saveState();
      return {
        action: "PROFIT_LOCK",
        pnl,
        lockedProfit: p.lockedProfit,
        lockedStopPrice: lockedStop
      };
    }

    if (milestoneReached) {
      syncOpenPositionToDb();
      saveState();
      return {
        action: "AI_REANALYZE",
        pnl,
        lockedProfit: p.lockedProfit,
        nextProfitMilestone: p.nextProfitMilestone,
        targetActivated: Boolean(p.targetActivated)
      };
    }

    syncOpenPositionToDb();
    saveState();
    return {
      action: "HOLD",
      pnl,
      targetActivated: Boolean(p.targetActivated),
      lockedProfit: p.lockedProfit,
      nextProfitMilestone: p.nextProfitMilestone
    };
  }

  /*
   * Automatic Paper Trading Pipeline:
   * Validated Market Data -> MarketAnalysis -> AI Decision Contract
   * -> Deterministic Strategy -> RiskEngine -> AISafetyGate -> Paper BUY/SELL
   * -> Position Management / Automatic Exits -> P&L -> Audit
   */
  function autoEvaluateAndExecute(input = {}) {
    const logger = input.auditLogger || getAuditLogger();
    const isEmergency =
      state.emergencyStop ||
      input.emergencyStop === true ||
      Boolean(logger && logger.isEmergencyStopActive()) ||
      Boolean(RiskEngineRefPaper && RiskEngineRefPaper.isEmergencyStopActive());

    if (isEmergency) {
      const closed = state.position
        ? closePosition(input.price || state.position.current, "EMERGENCY_STOP")
        : null;
      return {
        ok: false,
        executed: false,
        action: "EMERGENCY_STOP",
        reason: "Emergency stop is active.",
        closedPosition: closed
      };
    }

    if (!isAutoPaperEnabled() && input.forceAuto !== true) {
      return {
        ok: false,
        executed: false,
        action: "HOLD",
        reason: "Automatic paper trading is disabled."
      };
    }

    const snapshot = input.snapshot || {};
    const dataReady = input.dataReady === true || snapshot.dataReady === true;
    const price = Number(input.price ?? snapshot.price);
    const symbol = String(input.symbol || snapshot.name || snapshot.key || "NIFTY 50").trim();
    const exchange = String(input.exchange || snapshot.exchange || "NSE").trim().toUpperCase();
    const assetType = String(input.assetType || snapshot.type || "EQUITY").toUpperCase() === "OPTION"
      ? "OPTION"
      : "EQUITY";
    const optionType = String(input.optionType || snapshot.optionType || "").toUpperCase();

    if (!dataReady || !Number.isFinite(price) || price <= 0) {
      return {
        ok: false,
        executed: false,
        action: "NO_TRADE",
        reason: "Validated market data is required for automatic paper trading."
      };
    }

    // If an open paper position already exists for this symbol, update price & manage automatic exits first
    if (state.position) {
      if (state.position.symbol === symbol) {
        const updateRes = updatePrice(price, {
          autoExit: true,
          exitOnTarget: input.exitOnTarget === true || state.position.exitOnTarget === true
        });

        if (updateRes && updateRes.closed && logger) {
          logger.logTradeDecision(
            `Auto Paper Exit (${updateRes.action}) on ${symbol}`,
            {
              symbol,
              action: updateRes.action,
              pnl: updateRes.pnl
            }
          );
        }

        return {
          ok: true,
          executed: Boolean(updateRes && updateRes.closed),
          action: updateRes ? updateRes.action : "HOLD",
          positionUpdate: updateRes,
          reason: updateRes && updateRes.closed
            ? `Position automatically closed on ${updateRes.action}.`
            : "Existing open position updated; duplicate entry blocked."
        };
      }

      // Duplicate/single-position protection across all symbols
      return {
        ok: false,
        executed: false,
        action: "HOLD",
        reason: "Maximum open positions reached (1 open paper position already active)."
      };
    }

    // Step 1: Deterministic Market Analysis
    const analysis =
      input.analysis ||
      (MarketAnalysisRefPaper
        ? MarketAnalysisRefPaper.analyze({
            dataReady: true,
            assetType,
            trendScore: snapshot.indicators?.trendScore,
            momentumScore: snapshot.indicators?.momentumScore,
            volumeScore: snapshot.indicators?.volumeScore,
            vwapScore: snapshot.indicators?.vwapScore,
            supportResistanceScore: snapshot.indicators?.supportResistanceScore,
            volatilityScore: snapshot.indicators?.volatilityScore,
            optionsScore: snapshot.indicators?.optionsScore
          })
        : null);

    if (!analysis || analysis.dataReady !== true) {
      return {
        ok: false,
        executed: false,
        action: "NO_TRADE",
        reason: "Market analysis unavailable."
      };
    }

    // Step 2: Optional AI Decision Contract validation (when AI payload is provided)
    let validatedAIDecision = null;
    if (input.aiDecision !== undefined && input.aiDecision !== null && AIDecisionContractRefPaper) {
      const contractRes = AIDecisionContractRefPaper.validate(input.aiDecision);
      if (!contractRes.ok) {
        if (logger) {
          logger.logRiskRejection("Auto Paper trade blocked: Invalid AI Decision Contract", {
            symbol,
            errors: contractRes.errors
          });
        }
        return {
          ok: false,
          executed: false,
          action: "NO_TRADE",
          code: contractRes.code,
          reason: contractRes.errors.join(" ")
        };
      }
      validatedAIDecision = contractRes.decision;
      if (ServerDbRefPaper) {
        try {
          ServerDbRefPaper.insertAIDecision(validatedAIDecision, symbol, currentUserId);
        } catch (_) {}
      }
    }

    // Step 3: Deterministic Strategy Engine
    const strategy =
      input.strategy ||
      (StrategyEngineRefPaper
        ? StrategyEngineRefPaper.evaluate({
            dataReady: true,
            price,
            assetType,
            analysis,
            aiDecision: validatedAIDecision,
            stopLoss: input.stopLoss,
            target: input.target,
            emergencyStop: isEmergency
          })
        : null);

    if (ServerDbRefPaper && strategy) {
      try {
        ServerDbRefPaper.insertStrategyDecision(strategy, symbol, currentUserId);
      } catch (_) {}
    }

    if (
      !strategy ||
      !["BUY", "SELL", "BUY_CE", "BUY_PE"].includes(strategy.action)
    ) {
      return {
        ok: false,
        executed: false,
        action: strategy?.action || "NO_TRADE",
        strategy,
        reason: strategy?.reason || "Strategy did not authorize a directional paper trade."
      };
    }

    const direction = strategy.action === "SELL" ? "SELL" : "BUY";
    const qty = Number(input.quantity ?? input.qty ?? 1);
    const lotSize = Number(input.lotSize ?? 1);
    const lots = Number(input.lots ?? 1);
    const acctMetrics = computeAccountMetrics(state);

    // Step 4: Centralized Risk Engine
    const riskCheck = RiskEngineRefPaper.evaluate({
      side: direction,
      symbol,
      entry: strategy.entry,
      stop: strategy.stopLoss,
      target: strategy.target,
      quantity: qty,
      assetType,
      lotSize,
      lots,
      dailyPnl: state.dailyPnl,
      unrealizedPnl: state.unrealizedPnl,
      tradesToday: state.tradesToday,
      openPositions: state.position ? 1 : 0,
      availableBalance: acctMetrics.availableBalance,
      averaging: false,
      emergencyStop: isEmergency
    });

    if (ServerDbRefPaper) {
      try {
        ServerDbRefPaper.insertRiskEvent(riskCheck, symbol, direction, currentUserId);
      } catch (_) {}
    }

    if (!riskCheck.allowed) {
      if (logger) {
        logger.logRiskRejection("Auto Paper trade rejected by RiskEngine", {
          symbol,
          direction,
          reasons: riskCheck.reasons
        });
      }
      return {
        ok: false,
        executed: false,
        action: "BLOCKED",
        code: "RISK_REJECTED",
        riskCheck,
        reason: riskCheck.reasons.join(" ")
      };
    }

    // Step 5: AI Safety Gate
    const aiGate = AISafetyGateRefPaper.evaluate({
      dataReady: true,
      signal: strategy.action,
      confidence: strategy.confidence,
      risk: analysis.risk,
      assetType,
      optionType,
      side: direction,
      stopLoss: strategy.stopLoss,
      riskCheck,
      aiDecision: validatedAIDecision || undefined,
      maxTradesPerDay: state.maxTradesPerDay,
      tradesToday: state.tradesToday,
      maxOpenPositions: 1,
      openPositions: state.position ? 1 : 0,
      emergencyStop: isEmergency,
      averaging: false
    });

    if (!aiGate.allowed) {
      if (logger) {
        logger.logRiskRejection("Auto Paper trade rejected by AISafetyGate", {
          symbol,
          direction,
          reasons: aiGate.reasons
        });
      }
      return {
        ok: false,
        executed: false,
        action: "BLOCKED",
        code: "AI_SAFETY_REJECTED",
        aiGate,
        reason: aiGate.reasons.join(" ")
      };
    }

    // Step 6: Open Paper Position
    const opened = openPosition({
      symbol,
      exchange,
      direction,
      entry: strategy.entry,
      stop: strategy.stopLoss,
      target: strategy.target,
      qty,
      assetType,
      lotSize,
      lots,
      exitOnTarget: input.exitOnTarget === true,
      mode: "AUTO_PAPER"
    });

    if (!opened.ok) {
      return {
        ok: false,
        executed: false,
        action: "BLOCKED",
        reason: opened.reason
      };
    }

    if (logger) {
      logger.logTradeDecision(
        `Auto Paper ${direction} executed on ${symbol} at ₹${strategy.entry}`,
        {
          symbol,
          direction,
          entry: strategy.entry,
          stop: strategy.stopLoss,
          target: strategy.target,
          quantity: opened.preview.effectiveQuantity,
          confidence: strategy.confidence
        }
      );
    }

    return {
      ok: true,
      executed: true,
      action: direction,
      signal: strategy.action,
      position: opened.position,
      preview: opened.preview,
      strategy,
      riskCheck,
      aiGate
    };
  }

  function closePosition(price, reason = "MANUAL") {
    if (!state.position) {
      return { ok: false, code: "NO_OPEN_POSITION", reason: "No open position." };
    }

    const p = state.position;
    const exitPrice =
      price !== undefined && price !== null && Number.isFinite(Number(price)) && Number(price) > 0
        ? Number(price)
        : Number(p.current);

    const effectiveQty = Number(p.effectiveQty || p.qty);

    const pnl =
      p.direction === "BUY"
        ? (exitPrice - p.entry) * effectiveQty
        : (p.entry - exitPrice) * effectiveQty;

    const closedAt = new Date().toISOString();
    const exitOrderId = `PAPER-ORD-${Date.now()}-${state.orders.length + 1}`;
    const exitFillId = `PAPER-FILL-${Date.now()}-${state.fills.length + 1}`;
    const tradeId = `PAPER-TRD-${Date.now()}-${state.history.length + 1}`;
    const exitDirection = p.direction === "BUY" ? "SELL" : "BUY";
    const entryOrderId = p.orderId || null;
    const entryFillId = p.fillId || null;

    const exitOrderRecord = {
      orderId: exitOrderId,
      positionId: p.id,
      tradeId,
      type: "EXIT",
      symbol: p.symbol,
      exchange: p.exchange || "NSE",
      direction: exitDirection,
      assetType: p.assetType,
      lotSize: p.lotSize ?? null,
      lots: p.lots ?? null,
      quantity: effectiveQty,
      price: exitPrice,
      stop: p.stop,
      target: p.target,
      mode: p.mode || "MANUAL_PAPER",
      reason,
      status: "FILLED_PAPER",
      timestamp: closedAt
    };

    const exitFillRecord = {
      fillId: exitFillId,
      orderId: exitOrderId,
      positionId: p.id,
      tradeId,
      symbol: p.symbol,
      exchange: p.exchange || "NSE",
      direction: exitDirection,
      assetType: p.assetType,
      orderType: "EXIT",
      quantity: effectiveQty,
      fillPrice: exitPrice,
      slippage: 0,
      fees: 0,
      dataSource: "VALIDATED_PAPER_QUOTE",
      filledAt: closedAt
    };

    // Link entry order and entry fill to tradeId in memory as well
    for (const o of state.orders) {
      if (o && entryOrderId && o.orderId === entryOrderId) {
        o.tradeId = tradeId;
      }
    }
    for (const f of state.fills) {
      if (f && entryOrderId && f.orderId === entryOrderId) {
        f.tradeId = tradeId;
      }
    }

    state.orders.unshift(exitOrderRecord);
    state.fills.unshift(exitFillRecord);

    const tradeRecord = {
      id: tradeId,
      tradeId,
      positionId: p.id,
      entryOrderId,
      exitOrderId,
      entryFillId,
      exitFillId,
      symbol: p.symbol,
      exchange: p.exchange || "NSE",
      direction: p.direction,
      assetType: p.assetType,
      lotSize: p.lotSize ?? null,
      lots: p.lots ?? null,
      quantity: effectiveQty,
      entry: p.entry,
      exit: exitPrice,
      stop: p.stop,
      target: p.target,
      grossPnl: pnl,
      fees: 0,
      pnl,
      reason,
      mode: p.mode || "MANUAL_PAPER",
      openedAt: p.openedAt,
      closedAt
    };

    state.history.unshift(tradeRecord);
    state.dailyPnl += pnl;
    state.realizedPnl += pnl;
    state.unrealizedPnl = 0;
    if (pnl > 0) state.wins += 1;
    else state.losses += 1;

    if (ServerDbRefPaper) {
      try {
        ServerDbRefPaper.recordClosePositionTransaction({
          userId: currentUserId,
          positionId: p.id,
          entryOrderId,
          exitOrderId,
          entryFillId,
          exitFillId,
          tradeId: tradeRecord.id,
          symbol: p.symbol,
          exchange: p.exchange || "NSE",
          direction: p.direction,
          assetType: p.assetType,
          lotSize: p.lotSize,
          lots: p.lots,
          effectiveQty,
          entry: p.entry,
          exitPrice,
          stop: p.stop,
          target: p.target,
          grossPnl: pnl,
          fees: 0,
          pnl,
          reason,
          mode: p.mode,
          openedAt: p.openedAt,
          closedAt
        });
      } catch (_) {}
    }

    state.position = null;
    state.lockedProfit = 0;
    state.nextProfitMilestone = 0;

    saveState();

    return {
      ok: true,
      pnl,
      reason,
      dailyPnl: state.dailyPnl,
      realizedPnl: state.realizedPnl,
      trade: tradeRecord,
      exitOrder: exitOrderRecord,
      exitFill: exitFillRecord,
      accountMetrics: computeAccountMetrics(state)
    };
  }

  function triggerEmergencyStop(reason = "EMERGENCY_STOP") {
    state.emergencyStop = true;
    let closedTrade = null;

    if (state.position) {
      const res = closePosition(state.position.current, reason);
      if (res.ok) {
        closedTrade = res;
      }
    } else {
      saveState();
    }

    return {
      ok: true,
      emergencyStop: true,
      closedTrade
    };
  }

  function resetEmergencyStop() {
    state.emergencyStop = false;
    saveState();
    return {
      ok: true,
      emergencyStop: false
    };
  }

  /*
   * Deterministic View Model Builder for Paper Trading, Positions, Orders, Fills & Trade History UI
   */
  function buildPaperTradingViewModel(input = {}) {
    const pState = input.paperState || state;
    const metrics = computeAccountMetrics(pState);
    const emergencyStop = Boolean(
      input.emergencyStop ||
        pState.emergencyStop ||
        input.serverEmergencyStop?.active
    );

    const pos = pState.position || pState.openPosition || null;
    let openPosition = null;
    if (pos && (pos.status === "OPEN" || !pos.status)) {
      const eq = Number(pos.effectiveQty || pos.qty || 0);
      const entry = Number(pos.entry || 0);
      const current = Number(pos.current ?? entry);
      const stop = Number(pos.stop || 0);
      const target = Number(pos.target || 0);
      const side = String(pos.direction || "BUY").toUpperCase();
      const uPnl = side === "BUY" ? (current - entry) * eq : (entry - current) * eq;
      const riskAmt = Math.abs(entry - stop) * eq;
      const rewardAmt = Math.abs(target - entry) * eq;
      const lockedStop =
        pos.lockedProfit > 0 && eq > 0
          ? side === "BUY"
            ? entry + pos.lockedProfit / eq
            : entry - pos.lockedProfit / eq
          : null;

      openPosition = {
        id: pos.id || "--",
        orderId: pos.orderId || "--",
        symbol: pos.symbol || "NIFTY 50",
        exchange: pos.exchange || "NSE",
        direction: side,
        assetType: pos.assetType || "EQUITY",
        lotSize: pos.lotSize || null,
        lots: pos.lots || null,
        quantity: eq,
        entry,
        entryFormatted: formatINR(entry),
        current,
        currentFormatted: formatINR(current),
        stop,
        stopFormatted: formatINR(stop),
        target,
        targetFormatted: formatINR(target),
        trailingStop: lockedStop,
        trailingStopFormatted: lockedStop !== null ? formatINR(lockedStop) : "INACTIVE",
        positionValue: Math.abs(entry * eq),
        positionValueFormatted: formatINR(Math.abs(entry * eq)),
        riskAmount: riskAmt,
        riskAmountFormatted: formatINR(riskAmt),
        rewardAmount: rewardAmt,
        rewardAmountFormatted: formatINR(rewardAmt),
        unrealizedPnl: uPnl,
        unrealizedPnlFormatted: formatSignedINR(uPnl),
        unrealizedTone: uPnl > 0 ? "positive" : uPnl < 0 ? "negative" : "neutral",
        profitStep: Number(pos.profitStep || 0),
        profitStepFormatted: formatINR(pos.profitStep || 0),
        lockedProfit: Number(pos.lockedProfit || 0),
        lockedProfitFormatted: formatINR(pos.lockedProfit || 0),
        nextProfitMilestone: Number(pos.nextProfitMilestone || 0),
        nextProfitMilestoneFormatted: formatINR(pos.nextProfitMilestone || 0),
        targetActivated: Boolean(pos.targetActivated),
        exitOnTarget: Boolean(pos.exitOnTarget),
        mode: pos.mode || "MANUAL_PAPER",
        openedAt: pos.openedAt || "--"
      };
    }

    const orders = (Array.isArray(pState.orders) ? pState.orders : []).map((o) => ({
      orderId: o.orderId || o.id || "--",
      type: o.type || "ENTRY",
      symbol: o.symbol || "--",
      exchange: o.exchange || "NSE",
      direction: o.direction || "BUY",
      assetType: o.assetType || "EQUITY",
      quantity: Number(o.quantity || 0),
      price: Number(o.price || 0),
      priceFormatted: formatINR(o.price || 0),
      stopFormatted: o.stop ? formatINR(o.stop) : "--",
      targetFormatted: o.target ? formatINR(o.target) : "--",
      mode: o.mode || "MANUAL_PAPER",
      reason: o.reason || "--",
      status: o.status || "FILLED_PAPER",
      timestamp: o.timestamp || "--"
    }));

    const fills = (Array.isArray(pState.fills) ? pState.fills : []).map((f) => ({
      fillId: f.fillId || "--",
      orderId: f.orderId || "--",
      symbol: f.symbol || "--",
      direction: f.direction || "BUY",
      quantity: Number(f.quantity || 0),
      fillPrice: Number(f.fillPrice || 0),
      fillPriceFormatted: formatINR(f.fillPrice || 0),
      slippage: Number(f.slippage || 0),
      fees: Number(f.fees || 0),
      filledAt: f.filledAt || "--"
    }));

    const history = (Array.isArray(pState.history) ? pState.history : []).map((t) => {
      const pnlVal = Number(t.pnl || 0);
      return {
        id: t.id || "--",
        positionId: t.positionId || "--",
        symbol: t.symbol || "--",
        exchange: t.exchange || "NSE",
        direction: t.direction || "BUY",
        assetType: t.assetType || "EQUITY",
        quantity: Number(t.quantity || 0),
        entry: Number(t.entry ?? t.entryPrice ?? 0),
        entryFormatted: formatINR(t.entry ?? t.entryPrice ?? 0),
        exit: Number(t.exit ?? t.exitPrice ?? 0),
        exitFormatted: formatINR(t.exit ?? t.exitPrice ?? 0),
        stopFormatted: t.stop ? formatINR(t.stop) : "--",
        targetFormatted: t.target ? formatINR(t.target) : "--",
        pnl: pnlVal,
        pnlFormatted: formatSignedINR(pnlVal),
        pnlTone: pnlVal > 0 ? "positive" : pnlVal < 0 ? "negative" : "neutral",
        reason: t.reason || "MANUAL",
        openedAt: t.openedAt || "--",
        closedAt: t.closedAt || "--"
      };
    });

    const maxTradesPerDay = Number(pState.maxTradesPerDay || 3);
    const tradesToday = Number(pState.tradesToday || 0);

    return {
      engineVersion: PAPER_ENGINE_VERSION,
      tradingMode: "paper",
      liveTradingEnabled: false,
      emergencyStop,
      autoPaperEnabled: pState.autoPaperEnabled !== false,
      account: {
        ...metrics,
        tradesToday,
        maxTradesPerDay,
        tradesTodayFormatted: `${tradesToday} / ${maxTradesPerDay}`,
        maxLossPerTrade: Number(pState.maxLossPerTrade || 500),
        maxLossPerTradeFormatted: formatINR(pState.maxLossPerTrade || 500),
        maxDailyLoss: Number(pState.maxDailyLoss || 1000),
        maxDailyLossFormatted: formatINR(pState.maxDailyLoss || 1000)
      },
      openPosition,
      orders,
      fills,
      history,
      documentedRules: DOCUMENTED_PAPER_TRADING_RULES
    };
  }

  function getState() {
    const copy = JSON.parse(JSON.stringify(state));
    const metrics = computeAccountMetrics(copy);
    copy.reservedCapital = metrics.reservedCapital;
    copy.availableBalance = metrics.availableBalance;
    copy.totalEquity = metrics.totalEquity;
    copy.effectiveDailyPnl = metrics.effectiveDailyPnl;
    return copy;
  }

  loadState();

  return {
    PAPER_ENGINE_VERSION,
    DOCUMENTED_PAPER_TRADING_RULES,
    formatINR,
    formatSignedINR,
    computeAccountMetrics,
    risk,
    reward,
    positionValue,
    profitStep,
    preview,
    canTrade,
    openPosition,
    updatePrice,
    autoEvaluateAndExecute,
    setAutoPaperEnabled,
    isAutoPaperEnabled,
    closePosition,
    triggerEmergencyStop,
    resetEmergencyStop,
    resetState,
    loadState,
    setCurrentUser,
    getCurrentUser,
    syncFromServerPayload,
    buildPaperTradingViewModel,
    getState,
    lockedStopPrice
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = PaperTrading;
}
