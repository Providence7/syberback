/**
 * src/middlewares/security.js
 */

import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import crypto from 'crypto';

// ─────────────────────────────────────────────
// 1. Security Headers
// (CSP here only covers responses from THIS host. For the SPA, send a CSP
// from the host that serves the HTML.)
// ─────────────────────────────────────────────
export function securityHeaders(req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://js.paystack.co",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://api.paystack.co",
      "frame-src https://checkout.paystack.com",
      "img-src 'self' data: https://paystack.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join('; ')
  );

  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  next();
}

// ─────────────────────────────────────────────
// 2. Rate Limiters
// Many Nigerian mobile users share one IP (carrier-grade NAT), so per-IP
// caps must be generous. Brute-force protection for auth lives in
// rateLimiters.js (per-email + per-IP on each sensitive route).
// ─────────────────────────────────────────────
export const paymentRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many payment attempts. Try again later.' },
  skip: (req) => req.path.includes('/webhooks/'),
});

export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

// DEPRECATED: do NOT mount on the whole /api/auth prefix. It would throttle
// session probes and admin dashboard calls. Use the per-route limiters in
// rateLimiters.js instead. Kept exported so existing imports don't break.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 20 : 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─────────────────────────────────────────────
// 3. Strict Origin Check (CSRF defence for cookie auth)
// Exact origin match. Fails closed in production if CLIENT_URL is unset.
// ─────────────────────────────────────────────
const toOrigin = (value) => {
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
};

export function strictOriginCheck(req, res, next) {
  const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

  if (!mutatingMethods.includes(req.method)) {
    return next();
  }

  const origin = req.headers.origin || '';

  if (!origin || origin === 'null') {
    return next();
  }

  const allowedOrigins = (process.env.CLIENT_URL || '')
    .split(',')
    .map(toOrigin)
    .filter(Boolean);

  if (!allowedOrigins.length) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[security:origin] CLIENT_URL is not set; rejecting request');
      return res.status(403).json({ message: 'Forbidden.' });
    }
    return next();
  }

  if (!allowedOrigins.includes(origin)) {
    return res.status(403).json({ message: 'Forbidden.' });
  }

  next();
}

// ─────────────────────────────────────────────
// 4. Mongo Sanitizer (body + query)
// Strips operator keys ($ne, $gt, ...) and prototype-pollution keys.
// req.params is intentionally not handled: it is empty when this runs
// as global middleware.
// ─────────────────────────────────────────────
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isUnsafeKey = (key) => key.startsWith('$') || UNSAFE_KEYS.has(key);

function sanitizeInPlace(value) {
  if (Array.isArray(value)) {
    value.forEach(sanitizeInPlace);
    return value;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (isUnsafeKey(key)) delete value[key];
      else sanitizeInPlace(value[key]);
    }
  }
  return value;
}

export function sanitizeMongo(req, res, next) {
  if (req.body) sanitizeInPlace(req.body);

  // Express 5 re-parses req.query on every access and has no setter, so pin
  // the sanitized object as an own property (also fine on Express 4).
  const query = sanitizeInPlace(req.query);
  Object.defineProperty(req, 'query', {
    value: query,
    writable: true,
    configurable: true,
    enumerable: true,
  });

  next();
}

export const sanitizeHpp = hpp();

// ─────────────────────────────────────────────
// 5. Paystack Webhook Verify
// Requires the raw body: express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })
// ─────────────────────────────────────────────
export function verifyPaystackWebhook(req, res, next) {
  const signature = req.headers['x-paystack-signature'];

  if (!signature) {
    return res.status(401).json({ message: 'Missing webhook signature.' });
  }

  if (!process.env.PAYSTACK_SECRET_KEY || !req.rawBody) {
    console.error(
      '[security:paystack-webhook] PAYSTACK_SECRET_KEY or req.rawBody missing ' +
      '(capture rawBody in the express.json verify option)'
    );
    return res.status(500).json({ message: 'Webhook verification unavailable.' });
  }

  const expected = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.rawBody)
    .digest();

  const received = Buffer.from(String(signature), 'hex');

  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return res.status(401).json({ message: 'Invalid webhook signature.' });
  }

  next();
}