/**
 * InfluxDB 3.0 client for time-series data storage
 */

import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';
import { logger } from '../utils/logger.js';
import { DATABASE_CONFIG } from '../utils/constants.js';
import { 
  TokenData, 
  PricePoint, 
  TradeData, 
  QueryResponse,
  PriceHistoryQuery,
  VolumeAnalysisQuery,
  AggregatedData,
  CleanupEvent,
  CleanupMetrics,
} from './schema.js';

export class InfluxClient {
  private client: InfluxDB;
  private writeApi: WriteApi | null = null;
  private writeBuffer: Point[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private host: string;
  private database: string;
  private token: string;
  private org: string;

  constructor(
    config: {
      host: string;
      token: string;
      database: string;
      organization: string;
    },
    _batchSize: number = 100,
    _flushInterval: number = 5000
  ) {
    this.host = config.host;
    this.database = config.database;
    this.token = config.token;
    this.org = config.organization;
    
    this.client = new InfluxDB({
      url: this.host,
      token: this.token,
    });
    
    this.setupFlushTimer();
  }

  async connect(): Promise<void> {
    try {
      // Initialize write API
      this.writeApi = this.client.getWriteApi(this.org, this.database);
      
      // Test connection with a simple query
      const queryApi = this.client.getQueryApi(this.org);
      await queryApi.queryRaw('SELECT 1');
      
      this.isConnected = true;
      logger.info('Connected to InfluxDB', {
        host: this.host,
        database: this.database,
      });
    } catch (error) {
      this.isConnected = false;
      logger.error('Failed to connect to InfluxDB', {
        host: this.host,
        database: this.database,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    // Flush any remaining data
    await this.flush();
    
    // Close write API
    if (this.writeApi) {
      await this.writeApi.close();
      this.writeApi = null;
    }
    
    this.isConnected = false;
    logger.info('Disconnected from InfluxDB');
  }

  private setupFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.writeBuffer.length > 0) {
        void this.flush();
      }
    }, DATABASE_CONFIG.FLUSH_INTERVAL);
  }

  private createTokenDataPoint(tokenData: TokenData): Point {
    const point = new Point('token_data');
    point.tag('mint', tokenData.mint);
    point.tag('symbol', tokenData.symbol);
    point.tag('platform', tokenData.platform);
    point.tag('name', tokenData.name);
    point.floatField('price', tokenData.price);
    point.floatField('volume24h', tokenData.volume24h);
    point.floatField('marketCap', tokenData.marketCap);
    point.floatField('liquidity', tokenData.liquidity);
    point.floatField('priceChange24h', tokenData.priceChange24h);
    point.floatField('volumeChange24h', tokenData.volumeChange24h);
    point.intField('holders', tokenData.holders);
    point.floatField('platformConfidence', tokenData.platformConfidence);
    point.timestamp(tokenData.timestamp);
    return point;
  }

  private createPricePoint(priceData: PricePoint): Point {
    const point = new Point('price_data');
    point.tag('mint', priceData.mint);
    point.tag('platform', priceData.platform);
    point.tag('source', priceData.source);
    point.floatField('price', priceData.price);
    point.floatField('volume', priceData.volume);
    point.timestamp(priceData.timestamp);
    return point;
  }

  private createTradeDataPoint(tradeData: TradeData): Point {
    const point = new Point('trade_data');
    point.tag('mint', tradeData.mint);
    point.tag('platform', tradeData.platform);
    point.tag('type', tradeData.type);
    point.tag('wallet', tradeData.wallet);
    point.floatField('amount', tradeData.amount);
    point.floatField('price', tradeData.price);
    point.floatField('value', tradeData.value);
    point.timestamp(tradeData.timestamp);
    return point;
  }

  private createCleanupEventPoint(event: CleanupEvent): Point {
    const point = new Point('cleanup_events');
    point.tag('mint', event.mint);
    point.tag('symbol', event.symbol);
    point.tag('platform', event.platform);
    point.tag('reason', event.reason);
    point.stringField('details', event.details);
    point.floatField('finalPrice', event.finalPrice || 0);
    point.floatField('finalVolume', event.finalVolume || 0);
    point.floatField('finalLiquidity', event.finalLiquidity || 0);
    point.floatField('peakPrice', event.peakPrice || 0);
    point.floatField('peakVolume', event.peakVolume || 0);
    point.intField('trackedDuration', event.trackedDuration);
    point.floatField('finalMarketCap', event.finalMarketCap || 0);
    point.intField('totalTrades', event.totalTrades || 0);
    point.timestamp(event.timestamp);
    return point;
  }

  async writeTokenData(tokenData: TokenData): Promise<void> {
    const point = this.createTokenDataPoint(tokenData);
    this.writeBuffer.push(point);
    return Promise.resolve();
  }

  async writePriceData(priceData: PricePoint): Promise<void> {
    const point = this.createPricePoint(priceData);
    this.writeBuffer.push(point);
    return Promise.resolve();
  }

  async writeTradeData(tradeData: TradeData): Promise<void> {
    const point = this.createTradeDataPoint(tradeData);
    this.writeBuffer.push(point);
    return Promise.resolve();
  }

  async writeBatch(data: (TokenData | PricePoint | TradeData)[]): Promise<void> {
    for (const item of data) {
      if ('volume24h' in item) {
        await this.writeTokenData(item);
      } else if ('source' in item) {
        await this.writePriceData(item);
      } else {
        await this.writeTradeData(item);
      }
    }
  }

  async writeCleanupEvent(event: CleanupEvent): Promise<void> {
    const point = this.createCleanupEventPoint(event);
    this.writeBuffer.push(point);
    return Promise.resolve();
  }

  async writeCleanupMetrics(metrics: CleanupMetrics): Promise<void> {
    const point = new Point('cleanup_metrics');
    point.intField('totalEvaluated', metrics.totalEvaluated);
    point.intField('ruggedDetected', metrics.ruggedDetected);
    point.intField('inactiveDetected', metrics.inactiveDetected);
    point.intField('lowVolumeDetected', metrics.lowVolumeDetected);
    point.intField('actuallyRemoved', metrics.actuallyRemoved);
    point.intField('savedByWhitelist', metrics.savedByWhitelist);
    point.intField('savedByGracePeriod', metrics.savedByGracePeriod);
    point.intField('savedByLimit', metrics.savedByLimit);
    point.intField('executionTimeMs', metrics.executionTimeMs);
    if (metrics.memoryFreedBytes) {
      point.intField('memoryFreedBytes', metrics.memoryFreedBytes);
    }
    point.timestamp(new Date());
    this.writeBuffer.push(point);
    return Promise.resolve();
  }

  private async flush(): Promise<void> {
    if (!this.writeApi || this.writeBuffer.length === 0) {
      return;
    }

    const pointsToWrite = [...this.writeBuffer];
    this.writeBuffer = [];

    try {
      await this.writeApi.writePoints(pointsToWrite);
      await this.writeApi.flush();

      logger.debug('Flushed data to InfluxDB', {
        pointsWritten: pointsToWrite.length,
        bufferSize: this.writeBuffer.length,
      });
    } catch (error) {
      logger.error('Failed to flush data to InfluxDB', {
        error: error instanceof Error ? error.message : String(error),
        bufferSize: this.writeBuffer.length,
      });
      // Re-add points to buffer for retry
      this.writeBuffer.unshift(...pointsToWrite);
    }
  }

  async queryTokenData(
    mint?: string,
    platform?: string,
    timeRange?: { start: Date; end: Date },
    limit = 1000
  ): Promise<QueryResponse<TokenData>> {
    try {
      let query = `SELECT * FROM token_data`;
      const conditions: string[] = [];

      if (mint) {
        conditions.push(`mint = '${mint}'`);
      }
      if (platform) {
        conditions.push(`platform = '${platform}'`);
      }
      if (timeRange) {
        conditions.push(`time >= '${timeRange.start.toISOString()}' AND time <= '${timeRange.end.toISOString()}'`);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      query += ` ORDER BY time DESC LIMIT ${limit}`;

      const queryApi = this.client.getQueryApi(this.org);
      await queryApi.queryRaw(query);

      const data: TokenData[] = [];
      // Parse the result and convert to TokenData objects
      // This is a simplified implementation - you'd need to parse the actual result format

      return {
        data,
        count: data.length,
        success: true,
        timestamp: new Date(),
        query: { mint, platform, timeRange, limit } as Record<string, unknown>
      };
    } catch (error) {
      logger.error('Failed to query token data', {
        mint,
        platform,
        timeRange,
        limit,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        data: [],
        count: 0,
        success: false,
        timestamp: new Date(),
        query: { mint, platform, timeRange, limit },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async getPriceHistory(query: PriceHistoryQuery): Promise<QueryResponse<AggregatedData>> {
    try {
      const { mint, timeRange, interval = '1h', aggregation = 'mean' } = query;
      
      const sqlQuery = `
        SELECT ${aggregation}(price) as value, 
               ${aggregation}(volume) as volume,
               time_bucket('${interval}', time) as timestamp
        FROM price_data 
        WHERE mint = '${mint}' 
          AND time >= '${timeRange.start.toISOString()}' 
          AND time <= '${timeRange.end.toISOString()}'
        GROUP BY time_bucket('${interval}', time)
        ORDER BY timestamp DESC
      `;

      const queryApi = this.client.getQueryApi(this.org);
      await queryApi.queryRaw(sqlQuery);

      const data: AggregatedData[] = [];
      // Parse the result and convert to AggregatedData objects

      return {
        data,
        count: data.length,
        success: true,
        timestamp: new Date(),
        query: query as unknown as Record<string, unknown>
      };
    } catch (error) {
      logger.error('Failed to get price history', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        data: [],
        count: 0,
        success: false,
        timestamp: new Date(),
        query: query as unknown as Record<string, unknown>,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async getVolumeAnalysis(query: VolumeAnalysisQuery): Promise<QueryResponse<AggregatedData>> {
    try {
      const { platform, timeRange, groupBy = 'platform', topN = 10 } = query;
      
      let sqlQuery = `
        SELECT ${groupBy === 'platform' ? 'platform' : 'time_bucket(\'1h\', time)'} as group_key,
               SUM(volume) as value,
               COUNT(*) as count
        FROM trade_data
        WHERE time >= '${timeRange.start.toISOString()}' 
          AND time <= '${timeRange.end.toISOString()}'
      `;

      if (platform) {
        sqlQuery += ` AND platform = '${platform}'`;
      }

      sqlQuery += `
        GROUP BY ${groupBy === 'platform' ? 'platform' : 'time_bucket(\'1h\', time)'}
        ORDER BY value DESC
        LIMIT ${topN}
      `;

      const queryApi = this.client.getQueryApi(this.org);
      await queryApi.queryRaw(sqlQuery);

      const data: AggregatedData[] = [];
      // Parse the result and convert to AggregatedData objects

      return {
        data,
        count: data.length,
        success: true,
        timestamp: new Date(),
        query: query as unknown as Record<string, unknown>
      };
    } catch (error) {
      logger.error('Failed to get volume analysis', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        data: [],
        count: 0,
        success: false,
        timestamp: new Date(),
        query: query as unknown as Record<string, unknown>,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async queryCleanupEvents(
    mint?: string,
    reason?: 'rugged' | 'inactive' | 'low_volume',
    platform?: string,
    timeRange?: { start: Date; end: Date },
    limit = 1000
  ): Promise<QueryResponse<CleanupEvent>> {
    try {
      let query = `SELECT * FROM cleanup_events`;
      const conditions: string[] = [];

      if (mint) {
        conditions.push(`mint = '${mint}'`);
      }
      if (reason) {
        conditions.push(`reason = '${reason}'`);
      }
      if (platform) {
        conditions.push(`platform = '${platform}'`);
      }
      if (timeRange) {
        conditions.push(`time >= '${timeRange.start.toISOString()}' AND time <= '${timeRange.end.toISOString()}'`);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      query += ` ORDER BY time DESC LIMIT ${limit}`;

      const queryApi = this.client.getQueryApi(this.org);
      await queryApi.queryRaw(query);

      const data: CleanupEvent[] = [];
      // Parse the result and convert to CleanupEvent objects

      return {
        data,
        count: data.length,
        success: true,
        timestamp: new Date(),
        query: { mint, reason, platform, timeRange, limit } as Record<string, unknown>
      };
    } catch (error) {
      logger.error('Failed to query cleanup events', {
        mint,
        reason,
        platform,
        timeRange,
        limit,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        data: [],
        count: 0,
        success: false,
        timestamp: new Date(),
        query: { mint, reason, platform, timeRange, limit } as Record<string, unknown>,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  isHealthy(): boolean {
    return this.isConnected && this.writeApi !== null;
  }

  getBufferSize(): number {
    return this.writeBuffer.length;
  }

  async close(): Promise<void> {
    await this.disconnect();
  }
}