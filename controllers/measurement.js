import Measurement from '../models/measurement.js';

export const createMeasurement = async (req, res) => {
  try {
    const photoUrl = req.file?.path || null;
    const photoPublicId = req.file?.filename || null;

    const measurement = await Measurement.create({
      name: req.body.name,
      unit: req.body.unit,
      gender: req.body.gender,
      data: JSON.parse(req.body.data),
      photoUrl,
      photoPublicId,
      user: req.user.id,
    });

    res.status(201).json(measurement);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Read All
export const getMeasurements = async (req, res) => {
  try {
    const measurements = await Measurement.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(measurements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Read One
export const getMeasurementById = async (req, res) => {
  try {
    const measurement = await Measurement.findOne({ _id: req.params.id, user: req.user.id });
    if (!measurement) return res.status(404).json({ error: 'Measurement not found' });
    res.json(measurement);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Update
export const updateMeasurement = async (req, res) => {
  try {
    const update = {
      name: req.body.name,
      unit: req.body.unit,
      gender: req.body.gender,
      data: JSON.parse(req.body.data),
    };

    if (req.file) {
      update.photoUrl = req.file.path;
      update.photoPublicId = req.file.filename;
    }

    const measurement = await Measurement.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      update,
      { new: true }
    );

    if (!measurement) return res.status(404).json({ error: 'Measurement not found' });

    res.json(measurement);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Delete
export const deleteMeasurement = async (req, res) => {
  try {
    const measurement = await Measurement.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id
    });

    if (!measurement) return res.status(404).json({ error: 'Measurement not found' });

    res.json({ message: 'Measurement deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// controllers/measurementController.js
export const checkUserMeasurements = async (req, res) => {
  // console.log('✅ /api/measurements/has route hit with user:', req.user);

  try {
    const userId = req.user.id;
    const hasMeasurement = await Measurement.findOne({ user: userId });
    return res.status(200).json({ hasMeasurement: !!hasMeasurement });
  } catch (error) {
    console.error('Error checking user measurements:', error);
    return res.status(500).json({ message: 'Server error checking measurements' });
  }
};
