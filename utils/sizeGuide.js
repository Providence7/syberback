// src/utils/sizeGuide.js
//
// Server-side copy of the size-scoring logic. This is the SINGLE SOURCE OF
// TRUTH for `size` — the client (MeasurementFormPage) may also compute a
// preview for the UI badge, but the server never trusts that value. It
// always recomputes from the submitted `data` + `age` before saving. Keep
// this in sync with the frontend's src/lib/sizeGuide.js if the scoring
// rules ever change.
//
// PHILOSOPHY (unchanged, confirmed intentional): "Largest Fit Rule" — among
// every measurement that votes for a size, the largest one wins, and a
// profile's size can only ever move UP, never back down, even if a later
// edit shrinks a measurement. This is a deliberate safety margin for
// tailoring, not a bug.
//
// Because a size can never be walked back down once a vote is cast, THIS
// FILE now puts real weight on making sure a vote is trustworthy before
// it's allowed to happen:
//   1. Boundary buffer (hysteresis) — a measurement has to clear a cutoff
//      by a real margin, not just barely cross it, before it's trusted to
//      vote for the next size up. A reading 0.1" over a line no longer
//      permanently locks in a bump.
//   2. Sanity ranges — obviously wrong data entry (typo, wrong unit) is
//      ignored rather than allowed to drive an irreversible upgrade.
//   3. Placeholder fields count less — topLength and trouserLength cutoffs
//      are still unverified estimates (see note below), so on their own
//      they can no longer single-handedly trigger a permanent size bump;
//      they only count once a real measurement in the same region agrees.
//      Once real order data confirms those cutoffs, bump their weight back
//      to 1 like the others.
//
// AGE POLICY: age is a FALLBACK ONLY. It never overrides real measurement
// data. `determineSize` first tries to size from the measurement fields
// (chest, back, top length, hips, trouser length). Only when NONE of those
// produce a trusted candidate — i.e. there's nothing usable in `data` at
// all — does it fall back to age (age < KID_AGE_CUTOFF => Kid). A young
// age can no longer force `Kid` on a profile that has real, larger
// measurements attached.

export const SIZE_MAP = {
  k:  { key: 'kid',        label: 'Kid'         },
  s:  { key: 'small',      label: 'Small'       },
  m:  { key: 'medium',     label: 'Medium'      },
  l:  { key: 'large',      label: 'Large'       },
  xl: { key: 'extraLarge', label: 'Extra Large' },
};

export const SIZE_HIERARCHY = ['k', 's', 'm', 'l', 'xl'];

export const KID_AGE_CUTOFF = 13;

// Minimum accumulated weight for a size bucket to be "trusted" enough to
// be a candidate for the largest-fit decision. A full-confidence field
// (chest, back, hips) contributes 1 on its own and always clears this.
// A placeholder field (topLength, trouserLength) contributes 0.5 and so
// needs corroboration from another field in the same region before its
// vote is trusted.
const VOTE_TRUST_THRESHOLD = 1;

const emptyScores = () => ({ k: 0, s: 0, m: 0, l: 0, xl: 0 });

// Cutoff bands per field, in inches, ascending. `max` is the exclusive
// upper bound of that band (Infinity for the last one).
//   - buffer: how far past a boundary a value must sit to be trusted as a
//     vote for the *next* band up, instead of falling back to the band it
//     just barely left.
//   - placeholder: true for cutoffs that are still estimates, not yet
//     verified against real order/size data (see file header).
const FIELD_BANDS = {
  chestCircumference: {
    buffer: 0.5,
    bands: [
      { max: 32, key: 'k' }, { max: 36, key: 's' }, { max: 43, key: 'm' },
      { max: 48, key: 'l' }, { max: Infinity, key: 'xl' },
    ],
  },
  backWidth: {
    buffer: 0.25,
    bands: [
      { max: 14, key: 'k' }, { max: 16, key: 's' }, { max: 18, key: 'm' },
      { max: 20, key: 'l' }, { max: Infinity, key: 'xl' },
    ],
  },
  topLength: {
    buffer: 0.75,
    placeholder: true, // PLACEHOLDER cutoffs — confirm against real data.
    bands: [
      { max: 22, key: 'k' }, { max: 26, key: 's' }, { max: 30, key: 'm' },
      { max: 35, key: 'l' }, { max: Infinity, key: 'xl' },
    ],
  },
  hips: {
    buffer: 0.5,
    bands: [
      { max: 30, key: 'k' }, { max: 36, key: 's' }, { max: 42, key: 'm' },
      { max: 48, key: 'l' }, { max: Infinity, key: 'xl' },
    ],
  },
  trouserLength: {
    buffer: 0.75,
    placeholder: true, // PLACEHOLDER cutoffs — confirm against real data.
    bands: [
      { max: 30, key: 'k' }, { max: 38, key: 's' }, { max: 41, key: 'm' },
      { max: 44, key: 'l' }, { max: Infinity, key: 'xl' },
    ],
  },
};

// Plausible real-world ranges per field, inches. Anything outside this is
// almost certainly a typo or unit mistake (e.g. cm entered as inches) and
// is ignored rather than allowed to drive a permanent size upgrade.
const SANITY_RANGE = {
  chestCircumference: [15, 70],
  backWidth: [8, 30],
  topLength: [12, 50],
  hips: [15, 70],
  trouserLength: [15, 55],
};

const isSane = (field, value) => {
  const range = SANITY_RANGE[field];
  if (!range) return true;
  return value >= range[0] && value <= range[1];
};

// Scores a single field into `scores`, applying the boundary buffer so a
// value has to clearly clear a cutoff — not just technically cross it —
// before it votes for the larger band.
const scoreField = (field, rawValue, scores) => {
  const value = parseFloat(rawValue);
  if (!Number.isFinite(value) || value <= 0) return;

  if (!isSane(field, value)) {
    console.warn(`[sizeGuide] Ignoring implausible ${field}=${value} (outside ${SANITY_RANGE[field]?.join('-')}in) when computing size.`);
    return;
  }

  const { bands, buffer, placeholder } = FIELD_BANDS[field];
  const weight = placeholder ? 0.5 : 1;

  for (let i = 0; i < bands.length; i++) {
    const { max, key } = bands[i];
    if (value >= max) continue;

    const prevMax = i > 0 ? bands[i - 1].max : -Infinity;
    const clearsBuffer = i === 0 || value >= prevMax + buffer;

    if (clearsBuffer) {
      scores[key] += weight;
    } else {
      // Too close to the line to trust as a vote for the bigger band —
      // since sizes never move back down, a borderline reading should
      // never be the thing that makes that call. Falls back to the
      // smaller band instead.
      scores[bands[i - 1].key] += weight;
    }
    return;
  }
};

// Upper body: chest, back width, AND top length all vote.
const scoreUpperBody = (form) => {
  const scores = emptyScores();
  scoreField('chestCircumference', form.chestCircumference, scores);
  scoreField('backWidth', form.backWidth, scores);
  scoreField('topLength', form.topLength, scores);
  return scores;
};

// Lower body: hips AND trouser length vote. Waist is still collected and
// saved (for the actual cut/pattern) but doesn't feed size scoring.
const scoreLowerBody = (form) => {
  const scores = emptyScores();
  scoreField('hips', form.hips, scores);
  scoreField('trouserLength', form.trouserLength, scores);
  return scores;
};

// Largest Fit Rule: among the sizes with enough trusted vote-weight, pick
// the largest by hierarchy position — not the most-voted one. A bucket
// only counting a lone placeholder-field vote (weight 0.5) doesn't clear
// VOTE_TRUST_THRESHOLD on its own, so it can't single-handedly trigger an
// irreversible upgrade.
const getLargestFitSize = (scoreObj) => {
  const voted = Object.keys(scoreObj).filter((size) => scoreObj[size] >= VOTE_TRUST_THRESHOLD);
  if (!voted.length) return null;

  let maxIndex = 0;
  voted.forEach((size) => {
    const idx = SIZE_HIERARCHY.indexOf(size);
    if (idx > maxIndex) maxIndex = idx;
  });
  return SIZE_HIERARCHY[maxIndex];
};

// form: { age?, chestCircumference?, backWidth?, topLength?, hips?,
//         trouserLength?, ... } (all measurements in inches)
//
// Returns a SINGLE SIZE_MAP entry, or null if there wasn't enough trusted
// info at all. Upper and lower body are scored independently (so a large
// chest with small hips still gets weighed correctly), but only one final
// size is returned: whichever of the two — top or bottom — lands larger
// on the hierarchy.
//
// Age is consulted LAST, and ONLY as a fallback: it's used solely when
// there are no trusted measurement candidates at all (e.g. a bare profile
// with just a name and age, no measurements yet). If any measurement data
// produced a trusted size, that result is returned as-is — age never
// downgrades or overrides it, even for a young age with a large chest.
export const determineSize = (form = {}) => {
  const topKey    = getLargestFitSize(scoreUpperBody(form));
  const bottomKey = getLargestFitSize(scoreLowerBody(form));

  const candidates = [topKey, bottomKey].filter(Boolean);

  if (!candidates.length) {
    const ageNum = parseFloat(form.age);
    if (Number.isFinite(ageNum) && ageNum > 0 && ageNum < KID_AGE_CUTOFF) {
      return SIZE_MAP.k;
    }
    return null;
  }

  let maxIndex = 0;
  candidates.forEach((key) => {
    const idx = SIZE_HIERARCHY.indexOf(key);
    if (idx > maxIndex) maxIndex = idx;
  });

  return SIZE_MAP[SIZE_HIERARCHY[maxIndex]];
};