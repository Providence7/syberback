import express from 'express';
import { getCurrencyRate } from '../controllers/currency.js';

const router = express.Router();

router.get('/', getCurrencyRate);

export default router;
