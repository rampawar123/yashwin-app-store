/*
 * YASHWIN AI Trading Assistant
 * Phase 7, 10 & Final Completion — Read-Only Browser API Client + Server Persistence Bridge
 *
 * Uses same-origin /api routes by default.
 * No credentials.
 * No live broker orders.
 * No live trading execution.
 */

const MarketAPI = (() => {
  const API_BASE =
    typeof window !== "undefined" && window.YASHWIN_API_BASE_URL
      ? String(window.YASHWIN_API_BASE_URL).trim()
      : "";

  let csrfToken = null;

  function setCsrfToken(token) {
    csrfToken = token ? String(token) : null;
  }

  function getCsrfToken() {
    return csrfToken;
  }

  const DEFAULT_TIMEOUT_MS = 12000;

  function resolveApiBaseUrl(options = {}) {
    if (options.baseUrl !== undefined) {
      return String(options.baseUrl).trim();
    }
    if (typeof window !== "undefined" && window.YASHWIN_API_BASE_URL) {
      return String(window.YASHWIN_API_BASE_URL).trim();
    }
    return API_BASE;
  }

  async function request(path, options = {}) {
    const baseUrl = resolveApiBaseUrl(options);
    const fetchFn = options.fetchFn || (typeof fetch === "function" ? fetch : null);

    if (!fetchFn) {
      return {
        ok: false,
        code: "FETCH_UNAVAILABLE",
        message: "Fetch API is not available in this environment."
      };
    }

    const method = String(options.method || "GET").toUpperCase();
    const effectiveCsrf =
      options.csrfToken !== undefined ? options.csrfToken : csrfToken;
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
    const maxRetries =
      options.retries !== undefined
        ? Math.max(0, Math.min(2, Number(options.retries) || 0))
        : 0;

    let attempt = 0;
    while (attempt <= maxRetries) {
      let timerId = null;
      const controller =
        typeof AbortController === "function" && !options.signal
          ? new AbortController()
          : null;

      try {
        if (controller && timeoutMs > 0) {
          timerId = setTimeout(() => {
            try {
              controller.abort();
            } catch (_) {}
          }, timeoutMs);
        }

        const response = await fetchFn(`${baseUrl}${path}`, {
          method,
          credentials: options.credentials || "same-origin",
          signal: options.signal || (controller ? controller.signal : undefined),
          headers: {
            Accept: "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(method !== "GET" && method !== "HEAD" && effectiveCsrf
              ? { "X-CSRF-Token": String(effectiveCsrf) }
              : {}),
            ...(options.headers || {})
          },
          body: options.body ? JSON.stringify(options.body) : undefined
        });

        if (timerId) clearTimeout(timerId);

        const data = await response.json();
        if (data && typeof data.csrfToken === "string") {
          csrfToken = data.csrfToken;
        } else if (path === "/api/user/logout" && data?.ok) {
          csrfToken = null;
        }
        return data;
      } catch (error) {
        if (timerId) clearTimeout(timerId);
        if (attempt < maxRetries && (method === "GET" || method === "HEAD")) {
          attempt += 1;
          continue;
        }
        const isTimeout = error && (error.name === "AbortError" || /abort|timeout/i.test(String(error.message || "")));
        return {
          ok: false,
          code: isTimeout ? "API_TIMEOUT" : "API_UNREACHABLE",
          message: isTimeout
            ? `Market API request timed out after ${timeoutMs}ms.`
            : error.message || "Market API server is not reachable."
        };
      }
    }
  }

  function health(options = {}) {
    return request("/api/health", options);
  }

  function authStatus(options = {}) {
    return request("/api/auth/status", options);
  }

  function aiStatus(options = {}) {
    return request("/api/ai/status", options);
  }

  function aiAnalyze(payload = {}, options = {}) {
    return request("/api/ai/analyze", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function userRegister(payload = {}, options = {}) {
    return request("/api/user/register", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function userLogin(payload = {}, options = {}) {
    return request("/api/user/login", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function userLogout(options = {}) {
    return request("/api/user/logout", {
      ...options,
      method: "POST",
      body: {}
    });
  }

  function userSession(options = {}) {
    return request("/api/user/session", options);
  }

  function userProfile(options = {}) {
    return request("/api/user/profile", options);
  }

  function updateUserProfile(payload = {}, options = {}) {
    return request("/api/user/profile", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function verifyEmailChange(token, options = {}) {
    return request("/api/user/email/verify", {
      ...options,
      method: "POST",
      body: { token }
    });
  }

  function changePassword(payload = {}, options = {}) {
    return request("/api/user/password", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function paperState(options = {}) {
    return request("/api/paper/state", options);
  }

  function paperOpen(payload = {}, options = {}) {
    return request("/api/paper/open", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function paperClose(payload = {}, options = {}) {
    return request("/api/paper/close", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function paperPriceUpdate(payload = {}, options = {}) {
    return request("/api/paper/price-update", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function buildPortfolioQuery(params = {}) {
    const sp = new URLSearchParams();
    if (params.symbol) sp.set("symbol", String(params.symbol).trim());
    if (params.status) sp.set("status", String(params.status).trim());
    if (params.reason) sp.set("reason", String(params.reason).trim());
    if (params.date) sp.set("date", String(params.date).trim());
    if (params.fromDate) sp.set("fromDate", String(params.fromDate).trim());
    if (params.toDate) sp.set("toDate", String(params.toDate).trim());
    if (params.quoteStale) sp.set("quoteStale", "1");
    if (params.quoteUnavailable) sp.set("quoteUnavailable", "1");
    const qs = sp.toString();
    return qs ? `?${qs}` : "";
  }

  function portfolioSummary(params = {}, options = {}) {
    return request(`/api/portfolio/summary${buildPortfolioQuery(params)}`, options);
  }

  function portfolioPositions(params = {}, options = {}) {
    return request(`/api/portfolio/positions${buildPortfolioQuery(params)}`, options);
  }

  function portfolioPerformance(params = {}, options = {}) {
    return request(`/api/portfolio/performance${buildPortfolioQuery(params)}`, options);
  }

  function portfolioHistory(params = {}, options = {}) {
    return request(`/api/portfolio/history${buildPortfolioQuery(params)}`, options);
  }

  function buildOrderTradeHistoryQuery(params = {}) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        sp.set(k, String(v).trim());
      }
    }
    const qs = sp.toString();
    return qs ? `?${qs}` : "";
  }

  function ordersHistory(params = {}, options = {}) {
    return request(`/api/orders${buildOrderTradeHistoryQuery(params)}`, options);
  }

  function orderFills(params = {}, options = {}) {
    return request(`/api/orders/fills${buildOrderTradeHistoryQuery(params)}`, options);
  }

  function tradesHistory(params = {}, options = {}) {
    return request(`/api/trades/history${buildOrderTradeHistoryQuery(params)}`, options);
  }

  function auditLogs(category = "", options = {}) {
    const query = category ? `?category=${encodeURIComponent(category)}` : "";
    return request(`/api/audit/logs${query}`, options);
  }

  function activateEmergencyStop(reason = "Activated via UI", options = {}) {
    return request("/api/emergency/activate", {
      ...options,
      method: "POST",
      body: { reason }
    });
  }

  function resetEmergencyStop(reason = "Reset via UI", options = {}) {
    return request("/api/emergency/reset", {
      ...options,
      method: "POST",
      body: { reason }
    });
  }

  function runBacktest(payload = {}, options = {}) {
    return request("/api/backtest/run", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function backtestRuns(options = {}) {
    return request("/api/backtest/runs", options);
  }

  function backtestRunDetail(runId, options = {}) {
    return request(`/api/backtest/runs/${encodeURIComponent(String(runId))}`, options);
  }

  function backtestRunTrades(runId, options = {}) {
    return request(`/api/backtest/runs/${encodeURIComponent(String(runId))}/trades`, options);
  }

  function strategyEvaluate(payload = {}, options = {}) {
    return request("/api/strategy/evaluate", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function strategyHistory(options = {}) {
    return request("/api/strategy/history", options);
  }

  function riskEvaluate(payload = {}, options = {}) {
    return request("/api/risk/evaluate", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function riskStatus(options = {}) {
    return request("/api/risk/status", options);
  }

  function intelligenceStatus(market = "NSE", options = {}) {
    const params = new URLSearchParams({
      market: String(market || "NSE").trim().toUpperCase()
    });
    if (options.symbol) {
      params.set("symbol", String(options.symbol).trim().toUpperCase());
    }
    if (options.category) {
      params.set("category", String(options.category).trim().toUpperCase());
    }
    if (options.refresh) {
      params.set("refresh", "1");
    }
    return request(
      `/api/intelligence/status?${params.toString()}`,
      options
    );
  }

  function intelligenceFeed(query = {}, options = {}) {
    const params = new URLSearchParams({
      market: String(query.market || query.exchange || "NSE").trim().toUpperCase()
    });
    if (query.symbol) {
      params.set("symbol", String(query.symbol).trim().toUpperCase());
    }
    if (query.category) {
      params.set("category", String(query.category).trim().toUpperCase());
    }
    if (query.refresh) {
      params.set("refresh", "1");
    }
    return request(
      `/api/intelligence/feed?${params.toString()}`,
      options
    );
  }

  function readinessAudit(options = {}) {
    return request("/api/readiness/audit", options);
  }

  function searchInstruments(exchange, query, options = {}) {
    const params = new URLSearchParams({
      exchange: String(exchange || "NSE").trim().toUpperCase(),
      q: String(query || "").trim()
    });

    return request(`/api/instruments/search?${params.toString()}`, options);
  }

  function quote(exchange, query, exactSymbol = "", options = {}) {
    const params = new URLSearchParams({
      exchange: String(exchange || "NSE").trim().toUpperCase(),
      q: String(query || "").trim()
    });

    if (exactSymbol) {
      params.set("symbol", String(exactSymbol).trim());
    }

    return request(`/api/market/quote?${params.toString()}`, options);
  }

  function candles(exchange, query, exactSymbol = "", options = {}) {
    const params = new URLSearchParams({
      exchange: String(exchange || "NSE").trim().toUpperCase(),
      q: String(query || "").trim()
    });

    if (exactSymbol) {
      params.set("symbol", String(exactSymbol).trim());
    }
    if (options.interval) {
      params.set("interval", String(options.interval).trim());
    }
    if (options.fromdate) {
      params.set("fromdate", String(options.fromdate).trim());
    }
    if (options.todate) {
      params.set("todate", String(options.todate).trim());
    }

    return request(`/api/market/candles?${params.toString()}`, options);
  }

  function watchlist(options = {}) {
    return request("/api/watchlist", options);
  }

  function watchlistQuotes(params = {}, options = {}) {
    const qs = new URLSearchParams();
    qs.set("enrich", "1");
    if (params.live) qs.set("live", "1");
    if (params.refresh) qs.set("refresh", "1");
    return request(`/api/watchlist/quotes?${qs.toString()}`, options);
  }

  function addWatchlist(payload = {}, options = {}) {
    return request("/api/watchlist/add", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function removeWatchlist(payload = {}, options = {}) {
    return request("/api/watchlist/remove", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function reorderWatchlist(payload = {}, options = {}) {
    return request("/api/watchlist/reorder", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function alertsList(filters = {}, options = {}) {
    const qs = new URLSearchParams();
    if (filters.status) qs.set("status", String(filters.status));
    if (filters.symbol) qs.set("symbol", String(filters.symbol));
    if (filters.alertType) qs.set("alertType", String(filters.alertType));
    if (filters.limit) qs.set("limit", String(filters.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/api/alerts${suffix}`, options);
  }

  function createAlert(payload = {}, options = {}) {
    return request("/api/alerts", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function pauseAlert(payload = {}, options = {}) {
    return request("/api/alerts/pause", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function resumeAlert(payload = {}, options = {}) {
    return request("/api/alerts/resume", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function cancelAlert(payload = {}, options = {}) {
    return request("/api/alerts/cancel", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function resetAlert(payload = {}, options = {}) {
    return request("/api/alerts/reset", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function evaluateAlerts(payload = {}, options = {}) {
    return request("/api/alerts/evaluate", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function alertEvents(filters = {}, options = {}) {
    const qs = new URLSearchParams();
    if (filters.symbol) qs.set("symbol", String(filters.symbol));
    if (filters.alertType) qs.set("alertType", String(filters.alertType));
    if (filters.acknowledged !== undefined && filters.acknowledged !== null && filters.acknowledged !== "") {
      qs.set("acknowledged", String(filters.acknowledged));
    }
    if (filters.fromDate) qs.set("fromDate", String(filters.fromDate));
    if (filters.toDate) qs.set("toDate", String(filters.toDate));
    if (filters.limit) qs.set("limit", String(filters.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/api/alerts/events${suffix}`, options);
  }

  function acknowledgeAlertEvent(payload = {}, options = {}) {
    return request("/api/alerts/events/acknowledge", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function notificationsList(filters = {}, options = {}) {
    const qs = new URLSearchParams();
    if (filters.readStatus) qs.set("readStatus", String(filters.readStatus));
    if (filters.category) qs.set("category", String(filters.category));
    if (filters.severity) qs.set("severity", String(filters.severity));
    if (filters.symbol) qs.set("symbol", String(filters.symbol));
    if (filters.date) qs.set("date", String(filters.date));
    if (filters.fromDate) qs.set("fromDate", String(filters.fromDate));
    if (filters.toDate) qs.set("toDate", String(filters.toDate));
    if (filters.page) qs.set("page", String(filters.page));
    if (filters.pageSize) qs.set("pageSize", String(filters.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/api/notifications${suffix}`, options);
  }

  function markNotificationRead(payload = {}, options = {}) {
    return request("/api/notifications/read", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function markAllNotificationsRead(options = {}) {
    return request("/api/notifications/read-all", {
      ...options,
      method: "POST",
      body: {}
    });
  }

  function notificationPreferences(options = {}) {
    return request("/api/notifications/preferences", options);
  }

  function updateNotificationPreferences(payload = {}, options = {}) {
    return request("/api/notifications/preferences", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function recordNotificationDelivery(payload = {}, options = {}) {
    return request("/api/notifications/delivery", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function notificationDeliveryLogs(filters = {}, options = {}) {
    const qs = new URLSearchParams();
    if (filters.notificationId) qs.set("notificationId", String(filters.notificationId));
    if (filters.limit) qs.set("limit", String(filters.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/api/notifications/delivery${suffix}`, options);
  }

  function createSystemNotification(payload = {}, options = {}) {
    return request("/api/notifications/system", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function recentSearches(options = {}) {
    return request("/api/search/recent", options);
  }

  function recordRecentSearch(payload = {}, options = {}) {
    return request("/api/search/recent", {
      ...options,
      method: "POST",
      body: payload
    });
  }

  function clearRecentSearches(options = {}) {
    return request("/api/search/recent/clear", {
      ...options,
      method: "POST",
      body: {}
    });
  }

  return {
    API_BASE,
    setCsrfToken,
    getCsrfToken,
    request,
    health,
    authStatus,
    aiStatus,
    aiAnalyze,
    userRegister,
    userLogin,
    userLogout,
    userSession,
    userProfile,
    updateUserProfile,
    verifyEmailChange,
    changePassword,
    paperState,
    paperOpen,
    paperClose,
    paperPriceUpdate,
    portfolioSummary,
    portfolioPositions,
    portfolioPerformance,
    portfolioHistory,
    ordersHistory,
    orderFills,
    tradesHistory,
    auditLogs,
    activateEmergencyStop,
    resetEmergencyStop,
    runBacktest,
    backtestRuns,
    backtestRunDetail,
    backtestRunTrades,
    strategyEvaluate,
    strategyHistory,
    riskEvaluate,
    riskStatus,
    intelligenceStatus,
    intelligenceFeed,
    readinessAudit,
    searchInstruments,
    quote,
    candles,
    watchlist,
    watchlistQuotes,
    addWatchlist,
    removeWatchlist,
    reorderWatchlist,
    alertsList,
    createAlert,
    pauseAlert,
    resumeAlert,
    cancelAlert,
    resetAlert,
    evaluateAlerts,
    alertEvents,
    acknowledgeAlertEvent,
    notificationsList,
    markNotificationRead,
    markAllNotificationsRead,
    notificationPreferences,
    updateNotificationPreferences,
    recordNotificationDelivery,
    notificationDeliveryLogs,
    createSystemNotification,
    recentSearches,
    recordRecentSearch,
    clearRecentSearches
  };
})();

if (typeof window !== "undefined") {
  window.MarketAPI = MarketAPI;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = MarketAPI;
}
