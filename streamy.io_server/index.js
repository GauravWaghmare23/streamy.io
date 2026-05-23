import { configDotenv } from "dotenv";
configDotenv();
import { createServer } from "http";
import app from "./src/app.js";

// create HTTP server using the Express app

const server = createServer(app);

const PORT = process.env.PORT;

// Start the server and handle potential errors

const startServer = () => {
    try {
        server.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
}

startServer();

// Handle graceful shutdown on SIGINT and SIGTERM signals

process.on("SIGINT",()=>{
    console.log("Shutting down server...");
    server.close(()=>{
        console.log("Server shut down gracefully.");
        process.exit(0);
    });
});

process.on("SIGTERM",()=>{
    console.log("Shutting down server...");
    server.close(()=>{
        console.log("Server shut down gracefully.");
        process.exit(0);
    });
});