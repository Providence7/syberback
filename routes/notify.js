// routes/notify.js
import express from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import {
  getNotifications,
  markAllAsRead,
  markNotificationAsRead,
  adminSendNotification,        // ← add this import
} from '../controllers/notify.js';

const router = express.Router();

router.get('/',                    protect, getNotifications);
router.post('/read-all',           protect, markAllAsRead);           // ← was POST '/' — fixed
router.post('/admin/send',         protect, adminSendNotification);   // ← was missing entirely
router.post('/:id/read',           protect, markNotificationAsRead);  // ← must stay last (param route)

export default router;