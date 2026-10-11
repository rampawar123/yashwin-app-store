/*
 * YASHWIN AI Trading Assistant
 * Task 12 — Complete Orders, Virtual Fills & Trade History Engine
 *
 * Documented Order, Virtual Fill & Trade History Rules (DOCUMENTED_ORDER_TRADE_HISTORY_RULES):
 * - Trading Mode: Strictly PAPER ('TRADING_MODE=paper', 'LIVE_TRADING_ENABLED=false', zero live Angel One broker orders)
 * - Simulated Statuses:
 *   - FILLED_PAPER: Simulated paper execution (ENTRY or EXIT) — explicitly distinguished from real broker execution (brokerExecution = 'NONE (SIMULATED_PAPER)')
 *   - REJECTED: Order rejected by RiskEngine, AISafetyGate, Emergency Stop, or data validation — NEVER creates a position, virtual fill, or executed trade
 *   - CANCELLED: Simulated cancelled paper order (if cancelled before fill) — NEVER creates a position or executed trade
 * - Relational Lifecycle & Cross-Linking:
 *   - Every paper order has a unique orderId (and optional clientOrderKey idempotency key to prevent duplicate orders)
 *   - Every virtual fill has a unique fillId, links to its orderId, and links to positionId / tradeId
 *   - Every closed trade has a unique tradeId, links to positionId, entryOrderId, exitOrderId, entryFillId, and exitFillId
 *   - Open positions are strictly excluded from closed trade history
 *   - Rejected orders are strictly excluded from executed fills and closed trades
 *   - Closing a position twice is rejected (POSITION_ALREADY_CLOSED) and never double-counts realized P&L
 * - Accounting & P&L Formulas:
 *   - Gross P&L:
 *     - BUY: (exitPrice - entryPrice) * effectiveQty
 *     - SELL: (entryPrice - exitPrice) * effectiveQty
 *   - Total Fees: entryFee + exitFee (default ₹0.00 in standard paper simulation unless configured)
 *   - Net P&L: grossPnl - fees
 *   - R-Multiple: netPnl / (|entryPrice - stopLoss| * effectiveQty) when stopLoss is valid and risk > 0, else null ('RISK_UNAVAILABLE')
 * - Deterministic Chronological Sorting & Pagination:
 *   - Orders: timestamp DESC, orderId DESC (or ASC when requested)
 *   - Fills: filledAt DESC, fillId DESC (or ASC when requested)
 *   - Closed Trades: closedAt DESC, id DESC (or ASC when requested)
 *   - Bounded pagination: page >= 1, pageSize between 1 and 100 (default 25)
 */

const OrderTradeHistoryEngine = (() => {
  const ORDER_HISTORY_ENGINE_VERSION = "1.0.0-TASK12-ORDERS-FILLS-HISTORY";

  const SUPPORTED_ORDER_STATUSES = Object.freeze([
    "FILLED_PAPER",
    "REJECTED",
    "CANCELLED"
  ]);

  const SUPPORTED_ORDER_TYPES = Object.freeze(["ENTRY", "EXIT"]);

  const SUPPORTED_DIRECTIONS = Object.freeze(["BUY", "SELL"]);

  const SUPPORTED_EXIT_REASONS = Object.freeze([
    "STOP_LOSS",
    "TARGET_EXIT",
    "PROFIT_LOCK",
    "RISK_LOCK",
    "EMERGENCY_STOP",
    "MANUAL_EXIT",
    "MANUAL"
  ]);

  const DOCUMENTED_ORDER_TRADE_HISTORY_RULES = Object.freeze({
    version: ORDER_HISTORY_ENGINE_VERSION,
    tradingMode: "paper",
    liveTradingEnabled: false,
    brokerOrders: "NONE",
    brokerExecutionRepresentation: "NEVER_REPRESENT_AS_ANGEL_ONE_FILL",
    supportedOrderStatuses: SUPPORTED_ORDER_STATUSES,
    supportedOrderTypes: SUPPORTED_ORDER_TYPES,
    supportedDirections: SUPPORTED_DIRECTIONS,
    supportedExitReasons: SUPPORTED_EXIT_REASONS,
    defaultPageSize: 25,
    maxPageSize: 100,
    sqliteTablesReused: [
      "paper_accounts",
      "paper_orders",
      "paper_fills",
      "paper_positions",
      "paper_trade_results",
      "audit_events",
      "risk_events"
    ],
    disclaimer:
      "All orders, fills, and closed trades are simulated PAPER records (FILLED_PAPER). Zero real orders are sent to Angel One or any live exchange."
  });

  function round2(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function formatINR(value) {
    if (value === null || value === undefined || value === "") return "--";
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
    if (value === null || value === undefined || value === "") return "--";
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    if (n > 0) return "+" + formatINR(n);
    return formatINR(n);
  }

  function formatDuration(openedAt, closedAt) {
    if (!openedAt || !closedAt) {
      return { durationMs: null, durationFormatted: "UNAVAILABLE" };
    }
    const startMs = Date.parse(String(openedAt));
    const endMs = Date.parse(String(closedAt));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      return { durationMs: null, durationFormatted: "UNAVAILABLE" };
    }
    const diffMs = Math.max(0, endMs - startMs);
    const totalSec = Math.floor(diffMs / 1000);
    if (totalSec < 60) {
      return { durationMs: diffMs, durationFormatted: `${totalSec}s` };
    }
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins < 60) {
      return { durationMs: diffMs, durationFormatted: `${mins}m ${secs}s` };
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return { durationMs: diffMs, durationFormatted: `${hours}h ${remMins}m` };
  }

  function normalizeExitReason(rawReason) {
    const r = String(rawReason || "MANUAL_EXIT").trim().toUpperCase();
    if (r === "STOP_LOSS" || r === "SL" || r === "HARD_STOP_LOSS") return "STOP_LOSS";
    if (r === "TARGET_EXIT" || r === "TARGET" || r === "TARGET_REACHED") return "TARGET_EXIT";
    if (r === "EMERGENCY_STOP" || r === "KILL_SWITCH") return "EMERGENCY_STOP";
    if (r === "RISK_LOCK" || r === "DAILY_LOSS_LOCK") return "RISK_LOCK";
    if (r === "PROFIT_LOCK" || r === "TRAILING_STOP") return "PROFIT_LOCK";
    if (r === "MANUAL" || r === "MANUAL_EXIT" || r === "USER_EXIT") return "MANUAL_EXIT";
    return r;
  }

  function parseOptionContractFromSymbol(symbol, rawRecord = {}) {
    const assetType = String(rawRecord.assetType || rawRecord.asset_type || "EQUITY").toUpperCase();
    const sym = String(symbol || rawRecord.symbol || "").trim().toUpperCase();

    let optionType = rawRecord.optionType || rawRecord.option_type || null;
    let strikePrice =
      rawRecord.strikePrice !== undefined && rawRecord.strikePrice !== null
        ? Number(rawRecord.strikePrice)
        : rawRecord.strike_price !== undefined && rawRecord.strike_price !== null
          ? Number(rawRecord.strike_price)
          : null;
    let expiry = rawRecord.expiry || null;

    if (!optionType && (assetType === "OPTION" || /(CE|PE)$/.test(sym))) {
      const m = sym.match(/^([A-Z]+)(\d{2}[A-Z]{3}\d{2})(\d+(?:\.\d+)?)(CE|PE)$/);
      if (m) {
        expiry = expiry || m[2];
        if (!Number.isFinite(strikePrice)) strikePrice = Number(m[3]);
        optionType = m[4];
      } else if (sym.endsWith("CE")) {
        optionType = "CE";
      } else if (sym.endsWith("PE")) {
        optionType = "PE";
      }
    }

    const isOption = assetType === "OPTION" || Boolean(optionType);
    const lotSize =
      rawRecord.lotSize !== undefined && rawRecord.lotSize !== null && Number(rawRecord.lotSize) > 0
        ? Number(rawRecord.lotSize)
        : rawRecord.lot_size !== undefined && rawRecord.lot_size !== null && Number(rawRecord.lot_size) > 0
          ? Number(rawRecord.lot_size)
          : isOption
            ? 1
            : null;
    const lots =
      rawRecord.lots !== undefined && rawRecord.lots !== null && Number(rawRecord.lots) > 0
        ? Number(rawRecord.lots)
        : isOption && lotSize && Number(rawRecord.quantity) > 0
          ? Math.max(1, Math.round(Number(rawRecord.quantity) / lotSize))
          : null;

    return {
      assetType: isOption ? "OPTION" : "EQUITY",
      isOption,
      optionType: optionType ? String(optionType).toUpperCase() : null,
      strikePrice: Number.isFinite(strikePrice) && strikePrice > 0 ? strikePrice : null,
      expiry: expiry ? String(expiry) : null,
      lotSize,
      lots,
      contractLabel: isOption
        ? `${sym}${optionType ? ` (${optionType})` : ""}${strikePrice ? ` • Strike ₹${strikePrice}` : ""}${expiry ? ` • Exp ${expiry}` : ""}${lotSize && lots ? ` • ${lots} lot(s) x ${lotSize}` : ""}`
        : "EQUITY / SPOT"
    };
  }

  /* =====================================================
     QUERY PARAMETER & PAGINATION VALIDATION
  ===================================================== */

  function validateAndNormalizeQuery(rawQuery = {}) {
    const errors = [];
    const pageRaw = rawQuery.page !== undefined && rawQuery.page !== "" ? Number(rawQuery.page) : 1;
    const pageSizeRaw =
      rawQuery.pageSize !== undefined && rawQuery.pageSize !== ""
        ? Number(rawQuery.pageSize)
        : rawQuery.limit !== undefined && rawQuery.limit !== ""
          ? Number(rawQuery.limit)
          : DOCUMENTED_ORDER_TRADE_HISTORY_RULES.defaultPageSize;

    if (!Number.isInteger(pageRaw) || pageRaw < 1) {
      errors.push("Invalid page number: page must be a positive integer >= 1.");
    }

    if (
      !Number.isInteger(pageSizeRaw) ||
      pageSizeRaw < 1 ||
      pageSizeRaw > DOCUMENTED_ORDER_TRADE_HISTORY_RULES.maxPageSize
    ) {
      errors.push(
        `Invalid pageSize: must be an integer between 1 and ${DOCUMENTED_ORDER_TRADE_HISTORY_RULES.maxPageSize}.`
      );
    }

    const sortDirRaw = String(rawQuery.sortDir || rawQuery.sort || "DESC").trim().toUpperCase();
    if (sortDirRaw !== "DESC" && sortDirRaw !== "ASC") {
      errors.push("Invalid sortDir: must be ASC or DESC.");
    }

    const directionRaw = rawQuery.direction
      ? String(rawQuery.direction).trim().toUpperCase()
      : "";
    if (directionRaw && directionRaw !== "ALL" && !SUPPORTED_DIRECTIONS.includes(directionRaw)) {
      errors.push("Invalid direction filter: must be BUY, SELL, or ALL.");
    }

    const orderStatusRaw = rawQuery.orderStatus || rawQuery.status
      ? String(rawQuery.orderStatus || rawQuery.status).trim().toUpperCase()
      : "";
    if (
      orderStatusRaw &&
      orderStatusRaw !== "ALL" &&
      !["FILLED_PAPER", "REJECTED", "CANCELLED", "WIN", "LOSS", "BREAKEVEN", "OPEN", "CLOSED"].includes(
        orderStatusRaw
      )
    ) {
      errors.push(
        "Invalid status filter: must be FILLED_PAPER, REJECTED, CANCELLED, WIN, LOSS, BREAKEVEN, or ALL."
      );
    }

    const orderTypeRaw = rawQuery.orderType || rawQuery.type
      ? String(rawQuery.orderType || rawQuery.type).trim().toUpperCase()
      : "";
    if (orderTypeRaw && orderTypeRaw !== "ALL" && !SUPPORTED_ORDER_TYPES.includes(orderTypeRaw)) {
      errors.push("Invalid orderType filter: must be ENTRY, EXIT, or ALL.");
    }

    const exitReasonRaw = rawQuery.exitReason || rawQuery.reason
      ? String(rawQuery.exitReason || rawQuery.reason).trim().toUpperCase()
      : "";
    if (
      exitReasonRaw &&
      exitReasonRaw !== "ALL" &&
      !SUPPORTED_EXIT_REASONS.includes(exitReasonRaw)
    ) {
      errors.push(
        "Invalid exitReason filter: must be STOP_LOSS, TARGET_EXIT, PROFIT_LOCK, RISK_LOCK, EMERGENCY_STOP, MANUAL_EXIT, or ALL."
      );
    }

    const pnlResultRaw = rawQuery.pnlResult || rawQuery.outcome
      ? String(rawQuery.pnlResult || rawQuery.outcome).trim().toUpperCase()
      : "";
    if (
      pnlResultRaw &&
      pnlResultRaw !== "ALL" &&
      !["WIN", "PROFIT", "LOSS", "BREAKEVEN", "FLAT"].includes(pnlResultRaw)
    ) {
      errors.push("Invalid profit/loss filter: must be WIN, LOSS, BREAKEVEN, or ALL.");
    }

    const fromDateRaw = rawQuery.fromDate || rawQuery.from ? String(rawQuery.fromDate || rawQuery.from).trim() : "";
    const toDateRaw = rawQuery.toDate || rawQuery.to ? String(rawQuery.toDate || rawQuery.to).trim() : "";

    const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (fromDateRaw && !isoDateRegex.test(fromDateRaw) && !Number.isFinite(Date.parse(fromDateRaw))) {
      errors.push("Invalid fromDate format: expected YYYY-MM-DD.");
    }
    if (toDateRaw && !isoDateRegex.test(toDateRaw) && !Number.isFinite(Date.parse(toDateRaw))) {
      errors.push("Invalid toDate format: expected YYYY-MM-DD.");
    }
    if (
      fromDateRaw &&
      toDateRaw &&
      isoDateRegex.test(fromDateRaw) &&
      isoDateRegex.test(toDateRaw) &&
      fromDateRaw > toDateRaw
    ) {
      errors.push("Invalid date range: fromDate cannot be after toDate.");
    }

    if (errors.length > 0) {
      return {
        ok: false,
        code: "INVALID_QUERY_PARAMETERS",
        errors,
        message: errors.join(" ")
      };
    }

    return {
      ok: true,
      filters: {
        symbol: rawQuery.symbol || rawQuery.instrument || rawQuery.q
          ? String(rawQuery.symbol || rawQuery.instrument || rawQuery.q).trim()
          : "",
        exchange: rawQuery.exchange && String(rawQuery.exchange).toUpperCase() !== "ALL"
          ? String(rawQuery.exchange).trim().toUpperCase()
          : "",
        direction: directionRaw && directionRaw !== "ALL" ? directionRaw : "",
        orderStatus:
          orderStatusRaw &&
          orderStatusRaw !== "ALL" &&
          SUPPORTED_ORDER_STATUSES.includes(orderStatusRaw)
            ? orderStatusRaw
            : "",
        orderType: orderTypeRaw && orderTypeRaw !== "ALL" ? orderTypeRaw : "",
        exitReason: exitReasonRaw && exitReasonRaw !== "ALL" ? exitReasonRaw : "",
        pnlResult:
          pnlResultRaw && pnlResultRaw !== "ALL"
            ? pnlResultRaw === "PROFIT"
              ? "WIN"
              : pnlResultRaw === "FLAT"
                ? "BREAKEVEN"
                : pnlResultRaw
            : ["WIN", "LOSS", "BREAKEVEN"].includes(orderStatusRaw)
              ? orderStatusRaw
              : "",
        fromDate: fromDateRaw ? fromDateRaw.slice(0, 10) : "",
        toDate: toDateRaw ? toDateRaw.slice(0, 10) : "",
        orderId: rawQuery.orderId ? String(rawQuery.orderId).trim() : "",
        fillId: rawQuery.fillId ? String(rawQuery.fillId).trim() : "",
        positionId: rawQuery.positionId ? String(rawQuery.positionId).trim() : "",
        tradeId: rawQuery.tradeId ? String(rawQuery.tradeId).trim() : "",
        page: pageRaw,
        pageSize: pageSizeRaw,
        sortDir: sortDirRaw
      }
    };
  }

  /* =====================================================
     CROSS-LINKING & ENRICHMENT OF ORDERS, FILLS & TRADES
  ===================================================== */

  function enrichAndLinkRecords(input = {}) {
    const rawOrders = Array.isArray(input.orders) ? input.orders : [];
    const rawFills = Array.isArray(input.fills) ? input.fills : [];
    const rawTrades = Array.isArray(input.trades)
      ? input.trades
      : Array.isArray(input.history)
        ? input.history
        : [];
    const openPos = input.openPosition || null;

    // Index fills by orderId and fillId
    const fillByOrderId = new Map();
    const fillById = new Map();
    for (const f of rawFills) {
      if (!f) continue;
      if (f.orderId) fillByOrderId.set(String(f.orderId), f);
      if (f.fillId) fillById.set(String(f.fillId), f);
    }

    // Index orders by orderId
    const orderById = new Map();
    for (const o of rawOrders) {
      if (!o || !o.orderId) continue;
      orderById.set(String(o.orderId), o);
    }

    // Index closed trades by positionId, entryOrderId, exitOrderId, tradeId
    const tradeByPositionId = new Map();
    const tradeByOrderId = new Map();
    const tradeById = new Map();

    // First enrich closed trades (strictly excluding any OPEN positions)
    const enrichedTrades = rawTrades
      .filter((t) => t && String(t.status || "CLOSED").toUpperCase() !== "OPEN")
      .map((t) => {
        const tradeId = String(t.id || t.tradeId || "");
        const positionId = t.positionId ? String(t.positionId) : null;
        const symbol = String(t.symbol || "NIFTY 50").trim();
        const exchange = String(t.exchange || "NSE").trim().toUpperCase();
        const direction = String(t.direction || "BUY").trim().toUpperCase();
        const quantity = Number(t.quantity || t.effectiveQty || 0);
        const entryPrice = Number(t.entry ?? t.entryPrice ?? 0);
        const exitPrice = Number(t.exit ?? t.exitPrice ?? 0);
        const stopLoss =
          t.stop !== undefined && t.stop !== null && Number(t.stop) > 0
            ? Number(t.stop)
            : t.stopLoss !== undefined && t.stopLoss !== null && Number(t.stopLoss) > 0
              ? Number(t.stopLoss)
              : null;
        const target =
          t.target !== undefined && t.target !== null && Number(t.target) > 0
            ? Number(t.target)
            : null;

        // Find matching entry/exit orders & fills if not explicitly stored on the trade row
        let entryOrderId = t.entryOrderId || null;
        let exitOrderId = t.exitOrderId || null;
        let entryFillId = t.entryFillId || null;
        let exitFillId = t.exitFillId || null;

        for (const o of rawOrders) {
          if (!o) continue;
          const oPosId = o.positionId ? String(o.positionId) : null;
          const oTradeId = o.tradeId ? String(o.tradeId) : null;
          const matchesPos = positionId && oPosId === positionId;
          const matchesTrade = tradeId && oTradeId === tradeId;
          const matchesTimeAndSym =
            o.symbol === symbol &&
            ((o.type === "ENTRY" && t.openedAt && o.timestamp === t.openedAt) ||
              (o.type === "EXIT" && t.closedAt && o.timestamp === t.closedAt));

          if (matchesPos || matchesTrade || matchesTimeAndSym) {
            if (String(o.type).toUpperCase() === "ENTRY" && !entryOrderId) {
              entryOrderId = o.orderId;
            } else if (String(o.type).toUpperCase() === "EXIT" && !exitOrderId) {
              exitOrderId = o.orderId;
            }
          }
        }

        const entryFill = entryOrderId ? fillByOrderId.get(String(entryOrderId)) : null;
        const exitFill = exitOrderId ? fillByOrderId.get(String(exitOrderId)) : null;
        if (entryFill && !entryFillId) entryFillId = entryFill.fillId;
        if (exitFill && !exitFillId) exitFillId = exitFill.fillId;

        const grossPnl = round2(
          t.grossPnl !== undefined && t.grossPnl !== null && Number.isFinite(Number(t.grossPnl))
            ? Number(t.grossPnl)
            : direction === "BUY"
              ? (exitPrice - entryPrice) * quantity
              : (entryPrice - exitPrice) * quantity
        );

        const fees = round2(
          t.fees !== undefined && t.fees !== null && Number.isFinite(Number(t.fees))
            ? Number(t.fees)
            : Number(entryFill?.fees || 0) + Number(exitFill?.fees || 0)
        );

        const netPnl = round2(
          t.pnl !== undefined && t.pnl !== null && Number.isFinite(Number(t.pnl))
            ? Number(t.pnl)
            : grossPnl - fees
        );

        const unitRisk =
          stopLoss !== null && Number.isFinite(stopLoss) && stopLoss > 0
            ? Math.abs(entryPrice - stopLoss)
            : 0;
        const initialRiskAmount = round2(unitRisk * quantity);
        const rMultiple =
          initialRiskAmount > 0 ? round2(netPnl / initialRiskAmount) : null;
        const rMultipleStatus =
          initialRiskAmount > 0 ? "VALID" : "RISK_UNAVAILABLE";

        const durationInfo = formatDuration(t.openedAt, t.closedAt);
        const normalizedExitReason = normalizeExitReason(t.reason || t.exitReason);
        const contractInfo = parseOptionContractFromSymbol(symbol, t);

        const pnlOutcome =
          netPnl > 0 ? "WIN" : netPnl < 0 ? "LOSS" : "BREAKEVEN";

        const enrichedTrade = {
          id: tradeId,
          tradeId,
          userId: t.userId || null,
          positionId,
          entryOrderId,
          exitOrderId,
          entryFillId,
          exitFillId,
          symbol,
          exchange,
          direction,
          assetType: contractInfo.assetType,
          isOption: contractInfo.isOption,
          optionType: contractInfo.optionType,
          strikePrice: contractInfo.strikePrice,
          expiry: contractInfo.expiry,
          lotSize: contractInfo.lotSize,
          lots: contractInfo.lots,
          contractLabel: contractInfo.contractLabel,
          quantity,
          entry: entryPrice,
          entryPrice,
          entryFormatted: formatINR(entryPrice),
          exit: exitPrice,
          exitPrice,
          exitFormatted: formatINR(exitPrice),
          stop: stopLoss,
          stopLoss,
          stopFormatted: stopLoss !== null ? formatINR(stopLoss) : "UNAVAILABLE",
          target,
          targetFormatted: target !== null ? formatINR(target) : "UNAVAILABLE",
          grossPnl,
          grossPnlFormatted: formatSignedINR(grossPnl),
          fees,
          feesFormatted: formatINR(fees),
          pnl: netPnl,
          netPnl,
          netPnlFormatted: formatSignedINR(netPnl),
          pnlFormatted: formatSignedINR(netPnl),
          pnlOutcome,
          pnlTone: netPnl > 0 ? "positive" : netPnl < 0 ? "negative" : "neutral",
          initialRiskAmount: initialRiskAmount > 0 ? initialRiskAmount : null,
          initialRiskFormatted: initialRiskAmount > 0 ? formatINR(initialRiskAmount) : "UNAVAILABLE",
          rMultiple,
          rMultipleStatus,
          rMultipleFormatted:
            rMultiple !== null
              ? `${rMultiple >= 0 ? "+" : ""}${rMultiple.toFixed(2)}R`
              : "UNAVAILABLE",
          holdingDurationMs: durationInfo.durationMs,
          holdingDurationFormatted: durationInfo.durationFormatted,
          reason: t.reason || normalizedExitReason,
          exitReason: normalizedExitReason,
          mode: t.mode || "MANUAL_PAPER",
          executionMode: "SIMULATED_PAPER",
          brokerExecution: "NONE",
          openedAt: t.openedAt || null,
          closedAt: t.closedAt || null,
          status: "CLOSED"
        };

        if (positionId) tradeByPositionId.set(positionId, enrichedTrade);
        if (entryOrderId) tradeByOrderId.set(String(entryOrderId), enrichedTrade);
        if (exitOrderId) tradeByOrderId.set(String(exitOrderId), enrichedTrade);
        if (tradeId) tradeById.set(tradeId, enrichedTrade);

        return enrichedTrade;
      });

    // Enrich Paper Orders
    const enrichedOrders = rawOrders.map((o) => {
      const orderId = String(o.orderId || o.id || "");
      const symbol = String(o.symbol || "NIFTY 50").trim();
      const exchange = String(o.exchange || "NSE").trim().toUpperCase();
      const direction = String(o.direction || "BUY").trim().toUpperCase();
      const type = String(o.type || o.orderType || "ENTRY").trim().toUpperCase();
      const status = String(o.status || "FILLED_PAPER").trim().toUpperCase();
      const quantity = Number(o.quantity || 0);
      const price = Number(o.price || 0);
      const stop =
        o.stop !== undefined && o.stop !== null && Number(o.stop) > 0
          ? Number(o.stop)
          : null;
      const target =
        o.target !== undefined && o.target !== null && Number(o.target) > 0
          ? Number(o.target)
          : null;

      const linkedFill = fillByOrderId.get(orderId) || null;
      const linkedTrade =
        tradeByOrderId.get(orderId) ||
        (o.tradeId ? tradeById.get(String(o.tradeId)) : null) ||
        (o.positionId ? tradeByPositionId.get(String(o.positionId)) : null) ||
        null;

      const relatedPositionId =
        o.positionId ||
        linkedTrade?.positionId ||
        (openPos && openPos.orderId === orderId ? openPos.id : null) ||
        null;
      const relatedTradeId = o.tradeId || linkedTrade?.tradeId || null;
      const relatedFillId = linkedFill?.fillId || null;

      const isFilled = status === "FILLED_PAPER";
      const isRejected = status === "REJECTED" || status === "CANCELLED";
      const fillPrice = isFilled
        ? linkedFill && Number.isFinite(Number(linkedFill.fillPrice))
          ? Number(linkedFill.fillPrice)
          : price
        : null;

      const contractInfo = parseOptionContractFromSymbol(symbol, o);

      return {
        orderId,
        userId: o.userId || null,
        clientOrderKey: o.clientOrderKey || null,
        timestamp: o.timestamp || o.createdAt || null,
        symbol,
        exchange,
        direction,
        type,
        orderType: "MARKET_PAPER",
        lifecycleStage: type, // ENTRY or EXIT
        assetType: contractInfo.assetType,
        isOption: contractInfo.isOption,
        optionType: contractInfo.optionType,
        strikePrice: contractInfo.strikePrice,
        expiry: contractInfo.expiry,
        lotSize: contractInfo.lotSize,
        lots: contractInfo.lots,
        contractLabel: contractInfo.contractLabel,
        quantity,
        requestedPrice: price > 0 ? price : null,
        requestedPriceFormatted: price > 0 ? formatINR(price) : "UNAVAILABLE",
        fillPrice,
        fillPriceFormatted: fillPrice !== null && fillPrice > 0 ? formatINR(fillPrice) : isRejected ? "NOT_FILLED" : "UNAVAILABLE",
        stop,
        stopFormatted: stop !== null ? formatINR(stop) : "--",
        target,
        targetFormatted: target !== null ? formatINR(target) : "--",
        status,
        isSimulatedPaperFill: isFilled,
        brokerExecution: "NONE (SIMULATED_PAPER)",
        mode: o.mode || "MANUAL_PAPER",
        reason: o.reason || (isRejected ? "Order rejected by safety/risk checks" : "Paper execution"),
        rejectionReason: isRejected ? (o.rejectionReason || o.reason || "Rejected") : null,
        positionId: relatedPositionId,
        tradeId: relatedTradeId,
        fillId: relatedFillId
      };
    });

    // Enrich Virtual Fills (strictly executed fills only)
    const enrichedFills = rawFills.map((f) => {
      const fillId = String(f.fillId || "");
      const orderId = String(f.orderId || "");
      const parentOrder = orderById.get(orderId) || null;
      const linkedTrade =
        tradeByOrderId.get(orderId) ||
        (f.tradeId ? tradeById.get(String(f.tradeId)) : null) ||
        (f.positionId ? tradeByPositionId.get(String(f.positionId)) : null) ||
        (parentOrder?.positionId ? tradeByPositionId.get(String(parentOrder.positionId)) : null) ||
        null;

      const symbol = String(f.symbol || parentOrder?.symbol || "NIFTY 50").trim();
      const exchange = String(f.exchange || parentOrder?.exchange || "NSE").trim().toUpperCase();
      const direction = String(f.direction || parentOrder?.direction || "BUY").trim().toUpperCase();
      const entryOrExit = String(
        f.orderType || parentOrder?.type || "ENTRY"
      ).trim().toUpperCase();
      const quantity = Number(f.quantity || 0);
      const fillPrice = Number(f.fillPrice || 0);
      const slippage = Number.isFinite(Number(f.slippage)) ? round2(Number(f.slippage)) : 0;
      const fees = Number.isFinite(Number(f.fees)) ? round2(Number(f.fees)) : 0;
      const fillNotional = round2(Math.abs(fillPrice * quantity));

      const relatedPositionId =
        f.positionId ||
        parentOrder?.positionId ||
        linkedTrade?.positionId ||
        (openPos && openPos.orderId === orderId ? openPos.id : null) ||
        null;
      const relatedTradeId = f.tradeId || parentOrder?.tradeId || linkedTrade?.tradeId || null;

      const contractInfo = parseOptionContractFromSymbol(symbol, parentOrder || f);

      return {
        fillId,
        orderId,
        userId: f.userId || parentOrder?.userId || null,
        entryOrExit,
        filledAt: f.filledAt || parentOrder?.timestamp || null,
        timestamp: f.filledAt || parentOrder?.timestamp || null,
        symbol,
        exchange,
        direction,
        assetType: contractInfo.assetType,
        isOption: contractInfo.isOption,
        optionType: contractInfo.optionType,
        strikePrice: contractInfo.strikePrice,
        expiry: contractInfo.expiry,
        lotSize: contractInfo.lotSize,
        lots: contractInfo.lots,
        contractLabel: contractInfo.contractLabel,
        quantity,
        fillPrice,
        fillPriceFormatted: formatINR(fillPrice),
        fillNotional,
        fillNotionalFormatted: formatINR(fillNotional),
        slippage,
        slippageFormatted: formatINR(slippage),
        fees,
        feesFormatted: formatINR(fees),
        positionId: relatedPositionId,
        tradeId: relatedTradeId,
        mode: parentOrder?.mode || "MANUAL_PAPER",
        dataSource: f.dataSource || "VALIDATED_PAPER_QUOTE",
        executionAssumptions:
          "Simulated paper fill at validated reference price (0 bps synthetic slippage, ₹0 broker commission)",
        brokerExecution: "NONE (SIMULATED_PAPER)"
      };
    });

    return {
      orders: enrichedOrders,
      fills: enrichedFills,
      trades: enrichedTrades
    };
  }

  /* =====================================================
     DETERMINISTIC SORTING, FILTERING & PAGINATION
  ===================================================== */

  function sortRecordsDeterministically(records = [], timestampField = "timestamp", idField = "id", sortDir = "DESC") {
    const dir = String(sortDir || "DESC").toUpperCase() === "ASC" ? 1 : -1;
    return [...records].sort((a, b) => {
      const tsA = String(a?.[timestampField] || "");
      const tsB = String(b?.[timestampField] || "");
      if (tsA !== tsB) {
        return tsA.localeCompare(tsB) * dir;
      }
      const idA = String(a?.[idField] || "");
      const idB = String(b?.[idField] || "");
      return idA.localeCompare(idB) * dir;
    });
  }

  function matchesCommonFilters(record, filters = {}, dateField = "timestamp") {
    if (!record) return false;

    if (filters.symbol) {
      const q = String(filters.symbol).trim().toUpperCase();
      const sym = String(record.symbol || "").toUpperCase();
      const contract = String(record.contractLabel || "").toUpperCase();
      if (!sym.includes(q) && !contract.includes(q)) return false;
    }

    if (filters.exchange) {
      if (String(record.exchange || "").toUpperCase() !== String(filters.exchange).toUpperCase()) {
        return false;
      }
    }

    if (filters.direction) {
      if (String(record.direction || "").toUpperCase() !== String(filters.direction).toUpperCase()) {
        return false;
      }
    }

    if (filters.orderId && String(record.orderId || record.entryOrderId || record.exitOrderId || "") !== filters.orderId) {
      if (
        String(record.orderId || "") !== filters.orderId &&
        String(record.entryOrderId || "") !== filters.orderId &&
        String(record.exitOrderId || "") !== filters.orderId
      ) {
        return false;
      }
    }

    if (filters.fillId) {
      if (
        String(record.fillId || "") !== filters.fillId &&
        String(record.entryFillId || "") !== filters.fillId &&
        String(record.exitFillId || "") !== filters.fillId
      ) {
        return false;
      }
    }

    if (filters.positionId && String(record.positionId || "") !== filters.positionId) {
      return false;
    }

    if (filters.tradeId && String(record.tradeId || record.id || "") !== filters.tradeId) {
      return false;
    }

    if (filters.fromDate || filters.toDate) {
      const rawTs = String(record[dateField] || record.timestamp || "");
      const dateStr = rawTs.slice(0, 10);
      if (!dateStr) return false;
      if (filters.fromDate && dateStr < filters.fromDate) return false;
      if (filters.toDate && dateStr > filters.toDate) return false;
    }

    return true;
  }

  function filterOrders(orders = [], filters = {}) {
    return orders.filter((o) => {
      if (!matchesCommonFilters(o, filters, "timestamp")) return false;
      if (filters.orderStatus && String(o.status || "").toUpperCase() !== filters.orderStatus) {
        return false;
      }
      if (filters.orderType && String(o.type || "").toUpperCase() !== filters.orderType) {
        return false;
      }
      if (filters.exitReason) {
        const norm = normalizeExitReason(o.reason);
        const targetReason = normalizeExitReason(filters.exitReason);
        if (norm !== targetReason && String(o.reason || "").toUpperCase() !== filters.exitReason) {
          return false;
        }
      }
      return true;
    });
  }

  function filterFills(fills = [], filters = {}) {
    return fills.filter((f) => {
      if (!matchesCommonFilters(f, filters, "filledAt")) return false;
      if (filters.orderType && String(f.entryOrExit || "").toUpperCase() !== filters.orderType) {
        return false;
      }
      return true;
    });
  }

  function filterClosedTrades(trades = [], filters = {}) {
    return trades.filter((t) => {
      if (String(t.status || "CLOSED").toUpperCase() === "OPEN") return false;
      if (!matchesCommonFilters(t, filters, "closedAt")) return false;

      if (filters.exitReason) {
        const norm = normalizeExitReason(t.exitReason || t.reason);
        const targetReason = normalizeExitReason(filters.exitReason);
        if (norm !== targetReason) return false;
      }

      if (filters.pnlResult) {
        if (filters.pnlResult === "WIN" && Number(t.pnl) <= 0) return false;
        if (filters.pnlResult === "LOSS" && Number(t.pnl) >= 0) return false;
        if (filters.pnlResult === "BREAKEVEN" && Number(t.pnl) !== 0) return false;
      }

      return true;
    });
  }

  function paginateRecords(records = [], page = 1, pageSize = 25) {
    const totalItems = Array.isArray(records) ? records.length : 0;
    const safePageSize = Math.max(
      1,
      Math.min(DOCUMENTED_ORDER_TRADE_HISTORY_RULES.maxPageSize, Number(pageSize) || 25)
    );
    const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
    const safePage = Math.max(1, Number(page) || 1);
    const startIndex = (safePage - 1) * safePageSize;
    const items = startIndex < totalItems ? records.slice(startIndex, startIndex + safePageSize) : [];

    return {
      items,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        totalItems,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPrevPage: safePage > 1
      }
    };
  }

  /* =====================================================
     COMPLETE SNAPSHOT & VIEW MODEL BUILDER
  ===================================================== */

  function buildOrderTradeHistorySnapshot(input = {}) {
    const validation = validateAndNormalizeQuery(input.query || input.filters || {});
    if (!validation.ok) {
      return validation;
    }

    const filters = validation.filters;
    const enriched = enrichAndLinkRecords(input);

    const sortedOrders = sortRecordsDeterministically(
      enriched.orders,
      "timestamp",
      "orderId",
      filters.sortDir
    );
    const sortedFills = sortRecordsDeterministically(
      enriched.fills,
      "filledAt",
      "fillId",
      filters.sortDir
    );
    const sortedTrades = sortRecordsDeterministically(
      enriched.trades,
      "closedAt",
      "tradeId",
      filters.sortDir
    );

    const filteredOrders = filterOrders(sortedOrders, filters);
    const filteredFills = filterFills(sortedFills, filters);
    const filteredTrades = filterClosedTrades(sortedTrades, filters);

    const ordersPage = paginateRecords(filteredOrders, filters.page, filters.pageSize);
    const fillsPage = paginateRecords(filteredFills, filters.page, filters.pageSize);
    const tradesPage = paginateRecords(filteredTrades, filters.page, filters.pageSize);

    // Compute summary counters & accounting consistency checks
    const filledOrdersCount = sortedOrders.filter((o) => o.status === "FILLED_PAPER").length;
    const rejectedOrdersCount = sortedOrders.filter((o) => o.status === "REJECTED").length;
    const cancelledOrdersCount = sortedOrders.filter((o) => o.status === "CANCELLED").length;

    const totalGrossPnl = round2(
      filteredTrades.reduce((s, t) => s + Number(t.grossPnl || 0), 0)
    );
    const totalFees = round2(
      filteredTrades.reduce((s, t) => s + Number(t.fees || 0), 0)
    );
    const totalNetPnl = round2(
      filteredTrades.reduce((s, t) => s + Number(t.netPnl || 0), 0)
    );
    const winningTradesCount = filteredTrades.filter((t) => Number(t.netPnl) > 0).length;
    const losingTradesCount = filteredTrades.filter((t) => Number(t.netPnl) < 0).length;
    const breakevenTradesCount = filteredTrades.filter((t) => Number(t.netPnl) === 0).length;

    return {
      ok: true,
      version: ORDER_HISTORY_ENGINE_VERSION,
      mode: "PAPER",
      liveTradingEnabled: false,
      brokerExecution: "NONE",
      userId: input.userId || null,
      filtersApplied: filters,
      summary: {
        totalOrders: sortedOrders.length,
        filledOrdersCount,
        rejectedOrdersCount,
        cancelledOrdersCount,
        totalFills: sortedFills.length,
        totalClosedTrades: sortedTrades.length,
        filteredOrdersCount: filteredOrders.length,
        filteredFillsCount: filteredFills.length,
        filteredTradesCount: filteredTrades.length,
        winningTradesCount,
        losingTradesCount,
        breakevenTradesCount,
        totalGrossPnl,
        totalGrossPnlFormatted: formatSignedINR(totalGrossPnl),
        totalFees,
        totalFeesFormatted: formatINR(totalFees),
        totalNetPnl,
        totalNetPnlFormatted: formatSignedINR(totalNetPnl),
        accountingConsistent: Math.abs(totalGrossPnl - totalFees - totalNetPnl) < 0.01
      },
      orders: ordersPage.items,
      ordersPagination: ordersPage.pagination,
      fills: fillsPage.items,
      fillsPagination: fillsPage.pagination,
      trades: tradesPage.items,
      tradesPagination: tradesPage.pagination,
      documentedRules: DOCUMENTED_ORDER_TRADE_HISTORY_RULES
    };
  }

  return {
    ORDER_HISTORY_ENGINE_VERSION,
    SUPPORTED_ORDER_STATUSES,
    SUPPORTED_ORDER_TYPES,
    SUPPORTED_DIRECTIONS,
    SUPPORTED_EXIT_REASONS,
    DOCUMENTED_ORDER_TRADE_HISTORY_RULES,
    formatINR,
    formatSignedINR,
    formatDuration,
    normalizeExitReason,
    parseOptionContractFromSymbol,
    validateAndNormalizeQuery,
    enrichAndLinkRecords,
    sortRecordsDeterministically,
    filterOrders,
    filterFills,
    filterClosedTrades,
    paginateRecords,
    buildOrderTradeHistorySnapshot
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = OrderTradeHistoryEngine;
}
