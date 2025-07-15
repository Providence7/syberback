// src/routes/styleRoutes.js
import express from 'express';
const router = express.Router();
import { addStyle, getStyles, getStyleById, updateStyle, deleteStyle } from '../controllers/styleContoller.js'; // Corrected typo styleContoller to styleController
import { protect, authorize } from '../middlewares/authMiddleware.js';
import upload from '../utils/multer.js'; // Import your custom multer setup

// @route   POST /api/styles
// @desc    Add a new style (Admin only)
// @access  Private (Admin)
router.post('/', protect, authorize(['admin']), upload.single('image'), addStyle);

// @route   GET /api/styles
// @desc    Get all styles
// @access  Public (can be protected if only logged-in users should see it: protect)
router.get('/', getStyles);

// @route   GET /api/styles/:id
// @desc    Get single style by ID
// @access  Public
router.get('/:id', getStyleById);

// @route   PUT /api/styles/:id
// @desc    Update a style (Admin only), with optional image upload
// @access  Private (Admin)
router.put('/:id', protect, authorize(['admin']), upload.single('image'), updateStyle);

// @route   DELETE /api/styles/:id
// @desc    Delete a style (Admin only)
// @access  Private (Admin)
router.delete('/:id', protect, authorize(['admin']), deleteStyle);

export default router;