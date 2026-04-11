// models/Notification.js
import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title:    { type: String, required: true },
    message:  { type: String, required: true },
    type:     { type: String, enum: ['info', 'success', 'warning', 'error'], default: 'info' },
    category: { type: String, enum: ['style', 'material', 'order', 'measurement', 'admin'], default: 'admin' },
    read:     { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.Notification || mongoose.model('Notification', notificationSchema);