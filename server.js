import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import connectDB from "./config/db.js";
import measurementRoutes from './routes/measurement.js';
import inpersonRoute from './routes/inpersonRoutes.js';
import notificationRoutes from './routes/notify.js';
import styleRoutes from './routes/styleRoutes.js';
import currencyRoutes from './routes/currency.js';
import orderRoutes from './routes/order.js';
import fabricRoutes from './routes/fabricRoutes.js';
import http from 'http';
import { initSocket } from './services/socket.js';

dotenv.config();
const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(cookieParser());

app.get('/', (req, res) => res.send("✅ SyberTailor backend is running!"));

app.use('/api/auth', authRoutes);
app.use('/api/measurements', measurementRoutes);
app.use('/api/order', inpersonRoute);
app.use('/api/notifications', notificationRoutes);
app.use('/api/styles', styleRoutes);
app.use('/api/fabrics', fabricRoutes);
app.use('/api/currency', currencyRoutes);
app.use('/api/orders', orderRoutes);

connectDB();

const server = http.createServer(app);

// ✅ Store io on app so controllers can access it via req.app.get('io')
const io = initSocket(server);
app.set('io', io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CLIENT_URL: ${process.env.CLIENT_URL}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
});