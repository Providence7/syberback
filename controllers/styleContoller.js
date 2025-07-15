// src/controllers/styleController.js
import Style from '../models/styles.js';
import { v2 as cloudinary } from 'cloudinary';

// It's good practice to ensure cloudinary is configured here or globally
// import '../config/cloudinaryConfig.js'; // Only if not configured globally in server.js or app.js

// Helper to extract public_id from Cloudinary URL (if you didn't store it)
// This is a fallback if you forgot to store cloudinary_id. Better to store it.
const getPublicIdFromUrl = (imageUrl) => {
  if (!imageUrl) return null;
  const parts = imageUrl.split('/');
  const filename = parts[parts.length - 1];
  return filename.substring(0, filename.lastIndexOf('.'));
};


// @route   POST /api/styles
// @desc    Add a new style (Admin only)
// @access  Private (Admin)
export const addStyle = async (req, res) => {
  const {
    title, type, gender, ageGroup, price, description,
    details, colour, recommendedMaterials, yardsRequired, tags
  } = req.body;

  // Multer will place the file info on req.file (if using multer-storage-cloudinary, it's already uploaded)
  const uploadedImage = req.file; // This now contains Cloudinary response directly if using CloudinaryStorage

  try {
    if (!uploadedImage) {
      return res.status(400).json({ msg: 'No image file uploaded or upload failed.' });
    }

    // Check if a style with the same title already exists
    const existingStyle = await Style.findOne({ title });
    if (existingStyle) {
      // If an image was uploaded, delete it from Cloudinary before sending error
      await cloudinary.uploader.destroy(uploadedImage.filename); // Use filename (public_id) from multer-storage-cloudinary
      return res.status(400).json({ msg: 'A style with this title already exists.' });
    }

    const newStyle = new Style({
      title,
      type,
      gender,
      ageGroup,
      price: Number(price),
      image: uploadedImage.path, // Cloudinary secure_url from multer-storage-cloudinary
      cloudinary_id: uploadedImage.filename, // Store the Cloudinary public_id
      description,
      details,
      colour,
      recommendedMaterials: recommendedMaterials ? recommendedMaterials.split(',').map(item => item.trim()).filter(item => item !== '') : [],
      yardsRequired: Number(yardsRequired), // Ensure yardsRequired is a number
      tags: tags ? tags.split(',').map(item => item.trim()).filter(item => item !== '') : [],
      addedBy: req.user.id // Ensure req.user.id is populated by your auth middleware
    });

    const style = await newStyle.save();
    res.status(201).json(style);
  } catch (err) {
    console.error('Error adding style:', err.message);
    // If an image was uploaded but saving to DB failed, delete it from Cloudinary
    if (uploadedImage && uploadedImage.filename) {
      await cloudinary.uploader.destroy(uploadedImage.filename);
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ msg: err.message });
    }
    res.status(500).send('Server Error');
  }
};

// @route   GET /api/styles
// @desc    Get all styles
// @access  Public
export const getStyles = async (req, res) => {
  try {
    const styles = await Style.find().sort({ createdAt: -1 });
    res.json(styles);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @route   GET /api/styles/:id
// @desc    Get style by ID
// @access  Public
export const getStyleById = async (req, res) => {
  try {
    const style = await Style.findById(req.params.id);
    if (!style) {
      return res.status(404).json({ msg: 'Style not found' });
    }
    res.json(style);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Style not found' });
    }
    res.status(500).send('Server Error');
  }
};

// @route   PUT /api/styles/:id
// @desc    Update a style (Admin only), with optional image upload
// @access  Private (Admin)
export const updateStyle = async (req, res) => {
  const {
    title, type, gender, ageGroup, price, description,
    details, colour, recommendedMaterials, yardsRequired, tags
  } = req.body;

  const uploadedImage = req.file; // This now contains Cloudinary response directly if using CloudinaryStorage

  try {
    let style = await Style.findById(req.params.id);

    if (!style) {
        if (uploadedImage && uploadedImage.filename) {
            await cloudinary.uploader.destroy(uploadedImage.filename);
        }
        return res.status(404).json({ msg: 'Style not found' });
    }

    // --- Core Logic Change Starts Here ---

    // 1. Update image and cloudinary_id ONLY if a new image is uploaded
    if (uploadedImage) {
      // Delete old image from Cloudinary if it exists
      if (style.cloudinary_id) {
        await cloudinary.uploader.destroy(style.cloudinary_id);
      } else if (style.image) {
          // Fallback for old styles that might not have cloudinary_id
          const oldPublicId = getPublicIdFromUrl(style.image);
          if (oldPublicId) {
              await cloudinary.uploader.destroy(oldPublicId);
          }
      }
      style.image = uploadedImage.path;
      style.cloudinary_id = uploadedImage.filename;
    }
    // IMPORTANT: If no new image, style.image and style.cloudinary_id retain their existing values
    // This is crucial for the 'required' validation.

    // 2. Update other text fields only if they are provided in the request body
    // Using `!== undefined` ensures that empty strings can be valid updates.
    if (title !== undefined) style.title = title;
    if (type !== undefined) style.type = type;
    if (gender !== undefined) style.gender = gender;
    if (ageGroup !== undefined) style.ageGroup = ageGroup;
    if (price !== undefined) style.price = Number(price); // Ensure number conversion
    if (description !== undefined) style.description = description;
    if (details !== undefined) style.details = details;
    if (colour !== undefined) style.colour = colour;

    // Handle recommendedMaterials and tags: if sent as undefined, keep existing.
    // If sent as empty string, clear them.
    if (recommendedMaterials !== undefined) {
      style.recommendedMaterials = recommendedMaterials.split(',').map(item => item.trim()).filter(item => item !== '');
    }
    if (yardsRequired !== undefined) style.yardsRequired = Number(yardsRequired); // Ensure number conversion
    if (tags !== undefined) {
      style.tags = tags.split(',').map(item => item.trim()).filter(item => item !== '');
    }

    // --- Core Logic Change Ends Here ---

    const updatedStyle = await style.save(); // Save the modified document
    res.json(updatedStyle);
  } catch (err) {
    console.error('Error updating style:', err.message); // Log the specific Mongoose validation message
    // If a new image was uploaded but DB update failed, delete the new image from Cloudinary
    if (uploadedImage && uploadedImage.filename) {
      await cloudinary.uploader.destroy(uploadedImage.filename);
    }
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Style not found' });
    }
    if (err.name === 'ValidationError') {
      // Send the validation error message back to the frontend
      const errors = {};
      for (let field in err.errors) {
          errors[field] = err.errors[field].message;
      }
      return res.status(400).json({ msg: 'Validation failed', errors: errors, message: err.message }); // Provide more detail
    }
    res.status(500).send('Server Error');
  }
};
// @route   DELETE /api/styles/:id
// @desc    Delete a style (Admin only)
// @access  Private (Admin)
export const deleteStyle = async (req, res) => {
  try {
    const style = await Style.findById(req.params.id);

    if (!style) {
      return res.status(404).json({ msg: 'Style not found' });
    }

    // Delete image from Cloudinary using the stored public_id
    if (style.cloudinary_id) {
      await cloudinary.uploader.destroy(style.cloudinary_id);
    } else if (style.image) { // Fallback if cloudinary_id wasn't stored
        const publicId = getPublicIdFromUrl(style.image);
        if (publicId) {
            await cloudinary.uploader.destroy(publicId);
        }
    }

    await Style.findByIdAndDelete(req.params.id);

    res.json({ msg: 'Style removed' });
  } catch (err) {
    console.error('Error deleting style:', err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Style not found' });
    }
    res.status(500).send('Server Error');
  }
};