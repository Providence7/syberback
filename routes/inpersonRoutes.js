import express from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import dotenv from 'dotenv';
import { 
  createOrder, 
  getUserOrders, 
  getOrderById, 
  getAllOrders, 
  updateOrder, 
  deleteOrder,
  getOrdersByDateRange 
} from '../controllers/inpersonContoller.js';
dotenv.config();
const router = express.Router();
// User routes
router.use(authenticateUser)
router.post('/in-person/', createOrder);
router.get('/in-person/', getUserOrders);
router.get('/in-person/:orderId', getOrderById);

// Admin routes (add admin middleware)
router.get('/admin/in-person/',  getAllOrders);
router.put('/admin/in-person/:orderId',  updateOrder);
router.delete('/admin/in-person/:orderId',  deleteOrder);
router.get('/admin/in-person/date-range', getOrdersByDateRange);

export default router;
