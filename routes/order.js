// src/routes/orderRoutes.js
import express from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';

import {
    createOrder,
    getUserOrders,
    getOrderById, // User-specific get by ID
    payForOrder, // <-- NEW: Import the new controller function

    // Admin-specific functions
    getAdminOrders,
    getAdminOrderById,
    updateOrderAdmin,

} from '../controllers/order.js'; // Ensure this path is correct: '../controllers/order.js' or '../controllers/orderController.js'

const router = express.Router();

// --- Admin-specific Order Routes (require admin authorization) ---
router.get('/admin', protect, authorize(['admin']), getAdminOrders);
router.get('/admin/:id', protect, authorize(['admin']), getAdminOrderById);
router.put('/admin/:id', protect, authorize(['admin']), updateOrderAdmin);


// --- User-facing Order Routes (require user authentication) ---
router.post('/', protect, createOrder);
router.get('/', protect, getUserOrders);
router.get('/:orderId', protect, getOrderById);


// --- NEW ROUTE: Pay for an existing order ---
router.post('/:orderId/pay', protect, payForOrder); // Ensure this is unique and doesn't conflict with others

export default router;