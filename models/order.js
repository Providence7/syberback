// models/OnlineOrder.js
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const onlineOrderSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  styleSource: {
    type: String,
    enum: ['saved', 'upload', 'catalogue'],
    required: true,
  },
  styleImage: {
    type: String,
    required: true,
  },
  styleTitle: {
    type: String,
    required: true,
  },
  stylePrice: {
    type: Number,
    default: 0,
  },

  materialSource: {
    type: String,
    enum: ['saved', 'upload', 'tailor_supplied'],
    default: 'tailor_supplied',
  },
  materialImage: {
    type: String,
  },
  materialTitle: {
    type: String,
  },
  materialColor: {
    type: String,
  },
  materialPrice: {
    type: Number,
    default: 0,
  },

  tailorSupplyMaterial: {
    type: Boolean,
    default: true,
  },
  yardsNeeded: {
    type: Number,
  },
  pricePerYard: {
    type: Number,
  },

  measurement: {
    type: Schema.Types.ObjectId,
    ref: 'Measurement',
    required: true,
  },
  note: {
    type: String,
    trim: true,
  },

  status: {
    type: String,
    enum: ['pending', 'under_review', 'confirmed', 'in_progress', 'completed', 'cancelled'],
    default: 'pending',
  },
  totalPrice: {
    type: Number,
    required: true,
  },

  isUnderReview: {
    type: Boolean,
    default: false,
  },
  reviewReason: {
    type: String,
  },

  orderDate: {
    type: Date,
    default: Date.now,
  },
  estimatedDelivery: {
    type: Date,
  },
  actualDelivery: {
    type: Date,
  },
}, {
  timestamps: true,
});

// Pre-save middleware
onlineOrderSchema.pre('save', function (next) {
  this.totalPrice = (this.stylePrice || 0) + (this.materialPrice || 0);

  if (this.styleSource === 'upload') {
    this.isUnderReview = true;
    this.status = 'under_review';
    this.reviewReason = 'Manual style upload requires review';
  }

  next();
});

// Instance method
onlineOrderSchema.methods.calculateDeliveryEstimate = function () {
  const baseDeliveryDays = 5;
  const additionalDays = this.isUnderReview ? 2 : 0;

  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + baseDeliveryDays + additionalDays);

  this.estimatedDelivery = deliveryDate;
  return deliveryDate;
};

const OnlineOrder = model('OnlineOrder', onlineOrderSchema);
export default OnlineOrder;
