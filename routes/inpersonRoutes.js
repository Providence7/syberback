// src/routes/inPersonRoutes.js
import express from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import dotenv from 'dotenv';
import {
  createOrder,
  getUserOrders,
  getOrderById,
  getAllOrders,
  deleteOrder,
  getOrdersByDateRange,
  getAvailability, // ✅ NEW
} from '../controllers/inpersonContoller.js';

dotenv.config();
const router = express.Router();

// ── IMPORTANT: date-range / availability must be registered BEFORE /:orderId ──
// Express matches routes top-to-bottom. If /:orderId is listed first,
// the string "date-range" (or "availability") would be captured as the
// orderId parameter and the intended handler would never be reached.

// ── Admin routes ───────────────────────────────────────────────────────────────
// ✅ FIX: Added authorize(['admin']) — previously any logged-in user could
//    hit admin endpoints. Also fixed route prefix so they don't collide
//    with user routes.
router.get('/admin/in-person/date-range', protect, authorize(['admin']), getOrdersByDateRange);
router.get('/admin/in-person/',           protect, authorize(['admin']), getAllOrders);
router.get('/admin/in-person/:orderId',   protect, authorize(['admin']), getOrderById);
router.delete('/admin/in-person/:orderId', protect, authorize(['admin']), deleteOrder);

// ── User routes ────────────────────────────────────────────────────────────────
router.use(protect);

// ✅ NEW — must come before '/in-person/:orderId' below, same reasoning as
// date-range above: otherwise Express would treat "availability" as an
// :orderId value and this route would never be reached.
router.get('/in-person/availability', getAvailability);

router.post('/in-person/',           createOrder);
router.get('/in-person/',            getUserOrders);
router.get('/in-person/:orderId',    getOrderById);
router.delete('/in-person/:orderId', deleteOrder);

export default router;