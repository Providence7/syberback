// middleware/authMiddleware.js
import jwt from 'jsonwebtoken';

export function authenticateUser(req, res, next) {
  const token = req.cookies.accessToken; // 🔥 Read from cookies, not headers

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: No token in cookies' });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.user = decoded; // e.g., { id: userId }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized: Invalid token' });
  }
}
