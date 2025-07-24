// src/controllers/orderController.js
import Order from '../models/order.js';
import User from '../models/user.js';
import Notification from '../models/notification.js';
import cloudinary from '../utils/cloudinary.js';
import { sendEmail } from '../utils/email.js';
import { scheduleOrderNotifications, cancelOrderNotifications } from '../utils/notificationScheduler.js'; // NEW IMPORT
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL; // Ensure this is set in your .env

// Helper to format order for frontend display (especially for admin view)
const formatOrderForAdminFrontend = (order) => {
    return {
        _id: order._id,
        user: order.user ? { _id: order.user._id, name: order.user.name, email: order.user.email } : null,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        orderType: order.orderType,
        status: order.status,
        paymentStatus: order.paymentStatus,
        totalPrice: order.totalPrice,
        date: order.createdAt.toISOString().split('T')[0],
        notes: order.notes,
        style: order.style,
        material: order.material,
        measurements: order.measurements,
        paymentReference: order.paymentReference,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        expectedDeliveryDate: order.expectedDeliveryDate, // NEW
    };
};

export const createOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            style,
            material,
            measurements,
            notes,
            orderType = 'Online', // Default to 'Online' if not provided
        } = req.body;

        if (!style || !material) {
            return res.status(400).json({ message: 'Style and material data are required.' });
        }

        const cleanStyle = {
            title: style.title,
            price: typeof style.price === 'number' ? style.price : (parseFloat(style.price) || 0),
            yardsRequired: typeof style.yardsRequired === 'number' ? style.yardsRequired : (parseFloat(style.yardsRequired) || 0),
            recommendedMaterials: style.recommendedMaterials || [],
            image: style.image
        };

        const cleanMaterial = {
            name: material.name,
            type: material.type,
            pricePerYard: typeof material.pricePerYard === 'number' ? material.pricePerYard : (parseFloat(material.pricePerYard) || 0),
            image: material.image
        };

        if (!cleanStyle.title || !cleanStyle.image || !cleanMaterial.name || !cleanMaterial.image) {
            return res.status(400).json({ message: 'Style title, style image, material name, and material image are required.' });
        }

        let styleImageUrl = cleanStyle.image;
        if (cleanStyle.image && typeof cleanStyle.image === 'string' && cleanStyle.image.startsWith('data:image')) {
            try {
                const uploadedStyle = await cloudinary.uploader.upload(cleanStyle.image, {
                    folder: 'orders/styles',
                });
                styleImageUrl = uploadedStyle.secure_url;
            } catch (uploadError) {
                return res.status(500).json({ message: "Failed to upload style image." });
            }
        } else if (!cleanStyle.image) {
            return res.status(400).json({ message: 'Style image is required.' });
        }

        let materialImageUrl = cleanMaterial.image;
        if (cleanMaterial.image && typeof cleanMaterial.image === 'string' && cleanMaterial.image.startsWith('data:image')) {
            try {
                const uploadedMaterial = await cloudinary.uploader.upload(cleanMaterial.image, {
                    folder: 'orders/materials',
                });
                materialImageUrl = uploadedMaterial.secure_url;
            } catch (uploadError) {
                return res.status(500).json({ message: "Failed to upload material image." });
            }
        } else if (!cleanMaterial.image) {
            return res.status(400).json({ message: 'Material image is required.' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const cleanedMeasurements = typeof measurements === 'string' ? measurements.trim() : '';
        const calculatedTotalPrice = cleanStyle.price + (cleanMaterial.pricePerYard * cleanStyle.yardsRequired);

        const newOrder = new Order({
            user: userId,
            customerName: user.name,
            customerEmail: user.email,
            orderType: orderType,
            style: {
                ...cleanStyle,
                image: styleImageUrl
            },
            material: {
                ...cleanMaterial,
                image: materialImageUrl
            },
            measurements: cleanedMeasurements,
            notes: notes || '',
            status: 'pending', // Default status for new orders
            paymentStatus: 'unpaid', // Default payment status
            totalPrice: calculatedTotalPrice,
            // expectedDeliveryDate will be set in scheduleOrderNotifications if order is paid
        });

        await newOrder.save();

        // Initial notification to user about order creation and pending payment
        await Notification.create({
            user: userId,
            order: newOrder._id, // Link notification to order
            title: 'Order Created, Payment Pending',
            message: `Your order for ${newOrder.style.title} has been created, but payment is pending. Please complete payment from your order history.`,
            type: 'order_status', // Add a type for better filtering
        });

        // Email admin about new order (even if unpaid, they should know)
        try {
            await sendEmail({
                to: ADMIN_EMAIL,
                subject: `NEW ORDER Created: ${newOrder._id} (Payment Pending)`,
                html: `
                    <h2>New Order Created!</h2>
                    <p>Order ID: <strong>${newOrder._id}</strong></p>
                    <p>Customer: ${newOrder.customerName} (${newOrder.customerEmail})</p>
                    <p>Item: ${newOrder.style.title}</p>
                    <p>Total: ₦${newOrder.totalPrice.toLocaleString()}</p>
                    <p>Payment Status: <strong>UNPAID</strong></p>
                    <p>Notes: ${newOrder.notes || 'None'}</p>
                    <p>Please monitor payment for this order.</p>
                `,
            });
        } catch (emailError) {
            console.error('Error sending admin email for new unpaid order:', emailError);
        }

        res.status(201).json({
            message: 'Order created. Payment is pending. Please pay from your order history.',
            order: newOrder
        });

    } catch (err) {
        console.error('Order creation error caught in controller:', err);
        if (err.name === 'ValidationError') {
            const errors = Object.values(err.errors).map(error => error.message);
            return res.status(400).json({
                message: 'Validation failed',
                errors
            });
        }
        res.status(500).json({ message: 'Failed to create order' });
    }
};

export const payForOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;
        const { reference } = req.body;

        if (!reference) {
            return res.status(400).json({ message: 'Paystack transaction reference is required.' });
        }

        const order = await Order.findOne({ _id: orderId, user: userId });

        if (!order) {
            return res.status(404).json({ message: 'Order not found or you do not have access to it.' });
        }

        if (order.paymentStatus === 'paid') {
            return res.status(400).json({ message: 'This order has already been paid.' });
        }

        let paymentSuccessful = false;
        let paymentGatewayResponse = null;

        try {
            const paystackResponse = await axios.get(
                `https://api.paystack.co/transaction/verify/${reference}`, {
                    headers: {
                        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                    },
                }
            );

            paymentGatewayResponse = paystackResponse.data;

            if (paymentGatewayResponse.status && paymentGatewayResponse.data.status === 'success') {
                const amountPaid = paymentGatewayResponse.data.amount / 100;
                if (amountPaid === order.totalPrice) {
                    paymentSuccessful = true;
                } else {
                    console.warn(`Amount mismatch for order ${orderId}. Expected ${order.totalPrice}, paid ${amountPaid}`);
                    paymentSuccessful = false;
                    paymentGatewayResponse.message = 'Payment successful, but amount mismatch. Contact support.';
                }
            } else {
                paymentSuccessful = false;
            }

        } catch (paymentError) {
            console.error('Error verifying Paystack transaction:', paymentError.response ? paymentError.response.data : paymentError.message);
            paymentSuccessful = false;
            paymentGatewayResponse = paymentError.response ? paymentError.response.data : { message: 'Failed to verify payment with Paystack.' };
        }

        if (paymentSuccessful) {
            order.paymentStatus = 'paid';
            order.paymentReference = reference;
            order.paymentMethod = 'Paystack';
            order.paymentDetails = paymentGatewayResponse.data;
            order.status = 'in-progress'; // Set status to in-progress once paid

            await order.save();

            const user = await User.findById(userId);

            await Notification.create({
                user: userId,
                order: order._id, // Link notification to order
                title: 'Payment Successful!',
                message: `Your payment for order ${order.style.title} was successful. Your order is now being processed.`,
                type: 'payment_success',
            });

            // --- NEW: Schedule notifications only after successful payment ---
            if (order.orderType === 'Online') { // Ensure it's an online order for these notifications
                await scheduleOrderNotifications(order);
            }

            if (user) {
                try {
                    await sendEmail({
                        to: user.email,
                        subject: 'Payment Successful! Your Order is Confirmed',
                        html: `
                            <h2>Payment Successful!</h2>
                            <p>Dear ${user.name},</p>
                            <p>Great news! Your payment for order <strong>${order.style.title}</strong> (Order ID: ${order._id}) of ₦${order.totalPrice.toLocaleString()} has been successfully received via Paystack.</p>
                            <p>Your order is now confirmed and will be processed shortly. We've set your expected delivery date to <strong>${order.expectedDeliveryDate.toLocaleDateString()}</strong>.</p>
                            <p>Thank you for your business!</p>
                            <p>Transaction Reference: ${reference}</p>
                        `,
                    });
                } catch (emailError) {
                    console.error('Error sending payment success email to user:', emailError);
                }
            }

            try {
                await sendEmail({
                    to: ADMIN_EMAIL,
                    subject: `Order NOW PAID: ${order._id}`,
                    html: `
                        <h2>New Order NOW PAID!</h2>
                        <p>Order ID: ${order._id}</p>
                        <p>Customer: ${order.customerName} (${order.customerEmail})</p>
                        <p>Item: ${order.style.title}</p>
                        <p>Total: ₦${order.totalPrice.toLocaleString()}</p>
                        <p>Payment Status: PAID</p>
                        <p>Payment Method: Paystack</p>
                        <p>Payment Reference: ${reference}</p>
                        <p>This order was previously unpaid/failed and has now been successfully paid by the user.</p>
                        <p>Expected Delivery Date: <strong>${order.expectedDeliveryDate.toLocaleDateString()}</strong></p>
                    `,
                });
            } catch (emailError) {
                console.error('Error sending admin email for newly paid order:', emailError);
            }

            res.status(200).json({ message: 'Payment successful, order updated.', order });

        } else {
            order.paymentStatus = 'failed';
            order.paymentDetails = paymentGatewayResponse;
            order.paymentReference = null;
            await order.save();

            await Notification.create({
                user: userId,
                order: order._id, // Link notification to order
                title: 'Payment Failed',
                message: `Payment for your order ${order.style.title} failed. Please try again.`,
                type: 'payment_failed',
            });

            return res.status(402).json({ message: `Payment failed: ${paymentGatewayResponse.message || 'Verification failed.'}`, error: paymentGatewayResponse });
        }

    } catch (err) {
        console.error('Error in payForOrder:', err);
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid order ID format.' });
        }
        res.status(500).json({ message: 'Failed to process payment for order.' });
    }
};

// --- User-specific Order Functions ---

export const getUserOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        // Populate user for potential future use in the formatOrderForAdminFrontend helper
        // or if you want to expand what's returned to the user.
        const orders = await Order.find({ user: userId }).sort({ createdAt: -1 });
        res.status(200).json({
            message: 'User orders retrieved successfully',
            orders
        });
    } catch (err) {
        console.error('Error fetching user orders:', err);
        res.status(500).json({ message: 'Failed to fetch user orders' });
    }
};

export const getOrderById = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        const order = await Order.findOne({ _id: orderId, user: userId })
            .populate('user', 'name email');

        if (!order) {
            return res.status(404).json({ message: 'Order not found or you do not have access to it.' });
        }

        res.status(200).json({
            message: 'Order retrieved successfully',
            order
        });

    } catch (err) {
        console.error('Error fetching single order:', err);
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid order ID format.' });
        }
        res.status(500).json({ message: 'Failed to fetch order' });
    }
};

export const updateOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;
        const updates = req.body;

        const order = await Order.findOneAndUpdate(
            { _id: orderId, user: userId },
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!order) {
            return res.status(404).json({ message: 'Order not found or you do not have access to it.' });
        }

        res.status(200).json({
            message: 'Order updated successfully',
            order
        });

    } catch (err) {
        console.error('Error updating order:', err);
        if (err.name === 'ValidationError') {
            const errors = Object.values(err.errors).map(error => error.message);
            return res.status(400).json({
                message: 'Validation failed',
                errors
            });
        }
        res.status(500).json({ message: 'Failed to update order' });
    }
};

export const deleteOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        const order = await Order.findOneAndUpdate(
            { _id: orderId, user: userId },
            { $set: { status: 'cancelled', deletedAt: new Date() } },
            { new: true }
        );

        if (!order) {
            return res.status(404).json({ message: 'Order not found or you do not have access to it.' });
        }

        // --- NEW: Cancel pending notifications if order is cancelled ---
        cancelOrderNotifications(orderId);

        // Send notification to user
        await Notification.create({
            user: userId,
            order: order._id, // Link notification to order
            title: 'Order Cancelled',
            message: `Your order ${order.style.title} (ID: ${order._id.substring(0, 8)}...) has been cancelled.`,
            type: 'order_status',
        });

        res.status(200).json({ message: 'Order cancelled successfully', order });

    } catch (err) {
        console.error('Error deleting/cancelling order:', err);
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid order ID format.' });
        }
        res.status(500).json({ message: 'Failed to cancel order' });
    }
};

// --- Admin-specific Order Functions ---

export const getAdminOrders = async (req, res) => {
    try {
        const orders = await Order.find().populate('user', 'name email').sort({ createdAt: -1 });
        const formattedOrders = orders.map(formatOrderForAdminFrontend);
        res.status(200).json({
            message: 'All orders retrieved successfully for admin',
            orders: formattedOrders
        });
    } catch (err) {
        console.error('Error fetching admin orders:', err);
        res.status(500).json({ message: 'Failed to fetch all orders' });
    }
};

export const getAdminOrderById = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findById(id).populate('user', 'name email');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.status(200).json({
            message: 'Order retrieved successfully for admin',
            order: formatOrderForAdminFrontend(order)
        });
    } catch (err) {
        console.error('Error fetching admin single order:', err);
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid order ID format.' });
        }
        res.status(500).json({ message: 'Failed to fetch order' });
    }
};

export const updateOrderAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const order = await Order.findById(id).populate('user', 'name email');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Capture original status for comparison
        const originalStatus = order.status;
        const originalPaymentStatus = order.paymentStatus;

        // Apply updates
        Object.keys(updates).forEach(key => {
            order[key] = updates[key];
        });

        await order.save();

        // Send notification to user if status or paymentStatus changes
        if (updates.status && originalStatus !== updates.status) { // Check if status actually changed
            await Notification.create({
                user: order.user._id,
                order: order._id, // Link notification to order
                title: `Order Status Updated: ${updates.status.toUpperCase()}`,
                message: `Your order for ${order.style?.title || 'your item'} (ID: ${order._id.substring(0, 8)}...) has been updated to '${updates.status}'.`,
                type: 'order_status',
            });
            // If the status is 'completed' and payment is paid, notify user of completion
            if (updates.status === 'completed' && order.paymentStatus === 'paid' && order.user?.email) {
                await sendEmail({
                    to: order.user.email,
                    subject: 'Your Order Has Been Completed!',
                    html: `
                        <h2>Order Completed!</h2>
                        <p>Dear ${order.user.name},</p>
                        <p>Great news! Your order <strong>${order.style?.title || 'your item'}</strong> (Order ID: ${order._id}) has been completed and is ready for collection/delivery.</p>
                        <p>Thank you for your business!</p>
                    `,
                });
            }
        }

        if (updates.paymentStatus && originalPaymentStatus !== updates.paymentStatus) { // Check if paymentStatus actually changed
            await Notification.create({
                user: order.user._id,
                order: order._id, // Link notification to order
                title: `Payment Status Updated: ${updates.paymentStatus.toUpperCase()}`,
                message: `The payment status for your order ${order.style?.title || 'your item'} (ID: ${order._id.substring(0, 8)}...) has been updated to '${updates.paymentStatus}'.`,
                type: 'payment_status_update',
            });
            if (updates.paymentStatus === 'paid' && order.user?.email) {
                await sendEmail({
                    to: order.user.email,
                    subject: 'Your Order Payment Has Been Marked As Paid!',
                    html: `
                        <h2>Payment Confirmed!</h2>
                        <p>Dear ${order.user.name},</p>
                        <p>Your payment for order <strong>${order.style?.title || 'your item'}</strong> (Order ID: ${order._id}) has now been confirmed and marked as PAID by our team.</p>
                        <p>Your order will now proceed with processing.</p>
                        <p>Thank you for your business!</p>
                    `,
                });

                // If admin marks as paid, and it's an online order, schedule notifications
                if (order.orderType === 'Online' && originalPaymentStatus !== 'paid') {
                     await scheduleOrderNotifications(order);
                }
            } else if (updates.paymentStatus !== 'paid' && originalPaymentStatus === 'paid') {
                // If payment status changes from paid to something else (e.g., refunded, failed)
                // You might want to cancel active schedules
                cancelOrderNotifications(order._id.toString());
            }
        }

        res.status(200).json({
            message: 'Order updated successfully by admin',
            order: formatOrderForAdminFrontend(order)
        });

    } catch (err) {
        console.error('Error updating order by admin:', err);
        if (err.name === 'ValidationError') {
            const errors = Object.values(err.errors).map(error => error.message);
            return res.status(400).json({
                message: 'Validation failed',
                errors
            });
        }
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid order ID format.' });
        }
        res.status(500).json({ message: 'Failed to update order' });
    }
};

export const deleteOrderAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findByIdAndDelete(id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // --- NEW: Cancel pending notifications if order is permanently deleted by admin ---
        cancelOrderNotifications(id);

        // You might want to notify the user if their order was deleted by admin
        if (order.user) {
            await Notification.create({
                user: order.user,
                order: order._id, // Link notification to order
                title: 'Order Permanently Deleted',
                message: `Your order ${order.style?.title || 'your item'} (ID: ${order._id.substring(0, 8)}...) has been permanently deleted by an administrator. Please contact support for more details.`,
                type: 'order_status',
            });
        }

        res.status(200).json({ message: 'Order permanently deleted by admin' });

    } catch (err) {
        console.error('Error deleting order by admin:', err);
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid order ID format.' });
        }
        res.status(500).json({ message: 'Failed to delete order' });
    }
};