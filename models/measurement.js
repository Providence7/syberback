// src/models/measurement.js
import mongoose from 'mongoose';

const measurementSchema = new mongoose.Schema(
  {
    name:           { type: String, required: true },
    photoUrl:       { type: String, default: null },
    photoPublicId:  { type: String, default: null },

    // Was this photo validated by AI as a clear full-body image?
    photoValidated: { type: Boolean, default: false },

    unit:   { type: String, enum: ['in'], default: 'in' },
    gender: { type: String, enum: ['male', 'female'], lowercase: true },

    // Machine-readable size key — used by the order form to look up materialQuantities
    size: {
      type: String,
      enum: ['kid', 'small', 'medium', 'large', 'extraLarge'],
      default: 'medium',
    },

    // Human-readable label shown in the UI
    sizeLabel: {
      type: String,
      enum: ['Kid', 'Small', 'Medium', 'Large', 'Extra Large'],
      default: 'Medium',
    },

    age: { type: String },

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