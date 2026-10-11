/*
 * YASHWIN AI Trading Assistant
 * Phase 17 — Alerts, Audit Logs & Global Emergency Stop Controller
 *
 * Implements:
 * - Structured audit log (TRADE_DECISION, RISK_REJECTION, AUTH_EVENT, EMERGENCY_STOP, ERROR)
 * - Synchronizes with single persistent server-side SQLite database (server/database.js) when running in Node.js
 * - Global Emergency Stop state machine that:
 *   1. Sets global state
 *   2. Syncs RiskEngine emergency stop
 *   3. Blocks AI trade authorization
 *   4. Closes open PaperTrading positions immediately
 *   5. Persists & logs the event
 *   6. Requires explicit resetEmergencyStop()
 */

const RiskEngineRefAudit =
  typeof RiskEngine !== "undefined"
    ? RiskEngine
    : typeof require === "function"
      ? require("./risk-engine")
      : null;

const PaperTradingRefAudit =
  typeof PaperTrading !== "undefined"
    ? PaperTrading
    : typeof require === "function"
      ? require("./paper")
      : null;

const ServerDbRefAudit = (() => {
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

const AuditLogger = (() => {
  const STORAGE_KEY = "yashwin_audit_logs_v1";
  const EMERGENCY_KEY = "yashwin_emergency_stop_v1";
  const MAX_LOGS = 250;

  const CATEGORIES = {
    TRADE_DECISION: "TRADE_DECISION",
    RISK_REJECTION: "RISK_REJECTION",
    AUTH_EVENT: "AUTH_EVENT",
    EMERGENCY_STOP: "EMERGENCY_STOP",
    ERROR: "ERROR",
    PILOT_APPROVAL: "PILOT_APPROVAL",
    SYSTEM: "SYSTEM"
  };

  let logs = [];
  let emergencyStopState = {
    active: false,
    activatedAt: null,
    reason: null
  };

  function redactSensitive(details = {}) {
    if (!details || typeof details !== "object") return {};
    if (Array.isArray(details)) {
      return details.map((item) => redactSensitive(item));
    }
    const copy = { ...details };
    const forbidden = [
      "apiKey",
      "api_key",
      "angel_api_key",
      "clientId",
      "angel_client_id",
      "pin",
      "angel_pin",
      "totpSecret",
      "angel_totp_secret",
      "twelve_data_api_key",
      "twelvedataapikey",
      "accessToken",
      "refreshToken",
      "feedToken",
      "jwtToken",
      "password",
      "gemini_api_key",
      "google_ai_api_key",
      "authorization"
    ];

    for (const key of Object.keys(copy)) {
      if (
        forbidden.some((f) => f.toLowerCase() === String(key).toLowerCase())
      ) {
        copy[key] = "[REDACTED]";
      } else if (copy[key] && typeof copy[key] === "object") {
        copy[key] = redactSensitive(copy[key]);
      }
    }
    return copy;
  }

  function save() {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
        localStorage.setItem(EMERGENCY_KEY, JSON.stringify(emergencyStopState));
      } catch (_) {}
    }
  }

  function load() {
    if (ServerDbRefAudit) {
      try {
        const dbEm = ServerDbRefAudit.getEmergencyStop();
        emergencyStopState = {
          active: Boolean(dbEm.active),
          activatedAt: dbEm.activatedAt || null,
          reason: dbEm.reason || null
        };
        logs = ServerDbRefAudit.listAuditEvents(null, MAX_LOGS);
      } catch (_) {}
    }

    if (typeof localStorage !== "undefined") {
      try {
        const rawLogs = localStorage.getItem(STORAGE_KEY);
        if (rawLogs) {
          const parsed = JSON.parse(rawLogs);
          if (Array.isArray(parsed)) {
            logs = parsed.slice(0, MAX_LOGS);
          }
        }
        const rawEmergency = localStorage.getItem(EMERGENCY_KEY);
        if (rawEmergency) {
          const parsedEm = JSON.parse(rawEmergency);
          if (parsedEm && typeof parsedEm === "object") {
            emergencyStopState = {
              active: Boolean(parsedEm.active),
              activatedAt: parsedEm.activatedAt || null,
              reason: parsedEm.reason || null
            };
          }
        }
      } catch (_) {}
    }
  }

  function record(category, message, details = {}) {
    const validCategory = CATEGORIES[category] || CATEGORIES.SYSTEM;
    const entry = {
      id: `AUDIT-${Date.now()}-${logs.length + 1}`,
      category: validCategory,
      message: String(message || "").trim(),
      details: redactSensitive(details),
      timestamp: new Date().toISOString()
    };

    logs.unshift(entry);
    if (logs.length > MAX_LOGS) {
      logs = logs.slice(0, MAX_LOGS);
    }

    if (ServerDbRefAudit) {
      try {
        ServerDbRefAudit.insertAuditEvent(entry);
      } catch (_) {}
    }

    save();
    return entry;
  }

  function logTradeDecision(message, details) {
    return record(CATEGORIES.TRADE_DECISION, message, details);
  }

  function logRiskRejection(message, details) {
    return record(CATEGORIES.RISK_REJECTION, message, details);
  }

  function logAuthEvent(message, details) {
    return record(CATEGORIES.AUTH_EVENT, message, details);
  }

  function logError(message, details) {
    return record(CATEGORIES.ERROR, message, details);
  }

  function activateEmergencyStop(reason = "Manual Emergency Stop", context = {}) {
    emergencyStopState = {
      active: true,
      activatedAt: new Date().toISOString(),
      reason: String(reason)
    };

    if (ServerDbRefAudit) {
      try {
        ServerDbRefAudit.setEmergencyStop(true, reason);
      } catch (_) {}
    }

    const riskEngine =
      context.riskEngine ||
      (typeof RiskEngine !== "undefined" ? RiskEngine : RiskEngineRefAudit);
    if (riskEngine && typeof riskEngine.setEmergencyStop === "function") {
      riskEngine.setEmergencyStop(true);
    }

    const paperTrading =
      context.paperTrading ||
      (typeof PaperTrading !== "undefined" ? PaperTrading : PaperTradingRefAudit);
    let closedPositionResult = null;
    if (paperTrading && typeof paperTrading.triggerEmergencyStop === "function") {
      closedPositionResult = paperTrading.triggerEmergencyStop("EMERGENCY_STOP");
    }

    const entry = record(CATEGORIES.EMERGENCY_STOP, `EMERGENCY STOP ACTIVATED: ${reason}`, {
      reason,
      closedPosition: Boolean(closedPositionResult?.closedTrade)
    });

    save();

    return {
      ok: true,
      active: true,
      activatedAt: emergencyStopState.activatedAt,
      reason: emergencyStopState.reason,
      closedPositionResult,
      auditEntry: entry
    };
  }

  function resetEmergencyStop(reason = "Explicit User Reset", context = {}) {
    emergencyStopState = {
      active: false,
      activatedAt: null,
      reason: null
    };

    if (ServerDbRefAudit) {
      try {
        ServerDbRefAudit.setEmergencyStop(false, reason);
      } catch (_) {}
    }

    const riskEngine =
      context.riskEngine ||
      (typeof RiskEngine !== "undefined" ? RiskEngine : RiskEngineRefAudit);
    if (riskEngine && typeof riskEngine.setEmergencyStop === "function") {
      riskEngine.setEmergencyStop(false);
    }

    const paperTrading =
      context.paperTrading ||
      (typeof PaperTrading !== "undefined" ? PaperTrading : PaperTradingRefAudit);
    if (paperTrading && typeof paperTrading.resetEmergencyStop === "function") {
      paperTrading.resetEmergencyStop();
    }

    const entry = record(CATEGORIES.EMERGENCY_STOP, `EMERGENCY STOP RESET: ${reason}`, {
      reason
    });

    save();

    return {
      ok: true,
      active: false,
      auditEntry: entry
    };
  }

  function isEmergencyStopActive() {
    if (ServerDbRefAudit) {
      try {
        const dbEm = ServerDbRefAudit.getEmergencyStop();
        if (dbEm && typeof dbEm.active === "boolean") {
          emergencyStopState.active = dbEm.active;
        }
      } catch (_) {}
    }
    return emergencyStopState.active === true;
  }

  function getEmergencyState() {
    return { ...emergencyStopState };
  }

  function getLogs(filterCategory = null) {
    if (!filterCategory) {
      return [...logs];
    }
    return logs.filter((item) => item.category === filterCategory);
  }

  function clearLogs() {
    logs = [];
    save();
  }

  load();

  return {
    CATEGORIES,
    record,
    logTradeDecision,
    logRiskRejection,
    logAuthEvent,
    logError,
    activateEmergencyStop,
    resetEmergencyStop,
    isEmergencyStopActive,
    getEmergencyState,
    getLogs,
    clearLogs,
    redactSensitive
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = AuditLogger;
}
