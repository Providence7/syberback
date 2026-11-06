// src/utils/notificationScheduler.js
import schedule       from 'node-schedule';
import Order          from '../models/order.js';
import User           from '../models/user.js';
import { notifyUser } from './notifyUsers.js';
import { sendEmail }  from './email.js';
import dotenv         from 'dotenv';

dotenv.config();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// ── In-memory map of all active scheduled jobs ────────────────────────────────
// Keyed by job name so we can cancel them cleanly when an order is deleted
// or cancelled.
const scheduledJobs = new Map();

function registerJob(name, date, fn) {
  // Don't schedule jobs in the past — node-schedule will fire them immediately
  // on some versions, which causes unexpected bursts on server restart.
  if (date <= new Date()) return;

  // If a job with this name already exists, cancel it first so the same
  // notification can never fire twice.
  const existing = scheduledJobs.get(name) || schedule.scheduledJobs[name];
  if (existing) {
    existing.cancel();
    scheduledJobs.delete(name);
  }

  const job = schedule.scheduleJob(name, date, fn);
  if (job) {
    scheduledJobs.set(name, job);
    // Auto-remove from map after it fires so memory doesn't grow unbounded
    job.on('success', () => scheduledJobs.delete(name));
  }
}

// ── Progress steps — what the customer sees each day ─────────────────────────
// type must be a value in the Notification schema enum.
// 'order_progress'    — days 2–5 (material, cut, sewn, dry-cleaned)
// 'delivery_imminent' — day 6 (almost there, delivery tomorrow)
const PROGRESS_STEPS = [
  {
    day:     2,
    type:    'order_progress',
    title:   'Your Material Is Ready! 🧵',
    message: 'Great news, %NAME%! Your material for "%ITEM%" (Order: %SHORT_ID%) has been purchased and is ready for the next step.',
    emailSubject: 'Update on your order — material ready',
    emailBody: (name, item, shortId) => `
      <h2>Your material is ready! 🧵</h2>
      <p>Hi ${name},</p>
      <p>Great news! The material for your order <strong>"${item}"</strong> (ID: ${shortId}) has been purchased and is ready for the next step.</p>
      <p>We'll keep you updated as your garment comes to life.</p>
    `,
  },
  {
    day:     3,
    type:    'order_progress',
    title:   'Your Cloth is Cut! ✂️',
    message: '%NAME%, your cloth for "%ITEM%" (Order: %SHORT_ID%) is now cut and being prepared for tailoring. Great progress! ✂️',
    emailSubject: 'Update on your order — cloth cut',
    emailBody: (name, item, shortId) => `
      <h2>Your cloth has been cut! ✂️</h2>
      <p>Hi ${name},</p>
      <p>Your cloth for <strong>"${item}"</strong> (ID: ${shortId}) is now cut and ready for tailoring. We're making great progress!</p>
    `,
  },
  {
    day:     4,
    type:    'order_progress',
    title:   'Your Garment is Being Sewn! 🧵✨',
    message: 'Exciting update, %NAME%! Your garment for "%ITEM%" (Order: %SHORT_ID%) is being expertly sewn. Quality craftsmanship in action! 🧵✨',
    emailSubject: 'Update on your order — sewing in progress',
    emailBody: (name, item, shortId) => `
      <h2>Your garment is being sewn! 🧵✨</h2>
      <p>Hi ${name},</p>
      <p>Your custom garment <strong>"${item}"</strong> (ID: ${shortId}) is being expertly sewn by our tailors. Quality craftsmanship in action!</p>
    `,
  },
  {
    day:     5,
    type:    'order_progress',
    title:   'Freshly Dry-Cleaned! ✨',
    message: '%NAME%, your garment for "%ITEM%" (Order: %SHORT_ID%) has just been dry-cleaned and is looking its best! ✨',
    emailSubject: 'Update on your order — dry-cleaning done',
    emailBody: (name, item, shortId) => `
      <h2>Your garment has been dry-cleaned! ✨</h2>
      <p>Hi ${name},</p>
      <p>Your beautiful garment <strong>"${item}"</strong> (ID: ${shortId}) has been freshly dry-cleaned and is looking spectacular!</p>
    `,
  },
  {
    day:     6,
    type:    'delivery_imminent',
    title:   '🎉 Almost There! Delivery Tomorrow!',
    message: '🎉 %NAME%, your order "%ITEM%" (Order: %SHORT_ID%) is complete! Expect delivery tomorrow. 🚚',
    emailSubject: '🎉 Your order is ready — delivery tomorrow!',
    emailBody: (name, item, shortId) => `
      <h2>🎉 Your order is ready!</h2>
      <p>Hi ${name},</p>
      <p>Great news! Your custom order <strong>"${item}"</strong> (ID: ${shortId}) is complete and looking fabulous.</p>
      <p><strong>Expect delivery tomorrow! 🚚</strong></p>
      <p>Thank you for choosing us. We hope you love your garment!</p>
    `,
  },
];

// ── Fill in template placeholders ─────────────────────────────────────────────
function interpolate(template, name, item, shortId) {
  return template
    .replace(/%NAME%/g,     name)
    .replace(/%ITEM%/g,     item)
    .replace(/%SHORT_ID%/g, shortId);
}

/**
 * scheduleOrderNotifications
 *
 * Schedules all automated notifications for a single order.
 * Safe to call multiple times — registerJob cancels any existing job with
 * the same name before creating a new one.
 *
 * Call this:
 *   - After payment is verified (verifyOrderPayment controller)
 *   - On server startup for all active orders (rescheduleAllNotifications)
 */
export const scheduleOrderNotifications = async (order) => {
  if (!order || order.orderType !== 'Online' || order.paymentStatus !== 'paid') return;

  const orderId   = order._id.toString();
  const shortId   = orderId.substring(0, 8);
  const name      = order.customerName  || 'Customer';
  const item      = order.style?.title  || 'your custom garment';
  const email     = order.customerEmail;
  const createdAt = new Date(order.createdAt);

  // Use the stored expectedDeliveryDate if available, otherwise derive it.
  // We do NOT save back to the order here — that's the controller's job.
  const deliveryDate = order.expectedDeliveryDate
    ? new Date(order.expectedDeliveryDate)
    : (() => {
        const d = new Date(createdAt);
        d.setDate(d.getDate() + 7);
        return d;
      })();

  // ── Fetch user once ────────────────────────────────────────────────────────
  const user = order.user ? await User.findById(order.user).lean() : null;
  if (!user) {
    console.warn(`User not found for Order ${orderId}. Skipping user notifications.`);
    return;
  }

  // ── Admin reminder: 3 days before delivery ─────────────────────────────────
  const threeDaysBefore = new Date(deliveryDate);
  threeDaysBefore.setDate(deliveryDate.getDate() - 3);

  registerJob(`admin_3d_before_${orderId}`, threeDaysBefore, async () => {
    try {
      await sendEmail({
        to:      ADMIN_EMAIL,
        subject: `DELIVERY REMINDER: Order ${orderId} due in 3 days`,
        html: `
          <h2>Delivery Reminder</h2>
          <p>Order <strong>${orderId}</strong> for <strong>${name}</strong> is due in 3 days.</p>
          <p>Item: ${item}</p>
          <p>Expected delivery: ${deliveryDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        `,
      });
      console.log(`Admin notified: 3-day reminder for Order ${orderId}`);
    } catch (err) {
      console.error(`Admin 3-day reminder error for Order ${orderId}:`, err.message);
    }
  });

  // ── Admin reminder: 1 day before delivery ─────────────────────────────────
  const oneDayBefore = new Date(deliveryDate);
  oneDayBefore.setDate(deliveryDate.getDate() - 1);

  registerJob(`admin_1d_before_${orderId}`, oneDayBefore, async () => {
    try {
      await sendEmail({
        to:      ADMIN_EMAIL,
        subject: `URGENT: Order ${orderId} due TOMORROW`,
        html: `
          <h2>Urgent Delivery Reminder</h2>
          <p>Order <strong>${orderId}</strong> for <strong>${name}</strong> is due <strong>tomorrow</strong>.</p>
          <p>Item: ${item}</p>
          <p>Expected delivery: ${deliveryDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        `,
      });
      console.log(`Admin notified: 1-day reminder for Order ${orderId}`);
    } catch (err) {
      console.error(`Admin 1-day reminder error for Order ${orderId}:`, err.message);
    }
  });

  // ── Daily customer progress notifications ──────────────────────────────────
  for (const step of PROGRESS_STEPS) {
    const stepDate = new Date(createdAt);
    stepDate.setDate(createdAt.getDate() + step.day);

    const jobName = `user_day${step.day}_${orderId}`;

    registerJob(jobName, stepDate, async () => {
      // ── 1. In-app + real-time + Web Push (all via notifyUser) ────────────
      try {
        await notifyUser(null, user._id.toString(), {
          title:    step.title,
          message:  interpolate(step.message, name, item, shortId),
          type:     step.type,        // 'order_progress' or 'delivery_imminent'
          category: 'order',
          order:    order._id,
          url:      '/app',           // change to your orders page if you have one
        });
        console.log(`Notification sent (Day ${step.day}): "${step.title}" for Order ${orderId}`);
      } catch (err) {
        console.error(`Notification failed (Day ${step.day}) for Order ${orderId}:`, err.message);
      }

      // ── 2. Email notification ────────────────────────────────────────────
      // Runs independently — email failure does not affect the notification above
      try {
        await sendEmail({
          to:      email,
          subject: step.emailSubject,
          html:    step.emailBody(name, item, shortId),
        });
        console.log(`Email sent (Day ${step.day}): "${step.emailSubject}" to ${email} for Order ${orderId}`);
      } catch (err) {
        console.error(`Email failed (Day ${step.day}) for Order ${orderId}:`, err.message);
      }
    });
  }
};

/**
 * cancelOrderNotifications
 *
 * Cancels all pending scheduled jobs for an order.
 * Call this when an order is deleted or cancelled.
 */
export const cancelOrderNotifications = (orderId) => {
  const names = [
    `admin_3d_before_${orderId}`,
    `admin_1d_before_${orderId}`,
    ...PROGRESS_STEPS.map(s => `user_day${s.day}_${orderId}`),
  ];

  let cancelled = 0;
  for (const name of names) {
    const job = scheduledJobs.get(name);
    if (job) {
      job.cancel();
      scheduledJobs.delete(name);
      cancelled++;
    }
    // Also try via node-schedule directly in case it wasn't in our map
    const directJob = schedule.scheduledJobs[name];
    if (directJob) {
      directJob.cancel();
      cancelled++;
    }
  }
  if (cancelled > 0) {
    console.log(`Cancelled ${cancelled} scheduled job(s) for Order ${orderId}`);
  }
};

/**
 * rescheduleAllNotifications
 *
 * Called once on server startup to re-register all pending jobs.
 * node-schedule jobs don't persist across restarts — this re-creates them
 * from the database for any order that hasn't been delivered yet.
 */
export const rescheduleAllNotifications = async () => {
  try {
    const activeOrders = await Order.find({
      orderType:            'Online',
      paymentStatus:        'paid',
      status:               { $nin: ['completed', 'cancelled'] },
      expectedDeliveryDate: { $gte: new Date() },
    }).lean();

    for (const order of activeOrders) {
      await scheduleOrderNotifications(order);
    }

    console.log(`Notification rescheduling complete (${activeOrders.length} active orders).`);
  } catch (err) {
    console.error('Notification rescheduling error on startup:', err.message);
  }
};