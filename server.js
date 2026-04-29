import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import http from 'http';
import connectDB from "./config/db.js";

// Security Middleware
import * as security from './middlewares/security.js'; 

// Route Imports
import authRoutes from './routes/authRoutes.js';
import measurementRoutes from './routes/measurement.js';
import inpersonRoute from './routes/inpersonRoutes.js';
import notificationRoutes from './routes/notify.js';
import styleRoutes from './routes/styleRoutes.js';
import currencyRoutes from './routes/currency.js';
import orderRoutes from './routes/order.js';
import fabricRoutes from './routes/fabricRoutes.js';
import { initSocket } from './services/socket.js';

dotenv.config();
const app = express();

// 1. Setup Environment
app.set('trust proxy', 1);

// 2. Global Security Headers
app.use(security.securityHeaders);
app.use(security.generalRateLimiter);

// 3. CORS (Allowing your frontend and the CSRF header)
app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'], 
}));

// 4. Webhook Handling (Raw body required)
app.post('/api/webhooks/paystack', 
  express.raw({ type: 'application/json' }), 
  (req, res, next) => { req.rawBody = req.body; next(); },
  security.verifyPaystackWebhook,
  (req, res) => res.status(200).send('Webhook verified')
);

// 5. Parsers & Sanitization
app.use(express.json());
app.use(cookieParser());
app.use(security.sanitizeMongo);
app.use(security.sanitizeHpp);

// 6. Security Token Endpoint
app.get('/api/csrf-token', security.issueCsrfToken);

app.get('/', (req, res) => res.send("✅ SyberTailor backend is running!"));

// 7. Route Logic
// ---------------------------------------------------------

// Auth - with specific rate limiter
app.use('/api/auth', security.authRateLimiter, authRoutes);

// Protected Business Routes - Require CSRF + Origin Check
// These handle measurements, money, and custom styles
const protectedRoutes = [
  '/api/measurements',
  '/api/order',
  '/api/orders',
  '/api/styles',
  '/api/fabrics'
];
app.use(protectedRoutes, security.strictOriginCheck, security.csrfProtection);

// Map the Routers
app.use('/api/measurements', measurementRoutes);
app.use('/api/order', inpersonRoute);
app.use('/api/orders', orderRoutes);
app.use('/api/styles', styleRoutes);
app.use('/api/fabrics', fabricRoutes);

// General/Public Routes
app.use('/api/notifications', notificationRoutes);
app.use('/api/currency', currencyRoutes);

// ---------------------------------------------------------

connectDB();

const server = http.createServer(app);
const io = initSocket(server);
app.set('io', io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});