import pino from "pino";
import fs from "fs";

// Ensure logs directory exists before creating file stream
if (!fs.existsSync("logs")) {
  fs.mkdirSync("logs");
}

// Create a file stream for logging to a file
const fileStream = pino.destination({
  dest: "./logs/server.log",
  sync: false,
});

// Configure console transport with pretty printing for non-production environments

const consoleTransport =
  process.env.NODE_ENV !== "production"
    ? pino.transport({
        target: "pino-pretty",

        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      })
    : pino.destination(1);


// Create the main logger instance with multiple transports and custom configuration
const logger = pino(
  {
    level: process.env.NODE_ENV === "production" ? "info" : "debug",

    base: {
      env: process.env.NODE_ENV,
    },

    timestamp: pino.stdTimeFunctions.isoTime,
  },

  // Use pino.multistream to log to both console and file

  pino.multistream([
    {
      stream: consoleTransport,
    },

    {
      stream: fileStream,
    },
  ]),
);

export default logger;
