/*
 * YASHWIN AI Trading Assistant
 * Phase 2 & 8 — Market Data Service
 *
 * Selected Instrument -> Provider -> Validated Quote
 *
 * No fake prices.
 * No trading decisions.
 * No broker orders.
 */

const ProviderContract =
  typeof MarketDataProvider !== "undefined"
    ? MarketDataProvider
    : typeof require === "function"
      ? require("./providers/provider")
      : null;

const ProviderRegistry =
  typeof MarketDataProviders !== "undefined"
    ? MarketDataProviders
    : typeof require === "function"
      ? require("./provider-registry")
      : null;

const RealMarketDataService = (() => {

  const MAX_QUOTE_AGE_MS = 60 * 1000;
  const MAX_FUTURE_TIMESTAMP_MS = 5 * 1000;

  let activeProviderName = "UNCONFIGURED";

  function setProvider(name) {
    const provider = ProviderRegistry ? ProviderRegistry.get(name) : null;

    if (!provider) {
      throw new Error("Unknown market-data provider: " + name);
    }

    activeProviderName = String(name).trim().toUpperCase();
    return provider;
  }

  function getProvider() {
    return ProviderRegistry ? ProviderRegistry.get(activeProviderName) : null;
  }

  function getStatus() {
    const provider = getProvider();

    return {
      provider: activeProviderName,
      status: provider?.status || "DISCONNECTED",
      dataReady: provider?.status === "CONNECTED"
    };
  }

  async function connect(apiClient) {
    const provider = getProvider();

    if (!provider) {
      throw new Error("Market-data provider is unavailable.");
    }

    return provider.connect(apiClient);
  }

  function validateQuote(
    rawQuote,
    instrumentKey,
    providerName = activeProviderName,
    nowMs = Date.now()
  ) {
    const quote = ProviderContract
      ? ProviderContract.normalizeQuote(rawQuote || {})
      : rawQuote || {};

    const base = {
      provider: providerName,
      instrument: instrumentKey || quote.instrument || null
    };

    if (
      quote.dataReady !== true ||
      quote.price === null ||
      quote.price === undefined
    ) {
      return {
        ok: false,
        code: "INVALID_MARKET_DATA",
        ...base,
        dataReady: false,
        quote: null
      };
    }

    const numericPrice = Number(quote.price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return {
        ok: false,
        code: "INVALID_MARKET_DATA",
        ...base,
        dataReady: false,
        quote: null
      };
    }

    if (!quote.timestamp) {
      return {
        ok: false,
        code: "INVALID_MARKET_DATA",
        ...base,
        dataReady: false,
        quote: null
      };
    }

    const timestampMs = Date.parse(quote.timestamp);
    if (!Number.isFinite(timestampMs)) {
      return {
        ok: false,
        code: "INVALID_MARKET_DATA",
        ...base,
        dataReady: false,
        quote: null
      };
    }

    const quoteAgeMs = nowMs - timestampMs;

    if (quoteAgeMs < -MAX_FUTURE_TIMESTAMP_MS) {
      return {
        ok: false,
        code: "FUTURE_MARKET_DATA",
        ...base,
        dataReady: false,
        quote: null
      };
    }

    if (quoteAgeMs > MAX_QUOTE_AGE_MS) {
      return {
        ok: false,
        code: "STALE_MARKET_DATA",
        ...base,
        dataReady: false,
        quote: null
      };
    }

    return {
      ok: true,
      code: "OK",
      ...base,
      dataReady: true,
      quote: {
        ...quote,
        price: numericPrice
      }
    };
  }

  async function getQuote(instrument, apiClient) {
    if (!instrument?.key && !instrument?.name && !instrument?.tradingsymbol) {
      throw new Error("Valid instrument is required.");
    }

    const provider = getProvider();

    if (!provider) {
      throw new Error("Market-data provider is unavailable.");
    }

    if (
      ProviderContract &&
      provider.status !== ProviderContract.STATUS.CONNECTED
    ) {
      return {
        ok: false,
        code: "DATA_NOT_READY",
        provider: activeProviderName,
        instrument: instrument.key || instrument.name,
        dataReady: false,
        quote: null
      };
    }

    const raw = await provider.getQuote(instrument, apiClient);

    return validateQuote(
      raw,
      instrument.key || instrument.name,
      activeProviderName
    );
  }

  async function getCandles(instrument, options = {}, apiClient) {
    if (!instrument?.key && !instrument?.name && !instrument?.tradingsymbol) {
      throw new Error("Valid instrument is required.");
    }

    const provider = getProvider();

    if (!provider || typeof provider.getCandles !== "function") {
      return {
        ok: false,
        code: "CANDLES_NOT_AVAILABLE",
        provider: activeProviderName,
        instrument: instrument.key || instrument.name,
        candles: []
      };
    }

    try {
      const candles = await provider.getCandles(instrument, options, apiClient);
      return {
        ok: true,
        code: "OK",
        provider: activeProviderName,
        instrument: instrument.key || instrument.name,
        candles: Array.isArray(candles) ? candles : []
      };
    } catch (error) {
      return {
        ok: false,
        code: error?.code || "CANDLES_FETCH_FAILED",
        provider: activeProviderName,
        instrument: instrument.key || instrument.name,
        candles: []
      };
    }
  }

  return {
    MAX_QUOTE_AGE_MS,
    MAX_FUTURE_TIMESTAMP_MS,
    setProvider,
    getProvider,
    getStatus,
    connect,
    validateQuote,
    getQuote,
    getCandles
  };

})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = RealMarketDataService;
}

