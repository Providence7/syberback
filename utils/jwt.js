import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export const signAccessToken = payload =>
  jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });

export const signRefreshToken = payload =>
  jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });

export const verifyAccessToken = token =>
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

export const verifyRefreshToken = token =>
  jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
