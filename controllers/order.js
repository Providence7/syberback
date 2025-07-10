// src/controllers/orderController.js
import Order from '../models/order.js';
import User from '../models//user.js';
import Notification from '../models/notification.js';
import cloudinary from '../utils/cloudinary.js';
import { sendEmail } from '../utils/email.js';

// Helper to format order for frontend display (especially for admin view)
const formatOrderForAdminFrontend = (order) => {
  return {
    _id: order._id,
    // orderId: order.orderId, // If you implement a custom orderId field in your model
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    orderType: order.orderType,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalPrice: order.totalPrice, // Use totalPrice consistently
    date: order.createdAt.toISOString().split('T')[0], // Format date as YYYY-MM-DD
    notes: order.notes,
    style: order.style,
    material: order.material,
    measurements: order.measurements,
    // Add other fields you want to display in the admin panel
  };
};

export const createOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            style,
            material,
            measurements,
            notes,
            orderType = 'Online'
        } = req.body;

        // 1. Validate basic presence of style and material objects
        if (!style || !material) {
            console.error('Controller Error: Missing style or material in request body.');
            return res.status(400).json({ message: 'Style and material data are required.' });
        }

        // 2. Explicitly parse numeric fields and provide fallbacks.
        // This is the most crucial part to ensure no NaNs propagate to the model.
        const cleanStyle = {
            title: style.title,
            // Ensure price is a valid number, default to 0 if not.
            price: typeof style.price === 'number' ? style.price : (parseFloat(style.price) || 0),
            // Ensure yardsRequired is a valid number, default to 0 if not.
            yardsRequired: typeof style.yardsRequired === 'number' ? style.yardsRequired : (parseFloat(style.yardsRequired) || 0),
            recommendedMaterials: style.recommendedMaterials || [],
            image: style.image
        };

        const cleanMaterial = {
            name: material.name,
            type: material.type,
            // Ensure pricePerYard is a valid number, default to 0 if not.
            pricePerYard: typeof material.pricePerYard === 'number' ? material.pricePerYard : (parseFloat(material.pricePerYard) || 0),
            image: material.image
        };

        console.log('Controller: Parsed cleanStyle:', cleanStyle);
        console.log('Controller: Parsed cleanMaterial:', cleanMaterial);

        // Validate that required parsed numeric fields are not 0 if they're actually critical
        if (cleanStyle.price === 0 && style.price !== 0 && style.price !== "0") {
            console.error('Controller Error: Style price became 0 after parsing, but original was not 0 or "0".');
            return res.status(400).json({ message: 'Style price must be a valid number.' });
        }
        if (cleanMaterial.pricePerYard === 0 && material.pricePerYard !== 0 && material.pricePerYard !== "0") {
            console.error('Controller Error: Material price per yard became 0 after parsing, but original was not 0 or "0".');
            return res.status(400).json({ message: 'Material price per yard must be a valid number.' });
        }

        // Validate essential properties for the schema requirements
        if (!cleanStyle.title || !cleanStyle.image || !cleanMaterial.name || !cleanMaterial.image) {
            console.error('Controller Error: Missing required style/material properties (title, name, image).');
            return res.status(400).json({ message: 'Style title, style image, material name, and material image are required.' });
        }

        // Cloudinary upload for style image
        let styleImageUrl = cleanStyle.image;
        if (cleanStyle.image && typeof cleanStyle.image === 'string' && cleanStyle.image.startsWith('data:image')) {
            try {
                const uploadedStyle = await cloudinary.uploader.upload(cleanStyle.image, {
                    folder: 'orders/styles',
                });
                styleImageUrl = uploadedStyle.secure_url;
            } catch (uploadError) {
                console.error("Cloudinary style image upload failed:", uploadError);
                return res.status(500).json({ message: "Failed to upload style image." });
            }
        } else if (!cleanStyle.image) {
            console.error('Controller Error: Style image is missing (after initial check).');
            return res.status(400).json({ message: 'Style image is required.' });
        }

        // Cloudinary upload for material image
        let materialImageUrl = cleanMaterial.image;
        if (cleanMaterial.image && typeof cleanMaterial.image === 'string' && cleanMaterial.image.startsWith('data:image')) {
            try {
                const uploadedMaterial = await cloudinary.uploader.upload(cleanMaterial.image, {
                    folder: 'orders/materials',
                });
                materialImageUrl = uploadedMaterial.secure_url;
            } catch (uploadError) {
                console.error("Cloudinary material image upload failed:", uploadError);
                return res.status(500).json({ message: "Failed to upload material image." });
            }
        } else if (!cleanMaterial.image) {
            console.error('Controller Error: Material image is missing (after initial check).');
            return res.status(400).json({ message: 'Material image is required.' });
        }

        // Get user details to populate customerName and customerEmail in the order
        const user = await User.findById(userId);
        if (!user) {
            console.error('Controller Error: User not found for ID:', userId);
            return res.status(404).json({ message: 'User not found' });
        }

        const cleanedMeasurements = typeof measurements === 'string' ? measurements.trim() : '';

        // *** START OF THE CRUCIAL CHANGE: Calculate totalPrice here ***
        const calculatedTotalPrice = cleanStyle.price + (cleanMaterial.pricePerYard * cleanStyle.yardsRequired);
        console.log(`Controller: Calculated totalPrice before creating Order instance: ${calculatedTotalPrice}`);
        // *** END OF THE CRUCIAL CHANGE ***

        console.log('Controller: Creating new Order instance...');
        // Create the order, including the calculated totalPrice
        const newOrder = new Order({
            user: userId,
            customerName: user.name,
            customerEmail: user.email,
            orderType: orderType,
            style: {
                ...cleanStyle,
                image: styleImageUrl
            },
            material: {
                ...cleanMaterial,
                image: materialImageUrl
            },
            measurements: cleanedMeasurements,
            notes: notes || '',
            status: 'pending',
            paymentStatus: 'unpaid',
            totalPrice: calculatedTotalPrice, // <--- Assign the calculated price here
        });

        console.log('Controller: Calling newOrder.save()...');
        await newOrder.save(); // The pre-save hook will still run and can re-calculate/verify

        console.log('Controller: Order saved successfully.');

        // Create notification for the user
        await Notification.create({
            user: userId,
            title: 'New Order Placed',
            message: `Your order for ${newOrder.style.title} has been received and is being processed.`,
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
                    <p><strong>Style:</strong> ${newOrder.style.title}</p>
                    <p><strong>Material:</strong> ${newOrder.material.name}</p>
                    <p><strong>Estimated Total:</strong> ₦${newOrder.totalPrice.toLocaleString()}</p>
                    <p>We'll get back to you soon with updates.</p>
                `,
            });

            await sendEmail({
                to: process.env.ADMIN_EMAIL, // Use an environment variable for admin email
                subject: 'New Order Received',
                html: `
                    <h2>New Order Received!</h2>
                    <p><strong>Customer:</strong> ${user.name} (${user.email})</p>
                    <p><strong>Order ID:</strong> ${newOrder._id}</p>
                    <p><strong>Order Type:</strong> ${newOrder.orderType}</p>
                    <p><strong>Style:</strong> ${newOrder.style.title}</p>
                    <p><strong>Material:</strong> ${newOrder.material.name}</p>
                    <p><strong>Measurements:</strong> ${newOrder.measurements || 'None'}</p> <p><strong>Notes:</strong> ${notes || 'None'}</p>
                    <p><strong>Total:</strong> ₦${newOrder.totalPrice.toLocaleString()}</p>
                    <p>Login to the admin panel to manage this order.</p>
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
        console.error('Order creation error caught in controller:', err);
        console.error('Full error object:', JSON.stringify(err, null, 2));

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

// GET all orders for a specific user (User dashboard view)
export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, status, paymentStatus } = req.query;

    const filter = { user: userId };
    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    const skip = (parseInt(page) - 1) * parseInt(limit); // Ensure limit is parsed

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'name email'); // Populate user details if needed for display

    const totalOrders = await Order.countDocuments(filter);

    res.status(200).json({
      message: 'Orders retrieved successfully',
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOrders / parseInt(limit)), // Ensure limit is parsed
        totalOrders,
        hasNextPage: parseInt(page) * parseInt(limit) < totalOrders,
        hasPrevPage: parseInt(page) > 1
      }
    });

  } catch (err) {
    console.error('Error fetching user orders:', err);
    res.status(500).json({ message: 'Failed to fetch user orders' });
  }
};

// GET single order by ID for a user (User dashboard view)
export const getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id; // Ensure user can only access their own orders

    const order = await Order.findOne({ _id: orderId, user: userId })
      .populate('user', 'name email');

    if (!order) {
      return res.status(404).json({ message: 'Order not found or you do not have access to it.' });
    }

    res.status(200).json({
      message: 'Order retrieved successfully',
      order
    });

  } catch (err) {
    console.error('Error fetching single order:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid order ID format.' });
    }
    res.status(500).json({ message: 'Failed to fetch order' });
  }
};

// UPDATE order (User-specific update - limited fields)
export const updateOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    const { notes } = req.body; // Users can only update notes, or certain other fields

    const order = await Order.findOne({ _id: orderId, user: userId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found or you do not have access to it.' });
    }

    // Prevent updates if order is already being processed or completed
    if (['in-progress', 'completed', 'cancelled', 'ready-for-pickup'].includes(order.status)) {
      return res.status(400).json({ message: `Order status is '${order.status}'. Modifications are no longer allowed.` });
    }

    const updateData = {};
    if (notes !== undefined) updateData.notes = notes;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update.' });
    }

    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true, runValidators: true }
    ).populate('user', 'name email');

    res.status(200).json({
      message: 'Order updated successfully',
      order: updatedOrder
    });

  } catch (err) {
    console.error('Error updating order:', err);
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(error => error.message);
      return res.status(400).json({
        message: 'Validation failed',
        errors
      });
    }
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid order ID format.' });
    }
    res.status(500).json({ message: 'Failed to update order' });
  }
};


// DELETE order (User soft delete - change status to cancelled)
export const deleteOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id; // Only allow user to cancel their own order

    const order = await Order.findOne({ _id: orderId, user: userId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found or you do not have access to it.' });
    }

    // Check if order can be cancelled by user
    if (['completed', 'cancelled', 'in-progress', 'ready-for-pickup'].includes(order.status)) {
      return res.status(400).json({
        message: `Cannot cancel order with status '${order.status}'. Please contact support for assistance.`
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
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid order ID format.' });
    }
    res.status(500).json({ message: 'Failed to cancel order' });
  }
};

// --- ADMIN-SPECIFIC ORDER CONTROLLERS ---

// @desc    Get all orders (Admin only)
// @route   GET /api/orders/admin
// @access  Private/Admin
export const getAdminOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      paymentStatus,
      searchTerm,
      sortBy = 'createdAt', // Default sort by creation date
      sortOrder = 'desc', // Default sort descending
      orderType, // New filter for order type
    } = req.query;

    let query = {};
    if (status && status !== 'All') query.status = status;
    if (paymentStatus && paymentStatus !== 'All') query.paymentStatus = paymentStatus;
    if (orderType && orderType !== 'All') query.orderType = orderType;

    if (searchTerm) {
      query.$or = [
        { customerName: { $regex: searchTerm, $options: 'i' } },
        { customerEmail: { $regex: searchTerm, $options: 'i' } },
        { 'style.title': { $regex: searchTerm, $options: 'i' } },
        { 'material.name': { $regex: searchTerm, $options: 'i' } },
        { _id: { $regex: searchTerm, $options: 'i' } }, // Search by MongoDB _id (similar to order ID)
        // If you had a custom orderId field, you'd add it here:
        // { orderId: { $regex: searchTerm, $options: 'i' } },
      ];
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await Order.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));
      // .populate('user', 'name email'); // No need to populate if customerName/Email are stored directly

    const totalOrders = await Order.countDocuments(query);

    res.status(200).json({
      orders: orders.map(formatOrderForAdminFrontend), // Format for frontend
      totalOrders,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalOrders / parseInt(limit)),
    });

  } catch (error) {
    console.error('Error fetching all orders (Admin):', error);
    res.status(500).json({ message: 'Server error fetching orders.' });
  }
};

// @desc    Get single order by ID (Admin only) - more detailed view
// @route   GET /api/orders/admin/:id
// @access  Private/Admin
export const getAdminOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email phone address'); // Populate user info for full receipt

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    // Return the raw order object for detailed admin view
    res.status(200).json(order);
  } catch (error) {
    console.error('Error fetching order by ID (Admin):', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid order ID format.' });
    }
    res.status(500).json({ message: 'Server error fetching order.' });
  }
};


// @desc    Update order status and details (Admin only)
// @route   PUT /api/orders/admin/:id
// @access  Private/Admin
export const updateOrderAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, paymentStatus, notes, orderType, // Admin can update these
            style, material, measurements, // If admin can modify these post-creation
            totalPrice } = req.body;

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const oldStatus = order.status;
    const oldPaymentStatus = order.paymentStatus;

    // Update fields if provided
    if (status !== undefined) order.status = status;
    if (paymentStatus !== undefined) order.paymentStatus = paymentStatus;
    if (notes !== undefined) order.notes = notes;
    if (orderType !== undefined) order.orderType = orderType;

    // Admin can potentially update style/material/measurements/totalPrice directly
    // Be careful with these - ensure proper validation if allowing
    if (totalPrice !== undefined) order.totalPrice = totalPrice;
    if (style !== undefined) order.style = style; // Consider deep merging instead of direct replacement
    if (material !== undefined) order.material = material;
    if (measurements !== undefined) order.measurements = measurements;

    const updatedOrder = await order.save(); // The pre-save hook for totalPrice will run if style/material changed

    // Send notification and email for status changes (if different from old status)
    if (status && status !== oldStatus) {
      const user = await User.findById(updatedOrder.user);
      if (user) {
        await Notification.create({
          user: user._id,
          title: 'Order Status Update',
          message: `Your order for ${updatedOrder.style.title} is now ${updatedOrder.status}.`,
        });

        try {
          await sendEmail({
            to: user.email,
            subject: `Order Status Update: ${updatedOrder.style.title}`,
            html: `
              <h2>Order Status Update</h2>
              <p>Dear ${user.name},</p>
              <p>The status of your order for <strong>${updatedOrder.style.title}</strong> (Order ID: ${updatedOrder._id}) has been updated to: <strong>${updatedOrder.status}</strong>.</p>
              <p>Thank you for your patience!</p>
            `,
          });
        } catch (emailError) {
          console.error('Error sending status update email:', emailError);
        }
      }
    }

    // Send notification and email for payment status changes
    if (paymentStatus && paymentStatus !== oldPaymentStatus) {
        const user = await User.findById(updatedOrder.user);
        if (user) {
            await Notification.create({
                user: user._id,
                title: 'Payment Status Update',
                message: `The payment status for your order (${updatedOrder.style.title}) is now ${updatedOrder.paymentStatus}.`,
            });
            try {
                await sendEmail({
                    to: user.email,
                    subject: `Payment Status Update: ${updatedOrder.style.title}`,
                    html: `
                        <h2>Payment Status Update</h2>
                        <p>Dear ${user.name},</p>
                        <p>The payment status for your order for <strong>${updatedOrder.style.title}</strong> (Order ID: ${updatedOrder._id}) has been updated to: <strong>${updatedOrder.paymentStatus}</strong>.</p>
                        <p>Thank you!</p>
                    `,
                });
            } catch (emailError) {
                console.error('Error sending payment status update email:', emailError);
            }
        }
    }

    res.status(200).json({
      message: 'Order updated successfully',
      order: formatOrderForAdminFrontend(updatedOrder), // Send formatted data back
    });
  } catch (error) {
    console.error('Error updating order (Admin):', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid order ID format.' });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: 'Validation failed', errors });
    }
    res.status(500).json({ message: 'Server error updating order.' });
  }
};


// @desc    Delete order (Admin only - hard delete)
// @route   DELETE /api/orders/admin/:id
// @access  Private/Admin
export const deleteOrderAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findByIdAndDelete(id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Optional: Delete associated Cloudinary images if order is hard deleted
    // if (order.style?.image) {
    //   const publicId = order.style.image.split('/').pop().split('.')[0];
    //   await cloudinary.uploader.destroy(`orders/styles/${publicId}`);
    // }
    // if (order.material?.image) {
    //   const publicId = order.material.image.split('/').pop().split('.')[0];
    //   await cloudinary.uploader.destroy(`orders/materials/${publicId}`);
    // }

    res.status(200).json({ message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Error deleting order (Admin):', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid order ID format.' });
    }
    res.status(500).json({ message: 'Server error deleting order.' });
  }
};