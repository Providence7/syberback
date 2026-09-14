// src/routes/photoAnalysisRoutes.js
import express from 'express';
import upload from '../middlewares/uploadMiddleware.js';
import { protect } from '../middlewares/authMiddleware.js';
import { analyzePhoto } from '../controllers/photoanalysis.js';

const router = express.Router();

// POST /api/photo-analysis — checked before save, standalone from create/update
router.post('/', protect, upload.single('photo'), analyzePhoto);

export default router;