// routes/notify.js
import express from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import {
  getNotifications,
  markAllAsRead,
  markNotificationAsRead,
  adminSendNotification,
  deleteNotification,     // ✅ NEW
  savePushSubscription,   // ✅ NEW
} from '../controllers/notify.js';

const router = express.Router();

// Inline admin guard — no extra file needed
const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

router.get('/',              protect,            getNotifications);
router.post('/read-all',     protect,            markAllAsRead);
router.post('/subscribe',    protect,            savePushSubscription);  // ✅ NEW
router.post('/admin/send',   protect, adminOnly, adminSendNotification);
router.post('/:id/read',     protect,            markNotificationAsRead);
router.delete('/:id',        protect,            deleteNotification);    // ✅ NEW

export default router;