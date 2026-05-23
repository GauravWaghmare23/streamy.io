import pinoHttp from "pino-http";
import logger from "../config/logger.js";

const loggerMiddleware = pinoHttp({
    logger,

    customSuccessMessage:(req,res)=>{
        return `${req.method} ${req.url} - ${res.statusCode}`;
    },

    customErrorMessage:(req,res,err)=>{
        return `${req.method} ${req.url} - ${res.statusCode} - ${err.message}`;
    },

    customLogLevel:(req,res,err)=>{
        if (res.statusCode >= 500 || err) {
            return "error";
        } else if (res.statusCode >= 400) {
            return "warn";
        } else {
            return "info";
        }
    },

    serializers:{
        req:(req)=>{
            return {
                method: req.method,
                url: req.url,
                headers: req.headers,
                query: req.query,
                params: req.params,
                body: req.body,
                userAgent: req.headers['user-agent'],
            }
        },
        res:(res)=>{
            return {
                statusCode: res.statusCode,
            }
        }
    }
});

export default loggerMiddleware;