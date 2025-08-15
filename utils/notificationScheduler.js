// src/utils/notificationScheduler.js
import schedule from 'node-schedule';
import Order from '../models/order.js'; // Assuming this path
import Notification from '../models/notification.js'; // Assuming this path
import User from '../models/user.js'; // Assuming this path and adding it
import { sendEmail } from './email.js'; // Assuming this path
import dotenv from 'dotenv';

dotenv.config();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

/**
 * Schedules all automated notifications for a given order.
 * This should be called once an order is successfully created and paid, and on server startup.
 * @param {Object} order - The Mongoose order document.
 */
export const scheduleOrderNotifications = async (order) => {
    // Only schedule for paid online orders
    if (!order || order.orderType !== 'Online' || order.paymentStatus !== 'paid') {
        return;
    }

    const orderId = order._id.toString();
    const customerEmail = order.customerEmail;
    const customerName = order.customerName || 'Customer';
    const itemName = order.style?.title || 'your custom garment';

    const createdAt = new Date(order.createdAt);
    const expectedDeliveryDate = new Date(createdAt);
    expectedDeliveryDate.setDate(createdAt.getDate() + 7); // 7 days after order creation

    // Check if expected delivery date is already set to avoid overwriting
    if (!order.expectedDeliveryDate) {
        order.expectedDeliveryDate = expectedDeliveryDate;
        await order.save();
    }

    console.log(`Scheduling notifications for Order ${orderId}. Expected delivery: ${expectedDeliveryDate.toLocaleDateString()}`);

    // --- Admin Notifications (Email) ---

    // 3 Days Before Delivery
    const threeDaysBefore = new Date(expectedDeliveryDate);
    threeDaysBefore.setDate(expectedDeliveryDate.getDate() - 3);
    if (threeDaysBefore > new Date()) {
        schedule.scheduleJob(`admin_3_days_before_${orderId}`, threeDaysBefore, async () => {
            console.log(`Executing admin 3-day reminder for Order ${orderId}`);
            try {
                await sendEmail({
                    to: ADMIN_EMAIL,
                    subject: `DELIVERY REMINDER: Order ${orderId} Due in 3 Days`,
                    html: `...`, // Content remains the same
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
    if (oneDayBefore > new Date()) {
        schedule.scheduleJob(`admin_1_day_before_${orderId}`, oneDayBefore, async () => {
            console.log(`Executing admin 1-day reminder for Order ${orderId}`);
            try {
                await sendEmail({
                    to: ADMIN_EMAIL,
                    subject: `URGENT DELIVERY: Order ${orderId} Due Tomorrow!`,
                    html: `...`, // Content remains the same
                });
                console.log(`Admin notified (1 day before) for Order ${orderId}`);
            } catch (error) {
                console.error(`Error sending admin 1-day delivery reminder for Order ${orderId}:`, error);
            }
        });
    }

    // --- User In-App Notifications (Daily Progress) ---
    // Fetch the user once to avoid repeated database calls
    const user = order.user ? await User.findById(order.user) : null;
    if (!user) {
        console.warn(`User not found or missing user ID for Order ${orderId}. Skipping user notifications.`);
        return; // Exit the function if no user is found for notifications
    }

    const progressSteps = [
        { day: 2, title: 'Your Material Is Ready! 🧵', message: 'Great news, %NAME%! Your material for order %ITEM% (ID: %ID%...) has been successfully purchased and is ready for the next step. 🧵' },
        { day: 3, title: 'Your Cloth is Cut! ✂️', message: '%NAME%, your cloth for order %ITEM% (ID: %ID%...) is now cut and being prepared for tailoring. We\'re making great progress! ✂️' },
        { day: 4, title: 'Your Garment is Being Sewn! 🧵✨', message: 'Exciting, %NAME%! Your custom garment for order %ITEM% (ID: %ID%...) is being expertly sewn. Quality craftsmanship in action! 🧵✨' },
        { day: 5, title: 'Freshly Dry-Cleaned! ✨', message: '%NAME%, your beautiful garment for order %ITEM% (ID: %ID%...) has just been dry-cleaned and is looking its best! ✨' },
        { day: 6, title: '🎉 Almost There! 🎉', message: '🎉 Woohoo, %NAME%! Your custom order %ITEM% (ID: %ID%...) is complete and looking fabulous! Expect delivery by tomorrow! 🚚', type: 'delivery_imminent' }
    ];

    for (const step of progressSteps) {
        const stepDate = new Date(createdAt);
        stepDate.setDate(createdAt.getDate() + step.day);

        if (stepDate > new Date()) {
            schedule.scheduleJob(`user_day${step.day}_${orderId}`, stepDate, async () => {
                try {
                    await Notification.create({
                        user: user._id,
                        order: order._id,
                        title: step.title,
                        message: step.message
                            .replace('%NAME%', customerName)
                            .replace('%ITEM%', itemName)
                            .replace('%ID%', orderId.substring(0, 8)),
                        type: step.type || 'order_progress',
                    });
                    console.log(`User notified (Day ${step.day}): ${step.title} for Order ${orderId}`);
                } catch (error) {
                    console.error(`Error sending user Day ${step.day} notification for Order ${orderId}:`, error);
                }
            });
        }
    }
};

// Function to cancel scheduled jobs for an order (e.g., if order is cancelled)
export const cancelOrderNotifications = (orderId) => {
    // ... This function remains the same ...
};

// New function to be called on server startup
export const rescheduleAllNotifications = async () => {
    try {
        console.log('Initializing notification scheduler...');
        const activeOrders = await Order.find({
            orderType: 'Online',
            paymentStatus: 'paid',
            // Assuming you add an isCompleted or isDelivered field to your Order model
            // For now, we'll assume orders with expectedDeliveryDate in the future are active
            expectedDeliveryDate: { $gte: new Date() }
        });

        console.log(`Found ${activeOrders.length} active orders to reschedule.`);
        for (const order of activeOrders) {
            await scheduleOrderNotifications(order);
        }
        console.log('Notification rescheduling complete.');
    } catch (error) {
        console.error('Error during notification rescheduling on startup:', error);
    }
};