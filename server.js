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
const REQUIRED_ENV = [
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
app.use(security.securityHeaders);
app.use(security.generalRateLimiter);

// ── C. CORS ───────────────────────────────────────────────────────────────────
app.use(cors({
  origin:         process.env.CLIENT_URL,
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── D. Cookie parser ──────────────────────────────────────────────────────────
app.use(cookieParser());

// ── E. Webhook (MUST be before express.json parses the body) ─────────────────
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

// ── H. Health check ───────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('SyberTailor backend is running.'));

// ── I. Auth routes (rate-limited) ─────────────────────────────────────────────
app.use('/api/auth', security.authRateLimiter, authRoutes);

// ── J. Protected routes (Origin check only) ───────────────────────────────────
const protectedPrefixes = [
  '/api/measurements',
  '/api/order',
  '/api/orders',
];
app.use(protectedPrefixes, security.strictOriginCheck);

app.use('/api/measurements', measurementRoutes);
app.use('/api/order',        inpersonRoute);
app.use('/api/orders',       orderRoutes);

// ── K. Public routes ──────────────────────────────────────────────────────────
app.use('/api/notifications', notificationRoutes);
app.use('/api/currency',      currencyRoutes);
app.use('/api/styles',        styleRoutes);
app.use('/api/fabrics',       fabricRoutes);

// ── L. Global error handler ───────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
  });
});

// ── M. Database + Server ──────────────────────────────────────────────────────
connectDB();

const server = http.createServer(app);
const io     = initSocket(server);
app.set('io', io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});