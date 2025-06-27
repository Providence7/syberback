import mongoose from 'mongoose';
import Notification from '../models/notification.js';

export const getNotifications = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id); // ✅ convert to ObjectId

    const notifications = await Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(20);

    res.status(200).json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Server error while fetching notifications' });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id); // ✅ convert to ObjectId

    const result = await Notification.updateMany(
      { user: userId, read: false },
      { $set: { read: true } }
    );

    res.status(200).json({ success: true, updatedCount: result.modifiedCount });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
