// src/utils/sizeGuide.js
//
// Server-side copy of the size-scoring logic. This is the SINGLE SOURCE OF
// TRUTH for `size` — the client (MeasurementFormPage) may also compute a
// preview for the UI badge, but the server never trusts that value. It
// always recomputes from the submitted `data` + `age` before saving. Keep
// this in sync with the frontend's src/lib/sizeGuide.js if the scoring
// rules ever change.

export const SIZE_MAP = {
  k:  { key: 'kid',        label: 'Kid'         },
  s:  { key: 'small',      label: 'Small'       },
  m:  { key: 'medium',     label: 'Medium'      },
  l:  { key: 'large',      label: 'Large'       },
  xl: { key: 'extraLarge', label: 'Extra Large' },
};

export const SIZE_HIERARCHY = ['k', 's', 'm', 'l', 'xl'];

export const KID_AGE_CUTOFF = 13;

const emptyScores = () => ({ k: 0, s: 0, m: 0, l: 0, xl: 0 });

// Upper body: chest, back width, AND top length (shoulder-to-hem) all vote.
// NOTE: the topLength cutoffs below are placeholder estimates (evenly
// spaced like the other bands) — confirm against real order/size data and
// adjust before relying on this in production.
const scoreUpperBody = (form) => {
  const scores = emptyScores();
  const chest     = parseFloat(form.chestCircumference) || 0;
  const back      = parseFloat(form.backWidth)          || 0;
  const topLength = parseFloat(form.topLength)          || 0;

  // Chest/bust circumference, inches.
  if (chest > 0) {
    if      (chest < 32) scores.k++;
    else if (chest < 36) scores.s++;
    else if (chest < 43) scores.m++;
    else if (chest < 48) scores.l++;
    else                 scores.xl++;
  }

  // Back width (shoulder to shoulder), inches.
  if (back > 0) {
    if      (back < 14) scores.k++;
    else if (back < 16) scores.s++;
    else if (back < 18) scores.m++;
    else if (back < 20) scores.l++;
    else                scores.xl++;
  }

  // Top length (shoulder to hem), inches. PLACEHOLDER cutoffs — verify.
  if (topLength > 0) {
    if      (topLength < 22) scores.k++;
    else if (topLength < 26) scores.s++;
    else if (topLength < 30) scores.m++;
    else if (topLength < 35) scores.l++;
    else                     scores.xl++;
  }

  return scores;
};

// Lower body: hips AND trouser length vote. Waist is still collected and
// saved (for the actual cut/pattern) but no longer feeds size scoring —
// only these two do, per current instructions.
// NOTE: the trouserLength cutoffs below are placeholder estimates —
// confirm against real order/size data and adjust before relying on this
// in production.
const scoreLowerBody = (form) => {
  const scores = emptyScores();
  const hips          = parseFloat(form.hips)          || 0;
  const trouserLength = parseFloat(form.trouserLength) || 0;

  // Hip/seat circumference, inches.
  if (hips > 0) {
    if      (hips < 30) scores.k++;
    else if (hips < 36) scores.s++;
    else if (hips < 42) scores.m++;
    else if (hips < 48) scores.l++;
    else                scores.xl++;
  }

  // Trouser length (waist to ankle), inches. PLACEHOLDER cutoffs — verify.
  if (trouserLength > 0) {
    if      (trouserLength < 30) scores.k++;
    else if (trouserLength < 38) scores.s++;
    else if (trouserLength < 41) scores.m++;
    else if (trouserLength < 44) scores.l++;
    else                         scores.xl++;
  }

  return scores;
};

// Largest Fit Rule: among the sizes that got at least one vote, pick the
// largest by hierarchy position — not the most-voted one.
const getLargestFitSize = (scoreObj) => {
  const voted = Object.keys(scoreObj).filter((size) => scoreObj[size] > 0);
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
// Returns a SINGLE SIZE_MAP entry, or null if there wasn't enough info at
// all. Upper and lower body are still scored independently internally
// (so a large chest with small hips still gets weighed correctly), but
// only one final size is returned to the caller: whichever of the two —
// top or bottom — lands larger on the hierarchy. This is intentional:
// showing clients two different sizes on one profile was confusing them.
export const determineSize = (form = {}) => {
  const ageNum = parseFloat(form.age);
  if (Number.isFinite(ageNum) && ageNum > 0 && ageNum < KID_AGE_CUTOFF) {
    return SIZE_MAP.k;
  }

  const topKey    = getLargestFitSize(scoreUpperBody(form));
  const bottomKey = getLargestFitSize(scoreLowerBody(form));

  const candidates = [topKey, bottomKey].filter(Boolean);
  if (!candidates.length) return null;

  let maxIndex = 0;
  candidates.forEach((key) => {
    const idx = SIZE_HIERARCHY.indexOf(key);
    if (idx > maxIndex) maxIndex = idx;
  });

  return SIZE_MAP[SIZE_HIERARCHY[maxIndex]];
};