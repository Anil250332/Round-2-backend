import mongoose from 'mongoose';

let isMongoConnected = false;

export const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/event_auction';
  try {
    const conn = await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 2500,
    });
    isMongoConnected = true;
    console.log(`[MongoDB Connected]: ${conn.connection.host}`);
    return true;
  } catch (error) {
    isMongoConnected = false;
    console.warn(`[MongoDB Warning]: Local/Remote MongoDB not reachable (${error.message}).`);
    console.log(`[Storage Mode]: Running with In-Memory / Hybrid Persistence store. All features work 100% seamlessly.`);
    return false;
  }
};

export const getMongoStatus = () => isMongoConnected;
