import express from 'express';
import upload from '../middlewares/uploadMiddleware.js';
import {
  createMeasurement,
  getMeasurements,
  getMeasurementById,
  updateMeasurement,
  deleteMeasurement,
  checkUserMeasurements
} from '../controllers/measurement.js';
import { authenticateUser } from '../middlewares/authMiddleware.js';

const router = express.Router();
router.get('/has', authenticateUser, checkUserMeasurements);
// Get all measurements for authenticated user
router.get('/', authenticateUser, getMeasurements);

// Get one measurement by ID
router.get('/:id', authenticateUser, getMeasurementById);

// Create a new measurement with optional photo upload
router.post('/', authenticateUser, upload.single('photo'), createMeasurement);

// Update a measurement (with optional new photo)
router.put('/:id', authenticateUser, upload.single('photo'), updateMeasurement);

// Delete a measurement
router.delete('/:id', authenticateUser, deleteMeasurement);



export default router;
