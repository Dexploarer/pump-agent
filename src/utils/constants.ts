/**
 * Configuration constants for Pump Agent
 */

export const WEBSOCKET_CONFIG = {
  PUMP_PORTAL_URL: 'wss://pumpportal.fun/api/data',
  RECONNECT_DELAY: 5000,
  MAX_RECONNECT_ATTEMPTS: 10,
  PING_INTERVAL: 30000,
  CONNECTION_TIMEOUT: 10000,
} as const;

export const PLATFORM_PATTERNS = {
  PUMP_FUN_SUFFIX: 'pump',
  LETSBONK_FUN_SUFFIX: 'bonk',
} as const;

export const PLATFORMS = {
  PUMP_FUN: 'pump.fun',
  LETSBONK_FUN: 'letsbonk.fun',
  UNKNOWN: 'unknown',
} as const;

export const DATABASE_CONFIG = {
  MEASUREMENT_NAME: 'token_data',
  BATCH_SIZE: 1000,
  FLUSH_INTERVAL: 5000,
  RETENTION_DAYS: 30,
} as const;

export const MCP_CONFIG = {
  SERVER_NAME: 'pump-agent',
  SERVER_VERSION: '1.0.0',
  DEFAULT_PORT: 3001,
} as const;

export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
} as const;

export type Platform = typeof PLATFORMS[keyof typeof PLATFORMS];
export type LogLevel = typeof LOG_LEVELS[keyof typeof LOG_LEVELS];