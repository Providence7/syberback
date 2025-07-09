import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import connectDB from  "./config/db.js"
import measurementRoutes from './routes/measurement.js';
import inpersonRoute  from  './routes/inpersonRoutes.js'
import notificationRoutes from './routes/notify.js';
import styleRoutes from './routes/styleRoutes.js';
import currencyRoutes from './routes/currency.js';
import orderRoutes  from  './routes/order.js'
import { randomUUID } from 'crypto';
const uuid = randomUUID();
dotenv.config();
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: process.env.CLIENT_URL, // your frontend origin
  credentials: true,
}));

app.get('/',(req, res )=>{
  res.send("money")
})
app.use('/api/auth', authRoutes);
app.use('/api/measurements', measurementRoutes);
app.use('/api/order', inpersonRoute)
app.use('/api/notifications', notificationRoutes);
app.use('/api/styles', styleRoutes);
app.use('/api/currency', currencyRoutes);
app.use('/api/orders', orderRoutes);
connectDB()


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});