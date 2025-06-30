import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => ({
    folder: 'online-orders',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    public_id: `${file.fieldname}-${Date.now()}`
  })
});

export default { cloudinary, storage };
