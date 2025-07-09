import Style  from  "../models/styles.js"; // ESM import
import { v2 as cloudinary } from 'cloudinary'; // ESM import for cloudinary

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// @route   POST /api/styles
// @desc    Add a new style (Admin only)
// @access  Private (Admin)
export const addStyle = async (req, res) => { // Named export
  const {
    title,
    type,
    gender,
    ageGroup,
    price,
    description,
    details,
    colour,
    recommendedMaterials,
    yardsRequired,
    tags
  } = req.body;

  // Multer will place the file info on req.file
  const imageFile = req.file;

  try {
    if (!imageFile) {
      return res.status(400).json({ msg: 'No image file uploaded' });
    }

    // Upload image to Cloudinary
    const uploadResponse = await cloudinary.uploader.upload(imageFile.path, {
      folder: 'style-gallery', // Optional: organize images in a folder
    });

    const imageUrl = uploadResponse.secure_url; // Get the secure URL

    const newStyle = new Style({
      title,
      type,
      gender,
      ageGroup,
      price: Number(price), // Ensure price is number from FormData
      image: imageUrl, // Use the Cloudinary URL
      description,
      details,
      colour,
      // recommendedMaterials and tags will come as strings in FormData,
      // so convert them back to arrays
      recommendedMaterials: recommendedMaterials ? recommendedMaterials.split(',').map(item => item.trim()).filter(item => item !== '') : [],
      yardsRequired,
      tags: tags ? tags.split(',').map(item => item.trim()).filter(item => item !== '') : [],
      addedBy: req.user.id
    });

    const style = await newStyle.save();
    res.status(201).json(style);
  } catch (err) {
    console.error(err.message);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ msg: err.message });
    }
    res.status(500).send('Server Error');
  }
};

// @route   GET /api/styles
// @desc    Get all styles
// @access  Public
export const getStyles = async (req, res) => { // Named export
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
export const getStyleById = async (req, res) => { // Named export
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
// @desc    Update a style (Admin only)
// @access  Private (Admin)
export const updateStyle = async (req, res) => { // Named export
  const {
    title,
    type,
    gender,
    ageGroup,
    price,
    description,
    details,
    colour,
    recommendedMaterials,
    yardsRequired,
    tags
  } = req.body;

  const imageFile = req.file; // Check for new image upload

  // Build style object for update
  const styleFields = {};
  if (title) styleFields.title = title;
  if (type) styleFields.type = type;
  if (gender) styleFields.gender = gender;
  if (ageGroup) styleFields.ageGroup = ageGroup;
  if (price) styleFields.price = Number(price); // Ensure number
  if (description) styleFields.description = description;
  if (details) styleFields.details = details;
  if (colour) styleFields.colour = colour;

  if (recommendedMaterials !== undefined) { // Allow empty string to clear materials
      styleFields.recommendedMaterials = recommendedMaterials.split(',').map(item => item.trim()).filter(item => item !== '');
  }
  if (yardsRequired) styleFields.yardsRequired = yardsRequired;
  if (tags !== undefined) { // Allow empty string to clear tags
      styleFields.tags = tags.split(',').map(item => item.trim()).filter(item => item !== '');
  }


  try {
    let style = await Style.findById(req.params.id);

    if (!style) return res.status(404).json({ msg: 'Style not found' });

    // Handle new image upload for update
    if (imageFile) {
        const uploadResponse = await cloudinary.uploader.upload(imageFile.path, {
            folder: 'style-gallery',
        });
        styleFields.image = uploadResponse.secure_url;
    }

    style = await Style.findByIdAndUpdate(
      req.params.id,
      { $set: styleFields },
      { new: true, runValidators: true }
    );

    res.json(style);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Style not found' });
    }
    res.status(500).send('Server Error');
  }
};

// @route   DELETE /api/styles/:id
// @desc    Delete a style (Admin only)
// @access  Private (Admin)
export const deleteStyle = async (req, res) => { // Named export
  try {
    const style = await Style.findById(req.params.id);

    if (!style) {
      return res.status(404).json({ msg: 'Style not found' });
    }

    // Optional: Delete image from Cloudinary when style is deleted
    // You would need to parse the public_id from the image URL
    // Example: cloudinary.uploader.destroy(public_id_from_url);

    await Style.findByIdAndDelete(req.params.id);

    res.json({ msg: 'Style removed' });
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Style not found' });
    }
    res.status(500).send('Server Error');
  }
};