/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — Market Data Provider Registry
 *
 * Provider selection layer only.
 * No fake prices.
 * No trading decisions.
 * No broker orders.
 */

const MarketDataProviders = (() => {

  const providers = new Map();

  function register(name, provider) {
    if (!name || !provider) {
      throw new Error("Provider name and provider are required.");
    }

    providers.set(String(name).toUpperCase(), provider);
  }

  function get(name) {
    if (!name) return null;

    return providers.get(
      String(name).toUpperCase()
    ) || null;
  }

  function list() {
    return Array.from(providers.keys());
  }

  function createUnconfigured(name) {
    if (typeof MarketDataProvider === "undefined") {
      throw new Error("MarketDataProvider contract is not loaded.");
    }

    return MarketDataProvider.createProvider(name);
  }

  return {
    register,
    get,
    list,
    createUnconfigured
  };

})();

/*
 * Initial registry state.
 *
 * The actual real-data provider will be registered
 * only after its API credentials/configuration are ready.
 */
MarketDataProviders.register(
  "UNCONFIGURED",
  MarketDataProviders.createUnconfigured("UNCONFIGURED")
);
