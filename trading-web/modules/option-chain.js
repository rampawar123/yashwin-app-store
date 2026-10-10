/*
 * YASHWIN AI Trading Assistant
 * Phase 15 — Option-Chain Architecture
 *
 * Supports:
 * - chain fetch adapter (read-only)
 * - normalization of CE/PE contracts (expiry, strike, OI, OI change, volume, IV, LTP)
 * - PCR calculation where data supports it
 * - expiry selection & ATM/OTM/ITM strike selection
 * - option scoring
 *
 * Never invents option-chain values.
 * No broker orders.
 */

const OptionChain = (() => {

  function numberOrNull(val) {
    if (val === null || val === undefined || val === "") return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeContract(raw = {}) {
    const optionType = String(raw.optionType || raw.type || "").trim().toUpperCase();
    const strikePrice = numberOrNull(raw.strikePrice ?? raw.strike);
    const expiry = raw.expiry ? String(raw.expiry).trim() : null;
    const exchange = String(raw.exchange || "NFO").trim().toUpperCase();

    if (
      (optionType !== "CE" && optionType !== "PE") ||
      strikePrice === null ||
      strikePrice <= 0 ||
      !expiry
    ) {
      return null;
    }

    return {
      exchange,
      tradingsymbol: raw.tradingsymbol || raw.symbol || null,
      symboltoken: raw.symboltoken || raw.token || null,
      optionType,
      strikePrice,
      expiry,
      ltp: numberOrNull(raw.ltp ?? raw.price),
      oi: numberOrNull(raw.oi ?? raw.openInterest),
      oiChange: numberOrNull(raw.oiChange ?? raw.openInterestChange),
      volume: numberOrNull(raw.volume ?? raw.tradeVolume),
      iv: numberOrNull(raw.iv ?? raw.impliedVolatility),
      lotSize: numberOrNull(raw.lotSize ?? raw.lotsize)
    };
  }

  function normalizeChain(rawContracts = [], underlyingPrice = null) {
    const source = Array.isArray(rawContracts)
      ? rawContracts
      : Array.isArray(rawContracts?.contracts)
        ? rawContracts.contracts
        : Array.isArray(rawContracts?.results)
          ? rawContracts.results
          : [];

    const validContracts = source
      .map(normalizeContract)
      .filter(Boolean);

    const expiriesSet = new Set();
    const strikesMap = new Map();

    let totalCallOI = 0;
    let totalPutOI = 0;
    let hasCallOI = false;
    let hasPutOI = false;

    let totalCallOIChange = 0;
    let totalPutOIChange = 0;
    let hasCallOIChange = false;
    let hasPutOIChange = false;

    let ivSum = 0;
    let ivCount = 0;

    for (const c of validContracts) {
      expiriesSet.add(c.expiry);

      const key = `${c.expiry}::${c.strikePrice}`;
      if (!strikesMap.has(key)) {
        strikesMap.set(key, {
          expiry: c.expiry,
          strikePrice: c.strikePrice,
          CE: null,
          PE: null
        });
      }

      const row = strikesMap.get(key);
      row[c.optionType] = c;

      if (c.optionType === "CE") {
        if (c.oi !== null && c.oi >= 0) {
          totalCallOI += c.oi;
          hasCallOI = true;
        }
        if (c.oiChange !== null) {
          totalCallOIChange += c.oiChange;
          hasCallOIChange = true;
        }
      } else if (c.optionType === "PE") {
        if (c.oi !== null && c.oi >= 0) {
          totalPutOI += c.oi;
          hasPutOI = true;
        }
        if (c.oiChange !== null) {
          totalPutOIChange += c.oiChange;
          hasPutOIChange = true;
        }
      }

      if (c.iv !== null && c.iv > 0) {
        ivSum += c.iv;
        ivCount += 1;
      }
    }

    const expiries = Array.from(expiriesSet).sort((a, b) => {
      const da = Date.parse(a);
      const db = Date.parse(b);
      if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
      return a.localeCompare(b);
    });

    const rows = Array.from(strikesMap.values()).sort(
      (a, b) => a.strikePrice - b.strikePrice
    );

    const pcr =
      hasCallOI && hasPutOI && totalCallOI > 0
        ? Math.round((totalPutOI / totalCallOI) * 100) / 100
        : null;

    const avgIV = ivCount > 0 ? Math.round((ivSum / ivCount) * 100) / 100 : null;

    const metricsAvailable =
      validContracts.length > 0 &&
      pcr !== null &&
      hasCallOIChange &&
      hasPutOIChange;

    return {
      available: validContracts.length > 0,
      metricsAvailable,
      underlyingPrice: numberOrNull(underlyingPrice),
      expiries,
      contracts: validContracts,
      rows,
      summary: {
        available: metricsAvailable,
        pcr,
        iv: avgIV,
        callOI: hasCallOI ? totalCallOI : null,
        putOI: hasPutOI ? totalPutOI : null,
        callOIChange: hasCallOIChange ? totalCallOIChange : null,
        putOIChange: hasPutOIChange ? totalPutOIChange : null
      }
    };
  }

  function selectExpiry(chain = {}, preferredExpiry = null) {
    const expiries = Array.isArray(chain.expiries) ? chain.expiries : [];
    if (!expiries.length) return null;

    if (preferredExpiry && expiries.includes(preferredExpiry)) {
      return preferredExpiry;
    }

    return expiries[0];
  }

  function selectStrike(chain = {}, options = {}) {
    const underlying = numberOrNull(
      options.underlyingPrice ?? chain.underlyingPrice
    );
    const optionType = String(options.optionType || "CE").trim().toUpperCase();
    const expiry = selectExpiry(chain, options.expiry);

    if (!expiry || underlying === null || underlying <= 0) {
      return null;
    }

    const candidates = (Array.isArray(chain.contracts) ? chain.contracts : []).filter(
      (c) => c.expiry === expiry && c.optionType === optionType
    );

    if (!candidates.length) return null;

    const sortedByDistance = [...candidates].sort((a, b) => {
      const distA = Math.abs(a.strikePrice - underlying);
      const distB = Math.abs(b.strikePrice - underlying);
      if (distA !== distB) return distA - distB;
      return a.strikePrice - b.strikePrice;
    });

    return sortedByDistance[0] || null;
  }

  function scoreChain(chain = {}) {
    const summary = chain.summary || {};
    if (summary.available !== true) {
      return 0;
    }

    if (
      typeof MarketAnalysis !== "undefined" &&
      typeof MarketAnalysis.calculateOptionScore === "function"
    ) {
      return MarketAnalysis.calculateOptionScore(summary);
    }

    const pcr = Number(summary.pcr);
    const callOIChange = Number(summary.callOIChange);
    const putOIChange = Number(summary.putOIChange);
    const iv = Number(summary.iv);

    if (
      !Number.isFinite(pcr) ||
      !Number.isFinite(callOIChange) ||
      !Number.isFinite(putOIChange)
    ) {
      return 0;
    }

    let score = 0;
    if (pcr >= 1.2) score += 35;
    else if (pcr >= 1.0) score += 20;
    else if (pcr <= 0.8) score -= 35;
    else if (pcr < 1.0) score -= 20;

    const oiDelta = putOIChange - callOIChange;
    if (oiDelta > 0) score += 30;
    else if (oiDelta < 0) score -= 30;

    if (Number.isFinite(iv) && iv >= 35) {
      score *= 0.75;
    }

    return Math.max(-100, Math.min(100, score));
  }

  async function fetchChainFromSearch(underlyingSymbol, exchange = "NFO", apiClient) {
    const api =
      apiClient ||
      (typeof MarketAPI !== "undefined" ? MarketAPI : null);

    if (!api || typeof api.searchInstruments !== "function") {
      const err = new Error("MarketAPI searchInstruments is unavailable.");
      err.code = "MARKET_API_UNAVAILABLE";
      throw err;
    }

    const response = await api.searchInstruments(exchange, underlyingSymbol);
    const rawResults = Array.isArray(response?.results) ? response.results : [];

    return normalizeChain(rawResults);
  }

  return {
    normalizeContract,
    normalizeChain,
    selectExpiry,
    selectStrike,
    scoreChain,
    fetchChainFromSearch
  };

})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = OptionChain;
}
