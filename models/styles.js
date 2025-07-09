import mongoose from 'mongoose';
const { Schema } = mongoose; // Destructure Schema

const StyleSchema = new Schema({
  title: { type: String, required: true, trim: true },
  type: { type: String, required: true, enum: ['Traditional', 'Casual', 'Modern', 'Corporate', 'Dashiki', 'Suit', 'Dress', 'Jumpsuit'] },
  gender: { type: String, required: true, enum: ['Male', 'Female', 'Unisex'] },
  ageGroup: { type: String, required: true, enum: ['Adult', 'Teen', 'Kid'] },
  price: { type: Number, required: true, min: 0 },
  image: { type: String, required: true }, // Store Cloudinary URL here
  description: { type: String, required: true, trim: true },
  details: { type: String, required: true, trim: true },
  colour: { type: String, trim: true, default: '' },
  recommendedMaterials: [{ type: String, trim: true }],
  yardsRequired: { type: String, trim: true, default: '' },
  tags: [{ type: String, trim: true }],
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