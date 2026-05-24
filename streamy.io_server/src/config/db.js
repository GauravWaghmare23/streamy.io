import mongoose from "mongoose";
import logger from "./logger.js";
import dns from "dns";

dns.setServers(["1.1.1.1", "8.8.8.8"]);


const connectDB = async () => {
    try {
        const connectionInstance = await mongoose.connect(process.env.MONGO_URI);

        logger.info(`MongoDB connected : ${connectionInstance.connection.host}`);

        mongoose.connection.on('connected', () => {
            logger.info(`MongoDB connection established...`);
        });

        mongoose.connection.on("error", (error) => {
            logger.error({
                message: "MongoDB connection error",
                error: error.message,
            });
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn(`MongoDb disconnected...`)
        });

    } catch (error) {

        logger.error({
            message: "MongoDB connection failed",
            error: error.message,
        });

        process.exit(1);
    }
}

export default connectDB;