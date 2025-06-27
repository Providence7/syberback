import express from 'express';
import { createOrder, getUserOrders } from '../controllers/online.js';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import upload from '../middlewares/online.js';

const router = express.Router();

// Accept two images: styleImage, materialImage
router.post('/', authenticateUser, upload.fields([
  { name: 'styleImage', maxCount: 1 },
  { name: 'materialImage', maxCount: 1 },
]), createOrder);

router.get('/', authenticateUser, getUserOrders);

export default router;
