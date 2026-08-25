// src/utils/transportFee.js
//
// Server-side, AUTHORITATIVE transport fee calculation. This is what
// actually gets charged — CreateOrderForm.jsx's client-side copy is purely
// a display estimate shown before checkout.
//
// ── Pricing model ────────────────────────────────────────────────────────
// Pure linear rate: fee = distanceKm * NAIRA_PER_KM. No flat/base fee, no
// distance bands — straight proportionality, so a trip twice as far always
// costs exactly twice as much.
//
// The rate itself is derived from one real-world calibration point instead
// of being picked arbitrarily: Iwo Road roundabout -> Mokola should cost
// ₦750. Whatever that trip's real straight-line distance is, dividing 750
// by it gives you naira-per-km, and every other fee falls out of that.
//
// IWO_ROAD_TO_MOKOLA_KM below (4.05) was estimated from public landmark
// coordinates near Mokola (UCH / Premier Hotel on Mokola Hill) — it is a
// best-effort estimate, not a verified figure. To get the exact number:
//   1. In the running app (EditProfile.jsx already calls mapboxForwardGeocode),
//      search "Mokola, Ibadan" and note the lat/lng it returns.
//   2. Run that lat/lng through getDistanceKm() below against
//      IWO_ROAD_LAT/IWO_ROAD_LNG.
//   3. Replace IWO_ROAD_TO_MOKOLA_KM with that number.
// This uses the exact same Mapbox geocoder + Haversine formula the rest of
// the app already relies on, so it'll be far more accurate than any
// third-party lookup, and guaranteed consistent with what customers see.
//
// IMPORTANT: keep IWO_ROAD_TO_MOKOLA_KM in sync with the identical constant
// in src/components/CreateOrderForm.jsx — if they drift apart, the estimate
// shown at checkout will stop matching what's actually charged.

const IWO_ROAD_LAT = 7.403139;
const IWO_ROAD_LNG = 3.939023;

const IWO_ROAD_TO_MOKOLA_KM  = 4.05; // confirm via Mapbox geocode — see note above
const IWO_ROAD_TO_MOKOLA_FEE = 750;  // naira

const NAIRA_PER_KM = IWO_ROAD_TO_MOKOLA_FEE / IWO_ROAD_TO_MOKOLA_KM; // ≈ ₦185/km

const toRad = (deg) => (deg * Math.PI) / 180;

export const getDistanceKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * @param {number} lat - customer's saved delivery latitude
 * @param {number} lng - customer's saved delivery longitude
 * @returns {{ distanceKm: number, fee: number }}
 */
export const getTransportFeeFromIwoRoad = (lat, lng) => {
  const distanceKm = getDistanceKm(IWO_ROAD_LAT, IWO_ROAD_LNG, lat, lng);
  // Rounded to the nearest ₦10 for a tidy display/charge amount.
  const fee = Math.round((distanceKm * NAIRA_PER_KM) / 10) * 10;
  return { distanceKm, fee };
};