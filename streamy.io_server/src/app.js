import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import globalRateLimiter from "./config/rateLimiter.js";
import loggerMiddleware from "./middleware/logger.middleware.js";
import errorMiddleware from "./middleware/error.middleware.js";

const app = express();

// Trust first proxy for correct IP logging
app.set("trust proxy", 1); 

// Use the custom logger middleware for all routes
app.use(loggerMiddleware);

// Applies global rate limiter to all requests
app.use(globalRateLimiter);

// Middleware setup
app.use(cors());
app.use(compression());
app.use(helmet());
app.use(cookieParser());

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to Streamy.io API',
        env: process.env.NODE_ENV,
    });
});


// 404 handler for undefined routes
app.use((req, res) => {
   return res.status(404).json({
      success: false,
      message: "Route not found",
   });
});

// Global error handling middleware
app.use(errorMiddleware);


export default app;