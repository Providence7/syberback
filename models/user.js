// src/models/User.js
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const userSchema = new mongoose.Schema({
  uniqueId: { type: String, default: uuidv4, unique: true },
  name: String,
  email: { type: String, unique: true },
  password: String,
  isVerified: { type: Boolean, default: false },
  emailToken: String,
  emailTokenExpires: Date,
  resetToken: String,
  resetTokenExpires: Date,
  refreshToken: String,
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
});

export default mongoose.models.User ||
       mongoose.model('User', userSchema);
