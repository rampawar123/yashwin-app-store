/*
 * YASHWIN AI Trading Assistant
 * Phase 12 & Task 9 — Complete Centralized Risk Management Engine
 *
 * Existing Risk Rules & Enforcement Points Documented & Preserved:
 * - Max loss per trade: ₹500 (DEFAULTS.maxLossPerTrade)
 * - Max daily loss lock: ₹1,000 (DEFAULTS.maxDailyLoss)
 * - Max trades per day: 3 (DEFAULTS.maxTradesPerDay)
 * - Max concurrent open positions: 1 (DEFAULTS.maxOpenPositions)
 * - Position averaging: false / BLOCKED (DEFAULTS.allowAveraging)
 * - TRADING_MODE = "paper"
 * - LIVE_TRADING_ENABLED = false
 *
 * Actual Enforcement Points Across Codebase:
 * 1. StrategyEngine (`web/modules/strategy-engine.js`) — `buildStrategyViewModel`
 * 2. AISafetyGate (`web/modules/ai-safety-gate.js`) — requires `riskCheck.allowed === true`
 * 3. PaperTrading (`web/modules/paper.js`) — `canTrade`, `openPosition`, `updatePrice` (DAILY_LOSS_LOCK / STOP_LOSS / EMERGENCY_STOP), `autoEvaluateAndExecute`
 * 4. PilotApproval (`web/modules/pilot-approval.js`) — `createProposal` & `approveProposal`
 * 5. Server API (`server/api-server.js`) — `POST /api/paper/open`, `POST /api/risk/evaluate`, `GET /api/risk/status`, `POST /api/emergency/activate`, `POST /api/emergency/reset`
 * 6. SQLite Database (`server/database.js`) — `paper_accounts`, `paper_positions`, `risk_events`, `emergency_stop_state`
 *
 * No broker orders.
 * No live trading.
 * No profit guarantee.
 */

const RiskEngine = (() => {

  const RISK_ENGINE_VERSION = "2.0.0-DETERMINISTIC-RISK";

  const DEFAULTS = {
    maxLossPerTrade: 500,
    maxDailyLoss: 1000,
    maxTradesPerDay: 3,
    maxQuantity: 100000,
    maxOpenPositions: 1,
    allowAveraging: false
  };

  const DOCUMENTED_RISK_RULES = Object.freeze({
    version: RISK_ENGINE_VERSION,
    tradingMode: "paper",
    liveTradingEnabled: false,
    limits: Object.freeze({ ...DEFAULTS }),
    perTradeControl: Object.freeze({
      maxLossPerTrade: 500,
      mandatoryStopLoss: true,
      buyStopRule: "stop < entry",
      sellStopRule: "stop > entry",
      formula: "riskAmount = Math.abs(entry - stop) * effectiveQuantity <= 500"
    }),
    dailyRiskControl: Object.freeze({
      maxDailyLoss: 1000,
      dailyLossLockThreshold: -1000,
      includesRealizedAndUnrealized: true,
      blocksNewTradesWhenLocked: true
    }),
    tradeFrequencyAndPositionLimits: Object.freeze({
      maxTradesPerDay: 3,
      maxOpenPositions: 1,
      allowAveraging: false,
      allowDuplicatePosition: false
    }),
    emergencyStopControl: Object.freeze({
      blocksAllNewTradesImmediately: true,
      autoResetAllowed: false,
      explicitResetRequired: true
    }),
    enforcementPoints: Object.freeze([
      "StrategyEngine.buildStrategyViewModel",
      "AISafetyGate.evaluate",
      "PaperTrading.canTrade / openPosition / autoEvaluateAndExecute / updatePrice",
      "PilotApproval.createProposal / approveProposal",
      "Server API (/api/paper/open, /api/risk/evaluate, /api/risk/status, /api/emergency/*)",
      "Single SQLite Database (paper_accounts, paper_positions, risk_events, emergency_stop_state)"
    ])
  });

  let configuredLimits = { ...DEFAULTS };
  let emergencyStopActive = false;

  function number(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function isPositiveFinite(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0;
  }

  function roundCurrency(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
  }

  function configureLimits(partial = {}) {
    if (number(partial.maxLossPerTrade) > 0) {
      configuredLimits.maxLossPerTrade = number(partial.maxLossPerTrade);
    }
    if (number(partial.maxDailyLoss) > 0) {
      configuredLimits.maxDailyLoss = number(partial.maxDailyLoss);
    }
    if (number(partial.maxTradesPerDay) > 0) {
      configuredLimits.maxTradesPerDay = Math.floor(number(partial.maxTradesPerDay));
    }
    if (number(partial.maxQuantity) > 0) {
      configuredLimits.maxQuantity = Math.floor(number(partial.maxQuantity));
    }
    if (number(partial.maxOpenPositions) > 0) {
      configuredLimits.maxOpenPositions = Math.floor(number(partial.maxOpenPositions));
    }
    configuredLimits.allowAveraging = false;
    return getLimits();
  }

  function resetLimits() {
    configuredLimits = { ...DEFAULTS };
    return getLimits();
  }

  function getLimits() {
    return { ...configuredLimits };
  }

  function setEmergencyStop(active) {
    emergencyStopActive = Boolean(active);
    return emergencyStopActive;
  }

  function isEmergencyStopActive() {
    return emergencyStopActive;
  }

  /*
   * Deterministic Position Sizing Helper (Task 9 Section 2 & 6):
   * Calculates maximum safe quantity or option lots so that:
   * 1) Per-trade risk <= min(maxLossPerTrade (₹500), remainingDailyRiskBudget)
   * 2) Capital required (entry * effectiveQuantity) <= availableBalance (when provided)
   */
  function calculateSafePositionSize(input = {}) {
    const limits = {
      ...configuredLimits,
      ...(input.limits || {})
    };

    const entry = Number(input.entry);
    const stop = Number(input.stop);
    const side = String(input.side || input.direction || "BUY").trim().toUpperCase();
    const assetType = String(input.assetType || "EQUITY").trim().toUpperCase();
    const lotSize = Number(input.lotSize ?? 1);
    const maxLossPerTrade = isPositiveFinite(input.maxLossPerTrade)
      ? Math.min(Number(input.maxLossPerTrade), limits.maxLossPerTrade)
      : limits.maxLossPerTrade;

    const dailyPnl = number(input.dailyPnl, 0);
    const unrealizedPnl = number(input.unrealizedPnl, 0);
    const combinedDailyPnl = dailyPnl + (unrealizedPnl < 0 ? unrealizedPnl : 0);
    const remainingDailyRisk = Math.max(0, roundCurrency(limits.maxDailyLoss + combinedDailyPnl));
    const effectiveRiskBudget = Math.min(maxLossPerTrade, remainingDailyRisk);

    const result = {
      ok: false,
      side,
      assetType,
      entry: isPositiveFinite(entry) ? entry : null,
      stop: isPositiveFinite(stop) ? stop : null,
      unitRisk: 0,
      maxLossPerTrade,
      remainingDailyRisk,
      effectiveRiskBudget,
      recommendedQuantity: 0,
      recommendedLots: 0,
      lotSize: assetType === "OPTION" ? lotSize : 1,
      effectiveQuantity: 0,
      riskAmount: 0,
      capitalRequired: 0,
      reason: ""
    };

    if (side !== "BUY" && side !== "SELL") {
      result.reason = "Invalid trade side. Use BUY or SELL.";
      return result;
    }

    if (!isPositiveFinite(entry)) {
      result.reason = "Invalid entry price.";
      return result;
    }

    if (!isPositiveFinite(stop)) {
      result.reason = "Invalid stop-loss price.";
      return result;
    }

    if (side === "BUY" && stop >= entry) {
      result.reason = "Invalid BUY stop-loss. Stop-loss must be below entry price.";
      return result;
    }

    if (side === "SELL" && stop <= entry) {
      result.reason = "Invalid SELL stop-loss. Stop-loss must be above entry price.";
      return result;
    }

    if (remainingDailyRisk <= 0) {
      result.reason = "Daily loss limit has been reached; remaining daily risk budget is ₹0.";
      return result;
    }

    const unitRisk = roundCurrency(Math.abs(entry - stop));
    result.unitRisk = unitRisk;

    if (unitRisk <= 0) {
      result.reason = "Unit risk between entry and stop-loss must be greater than zero.";
      return result;
    }

    const availableBalance =
      input.availableBalance !== undefined && input.availableBalance !== null
        ? Number(input.availableBalance)
        : null;

    if (availableBalance !== null && (!Number.isFinite(availableBalance) || availableBalance <= 0)) {
      result.reason = "Insufficient available paper balance.";
      return result;
    }

    if (assetType === "OPTION") {
      if (!Number.isInteger(lotSize) || lotSize <= 0) {
        result.reason = "Option lot size must be a positive whole number.";
        return result;
      }

      const riskPerLot = unitRisk * lotSize;
      let maxLotsByRisk = Math.floor(effectiveRiskBudget / riskPerLot);

      if (availableBalance !== null) {
        const costPerLot = entry * lotSize;
        const maxLotsByCapital = costPerLot > 0 ? Math.floor(availableBalance / costPerLot) : 0;
        maxLotsByRisk = Math.min(maxLotsByRisk, maxLotsByCapital);
      }

      const maxLotsByQtyLimit = Math.floor(limits.maxQuantity / lotSize);
      const safeLots = Math.max(0, Math.min(maxLotsByRisk, maxLotsByQtyLimit));

      if (safeLots < 1) {
        result.reason =
          riskPerLot > effectiveRiskBudget
            ? `Minimum 1 option lot risk (₹${riskPerLot.toFixed(2)}) exceeds allowed risk budget (₹${effectiveRiskBudget.toFixed(2)}).`
            : "Insufficient available paper balance for 1 option lot.";
        return result;
      }

      const effQty = safeLots * lotSize;
      result.ok = true;
      result.recommendedLots = safeLots;
      result.recommendedQuantity = effQty;
      result.effectiveQuantity = effQty;
      result.riskAmount = roundCurrency(unitRisk * effQty);
      result.capitalRequired = roundCurrency(entry * effQty);
      result.reason = `Safe option size: ${safeLots} lot(s) (${effQty} qty) with ₹${result.riskAmount.toFixed(2)} risk.`;
      return result;
    }

    let maxQtyByRisk = Math.floor(effectiveRiskBudget / unitRisk);
    if (availableBalance !== null) {
      const maxQtyByCapital = Math.floor(availableBalance / entry);
      maxQtyByRisk = Math.min(maxQtyByRisk, maxQtyByCapital);
    }

    const safeQty = Math.max(0, Math.min(maxQtyByRisk, limits.maxQuantity));
    if (safeQty < 1) {
      result.reason =
        unitRisk > effectiveRiskBudget
          ? `Unit risk per share (₹${unitRisk.toFixed(2)}) exceeds allowed risk budget (₹${effectiveRiskBudget.toFixed(2)}).`
          : "Insufficient available paper balance for 1 share/unit.";
      return result;
    }

    result.ok = true;
    result.recommendedQuantity = safeQty;
    result.recommendedLots = 1;
    result.effectiveQuantity = safeQty;
    result.riskAmount = roundCurrency(unitRisk * safeQty);
    result.capitalRequired = roundCurrency(entry * safeQty);
    result.reason = `Safe position size: ${safeQty} unit(s) with ₹${result.riskAmount.toFixed(2)} risk.`;
    return result;
  }

  /*
   * Centralized Risk Evaluation Gate (Task 9 Sections 2, 3, 4, 5, 6, 7):
   * Validates per-trade risk, stop-loss direction, target direction, daily loss lock
   * (including realized + unrealized P&L), trade frequency, single open position,
   * duplicate symbol/averaging protection, available paper balance, data freshness,
   * and Emergency Stop state.
   */
  function evaluate(input = {}) {
    const limits = {
      ...configuredLimits,
      ...(input.limits || {})
    };

    const isEmergency =
      emergencyStopActive === true || input.emergencyStop === true;

    const realizedDailyPnl = number(
      input.realizedDailyPnl !== undefined ? input.realizedDailyPnl : input.dailyPnl,
      0
    );
    const unrealizedPnl = number(input.unrealizedPnl, 0);
    // Effective daily P&L includes realized P&L plus any active unrealized drawdown/P&L
    const effectiveDailyPnl =
      input.realizedDailyPnl !== undefined || input.unrealizedPnl !== undefined
        ? roundCurrency(realizedDailyPnl + unrealizedPnl)
        : roundCurrency(number(input.dailyPnl, 0));

    const tradesToday = number(input.tradesToday, 0);
    const openPositions = number(
      input.openPositions !== undefined
        ? input.openPositions
        : input.openPosition
          ? 1
          : 0,
      0
    );

    const remainingDailyLossBuffer = Math.max(
      0,
      roundCurrency(limits.maxDailyLoss + effectiveDailyPnl)
    );
    const dailyLossLocked = effectiveDailyPnl <= -limits.maxDailyLoss;
    const remainingTradesToday = Math.max(
      0,
      Math.floor(limits.maxTradesPerDay - tradesToday)
    );

    const result = {
      allowed: false,
      status: "BLOCKED",
      code: "RISK_BLOCKED",
      reasons: [],
      riskAmount: 0,
      unitRisk: 0,
      unitReward: null,
      rewardAmount: null,
      riskRewardRatio: null,
      capitalRequired: 0,
      dailyPnl: number(input.dailyPnl, realizedDailyPnl),
      realizedDailyPnl,
      unrealizedPnl,
      effectiveDailyPnl,
      remainingDailyLossBuffer,
      dailyLossLocked,
      tradesToday,
      remainingTradesToday,
      openPositions,
      quantity: number(input.quantity ?? input.qty),
      emergencyStop: isEmergency,
      limits: {
        maxLossPerTrade: limits.maxLossPerTrade,
        maxDailyLoss: limits.maxDailyLoss,
        maxTradesPerDay: limits.maxTradesPerDay,
        maxOpenPositions: limits.maxOpenPositions,
        maxQuantity: limits.maxQuantity,
        allowAveraging: false
      },
      timestamp: new Date().toISOString()
    };

    const rawEntry = input.entry;
    const rawStop = input.stop !== undefined ? input.stop : input.stopLoss;
    const rawTarget = input.target;
    const rawQty = input.quantity !== undefined ? input.quantity : input.qty;

    const entry = Number(rawEntry);
    const stop = Number(rawStop);
    const target = rawTarget !== undefined && rawTarget !== null && rawTarget !== "" ? Number(rawTarget) : null;
    const qty = Number(rawQty);
    const lotSize = Number(input.lotSize ?? 1);
    const lots = Number(input.lots ?? 1);
    const assetType = String(input.assetType || "EQUITY").trim().toUpperCase();
    const side = String(input.side || input.direction || "").trim().toUpperCase();
    const symbol = input.symbol ? String(input.symbol).trim().toUpperCase() : null;
    const existingSymbol = input.existingSymbol
      ? String(input.existingSymbol).trim().toUpperCase()
      : input.openPosition?.symbol
        ? String(input.openPosition.symbol).trim().toUpperCase()
        : null;

    if (isEmergency) {
      result.reasons.push("Emergency stop is active.");
    }

    if (input.staleData === true) {
      result.reasons.push("Stale market data cannot be used to authorize a trade.");
    }

    if (input.dataReady === false) {
      result.reasons.push("Validated market data is required before risk approval.");
    }

    if (
      input.averaging === true ||
      (symbol && existingSymbol && symbol === existingSymbol && openPositions > 0)
    ) {
      result.reasons.push("Averaging into an existing position is blocked.");
    }

    if (!Number.isFinite(entry) || entry <= 0) {
      result.reasons.push("Invalid entry price.");
    }

    if (!Number.isFinite(stop) || stop <= 0) {
      result.reasons.push("Invalid stop-loss price.");
    }

    if (assetType === "OPTION") {
      if (!Number.isFinite(lotSize) || lotSize <= 0) {
        result.reasons.push("Invalid option lot size.");
      }

      if (!Number.isFinite(lots) || lots <= 0) {
        result.reasons.push("Invalid option lot count.");
      }

      if (Number.isFinite(lotSize) && !Number.isInteger(lotSize)) {
        result.reasons.push("Option lot size must be a whole number.");
      }

      if (Number.isFinite(lots) && !Number.isInteger(lots)) {
        result.reasons.push("Option lot count must be a whole number.");
      }
    } else {
      if (!Number.isFinite(qty) || qty <= 0) {
        result.reasons.push("Invalid quantity.");
      } else if (!Number.isInteger(qty)) {
        result.reasons.push("Quantity must be a whole number.");
      }
    }

    if (side !== "BUY" && side !== "SELL") {
      result.reasons.push("Invalid trade side. Use BUY or SELL.");
    }

    if (Number.isFinite(entry) && entry > 0 && Number.isFinite(stop) && stop > 0 && (side === "BUY" || side === "SELL")) {
      if (side === "BUY" && stop >= entry) {
        result.reasons.push(
          "Invalid BUY stop-loss. Stop-loss must be below entry price."
        );
      }

      if (side === "SELL" && stop <= entry) {
        result.reasons.push(
          "Invalid SELL stop-loss. Stop-loss must be above entry price."
        );
      }
    }

    if (target !== null) {
      if (!Number.isFinite(target) || target <= 0) {
        result.reasons.push("Invalid target price.");
      } else if (Number.isFinite(entry) && entry > 0 && (side === "BUY" || side === "SELL")) {
        if (side === "BUY" && target <= entry) {
          result.reasons.push("Invalid BUY target. Target must be above entry price.");
        }
        if (side === "SELL" && target >= entry) {
          result.reasons.push("Invalid SELL target. Target must be below entry price.");
        }
      }
    }

    const effectiveQuantity =
      assetType === "OPTION"
        ? Number.isInteger(lotSize) && lotSize > 0 && Number.isInteger(lots) && lots > 0
          ? lotSize * lots
          : 0
        : Number.isInteger(qty) && qty > 0
          ? qty
          : 0;

    if (!Number.isFinite(effectiveQuantity) || effectiveQuantity <= 0) {
      if (result.reasons.length === 0) {
        result.reasons.push("Invalid effective quantity.");
      }
      return result;
    }

    result.effectiveQuantity = effectiveQuantity;
    result.assetType = assetType;
    result.lotSize = lotSize;
    result.lots = lots;

    if (Number.isFinite(entry) && entry > 0) {
      result.capitalRequired = roundCurrency(entry * effectiveQuantity);

      if (input.availableBalance !== undefined && input.availableBalance !== null) {
        const avail = Number(input.availableBalance);
        if (!Number.isFinite(avail) || result.capitalRequired > avail) {
          result.reasons.push("Order value exceeds available paper balance.");
        }
      }
    }

    if (Number.isFinite(entry) && entry > 0 && Number.isFinite(stop) && stop > 0) {
      result.unitRisk = roundCurrency(Math.abs(entry - stop));
      result.riskAmount = roundCurrency(Math.abs(entry - stop) * effectiveQuantity);

      if (result.riskAmount > limits.maxLossPerTrade) {
        result.reasons.push("Risk per trade exceeds the maximum allowed loss.");
      }

      // Also enforce that if a single trade's risk would breach the remaining daily loss lock when combined with existing daily losses, block it when enforceRemainingDailyBudget is true
      if (
        input.enforceRemainingDailyBudget === true &&
        !dailyLossLocked &&
        result.riskAmount > remainingDailyLossBuffer
      ) {
        result.reasons.push(
          `Trade risk (₹${result.riskAmount.toFixed(2)}) exceeds remaining daily loss buffer (₹${remainingDailyLossBuffer.toFixed(2)}).`
        );
      }

      if (target !== null && Number.isFinite(target) && target > 0 && result.unitRisk > 0) {
        result.unitReward = roundCurrency(Math.abs(target - entry));
        result.rewardAmount = roundCurrency(result.unitReward * effectiveQuantity);
        result.riskRewardRatio = Number((result.unitReward / result.unitRisk).toFixed(2));
      }
    }

    if (dailyLossLocked || result.dailyPnl <= -limits.maxDailyLoss) {
      result.reasons.push("Daily loss limit has been reached.");
    }

    if (!Number.isFinite(tradesToday) || tradesToday < 0) {
      result.reasons.push("Invalid daily trade count state.");
    } else if (tradesToday >= limits.maxTradesPerDay) {
      result.reasons.push("Maximum daily trade count has been reached.");
    }

    if (effectiveQuantity > limits.maxQuantity) {
      result.reasons.push("Order quantity exceeds the maximum quantity limit.");
    }

    if (!Number.isFinite(openPositions) || openPositions < 0) {
      result.reasons.push("Invalid open positions state.");
    } else if (openPositions >= limits.maxOpenPositions) {
      result.reasons.push("Maximum open-position limit has been reached.");
    }

    if (result.reasons.length === 0) {
      result.allowed = true;
      result.status = "APPROVED";
      result.code = "RISK_APPROVED";
    }

    return result;
  }

  function canTrade(input = {}) {
    return evaluate(input);
  }

  /*
   * Build Complete Risk Status & View Model (Task 9 Section 8):
   * Provides deterministic state for Dashboard, Strategy, AI Analysis,
   * Paper Trading, and Risk Management UI pages.
   */
  function buildRiskViewModel(params = {}) {
    const limits = {
      ...configuredLimits,
      ...(params.limits || {})
    };

    const paperState = params.paperState || {};
    const account = params.account || paperState;
    const openPos =
      params.openPosition !== undefined
        ? params.openPosition
        : paperState.position || null;

    const capital = number(account?.capital, 100000);
    const realizedDailyPnl = number(account?.dailyPnl, 0);
    const totalRealizedPnl = number(account?.realizedPnl, 0);
    const unrealizedPnl = openPos
      ? number(openPos.unrealizedPnl, number(account?.unrealizedPnl, 0))
      : 0;
    const effectiveDailyPnl = roundCurrency(realizedDailyPnl + unrealizedPnl);

    const committedMargin = openPos
      ? roundCurrency(
          Math.abs(number(openPos.entry, 0) * number(openPos.effectiveQty || openPos.qty, 0))
        )
      : 0;
    const availableBalance = Math.max(
      0,
      roundCurrency(capital + totalRealizedPnl - committedMargin)
    );

    const tradesToday = Math.max(0, Math.floor(number(account?.tradesToday, 0)));
    const remainingTradesToday = Math.max(0, limits.maxTradesPerDay - tradesToday);
    const openPositionsCount = openPos ? 1 : 0;

    const remainingDailyLossBuffer = Math.max(
      0,
      roundCurrency(limits.maxDailyLoss + effectiveDailyPnl)
    );
    const dailyLossUsed = Math.max(0, roundCurrency(-effectiveDailyPnl));
    const dailyLossUsedPct = Math.min(
      100,
      Math.max(0, roundCurrency((dailyLossUsed / limits.maxDailyLoss) * 100))
    );

    const dailyLossLocked =
      realizedDailyPnl <= -limits.maxDailyLoss ||
      effectiveDailyPnl <= -limits.maxDailyLoss;
    const tradeCountLocked = tradesToday >= limits.maxTradesPerDay;
    const positionLimitLocked = openPositionsCount >= limits.maxOpenPositions;

    const isEmergency =
      emergencyStopActive === true ||
      Boolean(params.emergencyStop) ||
      Boolean(params.serverEmergencyStop?.active) ||
      Boolean(paperState?.emergencyStop);

    const emergencyReason =
      params.serverEmergencyStop?.reason ||
      (isEmergency ? "Global Emergency Stop active — all new trades halted" : "Standby — Ready");
    const emergencyActivatedAt = params.serverEmergencyStop?.activatedAt || null;

    let openPositionRiskAmount = 0;
    if (openPos) {
      const eq = number(openPos.effectiveQty || openPos.qty, 0);
      openPositionRiskAmount = roundCurrency(
        Math.abs(number(openPos.entry, 0) - number(openPos.stop, 0)) * eq
      );
    }

    const activeRejectionReasons = [];
    if (isEmergency) {
      activeRejectionReasons.push("Emergency Stop is ACTIVE — all new trades are blocked until explicitly reset.");
    }
    if (dailyLossLocked) {
      activeRejectionReasons.push(
        `Daily Loss Lock is ACTIVE (Effective Daily P&L ₹${effectiveDailyPnl.toFixed(2)} reached -₹${limits.maxDailyLoss.toFixed(2)} limit).`
      );
    }
    if (tradeCountLocked) {
      activeRejectionReasons.push(
        `Daily Trade Frequency Lock is ACTIVE (${tradesToday} / ${limits.maxTradesPerDay} trades executed today).`
      );
    }
    if (positionLimitLocked) {
      activeRejectionReasons.push(
        `Single Open Position Lock is ACTIVE (${openPositionsCount} / ${limits.maxOpenPositions} position open on ${openPos?.symbol || "instrument"}).`
      );
    }

    const riskEvents = Array.isArray(params.riskEvents) ? params.riskEvents : [];
    const lastRiskEvaluation =
      params.lastRiskCheck ||
      (riskEvents.length > 0 ? riskEvents[0] : null);

    if (
      lastRiskEvaluation &&
      lastRiskEvaluation.allowed === false &&
      Array.isArray(lastRiskEvaluation.reasons)
    ) {
      for (const r of lastRiskEvaluation.reasons) {
        if (r && !activeRejectionReasons.includes(r)) {
          activeRejectionReasons.push(r);
        }
      }
    }

    const overallStatus = isEmergency
      ? "EMERGENCY_STOP"
      : dailyLossLocked
        ? "DAILY_LOSS_LOCKED"
        : tradeCountLocked
          ? "MAX_TRADES_LOCKED"
          : positionLimitLocked
            ? "POSITION_LIMIT_LOCKED"
            : "PROTECTED_READY";

    const canOpenNewTrade =
      !isEmergency &&
      !dailyLossLocked &&
      !tradeCountLocked &&
      !positionLimitLocked;

    return {
      version: RISK_ENGINE_VERSION,
      tradingMode: "paper",
      liveTradingEnabled: false,
      overallStatus,
      canOpenNewTrade,
      limits: {
        maxLossPerTrade: limits.maxLossPerTrade,
        maxLossPerTradeFormatted: `₹${limits.maxLossPerTrade.toFixed(2)}`,
        maxDailyLoss: limits.maxDailyLoss,
        maxDailyLossFormatted: `₹${limits.maxDailyLoss.toFixed(2)}`,
        maxTradesPerDay: limits.maxTradesPerDay,
        maxOpenPositions: limits.maxOpenPositions,
        maxQuantity: limits.maxQuantity,
        allowAveraging: false
      },
      capitalAndPnl: {
        capital,
        capitalFormatted: `₹${capital.toFixed(2)}`,
        availableBalance,
        availableBalanceFormatted: `₹${availableBalance.toFixed(2)}`,
        committedMargin,
        committedMarginFormatted: `₹${committedMargin.toFixed(2)}`,
        realizedDailyPnl,
        realizedDailyPnlFormatted: `${realizedDailyPnl >= 0 ? "+" : "-"}₹${Math.abs(realizedDailyPnl).toFixed(2)}`,
        unrealizedPnl,
        unrealizedPnlFormatted: `${unrealizedPnl >= 0 ? "+" : "-"}₹${Math.abs(unrealizedPnl).toFixed(2)}`,
        effectiveDailyPnl,
        effectiveDailyPnlFormatted: `${effectiveDailyPnl >= 0 ? "+" : "-"}₹${Math.abs(effectiveDailyPnl).toFixed(2)}`,
        remainingDailyLossBuffer,
        remainingDailyLossBufferFormatted: `₹${remainingDailyLossBuffer.toFixed(2)}`,
        dailyLossUsed,
        dailyLossUsedPct,
        dailyLossLocked
      },
      counters: {
        tradesToday,
        maxTradesPerDay: limits.maxTradesPerDay,
        remainingTradesToday,
        tradesTodayFormatted: `${tradesToday} / ${limits.maxTradesPerDay}`,
        tradeCountLocked,
        openPositionsCount,
        maxOpenPositions: limits.maxOpenPositions,
        openPositionsFormatted: `${openPositionsCount} / ${limits.maxOpenPositions}`,
        positionLimitLocked,
        openPositionSymbol: openPos ? openPos.symbol : null,
        openPositionDirection: openPos ? openPos.direction : null,
        openPositionRiskAmount,
        openPositionRiskFormatted: `₹${openPositionRiskAmount.toFixed(2)}`
      },
      emergencyStop: {
        active: isEmergency,
        badge: isEmergency ? "EMERGENCY STOP ACTIVE" : "NORMAL (ARMED)",
        stateText: isEmergency ? "ACTIVE (TRADING HALTED)" : "INACTIVE — ARMED",
        reason: emergencyReason,
        activatedAt: emergencyActivatedAt
      },
      activeRejectionReasons,
      lastRiskEvaluation,
      riskEvents: riskEvents.slice(0, 25),
      documentedRules: DOCUMENTED_RISK_RULES,
      timestamp: new Date().toISOString()
    };
  }

  return {
    RISK_ENGINE_VERSION,
    DEFAULTS,
    DOCUMENTED_RISK_RULES,
    configureLimits,
    resetLimits,
    getLimits,
    setEmergencyStop,
    isEmergencyStopActive,
    calculateSafePositionSize,
    evaluate,
    canTrade,
    buildRiskViewModel
  };

})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = RiskEngine;
}
