/*
 * YASHWIN AI Trading Assistant
 * Phase 8 & E — Market Data Layer, Snapshot Builder & Technical Analysis Engine
 *
 * Supports indices, searchable equities, and validated options.
 * Computes deterministic technical indicators ONLY when real quote/candle
 * data is supplied:
 * - EMA (9, 21)
 * - SMA (20, 50)
 * - VWAP
 * - RSI (14)
 * - MACD (12, 26, 9)
 * - ATR (14)
 * - Bollinger Bands (20, 2)
 * - ADX (14)
 * - Volume analysis
 * - Support / Resistance & Breakout / Breakdown detection
 * - Market Regime classification
 *
 * Never calculates indicators from fabricated values.
 * Handles insufficient candles gracefully.
 * No fake live prices. No broker orders.
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

  function resolveInstrumentDescriptor(input) {
    if (!input) {
      throw new Error("Instrument key or object is required.");
    }

    if (typeof input === "string") {
      const cleanKey = input.trim().toUpperCase();
      if (!cleanKey) {
        throw new Error("Unknown market instrument.");
      }

      if (instruments[cleanKey]) {
        return { ...instruments[cleanKey] };
      }

      return {
        key: cleanKey,
        name: input.trim(),
        exchange: "NSE",
        type: "EQUITY"
      };
    }

    if (typeof input === "object") {
      const key = String(
        input.key || input.tradingsymbol || input.name || ""
      ).trim();

      if (!key) {
        throw new Error("Unknown market instrument.");
      }

      const upperKey = key.toUpperCase();
      if (instruments[upperKey]) {
        return {
          ...instruments[upperKey],
          ...input,
          key: instruments[upperKey].key,
          name: input.name || instruments[upperKey].name,
          exchange: String(
            input.exchange || instruments[upperKey].exchange
          ).toUpperCase(),
          type: String(input.type || instruments[upperKey].type).toUpperCase()
        };
      }

      const exchange = String(input.exchange || "NSE").trim().toUpperCase();
      const inferredType =
        input.type ||
        (["NFO", "BFO"].includes(exchange) || input.optionType
          ? "OPTION"
          : "EQUITY");

      return {
        key,
        name: String(input.name || input.tradingsymbol || key).trim(),
        exchange,
        type: String(inferredType).toUpperCase(),
        optionType: input.optionType || null,
        strikePrice: input.strikePrice ?? null,
        expiry: input.expiry || null,
        symboltoken: input.symboltoken || null
      };
    }

    throw new Error("Unknown market instrument.");
  }

  function emptySnapshot(instrumentInput) {
    const instrument = resolveInstrumentDescriptor(instrumentInput);

    return {
      instrument: instrument.key,
      name: instrument.name,
      exchange: instrument.exchange,
      type: instrument.type,
      optionType: instrument.optionType || null,
      strikePrice: instrument.strikePrice ?? null,
      expiry: instrument.expiry || null,

      status: "DATA_WAITING",
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
        volatilityScore: null,
        ema9: null,
        ema21: null,
        sma20: null,
        sma50: null,
        vwap: null,
        rsi14: null,
        macd: null,
        atr14: null,
        bollingerBands: null,
        adx14: null,
        support: null,
        resistance: null,
        breakout: "NONE",
        marketRegime: "UNKNOWN",
        dataQuality: "DATA_UNAVAILABLE"
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

  function clamp(val, min = -100, max = 100) {
    return Math.max(min, Math.min(max, Number(val) || 0));
  }

  function round2(n) {
    const num = Number(n);
    return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
  }

  function calculateSMA(values = [], period = 20) {
    if (!Array.isArray(values) || values.length < period || period <= 0) {
      return null;
    }
    const slice = values.slice(-period);
    const sum = slice.reduce((acc, v) => acc + Number(v), 0);
    return round2(sum / period);
  }

  function calculateEMASeries(values = [], period = 9) {
    if (!Array.isArray(values) || values.length < period || period <= 0) {
      return [];
    }
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((acc, v) => acc + Number(v), 0) / period;
    const series = [ema];

    for (let i = period; i < values.length; i += 1) {
      ema = Number(values[i]) * k + ema * (1 - k);
      series.push(ema);
    }
    return series;
  }

  function calculateEMA(values = [], period = 9) {
    const series = calculateEMASeries(values, period);
    return series.length ? round2(series[series.length - 1]) : null;
  }

  function calculateRSI(closes = [], period = 14) {
    if (!Array.isArray(closes) || closes.length < period + 1) {
      return null;
    }
    let gains = 0;
    let losses = 0;
    const startIdx = closes.length - period - 1;
    for (let i = startIdx + 1; i < closes.length; i += 1) {
      const diff = Number(closes[i]) - Number(closes[i - 1]);
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return round2(100 - 100 / (1 + rs));
  }

  function calculateMACD(closes = [], fast = 12, slow = 26, signalPeriod = 9) {
    if (!Array.isArray(closes) || closes.length < slow) {
      return null;
    }
    const fastSeries = [];
    const slowSeries = [];
    const kFast = 2 / (fast + 1);
    const kSlow = 2 / (slow + 1);

    let emaFast = closes.slice(0, fast).reduce((a, b) => a + Number(b), 0) / fast;
    for (let i = 0; i < closes.length; i += 1) {
      if (i >= fast) {
        emaFast = Number(closes[i]) * kFast + emaFast * (1 - kFast);
      }
      fastSeries.push(emaFast);
    }

    let emaSlow = closes.slice(0, slow).reduce((a, b) => a + Number(b), 0) / slow;
    const macdLineSeries = [];
    for (let i = slow - 1; i < closes.length; i += 1) {
      if (i >= slow) {
        emaSlow = Number(closes[i]) * kSlow + emaSlow * (1 - kSlow);
      }
      macdLineSeries.push(fastSeries[i] - emaSlow);
    }

    const macdLine = macdLineSeries[macdLineSeries.length - 1];
    const sigSeries = calculateEMASeries(macdLineSeries, signalPeriod);
    const signalLine = sigSeries.length ? sigSeries[sigSeries.length - 1] : macdLine;
    const histogram = macdLine - signalLine;

    return {
      macd: round2(macdLine),
      signal: round2(signalLine),
      histogram: round2(histogram),
      state: histogram > 0 ? "BULLISH" : histogram < 0 ? "BEARISH" : "NEUTRAL"
    };
  }

  function calculateATR(candles = [], period = 14) {
    if (!Array.isArray(candles) || candles.length < 2) {
      return null;
    }
    const trs = [];
    for (let i = 1; i < candles.length; i += 1) {
      const c = candles[i];
      const prev = candles[i - 1];
      const high = Number(c.high);
      const low = Number(c.low);
      const prevClose = Number(prev.close ?? prev.price);
      if (Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(prevClose)) {
        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        trs.push(tr);
      }
    }
    if (!trs.length) return null;
    const usePeriod = Math.min(period, trs.length);
    const slice = trs.slice(-usePeriod);
    const atr = slice.reduce((a, b) => a + b, 0) / usePeriod;
    return round2(atr);
  }

  function calculateBollingerBands(closes = [], period = 20, stdDevMult = 2) {
    if (!Array.isArray(closes) || closes.length < period) {
      return null;
    }
    const slice = closes.slice(-period).map(Number);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    const upper = round2(mean + stdDevMult * stdDev);
    const lower = round2(mean - stdDevMult * stdDev);
    const middle = round2(mean);
    const bandwidthPct = middle > 0 ? round2(((upper - lower) / middle) * 100) : 0;

    return {
      upper,
      middle,
      lower,
      stdDev: round2(stdDev),
      bandwidthPct
    };
  }

  function calculateADX(candles = [], period = 14) {
    if (!Array.isArray(candles) || candles.length < period + 1) {
      return null;
    }
    let plusDMTotal = 0;
    let minusDMTotal = 0;
    let trTotal = 0;

    const start = candles.length - period;
    for (let i = start; i < candles.length; i += 1) {
      const cur = candles[i];
      const prev = candles[i - 1];
      const upMove = Number(cur.high) - Number(prev.high);
      const downMove = Number(prev.low) - Number(cur.low);

      const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
      const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
      const tr = Math.max(
        Number(cur.high) - Number(cur.low),
        Math.abs(Number(cur.high) - Number(prev.close ?? prev.price)),
        Math.abs(Number(cur.low) - Number(prev.close ?? prev.price))
      );

      plusDMTotal += plusDM;
      minusDMTotal += minusDM;
      trTotal += tr;
    }

    if (trTotal <= 0) return 0;
    const plusDI = (plusDMTotal / trTotal) * 100;
    const minusDI = (minusDMTotal / trTotal) * 100;
    const diSum = plusDI + minusDI;
    if (diSum <= 0) return 0;
    const dx = (Math.abs(plusDI - minusDI) / diSum) * 100;
    return round2(dx);
  }

  function calculateVWAPFromCandles(candles = []) {
    if (!Array.isArray(candles) || !candles.length) return null;
    let pvSum = 0;
    let volSum = 0;
    for (const c of candles) {
      const h = Number(c.high);
      const l = Number(c.low);
      const cl = Number(c.close ?? c.price);
      const v = Number(c.volume ?? 0);
      if (Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(cl) && v > 0) {
        const tp = (h + l + cl) / 3;
        pvSum += tp * v;
        volSum += v;
      }
    }
    if (volSum <= 0) return null;
    return round2(pvSum / volSum);
  }

  function deriveIndicatorsFromQuote(quote = {}, candles = []) {
    const price = Number(quote.price ?? (candles.length ? candles[candles.length - 1].close : NaN));
    const open = quote.open !== null && quote.open !== undefined ? Number(quote.open) : null;
    const high = quote.high !== null && quote.high !== undefined ? Number(quote.high) : null;
    const low = quote.low !== null && quote.low !== undefined ? Number(quote.low) : null;
    const prevClose =
      quote.previousClose !== null && quote.previousClose !== undefined
        ? Number(quote.previousClose)
        : null;
    const volume =
      quote.volume !== null && quote.volume !== undefined ? Number(quote.volume) : null;

    const validCandles = Array.isArray(candles)
      ? candles.filter(
          (c) =>
            c &&
            Number.isFinite(Number(c.close ?? c.price)) &&
            Number(c.close ?? c.price) > 0
        )
      : [];

    if (!Number.isFinite(price) || price <= 0) {
      return {
        trendScore: null,
        momentumScore: null,
        volumeScore: null,
        vwapScore: null,
        supportResistanceScore: null,
        volatilityScore: null,
        ema9: null,
        ema21: null,
        sma20: null,
        sma50: null,
        vwap: null,
        rsi14: null,
        macd: null,
        atr14: null,
        bollingerBands: null,
        adx14: null,
        support: null,
        resistance: null,
        breakout: "NONE",
        marketRegime: "UNKNOWN",
        dataQuality: "DATA_UNAVAILABLE",
        reason: "No validated market price or candle series supplied."
      };
    }

    const closes = validCandles.map((c) => Number(c.close ?? c.price));
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    const rsi14 = calculateRSI(closes, 14);
    const macd = calculateMACD(closes, 12, 26, 9);
    const atr14 = calculateATR(validCandles, 14);
    const bollingerBands = calculateBollingerBands(closes, 20, 2);
    const adx14 = calculateADX(validCandles, 14);
    const candleVwap = calculateVWAPFromCandles(validCandles);

    let trendScore = null;
    if (Number.isFinite(prevClose) && prevClose > 0) {
      const changePct = ((price - prevClose) / prevClose) * 100;
      trendScore = Math.round(clamp(changePct * 40, -100, 100));
    } else if (ema9 !== null && ema21 !== null && ema21 > 0) {
      const emaDiffPct = ((ema9 - ema21) / ema21) * 100;
      trendScore = Math.round(clamp(emaDiffPct * 60, -100, 100));
    }

    let momentumScore = null;
    if (Number.isFinite(open) && open > 0) {
      const intradayPct = ((price - open) / open) * 100;
      momentumScore = Math.round(clamp(intradayPct * 50, -100, 100));
    } else if (rsi14 !== null) {
      momentumScore = Math.round(clamp((rsi14 - 50) * 2.5, -100, 100));
    } else if (trendScore !== null) {
      momentumScore = trendScore;
    }

    let vwap = candleVwap;
    let vwapScore = null;
    let supportResistanceScore = null;
    let volatilityScore = null;
    let support = null;
    let resistance = null;

    if (
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      high >= low &&
      high > 0
    ) {
      const typicalPrice = round2((high + low + price) / 3);
      if (vwap === null) vwap = typicalPrice;
      const vwapDiffPct = ((price - vwap) / vwap) * 100;
      vwapScore = Math.round(clamp(vwapDiffPct * 60, -100, 100));

      support = round2(low);
      resistance = round2(high);

      const range = high - low;
      if (range > 0) {
        const positionInRange = (price - low) / range; // 0 to 1
        supportResistanceScore = Math.round(
          clamp((positionInRange - 0.5) * 160, -100, 100)
        );
      } else {
        supportResistanceScore = 0;
      }

      const rangePct = (range / price) * 100;
      volatilityScore = Math.round(clamp(rangePct * 20, 0, 100));
    } else if (validCandles.length >= 2) {
      const recentHighs = validCandles.slice(-20).map((c) => Number(c.high));
      const recentLows = validCandles.slice(-20).map((c) => Number(c.low));
      resistance = round2(Math.max(...recentHighs));
      support = round2(Math.min(...recentLows));
      if (vwap !== null && vwap > 0) {
        vwapScore = Math.round(clamp(((price - vwap) / vwap) * 6000, -100, 100));
      }
      if (atr14 !== null && price > 0) {
        volatilityScore = Math.round(clamp(((atr14 / price) * 100) * 25, 0, 100));
      }
    }

    let breakout = "NONE";
    if (validCandles.length >= 5) {
      const priorCandles = validCandles.slice(-20, -1);
      if (priorCandles.length >= 3) {
        const priorHigh = Math.max(...priorCandles.map((c) => Number(c.high)));
        const priorLow = Math.min(...priorCandles.map((c) => Number(c.low)));
        if (price > priorHigh) breakout = "BULLISH_BREAKOUT";
        else if (price < priorLow) breakout = "BEARISH_BREAKDOWN";
      }
    }

    let volumeScore = null;
    if (Number.isFinite(volume) && volume >= 0) {
      const sign = (trendScore || momentumScore || 0) >= 0 ? 1 : -1;
      volumeScore = volume > 0 ? sign * 50 : 0;
    }

    let marketRegime = "RANGEBOUND";
    if ((volatilityScore || 0) >= 70) {
      marketRegime = "HIGH_VOLATILITY";
    } else if ((adx14 !== null && adx14 >= 25) || Math.abs(trendScore || 0) >= 50) {
      marketRegime = (trendScore || 0) >= 0 ? "BULLISH_TREND" : "BEARISH_TREND";
    }

    const dataQuality =
      validCandles.length >= 26
        ? "FULL_CANDLE_SERIES"
        : validCandles.length >= 14
          ? "PARTIAL_CANDLE_SERIES"
          : "QUOTE_OHLC_ONLY";

    const stateLabel =
      (trendScore || 0) >= 20
        ? "BULLISH"
        : (trendScore || 0) <= -20
          ? "BEARISH"
          : "NEUTRAL";

    return {
      trendScore,
      momentumScore,
      volumeScore,
      vwapScore,
      supportResistanceScore,
      volatilityScore,
      ema9,
      ema21,
      sma20,
      sma50,
      vwap,
      rsi14,
      macd,
      atr14,
      bollingerBands,
      adx14,
      support,
      resistance,
      breakout,
      marketRegime,
      state: stateLabel,
      dataQuality,
      reason: `Technical state ${stateLabel} (${marketRegime}) computed from ${dataQuality}.`
    };
  }

  function snapshotFromValidatedQuote(instrumentInput, validationResult, candles = []) {
    const snapshot = emptySnapshot(instrumentInput);

    if (!validationResult || validationResult.ok !== true || !validationResult.quote) {
      snapshot.status = validationResult?.code || "DATA_WAITING";
      snapshot.dataReady = false;
      return snapshot;
    }

    const q = validationResult.quote;
    snapshot.status = "LIVE_DATA";
    snapshot.dataReady = true;
    snapshot.timestamp = q.timestamp;
    snapshot.price = Number(q.price);
    snapshot.open = q.open ?? null;
    snapshot.high = q.high ?? null;
    snapshot.low = q.low ?? null;
    snapshot.previousClose = q.previousClose ?? null;
    snapshot.volume = q.volume ?? null;
    snapshot.candles = Array.isArray(candles) ? candles : [];
    snapshot.indicators = deriveIndicatorsFromQuote(q, snapshot.candles);

    return snapshot;
  }

  function calculateAlignedSMASeries(values = [], period = 20) {
    if (!Array.isArray(values) || period <= 0) return [];
    const out = [];
    for (let i = 0; i < values.length; i += 1) {
      if (i + 1 < period) {
        out.push(null);
      } else {
        const slice = values.slice(i + 1 - period, i + 1);
        const sum = slice.reduce((acc, v) => acc + Number(v), 0);
        out.push(round2(sum / period));
      }
    }
    return out;
  }

  function calculateAlignedEMASeries(values = [], period = 9) {
    if (!Array.isArray(values) || period <= 0) return [];
    const out = [];
    if (values.length < period) {
      return values.map(() => null);
    }
    const k = 2 / (period + 1);
    let ema =
      values.slice(0, period).reduce((acc, v) => acc + Number(v), 0) / period;
    for (let i = 0; i < values.length; i += 1) {
      if (i < period - 1) {
        out.push(null);
      } else if (i === period - 1) {
        out.push(round2(ema));
      } else {
        ema = Number(values[i]) * k + ema * (1 - k);
        out.push(round2(ema));
      }
    }
    return out;
  }

  function calculateAlignedVWAPSeries(candles = []) {
    if (!Array.isArray(candles) || !candles.length) return [];
    const out = [];
    let pvSum = 0;
    let volSum = 0;
    let priceSum = 0;
    let validCount = 0;

    for (let i = 0; i < candles.length; i += 1) {
      const c = candles[i];
      const h = Number(c?.high);
      const l = Number(c?.low);
      const cl = Number(c?.close ?? c?.price);
      const v = Number(c?.volume ?? 0);

      if (Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(cl) && cl > 0) {
        const tp = (h + l + cl) / 3;
        priceSum += tp;
        validCount += 1;
        if (Number.isFinite(v) && v > 0) {
          pvSum += tp * v;
          volSum += v;
        }
        if (volSum > 0) {
          out.push(round2(pvSum / volSum));
        } else if (validCount > 0) {
          out.push(round2(priceSum / validCount));
        } else {
          out.push(null);
        }
      } else {
        out.push(null);
      }
    }
    return out;
  }

  function calculateAlignedBollingerSeries(closes = [], period = 20, stdDevMult = 2) {
    if (!Array.isArray(closes) || period <= 0) return [];
    const out = [];
    for (let i = 0; i < closes.length; i += 1) {
      if (i + 1 < period) {
        out.push(null);
      } else {
        const bb = calculateBollingerBands(closes.slice(0, i + 1), period, stdDevMult);
        out.push(bb);
      }
    }
    return out;
  }

  function calculateAlignedRSISeries(closes = [], period = 14) {
    if (!Array.isArray(closes) || period <= 0) return [];
    const out = [];
    for (let i = 0; i < closes.length; i += 1) {
      if (i < period) {
        out.push(null);
      } else {
        out.push(calculateRSI(closes.slice(0, i + 1), period));
      }
    }
    return out;
  }

  function calculateAlignedMACDSeries(closes = [], fast = 12, slow = 26, signalPeriod = 9) {
    if (!Array.isArray(closes) || slow <= 0) return [];
    const out = [];
    for (let i = 0; i < closes.length; i += 1) {
      if (i + 1 < slow) {
        out.push(null);
      } else {
        out.push(calculateMACD(closes.slice(0, i + 1), fast, slow, signalPeriod));
      }
    }
    return out;
  }

  function calculateAlignedATRSeries(candles = [], period = 14) {
    if (!Array.isArray(candles)) return [];
    const out = [];
    for (let i = 0; i < candles.length; i += 1) {
      if (i < 1) {
        out.push(null);
      } else {
        out.push(calculateATR(candles.slice(0, i + 1), period));
      }
    }
    return out;
  }

  function calculateAlignedADXSeries(candles = [], period = 14) {
    if (!Array.isArray(candles)) return [];
    const out = [];
    for (let i = 0; i < candles.length; i += 1) {
      if (i < period) {
        out.push(null);
      } else {
        out.push(calculateADX(candles.slice(0, i + 1), period));
      }
    }
    return out;
  }

  function calculateIndicatorSeries(candles = []) {
    const validCandles = Array.isArray(candles)
      ? candles.filter(
          (c) =>
            c &&
            Number.isFinite(Number(c.open)) &&
            Number.isFinite(Number(c.high)) &&
            Number.isFinite(Number(c.low)) &&
            Number.isFinite(Number(c.close ?? c.price)) &&
            Number(c.close ?? c.price) > 0 &&
            Number(c.high) >= Number(c.low)
        )
      : [];

    if (!validCandles.length) {
      return {
        candleCount: 0,
        ema9: [],
        ema21: [],
        sma20: [],
        sma50: [],
        vwap: [],
        bollingerBands: [],
        rsi14: [],
        macd: [],
        atr14: [],
        adx14: []
      };
    }

    const closes = validCandles.map((c) => Number(c.close ?? c.price));
    return {
      candleCount: validCandles.length,
      ema9: calculateAlignedEMASeries(closes, 9),
      ema21: calculateAlignedEMASeries(closes, 21),
      sma20: calculateAlignedSMASeries(closes, 20),
      sma50: calculateAlignedSMASeries(closes, 50),
      vwap: calculateAlignedVWAPSeries(validCandles),
      bollingerBands: calculateAlignedBollingerSeries(closes, 20, 2),
      rsi14: calculateAlignedRSISeries(closes, 14),
      macd: calculateAlignedMACDSeries(closes, 12, 26, 9),
      atr14: calculateAlignedATRSeries(validCandles, 14),
      adx14: calculateAlignedADXSeries(validCandles, 14)
    };
  }

  function getInstrument(key) {
    if (!key) return null;
    const upper = String(key).trim().toUpperCase();
    return instruments[upper] || null;
  }

  function listInstruments() {
    return Object.values(instruments);
  }

  return {
    instruments,
    resolveInstrumentDescriptor,
    emptySnapshot,
    calculateSMA,
    calculateEMA,
    calculateEMASeries,
    calculateRSI,
    calculateMACD,
    calculateATR,
    calculateBollingerBands,
    calculateADX,
    calculateVWAPFromCandles,
    calculateAlignedSMASeries,
    calculateAlignedEMASeries,
    calculateAlignedVWAPSeries,
    calculateAlignedBollingerSeries,
    calculateAlignedRSISeries,
    calculateAlignedMACDSeries,
    calculateAlignedATRSeries,
    calculateAlignedADXSeries,
    calculateIndicatorSeries,
    deriveIndicatorsFromQuote,
    snapshotFromValidatedQuote,
    getInstrument,
    listInstruments
  };

})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = MarketData;
}
