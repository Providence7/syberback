// src/controllers/authController.js
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import User from '../models/user.js';
import Order from '../models/order.js'; // Import the Order model
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from '../utils/jwt.js';
import { sendEmail } from '../utils/email.js';

// Helpers
function randomToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}// 1. Register (safer: accepts phone, isolates sendEmail errors)

export const register = async (req, res) => {
  const { name, email, password, phone } = req.body;

  try {
    // 1. Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // 2. Create new user (unverified)
    const newUser = await User.create({
      name,
      email,
      password,
      phone,
      isVerified: false,
      emailToken: crypto.randomBytes(32).toString('hex'),
      emailTokenExpires: Date.now() + 3600000, // 1 hour
    });

    // 3. Send verification email
    const verifyUrl = `${process.env.FRONTEND_URL}/verify?token=${newUser.emailToken}`;
    const message = `
      <h1>Email Verification</h1>
      <p>Click the link below to verify your account:</p>
      <a href="${verifyUrl}">${verifyUrl}</a>
    `;

    const emailSent = await sendEmail({
      to: newUser.email,
      subject: 'Verify your SyberTailor account',
      html: message,
    });

    if (!emailSent) {
      // Rollback user if email fails
      await User.findByIdAndDelete(newUser._id);
      return res.status(500).json({ message: 'Failed to send verification email' });
    }

    res.status(201).json({
      message: 'Registration successful! Please check your email to verify your account.',
    });
  } catch (err) {
    console.error('❌ Registration error:', err.message);
    res.status(500).json({ message: 'Server error during registration.' });
  }
};



// 2. Verify Email (No changes needed)
export async function verifyEmail(req, res) {
  const { email, code } = req.body;
  try {
    const user = await User.findOne({ email, emailToken: code });
    if (!user || user.emailTokenExpires < Date.now()) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }
    user.isVerified = true;
    user.emailToken = undefined;
    user.emailTokenExpires = undefined;
    await user.save();
    res.json({ message: 'Email verified!' });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ message: 'Server error during email verification.' });
  }
}

// 9. Resend Email Verification Code (No changes needed)
export async function resendVerification(req, res) {
  const { email } = req.body;
  try {
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
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ message: 'Server error during resending verification code.' });
  }
}

// 3. Login (No changes needed here)
export async function login(req, res) {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    if (!user.isVerified) {
      return res.status(403).json({ message: 'Please verify your email first' });
    }
    const accessToken = signAccessToken({ id: user._id, isAdmin: user.isAdmin });
    const refreshToken = signRefreshToken({ id: user._id, isAdmin: user.isAdmin });
    user.refreshToken = refreshToken;
    await user.save();
    const isProd = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true, secure: isProd, sameSite: isProd ? 'None' : 'Lax', path: '/',
    };
    res
      .cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 })
      .cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 })
      .json({
        message: 'Login successful',
        user: {
          uniqueId: user.uniqueId, name: user.name, email: user.email, isAdmin: user.isAdmin
        }
      });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login.' });
  }
}

// 4. Logout (No changes needed)
export async function logout(req, res) {
  if (req.user && req.user.id) {
    try {
      await User.findByIdAndUpdate(req.user.id, { refreshToken: null });
      console.log(`User ${req.user.id} refresh token revoked from database.`);
    } catch (error) {
      console.error('Error revoking refresh token from database on logout:', error);
    }
  } else {
    console.warn('Logout called without an authenticated user. Cannot revoke refresh token from DB.');
  }
  const isProd = process.env.NODE_ENV === 'production';
  const cookieClearOptions = {
    httpOnly: true, secure: isProd, sameSite: isProd ? 'None' : 'Lax', path: '/',
  };
  res
    .clearCookie('accessToken', cookieClearOptions)
    .clearCookie('refreshToken', cookieClearOptions)
    .sendStatus(204);
}

// 5. Refresh (No changes needed)
export async function refresh(req, res) {
  const token = req.cookies.refreshToken;
  if (!token) {
    console.warn('Refresh attempt: No refresh token in cookies.');
    return res.sendStatus(401);
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
  } catch (err) {
    console.error('Refresh attempt: JWT verification failed for refresh token:', err.message);
    return res.sendStatus(403);
  }
  const user = await User.findById(payload.id);
  if (!user || user.refreshToken !== token) {
    console.warn('Refresh attempt: User not found or refresh token mismatch/revoked.');
    return res.sendStatus(403);
  }
  const newAccessToken = signAccessToken({ id: user._id, isAdmin: user.isAdmin });
  const newRefreshToken = signRefreshToken({ id: user._id, isAdmin: user.isAdmin });
  user.refreshToken = newRefreshToken;
  await user.save();
  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true, secure: isProd, sameSite: isProd ? 'None' : 'Lax', path: '/',
  };
  res
    .cookie('accessToken', newAccessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 })
    .cookie('refreshToken', newRefreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 })
    .json({ message: 'Tokens refreshed' });
}

// 6. Me (No changes needed)
export async function me(req, res) {
  if (!req.user) {
    console.warn('Me endpoint accessed without req.user populated. Check middleware setup.');
    return res.status(401).json({ message: 'Not authenticated' });
  }
  res.json({
    user: {
      uniqueId: req.user.uniqueId, name: req.user.name, email: req.user.email,
      isAdmin: req.user.isAdmin, isVerified: req.user.isVerified,
      phone: req.user.phone, address: req.user.address,
    },
  });
}

// 7. Request Password Reset (No changes needed)
export async function requestPasswordReset(req, res) {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.sendStatus(204);
    const resetToken = randomToken();
    user.resetToken = resetToken;
    user.resetTokenExpires = Date.now() + 60 * 60 * 1000;
    await user.save();
    const resetURL = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}&id=${user._id}`;
    await sendEmail({
      to: email, subject: 'Password Reset for SyberTailor',
      html: `<p>You are receiving this because you (or someone else) have requested the reset of the password for your account.</p>
             <p>Please click on the following link, or paste this into your browser to complete the process:</p>
             <p><a href="${resetURL}">${resetURL}</a></p>
             <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>`
    });
    res.json({ message: 'If the email exists, a password reset link has been sent.' });
  } catch (error) {
    console.error('Request password reset error:', error);
    res.status(500).json({ message: 'Server error during password reset request.' });
  }
}

// 8. Reset Password (No changes needed)
export async function resetPassword(req, res) {
  const { id, token, password } = req.body;
  try {
    const user = await User.findOne({
      _id: id, resetToken: token, resetTokenExpires: { $gt: Date.now() }
    }).select('+password');
    if (!user) return res.status(400).json({ message: 'Invalid or expired reset token' });
    user.password = password;
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    await user.save();
    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error during password reset.' });
  }
}

// Get user profile (for the authenticated user) (No changes needed)
export const getProfile = async (req, res) => {
  try {
    if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated or user data missing.' });
    }
    res.json(req.user);
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Server error fetching profile.' });
  }
};

// Update user profile (No changes needed)
export const updateProfile = async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;
    if (!req.user || !req.user.id) {
        return res.status(401).json({ message: 'Not authenticated or user ID missing.' });
    }
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { name, email, phone, address },
      { new: true, runValidators: true }
    ).select('-password');
    if (!updatedUser) {
        return res.status(404).json({ message: 'User not found for update.' });
    }
    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (err) {
    console.error('Update profile error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Email already exists. Please use a different email.' });
    }
    res.status(500).json({ error: 'Server error updating profile.' });
  }
};

// --- ADMIN FUNCTIONS (No changes needed here) ---

// @desc    Get all users (Admin only)
// @route   GET /api/auth/admin/users
// @access  Private/Admin
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}).select('-password -refreshToken');
    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({ message: 'Server error fetching users.' });
  }
};

// @desc    Get user by ID (Admin only)
// @route   GET /api/auth/admin/users/:id
// @access  Private/Admin
export const getUserById = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId).select('-password -refreshToken');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(200).json(user);
  } catch (error) {
    console.error('Error fetching user by ID:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format.' });
    }
    res.status(500).json({ message: 'Server error fetching user.' });
  }
};

// --- NEW DASHBOARD STATS FUNCTION ---

// @desc    Get admin dashboard statistics
// @route   GET /api/auth/admin/dashboard-stats
// @access  Private/Admin
// src/controllers/authController.js
// ... (your existing imports, like User, Order, etc.)

// --- NEW DASHBOARD STATS FUNCTION ---

// @desc    Get admin dashboard statistics
// @route   GET /api/auth/admin/dashboard-stats
// @access  Private/Admin
export const getAdminDashboardStats = async (req, res) => {
  try {
    // Total Users
    const users = await User.countDocuments();

    // Total Orders
    const orders = await Order.countDocuments();

    // Total Payments (sum of totalPrice for paid orders)
    const paidPayments = await Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } }
    ]);
    const payments = paidPayments.length > 0 ? paidPayments[0].total : 0;

    // Scheduled Orders (e.g., 'in-progress' status)
    const scheduledOrders = await Order.countDocuments({ status: 'in-progress' });

    // Visits - This is typically from an external analytics tool or a custom logging system.
    // For now, we'll keep it as a dummy value as it's not in your current models.
    const visits = 0; // Placeholder

    // Revenue Trend (e.g., last 7 days orders)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0); // Start of the day 7 days ago

    const revenueTrend = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo },
          paymentStatus: 'paid' // Only count paid orders for revenue trend
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalPrice' }
        }
      },
      { $sort: { _id: 1 } } // Sort by date
    ]);

    // Format revenueTrend for the chart (e.g., fill in missing days)
    const formattedRevenueTrend = [];
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i)); // Get date for each of last 7 days
        const dateString = d.toISOString().split('T')[0]; // YYYY-MM-DD
        const dayName = daysOfWeek[d.getDay()];

        const found = revenueTrend.find(item => item._id === dateString);
        formattedRevenueTrend.push({
            day: dayName,
            date: dateString,
            orders: found ? found.totalOrders : 0,
            revenue: found ? found.totalRevenue : 0
        });
    }

    // --- UPDATED RECENT ACTIVITIES LOGIC ---
    const ACTIVITIES_LIMIT = 8; // Define the limit here

    // Fetch recent users and orders, select necessary fields
    // Fetch a bit more than the limit to ensure enough for combination and sorting
    const rawRecentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(ACTIVITIES_LIMIT + 2) // Fetch a few extra
      .select('name createdAt');

    const rawRecentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(ACTIVITIES_LIMIT + 2) // Fetch a few extra
      .select('style.title createdAt');

    // Combine all events into a single array with a type and message builder
    const combinedActivities = [];

    rawRecentUsers.forEach(u => {
      if (u.createdAt && u.name) {
        combinedActivities.push({
          type: 'user',
          createdAt: u.createdAt,
          message: `New user: ${u.name} joined.`,
        });
      }
    });

    rawRecentOrders.forEach(o => {
      if (o.createdAt && o.style && o.style.title) {
        combinedActivities.push({
          type: 'order',
          createdAt: o.createdAt,
          message: `New order: ${o.style.title} placed.`,
        });
      }
    });

    // Sort combined activities by createdAt in descending order
    combinedActivities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Format the top N recent activities
    const recent = combinedActivities.slice(0, ACTIVITIES_LIMIT).map(activity => {
        // Use a more robust date formatting for the display string
        const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        return `${activity.message} (${activity.createdAt.toLocaleString(undefined, options)})`;
    });

    res.status(200).json({
      users,
      payments,
      orders,
      schedule: scheduledOrders,
      visits, // Still a placeholder
      recent,
      revenueTrend: formattedRevenueTrend,
    });

  } catch (error) {
    console.error('Error fetching admin dashboard stats:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard statistics.' });
  }
};
// src/controllers/authController.js
// ... (your existing imports and functions)

// --- ADMIN FUNCTIONS ---

// ... (existing getAllUsers, getUserById)

// @desc    Update user (Admin only)
// @route   PUT /api/auth/admin/users/:id
// @access  Private/Admin
export const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, phone, address, isAdmin, isVerified } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent changing the current admin's own admin status via this route if not careful,
    // or if you want to protect the super admin.
    // For simplicity, we allow it for now, but in production, you might restrict
    // an admin from revoking their own admin privileges.
    if (user.isAdmin && !isAdmin && user._id.toString() === req.user.id) {
        return res.status(403).json({ message: 'Cannot revoke your own admin privileges via this route.' });
    }

    user.name = name || user.name;
    // Only update email if provided and different, and handle uniqueness
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email });
      if (emailExists && emailExists._id.toString() !== userId) {
        return res.status(400).json({ message: 'Email already registered by another user.' });
      }
      user.email = email;
    }
    user.phone = phone || user.phone;
    user.address = address || user.address;
    user.isAdmin = typeof isAdmin === 'boolean' ? isAdmin : user.isAdmin;
    user.isVerified = typeof isVerified === 'boolean' ? isVerified : user.isVerified;

    const updatedUser = await user.save();

    res.status(200).json({
      message: 'User updated successfully',
      user: {
        _id: updatedUser._id,
        uniqueId: updatedUser.uniqueId,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        address: updatedUser.address,
        isAdmin: updatedUser.isAdmin,
        isVerified: updatedUser.isVerified,
      },
    });

  } catch (error) {
    console.error('Error updating user (Admin):', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format.' });
    }
    if (error.code === 11000) { // Duplicate key error (e.g., email)
      return res.status(400).json({ message: 'A user with this email already exists.' });
    }
    res.status(500).json({ message: 'Server error updating user.' });
  }
};

// @desc    Delete user (Admin only)
// @route   DELETE /api/auth/admin/users/:id
// @access  Private/Admin
export const deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // Prevent an admin from deleting themselves
    if (req.user.id === userId) {
      return res.status(403).json({ message: 'Administrators cannot delete their own account via this route.' });
    }

    const user = await User.findByIdAndDelete(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('Error deleting user (Admin):', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format.' });
    }
    res.status(500).json({ message: 'Server error deleting user.' });
  }
};