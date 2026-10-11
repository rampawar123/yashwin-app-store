'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Task 7 — Server-Side Market Intelligence Service
 *
 * Strictly enforces:
 * - Server-side provider integration only (credentials from environment variables, never exposed to browser)
 * - Supports Indian market news, Global market news, Relevant company news, Economic calendar/events,
 *   Global market indices, and Market sentiment (only when backed by a genuine source)
 * - Preserves source/provider, headline/title, publication timestamp, URL, related symbol/company,
 *   and data retrieval timestamp for every item
 * - Deduplicates news items and clearly marks stale, missing, malformed, or unavailable data
 * - Zero fake headlines, invented events, fabricated prices, or unsupported sentiment
 * - Request timeout, per-provider rate limiting, safe error handling, and bounded caching
 * - Single SQLite database persistence when enabled
 * - Paper Trading only (LIVE_TRADING_ENABLED=false)
 */

const crypto = require('node:crypto');
const db = require('./database');
const { getConfig } = require('./config');

const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_CACHE_TTL_MS = 120 * 1000; // 2 minutes fresh cache
const DEFAULT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h for news freshness classification
const MAX_CACHE_ENTRIES = 50;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;

const SUPPORTED_PROVIDERS = Object.freeze([
  'FINNHUB',
  'ALPHA_VANTAGE',
  'NEWSAPI',
  'TRADING_ECONOMICS',
  'EXCHANGE_RSS'
]);

const VALID_CATEGORIES = new Set([
  'ALL',
  'INDIAN_MARKET',
  'GLOBAL_MARKET',
  'COMPANY_NEWS',
  'ECONOMIC_EVENTS',
  'GLOBAL_INDICES'
]);

// Bounded in-memory cache: key -> { payload, fetchedAtMs }
const intelligenceCache = new Map();

// Rate-limiter state: providerKey -> [timestamps]
const rateLimitBuckets = new Map();

// Optional injectable adapter for deterministic testing & custom licensed feeds
let customProviderAdapter = null;

function setCustomProviderAdapter(adapter) {
  if (adapter && typeof adapter === 'object') {
    customProviderAdapter = adapter;
    return true;
  }
  customProviderAdapter = null;
  return false;
}

function clearCustomProviderAdapter() {
  customProviderAdapter = null;
}

function clearIntelligenceCache() {
  intelligenceCache.clear();
  rateLimitBuckets.clear();
}

function getIntelligenceConfig(env = process.env) {
  const finnhubApiKey = String(env.FINNHUB_API_KEY || '').trim();
  const alphaVantageApiKey = String(env.ALPHA_VANTAGE_API_KEY || '').trim();
  const newsApiKey = String(env.NEWS_API_KEY || '').trim();
  const tradingEconomicsApiKey = String(env.TRADING_ECONOMICS_API_KEY || '').trim();
  const indianRssUrl = String(env.INDIAN_MARKET_RSS_URL || '').trim();
  const globalRssUrl = String(env.GLOBAL_MARKET_RSS_URL || '').trim();
  const primaryProvider = String(env.MARKET_INTELLIGENCE_PROVIDER || 'AUTO')
    .trim()
    .toUpperCase();

  const configuredProviders = [];
  if (finnhubApiKey) configuredProviders.push('FINNHUB');
  if (alphaVantageApiKey) configuredProviders.push('ALPHA_VANTAGE');
  if (newsApiKey) configuredProviders.push('NEWSAPI');
  if (tradingEconomicsApiKey) configuredProviders.push('TRADING_ECONOMICS');
  if (indianRssUrl || globalRssUrl) configuredProviders.push('EXCHANGE_RSS');
  if (customProviderAdapter) configuredProviders.push(String(customProviderAdapter.name || 'CUSTOM_PROVIDER').toUpperCase());

  return {
    primaryProvider,
    configured: configuredProviders.length > 0,
    configuredProviders,
    timeoutMs: Math.max(1000, Math.min(15000, Number(env.MARKET_INTELLIGENCE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS)),
    cacheTtlMs: Math.max(5000, Math.min(900000, Number(env.MARKET_INTELLIGENCE_CACHE_TTL_MS) || DEFAULT_CACHE_TTL_MS)),
    staleThresholdMs: Math.max(
      60000,
      Number(env.MARKET_INTELLIGENCE_STALE_MS) || DEFAULT_STALE_THRESHOLD_MS
    ),
    credentials: {
      finnhubApiKey,
      alphaVantageApiKey,
      newsApiKey,
      tradingEconomicsApiKey,
      indianRssUrl,
      globalRssUrl
    }
  };
}

function getSafeIntelligenceStatus(env = process.env) {
  const cfg = getIntelligenceConfig(env);
  return {
    configured: cfg.configured,
    primaryProvider: cfg.primaryProvider,
    configuredProviders: cfg.configuredProviders,
    supportedProviders: SUPPORTED_PROVIDERS,
    timeoutMs: cfg.timeoutMs,
    cacheTtlMs: cfg.cacheTtlMs,
    cacheSize: intelligenceCache.size,
    maxCacheEntries: MAX_CACHE_ENTRIES,
    liveTradingEnabled: false,
    tradingMode: getConfig(env).trading.mode
  };
}

function checkRateLimit(providerKey, nowMs = Date.now()) {
  const key = String(providerKey || 'DEFAULT').toUpperCase();
  const existing = rateLimitBuckets.get(key) || [];
  const recent = existing.filter((ts) => nowMs - ts < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldest = recent[0] || nowMs;
    const retryAfterSec = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (nowMs - oldest)) / 1000));
    return {
      allowed: false,
      retryAfterSec,
      remaining: 0
    };
  }

  recent.push(nowMs);
  rateLimitBuckets.set(key, recent);
  return {
    allowed: true,
    retryAfterSec: 0,
    remaining: Math.max(0, MAX_REQUESTS_PER_WINDOW - recent.length)
  };
}

function setBoundedCache(cacheKey, payload, nowMs = Date.now()) {
  if (intelligenceCache.has(cacheKey)) {
    intelligenceCache.delete(cacheKey);
  }
  while (intelligenceCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = intelligenceCache.keys().next().value;
    if (oldestKey === undefined) break;
    intelligenceCache.delete(oldestKey);
  }
  intelligenceCache.set(cacheKey, {
    payload,
    fetchedAtMs: nowMs
  });
}

function getBoundedCache(cacheKey, ttlMs = DEFAULT_CACHE_TTL_MS, nowMs = Date.now()) {
  const entry = intelligenceCache.get(cacheKey);
  if (!entry) return null;
  if (nowMs - entry.fetchedAtMs > ttlMs) {
    intelligenceCache.delete(cacheKey);
    return null;
  }
  return entry.payload;
}

function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

const RSS_TIMEZONE_OFFSETS = Object.freeze({
  IST: '+05:30',
  GMT: '+00:00',
  UTC: '+00:00',
  UT: '+00:00',
  Z: '+00:00',
  EST: '-05:00',
  EDT: '-04:00',
  CST: '-06:00',
  CDT: '-05:00',
  MST: '-07:00',
  MDT: '-06:00',
  PST: '-08:00',
  PDT: '-07:00',
  BST: '+01:00',
  CET: '+01:00',
  CEST: '+02:00',
  JST: '+09:00',
  SGT: '+08:00',
  HKT: '+08:00'
});

function stripXmlCdataAndEntities(rawStr = '') {
  return String(rawStr || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();
}

const RSS_MONTH_MAP = Object.freeze({
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12'
});

function isKnownIndianLocalTimeFeed(options = {}) {
  if (options.defaultTimezone && /^(?:Asia\/Kolkata|Asia\/Calcutta|IST|\+05:30)$/i.test(String(options.defaultTimezone).trim())) {
    return true;
  }
  const provider = String(options.provider || options.defaultProvider || '').trim().toUpperCase();
  const source = String(options.source || '').trim().toUpperCase();
  const category = String(options.category || options.defaultCategory || '').trim().toUpperCase();
  const url = String(options.url || '').trim().toLowerCase();

  if (
    /\b(?:NSE|BSE|SEBI|RBI|INDIA|INDIAN|MONEYCONTROL|ECONOMIC\s*TIMES|LIVEMINT|BUSINESS\s*STANDARD|NDTV\s*PROFIT|NIFTY|SENSEX)\b/.test(
      `${provider} ${source}`
    )
  ) {
    return true;
  }
  if (provider === 'EXCHANGE_RSS' && category !== 'GLOBAL_MARKET') {
    return true;
  }
  if (url && /(?:nseindia\.com|bseindia\.com|sebi\.gov\.in|rbi\.org\.in|moneycontrol\.com|economictimes\.indiatimes\.com|livemint\.com)/.test(url)) {
    return true;
  }
  return false;
}

function normalizeTimestamp(rawTs, options = {}) {
  if (rawTs === null || rawTs === undefined || rawTs === '') {
    return { valid: false, iso: null, ms: NaN };
  }
  if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
    // Handle Unix seconds vs milliseconds
    const ms = rawTs < 1e11 ? rawTs * 1000 : rawTs;
    if (ms > 0) {
      return { valid: true, iso: new Date(ms).toISOString(), ms };
    }
  }
  const str = stripXmlCdataAndEntities(String(rawTs));
  if (!str) {
    return { valid: false, iso: null, ms: NaN };
  }

  // Numeric Unix string (seconds or milliseconds)
  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    const ms = num < 1e11 ? num * 1000 : num;
    if (Number.isFinite(ms) && ms > 0) {
      return { valid: true, iso: new Date(ms).toISOString(), ms };
    }
  }

  // Alpha Vantage compact format: YYYYMMDDTHHMMSS
  if (/^\d{8}T\d{6}$/.test(str)) {
    const formatted = `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}T${str.slice(9, 11)}:${str.slice(11, 13)}:${str.slice(13, 15)}Z`;
    const ms = Date.parse(formatted);
    if (Number.isFinite(ms)) {
      return { valid: true, iso: new Date(ms).toISOString(), ms };
    }
  }

  const assumeIndianLocal = isKnownIndianLocalTimeFeed(options);

  // Normalize trailing timezone abbreviations (e.g. "Sat, 10 Oct 2026 14:30:00 IST" or "2026-10-10 14:30:00 IST")
  // and "GMT+05:30" / "UTC+05:30" before Date.parse
  let normalizedStr = str
    .replace(/\b(?:GMT|UTC)\s*([+-]\d{2}:?\d{2})\b/i, '$1')
    .replace(/\s+\([A-Za-z\s]+\)$/, '')
    .trim();

  let hasExplicitTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalizedStr);

  const tzMatch = normalizedStr.match(/\s+([A-Z]{2,4})$/i);
  if (tzMatch) {
    const tzAbbr = tzMatch[1].toUpperCase();
    if (RSS_TIMEZONE_OFFSETS[tzAbbr]) {
      normalizedStr = normalizedStr.slice(0, -tzMatch[0].length).trim() + ' ' + RSS_TIMEZONE_OFFSETS[tzAbbr];
      hasExplicitTz = true;
    }
  }

  // Support DD-Mon-YYYY HH:mm(:ss) or DD Mon YYYY HH:mm(:ss) (with optional leading weekday like "Sat, ")
  const dmyMonMatch = normalizedStr.match(
    /^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})[\s-]+([A-Za-z]{3})[\s-]+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([+-]\d{2}:?\d{2}|Z))?$/i
  );
  if (dmyMonMatch) {
    const day = dmyMonMatch[1].padStart(2, '0');
    const mon = RSS_MONTH_MAP[dmyMonMatch[2].toUpperCase()];
    const year = dmyMonMatch[3];
    const hh = dmyMonMatch[4].padStart(2, '0');
    const mm = dmyMonMatch[5];
    const ss = dmyMonMatch[6] || '00';
    const explicitOffset = dmyMonMatch[7] || null;
    if (mon) {
      const tzSuffix = explicitOffset || (assumeIndianLocal ? '+05:30' : 'Z');
      const isoCandidate = `${year}-${mon}-${day}T${hh}:${mm}:${ss}${tzSuffix}`;
      const parsedMs = Date.parse(isoCandidate);
      if (Number.isFinite(parsedMs)) {
        return { valid: true, iso: new Date(parsedMs).toISOString(), ms: parsedMs };
      }
    }
  }

  // Support numeric DD-MM-YYYY HH:mm(:ss) or DD/MM/YYYY HH:mm(:ss)
  const dmyNumMatch = normalizedStr.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([+-]\d{2}:?\d{2}|Z))?$/i
  );
  if (dmyNumMatch) {
    const day = dmyNumMatch[1].padStart(2, '0');
    const monNum = Number(dmyNumMatch[2]);
    const year = dmyNumMatch[3];
    const hh = dmyNumMatch[4].padStart(2, '0');
    const mm = dmyNumMatch[5];
    const ss = dmyNumMatch[6] || '00';
    const explicitOffset = dmyNumMatch[7] || null;
    if (monNum >= 1 && monNum <= 12) {
      const mon = String(monNum).padStart(2, '0');
      const tzSuffix = explicitOffset || (assumeIndianLocal ? '+05:30' : 'Z');
      const isoCandidate = `${year}-${mon}-${day}T${hh}:${mm}:${ss}${tzSuffix}`;
      const parsedMs = Date.parse(isoCandidate);
      if (Number.isFinite(parsedMs)) {
        return { valid: true, iso: new Date(parsedMs).toISOString(), ms: parsedMs };
      }
    }
  }

  // Support YYYY-MM-DD HH:mm(:ss) or YYYY-MM-DDTHH:mm(:ss) (with or without explicit timezone)
  const ymdMatch = normalizedStr.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(?:\s*([+-]\d{2}:?\d{2}|Z))?$/i
  );
  if (ymdMatch) {
    const year = ymdMatch[1];
    const mon = ymdMatch[2];
    const day = ymdMatch[3];
    const hh = ymdMatch[4].padStart(2, '0');
    const mm = ymdMatch[5];
    const ss = ymdMatch[6] || '00';
    const msPart = ymdMatch[7] || '';
    const explicitOffset = ymdMatch[8] || null;
    const tzSuffix = explicitOffset || (assumeIndianLocal && !hasExplicitTz ? '+05:30' : 'Z');
    const isoCandidate = `${year}-${mon}-${day}T${hh}:${mm}:${ss}${msPart}${tzSuffix}`;
    const parsedMs = Date.parse(isoCandidate);
    if (Number.isFinite(parsedMs)) {
      return { valid: true, iso: new Date(parsedMs).toISOString(), ms: parsedMs };
    }
  }

  const ms = Date.parse(normalizedStr);
  if (Number.isFinite(ms)) {
    return { valid: true, iso: new Date(ms).toISOString(), ms };
  }

  const fallbackMs = Date.parse(str);
  if (Number.isFinite(fallbackMs)) {
    return { valid: true, iso: new Date(fallbackMs).toISOString(), ms: fallbackMs };
  }
  return { valid: false, iso: null, ms: NaN };
}

function classifyNewsItem(raw = {}, headline = '', summary = '', source = '', category = 'INDIAN_MARKET') {
  if (raw && typeof raw.classification === 'string') {
    const explicit = raw.classification.trim().toUpperCase();
    if (['EXCHANGE_FILING', 'COMPANY_NEWS', 'MACRO_NEWS', 'MARKET_NEWS'].includes(explicit)) {
      return explicit;
    }
  }

  const text = `${headline || ''} ${summary || ''}`.toUpperCase();
  const src = String(source || '').toUpperCase();

  const isFiling =
    /\b(?:REGULATION\s*30|SEBI\s*\(?LODR|CORPORATE\s*ANNOUNCEMENT|EXCHANGE\s*FILING|BOARD\s*MEETING\s*INTIMATION|CLOSURE\s*OF\s*TRADING\s*WINDOW|TRADING\s*WINDOW|SCRUTINIZER|POSTAL\s*BALLOT|ANNUAL\s*GENERAL\s*MEETING|\bAGM\b|\bEGM\b|ALLOTMENT\s*OF\s*ESOP|INVESTOR\s*PRESENTATION|OUTCOME\s*OF\s*BOARD\s*MEETING|COMPLIANCE\s*CERTIFICATE|SHAREHOLDING\s*PATTERN|NEWSPAPER\s*PUBLICATION|LOSS\s*OF\s*SHARE\s*CERTIFICATE|INTIMATION\s*UNDER\s*REGULATION|DISCLOSURE\s*UNDER\s*REGULATION)\b/.test(
      text
    ) || /\b(?:CORPORATE\s*FILING|BSE\s*ANNOUNCEMENT|NSE\s*ANNOUNCEMENT|EXCHANGE\s*FILING)\b/.test(src);

  if (isFiling) {
    return 'EXCHANGE_FILING';
  }

  const isMacro =
    /\b(?:RBI\s*MPC|REPO\s*RATE|CENTRAL\s*BANK|FOMC|FEDERAL\s*RESERVE|TREASURY\s*YIELD|CPI\s*INFLATION|WPI\s*INFLATION|GDP\s*GROWTH|MONETARY\s*POLICY|FISCAL\s*DEFICIT|PMI\s*DATA|UNEMPLOYMENT\s*RATE|ECB|BANK\s*OF\s*JAPAN|CRUDE\s*OIL|GEOPOLITICAL)\b/.test(
      text
    );

  if (isMacro || category === 'GLOBAL_MARKET') {
    return 'MACRO_NEWS';
  }

  if (
    category === 'COMPANY_NEWS' ||
    Boolean(raw?.relatedSymbol || raw?.symbol || raw?.companyName || raw?.company) ||
    /\b(?:Q[1-4]\s*(?:FY\d{2,4}\s*)?(?:RESULTS|PROFIT|EARNINGS|REVENUE)|NET\s*PROFIT|DIVIDEND|ORDER\s*WIN|ACQUISITION|MERGER|BUYBACK|CAPEX|GIGAFACTORY|SHARES)\b/.test(
      text
    )
  ) {
    return 'COMPANY_NEWS';
  }

  return 'MARKET_NEWS';
}

function buildFactualSummary(rawSummary, headline, classification, source) {
  const cleanSummary = rawSummary ? stripXmlCdataAndEntities(String(rawSummary)).trim() : '';
  const cleanHeadline = stripXmlCdataAndEntities(String(headline || '')).trim();
  if (cleanSummary && cleanSummary.toLowerCase() !== cleanHeadline.toLowerCase()) {
    return cleanSummary.slice(0, 500);
  }
  const label =
    classification === 'EXCHANGE_FILING'
      ? 'Exchange/corporate filing headline'
      : classification === 'MACRO_NEWS'
        ? 'Macro/market update headline'
        : classification === 'COMPANY_NEWS'
          ? 'Company news headline'
          : 'Market news headline';
  return `${label} reported by ${source || 'provider'}: ${cleanHeadline}`.slice(0, 500);
}

function normalizeHeadlineKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateAndNormalizeNewsItem(raw = {}, options = {}) {
  const retrievalIso = options.retrievalTimestamp || new Date(options.nowMs || Date.now()).toISOString();
  const nowMs = Number(options.nowMs) || Date.now();
  const staleThresholdMs = Number(options.staleThresholdMs) || DEFAULT_STALE_THRESHOLD_MS;

  if (!raw || typeof raw !== 'object') {
    return {
      valid: false,
      status: 'MALFORMED',
      reason: 'News item is not an object.'
    };
  }

  const headline = String(raw.headline || raw.title || '').trim();
  const source = String(raw.source || raw.provider || options.defaultProvider || '').trim();
  const provider = String(raw.provider || options.defaultProvider || source || 'UNKNOWN_PROVIDER')
    .trim()
    .toUpperCase();

  if (!headline || headline.length < 4) {
    return {
      valid: false,
      status: 'MALFORMED',
      reason: 'Missing or invalid headline/title.'
    };
  }

  if (!source) {
    return {
      valid: false,
      status: 'MALFORMED',
      reason: 'Missing news source/provider.'
    };
  }

  const rawCategory = String(raw.category || options.defaultCategory || 'INDIAN_MARKET')
    .trim()
    .toUpperCase();

  const url = normalizeUrl(raw.url || raw.link);

  const pubTime = normalizeTimestamp(
    raw.publishedAt ?? raw.publicationTimestamp ?? raw.datetime ?? raw.time_published ?? raw.pubDate ?? raw.timestamp,
    {
      provider,
      source,
      category: rawCategory,
      url: url || raw.url || raw.link || '',
      defaultTimezone: raw.timezone || options.defaultTimezone || null
    }
  );

  const relatedSymbol = raw.relatedSymbol || raw.symbol || raw.related || options.defaultSymbol || null;
  const cleanSymbol = relatedSymbol ? String(relatedSymbol).trim().toUpperCase() : null;
  const companyName = raw.companyName || raw.company || null;

  const category = ['INDIAN_MARKET', 'GLOBAL_MARKET', 'COMPANY_NEWS'].includes(rawCategory)
    ? rawCategory
    : cleanSymbol
      ? 'COMPANY_NEWS'
      : 'INDIAN_MARKET';

  const isFuture = pubTime.valid && pubTime.ms > nowMs + 60 * 1000;
  const isStale = !pubTime.valid || isFuture || nowMs - pubTime.ms > staleThresholdMs;

  const freshness = !pubTime.valid
    ? 'MISSING_TIMESTAMP'
    : isFuture
      ? 'INVALID_FUTURE_TIMESTAMP'
      : isStale
        ? 'STALE'
        : 'FRESH';

  const rawSummary = raw.summary ? String(raw.summary).trim().slice(0, 500) : null;
  const classification = classifyNewsItem(raw, headline, rawSummary, source, category);
  const factualSummary = buildFactualSummary(rawSummary, headline, classification, source);

  // Sentiment ONLY if explicitly backed by provider payload AND item is fresh/valid
  let sentiment = null;
  let sentimentScore = null;
  if (!isStale && freshness === 'FRESH') {
    if (raw.sentiment && typeof raw.sentiment === 'string') {
      const sUpper = raw.sentiment.trim().toUpperCase();
      if (['BULLISH', 'BEARISH', 'NEUTRAL', 'MIXED', 'POSITIVE', 'NEGATIVE'].includes(sUpper)) {
        sentiment = sUpper === 'POSITIVE' ? 'BULLISH' : sUpper === 'NEGATIVE' ? 'BEARISH' : sUpper;
      }
    }
    if (raw.sentimentScore !== undefined && raw.sentimentScore !== null && Number.isFinite(Number(raw.sentimentScore))) {
      sentimentScore = Math.max(-100, Math.min(100, Number(raw.sentimentScore)));
      if (!sentiment) {
        sentiment = sentimentScore >= 20 ? 'BULLISH' : sentimentScore <= -20 ? 'BEARISH' : 'NEUTRAL';
      }
    }
  }

  const idSeed = `${provider}|${url || normalizeHeadlineKey(headline)}|${pubTime.iso || ''}`;
  const itemId = `NWS-${crypto.createHash('sha256').update(idSeed).digest('hex').slice(0, 16)}`;

  return {
    valid: true,
    itemId,
    category,
    classification,
    source,
    provider,
    headline,
    title: headline,
    summary: rawSummary,
    factualSummary,
    publicationTimestamp: pubTime.iso,
    publishedAt: pubTime.iso,
    retrievalTimestamp: retrievalIso,
    url,
    relatedSymbol: cleanSymbol,
    companyName: companyName ? String(companyName).trim() : null,
    sentiment,
    sentimentScore,
    freshness,
    isStale,
    status: freshness === 'INVALID_FUTURE_TIMESTAMP' ? 'INVALID_FUTURE_TIMESTAMP' : isStale ? 'STALE' : 'VALID'
  };
}

function deduplicateAndValidateNews(rawItems = [], options = {}) {
  const seenUrls = new Set();
  const seenHeadlines = new Set();
  const validItems = [];
  let duplicatesRemoved = 0;
  let malformedRejected = 0;

  for (const raw of rawItems) {
    const normalized = validateAndNormalizeNewsItem(raw, options);
    if (!normalized.valid) {
      malformedRejected += 1;
      continue;
    }

    const urlKey = normalized.url ? normalized.url.toLowerCase() : null;
    const headlineKey = normalizeHeadlineKey(normalized.headline);

    if ((urlKey && seenUrls.has(urlKey)) || (headlineKey && seenHeadlines.has(headlineKey))) {
      duplicatesRemoved += 1;
      continue;
    }

    if (urlKey) seenUrls.add(urlKey);
    if (headlineKey) seenHeadlines.add(headlineKey);
    validItems.push(normalized);
  }

  // Sort FRESH items first (newest to oldest), followed by STALE / INVALID_FUTURE_TIMESTAMP / MISSING_TIMESTAMP items
  validItems.sort((a, b) => {
    const aFresh = a.freshness === 'FRESH' && !a.isStale ? 1 : 0;
    const bFresh = b.freshness === 'FRESH' && !b.isStale ? 1 : 0;
    if (aFresh !== bFresh) {
      return bFresh - aFresh;
    }
    const msA = a.publicationTimestamp ? Date.parse(a.publicationTimestamp) : 0;
    const msB = b.publicationTimestamp ? Date.parse(b.publicationTimestamp) : 0;
    return msB - msA;
  });

  const freshItems = validItems.filter((i) => i.freshness === 'FRESH' && !i.isStale);
  const staleItems = validItems.filter((i) => i.freshness !== 'FRESH' || i.isStale);
  const invalidFutureCount = validItems.filter((i) => i.freshness === 'INVALID_FUTURE_TIMESTAMP').length;
  const missingTimestampCount = validItems.filter((i) => i.freshness === 'MISSING_TIMESTAMP').length;

  return {
    items: validItems,
    freshItems,
    staleItems,
    duplicatesRemoved,
    malformedRejected,
    invalidFutureCount,
    missingTimestampCount
  };
}

function validateAndNormalizeEconomicEvent(raw = {}, options = {}) {
  const retrievalIso = options.retrievalTimestamp || new Date(options.nowMs || Date.now()).toISOString();

  if (!raw || typeof raw !== 'object') {
    return { valid: false, status: 'MALFORMED', reason: 'Economic event is not an object.' };
  }

  const title = String(raw.title || raw.event || raw.headline || '').trim();
  const source = String(raw.source || raw.provider || options.defaultProvider || '').trim();
  const provider = String(raw.provider || options.defaultProvider || source || 'UNKNOWN_PROVIDER')
    .trim()
    .toUpperCase();

  if (!title || !source) {
    return { valid: false, status: 'MALFORMED', reason: 'Economic event requires title and source.' };
  }

  const eventTime = normalizeTimestamp(raw.eventTimestamp || raw.date || raw.time || raw.publicationTimestamp);
  const country = String(raw.country || raw.region || 'GLOBAL').trim().toUpperCase();
  const impactRaw = String(raw.impact || raw.importance || 'MEDIUM').trim().toUpperCase();
  const impact = ['HIGH', 'MEDIUM', 'LOW'].includes(impactRaw) ? impactRaw : 'MEDIUM';

  return {
    valid: true,
    eventId: `ECO-${crypto.createHash('sha256').update(`${provider}|${country}|${title}|${eventTime.iso || ''}`).digest('hex').slice(0, 14)}`,
    title,
    event: title,
    country,
    impact,
    actual: raw.actual !== undefined && raw.actual !== null ? String(raw.actual).trim() : null,
    forecast: raw.forecast !== undefined && raw.forecast !== null ? String(raw.forecast).trim() : null,
    previous: raw.previous !== undefined && raw.previous !== null ? String(raw.previous).trim() : null,
    unit: raw.unit ? String(raw.unit).trim() : null,
    publicationTimestamp: eventTime.iso,
    eventTimestamp: eventTime.iso,
    retrievalTimestamp: retrievalIso,
    source,
    provider,
    url: normalizeUrl(raw.url),
    status: eventTime.valid ? 'VALID' : 'MISSING_TIMESTAMP'
  };
}

function validateAndNormalizeGlobalIndex(raw = {}, options = {}) {
  const retrievalIso = options.retrievalTimestamp || new Date(options.nowMs || Date.now()).toISOString();
  const nowMs = Number(options.nowMs) || Date.now();
  const staleThresholdMs = Number(options.staleThresholdMs) || DEFAULT_STALE_THRESHOLD_MS;

  if (!raw || typeof raw !== 'object') {
    return { valid: false, status: 'MALFORMED', reason: 'Global index item is not an object.' };
  }

  const symbol = String(raw.symbol || raw.key || '').trim().toUpperCase();
  const name = String(raw.name || symbol).trim();
  const source = String(raw.source || raw.provider || options.defaultProvider || '').trim();
  const provider = String(raw.provider || options.defaultProvider || source || 'UNKNOWN_PROVIDER')
    .trim()
    .toUpperCase();
  const price = Number(raw.price ?? raw.value ?? raw.ltp);

  if (!symbol || !source || !Number.isFinite(price) || price <= 0) {
    return {
      valid: false,
      status: 'MALFORMED',
      reason: 'Global index requires symbol, source, and positive numeric price.'
    };
  }

  const change = raw.change !== undefined && raw.change !== null && Number.isFinite(Number(raw.change))
    ? Number(raw.change)
    : null;
  const changePercent =
    raw.changePercent !== undefined && raw.changePercent !== null && Number.isFinite(Number(raw.changePercent))
      ? Number(raw.changePercent)
      : null;

  const quoteTime = normalizeTimestamp(raw.timestamp || raw.publicationTimestamp || raw.updatedAt);
  const isStale = !quoteTime.valid || nowMs - quoteTime.ms > staleThresholdMs;

  return {
    valid: true,
    symbol,
    name,
    region: String(raw.region || 'GLOBAL').trim().toUpperCase(),
    price,
    change,
    changePercent,
    currency: String(raw.currency || 'USD').trim().toUpperCase(),
    publicationTimestamp: quoteTime.iso,
    retrievalTimestamp: retrievalIso,
    source,
    provider,
    url: normalizeUrl(raw.url),
    freshness: !quoteTime.valid ? 'MISSING_TIMESTAMP' : isStale ? 'STALE' : 'FRESH',
    isStale,
    status: isStale ? 'STALE' : 'VALID'
  };
}

function deriveBackedSentiment(rawSentiment, validatedNewsItems = [], nowMs = Date.now(), staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS) {
  // 1. If provider explicitly supplied a verified sentiment object backed by a source
  if (rawSentiment && typeof rawSentiment === 'object' && rawSentiment.source && rawSentiment.available !== false) {
    const ts = normalizeTimestamp(rawSentiment.timestamp || rawSentiment.publicationTimestamp);
    const isFresh = ts.valid && nowMs - ts.ms <= staleThresholdMs;
    const labelRaw = String(rawSentiment.label || rawSentiment.sentiment || '').trim().toUpperCase();
    const scoreRaw = Number(rawSentiment.score ?? rawSentiment.sentimentScore);

    if (['BULLISH', 'BEARISH', 'NEUTRAL', 'MIXED'].includes(labelRaw) && Number.isFinite(scoreRaw)) {
      return {
        available: isFresh,
        status: isFresh ? 'AVAILABLE' : 'STALE',
        label: labelRaw,
        score: Math.max(-100, Math.min(100, Math.round(scoreRaw))),
        source: String(rawSentiment.source).trim(),
        provider: String(rawSentiment.provider || rawSentiment.source).trim().toUpperCase(),
        publicationTimestamp: ts.iso,
        retrievalTimestamp: new Date(nowMs).toISOString(),
        sampleSize: Number(rawSentiment.sampleSize) || validatedNewsItems.length,
        reason: isFresh
          ? `Sentiment backed by ${rawSentiment.source}.`
          : `Sentiment from ${rawSentiment.source} is stale.`
      };
    }
  }

  // 2. Otherwise, check if fresh validated news items carry provider-supplied sentiment scores
  const freshScored = validatedNewsItems.filter(
    (item) => !item.isStale && item.sentimentScore !== null && Number.isFinite(Number(item.sentimentScore))
  );

  if (freshScored.length > 0) {
    const sum = freshScored.reduce((acc, item) => acc + Number(item.sentimentScore), 0);
    const avg = Math.round(sum / freshScored.length);
    const label = avg >= 20 ? 'BULLISH' : avg <= -20 ? 'BEARISH' : 'NEUTRAL';
    const sources = Array.from(new Set(freshScored.map((i) => i.source))).join(', ');

    return {
      available: true,
      status: 'AVAILABLE',
      label,
      score: Math.max(-100, Math.min(100, avg)),
      source: sources,
      provider: freshScored[0].provider,
      publicationTimestamp: freshScored[0].publicationTimestamp,
      retrievalTimestamp: new Date(nowMs).toISOString(),
      sampleSize: freshScored.length,
      reason: `Aggregated from ${freshScored.length} provider-scored news item(s) (${sources}).`
    };
  }

  // 3. No genuine sentiment source available -> never invent sentiment!
  return {
    available: false,
    status: 'UNAVAILABLE',
    label: 'UNAVAILABLE',
    score: null,
    source: null,
    provider: null,
    publicationTimestamp: null,
    retrievalTimestamp: new Date(nowMs).toISOString(),
    sampleSize: 0,
    reason: 'Market sentiment is unavailable because no configured provider supplied verified sentiment scores.'
  };
}

const { validateSafeOutboundUrl } = require('./notification-delivery-service');
const MAX_INTEL_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB bounded response limit

async function fetchJsonWithTimeout(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const fetchFn = options.fetchFn || (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) {
    const err = new Error('Fetch API is not available on server runtime.');
    err.code = 'FETCH_UNAVAILABLE';
    throw err;
  }

  // Enforce SSRF validation on outbound provider/RSS URLs
  const urlCheck = validateSafeOutboundUrl(url, {
    allowLoopbackForTest: options.allowLoopbackForTest === true,
    env: options.env || process.env
  });
  if (!urlCheck.ok) {
    const err = new Error(urlCheck.reason);
    err.code = urlCheck.code;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, application/rss+xml, application/xml, text/xml',
        'User-Agent': 'YASHWIN-AI-Trading-Assistant/1.0',
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const err = new Error(`Provider HTTP ${response.status}`);
      err.code = response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_HTTP_ERROR';
      err.statusCode = response.status;
      throw err;
    }

    const contentLength = Number(response.headers?.get?.('content-length') || 0);
    if (contentLength > MAX_INTEL_RESPONSE_BYTES) {
      const err = new Error('Provider response exceeded maximum allowed size.');
      err.code = 'PROVIDER_RESPONSE_TOO_LARGE';
      throw err;
    }

    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType.includes('xml') || contentType.includes('rss')) {
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_INTEL_RESPONSE_BYTES) {
        const err = new Error('Provider XML/RSS response exceeded maximum allowed size.');
        err.code = 'PROVIDER_RESPONSE_TOO_LARGE';
        throw err;
      }
      return { type: 'xml', text };
    }

    const data = await response.json();
    return { type: 'json', data };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      const timeoutErr = new Error(`Market intelligence provider timed out after ${timeoutMs}ms.`);
      timeoutErr.code = 'PROVIDER_TIMEOUT';
      throw timeoutErr;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseSimpleRssItems(xmlText = '', defaultSource = 'EXCHANGE_RSS', defaultCategory = 'INDIAN_MARKET') {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const items = [];
  const itemRegex = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const linkHrefMatch = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    const linkTagMatch = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const pubDateMatch = block.match(
      /<(?:pubDate|dc:date|published|updated)\b[^>]*>([\s\S]*?)<\/(?:pubDate|dc:date|published|updated)>/i
    );
    const descMatch = block.match(
      /<(?:description|summary|content)\b[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i
    );

    const headline = stripXmlCdataAndEntities(titleMatch?.[1] || '');
    const url = stripXmlCdataAndEntities(linkHrefMatch?.[1] || linkTagMatch?.[1] || '');
    const publishedAt = stripXmlCdataAndEntities(pubDateMatch?.[1] || '');
    const summary = stripXmlCdataAndEntities(descMatch?.[1] || '');

    if (headline) {
      items.push({
        headline,
        url,
        publishedAt,
        summary,
        source: defaultSource,
        provider: 'EXCHANGE_RSS',
        category: defaultCategory
      });
    }
  }
  return items;
}

async function fetchFromFinnhub(cfg, query = {}, options = {}) {
  const apiKey = cfg.credentials.finnhubApiKey;
  if (!apiKey) return null;

  const rl = checkRateLimit('FINNHUB', options.nowMs);
  if (!rl.allowed) {
    const err = new Error(`Finnhub rate limit reached. Retry in ${rl.retryAfterSec}s.`);
    err.code = 'PROVIDER_RATE_LIMITED';
    err.retryAfterSec = rl.retryAfterSec;
    throw err;
  }

  const rawNews = [];
  const encodedKey = encodeURIComponent(apiKey);

  // 1. General/Global market news
  const generalRes = await fetchJsonWithTimeout(
    `https://finnhub.io/api/v1/news?category=general&token=${encodedKey}`,
    { timeoutMs: cfg.timeoutMs, fetchFn: options.fetchFn }
  );

  if (Array.isArray(generalRes.data)) {
    for (const item of generalRes.data.slice(0, 25)) {
      const text = `${item.headline || ''} ${item.summary || ''}`.toUpperCase();
      const isIndia =
        text.includes('INDIA') ||
        text.includes('NIFTY') ||
        text.includes('SENSEX') ||
        text.includes('RBI') ||
        text.includes('NSE') ||
        text.includes('BSE');

      rawNews.push({
        headline: item.headline,
        summary: item.summary,
        source: item.source || 'Finnhub',
        provider: 'FINNHUB',
        publishedAt: item.datetime,
        url: item.url,
        relatedSymbol: item.related || null,
        category: isIndia ? 'INDIAN_MARKET' : 'GLOBAL_MARKET'
      });
    }
  }

  // 2. Company news if symbol provided
  const cleanSym = String(query.symbol || '')
    .replace(/-EQ$/i, '')
    .trim()
    .toUpperCase();

  if (cleanSym && !['NIFTY 50', 'NIFTY50', 'BANK NIFTY', 'BANKNIFTY', 'SENSEX'].includes(cleanSym)) {
    const nowDate = new Date(options.nowMs || Date.now());
    const fromDate = new Date(nowDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const toStr = nowDate.toISOString().slice(0, 10);
    const fromStr = fromDate.toISOString().slice(0, 10);

    try {
      const compRes = await fetchJsonWithTimeout(
        `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(cleanSym)}&from=${fromStr}&to=${toStr}&token=${encodedKey}`,
        { timeoutMs: cfg.timeoutMs, fetchFn: options.fetchFn }
      );
      if (Array.isArray(compRes.data)) {
        for (const item of compRes.data.slice(0, 15)) {
          rawNews.push({
            headline: item.headline,
            summary: item.summary,
            source: item.source || 'Finnhub Company News',
            provider: 'FINNHUB',
            publishedAt: item.datetime,
            url: item.url,
            relatedSymbol: cleanSym,
            category: 'COMPANY_NEWS'
          });
        }
      }
    } catch (_) {
      // Preserve general news even if company endpoint fails
    }
  }

  return {
    provider: 'FINNHUB',
    rawNews,
    rawEvents: [],
    rawGlobalIndices: [],
    rawSentiment: null
  };
}

async function fetchFromAlphaVantage(cfg, query = {}, options = {}) {
  const apiKey = cfg.credentials.alphaVantageApiKey;
  if (!apiKey) return null;

  const rl = checkRateLimit('ALPHA_VANTAGE', options.nowMs);
  if (!rl.allowed) {
    const err = new Error(`Alpha Vantage rate limit reached. Retry in ${rl.retryAfterSec}s.`);
    err.code = 'PROVIDER_RATE_LIMITED';
    err.retryAfterSec = rl.retryAfterSec;
    throw err;
  }

  const cleanSym = String(query.symbol || '')
    .replace(/-EQ$/i, '')
    .trim()
    .toUpperCase();
  const tickerParam =
    cleanSym && !['NIFTY 50', 'NIFTY50', 'BANK NIFTY', 'BANKNIFTY', 'SENSEX'].includes(cleanSym)
      ? `&tickers=${encodeURIComponent(cleanSym)}`
      : '';

  const res = await fetchJsonWithTimeout(
    `https://www.alphavantage.co/query?function=NEWS_SENTIMENT${tickerParam}&limit=30&apikey=${encodeURIComponent(apiKey)}`,
    { timeoutMs: cfg.timeoutMs, fetchFn: options.fetchFn }
  );

  const feed = Array.isArray(res.data?.feed) ? res.data.feed : [];
  const rawNews = feed.map((item) => {
    const scoreNum = Number(item.overall_sentiment_score);
    const scaledScore = Number.isFinite(scoreNum) ? Math.round(scoreNum * 100) : null;
    const text = `${item.title || ''} ${item.summary || ''}`.toUpperCase();
    const isIndia =
      text.includes('INDIA') ||
      text.includes('NIFTY') ||
      text.includes('SENSEX') ||
      text.includes('RBI');

    const primaryTicker =
      Array.isArray(item.ticker_sentiment) && item.ticker_sentiment[0]?.ticker
        ? String(item.ticker_sentiment[0].ticker)
        : cleanSym || null;

    return {
      headline: item.title,
      summary: item.summary,
      source: item.source || 'Alpha Vantage',
      provider: 'ALPHA_VANTAGE',
      publishedAt: item.time_published,
      url: item.url,
      relatedSymbol: primaryTicker,
      sentiment: item.overall_sentiment_label,
      sentimentScore: scaledScore,
      category: cleanSym && primaryTicker === cleanSym ? 'COMPANY_NEWS' : isIndia ? 'INDIAN_MARKET' : 'GLOBAL_MARKET'
    };
  });

  return {
    provider: 'ALPHA_VANTAGE',
    rawNews,
    rawEvents: [],
    rawGlobalIndices: [],
    rawSentiment: null
  };
}

async function fetchFromRssFeeds(cfg, options = {}) {
  const { indianRssUrl, globalRssUrl } = cfg.credentials;
  if (!indianRssUrl && !globalRssUrl) return null;

  const rl = checkRateLimit('EXCHANGE_RSS', options.nowMs);
  if (!rl.allowed) {
    const err = new Error(`RSS feed rate limit reached. Retry in ${rl.retryAfterSec}s.`);
    err.code = 'PROVIDER_RATE_LIMITED';
    err.retryAfterSec = rl.retryAfterSec;
    throw err;
  }

  const rawNews = [];
  if (indianRssUrl) {
    const indRes = await fetchJsonWithTimeout(indianRssUrl, {
      timeoutMs: cfg.timeoutMs,
      fetchFn: options.fetchFn
    });
    if (indRes.type === 'xml') {
      rawNews.push(...parseSimpleRssItems(indRes.text, 'Indian Market RSS', 'INDIAN_MARKET'));
    }
  }
  if (globalRssUrl) {
    const glbRes = await fetchJsonWithTimeout(globalRssUrl, {
      timeoutMs: cfg.timeoutMs,
      fetchFn: options.fetchFn
    });
    if (glbRes.type === 'xml') {
      rawNews.push(...parseSimpleRssItems(glbRes.text, 'Global Market RSS', 'GLOBAL_MARKET'));
    }
  }

  return {
    provider: 'EXCHANGE_RSS',
    rawNews,
    rawEvents: [],
    rawGlobalIndices: [],
    rawSentiment: null
  };
}

async function fetchMarketIntelligence(query = {}, options = {}) {
  const nowMs = Number(options.nowMs) || Date.now();
  const retrievalTimestamp = new Date(nowMs).toISOString();
  const cfg = getIntelligenceConfig(options.env || process.env);

  const market = String(query.market || query.exchange || 'NSE').trim().toUpperCase();
  const symbol = query.symbol ? String(query.symbol).trim().toUpperCase() : null;
  const requestedCategory = String(query.category || 'ALL').trim().toUpperCase();
  const category = VALID_CATEGORIES.has(requestedCategory) ? requestedCategory : 'ALL';
  const forceRefresh = Boolean(query.refresh === true || query.refresh === '1' || query.refresh === 'true');

  const cacheKey = `${market}:${symbol || 'ALL'}:${category}`;
  if (!forceRefresh) {
    const cached = getBoundedCache(cacheKey, cfg.cacheTtlMs, nowMs);
    if (cached) {
      return {
        ...cached,
        cached: true
      };
    }
  }

  // If no provider is configured at all -> return explicit DATA_UNAVAILABLE state without fake data
  if (!cfg.configured && !customProviderAdapter) {
    return {
      ok: true,
      status: 'DATA_UNAVAILABLE',
      available: false,
      cached: false,
      market,
      symbol,
      category,
      provider: 'UNCONFIGURED',
      configuredProviders: [],
      retrievalTimestamp,
      indianMarketNews: [],
      globalMarketNews: [],
      companyNews: [],
      economicEvents: [],
      globalIndices: [],
      headlines: [],
      sentiment: {
        available: false,
        status: 'UNAVAILABLE',
        label: 'UNAVAILABLE',
        score: null,
        source: null,
        provider: null,
        publicationTimestamp: null,
        retrievalTimestamp,
        sampleSize: 0,
        reason: 'External market intelligence provider is not configured on the server.'
      },
      diagnostics: {
        duplicatesRemoved: 0,
        malformedRejected: 0,
        staleCount: 0,
        freshCount: 0,
        invalidFutureCount: 0,
        missingTimestampCount: 0,
        errors: [],
        rateLimited: false,
        message:
          'No market intelligence provider credentials configured (set FINNHUB_API_KEY, ALPHA_VANTAGE_API_KEY, or INDIAN_MARKET_RSS_URL in server environment).'
      }
    };
  }

  const rawNewsCombined = [];
  const rawEventsCombined = [];
  const rawIndicesCombined = [];
  let rawSentimentBacked = null;
  const providerErrors = [];
  const activeProviders = [];
  let rateLimited = false;

  // 1. Custom/Test Provider Adapter (if registered)
  if (customProviderAdapter && typeof customProviderAdapter.fetchIntelligence === 'function') {
    const pName = String(customProviderAdapter.name || 'CUSTOM_PROVIDER').toUpperCase();
    const rl = checkRateLimit(pName, nowMs);
    if (!rl.allowed) {
      rateLimited = true;
      providerErrors.push({
        provider: pName,
        code: 'PROVIDER_RATE_LIMITED',
        message: `Rate limit exceeded for ${pName}. Retry after ${rl.retryAfterSec}s.`
      });
    } else {
      try {
        const customRaw = await customProviderAdapter.fetchIntelligence(
          { market, symbol, category },
          { nowMs, timeoutMs: cfg.timeoutMs }
        );
        if (customRaw && typeof customRaw === 'object') {
          activeProviders.push(pName);
          if (Array.isArray(customRaw.indianMarketNews)) {
            rawNewsCombined.push(
              ...customRaw.indianMarketNews.map((n) => ({ ...n, category: n.category || 'INDIAN_MARKET', provider: n.provider || pName }))
            );
          }
          if (Array.isArray(customRaw.globalMarketNews)) {
            rawNewsCombined.push(
              ...customRaw.globalMarketNews.map((n) => ({ ...n, category: n.category || 'GLOBAL_MARKET', provider: n.provider || pName }))
            );
          }
          if (Array.isArray(customRaw.companyNews)) {
            rawNewsCombined.push(
              ...customRaw.companyNews.map((n) => ({
                ...n,
                category: n.category || 'COMPANY_NEWS',
                relatedSymbol: n.relatedSymbol || symbol,
                provider: n.provider || pName
              }))
            );
          }
          if (Array.isArray(customRaw.news)) {
            rawNewsCombined.push(
              ...customRaw.news.map((n) => ({ ...n, provider: n.provider || pName }))
            );
          }
          if (Array.isArray(customRaw.economicEvents)) {
            rawEventsCombined.push(
              ...customRaw.economicEvents.map((e) => ({ ...e, provider: e.provider || pName }))
            );
          }
          if (Array.isArray(customRaw.globalIndices)) {
            rawIndicesCombined.push(
              ...customRaw.globalIndices.map((idx) => ({ ...idx, provider: idx.provider || pName }))
            );
          }
          if (customRaw.sentiment && typeof customRaw.sentiment === 'object') {
            rawSentimentBacked = {
              ...customRaw.sentiment,
              provider: customRaw.sentiment.provider || pName
            };
          }
        }
      } catch (err) {
        if (err?.code === 'PROVIDER_RATE_LIMITED') rateLimited = true;
        providerErrors.push({
          provider: pName,
          code: err?.code || 'PROVIDER_ERROR',
          message: err?.message || `Failed to fetch from ${pName}`
        });
      }
    }
  }

  // 2. Real Configured Server Providers
  if (cfg.credentials.finnhubApiKey) {
    try {
      const fh = await fetchFromFinnhub(cfg, { market, symbol, category }, { nowMs, fetchFn: options.fetchFn });
      if (fh) {
        activeProviders.push('FINNHUB');
        rawNewsCombined.push(...fh.rawNews);
      }
    } catch (err) {
      if (err?.code === 'PROVIDER_RATE_LIMITED') rateLimited = true;
      providerErrors.push({
        provider: 'FINNHUB',
        code: err?.code || 'PROVIDER_ERROR',
        message: err?.message || 'Finnhub request failed.'
      });
    }
  }

  if (cfg.credentials.alphaVantageApiKey) {
    try {
      const av = await fetchFromAlphaVantage(cfg, { market, symbol, category }, { nowMs, fetchFn: options.fetchFn });
      if (av) {
        activeProviders.push('ALPHA_VANTAGE');
        rawNewsCombined.push(...av.rawNews);
      }
    } catch (err) {
      if (err?.code === 'PROVIDER_RATE_LIMITED') rateLimited = true;
      providerErrors.push({
        provider: 'ALPHA_VANTAGE',
        code: err?.code || 'PROVIDER_ERROR',
        message: err?.message || 'Alpha Vantage request failed.'
      });
    }
  }

  if (cfg.credentials.indianRssUrl || cfg.credentials.globalRssUrl) {
    try {
      const rss = await fetchFromRssFeeds(cfg, { nowMs, fetchFn: options.fetchFn });
      if (rss) {
        activeProviders.push('EXCHANGE_RSS');
        rawNewsCombined.push(...rss.rawNews);
      }
    } catch (err) {
      if (err?.code === 'PROVIDER_RATE_LIMITED') rateLimited = true;
      providerErrors.push({
        provider: 'EXCHANGE_RSS',
        code: err?.code || 'PROVIDER_ERROR',
        message: err?.message || 'RSS feed request failed.'
      });
    }
  }

  // 3. Validate & Deduplicate all items
  const newsValidation = deduplicateAndValidateNews(rawNewsCombined, {
    nowMs,
    retrievalTimestamp,
    staleThresholdMs: cfg.staleThresholdMs,
    defaultProvider: activeProviders[0] || 'EXTERNAL_FEED'
  });

  const validatedEvents = [];
  let malformedEvents = 0;
  for (const rawEv of rawEventsCombined) {
    const ev = validateAndNormalizeEconomicEvent(rawEv, {
      nowMs,
      retrievalTimestamp,
      defaultProvider: activeProviders[0] || 'ECONOMIC_CALENDAR'
    });
    if (ev.valid) {
      validatedEvents.push(ev);
    } else {
      malformedEvents += 1;
    }
  }

  const validatedIndices = [];
  let malformedIndices = 0;
  const seenIndexSymbols = new Set();
  for (const rawIdx of rawIndicesCombined) {
    const idx = validateAndNormalizeGlobalIndex(rawIdx, {
      nowMs,
      retrievalTimestamp,
      staleThresholdMs: cfg.staleThresholdMs,
      defaultProvider: activeProviders[0] || 'GLOBAL_INDEX_FEED'
    });
    if (idx.valid && !seenIndexSymbols.has(idx.symbol)) {
      seenIndexSymbols.add(idx.symbol);
      validatedIndices.push(idx);
    } else if (!idx.valid) {
      malformedIndices += 1;
    }
  }

  // Exclude STALE and INVALID_FUTURE_TIMESTAMP items from active category arrays and main headlines
  const freshValidatedNews = newsValidation.freshItems;
  const staleAndInvalidNews = newsValidation.staleItems;

  const indianMarketNews = freshValidatedNews.filter((i) => i.category === 'INDIAN_MARKET');
  const globalMarketNews = freshValidatedNews.filter((i) => i.category === 'GLOBAL_MARKET');
  const companyNews = freshValidatedNews.filter((i) => {
    if (i.category !== 'COMPANY_NEWS' && (!symbol || i.relatedSymbol !== symbol)) {
      return false;
    }
    if (symbol && i.relatedSymbol && i.relatedSymbol !== symbol && !symbol.includes(i.relatedSymbol)) {
      return false;
    }
    return true;
  });

  const sentiment = deriveBackedSentiment(
    rawSentimentBacked,
    freshValidatedNews,
    nowMs,
    cfg.staleThresholdMs
  );

  const freshNewsCount = freshValidatedNews.length;
  const staleNewsCount = staleAndInvalidNews.length;
  const freshIndicesCount = validatedIndices.filter((i) => !i.isStale).length;

  const totalValidItems =
    newsValidation.items.length + validatedEvents.length + validatedIndices.length;
  const hasFreshContent =
    freshNewsCount > 0 || validatedEvents.length > 0 || freshIndicesCount > 0 || sentiment.available;

  let overallStatus = 'AVAILABLE';
  if (totalValidItems === 0 && !sentiment.available) {
    overallStatus = rateLimited
      ? 'RATE_LIMITED'
      : providerErrors.length > 0
        ? 'PROVIDER_ERROR'
        : 'EMPTY';
  } else if (!hasFreshContent) {
    overallStatus = 'STALE_DATA';
  }

  const responsePayload = {
    ok: overallStatus !== 'PROVIDER_ERROR' && overallStatus !== 'RATE_LIMITED',
    status: overallStatus,
    available: hasFreshContent,
    cached: false,
    market,
    symbol,
    category,
    provider: activeProviders.join(', ') || cfg.configuredProviders.join(', ') || 'UNCONFIGURED',
    configuredProviders: cfg.configuredProviders,
    retrievalTimestamp,
    indianMarketNews,
    globalMarketNews,
    companyNews,
    staleNews: staleAndInvalidNews,
    economicEvents: validatedEvents,
    globalIndices: validatedIndices,
    headlines: freshValidatedNews.slice(0, 15).map((i) => ({
      itemId: i.itemId,
      title: i.headline,
      headline: i.headline,
      summary: i.summary,
      factualSummary: i.factualSummary,
      classification: i.classification,
      source: i.source,
      provider: i.provider,
      publicationTimestamp: i.publicationTimestamp,
      retrievalTimestamp: i.retrievalTimestamp,
      url: i.url,
      relatedSymbol: i.relatedSymbol,
      category: i.category,
      sentiment: i.sentiment,
      sentimentScore: i.sentimentScore,
      freshness: i.freshness,
      isStale: i.isStale
    })),
    sentiment,
    diagnostics: {
      duplicatesRemoved: newsValidation.duplicatesRemoved,
      malformedRejected: newsValidation.malformedRejected + malformedEvents + malformedIndices,
      staleCount: staleNewsCount,
      freshCount: freshNewsCount,
      invalidFutureCount: newsValidation.invalidFutureCount,
      missingTimestampCount: newsValidation.missingTimestampCount,
      staleItems: staleAndInvalidNews,
      errors: providerErrors,
      rateLimited,
      message:
        overallStatus === 'AVAILABLE'
          ? `Retrieved ${freshNewsCount} fresh validated news item(s) (${staleNewsCount} stale/invalid filtered), ${validatedEvents.length} economic event(s), and ${validatedIndices.length} global index quote(s).`
          : overallStatus === 'STALE_DATA'
            ? 'Retrieved intelligence items are older than the freshness threshold or have invalid future timestamps and are marked STALE.'
            : overallStatus === 'EMPTY'
              ? 'Provider responded with zero matching intelligence items for the selected filter.'
              : providerErrors[0]?.message || 'Unable to retrieve market intelligence from provider.'
    }
  };

  // Persist validated items into single SQLite database if available
  if (typeof db.cacheMarketIntelligenceItems === 'function' && newsValidation.items.length > 0) {
    try {
      db.cacheMarketIntelligenceItems(newsValidation.items);
    } catch (_) {}
  }

  if (overallStatus === 'AVAILABLE' || overallStatus === 'STALE_DATA' || overallStatus === 'EMPTY') {
    setBoundedCache(cacheKey, responsePayload, nowMs);
  }

  return responsePayload;
}

module.exports = {
  SUPPORTED_PROVIDERS,
  VALID_CATEGORIES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_STALE_THRESHOLD_MS,
  MAX_CACHE_ENTRIES,
  getIntelligenceConfig,
  getSafeIntelligenceStatus,
  setCustomProviderAdapter,
  clearCustomProviderAdapter,
  clearIntelligenceCache,
  checkRateLimit,
  isKnownIndianLocalTimeFeed,
  normalizeTimestamp,
  stripXmlCdataAndEntities,
  classifyNewsItem,
  buildFactualSummary,
  validateAndNormalizeNewsItem,
  deduplicateAndValidateNews,
  validateAndNormalizeEconomicEvent,
  validateAndNormalizeGlobalIndex,
  deriveBackedSentiment,
  parseSimpleRssItems,
  fetchMarketIntelligence
};
