import Order from '../models/order.js';
import User from '../models/user.js';
import Notification from '../models/notification.js';
import cloudinary from '../utils/cloudinary.js';
import { sendEmail } from '../utils/email.js';

export const createOrder = async (req, res) => {
  try {
    const userId = req.user.id; // Make sure this is properly set by your auth middleware
    const {
      style,
      material,
      measurements,
      notes
    } = req.body;

    // Validate required fields
    if (!style || !material) {
      return res.status(400).json({ message: 'Style and material are required' });
    }

    // Clean and validate style data
    const cleanStyle = {
      title: style.title,
      price: parseFloat(style.price) || 0,
      yardsRequired: parseFloat(style.yardsRequired) || 0,
      recommendedMaterials: style.recommendedMaterials || [],
      image: style.image
    };

    // Clean and validate material data
    const cleanMaterial = {
      name: material.name,
      type: material.type,
      pricePerYard: parseFloat(material.pricePerYard) || 0,
      image: material.image
    };
// Defensive check
if (!cleanStyle.image) {
  console.error('❌ cleanStyle.image is missing');
  return res.status(400).json({ message: 'Style image is required.' }); 
}

let styleImageUrl = cleanStyle.image;

// Cloudinary upload if needed
if (cleanStyle.image.startsWith('data:image')) {
  const uploadedStyle = await cloudinary.uploader.upload(cleanStyle.image, {
    folder: 'orders/styles',
  });
  styleImageUrl = uploadedStyle.secure_url;
}   


if (!cleanMaterial.image) {
  console.error('❌ cleanStyle.image is missing');
  return res.status(400).json({ message: 'Style image is required.' });
}
    let materialImageUrl = cleanMaterial.image;

    // Upload to Cloudinary if base64
    

    if (cleanMaterial.image?.startsWith('data:image')) {
      const uploadedMaterial = await cloudinary.uploader.upload(cleanMaterial.image, {
        folder: 'orders/materials',
      });
      materialImageUrl = uploadedMaterial.secure_url;
    }

    // Create the order
    const newOrder = new Order({
      user: userId, // This should be properly set
      style: { 
        ...cleanStyle, 
        image: styleImageUrl 
      },
      material: { 
        ...cleanMaterial, 
        image: materialImageUrl 
      },
      measurements: measurements || [], // Array of measurement names
      notes: notes || '',
      status: 'pending',
      paymentStatus: 'unpaid', // Changed from 'paid' to 'unpaid' - should be set after payment
    });

    await newOrder.save();

    // Get user for email
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Create notification for the user
    await Notification.create({
      user: userId,
      title: 'New Order Placed',
      message: `Your order for ${cleanStyle.title} has been received and is being processed.`,
    });

    // Send emails
    try {
      await sendEmail({
        to: user.email,
        subject: 'Order Confirmation',
        html: `
          <h2>Order Confirmation</h2>
          <p>Dear ${user.name},</p>
          <p>Your order has been received successfully!</p>
          <p><strong>Style:</strong> ${cleanStyle.title}</p>
          <p><strong>Material:</strong> ${cleanMaterial.name}</p>
          <p><strong>Total:</strong> ₦${newOrder.totalPrice || 0}</p>
          <p>We'll get back to you soon with updates.</p>
        `,
      });

      await sendEmail({
        to: 'sybertailor@gmail.com',
        subject: 'New Order Received',
        html: `
          <h2>New Order</h2>
          <p><strong>Customer:</strong> ${user.name} (${user.email})</p>
          <p><strong>Style:</strong> ${cleanStyle.title}</p>
          <p><strong>Material:</strong> ${cleanMaterial.name}</p>
          <p><strong>Measurements:</strong> ${measurements ? measurements.join(', ') : 'None'}</p>
          <p><strong>Notes:</strong> ${notes || 'None'}</p>
          <p><strong>Total:</strong> ₦${newOrder.totalPrice || 0}</p>
        `,
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Don't fail the order creation if email fails
    }

    res.status(201).json({ 
      message: 'Order created successfully', 
      order: newOrder 
    });
    
  } catch (err) {
    console.error('Order creation error:', err);
    
    // Handle validation errors specifically
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(error => error.message);
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors 
      });
    }
    
    res.status(500).json({ message: 'Failed to create order' });
  }
};

// GET all orders for a user
export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, status, paymentStatus } = req.query;

    // Build filter object
    const filter = { user: userId };
    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get orders with pagination
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'name email');

    // Get total count for pagination
    const totalOrders = await Order.countDocuments(filter);

    res.status(200).json({
      message: 'Orders retrieved successfully',
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
    console.error('Error fetching orders:', err);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

// GET single order by ID
export const getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await Order.findOne({ _id: orderId, user: userId })
      .populate('user', 'name email');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.status(200).json({
      message: 'Order retrieved successfully',
      order
    });

  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ message: 'Failed to fetch order' });
  }
};

// GET all orders (Admin only)
export const getAllOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, paymentStatus, userId } = req.query;

    // Build filter object
    const filter = {};
    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (userId) filter.user = userId;

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get orders with pagination
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'name email');

    // Get total count for pagination
    const totalOrders = await Order.countDocuments(filter);

    res.status(200).json({
      message: 'Orders retrieved successfully',
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
    console.error('Error fetching orders:', err);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

// UPDATE order
export const updateOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    const {
      style,
      material,
      measurements,
      notes,
      status,
      paymentStatus
    } = req.body;

    // Find the order
    const order = await Order.findOne({ _id: orderId, user: userId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Prepare update object
    const updateData = {};

    // Update style if provided
    if (style) {
      const cleanStyle = {
        title: style.title || order.style.title,
        price: parseFloat(style.price) || order.style.price,
        yardsRequired: parseFloat(style.yardsRequired) || order.style.yardsRequired,
        recommendedMaterials: style.recommendedMaterials || order.style.recommendedMaterials,
        image: style.image || order.style.image
      };

      // Handle image upload if new image is provided
      if (style.image?.startsWith('data:image')) {
        const uploadedStyle = await cloudinary.uploader.upload(style.image, {
          folder: 'orders/styles',
        });
        cleanStyle.image = uploadedStyle.secure_url;
      }

      updateData.style = cleanStyle;
    }

    // Update material if provided
    if (material) {
      const cleanMaterial = {
        name: material.name || order.material.name,
        type: material.type || order.material.type,
        pricePerYard: parseFloat(material.pricePerYard) || order.material.pricePerYard,
        image: material.image || order.material.image
      };

      // Handle image upload if new image is provided
      if (material.image?.startsWith('data:image')) {
        const uploadedMaterial = await cloudinary.uploader.upload(material.image, {
          folder: 'orders/materials',
        });
        cleanMaterial.image = uploadedMaterial.secure_url;
      }

      updateData.material = cleanMaterial;
    }

    // Update other fields
    if (measurements !== undefined) updateData.measurements = measurements;
    if (notes !== undefined) updateData.notes = notes;
    if (status !== undefined) updateData.status = status;
    if (paymentStatus !== undefined) updateData.paymentStatus = paymentStatus;

    // Update the order
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true, runValidators: true }
    ).populate('user', 'name email');

    // Create notification for status changes
    if (status && status !== order.status) {
      const statusMessages = {
        'pending': 'Your order is being reviewed',
        'confirmed': 'Your order has been confirmed and is in production',
        'in_progress': 'Your order is currently being tailored',
        'completed': 'Your order has been completed and is ready for pickup',
        'cancelled': 'Your order has been cancelled'
      };

      await Notification.create({
        user: userId,
        title: 'Order Status Update',
        message: `${statusMessages[status] || 'Your order status has been updated'}.`,
      });

      // Send status update email
      const user = await User.findById(userId);
      if (user) {
        try {
          await sendEmail({
            to: user.email,
            subject: 'Order Status Update',
            html: `
              <h2>Order Status Update</h2>
              <p>Dear ${user.name},</p>
              <p>Your order status has been updated to: <strong>${status}</strong></p>
              <p>${statusMessages[status] || 'Your order status has been updated'}.</p>
              <p><strong>Order Details:</strong></p>
              <p><strong>Style:</strong> ${updatedOrder.style.title}</p>
              <p><strong>Material:</strong> ${updatedOrder.material.name}</p>
              <p>Thank you for choosing our services!</p>
            `,
          });
        } catch (emailError) {
          console.error('Email sending failed:', emailError);
        }
      }
    }

    res.status(200).json({
      message: 'Order updated successfully',
      order: updatedOrder
    });

  } catch (err) {
    console.error('Error updating order:', err);
    
    // Handle validation errors specifically
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(error => error.message);
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors 
      });
    }
    
    res.status(500).json({ message: 'Failed to update order' });
  }
};

// DELETE order (soft delete - change status to cancelled)
export const deleteOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await Order.findOne({ _id: orderId, user: userId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if order can be cancelled
    if (order.status === 'completed' || order.status === 'cancelled') {
      return res.status(400).json({ 
        message: 'Cannot cancel order that is already completed or cancelled' 
      });
    }

    // Update order status to cancelled
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { status: 'cancelled' },
      { new: true }
    ).populate('user', 'name email');

    // Create notification
    await Notification.create({
      user: userId,
      title: 'Order Cancelled',
      message: `Your order for ${order.style.title} has been cancelled.`,
    });

    res.status(200).json({
      message: 'Order cancelled successfully',
      order: updatedOrder
    });

  } catch (err) {
    console.error('Error cancelling order:', err);
    res.status(500).json({ message: 'Failed to cancel order' });
  }
};