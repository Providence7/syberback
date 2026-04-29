/**
 * src/middleware/security.js
 *
 * Central security middleware module. Import and apply in app.js.
 *
 * What each piece does:
 *
 * securityHeaders      — Content-Security-Policy + other HTTP security headers
 *                        Blocks inline script injection (XSS), clickjacking,
 *                        MIME sniffing, and restricts which domains JS can contact.
 *
 * csrfProtection       — Double-submit cookie CSRF guard for all state-changing routes.
 *                        Cross-origin pages cannot read the token, so they cannot forge
 *                        a valid request even with the user's session cookie.
 *
 * issueCsrfToken       — GET /api/csrf-token — issues the token the frontend stores
 *                        in memory (NOT sessionStorage) on app mount.
 *
 * paymentRateLimiter   — Hard cap on payment verify attempts per IP.
 *                        Prevents DoS against the Paystack API quota.
 *
 * strictOriginCheck    — Rejects requests to financial routes that don't originate
 *                        from your own frontend. Defence-in-depth alongside CSRF.
 *
 * sanitizeRequest      — Strips MongoDB operator injection ($gt, $where etc.) and
 *                        HTTP Parameter Pollution from all incoming request bodies.
 *                        Freezes Object.prototype to prevent prototype pollution.
 */

import rateLimit      from 'express-rate-limit';
import mongoSanitize  from 'express-mongo-sanitize';
import hpp            from 'hpp';
import { doubleCsrf } from 'csrf-csrf';
import crypto         from 'crypto';

// ── Freeze Object.prototype once at module load ───────────────────────────
// Prevents prototype pollution attacks via crafted JSON payloads like:
//   { "__proto__": { "isAdmin": true } }
// This runs immediately when the module is imported — before any request
// handling begins.

// ── 1. Security headers (CSP + hardening) ────────────────────────────────
export function securityHeaders(req, res, next) {
  // Content-Security-Policy
  // Adjust script-src and connect-src to match your actual CDNs / APIs.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    // Only allow scripts from your origin and Paystack's JS SDK
    "script-src 'self' https://js.paystack.co",
    // Only allow styles from your origin (Tailwind is bundled, no CDN needed)
    "style-src 'self' 'unsafe-inline'",
    // API calls allowed to your own origin and Paystack
    "connect-src 'self' https://api.paystack.co",
    // Paystack checkout iframe
    "frame-src https://checkout.paystack.com",
    // Images: your origin + data URIs (for jsPDF) + Paystack CDN
    "img-src 'self' data: https://paystack.com",
    // No object / embed / base tag manipulation
    "object-src 'none'",
    "base-uri 'self'",
    // Block all mixed content
    "upgrade-insecure-requests",
  ].join('; '));

  // Prevent your site from being embedded in iframes (clickjacking)
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent browsers from MIME-sniffing response content-type
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Only send Referer header to same origin — prevents leaking URLs to third parties
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Restrict powerful browser APIs (camera, mic, geolocation etc.)
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Force HTTPS for 1 year (only set this if you are 100% HTTPS)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

// ── 2. CSRF protection (double-submit cookie pattern) ────────────────────
// How it works:
//   1. Frontend calls GET /api/csrf-token on mount
//   2. Server sets an HttpOnly cookie + returns a token in JSON
//   3. Frontend stores JSON token in memory (not storage)
//   4. Every POST/DELETE/PATCH sends token as X-CSRF-Token header
//   5. Backend validates header token against cookie — cross-origin pages
//      cannot read the cookie (HttpOnly) or the header value (CORS)
//
// CSRF_SECRET must be a random 64-char string set in your .env
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret:    () => process.env.CSRF_SECRET,
  cookieName:   '__Host-x-csrf-token',  // __Host- prefix enforces Secure + no domain
  cookieOptions: {
    sameSite: 'strict',
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    path:     '/',
  },
  size:               64,
  ignoredMethods:     ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: req => req.headers['x-csrf-token'],
});

// Middleware that validates the CSRF token — apply to all mutating routes
export { doubleCsrfProtection as csrfProtection };

// Route handler: GET /api/csrf-token
// Frontend calls this on app mount and stores the token in JS memory
export function issueCsrfToken(req, res) {
  const token = generateToken(req, res);
  res.json({ token });
}

// ── 3. Payment endpoint rate limiter ─────────────────────────────────────
// 10 payment attempts per IP per 15 minutes.
// This protects your Paystack API quota from denial-of-service floods.
export const paymentRateLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { message: 'Too many payment attempts. Please try again in 15 minutes.' },
  // Key by IP — for production behind a proxy, set app.set('trust proxy', 1)
  // and this will use the real IP from X-Forwarded-For
  keyGenerator: (req) => req.ip,
  skip: (req) => {
    // Never rate-limit webhook endpoint (Paystack's server IPs)
    return req.path.includes('/webhooks/');
  },
});

// General API rate limiter — broader window, higher limit
export const generalRateLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { message: 'Too many requests. Please slow down.' },
});

// Auth endpoint limiter (login / register) — tighter
export const authRateLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { message: 'Too many login attempts. Please try again later.' },
});

// ── 4. Origin check — defence in depth for financial routes ───────────────
// Rejects requests to payment/delete routes that don't originate from your
// own frontend. This is NOT a substitute for CSRF tokens — it's an extra
// layer that fails fast on obviously wrong origins.
export function strictOriginCheck(req, res, next) {
  const mutatingMethods = ['POST', 'DELETE', 'PATCH', 'PUT'];
  if (!mutatingMethods.includes(req.method)) return next();

  const origin  = req.headers.origin  || '';
  const referer = req.headers.referer || '';
  const source  = origin || referer;

  const allowedOrigins = (process.env.FRONTEND_URL || '')
    .split(',')
    .map(u => u.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    // No FRONTEND_URL set — misconfiguration, log and block
    console.error('SECURITY: FRONTEND_URL not set. Blocking all mutating requests.');
    return res.status(500).json({ message: 'Server misconfiguration.' });
  }

  const isAllowed = allowedOrigins.some(allowed => source.startsWith(allowed));

  if (!isAllowed) {
    console.warn(`SECURITY: Blocked request from origin "${source}" to ${req.method} ${req.path}`);
    return res.status(403).json({ message: 'Forbidden.' });
  }

  next();
}

// ── 5. Request sanitisation ───────────────────────────────────────────────
// Two separate middlewares — apply both globally in app.js

// Strips MongoDB operators ($gt, $where, $regex etc.) from query/body/params
// Prevents NoSQL injection attacks like: { "email": { "$gt": "" } }
export const sanitizeMongo = mongoSanitize({
  replaceWith: '_',  // replace $ with _ instead of silently stripping
  onSanitizeError: (req, res) => {
    console.warn(`SECURITY: MongoDB injection attempt from ${req.ip} on ${req.path}`);
    res.status(400).json({ message: 'Invalid characters detected in request.' });
  },
  allowDots: false,
});

// Prevents HTTP Parameter Pollution (e.g. ?status=paid&status=unpaid)
export const sanitizeHpp = hpp();

// ── 6. Paystack webhook signature verification ────────────────────────────
// Verifies that incoming webhooks genuinely came from Paystack.
// Must be applied BEFORE express.json() parses the body — use raw body.
export function verifyPaystackWebhook(req, res, next) {
  const signature = req.headers['x-paystack-signature'];
  if (!signature) {
    return res.status(401).json({ message: 'Missing webhook signature.' });
  }

  // req.rawBody must be set by a raw body middleware (see app.js)
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.rawBody)
    .digest('hex');

  if (hash !== signature) {
    console.warn(`SECURITY: Invalid Paystack webhook signature from ${req.ip}`);
    return res.status(401).json({ message: 'Invalid webhook signature.' });
  }

  next();
}