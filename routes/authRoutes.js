// src/routes/auth.js
import express from 'express';
import {
  register, verifyEmail, login, logout, updateProfile, getProfile,
  refresh, me, requestPasswordReset, resetPassword, getUserById, updateUser, deleteUser,
  getAllUsers,
  getAdminDashboardStats,
} from '../controllers/authController.js';

import { protect, authorize } from '../middlewares/authMiddleware.js';
import {
  registerLimiter,
  loginIpLimiter, loginEmailLimiter,
  verifyIpLimiter, verifyEmailLimiter,
  resetRequestIpLimiter, resetRequestEmailLimiter,
  resetPasswordLimiter,
} from '../middlewares/rateLimiters.js';

const router = express.Router();

// Public routes
router.post('/register', registerLimiter, register);
router.post('/verify-email', verifyIpLimiter, verifyEmailLimiter, verifyEmail);
router.post('/login', loginIpLimiter, loginEmailLimiter, login);
router.post('/request-reset', resetRequestIpLimiter, resetRequestEmailLimiter, requestPasswordReset);
router.post('/reset-password', resetPasswordLimiter, resetPassword);
// router.post('/resend-verification', resendVerification);

// Session routes: public on purpose. They answer 200 { user: null } for
// guests, so anonymous visitors never trigger a 401 in the console.
router.post('/refresh', refresh);
router.get('/me', me);
router.post('/logout', logout);

// Protected routes (any authenticated user)
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);

// Admin routes (authentication AND admin authorization)
router.get('/admin/dashboard', protect, authorize(['admin']), (req, res) => {
  res.json({
    message: `Welcome to the Admin Dashboard, ${req.user.name}! You are an administrator.`,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      isAdmin: req.user.isAdmin,
    },
  });
});

router.get('/admin/users', protect, authorize(['admin']), getAllUsers);
router.get('/admin/users/:id', protect, authorize(['admin']), getUserById);
router.get('/admin/dashboard-stats', protect, authorize(['admin']), getAdminDashboardStats);
router.put('/admin/users/:id', protect, authorize(['admin']), updateUser);
router.delete('/admin/users/:id', protect, authorize(['admin']), deleteUser);

export default router;