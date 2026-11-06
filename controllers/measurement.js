// src/controllers/measurement.js
import OpenAI from 'openai';
import Measurement from '../models/measurement.js';
import User from '../models/user.js';
import { determineSize, SIZE_MAP } from '../utils/sizeGuide.js';
import { notifyAdminsPhotoOnly } from '../utils/pushNotify.js';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const parseAge = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const parseData = (raw) => {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

// True if at least one real measurement value was entered.
const hasMeasurementValues = (data) =>
  !!data &&
  typeof data === 'object' &&
  Object.values(data).some((v) => v !== '' && v !== null && v !== undefined);

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

// ── Photo check (GPT-4o vision) — ADVISORY ONLY ───────────────────────────
// The browser already blocks bad photos (MoveNet). This server check is a
// second opinion that LABELS the photo for the admin — it never rejects or
// deletes one. If OpenAI is down, mis-configured or disagrees, the photo is
// still saved.

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
  if (check.personCount === 0) return 'No person was detected in this photo.';
  if (check.personCount > 1) return 'This photo has more than one person in it.';
  if (!check.isUpright) return 'The person in this photo does not appear to be standing upright.';
  if (!check.isFullBody) return 'The photo does not show the person from head to toe.';
  return 'This photo could not be verified.';
};

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

// Never throws, never blocks. Returns the fields to store on the measurement.
const checkPhotoAdvisory = async (photoUrl) => {
  try {
    const check = await validatePersonPhoto(photoUrl);
    return {
      photoCheck:      check.valid ? 'passed' : 'failed',
      photoValidated:  check.valid,
      photoCheckNotes: check.valid ? '' : describePhotoIssues(check),
    };
  } catch (err) {
    // This line tells you WHY the AI check isn't working (bad key, quota, etc.)
    console.error('[photo check] unavailable — saving photo unchecked:', err.message);
    return { photoCheck: 'unchecked', photoValidated: false, photoCheckNotes: '' };
  }
};

// ── POST /api/measurements ────────────────────────────────────────────────────
export const createMeasurement = async (req, res) => {
  try {
    const photoUrl      = req.file?.path     || null;
    const photoPublicId = req.file?.filename || null;

    const age  = parseAge(req.body.age);
    const data = parseData(req.body.data);

    const hasValues = hasMeasurementValues(data);
    if (!photoUrl && !hasValues) {
      return res.status(400).json({
        message: 'Add a full-body photo or fill in at least one measurement.',
      });
    }

    const photoOnly = !!photoUrl && !hasValues;
    const photoMeta = photoUrl
      ? await checkPhotoAdvisory(photoUrl)
      : { photoCheck: 'unchecked', photoValidated: false, photoCheckNotes: '' };

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
      ...photoMeta,
      photoOnly,
      user:   req.user.id,
    });

    const populated = await Measurement.findById(measurement._id).populate('user', 'name email');

    // Fire-and-forget: the customer's save must never wait on (or fail because of) alerts.
    if (photoOnly) {
      notifyAdminsPhotoOnly(req, populated).catch((e) =>
        console.error('[photo-only alert] failed:', e.message),
      );
    }

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
    const existing = await Measurement.findOne({ _id: req.params.id, user: req.user.id })
      .select('photoUrl photoPublicId');
    if (!existing) return res.status(404).json({ error: 'Measurement not found' });

    let photoUpdate = {};

    if (req.file) {
      const photoMeta = await checkPhotoAdvisory(req.file.path);
      if (existing.photoPublicId) {
        // TODO: await cloudinary.uploader.destroy(existing.photoPublicId);
      }
      photoUpdate = {
        photoUrl:      req.file.path,
        photoPublicId: req.file.filename,
        ...photoMeta,
      };
    }

    const age  = parseAge(req.body.age);
    const data = parseData(req.body.data);
    const size = computeSize(data, age);

    const finalPhotoUrl = photoUpdate.photoUrl || existing.photoUrl;
    const photoOnly     = !!finalPhotoUrl && !hasMeasurementValues(data);

    const update = {
      name:   req.body.name,
      unit:   req.body.unit,
      gender: req.body.gender,
      age,
      data,
      ...size,
      ...photoUpdate,
      photoOnly,
    };

    const measurement = await Measurement.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      update,
      { new: true, runValidators: true }
    ).populate('user', 'name email');

    if (!measurement) return res.status(404).json({ error: 'Measurement not found' });

    // A new photo was added to a profile that still has no measurements → alert the admin.
    if (req.file && photoOnly) {
      notifyAdminsPhotoOnly(req, measurement).catch((e) =>
        console.error('[photo-only alert] failed:', e.message),
      );
    }

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
    const hasPhoto    = !!measurement?.photoUrl;
    return res.status(200).json({ hasMeasurement: !!measurement, hasPhoto });
  } catch (err) {
    console.error('checkUserMeasurements error:', err);
    return res.status(500).json({ message: 'Server error checking measurements' });
  }
};

// ── GET /api/measurements/admin ───────────────────────────────────────────────
// Extra filter: ?photoOnly=true → only profiles waiting to be measured.
export const getAdminMeasurements = async (req, res) => {
  try {
    const { page = 1, limit = 10, searchTerm, gender, unit, photoOnly } = req.query;

    let query = {};
    if (gender && gender !== 'All') query.gender = gender;
    if (unit   && unit   !== 'All') query.unit   = unit;
    if (photoOnly === 'true')       query.photoOnly = true;

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
// This is where YOU enter the measurements for a photo-only profile. As soon
// as real values are saved, photoOnly flips to false and the size is
// recomputed from them.
export const updateMeasurementAdmin = async (req, res) => {
  try {
    const existing = await Measurement.findById(req.params.id).select('photoUrl photoPublicId');
    if (!existing) return res.status(404).json({ message: 'Measurement not found.' });

    let photoUpdate = {};

    if (req.file) {
      const photoMeta = await checkPhotoAdvisory(req.file.path);
      if (existing.photoPublicId) {
        // TODO: await cloudinary.uploader.destroy(existing.photoPublicId);
      }
      photoUpdate = {
        photoUrl:      req.file.path,
        photoPublicId: req.file.filename,
        ...photoMeta,
      };
    }

    const { name, unit, gender, data: rawData, age: rawAge } = req.body;
    const age  = parseAge(rawAge);
    const data = parseData(rawData);
    const size = computeSize(data, age);

    const finalPhotoUrl = photoUpdate.photoUrl || existing.photoUrl;
    const photoOnly     = !!finalPhotoUrl && !hasMeasurementValues(data);

    const update = { name, unit, gender, age, data, ...size, ...photoUpdate, photoOnly };

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