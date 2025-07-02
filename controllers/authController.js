// src/controllers/authController.js
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import User from '../models/user.js';
import jwt from 'jsonwebtoken';

import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from '../utils/jwt.js';
import { sendEmail } from '../utils/email.js';

// Helpers
function randomToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

// 1. Register
export async function register(req, res) {
  const { name, email, password } = req.body;
  if (await User.exists({ email })) {
    return res.status(400).json({ message: 'Email already in use' });
  }

  const hash = await bcrypt.hash(password, 12);
  const emailCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
  const emailCodeExpires = Date.now() + 15 * 60 * 1000; // expires in 15 minutes

  const user = await User.create({
    name,
    email,
    password: hash,
    emailToken: emailCode,
    emailTokenExpires: emailCodeExpires
  });

  await sendEmail({
    to: email,
    subject: 'Your Email Verification Code',
    html: `<p>Your verification code is <b>${emailCode}</b>. It expires in 15 minutes.</p>`
  });

  res.status(201).json({
    message: 'Registered! A 6-digit code has been sent to your email.',
    uniqueId: user.uniqueId
  });
}


// 2. Verify Email
export async function verifyEmail(req, res) {
  const { email, code } = req.body;

  const user = await User.findOne({ email, emailToken: code });

  if (!user || user.emailTokenExpires < Date.now()) {
    return res.status(400).json({ message: 'Invalid or expired verification code' });
  }

  user.isVerified = true;
  user.emailToken = undefined;
  user.emailTokenExpires = undefined;
  await user.save();

  res.json({ message: 'Email verified!' });
}

// 9. Resend Email Verification Code
export async function resendVerification(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (user.isVerified) {
    return res.status(400).json({ message: 'User already verified' });
  }

  const newCode = Math.floor(100000 + Math.random() * 900000).toString();
  const codeExpires = Date.now() + 15 * 60 * 1000;

  user.emailToken = newCode;
  user.emailTokenExpires = codeExpires;
  await user.save();

  await sendEmail({
    to: email,
    subject: 'Your New Verification Code',
    html: `<p>Your new verification code is <b>${newCode}</b>. It expires in 15 minutes.</p>`
  });

  res.json({ message: 'Verification code resent' });
}


// 3. Login
export async function login(req, res) {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(400).json({ message: 'Invalid credentials' });
  }

  if (!user.isVerified) {
    return res.status(403).json({ message: 'Please verify your email first' });
  }

  const accessToken = signAccessToken({ id: user._id });
  const refreshToken = signRefreshToken({ id: user._id });

  user.refreshToken = refreshToken;
  await user.save();

  // ✅ Set both tokens in secure cookies
const cookieOptions = {
  httpOnly: true,
  secure: true,              // ✅ Must be true in production for HTTPS
  sameSite: 'None',          // ✅ Allows cross-origin cookies
};

  res
    .cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 1 * 24 * 60 * 60 * 1000  }) // 15 minutes
    .cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 }) // 7 days
    .json({ user: { uniqueId: user.uniqueId, email: user.email } }); // optional, token now in cookies
}


// 4. Logout
export async function logout(req, res) {
  res.clearCookie('accessToken', {
    httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
  });
  res.clearCookie('refreshToken', {
    httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
  });
  res.sendStatus(204);
}


// 5. Refresh
export async function refresh(req, res) {
  const token = req.cookies.refreshToken;
  if (!token) return res.sendStatus(401);

  let payload;
  try {
    payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
  } catch {
    return res.sendStatus(403);
  }

  const user = await User.findById(payload.id);
  if (!user || user.refreshToken !== token) {
    return res.sendStatus(403);
  }

  const newAccessToken = signAccessToken({ id: user._id });
  const newRefreshToken = signRefreshToken({ id: user._id });

  user.refreshToken = newRefreshToken;
  await user.save();
const cookieOptions = {
  httpOnly: true,
  secure: true,              // ✅ Must be true in production for HTTPS
  sameSite: 'None',          // ✅ Allows cross-origin cookies
};

  res
    .cookie('accessToken', newAccessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 })
    .cookie('refreshToken', newRefreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 })
    .json({ message: 'Tokens refreshed' });
}


// 6. Me

export async function me(req, res) {
  const token = req.cookies.accessToken;

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  } catch {
    return res.status(403).json({ message: 'Invalid token' });
  }

  const user = await User.findById(payload.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  res.json({
    user: {
      uniqueId: user.uniqueId,
      email: user.email,
      name: user.name, 
    },
  });
}
                      

// 7. Request Password Reset
export async function requestPasswordReset(req, res) {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.sendStatus(204);

  const resetToken = randomToken();
  user.resetToken = resetToken;
  user.resetTokenExpires = Date.now() + 60 * 60 * 1000;
  await user.save();

  const resetURL = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}&id=${user._id}`;
  await sendEmail({
    to: email,
    subject: 'Password Reset',
    html: `<p>Click <a href="${resetURL}">here</a> to reset your password.</p>`
  });

  res.json({ message: 'If the email exists, a reset link has been sent' });
}

// 8. Reset Password
export async function resetPassword(req, res) {
  const { id, token, password } = req.body;
  const user = await User.findOne({
    _id: id,
    resetToken: token,
    resetTokenExpires: { $gt: Date.now() }
  });
  if (!user) return res.status(400).json({ message: 'Invalid or expired reset token' });

  user.password = await bcrypt.hash(password, 12);
  user.resetToken = user.resetTokenExpires = undefined;
  await user.save();

  res.json({ message: 'Password reset successful' });
}
// Get user profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update user profile
export const updateProfile = async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { name, email, phone, address },
      { new: true, runValidators: true }
    ).select('-password');

    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};