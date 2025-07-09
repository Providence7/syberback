// src/models/Order.js
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
  // --- NEW FIELDS FOR ADMIN PAGE CONVENIENCE ---
  customerName: {
    type: String,
    required: true,
  },
  customerEmail: {
    type: String,
    required: true,
  },
  orderType: { // e.g., 'Online', 'In-Person', 'Scheduled' - default will be 'Online' for createOrder
    type: String,
    enum: ['Online', 'In-Person', 'Scheduled'],
    default: 'Online', // Set a default if most are online
  },
  // --- END NEW FIELDS ---
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
      name: { type: String, required: true }, // e.g., 'Chest', 'Waist'
      value: { type: Number, required: true }, // e.g., 40, 32
      unit: { type: String, default: 'inches' } // e.g., 'inches', 'cm'
    }
  ],
  notes: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'completed', 'cancelled', 'ready-for-pickup'], // Added 'ready-for-pickup'
    default: 'pending',
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid', 'failed', 'refunded'], // Added 'refunded' for comprehensive status
    default: 'unpaid',
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  paymentReference: {
    type: String,
    unique: true,
    sparse: true,
  },
}, { timestamps: true });

// --- PRE-SAVE HOOK FOR TOTAL PRICE CALCULATION AND POPULATING CUSTOMER INFO ---
orderSchema.pre('save', async function(next) {
  if (this.isNew) {
    // Populate customerName and customerEmail from the User model on new order creation
    if (this.user && !this.customerName && !this.customerEmail) {
      const user = await mongoose.model('User').findById(this.user);
      if (user) {
        this.customerName = user.name; // Assuming 'name' field in User model
        this.customerEmail = user.email;
      }
    }

    // Calculate total price for new orders
    // Assuming style.price is for the tailoring service/design
    // and material.pricePerYard is for the fabric per yard
    if (this.style && this.material) {
      this.totalPrice = (this.style.price || 0) + ((this.material.pricePerYard || 0) * (this.style.yardsRequired || 0));
    }
    // You might also add logic for measurement pricing if applicable
  } else if (this.isModified('style') || this.isModified('material')) {
    // Recalculate if style or material is updated
    if (this.style && this.material) {
      this.totalPrice = (this.style.price || 0) + ((this.material.pricePerYard || 0) * (this.style.yardsRequired || 0));
    }
  }
  next();
});

export default mongoose.models.Order || mongoose.model('Order', orderSchema);