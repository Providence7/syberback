/**
 * constants/categories.js
 *
 * Two separate taxonomies:
 *
 *  - STYLE_CATEGORIES  → garment/style catalogue (StyleShowcase, admin styles page)
 *  - FABRIC_CATEGORIES → raw fabric marketplace (FabricMarketplace, admin fabrics page)
 *
 * They're intentionally different lists — a fabric isn't itself "Cap" or
 * "Footwear", it's a *material* someone might use to make one. Keeping them
 * as two exports (rather than one shared list) avoids forcing fabric
 * categorization into buckets that don't actually describe fabric.
 */

// ── Styles / garments ───────────────────────────────────────────────────────
export const STYLE_CATEGORIES = [
  'Adire Casual',
  'Aso Oke Luxury',
  'Classic Senator',
  'Cap',
  'Accessories',
  'Footwear',
];

export const STYLE_CATEGORY_SHORT_LABELS = {
  'Adire Casual':    'Adire',
  'Aso Oke Luxury':  'Aso-Oke',
  'Classic Senator': 'Senator',
  'Cap':             'Cap',
  'Accessories':     'Access.',
  'Footwear':        'Shoes',
};

// ── Fabrics / raw materials ─────────────────────────────────────────────────
// 'African Prints' is the deliberate catch-all: Kente, Batik, and any other
// African fabric that isn't specifically Adire or Aso Oke lands here, rather
// than being forced into a category that doesn't fit it.
export const FABRIC_CATEGORIES = [
  'Adire',
  'Aso Oke',
  'Senator',
  'African Prints',
];

export const FABRIC_CATEGORY_SHORT_LABELS = {
  'Adire':          'Adire',
  'Aso Oke':        'Aso-Oke',
  'Senator':        'Senator',
  'African Prints': 'Prints',
};