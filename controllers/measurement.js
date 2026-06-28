// src/controllers/measurement.js
import Measurement from '../models/measurement.js';
import User from '../models/user.js';

// ── POST /api/measurements ────────────────────────────────────────────────────
export const createMeasurement = async (req, res) => {
  try {
    const photoUrl       = req.file?.path     || null;
    const photoPublicId  = req.file?.filename || null;

    // photoValidated is set to true only if an actual file was uploaded through
    // our multer middleware (meaning it passed basic mime/size checks server-side).
    // The client-side AI check is a UX guardrail; the flag here is a backend
    // audit trail that the upload was genuine and went through our pipeline.
    const photoValidated = !!req.file;

    const measurement = await Measurement.create({
      name:           req.body.name,
      unit:           req.body.unit,
      gender:         req.body.gender,
      size:           req.body.size,
      sizeLabel:      req.body.sizeLabel,
      age:            req.body.age || '',
      data:           JSON.parse(req.body.data || '{}'),
      photoUrl,
      photoPublicId,
      photoValidated,
      user:           req.user.id,
    });

    const populated = await Measurement.findById(measurement._id).populate('user', 'name email');
    res.status(201).json(populated);
  } catch (err) {
    console.error('createMeasurement error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/measurements ─────────────────────────────────────────────────────
export const getMeasurements = async (req, res) => {
  try {
    const measurements = await Measurement.find({ user: req.user.id })
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    res.json(measurements);
  } catch (err) {
    console.error('getMeasurements error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/measurements/:id ─────────────────────────────────────────────────
export const getMeasurementById = async (req, res) => {
  try {
    const measurement = await Measurement.findOne({ _id: req.params.id, user: req.user.id })
      .populate('user', 'name email');
    if (!measurement) return res.status(404).json({ error: 'Measurement not found' });
    res.json(measurement);
  } catch (err) {
    console.error('getMeasurementById error:', err);
    if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid measurement ID format.' });
    res.status(500).json({ error: err.message });
  }
};

// ── PUT /api/measurements/:id ─────────────────────────────────────────────────
export const updateMeasurement = async (req, res) => {
  try {
    const update = {
      name:      req.body.name,
      unit:      req.body.unit,
      gender:    req.body.gender,
      size:      req.body.size,
      sizeLabel: req.body.sizeLabel,
      age:       req.body.age || '',
      data:      JSON.parse(req.body.data || '{}'),
    };

    if (req.file) {
      const old = await Measurement.findOne({ _id: req.params.id, user: req.user.id }).select('photoPublicId');
      if (old?.photoPublicId) {
        // TODO: await cloudinary.uploader.destroy(old.photoPublicId);
      }
      update.photoUrl       = req.file.path;
      update.photoPublicId  = req.file.filename;
      update.photoValidated = true;
    }

    const measurement = await Measurement.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      update,
      { new: true, runValidators: true }
    ).populate('user', 'name email');

    if (!measurement) return res.status(404).json({ error: 'Measurement not found' });
    res.json(measurement);
  } catch (err) {
    console.error('updateMeasurement error:', err);
    if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid measurement ID format.' });
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation failed', errors: Object.values(err.errors).map(e => e.message) });
    }
    res.status(500).json({ error: err.message });
  }
};

// ── DELETE /api/measurements/:id ──────────────────────────────────────────────
export const deleteMeasurement = async (req, res) => {
  try {
    const measurement = await Measurement.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!measurement) return res.status(404).json({ error: 'Measurement not found' });
    // TODO: if (measurement.photoPublicId) await cloudinary.uploader.destroy(measurement.photoPublicId);
    res.json({ message: 'Measurement deleted' });
  } catch (err) {
    console.error('deleteMeasurement error:', err);
    if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid measurement ID format.' });
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/measurements/check ───────────────────────────────────────────────
export const checkUserMeasurements = async (req, res) => {
  try {
    const measurement = await Measurement.findOne({ user: req.user.id });
    const hasPhoto    = !!(measurement?.photoUrl && measurement?.photoValidated);
    return res.status(200).json({ hasMeasurement: !!measurement, hasPhoto });
  } catch (err) {
    console.error('checkUserMeasurements error:', err);
    return res.status(500).json({ message: 'Server error checking measurements' });
  }
};

// ── GET /api/measurements/admin ───────────────────────────────────────────────
export const getAdminMeasurements = async (req, res) => {
  try {
    const { page = 1, limit = 10, searchTerm, gender, unit } = req.query;

    let query = {};
    if (gender && gender !== 'All') query.gender = gender;
    if (unit   && unit   !== 'All') query.unit   = unit;

    if (searchTerm) {
      const matchingUsers = await User.find({
        $or: [
          { name:  { $regex: searchTerm, $options: 'i' } },
          { email: { $regex: searchTerm, $options: 'i' } },
        ],
      }).select('_id');

      const userIds = matchingUsers.map(u => u._id);

      query.$or = [
        { name:       { $regex: searchTerm, $options: 'i' } },
        { size:       { $regex: searchTerm, $options: 'i' } },
        { sizeLabel:  { $regex: searchTerm, $options: 'i' } },
      ];
      if (userIds.length > 0) query.$or.push({ user: { $in: userIds } });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const all = await Measurement.find(query)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Remove orphaned (deleted user) measurements on the fly
    const valid        = [];
    const orphanedIds  = [];
    for (const m of all) {
      if (m.user === null) orphanedIds.push(m._id);
      else valid.push(m);
    }
    if (orphanedIds.length > 0) {
      console.warn(`Deleting ${orphanedIds.length} orphaned measurements.`);
      await Measurement.deleteMany({ _id: { $in: orphanedIds } });
    }

    const total = await Measurement.countDocuments(query);
    res.status(200).json({
      measurements: valid,
      totalMeasurements: total,
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    console.error('getAdminMeasurements error:', err);
    res.status(500).json({ message: 'Server error fetching measurements.' });
  }
};

// ── GET /api/measurements/admin/:id ──────────────────────────────────────────
export const getAdminMeasurementById = async (req, res) => {
  try {
    const measurement = await Measurement.findById(req.params.id).populate('user', 'name email');
    if (!measurement) return res.status(404).json({ message: 'Measurement not found.' });
    res.status(200).json({ message: 'Measurement retrieved successfully', measurement });
  } catch (err) {
    console.error('getAdminMeasurementById error:', err);
    if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid measurement ID format.' });
    res.status(500).json({ message: 'Server error fetching measurement.' });
  }
};

// ── PUT /api/measurements/admin/:id ──────────────────────────────────────────
export const updateMeasurementAdmin = async (req, res) => {
  try {
    const { name, unit, gender, data, size, sizeLabel, age } = req.body;
    const update = {
      name, unit, gender, size, sizeLabel,
      age:  age || '',
      data: JSON.parse(data || '{}'),
    };

    if (req.file) {
      const old = await Measurement.findById(req.params.id).select('photoPublicId');
      if (old?.photoPublicId) {
        // TODO: await cloudinary.uploader.destroy(old.photoPublicId);
      }
      update.photoUrl       = req.file.path;
      update.photoPublicId  = req.file.filename;
      update.photoValidated = true;
    }

    const measurement = await Measurement.findByIdAndUpdate(req.params.id, update, {
      new: true, runValidators: true,
    }).populate('user', 'name email');

    if (!measurement) return res.status(404).json({ message: 'Measurement not found.' });
    res.status(200).json({ message: 'Measurement updated successfully', measurement });
  } catch (err) {
    console.error('updateMeasurementAdmin error:', err);
    if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid measurement ID format.' });
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation failed', errors: Object.values(err.errors).map(e => e.message) });
    }
    res.status(500).json({ message: 'Server error updating measurement.' });
  }
};

// ── DELETE /api/measurements/admin/:id ────────────────────────────────────────
export const deleteMeasurementAdmin = async (req, res) => {
  try {
    const measurement = await Measurement.findByIdAndDelete(req.params.id);
    if (!measurement) return res.status(404).json({ message: 'Measurement not found.' });
    // TODO: if (measurement.photoPublicId) await cloudinary.uploader.destroy(measurement.photoPublicId);
    res.status(200).json({ message: 'Measurement deleted successfully.' });
  } catch (err) {
    console.error('deleteMeasurementAdmin error:', err);
    if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid measurement ID format.' });
    res.status(500).json({ message: 'Server error deleting measurement.' });
  }
};