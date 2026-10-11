'use strict';

/*
 * YASHWIN AI Trading Assistant
 * Phase 3 — RFC 6238 TOTP Generator (Base32 + HMAC-SHA1)
 *
 * Server-side only.
 * Never log secrets or generated OTP codes.
 */

const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(secret) {
  const raw = String(secret || '')
    .toUpperCase()
    .replace(/[\s\-=]+/g, '');

  if (!raw || raw.length < 8) {
    const err = new Error('TOTP secret is missing or too short.');
    err.code = 'INVALID_TOTP_SECRET';
    throw err;
  }

  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < raw.length; i += 1) {
    const idx = BASE32_ALPHABET.indexOf(raw[i]);
    if (idx === -1) {
      const err = new Error('TOTP secret contains invalid Base32 characters.');
      err.code = 'INVALID_TOTP_SECRET';
      throw err;
    }

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  if (bytes.length === 0) {
    const err = new Error('TOTP secret decoded to empty buffer.');
    err.code = 'INVALID_TOTP_SECRET';
    throw err;
  }

  return Buffer.from(bytes);
}

function generateTOTP(secret, options = {}) {
  const key = decodeBase32(secret);
  const stepSeconds = Number(options.stepSeconds) || 30;
  const digits = Number(options.digits) || 6;
  const timestampMs =
    options.timestampMs !== undefined ? Number(options.timestampMs) : Date.now();

  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    const err = new Error('Invalid timestamp for TOTP generation.');
    err.code = 'INVALID_TOTP_TIMESTAMP';
    throw err;
  }

  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  counterBuf.writeUInt32BE(high, 0);
  counterBuf.writeUInt32BE(low, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;

  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = Math.pow(10, digits);
  const otp = String(binary % mod).padStart(digits, '0');

  return otp;
}

function validateTOTPSecret(secret) {
  try {
    decodeBase32(secret);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      code: error.code || 'INVALID_TOTP_SECRET',
      message: error.message
    };
  }
}

module.exports = {
  decodeBase32,
  generateTOTP,
  validateTOTPSecret
};
