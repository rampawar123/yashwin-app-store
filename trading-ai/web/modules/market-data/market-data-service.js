/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — Market Data Service
 *
 * Selected Instrument -> Provider -> Validated Quote
 *
 * No fake prices.
 * No trading decisions.
 * No broker orders.
 */

const RealMarketDataService = (() => {

  /*
   * Market-data quality guard.
   *
   * A quote older than this must never become trading-ready data.
   * 60 seconds is intentionally conservative for the dashboard layer.
   */
  const MAX_QUOTE_AGE_MS = 60 * 1000;
  const MAX_FUTURE_TIMESTAMP_MS = 5 * 1000;

  let activeProviderName = "UNCONFIGURED";

  function setProvider(name) {
    const provider = MarketDataProviders.get(name);

    if (!provider) {
      throw new Error("Unknown market-data provider: " + name);
    }

    activeProviderName = String(name).toUpperCase();
    return provider;
  }

  function getProvider() {
    return MarketDataProviders.get(activeProviderName);
  }

  function getStatus() {
    const provider = getProvider();

    return {
      provider: activeProviderName,
      status: provider?.status || "DISCONNECTED",
      dataReady: false
    };
  }

  async function connect() {
    const provider = getProvider();

    if (!provider) {
      throw new Error("Market-data provider is unavailable.");
    }

    return provider.connect();
  }

  async function getQuote(instrument) {
    if (!instrument?.key) {
      throw new Error("Valid instrument is required.");
    }

    const provider = getProvider();

    if (!provider) {
      throw new Error("Market-data provider is unavailable.");
    }

    if (
      typeof MarketDataProvider !== "undefined" &&
      provider.status !== MarketDataProvider.STATUS.CONNECTED
    ) {
      return {
        ok: false,
        code: "DATA_NOT_READY",
        provider: activeProviderName,
        instrument: instrument.key,
        dataReady: false,
        quote: null
      };
    }

    const raw = await provider.getQuote(instrument);

    const quote = MarketDataProvider.normalizeQuote(raw);

    if (
      quote.dataReady !== true ||
      quote.price === null ||
      !quote.timestamp
    ) {
      return {
        ok: false,
        code: "INVALID_MARKET_DATA",
        provider: activeProviderName,
        instrument: instrument.key,
        dataReady: false,
        quote: null
      };
    }

    const numericPrice = Number(quote.price);
    const timestampMs = Date.parse(quote.timestamp);
    const nowMs = Date.now();

    if (
      !Number.isFinite(numericPrice) ||
      numericPrice <= 0 ||
      !Number.isFinite(timestampMs)
    ) {
      return {
        ok: false,
        code: "INVALID_MARKET_DATA",
        provider: activeProviderName,
        instrument: instrument.key,
        dataReady: false,
        quote: null
      };
    }

    const quoteAgeMs = nowMs - timestampMs;

    if (
      quoteAgeMs > MAX_QUOTE_AGE_MS ||
      quoteAgeMs < -MAX_FUTURE_TIMESTAMP_MS
    ) {
      return {
        ok: false,
        code: "STALE_MARKET_DATA",
        provider: activeProviderName,
        instrument: instrument.key,
        dataReady: false,
        quote: null
      };
    }

    return {
      ok: true,
      code: "OK",
      provider: activeProviderName,
      instrument: instrument.key,
      dataReady: true,
      quote
    };
  }

  return {
    setProvider,
    getProvider,
    getStatus,
    connect,
    getQuote
  };

})();
