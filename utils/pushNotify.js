// src/services/pushNotifications.js
// ─────────────────────────────────────────────────────────────────────────────
// EVERYTHING for admin phone alerts lives in this one file:
//   • the push-subscription model (one document per device)
//   • the Web Push sender
//   • the /api/push routes (subscribe, unsubscribe, public-key, test)
//   • the "photo-only measurement" alert (in-app + phone push + email)
//
// server.js — two lines:
//   import { initPush } from './services/pushNotifications.js';
//   initPush(app);          // anywhere after app.use(express.json())
//
// One-time setup:
//   npm i web-push
//   npx web-push generate-vapid-keys
//   env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT=mailto:you@yourdomain.com
//   optional env: ADMIN_MEASUREMENTS_PATH (default /admin/measurements)
// ─────────────────────────────────────────────────────────────────────────────
import express from 'express';
import mongoose from 'mongoose';
import webpush from 'web-push';
import { protect } from '../middlewares/authMiddleware.js';
import User from '../models/user.js';
import { notifyUser } from '../utils/notifyUsers.js';
import { sendEmail } from '../utils/email.js';

// ── Model ────────────────────────────────────────────────────────────────────
const pushSubscriptionSchema = new mongoose.Schema(
  {
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth:   { type: String, required: true },
    },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true },
);

const PushSubscription =
  mongoose.models.PushSubscription || mongoose.model('PushSubscription', pushSubscriptionSchema);

// ── Web Push sender ──────────────────────────────────────────────────────────
// Configured lazily on first send, so it doesn't matter when dotenv loads.
let configured = false;
const configure = () => {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
  return true;
};

/** Push to every registered device of the given users. */
export const sendPushToUsers = async (userIds, { title, body, url = '/', tag }) => {
  if (!configure()) {
    console.warn('[push] VAPID keys missing — push skipped');
    return { sent: 0, removed: 0 };
  }

  const subs = await PushSubscription.find({ user: { $in: userIds } });
  if (subs.length === 0) return { sent: 0, removed: 0 };

  const payload = JSON.stringify({ title, body, url, tag });
  let sent = 0;
  let removed = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: 'high' }, // keep for a day, wake the phone
        );
        sent += 1;
      } catch (err) {
        // 404 / 410 = device unsubscribed or browser data cleared
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: s._id });
          removed += 1;
        } else {
          console.error('[push] send failed:', err.statusCode, err.body || err.message);
        }
      }
    }),
  );

  return { sent, removed };
};

// ── Photo-only measurement alert ─────────────────────────────────────────────
// Called by the measurement controller when a customer saves a photo but no
// measurements. Three independent channels — one failing never blocks the rest:
//   1. saved notification + live Socket.io pop-up (admin logged in anywhere)
//   2. Web Push (phone notification bar, even when the app is closed)
//   3. email to ADMIN_EMAIL
const ADMIN_MEASUREMENTS_PATH = process.env.ADMIN_MEASUREMENTS_PATH || '/admin/measurements';

export const notifyAdminsPhotoOnly = async (req, measurement) => {
  const admins = await User.find({ isAdmin: true }).select('_id');
  if (admins.length === 0) return;

  const adminIds = admins.map((a) => a._id);
  const who      = measurement.user?.name || 'A customer';
  const title    = '📸 Photo-only profile — needs measuring';
  const message  = `${who} saved "${measurement.name}" with a photo but no measurements. Please take their measurements.`;
  const io       = req.app.get('io');
  const link     = `${process.env.CLIENT_URL || ''}${ADMIN_MEASUREMENTS_PATH}?photoOnly=true`;

  const results = await Promise.allSettled([
    Promise.all(
      adminIds.map((id) =>
        notifyUser(io, id.toString(), { title, message, type: 'warning', category: 'measurement' }),
      ),
    ),
    sendPushToUsers(adminIds, {
      title,
      body: message,
      url: `${ADMIN_MEASUREMENTS_PATH}?photoOnly=true`,
      tag: `photo-only-${measurement._id}`,
    }),
    process.env.ADMIN_EMAIL
      ? sendEmail({
          to: process.env.ADMIN_EMAIL,
          subject: `Photo-only measurement profile: ${who}`,
          html: `
            <h2>Photo-only measurement profile</h2>
            <p><strong>${who}</strong> (${measurement.user?.email || 'no email'}) saved the profile
               <strong>"${measurement.name}"</strong> with a photo but <strong>no measurements</strong>.</p>
            <p>Please take their measurements on your end.</p>
            ${measurement.photoCheck === 'failed'
              ? `<p>⚠️ The automatic photo check had doubts: ${measurement.photoCheckNotes}</p>`
              : ''}
            ${measurement.photoUrl ? `<p><a href="${measurement.photoUrl}">View photo</a></p>` : ''}
            <p><a href="${link}">Open admin measurements</a></p>
          `,
        })
      : Promise.resolve(),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[photo-only alert] channel ${i} failed:`, r.reason?.message || r.reason);
    }
  });
};

// ── Routes (/api/push/*) ─────────────────────────────────────────────────────
const router = express.Router();

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ message: 'Admin access required' });
  next();
};

// Public key the browser needs to create a subscription (safe to expose).
router.get('/public-key', protect, (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// Save this device for the logged-in admin.
router.post('/subscribe', protect, adminOnly, async (req, res) => {
  try {
    const { endpoint, keys } = req.body.subscription || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: 'Invalid push subscription.' });
    }
    // Upsert by endpoint: another admin logging in on the same phone just takes over the device.
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        user: req.user.id,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        userAgent: req.headers['user-agent'] || '',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('push subscribe error:', err);
    res.status(500).json({ message: 'Could not save push subscription.' });
  }
});

// Remove this device.
router.post('/unsubscribe', protect, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ message: 'endpoint is required' });
    await PushSubscription.deleteOne({ endpoint, user: req.user.id });
    res.json({ success: true });
  } catch (err) {
    console.error('push unsubscribe error:', err);
    res.status(500).json({ message: 'Could not remove push subscription.' });
  }
});

// Sends a test pop-up to the calling admin's own devices.
router.post('/test', protect, adminOnly, async (req, res) => {
  try {
    const result = await sendPushToUsers([req.user.id], {
      title: '✅ Phone alerts are on',
      body: 'You will get a pop-up like this when a customer saves a photo without measurements.',
      url: '/',
      tag: 'push-test',
    });
    if (result.sent === 0) {
      return res.status(404).json({ message: 'No registered device found — switch alerts on first.' });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('push test error:', err);
    res.status(500).json({ message: 'Could not send test notification.' });
  }
});

// ── The one call server.js needs ─────────────────────────────────────────────
export const initPush = (app) => {
  app.use('/api/push', router);
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('[push] VAPID keys not set — phone alerts will not work until you add them.');
  }
};