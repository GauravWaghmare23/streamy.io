import { configDotenv } from "dotenv";
configDotenv();
import { createServer } from "http";
import app from "./src/app.js";
import logger from "./src/config/logger.js";
import connectDB from "./src/config/db.js";
import mongoose from "mongoose";


const server = createServer(app);

const PORT = process.env.PORT;

const startServer = async () => {
    try {
        await connectDB();
        server.listen(PORT, () => {
            logger.info(`Server is running on port ${PORT} in ${process.env.NODE_ENV} mode`);
        });
    } catch (error) {
        logger.error("Error starting server:", error);
        process.exit(1);
    }
}

startServer();

process.on("SIGINT", async()=>{
    logger.warn("Shutting down server...");
    await mongoose.connection.close();
    server.close(()=>{
        logger.info("Server shut down gracefully.");
        process.exit(0);
    });
});

process.on("SIGTERM", async()=>{
    logger.warn("Shutting down server...");
    await mongoose.connection.close();
    server.close(()=>{
        logger.info("Server shut down gracefully.");
        process.exit(0);
    });
});