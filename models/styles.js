import mongoose from 'mongoose';

const StyleSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      unique: true,
      trim: true,
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

    /**
     * Each value is a self-contained string that already includes the unit,
     * e.g. "2 yds", "1.5 trousers", "1 length (1 cap)".
     * This makes the data portable — no need to look up the unit separately.
     */
    materialQuantities: {
      type: Map,
      of: String,
      default: {},
    },

    /**
     * The measurement unit chosen by the admin for this style.
     * Stored here so the edit form can pre-select the correct unit.
     * Values: "yds" | "trousers" | "length (1 cap)"
     */
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

const Style = mongoose.model('Style', StyleSchema);
export default Style;