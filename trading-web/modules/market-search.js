/*
 * YASHWIN AI Trading Assistant
 * Phase 7 & Task 4 — Complete Market Search, Filtering, Disambiguation & Contract Validation Layer
 *
 * Consumes /api/instruments/search contract:
 * { ok: true, provider, exchange, query, results: [] }
 *
 * Strictly enforces:
 * - Zero fake prices, zero fabricated symboltokens, zero synthetic F&O contracts
 * - Search by symbol, trading symbol, and company/instrument name
 * - Exchange filters (ALL, NSE, BSE, NFO, BFO)
 * - Instrument type filters (ALL, EQUITY, INDEX, FUTURES, OPTION)
 * - Exact vs ambiguous symbol resolution
 * - Option contract validation (CE/PE, positive strikePrice, valid expiry, NFO/BFO exchange)
 * - Recent searches and Watchlist integration
 */

const MarketSearch = (() => {
  const SUPPORTED_EXCHANGES = ["ALL", "NSE", "BSE", "NFO", "BFO"];
  const SUPPORTED_TYPES = ["ALL", "INDEX", "EQUITY", "FUTURES", "OPTION"];

  const MONTH_MAP = {
    JAN: 0,
    FEB: 1,
    MAR: 2,
    APR: 3,
    MAY: 4,
    JUN: 5,
    JUL: 6,
    AUG: 7,
    SEP: 8,
    OCT: 9,
    NOV: 10,
    DEC: 11
  };

  /*
   * Known reference equities and indices (NSE & BSE).
   * Note: symboltoken is strictly null until resolved by official Angel One /api/instruments/search.
   * Never fabricates or guesses symboltokens.
   */
  const extraInstruments = [
    {
      key: "FINNIFTY",
      name: "NIFTY FIN SERVICE",
      companyName: "Nifty Financial Services Index",
      tradingsymbol: "FINNIFTY",
      exchange: "NSE",
      type: "INDEX",
      symboltoken: null
    },
    {
      key: "MIDCPNIFTY",
      name: "NIFTY MID SELECT",
      companyName: "Nifty Midcap Select Index",
      tradingsymbol: "MIDCPNIFTY",
      exchange: "NSE",
      type: "INDEX",
      symboltoken: null
    },
    {
      key: "BANKEX",
      name: "BSE BANKEX",
      companyName: "S&P BSE BANKEX Index",
      tradingsymbol: "BANKEX",
      exchange: "BSE",
      type: "INDEX",
      symboltoken: null
    },
    {
      key: "RELIANCE",
      name: "RELIANCE",
      companyName: "Reliance Industries Limited",
      tradingsymbol: "RELIANCE-EQ",
      exchange: "NSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "TCS",
      name: "TCS",
      companyName: "Tata Consultancy Services Limited",
      tradingsymbol: "TCS-EQ",
      exchange: "NSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "SBIN",
      name: "SBIN",
      companyName: "State Bank of India",
      tradingsymbol: "SBIN-EQ",
      exchange: "NSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "HDFCBANK",
      name: "HDFCBANK",
      companyName: "HDFC Bank Limited",
      tradingsymbol: "HDFCBANK-EQ",
      exchange: "NSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "ICICIBANK",
      name: "ICICIBANK",
      companyName: "ICICI Bank Limited",
      tradingsymbol: "ICICIBANK-EQ",
      exchange: "NSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "INFY",
      name: "INFY",
      companyName: "Infosys Limited",
      tradingsymbol: "INFY-EQ",
      exchange: "NSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "LT",
      name: "LT",
      companyName: "Larsen & Toubro Limited",
      tradingsymbol: "LT-EQ",
      exchange: "NSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "AXISBANK",
      name: "AXISBANK",
      companyName: "Axis Bank Limited",
      tradingsymbol: "AXISBANK-EQ",
      exchange: "NSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "BHARTIARTL",
      name: "BHARTIARTL",
      companyName: "Bharti Airtel Limited",
      tradingsymbol: "BHARTIARTL-EQ",
      exchange: "NSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "TATAMOTORS",
      name: "TATAMOTORS",
      companyName: "Tata Motors Limited",
      tradingsymbol: "TATAMOTORS-EQ",
      exchange: "NSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "RELIANCE_BSE",
      name: "RELIANCE",
      companyName: "Reliance Industries Limited (BSE)",
      tradingsymbol: "RELIANCE",
      exchange: "BSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "TCS_BSE",
      name: "TCS",
      companyName: "Tata Consultancy Services Limited (BSE)",
      tradingsymbol: "TCS",
      exchange: "BSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "SBIN_BSE",
      name: "SBIN",
      companyName: "State Bank of India (BSE)",
      tradingsymbol: "SBIN",
      exchange: "BSE",
      type: "EQUITY",
      symboltoken: null
    },
    {
      key: "HDFCBANK_BSE",
      name: "HDFCBANK",
      companyName: "HDFC Bank Limited (BSE)",
      tradingsymbol: "HDFCBANK",
      exchange: "BSE",
      type: "EQUITY",
      symboltoken: null
    }
  ];

  function allInstruments() {
    const base =
      typeof MarketData !== "undefined"
        ? MarketData.listInstruments().map((inst) => ({
            ...inst,
            companyName: inst.companyName || inst.name,
            tradingsymbol: inst.tradingsymbol || inst.name,
            symboltoken: inst.symboltoken || null
          }))
        : [
            {
              key: "NIFTY50",
              name: "NIFTY 50",
              companyName: "Nifty 50 Benchmark Index",
              tradingsymbol: "NIFTY 50",
              exchange: "NSE",
              type: "INDEX",
              symboltoken: null
            },
            {
              key: "BANKNIFTY",
              name: "BANK NIFTY",
              companyName: "Nifty Bank Index",
              tradingsymbol: "BANK NIFTY",
              exchange: "NSE",
              type: "INDEX",
              symboltoken: null
            },
            {
              key: "SENSEX",
              name: "SENSEX",
              companyName: "BSE SENSEX Benchmark Index",
              tradingsymbol: "SENSEX",
              exchange: "BSE",
              type: "INDEX",
              symboltoken: null
            }
          ];

    return [...base, ...extraInstruments];
  }

  function validateSearchInput(query, filters = {}) {
    const raw = String(query ?? "");
    const trimmed = raw.trim();
    const exchange = String(filters.exchange || "ALL").trim().toUpperCase();
    const type = String(filters.type || filters.instrumentType || "ALL").trim().toUpperCase();

    if (!SUPPORTED_EXCHANGES.includes(exchange)) {
      return {
        valid: false,
        code: "INVALID_EXCHANGE_FILTER",
        message: `Unsupported exchange filter "${exchange}". Allowed: NSE, BSE, NFO, BFO.`
      };
    }

    if (!SUPPORTED_TYPES.includes(type)) {
      return {
        valid: false,
        code: "INVALID_INSTRUMENT_TYPE_FILTER",
        message: `Unsupported instrument type filter "${type}". Allowed: INDEX, EQUITY, FUTURES, OPTION.`
      };
    }

    if (trimmed.length > 80) {
      return {
        valid: false,
        code: "SEARCH_QUERY_TOO_LONG",
        message: "Search query must be 80 characters or fewer."
      };
    }

    if (trimmed && !/^[A-Za-z0-9\s\.\-\_\&\/]+$/.test(trimmed)) {
      return {
        valid: false,
        code: "INVALID_SEARCH_CHARACTERS",
        message: "Search query contains unsupported special characters."
      };
    }

    return {
      valid: true,
      code: "OK",
      query: trimmed,
      exchange,
      type
    };
  }

  function parseExpiryDate(rawExpiry) {
    const str = String(rawExpiry || "").trim();
    if (!str) return null;

    const directMs = Date.parse(str);
    if (Number.isFinite(directMs)) {
      return new Date(directMs).toISOString();
    }

    const m = str.toUpperCase().match(/^(\d{1,2})[\s\-]?([A-Z]{3})[\s\-]?(\d{2,4})$/);
    if (m) {
      const day = Number(m[1]);
      const month = MONTH_MAP[m[2]];
      let year = Number(m[3]);
      if (year < 100) year += 2000;

      if (month !== undefined && day >= 1 && day <= 31) {
        const dt = new Date(Date.UTC(year, month, day, 15, 30, 0));
        if (!Number.isNaN(dt.getTime())) {
          return dt.toISOString();
        }
      }
    }

    return null;
  }

  function inferInstrumentType(item = {}) {
    const explicit = String(item.type || item.instrumentType || "").trim().toUpperCase();
    if (["INDEX", "EQUITY", "FUTURES", "OPTION"].includes(explicit)) {
      return explicit;
    }

    const exchange = String(item.exchange || "").trim().toUpperCase();
    const symbol = String(item.tradingsymbol || item.key || item.name || "").trim().toUpperCase();
    const optType = String(item.optionType || "").trim().toUpperCase();

    if (["NFO", "BFO"].includes(exchange)) {
      if (optType === "CE" || optType === "PE" || symbol.endsWith("CE") || symbol.endsWith("PE")) {
        return "OPTION";
      }
      if (symbol.endsWith("FUT") || optType === "FUT" || optType === "FF") {
        return "FUTURES";
      }
      return "OPTION";
    }

    if (/^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY|BANKEX)/.test(symbol) && !symbol.endsWith("-EQ")) {
      return "INDEX";
    }

    return "EQUITY";
  }

  function validateContractSelection(item = {}) {
    if (!item || typeof item !== "object") {
      return {
        valid: false,
        code: "INVALID_INSTRUMENT",
        reasons: ["Instrument object is required."]
      };
    }

    const exchange = String(item.exchange || "").trim().toUpperCase();
    const instType = inferInstrumentType(item);
    const hasOptionFields =
      Boolean(item.optionType) ||
      (item.strikePrice !== null && item.strikePrice !== undefined);

    if (!["NFO", "BFO"].includes(exchange) && !hasOptionFields && instType !== "OPTION" && instType !== "FUTURES") {
      return {
        valid: true,
        code: "OK",
        instrumentType: instType,
        reasons: []
      };
    }

    const reasons = [];
    if (!["NFO", "BFO"].includes(exchange)) {
      reasons.push("F&O contract must belong to a derivatives exchange (NFO or BFO).");
    }

    if (instType === "FUTURES" && !item.optionType && (item.strikePrice === null || item.strikePrice === undefined)) {
      const expiry = String(item.expiry || "").trim();
      if (!expiry) {
        reasons.push("Futures contract expiry date is required.");
      } else if (!parseExpiryDate(expiry)) {
        reasons.push("Futures contract expiry is not a valid date.");
      }
      return {
        valid: reasons.length === 0,
        code: reasons.length === 0 ? "OK" : "INVALID_FUTURES_CONTRACT",
        instrumentType: "FUTURES",
        reasons
      };
    }

    const optionType = String(item.optionType || "").trim().toUpperCase();
    const strikePrice = Number(item.strikePrice);
    const expiry = String(item.expiry || "").trim();

    if (optionType !== "CE" && optionType !== "PE") {
      reasons.push("Option type must be CE or PE.");
    }

    if (!Number.isFinite(strikePrice) || strikePrice <= 0) {
      reasons.push("Option strike price must be a positive number.");
    }

    if (!expiry) {
      reasons.push("Option expiry date is required.");
    } else if (!parseExpiryDate(expiry)) {
      reasons.push("Option expiry is not a valid date.");
    }

    return {
      valid: reasons.length === 0,
      code: reasons.length === 0 ? "OK" : "INVALID_OPTION_CONTRACT",
      instrumentType: "OPTION",
      reasons
    };
  }

  function applyFilters(items = [], filters = {}) {
    const exFilter = String(filters.exchange || "ALL").trim().toUpperCase();
    const typeFilter = String(filters.type || filters.instrumentType || "ALL").trim().toUpperCase();
    const optFilter = String(filters.optionType || "ALL").trim().toUpperCase();

    return items.filter((item) => {
      if (!item) return false;
      const itemEx = String(item.exchange || "NSE").trim().toUpperCase();
      const itemType = inferInstrumentType(item);

      if (exFilter && exFilter !== "ALL" && itemEx !== exFilter) {
        return false;
      }

      if (typeFilter && typeFilter !== "ALL") {
        if (typeFilter === "FNO") {
          if (itemType !== "FUTURES" && itemType !== "OPTION") return false;
        } else if (itemType !== typeFilter) {
          return false;
        }
      }

      if (optFilter && optFilter !== "ALL" && (optFilter === "CE" || optFilter === "PE")) {
        if (String(item.optionType || "").toUpperCase() !== optFilter) {
          return false;
        }
      }

      return true;
    });
  }

  function search(query, filters = {}) {
    const q = String(query || "").trim().toUpperCase();
    const catalog = applyFilters(allInstruments(), filters);

    if (!q) {
      return catalog.slice(0, 12);
    }

    return catalog
      .filter((item) => {
        const key = String(item.key || "").toUpperCase();
        const name = String(item.name || "").toUpperCase();
        const tsym = String(item.tradingsymbol || "").toUpperCase();
        const company = String(item.companyName || "").toUpperCase();
        const exch = String(item.exchange || "").toUpperCase();
        const token = String(item.symboltoken || "").toUpperCase();

        return (
          key.includes(q) ||
          name.includes(q) ||
          tsym.includes(q) ||
          company.includes(q) ||
          exch.includes(q) ||
          (token && token === q)
        );
      })
      .sort((a, b) => {
        const aExact =
          String(a.key || "").toUpperCase() === q ||
          String(a.name || "").toUpperCase() === q ||
          String(a.tradingsymbol || "").toUpperCase() === q
            ? 0
            : 1;
        const bExact =
          String(b.key || "").toUpperCase() === q ||
          String(b.name || "").toUpperCase() === q ||
          String(b.tradingsymbol || "").toUpperCase() === q
            ? 0
            : 1;

        if (aExact !== bExact) return aExact - bExact;

        const aIndex = a.type === "INDEX" ? 0 : 1;
        const bIndex = b.type === "INDEX" ? 0 : 1;

        return aIndex - bIndex;
      })
      .slice(0, 15);
  }

  function mapBrokerResultItem(item, fallbackExchange = "NSE") {
    const exchange = String(item.exchange || fallbackExchange).toUpperCase();
    const symbol = String(item.tradingsymbol || item.symboltoken || "").trim().toUpperCase();
    const optType = item.optionType ? String(item.optionType).trim().toUpperCase() : null;

    let type = item.instrumentType || item.type || null;
    if (!type) {
      if (["NFO", "BFO"].includes(exchange) || Boolean(optType)) {
        if (!optType && symbol.endsWith("FUT")) {
          type = "FUTURES";
        } else {
          type = "OPTION";
        }
      } else if (/^(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY|BANKEX)/.test(symbol) && !symbol.endsWith("-EQ")) {
        type = "INDEX";
      } else {
        type = "EQUITY";
      }
    }

    return {
      key: item.tradingsymbol || item.symboltoken,
      name: item.name || item.tradingsymbol || item.symboltoken,
      companyName: item.companyName || item.name || item.tradingsymbol || null,
      tradingsymbol: item.tradingsymbol || null,
      exchange,
      type: String(type).toUpperCase(),
      instrumentType: String(type).toUpperCase(),
      optionType: optType,
      strikePrice: item.strikePrice ?? null,
      expiry: item.expiry || null,
      lotSize: item.lotSize ?? null,
      symboltoken: item.symboltoken || null,
      brokerInstrument: true
    };
  }

  function resolveExactOrAmbiguous(results = [], query = "", filters = {}) {
    const filtered = applyFilters(results, filters);
    const q = String(query || "").trim().toUpperCase();

    if (!filtered.length) {
      return {
        status: "EMPTY",
        exactMatch: null,
        candidates: [],
        ambiguous: false
      };
    }

    if (filtered.length === 1) {
      return {
        status: "EXACT",
        exactMatch: filtered[0],
        candidates: filtered,
        ambiguous: false
      };
    }

    if (q) {
      const exactMatches = filtered.filter((item) => {
        const tsym = String(item.tradingsymbol || "").toUpperCase();
        const key = String(item.key || "").toUpperCase();
        const name = String(item.name || "").toUpperCase();
        const token = String(item.symboltoken || "").toUpperCase();
        return tsym === q || key === q || name === q || (token && token === q);
      });

      if (exactMatches.length === 1) {
        return {
          status: "EXACT",
          exactMatch: exactMatches[0],
          candidates: filtered,
          ambiguous: filtered.length > 1
        };
      }
    }

    return {
      status: "AMBIGUOUS",
      exactMatch: null,
      candidates: filtered,
      ambiguous: true
    };
  }

  async function searchWithDiagnostics(query, options = {}) {
    const exchangeFilter = String(options.exchange || "ALL").trim().toUpperCase();
    const typeFilter = String(options.type || options.instrumentType || "ALL").trim().toUpperCase();
    const optionTypeFilter = String(options.optionType || "ALL").trim().toUpperCase();
    const apiClient =
      options.apiClient || (typeof MarketAPI !== "undefined" ? MarketAPI : null);

    const validation = validateSearchInput(query, {
      exchange: exchangeFilter,
      type: typeFilter
    });

    if (!validation.valid) {
      return {
        ok: false,
        code: validation.code,
        message: validation.message,
        query: String(query || "").trim(),
        exchange: exchangeFilter,
        type: typeFilter,
        source: "VALIDATION_ERROR",
        results: [],
        resolution: { status: "EMPTY", exactMatch: null, candidates: [], ambiguous: false }
      };
    }

    const cleanQuery = validation.query;
    const localResults = search(cleanQuery, {
      exchange: exchangeFilter,
      type: typeFilter,
      optionType: optionTypeFilter
    });

    if (!cleanQuery) {
      const res = resolveExactOrAmbiguous(localResults, cleanQuery, {
        exchange: exchangeFilter,
        type: typeFilter,
        optionType: optionTypeFilter
      });
      return {
        ok: true,
        code: "OK",
        source: "REFERENCE_CATALOG",
        provider: "YASHWIN_CATALOG",
        query: cleanQuery,
        exchange: exchangeFilter,
        type: typeFilter,
        results: localResults,
        resolution: res,
        apiError: null
      };
    }

    // Determine target exchange for /api/instruments/search
    let apiExchange = exchangeFilter !== "ALL" ? exchangeFilter : "NSE";
    if (exchangeFilter === "ALL") {
      if (typeFilter === "FUTURES" || typeFilter === "OPTION") {
        apiExchange = "NFO";
      } else if (localResults.length && localResults[0].exchange) {
        apiExchange = localResults[0].exchange;
      }
    }

    if (!apiClient || typeof apiClient.searchInstruments !== "function") {
      const res = resolveExactOrAmbiguous(localResults, cleanQuery, {
        exchange: exchangeFilter,
        type: typeFilter,
        optionType: optionTypeFilter
      });
      return {
        ok: true,
        code: "OK",
        source: "REFERENCE_CATALOG",
        provider: "YASHWIN_CATALOG",
        query: cleanQuery,
        exchange: apiExchange,
        type: typeFilter,
        results: localResults,
        resolution: res,
        apiError: null
      };
    }

    try {
      const response = await apiClient.searchInstruments(apiExchange, cleanQuery);

      if (response && response.ok === true && Array.isArray(response.results)) {
        const mapped = response.results
          .filter((item) => item && (item.tradingsymbol || item.symboltoken))
          .map((item) => mapBrokerResultItem(item, apiExchange));

        const filteredBroker = applyFilters(mapped, {
          exchange: exchangeFilter,
          type: typeFilter,
          optionType: optionTypeFilter
        });

        const finalResults = filteredBroker.length > 0 ? filteredBroker.slice(0, 25) : localResults;
        const resolution = resolveExactOrAmbiguous(finalResults, cleanQuery, {
          exchange: exchangeFilter,
          type: typeFilter,
          optionType: optionTypeFilter
        });

        return {
          ok: true,
          code: "OK",
          source: filteredBroker.length > 0 ? "ANGEL_ONE_API" : "REFERENCE_CATALOG",
          provider: response.provider || "ANGEL_ONE",
          query: cleanQuery,
          exchange: response.exchange || apiExchange,
          type: typeFilter,
          results: finalResults,
          brokerMatchCount: filteredBroker.length,
          resolution,
          apiError: null
        };
      }

      const apiErrorCode = response?.code || "SEARCH_API_UNAVAILABLE";
      const apiErrorMessage =
        response?.message || "Angel One search session is not connected; showing verified reference instruments.";
      const resolution = resolveExactOrAmbiguous(localResults, cleanQuery, {
        exchange: exchangeFilter,
        type: typeFilter,
        optionType: optionTypeFilter
      });

      return {
        ok: true,
        code: apiErrorCode,
        source: "REFERENCE_CATALOG_FALLBACK",
        provider: "YASHWIN_CATALOG",
        query: cleanQuery,
        exchange: apiExchange,
        type: typeFilter,
        results: localResults,
        resolution,
        apiError: {
          code: apiErrorCode,
          message: apiErrorMessage
        }
      };
    } catch (error) {
      const resolution = resolveExactOrAmbiguous(localResults, cleanQuery, {
        exchange: exchangeFilter,
        type: typeFilter,
        optionType: optionTypeFilter
      });
      return {
        ok: false,
        code: error?.code || "NETWORK_FAILURE",
        message: error?.message || "Network error while searching instruments.",
        source: "REFERENCE_CATALOG_FALLBACK",
        query: cleanQuery,
        exchange: apiExchange,
        type: typeFilter,
        results: localResults,
        resolution,
        apiError: {
          code: error?.code || "NETWORK_FAILURE",
          message: error?.message || "Network error while searching instruments."
        }
      };
    }
  }

  async function searchAsync(query, exchange = "NSE", apiClient) {
    const localResults = search(query);
    const api =
      apiClient ||
      (typeof MarketAPI !== "undefined" ? MarketAPI : null);

    if (!api || typeof api.searchInstruments !== "function") {
      return localResults;
    }

    const normalizedQuery = String(query || "").trim();
    const normalizedExchange = String(exchange || "NSE").trim().toUpperCase();

    if (!normalizedQuery || !normalizedExchange) {
      return localResults;
    }

    try {
      const response = await api.searchInstruments(
        normalizedExchange,
        normalizedQuery
      );

      if (!response?.ok || !Array.isArray(response.results)) {
        return localResults;
      }

      const brokerResults = response.results
        .filter((item) => item && (item.tradingsymbol || item.symboltoken))
        .map((item) => mapBrokerResultItem(item, normalizedExchange));

      return brokerResults.length ? brokerResults.slice(0, 10) : localResults;
    } catch (_) {
      return localResults;
    }
  }

  function formatResultMeta(item = {}) {
    const instType = inferInstrumentType(item);
    const parts = [item.exchange || "NSE", instType];

    if (instType === "OPTION") {
      const optPart = [
        item.optionType || "",
        item.strikePrice ? `Strike ${item.strikePrice}` : "",
        item.expiry ? `Exp ${item.expiry}` : ""
      ]
        .filter(Boolean)
        .join(" ");
      if (optPart) parts.push(optPart);
    } else if (instType === "FUTURES" && item.expiry) {
      parts.push(`Exp ${item.expiry}`);
    }

    if (item.lotSize) {
      parts.push(`Lot ${item.lotSize}`);
    }

    const tokenLabel = item.symboltoken
      ? `Token: ${item.symboltoken}`
      : "Token: UNRESOLVED (Requires Broker Session)";
    parts.push(tokenLabel);

    return parts.join(" • ");
  }

  function escapeHtml(raw) {
    return String(raw ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function render(results, container, onSelect, options = {}) {
    if (!container) return;

    container.innerHTML = "";

    if (!Array.isArray(results) || !results.length) {
      const emptyMsg =
        options.emptyMessage ||
        "Try another stock, index, futures, or option symbol, or adjust your exchange/type filters.";
      container.innerHTML = `<div class="empty-state"><strong>No matching instrument found</strong><span>${escapeHtml(emptyMsg)}</span></div>`;
      return;
    }

    const watchlistSet = new Set(
      Array.isArray(options.watchlistKeys)
        ? options.watchlistKeys.map((k) => String(k).toUpperCase())
        : []
    );

    results.forEach((item) => {
      const row = document.createElement("div");
      row.className = "search-result-row";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result-item";

      const metaLabel = formatResultMeta(item);
      const companySubtitle =
        item.companyName && item.companyName !== item.name
          ? ` — ${item.companyName}`
          : "";
      const rightBadge = item.symboltoken
        ? `${item.tradingsymbol || item.key} • #${item.symboltoken}`
        : `${item.tradingsymbol || item.key}`;

      button.innerHTML = `
        <span class="search-result-main">
          <strong>${escapeHtml(item.name)}${escapeHtml(companySubtitle)}</strong>
          <small>${escapeHtml(metaLabel)}</small>
        </span>
        <span class="search-result-type tabular-nums">${escapeHtml(rightBadge)}</span>
      `;

      button.addEventListener("click", () => {
        if (typeof onSelect === "function") {
          onSelect(item);
        }
      });

      row.appendChild(button);

      if (typeof options.onToggleWatchlist === "function") {
        const itemKeyUpper = `${String(item.exchange || "NSE").toUpperCase()}:${String(item.key || item.tradingsymbol || item.name).toUpperCase()}`;
        const inWatchlist = watchlistSet.has(itemKeyUpper) || watchlistSet.has(String(item.key || "").toUpperCase());

        const wlBtn = document.createElement("button");
        wlBtn.type = "button";
        wlBtn.className = `search-watchlist-btn ${inWatchlist ? "active" : ""}`;
        wlBtn.title = inWatchlist ? "Remove from Watchlist" : "Add to Watchlist";
        wlBtn.textContent = inWatchlist ? "★ Saved" : "☆ Watch";
        wlBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          options.onToggleWatchlist(item, inWatchlist);
        });
        row.appendChild(wlBtn);
      }

      container.appendChild(row);
    });
  }

  return {
    SUPPORTED_EXCHANGES,
    SUPPORTED_TYPES,
    allInstruments,
    validateSearchInput,
    parseExpiryDate,
    inferInstrumentType,
    validateContractSelection,
    applyFilters,
    search,
    searchAsync,
    searchWithDiagnostics,
    resolveExactOrAmbiguous,
    mapBrokerResultItem,
    formatResultMeta,
    render
  };
})();

if (typeof window !== "undefined") {
  window.MarketSearch = MarketSearch;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = MarketSearch;
}
