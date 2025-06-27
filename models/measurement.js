import mongoose from 'mongoose';

const measurementSchema = new mongoose.Schema({
  name: { type: String, required: true },
  photoUrl: String,
  photoPublicId: String,
  unit: { type: String, enum: ['cm','in'], default: 'cm' },
  gender: String,
  data: mongoose.Schema.Types.Mixed,
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

export default mongoose.model('Measurement', measurementSchema);
