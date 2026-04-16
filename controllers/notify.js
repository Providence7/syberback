// controllers/notification.js
import mongoose from 'mongoose';
import Notification from '../models/notification.js';
import User from '../models/user.js';
import { notifyUser, broadcastNotification } from '../utils/notifyUsers.js';

export const getNotifications = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: 'User not authenticated' });
    }
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const notifications = await Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(50);
    const transformedNotifications = notifications.map(notif => ({
      ...notif.toObject(),
      id: notif._id.toString()
    }));
    res.status(200).json(transformedNotifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Server error while fetching notifications' });
  }
};

export const adminSendNotification = async (req, res) => {
  try {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: 'Admins only' });
    }
    const { title, message, type = 'info', scope, userId } = req.body;
    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({ message: 'Title and message are required' });
    }
    const io = req.app.get('io');
    if (scope === 'targeted') {
      if (!userId) return res.status(400).json({ message: 'userId required for targeted scope' });
      await notifyUser(io, userId, { title, message, type, category: 'admin' });
    } else {
      const users = await User.find({}, '_id');
      await broadcastNotification(io, users.map(u => u._id), { title, message, type, category: 'admin' });
    }
    res.status(200).json({ success: true, message: 'Notification sent' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const result = await Notification.updateMany(
      { user: userId, read: false },
      { $set: { read: true } }
    );
    res.status(200).json({
      success: true,
      updatedCount: result.modifiedCount,
      message: `Marked ${result.modifiedCount} notifications as read`
    });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const markNotificationAsRead = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    const userId         = new mongoose.Types.ObjectId(req.user.id);
    const notificationId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ success: false, message: 'Invalid notification ID format' });
    }
    const existingNotification = await Notification.findById(notificationId);
    if (!existingNotification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    if (existingNotification.user.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (existingNotification.read) {
      return res.status(200).json({ success: true, message: 'Already marked as read' });
    }
    await Notification.findByIdAndUpdate(notificationId, { $set: { read: true } });
    res.status(200).json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    const userId         = new mongoose.Types.ObjectId(req.user.id);
    const notificationId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ success: false, message: 'Invalid notification ID format' });
    }
    const notif = await Notification.findById(notificationId);
    if (!notif) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    if (notif.user.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    await notif.deleteOne();
    res.status(200).json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── POST /api/notifications/subscribe ────────────────────────────────────────
export const savePushSubscription = async (req, res) => {
  try {
    console.log('📥 savePushSubscription called for user:', req.user?.id);

    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const { subscription } = req.body;

    console.log('📦 Received subscription object:', JSON.stringify(subscription, null, 2));

    if (!subscription?.endpoint) {
      console.error('❌ No endpoint in subscription object');
      return res.status(400).json({ success: false, message: 'Invalid subscription object — missing endpoint' });
    }

    // Only add if this endpoint isn't already stored for this user
    // This handles the same device re-subscribing without duplication
    const user = await User.findById(req.user.id).select('name pushSubscriptions');

    if (!user) {
      console.error('❌ User not found when saving subscription:', req.user.id);
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const alreadyExists = user.pushSubscriptions?.some(
      entry => entry.subscription?.endpoint === subscription.endpoint
    );

    if (alreadyExists) {
      console.log(`ℹ️ Subscription endpoint already saved for "${user.name}" — skipping duplicate`);
      return res.status(200).json({ success: true, message: 'Subscription already saved' });
    }

    // Append the new subscription to the array
    await User.findByIdAndUpdate(
      req.user.id,
      {
        $push: {
          pushSubscriptions: {
            subscription,
            deviceHint: req.headers['user-agent']?.slice(0, 150) ?? 'unknown',
            createdAt: new Date()
          }
        }
      },
      { new: true }
    );

    console.log(`✅ Push subscription saved for user "${user.name}"`);
    console.log('💾 Endpoint stored:', subscription.endpoint?.slice(0, 60) + '...');

    res.status(200).json({ success: true, message: 'Push subscription saved' });
  } catch (error) {
    console.error('❌ Error saving push subscription:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};