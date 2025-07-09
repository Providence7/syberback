// src/controllers/inPersonOrderController.js
import InPersonOrder from '../models/inperson.js';
import User from '../models/user.js';
import Notification from '../models/notification.js';
import nodemailer from 'nodemailer';
import cron from 'node-cron';

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

// Helper function to format phone number
const formatPhoneNumber = (phone) => {
  // Remove any non-digit characters except +
  const cleaned = phone.replace(/[^\d+]/g, '');
  
  // If it starts with 0, replace with +234
  if (cleaned.startsWith('0')) {
    return `+234${cleaned.slice(1)}`;
  }
  
  // If it starts with 234 but no +, add +
  if (cleaned.startsWith('234') && !cleaned.startsWith('+234')) {
    return `+${cleaned}`;
  }
  
  // If it doesn't start with + and isn't 234, assume it's Nigerian and add +234
  if (!cleaned.startsWith('+') && !cleaned.startsWith('234')) {
    return `+234${cleaned}`;
  }
  
  return cleaned;
};

// Helper function to schedule email reminders
const scheduleEmailReminders = async (order) => {
  const appointmentDate = new Date(order.date);
  const today = new Date();
  
  // Only schedule reminders if appointment is today or in the future
  if (appointmentDate >= today && order.user?.email) {
    
    // Schedule 2 email reminders
    const reminderTimes = [
      { 
        hour: 9, 
        minute: 0, 
        subject: 'Appointment Reminder - SyberTailor',
        message: 'Good morning! This is a reminder that you have an appointment with SyberTailor today.' 
      },
      { 
        hour: 15, 
        minute: 0, 
        subject: 'Final Reminder - SyberTailor Appointment',
        message: 'Good afternoon! Final reminder about your appointment with SyberTailor today.' 
      }
    ];
    
    reminderTimes.forEach(({ hour, minute, subject, message }) => {
      const reminderDate = new Date(appointmentDate);
      reminderDate.setHours(hour, minute, 0, 0);
      
      // Only schedule if the reminder time hasn't passed
      if (reminderDate > new Date()) {
        const cronTime = `${minute} ${hour} ${reminderDate.getDate()} ${reminderDate.getMonth() + 1} *`;
        
        cron.schedule(cronTime, async () => {
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
                  <li><strong>Date:</strong> ${order.date}</li>
                  <li><strong>Time:</strong> ${order.time}</li>
                  <li><strong>Address:</strong> ${order.address}</li>
                  <li><strong>Phone:</strong> ${order.phone}</li>
                </ul>
                <p>Please arrive 10 minutes early. Thank you!</p>
                <p>Best regards,<br>SyberTailor Team</p>
              `,
            });
            
            console.log('Email reminder sent successfully');
          } catch (error) {
            console.error('Failed to send email reminder:', error);
          }
        }, {
          scheduled: true,
          timezone: "Africa/Lagos"
        });
      }
    });
  }
};

export const createOrder = async (req, res) => {
  try {
    const { name, phone, address, date, time } = req.body;
    const userId = req.user?.id || null;

    const newOrder = await InPersonOrder.create({
      user: userId,
      name,
      phone,
      address,
      date,
      time,
    });

    // Populate user info
    const populatedOrder = await InPersonOrder.findById(newOrder._id).populate('user');

    // Create notification for the user
    if (userId) {
      await Notification.create({
        user: userId,
        title: 'New Appointment Booked',
        message: `Your in-person appointment for ${date} at ${time} has been scheduled.`,
      });
    }

    // Setup transporter
    const transporter = setupTransporter();

    // Email content
    const toClient = populatedOrder.user?.email || '';
    const toAdmin = 'sybertailor@gmail.com';

    const emailSubject = 'SyberTailor Appointment Confirmation';
    const emailBody = `
      <h2>Appointment Confirmation</h2>
      <p>Dear ${populatedOrder.user?.name || name},</p>
      <p>Your in-person appointment has been scheduled successfully:</p>
      <ul>
        <li><strong>Date:</strong> ${date}</li>
        <li><strong>Time:</strong> ${time}</li>
        <li><strong>Address:</strong> ${address}</li>
        <li><strong>Phone:</strong> ${phone}</li>
      </ul>
      <p>Please arrive 10 minutes early. You will receive email reminders on the day of your appointment.</p>
      <p>Thank you for choosing SyberTailor!</p>
      <p>Best regards,<br>SyberTailor Team</p>
    `;

    // Send confirmation email
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
      // Don't fail the entire request if email fails
    }

    // Schedule email reminders for the appointment day
    await scheduleEmailReminders(populatedOrder);

    res.status(201).json({ 
      message: 'Appointment created successfully! Confirmation sent via email.',
      order: populatedOrder 
    });

  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Server error creating in-person appointment' });
  }
};

// GET all in-person orders for a user
export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, status } = req.query;

    // Build filter object
    const filter = { user: userId };
    if (status) filter.status = status;

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get orders with pagination
    const orders = await InPersonOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'name email');

    // Get total count for pagination
    const totalOrders = await InPersonOrder.countDocuments(filter);

    res.status(200).json({
      message: 'In-person orders retrieved successfully',
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        hasNextPage: page * limit < totalOrders,
        hasPrevPage: page > 1
      }
    });

  } catch (err) {
    console.error('Error fetching in-person orders:', err);
    res.status(500).json({ message: 'Failed to fetch in-person orders' });
  }
};

// GET single in-person order by ID
export const getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await InPersonOrder.findOne({ _id: orderId, user: userId })
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
    res.status(500).json({ message: 'Failed to fetch in-person order' });
  }
};

// GET all in-person orders (Admin only)
export const getAllOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, userId } = req.query;

    // Build filter object
    const filter = {};
    if (status) filter.status = status;
    if (userId) filter.user = userId;

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get orders with pagination
    const orders = await InPersonOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'name email');

    // Get total count for pagination
    const totalOrders = await InPersonOrder.countDocuments(filter);

    res.status(200).json({
      message: 'All in-person orders retrieved successfully',
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        hasNextPage: page * limit < totalOrders,
        hasPrevPage: page > 1
      }
    });

  } catch (err) {
    console.error('Error fetching all in-person orders:', err);
    res.status(500).json({ message: 'Failed to fetch in-person orders' });
  }
};

// UPDATE in-person order
export const updateOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { name, phone, address, date, time, status } = req.body;

    // Find the order
    const order = await InPersonOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'In-person order not found' });
    }

    // Prepare update object
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (date !== undefined) updateData.date = date;
    if (time !== undefined) updateData.time = time;
    if (status !== undefined) updateData.status = status;

    // Update the order
    const updatedOrder = await InPersonOrder.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true, runValidators: true }
    ).populate('user', 'name email');

    // Create notification for status changes
    if (status && status !== order.status && updatedOrder.user) {
      const statusMessages = {
        'pending': 'Your in-person appointment is being reviewed',
        'confirmed': 'Your in-person appointment has been confirmed',
        'in_progress': 'Your appointment is currently in progress',
        'completed': 'Your in-person appointment has been completed',
        'cancelled': 'Your in-person appointment has been cancelled'
      };

      await Notification.create({
        user: updatedOrder.user._id,
        title: 'Appointment Status Update',
        message: statusMessages[status] || 'Your appointment status has been updated.',
      });

      // Send status update email
      if (updatedOrder.user.email) {
        try {
          const transporter = setupTransporter();
          
          await transporter.sendMail({
            from: `SyberTailor <${process.env.SMTP_USER}>`,
            to: updatedOrder.user.email,
            subject: 'Appointment Status Update - SyberTailor',
            html: `
              <h2>Appointment Status Update</h2>
              <p>Dear ${updatedOrder.user.name},</p>
              <p>Your in-person appointment status has been updated to: <strong>${status.replace('_', ' ').toUpperCase()}</strong></p>
              <p>${statusMessages[status] || 'Your appointment status has been updated'}.</p>
              <p><strong>Appointment Details:</strong></p>
              <ul>
                <li><strong>Date:</strong> ${updatedOrder.date}</li>
                <li><strong>Time:</strong> ${updatedOrder.time}</li>
                <li><strong>Address:</strong> ${updatedOrder.address}</li>
                <li><strong>Phone:</strong> ${updatedOrder.phone}</li>
              </ul>
              <p>Thank you for choosing SyberTailor!</p>
              <p>Best regards,<br>SyberTailor Team</p>
            `,
          });
        } catch (emailError) {
          console.error('Email sending failed:', emailError);
        }
      }
    }

    // Send appointment details update email if date/time changed
    if ((date && date !== order.date) || (time && time !== order.time)) {
      if (updatedOrder.user && updatedOrder.user.email) {
        try {
          const transporter = setupTransporter();
          
          await transporter.sendMail({
            from: `SyberTailor <${process.env.SMTP_USER}>`,
            to: updatedOrder.user.email,
            subject: 'Appointment Details Updated - SyberTailor',
            html: `
              <h2>Appointment Details Updated</h2>
              <p>Dear ${updatedOrder.user.name},</p>
              <p>Your in-person appointment details have been updated:</p>
              <ul>
                <li><strong>New Date:</strong> ${updatedOrder.date}</li>
                <li><strong>New Time:</strong> ${updatedOrder.time}</li>
                <li><strong>Address:</strong> ${updatedOrder.address}</li>
                <li><strong>Phone:</strong> ${updatedOrder.phone}</li>
              </ul>
              <p>Please make note of these changes. You will receive email reminders on the day of your appointment.</p>
              <p>Thank you for choosing SyberTailor!</p>
              <p>Best regards,<br>SyberTailor Team</p>
            `,
          });

          // Reschedule email reminders for the new date
          await scheduleEmailReminders(updatedOrder);
        } catch (emailError) {
          console.error('Email sending failed:', emailError);
        }
      }
    }

    res.status(200).json({
      message: 'In-person order updated successfully',
      order: updatedOrder
    });

  } catch (err) {
    console.error('Error updating in-person order:', err);
    
    // Handle validation errors specifically
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(error => error.message);
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors 
      });
    }
    
    res.status(500).json({ message: 'Failed to update in-person order' });
  }
};

// DELETE in-person order (soft delete - change status to cancelled)
export const deleteOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await InPersonOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'In-person order not found' });
    }

    // Check if order can be cancelled
    if (order.status === 'completed' || order.status === 'cancelled') {
      return res.status(400).json({ 
        message: 'Cannot cancel appointment that is already completed or cancelled' 
      });
    }

    // Update order status to cancelled
    const updatedOrder = await InPersonOrder.findByIdAndUpdate(
      orderId,
      { status: 'cancelled' },
      { new: true }
    ).populate('user', 'name email');

    // Create notification
    if (updatedOrder.user) {
      await Notification.create({
        user: updatedOrder.user._id,
        title: 'Appointment Cancelled',
        message: `Your in-person appointment for ${updatedOrder.date} at ${updatedOrder.time} has been cancelled.`,
      });

      // Send cancellation email
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
                <li><strong>Date:</strong> ${updatedOrder.date}</li>
                <li><strong>Time:</strong> ${updatedOrder.time}</li>
                <li><strong>Address:</strong> ${updatedOrder.address}</li>
              </ul>
              <p>If you have any questions, please don't hesitate to contact us.</p>
              <p>Thank you for choosing SyberTailor!</p>
              <p>Best regards,<br>SyberTailor Team</p>
            `,
          });
        } catch (emailError) {
          console.error('Email sending failed:', emailError);
        }
      }
    }

    res.status(200).json({
      message: 'In-person order cancelled successfully',
      order: updatedOrder
    });

  } catch (err) {
    console.error('Error cancelling in-person order:', err);
    res.status(500).json({ message: 'Failed to cancel in-person order' });
  }
};

// Get orders by date range (useful for scheduling)
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

    if (status) filter.status = status;

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
    res.status(500).json({ message: 'Failed to fetch orders by date range' });
  }
};

// Manual function to send reminder email (for testing)
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
          <li><strong>Date:</strong> ${order.date}</li>
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
    res.status(500).json({ message: 'Failed to send reminder' });
  }
};

// Test email function (replacing the WhatsApp test)
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