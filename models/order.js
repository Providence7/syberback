// src/models/Order.js
import mongoose from 'mongoose';

const styleSchema = new mongoose.Schema({
  title: String,
  price: Number, 
  yardsRequired: Number, 
  recommendedMaterials: [String],
  image: {
    type: String, 
    required: true,
  },
}, { _id: false });

const materialSchema = new mongoose.Schema({
  name: String,
  type: String,
  pricePerYard: Number, 
  image: {
    type: String, 
    required: true,
  },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', 
    required: true,
  },
  customerName: {
    type: String,
    required: true,
  },
  customerEmail: {
    type: String,
    required: true,
  },
  orderType: {
    type: String,
    enum: ['Online', 'In-Person', 'Scheduled'],
    default: 'Online',
  },
  style: {
    type: styleSchema,
    required: true,
  },
  material: {
    type: materialSchema,
    required: true,
  },
  // FIXED: Changed from String to Mixed to accept the Measurement Object/Array
  measurements: {
    type: mongoose.Schema.Types.Mixed,
  },
  // models/Order.js — add inside orderSchema, after the measurements field
measurementRequest: {
  requested: { type: Boolean, default: false },
  fee:        { type: Number,  default: 1500  },
  paid:       { type: Boolean, default: false },
},
  notes: {
    type: String,
    default: '',
  },
  status: {
  type: String,
  enum: [
    'pending', 
    'pendingPayment', // <--- Add this line
    'in-progress', 
    'completed', 
    'cancelled', 
    'ready-for-pickup'
  ],
  default: 'pending',
},
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid', 'failed', 'refunded'],
    default: 'unpaid',
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  expectedDeliveryDate: {
    type: Date,
    default: null, 
  },
  paymentReference: {
    type: String,
    unique: true,
    sparse: true,
  },
}, { timestamps: true });
orderSchema.pre('save', async function(next) {
  if (this.isNew && this.user && (!this.customerName || !this.customerEmail)) {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(this.user);
      if (user) {
        this.customerName = user.name;
        this.customerEmail = user.email;
      }
    } catch (error) {
      console.error('Error populating customer info:', error);
    }
  }

  if (
    this.isNew ||
    this.isModified('style') ||
    this.isModified('material') ||
    this.isModified('measurementRequest')   // ← recalculate when toggled
  ) {
    const stylePrice           = parseFloat(this.style?.price)            || 0;
    const materialPricePerYard = parseFloat(this.material?.pricePerYard)  || 0;
    const yardsRequired        = parseFloat(this.style?.yardsRequired)    || 0;
    const measurementFee       = this.measurementRequest?.requested
                                   ? (this.measurementRequest.fee || 1500)
                                   : 0;

    const total = stylePrice + (materialPricePerYard * yardsRequired) + measurementFee;
    this.totalPrice = isNaN(total) ? 0 : total;
  }

  next();
});

export default mongoose.models.Order || mongoose.model('Order', orderSchema);