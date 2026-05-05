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
  date: { type: Date, required: true },
  time: { type: String, required: true },
  serviceType: { type: String, required: true }, // ✅ NEW — garment / commission type
  notes: { type: String },
}, { timestamps: true });

export default mongoose.models.InPersonOrder || mongoose.model('InPersonOrder', inPersonOrderSchema);