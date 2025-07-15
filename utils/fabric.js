import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { v2 as cloudinary } from 'cloudinary'; // Import cloudinary

// Ensure cloudinary is configured (e.g., by importing your config)
import './cloudinary.js '; // Adjust path as per your project structure
// Make sure Cloudinary is configured before this.
// Example (if not configured globally):
// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET
// });

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'tailor_app_fabrics', // Specify a folder for fabrics
        allowed_formats: ['jpeg', 'png', 'jpg', 'webp'],
        transformation: [{ width: 500, height: 500, crop: 'limit' }] // Optional: resize images
    },
});

const upload = multer({ storage: storage });

export default upload;