import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../utils/cloudinary.js';

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: `users/${req.user.id}/measurements`,
    allowed_formats: ['jpg', 'png', 'jpeg'],
    public_id: `${Date.now()}-${file.originalname.split('.')[0]}`, // optional, clean filename
  }),
});

const uploader = multer({ storage });

export default uploader;
