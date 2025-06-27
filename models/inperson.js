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
  date: { type: String, required: true },
  time: { type: String, required: true },
}, { timestamps: true });

export default mongoose.models.InPersonOrder || mongoose.model('InPersonOrder', inPersonOrderSchema);
