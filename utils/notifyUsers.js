// utils/notifyUser.js
import Notification from '../models/notification.js';
import { pushNotifyUser } from './webPush.js';

// Lets code that has no access to `req.app.get('io')` (e.g. the scheduler)
// still emit real-time events. Call setIo(io) once in server.js.
let _io = null;
export const setIo = (io) => { _io = io; };

/**
 * Creates a DB notification, emits it in real time via Socket.io (tab open),
 * and sends a Web Push (tab closed / app closed / phone locked).
 *
 * @param {object|null} io      Socket.io instance (pass null to use the shared one)
 * @param {string}      userId  Target user's MongoDB _id
 * @param {object}      payload { title, message, type, category, order?, url? }
 */
export const notifyUser = async (
  io,
  userId,
  { title, message, type = 'info', category = 'general', order, url }
) => {
  try {
    const notif = await Notification.create({
      user: userId,
      order,
      title,
      message,
      type,
      category,
      read: false,
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

    // Real-time (works when the app is open)
    (io || _io)?.to(`user:${userId}`).emit('notification', payload);

    // Web Push (works when the app is closed)
    await pushNotifyUser(userId, { ...payload, url });

    return notif;
  } catch (err) {
    console.error('notifyUser error:', err.message);
  }
};

/**
 * Broadcasts a notification to ALL given users
 */
export const broadcastNotification = async (io, userIds, payload) => {
  await Promise.all(userIds.map(id => notifyUser(io, id.toString(), payload)));
};