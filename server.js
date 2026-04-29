import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import http from 'http';
import connectDB from "./config/db.js";

import * as security from './middlewares/security.js'; 

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
app.use(cookieParser());
app.set('trust proxy', 1);

// A. SECURITY HEADERS & GLOBAL RATE LIMIT
app.use(security.securityHeaders);
app.use(security.generalRateLimiter);

// B. CORS
app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'], 
}));

// C. WEBHOOK HANDLING (MUST BE BEFORE express.json())
app.post('/api/webhooks/paystack', 
  express.raw({ type: 'application/json' }), 
  (req, res, next) => { req.rawBody = req.body; next(); },
  security.verifyPaystackWebhook,
  (req, res) => res.status(200).send('Webhook verified')
);

// D. PARSERS (MUST BE BEFORE SANITIZATION)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// E. SANITIZATION (Now works without TypeError)
app.use(security.sanitizeMongo);
app.use(security.sanitizeHpp);

app.get('/api/csrf-token', security.issueCsrfToken);
app.get('/', (req, res) => res.send("✅ SyberTailor backend is running!"));

// F. AUTH ROUTES
app.use('/api/auth', security.authRateLimiter, authRoutes);

// G. PROTECTED BUSINESS ROUTES
const protectedRoutes = [
  '/api/measurements',
  '/api/order',
  '/api/orders',
];

// Combine Origin Check + CSRF Protection
app.use(protectedRoutes, security.strictOriginCheck, security.csrfProtection);

// Map Routers
app.use('/api/measurements', measurementRoutes);
app.use('/api/order', inpersonRoute);
app.use('/api/orders', orderRoutes);

// H. GENERAL/PUBLIC ROUTES
app.use('/api/notifications', notificationRoutes);
app.use('/api/currency', currencyRoutes);
app.use('/api/styles', styleRoutes);
app.use('/api/fabrics', fabricRoutes);

connectDB();

const server = http.createServer(app);
const io = initSocket(server);
app.set('io', io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});