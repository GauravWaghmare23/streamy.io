import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { success } from 'zod';
import { env } from 'process';
import loggerMiddleware from "../src/middleware/logger.middleware.js";

const app = express();

// Use the custom logger middleware for all routes
app.use(loggerMiddleware);

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

export default app;