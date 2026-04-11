// utils/notifyUser.js
import Notification from '../models/notification.js';

/**
 * Creates a DB notification and emits it in real-time via Socket.io
 * @param {object} io        - The Socket.io server instance
 * @param {string} userId    - Target user's MongoDB _id (string)
 * @param {object} payload   - { title, message, type, category }
 */
export const notifyUser = async (io, userId, { title, message, type = 'info', category = 'admin' }) => {
  try {
    const notif = await Notification.create({
      user:     userId,
      title,
      message,
      type,
      category,
      read:     false,
    });

    const payload = {
      id:        notif._id.toString(),
      title:     notif.title,
      message:   notif.message,
      type:      notif.type,
      category:  notif.category,
      read:      false,
      createdAt: notif.createdAt.toISOString(),
    };

    // Emit to the specific user's socket room
    io.to(`user:${userId}`).emit('notification', payload);

    return notif;
  } catch (err) {
    console.error('notifyUser error:', err.message);
  }
};

/**
 * Broadcasts a notification to ALL connected users
 */
export const broadcastNotification = async (io, userIds, payload) => {
  await Promise.all(userIds.map(id => notifyUser(io, id.toString(), payload)));
};