/*
 * YASHWIN AI Trading Assistant
 * Phase 4 — Step 30
 *
 * Read-only browser API client.
 * No credentials.
 * No orders.
 * No trading execution.
 */

const MarketAPI = (() => {
  const API_BASE =
    String(window.YASHWIN_API_BASE_URL || '').trim() ||
    'http://127.0.0.1:8787';

  async function request(path) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit'
    });

    let data = null;

    try {
      data = await response.json();
    } catch (_) {
      throw new Error(`Invalid API response (${response.status}).`);
    }

    if (!response.ok || !data?.ok) {
      const error = new Error(
        data?.message || `API request failed (${response.status}).`
      );

      error.code = data?.code || 'API_REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }

    return data;
  }

  async function health() {
    return request('/api/health');
  }

  async function searchInstruments(exchange, query) {
    const params = new URLSearchParams({
      exchange: String(exchange || '').trim().toUpperCase(),
      q: String(query || '').trim()
    });

    return request(`/api/instruments/search?${params.toString()}`);
  }

  async function quote(exchange, query, symbol = '') {
    const params = new URLSearchParams({
      exchange: String(exchange || '').trim().toUpperCase(),
      q: String(query || '').trim()
    });

    if (symbol) {
      params.set('symbol', String(symbol).trim());
    }

    return request(`/api/market/quote?${params.toString()}`);
  }

  return {
    API_BASE,
    health,
    searchInstruments,
    quote
  };
})();
