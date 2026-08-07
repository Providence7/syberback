
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

// Upper body: chest, back width, top length.
// NOTE: topLength cutoffs below are placeholder estimates — confirm
// against real order/size data and adjust before relying on this.
const scoreUpperBody = (form) => {
  const scores = emptyScores();
  const chest     = parseFloat(form.chestCircumference) || 0;
  const back      = parseFloat(form.backWidth)          || 0;
  const topLength = parseFloat(form.topLength)          || 0;

  if (chest > 0) {
    if      (chest < 32) scores.k++;
    else if (chest < 38) scores.s++;
    else if (chest < 42) scores.m++;
    else if (chest < 46) scores.l++;
    else                 scores.xl++;
  }

  if (back > 0) {
    if      (back < 14) scores.k++;
    else if (back < 16) scores.s++;
    else if (back < 18) scores.m++;
    else if (back < 20) scores.l++;
    else                scores.xl++;
  }

  if (topLength > 0) {
    if      (topLength < 22) scores.k++;
    else if (topLength < 26) scores.s++;
    else if (topLength < 29) scores.m++;
    else if (topLength < 32) scores.l++;
    else                     scores.xl++;
  }

  return scores;
};

// Lower body: hips, trouser length. Waist is still collected/saved for the
// actual cut but doesn't feed size scoring.
// NOTE: trouserLength cutoffs below are placeholder estimates — confirm
// against real order/size data and adjust before relying on this.
const scoreLowerBody = (form) => {
  const scores = emptyScores();
  const hips          = parseFloat(form.hips)          || 0;
  const trouserLength = parseFloat(form.trouserLength) || 0;

  if (hips > 0) {
    if      (hips < 30) scores.k++;
    else if (hips < 36) scores.s++;
    else if (hips < 42) scores.m++;
    else if (hips < 48) scores.l++;
    else                scores.xl++;
  }

  if (trouserLength > 0) {
    if      (trouserLength < 32) scores.k++;
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

const largerKey = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  return SIZE_HIERARCHY.indexOf(a) >= SIZE_HIERARCHY.indexOf(b) ? a : b;
};

// form: { age?, chestCircumference?, backWidth?, topLength?, hips?,
//         trouserLength?, ... } (all measurements in inches)
//
// Returns a single SIZE_MAP entry, or null if there wasn't enough data at
// all. Upper and lower body are scored separately internally, then the
// LARGER of the two wins — one size, always erring toward not-too-small.
export const determineGarmentSizes = (form = {}) => {
  const ageNum = parseFloat(form.age);
  if (Number.isFinite(ageNum) && ageNum > 0 && ageNum < KID_AGE_CUTOFF) {
    return SIZE_MAP.k;
  }

  const topKey    = getLargestFitSize(scoreUpperBody(form));
  const bottomKey = getLargestFitSize(scoreLowerBody(form));
  const key       = largerKey(topKey, bottomKey);

  return key ? SIZE_MAP[key] : null;
};
