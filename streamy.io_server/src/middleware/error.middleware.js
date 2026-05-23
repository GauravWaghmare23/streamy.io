import logger from "../config/logger.js";

const errorMiddleware = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.message = err.message || "Internal Server Error";
    logger.error({
        message: err.message,
        stack: err.stack,
        statusCode: err.statusCode,
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: req.query,
        params: req.params,
    });

     if (process.env.NODE_ENV === "development") {
      return res.status(err.statusCode).json({
         success: false,
         message: err.message,
         stack: err.stack,
      });
   }

   return res.status(err.statusCode).json({
      success: false,
      message:
         err.statusCode === 500
            ? "Internal Server Error"
            : err.message,
   });

}

export default errorMiddleware;