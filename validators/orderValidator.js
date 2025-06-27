import { body } from 'express-validator';

export const validateOrder = [
  body('orderType').isIn(['online', 'inPerson']).withMessage('Invalid order type'),
  body('style.title').notEmpty().withMessage('Style title is required'),
  body('measurement').notEmpty().withMessage('Measurement ID is required'),
];
