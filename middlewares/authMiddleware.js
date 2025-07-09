// middleware/authMiddleware.js
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv'; // Import dotenv to access JWT secret
import User from '../models/user.js'; // Import your User model

dotenv.config(); // Load environment variables

// Middleware to authenticate users (formerly 'authenticateUser')
// It verifies the access token and attaches the user object from the DB to req.user
export const protect = async (req, res, next) => { // Renamed to 'protect' for common convention
  let token;

  // Check for token in cookies (as per your current setup)
  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: No access token found' });
  }

  try {
    // 1. Verify the access token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    // decoded will now contain { id: userId, isAdmin: boolean }

    // 2. Fetch the user from the database using the ID from the token
    // Select all fields EXCEPT the password. This will include isAdmin, uniqueId, name, email, etc.
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      // If user no longer exists in the DB (e.g., account deleted)
      return res.status(401).json({ message: 'Unauthorized: User not found' });
    }

    // Attach the full user object (from the database) to the request
    req.user = user;

    next(); // Proceed to the next middleware or route handler
  } catch (err) {
    console.error('Token verification error:', err.message);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Unauthorized: Access token expired' });
    }
    return res.status(401).json({ message: 'Unauthorized: Invalid access token' });
  }
};

// NEW: Middleware to authorize users based on roles
export const authorize = (roles = []) => {
  // roles can be an array like ['admin', 'manager']
  return (req, res, next) => {
    // If no roles are specified, allow access (or you can choose to deny)
    if (roles.length === 0) {
      return next();
    }

    // Check if req.user exists (meaning 'protect' middleware ran successfully)
    // and if the user has the required roles.
    // For 'admin' role, we check req.user.isAdmin
    if (req.user && req.user.isAdmin && roles.includes('admin')) {
      // User is an admin and 'admin' role is required
      return next();
    }
    // You can extend this for other roles if you add them to your user model
    // else if (req.user && req.user.isManager && roles.includes('manager')) {
    //   return next();
    // }

    // If none of the required roles are matched
    res.status(403).json({
      message: `Forbidden: User is not authorized to access this resource. Required roles: ${roles.join(', ')}`
    });
  };
};