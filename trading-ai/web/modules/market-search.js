/*
 * YASHWIN AI Trading Assistant
 * Market Search Layer
 *
 * No fake prices.
 * No broker orders.
 * No trading decision.
 */

const MarketSearch = (() => {

  const extraInstruments = [
    {
      key: "RELIANCE",
      name: "RELIANCE",
      exchange: "NSE",
      type: "EQUITY"
    },
    {
      key: "TCS",
      name: "TCS",
      exchange: "NSE",
      type: "EQUITY"
    },
    {
      key: "SBIN",
      name: "SBIN",
      exchange: "NSE",
      type: "EQUITY"
    },
    {
      key: "HDFCBANK",
      name: "HDFCBANK",
      exchange: "NSE",
      type: "EQUITY"
    },
    {
      key: "ICICIBANK",
      name: "ICICIBANK",
      exchange: "NSE",
      type: "EQUITY"
    },
    {
      key: "INFY",
      name: "INFY",
      exchange: "NSE",
      type: "EQUITY"
    }
  ];

  function allInstruments() {
    const base =
      typeof MarketData !== "undefined"
        ? MarketData.listInstruments()
        : [];

    return [...base, ...extraInstruments];
  }

  function search(query) {
    const q = String(query || "").trim().toUpperCase();

    if (!q) {
      return allInstruments().slice(0, 10);
    }

    return allInstruments()
      .filter(item =>
        item.key.includes(q) ||
        item.name.includes(q) ||
        item.exchange.includes(q)
      )
      .sort((a, b) => {
        const aExact = a.key === q || a.name === q ? 0 : 1;
        const bExact = b.key === q || b.name === q ? 0 : 1;

        if (aExact !== bExact) return aExact - bExact;

        const aIndex = /^(NIFTY50|BANKNIFTY|SENSEX)$/.test(a.key) ? 0 : 1;
        const bIndex = /^(NIFTY50|BANKNIFTY|SENSEX)$/.test(b.key) ? 0 : 1;

        return aIndex - bIndex;
      })
      .slice(0, 10);
  }

  async function searchAsync(query, exchange) {
    const localResults = search(query);

    if (
      typeof MarketAPI === "undefined" ||
      typeof MarketAPI.searchInstruments !== "function"
    ) {
      return localResults;
    }

    const normalizedQuery = String(query || "").trim();
    const normalizedExchange = String(exchange || "").trim().toUpperCase();

    if (!normalizedQuery || !normalizedExchange) {
      return localResults;
    }

    try {
      const response = await MarketAPI.searchInstruments(
        normalizedExchange,
        normalizedQuery
      );

      const brokerResults = Array.isArray(response?.results)
        ? response.results.map(item => ({
            key: item.tradingsymbol || item.symboltoken,
            name: item.tradingsymbol || item.symboltoken,
            exchange: item.exchange || normalizedExchange,
            type: ["NFO", "BFO"].includes(
              String(item.exchange || normalizedExchange).toUpperCase()
            )
              ? "OPTION"
              : "EQUITY",
            optionType: item.optionType || null,
            strikePrice: item.strikePrice ?? null,
            expiry: item.expiry || null,
            symboltoken: item.symboltoken || null,
            brokerInstrument: true
          }))
        : [];

      return brokerResults.length ? brokerResults.slice(0, 10) : localResults;
    } catch (_) {
      return localResults;
    }
  }

  function render(results, container, onSelect) {
    if (!container) return;

    container.innerHTML = "";

    if (!results.length) {
      container.innerHTML =
        '<div class="empty-state"><strong>No instrument found</strong><span>Try another stock, index or symbol.</span></div>';
      return;
    }

    results.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result-item";

      button.innerHTML = `
        <span class="search-result-main">
          <strong>${item.name}</strong>
          <small>${item.exchange} • ${item.type}</small>
        </span>
        <span class="search-result-type">${item.key}</span>
      `;

      button.addEventListener("click", () => onSelect(item));
      container.appendChild(button);
    });
  }

  return {
    allInstruments,
    search,
    searchAsync,
    render
  };

})();
