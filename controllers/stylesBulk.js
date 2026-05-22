/**
 * stylesBulkController.js
 *
 * FIXES:
 *  - fetchImageBuffer() now uses native fetch (Node 18+) instead of the
 *    manual http/https.get + chunk-buffer approach. Cleaner, less code, and
 *    the built-in redirect:manual mode lets us cap redirects at MAX_REDIRECTS
 *    (5) to prevent redirect loops / stack overflows.
 *  - Removed the `https` and `http` core-module imports (no longer needed).
 *  - All other logic (Cloudinary upload paths, applyUnit, bulkAddStyles) is
 *    unchanged.
 */

import Style     from '../models/styles.js';
import { v2 as cloudinary } from 'cloudinary';
import { broadcastNotification } from '../utils/notifyUsers.js';
import User      from '../models/user.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_REDIRECTS = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetch any public image URL server-side into a Buffer.
 *
 * Uses the native fetch API (Node 18+).
 * Node.js has no CORS restrictions so Pinterest, etc. all work.
 * Spoofs a browser User-Agent so hotlink-protection checks are bypassed.
 * Caps redirect chains at MAX_REDIRECTS to prevent loops / stack overflows.
 *
 * @param {string} url       — Image URL to fetch
 * @param {number} [_depth]  — Internal redirect counter; do not pass externally
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
async function fetchImageBuffer(url, _depth = 0) {
  if (_depth > MAX_REDIRECTS) {
    throw new Error(`fetchImageBuffer: too many redirects (max ${MAX_REDIRECTS}) for ${url}`);
  }

  const res = await fetch(url, {
    method:   'GET',
    redirect: 'manual',   // we handle redirects ourselves to enforce the cap
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://www.pinterest.com/',
      'Accept':  'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  });

  // ── Follow redirects manually ─────────────────────────────────────────────
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers.get('location');
    if (!location) {
      throw new Error(`fetchImageBuffer: redirect with no Location header from ${url}`);
    }
    // Consume body so the connection is released before recursing
    await res.body?.cancel?.();
    return fetchImageBuffer(location, _depth + 1);
  }

  if (!res.ok) {
    throw new Error(`fetchImageBuffer: HTTP ${res.status} for ${url}`);
  }

  const buffer      = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { buffer, contentType };
}

/**
 * Upload a raw Buffer to Cloudinary via upload_stream.
 * This avoids the URL-fetch path inside Cloudinary's SDK which also
 * gets blocked by Pinterest's hotlink protection.
 *
 * @param {Buffer} buffer
 * @param {string} contentType
 * @returns {Promise<object>} Cloudinary upload result
 */
function uploadBufferToCloudinary(buffer, contentType) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'styles', resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });
}

/**
 * Upload a base64 data-URI to Cloudinary (used when frontend sends imageData).
 *
 * @param {string} dataUri — data:image/...;base64,<data>
 * @returns {Promise<object>} Cloudinary upload result
 */
function uploadBase64ToCloudinary(dataUri) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      dataUri,
      { folder: 'styles', resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
  });
}

/**
 * Embed the chosen unit into every size value.
 * e.g. { small: "2" }, "yds"  →  { small: "2 yds" }
 *
 * @param {object} quantities
 * @param {string} unit
 * @returns {object}
 */
const applyUnit = (quantities, unit) => {
  if (!quantities || typeof quantities !== 'object') return {};
  const out = {};
  Object.entries(quantities).forEach(([sz, val]) => {
    const v = String(val).trim();
    if (!v) return;
    out[sz] = unit && !v.includes(' ') ? `${v} ${unit}` : v;
  });
  return out;
};

// ── Controller ────────────────────────────────────────────────────────────────

/**
 * @route  POST /api/styles/bulk
 * @desc   Bulk-create styles. Accepts imageData (base64) OR imageUrl (any URL
 *         including Pinterest). Image is fetched server-side so CORS is never
 *         an issue.
 * @access Private – Admin only
 */
export const bulkAddStyles = async (req, res) => {
  const { styles: items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ msg: 'No styles provided.' });
  }
  if (items.length > 50) {
    return res.status(400).json({ msg: 'Maximum 50 styles per bulk request.' });
  }

  const saved  = [];
  const failed = [];

  for (const item of items) {
    const {
      title, type, gender, ageGroup, price, colour,
      description, details, recommendedMaterials, materialUnit,
      materialQuantities, tags,
      imageData,   // base64 data-URI (preferred, sent from frontend)
      imageUrl,    // public URL fallback — backend fetches server-side
    } = item;

    // ── Basic validation ────────────────────────────────────────────────────
    if (!title || !price || !gender) {
      failed.push({ title: title || 'Unknown', error: 'Missing required fields (title, price, gender).' });
      continue;
    }
    if (!imageData && !imageUrl) {
      failed.push({ title, error: 'No image provided (imageData or imageUrl required).' });
      continue;
    }

    try {
      // ── Duplicate check ─────────────────────────────────────────────────
      const existing = await Style.findOne({ title });
      if (existing) {
        failed.push({ title, error: 'A style with this title already exists.' });
        continue;
      }

      // ── Upload image to Cloudinary ───────────────────────────────────────
      let cloudResult;

      if (imageData && imageData.startsWith('data:')) {
        // Frontend already converted to base64 — fastest path
        cloudResult = await uploadBase64ToCloudinary(imageData);
      } else if (imageUrl) {
        // Fetch the image server-side (no CORS, spoofed User-Agent bypasses
        // Pinterest hotlink protection), then stream buffer to Cloudinary
        const { buffer, contentType } = await fetchImageBuffer(imageUrl);
        cloudResult = await uploadBufferToCloudinary(buffer, contentType);
      } else {
        failed.push({ title, error: 'Invalid image source.' });
        continue;
      }

      // ── Parse + normalise fields ─────────────────────────────────────────
      const materialsArr = recommendedMaterials
        ? String(recommendedMaterials).split(',').map(s => s.trim()).filter(Boolean)
        : [];

      let parsedQty = {};
      if (materialQuantities && typeof materialQuantities === 'object') {
        parsedQty = materialQuantities;
      } else if (typeof materialQuantities === 'string') {
        try { parsedQty = JSON.parse(materialQuantities); } catch { parsedQty = {}; }
      }

      const finalQty = applyUnit(parsedQty, materialUnit || 'yds');

      const typeArr = type
        ? String(type).split(',').map(s => s.trim()).filter(Boolean)
        : ['Traditional'];

      const tagsArr = tags
        ? String(tags).split(',').map(s => s.trim()).filter(Boolean)
        : [];

      // ── Save to MongoDB ──────────────────────────────────────────────────
      const newStyle = new Style({
        title,
        type:                 typeArr,
        gender,
        ageGroup:             ageGroup || 'Adult',
        price:                Number(price),
        image:                cloudResult.secure_url,
        cloudinary_id:        cloudResult.public_id,
        description:          description || '',
        details:              details || '',
        colour:               colour || '',
        recommendedMaterials: materialsArr,
        materialQuantities:   finalQty,
        materialUnit:         materialUnit || 'yds',
        tags:                 tagsArr,
        addedBy:              req.user.id,
      });

      const style = await newStyle.save();
      saved.push({ title: style.title, _id: style._id });

    } catch (err) {
      console.error(`Bulk: error on "${title}":`, err.message);
      failed.push({ title: title || 'Unknown', error: err.message });
    }
  }

  // ── Notify users (non-blocking) ──────────────────────────────────────────
  if (saved.length) {
    try {
      const io    = req.app.get('io');
      const users = await User.find({}, '_id');
      await broadcastNotification(io, users.map(u => u._id), {
        title:    '✨ New Styles Added',
        message:  `${saved.length} new style${saved.length > 1 ? 's' : ''} just added to the catalogue!`,
        type:     'info',
        category: 'style',
      });
    } catch (notifErr) {
      console.error('Notification error (non-blocking):', notifErr.message);
    }
  }

  return res.status(207).json({
    message: `${saved.length} saved, ${failed.length} failed.`,
    saved,
    failed,
  });
};