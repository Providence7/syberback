import mongoose from 'mongoose';
const { Schema } = mongoose;

const StyleSchema = new Schema({
  title: { type: String, required: true, trim: true },
  type: { type: String, required: true, enum: ['Traditional', 'Casual', 'Modern', 'Corporate', 'Dashiki', 'Suit', 'Dress', 'Jumpsuit'] },
  gender: { type: String, required: true, enum: ['Male', 'Female', 'Unisex'] },
  ageGroup: { type: String, required: true, enum: ['Adult', 'Teen', 'Kid'] },
  price: { type: Number, required: true, min: 0 },
  image: { type: String, required: true },
  cloudinary_id: { type: String, required: true },
  description: { type: String, required: true },
  details: { type: String, required: true },
  colour: String,
  recommendedMaterials: [String],
  // Removed yardsRequired and added materialQuantities to match the frontend
  materialQuantities: {
    type: Map,
    of: String,
    default: {} // Set a default empty object to avoid errors
  },
  tags: [String],
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('Style', StyleSchema);