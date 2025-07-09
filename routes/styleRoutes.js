import express from 'express';
const router = express.Router();
import { addStyle, getStyles, getStyleById, updateStyle, deleteStyle } from '../controllers/styleContoller.js';
import { protect, authorize } from '../middlewares/authMiddleware.js'; // Import new middleware
import multer from 'multer';
import path from 'path';

// Setup Multer for file uploads
const upload = multer({
  dest: 'uploads/', // Temporary storage for files
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images (jpeg, jpg, png, gif) are allowed!'));
    }
  }
});

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