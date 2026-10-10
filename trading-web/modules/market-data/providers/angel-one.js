/*
 * YASHWIN AI Trading Assistant
 * Phase 2 — Angel One Provider Adapter (Browser-Safe Read-Only Bridge)
 *
 * IMPORTANT:
 * API credentials must NEVER be placed in browser code.
 * All broker communication is delegated to server-side MarketAPI endpoints.
 * No fake prices.
 * No trading orders.
 */

const AngelOneProvider = (() => {

  const provider = {
    name: "ANGEL_ONE",
    status: "DISCONNECTED",

    options: {
      exchangeDefault: "NSE"
    },

    configure(options = {}) {
      // Never accept or store apiKey, clientId, pin, or totpSecret in browser
      if (options.exchangeDefault) {
        this.options.exchangeDefault = String(options.exchangeDefault)
          .trim()
          .toUpperCase();
      }

      return {
        configured: true,
        mode: "SERVER_PROXY_ONLY",
        exchangeDefault: this.options.exchangeDefault
      };
    },

    getStatus() {
      return {
        name: this.name,
        status: this.status,
        connected: this.status === "CONNECTED",
        mode: "SERVER_PROXY_ONLY"
      };
    },

    async connect(apiClient) {
      const api =
        apiClient ||
        (typeof MarketAPI !== "undefined" ? MarketAPI : null);

      if (!api || typeof api.health !== "function") {
        this.status = "ERROR";
        const err = new Error("MarketAPI client is unavailable.");
        err.code = "MARKET_API_UNAVAILABLE";
        throw err;
      }

      this.status = "CONNECTING";

      try {
        const health = await api.health();
        if (health?.ok && health?.session?.authenticated === true) {
          this.status = "CONNECTED";
          return this.getStatus();
        }

        this.status = "DISCONNECTED";
        return this.getStatus();
      } catch (error) {
        this.status = "ERROR";
        throw error;
      }
    },

    async disconnect() {
      this.status = "DISCONNECTED";
      return this.getStatus();
    },

    async searchInstrument(exchange, query, apiClient) {
      const api =
        apiClient ||
        (typeof MarketAPI !== "undefined" ? MarketAPI : null);

      if (!api || typeof api.searchInstruments !== "function") {
        const err = new Error("MarketAPI searchInstruments is unavailable.");
        err.code = "MARKET_API_UNAVAILABLE";
        throw err;
      }

      const targetExchange = String(
        exchange || this.options.exchangeDefault || "NSE"
      )
        .trim()
        .toUpperCase();

      return api.searchInstruments(targetExchange, query);
    },

    async getQuote(instrument = {}, apiClient) {
      const api =
        apiClient ||
        (typeof MarketAPI !== "undefined" ? MarketAPI : null);

      if (!api || typeof api.quote !== "function") {
        const err = new Error("MarketAPI quote is unavailable.");
        err.code = "MARKET_API_UNAVAILABLE";
        throw err;
      }

      const exchange = String(
        instrument.exchange || this.options.exchangeDefault || "NSE"
      )
        .trim()
        .toUpperCase();
      const query = String(
        instrument.name || instrument.tradingsymbol || instrument.key || ""
      ).trim();
      const exactSymbol = String(instrument.tradingsymbol || "").trim();

      if (!query) {
        const err = new Error("Instrument query is required for quote fetch.");
        err.code = "INSTRUMENT_QUERY_REQUIRED";
        throw err;
      }

      const response = await api.quote(exchange, query, exactSymbol);
      if (response?.ok && response.quote) {
        this.status = "CONNECTED";
        return response.quote;
      }

      const err = new Error("Failed to retrieve validated quote from server.");
      err.code = "ANGEL_QUOTE_UNAVAILABLE";
      throw err;
    },

    async getCandles(instrument = {}, options = {}, apiClient) {
      const api =
        apiClient ||
        (typeof MarketAPI !== "undefined" ? MarketAPI : null);

      if (!api || typeof api.candles !== "function") {
        const err = new Error("MarketAPI candles is unavailable.");
        err.code = "MARKET_API_UNAVAILABLE";
        throw err;
      }

      const exchange = String(
        instrument.exchange || this.options.exchangeDefault || "NSE"
      )
        .trim()
        .toUpperCase();
      const query = String(
        instrument.name || instrument.tradingsymbol || instrument.key || ""
      ).trim();
      const exactSymbol = String(instrument.tradingsymbol || "").trim();

      if (!query) {
        const err = new Error("Instrument query is required for candle fetch.");
        err.code = "INSTRUMENT_QUERY_REQUIRED";
        throw err;
      }

      const response = await api.candles(exchange, query, exactSymbol, options);
      if (response?.ok && Array.isArray(response.candles)) {
        this.status = "CONNECTED";
        return response.candles;
      }

      const err = new Error("Failed to retrieve historical candles from server.");
      err.code = "ANGEL_CANDLES_UNAVAILABLE";
      throw err;
    },

    normalizeQuote(raw = {}) {
      if (typeof MarketDataProvider !== "undefined") {
        return MarketDataProvider.normalizeQuote(raw);
      }
      return raw;
    }
  };

  return provider;

})();

if (typeof MarketDataProviders !== "undefined") {
  MarketDataProviders.register("ANGEL_ONE", AngelOneProvider);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = AngelOneProvider;
}
