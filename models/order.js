// src/models/Order.js
import mongoose from 'mongoose';

const styleSchema = new mongoose.Schema({
  title: String,
  price: Number,
  yardsRequired: Number,
  materialQuantityDisplay: String,
  // ✅ NEW: snapshotted from Style.materialUnit at order time. Needed so the
  // pre-validate check below (and any future audit/support lookup) can
  // confirm the order was created with a compatible fabric — independent
  // of whatever the live Style document says later.
  materialUnit: String,
  recommendedMaterials: [String],
  image: { type: String, required: true },
}, { _id: false });

const materialSchema = new mongoose.Schema({
  name: String,
  type: String,
  pricePerYard: Number,
  // ✅ NEW: snapshotted from Fabric.unit at order time.
  unit: String,
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

  orderGroupId:   { type: String, default: null, index: true },
  recipientLabel: { type: String, default: '' },

  style:    { type: styleSchema,    required: true },
  material: { type: materialSchema, required: true },

  measurements: { type: mongoose.Schema.Types.Mixed, default: null },

  measurementRequested: { type: Boolean, default: false },
  requestedSize:        { type: String, default: null },

  measurementRequest: {
    requested: { type: Boolean, default: false },
    fee:       { type: Number,  default: 1500  },
    paid:      { type: Boolean, default: false },
  },

  notes: { type: String, default: '' },

  delivery: {
    phone:   { type: String, required: true },
    address: { type: String, required: true },
    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    notes: { type: String, default: '' },
  },

  status: {
    type: String,
    enum: [
      'pendingPayment',
      'in-progress',
      'completed',
      'cancelled',
      'ready-for-pickup',
    ],
    default: 'pendingPayment',
  },

  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid', 'failed', 'refunded'],
    default: 'unpaid',
  },

  totalPrice: { type: Number, required: true, min: 0 },

  // ✅ NEW: delivery fee priced by distance from Iwo Road (see
  // utils/transportFee.js). Already folded into totalPrice at order-creation
  // time — stored separately here so receipts/admin views can show it as its
  // own line without recomputing. For group orders this is each order's
  // prorated share of one combined delivery fee for the whole group.
  transportFee:        { type: Number, default: 0, min: 0 },
  transportDistanceKm: { type: Number, default: null },

  expectedDeliveryDate: { type: Date, default: null },

  paymentReference:      { type: String, unique: true, sparse: true },
  groupPaymentReference: { type: String, default: null, index: true },

  paymentChannel: { type: String, default: 'card' },

  cancellationReason: { type: String, default: null },
  cancelledAt:         { type: Date,   default: null },

}, { timestamps: true });

orderSchema.pre('save', async function (next) {
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

  next();
});

// ✅ NEW: last line of defense. Even if the frontend picker and the
// controller-level check (assertFabricUnitCompatible, below) both somehow
// get bypassed, no Order document can ever be saved with a style/material
// unit mismatch — this fires on every .save() and Order.create() call.
orderSchema.pre('validate', function (next) {
  if (
    this.style?.materialUnit &&
    this.material?.unit &&
    this.style.materialUnit !== this.material.unit
  ) {
    return next(new Error(
      `Unit mismatch: "${this.style.title}" requires material priced per ${this.style.materialUnit}, ` +
      `but "${this.material.name}" is priced per ${this.material.unit}.`
    ));
  }
  next();
});

/**
 * Throws if a style/material pair have incompatible units. Call this
 * explicitly in the order controller BEFORE building the order payload,
 * so you can return a clean 400 with a user-facing message instead of
 * relying on the raw mongoose ValidationError from the hook above.
 *
 * @param {object} style    - must include materialUnit
 * @param {object} material - must include unit
 */
export function assertFabricUnitCompatible(style, material) {
  if (
    style?.materialUnit &&
    material?.unit &&
    style.materialUnit !== material.unit
  ) {
    const err = new Error(
      `"${material.name}" is priced per ${material.unit}, but "${style.title}" requires a material priced per ${style.materialUnit}.`
    );
    err.statusCode = 400;
    throw err;
  }
}

export function calculateOrderTotal(style, material, measurementRequest = {}) {
  const stylePrice           = parseFloat(style?.price)           || 0;
  const materialPricePerYard = parseFloat(material?.pricePerYard) || 0;
  const yardsRequired        = parseFloat(style?.yardsRequired)   || 0;
  const measurementFee       = measurementRequest?.requested
                                 ? (measurementRequest.fee || 1500)
                                 : 0;

  const total = stylePrice + (materialPricePerYard * yardsRequired) + measurementFee;
  return isNaN(total) ? 0 : total;
}

export function addWorkingDays(startDate, days) {
  const date = new Date(startDate);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return date;
}

export default mongoose.models.Order || mongoose.model('Order', orderSchema);