/*
 * YASHWIN AI Trading Assistant
 * Phase F & Task 7 — Complete Market Intelligence Engine
 * (Indian Market News, Global Market News, Company News, Economic Calendar, Global Indices & Backed Sentiment)
 *
 * Strictly enforces:
 * - Never pretends external news/global/macro data exists when not retrieved.
 * - Returns status: "DATA_UNAVAILABLE" when no external intelligence provider is configured.
 * - Preserves source/provider, headline/title, publication timestamp, URL, related symbol/company,
 *   and data retrieval timestamp for every item.
 * - Deduplicates news items and clearly marks stale, missing, malformed, or unavailable data.
 * - Sentiment is exposed ONLY when backed by a genuine source.
 * - Market Intelligence is supporting context only and NEVER overrides price action, technical indicators,
 *   AIDecisionContract, AISafetyGate, RiskEngine, or Emergency Stop.
 */

const MarketIntelligence = (() => {
  let configuredProvider = null;

  const VALID_FILTER_CATEGORIES = [
    "ALL",
    "INDIAN_MARKET",
    "GLOBAL_MARKET",
    "COMPANY_NEWS",
    "ECONOMIC_EVENTS",
    "GLOBAL_INDICES"
  ];

  function registerProvider(provider) {
    if (provider && typeof provider.fetchIntelligence === "function") {
      configuredProvider = provider;
      return true;
    }
    configuredProvider = null;
    return false;
  }

  function clearProvider() {
    configuredProvider = null;
  }

  function hasConfiguredProvider() {
    return Boolean(configuredProvider && typeof configuredProvider.fetchIntelligence === "function");
  }

  function emptyIntelligence(market = "NSE", reason = "External news/global intelligence provider is not configured.") {
    const retrievalIso = new Date().toISOString();
    return {
      status: "DATA_UNAVAILABLE",
      available: false,
      timestamp: retrievalIso,
      retrievalTimestamp: retrievalIso,
      source: "UNCONFIGURED",
      provider: "UNCONFIGURED",
      market: String(market || "NSE").toUpperCase(),
      symbol: null,
      headlines: [],
      indianMarketNews: [],
      globalMarketNews: [],
      companyNews: [],
      economicEvents: [],
      globalIndices: [],
      sentiment: "NEUTRAL",
      sentimentScore: null,
      sentimentBacked: {
        available: false,
        status: "UNAVAILABLE",
        label: "UNAVAILABLE",
        score: null,
        source: null,
        provider: null,
        publicationTimestamp: null,
        retrievalTimestamp: retrievalIso,
        reason
      },
      macroFactors: [],
      globalFactors: [],
      sectorFactors: [],
      optionsContext: null,
      risks: [reason],
      confidence: 0,
      freshness: "DATA_UNAVAILABLE",
      diagnostics: {
        duplicatesRemoved: 0,
        malformedRejected: 0,
        staleCount: 0,
        freshCount: 0,
        errors: [],
        rateLimited: false,
        message: reason
      }
    };
  }

  function normalizeHeadlineKey(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      parsed.hash = "";
      return parsed.toString();
    } catch (_) {
      return null;
    }
  }

  function validateNewsItem(item, options = {}) {
    const nowMs = Number(options.nowMs) || Date.now();
    const maxAgeMs = Number(options.maxAgeMs) || 24 * 60 * 60 * 1000;
    const retrievalIso = options.retrievalTimestamp || new Date(nowMs).toISOString();
    const defaultSource = String(options.defaultSource || "VERIFIED_FEED").trim();

    if (typeof item === "string") {
      const text = item.trim();
      if (!text) return { valid: false, status: "MALFORMED" };
      const pubIso = options.defaultTimestamp || retrievalIso;
      const pubMs = Date.parse(pubIso);
      const isStale = !Number.isFinite(pubMs) || nowMs - pubMs > maxAgeMs;
      return {
        valid: true,
        itemId: `NWS-${normalizeHeadlineKey(text).slice(0, 24)}`,
        category: options.defaultCategory || "INDIAN_MARKET",
        source: defaultSource,
        provider: defaultSource.toUpperCase(),
        headline: text,
        title: text,
        summary: null,
        publicationTimestamp: Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : null,
        retrievalTimestamp: retrievalIso,
        url: null,
        relatedSymbol: options.defaultSymbol || null,
        companyName: null,
        sentiment: null,
        sentimentScore: null,
        freshness: !Number.isFinite(pubMs) ? "MISSING_TIMESTAMP" : isStale ? "STALE" : "FRESH",
        isStale,
        status: isStale ? "STALE" : "VALID"
      };
    }

    if (!item || typeof item !== "object") {
      return { valid: false, status: "MALFORMED" };
    }

    const headline = String(item.headline || item.title || "").trim();
    const source = String(item.source || item.provider || defaultSource).trim();
    if (!headline || !source) {
      return { valid: false, status: "MALFORMED" };
    }

    const rawPub =
      item.publicationTimestamp ?? item.publishedAt ?? item.datetime ?? item.timestamp ?? options.defaultTimestamp;
    const pubMs =
      typeof rawPub === "number"
        ? rawPub < 1e11
          ? rawPub * 1000
          : rawPub
        : rawPub
          ? Date.parse(String(rawPub))
          : NaN;

    const isStale = !Number.isFinite(pubMs) || nowMs - pubMs > maxAgeMs || pubMs > nowMs + 60000;
    const freshness = !Number.isFinite(pubMs)
      ? "MISSING_TIMESTAMP"
      : pubMs > nowMs + 60000
        ? "INVALID_FUTURE_TIMESTAMP"
        : isStale
          ? "STALE"
          : "FRESH";

    const sentimentScore =
      item.sentimentScore !== undefined && item.sentimentScore !== null && Number.isFinite(Number(item.sentimentScore))
        ? Math.max(-100, Math.min(100, Number(item.sentimentScore)))
        : null;

    const rawSent = item.sentiment ? String(item.sentiment).trim().toUpperCase() : null;
    const sentiment =
      rawSent && ["BULLISH", "BEARISH", "NEUTRAL", "MIXED"].includes(rawSent)
        ? rawSent
        : sentimentScore !== null
          ? sentimentScore >= 20
            ? "BULLISH"
            : sentimentScore <= -20
              ? "BEARISH"
              : "NEUTRAL"
          : null;

    return {
      valid: true,
      itemId: item.itemId || `NWS-${normalizeHeadlineKey(headline).slice(0, 24)}`,
      category: String(item.category || options.defaultCategory || "INDIAN_MARKET").toUpperCase(),
      source,
      provider: String(item.provider || source).toUpperCase(),
      headline,
      title: headline,
      summary: item.summary ? String(item.summary).trim() : null,
      publicationTimestamp: Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : null,
      retrievalTimestamp: item.retrievalTimestamp || retrievalIso,
      url: normalizeUrl(item.url || item.link),
      relatedSymbol: item.relatedSymbol ? String(item.relatedSymbol).trim().toUpperCase() : options.defaultSymbol || null,
      companyName: item.companyName || null,
      sentiment,
      sentimentScore,
      freshness,
      isStale,
      status: isStale ? "STALE" : "VALID"
    };
  }

  function deduplicateItems(rawItems = [], options = {}) {
    const seenUrls = new Set();
    const seenHeadlines = new Set();
    const items = [];
    let duplicatesRemoved = 0;
    let malformedRejected = 0;

    for (const raw of rawItems) {
      const norm = validateNewsItem(raw, options);
      if (!norm.valid) {
        malformedRejected += 1;
        continue;
      }
      const uKey = norm.url ? norm.url.toLowerCase() : null;
      const hKey = normalizeHeadlineKey(norm.headline);

      if ((uKey && seenUrls.has(uKey)) || (hKey && seenHeadlines.has(hKey))) {
        duplicatesRemoved += 1;
        continue;
      }
      if (uKey) seenUrls.add(uKey);
      if (hKey) seenHeadlines.add(hKey);
      items.push(norm);
    }

    return { items, duplicatesRemoved, malformedRejected };
  }

  function normalize(raw = {}, options = {}) {
    const market = String(raw?.market || options.market || "NSE").toUpperCase();
    if (!raw || typeof raw !== "object" || (raw.available !== true && raw.status !== "AVAILABLE" && raw.status !== "STALE_DATA")) {
      return emptyIntelligence(
        market,
        raw?.diagnostics?.message || raw?.reason || "External market intelligence was not retrieved."
      );
    }

    const nowMs = Number(options.nowMs) || Date.now();
    const maxAgeMs = Number(options.maxAgeMs) || 15 * 60 * 1000; // 15 min default for normalize
    const tsRaw = raw.timestamp || raw.retrievalTimestamp;
    const tsMs = tsRaw ? Date.parse(tsRaw) : NaN;
    const retrievalIso = Number.isFinite(tsMs) ? new Date(tsMs).toISOString() : new Date(nowMs).toISOString();

    const isFresh = Number.isFinite(tsMs) && nowMs - tsMs <= maxAgeMs && tsMs <= nowMs + 5000;
    const freshness = !Number.isFinite(tsMs)
      ? "INVALID_TIMESTAMP"
      : isFresh
        ? "FRESH"
        : "STALE";

    const source = String(raw.source || raw.provider || "VERIFIED_FEED").trim();

    const combinedRawNews = [
      ...(Array.isArray(raw.indianMarketNews) ? raw.indianMarketNews : []),
      ...(Array.isArray(raw.globalMarketNews) ? raw.globalMarketNews : []),
      ...(Array.isArray(raw.companyNews) ? raw.companyNews : []),
      ...(Array.isArray(raw.headlines) ? raw.headlines : [])
    ];

    const deduped = deduplicateItems(combinedRawNews, {
      nowMs,
      maxAgeMs: Number(options.newsMaxAgeMs) || 24 * 60 * 60 * 1000,
      retrievalTimestamp: retrievalIso,
      defaultSource: source,
      defaultTimestamp: Number.isFinite(tsMs) ? new Date(tsMs).toISOString() : null,
      defaultSymbol: raw.symbol || options.symbol || null
    });

    const headlines = deduped.items.map((h) => h.headline);
    const indianMarketNews = deduped.items.filter((i) => i.category === "INDIAN_MARKET");
    const globalMarketNews = deduped.items.filter((i) => i.category === "GLOBAL_MARKET");
    const companyNews = deduped.items.filter((i) => i.category === "COMPANY_NEWS");

    const economicEvents = Array.isArray(raw.economicEvents) ? raw.economicEvents : [];
    const globalIndices = Array.isArray(raw.globalIndices) ? raw.globalIndices : [];

    // Handle both legacy string sentiment and Task 7 structured sentiment object
    let sentiment = "NEUTRAL";
    let sentimentScore = null;
    let sentimentBacked = {
      available: false,
      status: "UNAVAILABLE",
      label: "UNAVAILABLE",
      score: null,
      source: null,
      provider: null,
      publicationTimestamp: null,
      retrievalTimestamp: retrievalIso,
      reason: "Sentiment not backed by a verified source."
    };

    if (raw.sentiment && typeof raw.sentiment === "object") {
      sentimentBacked = {
        available: Boolean(raw.sentiment.available && isFresh),
        status: raw.sentiment.available && isFresh ? "AVAILABLE" : "UNAVAILABLE",
        label: String(raw.sentiment.label || "UNAVAILABLE").toUpperCase(),
        score:
          raw.sentiment.available && isFresh && Number.isFinite(Number(raw.sentiment.score))
            ? Number(raw.sentiment.score)
            : null,
        source: raw.sentiment.source || null,
        provider: raw.sentiment.provider || null,
        publicationTimestamp: raw.sentiment.publicationTimestamp || null,
        retrievalTimestamp: raw.sentiment.retrievalTimestamp || retrievalIso,
        reason: raw.sentiment.reason || null
      };
      if (sentimentBacked.available) {
        sentiment = ["BULLISH", "BEARISH", "NEUTRAL", "MIXED"].includes(sentimentBacked.label)
          ? sentimentBacked.label
          : "NEUTRAL";
        sentimentScore = sentimentBacked.score;
      }
    } else {
      const sentimentRaw = String(raw.sentiment || "NEUTRAL").trim().toUpperCase();
      sentiment = ["BULLISH", "BEARISH", "NEUTRAL", "MIXED"].includes(sentimentRaw)
        ? sentimentRaw
        : "NEUTRAL";

      const computedScore =
        raw.sentimentScore !== undefined && raw.sentimentScore !== null && Number.isFinite(Number(raw.sentimentScore))
          ? Math.max(-100, Math.min(100, Number(raw.sentimentScore)))
          : sentiment === "BULLISH"
            ? 50
            : sentiment === "BEARISH"
              ? -50
              : 0;

      sentimentScore = isFresh ? computedScore : null;
      sentimentBacked = {
        available: isFresh && (raw.sentiment !== undefined || raw.sentimentScore !== undefined),
        status: isFresh ? "AVAILABLE" : "STALE",
        label: sentiment,
        score: sentimentScore,
        source,
        provider: source.toUpperCase(),
        publicationTimestamp: retrievalIso,
        retrievalTimestamp: retrievalIso,
        reason: isFresh ? `Backed by ${source}` : "Sentiment timestamp is stale."
      };
    }

    return {
      status: isFresh ? "AVAILABLE" : "STALE_DATA",
      available: isFresh,
      timestamp: retrievalIso,
      retrievalTimestamp: retrievalIso,
      source,
      provider: String(raw.provider || source).toUpperCase(),
      market,
      symbol: raw.symbol || options.symbol || null,
      headlines,
      indianMarketNews,
      globalMarketNews,
      companyNews,
      economicEvents,
      globalIndices,
      sentiment,
      sentimentScore,
      sentimentBacked,
      macroFactors: Array.isArray(raw.macroFactors) ? raw.macroFactors.map(String) : [],
      globalFactors: Array.isArray(raw.globalFactors) ? raw.globalFactors.map(String) : [],
      sectorFactors: Array.isArray(raw.sectorFactors) ? raw.sectorFactors.map(String) : [],
      optionsContext: raw.optionsContext && typeof raw.optionsContext === "object" ? raw.optionsContext : null,
      risks: Array.isArray(raw.risks) ? raw.risks.map(String) : [],
      confidence: isFresh
        ? Math.max(0, Math.min(100, Number(raw.confidence ?? Math.abs(sentimentScore || 0)) || 0))
        : 0,
      freshness,
      diagnostics: raw.diagnostics || {
        duplicatesRemoved: deduped.duplicatesRemoved,
        malformedRejected: deduped.malformedRejected,
        staleCount: deduped.items.filter((i) => i.isStale).length,
        freshCount: deduped.items.filter((i) => !i.isStale).length,
        errors: [],
        rateLimited: false,
        message: isFresh ? "Market intelligence normalized." : "Market intelligence is stale."
      }
    };
  }

  async function getIntelligence(query = {}) {
    const market = query.market || query.exchange || "NSE";
    if (!configuredProvider) {
      return emptyIntelligence(market);
    }

    try {
      const raw = await configuredProvider.fetchIntelligence(query);
      return normalize(raw, { market, symbol: query.symbol });
    } catch (error) {
      return emptyIntelligence(market, error?.message || "Failed to fetch market intelligence.");
    }
  }

  function buildIntelligenceViewModel(serverPayload = {}, uiState = {}) {
    const activeFilter = VALID_FILTER_CATEGORIES.includes(String(uiState.category || "ALL").toUpperCase())
      ? String(uiState.category || "ALL").toUpperCase()
      : "ALL";
    const selectedSymbol = String(
      uiState.symbol || serverPayload?.symbol || "NIFTY 50"
    ).trim().toUpperCase();
    const selectedExchange = String(
      uiState.exchange || serverPayload?.market || "NSE"
    ).trim().toUpperCase();

    const status = String(serverPayload?.status || "DATA_UNAVAILABLE").toUpperCase();
    const available = Boolean(serverPayload?.available === true && status === "AVAILABLE");
    const provider = String(serverPayload?.provider || serverPayload?.source || "UNCONFIGURED");
    const retrievalTimestamp = serverPayload?.retrievalTimestamp || serverPayload?.timestamp || null;

    const indianMarketNews = Array.isArray(serverPayload?.indianMarketNews)
      ? serverPayload.indianMarketNews
      : [];
    const globalMarketNews = Array.isArray(serverPayload?.globalMarketNews)
      ? serverPayload.globalMarketNews
      : [];
    const companyNews = Array.isArray(serverPayload?.companyNews)
      ? serverPayload.companyNews
      : [];
    const economicEvents = Array.isArray(serverPayload?.economicEvents)
      ? serverPayload.economicEvents
      : [];
    const globalIndices = Array.isArray(serverPayload?.globalIndices)
      ? serverPayload.globalIndices
      : [];

    const allNews = [...indianMarketNews, ...globalMarketNews, ...companyNews];
    let filteredNews = allNews;
    if (activeFilter === "INDIAN_MARKET") filteredNews = indianMarketNews;
    else if (activeFilter === "GLOBAL_MARKET") filteredNews = globalMarketNews;
    else if (activeFilter === "COMPANY_NEWS") filteredNews = companyNews;

    const sentimentObj =
      serverPayload?.sentiment && typeof serverPayload.sentiment === "object"
        ? serverPayload.sentiment
        : serverPayload?.sentimentBacked && typeof serverPayload.sentimentBacked === "object"
          ? serverPayload.sentimentBacked
          : {
              available: false,
              status: "UNAVAILABLE",
              label: "UNAVAILABLE",
              score: null,
              source: null,
              reason: "Market sentiment requires a verified provider source."
            };

    return {
      status,
      available,
      loading: Boolean(uiState.loading),
      error: uiState.error || (status === "PROVIDER_ERROR" || status === "RATE_LIMITED" ? serverPayload?.diagnostics?.message : null),
      provider,
      configuredProviders: Array.isArray(serverPayload?.configuredProviders) ? serverPayload.configuredProviders : [],
      retrievalTimestamp,
      selectedSymbol,
      selectedExchange,
      activeFilter,
      counts: {
        indianNews: indianMarketNews.length,
        globalNews: globalMarketNews.length,
        companyNews: companyNews.length,
        economicEvents: economicEvents.length,
        globalIndices: globalIndices.length,
        totalNews: allNews.length
      },
      indianMarketNews,
      globalMarketNews,
      companyNews,
      filteredNews,
      economicEvents,
      globalIndices,
      sentiment: {
        available: Boolean(sentimentObj.available),
        status: String(sentimentObj.status || "UNAVAILABLE"),
        label: sentimentObj.available ? String(sentimentObj.label || "NEUTRAL") : "UNAVAILABLE",
        score: sentimentObj.available && Number.isFinite(Number(sentimentObj.score)) ? Number(sentimentObj.score) : null,
        scoreFormatted:
          sentimentObj.available && Number.isFinite(Number(sentimentObj.score))
            ? `${Number(sentimentObj.score) > 0 ? "+" : ""}${Number(sentimentObj.score)}`
            : "-- (UNVERIFIED)",
        source: sentimentObj.source || "UNCONFIGURED",
        publicationTimestamp: sentimentObj.publicationTimestamp || null,
        retrievalTimestamp: sentimentObj.retrievalTimestamp || retrievalTimestamp,
        reason: sentimentObj.reason || "No verified sentiment source configured."
      },
      diagnostics: serverPayload?.diagnostics || {
        duplicatesRemoved: 0,
        malformedRejected: 0,
        staleCount: 0,
        freshCount: 0,
        errors: [],
        rateLimited: false,
        message: "External market intelligence provider is not configured."
      },
      governanceRule:
        "SUPPORTING_CONTEXT_ONLY: Market Intelligence never overrides price action, technical indicators, AIDecisionContract, AISafetyGate, RiskEngine, or Emergency Stop."
    };
  }

  return {
    VALID_FILTER_CATEGORIES,
    registerProvider,
    clearProvider,
    hasConfiguredProvider,
    emptyIntelligence,
    validateNewsItem,
    deduplicateItems,
    normalize,
    getIntelligence,
    buildIntelligenceViewModel
  };
})();

if (typeof window !== "undefined") {
  window.MarketIntelligence = MarketIntelligence;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = MarketIntelligence;
}
