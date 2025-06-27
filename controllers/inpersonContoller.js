// src/controllers/inPersonOrderController.js
import InPersonOrder from '../models/inperson.js';
import User from '../models/user.js';
import Notification from '../models/notification.js';
import nodemailer from 'nodemailer';

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
        title: 'New Order Placed',
        message: `Your in-person order for ${date} at ${time} has been received.`,
      });
    }

    // Setup transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // Email content
    const toClient = populatedOrder.user?.email || '';
    const toAdmin = 'sybertailor@gmail.com';

    const emailSubject = 'SyberTailor Order Confirmation';
    const emailBody = `
      <p>Hi ${populatedOrder.user?.name || 'Client'},</p>
      <p>Your in-person order has been scheduled:</p>
      <ul>
        <li><strong>Date:</strong> ${date}</li>
        <li><strong>Time:</strong> ${time}</li>
        <li><strong>Address:</strong> ${address}</li>
      </ul>
      <p>Thank you for using SyberTailor!</p>
    `;

    await transporter.sendMail({
      from: `SyberTailor <${process.env.SMTP_USER}>`,
      to: [toClient, toAdmin].filter(Boolean).join(','),
      subject: emailSubject,
      html: emailBody,
    });

    res.status(201).json({ message: 'Order created, notification saved, and email sent successfully' });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ message: 'Server error creating in-person order' });
  }
};
