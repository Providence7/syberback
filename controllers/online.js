// controllers/onlineOrderController.js
import OnlineOrder from '../models/order.js';
import Measurement from '../models/measurement.js';
import  uploader  from '../middlewares/uploadMiddleware.js';
import { sendEmail } from '../utils/email.js';
import { generateReceiptPDF } from '../utils/pdfGenerator.js';
import fs from 'fs';
import path from 'path';

export async function createOrder(req, res) {
  try {
    const userId = req.user.id;
    const userInfo = req.user;

    const {
      styleSource,
      styleTitle,
      stylePrice,
      materialSource,
      materialTitle,
      materialColor,
      materialPrice,
      tailorSupplyMaterial,
      yardsNeeded,
      pricePerYard,
      measurement,
      note
    } = req.body;

    if (!styleTitle || !measurement) {
      return res.status(400).json({ error: 'Style title and measurement are required' });
    }

    const measurementExists = await Measurement.findById(measurement);
    if (!measurementExists) {
      return res.status(400).json({ error: 'Invalid measurement selected' });
    }

    // Upload images to Cloudinary if present
    let styleImagePath = req.body.styleImage || null;
    let materialImagePath = req.body.materialImage || null;

    if (req.files) {
      if (req.files.styleImage) {
        const result = await uploader(req.files.styleImage[0].path, 'online_orders');
        styleImagePath = result.secure_url;
        fs.unlinkSync(req.files.styleImage[0].path);
      }
      if (req.files.materialImage) {
        const result = await uploader(req.files.materialImage[0].path, 'online_orders');
        materialImagePath = result.secure_url;
        fs.unlinkSync(req.files.materialImage[0].path);
      }
    }

    const isUploadedStyle = styleSource === 'uploaded';

    // Set status: 'under_review' if uploaded, otherwise 'pending'
    const orderStatus = isUploadedStyle ? 'under_review' : 'pending';

    const orderData = {
      user: userId,
      styleSource,
      styleImage: styleImagePath,
      styleTitle,
      stylePrice: parseFloat(stylePrice) || 0,
      materialSource,
      materialImage: materialImagePath,
      materialTitle,
      materialColor,
      materialPrice: parseFloat(materialPrice) || 0,
      tailorSupplyMaterial: tailorSupplyMaterial === 'true',
      yardsNeeded: parseFloat(yardsNeeded) || 0,
      pricePerYard: parseFloat(pricePerYard) || 0,
      measurement,
      note: note || '',
      status: orderStatus,
    };

    const order = new OnlineOrder(orderData);
    order.calculateDeliveryEstimate();
    await order.save();
    await order.populate('measurement', 'name');
    await order.populate('user', 'name email');

    // Generate PDF receipt
    const pdfPath = await generateReceiptPDF(order, userInfo);

    // Send email to user with receipt
    await sendEmail({
      to: userInfo.email,
      subject: 'Your Order Receipt',
      html: `<p>Hello ${userInfo.name}, your order has been received!</p>`,
      attachments: [{
        filename: 'receipt.pdf',
        path: pdfPath
      }]
    });

    // Send email to admin notifying new order
    await sendEmail({
      to: 'sybertailor@gmail.com',
      subject: 'New Order Received',
      html: `<p>User <b>${userInfo.name}</b> placed an order.</p>
             <p>Email: ${userInfo.email}</p>
             <p>Phone: ${userInfo.phone || 'N/A'}</p>
             <p>Address: ${userInfo.address || 'N/A'}</p>
             <p>Order ID: ${order._id}</p>`
    });

    // If style is uploaded, send additional review emails with style image attached
    if (isUploadedStyle) {
      // Email to client about review
      await sendEmail({
        to: userInfo.email,
        subject: 'Style Uploaded - Awaiting Review',
        html: `<p>Hi ${userInfo.name}, your uploaded style has been received and is awaiting review by our team. We will contact you shortly.</p>`,
        attachments: styleImagePath ? [{
          filename: 'uploaded-style.jpg',
          path: styleImagePath
        }] : []
      });

      // Email to admin about new uploaded style for review
      await sendEmail({
        to: 'sybertailor@gmail.com',
        subject: 'New Style Uploaded for Review',
        html: `
          <p>User <b>${userInfo.name}</b> uploaded a new style for review.</p>
          <p>Email: ${userInfo.email}</p>
          <p>Phone: ${userInfo.phone || 'N/A'}</p>
          <p>Order ID: ${order._id}</p>
        `,
        attachments: styleImagePath ? [{
          filename: 'uploaded-style.jpg',
          path: styleImagePath
        }] : []
      });
    }

    fs.unlinkSync(pdfPath);

    res.status(201).json({
      message: 'Order created successfully',
      order,
      estimatedDelivery: order.estimatedDelivery
    });

  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ error: 'Failed to create order', details: error.message });
  }
}

// Get all orders for a user
export async function getUserOrders(req, res) {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const orders = await OnlineOrder.find({ user: userId })
      .populate('measurement', 'name')
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalOrders = await OnlineOrder.countDocuments({ user: userId });

    res.json({
      orders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders', details: error.message });
  }
}

// Get single order
export async function getOrder(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await OnlineOrder.findOne({ _id: orderId, user: userId })
      .populate('measurement', 'name details')
      .populate('user', 'name email');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch order', details: error.message });
  }
}

// Delete order (only if pending)
export async function deleteOrder(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await OnlineOrder.findOne({ _id: orderId, user: userId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending orders can be deleted' });
    }

    await OnlineOrder.findByIdAndDelete(orderId);

    res.json({ message: 'Order deleted successfully' });

  } catch (error) {
    res.status(500).json({ error: 'Failed to delete order', details: error.message });
  }
}

// Admin: Get all orders
export async function getAllOrders(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status;

    const query = status ? { status } : {};

    const orders = await OnlineOrder.find(query)
      .populate('measurement', 'name')
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalOrders = await OnlineOrder.countDocuments(query);

    res.json({
      orders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders', details: error.message });
  }
}

// Admin: Update order status
export async function updateOrderStatus(req, res) {
  try {
    const { orderId } = req.params;
    const { status, note } = req.body;
    const validStatuses = ['pending', 'under_review', 'confirmed', 'in_progress', 'completed', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const order = await OnlineOrder.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    order.status = status;
    if (note) order.note = note;
    if (status === 'completed') order.actualDelivery = new Date();

    await order.save();

    res.json({ message: 'Order status updated', order });

  } catch (error) {
    res.status(500).json({ error: 'Failed to update order status', details: error.message });
  }
}
