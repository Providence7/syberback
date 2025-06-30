import express from 'express';
import uploader from '../middlewares/uploadMiddleware.js';
import {authenticateUser} from '../middlewares/authMiddleware.js';
// import adminAuth from '../middlewares/adminAuth.js';
import {
  createOrder,
  getUserOrders,
  getOrder,
  deleteOrder,
  updateOrderStatus,
  getAllOrders,
} from '../controllers/online.js';

const router = express.Router();

// Middleware to handle multiple file fields (styleImage & materialImage)
const uploadFields = uploader.fields([
  { name: 'styleImage', maxCount: 1 },
  { name: 'materialImage', maxCount: 1 },
]);

// All user routes require auth
router.use(authenticateUser);

// Create a new online order
router.post('/', uploadFields, createOrder);

// Get all orders for the authenticated user
router.get('/my-orders', getUserOrders);

// Get a specific order by ID for the authenticated user
router.get('/:orderId', getOrder);

// Delete a pending order by ID (user only)
router.delete('/:orderId', deleteOrder);

// Admin-only routes
// router.use(adminAuth);

// // Get all orders (admin)
// router.get('/', getAllOrders);

// // Update order status (admin)
// router.patch('/:orderId/status', updateOrderStatus);

export default router;
