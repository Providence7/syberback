// src/models/Order.js
import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    styleSource: String,
    styleTitle: String,
    styleImage: String,
    styleImageId: String, // <--- for Cloudinary deletion
    stylePrice: { type: Number, default: 0 },

    materialSource: String,
    materialTitle: String,
    materialImage: String,
    materialImageId: String, // <--- for Cloudinary deletion
    materialPrice: { type: Number, default: 0 },

    measurement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Measurement',
      required: true,
    },
    note: String,
    isUnderReview: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['under_review', 'submitted', 'completed'],
      default: 'submitted',
    },
  },
  { timestamps: true }
);

export default mongoose.model('Order', orderSchema);
