import express    from 'express';
import dotenv     from 'dotenv';
import cookieParser from 'cookie-parser';
import cors       from 'cors';
import http       from 'http';
import connectDB  from './config/db.js';

import * as security from './middlewares/security.js';

import authRoutes         from './routes/authRoutes.js';
import measurementRoutes  from './routes/measurement.js';
import inpersonRoute      from './routes/inpersonRoutes.js';
import notificationRoutes from './routes/notify.js';
import styleRoutes        from './routes/styleRoutes.js';
import currencyRoutes     from './routes/currency.js';
import orderRoutes        from './routes/order.js';
import fabricRoutes       from './routes/fabricRoutes.js';
import { initSocket }     from './services/socket.js';

dotenv.config();

// ── Fail fast if critical env vars are missing ────────────────────────────────
// This gives you a clear startup error instead of a silent 500 at runtime.
const REQUIRED_ENV = [
  'CSRF_SECRET',
  'PAYSTACK_SECRET_KEY',
  'CLIENT_URL',
  
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const app = express();

// ── A. Trust proxy (Render sits behind a proxy) ───────────────────────────────
app.set('trust proxy', 1);

// ── B. Security headers + global rate limit ───────────────────────────────────
// These run first — before CORS so security headers are always set.
app.use(security.securityHeaders);
app.use(security.generalRateLimiter);

// ── C. CORS ───────────────────────────────────────────────────────────────────
// Must be before cookieParser and body parsers so preflight OPTIONS requests
// get the correct headers and aren't rejected.
app.use(cors({
  origin:         process.env.CLIENT_URL,
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
}));

// ── D. Cookie parser ──────────────────────────────────────────────────────────
// Must come before CSRF middleware — csrf-csrf reads the cookie to validate.
app.use(cookieParser());

// ── E. Webhook (MUST be before express.json parses the body) ─────────────────
// Paystack signature verification requires the raw unparsed body.
// express.raw() captures it before express.json() can transform it.
app.post(
  '/api/webhooks/paystack',
  express.raw({ type: 'application/json' }),
  (req, res, next) => { req.rawBody = req.body; next(); },
  security.verifyPaystackWebhook,
  (req, res) => res.status(200).send('OK')
);

// ── F. Body parsers ───────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── G. Sanitization ───────────────────────────────────────────────────────────
app.use(security.sanitizeMongo);
app.use(security.sanitizeHpp);

// ── H. CSRF token endpoint (PUBLIC — no CSRF check on this route) ─────────────
// Frontend calls this on app mount and stores the token in JS memory.
// Must be:
//   - After cookieParser (csrf-csrf sets a cookie here)
//   - After CORS (so the cross-origin fetch from the frontend is allowed)
//   - NOT inside the protectedRoutes middleware group (it issues, not validates)
app.get('/api/csrf-token', security.issueCsrfToken);

// ── I. Health check ───────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('SyberTailor backend is running.'));

// ── J. Auth routes (rate-limited, no CSRF — uses its own JWT flow) ────────────
app.use('/api/auth', security.authRateLimiter, authRoutes);

// ── K. Protected routes (Origin check + CSRF validation + payment rate limit) ──
// csrfProtection validates the X-CSRF-Token header against the cookie.
// strictOriginCheck blocks requests from foreign origins that have an origin header.
// paymentRateLimiter is applied only to the payment verify endpoint (in orderRoutes).
const protectedPrefixes = [
  '/api/measurements',
  '/api/order',
  '/api/orders',
];
app.use(protectedPrefixes, security.strictOriginCheck, security.csrfProtection);

app.use('/api/measurements', measurementRoutes);
app.use('/api/order',        inpersonRoute);
app.use('/api/orders',       orderRoutes);

// ── L. Public routes (no CSRF required) ──────────────────────────────────────
app.use('/api/notifications', notificationRoutes);
app.use('/api/currency',      currencyRoutes);
app.use('/api/styles',        styleRoutes);
app.use('/api/fabrics',       fabricRoutes);

// ── M. Global error handler ───────────────────────────────────────────────────
// Catches any unhandled errors including CSRF validation failures,
// so they always return JSON instead of an Express HTML error page.
app.use((err, req, res, next) => {
  // CSRF token mismatch — csrf-csrf throws with status 403
  if (err.code === 'EBADCSRFTOKEN' || err.status === 403) {
    console.warn(`CSRF validation failed: ${req.method} ${req.path} from ${req.ip}`);
    return res.status(403).json({ message: 'Invalid or missing CSRF token.' });
  }

  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
  });
});

// ── N. Database + Server ──────────────────────────────────────────────────────
connectDB();

const server = http.createServer(app);
const io     = initSocket(server);
app.set('io', io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});