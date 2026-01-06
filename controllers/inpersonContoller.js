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

    const appointmentDate = new Date(appointmentDateTime);
    if (isNaN(appointmentDate.getTime())) {
      return res.status(400).json({ message: 'Invalid appointment date/time.' });
    }

    const appointmentTime = appointmentDate.toTimeString().slice(0, 5);

    // Availability check
    const startOfDay = new Date(appointmentDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(appointmentDate);
    endOfDay.setHours(23, 59, 59, 999);

    const existingAppointments = await InPersonOrder.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      status: { $ne: 'cancelled' },
    });

    for (const existing of existingAppointments) {
      const existingDateTime = new Date(existing.date);
      const [h, m] = existing.time.split(':').map(Number);
      existingDateTime.setHours(h, m, 0, 0);

      const diffMinutes =
        Math.abs(existingDateTime.getTime() - appointmentDate.getTime()) / 60000;

      if (diffMinutes < 60) {
        return res.status(409).json({
          message: 'Appointments must be at least 1 hour apart.',
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
          message: `Your appointment is scheduled for ${populatedOrder.date.toLocaleDateString()} at ${populatedOrder.time}.`,
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
              <li>Date: ${populatedOrder.date.toLocaleDateString()}</li>
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

    // ✅ ALWAYS RETURN SUCCESS IF ORDER IS CREATED
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
        { name: { $regex: searchTerm, $options: 'i' } },
        { phone: { $regex: searchTerm, $options: 'i' } },
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
        { name: { $regex: searchTerm, $options: 'i' } },
        { phone: { $regex: searchTerm, $options: 'i' } },
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
        <p>${order.date.toLocaleDateString()} at ${order.time}</p>
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
