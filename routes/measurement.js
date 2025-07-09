// src/routes/measurementRoutes.js
import express from 'express';
import upload from '../middlewares/uploadMiddleware.js'; // Ensure this is correctly set up for Cloudinary
import { protect,  authorize } from '../middlewares/authMiddleware.js'; // Import  authorize
import {
    createMeasurement,
    getMeasurements,
    getMeasurementById,
    updateMeasurement,
    deleteMeasurement,
    checkUserMeasurements,
    // Import new admin functions
    getAdminMeasurements,
    getAdminMeasurementById,
    updateMeasurementAdmin,
    deleteMeasurementAdmin
} from '../controllers/measurement.js'; // Assuming it's in measurement.js

const router = express.Router();

// --- ADMIN MEASUREMENT ROUTES (PUT THESE FIRST!) ---
// Get all measurements for admin (e.g., GET /api/measurements/admin)
router.get('/admin', protect,  authorize('admin'), getAdminMeasurements);

// Get single measurement by ID for admin (e.g., GET /api/measurements/admin/:id)
router.get('/admin/:id', protect,  authorize('admin'), getAdminMeasurementById);

// Update a measurement for admin (e.g., PUT /api/measurements/admin/:id)
router.put('/admin/:id', protect,  authorize('admin'), upload.single('photo'), updateMeasurementAdmin);

// Delete a measurement for admin (e.g., DELETE /api/measurements/admin/:id)
router.delete('/admin/:id', protect,  authorize('admin'), deleteMeasurementAdmin);

// --- USER MEASUREMENT ROUTES (Existing routes) ---
router.get('/has', protect, checkUserMeasurements); // Check if user has any measurements

// Get all measurements for authenticated user
router.get('/', protect, getMeasurements); // Note: This is the user's /api/measurements

// Get one measurement by ID for authenticated user
router.get('/:id', protect, getMeasurementById);

// Create a new measurement with optional photo upload
router.post('/', protect, upload.single('photo'), createMeasurement);

// Update a measurement (with optional new photo)
router.put('/:id', protect, upload.single('photo'), updateMeasurement);

// Delete a measurement
router.delete('/:id', protect, deleteMeasurement);


export default router;