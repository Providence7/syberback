// src/routes/fabricRoutes.js
import express from 'express';
const router = express.Router();
import {
    addFabric,
    getFabrics,
    getFabricById,
    updateFabric,
    deleteFabric
} from '../controllers/fabricContoller.js';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import upload from '../utils/fabric.js'; // Import your custom multer setup

// @route   POST /api/fabrics
// @desc    Add a new fabric (Admin only)
// @access  Private (Admin)
router.post('/', protect, authorize(['admin']), upload.single('image'), addFabric);

// @route   GET /api/fabrics
// @desc    Get all fabrics
// @access  Public
router.get('/', getFabrics);

// @route   GET /api/fabrics/:id
// @desc    Get single fabric by ID
// @access  Public
router.get('/:id', getFabricById);

// @route   PUT /api/fabrics/:id
// @desc    Update a fabric (Admin only), with optional image upload
// @access  Private (Admin)
router.put('/:id', protect, authorize(['admin']), upload.single('image'), updateFabric);

// @route   DELETE /api/fabrics/:id
// @desc    Delete a fabric (Admin only)
// @access  Private (Admin)
router.delete('/:id', protect, authorize(['admin']), deleteFabric);

export default router;