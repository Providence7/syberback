import mongoose from 'mongoose';

const measurementSchema = new mongoose.Schema({
  name: { type: String, required: true },
  photoUrl: String,
  photoPublicId: String,
  unit: { type: String, enum: ['in'], default: 'in' },
  gender: String,
  // New fields added to the model
  size: {
    type: String,
    // This field stores the determined size (e.g., 'Small', 'Medium', 'Custom')
  },
  age: {
    type: String,
    // This field stores the age bracket as a string
  },
  data: mongoose.Schema.Types.Mixed,
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

export default mongoose.model('Measurement', measurementSchema);
