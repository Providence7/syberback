// services/socket.js
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { parse as parseCookie } from 'cookie';

let _io = null;

/**
 * Identify the user from the access-token cookie sent with the socket handshake
 * (works because the client connects with withCredentials: true).
 *
 * ignoreExpiration: access tokens are short-lived, and the socket only
 * authenticates once, at connect time. If the socket connects just after the
 * token expired (before your frontend refreshed it), a strict check would leave
 * the user without a room and they'd silently get no live notifications.
 * The signature is still verified, so the user id can't be forged, and this
 * only lets them RECEIVE their own notifications. Set it to false if you
 * prefer the strict behaviour.
 */
const authenticateSocket = (socket) => {
  try {
    const cookies = parseCookie(socket.handshake.headers.cookie || '');
    const token   = cookies.accessToken;
    if (!token) return null;

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, {
      ignoreExpiration: true,
    });
    return decoded?.id ? decoded.id.toString() : null;
  } catch {
    return null; // bad signature / malformed token
  }
};

export const initSocket = (httpServer) => {
  _io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL,
      credentials: true,
    },
  });

  _io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    // Verified user id taken from the session, NOT from the client
    const userId = authenticateSocket(socket);

    if (userId) {
      socket.join(`user:${userId}`);
      console.log(`User ${userId} joined their notification room`);
    } else {
      console.warn('Socket connected without a valid session:', socket.id);
    }

    // Kept so the existing frontend keeps working. The client-supplied id is
    // ignored on purpose; only the verified one is used.
    socket.on('register', () => {
      if (userId) socket.join(`user:${userId}`);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected:', socket.id);
    });
  });

  return _io; // must return io
};

// Optional: use this anywhere you can't access req.app
export const getIO = () => {
  if (!_io) throw new Error('Socket.io not initialised');
  return _io;
};