/*
 * YASHWIN AI Trading Assistant
 * Market Data Layer - Foundation
 *
 * Supported indices:
 * NIFTY 50
 * BANK NIFTY
 * SENSEX
 *
 * This module currently provides the standardized
 * market-data structure only.
 *
 * No fake live prices.
 * No broker orders.
 * No trading decision.
 */

const MarketData = (() => {

  const instruments = {
    NIFTY50: {
      key: "NIFTY50",
      name: "NIFTY 50",
      exchange: "NSE",
      type: "INDEX"
    },

    BANKNIFTY: {
      key: "BANKNIFTY",
      name: "BANK NIFTY",
      exchange: "NSE",
      type: "INDEX"
    },

    SENSEX: {
      key: "SENSEX",
      name: "SENSEX",
      exchange: "BSE",
      type: "INDEX"
    }
  };

  function emptySnapshot(instrumentKey) {
    const instrument = instruments[instrumentKey];

    if (!instrument) {
      throw new Error("Unknown market instrument.");
    }

    return {
      instrument: instrument.key,
      name: instrument.name,
      exchange: instrument.exchange,
      type: instrument.type,

      dataReady: false,
      timestamp: null,

      price: null,
      open: null,
      high: null,
      low: null,
      previousClose: null,

      volume: null,

      candles: [],

      indicators: {
        trendScore: null,
        momentumScore: null,
        volumeScore: null,
        vwapScore: null,
        supportResistanceScore: null,
        volatilityScore: null
      },

      options: {
        available: false,
        pcr: null,
        iv: null,
        callOI: null,
        putOI: null,
        callOIChange: null,
        putOIChange: null
      },

      breadth: {
        available: false,
        advancing: null,
        declining: null,
        unchanged: null
      },

      newsContext: {
        available: false,
        score: null,
        items: []
      }
    };
  }

  function getInstrument(key) {
    return instruments[key] || null;
  }

  function listInstruments() {
    return Object.values(instruments);
  }

  return {
    instruments,
    emptySnapshot,
    getInstrument,
    listInstruments
  };

})();
