// now create the contoller , rememeber im using cloudinary , add in app notification and email to both client and admin
// models/Order.js
import mongoose from 'mongoose';

const OrderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Optional: assuming you have user auth
    required: true,
  },
  style: {
    id: { type: String, required: true },
    title: { type: String, required: true },
    image: { type: String, required: true }, // Cloudinary image URL
    price: { type: Number, required: true },
    yardsRequired: { type: Number, required: true },
    recommendedMaterials: [{ type: String }],
  },
  material: {
    id: { type: String, required: true },
    name: { type: String, required: true },
    image: { type: String, required: true }, // Cloudinary image URL
    type: { type: String },
    pricePerYard: { type: Number, required: true },
  },
 measurements: {
  type: [String], // array of selected measurement names
  default: [],
},
  notes: {
    type: String,
    default: '',
  },
  totalCost: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'paid', 'cancelled'],
    default: 'pending',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model('Order', OrderSchema);
