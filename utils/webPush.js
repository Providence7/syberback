// utils/webPush.js
import webpush from 'web-push';
import User from '../models/user.js';

// ── VAPID setup with validation ───────────────────────────────────────────────
const { VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;

if (!VAPID_EMAIL || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('❌ VAPID env vars missing:', {
    VAPID_EMAIL:       !!VAPID_EMAIL,
    VAPID_PUBLIC_KEY:  !!VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: !!VAPID_PRIVATE_KEY,
  });
} else {
  console.log('✅ VAPID keys loaded. Email:', VAPID_EMAIL);
}

webpush.setVapidDetails(
  VAPID_EMAIL,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
);

// ── Send push to a raw subscription object ────────────────────────────────────
export const sendPushToUser = async (subscription, payload) => {
  if (!subscription?.endpoint) {
    console.warn('⚠️ sendPushToUser: no endpoint on subscription, skipping');
    return;
  }

  console.log('📤 Attempting web push to:', subscription.endpoint.slice(0, 70) + '...');

  try {
    const result = await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title:   payload.title   || 'AttireByte',
        message: payload.message || '',
        type:    payload.type    || 'info',
      })
    );
    console.log('✅ Web push sent! Status:', result.statusCode);
  } catch (err) {
    console.error('❌ Web push FAILED. Status:', err.statusCode, '| Body:', err.body || err.message);
    if (err.statusCode === 410 || err.statusCode === 404) {
      return 'expired';
    }
  }
};

// ── Look up user's saved subscription then send ───────────────────────────────
export const pushNotifyUser = async (userId, payload) => {
  try {
    console.log('🔍 pushNotifyUser: checking subscription for user', userId.toString());

    const user = await User.findById(userId).select('pushSubscription name');

    if (!user) {
      console.warn('⚠️ pushNotifyUser: user not found:', userId);
      return;
    }

    if (!user.pushSubscription) {
      console.warn(`⚠️ pushNotifyUser: "${user.name}" has NO push subscription — they haven't allowed notifications yet`);
      return;
    }

    console.log(`📬 Sending push to "${user.name}"...`);
    const result = await sendPushToUser(user.pushSubscription, payload);

    if (result === 'expired') {
      console.log(`🗑️ Removing stale subscription for "${user.name}"`);
      await User.findByIdAndUpdate(userId, { $unset: { pushSubscription: '' } });
    }
  } catch (err) {
    console.error('❌ pushNotifyUser error:', err.message);
  }
};