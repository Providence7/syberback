// src/routes/orderRoutes.js
import express from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import rateLimit from 'express-rate-limit';

import {
  createOrder,
  getUserOrders,
  getOrderById,
  deleteOrder,
  verifyOrderPayment,
  cancelOrder,
  getAdminOrders,
  getAdminOrderById,
  updateOrderAdmin,
  updateOrderStatus,
  deleteOrderAdmin,
  getAllOrdersAdmin,
} from '../controllers/order.js';

const router = express.Router();

// ── Rate limiter for payment endpoint ─────────────────────────────────────────
// Each user is limited to 10 payment attempts per 15 minutes.
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { message: 'Too many payment attempts. Please wait a few minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Rate limiter for cancellation endpoint ────────────────────────────────────
// Prevents accidental/abusive rapid-fire cancel requests. Generous limit
// since it's a legitimate self-service action, not a sensitive one.
const cancelLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { message: 'Too many cancellation attempts. Please wait a few minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Admin routes ───────────────────────────────────────────────────────────────
// Must come BEFORE /:id routes so Express does not match "admin" as an :id.
router.get('/admin/all',        protect, authorize(['admin']), getAllOrdersAdmin);
router.get('/admin',            protect, authorize(['admin']), getAdminOrders);
router.get('/admin/:id',        protect, authorize(['admin']), getAdminOrderById);
router.put('/admin/:id',        protect, authorize(['admin']), updateOrderAdmin);
router.patch('/admin/:id/status', protect, authorize(['admin']), updateOrderStatus);
router.delete('/admin/:id',     protect, authorize(['admin']), deleteOrderAdmin);

// ── User-facing routes ─────────────────────────────────────────────────────────
router.post('/',      protect, createOrder);
router.get('/',       protect, getUserOrders);
router.get('/:id',    protect, getOrderById);
router.delete('/:id', protect, deleteOrder);

// ── Payment verification ───────────────────────────────────────────────────────
// Security layers:
//   1. protect         — valid JWT/session cookie required
//   2. paymentLimiter  — rate-limited per user to prevent abuse
//   3. verifyOrderPayment (controller):
//        - ownership check  (order.user === req.user.id)
//        - server-to-server Paystack verify (amount never trusted from client)
//        - idempotent 409 if already paid
//        - reference reuse check across orders
router.post('/:id/pay', protect, paymentLimiter, verifyOrderPayment);

// ── Client-initiated cancellation ─────────────────────────────────────────────
// Security layers:
//   1. protect       — valid JWT/session cookie required
//   2. cancelLimiter  — rate-limited per user
//   3. cancelOrder (controller):
//        - ownership check
//        - requires a reason from a fixed allowlist ('Other' requires free text)
//        - blocked for already-cancelled or completed orders
router.patch('/:id/cancel', protect, cancelLimiter, cancelOrder);

export default router;