// utils/notifyUser.js
import Notification from '../models/notification.js';
import { pushNotifyUser } from './webPush.js';

/**
 * Creates a DB notification and emits it in real-time via Socket.io
 * Also sends a Web Push so the user gets it even when the tab is closed.
 * @param {object} io        - The Socket.io server instance
 * @param {string} userId    - Target user's MongoDB _id (string)
 * @param {object} payload   - { title, message, type, category }
 */
export const notifyUser = async (io, userId, { title, message, type = 'info', category = 'general' }) => {
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

    // Emit to the specific user's socket room (works when tab is open)
    io.to(`user:${userId}`).emit('notification', payload);

    // Web Push (works even when tab is closed / phone is locked)
    // Pass category through so the push payload is fully consistent with the DB record
    await pushNotifyUser(userId, { title, message, type, category });

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