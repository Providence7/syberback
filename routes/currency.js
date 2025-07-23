// src/routes/currencyRoutes.js
import express from 'express';
import { getExchangeRate } from '../controllers/currency.js';

const router = express.Router();

// @route   GET /api/currency/exchange-rate
// @desc    Get live USD to NGN exchange rate
// @access  Public
router.get('/exchange-rate', getExchangeRate);

export default router;