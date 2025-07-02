// controllers/notification.js
import mongoose from 'mongoose';
import Notification from '../models/notification.js';

export const getNotifications = async (req, res) => {
 
  try {
    if (!req.user?.id) {
      console.log('No user ID found in request');
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

export const markAllAsRead = async (req, res) => {
  console.log('markAllAsRead called for user:', req.user?.id);
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);

    const result = await Notification.updateMany(
      { user: userId, read: false },
      { $set: { read: true } }
    );

    console.log(`Marked ${result.modifiedCount} notifications as read for user ${userId}`);
    
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
  console.log('markNotificationAsRead called');
  console.log('User ID:', req.user?.id);
  console.log('Notification ID:', req.params.id);
  console.log('Full request params:', req.params);
  
  try {
    if (!req.user?.id) {
      console.log('No user ID found');
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);
    const notificationId = req.params.id;

    // Validate notification ID
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      console.log('Invalid notification ID format:', notificationId);
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid notification ID format' 
      });
    }

    console.log('Looking for notification with conditions:', {
      _id: notificationId,
      user: userId.toString(),
      read: false
    });

    // First, let's check if the notification exists at all
    const existingNotification = await Notification.findById(notificationId);
    console.log('Existing notification:', existingNotification);

    if (!existingNotification) {
      console.log('Notification not found in database');
      return res.status(404).json({ 
        success: false, 
        message: 'Notification not found' 
      });
    }

    if (existingNotification.user.toString() !== userId.toString()) {
      console.log('Notification belongs to different user');
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to access this notification' 
      });
    }

    if (existingNotification.read) {
      console.log('Notification already marked as read');
      return res.status(200).json({ 
        success: true, 
        message: 'Notification already marked as read' 
      });
    }

    // Update the notification
    const updatedNotification = await Notification.findByIdAndUpdate(
      notificationId,
      { $set: { read: true } },
      { new: true }
    );

    console.log('Updated notification:', updatedNotification);

    res.status(200).json({ 
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};