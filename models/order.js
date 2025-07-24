// src/models/Order.js
import mongoose from 'mongoose';

const styleSchema = new mongoose.Schema({
  title: String,
  price: Number, // Mongoose will try to cast this to Number
  yardsRequired: Number, // Mongoose will try to cast this to Number
  recommendedMaterials: [String],
  image: {
    type: String, // Cloudinary URL
    required: true,
  },
}, { _id: false });

const materialSchema = new mongoose.Schema({
  name: String,
  type: String,
  pricePerYard: Number, // Mongoose will try to cast this to Number
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
  customerName: {
    type: String,
    required: true,
  },
  customerEmail: {
    type: String,
    required: true,
  },
  orderType: {
    type: String,
    enum: ['Online', 'In-Person', 'Scheduled'],
    default: 'Online',
  },
  style: {
    type: styleSchema,
    required: true,
  },
  material: {
    type: materialSchema,
    required: true,
  },
  measurements: {
    type: String,
  },
  notes: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'completed', 'cancelled', 'ready-for-pickup'],
    default: 'pending',
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid', 'failed', 'refunded'],
    default: 'unpaid',
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0,
  },
    expectedDeliveryDate: {
        type: Date,
        default: null, // Will be set after order creation for online paid orders
    },
  paymentReference: {
    type: String,
    unique: true,
    sparse: true,
  },
}, { timestamps: true });

orderSchema.pre('save', async function(next) {
  // --- START DEBUGGING LOGS FOR PRE-SAVE HOOK ---
  console.log('--- Order Pre-save Hook Execution Started ---');
  console.log('Document state (this):', JSON.stringify(this.toObject(), null, 2)); // See the full object
  console.log('Is new document (this.isNew)?', this.isNew);
  console.log('Is style modified?', this.isModified('style'));
  console.log('Is material modified?', this.isModified('material'));


  // Populate customerName and customerEmail from the User model on new order creation
  if (this.isNew && this.user && (!this.customerName || !this.customerEmail)) {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(this.user);
      if (user) {
        this.customerName = user.name;
        this.customerEmail = user.email;
        console.log(`Customer info populated: ${this.customerName}, ${this.customerEmail}`);
      } else {
        console.warn('Pre-save hook: User not found for ID:', this.user);
      }
    } catch (error) {
      console.error('Error populating customer info in Order pre-save hook:', error);
    }
  }

  // Calculate total price for new orders or if style/material is modified
  if (this.isNew || this.isModified('style') || this.isModified('material')) {
    let calculatedTotalPrice = 0;

    console.log('Attempting totalPrice calculation...');
    console.log('Current this.style:', this.style);
    console.log('Current this.material:', this.material);

    if (this.style && this.material) {
      // Access raw values first to see their original type/value
      console.log('Raw this.style.price:', this.style.price, 'Type:', typeof this.style.price);
      console.log('Raw this.material.pricePerYard:', this.material.pricePerYard, 'Type:', typeof this.material.pricePerYard);
      console.log('Raw this.style.yardsRequired:', this.style.yardsRequired, 'Type:', typeof this.style.yardsRequired);

      // Perform parsing with parseFloat and provide default 0 for safety
      const stylePrice = parseFloat(this.style.price) || 0;
      const materialPricePerYard = parseFloat(this.material.pricePerYard) || 0;
      const yardsRequired = parseFloat(this.style.yardsRequired) || 0;

      console.log('Pre-save hook: style.price (parsed):', stylePrice);
      console.log('Pre-save hook: material.pricePerYard (parsed):', materialPricePerYard);
      console.log('Pre-save hook: style.yardsRequired (parsed):', yardsRequired);

      calculatedTotalPrice = stylePrice + (materialPricePerYard * yardsRequired);
    } else {
      console.warn('Pre-save hook: Missing style or material, cannot calculate totalPrice.');
    }

    console.log('Pre-save hook: Calculated totalPrice:', calculatedTotalPrice);
    console.log('Pre-save hook: Is calculatedTotalPrice NaN?', isNaN(calculatedTotalPrice));

    if (isNaN(calculatedTotalPrice)) {
      console.error('Order Pre-save hook: Calculated totalPrice is NaN after all parsing! Defaulting to 0.');
      this.totalPrice = 0; // Fallback to 0 to pass validation
    } else {
      this.totalPrice = calculatedTotalPrice;
    }
  }

  console.log('Pre-save hook: Final this.totalPrice before validation/saving:', this.totalPrice);
  console.log('--- Order Pre-save Hook Execution Finished ---');
  // --- END DEBUGGING LOGS FOR PRE-SAVE HOOK ---

  next(); // Always call next() to proceed
});

export default mongoose.models.Order || mongoose.model('Order', orderSchema);