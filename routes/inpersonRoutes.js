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
} from '../controllers/inpersonContoller.js';

dotenv.config();
const router = express.Router();

// ── IMPORTANT: date-range must be registered BEFORE /:orderId ─────────────────
// Express matches routes top-to-bottom. If /:orderId is listed first,
// the string "date-range" would be captured as the orderId parameter
// and the date-range handler would never be reached.

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
router.post('/in-person/',           createOrder);
router.get('/in-person/',            getUserOrders);
router.get('/in-person/:orderId',    getOrderById);
router.delete('/in-person/:orderId', deleteOrder);

export default router;