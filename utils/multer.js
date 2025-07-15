// src/utils/multer.js
import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { v2 as cloudinary } from 'cloudinary'; // Import cloudinary

// Ensure cloudinary is configured (e.g., by importing your config)
import './cloudinary.js '; // Adjust path as per your project structure

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'syber-tailors-styles', // Unique folder for your styles in Cloudinary
    allowed_formats: ['jpeg', 'png', 'jpg', 'webp'],
    transformation: [{ width: 800, height: 800, crop: 'limit' }] // Optional: Resize images on upload
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/; // Added webp as it's common
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(file.originalname.toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images (jpeg, jpg, png, gif, webp) are allowed!'));
    }
  }
});

export default upload;