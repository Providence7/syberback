// src/routes/styleRoutes.js
import express from 'express';
const router = express.Router();

import {
  addStyle,
  getStyles,
  getStyleById,
  updateStyle,
  deleteStyle,
} from '../controllers/styleContoller.js';

import { bulkAddStyles }  from '../controllers/stylesBulk.js';
import { imageProxy }     from '../middlewares/imageProxyMiddleware.js';  // NEW
import { protect, authorize } from '../middlewares/authMiddleware.js';
import upload from '../utils/multer.js';

// ── Image proxy (for admin UI previews — no CORS, works with Pinterest) ────
router.get('/image-proxy', protect, imageProxy);  // NEW — before /:id

// ── Bulk (JSON body, no file upload needed) ────────────────────────────────
router.post('/bulk', protect, authorize(['admin']), bulkAddStyles);

// ── Standard CRUD ──────────────────────────────────────────────────────────
router.post('/',      protect, authorize(['admin']), upload.single('image'), addStyle);
router.get('/',       getStyles);
router.get('/:id',    getStyleById);
router.put('/:id',    protect, authorize(['admin']), upload.single('image'), updateStyle);
router.delete('/:id', protect, authorize(['admin']), deleteStyle);

export default router;