import express from 'express';
import { createOrder } from '../controllers/inpersonContoller.js';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import dotenv from 'dotenv';
dotenv.config();
const router = express.Router();

router.post('/inperson', authenticateUser, createOrder);

export default router;
