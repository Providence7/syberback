// controllers/onlineOrderController.js
import Order from '../models/order.js';
import Measurement from '../models/measurement.js';
import User from '../models/user.js';
import Notification from '../models/notification.js';
import nodemailer from 'nodemailer';

export const createOrder = async (req, res) => {
  try {
    const {
      styleSource,
      styleTitle,
      stylePrice,
      materialSource,
      materialTitle,
      materialPrice,
      measurement,
      note,
    } = req.body;

    const userId = req.user?.id || req.user?._id;

    // Handle uploaded images
    const styleFile = req.files?.styleImage?.[0];
    const materialFile = req.files?.materialImage?.[0];

    const styleImage = styleFile?.path || null;
    const styleImageId = styleFile?.filename || null;

    const materialImage = materialFile?.path || null;
    const materialImageId = materialFile?.filename || null;

    // Check measurement exists
    const foundMeasurement = await Measurement.findById(measurement);
    if (!foundMeasurement) {
      return res.status(400).json({ error: 'Invalid measurement ID' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isUnderReview = styleSource === 'upload';
    const status = isUnderReview ? 'under_review' : 'submitted';

    // Create order
    const newOrder = await Order.create({
      user: userId,
      styleSource,
      styleTitle,
      styleImage,
      styleImageId,
      stylePrice,
      materialSource,
      materialTitle,
      materialImage,
      materialImageId,
      materialPrice,
      measurement,
      note,
      isUnderReview,
      status,
    });

    const populatedOrder = await Order.findById(newOrder._id).populate({
      path: 'measurement',
      select: 'name',
    });

    // Create notification
    await Notification.create({
      user: userId,
      title: 'New Order Placed',
      message: `Your order for ${styleTitle} has been successfully submitted.`,
    });

    // Send email
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const emailSubject = isUnderReview
      ? 'SyberTailor Order Under Review'
      : 'SyberTailor Order Confirmation';

    const emailBody = `
      <p>Hi ${user.fullName || 'Client'},</p>
      <p>Your order for <strong>${styleTitle}</strong> ${
        isUnderReview
          ? 'is currently under review because you uploaded a custom style.'
          : 'has been successfully submitted.'
      }</p>
      <p><strong>Note:</strong> ${note || 'None'}</p>
      <p>We will get back to you shortly.</p>
    `;

    await transporter.sendMail({
      from: `SyberTailor <${process.env.SMTP_USER}>`,
      to: [user.email, 'sybertailor@gmail.com'].filter(Boolean),
      subject: emailSubject,
      html: emailBody,
    });

    res.status(201).json(populatedOrder);
  } catch (err) {
    console.error('❌ Order creation error:', err);
    res.status(500).json({ error: 'Failed to create online order' });
  }
};




export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('🔍 Fetching orders for user:', userId);

    const orders = await Order.find({ user: userId })
      .populate({ path: 'measurement', select: 'name' })
      .sort({ createdAt: -1 });

    console.log(`✅ Orders found: ${orders.length}`);

    // Add expected delivery date (5 days after createdAt)
    const enrichedOrders = orders.map((order) => {
      const orderObj = order.toObject();
      const createdDate = new Date(order.createdAt);

      // Ensure time zone safety and proper addition
      const deliveryDate = new Date(createdDate.getTime() + 5 * 24 * 60 * 60 * 1000);

      return {
        ...orderObj,
        expected: deliveryDate.toISOString().split('T')[0], // Format: YYYY-MM-DD
      };
    });

    res.status(200).json(enrichedOrders);
  } catch (err) {
    console.error('❌ Error fetching user orders:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};