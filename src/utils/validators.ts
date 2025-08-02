/**
 * Environment validation utilities
 */

import { logger } from './logger.js';

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

interface EnvironmentConfig {
  INFLUXDB_TOKEN: string;
  INFLUXDB_ORG: string;
  INFLUXDB_BUCKET: string;
  INFLUXDB_URL: string;
  INFLUXDB_HOST: string;
  INFLUXDB_DATABASE: string;
  INFLUXDB_ORGANIZATION: string;
  PUMPPORTAL_WSS_URL: string;
  PUMPPORTAL_RECONNECT_DELAY: number;
  MAX_RECONNECT_ATTEMPTS: number;
  MAX_TOKENS_TRACKED: number;
  BATCH_SIZE: number;
  WRITE_INTERVAL_MS: number;
  NODE_ENV?: string;
  LOG_LEVEL?: string;
  MCP_PORT?: string;
}

const REQUIRED_ENV_VARS = [
  'INFLUXDB_TOKEN',
  'INFLUXDB_ORG', 
  'INFLUXDB_BUCKET',
  'INFLUXDB_URL',
] as const;

// Optional environment variables for future use
// const OPTIONAL_ENV_VARS = [
//   'NODE_ENV',
//   'LOG_LEVEL',
//   'MCP_PORT',
// ] as const;

export function validateEnvironment(): ValidationResult {
  console.log('Validating environment...');
  const errors: string[] = [];
  
  // Check required environment variables
  for (const envVar of REQUIRED_ENV_VARS) {
    console.log(`Checking ${envVar}: ${process.env[envVar] ? 'FOUND' : 'MISSING'}`);
    if (!process.env[envVar]) {
      errors.push(`Missing required environment variable: ${envVar}`);
    }
  }

  // Validate InfluxDB URL format
  const influxUrl = process.env['INFLUXDB_URL'];
  if (influxUrl && !isValidUrl(influxUrl)) {
    errors.push(`Invalid INFLUXDB_URL format: ${influxUrl}`);
  }

  // Validate port if provided
  const mcpPort = process.env['MCP_PORT'];
  if (mcpPort && !isValidPort(mcpPort)) {
    errors.push(`Invalid MCP_PORT: ${mcpPort}. Must be a number between 1 and 65535.`);
  }

  // Validate log level if provided
  const logLevel = process.env['LOG_LEVEL'];
  if (logLevel && !isValidLogLevel(logLevel)) {
    errors.push(`Invalid LOG_LEVEL: ${logLevel}. Must be one of: error, warn, info, debug.`);
  }

  const isValid = errors.length === 0;
  
  if (!isValid) {
    logger.error('Environment validation failed', { errors });
  } else {
    logger.info('Environment validation passed');
  }

  return { isValid, errors };
}

export function getEnvironmentConfig(): EnvironmentConfig {
  console.log('Getting environment config...');
  const validation = validateEnvironment();
  
  if (!validation.isValid) {
    console.error('Environment validation failed:', validation.errors);
    throw new Error(`Environment validation failed: ${validation.errors.join(', ')}`);
  }

  return {
    INFLUXDB_TOKEN: process.env['INFLUXDB_TOKEN']!,
    INFLUXDB_ORG: process.env['INFLUXDB_ORG']!,
    INFLUXDB_BUCKET: process.env['INFLUXDB_BUCKET']!,
    INFLUXDB_URL: process.env['INFLUXDB_URL']!,
    INFLUXDB_HOST: process.env['INFLUXDB_URL']!,
    INFLUXDB_DATABASE: process.env['INFLUXDB_BUCKET']!,
    INFLUXDB_ORGANIZATION: process.env['INFLUXDB_ORG']!,
    PUMPPORTAL_WSS_URL: process.env['PUMPPORTAL_WSS_URL'] || 'wss://pumpportal.fun/api/data',
    PUMPPORTAL_RECONNECT_DELAY: parseInt(process.env['PUMPPORTAL_RECONNECT_DELAY'] || '5000'),
    MAX_RECONNECT_ATTEMPTS: parseInt(process.env['MAX_RECONNECT_ATTEMPTS'] || '10'),
    MAX_TOKENS_TRACKED: parseInt(process.env['MAX_TOKENS_TRACKED'] || '1000'),
    BATCH_SIZE: parseInt(process.env['BATCH_SIZE'] || '100'),
    WRITE_INTERVAL_MS: parseInt(process.env['WRITE_INTERVAL_MS'] || '5000'),
    NODE_ENV: process.env['NODE_ENV'] || 'development',
    LOG_LEVEL: process.env['LOG_LEVEL'] || 'info',
    MCP_PORT: process.env['MCP_PORT'] || '3001',
  };
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidPort(port: string): boolean {
  const portNum = parseInt(port, 10);
  return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

function isValidLogLevel(level: string): boolean {
  return ['error', 'warn', 'info', 'debug'].includes(level.toLowerCase());
}

export function validateMintAddress(mintAddress: string): boolean {
  // Basic Solana address validation (base58, 32-44 chars)
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(mintAddress);
}

export function validateTokenSymbol(symbol: string): boolean {
  // Token symbols should be 1-10 characters, alphanumeric
  const symbolRegex = /^[A-Za-z0-9]{1,10}$/;
  return symbolRegex.test(symbol);
}

export function validatePrice(price: number): boolean {
  return typeof price === 'number' && 
         !isNaN(price) && 
         isFinite(price) && 
         price >= 0;
}

export function validateVolume(volume: number): boolean {
  return typeof volume === 'number' && 
         !isNaN(volume) && 
         isFinite(volume) && 
         volume >= 0;
}