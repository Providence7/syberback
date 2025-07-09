// src/routes/orderRoutes.js
import express from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';

import {
  createOrder,
  getUserOrders,
  getOrderById, // User-specific get by ID
  updateOrder,  // User-specific update
  deleteOrder,  // User-specific soft delete (cancel)

  // Admin-specific functions
  getAdminOrders,
  getAdminOrderById,
  updateOrderAdmin,
  deleteOrderAdmin,
} from '../controllers/order.js';

const router = express.Router();

// --- Admin-specific Order Routes (require admin authorization) ---
// IMPORTANT: Place these more specific routes FIRST
router.get('/admin', protect, authorize(['admin']), getAdminOrders);           // Get all orders for admin panel
router.get('/admin/:id', protect, authorize(['admin']), getAdminOrderById);   // Get single order for admin detail view
router.put('/admin/:id', protect, authorize(['admin']), updateOrderAdmin);     // Admin can update any order
router.delete('/admin/:id', protect, authorize(['admin']), deleteOrderAdmin); // Admin can hard-delete any order

// --- User-facing Order Routes (require user authentication) ---
// These are more general and should come AFTER the specific admin routes
router.post('/', protect, createOrder);
router.get('/', protect, getUserOrders);             // Get all orders for the authenticated user
router.get('/:orderId', protect, getOrderById);      // Get a specific order for the authenticated user
router.put('/:orderId', protect, updateOrder);       // User can update their own order (limited fields)
router.delete('/:orderId', protect, deleteOrder);    // User can soft-delete (cancel) their own order


export default router;