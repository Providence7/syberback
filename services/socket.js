// services/socket.js
import { Server } from 'socket.io';

let _io = null;

export const initSocket = (httpServer) => {
  _io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL,
      credentials: true,
    },
  });

  _io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    // Client calls socket.emit('register', userId) after connecting
    socket.on('register', (userId) => {
      if (userId) {
        socket.join(`user:${userId}`);
        console.log(`User ${userId} joined their notification room`);
      }
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected:', socket.id);
    });
  });

  return _io; // ✅ must return io
};

// Optional: use this anywhere you can't access req.app
export const getIO = () => {
  if (!_io) throw new Error('Socket.io not initialised');
  return _io;
};