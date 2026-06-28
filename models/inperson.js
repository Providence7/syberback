import mongoose from 'mongoose';

const inPersonOrderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
  name:        { type: String, required: true },
  phone:       { type: String, required: true },
  address:     { type: String, required: true },
  date:        { type: Date, required: true },
  time:        { type: String, required: true },
  serviceType: { type: String, required: true }, // garment / commission type
  notes:       { type: String },

  // ✅ NEW — needed because the controller already relies on `status`
  //    (getAllOrders filters out 'cancelled', deleteOrder soft-deletes
  //    admin cancellations by setting this field). Without it, those
  //    queries were silently matching nothing/everything.
  status: {
    type: String,
    enum: ['booked', 'completed', 'cancelled'],
    default: 'booked',
  },
}, { timestamps: true });

// ✅ FIX — double-booking guard.
// `date` already encodes the exact slot start time (the frontend builds it
// as `new Date(date + 'T' + timeParsed)`), so two bookings for the same
// calendar date + same time slot produce an identical `date` value down to
// the millisecond. A unique index on `date` therefore guarantees the
// database itself rejects a second booking for an already-taken slot, even
// if two requests race each other at the exact same moment — something an
// application-level "check then insert" can never fully prevent.
//
// The partialFilterExpression excludes cancelled appointments, so a
// cancelled slot frees itself up for a new booking.
inPersonOrderSchema.index(
  { date: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $ne: 'cancelled' } },
  }
);

export default mongoose.models.InPersonOrder || mongoose.model('InPersonOrder', inPersonOrderSchema);