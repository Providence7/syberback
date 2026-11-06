// utils/webPush.js
import 'dotenv/config'; // ES imports are hoisted, so load env vars before reading them
import webpush from 'web-push';
import User from '../models/user.js';

// ── VAPID setup ───────────────────────────────────────────────────────────────
const { VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
const pushEnabled = !!(VAPID_EMAIL && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushEnabled) {
  const subject = /^(mailto:|https:)/.test(VAPID_EMAIL) ? VAPID_EMAIL : `mailto:${VAPID_EMAIL}`;
  webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('✅ VAPID keys loaded.');
} else {
  console.error('❌ VAPID env vars missing — web push is disabled:', {
    VAPID_EMAIL:       !!VAPID_EMAIL,
    VAPID_PUBLIC_KEY:  !!VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: !!VAPID_PRIVATE_KEY,
  });
}

// ── Send a push to every device the user has allowed ─────────────────────────
export const pushNotifyUser = async (userId, payload) => {
  if (!pushEnabled) return;

  try {
    // NOTE: field is `pushSubscriptions` (array) — matches savePushSubscription
    const user = await User.findById(userId).select('pushSubscriptions').lean();
    const entries = user?.pushSubscriptions || [];

    if (!entries.length) return; // user hasn't allowed notifications on any device

    const body = JSON.stringify({
      id:       payload.id,
      title:    payload.title   || 'AttireByte',
      message:  payload.message || '',
      type:     payload.type    || 'info',
      category: payload.category,
      url:      payload.url     || '/app',
    });

    const results = await Promise.allSettled(
      entries.map(e =>
        webpush.sendNotification(e.subscription, body, { TTL: 86400, urgency: 'high' })
      )
    );

    // Collect dead subscriptions so we can clean them up
    const expiredEndpoints = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const code = r.reason?.statusCode;
        if (code === 404 || code === 410) {
          expiredEndpoints.push(entries[i].subscription.endpoint);
        } else {
          console.error('❌ Web push failed. Status:', code, '|', r.reason?.body || r.reason?.message);
        }
      }
    });

    if (expiredEndpoints.length) {
      await User.updateOne(
        { _id: userId },
        { $pull: { pushSubscriptions: { 'subscription.endpoint': { $in: expiredEndpoints } } } }
      );
      console.log(`🗑️ Removed ${expiredEndpoints.length} expired subscription(s) for user ${userId}`);
    }
  } catch (err) {
    console.error('❌ pushNotifyUser error:', err.message);
  }
};