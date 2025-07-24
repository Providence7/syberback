// src/utils/notificationScheduler.js
import schedule from 'node-schedule';
import Order from '../models/order.js'; // Assuming this path
import Notification from '../models/notification.js'; // Assuming this path
import { sendEmail } from './email.js'; // Assuming this path
import dotenv from 'dotenv';

dotenv.config();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

/**
 * Schedules all automated notifications for a given order.
 * This should be called once an order is successfully created and paid.
 * @param {Object} order - The Mongoose order document.
 */
export const scheduleOrderNotifications = async (order) => {
    if (!order || order.orderType !== 'Online' || order.paymentStatus !== 'paid') {
        // Only schedule for paid online orders
        return;
    }

    const orderId = order._id.toString();
    const customerEmail = order.customerEmail;
    const customerName = order.customerName || 'Customer';
    const itemName = order.style?.title || 'your custom garment';

    const createdAt = new Date(order.createdAt);
    const expectedDeliveryDate = new Date(createdAt);
    expectedDeliveryDate.setDate(createdAt.getDate() + 7); // 7 days after order creation

    // Save the expected delivery date to the order
    order.expectedDeliveryDate = expectedDeliveryDate;
    await order.save();


    console.log(`Scheduling notifications for Order ${orderId}. Expected delivery: ${expectedDeliveryDate.toLocaleDateString()}`);

    // --- Admin Notifications ---

    // 3 Days Before Delivery
    const threeDaysBefore = new Date(expectedDeliveryDate);
    threeDaysBefore.setDate(expectedDeliveryDate.getDate() - 3);
    if (threeDaysBefore > new Date()) { // Only schedule if in the future
        schedule.scheduleJob(`admin_3_days_before_${orderId}`, threeDaysBefore, async () => {
            console.log(`Executing admin 3-day reminder for Order ${orderId}`);
            try {
                await sendEmail({
                    to: ADMIN_EMAIL,
                    subject: `DELIVERY REMINDER: Order ${orderId} Due in 3 Days`,
                    html: `
                        <h2>Delivery Reminder!</h2>
                        <p>Order ID: <strong>${orderId}</strong> for <strong>${customerName} (${customerEmail})</strong> is due for delivery in approximately 3 days.</p>
                        <p>Item: ${itemName}</p>
                        <p>Please ensure all final preparations are underway.</p>
                    `,
                });
                console.log(`Admin notified (3 days before) for Order ${orderId}`);
            } catch (error) {
                console.error(`Error sending admin 3-day delivery reminder for Order ${orderId}:`, error);
            }
        });
    }

    // 1 Day Before Delivery
    const oneDayBefore = new Date(expectedDeliveryDate);
    oneDayBefore.setDate(expectedDeliveryDate.getDate() - 1);
    if (oneDayBefore > new Date()) { // Only schedule if in the future
        schedule.scheduleJob(`admin_1_day_before_${orderId}`, oneDayBefore, async () => {
            console.log(`Executing admin 1-day reminder for Order ${orderId}`);
            try {
                await sendEmail({
                    to: ADMIN_EMAIL,
                    subject: `URGENT DELIVERY: Order ${orderId} Due Tomorrow!`,
                    html: `
                        <h2>URGENT: Order Delivery Tomorrow!</h2>
                        <p>Order ID: <strong>${orderId}</strong> for <strong>${customerName} (${customerEmail})</strong> is scheduled for delivery tomorrow!</p>
                        <p>Item: ${itemName}</p>
                        <p>Final checks and arrangements for dispatch should be completed.</p>
                    `,
                });
                console.log(`Admin notified (1 day before) for Order ${orderId}`);
            } catch (error) {
                console.error(`Error sending admin 1-day delivery reminder for Order ${orderId}:`, error);
            }
        });
    }

    // --- User In-App Notifications (Daily Progress) ---
    const user = await User.findById(order.user); // Fetch user for userId to use with Notification model

    // Day 2: Material Bought
    const day2 = new Date(createdAt); day2.setDate(createdAt.getDate() + 2);
    if (day2 > new Date()) {
        schedule.scheduleJob(`user_day2_${orderId}`, day2, async () => {
            if (user) {
                await Notification.create({
                    user: user._id,
                    order: order._id,
                    title: 'Your Material Is Ready! 🧵',
                    message: `Great news, ${customerName}! Your material for order ${itemName} (ID: ${orderId.substring(0, 8)}...) has been successfully purchased and is ready for the next step. 🧵`,
                    type: 'order_progress',
                });
                console.log(`User notified (Day 2): Material bought for Order ${orderId}`);
            }
        });
    }

    // Day 3: Cloth Cut
    const day3 = new Date(createdAt); day3.setDate(createdAt.getDate() + 3);
    if (day3 > new Date()) {
        schedule.scheduleJob(`user_day3_${orderId}`, day3, async () => {
            if (user) {
                await Notification.create({
                    user: user._id,
                    order: order._id,
                    title: 'Your Cloth is Cut! ✂️',
                    message: `${customerName}, your cloth for order ${itemName} (ID: ${orderId.substring(0, 8)}...) is now cut and being prepared for tailoring. We're making great progress! ✂️`,
                    type: 'order_progress',
                });
                console.log(`User notified (Day 3): Cloth cut for Order ${orderId}`);
            }
        });
    }

    // Day 4: Sewn
    const day4 = new Date(createdAt); day4.setDate(createdAt.getDate() + 4);
    if (day4 > new Date()) {
        schedule.scheduleJob(`user_day4_${orderId}`, day4, async () => {
            if (user) {
                await Notification.create({
                    user: user._id,
                    order: order._id,
                    title: 'Your Garment is Being Sewn! 🧵✨',
                    message: `Exciting, ${customerName}! Your custom garment for order ${itemName} (ID: ${orderId.substring(0, 8)}...) is being expertly sewn. Quality craftsmanship in action! 🧵✨`,
                    type: 'order_progress',
                });
                console.log(`User notified (Day 4): Sewn for Order ${orderId}`);
            }
        });
    }

    // Day 5: Dry Cleaned
    const day5 = new Date(createdAt); day5.setDate(createdAt.getDate() + 5);
    if (day5 > new Date()) {
        schedule.scheduleJob(`user_day5_${orderId}`, day5, async () => {
            if (user) {
                await Notification.create({
                    user: user._id,
                    order: order._id,
                    title: 'Freshly Dry-Cleaned! ✨',
                    message: `${customerName}, your beautiful garment for order ${itemName} (ID: ${orderId.substring(0, 8)}...) has just been dry-cleaned and is looking its best! ✨`,
                    type: 'order_progress',
                });
                console.log(`User notified (Day 5): Dry cleaned for Order ${orderId}`);
            }
        });
    }

    // Day 6: Celebration & Expect Delivery Tomorrow
    const day6 = new Date(createdAt); day6.setDate(createdAt.getDate() + 6);
    if (day6 > new Date()) {
        schedule.scheduleJob(`user_day6_${orderId}`, day6, async () => {
            if (user) {
                await Notification.create({
                    user: user._id,
                    order: order._id,
                    title: '🎉 Almost There! 🎉',
                    message: `🎉 Woohoo, ${customerName}! Your custom order ${itemName} (ID: ${orderId.substring(0, 8)}...) is complete and looking fabulous! Expect delivery by tomorrow! 🚚`,
                    type: 'delivery_imminent',
                });
                console.log(`User notified (Day 6): Expect delivery tomorrow for Order ${orderId}`);
            }
        });
    }
};

// Function to cancel scheduled jobs for an order (e.g., if order is cancelled)
export const cancelOrderNotifications = (orderId) => {
    // Cancel admin jobs
    schedule.cancelJob(`admin_3_days_before_${orderId}`);
    schedule.cancelJob(`admin_1_day_before_${orderId}`);
    // Cancel user jobs
    schedule.cancelJob(`user_day2_${orderId}`);
    schedule.cancelJob(`user_day3_${orderId}`);
    schedule.cancelJob(`user_day4_${orderId}`);
    schedule.cancelJob(`user_day5_${orderId}`);
    schedule.cancelJob(`user_day6_${orderId}`);
    console.log(`Cancelled all scheduled notifications for Order ${orderId}`);
};

// Optional: Re-schedule existing jobs on server restart (advanced, requires storing job states)
// For simpler setups, you might just rely on new orders scheduling jobs.