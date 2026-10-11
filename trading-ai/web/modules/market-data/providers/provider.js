/*
 * YASHWIN AI Trading Assistant
 * Phase 2 — Real Market Data Provider Contract
 *
 * No fake prices.
 * No trading decisions.
 * No broker orders.
 */

const MarketDataProvider = (() => {

  const STATUS = {
    DISCONNECTED: "DISCONNECTED",
    CONNECTING: "CONNECTING",
    CONNECTED: "CONNECTED",
    ERROR: "ERROR"
  };

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeQuote(raw = {}) {
    return {
      instrument: raw.instrument || raw.tradingSymbol || null,
      exchange: raw.exchange ? String(raw.exchange).trim().toUpperCase() : null,
      timestamp: raw.timestamp || null,

      price: numberOrNull(raw.price),
      open: numberOrNull(raw.open),
      high: numberOrNull(raw.high),
      low: numberOrNull(raw.low),
      previousClose: numberOrNull(raw.previousClose),

      volume: numberOrNull(raw.volume),
      dataReady: raw.dataReady === true
    };
  }

  function createProvider(name = "UNCONFIGURED") {
    return {
      name: String(name || "UNCONFIGURED").toUpperCase(),
      status: STATUS.DISCONNECTED,

      configure() {
        return { configured: false, mode: "UNCONFIGURED" };
      },

      getStatus() {
        return {
          name: this.name,
          status: this.status,
          connected: this.status === STATUS.CONNECTED
        };
      },

      async connect() {
        this.status = STATUS.ERROR;
        const err = new Error("No real market-data provider configured yet.");
        err.code = "PROVIDER_UNCONFIGURED";
        throw err;
      },

      async disconnect() {
        this.status = STATUS.DISCONNECTED;
        return this.getStatus();
      },

      async getQuote() {
        const err = new Error("No real market-data provider configured yet.");
        err.code = "PROVIDER_UNCONFIGURED";
        throw err;
      },

      async searchInstrument() {
        const err = new Error("No real market-data provider configured yet.");
        err.code = "PROVIDER_UNCONFIGURED";
        throw err;
      },

      normalizeQuote
    };
  }

  return {
    STATUS,
    normalizeQuote,
    createProvider
  };

})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = MarketDataProvider;
}
