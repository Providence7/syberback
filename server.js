import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import connectDB from "./config/db.js"
import measurementRoutes from './routes/measurement.js';
import inpersonRoute from './routes/inpersonRoutes.js'
import notificationRoutes from './routes/notify.js';
import styleRoutes from './routes/styleRoutes.js';
import currencyRoutes from './routes/currency.js';
import orderRoutes from './routes/order.js'
import fabricRoutes from './routes/fabricRoutes.js';
// No need for randomUUID here unless you use it somewhere else not shown
// const uuid = randomUUID(); // This line is unused and can be removed

dotenv.config();
const app = express();

// --- Essential Middleware (Corrected Order) ---

// 1. CORS Middleware: Should be first to handle preflight requests and set headers correctly for all origins.
app.use(cors({
  origin: process.env.CLIENT_URL, // your frontend origin (e.g., http://localhost:5173)
  credentials: true, // Crucial for allowing cookies to be sent/received
}));

// 2. Body Parsing Middleware: For handling JSON request bodies.
app.use(express.json());

// 3. Cookie Parser Middleware: THIS IS THE ONE THAT POPULATES req.cookies
// Place it AFTER CORS and body parser, but BEFORE any routes that need to read req.cookies.
app.use(cookieParser());

// --- Test Route (Optional, for quick checks) ---
app.get('/', (req, res) => {
  res.send("Backend is running!");
});

// --- Your API Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/measurements', measurementRoutes);
app.use('/api/order', inpersonRoute) // Assuming this is for in-person orders
app.use('/api/notifications', notificationRoutes); // This router uses authenticateUser
app.use('/api/styles', styleRoutes);
app.use('/api/fabrics', fabricRoutes);
app.use('/api/currency', currencyRoutes); // Use the new currency routes
app.use('/api/orders', orderRoutes); // Your online orders route
console.log("hello")
// --- Dataconsobase Connection ---
connectDB(); // Ensure this function connects to your MongoDB

// --- Server Start ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`CLIENT_URL: ${process.env.CLIENT_URL}`); // Verify this is correct
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`); // Verify this for cookie secure/sameSite
});