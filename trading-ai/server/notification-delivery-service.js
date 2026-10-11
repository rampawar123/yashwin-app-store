'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Task 15 — Server-Only External Notification Delivery Service
 *
 * Security & Honesty Rules:
 * - Credentials (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, NOTIFICATION_WEBHOOK_URL,
 *   NOTIFICATION_EMAIL_WEBHOOK_URL) live strictly in server environment variables.
 * - Never exposes tokens, chat IDs, or webhook URLs to browser JavaScript.
 * - Never fabricates "DELIVERED" when a channel is unconfigured, disabled, or fails.
 * - Includes per-user/per-channel rate limiting and timeout protection.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { getConfig } = require('./config');

const DEFAULT_TIMEOUT_MS = 4500;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_DISPATCHES_PER_MINUTE = 15;

const dispatchRateBuckets = new Map();
let customTransportHandler = null;

function setCustomTransportHandlerForTest(fn) {
  customTransportHandler = typeof fn === 'function' ? fn : null;
}

function setCustomTransportAdapter(fn) {
  customTransportHandler = typeof fn === 'function' ? fn : null;
}

function clearCustomTransportAdapter() {
  customTransportHandler = null;
}

function resetRateLimitsForTest() {
  dispatchRateBuckets.clear();
  customTransportHandler = null;
}

function resetRateLimitState() {
  dispatchRateBuckets.clear();
}

function sanitizeErrorReason(reason, env = process.env) {
  let msg = String(reason || '');
  const secrets = [
    env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_CHAT_ID,
    env.NOTIFICATION_WEBHOOK_URL,
    env.NOTIFICATION_EMAIL_WEBHOOK_URL
  ].filter((v) => typeof v === 'string' && v.trim().length > 0);

  for (const sec of secrets) {
    const trimmed = sec.trim();
    if (trimmed && msg.includes(trimmed)) {
      msg = msg.split(trimmed).join('[REDACTED]');
    }
  }
  msg = msg.replace(/https?:\/\/[^\s"'<>]+/gi, '[REDACTED]');
  return msg;
}

function checkRateLimit(userId, channel) {
  const bucketKey = `${userId || 'GUEST'}:${channel}`;
  const now = Date.now();
  const existing = dispatchRateBuckets.get(bucketKey) || [];
  const recent = existing.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= MAX_DISPATCHES_PER_MINUTE) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((RATE_LIMIT_WINDOW_MS - (now - recent[0])) / 1000)
    };
  }
  recent.push(now);
  dispatchRateBuckets.set(bucketKey, recent);
  return { allowed: true };
}

function getSafeExternalChannelStatus(env = process.env) {
  const telegramBotToken = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  const telegramChatId = String(env.TELEGRAM_CHAT_ID || '').trim();
  const webhookUrl = String(env.NOTIFICATION_WEBHOOK_URL || '').trim();
  const emailWebhookUrl = String(env.NOTIFICATION_EMAIL_WEBHOOK_URL || '').trim();

  const tgConf = Boolean(telegramBotToken && telegramChatId);
  const emConf = Boolean(emailWebhookUrl);
  const whConf = Boolean(webhookUrl);

  const tgObj = {
    configured: tgConf,
    status: tgConf ? 'CONFIGURED' : 'UNCONFIGURED',
    mode: 'SERVER_ONLY',
    missingEnv: tgConf
      ? []
      : ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'].filter((k) => !String(env[k] || '').trim())
  };
  const emObj = {
    configured: emConf,
    status: emConf ? 'CONFIGURED' : 'UNCONFIGURED',
    mode: 'SERVER_ONLY',
    missingEnv: emConf ? [] : ['NOTIFICATION_EMAIL_WEBHOOK_URL']
  };
  const whObj = {
    configured: whConf,
    status: whConf ? 'CONFIGURED' : 'UNCONFIGURED',
    mode: 'SERVER_ONLY',
    missingEnv: whConf ? [] : ['NOTIFICATION_WEBHOOK_URL']
  };

  return {
    telegramConfigured: tgConf,
    emailConfigured: emConf,
    webhookConfigured: whConf,
    TELEGRAM: tgObj,
    EMAIL: emObj,
    WEBHOOK: whObj,
    channels: {
      IN_APP: { configured: true, status: 'CONFIGURED', mode: 'SQLITE_PERSISTENT' },
      BROWSER: { configured: true, status: 'CLIENT_PERMISSION_REQUIRED', mode: 'CLIENT_PERMISSION_REQUIRED' },
      SOUND: { configured: true, status: 'CONFIGURED', mode: 'CLIENT_WEB_AUDIO' },
      TELEGRAM: tgObj,
      EMAIL: emObj,
      WEBHOOK: whObj
    }
  };
}

function isBlockedSsrfHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc00:') ||
    host.startsWith('fd00:') ||
    host === 'metadata.google.internal' ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  // IPv4 private / loopback / link-local / metadata ranges
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true; // Cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
  }

  return false;
}

function validateSafeOutboundUrl(rawUrl, options = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {
      ok: false,
      code: 'INVALID_ENDPOINT_URL',
      reason: 'Outbound endpoint URL is empty or not a string.'
    };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (_) {
    return {
      ok: false,
      code: 'INVALID_ENDPOINT_URL',
      reason: 'Outbound endpoint URL is malformed.'
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      code: 'FORBIDDEN_URL_SCHEME',
      reason: `Unsupported URL scheme '${parsed.protocol}'. Only HTTPS (or HTTP in non-production) is permitted.`
    };
  }

  const isProd = String((options.env || process.env).NODE_ENV || '').trim().toLowerCase() === 'production';
  if (isProd && parsed.protocol !== 'https:') {
    return {
      ok: false,
      code: 'HTTPS_REQUIRED_IN_PRODUCTION',
      reason: 'Production outbound notification webhooks must use HTTPS.'
    };
  }

  if (options.allowLoopbackForTest !== true && isBlockedSsrfHost(parsed.hostname)) {
    return {
      ok: false,
      code: 'SSRF_BLOCKED_HOST',
      reason: 'Outbound requests to private, loopback, link-local, or cloud metadata addresses are blocked (SSRF protection).'
    };
  }

  return {
    ok: true,
    parsed
  };
}

function postJsonWithTimeout(targetUrl, payload, timeoutMs = DEFAULT_TIMEOUT_MS, options = {}) {
  return new Promise((resolve, reject) => {
    const urlCheck = validateSafeOutboundUrl(targetUrl, options);
    if (!urlCheck.ok) {
      const err = new Error(urlCheck.reason);
      err.code = urlCheck.code;
      return reject(err);
    }
    const parsed = urlCheck.parsed;

    const bodyStr = JSON.stringify(payload);
    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(bodyStr)
        },
        timeout: timeoutMs
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          if (raw.length < 4096) raw += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode });
          } else {
            const err = new Error(`External channel returned HTTP ${res.statusCode}.`);
            err.code = `HTTP_${res.statusCode}`;
            reject(err);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      const err = new Error('External notification request timed out.');
      err.code = 'DISPATCH_TIMEOUT';
      reject(err);
    });

    req.on('error', (err) => {
      const safeErr = new Error(err?.message || 'External notification network error.');
      safeErr.code = err?.code || 'NETWORK_ERROR';
      reject(safeErr);
    });

    req.write(bodyStr);
    req.end();
  });
}

async function dispatchExternalChannel(channel, notification, options = {}) {
  const ch = String(channel || '').trim().toUpperCase();
  const env = options.env || process.env;
  const status = getSafeExternalChannelStatus(env);

  if (ch === 'TELEGRAM' && !status.telegramConfigured) {
    return {
      ok: false,
      channel: 'TELEGRAM',
      status: 'UNCONFIGURED',
      delivered: false,
      reason: 'Server Telegram credentials (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) are not configured.'
    };
  }
  if (ch === 'EMAIL' && !status.emailConfigured) {
    return {
      ok: false,
      channel: 'EMAIL',
      status: 'UNCONFIGURED',
      delivered: false,
      reason: 'Server Email transport (NOTIFICATION_EMAIL_WEBHOOK_URL) is not configured.'
    };
  }
  if (ch === 'WEBHOOK' && !status.webhookConfigured) {
    return {
      ok: false,
      channel: 'WEBHOOK',
      status: 'UNCONFIGURED',
      delivered: false,
      reason: 'Server Webhook endpoint (NOTIFICATION_WEBHOOK_URL) is not configured.'
    };
  }

  const rateCheck = checkRateLimit(notification.userId, ch);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      channel: ch,
      status: 'RATE_LIMITED',
      delivered: false,
      reason: `Rate limit exceeded for ${ch}. Retry after ${rateCheck.retryAfterSeconds}s.`
    };
  }

  try {
    if (customTransportHandler) {
      const customRes = await customTransportHandler(ch, notification, env);
      const isOk = Boolean(customRes?.ok || customRes?.delivered || customRes?.status === 'DELIVERED');
      return {
        ok: isOk,
        channel: ch,
        status: isOk ? 'DELIVERED' : (customRes?.status || 'FAILED'),
        delivered: isOk,
        reason: sanitizeErrorReason(
          customRes?.reason || (isOk ? `Delivered via ${ch}` : `${ch} delivery failed.`),
          env
        )
      };
    }

    if (ch === 'TELEGRAM') {
      const botToken = String(env.TELEGRAM_BOT_TOKEN || '').trim();
      const chatId = String(env.TELEGRAM_CHAT_ID || '').trim();
      const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const text = `[YASHWIN PAPER ALERT]\n${notification.title}\n${notification.message}\nSymbol: ${notification.symbol || '--'} (${notification.exchange || 'NSE'})\nTime: ${notification.triggeredAt}`;
      await postJsonWithTimeout(apiUrl, { chat_id: chatId, text });
      return {
        ok: true,
        channel: 'TELEGRAM',
        status: 'DELIVERED',
        delivered: true,
        reason: 'Delivered via server Telegram Bot API.'
      };
    }

    if (ch === 'EMAIL') {
      const emailUrl = String(env.NOTIFICATION_EMAIL_WEBHOOK_URL || '').trim();
      await postJsonWithTimeout(emailUrl, {
        subject: `[YASHWIN] ${notification.title}`,
        message: notification.message,
        category: notification.category,
        symbol: notification.symbol,
        exchange: notification.exchange,
        triggeredAt: notification.triggeredAt,
        mode: 'PAPER'
      });
      return {
        ok: true,
        channel: 'EMAIL',
        status: 'DELIVERED',
        delivered: true,
        reason: 'Delivered via server Email notification relay.'
      };
    }

    if (ch === 'WEBHOOK') {
      const webhookUrl = String(env.NOTIFICATION_WEBHOOK_URL || '').trim();
      await postJsonWithTimeout(webhookUrl, {
        notificationId: notification.notificationId,
        category: notification.category,
        severity: notification.severity,
        title: notification.title,
        message: notification.message,
        symbol: notification.symbol,
        exchange: notification.exchange,
        observedPrice: notification.observedPrice,
        observedValue: notification.observedValue,
        thresholdValue: notification.thresholdValue,
        triggeredAt: notification.triggeredAt,
        mode: 'PAPER',
        liveTradingEnabled: false
      });
      return {
        ok: true,
        channel: 'WEBHOOK',
        status: 'DELIVERED',
        delivered: true,
        reason: 'Delivered via server Webhook endpoint.'
      };
    }

    return {
      ok: false,
      channel: ch,
      status: 'FAILED',
      delivered: false,
      reason: `Unsupported external channel '${ch}'.`
    };
  } catch (error) {
    return {
      ok: false,
      channel: ch,
      status: 'FAILED',
      delivered: false,
      reason: sanitizeErrorReason(error?.message || `${ch} delivery failed.`, env)
    };
  }
}

module.exports = {
  getSafeExternalChannelStatus,
  dispatchExternalChannel,
  isBlockedSsrfHost,
  validateSafeOutboundUrl,
  setCustomTransportHandlerForTest,
  setCustomTransportAdapter,
  clearCustomTransportAdapter,
  resetRateLimitsForTest,
  resetRateLimitState
};
