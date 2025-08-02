/**
 * Database schemas and types for Pump Agent
 */

import { Platform } from '../utils/constants.js';
import { PriceAlert } from '../data-collector/price-tracker.js';

export interface TokenData {
  mint: string;
  symbol: string;
  name: string;
  platform: Platform;
  platformConfidence: number;
  price: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  priceChange24h: number;
  volumeChange24h: number;
  holders: number;
  timestamp: Date;
  uri?: string;
  description?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface PricePoint {
  mint: string;
  platform: Platform;
  price: number;
  volume: number;
  timestamp: Date;
  source: string;
}

export interface TradeData {
  mint: string;
  platform: Platform;
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  value: number;
  wallet: string;
  signature: string;
  timestamp: Date;
}

export interface PlatformMetrics {
  platform: Platform;
  totalTokens: number;
  totalVolume24h: number;
  totalMarketCap: number;
  averagePrice: number;
  topTokensByVolume: TokenData[];
  timestamp: Date;
}

export interface WebSocketMessage {
  type: 'tokenUpdate' | 'trade' | 'error' | 'heartbeat';
  data: unknown;
  timestamp: Date;
}

export interface TokenUpdateMessage extends WebSocketMessage {
  type: 'tokenUpdate';
  data: Omit<TokenData, 'timestamp'>;
}

export interface TradeMessage extends WebSocketMessage {
  type: 'trade';
  data: Omit<TradeData, 'timestamp'>;
}

export interface ErrorMessage extends WebSocketMessage {
  type: 'error';
  data: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface HeartbeatMessage extends WebSocketMessage {
  type: 'heartbeat';
  data: {
    status: 'alive';
    uptime: number;
    connections: number;
  };
}

// InfluxDB specific schemas
export interface InfluxPoint {
  measurement: string;
  tags: Record<string, string>;
  fields: Record<string, number | string | boolean>;
  timestamp?: Date;
}

export interface TokenDataPoint extends InfluxPoint {
  measurement: 'token_data';
  tags: {
    mint: string;
    symbol: string;
    platform: Platform;
    name: string;
  };
  fields: {
    price: number;
    volume24h: number;
    marketCap: number;
    liquidity: number;
    priceChange24h: number;
    volumeChange24h: number;
    holders: number;
    platformConfidence: number;
  };
}

export interface PriceDataPoint extends InfluxPoint {
  measurement: 'price_data';
  tags: {
    mint: string;
    platform: Platform;
    source: string;
  };
  fields: {
    price: number;
    volume: number;
  };
}

export interface TradeDataPoint extends InfluxPoint {
  measurement: 'trade_data';
  tags: {
    mint: string;
    platform: Platform;
    type: 'buy' | 'sell';
    wallet: string;
  };
  fields: {
    amount: number;
    price: number;
    value: number;
  };
}

// Query interfaces for MCP server
export interface TokenQuery {
  mint?: string;
  symbol?: string;
  platform?: Platform;
  minPrice?: number;
  maxPrice?: number;
  minVolume?: number;
  maxVolume?: number;
  timeRange?: {
    start: Date;
    end: Date;
  };
  limit?: number;
  orderBy?: 'price' | 'volume' | 'marketCap' | 'timestamp';
  orderDirection?: 'asc' | 'desc';
}

export interface PriceHistoryQuery {
  mint: string;
  timeRange: {
    start: Date;
    end: Date;
  };
  interval?: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  aggregation?: 'mean' | 'max' | 'min' | 'first' | 'last';
}

export interface VolumeAnalysisQuery {
  platform?: Platform;
  timeRange: {
    start: Date;
    end: Date;
  };
  groupBy?: 'platform' | 'hour' | 'day';
  topN?: number;
}

export interface TrendAnalysisQuery {
  platform?: Platform;
  metric: 'price' | 'volume' | 'marketCap';
  timeRange: {
    start: Date;
    end: Date;
  };
  threshold?: number;
  direction?: 'up' | 'down' | 'both';
}

// Response types
export interface QueryResponse<T> {
  success: boolean;
  data: T[];
  count: number;
  timestamp: Date;
  query: Record<string, unknown>;
  error?: string;
}

export interface AggregatedData {
  value: number;
  timestamp: Date;
  count: number;
}

export interface TrendData {
  mint: string;
  symbol: string;
  platform: Platform;
  startValue: number;
  endValue: number;
  change: number;
  changePercent: number;
  direction: 'up' | 'down' | 'stable';
}

// Validation schemas
export const TOKEN_DATA_REQUIRED_FIELDS = [
  'mint',
  'symbol', 
  'name',
  'platform',
  'price',
  'volume24h',
  'marketCap',
  'timestamp',
] as const;

export const TRADE_DATA_REQUIRED_FIELDS = [
  'mint',
  'platform',
  'type',
  'amount',
  'price',
  'value',
  'wallet',
  'signature',
  'timestamp',
] as const;

export type TokenDataRequiredField = typeof TOKEN_DATA_REQUIRED_FIELDS[number];
export type TradeDataRequiredField = typeof TRADE_DATA_REQUIRED_FIELDS[number];

// Cleanup event for audit trail
export interface CleanupEvent {
  mint: string;
  symbol: string;
  platform: Platform;
  reason: 'rugged' | 'inactive' | 'low_volume';
  details: string;
  timestamp: Date;
  finalPrice?: number;
  finalVolume?: number;
  finalLiquidity?: number;
  peakPrice?: number;
  peakVolume?: number;
  trackedDuration: number; // milliseconds
  finalMarketCap?: number;
  totalTrades?: number;
}

// Cleanup metrics for reporting
export interface CleanupMetrics {
  totalEvaluated: number;
  ruggedDetected: number;
  inactiveDetected: number;
  lowVolumeDetected: number;
  actuallyRemoved: number;
  savedByWhitelist: number;
  savedByGracePeriod: number;
  savedByLimit: number;
  executionTimeMs: number;
  memoryFreedBytes?: number;
}

// Event data types for proper event typing
export interface AlertEventData {
  alert: PriceAlert;
  tokenData: TokenData;
}

export interface TrendEventData {
  mint: string;
  symbol: string;
  platform: Platform;
  trendType: 'bullish' | 'bearish' | 'sideways';
  confidence: number;
  timeframe: string;
  data: {
    startPrice: number;
    endPrice: number;
    changePercent: number;
    volume: number;
  };
}

export interface CleanupEventData {
  mint: string;
  symbol: string;
  platform: Platform;
  reason: 'rugged' | 'inactive' | 'low_volume' | 'emergency';
  details: string;
  finalMetrics: {
    price: number;
    volume: number;
    liquidity: number;
    trackedDuration: number;
  };
}

// Emergency override config interface (mutable version of constants)
export interface EmergencyOverrideConfig {
  MAX_CLEANUP_PERCENTAGE: number;
  CLEANUP_ENABLED: boolean;
  FORCE_MINIMUM_TOKENS?: boolean;
  BYPASS_SAFETY_CHECKS?: boolean;
}

// Solana transaction types for proper typing
export interface SolanaInstruction {
  programId: {
    toString(): string;
  };
  accounts: unknown[];
  data: unknown;
}

export interface SolanaTransactionMessage {
  instructions: SolanaInstruction[];
  recentBlockhash: string;
  feePayer: unknown;
}

export interface SolanaTransaction {
  transaction: {
    message: SolanaTransactionMessage;
  };
  meta: unknown;
}

// InfluxDB query result types
export interface InfluxQueryRow {
  [key: string]: string | number | boolean | Date | null | undefined;
}

export interface InfluxQueryResult {
  [Symbol.asyncIterator](): AsyncIterableIterator<InfluxQueryRow>;
}

// Query response types
export interface QueryResponse<T> {
  data: T[];
  metadata?: {
    totalCount?: number;
    executionTime?: number;
  };
}