// src/models/measurement.js
import mongoose from 'mongoose';

const SIZE_VALUES = ['kid', 'small', 'medium', 'large', 'extraLarge'];
const SIZE_LABELS = ['Kid', 'Small', 'Medium', 'Large', 'Extra Large'];

const measurementSchema = new mongoose.Schema(
  {
    name:           { type: String, required: true },
    photoUrl:       { type: String, default: null },
    photoPublicId:  { type: String, default: null },

    // Was this photo validated by AI as a clear full-body image?
    photoValidated: { type: Boolean, default: false },

    unit:   { type: String, enum: ['in'], default: 'in' },
    gender: { type: String, enum: ['male', 'female'], lowercase: true },

    // Machine-readable size keys — used by the order form to look up
    // materialQuantities per garment. Sized independently: a top and bottom
    // don't have to land on the same size.
    topSize: {
      type: String,
      enum: SIZE_VALUES,
      default: 'medium',
    },
    topSizeLabel: {
      type: String,
      enum: SIZE_LABELS,
      default: 'Medium',
    },
    bottomSize: {
      type: String,
      enum: SIZE_VALUES,
      default: 'medium',
    },
    bottomSizeLabel: {
      type: String,
      enum: SIZE_LABELS,
      default: 'Medium',
    },

    // Optional age in years. Kept nullable (not required) since a profile can
    // be created from measurements alone with no age given.
    age: {
      type: Number,
      min: [0, 'Age cannot be negative'],
      max: [120, 'Age must be a realistic value'],
      default: null,
    },

    // All raw measurement fields stored as a flexible map
    data: { type: mongoose.Schema.Types.Mixed },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Virtual: does this measurement profile have a validated photo?
measurementSchema.virtual('hasPhoto').get(function () {
  return !!this.photoUrl && this.photoValidated === true;
});

// Virtual: does this profile have at least some measurement data?
measurementSchema.virtual('hasMeasurementData').get(function () {
  if (!this.data || typeof this.data !== 'object') return false;
  return Object.values(this.data).some(v => v !== '' && v !== null && v !== undefined);
});

export default mongoose.model('Measurement', measurementSchema);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        