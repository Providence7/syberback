import express from 'express';
import { getAllStyles, createStyle } from '../controllers/styleContoller.js';
import { validate } from '../middlewares/validate.js';
import { styleSchema } from '../validators/styleValidator.js';

const router = express.Router();

router.get('/', getAllStyles);
router.post('/', validate(styleSchema), createStyle);

export default router;
