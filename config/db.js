// src/config/connectDB.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { rescheduleAllNotifications } from '../utils/notificationScheduler.js';

dotenv.config();

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);

        console.log(`🧵 MongoDB Connected: ${conn.connection.host}`);
        
        // Call the notification rescheduling function after a successful connection
        await rescheduleAllNotifications();

    } catch (error) {
        console.error(`❌ MongoDB Connection Error: ${error.message}`);
        process.exit(1);
    }
};

export default connectDB;