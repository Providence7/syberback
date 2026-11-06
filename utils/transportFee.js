// src/utils/transportFee.js
//
// Server-side, AUTHORITATIVE transport fee calculation. This is what
// actually gets charged. src/lib/transportFee.js on the client has a copy of
// the same rules purely to show an estimate before checkout.
//
// ── Pricing model ────────────────────────────────────────────────────────
// 0. Outside Nigeria: no fee is charged here (fee: 0, isInternational: true).
//    Staff DM the customer to agree delivery and cost.
// 1. The state is read from the saved delivery address (EditProfile already
//    refuses to save a Nigerian address without a state or state capital).
//    If no state can be found and the pin is not abroad, this throws a 400
//    so the order is rejected instead of being charged the wrong fee.
// 2. Ibadan (Oyo State, address mentions Ibadan or the pin is inside the
//    Ibadan area): measured from Iwo Road by DRIVING distance (Mapbox,
//    straight-line fallback).
//       within 15 km          -> free
//       beyond 15 km          -> IBADAN_BEYOND_RADIUS_FEE
//    The free zones below (Sango, Mokola, UI, Agbowo, Apete) stay free.
// 3. Everywhere else: flat fee per state from TRANSPORT_FEE_BY_STATE
//    (Oyo outside Ibadan, e.g. Ogbomoso / Oyo town, is the Oyo entry).
//
// To change prices, edit TRANSPORT_FEE_BY_STATE / IBADAN_* only, then make
// the SAME edit in src/lib/transportFee.js on the client, and keep
// NIGERIAN_STATES identical to the list in EditProfile.jsx.
//
// Requires MAPBOX_TOKEN in the server's .env, and Node 18+ (built-in fetch).

const IWO_ROAD_LAT = 7.403139;
const IWO_ROAD_LNG = 3.939023;

const NIGERIA_BBOX = { minLat: 4.2, maxLat: 13.9, minLng: 2.6, maxLng: 14.7 };

const isWithinNigeria = (lat, lng) =>
  lat != null && lng != null &&
  lat >= NIGERIA_BBOX.minLat && lat <= NIGERIA_BBOX.maxLat &&
  lng >= NIGERIA_BBOX.minLng && lng <= NIGERIA_BBOX.maxLng;

const MAPBOX_DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving';
const MAPBOX_GEOCODING_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places';
const MAPBOX_TIMEOUT_MS = 5000;
const getMapboxToken = () => process.env.MAPBOX_TOKEN;

// ── Ibadan rules ─────────────────────────────────────────────────────────
const IBADAN_FREE_RADIUS_KM = 15;
const IBADAN_BEYOND_RADIUS_FEE = 1500;
// Used only when an Oyo address does not say "Ibadan": a pin this close to
// Iwo Road (straight-line) is still treated as Ibadan. Ogbomoso / Oyo town
// are well beyond this.
const IBADAN_AREA_MAX_KM = 30;

const FREE_ZONE_PATTERNS = [
  /\bsango\b/,
  /\bmokola\b/,
  /\bagbowo\b/,
  /\bapete\b/,
  /\buniversity of ibadan\b/,
  /\bui\b/,
  /\bu\.i\.?\b/,
];

// ── Flat fee per state (₦), from Iwo Road, Ibadan ────────────────────────
const TRANSPORT_FEE_BY_STATE = {
  'Abia': 9000,
  'Adamawa': 15000,
  'Akwa Ibom': 11000,
  'Anambra': 7500,
  'Bauchi': 13000,
  'Bayelsa': 10000,
  'Benue': 10000,
  'Borno': 17500,
  'Cross River': 12500,
  'Delta': 7000,
  'Ebonyi': 9000,
  'Edo': 5000,
  'Ekiti': 2250,
  'Enugu': 8000,
  'Gombe': 14000,
  'Imo': 8000,
  'Jigawa': 15000,
  'Kaduna': 11000,
  'Kano': 12500,
  'Katsina': 13500,
  'Kebbi': 13000,
  'Kogi': 6000,
  'Kwara': 2000,
  'Lagos': 1750,
  'Nasarawa': 11000,
  'Niger': 9000,
  'Ogun': 1250,
  'Ondo': 2000,
  'Osun': 1500,
  'Oyo': 1000,
  'Plateau': 12000,
  'Rivers': 10000,
  'Sokoto': 14000,
  'Taraba': 15000,
  'Yobe': 16000,
  'Zamfara': 13500,
  'Federal Capital Territory': 10000,
};

// ── State detection (keep identical to EditProfile.jsx) ──────────────────
const NIGERIAN_STATES = [
  { name: 'Abia',                      aliases: ['abia', 'umuahia'] },
  { name: 'Adamawa',                   aliases: ['adamawa', 'yola'] },
  { name: 'Akwa Ibom',                 aliases: ['akwa ibom', 'uyo'] },
  { name: 'Anambra',                   aliases: ['anambra', 'awka'] },
  { name: 'Bauchi',                    aliases: ['bauchi'] },
  { name: 'Bayelsa',                   aliases: ['bayelsa', 'yenagoa'] },
  { name: 'Benue',                     aliases: ['benue', 'makurdi'] },
  { name: 'Borno',                     aliases: ['borno', 'maiduguri'] },
  { name: 'Cross River',               aliases: ['cross river', 'calabar'] },
  { name: 'Delta',                     aliases: ['delta', 'asaba'] },
  { name: 'Ebonyi',                    aliases: ['ebonyi', 'abakaliki'] },
  { name: 'Edo',                       aliases: ['edo', 'benin city'] },
  { name: 'Ekiti',                     aliases: ['ekiti', 'ado ekiti'] },
  { name: 'Enugu',                     aliases: ['enugu'] },
  { name: 'Gombe',                     aliases: ['gombe'] },
  { name: 'Imo',                       aliases: ['imo', 'owerri'] },
  { name: 'Jigawa',                    aliases: ['jigawa', 'dutse'] },
  { name: 'Kaduna',                    aliases: ['kaduna'] },
  { name: 'Kano',                      aliases: ['kano'] },
  { name: 'Katsina',                   aliases: ['katsina'] },
  { name: 'Kebbi',                     aliases: ['kebbi', 'birnin kebbi'] },
  { name: 'Kogi',                      aliases: ['kogi', 'lokoja'] },
  { name: 'Kwara',                     aliases: ['kwara', 'ilorin'] },
  { name: 'Lagos',                     aliases: ['lagos', 'ikeja'] },
  { name: 'Nasarawa',                  aliases: ['nasarawa', 'nassarawa', 'lafia'] },
  { name: 'Niger',                     aliases: ['niger state', 'minna'] },
  { name: 'Ogun',                      aliases: ['ogun', 'abeokuta'] },
  { name: 'Ondo',                      aliases: ['ondo', 'akure'] },
  { name: 'Osun',                      aliases: ['osun', 'osogbo', 'oshogbo'] },
  { name: 'Oyo',                       aliases: ['oyo', 'ibadan'] },
  { name: 'Plateau',                   aliases: ['plateau', 'jos'] },
  { name: 'Rivers',                    aliases: ['rivers', 'port harcourt', 'portharcourt'] },
  { name: 'Sokoto',                    aliases: ['sokoto'] },
  { name: 'Taraba',                    aliases: ['taraba', 'jalingo'] },
  { name: 'Yobe',                      aliases: ['yobe', 'damaturu'] },
  { name: 'Zamfara',                   aliases: ['zamfara', 'gusau'] },
  { name: 'Federal Capital Territory', aliases: ['federal capital territory', 'f c t', 'fct', 'abuja'] },
];

const normalizeAddressText = (text = '') =>
  ` ${String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

const STATE_ALIAS_INDEX = NIGERIAN_STATES
  .flatMap((s) => s.aliases.map((alias) => ({ state: s.name, needle: ` ${alias} ` })));

// The state is normally the LAST thing in an address ("...Ondo Road, Ibadan,
// Oyo State"), so the mention that appears latest wins. That stops a street
// named after another state from deciding the fee.
export const detectNigerianState = (text = '') => {
  const haystack = normalizeAddressText(text);
  let best = null;
  for (const { state, needle } of STATE_ALIAS_INDEX) {
    const idx = haystack.lastIndexOf(needle);
    if (idx === -1) continue;
    const end = idx + needle.length;
    if (!best || end > best.end || (end === best.end && needle.length > best.len)) {
      best = { state, end, len: needle.length };
    }
  }
  return best ? best.state : null;
};

const mentionsIbadan = (address = '') => normalizeAddressText(address).includes(' ibadan ');

// ── Distance helpers ─────────────────────────────────────────────────────
const toRad = (deg) => (deg * Math.PI) / 180;

// Straight-line distance. Used for the Ibadan-area check and as a fallback if Mapbox fails.
export const getDistanceKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Driving distance in km from Mapbox, or null if it can't be determined.
export const getMapboxDrivingDistanceKm = async (lat1, lng1, lat2, lng2) => {
  const token = getMapboxToken();
  if (!token) {
    console.warn('MAPBOX_TOKEN is not set — falling back to straight-line distance.');
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAPBOX_TIMEOUT_MS);

  try {
    // Mapbox expects coordinates as lng,lat
    const url =
      `${MAPBOX_DIRECTIONS_URL}/${lng1},${lat1};${lng2},${lat2}` +
      `?access_token=${token}&overview=false`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.error(`Mapbox Directions failed (${res.status}):`, await res.text());
      return null;
    }
    const data = await res.json();
    const meters = data?.routes?.[0]?.distance;
    return typeof meters === 'number' ? meters / 1000 : null;
  } catch (err) {
    console.error('Mapbox Directions error:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// Country code of a pin ('NG', 'BJ', ...), or null if it can't be determined.
// Only used when the address names no Nigerian state, to tell a customer in a
// neighbouring country (pin inside the Nigeria bounding box) from a Nigerian
// address that is missing its state.
const getCountryCodeFromPin = async (lat, lng) => {
  const token = getMapboxToken();
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAPBOX_TIMEOUT_MS);

  try {
    const url = `${MAPBOX_GEOCODING_URL}/${lng},${lat}.json?access_token=${token}&types=country`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const code = data?.features?.[0]?.properties?.short_code;
    return code ? String(code).toUpperCase() : null;
  } catch (err) {
    console.error('Mapbox country lookup error:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export const isFreeDeliveryZone = (address = '') => {
  const text = String(address || '').toLowerCase();
  return FREE_ZONE_PATTERNS.some((re) => re.test(text));
};

const internationalResult = () => ({
  distanceKm: null, fee: 0, isFree: false, isInternational: true,
  state: null, isIbadan: false, source: 'international',
});

/**
 * NOTE: async — callers must `await` it.
 *
 * Throws an Error with status 400 when the pin is in Nigeria but the address
 * has no state. The message is meant to be shown to the customer.
 *
 * @param {number} lat - customer's saved delivery latitude
 * @param {number} lng - customer's saved delivery longitude
 * @param {string} [address] - customer's saved delivery address
 * @returns {Promise<{ distanceKm: number|null, fee: number, isFree: boolean, isInternational: boolean, state: string|null, isIbadan: boolean, source: string }>}
 */
export const getTransportFeeFromIwoRoad = async (lat, lng, address = '') => {
  if (!isWithinNigeria(lat, lng)) return internationalResult();

  const state = detectNigerianState(address);

  if (!state) {
    const countryCode = await getCountryCodeFromPin(lat, lng);
    if (countryCode && countryCode !== 'NG') return internationalResult();

    const err = new Error(
      'Your delivery address must include your state (for example "Ibadan, Oyo State"). Please update your profile address and try again.'
    );
    err.status = 400;
    err.statusCode = 400;
    throw err;
  }

  const straightKm = getDistanceKm(IWO_ROAD_LAT, IWO_ROAD_LNG, lat, lng);
  const isIbadan =
    state === 'Oyo' && (mentionsIbadan(address) || straightKm <= IBADAN_AREA_MAX_KM);

  // Not Ibadan: flat fee for the state.
  if (!isIbadan) {
    const fee = TRANSPORT_FEE_BY_STATE[state];
    return {
      distanceKm: straightKm, fee, isFree: fee === 0, isInternational: false,
      state, isIbadan: false, source: 'state',
    };
  }

  // Ibadan: free zones first (skips the Mapbox call), then the 15 km rule.
  if (isFreeDeliveryZone(address)) {
    return {
      distanceKm: straightKm, fee: 0, isFree: true, isInternational: false,
      state, isIbadan: true, source: 'free-zone',
    };
  }

  let distanceKm = await getMapboxDrivingDistanceKm(IWO_ROAD_LAT, IWO_ROAD_LNG, lat, lng);
  let source = 'mapbox';
  if (distanceKm == null) {
    distanceKm = straightKm;
    source = 'straight-line';
  }

  const fee = distanceKm <= IBADAN_FREE_RADIUS_KM ? 0 : IBADAN_BEYOND_RADIUS_FEE;
  return {
    distanceKm, fee, isFree: fee === 0, isInternational: false,
    state, isIbadan: true, source,
  };
};