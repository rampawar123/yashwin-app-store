"use strict";
/*
 * CRIC YUVA Phase 1-19 data contract.
 * This file contains the central schema extensions and domain helpers used by server.js.
 * It deliberately does not change the original UI files.
 */
const crypto = require("crypto");
function id(prefix) { return `${prefix}-${new Date().getFullYear()}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`; }
function now() { return Date.now(); }
function safeJson(v, fallback = {}) { if (v && typeof v === "object") return v; if (typeof v === "string") { try { return JSON.parse(v); } catch {} } return fallback; }
function cricketBallIsLegal(ball) { return !ball.wide && !ball.noBall; }
function scoreDelivery(state, delivery) {
  const d = delivery || {}; const out = JSON.parse(JSON.stringify(state || {}));
  out.runs = Number(out.runs || 0); out.wickets = Number(out.wickets || 0); out.legalBalls = Number(out.legalBalls || 0); out.totalBalls = Number(out.totalBalls || 0);
  out.runs += Math.max(0, Number(d.runs || 0)); out.totalBalls += 1;
  if (d.wide || d.noBall) out.runs += Math.max(1, Number(d.extraRuns || 1));
  else out.legalBalls += 1;
  if (d.wicket) out.wickets += 1;
  return out;
}
module.exports = { id, now, safeJson, cricketBallIsLegal, scoreDelivery };
