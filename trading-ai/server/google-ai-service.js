'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Server-Side Google AI Analysis Service (@google/genai)
 *
 * Strictly enforces:
 * - Server-side API key usage only (GEMINI_API_KEY / GOOGLE_AI_API_KEY)
 * - Never exposes API keys to browser or logs
 * - Validates every AI output against AIDecisionContract
 * - Clearly distinguishes REAL_GOOGLE_AI from MOCK_AI
 * - Never fabricates success when GEMINI_API_KEY is absent
 */

const { GoogleGenAI, Type } = require('@google/genai');
const config = require('./config');
const AIDecisionContract = require('../web/modules/ai-decision-contract');

let mockAIClient = null;

function setMockAIClient(mockFn) {
  mockAIClient = typeof mockFn === 'function' ? mockFn : null;
}

function getGoogleAIStatus(env = process.env) {
  const cfg = config.getConfig(env);
  const validation = config.validateGoogleAIConfig(cfg);

  return {
    provider: 'GOOGLE_GENAI',
    model: validation.model,
    credentialsConfigured: validation.ready,
    mockActive: Boolean(mockAIClient),
    mode: 'SERVER_ONLY'
  };
}

function getGoogleAIDiagnostics(env = process.env) {
  const status = getGoogleAIStatus(env);
  return {
    googleAIConfigured: status.credentialsConfigured ? 'YES' : 'NO',
    googleAIModel: status.model,
    googleAIMode: 'SERVER_ONLY',
    dataSource: status.mockActive
      ? 'MOCK_AI'
      : status.credentialsConfigured
        ? 'REAL_GOOGLE_AI'
        : 'UNCONFIGURED'
  };
}

function validateMarketInputForAI(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    const err = new Error('Market snapshot payload is required for AI analysis.');
    err.code = 'INVALID_AI_INPUT';
    throw err;
  }

  if (
    payload.dataReady !== true ||
    payload.staleData === true ||
    payload.status === 'STALE_MARKET_DATA' ||
    payload.status === 'DISCONNECTED' ||
    payload.status === 'INVALID_MARKET_DATA'
  ) {
    const err = new Error('Validated, fresh, connected market data (dataReady=true) is required before Google AI analysis.');
    err.code = 'MARKET_DATA_NOT_READY';
    throw err;
  }

  const price = Number(payload.price);
  if (!Number.isFinite(price) || price <= 0) {
    const err = new Error('Valid positive market price is required for Google AI analysis.');
    err.code = 'INVALID_MARKET_PRICE';
    throw err;
  }

  const rawMi = payload.marketIntelligence || payload.marketIntelligenceContext || null;
  const miAvailable = Boolean(
    rawMi &&
      typeof rawMi === 'object' &&
      rawMi.available !== false &&
      rawMi.status !== 'STALE_DATA' &&
      rawMi.status !== 'DATA_UNAVAILABLE'
  );

  return {
    symbol: String(payload.symbol || payload.instrument || 'NIFTY 50').trim(),
    exchange: String(payload.exchange || 'NSE').trim().toUpperCase(),
    assetType: String(payload.assetType || 'EQUITY').trim().toUpperCase(),
    optionType: String(payload.optionType || '').trim().toUpperCase(),
    price,
    open: Number(payload.open) || price,
    high: Number(payload.high) || price,
    low: Number(payload.low) || price,
    previousClose: Number(payload.previousClose) || price,
    volume: Number(payload.volume) || 0,
    indicators: payload.indicators && typeof payload.indicators === 'object' ? payload.indicators : {},
    deterministicAnalysis:
      payload.deterministicAnalysis && typeof payload.deterministicAnalysis === 'object'
        ? payload.deterministicAnalysis
        : null,
    marketIntelligence:
      rawMi && typeof rawMi === 'object'
        ? {
            available: miAvailable,
            sentiment: miAvailable ? rawMi.sentiment || null : null,
            indianHeadlinesCount:
              miAvailable && Array.isArray(rawMi.indianMarketNews)
                ? rawMi.indianMarketNews.filter((n) => !n?.isStale && n?.freshness !== 'INVALID_FUTURE_TIMESTAMP').length
                : 0,
            globalHeadlinesCount:
              miAvailable && Array.isArray(rawMi.globalMarketNews)
                ? rawMi.globalMarketNews.filter((n) => !n?.isStale && n?.freshness !== 'INVALID_FUTURE_TIMESTAMP').length
                : 0
          }
        : null,
    dataSource: payload.dataSource === 'MOCK' ? 'MOCK' : 'REAL'
  };
}

async function analyzeMarketWithGoogleAI(payload = {}, env = process.env) {
  const marketInput = validateMarketInputForAI(payload);

  // Test/Controlled Mock path (clearly labeled MOCK_AI)
  if (mockAIClient) {
    const rawMockResponse = await mockAIClient(marketInput);
    const contractCheck = AIDecisionContract.validate(rawMockResponse, {
      source: 'MOCK_AI'
    });

    if (!contractCheck.ok) {
      return {
        ok: false,
        code: contractCheck.code,
        message: contractCheck.errors.join(' '),
        dataSource: 'MOCK_AI',
        decision: contractCheck.decision
      };
    }

    return {
      ok: true,
      provider: 'GOOGLE_GENAI',
      model: 'gemini-3.8-flash',
      dataSource: 'MOCK_AI',
      marketDataSource: marketInput.dataSource,
      decision: contractCheck.decision
    };
  }

  const cfg = config.getConfig(env);
  const aiConfig = config.validateGoogleAIConfig(cfg);

  if (!aiConfig.ready) {
    const err = new Error('Google AI API key (GEMINI_API_KEY) is not configured on the server.');
    err.code = 'GOOGLE_AI_CREDENTIALS_MISSING';
    throw err;
  }

  const ai = new GoogleGenAI({
    apiKey: cfg.googleAI.apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });

  const prompt = JSON.stringify({
    task: 'Analyze validated Indian (NIFTY 50 / SENSEX / NSE / BSE) and Global market context and return a strict JSON trading assessment for Paper Trading.',
    rules: [
      'Never recommend a trade if risk is HIGH.',
      'Only recommend BUY, SELL, BUY_CE, or BUY_PE when conviction >= 70.',
      'Otherwise return HOLD or NO_TRADE or WATCH.',
      'Never claim that market direction can be predicted with certainty.',
      'Include clear technical, Indian/Global market context, and risk reasoning.'
    ],
    market: marketInput
  });

  const candidateModels = Array.from(
    new Set([aiConfig.model, 'gemini-3.1-flash-lite', 'gemini-flash-latest'])
  );

  let response = null;
  let usedModel = aiConfig.model;
  let lastErr = null;

  for (const candidateModel of candidateModels) {
    try {
      usedModel = candidateModel;
      response = await ai.models.generateContent({
        model: candidateModel,
        contents: prompt,
        config: {
          systemInstruction:
            'You are the analytical engine for YASHWIN AI Trading Assistant. Return only valid JSON matching the schema. Never fabricate market prices or claim 100% certainty.',
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              signal: {
                type: Type.STRING,
                description: 'One of BUY, SELL, HOLD, NO_TRADE, WATCH, BUY_CE, BUY_PE'
              },
              confidence: {
                type: Type.NUMBER,
                description: 'Conviction score from 0 to 100'
              },
              risk: {
                type: Type.STRING,
                description: 'One of LOW, MEDIUM, HIGH'
              },
              trend: {
                type: Type.STRING,
                description: 'One of BULLISH, BEARISH, SIDEWAYS, UNKNOWN'
              },
              reasoning: {
                type: Type.STRING,
                description: 'Concise technical and risk explanation'
              },
              stopLossSuggestion: {
                type: Type.NUMBER,
                description: 'Suggested stop-loss price based on market structure'
              },
              targetSuggestion: {
                type: Type.NUMBER,
                description: 'Suggested target price based on reward-to-risk'
              }
            },
            required: ['signal', 'confidence', 'risk', 'trend', 'reasoning']
          }
        }
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      const isTransientDemand = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand') || msg.includes('429');
      if (!isTransientDemand) {
        throw err;
      }
    }
  }

  if (lastErr) {
    throw lastErr;
  }

  const rawText = typeof response?.text === 'string' ? response.text.trim() : '';
  const contractCheck = AIDecisionContract.validate(rawText, {
    source: 'REAL_GOOGLE_AI'
  });

  if (!contractCheck.ok) {
    return {
      ok: false,
      code: contractCheck.code,
      message: contractCheck.errors.join(' '),
      dataSource: 'REAL_GOOGLE_AI',
      decision: contractCheck.decision
    };
  }

  return {
    ok: true,
    provider: 'GOOGLE_GENAI',
    model: usedModel,
    dataSource: 'REAL_GOOGLE_AI',
    marketDataSource: marketInput.dataSource,
    decision: contractCheck.decision
  };
}

module.exports = {
  getGoogleAIStatus,
  getGoogleAIDiagnostics,
  validateMarketInputForAI,
  analyzeMarketWithGoogleAI,
  setMockAIClient
};
