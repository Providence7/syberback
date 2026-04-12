// src/controllers/orderController.js
import Order from '../models/order.js';
import User from '../models/user.js';
import Notification from '../models/notification.js';
import cloudinary from '../utils/cloudinary.js';
import { sendEmail } from '../utils/email.js';
import { scheduleOrderNotifications, cancelOrderNotifications } from '../utils/notificationScheduler.js';
import axios from 'axios';
import dotenv from 'dotenv';
import { notifyUser, broadcastNotification } from '../utils/notifyUsers.js';
dotenv.config();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const MEASUREMENT_FEE = 1500;

const addWorkingDays = (startDate, days) => {
  const date = new Date(startDate);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return date;
};

// ── POST /api/orders ──────────────────────────────────────────────────────────
// Create order — status = pendingPayment, NO delivery date, NO admin notification.
export const createOrder = async (req, res) => {
  try {
    const {
      style, material, measurements, notes,
      totalPrice, paymentChannel,
      measurementRequested, requestedSize,
    } = req.body;

    if (!style || !material) {
      return res.status(400).json({ message: 'Style and material are required.' });
    }

    // ✅ Fetch user to pre-fill customerName and customerEmail before validation fires
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const order = await Order.create({
      user:          req.user.id,
      customerName:  user.name,   // ✅ explicitly set before Mongoose validation
      customerEmail: user.email,  // ✅ explicitly set before Mongoose validation
      style,
      material,
      measurements:  measurements || null,
      notes:         notes        || '',
      totalPrice,
      paymentChannel: paymentChannel || 'card',
      measurementRequested: !!measurementRequested,
      requestedSize:  requestedSize || null,
      status:         'pendingPayment',
      paymentStatus:  'unpaid',
      expectedDeliveryDate: null,
    });

    // Notify the user their order is created and awaiting payment
    const io = req.app.get('io');
    await notifyUser(io, req.user.id, {
      title:    'Order Created',
      message:  `Your order for "${style.title}" has been placed. Complete payment to confirm it.`,
      type:     'info',
      category: 'order',
    });

    res.status(201).json({ message: 'Order created successfully.', order });
  } catch (err) {
    console.error('createOrder error:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ── POST /api/orders/:id/pay ──────────────────────────────────────────────────
// Verify Paystack payment, update order, set delivery date, THEN notify admin.
export const verifyOrderPayment = async (req, res) => {
  try {
    const { reference } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (order.user.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: 'Not authorised.' });
    }
    if (order.paymentStatus === 'paid') {
      return res.status(400).json({ message: 'Order already paid.' });
    }

    // ── Verify with Paystack ────────────────────────────────────────────────
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data?.status !== 'success') {
      order.paymentStatus = 'failed';
      await order.save();
      return res.status(400).json({ message: 'Payment verification failed.' });
    }

    // ✅ Payment confirmed — now update everything
    order.paymentStatus        = 'paid';
    order.paymentReference     = reference;
    order.status               = 'in-progress';
    order.expectedDeliveryDate = addWorkingDays(new Date(), 7);

    await order.save();

    const io            = req.app.get('io');
    const deliveryLabel = order.expectedDeliveryDate.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    // ✅ Notify the customer
    await notifyUser(io, req.user.id, {
      title:    'Payment Confirmed! 🎉',
      message:  `Your order for "${order.style?.title}" is now in progress. Expected delivery: ${deliveryLabel}.`,
      type:     'success',
      category: 'order',
    });

    // ✅ Notify EVERY admin — only fires after verified payment
    const admins = await User.find({ isAdmin: true }, '_id');
    if (admins.length > 0) {
      await broadcastNotification(
        io,
        admins.map(a => a._id),
        {
          title:    '💳 New Paid Order',
          message:  `${order.customerName} just paid for "${order.style?.title}". Order is in progress. Delivery: ${deliveryLabel}.`,
          type:     'success',
          category: 'order',
        }
      );
    }

    res.status(200).json({ message: 'Payment verified. Order is now in progress.', order });
  } catch (err) {
    console.error('verifyOrderPayment error:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ── GET /api/orders ───────────────────────────────────────────────────────────
export const getUserOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/orders/:id ───────────────────────────────────────────────────────
export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    const isOwner = order.user.toString() === req.user.id.toString();
    if (!isOwner && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorised.' });
    }

    res.status(200).json({ order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/orders/admin/all ─────────────────────────────────────────────────
export const getAllOrdersAdmin = async (req, res) => {
  try {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: 'Admins only.' });
    }

    const orders = await Order.find({ paymentStatus: 'paid' })
      .sort({ createdAt: -1 })
      .populate('user', 'name email');

    res.status(200).json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── PATCH /api/orders/:id/status ─────────────────────────────────────────────
export const updateOrderStatus = async (req, res) => {
  try {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: 'Admins only.' });
    }

    const { status } = req.body;
    const allowed    = ['in-progress', 'completed', 'cancelled', 'ready-for-pickup'];

    if (!allowed.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Allowed: ${allowed.join(', ')}` });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    if (order.paymentStatus !== 'paid') {
      return res.status(400).json({ message: 'Cannot update status of an unpaid order.' });
    }

    order.status = status;
    await order.save();

    const io = req.app.get('io');

    const statusMessages = {
      'completed':        { title: 'Order Delivered! 🎉', message: `Your order for "${order.style?.title}" has been delivered. Thank you!`, type: 'success' },
      'ready-for-pickup': { title: 'Ready for Pickup! 📦', message: `Your order for "${order.style?.title}" is ready for pickup.`, type: 'info' },
      'cancelled':        { title: 'Order Cancelled', message: `Your order for "${order.style?.title}" has been cancelled. Contact us for more info.`, type: 'error' },
      'in-progress':      { title: 'Order In Progress', message: `Your order for "${order.style?.title}" is now being worked on.`, type: 'info' },
    };

    const notifPayload = statusMessages[status];
    if (notifPayload) {
      await notifyUser(io, order.user.toString(), {
        ...notifPayload,
        category: 'order',
      });
    }

    res.status(200).json({ message: `Order status updated to "${status}".`, order });
  } catch (err) {
    console.error('updateOrderStatus error:', err);
    res.status(500).json({ message: err.message });
  }
};

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
    measurementRequest: order.measurementRequest,
    paymentReference: order.paymentReference,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    expectedDeliveryDate: order.expectedDeliveryDate,
  };
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
      order.paymentStatus    = 'paid';
      order.paymentReference = reference;
      order.paymentMethod    = 'Paystack';
      order.paymentDetails   = paymentGatewayResponse.data;
      order.status           = 'in-progress';

      if (order.measurementRequest?.requested) {
        order.measurementRequest.paid = true;
      }

      await order.save();

      const user = await User.findById(userId);

      await Notification.create({
        user:  userId,
        order: order._id,
        title: 'Payment Successful! 🎉',
        message: order.measurementRequest?.requested
          ? `Payment for ${order.style.title} confirmed. A tailor will contact you soon to schedule your measurement session.`
          : `Your payment for ${order.style.title} was successful. Your order is now being processed.`,
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
              ${order.measurementRequest?.requested ? `<p>📏 You requested our measurement service. A tailor will contact you within 24 hours to schedule a visit.</p>` : ''}
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
            ${order.measurementRequest?.requested ? `<p>⚠️ <strong>ACTION REQUIRED:</strong> This customer paid for a measurement service. Please schedule a tailor visit.</p>` : ''}
          `,
        });
      } catch (emailError) {
        console.error('Error sending admin paid email:', emailError);
      }

      res.status(200).json({ message: 'Payment successful, order updated.', order });

    } else {
      order.paymentStatus    = 'failed';
      order.paymentDetails   = paymentGatewayResponse;
      order.paymentReference = null;
      await order.save();

      await Notification.create({
        user:  userId,
        order: order._id,
        title: 'Payment Failed',
        message: `Payment for your order ${order.style.title} failed. Please try again.`,
        type: 'payment_failed',
      });

      return res.status(402).json({
        message: `Payment failed: ${paymentGatewayResponse?.message || 'Verification failed.'}`,
        error: paymentGatewayResponse,
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
      user:  userId,
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
      order: formatOrderForAdminFrontend(order),
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

    const originalStatus        = existingOrder.status;
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
          user:  updatedOrder.user._id,
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
          user:  updatedOrder.user._id,
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
      order: formatOrderForAdminFrontend(updatedOrder),
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
        user:  order.user,
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