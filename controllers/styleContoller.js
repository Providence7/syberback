import Style from '../models/styles.js';
import { v2 as cloudinary } from 'cloudinary';
import { broadcastNotification } from '../utils/notifyUsers.js';
import User from '../models/user.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Embed the chosen unit into every size value so the string is self-contained.
 * e.g. quantities = { small: "2", large: "3" }, unit = "yds"
 *   →  { small: "2 yds", large: "3 yds" }
 *
 * If a value already contains a space (unit already embedded), leave it alone.
 * If unit is empty / falsy, store the raw number string.
 */
const applyUnit = (quantities, unit) => {
  if (!quantities || typeof quantities !== 'object') return {};
  const formatted = {};
  Object.entries(quantities).forEach(([size, value]) => {
    const v = String(value).trim();
    if (!v) return; // skip empty sizes
    formatted[size] = unit && !v.includes(' ') ? `${v} ${unit}` : v;
  });
  return formatted;
};

// ---------------------------------------------------------------------------
// @route   POST /api/styles
// @desc    Add a new style (Admin only)
// ---------------------------------------------------------------------------
export const addStyle = async (req, res) => {
  const {
    title, type, gender, ageGroup, price, description,
    details, colour, recommendedMaterials, materialQuantities,
    materialUnit, tags,
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

    const materialsArr = recommendedMaterials
      ? recommendedMaterials.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    let parsedQuantities = {};
    try { parsedQuantities = materialQuantities ? JSON.parse(materialQuantities) : {}; }
    catch { parsedQuantities = {}; }

    const finalQuantities = applyUnit(parsedQuantities, materialUnit || '');

    const newStyle = new Style({
      title,
      type: type ? type.split(',').map(s => s.trim()).filter(Boolean) : [],
      gender, ageGroup,
      price: Number(price),
      image: uploadedImage.path,
      cloudinary_id: uploadedImage.filename,
      description, details, colour,
      recommendedMaterials: materialsArr,
      materialQuantities: finalQuantities,
      materialUnit: materialUnit || '',
      tags: tags ? tags.split(',').map(s => s.trim()).filter(Boolean) : [],
      addedBy: req.user.id,
    });

    const style = await newStyle.save();

    // ✅ Notify all users in real-time
    try {
      const io = req.app.get('io');
      const users = await User.find({}, '_id');
      await broadcastNotification(io, users.map(u => u._id), {
        title:    '✨ New Style Added',
        message:  `Check out our new style: "${style.title}"`,
        type:     'info',
        category: 'style',
      });
    } catch (notifErr) {
      console.error('Notification error (non-blocking):', notifErr.message);
    }

    res.status(201).json(style);
  } catch (err) {
    console.error('Error adding style:', err.message);
    if (uploadedImage?.filename) await cloudinary.uploader.destroy(uploadedImage.filename);
    res.status(500).send('Server Error');
  }
};

export const updateStyle = async (req, res) => {
  const {
    title, type, gender, ageGroup, price, description,
    details, colour, recommendedMaterials, materialQuantities,
    materialUnit, tags,
  } = req.body;

  const uploadedImage = req.file;

  try {
    let style = await Style.findById(req.params.id);
    if (!style) return res.status(404).json({ msg: 'Style not found' });

    if (uploadedImage) {
      if (style.cloudinary_id) await cloudinary.uploader.destroy(style.cloudinary_id);
      style.image = uploadedImage.path;
      style.cloudinary_id = uploadedImage.filename;
    }

    const updateFields = {};
    if (title !== undefined)        updateFields.title        = title;
    if (type !== undefined)         updateFields.type         = type.split(',').map(s => s.trim()).filter(Boolean);
    if (gender !== undefined)       updateFields.gender       = gender;
    if (ageGroup !== undefined)     updateFields.ageGroup     = ageGroup;
    if (price !== undefined)        updateFields.price        = Number(price);
    if (description !== undefined)  updateFields.description  = description;
    if (details !== undefined)      updateFields.details      = details;
    if (colour !== undefined)       updateFields.colour       = colour;
    if (materialUnit !== undefined) updateFields.materialUnit = materialUnit;

    if (recommendedMaterials !== undefined) {
      updateFields.recommendedMaterials = recommendedMaterials
        .split(',').map(s => s.trim()).filter(Boolean);
    }
    if (materialQuantities !== undefined) {
      let parsedQ = {};
      try { parsedQ = JSON.parse(materialQuantities); } catch { parsedQ = {}; }
      const unitToUse = materialUnit !== undefined ? materialUnit : (style.materialUnit || '');
      updateFields.materialQuantities = applyUnit(parsedQ, unitToUse);
    }
    if (tags !== undefined) {
      updateFields.tags = tags.split(',').map(s => s.trim()).filter(Boolean);
    }

    const updatedStyle = await Style.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true },
    );

    // ✅ Notify all users about the update
    try {
      const io = req.app.get('io');
      const users = await User.find({}, '_id');
      await broadcastNotification(io, users.map(u => u._id), {
        title:    '🔄 Style Updated',
        message:  `The style "${updatedStyle.title}" has been refreshed with new details.`,
        type:     'info',
        category: 'style',
      });
    } catch (notifErr) {
      console.error('Notification error (non-blocking):', notifErr.message);
    }

    res.json(updatedStyle);
  } catch (err) {
    console.error('Error updating style:', err.message);
    res.status(500).send('Server Error');
  }
};

// ---------------------------------------------------------------------------
// @route   GET /api/styles
// ---------------------------------------------------------------------------
export const getStyles = async (req, res) => {
  try {
    const styles = await Style.find().sort({ createdAt: -1 });
    res.json(styles);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// ---------------------------------------------------------------------------
// @route   GET /api/styles/:id
// ---------------------------------------------------------------------------
export const getStyleById = async (req, res) => {
  try {
    const style = await Style.findById(req.params.id);
    if (!style) return res.status(404).json({ msg: 'Style not found' });
    res.json(style);
  } catch (err) {
    res.status(500).send('Server Error');
  }
};
// ---------------------------------------------------------------------------
// @route   DELETE /api/styles/:id
// ---------------------------------------------------------------------------
export const deleteStyle = async (req, res) => {
  try {
    const style = await Style.findById(req.params.id);
    if (!style) return res.status(404).json({ msg: 'Style not found' });

    if (style.cloudinary_id) await cloudinary.uploader.destroy(style.cloudinary_id);
    await Style.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Style removed' });
  } catch (err) {
    res.status(500).send('Server Error');
  }
};