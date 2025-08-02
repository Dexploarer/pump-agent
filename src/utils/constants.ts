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
  BONKAKE_SUFFIX: 'bonkake',
} as const;

export const PLATFORMS = {
  PUMP_FUN: 'pump.fun',
  LETSBONK_FUN: 'letsbonk.fun',
  BONKAKE: 'bonkake.fun',
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

export const TOKEN_CLEANUP_CONFIG = {
  // Inactivity thresholds
  INACTIVITY_THRESHOLD_MS: 3600000, // 1 hour of no trades
  MIN_VOLUME_24H_SOL: 10, // Minimum 24h volume in SOL
  CONSECUTIVE_ZERO_VOLUME_PERIODS: 3, // Number of periods with zero volume before removal
  
  // Rug detection thresholds
  RUG_DETECTION_PRICE_DROP: 0.95, // 95% price drop from peak
  RUG_DETECTION_LIQUIDITY_THRESHOLD_USD: 100, // Minimum liquidity in USD
  RUG_DETECTION_VOLUME_DROP: 0.99, // 99% volume drop from peak
  
  // Cleanup process settings
  CLEANUP_INTERVAL_MS: 300000, // Run cleanup every 5 minutes
  MAX_CLEANUP_PERCENTAGE: 0.1, // Maximum 10% of tokens removed per cleanup
  MIN_TOKENS_TO_KEEP: 100, // Always keep at least 100 tokens
  NEW_TOKEN_GRACE_PERIOD_MS: 1800000, // 30 minutes grace period for new tokens
  
  // Safety settings
  WHITELIST_TOKENS: [] as string[], // Tokens that should never be removed
  CLEANUP_ENABLED: true, // Master switch for cleanup functionality
} as const;

export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
} as const;

export type Platform = typeof PLATFORMS[keyof typeof PLATFORMS];
export type LogLevel = typeof LOG_LEVELS[keyof typeof LOG_LEVELS];