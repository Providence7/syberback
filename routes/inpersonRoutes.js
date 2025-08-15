import express from 'express';
import { protect} from '../middlewares/authMiddleware.js';
import dotenv from 'dotenv';
import { 
  createOrder, 
  getUserOrders, 
  getOrderById, 
  getAllOrders, 
  deleteOrder,
  getOrdersByDateRange 
} from '../controllers/inpersonContoller.js';
dotenv.config();
const router = express.Router();
// User routes
router.use(protect)
router.post('/in-person/', createOrder);
router.get('/in-person/', getUserOrders);
router.get('/in-person/:orderId', getOrderById);

// Admin routes (add admin middleware)
router.get('/admin/in-person/',  getAllOrders); 
router.get('/admin/in-person/:orderId', getOrderById);
router.delete('/admin/in-person/:orderId',  deleteOrder);
router.get('/admin/in-person/date-range', getOrdersByDateRange);

export default router;
