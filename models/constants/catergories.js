/**
 * constants/categories.js
 *
 * Shared taxonomy used by BOTH Style and Fabric models/controllers/admin UIs.
 * Import this everywhere instead of hardcoding the list, so styles and
 * fabrics can never drift out of sync on category names.
 */
export const CATEGORIES = [
  'Adire Casual',
  'Aso Oke Luxury',
  'Classic Senator',
  'Cap',
  'Accessories',
  'Footwear',
];

// Compact labels for narrow mobile tab strips.
export const CATEGORY_SHORT_LABELS = {
  'Adire Casual':    'Adire',
  'Aso Oke Luxury':  'Aso-Oke',
  'Classic Senator': 'Senator',
  'Cap':             'Cap',
  'Accessories':     'Access.',
  'Footwear':        'Shoes',
};