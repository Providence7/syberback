import mongoose from 'mongoose';
const { Schema } = mongoose; // Destructure Schema

const StyleSchema = new Schema({
  title: { type: String, required: true, trim: true },
  type: { type: String, required: true, enum: ['Traditional', 'Casual', 'Modern', 'Corporate', 'Dashiki', 'Suit', 'Dress', 'Jumpsuit'] },
  gender: { type: String, required: true, enum: ['Male', 'Female', 'Unisex'] },
  ageGroup: { type: String, required: true, enum: ['Adult', 'Teen', 'Kid'] },
  price: { type: Number, required: true, min: 0 },
   image: { type: String, required: true }, // Cloudinary URL
  cloudinary_id: { type: String, required: true }, // Cloudinary public ID for deletion
  description: { type: String, required: true },
  details: { type: String, required: true },
  colour: String,
  recommendedMaterials: [String], // Array of strings
  yardsRequired: Number,
  tags: [String], // Array of strings
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