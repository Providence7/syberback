// utils/webPush.js
// ✅ NEW FILE — handles Web Push API via the `web-push` npm package.
//
// Setup:
//   1. npm install web-push
//   2. npx web-push generate-vapid-keys   (run once, paste output into .env)
//   3. Add to .env:
//        VAPID_PUBLIC_KEY=...
//        VAPID_PRIVATE_KEY=...
//        VAPID_EMAIL=mailto:you@yourdomain.com
//   4. Add to frontend .env:
//        VITE_VAPID_PUBLIC_KEY=<same public key>

import webpush from 'web-push';
import User from '../models/user.js';

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

/**
 * Send a Web Push notification to a single subscription object.
 * Returns 'expired' when the subscription is no longer valid (HTTP 410)
 * so the caller can clean it up from the database.
 *
 * @param {object} subscription  - PushSubscription from the browser / DB
 * @param {object} payload       - { title, message, type, icon? }
 * @returns {Promise<'expired'|void>}
 */
export const sendPushToUser = async (subscription, payload) => {
  if (!subscription?.endpoint) return;
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription has expired or been unsubscribed — signal caller to delete it
      return 'expired';
    }
    console.error('Web push error:', err.message);
  }
};

/**
 * Convenience wrapper: look up a user's saved push subscription and fire a
 * push notification, automatically cleaning up expired subscriptions.
 *
 * @param {string|ObjectId} userId
 * @param {object}          payload  - { title, message, type }
 */
export const pushNotifyUser = async (userId, payload) => {
  try {
    const user = await User.findById(userId).select('pushSubscription');
    if (!user?.pushSubscription) return;

    const result = await sendPushToUser(user.pushSubscription, payload);

    if (result === 'expired') {
      // Subscription is stale — remove it so we don't keep trying
      await User.findByIdAndUpdate(userId, { $unset: { pushSubscription: '' } });
      console.log(`Cleaned up expired push subscription for user ${userId}`);
    }
  } catch (err) {
    console.error('pushNotifyUser error:', err.message);
  }
};