/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — Real Market Data Provider Contract
 *
 * This is only the provider contract.
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

  function normalizeQuote(raw = {}) {
    return {
      instrument: raw.instrument || null,
      exchange: raw.exchange || null,
      timestamp: raw.timestamp || null,

      price: raw.price ?? null,
      open: raw.open ?? null,
      high: raw.high ?? null,
      low: raw.low ?? null,
      previousClose: raw.previousClose ?? null,

      volume: raw.volume ?? null,
      dataReady: raw.dataReady === true
    };
  }

  function createProvider(name = "UNCONFIGURED") {
    return {
      name,
      status: STATUS.DISCONNECTED,

      async connect() {
        this.status = STATUS.CONNECTING;
        throw new Error(
          "No real market-data provider configured yet."
        );
      },

      async disconnect() {
        this.status = STATUS.DISCONNECTED;
      },

      async getQuote() {
        throw new Error(
          "No real market-data provider configured yet."
        );
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
