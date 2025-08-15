// models/inperson.js
import mongoose from 'mongoose';

const inPersonOrderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  date: { type: Date, required: true }, // <-- IMPORTANT: Changed from String to Date
  time: { type: String, required: true }, // Still String for time slot (e.g., "10:00 AM")
  status: { // <-- NEW FIELD: Added status for managing order lifecycle
    type: String,
    enum: ['pending', 'confirmed', 'in-progress', 'completed', 'cancelled'],
    default: 'pending',
  },
  notes: { type: String }, // <-- NEW FIELD: For general notes on the in-person order
}, { timestamps: true });

export default mongoose.models.InPersonOrder || mongoose.model('InPersonOrder', inPersonOrderSchema);