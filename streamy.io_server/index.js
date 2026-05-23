import { configDotenv } from "dotenv";
configDotenv();
import { createServer } from "http";
import app from "./src/app.js";
import logger from "./src/config/logger.js";

// create HTTP server using the Express app

const server = createServer(app);

const PORT = process.env.PORT;

// Start the server and handle potential errors

const startServer = () => {
    try {
        server.listen(PORT, () => {
            logger.info(`Server is running on port ${PORT} in ${process.env.NODE_ENV} mode`);
        });
    } catch (error) {
        logger.error("Error starting server:", error);
        process.exit(1);
    }
}

startServer();

// Handle graceful shutdown on SIGINT and SIGTERM signals

process.on("SIGINT",()=>{
    logger.warn("Shutting down server...");
    server.close(()=>{
        logger.info("Server shut down gracefully.");
        process.exit(0);
    });
});

process.on("SIGTERM",()=>{
    logger.warn("Shutting down server...");
    server.close(()=>{
        logger.info("Server shut down gracefully.");
        process.exit(0);
    });
});