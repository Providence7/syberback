import Style from '../models/styles.js';
import cloudinary from '../utils/cloudinary.js';

export const getAllStyles = async (req, res, next) => {
  try {
    const styles = await Style.find();
    res.json(styles);
  } catch (error) {
    next(error);
  }
};

export const createStyle = async (req, res, next) => {
  try {
    const {
      title, type, gender, ageGroup, identity,
      yardsRequired, colour, recommendedMaterials,
      price, image, description, details
    } = req.body;

    const uploaded = await cloudinary.uploader.upload(image, {
      folder: 'styles',
    });

    const style = new Style({
      title,
      type,
      gender,
      ageGroup,
      identity,
      yardsRequired,
      colour,
      recommendedMaterials,
      price,
      image: uploaded.secure_url,
      description,
      details
    });

    const saved = await style.save();
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
};
