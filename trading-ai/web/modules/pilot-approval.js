/*
 * YASHWIN AI Trading Assistant
 * Phase 18 — Human-Approved Pilot Workflow
 *
 * Workflow:
 * AI Recommendation -> Strategy -> Risk Evaluation -> Trade Preview
 * -> Explicit Human Approval -> Paper/Sandbox Execution ONLY
 *
 * NEVER sends automatic or live broker orders.
 */

const RiskEngineRef =
  typeof RiskEngine !== "undefined"
    ? RiskEngine
    : typeof require === "function"
      ? require("./risk-engine")
      : null;

const AISafetyGateRef =
  typeof AISafetyGate !== "undefined"
    ? AISafetyGate
    : typeof require === "function"
      ? require("./ai-safety-gate")
      : null;

const PaperTradingRef =
  typeof PaperTrading !== "undefined"
    ? PaperTrading
    : typeof require === "function"
      ? require("./paper")
      : null;

const AuditLoggerRef =
  typeof AuditLogger !== "undefined"
    ? AuditLogger
    : typeof require === "function"
      ? require("./audit-logger")
      : null;

const PilotApproval = (() => {

  let pendingProposal = null;

  function createProposal(input = {}) {
    const emergencyStop =
      input.emergencyStop === true ||
      (AuditLoggerRef && AuditLoggerRef.isEmergencyStopActive()) ||
      (RiskEngineRef && RiskEngineRef.isEmergencyStopActive());

    if (emergencyStop) {
      return {
        ok: false,
        code: "EMERGENCY_STOP_ACTIVE",
        reason: "Cannot create pilot proposal while Emergency Stop is active."
      };
    }

    const symbol = String(input.instrument || input.symbol || "").trim();
    const direction = String(input.direction || input.side || "BUY").trim().toUpperCase();
    const assetType = String(input.assetType || "EQUITY").trim().toUpperCase();
    const quantity = Number(input.quantity ?? input.qty ?? 1);
    const lotSize = Number(input.lotSize ?? 1);
    const lots = Number(input.lots ?? 1);
    const entry = Number(input.entry);
    const stop = Number(input.stop ?? input.stopLoss);
    const target = Number(input.target);
    const reason = String(input.reason || "Deterministic strategy setup").trim();
    const strategyVersion = String(input.strategyVersion || "1.0.0-DETERMINISTIC").trim();

    if (!symbol) {
      return { ok: false, code: "INVALID_INSTRUMENT", reason: "Instrument is required." };
    }

    const paperState = PaperTradingRef ? PaperTradingRef.getState() : { dailyPnl: 0, tradesToday: 0, position: null };

    const riskCheck = RiskEngineRef.evaluate({
      side: direction,
      entry,
      stop,
      quantity,
      assetType,
      lotSize,
      lots,
      dailyPnl: paperState.dailyPnl,
      tradesToday: paperState.tradesToday,
      openPositions: paperState.position ? 1 : 0,
      averaging: false,
      emergencyStop
    });

    if (!riskCheck.allowed) {
      if (AuditLoggerRef) {
        AuditLoggerRef.logRiskRejection("Pilot proposal rejected by RiskEngine", {
          symbol,
          reasons: riskCheck.reasons
        });
      }
      return {
        ok: false,
        code: "RISK_REJECTED",
        reason: riskCheck.reasons.join(" "),
        riskCheck
      };
    }

    const aiGate = AISafetyGateRef.evaluate({
      dataReady: input.dataReady === true,
      signal: input.signal || direction,
      confidence: input.confidence,
      risk: input.risk || "LOW",
      assetType,
      optionType: input.optionType || "",
      side: direction,
      stopLoss: stop,
      riskCheck,
      emergencyStop,
      averaging: false
    });

    if (!aiGate.allowed) {
      if (AuditLoggerRef) {
        AuditLoggerRef.logRiskRejection("Pilot proposal rejected by AISafetyGate", {
          symbol,
          reasons: aiGate.reasons
        });
      }
      return {
        ok: false,
        code: "AI_SAFETY_REJECTED",
        reason: aiGate.reasons.join(" "),
        aiGate
      };
    }

    const preview = PaperTradingRef.preview(entry, stop, target, quantity, {
      assetType,
      lotSize,
      lots
    });

    pendingProposal = {
      proposalId: `PILOT-${Date.now()}`,
      status: "AWAITING_HUMAN_APPROVAL",
      executionMode: "PAPER_SANDBOX_ONLY",
      instrument: symbol,
      direction,
      assetType,
      optionType: input.optionType || null,
      quantity: preview.effectiveQuantity,
      qty: quantity,
      lotSize: preview.lotSize,
      lots: preview.lots,
      entry,
      stop,
      target,
      maximumLoss: preview.risk,
      expectedReward: preview.reward,
      rewardRiskRatio: preview.rr,
      confidence: Number(input.confidence),
      signal: input.signal || direction,
      reason,
      strategyVersion,
      timestamp: new Date().toISOString()
    };

    if (AuditLoggerRef) {
      AuditLoggerRef.record(
        AuditLoggerRef.CATEGORIES.PILOT_APPROVAL,
        `Pilot trade proposal created for ${symbol} (${direction}) awaiting human approval`,
        {
          proposalId: pendingProposal.proposalId,
          instrument: symbol,
          direction,
          maximumLoss: pendingProposal.maximumLoss
        }
      );
    }

    return {
      ok: true,
      proposal: { ...pendingProposal }
    };
  }

  function approveProposal(proposalId) {
    if (!pendingProposal) {
      return {
        ok: false,
        code: "NO_PENDING_PROPOSAL",
        reason: "No pending trade proposal to approve."
      };
    }

    if (proposalId && pendingProposal.proposalId !== proposalId) {
      return {
        ok: false,
        code: "PROPOSAL_ID_MISMATCH",
        reason: "Proposal ID does not match current pending proposal."
      };
    }

    if (
      (AuditLoggerRef && AuditLoggerRef.isEmergencyStopActive()) ||
      (RiskEngineRef && RiskEngineRef.isEmergencyStopActive())
    ) {
      pendingProposal = null;
      return {
        ok: false,
        code: "EMERGENCY_STOP_ACTIVE",
        reason: "Emergency stop is active; approval aborted."
      };
    }

    const p = pendingProposal;
    const execution = PaperTradingRef.openPosition({
      symbol: p.instrument,
      direction: p.direction,
      entry: p.entry,
      stop: p.stop,
      target: p.target,
      qty: p.qty,
      assetType: p.assetType,
      lotSize: p.lotSize,
      lots: p.lots,
      mode: "HUMAN_APPROVED_PILOT_PAPER"
    });

    if (!execution.ok) {
      return {
        ok: false,
        code: "PAPER_EXECUTION_FAILED",
        reason: execution.reason
      };
    }

    const approvedRecord = {
      ...p,
      status: "APPROVED_AND_EXECUTED_IN_PAPER",
      approvedAt: new Date().toISOString()
    };

    pendingProposal = null;

    if (AuditLoggerRef) {
      AuditLoggerRef.record(
        AuditLoggerRef.CATEGORIES.PILOT_APPROVAL,
        `Human approved pilot trade ${approvedRecord.proposalId} in PAPER mode`,
        {
          proposalId: approvedRecord.proposalId,
          instrument: approvedRecord.instrument,
          direction: approvedRecord.direction
        }
      );
    }

    return {
      ok: true,
      executionMode: "PAPER_SANDBOX_ONLY",
      proposal: approvedRecord,
      position: execution.position
    };
  }

  function rejectProposal(reason = "Rejected by human operator") {
    if (!pendingProposal) {
      return {
        ok: false,
        code: "NO_PENDING_PROPOSAL",
        reason: "No pending proposal to reject."
      };
    }

    const rejected = {
      ...pendingProposal,
      status: "REJECTED_BY_HUMAN",
      rejectedAt: new Date().toISOString(),
      rejectionReason: String(reason)
    };

    pendingProposal = null;

    if (AuditLoggerRef) {
      AuditLoggerRef.record(
        AuditLoggerRef.CATEGORIES.PILOT_APPROVAL,
        `Human rejected pilot trade ${rejected.proposalId}: ${reason}`,
        {
          proposalId: rejected.proposalId,
          instrument: rejected.instrument
        }
      );
    }

    return {
      ok: true,
      proposal: rejected
    };
  }

  function getPendingProposal() {
    return pendingProposal ? { ...pendingProposal } : null;
  }

  return {
    createProposal,
    approveProposal,
    rejectProposal,
    getPendingProposal
  };

})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = PilotApproval;
}
