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
        invalidFutureCount: 0,
        missingTimestampCount: 0,
        staleItems: [],
        errors: [],
        rateLimited: false,
        message: reason
      }
    };
  }

  function classifyHeadline(raw = {}, headline = "", summary = "", source = "", category = "INDIAN_MARKET") {
    if (raw && typeof raw.classification === "string") {
      const explicit = raw.classification.trim().toUpperCase();
      if (["EXCHANGE_FILING", "COMPANY_NEWS", "MACRO_NEWS", "MARKET_NEWS"].includes(explicit)) {
        return explicit;
      }
    }

    const text = `${headline || ""} ${summary || ""}`.toUpperCase();
    const src = String(source || "").toUpperCase();

    const isFiling =
      /\b(?:REGULATION\s*30|SEBI\s*\(?LODR|CORPORATE\s*ANNOUNCEMENT|EXCHANGE\s*FILING|BOARD\s*MEETING\s*INTIMATION|CLOSURE\s*OF\s*TRADING\s*WINDOW|TRADING\s*WINDOW|SCRUTINIZER|POSTAL\s*BALLOT|ANNUAL\s*GENERAL\s*MEETING|\bAGM\b|\bEGM\b|ALLOTMENT\s*OF\s*ESOP|INVESTOR\s*PRESENTATION|OUTCOME\s*OF\s*BOARD\s*MEETING|COMPLIANCE\s*CERTIFICATE|SHAREHOLDING\s*PATTERN|NEWSPAPER\s*PUBLICATION|LOSS\s*OF\s*SHARE\s*CERTIFICATE|INTIMATION\s*UNDER\s*REGULATION|DISCLOSURE\s*UNDER\s*REGULATION)\b/.test(
        text
      ) || /\b(?:CORPORATE\s*FILING|BSE\s*ANNOUNCEMENT|NSE\s*ANNOUNCEMENT|EXCHANGE\s*FILING)\b/.test(src);

    if (isFiling) {
      return "EXCHANGE_FILING";
    }

    const isMacro =
      /\b(?:RBI\s*MPC|REPO\s*RATE|CENTRAL\s*BANK|FOMC|FEDERAL\s*RESERVE|TREASURY\s*YIELD|CPI\s*INFLATION|WPI\s*INFLATION|GDP\s*GROWTH|MONETARY\s*POLICY|FISCAL\s*DEFICIT|PMI\s*DATA|UNEMPLOYMENT\s*RATE|ECB|BANK\s*OF\s*JAPAN|CRUDE\s*OIL|GEOPOLITICAL)\b/.test(
        text
      );

    if (isMacro || category === "GLOBAL_MARKET") {
      return "MACRO_NEWS";
    }

    if (
      category === "COMPANY_NEWS" ||
      Boolean(raw?.relatedSymbol || raw?.symbol || raw?.companyName || raw?.company) ||
      /\b(?:Q[1-4]\s*(?:FY\d{2,4}\s*)?(?:RESULTS|PROFIT|EARNINGS|REVENUE)|NET\s*PROFIT|DIVIDEND|ORDER\s*WIN|ACQUISITION|MERGER|BUYBACK|CAPEX|GIGAFACTORY|SHARES)\b/.test(
        text
      )
    ) {
      return "COMPANY_NEWS";
    }

    return "MARKET_NEWS";
  }

  function buildFactualSummary(rawSummary, headline, classification, source) {
    const cleanSummary = rawSummary ? String(rawSummary).trim() : "";
    const cleanHeadline = String(headline || "").trim();
    if (cleanSummary && cleanSummary.toLowerCase() !== cleanHeadline.toLowerCase()) {
      return cleanSummary.slice(0, 500);
    }
    const label =
      classification === "EXCHANGE_FILING"
        ? "Exchange/corporate filing headline"
        : classification === "MACRO_NEWS"
          ? "Macro/market update headline"
          : classification === "COMPANY_NEWS"
            ? "Company news headline"
            : "Market news headline";
    return `${label} reported by ${source || "provider"}: ${cleanHeadline}`.slice(0, 500);
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
      const isFuture = Number.isFinite(pubMs) && pubMs > nowMs + 60000;
      const isStale = !Number.isFinite(pubMs) || isFuture || nowMs - pubMs > maxAgeMs;
      const category = options.defaultCategory || "INDIAN_MARKET";
      const classification = classifyHeadline({}, text, null, defaultSource, category);
      return {
        valid: true,
        itemId: `NWS-${normalizeHeadlineKey(text).slice(0, 24)}`,
        category,
        classification,
        source: defaultSource,
        provider: defaultSource.toUpperCase(),
        headline: text,
        title: text,
        summary: null,
        factualSummary: buildFactualSummary(null, text, classification, defaultSource),
        publicationTimestamp: Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : null,
        retrievalTimestamp: retrievalIso,
        url: null,
        relatedSymbol: options.defaultSymbol || null,
        companyName: null,
        sentiment: null,
        sentimentScore: null,
        freshness: !Number.isFinite(pubMs)
          ? "MISSING_TIMESTAMP"
          : isFuture
            ? "INVALID_FUTURE_TIMESTAMP"
            : isStale
              ? "STALE"
              : "FRESH",
        isStale,
        status: isFuture ? "INVALID_FUTURE_TIMESTAMP" : isStale ? "STALE" : "VALID"
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

    const isFuture = Number.isFinite(pubMs) && pubMs > nowMs + 60000;
    const isStale = !Number.isFinite(pubMs) || isFuture || nowMs - pubMs > maxAgeMs;
    const freshness = !Number.isFinite(pubMs)
      ? "MISSING_TIMESTAMP"
      : isFuture
        ? "INVALID_FUTURE_TIMESTAMP"
        : isStale
          ? "STALE"
          : "FRESH";

    const category = String(item.category || options.defaultCategory || "INDIAN_MARKET").toUpperCase();
    const rawSummary = item.summary ? String(item.summary).trim() : null;
    const classification = classifyHeadline(item, headline, rawSummary, source, category);
    const factualSummary = item.factualSummary
      ? String(item.factualSummary).trim()
      : buildFactualSummary(rawSummary, headline, classification, source);

    let sentimentScore = null;
    let sentiment = null;
    if (!isStale && freshness === "FRESH") {
      sentimentScore =
        item.sentimentScore !== undefined && item.sentimentScore !== null && Number.isFinite(Number(item.sentimentScore))
          ? Math.max(-100, Math.min(100, Number(item.sentimentScore)))
          : null;

      const rawSent = item.sentiment ? String(item.sentiment).trim().toUpperCase() : null;
      sentiment =
        rawSent && ["BULLISH", "BEARISH", "NEUTRAL", "MIXED"].includes(rawSent)
          ? rawSent
          : sentimentScore !== null
            ? sentimentScore >= 20
              ? "BULLISH"
              : sentimentScore <= -20
                ? "BEARISH"
                : "NEUTRAL"
            : null;
    }

    return {
      valid: true,
      itemId: item.itemId || `NWS-${normalizeHeadlineKey(headline).slice(0, 24)}`,
      category,
      classification,
      source,
      provider: String(item.provider || source).toUpperCase(),
      headline,
      title: headline,
      summary: rawSummary,
      factualSummary,
      publicationTimestamp: Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : null,
      retrievalTimestamp: item.retrievalTimestamp || retrievalIso,
      url: normalizeUrl(item.url || item.link),
      relatedSymbol: item.relatedSymbol ? String(item.relatedSymbol).trim().toUpperCase() : options.defaultSymbol || null,
      companyName: item.companyName || null,
      sentiment,
      sentimentScore,
      freshness,
      isStale,
      status: freshness === "INVALID_FUTURE_TIMESTAMP" ? "INVALID_FUTURE_TIMESTAMP" : isStale ? "STALE" : "VALID"
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

    items.sort((a, b) => {
      const aFresh = a.freshness === "FRESH" && !a.isStale ? 1 : 0;
      const bFresh = b.freshness === "FRESH" && !b.isStale ? 1 : 0;
      if (aFresh !== bFresh) return bFresh - aFresh;
      const msA = a.publicationTimestamp ? Date.parse(a.publicationTimestamp) : 0;
      const msB = b.publicationTimestamp ? Date.parse(b.publicationTimestamp) : 0;
      return msB - msA;
    });

    const freshItems = items.filter((i) => i.freshness === "FRESH" && !i.isStale);
    const staleItems = items.filter((i) => i.freshness !== "FRESH" || i.isStale);
    const invalidFutureCount = items.filter((i) => i.freshness === "INVALID_FUTURE_TIMESTAMP").length;
    const missingTimestampCount = items.filter((i) => i.freshness === "MISSING_TIMESTAMP").length;

    return {
      items,
      freshItems,
      staleItems,
      duplicatesRemoved,
      malformedRejected,
      invalidFutureCount,
      missingTimestampCount
    };
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
      ...(Array.isArray(raw.staleNews) ? raw.staleNews : []),
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

    const headlines = deduped.freshItems.map((h) => h.headline);
    const indianMarketNews = deduped.freshItems.filter((i) => i.category === "INDIAN_MARKET");
    const globalMarketNews = deduped.freshItems.filter((i) => i.category === "GLOBAL_MARKET");
    const companyNews = deduped.freshItems.filter((i) => i.category === "COMPANY_NEWS");
    const staleNews = deduped.staleItems;

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
      } else {
        sentiment = "UNAVAILABLE";
        sentimentScore = null;
      }
    } else if (raw.sentiment !== undefined || raw.sentimentScore !== undefined) {
      const sentimentRaw = String(raw.sentiment || "NEUTRAL").trim().toUpperCase();
      const hasBackedLabel = ["BULLISH", "BEARISH", "NEUTRAL", "MIXED"].includes(sentimentRaw);
      const hasNumericScore =
        raw.sentimentScore !== undefined &&
        raw.sentimentScore !== null &&
        Number.isFinite(Number(raw.sentimentScore));

      if (isFresh && (hasBackedLabel || hasNumericScore)) {
        sentiment = hasBackedLabel
          ? sentimentRaw
          : Number(raw.sentimentScore) >= 20
            ? "BULLISH"
            : Number(raw.sentimentScore) <= -20
              ? "BEARISH"
              : "NEUTRAL";
        sentimentScore = hasNumericScore
          ? Math.max(-100, Math.min(100, Number(raw.sentimentScore)))
          : sentiment === "BULLISH"
            ? 50
            : sentiment === "BEARISH"
              ? -50
              : 0;
        sentimentBacked = {
          available: true,
          status: "AVAILABLE",
          label: sentiment,
          score: sentimentScore,
          source,
          provider: source.toUpperCase(),
          publicationTimestamp: retrievalIso,
          retrievalTimestamp: retrievalIso,
          reason: `Backed by ${source}`
        };
      } else {
        sentiment = "UNAVAILABLE";
        sentimentScore = null;
        sentimentBacked = {
          available: false,
          status: isFresh ? "UNAVAILABLE" : "STALE",
          label: "UNAVAILABLE",
          score: null,
          source,
          provider: source.toUpperCase(),
          publicationTimestamp: retrievalIso,
          retrievalTimestamp: retrievalIso,
          reason: isFresh ? "No verified sentiment supplied." : "Sentiment timestamp is stale."
        };
      }
    } else {
      sentiment = "UNAVAILABLE";
      sentimentScore = null;
    }

    const hasFreshContent =
      isFresh &&
      (deduped.freshItems.length > 0 ||
        economicEvents.length > 0 ||
        globalIndices.length > 0 ||
        sentimentBacked.available);

    return {
      status: hasFreshContent ? "AVAILABLE" : "STALE_DATA",
      available: hasFreshContent,
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
      staleNews,
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
      confidence: hasFreshContent
        ? Math.max(0, Math.min(100, Number(raw.confidence ?? Math.abs(sentimentScore || 0)) || 0))
        : 0,
      freshness: hasFreshContent ? "FRESH" : freshness === "INVALID_TIMESTAMP" ? "INVALID_TIMESTAMP" : "STALE",
      diagnostics: {
        duplicatesRemoved: raw.diagnostics?.duplicatesRemoved ?? deduped.duplicatesRemoved,
        malformedRejected: raw.diagnostics?.malformedRejected ?? deduped.malformedRejected,
        staleCount: raw.diagnostics?.staleCount ?? deduped.staleItems.length,
        freshCount: raw.diagnostics?.freshCount ?? deduped.freshItems.length,
        invalidFutureCount: raw.diagnostics?.invalidFutureCount ?? deduped.invalidFutureCount,
        missingTimestampCount: raw.diagnostics?.missingTimestampCount ?? deduped.missingTimestampCount,
        staleItems: Array.isArray(raw.diagnostics?.staleItems)
          ? raw.diagnostics.staleItems
          : deduped.staleItems,
        errors: Array.isArray(raw.diagnostics?.errors) ? raw.diagnostics.errors : [],
        rateLimited: Boolean(raw.diagnostics?.rateLimited),
        message:
          raw.diagnostics?.message ||
          (hasFreshContent ? "Market intelligence normalized." : "Market intelligence is stale.")
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

    const rawIndian = Array.isArray(serverPayload?.indianMarketNews)
      ? serverPayload.indianMarketNews
      : [];
    const rawGlobal = Array.isArray(serverPayload?.globalMarketNews)
      ? serverPayload.globalMarketNews
      : [];
    const rawCompany = Array.isArray(serverPayload?.companyNews)
      ? serverPayload.companyNews
      : [];
    const rawStale = Array.isArray(serverPayload?.staleNews)
      ? serverPayload.staleNews
      : Array.isArray(serverPayload?.diagnostics?.staleItems)
        ? serverPayload.diagnostics.staleItems
        : [];

    const isFreshItem = (item) =>
      item &&
      item.isStale !== true &&
      item.freshness !== "STALE" &&
      item.freshness !== "INVALID_FUTURE_TIMESTAMP" &&
      item.freshness !== "MISSING_TIMESTAMP";

    const indianMarketNews = rawIndian.filter(isFreshItem);
    const globalMarketNews = rawGlobal.filter(isFreshItem);
    const companyNews = rawCompany.filter(isFreshItem);

    const staleNewsMap = new Map();
    for (const item of [
      ...rawIndian.filter((i) => !isFreshItem(i)),
      ...rawGlobal.filter((i) => !isFreshItem(i)),
      ...rawCompany.filter((i) => !isFreshItem(i)),
      ...rawStale
    ]) {
      if (item && typeof item === "object") {
        const key = item.itemId || item.url || item.headline || item.title;
        if (key && !staleNewsMap.has(key)) {
          staleNewsMap.set(key, item);
        }
      }
    }
    const staleNews = Array.from(staleNewsMap.values());

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
        staleNews: staleNews.length,
        invalidFutureNews: staleNews.filter((i) => i.freshness === "INVALID_FUTURE_TIMESTAMP").length,
        economicEvents: economicEvents.length,
        globalIndices: globalIndices.length,
        totalNews: allNews.length
      },
      indianMarketNews,
      globalMarketNews,
      companyNews,
      staleNews,
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
      diagnostics: {
        duplicatesRemoved: Number(serverPayload?.diagnostics?.duplicatesRemoved) || 0,
        malformedRejected: Number(serverPayload?.diagnostics?.malformedRejected) || 0,
        staleCount: Number(serverPayload?.diagnostics?.staleCount ?? staleNews.length) || 0,
        freshCount: Number(serverPayload?.diagnostics?.freshCount ?? allNews.length) || 0,
        invalidFutureCount:
          Number(
            serverPayload?.diagnostics?.invalidFutureCount ??
              staleNews.filter((i) => i.freshness === "INVALID_FUTURE_TIMESTAMP").length
          ) || 0,
        missingTimestampCount:
          Number(
            serverPayload?.diagnostics?.missingTimestampCount ??
              staleNews.filter((i) => i.freshness === "MISSING_TIMESTAMP").length
          ) || 0,
        staleItems: staleNews,
        errors: Array.isArray(serverPayload?.diagnostics?.errors) ? serverPayload.diagnostics.errors : [],
        rateLimited: Boolean(serverPayload?.diagnostics?.rateLimited),
        message:
          serverPayload?.diagnostics?.message || "External market intelligence provider is not configured."
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
    classifyHeadline,
    buildFactualSummary,
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
