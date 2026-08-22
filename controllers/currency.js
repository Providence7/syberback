// src/controllers/currencyController.js
import axios from 'axios';

const EXCHANGE_RATE_API_KEY  = process.env.EXCHANGE_RATE_API_KEY;
const EXCHANGE_RATE_BASE_URL = 'https://v6.exchangerate-api.com/v6';

const CACHE_EXPIRY_MS = 1000 * 60 * 60; // 1 hour

// Keyed by "FROM_TO" pair, e.g. "USD_NGN", "NGN_GBP" — one shared cache
// so every currency pair gets its own independent 1-hour window instead of
// all pairs invalidating together.
const rateCache = new Map();

async function fetchPairRate(from, to) {
  const cacheKey = `${from}_${to}`;
  const cached   = rateCache.get(cacheKey);
  const now      = Date.now();

  if (cached && (now - cached.timestamp < CACHE_EXPIRY_MS)) {
    return { rate: cached.rate, source: 'cache' };
  }

  if (!EXCHANGE_RATE_API_KEY) {
    const err = new Error('Server configuration error: Exchange rate API key missing.');
    err.statusCode = 500;
    throw err;
  }

  const url = `${EXCHANGE_RATE_BASE_URL}/${EXCHANGE_RATE_API_KEY}/pair/${from}/${to}`;
  const response = await axios.get(url);

  if (response.data?.result === 'success') {
    const rate = response.data.conversion_rate;
    rateCache.set(cacheKey, { rate, timestamp: now });
    return { rate, source: 'api' };
  }

  const err = new Error('Failed to fetch exchange rate. Invalid API response.');
  err.statusCode = 500;
  err.details = response.data;
  throw err;
}

// @route   GET /api/currency/exchange-rate
// @desc    Legacy USD->NGN rate — unchanged shape, kept so the existing
//          manual NGN/USD toggles on Style/Fabric pages keep working.
// @access  Public
export const getExchangeRate = async (req, res) => {
  try {
    const { rate, source } = await fetchPairRate('USD', 'NGN');
    res.json({
      success: true,
      message: 'Exchange rate fetched successfully',
      data: { USD_to_NGN: rate, source },
    });
  } catch (err) {
    console.error('Error in getExchangeRate:', err.message);
    res.status(err.statusCode || 500).json({ msg: err.message, details: err.details });
  }
};

// ✅ NEW ─────────────────────────────────────────────────────────────────────
// @route   GET /api/currency/convert?to=GBP
// @desc    NGN -> <to> conversion rate for a single target currency. Used by
//          the frontend to auto-display product prices in whatever currency
//          matches the visitor's detected country.
// @access  Public

// Sanity-check list so a typo'd/unsupported code fails fast with a clean
// 400 instead of a confusing 500 from the upstream API. Add to this as you
// support more storefront currencies.
const SUPPORTED_CURRENCIES = new Set([
  'USD', 'GBP', 'EUR', 'CAD', 'GHS', 'ZAR', 'KES', 'AUD', 'NGN',
]);

export const getRateFor = async (req, res) => {
  const to = String(req.query.to || '').toUpperCase();

  if (!to || !/^[A-Z]{3}$/.test(to)) {
    return res.status(400).json({ success: false, message: 'Query param "to" must be a 3-letter currency code.' });
  }

  if (to === 'NGN') {
    // Identity conversion — no API call needed.
    return res.json({ success: true, data: { from: 'NGN', to: 'NGN', rate: 1, source: 'identity' } });
  }

  if (!SUPPORTED_CURRENCIES.has(to)) {
    return res.status(400).json({ success: false, message: `Currency "${to}" isn't supported yet.` });
  }

  try {
    const { rate, source } = await fetchPairRate('NGN', to);
    res.json({ success: true, data: { from: 'NGN', to, rate, source } });
  } catch (err) {
    console.error('Error in getRateFor:', err.message);
    res.status(err.statusCode || 500).json({ success: false, message: err.message, details: err.details });
  }
};