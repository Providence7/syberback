// src/models/notification.js
import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    // null = broadcast to all users; a user ObjectId = targeted
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // 'broadcast' = sent to everyone, 'targeted' = sent to one user
    scope: {
      type: String,
      enum: ['broadcast', 'targeted'],
      default: 'broadcast',
    },

    title:   { type: String, required: true },
    message: { type: String, required: true },

    // 'success' | 'info' | 'warning' | 'error'
    type: {
      type: String,
      enum: ['success', 'info', 'warning', 'error'],
      default: 'info',
    },

    // 'style' | 'material' | 'order' | 'measurement' | 'admin'
    category: {
      type: String,
      enum: ['style', 'material', 'order', 'measurement', 'admin'],
      default: 'admin',
    },

    // Optional extra data (e.g. { id, image } for a style)
    data: { type: mongoose.Schema.Types.Mixed, default: null },

    // Per-user read tracking
    // Stored as array of user IDs who have read this notification
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Who created this notification (admin user id)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true },
);

// Index for fast per-user queries
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ scope: 1,     createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);