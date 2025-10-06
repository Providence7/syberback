// src/routes/auth.js
import express from 'express';
import {
  register, verifyEmail, login, logout, updateProfile, getProfile,
  refresh, me, requestPasswordReset, resetPassword,  getUserById, updateUser, deleteUser,
  getAllUsers, // Existing admin functions
  getAdminDashboardStats // NEW: Import the dashboard stats function
} from '../controllers/authController.js';

import { protect, authorize } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/register', register);
router.post('/verify-email', verifyEmail);
router.post('/login', login);
router.post('/request-reset', requestPasswordReset);
router.post('/reset-password', resetPassword);
// router.post('/resend-verification', resendVerification);
router.post('/refresh', refresh);

// Protected routes (requires any authenticated user)
router.post('/logout', protect, logout);
router.get('/me', protect, me);
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);

// Admin-specific routes
// These routes require both authentication AND authorization (as an admin).

// Admin Dashboard or Overview
router.get('/admin/dashboard', protect, authorize(['admin']), (req, res) => {
  res.json({
    message: `Welcome to the Admin Dashboard, ${req.user.name}! You are an administrator.`,
    user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        isAdmin: req.user.isAdmin
    }
  });
});

// Admin User Management
router.get('/admin/users', protect, authorize(['admin']), getAllUsers);
router.get('/admin/users/:id', protect, authorize(['admin']), getUserById);

// --- NEW ADMIN DASHBOARD STATS ROUTE ---
router.get('/admin/dashboard-stats', protect, authorize(['admin']), getAdminDashboardStats);
// --- END NEW ---
// --- NEW ADMIN USER MANAGEMENT ROUTES ---
router.put('/admin/users/:id', protect, authorize(['admin']), updateUser);
router.delete('/admin/users/:id', protect, authorize(['admin']), deleteUser);
// --- END NEW ---
export default router;