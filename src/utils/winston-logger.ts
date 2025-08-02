import winston from 'winston';
import path from 'path';

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// JSON format for file output
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: jsonFormat,
  defaultMeta: { service: 'pump-agent' },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: consoleFormat,
      level: 'debug'
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: jsonFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    
    // Separate file for errors
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: jsonFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      format: jsonFormat
    })
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      format: jsonFormat
    })
  ]
});

// Create a simple interface for backward compatibility
export const log = {
  error: (message: string, meta?: Record<string, unknown>) => logger.error(message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => logger.warn(message, meta),
  info: (message: string, meta?: Record<string, unknown>) => logger.info(message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => logger.debug(message, meta),
  verbose: (message: string, meta?: Record<string, unknown>) => logger.verbose(message, meta),
  silly: (message: string, meta?: Record<string, unknown>) => logger.silly(message, meta)
};

// Export the winston logger instance for advanced usage
export { logger };

// Helper function to get recent logs for UI
export const getRecentLogs = (limit: number = 50): Array<{
  timestamp: string;
  level: string;
  message: string;
  meta?: Record<string, unknown>;
}> => {
  try {
    const fs = require('fs');
    const logFile = path.join(logsDir, 'combined.log');
    
    if (!fs.existsSync(logFile)) {
      return [];
    }
    
    const logContent = fs.readFileSync(logFile, 'utf8');
    const lines = logContent.trim().split('\n').filter(line => line.trim());
    
    // Parse the last 'limit' lines
    const recentLines = lines.slice(-limit);
    const logs = recentLines.map(line => {
      try {
        const parsed = JSON.parse(line);
        return {
          timestamp: parsed.timestamp || new Date().toISOString(),
          level: parsed.level?.toUpperCase() || 'INFO',
          message: parsed.message || 'No message',
          meta: parsed.meta || {}
        };
      } catch (parseError) {
        // If JSON parsing fails, create a basic log entry
        return {
          timestamp: new Date().toISOString(),
          level: 'INFO',
          message: line.substring(0, 200), // Truncate long lines
          meta: {}
        };
      }
    });
    
    return logs.reverse(); // Show newest first
  } catch (error) {
    console.error('Failed to read logs:', error);
    return [];
  }
}; 