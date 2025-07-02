import express from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import {
  getNotifications,
  markAllAsRead,
  markNotificationAsRead
} from '../controllers/notify.js';

const router = express.Router();

// ✅ First, authenticate the user for all routes
router.use(authenticateUser);

// ✅ Then log after authentication

// ✅ Routes
router.get('/', getNotifications);
router.post('/', markAllAsRead);
router.post('/:id/read', markNotificationAsRead);

export default router;
