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

  // ── Family / multi-person checkout ────────────────────────────────────────
  // When a customer orders for several people (e.g. a couple, a family) in
  // one checkout, every resulting Order document shares the same
  // orderGroupId. Each document still represents exactly one person's
  // style + material + measurement, which keeps every other part of the
  // system (admin views, single-order emails, cancellation) unchanged.
  // recipientLabel is a free-text tag ("Mum", "Tolu", "Person 2") so the
  // tailor and the admin dashboard can tell the items in a group apart.
  orderGroupId:   { type: String, default: null, index: true },
  recipientLabel: { type: String, default: '' },

  style:    { type: styleSchema,    required: true },
  material: { type: materialSchema, required: true },

  // A real saved measurement is now mandatory for every order — there is no
  // body-build / silhouette fallback. Always an array (possibly length 1)
  // for forward-compatibility with the frontend's measurement selector.
  measurements: { type: mongoose.Schema.Types.Mixed, required: true },

  measurementRequest: {
    requested: { type: Boolean, default: false },
    fee:       { type: Number,  default: 1500  },
    paid:      { type: Boolean, default: false },
  },

  notes: { type: String, default: '' },

  // ── Delivery (snapshotted from the customer's profile at order creation) ──
  // Snapshotting instead of referencing the live User doc means editing a
  // profile address later never silently changes where an already-placed
  // order gets delivered — the order always ships to what was on file the
  // moment it was paid for. `location` is optional (not every customer pins
  // GPS); `notes` is a free-text landmark/gate-colour field for the rider,
  // distinct from the style-customization `notes` field above. All orders
  // in the same group share one delivery snapshot (one household, one drop-off).
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

  // ✅ FIX: totalPrice is set explicitly on creation and NEVER recalculated
  // on subsequent saves. Recalculation was causing the Paystack amount
  // mismatch: controller sets paymentStatus='paid' then calls order.save(),
  // the pre-save hook was recalculating totalPrice which could differ from
  // what Paystack verified, making all future saves fail the amount check.
  totalPrice: { type: Number, required: true, min: 0 },

  // ✅ NULL until payment is verified — set by controller, not by model hook
  expectedDeliveryDate: { type: Date, default: null },

  // Unique per order document. For a group checkout, the raw Paystack
  // reference is shared across items, so each document stores a
  // per-item-suffixed version here (to satisfy uniqueness) while the raw,
  // shared reference is kept in groupPaymentReference for reuse-detection
  // and lookups across the whole group.
  paymentReference:      { type: String, unique: true, sparse: true },
  groupPaymentReference: { type: String, default: null, index: true },

  paymentChannel: { type: String, default: 'card' },

  // ── Cancellation ───────────────────────────────────────────────────────
  // Set by the client-facing cancelOrder controller. paymentStatus is left
  // untouched on cancel — if the order was already paid, that history is
  // preserved (refunds are a separate, unimplemented flow); if it was
  // still unpaid, it simply never gets charged.
  cancellationReason: { type: String, default: null },
  cancelledAt:         { type: Date,   default: null },

}, { timestamps: true });

// ── Pre-save: ONLY auto-fill customer info on new documents ──────────────────
// ✅ FIX: Removed totalPrice recalculation from pre-save entirely.
//    Removed expectedDeliveryDate + status mutation from pre-save entirely.
//    Both are now the sole responsibility of the controller after payment,
//    preventing double-execution and race conditions.
orderSchema.pre('save', async function (next) {
  // Auto-fill customer name/email from User only when missing on new docs
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

/**
 * Calculate total price for a new order.
 * Call this explicitly in the controller before Order.create(),
 * so the value stored in the DB exactly matches what Paystack charges.
 *
 * @param {object} style       - style sub-document
 * @param {object} material    - material sub-document
 * @param {object} measurementRequest - { requested, fee }
 * @returns {number} total in Naira
 */
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

/**
 * Add N working days (Mon–Fri) to a date, skipping weekends.
 */
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