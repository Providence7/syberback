/**
 * src/middleware/security.js
 */

import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import { doubleCsrf } from 'csrf-csrf';
import crypto from 'crypto';

const isProd = process.env.NODE_ENV === 'production';

// ── 1. Security headers (CSP + hardening) ────────────────────────────────
export function securityHeaders(req, res, next) {
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' https://js.paystack.co",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https://api.paystack.co",
    "frame-src https://checkout.paystack.com",
    "img-src 'self' data: https://paystack.com",
    "object-src 'none'",
    "base-uri 'self'",
  ];

  if (isProd) {
    cspDirectives.push("upgrade-insecure-requests");
  }

  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

// ── 2. CSRF protection ───────────────────────────────────────────────────
// ── 2. CSRF protection ───────────────────────────────────────────────────
const doubleCsrfOptions = {
  getSecret: () => process.env.CSRF_SECRET || "a_very_long_random_string_for_development_only",
  cookieName: isProd ? '__Host-x-csrf-token' : 'x-csrf-token',
  cookieOptions: {
    sameSite: 'lax', 
    secure: isProd,
    httpOnly: true,
    path: '/',
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],
  
  // ✅ ADD THIS SECTION TO FIX THE ERROR:
  // This tells the library how to uniquely identify the session.
  // We will use the client's IP address or the x-csrf-token cookie itself.
  getSessionIdentifier: (req) => {
    return req.ip || req.headers['user-agent'];
  },
};

const csrfInstance = doubleCsrf(doubleCsrfOptions);

export const generateToken = csrfInstance.generateCsrfToken;
export const csrfProtection = csrfInstance.doubleCsrfProtection;

export function issueCsrfToken(req, res) {
  try {
    const token = generateToken(req, res);
    res.json({ token });
  } catch (error) {
    console.error("CSRF Token Generation Error:", error.message);
    res.status(500).json({ 
      message: "Internal Security Error", 
      details: error.message 
    });
  }
}

// ── 3. Rate Limiters ─────────────────────────────────────────────────────
export const paymentRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many payment attempts.' },
  keyGenerator: (req) => req.ip,
  skip: (req) => req.path.includes('/webhooks/'),
});

export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Increased limit for Dev to prevent 429 while refreshing
  max: isProd ? 20 : 100, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts.' },
});

// ── 4. Origin check ──────────────────────────────────────────────────────
export function strictOriginCheck(req, res, next) {
  const mutatingMethods = ['POST', 'DELETE', 'PATCH', 'PUT'];
  if (!mutatingMethods.includes(req.method)) return next();

  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const source = origin || referer;

  const allowedOrigins = (process.env.FRONTEND_URL || '')
    .split(',')
    .map(u => u.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    return res.status(500).json({ message: 'Server misconfiguration: No allowed origins.' });
  }

  const isAllowed = allowedOrigins.some(allowed => source.startsWith(allowed));

  if (!isAllowed) {
    return res.status(403).json({ message: 'Forbidden: Origin not allowed.' });
  }

  next();
}

// ── 5. Request sanitisation (Manual to prevent Getter-Only error) ────────
export function sanitizeMongo(req, res, next) {
  const sanitize = (obj) => {
    if (obj instanceof Object) {
      for (const key in obj) {
        if (key.startsWith('$') || key.includes('.')) {
          const newKey = key.replace(/\$/g, '_').replace(/\./g, '_');
          obj[newKey] = obj[key];
          delete obj[key];
          sanitize(obj[newKey]);
        } else {
          sanitize(obj[key]);
        }
      }
    }
  };

  if (req.body) sanitize(req.body);
  if (req.query) sanitize(req.query);
  if (req.params) sanitize(req.params);
  
  next();
}


export const sanitizeHpp = hpp();

// ── 6. Paystack webhook verification ─────────────────────────────────────
export function verifyPaystackWebhook(req, res, next) {
  const signature = req.headers['x-paystack-signature'];
  if (!signature) return res.status(401).json({ message: 'Missing signature.' });

  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.rawBody)
    .digest('hex');

  if (hash !== signature) return res.status(401).json({ message: 'Invalid signature.' });

  next();
}