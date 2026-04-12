// src/models/Order.js
import mongoose from 'mongoose';

const styleSchema = new mongoose.Schema({
  title: String,
  price: Number,
  yardsRequired: Number,
  materialQuantityDisplay: String,
  recommendedMaterials: [String],
  image: { type: String, required: true },
}, { _id: false });

const materialSchema = new mongoose.Schema({
  name: String,
  type: String,
  pricePerYard: Number,
  color: String,
  description: String,
  image: { type: String, required: true },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  customerName:  { type: String, required: true },
  customerEmail: { type: String, required: true },

  orderType: {
    type: String,
    enum: ['Online', 'In-Person', 'Scheduled'],
    default: 'Online',
  },

  style:    { type: styleSchema,    required: true },
  material: { type: materialSchema, required: true },

  measurements: { type: mongoose.Schema.Types.Mixed },

  measurementRequest: {
    requested: { type: Boolean, default: false },
    fee:       { type: Number,  default: 1500  },
    paid:      { type: Boolean, default: false },
  },

  notes: { type: String, default: '' },

  status: {
    type: String,
    enum: [
      'pendingPayment', // ✅ default before payment
      'in-progress',    // ✅ set after payment verified
      'completed',      // ✅ admin marks as delivered
      'cancelled',
      'ready-for-pickup',
    ],
    default: 'pendingPayment', // ✅ always starts here — no delivery date yet
  },

  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid', 'failed', 'refunded'],
    default: 'unpaid',
  },

  totalPrice: { type: Number, required: true, min: 0 },

  // ✅ NULL until payment is verified — never set on creation
  expectedDeliveryDate: { type: Date, default: null },

  paymentReference: { type: String, unique: true, sparse: true },

  paymentChannel: { type: String, default: 'card' },

  measurementRequested: { type: Boolean, default: false },
  requestedSize:        { type: String },

}, { timestamps: true });

// ── Pre-save: auto-fill customer info & recalculate total ─────────────────────
orderSchema.pre('save', async function (next) {
  // Auto-fill customer name/email from User if missing
  if (this.isNew && this.user && (!this.customerName || !this.customerEmail)) {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(this.user);
      if (user) {
        this.customerName  = user.name;
        this.customerEmail = user.email;
      }
    } catch (err) {
      console.error('Error populating customer info:', err);
    }
  }

  // Recalculate total when relevant fields change
  if (
    this.isNew ||
    this.isModified('style') ||
    this.isModified('material') ||
    this.isModified('measurementRequest')
  ) {
    const stylePrice           = parseFloat(this.style?.price)           || 0;
    const materialPricePerYard = parseFloat(this.material?.pricePerYard) || 0;
    const yardsRequired        = parseFloat(this.style?.yardsRequired)   || 0;
    const measurementFee       = this.measurementRequest?.requested
                                   ? (this.measurementRequest.fee || 1500)
                                   : 0;

    const total = stylePrice + (materialPricePerYard * yardsRequired) + measurementFee;
    this.totalPrice = isNaN(total) ? 0 : total;
  }

  // ✅ Set expectedDeliveryDate to 7 WORKING DAYS after payment is verified.
  // Only runs the first time paymentStatus flips to 'paid'.
  if (this.isModified('paymentStatus') && this.paymentStatus === 'paid' && !this.expectedDeliveryDate) {
    this.expectedDeliveryDate = addWorkingDays(new Date(), 7);
    this.status = 'in-progress'; // ✅ auto-advance status on payment
  }

  next();
});

/**
 * Add N working days (Mon–Fri) to a date, skipping weekends.
 */
function addWorkingDays(startDate, days) {
  const date = new Date(startDate);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added++; // skip Sunday (0) and Saturday (6)
  }
  return date;
}

export default mongoose.models.Order || mongoose.model('Order', orderSchema);