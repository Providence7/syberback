// src/routes/auth.js
import express from 'express';
import {
  register, verifyEmail, login, logout,updateProfile,getProfile,
  refresh, me, requestPasswordReset, resetPassword , resendVerification
} from '../controllers/authController.js';
import { authenticateUser } from '../middlewares/authMiddleware.js';


const router = express.Router();

router.post('/register', register);
router.post('/verify-email', verifyEmail);
router.post('/login', login);
router.post('/logout', logout);
router.post('/refresh', refresh);
router.get('/me',authenticateUser, me);
router.post('/request-reset', requestPasswordReset);
router.post('/reset-password', resetPassword);
router.post('/resend-verification', resendVerification);
router.get('/profile', authenticateUser, getProfile);
router.put('/profile', authenticateUser, updateProfile);

export default router;
