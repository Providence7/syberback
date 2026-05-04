/**
 * src/middlewares/security.js
 *
 * Full updated version for latest csrf-csrf package
 */

import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import { doubleCsrf } from 'csrf-csrf';
import crypto from 'crypto';

// ─────────────────────────────────────────────
// 1. Security Headers
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
      "upgrade-insecure-requests",
    ].join('; ')
  );

  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Referrer-Policy',
    'strict-origin-when-cross-origin'
  );
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  next();
}

// ─────────────────────────────────────────────
// 2. CSRF Protection (LATEST VERSION)
// ─────────────────────────────────────────────

const isProd =
  process.env.NODE_ENV === 'production';

const {
  generateCsrfToken,
  doubleCsrfProtection,
  invalidCsrfTokenError,
} = doubleCsrf({
  // required
  getSecret: () => process.env.CSRF_SECRET,

  // NEW required option in latest package
  getSessionIdentifier: (req) =>
    req.user?.id || req.ip,

  // localhost friendly cookie
  cookieName: 'csrf-token',

  cookieOptions: {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
  },

  size: 64,

  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],

  getTokenFromRequest: (req) =>
    req.headers['x-csrf-token'],
});

export {
  doubleCsrfProtection as csrfProtection,
};

export { invalidCsrfTokenError };

// GET /api/csrf-token
export function issueCsrfToken(
  req,
  res,
  next
) {
  try {
    const token = generateCsrfToken(
      req,
      res
    );

    res.json({ token });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────
// 3. Rate Limiters
// ─────────────────────────────────────────────

export const paymentRateLimiter =
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message:
        'Too many payment attempts. Try again later.',
    },
    keyGenerator: (req) => req.ip,
    skip: (req) =>
      req.path.includes('/webhooks/'),
  });

export const generalRateLimiter =
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message:
        'Too many requests. Please slow down.',
    },
  });


export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─────────────────────────────────────────────
// 4. Strict Origin Check
// ─────────────────────────────────────────────

export function strictOriginCheck(
  req,
  res,
  next
) {
  const mutatingMethods = [
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
  ];

  if (
    !mutatingMethods.includes(req.method)
  ) {
    return next();
  }

  const origin =
    req.headers.origin || '';
  const referer =
    req.headers.referer || '';

  const noOrigin =
    !origin || origin === 'null';

  if (noOrigin) {
    return next();
  }

  const allowedOrigins = (
    process.env.CLIENT_URL || ''
  )
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  if (!allowedOrigins.length) {
    return next();
  }

  const source = origin || referer;

  const allowed =
    allowedOrigins.some((url) =>
      source.startsWith(url)
    );

  if (!allowed) {
    return res.status(403).json({
      message: 'Forbidden.',
    });
  }

  next();
}

// ─────────────────────────────────────────────
// 5. Mongo Sanitizer
// ─────────────────────────────────────────────

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !key.startsWith('$') &&
            key !== '__proto__' &&
            key !== 'constructor'
        )
        .map(([key, val]) => [
          key,
          sanitizeValue(val),
        ])
    );
  }

  return value;
}

export function sanitizeMongo(
  req,
  res,
  next
) {
  if (req.body) {
    req.body = sanitizeValue(
      req.body
    );
  }

  if (req.params) {
    req.params = sanitizeValue(
      req.params
    );
  }

  next();
}

export const sanitizeHpp = hpp();

// ─────────────────────────────────────────────
// 6. Paystack Webhook Verify
// ─────────────────────────────────────────────

export function verifyPaystackWebhook(
  req,
  res,
  next
) {
  const signature =
    req.headers[
      'x-paystack-signature'
    ];

  if (!signature) {
    return res.status(401).json({
      message:
        'Missing webhook signature.',
    });
  }

  const hash = crypto
    .createHmac(
      'sha512',
      process.env
        .PAYSTACK_SECRET_KEY
    )
    .update(req.rawBody)
    .digest('hex');

  if (hash !== signature) {
    return res.status(401).json({
      message:
        'Invalid webhook signature.',
    });
  }

  next();
}