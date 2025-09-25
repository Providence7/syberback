import Style from '../models/styles.js';
import { v2 as cloudinary } from 'cloudinary';

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
    details, colour, recommendedMaterials, materialQuantities, tags
  } = req.body;

  const uploadedImage = req.file;

  try {
    if (!uploadedImage) {
      return res.status(400).json({ msg: 'No image file uploaded or upload failed.' });
    }

    const existingStyle = await Style.findOne({ title });
    if (existingStyle) {
      await cloudinary.uploader.destroy(uploadedImage.filename);
      return res.status(400).json({ msg: 'A style with this title already exists.' });
    }

    // Parse the materialQuantities JSON string into a JavaScript object
    const parsedMaterialQuantities = materialQuantities ? JSON.parse(materialQuantities) : {};

    const newStyle = new Style({
      title,
      // Handle the type field as a comma-separated array
      type: type ? type.split(',').map(item => item.trim()).filter(item => item !== '') : [],
      gender,
      ageGroup,
      price: Number(price),
      image: uploadedImage.path,
      cloudinary_id: uploadedImage.filename,
      description,
      details,
      colour,
      recommendedMaterials: recommendedMaterials ? recommendedMaterials.split(',').map(item => item.trim()).filter(item => item !== '') : [],
      materialQuantities: parsedMaterialQuantities,
      tags: tags ? tags.split(',').map(item => item.trim()).filter(item => item !== '') : [],
      addedBy: req.user.id
    });

    const style = await newStyle.save();
    res.status(201).json(style);
  } catch (err) {
    console.error('Error adding style:', err.message);
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
    details, colour, recommendedMaterials, materialQuantities, tags
  } = req.body;

  const uploadedImage = req.file;

  try {
    let style = await Style.findById(req.params.id);

    if (!style) {
      if (uploadedImage && uploadedImage.filename) {
        await cloudinary.uploader.destroy(uploadedImage.filename);
      }
      return res.status(404).json({ msg: 'Style not found' });
    }

    if (uploadedImage) {
      if (style.cloudinary_id) {
        await cloudinary.uploader.destroy(style.cloudinary_id);
      } else if (style.image) {
          const oldPublicId = getPublicIdFromUrl(style.image);
          if (oldPublicId) {
            await cloudinary.uploader.destroy(oldPublicId);
          }
      }
      style.image = uploadedImage.path;
      style.cloudinary_id = uploadedImage.filename;
    }

    const updateFields = {};

    if (title !== undefined) updateFields.title = title;
    // Handle type as an array
    if (type !== undefined) updateFields.type = type.split(',').map(item => item.trim()).filter(item => item !== '');
    if (gender !== undefined) updateFields.gender = gender;
    if (ageGroup !== undefined) updateFields.ageGroup = ageGroup;
    if (price !== undefined) updateFields.price = Number(price);
    if (description !== undefined) updateFields.description = description;
    if (details !== undefined) updateFields.details = details;
    if (colour !== undefined) updateFields.colour = colour;

    if (recommendedMaterials !== undefined) {
      updateFields.recommendedMaterials = recommendedMaterials.split(',').map(item => item.trim()).filter(item => item !== '');
    }

    // Parse and update materialQuantities
    if (materialQuantities !== undefined) {
      updateFields.materialQuantities = JSON.parse(materialQuantities);
    }
    
    if (tags !== undefined) {
      updateFields.tags = tags.split(',').map(item => item.trim()).filter(item => item !== '');
    }

    const updatedStyle = await Style.findByIdAndUpdate(
        req.params.id,
        { $set: updateFields },
        { new: true, runValidators: true }
    );

    res.json(updatedStyle);
  } catch (err) {
    console.error('Error updating style:', err.message);
    if (uploadedImage && uploadedImage.filename) {
      await cloudinary.uploader.destroy(uploadedImage.filename);
    }
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Style not found' });
    }
    if (err.name === 'ValidationError') {
      const errors = {};
      for (let field in err.errors) {
          errors[field] = err.errors[field].message;
      }
      return res.status(400).json({ msg: 'Validation failed', errors: errors, message: err.message });
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

    if (style.cloudinary_id) {
      await cloudinary.uploader.destroy(style.cloudinary_id);
    } else if (style.image) {
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