import express from 'express';
import { 
  createOrder, 
  getUserOrders, 
  getOrderById, 
  getAllOrders, 
  updateOrder, 
  deleteOrder 
} from '../controllers/order.js';
import {authenticateUser } from '../middlewares/authMiddleware.js';
const router = express.Router();

// Routes
router.use(authenticateUser);
router.post('/', createOrder);
router.get('/', getUserOrders);
router.get('/:orderId', getOrderById);
router.get('/admin/orders', getAllOrders); // Admin only
router.put('/:orderId', updateOrder);
router.delete('/:orderId', deleteOrder);
export default router;
