import InPersonOrder from '../models/inperson.js';
import User from '../models/user.js';
import Notification from '../models/notification.js';
import nodemailer from 'nodemailer';

/* ===============================
   EMAIL TRANSPORT
================================ */
const setupTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

/* ===============================
   CREATE ORDER
================================ */
export const createOrder = async (req, res) => {
  try {
    const { name, phone, address, appointmentDateTime, notes, customerId } = req.body;
    const userId = req.user?.id || customerId || null;

    // FIX: parse the incoming date string as LOCAL time, not UTC.
    //
    // The problem: if the frontend sends "2026-04-04T12:00" (no timezone suffix),
    // new Date("2026-04-04T12:00") is treated as LOCAL by browsers but as UTC
    // by Node.js, which shifts the stored date/time by the server's UTC offset.
    //
    // Solution: if the string has no timezone info (no Z, no +/-), append the
    // server's local offset so Node interprets it as the client's intended local time.
    // In production you should ideally send the timezone from the frontend, but this
    // covers the common case where the datetime-local input sends no offset.
    let appointmentDate;
    const rawDateTime = String(appointmentDateTime || '');

    if (rawDateTime && !rawDateTime.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(rawDateTime)) {
      // No timezone suffix — treat as UTC so the date stored matches what was typed.
      // This is the safest approach when the frontend sends a plain datetime-local value:
      // store it as-is in UTC, and read it back as UTC on the frontend (formatDateSafe).
      appointmentDate = new Date(rawDateTime + 'Z');
    } else {
      appointmentDate = new Date(rawDateTime);
    }

    if (isNaN(appointmentDate.getTime())) {
      return res.status(400).json({ message: 'Invalid appointment date/time.' });
    }

    const appointmentTime = `${String(appointmentDate.getUTCHours()).padStart(2, '0')}:${String(appointmentDate.getUTCMinutes()).padStart(2, '0')}`;

    // FIX: Changed from 1-hour to 2-hour minimum gap between appointments.
    // Build a window covering the whole day using UTC dates so the query
    // is consistent with how we stored the date above.
    const startOfDay = new Date(appointmentDate);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date(appointmentDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const existingAppointments = await InPersonOrder.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      status: { $ne: 'cancelled' },
    });

    for (const existing of existingAppointments) {
      const existingDateTime = new Date(existing.date);

      // Reconstruct the existing appointment's exact moment from its stored UTC date
      // and its stored time string (HH:MM) — both are in UTC.
      const [h, m] = existing.time.split(':').map(Number);
      existingDateTime.setUTCHours(h, m, 0, 0);

      const diffMinutes =
        Math.abs(existingDateTime.getTime() - appointmentDate.getTime()) / 60000;

      // FIX: 120 minutes (2 hours) minimum gap instead of 60
      if (diffMinutes < 120) {
        const blockedHour = existingDateTime.getUTCHours();
        const blockedMin  = String(existingDateTime.getUTCMinutes()).padStart(2, '0');
        return res.status(409).json({
          message: `Appointments must be at least 2 hours apart. The slot at ${blockedHour}:${blockedMin} is already booked — please choose a time at least 2 hours before or after it.`,
        });
      }
    }

    // ✅ CORE ACTION
    const newOrder = await InPersonOrder.create({
      user: userId,
      name,
      phone,
      address,
      date: appointmentDate,
      time: appointmentTime,
      notes,
      status: 'pending',
    });

    const populatedOrder = await InPersonOrder.findById(newOrder._id)
      .populate('user', 'name email');

    // 🟡 SIDE EFFECTS (NON-BLOCKING)
    try {
      if (populatedOrder.user) {
        await Notification.create({
          user: populatedOrder.user._id,
          title: 'New Appointment Booked',
          message: `Your appointment is scheduled for ${formatDateForEmail(populatedOrder.date)} at ${populatedOrder.time}.`,
        });
      }

      const transporter = setupTransporter();
      const recipients = [
        populatedOrder.user?.email,
        process.env.ADMIN_EMAIL,
      ].filter(Boolean);

      if (recipients.length) {
        await transporter.sendMail({
          from: `AttireByte <${process.env.SMTP_USER}>`,
          to: recipients.join(','),
          subject: 'Appointment Confirmation',
          html: `
            <h2>Appointment Confirmation</h2>
            <ul>
              <li>Date: ${formatDateForEmail(populatedOrder.date)}</li>
              <li>Time: ${populatedOrder.time}</li>
              <li>Address: ${populatedOrder.address}</li>
              <li>Phone: ${populatedOrder.phone}</li>
            </ul>
          `,
        });
      }
    } catch (sideEffectError) {
      console.warn('Post-create task failed:', sideEffectError.message);
    }

    return res.status(201).json({
      message: 'Appointment created successfully.',
      order: populatedOrder,
    });

  } catch (error) {
    console.error('Create appointment fatal error:', error);
    return res.status(500).json({
      message: 'Failed to create appointment.',
      error: error.message,
    });
  }
};

/**
 * Format a UTC date for email display.
 * Uses UTC date parts so the date shown in emails matches what the user booked.
 */
const formatDateForEmail = (date) => {
  const d = new Date(date);
  const year  = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day   = String(d.getUTCDate()).padStart(2, '0');
  return `${month}/${day}/${year}`;
};


/* ===============================
   USER ORDERS
================================ */
export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, status, searchTerm } = req.query;

    const filter = { user: userId };
    if (status && status !== 'All') filter.status = status;

    if (searchTerm) {
      filter.$or = [
        { name:    { $regex: searchTerm, $options: 'i' } },
        { phone:   { $regex: searchTerm, $options: 'i' } },
        { address: { $regex: searchTerm, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;

    const orders = await InPersonOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('user', 'name email');

    const totalOrders = await InPersonOrder.countDocuments(filter);

    res.status(200).json({
      orders,
      totalOrders,
      currentPage: Number(page),
      totalPages: Math.ceil(totalOrders / limit),
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch user orders.' });
  }
};

/* ===============================
   GET SINGLE ORDER
================================ */
export const getOrderById = async (req, res) => {
  try {
    const order = await InPersonOrder.findById(req.params.orderId)
      .populate('user', 'name email');

    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    res.status(200).json({ order });

  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch order.' });
  }
};

/* ===============================
   ADMIN: ALL ORDERS
================================ */
export const getAllOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, searchTerm } = req.query;

    const filter = {};
    if (status && status !== 'All') filter.status = status;

    if (searchTerm) {
      filter.$or = [
        { name:    { $regex: searchTerm, $options: 'i' } },
        { phone:   { $regex: searchTerm, $options: 'i' } },
        { address: { $regex: searchTerm, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;

    const orders = await InPersonOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('user', 'name email');

    const totalOrders = await InPersonOrder.countDocuments(filter);

    res.status(200).json({
      orders,
      totalOrders,
      currentPage: Number(page),
      totalPages: Math.ceil(totalOrders / limit),
    });

  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch all orders.' });
  }
};

/* ===============================
   CANCEL ORDER
================================ */
export const deleteOrder = async (req, res) => {
  try {
    const order = await InPersonOrder.findByIdAndUpdate(
      req.params.orderId,
      { status: 'cancelled' },
      { new: true }
    ).populate('user', 'name email');

    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    res.status(200).json({
      message: 'Order cancelled successfully.',
      order,
    });

  } catch (err) {
    res.status(500).json({ message: 'Failed to cancel order.' });
  }
};

/* ===============================
   DATE RANGE
================================ */
export const getOrdersByDateRange = async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;

    const filter = {
      date: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };

    if (status && status !== 'All') filter.status = status;

    const orders = await InPersonOrder.find(filter)
      .sort({ date: 1, time: 1 })
      .populate('user', 'name email');

    res.status(200).json({ orders });

  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch orders by date range.' });
  }
};

/* ===============================
   MANUAL REMINDER
================================ */
export const sendManualReminder = async (req, res) => {
  try {
    const order = await InPersonOrder.findById(req.params.orderId)
      .populate('user', 'name email');

    if (!order?.user?.email) {
      return res.status(400).json({ message: 'No email found.' });
    }

    const transporter = setupTransporter();

    await transporter.sendMail({
      from: `SyberTailor <${process.env.SMTP_USER}>`,
      to: order.user.email,
      subject: 'Appointment Reminder',
      html: `
        <p>Reminder for your appointment:</p>
        <p>${formatDateForEmail(order.date)} at ${order.time}</p>
      `,
    });

    res.status(200).json({ message: 'Reminder sent.' });

  } catch (err) {
    res.status(500).json({ message: 'Failed to send reminder.' });
  }
};

/* ===============================
   TEST EMAIL
================================ */
export const testEmail = async (req, res) => {
  try {
    const transporter = setupTransporter();

    await transporter.sendMail({
      from: `SyberTailor <${process.env.SMTP_USER}>`,
      to: req.body.email,
      subject: 'Test Email',
      html: '<p>Email configuration working.</p>',
    });

    res.status(200).json({ message: 'Test email sent.' });

  } catch (err) {
    res.status(500).json({ message: 'Test email failed.' });
  }
};