/*
 * YASHWIN AI Trading Assistant
 * Phase 2 — Market Data Provider Registry
 *
 * Provider selection layer only.
 * No fake prices.
 * No trading decisions.
 * No broker orders.
 */

const MarketDataProviderContract =
  typeof MarketDataProvider !== "undefined"
    ? MarketDataProvider
    : typeof require === "function"
      ? require("./providers/provider")
      : null;

const MarketDataProviders = (() => {

  const providers = new Map();

  function register(name, provider) {
    if (!name || !provider) {
      throw new Error("Provider name and provider are required.");
    }

    providers.set(String(name).trim().toUpperCase(), provider);
    return provider;
  }

  function get(name) {
    if (!name) return null;

    return providers.get(String(name).trim().toUpperCase()) || null;
  }

  function list() {
    return Array.from(providers.keys());
  }

  function createUnconfigured(name) {
    if (!MarketDataProviderContract) {
      throw new Error("MarketDataProvider contract is not loaded.");
    }

    return MarketDataProviderContract.createProvider(name);
  }

  return {
    register,
    get,
    list,
    createUnconfigured
  };

})();

MarketDataProviders.register(
  "UNCONFIGURED",
  MarketDataProviders.createUnconfigured("UNCONFIGURED")
);

if (typeof module !== "undefined" && module.exports) {
  module.exports = MarketDataProviders;
}
