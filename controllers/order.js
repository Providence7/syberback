// src/controllers/order.js
import Order, { calculateOrderTotal, addWorkingDays } from '../models/order.js';
import User from '../models/user.js';
import Notification from '../models/notification.js';
import { sendEmail } from '../utils/email.js';
import { scheduleOrderNotifications, cancelOrderNotifications } from '../utils/notificationScheduler.js';
import { notifyUser, broadcastNotification } from '../utils/notifyUsers.js';
import dotenv from 'dotenv';
dotenv.config();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// ── Cancellation reasons the client UI is allowed to send ─────────────────────
// Keep this in sync with CANCEL_REASONS in the Orders.jsx frontend.
const CANCEL_REASONS = [
  'Ordered by mistake',
  'Found a better price elsewhere',
  'Changed my mind',
  'Other',
];

// ── POST /api/orders ──────────────────────────────────────────────────────────
export const createOrder = async (req, res) => {
  try {
    const {
      style,
      material,
      measurements,
      notes,
      paymentChannel,
      measurementRequested,
      requestedSize,
      measurementRequest,
    } = req.body;

    if (!style || !material) {
      return res.status(400).json({ message: 'Style and material are required.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const computedTotal = calculateOrderTotal(style, material, measurementRequest);

    const order = await Order.create({
      user:                 req.user.id,
      customerName:         user.name,
      customerEmail:        user.email,
      style,
      material,
      measurements:         measurements || null,
      notes:                notes        || '',
      totalPrice:           computedTotal,
      orderType:            'Online',
      paymentChannel:       paymentChannel || 'card',
      measurementRequest:   measurementRequest || { requested: false, fee: 1500, paid: false },
      measurementRequested: !!measurementRequested,
      requestedSize:        requestedSize || null,
      status:               'pendingPayment',
      paymentStatus:        'unpaid',
      expectedDeliveryDate: null,
    });

    const io = req.app.get('io');
    await notifyUser(io, req.user.id, {
      title:    'Order Created',
      message:  `Your order for "${style.title}" has been placed. Complete payment to confirm it.`,
      type:     'info',
      category: 'order',
    });

    res.status(201).json({ message: 'Order created successfully.', order });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ── POST /api/orders/:id/pay ──────────────────────────────────────────────────
export const verifyOrderPayment = async (req, res) => {
  const orderId = req.params.id;

  try {
    const { reference } = req.body;

    // ── Input validation ──────────────────────────────────────────────────────
    if (!reference || typeof reference !== 'string') {
      return res.status(400).json({ message: 'Payment reference is required.' });
    }

    if (!/^[a-zA-Z0-9_-]{5,100}$/.test(reference)) {
      return res.status(400).json({ message: 'Invalid payment reference format.' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    // ── Ownership check ───────────────────────────────────────────────────────
    if (order.user.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: 'Not authorised.' });
    }

    // ── Cancelled orders cannot be paid ───────────────────────────────────────
    if (order.status === 'cancelled') {
      return res.status(400).json({ message: 'This order has been cancelled and can no longer be paid for.' });
    }

    // ── Idempotency ───────────────────────────────────────────────────────────
    if (order.paymentStatus === 'paid') {
      return res.status(409).json({ message: 'Order already paid.', order });
    }

    // ── Reference reuse check ─────────────────────────────────────────────────
    const existingRefOrder = await Order.findOne({
      paymentReference: reference,
      _id: { $ne: order._id },
    });
    if (existingRefOrder) {
      return res.status(400).json({
        message: 'This payment reference has already been used. Please contact support.',
      });
    }

    // ── Server-to-server Paystack verification ────────────────────────────────
    let paystackData;
    try {
      const paystackRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
          signal:  AbortSignal.timeout(10_000),
        }
      );

      if (!paystackRes.ok) {
        return res.status(502).json({ message: 'Could not reach payment gateway. Please try again.' });
      }

      paystackData = await paystackRes.json();
    } catch (fetchErr) {
      return res.status(502).json({ message: 'Payment gateway timeout. Please contact support.' });
    }

    // ── Check Paystack transaction status ─────────────────────────────────────
    if (!paystackData.status || paystackData.data?.status !== 'success') {
      order.paymentStatus = 'failed';
      await order.save();
      return res.status(400).json({
        message: 'Payment not successful. Please try again or contact support.',
      });
    }

    // ── Amount verification (kobo) ────────────────────────────────────────────
    const amountPaidKobo = paystackData.data.amount;
    const expectedKobo   = Math.round(order.totalPrice * 100);

    if (amountPaidKobo !== expectedKobo) {
      order.paymentStatus = 'failed';
      await order.save();
      return res.status(400).json({
        message:
          `Payment amount mismatch. Expected ₦${order.totalPrice.toLocaleString()}, ` +
          `received ₦${(amountPaidKobo / 100).toLocaleString()}. ` +
          `Please contact support with reference: ${reference}.`,
      });
    }

    // ── All checks passed — mark order as paid ────────────────────────────────
    order.paymentStatus        = 'paid';
    order.paymentReference     = reference;
    order.status               = 'in-progress';
    order.expectedDeliveryDate = addWorkingDays(new Date(), 7);

    if (order.measurementRequest?.requested) {
      order.measurementRequest.paid = true;
    }

    await order.save();

    const io            = req.app.get('io');
    const deliveryLabel = order.expectedDeliveryDate.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    // ── Notify customer (in-app) ──────────────────────────────────────────────
    try {
      await notifyUser(io, req.user.id, {
        title:    'Payment Confirmed! 🎉',
        message:  `Your order for "${order.style?.title}" is now in progress. Expected delivery: ${deliveryLabel}.`,
        type:     'success',
        category: 'order',
      });
    } catch (notifyErr) {
      // in-app notification failed; payment itself is already confirmed above
    }

    // ── Notify admins (in-app) ────────────────────────────────────────────────
    try {
      const admins = await User.find({ isAdmin: true }, '_id');
      if (admins.length > 0) {
        await broadcastNotification(
          io,
          admins.map(a => a._id),
          {
            title:    '💳 New Paid Order',
            message:  `${order.customerName} paid for "${order.style?.title}". Delivery: ${deliveryLabel}.`,
            type:     'success',
            category: 'order',
          }
        );
      }
    } catch (notifyErr) {
      // admin notification failed; payment itself is already confirmed above
    }

    // ── Email customer ────────────────────────────────────────────────────────
    try {
      await sendEmail({
        to:      order.customerEmail,
        subject: 'Payment Successful! Your Order is Confirmed',
        html: `
          <h2>Payment Successful!</h2>
          <p>Dear ${order.customerName},</p>
          <p>Your payment for <strong>${order.style?.title}</strong> (Order ID: ${order._id})
             of ₦${order.totalPrice.toLocaleString()} has been received.</p>
          ${order.measurementRequest?.requested
            ? `<p>📏 You requested our measurement service. A tailor will contact you within 24 hours.</p>`
            : ''}
          <p>Expected delivery: <strong>${deliveryLabel}</strong>.</p>
          <p>Transaction Reference: ${reference}</p>
          <p>You can download your receipt from the Orders page in your account.</p>
        `,
      });
    } catch (emailErr) {
      // customer email failed; payment itself is already confirmed above
    }

    // ── Email admin ───────────────────────────────────────────────────────────
    try {
      await sendEmail({
        to:      ADMIN_EMAIL,
        subject: `New Paid Order: ${order._id}`,
        html: `
          <h2>New Paid Order</h2>
          <p>Order ID: ${order._id}</p>
          <p>Customer: ${order.customerName} (${order.customerEmail})</p>
          <p>Item: ${order.style?.title}</p>
          <p>Total: ₦${order.totalPrice.toLocaleString()}</p>
          <p>Payment Reference: ${reference}</p>
          ${order.measurementRequest?.requested
            ? `<p>⚠️ <strong>ACTION REQUIRED:</strong> Customer paid for measurement service. Please schedule a tailor visit.</p>`
            : ''}
        `,
      });
    } catch (emailErr) {
      // admin email failed; payment itself is already confirmed above
    }

    // ── Schedule order progress notifications ─────────────────────────────────
    if (order.orderType === 'Online') {
      try {
        await scheduleOrderNotifications(order);
      } catch (schedErr) {
        // scheduling failed; payment itself is already confirmed above
      }
    }

    res.status(200).json({
      message: 'Payment verified. Order is now in progress.',
      order,
    });

  } catch (err) {
    res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ── PATCH /api/orders/:id/cancel ───────────────────────────────────────────────
// Client-initiated cancellation. Distinct from admin's updateOrderStatus:
// this one is scoped to the order's owner, requires a reason, and works
// whether or not the order has been paid yet (paymentStatus is left as-is —
// a paid order that's cancelled keeps paymentStatus:'paid' as a historical
// record; refunding it is a separate, unimplemented flow).
export const cancelOrder = async (req, res) => {
  const orderId = req.params.id;

  try {
    const { reason, customReason } = req.body;

    if (!reason || !CANCEL_REASONS.includes(reason)) {
      return res.status(400).json({
        message: `A valid cancellation reason is required. Allowed: ${CANCEL_REASONS.join(', ')}`,
      });
    }

    if (reason === 'Other' && (!customReason || !customReason.trim())) {
      return res.status(400).json({ message: 'Please tell us why you are cancelling.' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    if (order.user.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: 'Not authorised.' });
    }

    if (order.status === 'cancelled') {
      return res.status(409).json({ message: 'This order is already cancelled.', order });
    }

    if (order.status === 'completed') {
      return res.status(400).json({ message: 'Completed orders cannot be cancelled.' });
    }

    const finalReason = reason === 'Other' ? customReason.trim() : reason;

    order.status              = 'cancelled';
    order.cancellationReason  = finalReason;
    order.cancelledAt         = new Date();
    await order.save();

    // Stop any scheduled progress-reminder notifications for this order
    cancelOrderNotifications(order._id.toString());

    // Notify admins so dashboards / manual follow-up can react
    try {
      const admins = await User.find({ isAdmin: true }, '_id');
      if (admins.length > 0) {
        const io = req.app.get('io');
        await broadcastNotification(
          io,
          admins.map(a => a._id),
          {
            title:    'Order Cancelled',
            message:  `${order.customerName} cancelled their order for "${order.style?.title}". Reason: ${finalReason}`,
            type:     'info',
            category: 'order',
          }
        );
      }
    } catch (notifyErr) {
      // admin notification failed; cancellation itself already succeeded above
    }

    res.status(200).json({ message: 'Order cancelled.', order });
  } catch (err) {
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

// ── DELETE /api/orders/:id ────────────────────────────────────────────────────
export const deleteOrder = async (req, res) => {
  try {
    const order = await Order.findOneAndDelete({
      _id:  req.params.id,
      user: req.user.id,
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found or you do not have access to it.' });
    }

    cancelOrderNotifications(order._id.toString());
    res.status(200).json({ message: 'Order deleted successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete order.' });
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const formatOrderForAdminFrontend = (order) => ({
  _id:                  order._id,
  user:                 order.user
                          ? { _id: order.user._id, name: order.user.name, email: order.user.email }
                          : null,
  customerName:         order.customerName,
  customerEmail:        order.customerEmail,
  orderType:            order.orderType,
  status:               order.status,
  paymentStatus:        order.paymentStatus,
  totalPrice:           order.totalPrice,
  date:                 order.createdAt.toISOString().split('T')[0],
  notes:                order.notes,
  style:                order.style,
  material:             order.material,
  measurements:         order.measurements,
  measurementRequest:   order.measurementRequest,
  paymentReference:     order.paymentReference,
  createdAt:            order.createdAt,
  updatedAt:            order.updatedAt,
  expectedDeliveryDate: order.expectedDeliveryDate,
  cancellationReason:   order.cancellationReason,
  cancelledAt:          order.cancelledAt,
});

// ── GET /api/orders/admin/all ─────────────────────────────────────────────────
export const getAllOrdersAdmin = async (req, res) => {
  try {
    const orders = await Order.find({ paymentStatus: 'paid' })
      .sort({ createdAt: -1 })
      .populate('user', 'name email');
    res.status(200).json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/orders/admin ─────────────────────────────────────────────────────
export const getAdminOrders = async (req, res) => {
  try {
    const orders = await Order.find({ paymentStatus: 'paid' })
      .populate('user', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      message: 'All orders retrieved successfully for admin',
      orders:  orders.map(formatOrderForAdminFrontend),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch all orders' });
  }
};

// ── GET /api/orders/admin/:id ─────────────────────────────────────────────────
export const getAdminOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, paymentStatus: 'paid' })
      .populate('user', 'name email');

    if (!order) return res.status(404).json({ message: 'Order not found.' });

    res.status(200).json({
      message: 'Order retrieved successfully for admin',
      order:   formatOrderForAdminFrontend(order),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch order' });
  }
};

// ── PATCH /api/orders/:id/status ──────────────────────────────────────────────
export const updateOrderStatus = async (req, res) => {
  try {
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
      'completed':        { title: 'Order Delivered! 🎉',  message: `Your order for "${order.style?.title}" has been delivered. Thank you!`,          type: 'success' },
      'ready-for-pickup': { title: 'Ready for Pickup! 📦', message: `Your order for "${order.style?.title}" is ready for pickup.`,                    type: 'info'    },
      'cancelled':        { title: 'Order Cancelled',       message: `Your order for "${order.style?.title}" has been cancelled. Contact us for info.`, type: 'error'   },
      'in-progress':      { title: 'Order In Progress',     message: `Your order for "${order.style?.title}" is now being worked on.`,                  type: 'info'    },
    };

    const notifPayload = statusMessages[status];
    if (notifPayload) {
      await notifyUser(io, order.user.toString(), { ...notifPayload, category: 'order' });
    }

    // Cancel scheduled reminders when order reaches a terminal state
    if (['completed', 'cancelled'].includes(status)) {
      cancelOrderNotifications(order._id.toString());
    }

    res.status(200).json({ message: `Order status updated to "${status}".`, order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── PUT /api/orders/admin/:id ─────────────────────────────────────────────────
export const updateOrderAdmin = async (req, res) => {
  try {
    const { id }  = req.params;
    const updates = req.body;

    // ── Field allowlist — financial fields cannot be changed via this endpoint.
    // paymentStatus, totalPrice, paymentReference require a separate
    // high-friction endpoint with re-authentication. This prevents a compromised
    // admin account from silently marking orders as paid.
    const ALLOWED_FIELDS = new Set(['status', 'notes', 'expectedDeliveryDate']);
    const safeUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_FIELDS.has(key)) safeUpdates[key] = value;
    }

    if (Object.keys(safeUpdates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update.' });
    }

    const existingOrder = await Order.findOne({ _id: id, paymentStatus: 'paid' });
    if (!existingOrder) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    const originalStatus = existingOrder.status;

    // Flatten nested safe updates for Mongoose $set
    const flatUpdates = {};
    for (const [key, value] of Object.entries(safeUpdates)) {
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
      return res.status(404).json({ message: 'Order not found after update.' });
    }

    if (safeUpdates.status && originalStatus !== safeUpdates.status) {
      if (updatedOrder.user?._id) {
        await Notification.create({
          user:     updatedOrder.user._id,
          order:    updatedOrder._id,
          title:    `Order Status Updated: ${safeUpdates.status.toUpperCase()}`,
          message:  `Your order for "${updatedOrder.style?.title || 'your item'}" has been updated to '${safeUpdates.status}'.`,
          type:     'order_status',
          category: 'order',
        });
      }

      if (safeUpdates.status === 'completed' && updatedOrder.user?.email) {
        try {
          await sendEmail({
            to:      updatedOrder.user.email,
            subject: 'Your Order Has Been Completed!',
            html:    `<h2>Order Completed!</h2><p>Dear ${updatedOrder.user.name}, your order is ready!</p>`,
          });
        } catch (emailErr) {
          // completion email failed; status update itself already succeeded above
        }
      }

      if (['completed', 'cancelled'].includes(safeUpdates.status)) {
        cancelOrderNotifications(updatedOrder._id.toString());
      }
    }

    res.status(200).json({
      message: 'Order updated successfully by admin',
      order:   formatOrderForAdminFrontend(updatedOrder),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update order' });
  }
};

// ── DELETE /api/orders/admin/:id ──────────────────────────────────────────────
export const deleteOrderAdmin = async (req, res) => {
  try {
    const order = await Order.findOneAndDelete({ _id: req.params.id, paymentStatus: 'paid' });

    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    cancelOrderNotifications(req.params.id);

    if (order.user) {
      await Notification.create({
        user:     order.user,
        order:    order._id,
        title:    'Order Permanently Deleted',
        message:  `Your order for "${order.style?.title || 'your item'}" has been permanently deleted.`,
        type:     'order_status',
        category: 'order',
      });
    }

    res.status(200).json({ message: 'Order permanently deleted by admin.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete order' });
  }
};