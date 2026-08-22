import mongoose from 'mongoose';

// Single source of truth for the 6 categories. Import this wherever
// category needs validating (controllers) or rendering (frontend tabs).
export const STYLE_CATEGORIES = [
  'Adire Casual',
  'Aso Oke Luxury',
  'Classic Senator',
  'Cap',
  'Accessories',
  'Footwear',
];

// Must match Fabric.js's `unit` enum exactly ('cap' | 'yards' | 'trouser').
// This used to default to 'yds' — a value Fabric.unit could never equal —
// which meant the unit-compatibility check silently never fired for any
// style that hadn't explicitly set materialUnit. That's the root cause of
// clients being able to pair Aso Oke Pants (needs 'cap') with Adire
// (unit: 'yards') and getting 8 caps × Adire's per-yard price.
export const STYLE_MATERIAL_UNITS = ['cap', 'yards', 'trouser'];

const StyleSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      unique: true,
      trim: true,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: {
        values: STYLE_CATEGORIES,
        message: '{VALUE} is not a valid category',
      },
    },
    type: {
      type: [String],
      default: [],
    },
    gender: {
      type: String,
      required: [true, 'Gender is required'],
      enum: ['Male', 'Female', 'Unisex'],
    },
    ageGroup: {
      type: String,
      enum: ['Adult', 'Child', 'Teen', 'Elder'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
    },
    image: {
      type: String,
      required: true,
    },
    cloudinary_id: {
      type: String,
      required: true,
    },
    description: { type: String },
    details:     { type: String },
    colour:      { type: String },

    recommendedMaterials: {
      type: [String],
      default: [],
    },

    materialQuantities: {
      type: Map,
      of: String,
      default: {},
    },

    // Enum + correct default ('yards', not 'yds'). This is the field every
    // incompatible-fabric bug traces back to — it must speak the same
    // vocabulary as Fabric.unit or the comparison is meaningless.
    materialUnit: {
      type: String,
      required: [true, 'materialUnit is required — it must match one of Fabric\'s unit values'],
      enum: {
        values: STYLE_MATERIAL_UNITS,
        message: '{VALUE} is not a valid materialUnit — must be one of: cap, yards, trouser',
      },
      default: 'yards',
    },

    tags: {
      type: [String],
      default: [],
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true },
);

// Helpful for querying/UI: quick lookup index
StyleSchema.index({ category: 1 });

const Style = mongoose.model('Style', StyleSchema);
export default Style;