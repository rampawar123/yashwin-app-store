/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — Angel One Provider Adapter
 *
 * Server-side integration contract.
 *
 * IMPORTANT:
 * API credentials must NEVER be placed in browser code.
 * No fake prices.
 * No trading orders.
 */

const AngelOneProvider = (() => {

  const provider = {
    name: "ANGEL_ONE",
    status: "DISCONNECTED",

    config: {
      apiKey: null,
      clientId: null
    },

    configure(config = {}) {
      this.config.apiKey = config.apiKey || null;
      this.config.clientId = config.clientId || null;

      return {
        configured:
          Boolean(this.config.apiKey) &&
          Boolean(this.config.clientId)
      };
    },

    async connect() {
      if (!this.config.apiKey || !this.config.clientId) {
        this.status = "ERROR";

        throw new Error(
          "Angel One credentials are not configured."
        );
      }

      /*
       * Authentication will be implemented on the server.
       * Do not authenticate from browser JavaScript.
       */

      this.status = "CONNECTING";

      throw new Error(
        "Angel One server authentication adapter is not implemented yet."
      );
    },

    async disconnect() {
      this.status = "DISCONNECTED";
    },

    async getQuote() {
      if (this.status !== "CONNECTED") {
        throw new Error(
          "Angel One provider is not connected."
        );
      }

      /*
       * Real quote API implementation comes next.
       * No fake market data is returned here.
       */

      throw new Error(
        "Angel One quote adapter is not implemented yet."
      );
    }
  };

  return provider;

})();

if (typeof MarketDataProviders !== "undefined") {
  MarketDataProviders.register(
    "ANGEL_ONE",
    AngelOneProvider
  );
}
