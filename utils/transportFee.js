// src/utils/transportFee.js

// Reference point: Iwo Road, Ibadan — every delivery fee is priced by
// straight-line distance from here.
export const IWO_ROAD_LAT = 7.403139;
export const IWO_ROAD_LNG = 3.939023;

/**
 * Haversine straight-line distance in kilometers between two lat/lng points.
 */
export function getDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Transport fee bands, priced from Iwo Road.
 *   ≤ 8.5km      → ₦500
 *   8.5 – 13km   → ₦850
 *   13 – 16km    → ₦1000
 *   beyond 16km  → ₦1000 + ₦300 per additional 3km band (rounded up)
 */
export function getTransportFee(distanceKm) {
  if (distanceKm <= 8.5) return 500;
  if (distanceKm <= 13)  return 850;
  if (distanceKm <= 16)  return 1000;

  const BAND_WIDTH    = 3;
  const RATE_PER_BAND = 300;
  const bandsPast16   = Math.ceil((distanceKm - 16) / BAND_WIDTH);
  return 1000 + bandsPast16 * RATE_PER_BAND;
}

/**
 * Convenience: distance + fee straight from a saved lat/lng.
 * Caller must verify lat/lng are non-null BEFORE calling this —
 * it doesn't validate, to keep it a pure calculation.
 */
export function getTransportFeeFromIwoRoad(lat, lng) {
  const distanceKm = getDistanceKm(IWO_ROAD_LAT, IWO_ROAD_LNG, lat, lng);
  return { distanceKm, fee: getTransportFee(distanceKm) };
}