// src/controllers/authController.js
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import ms from 'ms';
import dotenv from 'dotenv';
import User from '../models/user.js';
import Order from '../models/order.js';
import { sendEmail } from '../utils/email.js';
import {
  signAccessToken,
  signRefreshToken,
} from '../utils/jwt.js';

dotenv.config();

// ------------------------------
// 🔧 Helpers
// ------------------------------
const randomToken = (length = 32) => crypto.randomBytes(length).toString('hex');

const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
  path: '/',
});

// Validates and normalizes a { lat, lng } payload from the client.
// Returns null if no usable coordinates were sent, so callers can safely
// skip touching `location` when the client didn't include one (e.g. a
// profile edit that only changes the phone number shouldn't wipe out a
// previously saved GPS pin).
const parseLocation = (location) => {
  if (!location || typeof location !== 'object') return null;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, updatedAt: new Date() };
};

// Single source of truth for token lifetimes — read once from env so the
// cookie's maxAge and the JWT's own `exp` claim can never drift apart.
// IMPORTANT: utils/jwt.js's signAccessToken/signRefreshToken must use these
// same env vars (ACCESS_TOKEN_EXPIRES_IN / REFRESH_TOKEN_EXPIRES_IN) when
// signing, or the cookie lifetime and the token's actual expiry will
// disagree again — which is exactly the kind of mismatch that causes
// "sometimes works, sometimes says no access" symptoms.
const ACCESS_TOKEN_MAX_AGE  = ms(process.env.ACCESS_TOKEN_EXPIRES_IN  || '15m');
const REFRESH_TOKEN_MAX_AGE = ms(process.env.REFRESH_TOKEN_EXPIRES_IN || '7d');

// ------------------------------
// 👤 Register
// ------------------------------
export async function register(req, res) {
  const { name, email, password } = req.body;
  try {
    if (await User.exists({ email })) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    const user = await User.create({ name, email, password });

    const emailCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.emailToken = emailCode;
    user.emailTokenExpires = Date.now() + 15 * 60 * 1000;
    await user.save();

    await sendEmail({
      to: email,
      subject: 'Verify Your Email - SyberTailor',
      html: `<p>Your verification code is <b>${emailCode}</b>. It expires in 15 minutes.</p>`,
    });

    res.status(201).json({
      message: 'Registered! A 6-digit verification code was sent to your email.',
      user: {
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error during registration.' });
  }
}

// ------------------------------
// ✉️ Verify Email
// ------------------------------
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

    res.json({ message: 'Email verified successfully!' });
  } catch (error) {
    res.status(500).json({ message: 'Server error during email verification.' });
  }
}

// ------------------------------
// 🔑 Login
// ------------------------------
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

    const cookieOptions = getCookieOptions();

    res
      .cookie('accessToken', accessToken, { ...cookieOptions, maxAge: ACCESS_TOKEN_MAX_AGE })
      .cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_MAX_AGE })
      .json({
        message: 'Login successful',
        user: {
          name: user.name,
          email: user.email,
          isAdmin: user.isAdmin,
          isVerified: user.isVerified,
        },
      });
  } catch (error) {
    res.status(500).json({ message: 'Server error during login.' });
  }
}

// ------------------------------
// 🚪 Logout
// ------------------------------
export async function logout(req, res) {
  try {
    if (req.user?.id) {
      await User.findByIdAndUpdate(req.user.id, { refreshToken: null });
    }

    const cookieOptions = getCookieOptions();
    res
      .clearCookie('accessToken', cookieOptions)
      .clearCookie('refreshToken', cookieOptions)
      .sendStatus(204);
  } catch (error) {
    res.status(500).json({ message: 'Server error during logout.' });
  }
}

// ------------------------------
// ♻️ Refresh Tokens
// ------------------------------
export async function refresh(req, res) {
  const token = req.cookies?.refreshToken;

  if (!token) {
    return res.sendStatus(401);
  }

  try {
    const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(payload.id);

    if (!user || user.refreshToken !== token) {
      return res.sendStatus(403);
    }

    const newAccessToken = signAccessToken({ id: user._id, isAdmin: user.isAdmin });
    const newRefreshToken = signRefreshToken({ id: user._id, isAdmin: user.isAdmin });

    user.refreshToken = newRefreshToken;
    await user.save();

    const cookieOptions = getCookieOptions();
    res
      .cookie('accessToken', newAccessToken, { ...cookieOptions, maxAge: ACCESS_TOKEN_MAX_AGE })
      .cookie('refreshToken', newRefreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_MAX_AGE })
      .json({ message: 'Tokens refreshed successfully' });

  } catch (err) {
    res.sendStatus(403);
  }
}

// ------------------------------
// 👥 Me
// ------------------------------
export async function me(req, res) {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' });

  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      isAdmin: req.user.isAdmin,
      isVerified: req.user.isVerified,
    },
  });
}

// ------------------------------
// 🔄 Password Reset
// ------------------------------
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
      to: email,
      subject: 'Reset your SyberTailor password',
      html: `<p>Click the link below to reset your password:</p><a href="${resetURL}">${resetURL}</a>`,
    });

    res.json({ message: 'Password reset link sent to your email.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error during password reset request.' });
  }
}

export async function resetPassword(req, res) {
  const { id, token, password } = req.body;
  try {
    const user = await User.findOne({
      _id: id,
      resetToken: token,
      resetTokenExpires: { $gt: Date.now() },
    }).select('+password');

    if (!user) return res.status(400).json({ message: 'Invalid or expired token' });

    user.password = password;
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    await user.save();

    res.json({ message: 'Password reset successful.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error during password reset.' });
  }
}

// Get Profile
export const getProfile = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated or user data missing.' });
    }
    res.json(req.user);
  } catch (err) {
    res.status(500).json({ error: 'Server error fetching profile.' });
  }
};

// Update Profile
export const updateProfile = async (req, res) => {
  try {
    const { name, email, phone, address, location } = req.body;
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Not authenticated or user ID missing.' });
    }

    // Only touch `location` if the client actually sent usable coordinates —
    // this way a plain text/phone edit never silently wipes a previously
    // saved GPS pin.
    const parsedLocation = parseLocation(location);
    const updatePayload = { name, email, phone, address };
    if (parsedLocation) {
      updatePayload.location = parsedLocation;
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      updatePayload,
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found for update.' });
    }

    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Email already exists. Please use a different email.' });
    }
    res.status(500).json({ error: 'Server error updating profile.' });
  }
};

// --- ADMIN FUNCTIONS ---
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}).select('-password -refreshToken');
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching users.' });
  }
};

export const getUserById = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId).select('-password -refreshToken');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(200).json(user);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format.' });
    }
    res.status(500).json({ message: 'Server error fetching user.' });
  }
};

// ------------------------------
// 📊 Admin Dashboard Stats
// ------------------------------
export const getAdminDashboardStats = async (req, res) => {
  try {
    const ACTIVITIES_LIMIT = 20;

    // ── Scalar counts ──────────────────────────────────────
    const users = await User.countDocuments();

    // "orders" reflects active orders only — cancelled orders are excluded
    // so this stat drops immediately when an order is cancelled instead of
    // permanently counting orders that no longer represent live business.
    const orders    = await Order.countDocuments({ status: { $ne: 'cancelled' } });
    const cancelled = await Order.countDocuments({ status: 'cancelled' });

    // Revenue only counts orders that are both paid AND not cancelled.
    // A paid order that gets cancelled keeps paymentStatus:'paid' as a
    // historical record (see cancelOrder in order.js), so without the
    // status exclusion here its total would keep inflating "payments"
    // even though the sale no longer stands.
    const paidAgg = await Order.aggregate([
      { $match: { paymentStatus: 'paid', status: { $ne: 'cancelled' } } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } },
    ]);
    const payments = paidAgg[0]?.total ?? 0;

    const schedule = await Order.countDocuments({ status: 'in-progress' });
    const visits   = 0; // placeholder — wire to your analytics if available

    // ── Weekly revenue trend ───────────────────────────────
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const revenueTrend = await Order.aggregate([
      {
        $match: {
          createdAt:     { $gte: sevenDaysAgo },
          paymentStatus: 'paid',
          status:        { $ne: 'cancelled' },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          totalOrders:  { $sum: 1 },
          totalRevenue: { $sum: '$totalPrice' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const formattedRevenueTrend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateString = d.toISOString().split('T')[0];
      const found = revenueTrend.find(r => r._id === dateString);
      return {
        day:     daysOfWeek[d.getDay()],
        date:    dateString,
        orders:  found?.totalOrders  ?? 0,
        revenue: found?.totalRevenue ?? 0,
      };
    });

    // ── Raw data fetches ───────────────────────────────────
    const rawUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(ACTIVITIES_LIMIT)
      .select('name createdAt');

    // Populate user name on orders so we can show who placed them
    const rawOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(ACTIVITIES_LIMIT)
      .populate('user', 'name')
      .select('totalPrice status paymentStatus createdAt updatedAt user cancellationReason');

    // ── Build combined activity list ───────────────────────
    const combinedActivities = [];

    // 1. New user registrations
    rawUsers.forEach(u => {
      combinedActivities.push({
        type:      'user_registered',
        user:      u.name || 'Unknown user',
        date:      u.createdAt,
        sortKey:   u.createdAt,
      });
    });

    // 2. Orders placed
    rawOrders.forEach(o => {
      combinedActivities.push({
        type:    'order_placed',
        user:    o.user?.name || null,
        orderId: o._id.toString().slice(-6).toUpperCase(),
        amount:  o.totalPrice ?? null,
        date:    o.createdAt,
        sortKey: o.createdAt,
      });
    });

    // 3. Payments received  (paid orders — keyed off updatedAt so it feels like a separate event)
    rawOrders
      .filter(o => o.paymentStatus === 'paid')
      .forEach(o => {
        combinedActivities.push({
          type:    'payment_received',
          user:    o.user?.name || null,
          amount:  o.totalPrice ?? null,
          orderId: o._id.toString().slice(-6).toUpperCase(),
          date:    o.updatedAt || o.createdAt,
          sortKey: o.updatedAt || o.createdAt,
        });
      });

    // 4. Order status changes  (any order that isn't 'pending' has had a status event)
    //    Cancellations get their reason surfaced via the `note` field so the
    //    admin feed shows *why*, not just that the status flipped.
    rawOrders
      .filter(o => o.status && o.status !== 'pending')
      .forEach(o => {
        combinedActivities.push({
          type:    'order_status_changed',
          user:    o.user?.name || null,
          orderId: o._id.toString().slice(-6).toUpperCase(),
          status:  o.status,
          note:    o.status === 'cancelled' ? o.cancellationReason : undefined,
          date:    o.updatedAt || o.createdAt,
          sortKey: o.updatedAt || o.createdAt,
        });
      });

    // ── Sort newest-first and cap ──────────────────────────
    combinedActivities.sort((a, b) => new Date(b.sortKey) - new Date(a.sortKey));

    const recent = combinedActivities
      .slice(0, ACTIVITIES_LIMIT)
      .map(({ sortKey, ...rest }) => rest); // strip internal sort key before sending

    res.status(200).json({
      users,
      payments,
      orders,
      cancelled,
      schedule,
      visits,
      recent,
      revenueTrend: formattedRevenueTrend,
    });

  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch dashboard statistics.' });
  }
};

// @desc    Update user (Admin only)
// @route   PUT /api/auth/admin/users/:id
// @access  Private/Admin
export const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, phone, address, location, isAdmin, isVerified } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.isAdmin && !isAdmin && user._id.toString() === req.user.id) {
      return res.status(403).json({ message: 'Cannot revoke your own admin privileges via this route.' });
    }

    user.name = name || user.name;
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email });
      if (emailExists && emailExists._id.toString() !== userId) {
        return res.status(400).json({ message: 'Email already registered by another user.' });
      }
      user.email = email;
    }
    user.phone      = phone      || user.phone;
    user.address    = address    || user.address;

    // Same guard as updateProfile: only overwrite the saved GPS pin if the
    // admin form actually sent valid coordinates.
    const parsedLocation = parseLocation(location);
    if (parsedLocation) {
      user.location = parsedLocation;
    }

    user.isAdmin    = typeof isAdmin    === 'boolean' ? isAdmin    : user.isAdmin;
    user.isVerified = typeof isVerified === 'boolean' ? isVerified : user.isVerified;

    const updatedUser = await user.save();

    res.status(200).json({
      message: 'User updated successfully',
      user: {
        _id:        updatedUser._id,
        uniqueId:   updatedUser.uniqueId,
        name:       updatedUser.name,
        email:      updatedUser.email,
        phone:      updatedUser.phone,
        address:    updatedUser.address,
        location:   updatedUser.location,
        isAdmin:    updatedUser.isAdmin,
        isVerified: updatedUser.isVerified,
      },
    });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format.' });
    }
    if (error.code === 11000) {
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

    if (req.user.id === userId) {
      return res.status(403).json({ message: 'Administrators cannot delete their own account via this route.' });
    }

    const user = await User.findByIdAndDelete(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format.' });
    }
    res.status(500).json({ message: 'Server error deleting user.' });
  }
};