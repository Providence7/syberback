// src/models/User.js
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  // Globally unique ID. For a sequential human-readable customer number,
  // use a separate counter field managed in application logic.
  uniqueId: {
    type: String,
    default: uuidv4,
    unique: true,
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/.+@.+\..+/, 'Please enter a valid email address'],
  },
  pushSubscriptions: [
    {
      subscription: { type: Object },
      deviceHint: { type: String }, // optional: UA string for debugging
      createdAt: { type: Date, default: Date.now },
    },
  ],
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters long'],
    select: false, // never returned by default
  },
  isVerified: {
    type: Boolean,
    default: false,
  },

  // Secrets: excluded from every query unless explicitly requested with
  // .select('+field'). Filtering on them in queries still works, and so
  // does setting them and calling save(). This keeps them out of req.user
  // and therefore out of API responses like getProfile.
  emailToken:   { type: String, select: false },
  emailTokenExpires: Date,
  resetToken:   { type: String, select: false },
  resetTokenExpires: Date,
  refreshToken: { type: String, select: false }, // SHA-256 hash, not the raw token

  phone: {
    type: String,
    default: '',
  },
  address: {
    type: String,
    default: '',
  },
  // GPS pin captured from the customer's device when they saved their
  // address. `address` is the human-readable text; `location` is the
  // source of truth riders/dispatch use.
  location: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    // When the pin was captured/last updated, to spot stale pins
    updatedAt: { type: Date, default: null },
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

// Hash password before saving (only when new or modified)
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare entered password with the stored hash
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.models.User ||
  mongoose.model('User', userSchema);