/*
 * YASHWIN AI Trading Assistant
 * Task 15 — Complete Alert Notifications System & Delivery Engine
 *
 * Pure deterministic, zero-fabrication notification engine for:
 * - Transforming Task 14 triggered alert events (`alert_events_history`),
 *   risk lockouts, emergency stop events, and paper execution events into
 *   deduplicated, user-isolated notifications (`alert_notifications`).
 * - Managing per-user notification preferences (`user_notification_preferences`):
 *   * In-App Notification Center (enabled/disabled)
 *   * Browser Notification API (enabled/disabled + permission state)
 *   * Sound Alerts (enabled/disabled)
 *   * Optional External Channels (TELEGRAM, EMAIL, WEBHOOK — server-only)
 *   * Category filters (PRICE_ALERT, TECHNICAL_ALERT, STRATEGY_ALERT, RISK_WARNING, EMERGENCY_STOP, PAPER_EXECUTION, SYSTEM_ALERT)
 *   * Quiet Hours / Mute Window (e.g., 22:00 to 07:00)
 * - Recording accurate per-channel delivery attempts (`notification_delivery_logs`)
 *   with explicit status:
 *   * DELIVERED
 *   * SKIPPED_PREFERENCE
 *   * SKIPPED_QUIET_HOURS
 *   * UNCONFIGURED
 *   * PERMISSION_DENIED
 *   * FAILED
 *   * RATE_LIMITED
 * - Enforcing strict safety & governance:
 *   * Notifications are strictly informational.
 *   * Never executes live or paper orders automatically.
 *   * Never bypasses StrategyEngine, AISafetyGate, RiskEngine, or Emergency Stop.
 *   * Never fabricates delivery success when an external channel is unconfigured or fails.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NotificationEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENGINE_VERSION = '1.0.0-DETERMINISTIC-TASK15';

  const SUPPORTED_NOTIFICATION_CATEGORIES = [
    'PRICE_ALERT',
    'PERCENT_CHANGE_ALERT',
    'VOLUME_SPIKE_ALERT',
    'INDICATOR_ALERT',
    'STRATEGY_SIGNAL_ALERT',
    'CANDLE_BREAKOUT_ALERT',
    'TECHNICAL_ALERT',
    'STRATEGY_ALERT',
    'RISK_WARNING',
    'EMERGENCY_STOP',
    'PAPER_EXECUTION',
    'SYSTEM_ALERT'
  ];

  const SUPPORTED_DELIVERY_CHANNELS = [
    'IN_APP',
    'BROWSER',
    'SOUND',
    'TELEGRAM',
    'EMAIL',
    'WEBHOOK'
  ];

  const DELIVERY_STATUSES = [
    'DELIVERED',
    'SKIPPED_PREFERENCE',
    'SKIPPED_QUIET_HOURS',
    'SKIPPED_PERMISSION',
    'UNCONFIGURED',
    'PERMISSION_DENIED',
    'FAILED',
    'RATE_LIMITED',
    'PENDING_CLIENT'
  ];

  const SEVERITY_LEVELS = ['INFO', 'WARNING', 'HIGH', 'CRITICAL'];

  const DEFAULT_PREFERENCES = {
    inAppEnabled: true,
    browserNotificationsEnabled: false,
    soundEnabled: false,
    telegramEnabled: false,
    emailEnabled: false,
    webhookEnabled: false,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    categories: {
      PRICE_ALERT: true,
      PERCENT_CHANGE_ALERT: true,
      VOLUME_SPIKE_ALERT: true,
      INDICATOR_ALERT: true,
      STRATEGY_SIGNAL_ALERT: true,
      CANDLE_BREAKOUT_ALERT: true,
      TECHNICAL_ALERT: true,
      STRATEGY_ALERT: true,
      RISK_WARNING: true,
      EMERGENCY_STOP: true,
      PAPER_EXECUTION: true,
      SYSTEM_ALERT: true
    }
  };

  const DOCUMENTED_NOTIFICATION_RULES = {
    version: ENGINE_VERSION,
    tradingMode: 'paper',
    liveTradingEnabled: false,
    autoOrderPlacement: false,
    autoOrderExecutionOnNotification: false,
    supportedCategories: SUPPORTED_NOTIFICATION_CATEGORIES,
    supportedChannels: SUPPORTED_DELIVERY_CHANNELS,
    deliveryStatuses: DELIVERY_STATUSES,
    governance: [
      'Notifications are strictly informational and workspace navigation helpers.',
      'Creating, delivering, or clicking a notification NEVER places a live or paper order.',
      'External channels (Telegram, Email, Webhook) are server-only and report UNCONFIGURED or FAILED honestly when credentials are absent or requests fail.',
      'Each source alert event produces at most one in-app notification per user via deterministic deduplication keys.'
    ]
  };

  function getDefaultPreferences() {
    return {
      ...DEFAULT_PREFERENCES,
      categories: { ...DEFAULT_PREFERENCES.categories }
    };
  }

  function isValidTimeHHMM(val) {
    if (typeof val !== 'string') return false;
    const m = val.trim().match(/^(\d{2}):(\d{2})$/);
    if (!m) return false;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
  }

  function normalizePreferences(input = {}, existing = null) {
    const base = existing
      ? {
          ...DEFAULT_PREFERENCES,
          ...existing,
          categories: {
            ...DEFAULT_PREFERENCES.categories,
            ...(existing.categories || {})
          }
        }
      : {
          ...DEFAULT_PREFERENCES,
          categories: { ...DEFAULT_PREFERENCES.categories }
        };

    if (!input || typeof input !== 'object') {
      return base;
    }

    const boolField = (val, fallback) =>
      val === undefined || val === null ? fallback : Boolean(val === true || val === 'true' || val === 1 || val === '1');

    const quietStart =
      input.quietHoursStart !== undefined
        ? String(input.quietHoursStart).trim()
        : base.quietHoursStart;
    const quietEnd =
      input.quietHoursEnd !== undefined
        ? String(input.quietHoursEnd).trim()
        : base.quietHoursEnd;

    if (!isValidTimeHHMM(quietStart)) {
      const err = new Error(`Invalid quietHoursStart '${quietStart}'. Expected HH:MM (00:00 to 23:59).`);
      err.code = 'INVALID_NOTIFICATION_PREFERENCES';
      throw err;
    }

    if (!isValidTimeHHMM(quietEnd)) {
      const err = new Error(`Invalid quietHoursEnd '${quietEnd}'. Expected HH:MM (00:00 to 23:59).`);
      err.code = 'INVALID_NOTIFICATION_PREFERENCES';
      throw err;
    }

    const categories = { ...base.categories };
    if (input.categories && typeof input.categories === 'object') {
      for (const [k, v] of Object.entries(input.categories)) {
        const keyUpper = String(k).trim().toUpperCase();
        if (!SUPPORTED_NOTIFICATION_CATEGORIES.includes(keyUpper)) {
          const err = new Error(
            `Unsupported notification category '${keyUpper}'. Supported: ${SUPPORTED_NOTIFICATION_CATEGORIES.join(', ')}.`
          );
          err.code = 'INVALID_NOTIFICATION_CATEGORY';
          throw err;
        }
        categories[keyUpper] = boolField(v, categories[keyUpper]);
      }
    }

    return {
      inAppEnabled: boolField(input.inAppEnabled, base.inAppEnabled),
      browserNotificationsEnabled: boolField(
        input.browserNotificationsEnabled,
        base.browserNotificationsEnabled
      ),
      soundEnabled: boolField(input.soundEnabled, base.soundEnabled),
      telegramEnabled: boolField(input.telegramEnabled, base.telegramEnabled),
      emailEnabled: boolField(input.emailEnabled, base.emailEnabled),
      webhookEnabled: boolField(input.webhookEnabled, base.webhookEnabled),
      quietHoursEnabled: boolField(input.quietHoursEnabled, base.quietHoursEnabled),
      quietHoursStart: quietStart,
      quietHoursEnd: quietEnd,
      categories
    };
  }

  function validateAndNormalizePreferences(input = {}, existing = null) {
    try {
      const preferences = normalizePreferences(input, existing);
      return {
        ok: true,
        preferences
      };
    } catch (err) {
      return {
        ok: false,
        code: err.code || 'INVALID_NOTIFICATION_PREFERENCES',
        message: err.message,
        errors: [err.message]
      };
    }
  }

  function isWithinQuietHours(arg1 = {}, arg2 = null, arg3 = null) {
    let startStr = '22:00';
    let endStr = '07:00';
    let nowIsoOrDate = null;

    if (typeof arg1 === 'string' && typeof arg2 === 'string' && typeof arg3 === 'string') {
      // Called as isWithinQuietHours(nowTimeStr, startHHMM, endHHMM)
      nowIsoOrDate = arg1;
      startStr = arg2;
      endStr = arg3;
    } else {
      // Called as isWithinQuietHours(preferencesObj, nowIsoOrDate)
      if (!arg1 || !arg1.quietHoursEnabled) {
        return false;
      }
      startStr = arg1.quietHoursStart || '22:00';
      endStr = arg1.quietHoursEnd || '07:00';
      nowIsoOrDate = arg2;
    }

    if (!isValidTimeHHMM(startStr) || !isValidTimeHHMM(endStr)) {
      return false;
    }

    let hh = 0;
    let mm = 0;

    if (typeof nowIsoOrDate === 'string' && /^\d{2}:\d{2}$/.test(nowIsoOrDate.trim())) {
      const parts = nowIsoOrDate.trim().split(':');
      hh = Number(parts[0]);
      mm = Number(parts[1]);
    } else {
      const dt = nowIsoOrDate ? new Date(nowIsoOrDate) : new Date();
      if (Number.isNaN(dt.getTime())) return false;
      hh = dt.getUTCHours();
      mm = dt.getUTCMinutes();
    }

    const currentMinutes = hh * 60 + mm;
    const [startH, startM] = startStr.split(':').map(Number);
    const [endH, endM] = endStr.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes === endMinutes) {
      return false;
    }
    if (startMinutes < endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    // Crosses midnight (e.g. 22:00 to 07:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  function mapAlertTypeToCategoryAndSeverity(alertType = '') {
    const type = String(alertType || '').trim().toUpperCase();
    switch (type) {
      case 'PRICE_ABOVE':
      case 'PRICE_BELOW':
        return { category: 'PRICE_ALERT', severity: 'INFO' };
      case 'PERCENT_CHANGE_UP':
      case 'PERCENT_CHANGE_DOWN':
        return { category: 'PERCENT_CHANGE_ALERT', severity: 'INFO' };
      case 'VOLUME_SPIKE':
        return { category: 'VOLUME_SPIKE_ALERT', severity: 'WARNING' };
      case 'SUPPORT_BREAKDOWN':
      case 'RESISTANCE_BREAKOUT':
      case 'CANDLE_BREAKOUT':
        return { category: 'CANDLE_BREAKOUT_ALERT', severity: 'WARNING' };
      case 'RSI_OVERBOUGHT_OVERSOLD':
      case 'INDICATOR_CONDITION':
        return { category: 'INDICATOR_ALERT', severity: 'WARNING' };
      case 'STRATEGY_SIGNAL_CHANGE':
      case 'STRATEGY_SIGNAL':
        return { category: 'STRATEGY_SIGNAL_ALERT', severity: 'HIGH' };
      default:
        return { category: 'PRICE_ALERT', severity: 'INFO' };
    }
  }

  function buildNotificationFromAlertEvent(alertEvent = {}, userId = null) {
    if (!alertEvent || typeof alertEvent !== 'object') {
      const err = new Error('Alert event object is required to build a notification.');
      err.code = 'INVALID_ALERT_EVENT_FOR_NOTIFICATION';
      throw err;
    }

    const eventId = String(alertEvent.eventId || alertEvent.id || '').trim();
    const alertId = String(alertEvent.alertId || '').trim();
    const symbol = String(alertEvent.symbol || alertEvent.tradingsymbol || alertEvent.symbolKey || '').trim();
    if (!eventId || !symbol) {
      const err = new Error('Alert event requires a valid eventId and symbol.');
      err.code = 'INVALID_ALERT_EVENT_FOR_NOTIFICATION';
      throw err;
    }

    const ownerId = userId ? String(userId) : alertEvent.userId ? String(alertEvent.userId) : null;
    const { category, severity } = mapAlertTypeToCategoryAndSeverity(alertEvent.alertType);
    const exchange = String(alertEvent.exchange || 'NSE').trim().toUpperCase();
    const instrumentType = String(alertEvent.instrumentType || 'EQUITY').trim().toUpperCase();
    const conditionSummary =
      alertEvent.conditionSummary ||
      `${symbol} (${exchange}) ${alertEvent.alertType || 'ALERT'}`;
    const observedPrice =
      alertEvent.observedPrice !== null &&
      alertEvent.observedPrice !== undefined &&
      Number.isFinite(Number(alertEvent.observedPrice))
        ? Number(alertEvent.observedPrice)
        : null;
    const observedValue =
      alertEvent.observedValue !== null && alertEvent.observedValue !== undefined
        ? String(alertEvent.observedValue)
        : observedPrice !== null
          ? `₹${observedPrice.toFixed(2)}`
          : '--';

    const title = `Market Alert: ${symbol} (${exchange}) — ${alertEvent.alertType || 'TRIGGERED'}`;
    const message =
      alertEvent.message ||
      `${conditionSummary} triggered at observed value ${observedValue}. (Notification Only — No Order Placed)`;

    const dedupKey = alertEvent.dedupKey || `ALERT_EVENT:${eventId}`;

    return {
      userId: ownerId,
      sourceEventId: eventId,
      alertId: alertId || null,
      dedupKey,
      category,
      severity,
      title,
      message,
      symbol,
      tradingsymbol: alertEvent.tradingsymbol || symbol,
      exchange,
      instrumentType,
      alertType: alertEvent.alertType || 'PRICE_ABOVE',
      conditionSummary,
      thresholdValue:
        alertEvent.thresholdValue !== null &&
        alertEvent.thresholdValue !== undefined &&
        Number.isFinite(Number(alertEvent.thresholdValue))
          ? Number(alertEvent.thresholdValue)
          : null,
      observedPrice,
      observedValue,
      quoteTimestamp: alertEvent.quoteTimestamp || alertEvent.triggeredAt || new Date().toISOString(),
      triggeredAt: alertEvent.triggeredAt || new Date().toISOString(),
      metadata: {
        ...(alertEvent.context || {}),
        triggerMode: alertEvent.triggerMode || 'ONCE',
        autoOrderTriggered: false,
        brokerExecution: 'NONE'
      }
    };
  }

  function buildSystemOrRiskNotification(payload = {}, userId = null) {
    if (!payload || typeof payload !== 'object') {
      const err = new Error('Notification payload is required.');
      err.code = 'INVALID_NOTIFICATION_PAYLOAD';
      throw err;
    }

    const ownerId = userId ? String(userId) : payload.userId ? String(payload.userId) : null;
    const rawCat = String(payload.category || 'SYSTEM_ALERT').trim().toUpperCase();
    const category = SUPPORTED_NOTIFICATION_CATEGORIES.includes(rawCat)
      ? rawCat
      : 'SYSTEM_ALERT';

    const rawSev = String(
      payload.severity ||
        (category === 'EMERGENCY_STOP'
          ? 'CRITICAL'
          : category === 'RISK_WARNING'
            ? 'HIGH'
            : 'INFO')
    )
      .trim()
      .toUpperCase();
    const severity = SEVERITY_LEVELS.includes(rawSev) ? rawSev : 'INFO';

    const title = String(payload.title || '').trim();
    const message = String(payload.message || '').trim();
    if (!title || !message) {
      const err = new Error('Notification title and message are required.');
      err.code = 'INVALID_NOTIFICATION_PAYLOAD';
      throw err;
    }

    const nowIso = payload.createdAt || payload.triggeredAt || new Date().toISOString();
    const sourceEventId = payload.sourceEventId ? String(payload.sourceEventId).trim() : null;
    const dedupKey =
      payload.dedupKey ||
      (sourceEventId
        ? `SYS_EVT:${ownerId || 'GUEST'}:${sourceEventId}`
        : `SYS_MSG:${ownerId || 'GUEST'}:${category}:${title}:${nowIso}`);

    return {
      userId: ownerId,
      sourceEventId,
      alertId: payload.alertId || null,
      dedupKey,
      category,
      severity,
      title,
      message,
      symbol: payload.symbol ? String(payload.symbol).trim().toUpperCase() : null,
      tradingsymbol: payload.tradingsymbol ? String(payload.tradingsymbol).trim().toUpperCase() : null,
      exchange: payload.exchange ? String(payload.exchange).trim().toUpperCase() : null,
      instrumentType: payload.instrumentType ? String(payload.instrumentType).trim().toUpperCase() : null,
      alertType: payload.alertType || category,
      conditionSummary: payload.conditionSummary || title,
      thresholdValue:
        payload.thresholdValue !== undefined && payload.thresholdValue !== null
          ? Number(payload.thresholdValue)
          : null,
      observedPrice:
        payload.observedPrice !== undefined && payload.observedPrice !== null
          ? Number(payload.observedPrice)
          : null,
      observedValue: payload.observedValue !== undefined ? String(payload.observedValue) : null,
      quoteTimestamp: payload.quoteTimestamp || nowIso,
      triggeredAt: nowIso,
      metadata: {
        ...(payload.metadata || {}),
        autoOrderTriggered: false,
        brokerExecution: 'NONE'
      }
    };
  }

  function evaluateChannelDispatchPlan(notification = {}, preferences = DEFAULT_PREFERENCES, options = {}) {
    const prefs = normalizePreferences(preferences);
    const category = String(notification.category || 'PRICE_ALERT').toUpperCase();
    const isEmergency = category === 'EMERGENCY_STOP';
    const categoryEnabled = isEmergency ? true : prefs.categories[category] !== false;
    const inQuietHours = isEmergency
      ? false
      : isWithinQuietHours(prefs, options.nowTime || notification.triggeredAt);

    const extConfig = options.externalChannelStatus || {};
    const telegramConfigured = Boolean(
      extConfig.telegramConfigured || extConfig.TELEGRAM?.configured || extConfig.channels?.TELEGRAM?.configured
    );
    const emailConfigured = Boolean(
      extConfig.emailConfigured || extConfig.EMAIL?.configured || extConfig.channels?.EMAIL?.configured
    );
    const webhookConfigured = Boolean(
      extConfig.webhookConfigured || extConfig.WEBHOOK?.configured || extConfig.channels?.WEBHOOK?.configured
    );

    const plan = {};

    // 1. IN_APP Channel
    if (!categoryEnabled) {
      plan.IN_APP = {
        shouldSend: false,
        status: 'SKIPPED_PREFERENCE',
        reason: `Category ${category} is disabled in user notification preferences.`
      };
    } else if (!prefs.inAppEnabled && !isEmergency) {
      plan.IN_APP = {
        shouldSend: false,
        status: 'SKIPPED_PREFERENCE',
        reason: 'In-app notifications are disabled in user preferences.'
      };
    } else {
      plan.IN_APP = {
        shouldSend: true,
        status: 'DELIVERED',
        reason: 'Persisted to user-isolated In-App Notification Center.'
      };
    }

    // 2. BROWSER Notification Channel
    if (!categoryEnabled || !prefs.browserNotificationsEnabled) {
      plan.BROWSER = {
        shouldSend: false,
        status: 'SKIPPED_PREFERENCE',
        reason: 'Browser notifications disabled by user preference.'
      };
    } else if (inQuietHours) {
      plan.BROWSER = {
        shouldSend: false,
        status: 'SKIPPED_QUIET_HOURS',
        reason: `Suppressed during quiet hours (${prefs.quietHoursStart}–${prefs.quietHoursEnd}).`
      };
    } else {
      plan.BROWSER = {
        shouldSend: true,
        status: 'PENDING_CLIENT',
        reason: 'Eligible for Browser Notification API dispatch on active client session.'
      };
    }

    // 3. SOUND Alert Channel
    if (!categoryEnabled || !prefs.soundEnabled) {
      plan.SOUND = {
        shouldSend: false,
        status: 'SKIPPED_PREFERENCE',
        reason: 'Sound alerts disabled by user preference.'
      };
    } else if (inQuietHours) {
      plan.SOUND = {
        shouldSend: false,
        status: 'SKIPPED_QUIET_HOURS',
        reason: `Sound muted during quiet hours (${prefs.quietHoursStart}–${prefs.quietHoursEnd}).`
      };
    } else {
      plan.SOUND = {
        shouldSend: true,
        status: 'PENDING_CLIENT',
        reason: 'Eligible for audio alert playback on active client session.'
      };
    }

    // 4. TELEGRAM Channel (Server-Only)
    if (!categoryEnabled || !prefs.telegramEnabled) {
      plan.TELEGRAM = {
        shouldSend: false,
        status: 'SKIPPED_PREFERENCE',
        reason: 'Telegram channel disabled in user preferences.'
      };
    } else if (inQuietHours) {
      plan.TELEGRAM = {
        shouldSend: false,
        status: 'SKIPPED_QUIET_HOURS',
        reason: `Telegram suppressed during quiet hours (${prefs.quietHoursStart}–${prefs.quietHoursEnd}).`
      };
    } else if (!telegramConfigured) {
      plan.TELEGRAM = {
        shouldSend: false,
        status: 'UNCONFIGURED',
        reason: 'Server Telegram credentials (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) are not configured.'
      };
    } else {
      plan.TELEGRAM = {
        shouldSend: true,
        status: 'READY_SERVER_DISPATCH',
        reason: 'Server Telegram channel configured and eligible.'
      };
    }

    // 5. EMAIL Channel (Server-Only)
    if (!categoryEnabled || !prefs.emailEnabled) {
      plan.EMAIL = {
        shouldSend: false,
        status: 'SKIPPED_PREFERENCE',
        reason: 'Email notification channel disabled in user preferences.'
      };
    } else if (inQuietHours) {
      plan.EMAIL = {
        shouldSend: false,
        status: 'SKIPPED_QUIET_HOURS',
        reason: `Email suppressed during quiet hours (${prefs.quietHoursStart}–${prefs.quietHoursEnd}).`
      };
    } else if (!emailConfigured) {
      plan.EMAIL = {
        shouldSend: false,
        status: 'UNCONFIGURED',
        reason: 'Server email transport (NOTIFICATION_EMAIL_WEBHOOK_URL / SMTP) is not configured.'
      };
    } else {
      plan.EMAIL = {
        shouldSend: true,
        status: 'READY_SERVER_DISPATCH',
        reason: 'Server Email channel configured and eligible.'
      };
    }

    // 6. WEBHOOK Channel (Server-Only)
    if (!categoryEnabled || !prefs.webhookEnabled) {
      plan.WEBHOOK = {
        shouldSend: false,
        status: 'SKIPPED_PREFERENCE',
        reason: 'Webhook notification channel disabled in user preferences.'
      };
    } else if (inQuietHours) {
      plan.WEBHOOK = {
        shouldSend: false,
        status: 'SKIPPED_QUIET_HOURS',
        reason: `Webhook suppressed during quiet hours (${prefs.quietHoursStart}–${prefs.quietHoursEnd}).`
      };
    } else if (!webhookConfigured) {
      plan.WEBHOOK = {
        shouldSend: false,
        status: 'UNCONFIGURED',
        reason: 'Server webhook endpoint (NOTIFICATION_WEBHOOK_URL) is not configured.'
      };
    } else {
      plan.WEBHOOK = {
        shouldSend: true,
        status: 'READY_SERVER_DISPATCH',
        reason: 'Server Webhook channel configured and eligible.'
      };
    }

    return {
      category,
      isEmergency,
      categoryEnabled,
      inQuietHours,
      channels: plan
    };
  }

  function validateAndNormalizeQuery(rawQuery = {}) {
    const errors = [];
    const readStatus = String(rawQuery.readStatus || rawQuery.status || 'ALL')
      .trim()
      .toUpperCase();
    if (!['ALL', 'UNREAD', 'READ'].includes(readStatus)) {
      errors.push(`Unsupported readStatus '${readStatus}'. Allowed: ALL, UNREAD, READ.`);
    }

    const category = String(rawQuery.category || 'ALL').trim().toUpperCase();
    if (category !== 'ALL' && !SUPPORTED_NOTIFICATION_CATEGORIES.includes(category)) {
      errors.push(
        `Unsupported category '${category}'. Allowed: ALL, ${SUPPORTED_NOTIFICATION_CATEGORIES.join(', ')}.`
      );
    }

    const symbol = rawQuery.symbol ? String(rawQuery.symbol).trim().toUpperCase() : '';
    const exactDate = rawQuery.date ? String(rawQuery.date).trim() : '';
    const fromDate =
      exactDate ||
      (rawQuery.fromDate || rawQuery.from ? String(rawQuery.fromDate || rawQuery.from).trim() : '');
    const toDate =
      exactDate ||
      (rawQuery.toDate || rawQuery.to ? String(rawQuery.toDate || rawQuery.to).trim() : '');

    let fromMs = null;
    let toMs = null;
    if (fromDate) {
      fromMs = Date.parse(fromDate.length === 10 ? `${fromDate}T00:00:00.000Z` : fromDate);
      if (!Number.isFinite(fromMs)) {
        errors.push(`Invalid fromDate '${fromDate}'.`);
      }
    }
    if (toDate) {
      toMs = Date.parse(toDate.length === 10 ? `${toDate}T23:59:59.999Z` : toDate);
      if (!Number.isFinite(toMs)) {
        errors.push(`Invalid toDate '${toDate}'.`);
      }
    }
    if (fromMs !== null && toMs !== null && fromMs > toMs) {
      errors.push('fromDate cannot be after toDate.');
    }

    const page = rawQuery.page !== undefined ? Number(rawQuery.page) : 1;
    const pageSize =
      rawQuery.pageSize !== undefined
        ? Number(rawQuery.pageSize)
        : rawQuery.limit !== undefined
          ? Number(rawQuery.limit)
          : 25;

    if (!Number.isInteger(page) || page < 1) {
      errors.push('page must be a positive integer >= 1.');
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
      errors.push('pageSize must be an integer between 1 and 200.');
    }

    if (errors.length > 0) {
      return {
        ok: false,
        code: 'INVALID_NOTIFICATION_QUERY',
        message: errors.join(' '),
        errors
      };
    }

    return {
      ok: true,
      normalized: {
        readStatus,
        category,
        symbol,
        fromDate,
        toDate,
        fromMs,
        toMs,
        page,
        pageSize
      }
    };
  }

  function filterAndPaginateNotifications(notifications = [], rawQuery = {}) {
    const check = validateAndNormalizeQuery(rawQuery);
    if (!check.ok) {
      return {
        ok: false,
        code: check.code,
        message: check.message,
        errors: check.errors
      };
    }

    const q = check.normalized;
    const list = Array.isArray(notifications) ? notifications : [];

    // Stable chronological ordering: newest first by triggeredAt/createdAt, tie-break by notificationId DESC
    const sorted = [...list].sort((a, b) => {
      const tA = Date.parse(a.triggeredAt || a.createdAt || '') || 0;
      const tB = Date.parse(b.triggeredAt || b.createdAt || '') || 0;
      if (tB !== tA) return tB - tA;
      return String(b.notificationId || '').localeCompare(String(a.notificationId || ''));
    });

    const unreadTotal = sorted.filter((n) => !n.read).length;
    const categoryCounts = {};
    for (const n of sorted) {
      const cat = String(n.category || 'PRICE_ALERT').toUpperCase();
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }

    const filtered = sorted.filter((n) => {
      if (q.readStatus === 'UNREAD' && n.read) return false;
      if (q.readStatus === 'READ' && !n.read) return false;
      if (q.category !== 'ALL' && String(n.category).toUpperCase() !== q.category) return false;
      if (q.symbol) {
        const symMatch =
          String(n.symbol || '').toUpperCase().includes(q.symbol) ||
          String(n.tradingsymbol || '').toUpperCase().includes(q.symbol) ||
          String(n.title || '').toUpperCase().includes(q.symbol);
        if (!symMatch) return false;
      }
      if (q.fromMs !== null || q.toMs !== null) {
        const ts = Date.parse(n.triggeredAt || n.createdAt || '');
        if (!Number.isFinite(ts)) return false;
        if (q.fromMs !== null && ts < q.fromMs) return false;
        if (q.toMs !== null && ts > q.toMs) return false;
      }
      return true;
    });

    const totalMatching = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalMatching / q.pageSize));
    const currentPage = Math.min(q.page, totalPages);
    const startIdx = (currentPage - 1) * q.pageSize;
    const items = filtered.slice(startIdx, startIdx + q.pageSize);

    return {
      ok: true,
      unreadCount: unreadTotal,
      totalCount: sorted.length,
      filteredCount: totalMatching,
      categoryCounts,
      filtersApplied: {
        readStatus: q.readStatus,
        category: q.category,
        symbol: q.symbol || null,
        fromDate: q.fromDate || null,
        toDate: q.toDate || null
      },
      pagination: {
        page: currentPage,
        pageSize: q.pageSize,
        totalItems: totalMatching,
        totalPages,
        hasPrevPage: currentPage > 1,
        hasNextPage: currentPage < totalPages
      },
      notifications: items
    };
  }

  return {
    ENGINE_VERSION,
    SUPPORTED_NOTIFICATION_CATEGORIES,
    SUPPORTED_DELIVERY_CHANNELS,
    DELIVERY_STATUSES,
    SEVERITY_LEVELS,
    DEFAULT_PREFERENCES,
    DOCUMENTED_NOTIFICATION_RULES,
    getDefaultPreferences,
    isValidTimeHHMM,
    normalizePreferences,
    validateAndNormalizePreferences,
    isWithinQuietHours,
    mapAlertTypeToCategoryAndSeverity,
    buildNotificationFromAlertEvent,
    buildSystemOrRiskNotification,
    evaluateChannelDispatchPlan,
    validateAndNormalizeQuery,
    filterAndPaginateNotifications
  };
});
