// routes/notificationRoutes.js
import express from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { getNotifications,markAllAsRead } from '../controllers/notify.js';

const router = express.Router();

router.get('/', authenticateUser, getNotifications);
router.post('/', authenticateUser, markAllAsRead);

export default router;
