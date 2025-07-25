/**
 * Logger utility for Pump Agent
 */

import { LogLevel, LOG_LEVELS } from './constants.js';

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: Error;
}

class Logger {
  private logLevel: LogLevel;
  private context: Record<string, unknown>;

  constructor(context: Record<string, unknown> = {}, logLevel: LogLevel = LOG_LEVELS.INFO) {
    this.context = context;
    this.logLevel = logLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LOG_LEVELS.ERROR, LOG_LEVELS.WARN, LOG_LEVELS.INFO, LOG_LEVELS.DEBUG];
    return levels.indexOf(level) <= levels.indexOf(this.logLevel);
  }

  private formatLog(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = entry.level.toUpperCase().padEnd(5);
    const context = Object.keys(entry.context || {}).length > 0 
      ? ` [${JSON.stringify(entry.context)}]` 
      : '';
    const error = entry.error ? ` - ${entry.error.stack}` : '';
    
    return `${timestamp} ${level} ${entry.message}${context}${error}`;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      context: { ...this.context, ...context },
      error,
    };

    const formattedLog = this.formatLog(entry);
    
    switch (level) {
      case LOG_LEVELS.ERROR:
        console.error(formattedLog);
        break;
      case LOG_LEVELS.WARN:
        console.warn(formattedLog);
        break;
      case LOG_LEVELS.INFO:
        console.info(formattedLog);
        break;
      case LOG_LEVELS.DEBUG:
        console.debug(formattedLog);
        break;
    }
  }

  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log(LOG_LEVELS.ERROR, message, context, error);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LOG_LEVELS.WARN, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LOG_LEVELS.INFO, message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LOG_LEVELS.DEBUG, message, context);
  }

  child(additionalContext: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...additionalContext }, this.logLevel);
  }

  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }
}

// Default logger instance
export const logger = new Logger({ service: 'pump-agent' });

// Create logger with context
export function createLogger(context: Record<string, unknown>, logLevel?: LogLevel): Logger {
  return new Logger(context, logLevel);
}