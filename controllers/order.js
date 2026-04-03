// src/controllers/orderController.js
import Order from '../models/order.js';
import User from '../models/user.js';
import Notification from '../models/notification.js';
import cloudinary from '../utils/cloudinary.js';
import { sendEmail } from '../utils/email.js';
import { scheduleOrderNotifications, cancelOrderNotifications } from '../utils/notificationScheduler.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

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
        expectedDeliveryDate: order.expectedDeliveryDate,
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
            orderType = 'Online',
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
                const uploadedStyle = await cloudinary.uploader.upload(cleanStyle.image, { folder: 'orders/styles' });
                styleImageUrl = uploadedStyle.secure_url;
            } catch (uploadError) {
                return res.status(500).json({ message: "Failed to upload style image." });
            }
        }

        let materialImageUrl = cleanMaterial.image;
        if (cleanMaterial.image && typeof cleanMaterial.image === 'string' && cleanMaterial.image.startsWith('data:image')) {
            try {
                const uploadedMaterial = await cloudinary.uploader.upload(cleanMaterial.image, { folder: 'orders/materials' });
                materialImageUrl = uploadedMaterial.secure_url;
            } catch (uploadError) {
                return res.status(500).json({ message: "Failed to upload material image." });
            }
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const calculatedTotalPrice = cleanStyle.price + (cleanMaterial.pricePerYard * cleanStyle.yardsRequired);

        const newOrder = new Order({
            user: userId,
            customerName: user.name,
            customerEmail: user.email,
            orderType: orderType,
            style: { ...cleanStyle, image: styleImageUrl },
            material: { ...cleanMaterial, image: materialImageUrl },
            measurements: measurements,
            notes: notes || '',
            status: 'pending',
            paymentStatus: 'unpaid',
            totalPrice: calculatedTotalPrice,
        });

        await newOrder.save();

        await Notification.create({
            user: userId,
            order: newOrder._id,
            title: 'Order Created, Payment Pending',
            message: `Your order for ${newOrder.style.title} has been created, but payment is pending. Please complete payment from your order history.`,
            type: 'order_status',
        });

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
            console.error('Error sending admin email:', emailError);
        }

        res.status(201).json({
            message: 'Order created. Payment is pending. Please pay from your order history.',
            order: newOrder
        });

    } catch (err) {
        console.error('Order creation error caught in controller:', err);
        if (err.name === 'ValidationError') {
            const errors = Object.values(err.errors).map(error => error.message);
            return res.status(400).json({ message: 'Validation failed', errors });
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
                `https://api.paystack.co/transaction/verify/${reference}`,
                { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
            );

            paymentGatewayResponse = paystackResponse.data;

            if (paymentGatewayResponse.status && paymentGatewayResponse.data.status === 'success') {
                const amountPaid = paymentGatewayResponse.data.amount / 100;
                if (amountPaid === order.totalPrice) {
                    paymentSuccessful = true;
                } else {
                    console.warn(`Amount mismatch for order ${orderId}. Expected ${order.totalPrice}, paid ${amountPaid}`);
                    paymentGatewayResponse.message = 'Payment successful, but amount mismatch. Contact support.';
                }
            }
        } catch (paymentError) {
            console.error('Error verifying Paystack transaction:', paymentError.response?.data || paymentError.message);
            paymentGatewayResponse = paymentError.response?.data || { message: 'Failed to verify payment with Paystack.' };
        }

        if (paymentSuccessful) {
            order.paymentStatus = 'paid';
            order.paymentReference = reference;
            order.paymentMethod = 'Paystack';
            order.paymentDetails = paymentGatewayResponse.data;
            order.status = 'in-progress';
            await order.save();

            const user = await User.findById(userId);

            await Notification.create({
                user: userId,
                order: order._id,
                title: 'Payment Successful!',
                message: `Your payment for order ${order.style.title} was successful. Your order is now being processed.`,
                type: 'payment_success',
            });

            if (order.orderType === 'Online') {
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
                            <p>Your payment for order <strong>${order.style.title}</strong> (Order ID: ${order._id}) of ₦${order.totalPrice.toLocaleString()} has been received.</p>
                            <p>Expected delivery date: <strong>${order.expectedDeliveryDate ? order.expectedDeliveryDate.toLocaleDateString() : 'To be determined'}</strong>.</p>
                            <p>Transaction Reference: ${reference}</p>
                        `,
                    });
                } catch (emailError) {
                    console.error('Error sending success email:', emailError);
                }
            }

            try {
                await sendEmail({
                    to: ADMIN_EMAIL,
                    subject: `Order NOW PAID: ${order._id}`,
                    html: `
                        <h2>Order NOW PAID!</h2>
                        <p>Order ID: ${order._id}</p>
                        <p>Customer: ${order.customerName} (${order.customerEmail})</p>
                        <p>Item: ${order.style.title}</p>
                        <p>Total: ₦${order.totalPrice.toLocaleString()}</p>
                        <p>Payment Reference: ${reference}</p>
                    `,
                });
            } catch (emailError) {
                console.error('Error sending admin paid email:', emailError);
            }

            res.status(200).json({ message: 'Payment successful, order updated.', order });

        } else {
            order.paymentStatus = 'failed';
            order.paymentDetails = paymentGatewayResponse;
            order.paymentReference = null;
            await order.save();

            await Notification.create({
                user: userId,
                order: order._id,
                title: 'Payment Failed',
                message: `Payment for your order ${order.style.title} failed. Please try again.`,
                type: 'payment_failed',
            });

            return res.status(402).json({
                message: `Payment failed: ${paymentGatewayResponse?.message || 'Verification failed.'}`,
                error: paymentGatewayResponse
            });
        }

    } catch (err) {
        console.error('Error in payForOrder:', err);
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid order ID format.' });
        }
        res.status(500).json({ message: 'Failed to process payment for order.' });
    }
};

export const getUserOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const orders = await Order.find({ user: userId }).sort({ createdAt: -1 });
        res.status(200).json({ message: 'User orders retrieved successfully', orders });
    } catch (err) {
        console.error('Error fetching user orders:', err);
        res.status(500).json({ message: 'Failed to fetch user orders' });
    }
};

export const getOrderById = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        const order = await Order.findOne({ _id: orderId, user: userId }).populate('user', 'name email');

        if (!order) {
            return res.status(404).json({ message: 'Order not found or you do not have access to it.' });
        }

        res.status(200).json({ message: 'Order retrieved successfully', order });

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

        // Fetch the existing order first so we can return it alongside the updated version
        const existingOrder = await Order.findOne({ _id: orderId, user: userId });

        if (!existingOrder) {
            return res.status(404).json({ message: 'Order not found or access denied.' });
        }

        // Log existing state to the server terminal before applying changes
        console.log(`[updateOrder] Order ${orderId} BEFORE update:`, JSON.stringify({
            style: existingOrder.style,
            material: existingOrder.material,
            measurements: existingOrder.measurements,
            notes: existingOrder.notes,
            status: existingOrder.status,
            paymentStatus: existingOrder.paymentStatus,
        }, null, 2));

        // Only allow fields the user is permitted to change.
        // Status and paymentStatus are intentionally excluded — those are
        // controlled by the payment flow and admin actions only.
        const { style, material, measurements, notes, paymentChannel } = req.body;
        const allowedUpdates = {};

        if (notes !== undefined) allowedUpdates.notes = notes;
        if (paymentChannel !== undefined) allowedUpdates.paymentChannel = paymentChannel;
        if (measurements !== undefined) allowedUpdates.measurements = measurements;

        // FIX: flatten nested objects into dot-notation keys so $set patches
        // individual subdocument fields instead of replacing the whole object.
        // Without this, sending { style: { title: 'X' } } would wipe out
        // style.image, style.price, etc. entirely.
        if (style && typeof style === 'object') {
            for (const [key, value] of Object.entries(style)) {
                allowedUpdates[`style.${key}`] = value;
            }
        }

        if (material && typeof material === 'object') {
            for (const [key, value] of Object.entries(material)) {
                allowedUpdates[`material.${key}`] = value;
            }
        }

        const updatedOrder = await Order.findByIdAndUpdate(
            orderId,
            { $set: allowedUpdates },
            { new: true, runValidators: true }
        );

        console.log(`[updateOrder] Order ${orderId} AFTER update:`, JSON.stringify({
            style: updatedOrder.style,
            material: updatedOrder.material,
            measurements: updatedOrder.measurements,
            notes: updatedOrder.notes,
        }, null, 2));

        res.status(200).json({
            message: 'Order updated successfully',
            // Return the previous state so the frontend can show a before/after diff
            previousData: {
                style: existingOrder.style,
                material: existingOrder.material,
                measurements: existingOrder.measurements,
                notes: existingOrder.notes,
                totalPrice: existingOrder.totalPrice,
            },
            order: updatedOrder,
        });

    } catch (err) {
        console.error('Update Error:', err.message);
        if (err.name === 'ValidationError') {
            const errors = Object.values(err.errors).map(e => e.message);
            return res.status(400).json({ message: 'Validation failed', errors });
        }
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid order ID format.' });
        }
        res.status(400).json({ message: 'Update failed', reason: err.message });
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

        cancelOrderNotifications(orderId);

        await Notification.create({
            user: userId,
            order: order._id,
            title: 'Order Cancelled',
            message: `Your order ${order.style.title} has been cancelled.`,
            type: 'order_status',
        });

        res.status(200).json({ message: 'Order cancelled successfully', order });

    } catch (err) {
        console.error('Error deleting order:', err);
        res.status(500).json({ message: 'Failed to cancel order' });
    }
};

export const getAdminOrders = async (req, res) => {
    try {
        const orders = await Order.find().populate('user', 'name email').sort({ createdAt: -1 });
        const formattedOrders = orders.map(formatOrderForAdminFrontend);
        res.status(200).json({ message: 'All orders retrieved successfully for admin', orders: formattedOrders });
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
        res.status(500).json({ message: 'Failed to fetch order' });
    }
};

export const updateOrderAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const existingOrder = await Order.findById(id);
        if (!existingOrder) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const originalStatus = existingOrder.status;
        const originalPaymentStatus = existingOrder.paymentStatus;

        const flatUpdates = {};
        for (const [key, value] of Object.entries(updates)) {
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                for (const [subKey, subValue] of Object.entries(value)) {
                    flatUpdates[`${key}.${subKey}`] = subValue;
                }
            } else {
                flatUpdates[key] = value;
            }
        }

        const updatedOrder = await Order.findByIdAndUpdate(
            id,
            { $set: flatUpdates },
            { new: true, runValidators: true }
        ).populate('user', 'name email');

        if (!updatedOrder) {
            return res.status(404).json({ message: 'Order not found after update' });
        }

        if (updates.status && originalStatus !== updates.status) {
            if (updatedOrder.user?._id) {
                await Notification.create({
                    user: updatedOrder.user._id,
                    order: updatedOrder._id,
                    title: `Order Status Updated: ${updates.status.toUpperCase()}`,
                    message: `Your order for ${updatedOrder.style?.title || 'your item'} has been updated to '${updates.status}'.`,
                    type: 'order_status',
                });
            }

            if (updates.status === 'completed' && updatedOrder.paymentStatus === 'paid' && updatedOrder.user?.email) {
                try {
                    await sendEmail({
                        to: updatedOrder.user.email,
                        subject: 'Your Order Has Been Completed!',
                        html: `<h2>Order Completed!</h2><p>Dear ${updatedOrder.user.name}, your order is ready!</p>`,
                    });
                } catch (emailError) {
                    console.error('Error sending order completed email:', emailError);
                }
            }
        }

        if (updates.paymentStatus && originalPaymentStatus !== updates.paymentStatus) {
            if (updatedOrder.user?._id) {
                await Notification.create({
                    user: updatedOrder.user._id,
                    order: updatedOrder._id,
                    title: `Payment Status Updated: ${updates.paymentStatus.toUpperCase()}`,
                    message: `Payment for ${updatedOrder.style?.title || 'item'} updated to '${updates.paymentStatus}'.`,
                    type: 'payment_status_update',
                });
            }

            if (updates.paymentStatus === 'paid' && updatedOrder.user?.email) {
                try {
                    await sendEmail({
                        to: updatedOrder.user.email,
                        subject: 'Your Order Payment Has Been Confirmed!',
                        html: `<h2>Payment Confirmed!</h2><p>Dear ${updatedOrder.user.name}, your payment was confirmed.</p>`,
                    });
                } catch (emailError) {
                    console.error('Error sending payment email:', emailError);
                }

                if (updatedOrder.orderType === 'Online' && originalPaymentStatus !== 'paid') {
                    await scheduleOrderNotifications(updatedOrder);
                }
            } else if (updates.paymentStatus !== 'paid' && originalPaymentStatus === 'paid') {
                cancelOrderNotifications(updatedOrder._id.toString());
            }
        }

        res.status(200).json({
            message: 'Order updated successfully by admin',
            order: formatOrderForAdminFrontend(updatedOrder)
        });

    } catch (err) {
        console.error('Error updating order by admin:', err);
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

        cancelOrderNotifications(id);

        if (order.user) {
            await Notification.create({
                user: order.user,
                order: order._id,
                title: 'Order Permanently Deleted',
                message: `Your order ${order.style?.title || 'your item'} has been permanently deleted.`,
                type: 'order_status',
            });
        }

        res.status(200).json({ message: 'Order permanently deleted by admin' });

    } catch (err) {
        console.error('Error deleting order by admin:', err);
        res.status(500).json({ message: 'Failed to delete order' });
    }
};