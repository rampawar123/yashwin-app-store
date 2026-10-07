const PaperTrading = (() => {
  const state = {
    position: null,
    dailyPnl: 0,
    tradesToday: 0,
    maxDailyLoss: 1000,
    maxLossPerTrade: 500,
    maxTradesPerDay: 3,
    profitStepPct: 0.10,
    lockedProfit: 0,
    nextProfitMilestone: 0
  };

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

    const qty = Number(data.qty);
    return Number.isFinite(qty) && qty > 0 ? qty : 0;
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
    return Math.max(
      1,
      positionValue(entry, qty) * state.profitStepPct
    );
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

    return {
      risk: r,
      reward: rw,
      rr: r > 0 ? rw / r : 0,
      positionValue: value,
      profitStep: step,
      effectiveQuantity: quantity,
      assetType,
      lotSize: assetType === "OPTION" ? Number(meta.lotSize) : null,
      lots: assetType === "OPTION" ? Number(meta.lots) : null
    };
  }

  function canTrade(entry, stop, target, qty, meta = {}) {
    const p = preview(entry, stop, target, qty, meta);

    if (state.position)
      return {
        ok: false,
        reason: "An open paper position already exists."
      };

    if (p.effectiveQuantity <= 0)
      return {
        ok: false,
        reason: "Invalid effective quantity."
      };

    if (state.tradesToday >= state.maxTradesPerDay)
      return {
        ok: false,
        reason: "Maximum daily trades reached."
      };

    if (p.risk > state.maxLossPerTrade)
      return {
        ok: false,
        reason: "Trade risk exceeds ₹500 limit."
      };

    if (state.dailyPnl <= -state.maxDailyLoss)
      return {
        ok: false,
        reason: "Daily loss limit reached."
      };

    return {
      ok: true,
      preview: p
    };
  }

  function openPosition(data) {
    const check = canTrade(
      data.entry,
      data.stop,
      data.target,
      data.qty,
      data
    );

    if (!check.ok) return check;

    const step = check.preview.profitStep;

    state.position = {
      ...data,
      entry: Number(data.entry),
      stop: Number(data.stop),
      target: Number(data.target),
      qty: Number(data.qty),
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
      openedAt: new Date().toISOString()
    };

    state.lockedProfit = 0;
    state.nextProfitMilestone = step;
    state.tradesToday += 1;

    return {
      ok: true,
      position: state.position,
      preview: check.preview
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

  function updatePrice(price) {
    if (!state.position) return null;

    const p = state.position;
    p.current = Number(price);

    const effectiveQty = Number(p.effectiveQty || p.qty);

    const pnl = p.direction === "BUY"
      ? (p.current - p.entry) * effectiveQty
      : (p.entry - p.current) * effectiveQty;

    const milestoneReached = updateTrailingProfit(pnl);
    const lockedStop = lockedStopPrice();

    /*
     * HARD STOP LOSS
     * This can never be loosened by profit management.
     */
    if (
      (p.direction === "BUY" && p.current <= p.stop) ||
      (p.direction === "SELL" && p.current >= p.stop)
    ) {
      return {
        action: "STOP_LOSS",
        pnl
      };
    }

    /*
     * PROTECTED PROFIT
     * If market reverses to the protected level,
     * automatically exit and preserve the locked profit.
     */
    if (
      lockedStop !== null &&
      (
        (p.direction === "BUY" && p.current <= lockedStop) ||
        (p.direction === "SELL" && p.current >= lockedStop)
      )
    ) {
      return {
        action: "PROFIT_LOCK",
        pnl,
        lockedProfit: p.lockedProfit,
        lockedStopPrice: lockedStop
      };
    }

    /*
     * TARGET
     * Target is an activation point, NOT an exit.
     */
    const targetReached =
      p.direction === "BUY"
        ? p.current >= p.target
        : p.current <= p.target;

    if (targetReached && !p.targetActivated) {
      p.targetActivated = true;

      return {
        action: "TARGET_ACTIVATED",
        pnl,
        target: p.target,
        lockedProfit: p.lockedProfit,
        nextProfitMilestone: p.nextProfitMilestone
      };
    }

    /*
     * PROFIT MILESTONE
     * Every new milestone requests a fresh AI/market analysis.
     */
    if (milestoneReached) {
      return {
        action: "AI_REANALYZE",
        pnl,
        lockedProfit: p.lockedProfit,
        nextProfitMilestone: p.nextProfitMilestone,
        targetActivated: !!p.targetActivated
      };
    }

    return {
      action: "HOLD",
      pnl,
      targetActivated: !!p.targetActivated,
      lockedProfit: p.lockedProfit,
      nextProfitMilestone: p.nextProfitMilestone
    };
  }

  function closePosition(price, reason = "MANUAL") {
    if (!state.position)
      return { ok: false, reason: "No open position." };

    const p = state.position;
    const exitPrice = Number(price);

    const effectiveQty = Number(p.effectiveQty || p.qty);

    const pnl = p.direction === "BUY"
      ? (exitPrice - p.entry) * effectiveQty
      : (p.entry - exitPrice) * effectiveQty;

    state.dailyPnl += pnl;
    state.position = null;
    state.lockedProfit = 0;
    state.nextProfitMilestone = 0;

    return {
      ok: true,
      pnl,
      reason,
      dailyPnl: state.dailyPnl
    };
  }

  function getState() {
    return JSON.parse(JSON.stringify(state));
  }

  return {
    risk,
    reward,
    positionValue,
    profitStep,
    preview,
    canTrade,
    openPosition,
    updatePrice,
    closePosition,
    getState
  };
})();
