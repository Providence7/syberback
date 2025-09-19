import InPersonOrder from '../models/inperson.js';
import User from '../models/user.js';
import Notification from '../models/notification.js';
import nodemailer from 'nodemailer';
import cron from 'node-cron';
import { cancelJob } from 'node-schedule';

// Helper function to setup email transporter
const setupTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Helper function to format phone number (no change needed here)
const formatPhoneNumber = (phone) => {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('0')) {
    return `+234${cleaned.slice(1)}`;
  }
  if (cleaned.startsWith('234') && !cleaned.startsWith('+234')) {
    return `+${cleaned}`;
  }
  if (!cleaned.startsWith('+') && !cleaned.startsWith('234')) {
    return `+234${cleaned}`;
  }
  return cleaned;
};

// Helper function to schedule email reminders
const scheduleEmailReminders = async (order) => {
  if (!order.date instanceof Date || !order.time) {
      console.warn(`Cannot schedule reminders for order ${order._id}: invalid date or time.`);
      return;
  }

  const appointmentDate = new Date(order.date);
  const today = new Date();

  // Create a copy to perform the date-only comparison
  const appointmentDayStart = new Date(appointmentDate);
  appointmentDayStart.setHours(0, 0, 0, 0);
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);

  let hours, minutes;
  try {
    const timeParts = order.time.split(':');
    if (timeParts.length !== 2) {
      throw new Error(`Time format expected HH:MM, got: "${order.time}"`);
    }
    hours = Number(timeParts[0]);
    minutes = Number(timeParts[1]);

    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new Error(`Invalid hour or minute value: ${order.time}`);
    }
  } catch (parseError) {
    console.error(`Error parsing time for order ${order._id}: ${parseError.message}. Reminder not scheduled.`);
    return;
  }


  if (appointmentDayStart >= todayStart && order.user?.email) {
    const reminderTimes = [
      { hour: 9, minute: 0, subject: 'Appointment Reminder - SyberTailor', message: 'Good morning! This is a reminder that you have an appointment with SyberTailor today.' },
      { hour: 15, minute: 0, subject: 'Final Reminder - SyberTailor Appointment', message: 'Good afternoon! Final reminder about your appointment with SyberTailor today.' }
    ];

    reminderTimes.forEach(({ hour, minute, subject, message }) => {
      const reminderDateTime = new Date(appointmentDate);
      reminderDateTime.setHours(hour, minute, 0, 0);

      if (reminderDateTime > new Date()) {
        const jobName = `inperson_reminder_${order._id.toString()}_${hour}_${minute}`;
        
        cron.schedule(reminderDateTime, async () => {
          try {
            const transporter = setupTransporter();
            await transporter.sendMail({
              from: `SyberTailor <${process.env.SMTP_USER}>`,
              to: order.user.email,
              subject: subject,
              html: `
                <h2>Appointment Reminder</h2>
                <p>Dear ${order.user.name || order.name},</p>
                <p>${message}</p>
                <p><strong>Appointment Details:</strong></p>
                <ul>
                  <li><strong>Date:</strong> ${order.date.toLocaleDateString()}</li>
                  <li><strong>Time:</strong> ${order.time}</li>
                  <li><strong>Address:</strong> ${order.address}</li>
                  <li><strong>Phone:</strong> ${order.phone}</li>
                </ul>
                <p>Please arrive 10 minutes early. Thank you!</p>
                <p>Best regards,<br>SyberTailor Team</p>
              `,
            });
            console.log(`Email reminder sent successfully for order ${order._id} at ${hour}:${minute}`);
          } catch (error) {
            console.error(`Failed to send email reminder for order ${order._id} at ${hour}:${minute}:`, error);
          }
        }, {
          scheduled: true,
          timezone: "Africa/Lagos"
        });
        console.log(`Scheduled reminder for order ${order._id} at ${reminderDateTime}`);
      }
    });
  } else {
      console.log(`Not scheduling reminders for order ${order._id}: appointment in past or no customer email.`);
  }
};


export const createOrder = async (req, res) => {
  try {
    const { name, phone, address, appointmentDateTime, notes, customerId } = req.body;
    const userId = req.user?.id || customerId || null;

    // Validate incoming date format and parse it
    const newAppointmentDate = new Date(appointmentDateTime);
    if (isNaN(newAppointmentDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date or time format provided.' });
    }
    const appointmentTime = newAppointmentDate.toTimeString().slice(0, 5); // Extract HH:MM

    // 🕵️‍♀️ Correctly set the start and end of the day for the query
    const startOfDay = new Date(newAppointmentDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(newAppointmentDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch existing appointments for the day, excluding cancelled ones
    const existingAppointments = await InPersonOrder.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      status: { $ne: 'cancelled' }
    });

    // 🚦 Correct validation for one-hour difference
    for (const existing of existingAppointments) {
      // Create a full Date object for the existing appointment
      const existingDateTime = new Date(existing.date);
      const [existingHours, existingMinutes] = existing.time.split(':').map(Number);
      existingDateTime.setHours(existingHours, existingMinutes, 0, 0);
      
      const timeDifferenceInMinutes = Math.abs(newAppointmentDate.getTime() - existingDateTime.getTime()) / (1000 * 60);

      if (timeDifferenceInMinutes < 60) {
        return res.status(409).json({ message: 'This time slot is too close to an existing appointment. Please choose a time at least one hour apart.' });
      }
    }

    // If validation passes, create the new order
    const newOrder = await InPersonOrder.create({
      user: userId,
      name,
      phone,
      address,
      date: newAppointmentDate,
      time: appointmentTime,
      notes,
      status: 'pending',
    });

    const populatedOrder = await InPersonOrder.findById(newOrder._id).populate('user', 'name email');

    if (populatedOrder.user) {
      await Notification.create({
        user: populatedOrder.user._id,
        title: 'New Appointment Booked',
        message: `Your in-person appointment for ${populatedOrder.date.toLocaleDateString()} at ${populatedOrder.time} has been scheduled.`,
      });
    }

    const transporter = setupTransporter();

    const toClient = populatedOrder.user?.email || '';
    const toAdmin = process.env.ADMIN_EMAIL || 'sybertailor@gmail.com';

    const emailSubject = 'SyberTailor Appointment Confirmation';
    const emailBody = `
      <h2>Appointment Confirmation</h2>
      <p>Dear ${populatedOrder.user?.name || name},</p>
      <p>Your in-person appointment has been scheduled successfully:</p>
      <ul>
        <li><strong>Date:</strong> ${populatedOrder.date.toLocaleDateString()}</li>
        <li><strong>Time:</strong> ${populatedOrder.time}</li>
        <li><strong>Address:</strong> ${populatedOrder.address}</li>
        <li><strong>Phone:</strong> ${populatedOrder.phone}</li>
      </ul>
      <p>Please arrive 10 minutes early. You will receive email reminders on the day of your appointment.</p>
      <p>Thank you for choosing SyberTailor!</p>
      <p>Best regards,<br>SyberTailor Team</p>
    `;

    try {
      await transporter.sendMail({
        from: `SyberTailor <${process.env.SMTP_USER}>`,
        to: [toClient, toAdmin].filter(Boolean).join(','),
        subject: emailSubject,
        html: emailBody,
      });
      console.log('Confirmation email sent successfully');
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
    }

    await scheduleEmailReminders(populatedOrder);

    res.status(201).json({
      message: 'Appointment created successfully! Confirmation sent via email.',
      order: populatedOrder
    });

  } catch (error) {
    console.error('Error creating appointment:', error);
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: 'Validation failed', errors });
    }
    res.status(500).json({ message: 'Server error creating in-person appointment' });
  }
};

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

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await InPersonOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'name email');

    const totalOrders = await InPersonOrder.countDocuments(filter);

    res.status(200).json({
      message: 'In-person orders retrieved successfully',
      orders,
      totalOrders,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalOrders / parseInt(limit)),
    });

  } catch (err) {
    console.error('Error fetching in-person orders:', err);
    res.status(500).json({ message: 'Failed to fetch in-person orders' });
  }
};

export const getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await InPersonOrder.findById(orderId)
      .populate('user', 'name email');

    if (!order) {
      return res.status(404).json({ message: 'In-person order not found' });
    }

    res.status(200).json({
      message: 'In-person order retrieved successfully',
      order
    });

  } catch (err) {
    console.error('Error fetching in-person order:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid order ID format.' });
    }
    res.status(500).json({ message: 'Failed to fetch in-person order', error: err.message });
  }
};

export const getAllOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, userId, searchTerm } = req.query;

    const filter = {};
    if (userId) filter.user = userId;
    if (searchTerm) {
        filter.$or = [
          { name: { $regex: searchTerm, $options: 'i' } },
          { phone: { $regex: searchTerm, $options: 'i' } },
          { address: { $regex: searchTerm, $options: 'i' } },
        ];
    }

    if (!status || status === 'non-cancelled') {
        filter.status = { $ne: 'cancelled' };
    } else if (status && status !== 'All') {
        filter.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await InPersonOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'name email');

    const totalOrders = await InPersonOrder.countDocuments(filter);

    res.status(200).json({
      message: 'All in-person orders retrieved successfully',
      orders,
      totalOrders,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalOrders / parseInt(limit)),
    });

  } catch (err) {
    console.error('Error fetching all in-person orders:', err);
    res.status(500).json({ message: 'Failed to fetch in-person orders', error: err.message });
  }
};

export const deleteOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await InPersonOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'In-person order not found' });
    }

    if (order.status === 'cancelled') {
      return res.status(400).json({
        message: 'Appointment is already cancelled.'
      });
    }

    const updatedOrder = await InPersonOrder.findByIdAndUpdate(
      orderId,
      { status: 'cancelled' },
      { new: true }
    ).populate('user', 'name email');

    cancelJob(`inperson_reminder_${orderId.toString()}_9_0`);
    cancelJob(`inperson_reminder_${orderId.toString()}_15_0`);
    console.log(`Cancelled scheduled reminders for cancelled order ${orderId}`);

    if (updatedOrder.user) {
      await Notification.create({
        user: updatedOrder.user._id,
        title: 'Appointment Cancelled',
        message: `Your in-person appointment for ${updatedOrder.date.toLocaleDateString()} at ${updatedOrder.time} has been cancelled.`,
      });

      if (updatedOrder.user.email) {
        try {
          const transporter = setupTransporter();
          await transporter.sendMail({
            from: `SyberTailor <${process.env.SMTP_USER}>`,
            to: updatedOrder.user.email,
            subject: 'Appointment Cancelled - SyberTailor',
            html: `
              <h2>Appointment Cancelled</h2>
              <p>Dear ${updatedOrder.user.name},</p>
              <p>Your in-person appointment has been cancelled:</p>
              <ul>
                <li><strong>Date:</strong> ${updatedOrder.date.toLocaleDateString()}</li>
                <li><strong>Time:</strong> ${updatedOrder.time}</li>
                <li><strong>Address:</strong> ${updatedOrder.address}</li>
              </ul>
              <p>If you have any questions, please don't hesitate to contact us.</p>
              <p>Thank you for choosing SyberTailor!</p>
              <p>Best regards,<br>SyberTailor Team</p>
            `,
          });
        } catch (emailError) {
          console.error('Email sending failed for cancellation:', emailError);
        }
      }
    }

    res.status(200).json({
      message: 'In-person order cancelled successfully',
      order: updatedOrder
    });

  } catch (err) {
    console.error('Error cancelling in-person order:', err);
    if (err.name === 'CastError') {
        return res.status(400).json({ message: 'Invalid order ID format.' });
    }
    res.status(500).json({ message: 'Failed to cancel in-person order', error: err.message });
  }
};

export const getOrdersByDateRange = async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    const filter = {
      date: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    };

    if (status && status !== 'All') filter.status = status;

    const orders = await InPersonOrder.find(filter)
      .sort({ date: 1, time: 1 })
      .populate('user', 'name email');

    res.status(200).json({
      message: 'Orders retrieved successfully',
      orders,
      count: orders.length
    });

  } catch (err) {
    console.error('Error fetching orders by date range:', err);
    res.status(500).json({ message: 'Failed to fetch orders by date range', error: err.message });
  }
};

export const sendManualReminder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await InPersonOrder.findById(orderId).populate('user', 'name email');
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!order.user?.email) {
      return res.status(400).json({ message: 'No email address found for this order' });
    }

    const transporter = setupTransporter();

    await transporter.sendMail({
      from: `SyberTailor <${process.env.SMTP_USER}>`,
      to: order.user.email,
      subject: 'Appointment Reminder - SyberTailor',
      html: `
        <h2>Appointment Reminder</h2>
        <p>Dear ${order.user.name || order.name},</p>
        <p>This is a reminder about your appointment with SyberTailor:</p>
        <ul>
          <li><strong>Date:</strong> ${order.date.toLocaleDateString()}</li>
          <li><strong>Time:</strong> ${order.time}</li>
          <li><strong>Address:</strong> ${order.address}</li>
          <li><strong>Phone:</strong> ${order.phone}</li>
        </ul>
        <p>Please arrive 10 minutes early. Thank you!</p>
        <p>Best regards,<br>SyberTailor Team</p>
      `,
    });

    res.status(200).json({ message: 'Reminder sent successfully' });
  } catch (error) {
    console.error('Error sending manual reminder:', error);
    res.status(500).json({ message: 'Failed to send reminder', error: error.message });
  }
};

export const testEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email address is required' });
    }

    const transporter = setupTransporter();

    await transporter.sendMail({
      from: `SyberTailor <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Test Email - SyberTailor',
      html: `
        <h2>Test Email</h2>
        <p>Hello!</p>
        <p>This is a test email from SyberTailor. 🌟</p>
        <p>If you received this email, your email configuration is working correctly.</p>
        <p>Best regards,<br>SyberTailor Team</p>
      `,
    });

    res.status(200).json({
      message: 'Test email sent successfully',
      to: email
    });
  } catch (error) {
    console.error('Test email failed:', error);
    res.status(500).json({
      message: 'Test failed',
      error: error.message
    });
  }
};
