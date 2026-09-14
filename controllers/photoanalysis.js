// src/controllers/photoAnalysis.js
import OpenAI from 'openai';
import cloudinary from '../utils/cloudinary.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Schema 1: photo validity check ────────────────────────────────────────
// Deliberately lenient wording — this is a normal phone photo, not a
// studio shot, and only needs to catch real blockers (wrong number of
// people, not standing, most of the body out of frame). Overly literal
// checks here are what causes good photos to get rejected.
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
          description: 'True if the main subject is standing (not lying down or sitting). Ordinary standing poses — arms at sides, slightly bent, hands on hips, slight turn — all count as upright.',
        },
        isFullBody: {
          type: 'boolean',
          description: "True if the subject's head and feet are both visible, even with minor edge cropping typical of a phone photo. Only false if a large portion of the body (e.g. everything below the waist, or the head) is missing from frame.",
        },
        issues: {
          type: 'array',
          items: { type: 'string' },
          description: "Short, user-facing reasons the photo fails validation. Empty array if it passes. Do NOT include cosmetic complaints — lighting, background clutter, clothing choice, image quality — only real blockers to judging the person's body shape.",
        },
      },
      required: ['personCount', 'isUpright', 'isFullBody', 'issues'],
      additionalProperties: false,
    },
  },
};

const describeIssues = (check) => {
  if (check.issues?.length) return check.issues.join(' ');
  if (check.personCount === 0) return "We couldn't detect a person in this photo — please upload a clear photo of yourself.";
  if (check.personCount > 1) return 'This photo has more than one person in it — please upload a solo photo.';
  if (!check.isUpright) return 'The person in this photo should be standing upright, not lying down or sideways.';
  if (!check.isFullBody) return 'Please upload a full-body photo showing you from head to toe.';
  return 'This photo could not be used — please try a different one.';
};

const checkPhoto = async (imageUrl) => {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-2024-08-06',
    // Deterministic judgement — without this, the default temperature (1.0)
    // lets the same photo get judged slightly differently call to call,
    // which shows up as inconsistent, seemingly nonsensical rejections.
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Check this photo uploaded for a tailoring measurement profile. Be lenient — this is a normal phone photo, not a studio shot. Only flag a real problem: more than one person, the person lying/sitting rather than standing, or a large part of the body (head or lower body) missing from the frame. Minor edge cropping, imperfect lighting, background clutter, or casual clothing are NOT issues.',
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

// ── Schema 2: measurement estimate — only run once the photo has passed,
// and only when the user gave a reference height to scale against.
const MEASUREMENT_FIELDS = [
  'headCircumference', 'neckCircumference', 'backWidth', 'chestCircumference',
  'topLength', 'bicepCircumference', 'wristCircumference', 'shortSleeve',
  'stomach', 'totalHeight', 'waist', 'hips', 'riseLength',
  'thighCircumference', 'trouserLength', 'ankleCircumference',
  'footLength', 'footWidth',
];

const measurementProperties = Object.fromEntries(
  MEASUREMENT_FIELDS.map((key) => [
    key,
    {
      type: ['number', 'null'],
      description: `Estimated ${key} in centimetres, or null if it can't be reasonably estimated from this single photo.`,
    },
  ])
);

const MEASUREMENT_ESTIMATE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'measurement_estimate',
    strict: true,
    schema: {
      type: 'object',
      properties: measurementProperties,
      required: MEASUREMENT_FIELDS,
      additionalProperties: false,
    },
  },
};

const estimateMeasurements = async (imageUrl, referenceHeightCm) => {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-2024-08-06',
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `This person is ${referenceHeightCm}cm tall — use that as your scale reference. Estimate their body measurements in centimetres from this photo as a rough starting point for a tailor; the customer will review and adjust every value before it's used, so approximate is fine. Return null for any measurement you genuinely can't estimate from a single photo (e.g. wrist or ankle circumference are often not visible clearly enough) rather than guessing wildly.`,
          },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    response_format: MEASUREMENT_ESTIMATE_SCHEMA,
    max_tokens: 800,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  // Drop nulls so the client only prefills fields it actually got a value for.
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null));
};

// ── POST /api/photo-analysis ──────────────────────────────────────────────
// Standalone check so the measurement form can show pass/fail before the
// user submits — mirrors the validation createMeasurement/updateMeasurement
// run again at save time. The uploaded file here is only for analysis, so
// it's deleted from Cloudinary again once we're done with it, pass or fail.
export const analyzePhoto = async (req, res) => {
  const imageUrl      = req.file?.path;
  const photoPublicId = req.file?.filename;

  if (!imageUrl) {
    return res.status(400).json({ error: 'No photo was uploaded.' });
  }

  try {
    const check = await checkPhoto(imageUrl);

    if (!check.valid) {
      return res.status(200).json({
        valid: false,
        personCount: check.personCount,
        isUpright: check.isUpright,
        isFullBody: check.isFullBody,
        issues: check.issues,
        error: describeIssues(check),
        measurements: null,
      });
    }

    let measurements = null;
    const referenceHeightCm = req.body.referenceHeightCm ? Number(req.body.referenceHeightCm) : null;
    if (referenceHeightCm && Number.isFinite(referenceHeightCm)) {
      try {
        measurements = await estimateMeasurements(imageUrl, referenceHeightCm);
      } catch (estimateErr) {
        // A failed estimate shouldn't fail the whole request — the photo
        // still passed, the user just won't get a prefill this time.
        console.error('Measurement estimate failed:', estimateErr);
      }
    }

    return res.status(200).json({
      valid: true,
      personCount: check.personCount,
      isUpright: check.isUpright,
      isFullBody: check.isFullBody,
      issues: [],
      measurements,
    });
  } catch (err) {
    console.error('Photo analysis failed:', err);
    return res.status(502).json({ error: 'Could not check this photo right now — please try again.' });
  } finally {
    if (photoPublicId) {
      try {
        await cloudinary.uploader.destroy(photoPublicId);
      } catch (cleanupErr) {
        console.error('Failed to clean up temporary analysis photo:', cleanupErr);
      }
    }
  }
};