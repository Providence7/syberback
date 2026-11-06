// src/models/measurement.js
import mongoose from 'mongoose';

const SIZE_VALUES = ['kid', 'small', 'medium', 'large', 'extraLarge'];
const SIZE_LABELS = ['Kid', 'Small', 'Medium', 'Large', 'Extra Large'];

const measurementSchema = new mongoose.Schema(
  {
    name:           { type: String, required: true },
    photoUrl:       { type: String, default: null },
    photoPublicId:  { type: String, default: null },

    // true only when the server-side AI check confirmed a clear full-body photo.
    // This no longer decides whether the photo is kept — see photoCheck below.
    photoValidated: { type: Boolean, default: false },

    // Advisory result of the server-side AI photo check. It NEVER blocks a save:
    //   'passed'    – AI confirmed one person, standing, head to toe
    //   'failed'    – AI had doubts (see photoCheckNotes) — admin should eyeball it
    //   'unchecked' – the checker was unavailable; photo saved as-is
    photoCheck:      { type: String, enum: ['passed', 'failed', 'unchecked'], default: 'unchecked' },
    photoCheckNotes: { type: String, default: '' },

    // true when the profile has a photo but NO measurement values — the admin /
    // tailor takes the measurements on their end. Cleared automatically once
    // measurement values are saved (by the customer or by the admin).
    photoOnly: { type: Boolean, default: false },

    unit:   { type: String, enum: ['in'], default: 'in' },
    gender: { type: String, enum: ['male', 'female'], lowercase: true },

    // Single machine-readable size key — used by the order form to look up
    // materialQuantities. NOTE: for photoOnly profiles this is just the default
    // placeholder ('medium') until real measurements are entered.
    size: {
      type: String,
      enum: SIZE_VALUES,
      default: 'medium',
    },
    sizeLabel: {
      type: String,
      enum: SIZE_LABELS,
      default: 'Medium',
    },

    // Optional age in years.
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

// Virtual: does this profile have a photo? (Any saved photo counts — it no
// longer has to pass the AI check to be kept.)
measurementSchema.virtual('hasPhoto').get(function () {
  return !!this.photoUrl;
});

// Virtual: does this profile have at least some measurement data?
measurementSchema.virtual('hasMeasurementData').get(function () {
  if (!this.data || typeof this.data !== 'object') return false;
  return Object.values(this.data).some(v => v !== '' && v !== null && v !== undefined);
});

export default mongoose.model('Measurement', measurementSchema);