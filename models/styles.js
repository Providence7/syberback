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

    materialUnit: {
      type: String,
      default: 'yds',
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