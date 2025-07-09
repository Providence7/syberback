import mongoose from 'mongoose';

const styleSchema = new mongoose.Schema({
  title: String,
  price: Number,
  yardsRequired: Number,
  recommendedMaterials: [String],
  image: {
    type: String, // Cloudinary URL
    required: true,
  },
}, { _id: false });

const materialSchema = new mongoose.Schema({
  name: String,
  type: String,
  pricePerYard: Number,
  image: {
    type: String, // Cloudinary URL
    required: true,
  },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Reference to User model
    required: true,
  },
  style: {
    type: styleSchema,
    required: true,
  },
  material: {
    type: materialSchema,
    required: true,
  },
  measurements: [
    {
      type: String, // Only the measurement name is stored
      required: true,
    }
  ],
  notes: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'completed', 'cancelled'],
    default: 'pending',
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid'],
    default: 'unpaid',
  },
}, { timestamps: true });

export default mongoose.model('Order', orderSchema);
