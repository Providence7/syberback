import express from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import {
  getNotifications,
  markAllAsRead,
  markNotificationAsRead
} from '../controllers/notify.js';

const router = express.Router();

// ✅ First, authenticate the user for all routes
// router.use(protect);

// ✅ Then log after authentication

// ✅ Routes
router.get('/',protect, getNotifications);
router.post('/',protect, markAllAsRead);
router.post('/:id/read',protect, markNotificationAsRead);

export default router;
