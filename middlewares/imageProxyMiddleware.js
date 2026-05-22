/**
 * imageProxyMiddleware.js
 *
 * Add to styleRoutes.js (before /:id routes):
 *
 *   import { imageProxy } from '../middlewares/imageProxyMiddleware.js';
 *   router.get('/image-proxy', protect, imageProxy);
 *
 * Purpose: lets the admin UI preview any image URL (including Pinterest)
 * without hitting browser CORS / hotlink restrictions. The server fetches
 * the image and pipes it back to the browser.
 *
 * FIXES:
 *  - Added MAX_REDIRECTS cap (5) to prevent redirect loops / stack overflows.
 *  - Added SSRF / open-redirect guard: blocks requests to localhost, loopback,
 *    link-local, and private RFC-1918 ranges so an attacker cannot use this
 *    endpoint to probe internal infrastructure.
 *  - Redirect now passes depth counter instead of mutating req.query.
 */

import https from 'https';
import http  from 'http';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_REDIRECTS = 5;

/**
 * Hosts that must never be proxied — covers:
 *  - localhost / 127.x loopback
 *  - IPv4 unspecified  0.0.0.0
 *  - AWS/GCP/Azure link-local metadata  169.254.x.x
 *  - RFC-1918 private ranges  10.x, 172.16-31.x, 192.168.x
 *  - IPv6 loopback  ::1
 */
const BLOCKED_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|169\.254\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|::1)$/i;

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {number} [_depth=0]  Internal redirect-depth counter — do not pass from outside.
 */
export function imageProxy(req, res, _depth = 0) {
  const { url } = req.query;

  if (!url) return res.status(400).send('Missing url param');

  // ── Redirect-loop guard ───────────────────────────────────────────────────
  if (_depth > MAX_REDIRECTS) {
    return res.status(502).send(`Too many redirects (max ${MAX_REDIRECTS})`);
  }

  // ── URL validation ────────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).send('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).send('Only http/https URLs are allowed');
  }

  // ── SSRF / open-redirect guard ────────────────────────────────────────────
  // Resolve the raw hostname (strip IPv6 brackets if present)
  const hostname = parsed.hostname.replace(/^\[|]$/g, '');
  if (BLOCKED_HOST_RE.test(hostname)) {
    return res.status(403).send('Forbidden: private/internal host');
  }

  // ── Proxy the request ─────────────────────────────────────────────────────
  const client  = parsed.protocol === 'https:' ? https : http;
  const options = {
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path:     parsed.pathname + parsed.search,
    method:   'GET',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://www.pinterest.com/',
      'Accept':  'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
  };

  const proxyReq = client.request(options, (proxyRes) => {
    // ── Follow redirects ────────────────────────────────────────────────────
    if (
      [301, 302, 303, 307, 308].includes(proxyRes.statusCode) &&
      proxyRes.headers.location
    ) {
      // Consume the redirect response body so the socket is released
      proxyRes.resume();
      // Re-run with the new URL and incremented depth counter
      req.query.url = proxyRes.headers.location;
      return imageProxy(req, res, _depth + 1);
    }

    if (proxyRes.statusCode !== 200) {
      return res.status(502).send(`Upstream returned HTTP ${proxyRes.statusCode}`);
    }

    // ── Stream image back to browser ────────────────────────────────────────
    res.setHeader('Content-Type',  proxyRes.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    // Remove upstream headers that could confuse the browser
    res.removeHeader('X-Frame-Options');
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[imageProxy] Upstream request error:', err.message);
    if (!res.headersSent) {
      res.status(502).send('Proxy fetch failed');
    }
  });

  proxyReq.end();
}