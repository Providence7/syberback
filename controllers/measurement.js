// src/controllers/measurement.js
import OpenAI from 'openai';
import Measurement from '../models/measurement.js';
import User from '../models/user.js';
import { determineSize, SIZE_MAP } from '../utils/sizeGude.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const parseAge = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// Server-side single source of truth for garment size. Never trust
// client-computed size fields — always recompute from the measurement
// data + age that's actually being saved.
const computeSize = (data, age) => {
  const size = determineSize({ ...data, age }) || SIZE_MAP.m;
  return {
    size:      size.key,
    sizeLabel: size.label,
  };
};

// ── Photo validation (GPT-4o vision) ──────────────────────────────────────
// Checks only what we need to accept a tailoring photo: exactly one person,
// standing upright, visible head to toe. No measurement generation.
// imageUrl must be a publicly reachable URL (e.g. the Cloudinary secure_url
// multer-storage-cloudinary already gave us) — no base64/buffer needed.

const PHOTO_CHECK_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'photo_check',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        personCount: {
          type: 'integer',
          description: 'Number of distinct people visible in the photo.',
        },
        isUpright: {
          type: 'boolean',
          description: 'True if the main subject is standing upright (not lying down, sitting, or sideways).',
        },
        isFullBody: {
          type: 'boolean',
          description: 'True if the subject is visible head to toe with no significant cropping of head or feet.',
        },
        issues: {
          type: 'array',
          items: { type: 'string' },
          description: 'Short, user-facing reasons the photo fails validation. Empty array if it passes.',
        },
      },
      required: ['personCount', 'isUpright', 'isFullBody', 'issues'],
      additionalProperties: false,
    },
  },
};

const describePhotoIssues = (check) => {
  if (check.issues?.length) return check.issues.join(' ');
  if (check.personCount === 0) return 'No person was detected in this photo — please upload a clear photo of yourself.';
  if (check.personCount > 1) return 'This photo has more than one person in it — please upload a solo photo.';
  if (!check.isUpright) return 'The person in this photo should be standing upright, not lying down or sideways.';
  if (!check.isFullBody) return 'Please upload a full-body photo showing the person from head to toe.';
  return 'This photo could not be used — please try a different one.';
};

// Returns { valid, personCount, isUpright, isFullBody, issues } on success,
// or throws — callers decide how to surface a check-failed error vs an
// invalid-photo error.
const validatePersonPhoto = async (imageUrl) => {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-2024-08-06',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: "Check this photo uploaded for a tailoring measurement profile. Verify: (1) exactly one person is visible, (2) they are standing upright, not lying down, sitting, or sideways, (3) their full body is visible from head to toe, not cropped. List any issues that would make this photo unusable for a tailor; return an empty array if there are none.",
          },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    response_format: PHOTO_CHECK_SCHEMA,
    max_tokens: 500,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Empty response from vision model.');

  const parsed = JSON.parse(raw);
  const valid = parsed.personCount === 1 && parsed.isUpright && parsed.isFullBody;
  return { valid, ...parsed };
};

// ── POST /api/measurements ────────────────────────────────────────────────────
export const createMeasurement = async (req, res) => {
  try {
    const photoUrl       = req.file?.path     || null;
    const photoPublicId  = req.file?.filename || null;
    let photoValidated = false;

    if (req.file) {
      try {
        const check = await validatePersonPhoto(photoUrl);
        if (!check.valid) {
          // TODO: await cloudinary.uploader.destroy(photoPublicId); — remove the rejected upload
          return res.status(400).json({ message: describePhotoIssues(check) });
        }
        photoValidated = true;
      } catch (checkErr) {
        console.error('Photo validation failed:', checkErr);
        // TODO: await cloudinary.uploader.destroy(photoPublicId); — don't leave an unchecked photo attached
        return res.status(502).json({ message: 'Could not verify this photo right now — please try again.' });
      }
    }

    const age  = parseAge(req.body.age);
    const data = JSON.parse(req.body.data || '{}');
    const size = computeSize(data, age);

    const measurement = await Measurement.create({
      name:   req.body.name,
      unit:   req.body.unit,
      gender: req.body.gender,
      age,
      data,
      ...size,
      photoUrl,
      photoPublicId,
      photoValidated,
      user:   req.user.id,
    });

    const populated = await Measurement.findById(measurement._id).populate('user', 'name email');
    res.status(201).json(populated);
  } catch (err) {
    console.error('createMeasurement error:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation failed', errors: Object.values(err.errors).map(e => e.message) });
    }
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
    let photoUpdate = {};

    if (req.file) {
      try {
        const check = await validatePersonPhoto(req.file.path);
        if (!check.valid) {
          // TODO: await cloudinary.uploader.destroy(req.file.filename); — remove the rejected upload
          return res.status(400).json({ message: describePhotoIssues(check) });
        }
      } catch (checkErr) {
        console.error('Photo validation failed:', checkErr);
        // TODO: await cloudinary.uploader.destroy(req.file.filename);
        return res.status(502).json({ message: 'Could not verify this photo right now — please try again.' });
      }

      const old = await Measurement.findOne({ _id: req.params.id, user: req.user.id }).select('photoPublicId');
      if (old?.photoPublicId) {
        // TODO: await cloudinary.uploader.destroy(old.photoPublicId);
      }
      photoUpdate = {
        photoUrl:       req.file.path,
        photoPublicId:  req.file.filename,
        photoValidated: true,
      };
    }

    const age  = parseAge(req.body.age);
    const data = JSON.parse(req.body.data || '{}');
    const size = computeSize(data, age);

    const update = {
      name:   req.body.name,
      unit:   req.body.unit,
      gender: req.body.gender,
      age,
      data,
      ...size,
      ...photoUpdate,
    };

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
        { name:      { $regex: searchTerm, $options: 'i' } },
        { sizeLabel: { $regex: searchTerm, $options: 'i' } },
      ];
      if (userIds.length > 0) query.$or.push({ user: { $in: userIds } });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const all = await Measurement.find(query)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

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
    let photoUpdate = {};

    if (req.file) {
      try {
        const check = await validatePersonPhoto(req.file.path);
        if (!check.valid) {
          // TODO: await cloudinary.uploader.destroy(req.file.filename);
          return res.status(400).json({ message: describePhotoIssues(check) });
        }
      } catch (checkErr) {
        console.error('Photo validation failed:', checkErr);
        // TODO: await cloudinary.uploader.destroy(req.file.filename);
        return res.status(502).json({ message: 'Could not verify this photo right now — please try again.' });
      }

      const old = await Measurement.findById(req.params.id).select('photoPublicId');
      if (old?.photoPublicId) {
        // TODO: await cloudinary.uploader.destroy(old.photoPublicId);
      }
      photoUpdate = {
        photoUrl:       req.file.path,
        photoPublicId:  req.file.filename,
        photoValidated: true,
      };
    }

    const { name, unit, gender, data: rawData, age: rawAge } = req.body;
    const age  = parseAge(rawAge);
    const data = JSON.parse(rawData || '{}');
    const size = computeSize(data, age);

    const update = { name, unit, gender, age, data, ...size, ...photoUpdate };

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