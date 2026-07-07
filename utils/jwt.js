import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export const signAccessToken = payload =>
  jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });

export const signRefreshToken = payload =>
  jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '2d' });

export const verifyAccessToken = token =>
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

export const verifyRefreshToken = token =>
  jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
