// src/utils/transportFee.js
//
// Server-side, AUTHORITATIVE transport fee calculation. This is what
// actually gets charged — CreateOrderForm.jsx has a copy of the same rules
// purely to show an estimate before checkout.
//
// ── Pricing model ────────────────────────────────────────────────────────
// 1. Free zones: if the customer's saved address mentions one of the
//    FREE_ZONE_PATTERNS below (Sango, Mokola, UI, Agbowo, Apete), delivery is free.
// 2. Otherwise the fee comes from DISTANCE_BANDS, based on the DRIVING
//    distance from Iwo Road (Mapbox Directions API). Anything within 15 km
//    is free. If Mapbox is unavailable, straight-line distance is used instead.
//    The last band is a flat ceiling, so the fee can never run away for long
//    trips (Abuja = ₦15,000).
//
// To change prices, edit DISTANCE_BANDS only. Keep it identical to the copy in
// src/components/CreateOrderForm.jsx, or the estimate shown at checkout will
// stop matching what is charged.
//
// Requires MAPBOX_TOKEN in the server's .env, and Node 18+ (built-in fetch).

const IWO_ROAD_LAT = 7.403139;
const IWO_ROAD_LNG = 3.939023;

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;
const MAPBOX_DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving';
const MAPBOX_TIMEOUT_MS = 5000;

// Matched against the address (lowercased). \b stops "ui" matching inside "building".
const FREE_ZONE_PATTERNS = [
  /\bsango\b/,
  /\bmokola\b/,
  /\bagbowo\b/,
  /\bapete\b/,
  /\buniversity of ibadan\b/,
  /\bui\b/,
  /\bu\.i\.?\b/,
];

// maxKm = upper limit of the band (inclusive). Last band uses Infinity.
const DISTANCE_BANDS = [
  { maxKm: 15,       fee: 0     }, // within 15 km: free
  { maxKm: 50,       fee: 2000  }, // nearby towns
  { maxKm: 150,      fee: 4000  }, // e.g. Lagos, Abeokuta, Akure
  { maxKm: 300,      fee: 8000  },
  { maxKm: Infinity, fee: 15000 }, // anywhere further, e.g. Abuja
];

const toRad = (deg) => (deg * Math.PI) / 180;

// Straight-line distance. Used only as a fallback if Mapbox fails.
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
  if (!MAPBOX_TOKEN) {
    console.warn('MAPBOX_TOKEN is not set — falling back to straight-line distance.');
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAPBOX_TIMEOUT_MS);

  try {
    // Mapbox expects coordinates as lng,lat
    const url =
      `${MAPBOX_DIRECTIONS_URL}/${lng1},${lat1};${lng2},${lat2}` +
      `?access_token=${MAPBOX_TOKEN}&overview=false`;
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

export const isFreeDeliveryZone = (address = '') => {
  const text = String(address || '').toLowerCase();
  return FREE_ZONE_PATTERNS.some((re) => re.test(text));
};

/**
 * NOTE: this is now async — callers must `await` it.
 *
 * @param {number} lat - customer's saved delivery latitude
 * @param {number} lng - customer's saved delivery longitude
 * @param {string} [address] - customer's saved delivery address (needed for free zones)
 * @returns {Promise<{ distanceKm: number, fee: number, isFree: boolean, source: string }>}
 */
export const getTransportFeeFromIwoRoad = async (lat, lng, address = '') => {
  // Free zones skip the Mapbox call entirely.
  if (isFreeDeliveryZone(address)) {
    const distanceKm = getDistanceKm(IWO_ROAD_LAT, IWO_ROAD_LNG, lat, lng);
    return { distanceKm, fee: 0, isFree: true, source: 'free-zone' };
  }

  let distanceKm = await getMapboxDrivingDistanceKm(IWO_ROAD_LAT, IWO_ROAD_LNG, lat, lng);
  let source = 'mapbox';

  if (distanceKm == null) {
    distanceKm = getDistanceKm(IWO_ROAD_LAT, IWO_ROAD_LNG, lat, lng);
    source = 'straight-line';
  }

  const band = DISTANCE_BANDS.find((b) => distanceKm <= b.maxKm);
  return { distanceKm, fee: band.fee, isFree: band.fee === 0, source };
};