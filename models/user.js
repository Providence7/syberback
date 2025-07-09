// src/models/User.js
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs'; // Import bcryptjs for password hashing

const userSchema = new mongoose.Schema({
  uniqueId: {
    type: String,
    // Note: uuidv4 generates a globally unique identifier (e.g., 'a1b2c3d4-e5f6-7890-1234-567890abcdef').
    // This is for ensuring absolute uniqueness. It is not a sequential number and cannot be made to "start from 100" directly.
    // If you need a sequential, human-readable ID (like Customer #100, #101), that would be a separate field
    // managed by a custom counter in your application logic (e.g., in the controller) upon user creation.
    default: uuidv4,
    unique: true
  },
  name: {
    type: String,
    required: [true, 'Name is required']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/.+@.+\..+/, 'Please enter a valid email address'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters long'],
    select: false, // IMPORTANT: Do not return password by default in queries
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  emailToken: String,
  emailTokenExpires: Date,
  resetToken: String,
  resetTokenExpires: Date,
  refreshToken: String,
  phone: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    default: ''
  },
  // --- NEW FIELD: isAdmin ---
  isAdmin: {
    type: Boolean,
    default: false, // By default, a new user is not an admin
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt fields
});

// --- Password Hashing Middleware ---
// Hash password before saving (pre-save hook)
userSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) {
    return next();
  }
  // Generate a salt and hash the password
  const salt = await bcrypt.genSalt(10); // 10 rounds is a good balance
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// --- Method to Compare Passwords ---
// Method to compare entered password with hashed password in the database
userSchema.methods.matchPassword = async function(enteredPassword) {
  // Compare the entered plain text password with the hashed password stored in the database
  return await bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.models.User ||
        mongoose.model('User', userSchema);