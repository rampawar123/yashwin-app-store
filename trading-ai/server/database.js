'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Single Server-Side Persistent SQLite Database (node:sqlite)
 *
 * Strictly enforces:
 * - ONE persistent database for the entire trading application
 * - Idempotent schema initialization & migrations
 * - Indexes for frequently queried tables
 * - Atomic transactions for order, fill, position, and P&L updates
 * - Secret redaction on all stored JSON payloads
 * - ZERO broker secrets stored in database
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const WatchlistAlertEngine = require('../web/modules/watchlist-alert-engine');
const NotificationEngine = require('../web/modules/notification-engine');
const notificationDelivery = require('./notification-delivery-service');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB_PATH = path.resolve(__dirname, 'data', 'yashwin-trading.sqlite');
const LATEST_SCHEMA_VERSION = 9;
const EXPECTED_PRODUCTION_TABLES = Object.freeze([
  'ai_decisions',
  'alert_events_history',
  'alert_notifications',
  'app_settings',
  'audit_events',
  'backtest_runs',
  'broker_instruments_cache',
  'email_change_verifications',
  'emergency_stop_state',
  'market_alerts',
  'market_intelligence_cache',
  'market_snapshots_cache',
  'notification_delivery_logs',
  'paper_accounts',
  'paper_fills',
  'paper_orders',
  'paper_positions',
  'paper_trade_results',
  'risk_events',
  'schema_migrations',
  'strategy_decisions',
  'user_notification_preferences',
  'user_recent_searches',
  'user_sessions',
  'user_watchlist',
  'users'
]);

const FORBIDDEN_SECRET_KEYS = new Set([
  'apikey',
  'api_key',
  'angel_api_key',
  'clientid',
  'angel_client_id',
  'pin',
  'angel_pin',
  'totpsecret',
  'angel_totp_secret',
  'accesstoken',
  'refreshtoken',
  'feedtoken',
  'jwttoken',
  'password',
  'currentpassword',
  'current_password',
  'newpassword',
  'new_password',
  'password_hash',
  'passwordhash',
  'token',
  'token_hash',
  'tokenhash',
  'csrf_token',
  'csrftoken',
  'session_id',
  'sessionid',
  'gemini_api_key',
  'google_ai_api_key',
  'finnhub_api_key',
  'finnhubapikey',
  'alpha_vantage_api_key',
  'alphavantageapikey',
  'news_api_key',
  'newsapikey',
  'trading_economics_api_key',
  'tradingeconomicsapikey',
  'telegram_bot_token',
  'telegrambottoken',
  'telegram_chat_id',
  'telegramchatid',
  'notification_webhook_url',
  'notificationwebhookurl',
  'notification_email_webhook_url',
  'notificationemailwebhookurl',
  'authorization'
]);

function redactObject(input) {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    return input.map(redactObject);
  }
  if (typeof input !== 'object') {
    return input;
  }
  const clean = {};
  for (const [k, v] of Object.entries(input)) {
    if (FORBIDDEN_SECRET_KEYS.has(String(k).toLowerCase())) {
      clean[k] = '[REDACTED]';
    } else {
      clean[k] = redactObject(v);
    }
  }
  return clean;
}

function safeJsonStringify(val, fallback = '{}') {
  try {
    return JSON.stringify(redactObject(val ?? {}));
  } catch (_) {
    return fallback;
  }
}

function safeJsonParse(raw, fallback = null) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

let dbInstance = null;
let currentDbPath = null;

function normalizeSqlitePathInput(rawPath) {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return DEFAULT_DB_PATH;
  if (trimmed === ':memory:' || trimmed.startsWith('file:')) {
    return trimmed;
  }
  return path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.resolve(PROJECT_ROOT, trimmed);
}

function resolveDbPath(customPath) {
  if (customPath) return normalizeSqlitePathInput(customPath);
  if (process.env.YASHWIN_DB_PATH) {
    return normalizeSqlitePathInput(process.env.YASHWIN_DB_PATH);
  }
  return DEFAULT_DB_PATH;
}

function ensureColumn(db, tableName, columnName, columnDef) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!cols.some((c) => c.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
  }
}

function applyMigrationV2UserAccountSystem(db, nowIso) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      email_normalized TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_algo TEXT NOT NULL DEFAULT 'bcrypt',
      email_verified INTEGER NOT NULL DEFAULT 1,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_change_verifications (
      verification_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      new_email TEXT NOT NULL,
      new_email_normalized TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      verified_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_email_norm ON users(email_normalized);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_change_verifications(user_id, status);
  `);

  ensureColumn(db, 'paper_accounts', 'user_id', 'TEXT');
  ensureColumn(db, 'paper_orders', 'user_id', 'TEXT');
  ensureColumn(db, 'paper_fills', 'user_id', 'TEXT');
  ensureColumn(db, 'paper_positions', 'user_id', 'TEXT');
  ensureColumn(db, 'paper_trade_results', 'user_id', 'TEXT');
  ensureColumn(db, 'audit_events', 'user_id', 'TEXT');
  ensureColumn(db, 'ai_decisions', 'user_id', 'TEXT');
  ensureColumn(db, 'strategy_decisions', 'user_id', 'TEXT');
  ensureColumn(db, 'risk_events', 'user_id', 'TEXT');
  ensureColumn(db, 'backtest_runs', 'user_id', 'TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_accounts_user_unique
      ON paper_accounts(user_id) WHERE user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_paper_orders_user ON paper_orders(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_paper_fills_user ON paper_fills(user_id, filled_at DESC);
    CREATE INDEX IF NOT EXISTS idx_paper_positions_user ON paper_positions(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_paper_trades_user ON paper_trade_results(user_id, closed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_user ON audit_events(user_id, created_at DESC);
  `);

  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (2, 'user_account_system_and_ownership_isolation', ?)
  `).run(nowIso);
}

function applyMigrationV3MarketSearchSystem(db, nowIso) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_watchlist (
      watchlist_id TEXT PRIMARY KEY,
      user_id TEXT,
      symbol_key TEXT NOT NULL,
      tradingsymbol TEXT,
      name TEXT NOT NULL,
      exchange TEXT NOT NULL,
      instrument_type TEXT NOT NULL DEFAULT 'EQUITY',
      symboltoken TEXT,
      option_type TEXT,
      strike_price REAL,
      expiry TEXT,
      lot_size INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_recent_searches (
      recent_id TEXT PRIMARY KEY,
      user_id TEXT,
      symbol_key TEXT NOT NULL,
      tradingsymbol TEXT,
      name TEXT NOT NULL,
      exchange TEXT NOT NULL,
      instrument_type TEXT NOT NULL DEFAULT 'EQUITY',
      symboltoken TEXT,
      option_type TEXT,
      strike_price REAL,
      expiry TEXT,
      lot_size INTEGER,
      query_text TEXT,
      searched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS broker_instruments_cache (
      cache_key TEXT PRIMARY KEY,
      exchange TEXT NOT NULL,
      tradingsymbol TEXT NOT NULL,
      symboltoken TEXT NOT NULL,
      name TEXT,
      instrument_type TEXT NOT NULL,
      option_type TEXT,
      strike_price REAL,
      expiry TEXT,
      lot_size INTEGER,
      provider TEXT NOT NULL DEFAULT 'ANGEL_ONE',
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_watchlist_owner ON user_watchlist(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_recent_owner ON user_recent_searches(user_id, searched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_broker_inst_cache_exch ON broker_instruments_cache(exchange, tradingsymbol);
  `);

  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (3, 'market_search_watchlist_recent_and_instrument_cache', ?)
  `).run(nowIso);
}

function applyMigrationV4MarketIntelligenceSystem(db, nowIso) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_intelligence_cache (
      item_id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      provider TEXT NOT NULL,
      headline TEXT NOT NULL,
      summary TEXT,
      publication_timestamp TEXT,
      retrieval_timestamp TEXT NOT NULL,
      url TEXT,
      related_symbol TEXT,
      company_name TEXT,
      sentiment TEXT,
      sentiment_score REAL,
      freshness TEXT NOT NULL,
      is_stale INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_market_intel_cat_pub
      ON market_intelligence_cache(category, publication_timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_market_intel_symbol
      ON market_intelligence_cache(related_symbol, publication_timestamp DESC);
  `);

  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (4, 'market_intelligence_validated_news_cache', ?)
  `).run(nowIso);
}

function applyMigrationV5OrderFillTradeLifecycle(db, nowIso) {
  ensureColumn(db, 'paper_orders', 'lot_size', 'INTEGER');
  ensureColumn(db, 'paper_orders', 'lots', 'INTEGER');
  ensureColumn(db, 'paper_orders', 'position_id', 'TEXT');
  ensureColumn(db, 'paper_orders', 'trade_id', 'TEXT');
  ensureColumn(db, 'paper_orders', 'rejection_reason', 'TEXT');

  ensureColumn(db, 'paper_fills', 'exchange', "TEXT DEFAULT 'NSE'");
  ensureColumn(db, 'paper_fills', 'asset_type', "TEXT DEFAULT 'EQUITY'");
  ensureColumn(db, 'paper_fills', 'order_type', "TEXT DEFAULT 'ENTRY'");
  ensureColumn(db, 'paper_fills', 'position_id', 'TEXT');
  ensureColumn(db, 'paper_fills', 'trade_id', 'TEXT');
  ensureColumn(db, 'paper_fills', 'data_source', "TEXT DEFAULT 'VALIDATED_PAPER_QUOTE'");

  ensureColumn(db, 'paper_trade_results', 'exchange', "TEXT DEFAULT 'NSE'");
  ensureColumn(db, 'paper_trade_results', 'lot_size', 'INTEGER');
  ensureColumn(db, 'paper_trade_results', 'lots', 'INTEGER');
  ensureColumn(db, 'paper_trade_results', 'gross_pnl', 'REAL');
  ensureColumn(db, 'paper_trade_results', 'fees', 'REAL DEFAULT 0');
  ensureColumn(db, 'paper_trade_results', 'entry_order_id', 'TEXT');
  ensureColumn(db, 'paper_trade_results', 'exit_order_id', 'TEXT');
  ensureColumn(db, 'paper_trade_results', 'entry_fill_id', 'TEXT');
  ensureColumn(db, 'paper_trade_results', 'exit_fill_id', 'TEXT');
  ensureColumn(db, 'paper_trade_results', 'mode', "TEXT DEFAULT 'MANUAL_PAPER'");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_paper_orders_pos ON paper_orders(position_id);
    CREATE INDEX IF NOT EXISTS idx_paper_fills_order ON paper_fills(order_id);
    CREATE INDEX IF NOT EXISTS idx_paper_trades_pos ON paper_trade_results(position_id);
  `);

  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (5, 'order_fill_trade_history_cross_linking_and_lifecycle', ?)
  `).run(nowIso);
}

function applyMigrationV6BacktestRunHistory(db, nowIso) {
  ensureColumn(db, 'backtest_runs', 'exchange', "TEXT DEFAULT 'NSE'");
  ensureColumn(db, 'backtest_runs', 'timeframe', "TEXT DEFAULT 'FIVE_MINUTE'");
  ensureColumn(db, 'backtest_runs', 'from_date', 'TEXT');
  ensureColumn(db, 'backtest_runs', 'to_date', 'TEXT');
  ensureColumn(db, 'backtest_runs', 'strategy_version', "TEXT DEFAULT '1.0.0-DETERMINISTIC'");
  ensureColumn(db, 'backtest_runs', 'backtester_version', "TEXT DEFAULT '2.0.0-DETERMINISTIC-TASK13'");
  ensureColumn(db, 'backtest_runs', 'run_status', "TEXT DEFAULT 'COMPLETED'");
  ensureColumn(db, 'backtest_runs', 'config_json', "TEXT DEFAULT '{}'");
  ensureColumn(db, 'backtest_runs', 'assumptions_json', "TEXT DEFAULT '{}'");
  ensureColumn(db, 'backtest_runs', 'data_quality_json', "TEXT DEFAULT '{}'");
  ensureColumn(db, 'backtest_runs', 'fills_json', "TEXT DEFAULT '[]'");
  ensureColumn(db, 'backtest_runs', 'orders_json', "TEXT DEFAULT '[]'");
  ensureColumn(db, 'backtest_runs', 'daily_pnl_json', "TEXT DEFAULT '[]'");
  ensureColumn(db, 'backtest_runs', 'exit_reasons_json', "TEXT DEFAULT '[]'");
  ensureColumn(db, 'backtest_runs', 'equity_curve_json', "TEXT DEFAULT '[]'");
  ensureColumn(db, 'backtest_runs', 'error_json', 'TEXT');
  ensureColumn(db, 'backtest_runs', 'client_run_key', 'TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_backtest_runs_user_created
      ON backtest_runs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_backtest_runs_client_key
      ON backtest_runs(user_id, client_run_key);
  `);

  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (6, 'backtest_run_history_config_assumptions_and_status', ?)
  `).run(nowIso);
}

function applyMigrationV7WatchlistAndMarketAlerts(db, nowIso) {
  ensureColumn(db, 'user_watchlist', 'company_name', 'TEXT');
  ensureColumn(db, 'user_watchlist', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'user_watchlist', 'updated_at', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS market_alerts (
      alert_id TEXT PRIMARY KEY,
      user_id TEXT,
      symbol_key TEXT NOT NULL,
      symbol TEXT NOT NULL,
      tradingsymbol TEXT,
      name TEXT NOT NULL,
      exchange TEXT NOT NULL DEFAULT 'NSE',
      instrument_type TEXT NOT NULL DEFAULT 'EQUITY',
      symboltoken TEXT,
      option_type TEXT,
      strike_price REAL,
      expiry TEXT,
      lot_size INTEGER,
      alert_type TEXT NOT NULL,
      threshold_value REAL,
      baseline_price REAL,
      condition_json TEXT NOT NULL DEFAULT '{}',
      trigger_mode TEXT NOT NULL DEFAULT 'ONCE',
      cooldown_minutes INTEGER NOT NULL DEFAULT 15,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      last_status_reason TEXT,
      last_evaluated_at TEXT,
      last_triggered_at TEXT,
      trigger_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_events_history (
      event_id TEXT PRIMARY KEY,
      alert_id TEXT NOT NULL,
      user_id TEXT,
      symbol_key TEXT NOT NULL,
      symbol TEXT NOT NULL,
      tradingsymbol TEXT,
      exchange TEXT NOT NULL DEFAULT 'NSE',
      instrument_type TEXT NOT NULL DEFAULT 'EQUITY',
      alert_type TEXT NOT NULL,
      trigger_mode TEXT NOT NULL DEFAULT 'ONCE',
      condition_summary TEXT NOT NULL,
      threshold_value REAL,
      observed_price REAL NOT NULL,
      observed_value TEXT,
      message TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      acknowledged INTEGER NOT NULL DEFAULT 0,
      acknowledged_at TEXT,
      quote_timestamp TEXT NOT NULL,
      triggered_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_watchlist_sort
      ON user_watchlist(user_id, sort_order ASC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_market_alerts_owner_status
      ON market_alerts(user_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_market_alerts_symbol
      ON market_alerts(user_id, exchange, symbol_key);
    CREATE INDEX IF NOT EXISTS idx_alert_events_owner_time
      ON alert_events_history(user_id, triggered_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_events_alert
      ON alert_events_history(alert_id, triggered_at DESC);
  `);

  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (7, 'watchlist_ordering_and_market_alerts_engine', ?)
  `).run(nowIso);
}

function applyMigrationV8AlertNotificationsSystem(db, nowIso) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_notification_preferences (
      pref_key TEXT PRIMARY KEY,
      user_id TEXT UNIQUE,
      in_app_enabled INTEGER NOT NULL DEFAULT 1,
      browser_notifications_enabled INTEGER NOT NULL DEFAULT 0,
      sound_enabled INTEGER NOT NULL DEFAULT 0,
      telegram_enabled INTEGER NOT NULL DEFAULT 0,
      email_enabled INTEGER NOT NULL DEFAULT 0,
      webhook_enabled INTEGER NOT NULL DEFAULT 0,
      quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
      quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
      quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
      categories_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_notifications (
      notification_id TEXT PRIMARY KEY,
      user_id TEXT,
      source_event_id TEXT,
      alert_id TEXT,
      dedup_key TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'PRICE_ALERT',
      severity TEXT NOT NULL DEFAULT 'INFO',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      symbol TEXT,
      tradingsymbol TEXT,
      exchange TEXT,
      instrument_type TEXT,
      alert_type TEXT,
      condition_summary TEXT,
      threshold_value REAL,
      observed_price REAL,
      observed_value TEXT,
      quote_timestamp TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      read_status INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      triggered_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_delivery_logs (
      delivery_id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL,
      user_id TEXT,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      attempted_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_alert_notifications_owner_time
      ON alert_notifications(user_id, triggered_at DESC, notification_id DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_notifications_owner_read
      ON alert_notifications(user_id, read_status, triggered_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_notifications_source_evt
      ON alert_notifications(user_id, source_event_id);
    CREATE INDEX IF NOT EXISTS idx_notification_delivery_owner
      ON notification_delivery_logs(user_id, notification_id, attempted_at DESC);
  `);

  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (8, 'alert_notifications_center_preferences_and_delivery_logs', ?)
  `).run(nowIso);
}

function applyMigrationV9DatabaseHardeningAndCompositeIndexes(db, nowIso) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_paper_positions_user_status_opened
      ON paper_positions(user_id, status, opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_paper_orders_user_pos
      ON paper_orders(user_id, position_id);
    CREATE INDEX IF NOT EXISTS idx_paper_fills_user_pos
      ON paper_fills(user_id, position_id);
    CREATE INDEX IF NOT EXISTS idx_paper_trades_user_pos
      ON paper_trade_results(user_id, position_id);
    CREATE INDEX IF NOT EXISTS idx_ai_decisions_user_created
      ON ai_decisions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_strategy_decisions_user_created
      ON strategy_decisions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_risk_events_user_created
      ON risk_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_watchlist_user_exch_sym
      ON user_watchlist(user_id, exchange, symbol_key);
    CREATE INDEX IF NOT EXISTS idx_user_recent_user_exch_sym
      ON user_recent_searches(user_id, exchange, symbol_key);
    CREATE INDEX IF NOT EXISTS idx_market_alerts_user_type_status
      ON market_alerts(user_id, alert_type, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_events_user_ack_time
      ON alert_events_history(user_id, acknowledged, triggered_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_notifications_user_cat_time
      ON alert_notifications(user_id, category, triggered_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
      ON user_sessions(expires_at);
  `);

  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (9, 'database_final_audit_hardening_and_composite_indexes', ?)
  `).run(nowIso);
}

function initializeSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS emergency_stop_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      activated_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_accounts (
      account_id TEXT PRIMARY KEY,
      capital REAL NOT NULL DEFAULT 100000,
      realized_pnl REAL NOT NULL DEFAULT 0,
      unrealized_pnl REAL NOT NULL DEFAULT 0,
      daily_pnl REAL NOT NULL DEFAULT 0,
      trades_today INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      max_daily_loss REAL NOT NULL DEFAULT 1000,
      max_loss_per_trade REAL NOT NULL DEFAULT 500,
      max_trades_per_day INTEGER NOT NULL DEFAULT 3,
      auto_paper_enabled INTEGER NOT NULL DEFAULT 1,
      session_date TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_orders (
      order_id TEXT PRIMARY KEY,
      client_order_key TEXT UNIQUE,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL DEFAULT 'NSE',
      direction TEXT NOT NULL,
      order_type TEXT NOT NULL,
      asset_type TEXT NOT NULL DEFAULT 'EQUITY',
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      stop_loss REAL,
      target REAL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'MANUAL_PAPER',
      reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_fills (
      fill_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      fill_price REAL NOT NULL,
      slippage REAL NOT NULL DEFAULT 0,
      fees REAL NOT NULL DEFAULT 0,
      filled_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_positions (
      position_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL DEFAULT 'NSE',
      direction TEXT NOT NULL,
      asset_type TEXT NOT NULL DEFAULT 'EQUITY',
      lot_size INTEGER,
      lots INTEGER,
      quantity INTEGER NOT NULL,
      effective_qty INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      average_price REAL NOT NULL,
      current_price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      target REAL NOT NULL,
      trailing_stop REAL,
      profit_step REAL NOT NULL DEFAULT 0,
      locked_profit REAL NOT NULL DEFAULT 0,
      next_profit_milestone REAL NOT NULL DEFAULT 0,
      target_activated INTEGER NOT NULL DEFAULT 0,
      exit_on_target INTEGER NOT NULL DEFAULT 0,
      unrealized_pnl REAL NOT NULL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'OPEN',
      mode TEXT NOT NULL DEFAULT 'MANUAL_PAPER',
      exit_reason TEXT,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_trade_results (
      trade_id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      target REAL NOT NULL,
      pnl REAL NOT NULL,
      reason TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      closed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      audit_id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_decisions (
      decision_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      signal TEXT NOT NULL,
      action TEXT NOT NULL,
      confidence REAL NOT NULL,
      risk TEXT NOT NULL,
      trend TEXT,
      source TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategy_decisions (
      strategy_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      decision TEXT NOT NULL,
      action TEXT NOT NULL,
      entry_price REAL,
      stop_loss REAL,
      target REAL,
      confidence REAL NOT NULL,
      strategy_version TEXT NOT NULL,
      data_quality TEXT NOT NULL,
      reason TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS risk_events (
      risk_event_id TEXT PRIMARY KEY,
      symbol TEXT,
      side TEXT,
      allowed INTEGER NOT NULL,
      risk_amount REAL NOT NULL DEFAULT 0,
      reasons_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backtest_runs (
      run_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      candles_processed INTEGER NOT NULL,
      total_trades INTEGER NOT NULL,
      win_rate REAL NOT NULL,
      gross_pnl REAL NOT NULL,
      net_pnl REAL NOT NULL,
      max_drawdown REAL NOT NULL,
      profit_factor REAL NOT NULL,
      metrics_json TEXT NOT NULL,
      trades_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_snapshots_cache (
      symbol_key TEXT PRIMARY KEY,
      exchange TEXT NOT NULL,
      price REAL,
      status TEXT NOT NULL,
      data_ready INTEGER NOT NULL DEFAULT 0,
      snapshot_json TEXT NOT NULL,
      quote_timestamp TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_paper_orders_created ON paper_orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_paper_positions_status ON paper_positions(status);
    CREATE INDEX IF NOT EXISTS idx_paper_trades_closed ON paper_trade_results(closed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_category ON audit_events(category, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_decisions_symbol ON ai_decisions(symbol, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_strategy_decisions_symbol ON strategy_decisions(symbol, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_risk_events_created ON risk_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_backtest_runs_created ON backtest_runs(created_at DESC);
  `);

  const nowIso = new Date().toISOString();
  const todayKey = nowIso.slice(0, 10);

  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (1, 'initial_single_sqlite_schema', ?)
  `).run(nowIso);

  db.prepare(`
    INSERT OR IGNORE INTO emergency_stop_state (id, active, reason, activated_at, updated_at)
    VALUES (1, 0, NULL, NULL, ?)
  `).run(nowIso);

  db.prepare(`
    INSERT OR IGNORE INTO paper_accounts (
      account_id, capital, realized_pnl, unrealized_pnl, daily_pnl,
      trades_today, wins, losses, max_daily_loss, max_loss_per_trade,
      max_trades_per_day, auto_paper_enabled, session_date, updated_at
    ) VALUES ('DEFAULT_PAPER', 100000, 0, 0, 0, 0, 0, 0, 1000, 500, 3, 1, ?, ?)
  `).run(todayKey, nowIso);

  applyMigrationV2UserAccountSystem(db, nowIso);
  applyMigrationV3MarketSearchSystem(db, nowIso);
  applyMigrationV4MarketIntelligenceSystem(db, nowIso);
  applyMigrationV5OrderFillTradeLifecycle(db, nowIso);
  applyMigrationV6BacktestRunHistory(db, nowIso);
  applyMigrationV7WatchlistAndMarketAlerts(db, nowIso);
  applyMigrationV8AlertNotificationsSystem(db, nowIso);
  applyMigrationV9DatabaseHardeningAndCompositeIndexes(db, nowIso);
}

function getDb(customPath) {
  const targetPath = resolveDbPath(customPath);

  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (_) {}
    dbInstance = null;
  }

  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  dbInstance = new DatabaseSync(targetPath);
  currentDbPath = targetPath;
  initializeSchema(dbInstance);
  return dbInstance;
}

function closeDb() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (_) {}
    dbInstance = null;
    currentDbPath = null;
  }
}

function withTransaction(fn, customPath) {
  const db = getDb(customPath);
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {}
    throw error;
  }
}

function resetAllTablesForTest() {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const todayKey = nowIso.slice(0, 10);

  withTransaction((tx) => {
    tx.exec(`
      DELETE FROM notification_delivery_logs;
      DELETE FROM alert_notifications;
      DELETE FROM user_notification_preferences;
      DELETE FROM alert_events_history;
      DELETE FROM market_alerts;
      DELETE FROM market_intelligence_cache;
      DELETE FROM user_watchlist;
      DELETE FROM user_recent_searches;
      DELETE FROM broker_instruments_cache;
      DELETE FROM email_change_verifications;
      DELETE FROM user_sessions;
      DELETE FROM users;
      DELETE FROM paper_orders;
      DELETE FROM paper_fills;
      DELETE FROM paper_positions;
      DELETE FROM paper_trade_results;
      DELETE FROM audit_events;
      DELETE FROM ai_decisions;
      DELETE FROM strategy_decisions;
      DELETE FROM risk_events;
      DELETE FROM backtest_runs;
      DELETE FROM market_snapshots_cache;
      DELETE FROM app_settings;
      DELETE FROM paper_accounts WHERE account_id != 'DEFAULT_PAPER';
    `);

    tx.prepare(`
      UPDATE emergency_stop_state
      SET active = 0, reason = NULL, activated_at = NULL, updated_at = ?
      WHERE id = 1
    `).run(nowIso);

    tx.prepare(`
      UPDATE paper_accounts
      SET capital = 100000,
          realized_pnl = 0,
          unrealized_pnl = 0,
          daily_pnl = 0,
          trades_today = 0,
          wins = 0,
          losses = 0,
          max_daily_loss = 1000,
          max_loss_per_trade = 500,
          max_trades_per_day = 3,
          auto_paper_enabled = 1,
          session_date = ?,
          updated_at = ?,
          user_id = NULL
      WHERE account_id = 'DEFAULT_PAPER'
    `).run(todayKey, nowIso);
  });
}

/* =====================================================
   SETTINGS & EMERGENCY STOP REPOSITORY
===================================================== */

function setSetting(key, value) {
  const db = getDb();
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(String(key), safeJsonStringify(value), nowIso);
}

function getSetting(key, fallback = null) {
  const db = getDb();
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(String(key));
  if (!row) return fallback;
  return safeJsonParse(row.value_json, fallback);
}

function getEmergencyStop() {
  const db = getDb();
  const row = db.prepare('SELECT active, reason, activated_at, updated_at FROM emergency_stop_state WHERE id = 1').get();
  if (!row) {
    return { active: false, reason: null, activatedAt: null };
  }
  return {
    active: Boolean(row.active),
    reason: row.reason || null,
    activatedAt: row.activated_at || null,
    updatedAt: row.updated_at || null
  };
}

function setEmergencyStop(active, reason = null) {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const isAct = active ? 1 : 0;
  const activatedAt = isAct ? nowIso : null;
  const cleanReason = isAct ? String(reason || 'Emergency Stop Activated') : null;

  db.prepare(`
    UPDATE emergency_stop_state
    SET active = ?, reason = ?, activated_at = ?, updated_at = ?
    WHERE id = 1
  `).run(isAct, cleanReason, activatedAt, nowIso);

  return getEmergencyStop();
}

/* =====================================================
   USER ACCOUNT & SESSION REPOSITORY (TASK 2)
===================================================== */

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function mapUserRow(row, includeSecrets = false) {
  if (!row) return null;
  const user = {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    emailNormalized: row.email_normalized,
    emailVerified: Boolean(row.email_verified),
    settings: safeJsonParse(row.settings_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (includeSecrets) {
    user.passwordHash = row.password_hash;
    user.passwordAlgo = row.password_algo;
  }
  return user;
}

function ensureUserPaperAccount(userId, txOrDb = null) {
  if (!userId) return getPaperAccount(null);
  const db = txOrDb || getDb();
  const nowIso = new Date().toISOString();
  const todayKey = nowIso.slice(0, 10);
  const accountId = `PAPER_ACCT_${userId}`;

  db.prepare(`
    INSERT OR IGNORE INTO paper_accounts (
      account_id, user_id, capital, realized_pnl, unrealized_pnl, daily_pnl,
      trades_today, wins, losses, max_daily_loss, max_loss_per_trade,
      max_trades_per_day, auto_paper_enabled, session_date, updated_at
    ) VALUES (?, ?, 100000, 0, 0, 0, 0, 0, 0, 1000, 500, 3, 1, ?, ?)
  `).run(accountId, String(userId), todayKey, nowIso);

  return accountId;
}

function createUserRecord(payload) {
  const emailNorm = normalizeEmail(payload.email);
  const nowIso = payload.createdAt || new Date().toISOString();

  return withTransaction((tx) => {
    const existing = tx
      .prepare('SELECT user_id FROM users WHERE email_normalized = ?')
      .get(emailNorm);

    if (existing) {
      const err = new Error('An account with this email already exists.');
      err.code = 'DUPLICATE_EMAIL';
      throw err;
    }

    tx.prepare(`
      INSERT INTO users (
        user_id, name, email, email_normalized, password_hash,
        password_algo, email_verified, settings_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(payload.userId),
      String(payload.name).trim(),
      String(payload.email).trim(),
      emailNorm,
      String(payload.passwordHash),
      String(payload.passwordAlgo || 'bcrypt'),
      payload.emailVerified === false ? 0 : 1,
      safeJsonStringify(payload.settings || { theme: 'dark', notifications: true }),
      nowIso,
      nowIso
    );

    ensureUserPaperAccount(payload.userId, tx);

    const row = tx.prepare('SELECT * FROM users WHERE user_id = ?').get(String(payload.userId));
    return mapUserRow(row, false);
  });
}

function getUserByEmail(email, includeSecrets = false) {
  const db = getDb();
  const emailNorm = normalizeEmail(email);
  if (!emailNorm) return null;
  const row = db.prepare('SELECT * FROM users WHERE email_normalized = ?').get(emailNorm);
  return mapUserRow(row, includeSecrets);
}

function getUserById(userId, includeSecrets = false) {
  const db = getDb();
  if (!userId) return null;
  const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(String(userId));
  return mapUserRow(row, includeSecrets);
}

function updateUserNameAndSettings(userId, updates = {}) {
  const db = getDb();
  const existing = getUserById(userId, false);
  if (!existing) {
    const err = new Error('User not found.');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const nowIso = new Date().toISOString();
  const nextName =
    updates.name !== undefined ? String(updates.name).trim() : existing.name;
  const nextSettings =
    updates.settings && typeof updates.settings === 'object'
      ? { ...existing.settings, ...updates.settings }
      : existing.settings;

  db.prepare(`
    UPDATE users
    SET name = ?, settings_json = ?, updated_at = ?
    WHERE user_id = ?
  `).run(nextName, safeJsonStringify(nextSettings), nowIso, String(userId));

  return getUserById(userId, false);
}

function updateUserPasswordHash(userId, passwordHash, passwordAlgo = 'bcrypt') {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const info = db.prepare(`
    UPDATE users
    SET password_hash = ?, password_algo = ?, updated_at = ?
    WHERE user_id = ?
  `).run(String(passwordHash), String(passwordAlgo), nowIso, String(userId));

  if (!info || info.changes === 0) {
    const err = new Error('User not found.');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  return getUserById(userId, false);
}

function updateUserEmailDirect(userId, newEmail) {
  const emailTrimmed = String(newEmail || '').trim();
  const emailNorm = normalizeEmail(emailTrimmed);
  const nowIso = new Date().toISOString();

  return withTransaction((tx) => {
    const conflict = tx
      .prepare('SELECT user_id FROM users WHERE email_normalized = ? AND user_id != ?')
      .get(emailNorm, String(userId));

    if (conflict) {
      const err = new Error('Email is already in use by another account.');
      err.code = 'DUPLICATE_EMAIL';
      throw err;
    }

    tx.prepare(`
      UPDATE users
      SET email = ?, email_normalized = ?, email_verified = 1, updated_at = ?
      WHERE user_id = ?
    `).run(emailTrimmed, emailNorm, nowIso, String(userId));

    tx.prepare(`
      UPDATE email_change_verifications
      SET status = 'SUPERSEDED'
      WHERE user_id = ? AND status = 'PENDING'
    `).run(String(userId));

    const row = tx.prepare('SELECT * FROM users WHERE user_id = ?').get(String(userId));
    return mapUserRow(row, false);
  });
}

function createEmailChangeVerification(payload) {
  const emailTrimmed = String(payload.newEmail || '').trim();
  const emailNorm = normalizeEmail(emailTrimmed);
  const nowIso = payload.createdAt || new Date().toISOString();

  return withTransaction((tx) => {
    const conflict = tx
      .prepare('SELECT user_id FROM users WHERE email_normalized = ? AND user_id != ?')
      .get(emailNorm, String(payload.userId));

    if (conflict) {
      const err = new Error('Email is already in use by another account.');
      err.code = 'DUPLICATE_EMAIL';
      throw err;
    }

    tx.prepare(`
      UPDATE email_change_verifications
      SET status = 'SUPERSEDED'
      WHERE user_id = ? AND status = 'PENDING'
    `).run(String(payload.userId));

    tx.prepare(`
      INSERT INTO email_change_verifications (
        verification_id, user_id, new_email, new_email_normalized,
        token_hash, status, created_at, expires_at, verified_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, NULL)
    `).run(
      String(payload.verificationId),
      String(payload.userId),
      emailTrimmed,
      emailNorm,
      String(payload.tokenHash),
      nowIso,
      String(payload.expiresAt)
    );

    return {
      verificationId: payload.verificationId,
      userId: payload.userId,
      newEmail: emailTrimmed,
      newEmailNormalized: emailNorm,
      status: 'PENDING',
      createdAt: nowIso,
      expiresAt: payload.expiresAt
    };
  });
}

function getPendingEmailChangeForUser(userId) {
  const db = getDb();
  if (!userId) return null;
  const nowIso = new Date().toISOString();
  const row = db.prepare(`
    SELECT * FROM email_change_verifications
    WHERE user_id = ? AND status = 'PENDING' AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(String(userId), nowIso);

  if (!row) return null;
  return {
    verificationId: row.verification_id,
    userId: row.user_id,
    newEmail: row.new_email,
    newEmailNormalized: row.new_email_normalized,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

function confirmEmailChangeByTokenHash(tokenHash, userId = null) {
  const nowIso = new Date().toISOString();

  return withTransaction((tx) => {
    const row = tx.prepare(`
      SELECT * FROM email_change_verifications
      WHERE token_hash = ?
    `).get(String(tokenHash));

    if (!row || row.status !== 'PENDING') {
      const err = new Error('Invalid or already used email verification token.');
      err.code = 'INVALID_VERIFICATION_TOKEN';
      throw err;
    }

    if (userId && String(row.user_id) !== String(userId)) {
      const err = new Error('Verification token does not belong to the current user.');
      err.code = 'FORBIDDEN_VERIFICATION_TOKEN';
      throw err;
    }

    if (Date.parse(row.expires_at) <= Date.parse(nowIso)) {
      tx.prepare(`
        UPDATE email_change_verifications
        SET status = 'EXPIRED'
        WHERE verification_id = ?
      `).run(row.verification_id);

      const err = new Error('Email verification token has expired.');
      err.code = 'EXPIRED_VERIFICATION_TOKEN';
      throw err;
    }

    const conflict = tx
      .prepare('SELECT user_id FROM users WHERE email_normalized = ? AND user_id != ?')
      .get(row.new_email_normalized, row.user_id);

    if (conflict) {
      const err = new Error('Email is already in use by another account.');
      err.code = 'DUPLICATE_EMAIL';
      throw err;
    }

    tx.prepare(`
      UPDATE users
      SET email = ?, email_normalized = ?, email_verified = 1, updated_at = ?
      WHERE user_id = ?
    `).run(row.new_email, row.new_email_normalized, nowIso, row.user_id);

    tx.prepare(`
      UPDATE email_change_verifications
      SET status = 'VERIFIED', verified_at = ?
      WHERE verification_id = ?
    `).run(nowIso, row.verification_id);

    const updatedUser = tx.prepare('SELECT * FROM users WHERE user_id = ?').get(row.user_id);
    return mapUserRow(updatedUser, false);
  });
}

function createSessionRecord(session) {
  const db = getDb();
  const nowIso = session.createdAt || new Date().toISOString();

  db.prepare(`
    INSERT INTO user_sessions (
      session_id, user_id, token_hash, csrf_token,
      ip_address, user_agent, created_at, expires_at, revoked_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(
    String(session.sessionId),
    String(session.userId),
    String(session.tokenHash),
    String(session.csrfToken),
    session.ipAddress ? String(session.ipAddress) : null,
    session.userAgent ? String(session.userAgent).slice(0, 255) : null,
    nowIso,
    String(session.expiresAt),
    nowIso
  );

  return {
    sessionId: session.sessionId,
    userId: session.userId,
    csrfToken: session.csrfToken,
    createdAt: nowIso,
    expiresAt: session.expiresAt
  };
}

function getActiveSessionByTokenHash(tokenHash, nowMs = Date.now()) {
  const db = getDb();
  if (!tokenHash) return null;

  const row = db.prepare(`
    SELECT
      s.session_id, s.user_id, s.csrf_token, s.created_at, s.expires_at, s.revoked_at, s.last_seen_at,
      u.name, u.email, u.email_normalized, u.email_verified, u.settings_json,
      u.created_at AS user_created_at, u.updated_at AS user_updated_at
    FROM user_sessions s
    INNER JOIN users u ON u.user_id = s.user_id
    WHERE s.token_hash = ?
  `).get(String(tokenHash));

  if (!row) return null;
  if (row.revoked_at) return null;

  const expiresMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    return null;
  }

  return {
    session: {
      sessionId: row.session_id,
      userId: row.user_id,
      csrfToken: row.csrf_token,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at
    },
    user: {
      userId: row.user_id,
      name: row.name,
      email: row.email,
      emailNormalized: row.email_normalized,
      emailVerified: Boolean(row.email_verified),
      settings: safeJsonParse(row.settings_json, {}),
      createdAt: row.user_created_at,
      updatedAt: row.user_updated_at
    }
  };
}

function touchSession(sessionId) {
  const db = getDb();
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE user_sessions
    SET last_seen_at = ?
    WHERE session_id = ? AND revoked_at IS NULL
  `).run(nowIso, String(sessionId));
}

function revokeSessionByTokenHash(tokenHash) {
  const db = getDb();
  if (!tokenHash) return false;
  const nowIso = new Date().toISOString();
  const info = db.prepare(`
    UPDATE user_sessions
    SET revoked_at = ?
    WHERE token_hash = ? AND revoked_at IS NULL
  `).run(nowIso, String(tokenHash));
  return Boolean(info && info.changes > 0);
}

function revokeAllUserSessions(userId, exceptSessionId = null) {
  const db = getDb();
  const nowIso = new Date().toISOString();
  if (exceptSessionId) {
    db.prepare(`
      UPDATE user_sessions
      SET revoked_at = ?
      WHERE user_id = ? AND session_id != ? AND revoked_at IS NULL
    `).run(nowIso, String(userId), String(exceptSessionId));
  } else {
    db.prepare(`
      UPDATE user_sessions
      SET revoked_at = ?
      WHERE user_id = ? AND revoked_at IS NULL
    `).run(nowIso, String(userId));
  }
}

/* =====================================================
   PAPER TRADING PERSISTENCE (MULTI-USER OWNERSHIP ISOLATED)
   - When userId is provided: strictly scopes to that user's records
   - When userId is null/omitted: scopes to legacy/system records (user_id IS NULL)
   - Never auto-attaches ambiguous legacy records to any user
===================================================== */

function getPaperAccount(userId = null) {
  const db = getDb();
  let row;
  if (userId) {
    ensureUserPaperAccount(userId, db);
    row = db.prepare(`SELECT * FROM paper_accounts WHERE user_id = ?`).get(String(userId));
  } else {
    row = db.prepare(`SELECT * FROM paper_accounts WHERE account_id = 'DEFAULT_PAPER' AND user_id IS NULL`).get();
  }

  if (!row) return null;
  const openPos = getOpenPosition(userId);
  const capital = Number(row.capital);
  const realizedPnl = Number(row.realized_pnl);
  const dailyPnl = Number(row.daily_pnl);
  const unrealizedPnl = openPos ? Number(openPos.unrealizedPnl || 0) : Number(row.unrealized_pnl || 0);
  const reservedCapital = openPos ? Math.abs(Number(openPos.entry || 0) * Number(openPos.effectiveQty || openPos.qty || 0)) : 0;
  const availableBalance = Math.max(0, capital + realizedPnl - reservedCapital);
  const totalEquity = capital + realizedPnl + unrealizedPnl;
  const effectiveDailyPnl = dailyPnl + unrealizedPnl;

  return {
    accountId: row.account_id,
    userId: row.user_id || null,
    capital,
    reservedCapital,
    availableBalance,
    totalEquity,
    realizedPnl,
    unrealizedPnl,
    dailyPnl,
    effectiveDailyPnl,
    tradesToday: Number(row.trades_today),
    wins: Number(row.wins),
    losses: Number(row.losses),
    maxDailyLoss: Number(row.max_daily_loss),
    maxLossPerTrade: Number(row.max_loss_per_trade),
    maxTradesPerDay: Number(row.max_trades_per_day),
    autoPaperEnabled: Boolean(row.auto_paper_enabled),
    sessionDate: row.session_date,
    updatedAt: row.updated_at
  };
}

function mapPositionRow(row) {
  if (!row) return null;
  return {
    id: row.position_id,
    userId: row.user_id || null,
    orderId: row.order_id,
    symbol: row.symbol,
    exchange: row.exchange,
    direction: row.direction,
    assetType: row.asset_type,
    lotSize: row.lot_size,
    lots: row.lots,
    qty: Number(row.quantity),
    effectiveQty: Number(row.effective_qty),
    entry: Number(row.entry_price),
    averagePrice: Number(row.average_price),
    current: Number(row.current_price),
    stop: Number(row.stop_loss),
    target: Number(row.target),
    trailingStop: row.trailing_stop !== null ? Number(row.trailing_stop) : null,
    positionValue: Math.abs(Number(row.entry_price) * Number(row.effective_qty)),
    profitStep: Number(row.profit_step),
    lockedProfit: Number(row.locked_profit),
    nextProfitMilestone: Number(row.next_profit_milestone),
    targetActivated: Boolean(row.target_activated),
    exitOnTarget: Boolean(row.exit_on_target),
    unrealizedPnl: Number(row.unrealized_pnl),
    realizedPnl: Number(row.realized_pnl),
    status: row.status,
    mode: row.mode,
    openedAt: row.opened_at,
    updatedAt: row.updated_at
  };
}

function getOpenPosition(userId = null) {
  const db = getDb();
  const row = userId
    ? db.prepare(`
        SELECT * FROM paper_positions
        WHERE status = 'OPEN' AND user_id = ?
        ORDER BY opened_at DESC
        LIMIT 1
      `).get(String(userId))
    : db.prepare(`
        SELECT * FROM paper_positions
        WHERE status = 'OPEN' AND user_id IS NULL
        ORDER BY opened_at DESC
        LIMIT 1
      `).get();

  return mapPositionRow(row);
}

function getPositionByIdForUser(positionId, userId = null) {
  const db = getDb();
  if (!positionId) return null;
  const row = db.prepare(`SELECT * FROM paper_positions WHERE position_id = ?`).get(String(positionId));
  if (!row) return null;
  const rowOwner = row.user_id || null;
  const reqOwner = userId ? String(userId) : null;
  if (rowOwner !== reqOwner) {
    const err = new Error('Access denied: position belongs to a different owner scope.');
    err.code = 'FORBIDDEN_OWNERSHIP';
    throw err;
  }
  return mapPositionRow(row);
}

function recordOpenPositionTransaction(payload) {
  const userId = payload.userId ? String(payload.userId) : null;

  const entryNum = Number(payload.entry);
  const stopNum = Number(payload.stop);
  const qtyNum = Number(payload.effectiveQty ?? payload.qty);

  if (!Number.isFinite(entryNum) || entryNum <= 0) {
    const err = new Error('A positive finite entry price is required to open a paper position.');
    err.code = 'INVALID_ENTRY_PRICE';
    throw err;
  }
  if (!Number.isFinite(stopNum) || stopNum <= 0) {
    const err = new Error('A mandatory positive finite stop-loss price is required to open a paper position.');
    err.code = 'STOP_LOSS_REQUIRED';
    throw err;
  }
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
    const err = new Error('A positive finite quantity is required to open a paper position.');
    err.code = 'INVALID_QUANTITY';
    throw err;
  }

  return withTransaction((tx) => {
    if (payload.clientOrderKey) {
      const dupKey = tx
        .prepare('SELECT order_id FROM paper_orders WHERE client_order_key = ? LIMIT 1')
        .get(String(payload.clientOrderKey));
      if (dupKey) {
        const err = new Error('Duplicate order request rejected (clientOrderKey already exists).');
        err.code = 'DUPLICATE_ORDER_REQUEST';
        throw err;
      }
    }

    const existing = userId
      ? tx.prepare(`SELECT position_id FROM paper_positions WHERE status = 'OPEN' AND user_id = ? LIMIT 1`).get(userId)
      : tx.prepare(`SELECT position_id FROM paper_positions WHERE status = 'OPEN' AND user_id IS NULL LIMIT 1`).get();

    if (existing) {
      const err = new Error('An open paper position already exists.');
      err.code = 'DUPLICATE_OPEN_POSITION';
      throw err;
    }

    const accountId = userId ? ensureUserPaperAccount(userId, tx) : 'DEFAULT_PAPER';
    const nowIso = payload.openedAt || new Date().toISOString();
    const orderId = payload.orderId || `PAPER-ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const fillId = payload.fillId || `PAPER-FILL-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const positionId = payload.id || `PAPER-POS-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    tx.prepare(`
      INSERT INTO paper_orders (
        order_id, user_id, client_order_key, symbol, exchange, direction,
        order_type, asset_type, lot_size, lots, quantity, price, stop_loss, target,
        status, mode, reason, rejection_reason, position_id, trade_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ENTRY', ?, ?, ?, ?, ?, ?, ?, 'FILLED_PAPER', ?, ?, NULL, ?, NULL, ?)
    `).run(
      orderId,
      userId,
      payload.clientOrderKey || null,
      payload.symbol,
      payload.exchange || 'NSE',
      payload.direction,
      payload.assetType || 'EQUITY',
      payload.lotSize ?? null,
      payload.lots ?? null,
      payload.effectiveQty,
      payload.entry,
      payload.stop,
      payload.target,
      payload.mode || 'MANUAL_PAPER',
      payload.reason || 'Paper position entry',
      positionId,
      nowIso
    );

    tx.prepare(`
      INSERT INTO paper_fills (
        fill_id, user_id, order_id, position_id, trade_id, symbol, exchange, direction,
        asset_type, order_type, quantity, fill_price, slippage, fees, data_source, filled_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'ENTRY', ?, ?, ?, ?, ?, ?)
    `).run(
      fillId,
      userId,
      orderId,
      positionId,
      payload.symbol,
      payload.exchange || 'NSE',
      payload.direction,
      payload.assetType || 'EQUITY',
      payload.effectiveQty,
      payload.entry,
      Number(payload.slippage || 0),
      Number(payload.fees || 0),
      payload.dataSource || 'VALIDATED_PAPER_QUOTE',
      nowIso
    );

    tx.prepare(`
      INSERT INTO paper_positions (
        position_id, user_id, order_id, symbol, exchange, direction, asset_type,
        lot_size, lots, quantity, effective_qty, entry_price, average_price,
        current_price, stop_loss, target, trailing_stop, profit_step,
        locked_profit, next_profit_milestone, target_activated, exit_on_target,
        unrealized_pnl, realized_pnl, status, mode, opened_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, 0, ?, 0, 0, 'OPEN', ?, ?, ?)
    `).run(
      positionId,
      userId,
      orderId,
      payload.symbol,
      payload.exchange || 'NSE',
      payload.direction,
      payload.assetType || 'EQUITY',
      payload.lotSize ?? null,
      payload.lots ?? null,
      payload.qty,
      payload.effectiveQty,
      payload.entry,
      payload.entry,
      payload.entry,
      payload.stop,
      payload.target,
      payload.profitStep || 0,
      payload.profitStep || 0,
      payload.exitOnTarget ? 1 : 0,
      payload.mode || 'MANUAL_PAPER',
      nowIso,
      nowIso
    );

    tx.prepare(`
      UPDATE paper_accounts
      SET trades_today = trades_today + 1,
          unrealized_pnl = 0,
          updated_at = ?
      WHERE account_id = ?
    `).run(nowIso, accountId);

    return { orderId, fillId, positionId, userId };
  });
}

function recordRejectedPaperOrder(payload = {}, userId = null) {
  const db = getDb();
  const ownerId = userId !== null ? (userId ? String(userId) : null) : (payload.userId ? String(payload.userId) : null);
  const nowIso = payload.timestamp || new Date().toISOString();
  const orderId = payload.orderId || `PAPER-ORD-REJ-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const reasonText = String(payload.rejectionReason || payload.reason || 'Order rejected by safety/risk checks');

  db.prepare(`
    INSERT INTO paper_orders (
      order_id, user_id, client_order_key, symbol, exchange, direction,
      order_type, asset_type, lot_size, lots, quantity, price, stop_loss, target,
      status, mode, reason, rejection_reason, position_id, trade_id, created_at
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REJECTED', ?, ?, ?, NULL, NULL, ?)
  `).run(
    orderId,
    ownerId,
    String(payload.symbol || 'NIFTY 50'),
    String(payload.exchange || 'NSE').toUpperCase(),
    String(payload.direction || payload.side || 'BUY').toUpperCase(),
    String(payload.orderType || 'ENTRY').toUpperCase(),
    String(payload.assetType || 'EQUITY').toUpperCase(),
    payload.lotSize ?? null,
    payload.lots ?? null,
    Number.isFinite(Number(payload.effectiveQty ?? payload.qty ?? payload.quantity))
      ? Math.max(0, Math.trunc(Number(payload.effectiveQty ?? payload.qty ?? payload.quantity)))
      : 0,
    Number.isFinite(Number(payload.entry ?? payload.price)) ? Number(payload.entry ?? payload.price) : 0,
    Number.isFinite(Number(payload.stop ?? payload.stopLoss)) ? Number(payload.stop ?? payload.stopLoss) : null,
    Number.isFinite(Number(payload.target)) ? Number(payload.target) : null,
    String(payload.mode || 'MANUAL_PAPER'),
    reasonText,
    reasonText,
    nowIso
  );

  return {
    orderId,
    userId: ownerId,
    status: 'REJECTED',
    rejectionReason: reasonText,
    timestamp: nowIso
  };
}

function updateOpenPositionState(positionState, userId = null) {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const ownerId = userId !== null ? String(userId) : (positionState.userId ? String(positionState.userId) : null);

  if (ownerId) {
    const info = db.prepare(`
      UPDATE paper_positions
      SET current_price = ?,
          trailing_stop = ?,
          locked_profit = ?,
          next_profit_milestone = ?,
          target_activated = ?,
          unrealized_pnl = ?,
          updated_at = ?
      WHERE position_id = ? AND status = 'OPEN' AND user_id = ?
    `).run(
      Number(positionState.current),
      positionState.trailingStop !== undefined && positionState.trailingStop !== null
        ? Number(positionState.trailingStop)
        : null,
      Number(positionState.lockedProfit || 0),
      Number(positionState.nextProfitMilestone || 0),
      positionState.targetActivated ? 1 : 0,
      Number(positionState.unrealizedPnl || 0),
      nowIso,
      positionState.id,
      ownerId
    );

    if (info && info.changes > 0) {
      db.prepare(`
        UPDATE paper_accounts
        SET unrealized_pnl = ?,
            updated_at = ?
        WHERE user_id = ?
      `).run(Number(positionState.unrealizedPnl || 0), nowIso, ownerId);
    }
  } else {
    db.prepare(`
      UPDATE paper_positions
      SET current_price = ?,
          trailing_stop = ?,
          locked_profit = ?,
          next_profit_milestone = ?,
          target_activated = ?,
          unrealized_pnl = ?,
          updated_at = ?
      WHERE position_id = ? AND status = 'OPEN' AND user_id IS NULL
    `).run(
      Number(positionState.current),
      positionState.trailingStop !== undefined && positionState.trailingStop !== null
        ? Number(positionState.trailingStop)
        : null,
      Number(positionState.lockedProfit || 0),
      Number(positionState.nextProfitMilestone || 0),
      positionState.targetActivated ? 1 : 0,
      Number(positionState.unrealizedPnl || 0),
      nowIso,
      positionState.id
    );

    db.prepare(`
      UPDATE paper_accounts
      SET unrealized_pnl = ?,
          updated_at = ?
      WHERE account_id = 'DEFAULT_PAPER' AND user_id IS NULL
    `).run(Number(positionState.unrealizedPnl || 0), nowIso);
  }
}

function recordClosePositionTransaction(closePayload) {
  const userId = closePayload.userId ? String(closePayload.userId) : null;

  return withTransaction((tx) => {
    const posRow = tx
      .prepare('SELECT position_id, user_id, order_id, exchange, lot_size, lots, status FROM paper_positions WHERE position_id = ?')
      .get(String(closePayload.positionId));

    if (posRow) {
      const posOwner = posRow.user_id || null;
      if (posOwner !== userId) {
        const err = new Error('Cannot close a position owned by another user.');
        err.code = 'FORBIDDEN_OWNERSHIP';
        throw err;
      }
      if (String(posRow.status || '').toUpperCase() === 'CLOSED') {
        const err = new Error('Position is already closed.');
        err.code = 'POSITION_ALREADY_CLOSED';
        throw err;
      }
    }

    const entryOrderId = closePayload.entryOrderId || posRow?.order_id || null;
    const entryFillRow = entryOrderId
      ? tx.prepare('SELECT fill_id, fees FROM paper_fills WHERE order_id = ? LIMIT 1').get(String(entryOrderId))
      : null;
    const entryFillId = closePayload.entryFillId || entryFillRow?.fill_id || null;

    const accountId = userId ? ensureUserPaperAccount(userId, tx) : 'DEFAULT_PAPER';
    const nowIso = closePayload.closedAt || new Date().toISOString();
    const exitOrderId = closePayload.exitOrderId || `PAPER-ORD-EXIT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const fillId = closePayload.exitFillId || `PAPER-FILL-EXIT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const tradeId = closePayload.tradeId || `PAPER-TRD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const exitDirection = closePayload.direction === 'BUY' ? 'SELL' : 'BUY';
    const exchange = closePayload.exchange || posRow?.exchange || 'NSE';
    const lotSize = closePayload.lotSize !== undefined ? closePayload.lotSize : (posRow?.lot_size ?? null);
    const lots = closePayload.lots !== undefined ? closePayload.lots : (posRow?.lots ?? null);
    const exitFees = Number(closePayload.fees || 0);
    const totalFees = Number(entryFillRow?.fees || 0) + exitFees;
    const grossPnl =
      closePayload.grossPnl !== undefined && Number.isFinite(Number(closePayload.grossPnl))
        ? Number(closePayload.grossPnl)
        : Number(closePayload.pnl || 0) + totalFees;
    const pnl = Number(closePayload.pnl || 0);
    const isWin = pnl > 0 ? 1 : 0;
    const isLoss = pnl <= 0 ? 1 : 0;

    tx.prepare(`
      INSERT INTO paper_orders (
        order_id, user_id, client_order_key, symbol, exchange, direction,
        order_type, asset_type, lot_size, lots, quantity, price, stop_loss, target,
        status, mode, reason, rejection_reason, position_id, trade_id, created_at
      ) VALUES (?, ?, NULL, ?, ?, ?, 'EXIT', ?, ?, ?, ?, ?, ?, ?, 'FILLED_PAPER', ?, ?, NULL, ?, ?, ?)
    `).run(
      exitOrderId,
      userId,
      closePayload.symbol,
      exchange,
      exitDirection,
      closePayload.assetType || 'EQUITY',
      lotSize,
      lots,
      closePayload.effectiveQty,
      closePayload.exitPrice,
      closePayload.stop,
      closePayload.target,
      closePayload.mode || 'MANUAL_PAPER',
      closePayload.reason || 'MANUAL',
      closePayload.positionId,
      tradeId,
      nowIso
    );

    tx.prepare(`
      INSERT INTO paper_fills (
        fill_id, user_id, order_id, position_id, trade_id, symbol, exchange, direction,
        asset_type, order_type, quantity, fill_price, slippage, fees, data_source, filled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EXIT', ?, ?, 0, ?, ?, ?)
    `).run(
      fillId,
      userId,
      exitOrderId,
      closePayload.positionId,
      tradeId,
      closePayload.symbol,
      exchange,
      exitDirection,
      closePayload.assetType || 'EQUITY',
      closePayload.effectiveQty,
      closePayload.exitPrice,
      exitFees,
      closePayload.dataSource || 'VALIDATED_PAPER_QUOTE',
      nowIso
    );

    if (entryOrderId) {
      tx.prepare(`UPDATE paper_orders SET trade_id = ? WHERE order_id = ?`).run(tradeId, String(entryOrderId));
      tx.prepare(`UPDATE paper_fills SET trade_id = ? WHERE order_id = ?`).run(tradeId, String(entryOrderId));
    }

    if (userId) {
      tx.prepare(`
        UPDATE paper_positions
        SET current_price = ?,
            unrealized_pnl = 0,
            realized_pnl = ?,
            status = 'CLOSED',
            exit_reason = ?,
            closed_at = ?,
            updated_at = ?
        WHERE position_id = ? AND user_id = ?
      `).run(
        closePayload.exitPrice,
        pnl,
        closePayload.reason || 'MANUAL',
        nowIso,
        nowIso,
        closePayload.positionId,
        userId
      );
    } else {
      tx.prepare(`
        UPDATE paper_positions
        SET current_price = ?,
            unrealized_pnl = 0,
            realized_pnl = ?,
            status = 'CLOSED',
            exit_reason = ?,
            closed_at = ?,
            updated_at = ?
        WHERE position_id = ? AND user_id IS NULL
      `).run(
        closePayload.exitPrice,
        pnl,
        closePayload.reason || 'MANUAL',
        nowIso,
        nowIso,
        closePayload.positionId
      );
    }

    tx.prepare(`
      INSERT INTO paper_trade_results (
        trade_id, user_id, position_id, entry_order_id, exit_order_id, entry_fill_id, exit_fill_id,
        symbol, exchange, direction, asset_type, lot_size, lots,
        quantity, entry_price, exit_price, stop_loss, target,
        gross_pnl, fees, pnl, reason, mode, opened_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tradeId,
      userId,
      closePayload.positionId,
      entryOrderId,
      exitOrderId,
      entryFillId,
      fillId,
      closePayload.symbol,
      exchange,
      closePayload.direction,
      closePayload.assetType || 'EQUITY',
      lotSize,
      lots,
      closePayload.effectiveQty,
      closePayload.entry,
      closePayload.exitPrice,
      closePayload.stop,
      closePayload.target,
      grossPnl,
      totalFees,
      pnl,
      closePayload.reason || 'MANUAL',
      closePayload.mode || 'MANUAL_PAPER',
      closePayload.openedAt || nowIso,
      nowIso
    );

    tx.prepare(`
      UPDATE paper_accounts
      SET realized_pnl = realized_pnl + ?,
          daily_pnl = daily_pnl + ?,
          unrealized_pnl = 0,
          wins = wins + ?,
          losses = losses + ?,
          updated_at = ?
      WHERE account_id = ?
    `).run(pnl, pnl, isWin, isLoss, nowIso, accountId);

    return {
      entryOrderId,
      exitOrderId,
      entryFillId,
      fillId,
      exitFillId: fillId,
      tradeId,
      userId
    };
  });
}

function clampQueryLimit(limit, defaultVal = 50, maxVal = 1000) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return defaultVal;
  return Math.max(1, Math.min(maxVal, Math.trunc(n)));
}

function listPaperOrders(limit = 50, userId = null) {
  const db = getDb();
  const maxLimit = clampQueryLimit(limit, 50, 1000);
  const rows = userId
    ? db.prepare(`
        SELECT * FROM paper_orders
        WHERE user_id = ?
        ORDER BY created_at DESC, order_id DESC
        LIMIT ?
      `).all(String(userId), maxLimit)
    : db.prepare(`
        SELECT * FROM paper_orders
        WHERE user_id IS NULL
        ORDER BY created_at DESC, order_id DESC
        LIMIT ?
      `).all(maxLimit);

  return rows.map((r) => ({
    orderId: r.order_id,
    userId: r.user_id || null,
    clientOrderKey: r.client_order_key || null,
    positionId: r.position_id || null,
    tradeId: r.trade_id || null,
    type: r.order_type,
    symbol: r.symbol,
    exchange: r.exchange || 'NSE',
    direction: r.direction,
    assetType: r.asset_type || 'EQUITY',
    lotSize: r.lot_size !== null && r.lot_size !== undefined ? Number(r.lot_size) : null,
    lots: r.lots !== null && r.lots !== undefined ? Number(r.lots) : null,
    quantity: Number(r.quantity),
    price: Number(r.price),
    stop: r.stop_loss !== null ? Number(r.stop_loss) : null,
    target: r.target !== null ? Number(r.target) : null,
    status: r.status,
    mode: r.mode,
    reason: r.reason,
    rejectionReason: r.rejection_reason || (r.status === 'REJECTED' ? r.reason : null),
    timestamp: r.created_at
  }));
}

function listPaperFills(limit = 50, userId = null) {
  const db = getDb();
  const maxLimit = clampQueryLimit(limit, 50, 1000);
  const rows = userId
    ? db.prepare(`
        SELECT * FROM paper_fills
        WHERE user_id = ?
        ORDER BY filled_at DESC, fill_id DESC
        LIMIT ?
      `).all(String(userId), maxLimit)
    : db.prepare(`
        SELECT * FROM paper_fills
        WHERE user_id IS NULL
        ORDER BY filled_at DESC, fill_id DESC
        LIMIT ?
      `).all(maxLimit);

  return rows.map((r) => ({
    fillId: r.fill_id,
    userId: r.user_id || null,
    orderId: r.order_id,
    positionId: r.position_id || null,
    tradeId: r.trade_id || null,
    symbol: r.symbol,
    exchange: r.exchange || 'NSE',
    direction: r.direction,
    assetType: r.asset_type || 'EQUITY',
    orderType: r.order_type || 'ENTRY',
    quantity: Number(r.quantity),
    fillPrice: Number(r.fill_price),
    slippage: Number(r.slippage),
    fees: Number(r.fees),
    dataSource: r.data_source || 'VALIDATED_PAPER_QUOTE',
    filledAt: r.filled_at
  }));
}

function listTradeHistory(limit = 50, userId = null) {
  const db = getDb();
  const maxLimit = clampQueryLimit(limit, 50, 1000);
  const rows = userId
    ? db.prepare(`
        SELECT * FROM paper_trade_results
        WHERE user_id = ?
        ORDER BY closed_at DESC, trade_id DESC
        LIMIT ?
      `).all(String(userId), maxLimit)
    : db.prepare(`
        SELECT * FROM paper_trade_results
        WHERE user_id IS NULL
        ORDER BY closed_at DESC, trade_id DESC
        LIMIT ?
      `).all(maxLimit);

  return rows.map((r) => ({
    id: r.trade_id,
    tradeId: r.trade_id,
    userId: r.user_id || null,
    positionId: r.position_id,
    entryOrderId: r.entry_order_id || null,
    exitOrderId: r.exit_order_id || null,
    entryFillId: r.entry_fill_id || null,
    exitFillId: r.exit_fill_id || null,
    symbol: r.symbol,
    exchange: r.exchange || 'NSE',
    direction: r.direction,
    assetType: r.asset_type,
    lotSize: r.lot_size !== null && r.lot_size !== undefined ? Number(r.lot_size) : null,
    lots: r.lots !== null && r.lots !== undefined ? Number(r.lots) : null,
    quantity: Number(r.quantity),
    entry: Number(r.entry_price),
    exit: Number(r.exit_price),
    stop: Number(r.stop_loss),
    target: Number(r.target),
    grossPnl: r.gross_pnl !== null && r.gross_pnl !== undefined ? Number(r.gross_pnl) : Number(r.pnl),
    fees: r.fees !== null && r.fees !== undefined ? Number(r.fees) : 0,
    pnl: Number(r.pnl),
    reason: r.reason,
    mode: r.mode || 'MANUAL_PAPER',
    openedAt: r.opened_at,
    closedAt: r.closed_at
  }));
}

/* =====================================================
   AUDIT, AI, STRATEGY, RISK, BACKTEST & SNAPSHOT PERSISTENCE
===================================================== */

let auditSeq = 0;

function insertAuditEvent(entry, userId = null) {
  const db = getDb();
  auditSeq += 1;
  const auditId = entry.id || `AUDIT-${Date.now()}-${auditSeq}`;
  const nowIso = entry.timestamp || new Date().toISOString();
  const ownerId = userId || entry.userId || null;

  db.prepare(`
    INSERT OR REPLACE INTO audit_events (audit_id, user_id, category, message, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    auditId,
    ownerId ? String(ownerId) : null,
    String(entry.category || 'SYSTEM'),
    String(entry.message || ''),
    safeJsonStringify(entry.details || {}),
    nowIso
  );

  return {
    id: auditId,
    userId: ownerId ? String(ownerId) : null,
    category: String(entry.category || 'SYSTEM'),
    message: String(entry.message || ''),
    details: redactObject(entry.details || {}),
    timestamp: nowIso
  };
}

function listAuditEvents(category = null, limit = 100, userId = null) {
  const db = getDb();
  const maxLimit = clampQueryLimit(limit, 100, 500);
  let rows;
  if (userId) {
    rows = category
      ? db.prepare(`
          SELECT * FROM audit_events
          WHERE user_id = ? AND category = ?
          ORDER BY created_at DESC, audit_id DESC
          LIMIT ?
        `).all(String(userId), String(category), maxLimit)
      : db.prepare(`
          SELECT * FROM audit_events
          WHERE user_id = ?
          ORDER BY created_at DESC, audit_id DESC
          LIMIT ?
        `).all(String(userId), maxLimit);
  } else {
    rows = category
      ? db.prepare(`
          SELECT * FROM audit_events
          WHERE user_id IS NULL AND category = ?
          ORDER BY created_at DESC, audit_id DESC
          LIMIT ?
        `).all(String(category), maxLimit)
      : db.prepare(`
          SELECT * FROM audit_events
          WHERE user_id IS NULL
          ORDER BY created_at DESC, audit_id DESC
          LIMIT ?
        `).all(maxLimit);
  }

  return rows.map((r) => ({
    id: r.audit_id,
    userId: r.user_id || null,
    category: r.category,
    message: r.message,
    details: safeJsonParse(r.details_json, {}),
    timestamp: r.created_at
  }));
}

function insertAIDecision(decision, symbol = 'NIFTY 50', userId = null) {
  const db = getDb();
  const id = `AI-DEC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const nowIso = decision?.timestamp || new Date().toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO ai_decisions (
      decision_id, user_id, symbol, signal, action, confidence, risk, trend, source, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId ? String(userId) : null,
    String(decision?.symbol || symbol || 'NIFTY 50'),
    String(decision?.signal || 'NO_TRADE'),
    String(decision?.action || 'HOLD'),
    Number(decision?.confidence) || 0,
    String(decision?.risk || 'HIGH'),
    String(decision?.trend || 'UNKNOWN'),
    String(decision?.source || 'DETERMINISTIC_FALLBACK'),
    safeJsonStringify(decision || {}),
    nowIso
  );

  return id;
}

function listAIDecisions(limit = 50, userId = null) {
  const db = getDb();
  const maxLimit = clampQueryLimit(limit, 50, 200);
  const rows = userId
    ? db.prepare(`
        SELECT * FROM ai_decisions
        WHERE user_id = ?
        ORDER BY created_at DESC, decision_id DESC
        LIMIT ?
      `).all(String(userId), maxLimit)
    : db.prepare(`
        SELECT * FROM ai_decisions
        WHERE user_id IS NULL
        ORDER BY created_at DESC, decision_id DESC
        LIMIT ?
      `).all(maxLimit);

  return rows.map((r) => ({
    decisionId: r.decision_id,
    userId: r.user_id || null,
    symbol: r.symbol,
    signal: r.signal,
    action: r.action,
    confidence: Number(r.confidence),
    risk: r.risk,
    trend: r.trend,
    source: r.source,
    payload: safeJsonParse(r.payload_json, {}),
    timestamp: r.created_at
  }));
}

function insertStrategyDecision(strategy, symbol = 'NIFTY 50', userId = null) {
  const db = getDb();
  const id = `STRAT-DEC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const nowIso = strategy?.timestamp || new Date().toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO strategy_decisions (
      strategy_id, user_id, symbol, decision, action, entry_price, stop_loss, target,
      confidence, strategy_version, data_quality, reason, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId ? String(userId) : null,
    String(strategy?.symbol || symbol || 'NIFTY 50'),
    String(strategy?.decision || (strategy?.action && strategy.action !== 'NO_TRADE' && strategy.action !== 'HOLD' ? 'TRADE' : 'NO_TRADE')),
    String(strategy?.action || 'NO_TRADE'),
    strategy?.entry ?? null,
    strategy?.stopLoss ?? null,
    strategy?.target ?? null,
    Number(strategy?.confidence) || 0,
    String(strategy?.strategyVersion || '1.0.0-DETERMINISTIC'),
    String(strategy?.dataQuality || 'VALIDATED'),
    String(strategy?.reason || ''),
    safeJsonStringify(strategy || {}),
    nowIso
  );

  return id;
}

function listStrategyDecisions(limit = 50, userId = null) {
  const db = getDb();
  const maxLimit = clampQueryLimit(limit, 50, 200);
  const rows = userId
    ? db.prepare(`
        SELECT * FROM strategy_decisions
        WHERE user_id = ?
        ORDER BY created_at DESC, strategy_id DESC
        LIMIT ?
      `).all(String(userId), maxLimit)
    : db.prepare(`
        SELECT * FROM strategy_decisions
        WHERE user_id IS NULL
        ORDER BY created_at DESC, strategy_id DESC
        LIMIT ?
      `).all(maxLimit);

  return rows.map((r) => ({
    strategyId: r.strategy_id,
    userId: r.user_id || null,
    symbol: r.symbol,
    decision: r.decision,
    action: r.action,
    entry: r.entry_price,
    stopLoss: r.stop_loss,
    target: r.target,
    confidence: Number(r.confidence),
    strategyVersion: r.strategy_version,
    dataQuality: r.data_quality,
    reason: r.reason,
    timestamp: r.created_at
  }));
}

function insertRiskEvent(riskEval, symbol = null, side = null, userId = null) {
  const db = getDb();
  const id = `RISK-EVT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const nowIso = riskEval?.timestamp || new Date().toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO risk_events (
      risk_event_id, user_id, symbol, side, allowed, risk_amount, reasons_json, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId ? String(userId) : null,
    symbol ? String(symbol) : null,
    side ? String(side) : null,
    riskEval?.allowed ? 1 : 0,
    Number(riskEval?.riskAmount) || 0,
    safeJsonStringify(riskEval?.reasons || [], '[]'),
    safeJsonStringify(riskEval || {}),
    nowIso
  );

  return id;
}

function listRiskEvents(limit = 50, userId = null) {
  const db = getDb();
  const maxLimit = clampQueryLimit(limit, 50, 200);
  const rows = userId
    ? db.prepare(`
        SELECT * FROM risk_events
        WHERE user_id = ?
        ORDER BY created_at DESC, risk_event_id DESC
        LIMIT ?
      `).all(String(userId), maxLimit)
    : db.prepare(`
        SELECT * FROM risk_events
        WHERE user_id IS NULL
        ORDER BY created_at DESC, risk_event_id DESC
        LIMIT ?
      `).all(maxLimit);

  return rows.map((r) => ({
    riskEventId: r.risk_event_id,
    userId: r.user_id || null,
    symbol: r.symbol,
    side: r.side,
    allowed: Boolean(r.allowed),
    riskAmount: Number(r.risk_amount),
    reasons: safeJsonParse(r.reasons_json, []),
    timestamp: r.created_at
  }));
}

function mapBacktestRunRow(r) {
  if (!r) return null;
  return {
    runId: r.run_id,
    userId: r.user_id || null,
    symbol: r.symbol,
    exchange: r.exchange || 'NSE',
    timeframe: r.timeframe || 'FIVE_MINUTE',
    assetType: r.asset_type,
    fromDate: r.from_date || null,
    toDate: r.to_date || null,
    strategyVersion: r.strategy_version || '1.0.0-DETERMINISTIC',
    backtesterVersion: r.backtester_version || '2.0.0-DETERMINISTIC-TASK13',
    runStatus: r.run_status || 'COMPLETED',
    candlesProcessed: Number(r.candles_processed) || 0,
    totalTrades: Number(r.total_trades) || 0,
    winRate: Number(r.win_rate) || 0,
    grossPnl: Number(r.gross_pnl) || 0,
    netPnl: Number(r.net_pnl) || 0,
    maxDrawdown: Number(r.max_drawdown) || 0,
    profitFactor: Number(r.profit_factor) || 0,
    configuration: safeJsonParse(r.config_json, {}),
    assumptions: safeJsonParse(r.assumptions_json, {}),
    dataQuality: safeJsonParse(r.data_quality_json, {}),
    metrics: safeJsonParse(r.metrics_json, {}),
    trades: safeJsonParse(r.trades_json, []),
    fills: safeJsonParse(r.fills_json, []),
    orders: safeJsonParse(r.orders_json, []),
    dailyPnlBreakdown: safeJsonParse(r.daily_pnl_json, []),
    exitReasonBreakdown: safeJsonParse(r.exit_reasons_json, []),
    equityCurve: safeJsonParse(r.equity_curve_json, []),
    error: r.error_json ? safeJsonParse(r.error_json, null) : null,
    clientRunKey: r.client_run_key || null,
    createdAt: r.created_at
  };
}

function insertBacktestRun(result, userId = null, options = {}) {
  if (!result || !result.ok || !result.metrics) return null;
  const db = getDb();
  const ownerId = userId ? String(userId) : (result.userId ? String(result.userId) : null);
  const clientRunKey = options.clientRunKey || result.clientRunKey || result.configuration?.clientRunKey || null;

  if (clientRunKey) {
    const existing = ownerId
      ? db.prepare(`
          SELECT run_id FROM backtest_runs
          WHERE user_id = ? AND client_run_key = ?
          LIMIT 1
        `).get(ownerId, String(clientRunKey))
      : db.prepare(`
          SELECT run_id FROM backtest_runs
          WHERE user_id IS NULL AND client_run_key = ?
          LIMIT 1
        `).get(String(clientRunKey));

    if (existing && existing.run_id) {
      if (options.rejectDuplicateKey === true) {
        const err = new Error(`Duplicate backtest run submission detected for key '${clientRunKey}'.`);
        err.code = 'DUPLICATE_BACKTEST_RUN';
        throw err;
      }
      return existing.run_id;
    }
  }

  const id = result.runId || `BT-RUN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const existingById = db
    .prepare(`SELECT run_id FROM backtest_runs WHERE run_id = ? LIMIT 1`)
    .get(String(id));
  if (existingById && existingById.run_id) {
    return existingById.run_id;
  }
  const nowIso = new Date().toISOString();
  const m = result.metrics;
  const cfg = result.configuration || {};

  db.prepare(`
    INSERT INTO backtest_runs (
      run_id, user_id, symbol, exchange, timeframe, asset_type,
      from_date, to_date, strategy_version, backtester_version, run_status,
      candles_processed, total_trades, win_rate, gross_pnl, net_pnl,
      max_drawdown, profit_factor, config_json, assumptions_json,
      data_quality_json, metrics_json, trades_json, fills_json, orders_json,
      daily_pnl_json, exit_reasons_json, equity_curve_json, error_json,
      client_run_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    ownerId,
    String(result.symbol || cfg.symbol || 'NIFTY 50'),
    String(result.exchange || cfg.exchange || 'NSE'),
    String(result.timeframe || cfg.timeframe || 'FIVE_MINUTE'),
    String(result.assetType || cfg.assetType || 'EQUITY'),
    cfg.fromDate || result.dataQuality?.firstCandleTimestamp || null,
    cfg.toDate || result.dataQuality?.lastCandleTimestamp || null,
    String(result.strategyVersion || cfg.strategyVersion || '1.0.0-DETERMINISTIC'),
    String(result.backtesterVersion || cfg.backtesterVersion || '2.0.0-DETERMINISTIC-TASK13'),
    String(result.runStatus || m.runStatus || 'COMPLETED'),
    Number(result.candlesProcessed) || 0,
    Number(m.totalTrades) || 0,
    Number(m.winRate) || 0,
    Number(m.grossPnl ?? m.netPnl) || 0,
    Number(m.netPnl) || 0,
    Number(m.maxDrawdown) || 0,
    Number.isFinite(Number(m.profitFactor)) ? Number(m.profitFactor) : 999,
    safeJsonStringify(cfg),
    safeJsonStringify(result.assumptions || {}),
    safeJsonStringify(result.dataQuality || {}),
    safeJsonStringify(m),
    safeJsonStringify(result.trades || [], '[]'),
    safeJsonStringify(result.fills || [], '[]'),
    safeJsonStringify(result.orders || [], '[]'),
    safeJsonStringify(result.dailyPnlBreakdown || [], '[]'),
    safeJsonStringify(result.exitReasonBreakdown || [], '[]'),
    safeJsonStringify(result.detailedEquityCurve || result.equityCurve || [], '[]'),
    null,
    clientRunKey ? String(clientRunKey) : null,
    nowIso
  );

  return id;
}

function insertFailedBacktestRun(failureInput = {}, userId = null) {
  const db = getDb();
  const ownerId = userId ? String(userId) : null;
  const id = failureInput.runId || `BT-FAIL-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const nowIso = new Date().toISOString();
  const cfg = failureInput.configuration || failureInput.config || {};
  const errObj = {
    code: String(failureInput.code || 'BACKTEST_FAILED'),
    message: String(failureInput.message || 'Backtest execution failed.'),
    timestamp: nowIso
  };

  db.prepare(`
    INSERT INTO backtest_runs (
      run_id, user_id, symbol, exchange, timeframe, asset_type,
      from_date, to_date, strategy_version, backtester_version, run_status,
      candles_processed, total_trades, win_rate, gross_pnl, net_pnl,
      max_drawdown, profit_factor, config_json, assumptions_json,
      data_quality_json, metrics_json, trades_json, fills_json, orders_json,
      daily_pnl_json, exit_reasons_json, equity_curve_json, error_json,
      client_run_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    ownerId,
    String(failureInput.symbol || cfg.symbol || 'NIFTY 50'),
    String(failureInput.exchange || cfg.exchange || 'NSE'),
    String(failureInput.timeframe || cfg.timeframe || 'FIVE_MINUTE'),
    String(failureInput.assetType || cfg.assetType || 'EQUITY'),
    cfg.fromDate || null,
    cfg.toDate || null,
    String(cfg.strategyVersion || '1.0.0-DETERMINISTIC'),
    String(cfg.backtesterVersion || '2.0.0-DETERMINISTIC-TASK13'),
    String(failureInput.runStatus || 'FAILED'),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    safeJsonStringify(cfg),
    safeJsonStringify({}),
    safeJsonStringify(failureInput.dataQuality || {}),
    safeJsonStringify({ runStatus: 'FAILED', totalTrades: 0, netPnl: 0 }),
    '[]',
    '[]',
    '[]',
    '[]',
    '[]',
    '[]',
    safeJsonStringify(errObj),
    failureInput.clientRunKey ? String(failureInput.clientRunKey) : null,
    nowIso
  );

  return getBacktestRunById(id, ownerId);
}

function listBacktestRuns(limit = 20, userId = null) {
  const db = getDb();
  const maxLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const rows = userId
    ? db.prepare(`
        SELECT * FROM backtest_runs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(String(userId), maxLimit)
    : db.prepare(`
        SELECT * FROM backtest_runs
        WHERE user_id IS NULL
        ORDER BY created_at DESC
        LIMIT ?
      `).all(maxLimit);

  return rows.map(mapBacktestRunRow);
}

function getBacktestRunById(runId, userId = null) {
  if (!runId) return null;
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM backtest_runs WHERE run_id = ? LIMIT 1`)
    .get(String(runId));
  if (!row) return null;

  const rowOwner = row.user_id || null;
  const reqOwner = userId ? String(userId) : null;
  if (rowOwner !== reqOwner) {
    const err = new Error('Forbidden: backtest run belongs to another user.');
    err.code = 'FORBIDDEN_OWNERSHIP';
    err.statusCode = 403;
    throw err;
  }

  return mapBacktestRunRow(row);
}

function getBacktestRunTrades(runId, userId = null) {
  const runRecord = getBacktestRunById(runId, userId);
  if (!runRecord) return null;
  return {
    runId: runRecord.runId,
    userId: runRecord.userId,
    symbol: runRecord.symbol,
    exchange: runRecord.exchange,
    timeframe: runRecord.timeframe,
    assetType: runRecord.assetType,
    runStatus: runRecord.runStatus,
    strategyVersion: runRecord.strategyVersion,
    totalTrades: runRecord.totalTrades,
    trades: Array.isArray(runRecord.trades) ? runRecord.trades : [],
    fills: Array.isArray(runRecord.fills) ? runRecord.fills : [],
    orders: Array.isArray(runRecord.orders) ? runRecord.orders : []
  };
}

function upsertMarketSnapshotCache(snapshot) {
  if (!snapshot || !snapshot.instrument) return;
  const db = getDb();
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO market_snapshots_cache (
      symbol_key, exchange, price, status, data_ready, snapshot_json, quote_timestamp, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol_key) DO UPDATE SET
      exchange = excluded.exchange,
      price = excluded.price,
      status = excluded.status,
      data_ready = excluded.data_ready,
      snapshot_json = excluded.snapshot_json,
      quote_timestamp = excluded.quote_timestamp,
      updated_at = excluded.updated_at
  `).run(
    String(snapshot.instrument),
    String(snapshot.exchange || 'NSE'),
    snapshot.price !== null && snapshot.price !== undefined ? Number(snapshot.price) : null,
    String(snapshot.status || 'DATA_WAITING'),
    snapshot.dataReady ? 1 : 0,
    safeJsonStringify(snapshot),
    snapshot.timestamp || null,
    nowIso
  );
}

function getMarketSnapshotCache(symbolKey) {
  if (!symbolKey) return null;
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM market_snapshots_cache WHERE UPPER(symbol_key) = UPPER(?) LIMIT 1`)
    .get(String(symbolKey));
  if (!row) return null;
  return {
    symbolKey: row.symbol_key,
    exchange: row.exchange,
    price: row.price !== null && row.price !== undefined ? Number(row.price) : null,
    status: row.status,
    dataReady: Boolean(row.data_ready),
    snapshot: safeJsonParse(row.snapshot_json, {}),
    quoteTimestamp: row.quote_timestamp,
    updatedAt: row.updated_at
  };
}

function mapSearchInstrumentRow(row) {
  if (!row) return null;
  return {
    id: row.watchlist_id || row.recent_id || row.cache_key,
    watchlistId: row.watchlist_id || null,
    userId: row.user_id || null,
    key: row.symbol_key || row.tradingsymbol,
    symbolKey: row.symbol_key || row.tradingsymbol,
    tradingsymbol: row.tradingsymbol || null,
    name: row.name || row.tradingsymbol || row.symbol_key,
    companyName: row.company_name || row.name || row.tradingsymbol || row.symbol_key,
    exchange: row.exchange,
    type: row.instrument_type || 'EQUITY',
    instrumentType: row.instrument_type || 'EQUITY',
    symboltoken: row.symboltoken || null,
    optionType: row.option_type || null,
    strikePrice: row.strike_price !== null && row.strike_price !== undefined ? Number(row.strike_price) : null,
    expiry: row.expiry || null,
    lotSize: row.lot_size !== null && row.lot_size !== undefined ? Number(row.lot_size) : null,
    sortOrder: row.sort_order !== null && row.sort_order !== undefined ? Number(row.sort_order) : 0,
    queryText: row.query_text || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || row.created_at || null,
    timestamp: row.created_at || row.searched_at || row.updated_at || null
  };
}

function listWatchlist(userId = null) {
  const db = getDb();
  const rows = userId
    ? db.prepare(`
        SELECT * FROM user_watchlist
        WHERE user_id = ?
        ORDER BY sort_order ASC, created_at DESC
        LIMIT 100
      `).all(String(userId))
    : db.prepare(`
        SELECT * FROM user_watchlist
        WHERE user_id IS NULL
        ORDER BY sort_order ASC, created_at DESC
        LIMIT 100
      `).all();

  return rows.map(mapSearchInstrumentRow);
}

function addWatchlistItem(item = {}, userId = null, options = {}) {
  const db = getDb();
  const ownerId = userId ? String(userId) : null;
  const normalized = WatchlistAlertEngine.validateAndNormalizeWatchlistInstrument(item);
  const exchange = normalized.exchange;
  const symbolKey = normalized.symbolKey;

  const nowIso = new Date().toISOString();
  const existing = ownerId
    ? db.prepare(`
        SELECT watchlist_id, sort_order, created_at FROM user_watchlist
        WHERE user_id = ? AND exchange = ? AND (UPPER(symbol_key) = ? OR UPPER(tradingsymbol) = ?)
        LIMIT 1
      `).get(ownerId, exchange, symbolKey, String(normalized.tradingsymbol || symbolKey).toUpperCase())
    : db.prepare(`
        SELECT watchlist_id, sort_order, created_at FROM user_watchlist
        WHERE user_id IS NULL AND exchange = ? AND (UPPER(symbol_key) = ? OR UPPER(tradingsymbol) = ?)
        LIMIT 1
      `).get(exchange, symbolKey, String(normalized.tradingsymbol || symbolKey).toUpperCase());

  if (existing && options.rejectDuplicate === true) {
    const err = new Error(`Instrument '${normalized.name}' (${exchange}) is already in your watchlist.`);
    err.code = 'DUPLICATE_WATCHLIST_ITEM';
    throw err;
  }

  let sortOrder = existing?.sort_order;
  if (sortOrder === undefined || sortOrder === null) {
    if (Number.isFinite(Number(item.sortOrder))) {
      sortOrder = Math.max(0, Math.trunc(Number(item.sortOrder)));
    } else {
      const minRow = ownerId
        ? db.prepare(`SELECT MIN(sort_order) AS min_sort FROM user_watchlist WHERE user_id = ?`).get(ownerId)
        : db.prepare(`SELECT MIN(sort_order) AS min_sort FROM user_watchlist WHERE user_id IS NULL`).get();
      sortOrder =
        minRow && minRow.min_sort !== null && minRow.min_sort !== undefined
          ? Number(minRow.min_sort) - 1
          : 0;
    }
  }

  const watchlistId = existing?.watchlist_id || item.watchlistId || `WL-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const createdAt = existing?.created_at || nowIso;

  db.prepare(`
    INSERT OR REPLACE INTO user_watchlist (
      watchlist_id, user_id, symbol_key, tradingsymbol, name, company_name, exchange,
      instrument_type, symboltoken, option_type, strike_price, expiry, lot_size,
      sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    watchlistId,
    ownerId,
    symbolKey,
    normalized.tradingsymbol,
    normalized.name,
    normalized.companyName || normalized.name,
    exchange,
    normalized.instrumentType,
    normalized.symboltoken,
    normalized.optionType,
    normalized.strikePrice,
    normalized.expiry,
    normalized.lotSize,
    sortOrder,
    createdAt,
    nowIso
  );

  return listWatchlist(ownerId);
}

function removeWatchlistItem(identifier = {}, userId = null) {
  const db = getDb();
  const ownerId = userId ? String(userId) : null;
  const watchlistId = identifier.id || identifier.watchlistId || null;
  const symbolKey = String(identifier.key || identifier.symbolKey || identifier.tradingsymbol || identifier.symbol || '')
    .trim()
    .toUpperCase();
  const exchange = identifier.exchange ? String(identifier.exchange).trim().toUpperCase() : null;

  if (watchlistId) {
    const row = db.prepare('SELECT user_id FROM user_watchlist WHERE watchlist_id = ?').get(String(watchlistId));
    if (row) {
      const rowOwner = row.user_id || null;
      if (rowOwner !== ownerId) {
        const err = new Error('Forbidden: watchlist item belongs to another user.');
        err.code = 'FORBIDDEN_OWNERSHIP';
        err.statusCode = 403;
        throw err;
      }
      db.prepare('DELETE FROM user_watchlist WHERE watchlist_id = ?').run(String(watchlistId));
    }
  } else if (symbolKey) {
    if (ownerId) {
      if (exchange) {
        db.prepare('DELETE FROM user_watchlist WHERE user_id = ? AND exchange = ? AND (UPPER(symbol_key) = ? OR UPPER(tradingsymbol) = ? OR UPPER(name) = ?)').run(ownerId, exchange, symbolKey, symbolKey, symbolKey);
      } else {
        db.prepare('DELETE FROM user_watchlist WHERE user_id = ? AND (UPPER(symbol_key) = ? OR UPPER(tradingsymbol) = ? OR UPPER(name) = ?)').run(ownerId, symbolKey, symbolKey, symbolKey);
      }
    } else {
      if (exchange) {
        db.prepare('DELETE FROM user_watchlist WHERE user_id IS NULL AND exchange = ? AND (UPPER(symbol_key) = ? OR UPPER(tradingsymbol) = ? OR UPPER(name) = ?)').run(exchange, symbolKey, symbolKey, symbolKey);
      } else {
        db.prepare('DELETE FROM user_watchlist WHERE user_id IS NULL AND (UPPER(symbol_key) = ? OR UPPER(tradingsymbol) = ? OR UPPER(name) = ?)').run(symbolKey, symbolKey, symbolKey);
      }
    }
  }

  return listWatchlist(ownerId);
}

function reorderWatchlist(payload = {}, userId = null) {
  const ownerId = userId ? String(userId) : null;
  const nowIso = new Date().toISOString();

  return withTransaction((tx) => {
    const items = ownerId
      ? tx.prepare(`SELECT watchlist_id, user_id, symbol_key, exchange, sort_order FROM user_watchlist WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC`).all(ownerId)
      : tx.prepare(`SELECT watchlist_id, user_id, symbol_key, exchange, sort_order FROM user_watchlist WHERE user_id IS NULL ORDER BY sort_order ASC, created_at DESC`).all();

    if (!items.length) return [];

    // Support orderedIds / orderedItems array OR { watchlistId/key, direction: 'UP' | 'DOWN' }
    if (Array.isArray(payload.orderedIds) && payload.orderedIds.length > 0) {
      for (const reqId of payload.orderedIds) {
        const checkRow = tx.prepare('SELECT user_id FROM user_watchlist WHERE watchlist_id = ?').get(String(reqId));
        if (checkRow && (checkRow.user_id || null) !== ownerId) {
          const err = new Error('Forbidden: cannot reorder watchlist item owned by another user.');
          err.code = 'FORBIDDEN_OWNERSHIP';
          err.statusCode = 403;
          throw err;
        }
      }

      const idMap = new Map(items.map((r) => [r.watchlist_id, r]));
      const nextOrder = [];
      for (const id of payload.orderedIds) {
        const strId = String(id);
        if (idMap.has(strId)) {
          nextOrder.push(idMap.get(strId));
          idMap.delete(strId);
        }
      }
      for (const rem of idMap.values()) {
        nextOrder.push(rem);
      }

      const updateStmt = tx.prepare(`UPDATE user_watchlist SET sort_order = ?, updated_at = ? WHERE watchlist_id = ?`);
      nextOrder.forEach((row, idx) => {
        updateStmt.run(idx + 1, nowIso, row.watchlist_id);
      });
    } else if (Array.isArray(payload.orderedItems) && payload.orderedItems.length > 0) {
      const usedIds = new Set();
      const nextOrder = [];
      for (const spec of payload.orderedItems) {
        if (!spec) continue;
        const specId = spec.watchlistId || spec.id ? String(spec.watchlistId || spec.id) : null;
        const specKey = String(spec.key || spec.symbolKey || spec.tradingsymbol || spec.symbol || '').trim().toUpperCase();
        const specEx = spec.exchange ? String(spec.exchange).trim().toUpperCase() : null;

        const match = items.find(
          (r) =>
            !usedIds.has(r.watchlist_id) &&
            ((specId && r.watchlist_id === specId) ||
              (specKey &&
                String(r.symbol_key).toUpperCase() === specKey &&
                (!specEx || String(r.exchange).toUpperCase() === specEx)))
        );
        if (match) {
          usedIds.add(match.watchlist_id);
          nextOrder.push(match);
        }
      }
      for (const r of items) {
        if (!usedIds.has(r.watchlist_id)) {
          nextOrder.push(r);
        }
      }
      const updateStmt = tx.prepare(`UPDATE user_watchlist SET sort_order = ?, updated_at = ? WHERE watchlist_id = ?`);
      nextOrder.forEach((row, idx) => {
        updateStmt.run(idx + 1, nowIso, row.watchlist_id);
      });
    } else {
      const targetId = payload.id || payload.watchlistId || null;
      const targetKey = String(payload.key || payload.symbolKey || '').trim().toUpperCase();
      const direction = String(payload.direction || 'UP').trim().toUpperCase();

      if (targetId) {
        const checkRow = tx.prepare('SELECT user_id FROM user_watchlist WHERE watchlist_id = ?').get(String(targetId));
        if (checkRow && (checkRow.user_id || null) !== ownerId) {
          const err = new Error('Forbidden: watchlist item belongs to another user.');
          err.code = 'FORBIDDEN_OWNERSHIP';
          err.statusCode = 403;
          throw err;
        }
      }

      const idx = items.findIndex(
        (r) =>
          (targetId && r.watchlist_id === String(targetId)) ||
          (targetKey && String(r.symbol_key).toUpperCase() === targetKey)
      );

      if (idx !== -1) {
        const swapIdx = direction === 'DOWN' ? idx + 1 : idx - 1;
        if (swapIdx >= 0 && swapIdx < items.length) {
          const tmp = items[idx];
          items[idx] = items[swapIdx];
          items[swapIdx] = tmp;
        }
      }

      const updateStmt = tx.prepare(`UPDATE user_watchlist SET sort_order = ?, updated_at = ? WHERE watchlist_id = ?`);
      items.forEach((row, i) => {
        updateStmt.run(i + 1, nowIso, row.watchlist_id);
      });
    }

    return listWatchlist(ownerId);
  });
}

/* =====================================================
   TASK 14 — MARKET ALERTS & ALERT HISTORY REPOSITORY
   (Multi-User Isolated + Zero Fabrication)
===================================================== */

function mapMarketAlertRow(r) {
  if (!r) return null;
  const conditionParams = safeJsonParse(r.condition_json, {});
  const mapped = {
    alertId: r.alert_id,
    id: r.alert_id,
    userId: r.user_id || null,
    symbolKey: r.symbol_key,
    symbol: r.symbol,
    tradingsymbol: r.tradingsymbol || r.symbol,
    name: r.name || r.symbol,
    exchange: r.exchange || 'NSE',
    instrumentType: r.instrument_type || 'EQUITY',
    symboltoken: r.symboltoken || null,
    optionType: r.option_type || null,
    strikePrice: r.strike_price !== null && r.strike_price !== undefined ? Number(r.strike_price) : null,
    expiry: r.expiry || null,
    lotSize: r.lot_size !== null && r.lot_size !== undefined ? Number(r.lot_size) : null,
    alertType: r.alert_type,
    thresholdValue: r.threshold_value !== null && r.threshold_value !== undefined ? Number(r.threshold_value) : null,
    baselinePrice: r.baseline_price !== null && r.baseline_price !== undefined ? Number(r.baseline_price) : null,
    conditionParams,
    triggerMode: r.trigger_mode || 'ONCE',
    cooldownMinutes: Number(r.cooldown_minutes ?? 15),
    status: r.status || 'ACTIVE',
    lastStatusReason: r.last_status_reason || null,
    lastEvaluatedAt: r.last_evaluated_at || null,
    lastTriggeredAt: r.last_triggered_at || null,
    triggerCount: Number(r.trigger_count || 0),
    expiresAt: r.expires_at || null,
    notes: r.notes || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
  mapped.conditionSummary = WatchlistAlertEngine.formatConditionSummary(mapped);
  return mapped;
}

function mapAlertEventHistoryRow(r) {
  if (!r) return null;
  return {
    eventId: r.event_id,
    id: r.event_id,
    alertId: r.alert_id,
    userId: r.user_id || null,
    symbolKey: r.symbol_key,
    symbol: r.symbol,
    tradingsymbol: r.tradingsymbol || r.symbol,
    exchange: r.exchange || 'NSE',
    instrumentType: r.instrument_type || 'EQUITY',
    alertType: r.alert_type,
    triggerMode: r.trigger_mode || 'ONCE',
    conditionSummary: r.condition_summary,
    thresholdValue: r.threshold_value !== null && r.threshold_value !== undefined ? Number(r.threshold_value) : null,
    observedPrice: Number(r.observed_price),
    observedValue: r.observed_value,
    message: r.message,
    context: safeJsonParse(r.context_json, {}),
    acknowledged: Boolean(r.acknowledged),
    acknowledgedAt: r.acknowledged_at || null,
    quoteTimestamp: r.quote_timestamp,
    triggeredAt: r.triggered_at
  };
}

function createMarketAlert(payload = {}, userId = null, options = {}) {
  const db = getDb();
  const ownerId = userId ? String(userId) : (payload.userId ? String(payload.userId) : null);
  const validated = WatchlistAlertEngine.validateAlertDefinition(payload, options);
  const nowIso = options.nowIso || new Date().toISOString();
  const alertId = payload.alertId || `ALT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  db.prepare(`
    INSERT INTO market_alerts (
      alert_id, user_id, symbol_key, symbol, tradingsymbol, name, exchange,
      instrument_type, symboltoken, option_type, strike_price, expiry, lot_size,
      alert_type, threshold_value, baseline_price, condition_json, trigger_mode,
      cooldown_minutes, status, last_status_reason, last_evaluated_at,
      last_triggered_at, trigger_count, expires_at, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?, ?, ?)
  `).run(
    alertId,
    ownerId,
    validated.symbolKey,
    validated.symbol,
    validated.tradingsymbol,
    validated.name,
    validated.exchange,
    validated.instrumentType,
    validated.symboltoken,
    validated.optionType,
    validated.strikePrice,
    validated.expiry,
    validated.lotSize,
    validated.alertType,
    validated.thresholdValue,
    validated.baselinePrice,
    safeJsonStringify(validated.conditionParams || {}),
    validated.triggerMode,
    validated.cooldownMinutes,
    validated.status,
    validated.expiresAt,
    validated.notes,
    nowIso,
    nowIso
  );

  return getMarketAlertById(alertId, ownerId);
}

function getMarketAlertById(alertId, userId = null) {
  if (!alertId) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM market_alerts WHERE alert_id = ? LIMIT 1').get(String(alertId));
  if (!row) return null;

  const rowOwner = row.user_id || null;
  const reqOwner = userId ? String(userId) : null;
  if (rowOwner !== reqOwner) {
    const err = new Error('Forbidden: market alert belongs to another user.');
    err.code = 'FORBIDDEN_OWNERSHIP';
    err.statusCode = 403;
    throw err;
  }

  return mapMarketAlertRow(row);
}

function listMarketAlerts(filters = {}, userId = null) {
  const db = getDb();
  const ownerId = userId ? String(userId) : null;
  const statusFilter = filters.status ? String(filters.status).trim().toUpperCase() : null;
  const symbolFilter = filters.symbol ? String(filters.symbol).trim().toUpperCase() : null;
  const maxLimit = Math.max(1, Math.min(200, Number(filters.limit) || 100));

  const rows = ownerId
    ? db.prepare(`SELECT * FROM market_alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(ownerId, maxLimit)
    : db.prepare(`SELECT * FROM market_alerts WHERE user_id IS NULL ORDER BY created_at DESC LIMIT ?`).all(maxLimit);

  let mapped = rows.map(mapMarketAlertRow);
  if (statusFilter && statusFilter !== 'ALL') {
    mapped = mapped.filter((a) => String(a.status).toUpperCase() === statusFilter);
  }
  if (symbolFilter && symbolFilter !== 'ALL') {
    mapped = mapped.filter(
      (a) =>
        String(a.symbolKey).toUpperCase().includes(symbolFilter) ||
        String(a.symbol).toUpperCase().includes(symbolFilter) ||
        String(a.tradingsymbol || '').toUpperCase().includes(symbolFilter)
    );
  }
  return mapped;
}

function updateMarketAlertStatus(alertId, updates = {}, userId = null) {
  const db = getDb();
  const existing = getMarketAlertById(alertId, userId);
  if (!existing) {
    const err = new Error(`Market alert '${alertId}' not found.`);
    err.code = 'ALERT_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  const nowIso = updates.nowIso || new Date().toISOString();
  const nextStatus = updates.status
    ? String(updates.status).trim().toUpperCase()
    : existing.status;

  if (!WatchlistAlertEngine.ALERT_LIFECYCLE_STATES.includes(nextStatus)) {
    const err = new Error(`Invalid alert lifecycle status '${nextStatus}'.`);
    err.code = 'INVALID_ALERT_STATUS';
    throw err;
  }

  const nextReason =
    updates.lastStatusReason !== undefined
      ? updates.lastStatusReason
      : existing.lastStatusReason;
  const nextEvalAt =
    updates.lastEvaluatedAt !== undefined
      ? updates.lastEvaluatedAt
      : existing.lastEvaluatedAt;
  const nextTrigAt =
    updates.lastTriggeredAt !== undefined
      ? updates.lastTriggeredAt
      : existing.lastTriggeredAt;
  const nextTrigCount =
    updates.triggerCount !== undefined
      ? Number(updates.triggerCount)
      : existing.triggerCount;
  const nextConditionParams =
    updates.conditionParams && typeof updates.conditionParams === 'object'
      ? { ...existing.conditionParams, ...updates.conditionParams }
      : existing.conditionParams;

  db.prepare(`
    UPDATE market_alerts
    SET status = ?,
        last_status_reason = ?,
        last_evaluated_at = ?,
        last_triggered_at = ?,
        trigger_count = ?,
        condition_json = ?,
        updated_at = ?
    WHERE alert_id = ?
  `).run(
    nextStatus,
    nextReason ? String(nextReason) : null,
    nextEvalAt ? String(nextEvalAt) : null,
    nextTrigAt ? String(nextTrigAt) : null,
    nextTrigCount,
    safeJsonStringify(nextConditionParams),
    nowIso,
    String(alertId)
  );

  return getMarketAlertById(alertId, userId);
}

function deleteMarketAlert(alertId, userId = null) {
  const db = getDb();
  const existing = getMarketAlertById(alertId, userId);
  if (!existing) {
    const err = new Error(`Market alert '${alertId}' not found.`);
    err.code = 'ALERT_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  db.prepare('DELETE FROM market_alerts WHERE alert_id = ?').run(String(alertId));
  return { deleted: true, alertId: String(alertId) };
}

function recordTriggeredAlertEvent(eventPayload = {}, userId = null) {
  const ownerId = userId ? String(userId) : (eventPayload.userId ? String(eventPayload.userId) : null);
  const nowIso = eventPayload.triggeredAt || new Date().toISOString();
  const eventId = eventPayload.eventId || `ALTEVT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  return withTransaction((tx) => {
    const alertRow = tx
      .prepare('SELECT * FROM market_alerts WHERE alert_id = ? LIMIT 1')
      .get(String(eventPayload.alertId));

    if (!alertRow) {
      const err = new Error('Cannot record alert event for non-existent alert.');
      err.code = 'ALERT_NOT_FOUND';
      throw err;
    }

    if ((alertRow.user_id || null) !== ownerId) {
      const err = new Error('Forbidden: market alert belongs to another user.');
      err.code = 'FORBIDDEN_OWNERSHIP';
      err.statusCode = 403;
      throw err;
    }

    const triggerMode = String(alertRow.trigger_mode || 'ONCE').toUpperCase();
    const nextStatus = triggerMode === 'ONCE' ? 'TRIGGERED' : 'COOLDOWN';
    const nextCount = Number(alertRow.trigger_count || 0) + 1;
    const condObj = safeJsonParse(alertRow.condition_json, {});
    if (eventPayload.context?.strategyAction) {
      condObj.lastKnownSignal = eventPayload.context.strategyAction;
    }

    tx.prepare(`
      UPDATE market_alerts
      SET status = ?,
          last_status_reason = ?,
          last_evaluated_at = ?,
          last_triggered_at = ?,
          trigger_count = ?,
          condition_json = ?,
          updated_at = ?
      WHERE alert_id = ?
    `).run(
      nextStatus,
      String(eventPayload.message || 'Alert condition met'),
      nowIso,
      nowIso,
      nextCount,
      safeJsonStringify(condObj),
      nowIso,
      String(eventPayload.alertId)
    );

    tx.prepare(`
      INSERT INTO alert_events_history (
        event_id, alert_id, user_id, symbol_key, symbol, tradingsymbol, exchange,
        instrument_type, alert_type, trigger_mode, condition_summary, threshold_value,
        observed_price, observed_value, message, context_json, acknowledged,
        acknowledged_at, quote_timestamp, triggered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
    `).run(
      eventId,
      String(eventPayload.alertId),
      ownerId,
      String(eventPayload.symbolKey || alertRow.symbol_key),
      String(eventPayload.symbol || alertRow.symbol),
      String(eventPayload.tradingsymbol || alertRow.tradingsymbol || alertRow.symbol),
      String(eventPayload.exchange || alertRow.exchange || 'NSE'),
      String(eventPayload.instrumentType || alertRow.instrument_type || 'EQUITY'),
      String(eventPayload.alertType || alertRow.alert_type),
      triggerMode,
      String(eventPayload.conditionSummary || WatchlistAlertEngine.formatConditionSummary(mapMarketAlertRow(alertRow))),
      eventPayload.thresholdValue !== undefined ? eventPayload.thresholdValue : alertRow.threshold_value,
      Number(eventPayload.observedPrice || 0),
      eventPayload.observedValue !== undefined && eventPayload.observedValue !== null
        ? String(eventPayload.observedValue)
        : null,
      String(eventPayload.message || 'Market alert triggered'),
      safeJsonStringify(eventPayload.context || {}),
      String(eventPayload.quoteTimestamp || nowIso),
      nowIso
    );

    const savedEvt = tx
      .prepare('SELECT * FROM alert_events_history WHERE event_id = ?')
      .get(eventId);
    const updatedAlert = tx
      .prepare('SELECT * FROM market_alerts WHERE alert_id = ?')
      .get(String(eventPayload.alertId));

    return {
      event: mapAlertEventHistoryRow(savedEvt),
      alert: mapMarketAlertRow(updatedAlert)
    };
  });
}

function listAlertEventsHistory(filters = {}, userId = null) {
  const db = getDb();
  const ownerId = userId ? String(userId) : null;
  const maxLimit = Math.max(1, Math.min(200, Number(filters.limit) || 100));

  const rows = ownerId
    ? db.prepare(`SELECT * FROM alert_events_history WHERE user_id = ? ORDER BY triggered_at DESC, event_id DESC LIMIT ?`).all(ownerId, maxLimit)
    : db.prepare(`SELECT * FROM alert_events_history WHERE user_id IS NULL ORDER BY triggered_at DESC, event_id DESC LIMIT ?`).all(maxLimit);

  let mapped = rows.map(mapAlertEventHistoryRow);
  if (filters.symbol && String(filters.symbol).trim().toUpperCase() !== 'ALL') {
    const symQ = String(filters.symbol).trim().toUpperCase();
    mapped = mapped.filter(
      (e) =>
        String(e.symbolKey).toUpperCase().includes(symQ) ||
        String(e.symbol).toUpperCase().includes(symQ)
    );
  }
  if (filters.acknowledged !== undefined && filters.acknowledged !== null && filters.acknowledged !== 'ALL') {
    const ackBool = filters.acknowledged === true || filters.acknowledged === 'true' || filters.acknowledged === '1';
    mapped = mapped.filter((e) => e.acknowledged === ackBool);
  }
  return mapped;
}

function acknowledgeAlertEvent(eventId, userId = null) {
  const ownerId = userId ? String(userId) : null;
  const nowIso = new Date().toISOString();

  if (eventId === 'ALL') {
    withTransaction((tx) => {
      if (ownerId) {
        tx.prepare(`UPDATE alert_events_history SET acknowledged = 1, acknowledged_at = ? WHERE user_id = ? AND acknowledged = 0`).run(nowIso, ownerId);
        tx.prepare(`UPDATE alert_notifications SET read_status = 1, read_at = ? WHERE user_id = ? AND read_status = 0`).run(nowIso, ownerId);
      } else {
        tx.prepare(`UPDATE alert_events_history SET acknowledged = 1, acknowledged_at = ? WHERE user_id IS NULL AND acknowledged = 0`).run(nowIso);
        tx.prepare(`UPDATE alert_notifications SET read_status = 1, read_at = ? WHERE user_id IS NULL AND read_status = 0`).run(nowIso);
      }
    });
    return listAlertEventsHistory({}, ownerId);
  }

  return withTransaction((tx) => {
    const row = tx.prepare('SELECT * FROM alert_events_history WHERE event_id = ? LIMIT 1').get(String(eventId));
    if (!row) {
      const err = new Error(`Alert event '${eventId}' not found.`);
      err.code = 'ALERT_EVENT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    if ((row.user_id || null) !== ownerId) {
      const err = new Error('Forbidden: alert history event belongs to another user.');
      err.code = 'FORBIDDEN_OWNERSHIP';
      err.statusCode = 403;
      throw err;
    }

    tx.prepare(`UPDATE alert_events_history SET acknowledged = 1, acknowledged_at = ? WHERE event_id = ?`).run(nowIso, String(eventId));
    if (ownerId) {
      tx.prepare(`UPDATE alert_notifications SET read_status = 1, read_at = ? WHERE user_id = ? AND source_event_id = ? AND read_status = 0`).run(nowIso, ownerId, String(eventId));
    } else {
      tx.prepare(`UPDATE alert_notifications SET read_status = 1, read_at = ? WHERE user_id IS NULL AND source_event_id = ? AND read_status = 0`).run(nowIso, String(eventId));
    }
    const updated = tx.prepare('SELECT * FROM alert_events_history WHERE event_id = ? LIMIT 1').get(String(eventId));
    return mapAlertEventHistoryRow(updated);
  });
}

function evaluateUserAlertsAgainstMarketData(marketContextsBySymbol = {}, userId = null, options = {}) {
  const ownerId = userId ? String(userId) : null;
  const alerts = listMarketAlerts({}, ownerId);
  const triggeredEvents = [];
  const evaluations = [];
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const nowIso = new Date(nowMs).toISOString();

  for (const alert of alerts) {
    if (alert.status === 'PAUSED' || alert.status === 'DISABLED') {
      evaluations.push({
        alertId: alert.alertId,
        triggered: false,
        nextStatus: alert.status,
        reasonCode: `ALERT_${alert.status}`
      });
      continue;
    }

    const symKey = String(alert.symbolKey || alert.symbol || '').toUpperCase();
    const exSymKey = `${String(alert.exchange || 'NSE').toUpperCase()}:${symKey}`;
    const symName = String(alert.symbol || '').toUpperCase();
    const tsym = String(alert.tradingsymbol || '').toUpperCase();

    let ctx =
      marketContextsBySymbol[exSymKey] ||
      marketContextsBySymbol[symKey] ||
      marketContextsBySymbol[symName] ||
      (tsym ? marketContextsBySymbol[tsym] : null) ||
      null;

    if (!ctx && options.useCachedSnapshots !== false) {
      const cached =
        getMarketSnapshotCache(symKey) ||
        getMarketSnapshotCache(alert.symbol) ||
        (tsym ? getMarketSnapshotCache(tsym) : null);
      if (cached && cached.snapshot) {
        ctx = {
          snapshot: {
            ...cached.snapshot,
            price: cached.price,
            timestamp: cached.quoteTimestamp,
            dataReady: cached.dataReady
          }
        };
      }
    }

    const evalRes = WatchlistAlertEngine.evaluateSingleAlert(alert, ctx || {}, {
      nowMs,
      maxQuoteAgeMs: options.maxQuoteAgeMs
    });
    evaluations.push(evalRes);

    if (evalRes.triggered && evalRes.eventPayload) {
      const saved = recordTriggeredAlertEvent(evalRes.eventPayload, ownerId);
      triggeredEvents.push(saved.event);
      try {
        createNotificationFromAlertEvent(saved.event, ownerId, {
          nowTime: options.nowTime || nowIso
        });
      } catch (_) {}
      insertAuditEvent(
        {
          category: 'MARKET_ALERT',
          message: evalRes.eventPayload.message,
          details: {
            alertId: alert.alertId,
            eventId: saved.event.eventId,
            symbol: alert.symbol,
            exchange: alert.exchange,
            alertType: alert.alertType,
            observedPrice: evalRes.eventPayload.observedPrice,
            observedValue: evalRes.eventPayload.observedValue,
            quoteTimestamp: evalRes.eventPayload.quoteTimestamp
          }
        },
        ownerId
      );
    } else if (evalRes.statusChanged || evalRes.evaluatedAt) {
      const nextParams = { ...alert.conditionParams };
      if (
        alert.alertType === 'STRATEGY_SIGNAL_CHANGE' &&
        evalRes.observedValue &&
        typeof evalRes.observedValue === 'string'
      ) {
        nextParams.lastKnownSignal = evalRes.observedValue;
      }
      updateMarketAlertStatus(
        alert.alertId,
        {
          status: evalRes.nextStatus,
          lastStatusReason: evalRes.reason,
          lastEvaluatedAt: nowIso,
          conditionParams: nextParams,
          nowIso
        },
        ownerId
      );
    }
  }

  const notifList = listUserNotifications({}, ownerId);

  return {
    ok: true,
    userId: ownerId,
    evaluatedCount: evaluations.length,
    triggeredCount: triggeredEvents.length,
    triggeredEvents,
    evaluations,
    alerts: listMarketAlerts({}, ownerId),
    alertHistory: listAlertEventsHistory({}, ownerId),
    notifications: notifList.notifications,
    unreadNotificationCount: notifList.unreadCount
  };
}

/* =====================================================
   TASK 15 — ALERT NOTIFICATIONS SYSTEM & PREFERENCES REPOSITORY
   (Strict User Isolation + Deduplication + Delivery Audit Trail)
===================================================== */

function mapNotificationPreferencesRow(row, userId = null) {
  const ownerId = userId ? String(userId) : row?.user_id || null;
  if (!row) {
    return {
      userId: ownerId,
      ...NotificationEngine.normalizePreferences({})
    };
  }
  const catObj = safeJsonParse(row.categories_json, {});
  const normalized = NotificationEngine.normalizePreferences({
    inAppEnabled: Boolean(row.in_app_enabled),
    browserNotificationsEnabled: Boolean(row.browser_notifications_enabled),
    soundEnabled: Boolean(row.sound_enabled),
    telegramEnabled: Boolean(row.telegram_enabled),
    emailEnabled: Boolean(row.email_enabled),
    webhookEnabled: Boolean(row.webhook_enabled),
    quietHoursEnabled: Boolean(row.quiet_hours_enabled),
    quietHoursStart: row.quiet_hours_start || '22:00',
    quietHoursEnd: row.quiet_hours_end || '07:00',
    categories: catObj
  });
  return {
    userId: ownerId,
    ...normalized,
    updatedAt: row.updated_at || null
  };
}

function getUserNotificationPreferences(userId = null) {
  const db = getDb();
  const ownerId = userId ? String(userId) : null;
  const prefKey = ownerId ? `PREF_USER_${ownerId}` : 'PREF_GUEST';
  const row = db
    .prepare('SELECT * FROM user_notification_preferences WHERE pref_key = ? LIMIT 1')
    .get(prefKey);
  return mapNotificationPreferencesRow(row, ownerId);
}

function updateUserNotificationPreferences(updates = {}, userId = null) {
  const db = getDb();
  const ownerId = userId ? String(userId) : null;
  const prefKey = ownerId ? `PREF_USER_${ownerId}` : 'PREF_GUEST';
  const existing = getUserNotificationPreferences(ownerId);
  const normalized = NotificationEngine.normalizePreferences(updates, existing);
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO user_notification_preferences (
      pref_key, user_id, in_app_enabled, browser_notifications_enabled, sound_enabled,
      telegram_enabled, email_enabled, webhook_enabled, quiet_hours_enabled,
      quiet_hours_start, quiet_hours_end, categories_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pref_key) DO UPDATE SET
      in_app_enabled = excluded.in_app_enabled,
      browser_notifications_enabled = excluded.browser_notifications_enabled,
      sound_enabled = excluded.sound_enabled,
      telegram_enabled = excluded.telegram_enabled,
      email_enabled = excluded.email_enabled,
      webhook_enabled = excluded.webhook_enabled,
      quiet_hours_enabled = excluded.quiet_hours_enabled,
      quiet_hours_start = excluded.quiet_hours_start,
      quiet_hours_end = excluded.quiet_hours_end,
      categories_json = excluded.categories_json,
      updated_at = excluded.updated_at
  `).run(
    prefKey,
    ownerId,
    normalized.inAppEnabled ? 1 : 0,
    normalized.browserNotificationsEnabled ? 1 : 0,
    normalized.soundEnabled ? 1 : 0,
    normalized.telegramEnabled ? 1 : 0,
    normalized.emailEnabled ? 1 : 0,
    normalized.webhookEnabled ? 1 : 0,
    normalized.quietHoursEnabled ? 1 : 0,
    normalized.quietHoursStart,
    normalized.quietHoursEnd,
    safeJsonStringify(normalized.categories),
    nowIso
  );

  return getUserNotificationPreferences(ownerId);
}

function mapDeliveryLogRow(r) {
  if (!r) return null;
  return {
    deliveryId: r.delivery_id,
    notificationId: r.notification_id,
    userId: r.user_id || null,
    channel: r.channel,
    status: r.status,
    reason: r.reason || null,
    attemptedAt: r.attempted_at
  };
}

function recordNotificationDeliveryAttempt(payload = {}, userId = null, txOrDb = null) {
  const db = txOrDb || getDb();
  const ownerId = userId ? String(userId) : payload.userId ? String(payload.userId) : null;
  const notificationId = String(payload.notificationId || '').trim();
  if (!notificationId) {
    const err = new Error('notificationId is required for delivery attempt log.');
    err.code = 'INVALID_DELIVERY_LOG';
    throw err;
  }

  const notifRow = db
    .prepare('SELECT user_id FROM alert_notifications WHERE notification_id = ? LIMIT 1')
    .get(notificationId);
  if (!notifRow) {
    const err = new Error(`Notification '${notificationId}' not found.`);
    err.code = 'NOTIFICATION_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }
  if ((notifRow.user_id || null) !== ownerId) {
    const err = new Error('Forbidden: notification belongs to another user.');
    err.code = 'FORBIDDEN_OWNERSHIP';
    err.statusCode = 403;
    throw err;
  }

  const channel = String(payload.channel || 'IN_APP').trim().toUpperCase();
  const status = String(payload.status || 'DELIVERED').trim().toUpperCase();
  const nowIso = payload.attemptedAt || new Date().toISOString();
  const deliveryId =
    payload.deliveryId || `NDEL-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  db.prepare(`
    INSERT INTO notification_delivery_logs (
      delivery_id, notification_id, user_id, channel, status, reason, attempted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    deliveryId,
    notificationId,
    ownerId,
    channel,
    status,
    payload.reason ? String(redactObject({ reason: String(payload.reason) }).reason) : null,
    nowIso
  );

  const saved = db
    .prepare('SELECT * FROM notification_delivery_logs WHERE delivery_id = ? LIMIT 1')
    .get(deliveryId);
  return mapDeliveryLogRow(saved);
}

function listNotificationDeliveryLogs(notificationId = null, userId = null, limit = 100) {
  const db = getDb();
  const ownerId = userId ? String(userId) : null;
  const maxLimit = Math.max(1, Math.min(200, Number(limit) || 100));

  let rows;
  if (notificationId) {
    const notifRow = db
      .prepare('SELECT user_id FROM alert_notifications WHERE notification_id = ? LIMIT 1')
      .get(String(notificationId));
    if (notifRow && (notifRow.user_id || null) !== ownerId) {
      const err = new Error('Forbidden: notification belongs to another user.');
      err.code = 'FORBIDDEN_OWNERSHIP';
      err.statusCode = 403;
      throw err;
    }
    rows = ownerId
      ? db
          .prepare(
            `SELECT * FROM notification_delivery_logs WHERE user_id = ? AND notification_id = ? ORDER BY attempted_at DESC, delivery_id DESC LIMIT ?`
          )
          .all(ownerId, String(notificationId), maxLimit)
      : db
          .prepare(
            `SELECT * FROM notification_delivery_logs WHERE user_id IS NULL AND notification_id = ? ORDER BY attempted_at DESC, delivery_id DESC LIMIT ?`
          )
          .all(String(notificationId), maxLimit);
  } else {
    rows = ownerId
      ? db
          .prepare(
            `SELECT * FROM notification_delivery_logs WHERE user_id = ? ORDER BY attempted_at DESC, delivery_id DESC LIMIT ?`
          )
          .all(ownerId, maxLimit)
      : db
          .prepare(
            `SELECT * FROM notification_delivery_logs WHERE user_id IS NULL ORDER BY attempted_at DESC, delivery_id DESC LIMIT ?`
          )
          .all(maxLimit);
  }

  return rows.map(mapDeliveryLogRow);
}

function mapNotificationRow(r, includeDeliveries = false) {
  if (!r) return null;
  const mapped = {
    notificationId: r.notification_id,
    id: r.notification_id,
    userId: r.user_id || null,
    sourceEventId: r.source_event_id || null,
    alertId: r.alert_id || null,
    dedupKey: r.dedup_key,
    category: r.category || 'PRICE_ALERT',
    severity: r.severity || 'INFO',
    title: r.title,
    message: r.message,
    symbol: r.symbol || null,
    tradingsymbol: r.tradingsymbol || r.symbol || null,
    exchange: r.exchange || null,
    instrumentType: r.instrument_type || null,
    alertType: r.alert_type || null,
    conditionSummary: r.condition_summary || r.title,
    thresholdValue:
      r.threshold_value !== null && r.threshold_value !== undefined
        ? Number(r.threshold_value)
        : null,
    observedPrice:
      r.observed_price !== null && r.observed_price !== undefined
        ? Number(r.observed_price)
        : null,
    observedValue: r.observed_value || null,
    quoteTimestamp: r.quote_timestamp || null,
    metadata: safeJsonParse(r.metadata_json, {}),
    read: Boolean(r.read_status),
    readAt: r.read_at || null,
    triggeredAt: r.triggered_at,
    createdAt: r.created_at
  };

  if (includeDeliveries) {
    mapped.deliveries = listNotificationDeliveryLogs(r.notification_id, r.user_id || null, 20);
  }
  return mapped;
}

function persistNotificationAndDispatchPlan(notifSpec = {}, userId = null, options = {}) {
  const db = getDb();
  const ownerId = userId ? String(userId) : notifSpec.userId ? String(notifSpec.userId) : null;
  const dedupKey = String(notifSpec.dedupKey || '').trim();
  if (!dedupKey) {
    const err = new Error('Notification dedupKey is required.');
    err.code = 'INVALID_NOTIFICATION_PAYLOAD';
    throw err;
  }

  // Deduplication check: if notification already exists for this dedupKey, return existing without duplicate creation
  const existingRow = db
    .prepare('SELECT * FROM alert_notifications WHERE dedup_key = ? LIMIT 1')
    .get(dedupKey);
  if (existingRow) {
    if ((existingRow.user_id || null) !== ownerId) {
      const err = new Error('Forbidden: notification belongs to another user.');
      err.code = 'FORBIDDEN_OWNERSHIP';
      err.statusCode = 403;
      throw err;
    }
    return {
      created: false,
      deduplicated: true,
      notification: mapNotificationRow(existingRow, true)
    };
  }

  const prefs = getUserNotificationPreferences(ownerId);
  const extStatus = notificationDelivery.getSafeExternalChannelStatus(options.env || process.env);
  const dispatchPlan = NotificationEngine.evaluateChannelDispatchPlan(notifSpec, prefs, {
    nowTime: options.nowTime || notifSpec.triggeredAt,
    externalChannelStatus: extStatus
  });

  // If category is disabled or in-app notifications are disabled (unless EMERGENCY_STOP), skip persisting in-app notification
  if (!dispatchPlan.channels.IN_APP.shouldSend) {
    return {
      created: false,
      deduplicated: false,
      skippedByPreference: true,
      dispatchPlan,
      notification: null
    };
  }

  const nowIso = options.nowIso || new Date().toISOString();
  const notificationId =
    notifSpec.notificationId || `NTF-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const mappedNotif = withTransaction((tx) => {
    tx.prepare(`
      INSERT INTO alert_notifications (
        notification_id, user_id, source_event_id, alert_id, dedup_key,
        category, severity, title, message, symbol, tradingsymbol, exchange,
        instrument_type, alert_type, condition_summary, threshold_value,
        observed_price, observed_value, quote_timestamp, metadata_json,
        read_status, read_at, triggered_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
    `).run(
      notificationId,
      ownerId,
      notifSpec.sourceEventId || null,
      notifSpec.alertId || null,
      dedupKey,
      notifSpec.category || 'PRICE_ALERT',
      notifSpec.severity || 'INFO',
      notifSpec.title,
      notifSpec.message,
      notifSpec.symbol || null,
      notifSpec.tradingsymbol || notifSpec.symbol || null,
      notifSpec.exchange || null,
      notifSpec.instrumentType || null,
      notifSpec.alertType || null,
      notifSpec.conditionSummary || notifSpec.title,
      notifSpec.thresholdValue !== undefined ? notifSpec.thresholdValue : null,
      notifSpec.observedPrice !== undefined ? notifSpec.observedPrice : null,
      notifSpec.observedValue !== undefined ? notifSpec.observedValue : null,
      notifSpec.quoteTimestamp || nowIso,
      safeJsonStringify({
        ...(notifSpec.metadata || {}),
        dispatchPlan: {
          inQuietHours: dispatchPlan.inQuietHours,
          browserEligible: dispatchPlan.channels.BROWSER.shouldSend,
          soundEligible: dispatchPlan.channels.SOUND.shouldSend
        }
      }),
      notifSpec.triggeredAt || nowIso,
      nowIso
    );

    // Record channel delivery status logs atomically inside the same transaction
    for (const [channelName, chPlan] of Object.entries(dispatchPlan.channels)) {
      if (channelName === 'IN_APP') {
        recordNotificationDeliveryAttempt(
          {
            notificationId,
            channel: 'IN_APP',
            status: 'DELIVERED',
            reason: chPlan.reason,
            attemptedAt: nowIso
          },
          ownerId,
          tx
        );
      } else if (!chPlan.shouldSend) {
        if (
          chPlan.status === 'SKIPPED_QUIET_HOURS' ||
          chPlan.status === 'UNCONFIGURED' ||
          options.logAllChannels
        ) {
          recordNotificationDeliveryAttempt(
            {
              notificationId,
              channel: channelName,
              status: chPlan.status,
              reason: chPlan.reason,
              attemptedAt: nowIso
            },
            ownerId,
            tx
          );
        }
      } else if (channelName === 'BROWSER' || channelName === 'SOUND') {
        recordNotificationDeliveryAttempt(
          {
            notificationId,
            channel: channelName,
            status: 'PENDING_CLIENT',
            reason: chPlan.reason,
            attemptedAt: nowIso
          },
          ownerId,
          tx
        );
      }
    }

    const savedRow = tx
      .prepare('SELECT * FROM alert_notifications WHERE notification_id = ? LIMIT 1')
      .get(notificationId);
    return mapNotificationRow(savedRow, true);
  });

  // Trigger asynchronous external channel dispatch if any server channel is READY_SERVER_DISPATCH
  for (const extCh of ['TELEGRAM', 'EMAIL', 'WEBHOOK']) {
    if (dispatchPlan.channels[extCh]?.shouldSend) {
      notificationDelivery
        .dispatchExternalChannel(extCh, mappedNotif, { env: options.env || process.env })
        .then((res) => {
          try {
            recordNotificationDeliveryAttempt(
              {
                notificationId,
                channel: extCh,
                status: res.status,
                reason: res.reason
              },
              ownerId
            );
          } catch (_) {}
        })
        .catch((err) => {
          try {
            recordNotificationDeliveryAttempt(
              {
                notificationId,
                channel: extCh,
                status: 'FAILED',
                reason: err?.message || `${extCh} dispatch error`
              },
              ownerId
            );
          } catch (_) {}
        });
    }
  }

  return {
    created: true,
    deduplicated: false,
    dispatchPlan,
    notification: mappedNotif
  };
}

function createNotificationFromAlertEvent(alertEvent = {}, userId = null, options = {}) {
  const ownerId = userId ? String(userId) : alertEvent.userId ? String(alertEvent.userId) : null;
  const spec = NotificationEngine.buildNotificationFromAlertEvent(alertEvent, ownerId);
  return persistNotificationAndDispatchPlan(spec, ownerId, options);
}

function createSystemOrRiskNotification(payload = {}, userId = null, options = {}) {
  const ownerId = userId ? String(userId) : payload.userId ? String(payload.userId) : null;
  const spec = NotificationEngine.buildSystemOrRiskNotification(payload, ownerId);
  return persistNotificationAndDispatchPlan(spec, ownerId, options);
}

function syncAlertEventsToNotifications(userId = null, options = {}) {
  const ownerId = userId ? String(userId) : null;
  const events = listAlertEventsHistory({ limit: 200 }, ownerId);
  let createdCount = 0;
  for (const ev of events) {
    try {
      const res = createNotificationFromAlertEvent(ev, ownerId, options);
      if (res.created) {
        createdCount += 1;
        if (ev.acknowledged && res.notification) {
          markNotificationRead(res.notification.notificationId, ownerId);
        }
      }
    } catch (_) {}
  }
  return createdCount;
}

function getNotificationById(notificationId, userId = null) {
  if (!notificationId) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM alert_notifications WHERE notification_id = ? LIMIT 1')
    .get(String(notificationId));
  if (!row) return null;

  const ownerId = userId ? String(userId) : null;
  if ((row.user_id || null) !== ownerId) {
    const err = new Error('Forbidden: notification belongs to another user.');
    err.code = 'FORBIDDEN_OWNERSHIP';
    err.statusCode = 403;
    throw err;
  }
  return mapNotificationRow(row, true);
}

function listUserNotifications(query = {}, userId = null) {
  const db = getDb();
  const ownerId = userId ? String(userId) : null;

  // Ensure any persisted Task 14 alert_events_history rows are synced into notifications
  syncAlertEventsToNotifications(ownerId);

  const rows = ownerId
    ? db
        .prepare(
          `SELECT * FROM alert_notifications WHERE user_id = ? ORDER BY triggered_at DESC, notification_id DESC LIMIT 500`
        )
        .all(ownerId)
    : db
        .prepare(
          `SELECT * FROM alert_notifications WHERE user_id IS NULL ORDER BY triggered_at DESC, notification_id DESC LIMIT 500`
        )
        .all();

  const mapped = rows.map((r) => mapNotificationRow(r, true));
  return NotificationEngine.filterAndPaginateNotifications(mapped, query);
}

function markNotificationRead(notificationId = 'ALL', userId = null) {
  const ownerId = userId ? String(userId) : null;
  const nowIso = new Date().toISOString();

  if (notificationId === 'ALL' || !notificationId) {
    withTransaction((tx) => {
      if (ownerId) {
        tx.prepare(
          `UPDATE alert_notifications SET read_status = 1, read_at = ? WHERE user_id = ? AND read_status = 0`
        ).run(nowIso, ownerId);
        tx.prepare(
          `UPDATE alert_events_history SET acknowledged = 1, acknowledged_at = ? WHERE user_id = ? AND acknowledged = 0`
        ).run(nowIso, ownerId);
      } else {
        tx.prepare(
          `UPDATE alert_notifications SET read_status = 1, read_at = ? WHERE user_id IS NULL AND read_status = 0`
        ).run(nowIso);
        tx.prepare(
          `UPDATE alert_events_history SET acknowledged = 1, acknowledged_at = ? WHERE user_id IS NULL AND acknowledged = 0`
        ).run(nowIso);
      }
    });
    return {
      markedAll: true,
      ...listUserNotifications({}, ownerId)
    };
  }

  withTransaction((tx) => {
    const row = tx
      .prepare('SELECT * FROM alert_notifications WHERE notification_id = ? LIMIT 1')
      .get(String(notificationId));
    if (!row) {
      const err = new Error(`Notification '${notificationId}' not found.`);
      err.code = 'NOTIFICATION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    if ((row.user_id || null) !== ownerId) {
      const err = new Error('Forbidden: notification belongs to another user.');
      err.code = 'FORBIDDEN_OWNERSHIP';
      err.statusCode = 403;
      throw err;
    }

    tx.prepare(
      `UPDATE alert_notifications SET read_status = 1, read_at = ? WHERE notification_id = ?`
    ).run(nowIso, String(notificationId));

    if (row.source_event_id) {
      if (ownerId) {
        tx.prepare(
          `UPDATE alert_events_history SET acknowledged = 1, acknowledged_at = ? WHERE event_id = ? AND user_id = ?`
        ).run(nowIso, String(row.source_event_id), ownerId);
      } else {
        tx.prepare(
          `UPDATE alert_events_history SET acknowledged = 1, acknowledged_at = ? WHERE event_id = ? AND user_id IS NULL`
        ).run(nowIso, String(row.source_event_id));
      }
    }
  });

  const updated = getNotificationById(notificationId, ownerId);
  const summary = listUserNotifications({}, ownerId);
  return {
    markedAll: false,
    notification: updated,
    unreadCount: summary.unreadCount,
    notifications: summary.notifications
  };
}

function listRecentSearches(limit = 12, userId = null) {
  const db = getDb();
  const maxLimit = clampQueryLimit(limit, 12, 100);
  const rows = userId
    ? db.prepare(`
        SELECT * FROM user_recent_searches
        WHERE user_id = ?
        ORDER BY searched_at DESC
        LIMIT ?
      `).all(String(userId), maxLimit)
    : db.prepare(`
        SELECT * FROM user_recent_searches
        WHERE user_id IS NULL
        ORDER BY searched_at DESC
        LIMIT ?
      `).all(maxLimit);

  return rows.map(mapSearchInstrumentRow);
}

function recordRecentSearch(item = {}, userId = null) {
  const db = getDb();
  const ownerId = userId ? String(userId) : null;
  const exchange = String(item.exchange || 'NSE').trim().toUpperCase();
  const symbolKey = String(item.key || item.tradingsymbol || item.name || '').trim().toUpperCase();
  if (!symbolKey) return listRecentSearches(12, ownerId);

  const nowIso = new Date().toISOString();
  const existing = ownerId
    ? db.prepare(`
        SELECT recent_id FROM user_recent_searches
        WHERE user_id = ? AND exchange = ? AND UPPER(symbol_key) = ?
      `).get(ownerId, exchange, symbolKey)
    : db.prepare(`
        SELECT recent_id FROM user_recent_searches
        WHERE user_id IS NULL AND exchange = ? AND UPPER(symbol_key) = ?
      `).get(exchange, symbolKey);

  const recentId = existing?.recent_id || `REC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const instType = String(item.type || item.instrumentType || 'EQUITY').trim().toUpperCase();

  db.prepare(`
    INSERT OR REPLACE INTO user_recent_searches (
      recent_id, user_id, symbol_key, tradingsymbol, name, exchange,
      instrument_type, symboltoken, option_type, strike_price, expiry, lot_size, query_text, searched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    recentId,
    ownerId,
    symbolKey,
    item.tradingsymbol ? String(item.tradingsymbol).trim() : null,
    String(item.name || item.tradingsymbol || symbolKey).trim(),
    exchange,
    instType,
    item.symboltoken ? String(item.symboltoken).trim() : null,
    item.optionType ? String(item.optionType).trim().toUpperCase() : null,
    item.strikePrice !== null && item.strikePrice !== undefined && Number.isFinite(Number(item.strikePrice))
      ? Number(item.strikePrice)
      : null,
    item.expiry ? String(item.expiry).trim() : null,
    item.lotSize !== null && item.lotSize !== undefined && Number.isFinite(Number(item.lotSize))
      ? Number(item.lotSize)
      : null,
    item.queryText ? String(item.queryText).trim() : null,
    nowIso
  );

  return listRecentSearches(12, ownerId);
}

function clearRecentSearches(userId = null) {
  const db = getDb();
  if (userId) {
    db.prepare('DELETE FROM user_recent_searches WHERE user_id = ?').run(String(userId));
  } else {
    db.prepare('DELETE FROM user_recent_searches WHERE user_id IS NULL').run();
  }
  return [];
}

function cacheBrokerSearchResults(results = [], provider = 'ANGEL_ONE') {
  if (!Array.isArray(results) || !results.length) return 0;
  const nowIso = new Date().toISOString();

  return withTransaction((tx) => {
    let count = 0;
    const stmt = tx.prepare(`
      INSERT OR REPLACE INTO broker_instruments_cache (
        cache_key, exchange, tradingsymbol, symboltoken, name,
        instrument_type, option_type, strike_price, expiry, lot_size, provider, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of results) {
      if (!item || !item.exchange || !item.tradingsymbol || !item.symboltoken) continue;
      const exch = String(item.exchange).trim().toUpperCase();
      const tsym = String(item.tradingsymbol).trim();
      const token = String(item.symboltoken).trim();
      const cacheKey = `${exch}:${tsym}:${token}`;
      const instType = String(item.instrumentType || item.type || 'EQUITY').trim().toUpperCase();

      stmt.run(
        cacheKey,
        exch,
        tsym,
        token,
        String(item.name || tsym),
        instType,
        item.optionType ? String(item.optionType).trim().toUpperCase() : null,
        item.strikePrice !== null && item.strikePrice !== undefined && Number.isFinite(Number(item.strikePrice))
          ? Number(item.strikePrice)
          : null,
        item.expiry ? String(item.expiry).trim() : null,
        item.lotSize !== null && item.lotSize !== undefined && Number.isFinite(Number(item.lotSize))
          ? Number(item.lotSize)
          : null,
        String(provider || 'ANGEL_ONE'),
        nowIso
      );
      count += 1;
    }

    return count;
  });
}

function searchCachedBrokerInstruments(exchange = '', query = '', limit = 25) {
  const db = getDb();
  const exch = String(exchange || '').trim().toUpperCase();
  const q = String(query || '').trim().toUpperCase();
  if (!q) return [];
  const maxLimit = clampQueryLimit(limit, 25, 200);

  const likePattern = `%${q}%`;
  const rows = exch && exch !== 'ALL'
    ? db.prepare(`
        SELECT * FROM broker_instruments_cache
        WHERE exchange = ? AND (UPPER(tradingsymbol) LIKE ? OR UPPER(name) LIKE ? OR symboltoken = ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(exch, likePattern, likePattern, q, maxLimit)
    : db.prepare(`
        SELECT * FROM broker_instruments_cache
        WHERE UPPER(tradingsymbol) LIKE ? OR UPPER(name) LIKE ? OR symboltoken = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(likePattern, likePattern, q, maxLimit);

  return rows.map((r) => ({
    exchange: r.exchange,
    tradingsymbol: r.tradingsymbol,
    symboltoken: r.symboltoken,
    name: r.name || r.tradingsymbol,
    instrumentType: r.instrument_type,
    optionType: r.option_type,
    strikePrice: r.strike_price !== null ? Number(r.strike_price) : null,
    expiry: r.expiry,
    lotSize: r.lot_size !== null ? Number(r.lot_size) : null
  }));
}

function cacheMarketIntelligenceItems(items = []) {
  if (!Array.isArray(items) || !items.length) return 0;

  return withTransaction((tx) => {
    let count = 0;
    const stmt = tx.prepare(`
      INSERT OR REPLACE INTO market_intelligence_cache (
        item_id, category, source, provider, headline, summary,
        publication_timestamp, retrieval_timestamp, url, related_symbol,
        company_name, sentiment, sentiment_score, freshness, is_stale
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      if (!item || !item.itemId || !item.headline || !item.source) continue;
      stmt.run(
        String(item.itemId),
        String(item.category || 'INDIAN_MARKET'),
        String(item.source),
        String(item.provider || item.source),
        String(item.headline),
        item.summary ? String(item.summary) : null,
        item.publicationTimestamp || null,
        String(item.retrievalTimestamp || new Date().toISOString()),
        item.url || null,
        item.relatedSymbol ? String(item.relatedSymbol).toUpperCase() : null,
        item.companyName || null,
        item.sentiment || null,
        item.sentimentScore !== null && item.sentimentScore !== undefined && Number.isFinite(Number(item.sentimentScore))
          ? Number(item.sentimentScore)
          : null,
        String(item.freshness || 'FRESH'),
        item.isStale ? 1 : 0
      );
      count += 1;
    }

    return count;
  });
}

function listCachedMarketIntelligence(category = '', symbol = '', limit = 30) {
  const db = getDb();
  const cat = String(category || '').trim().toUpperCase();
  const sym = String(symbol || '').trim().toUpperCase();
  const max = Math.max(1, Math.min(100, Number(limit) || 30));

  let rows;
  if (sym) {
    rows = db.prepare(`
      SELECT * FROM market_intelligence_cache
      WHERE UPPER(related_symbol) = ?
      ORDER BY publication_timestamp DESC, retrieval_timestamp DESC
      LIMIT ?
    `).all(sym, max);
  } else if (cat && cat !== 'ALL') {
    rows = db.prepare(`
      SELECT * FROM market_intelligence_cache
      WHERE category = ?
      ORDER BY publication_timestamp DESC, retrieval_timestamp DESC
      LIMIT ?
    `).all(cat, max);
  } else {
    rows = db.prepare(`
      SELECT * FROM market_intelligence_cache
      ORDER BY publication_timestamp DESC, retrieval_timestamp DESC
      LIMIT ?
    `).all(max);
  }

  return rows.map((r) => ({
    itemId: r.item_id,
    category: r.category,
    source: r.source,
    provider: r.provider,
    headline: r.headline,
    title: r.headline,
    summary: r.summary,
    publicationTimestamp: r.publication_timestamp,
    retrievalTimestamp: r.retrieval_timestamp,
    url: r.url,
    relatedSymbol: r.related_symbol,
    companyName: r.company_name,
    sentiment: r.sentiment,
    sentimentScore: r.sentiment_score !== null ? Number(r.sentiment_score) : null,
    freshness: r.freshness,
    isStale: Boolean(r.is_stale)
  }));
}

function getDatabaseStatus() {
  const db = getDb();
  const resolvedPath = currentDbPath || resolveDbPath();
  const isMemory = resolvedPath === ':memory:' || String(resolvedPath).startsWith('file::memory:');
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name);
  const migrations = db
    .prepare(`SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC`)
    .all()
    .map((r) => ({
      version: Number(r.version),
      name: r.name,
      appliedAt: r.applied_at
    }));
  const journalModeRow = db.prepare('PRAGMA journal_mode').get();
  const fkRow = db.prepare('PRAGMA foreign_keys').get();

  return {
    engine: 'node:sqlite (SQLite WAL)',
    connected: true,
    isMemory,
    path: isMemory ? ':memory:' : path.basename(resolvedPath),
    relativePath: isMemory ? ':memory:' : path.relative(PROJECT_ROOT, resolvedPath),
    schemaVersion: migrations.length > 0 ? migrations[migrations.length - 1].version : 0,
    latestExpectedSchemaVersion: LATEST_SCHEMA_VERSION,
    migrationsCount: migrations.length,
    journalMode: journalModeRow?.journal_mode || 'wal',
    foreignKeysEnabled: Boolean(fkRow?.foreign_keys),
    tablesCount: tables.length,
    tables
  };
}

function runDatabaseAuditAndIntegrityCheck(customPath) {
  const db = getDb(customPath);
  const resolvedPath = currentDbPath || resolveDbPath(customPath);
  const isMemory = resolvedPath === ':memory:' || String(resolvedPath).startsWith('file::memory:');

  const quickCheckRow = db.prepare('PRAGMA quick_check').get();
  const quickCheck = quickCheckRow?.quick_check || Object.values(quickCheckRow || {})[0] || 'unknown';
  const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
  const journalModeRow = db.prepare('PRAGMA journal_mode').get();
  const fkRow = db.prepare('PRAGMA foreign_keys').get();
  const busyTimeoutRow = db.prepare('PRAGMA busy_timeout').get();

  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name);

  const indexes = db
    .prepare(`SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY tbl_name, name`)
    .all()
    .map((r) => ({ name: r.name, table: r.tbl_name }));

  const migrations = db
    .prepare(`SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC`)
    .all()
    .map((r) => ({
      version: Number(r.version),
      name: r.name,
      appliedAt: r.applied_at
    }));

  const missingTables = EXPECTED_PRODUCTION_TABLES.filter((t) => !tables.includes(t));

  // Verify no unredacted secrets exist in JSON payload columns across audit/decision/settings tables
  const secretScanTables = [
    { table: 'app_settings', col: 'value_json' },
    { table: 'audit_events', col: 'details_json' },
    { table: 'ai_decisions', col: 'payload_json' },
    { table: 'strategy_decisions', col: 'payload_json' },
    { table: 'risk_events', col: 'payload_json' },
    { table: 'alert_notifications', col: 'metadata_json' }
  ];
  let unredactedSecretHits = 0;
  for (const spec of secretScanTables) {
    if (!tables.includes(spec.table)) continue;
    const rows = db.prepare(`SELECT ${spec.col} AS json_text FROM ${spec.table} LIMIT 200`).all();
    for (const r of rows) {
      const txt = String(r.json_text || '');
      if (
        (txt.includes('"angel_api_key"') ||
          txt.includes('"gemini_api_key"') ||
          txt.includes('"telegram_bot_token"') ||
          txt.includes('"password_hash"')) &&
        !txt.includes('[REDACTED]')
      ) {
        unredactedSecretHits += 1;
      }
    }
  }

  // Verify open-position invariant: at most 1 OPEN position per user scope
  const duplicateOpenPosRows = db
    .prepare(`
      SELECT COALESCE(user_id, '__GUEST__') AS scope_key, COUNT(*) AS open_count
      FROM paper_positions
      WHERE status = 'OPEN'
      GROUP BY COALESCE(user_id, '__GUEST__')
      HAVING COUNT(*) > 1
    `)
    .all();

  const schemaVersion = migrations.length > 0 ? migrations[migrations.length - 1].version : 0;
  const healthy =
    quickCheck === 'ok' &&
    fkViolations.length === 0 &&
    missingTables.length === 0 &&
    schemaVersion === LATEST_SCHEMA_VERSION &&
    unredactedSecretHits === 0 &&
    duplicateOpenPosRows.length === 0;

  return {
    ok: healthy,
    healthy,
    engine: 'node:sqlite (DatabaseSync)',
    singleSourceOfTruth: true,
    isMemory,
    databaseFile: isMemory ? ':memory:' : path.basename(resolvedPath),
    relativePath: isMemory ? ':memory:' : path.relative(PROJECT_ROOT, resolvedPath),
    journalMode: journalModeRow?.journal_mode || 'wal',
    foreignKeysEnabled: Boolean(fkRow?.foreign_keys),
    busyTimeoutMs: Number(busyTimeoutRow?.timeout ?? Object.values(busyTimeoutRow || {})[0] ?? 0),
    integrityCheck: quickCheck,
    foreignKeyViolationsCount: fkViolations.length,
    schemaVersion,
    latestExpectedSchemaVersion: LATEST_SCHEMA_VERSION,
    migrationsCount: migrations.length,
    migrations,
    tablesCount: tables.length,
    expectedTablesCount: EXPECTED_PRODUCTION_TABLES.length,
    missingTables,
    tables,
    indexesCount: indexes.length,
    indexes,
    invariants: {
      singleOpenPositionPerUserOk: duplicateOpenPosRows.length === 0,
      zeroUnredactedSecretsInJsonOk: unredactedSecretHits === 0,
      foreignKeyConstraintsOk: fkViolations.length === 0
    }
  };
}

function checkpointWal(mode = 'PASSIVE', customPath) {
  const db = getDb(customPath);
  const resolvedPath = currentDbPath || resolveDbPath(customPath);
  const isMemory = resolvedPath === ':memory:' || String(resolvedPath).startsWith('file::memory:');
  const safeModes = new Set(['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE']);
  const normMode = safeModes.has(String(mode || 'PASSIVE').toUpperCase())
    ? String(mode || 'PASSIVE').toUpperCase()
    : 'PASSIVE';

  if (isMemory) {
    return {
      ok: true,
      isMemory: true,
      mode: normMode,
      busy: 0,
      logFrames: 0,
      checkpointedFrames: 0
    };
  }

  const row = db.prepare(`PRAGMA wal_checkpoint(${normMode})`).get() || {};
  return {
    ok: Number(row.busy || 0) === 0,
    isMemory: false,
    mode: normMode,
    busy: Number(row.busy || 0),
    logFrames: Number(row.log || 0),
    checkpointedFrames: Number(row.checkpointed || 0)
  };
}

function backupDatabase(destinationPath, customSourcePath) {
  if (!destinationPath || typeof destinationPath !== 'string' || !destinationPath.trim()) {
    const err = new Error('Destination backup file path is required.');
    err.code = 'INVALID_BACKUP_DESTINATION';
    throw err;
  }

  const db = getDb(customSourcePath);
  const sourcePath = currentDbPath || resolveDbPath(customSourcePath);
  const absDest = path.isAbsolute(destinationPath.trim())
    ? path.normalize(destinationPath.trim())
    : path.resolve(PROJECT_ROOT, destinationPath.trim());

  if (sourcePath !== ':memory:' && path.resolve(sourcePath) === path.resolve(absDest)) {
    const err = new Error('Backup destination path cannot be the active source database file.');
    err.code = 'BACKUP_SOURCE_COLLISION';
    throw err;
  }

  const destDir = path.dirname(absDest);
  fs.mkdirSync(destDir, { recursive: true });

  // Remove stale target file if it already exists so VACUUM INTO creates a clean atomic snapshot
  if (fs.existsSync(absDest)) {
    fs.unlinkSync(absDest);
  }

  checkpointWal('PASSIVE', customSourcePath);
  const escapedDest = absDest.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedDest}'`);

  // Verify the backup file integrity independently without mutating active connection
  const verifyConn = new DatabaseSync(absDest, { readOnly: true });
  let integrity = 'unknown';
  let schemaVersion = 0;
  let tablesCount = 0;
  try {
    const qcRow = verifyConn.prepare('PRAGMA quick_check').get();
    integrity = qcRow?.quick_check || Object.values(qcRow || {})[0] || 'unknown';
    const tables = verifyConn
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all();
    tablesCount = tables.length;
    const migRow = verifyConn
      .prepare(`SELECT MAX(version) AS max_ver FROM schema_migrations`)
      .get();
    schemaVersion = Number(migRow?.max_ver || 0);
  } finally {
    verifyConn.close();
  }

  const stat = fs.statSync(absDest);
  return {
    ok: integrity === 'ok' && schemaVersion === LATEST_SCHEMA_VERSION && stat.size > 0,
    backupPath: absDest,
    relativeBackupPath: path.relative(PROJECT_ROOT, absDest),
    sizeBytes: stat.size,
    integrityCheck: integrity,
    schemaVersion,
    tablesCount,
    createdAt: new Date().toISOString()
  };
}

function restoreDatabaseFromBackup(backupSourcePath, restoreTargetPath) {
  if (!backupSourcePath || typeof backupSourcePath !== 'string' || !backupSourcePath.trim()) {
    const err = new Error('Backup source file path is required.');
    err.code = 'INVALID_BACKUP_SOURCE';
    throw err;
  }
  if (!restoreTargetPath || typeof restoreTargetPath !== 'string' || !restoreTargetPath.trim()) {
    const err = new Error('Restore target file path is required.');
    err.code = 'INVALID_RESTORE_TARGET';
    throw err;
  }

  const absSource = path.isAbsolute(backupSourcePath.trim())
    ? path.normalize(backupSourcePath.trim())
    : path.resolve(PROJECT_ROOT, backupSourcePath.trim());

  const absTarget = path.isAbsolute(restoreTargetPath.trim())
    ? path.normalize(restoreTargetPath.trim())
    : path.resolve(PROJECT_ROOT, restoreTargetPath.trim());

  if (!fs.existsSync(absSource)) {
    const err = new Error('Backup source file does not exist.');
    err.code = 'BACKUP_SOURCE_NOT_FOUND';
    throw err;
  }

  if (path.resolve(absSource) === path.resolve(absTarget)) {
    const err = new Error('Restore target path cannot be the backup source file itself.');
    err.code = 'RESTORE_SOURCE_COLLISION';
    throw err;
  }

  const activePath = currentDbPath || resolveDbPath();
  if (
    path.resolve(absTarget) === path.resolve(DEFAULT_DB_PATH) ||
    (activePath !== ':memory:' && path.resolve(absTarget) === path.resolve(activePath))
  ) {
    const err = new Error(
      'Refusing to overwrite the active or canonical production database directly during restore.'
    );
    err.code = 'ACTIVE_DATABASE_OVERWRITE_FORBIDDEN';
    throw err;
  }

  // 1. Validate backup source integrity before restoring
  const sourceConn = new DatabaseSync(absSource, { readOnly: true });
  let sourceIntegrity = 'unknown';
  try {
    const qcRow = sourceConn.prepare('PRAGMA quick_check').get();
    sourceIntegrity = qcRow?.quick_check || Object.values(qcRow || {})[0] || 'unknown';
  } finally {
    sourceConn.close();
  }
  if (sourceIntegrity !== 'ok') {
    const err = new Error(`Backup source file failed integrity check (${sourceIntegrity}).`);
    err.code = 'CORRUPT_BACKUP_SOURCE';
    throw err;
  }

  // 2. Ensure target directory exists and clean any prior target file + WAL/SHM sidecars
  fs.mkdirSync(path.dirname(absTarget), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const candidate = `${absTarget}${suffix}`;
    if (fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
    }
  }

  // 3. Perform atomic SQLite snapshot copy from backup into target path
  const restoreConn = new DatabaseSync(absSource, { readOnly: true });
  try {
    const escapedTarget = absTarget.replace(/'/g, "''");
    restoreConn.exec(`VACUUM INTO '${escapedTarget}'`);
  } finally {
    restoreConn.close();
  }

  // 4. Verify restored database schema and integrity
  const verifyConn = new DatabaseSync(absTarget, { readOnly: true });
  let restoredIntegrity = 'unknown';
  let schemaVersion = 0;
  let tables = [];
  try {
    const qcRow = verifyConn.prepare('PRAGMA quick_check').get();
    restoredIntegrity = qcRow?.quick_check || Object.values(qcRow || {})[0] || 'unknown';
    tables = verifyConn
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all()
      .map((r) => r.name);
    const migRow = verifyConn
      .prepare(`SELECT MAX(version) AS max_ver FROM schema_migrations`)
      .get();
    schemaVersion = Number(migRow?.max_ver || 0);
  } finally {
    verifyConn.close();
  }

  const missingTables = EXPECTED_PRODUCTION_TABLES.filter((t) => !tables.includes(t));
  const stat = fs.statSync(absTarget);

  return {
    ok:
      restoredIntegrity === 'ok' &&
      schemaVersion === LATEST_SCHEMA_VERSION &&
      missingTables.length === 0 &&
      stat.size > 0,
    restoredPath: absTarget,
    relativeRestoredPath: path.relative(PROJECT_ROOT, absTarget),
    sizeBytes: stat.size,
    integrityCheck: restoredIntegrity,
    schemaVersion,
    tablesCount: tables.length,
    missingTables,
    restoredAt: new Date().toISOString()
  };
}

module.exports = {
  PROJECT_ROOT,
  DEFAULT_DB_PATH,
  LATEST_SCHEMA_VERSION,
  EXPECTED_PRODUCTION_TABLES,
  normalizeSqlitePathInput,
  resolveDbPath,
  getDb,
  closeDb,
  checkpointWal,
  backupDatabase,
  restoreDatabaseFromBackup,
  withTransaction,
  resetAllTablesForTest,
  redactObject,
  setSetting,
  getSetting,
  getEmergencyStop,
  setEmergencyStop,
  normalizeEmail,
  ensureUserPaperAccount,
  createUserRecord,
  getUserByEmail,
  getUserById,
  updateUserNameAndSettings,
  updateUserPasswordHash,
  updateUserEmailDirect,
  createEmailChangeVerification,
  getPendingEmailChangeForUser,
  confirmEmailChangeByTokenHash,
  createSessionRecord,
  getActiveSessionByTokenHash,
  touchSession,
  revokeSessionByTokenHash,
  revokeAllUserSessions,
  getPaperAccount,
  getOpenPosition,
  getPositionByIdForUser,
  recordOpenPositionTransaction,
  recordRejectedPaperOrder,
  updateOpenPositionState,
  recordClosePositionTransaction,
  listPaperOrders,
  listPaperFills,
  listTradeHistory,
  insertAuditEvent,
  listAuditEvents,
  insertAIDecisions: insertAIDecision,
  insertAIDecision,
  listAIDecisions,
  insertStrategyDecision,
  listStrategyDecisions,
  insertRiskEvent,
  listRiskEvents,
  insertBacktestRun,
  insertFailedBacktestRun,
  listBacktestRuns,
  getBacktestRunById,
  getBacktestRunTrades,
  upsertMarketSnapshotCache,
  getMarketSnapshotCache,
  listWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
  reorderWatchlist,
  createMarketAlert,
  getMarketAlertById,
  listMarketAlerts,
  updateMarketAlertStatus,
  deleteMarketAlert,
  recordTriggeredAlertEvent,
  listAlertEventsHistory,
  acknowledgeAlertEvent,
  evaluateUserAlertsAgainstMarketData,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
  recordNotificationDeliveryAttempt,
  listNotificationDeliveryLogs,
  createNotificationFromAlertEvent,
  createSystemOrRiskNotification,
  syncAlertEventsToNotifications,
  getNotificationById,
  listUserNotifications,
  markNotificationRead,
  listRecentSearches,
  recordRecentSearch,
  clearRecentSearches,
  cacheBrokerSearchResults,
  searchCachedBrokerInstruments,
  cacheMarketIntelligenceItems,
  listCachedMarketIntelligence,
  getDatabaseStatus,
  runDatabaseAuditAndIntegrityCheck
};
