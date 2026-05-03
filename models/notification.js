// models/notification.js
import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    order:   { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    title:   { type: String, required: true },
    message: { type: String, required: true },

    type: {
      type: String,
      enum: [
        'order_status',          // order created, cancelled, deleted, status updated
        'payment_success',       // payment verified successfully
        'payment_failed',        // payment verification failed
        'payment_status_update', // admin manually updated payment status
        'order_progress',        // daily progress update (material ready, cut, sewn, etc.)
        'delivery_imminent',     // day 6 — delivery tomorrow notification
        'info',                  // generic informational
        'success',               // generic success
        'warning',               // generic warning
        'error',                 // generic error
      ],
      default: 'info',
    },

    category: {
      type: String,
      enum: ['style', 'material', 'order', 'measurement', 'admin'],
      default: 'order',
    },

    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.Notification || mongoose.model('Notification', notificationSchema);