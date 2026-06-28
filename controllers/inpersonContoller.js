// src/controllers/inpersonController.js
// ✅ KEY FIX: getAllOrders (admin) now returns { orders, totalOrders } so the
//    admin frontend can destructure data.orders correctly.
//    Previously it may have returned a bare array or a different shape,
//    causing the admin table to render empty even when records existed.
//
// ✅ NEW FIX: createOrder now relies on a unique index on `date` (see the
//    model) to prevent two clients from booking the same date + time slot.
//    If a second request collides with an already-booked slot, MongoDB
//    throws a duplicate-key error (code 11000), which we catch here and
//    turn into a friendly 409 response instead of a generic 500.
//
// ✅ NEW: getAvailability lets the frontend ask "which time slots are
//    already booked for this date?" before the user even submits, so they
//    never pick a slot that's already gone.

import InPersonOrder from '../models/inperson.js'; // adjust path to your model

// ── POST /api/order/in-person ─────────────────────────────────────────────────
export const createOrder = async (req, res) => {
  try {
    const order = await InPersonOrder.create({
      ...req.body,
      user: req.user.id,
    });
    res.status(201).json({ message: 'Appointment booked successfully.', order });
  } catch (err) {
    // Duplicate key error from the unique index on `date` — someone else
    // booked this exact date + time slot first (possibly milliseconds ago).
    if (err.code === 11000) {
      return res.status(409).json({
        message: 'That date and time slot has just been booked by another client. Please choose a different time.',
      });
    }
    console.error('createOrder (in-person) error:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ── GET /api/order/in-person/availability ─────────────────────────────────────
// Returns which time-slot labels are already taken for a given calendar date,
// so the frontend can disable them before the user even attempts to submit.
// Query param: ?date=YYYY-MM-DD
export const getAvailability = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ message: 'date is required (YYYY-MM-DD).' });
    }

    const dayStart = new Date(`${date}T00:00:00.000`);
    const dayEnd   = new Date(`${date}T23:59:59.999`);

    if (Number.isNaN(dayStart.getTime())) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const booked = await InPersonOrder.find({
      date:   { $gte: dayStart, $lte: dayEnd },
      status: { $ne: 'cancelled' },
    }).select('time');

    res.status(200).json({ bookedSlots: booked.map((o) => o.time) });
  } catch (err) {
    console.error('getAvailability (in-person) error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch availability.' });
  }
};

// ── GET /api/order/in-person (user — their own orders) ───────────────────────
export const getUserOrders = async (req, res) => {
  try {
    const orders = await InPersonOrder.find({ user: req.user.id })
      .sort({ createdAt: -1 });

    // Return bare array — matches what the user Orders.jsx frontend expects
    res.status(200).json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/order/in-person/:orderId ─────────────────────────────────────────
// Used by both user (ownership-checked) and admin (any order)
export const getOrderById = async (req, res) => {
  try {
    const order = await InPersonOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    // Non-admins can only view their own orders
    if (!req.user.isAdmin && order.user?.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorised.' });
    }

    res.status(200).json({ message: 'Order retrieved successfully.', order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/order/admin/in-person (admin — all orders) ──────────────────────
// ✅ FIX: Returns { orders, totalOrders } — the shape AdminOrdersPage expects
//    when it does: const filteredOrders = data.orders.filter(...)
//    A bare array would cause `data.orders` to be undefined → crash/empty table.
export const getAllOrders = async (req, res) => {
  try {
    const {
      searchTerm = '',
      sortBy     = 'createdAt',
      sortOrder  = 'desc',
      page       = 1,
      limit      = 10,
      status,
    } = req.query;

    // Build filter
    const filter = {};

    // Exclude cancelled by default unless admin explicitly asks for them
    if (status && status !== 'non-cancelled') {
      filter.status = status;
    } else if (!status || status === 'non-cancelled') {
      filter.status = { $ne: 'cancelled' };
    }

    // Search by customer name, phone, or address
    if (searchTerm) {
      filter.$or = [
        { name:    { $regex: searchTerm, $options: 'i' } },
        { phone:   { $regex: searchTerm, $options: 'i' } },
        { address: { $regex: searchTerm, $options: 'i' } },
      ];
    }

    const sortDir    = sortOrder === 'asc' ? 1 : -1;
    const skip       = (parseInt(page) - 1) * parseInt(limit);
    const totalOrders = await InPersonOrder.countDocuments(filter);

    const orders = await InPersonOrder.find(filter)
      .sort({ [sortBy]: sortDir })
      .skip(skip)
      .limit(parseInt(limit));

    // ✅ Shape: { orders, totalOrders, currentPage, totalPages }
    res.status(200).json({
      message:     'In-person orders retrieved successfully.',
      orders,
      totalOrders,
      currentPage: parseInt(page),
      totalPages:  Math.ceil(totalOrders / parseInt(limit)),
    });
  } catch (err) {
    console.error('getAllOrders (in-person admin) error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch in-person orders.' });
  }
};

// ── DELETE /api/order/in-person/:orderId ──────────────────────────────────────
// User: deletes their own order
// Admin: can delete any order (soft-delete by setting status = 'cancelled')
export const deleteOrder = async (req, res) => {
  try {
    const order = await InPersonOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    if (req.user.isAdmin) {
      // Admin soft-deletes (marks cancelled) so the audit trail is preserved
      // ✅ After deletion, getAllOrders excludes { status: 'cancelled' } by default,
      //    so the order disappears from the admin table without losing the record.
      // ✅ This also frees up the date/time slot for rebooking, since the
      //    unique index's partialFilterExpression ignores cancelled orders.
      order.status = 'cancelled';
      await order.save();
      return res.status(200).json({ message: 'Appointment cancelled successfully.' });
    }

    // Regular user: hard-delete their own record
    if (order.user?.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorised.' });
    }
    await InPersonOrder.findByIdAndDelete(req.params.orderId);
    res.status(200).json({ message: 'Appointment deleted successfully.' });
  } catch (err) {
    console.error('deleteOrder (in-person) error:', err);
    res.status(500).json({ message: err.message || 'Failed to delete appointment.' });
  }
};

// ── GET /api/order/admin/in-person/date-range ─────────────────────────────────
export const getOrdersByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required.' });
    }

    const orders = await InPersonOrder.find({
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
      },
      status: { $ne: 'cancelled' },
    }).sort({ createdAt: -1 });

    res.status(200).json({
      message: 'Orders by date range retrieved.',
      orders,
      totalOrders: orders.length,
    });
  } catch (err) {
    console.error('getOrdersByDateRange error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch orders by date range.' });
  }
};