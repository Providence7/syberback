// src/routes/orderRoutes.js
import express from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import rateLimit from 'express-rate-limit';

import {
  createOrder,
  getUserOrders,
  getOrderById,
  deleteOrder,
  verifyOrderPayment,   // ✅ was missing — this is why payment never reflected
  getAdminOrders,
  getAdminOrderById,
  updateOrderAdmin,
  updateOrderStatus,
  deleteOrderAdmin,
  getAllOrdersAdmin,
} from '../controllers/order.js';

const router = express.Router();

// ── Rate limiter for payment endpoint ─────────────────────────────────────────
// Prevents brute-forcing payment references or flooding Paystack verify calls.
// Each user is limited to 10 payment attempts per 15 minutes.
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip, // per-user, not per-IP
  message: { message: 'Too many payment attempts. Please wait a few minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Admin routes ───────────────────────────────────────────────────────────────
// These must come BEFORE /:id routes to avoid Express matching "admin" as an :id
router.get('/admin/all', protect, authorize(['admin']), getAllOrdersAdmin);
router.get('/admin',     protect, authorize(['admin']), getAdminOrders);
router.get('/admin/:id', protect, authorize(['admin']), getAdminOrderById);
router.put('/admin/:id', protect, authorize(['admin']), updateOrderAdmin);
router.patch('/admin/:id/status', protect, authorize(['admin']), updateOrderStatus);
router.delete('/admin/:id', protect, authorize(['admin']), deleteOrderAdmin);

// ── User-facing routes ─────────────────────────────────────────────────────────
router.post('/',    protect, createOrder);
router.get('/',     protect, getUserOrders);
router.get('/:id',  protect, getOrderById);
router.delete('/:id', protect, deleteOrder);

// ── Payment verification ───────────────────────────────────────────────────────
// ✅ FIX: This route was commented out / missing — payment could never be
//    verified, so paymentStatus stayed 'unpaid', admin never got notified,
//    and receipts could never be downloaded.
//
// Security layers applied:
//   1. protect    — must be authenticated (valid JWT/session cookie)
//   2. paymentLimiter — rate-limited per user to prevent abuse
//   3. Inside verifyOrderPayment:
//        - order.user must match req.user.id (ownership check)
//        - amount verified with Paystack server-to-server (not trusted from client)
//        - idempotent: 409 if already paid
router.post('/:id/pay', protect, paymentLimiter, verifyOrderPayment);

export default router;