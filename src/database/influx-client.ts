/**
 * InfluxDB 3.0 client for time-series data storage
 */

import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { logger } from '../utils/logger.js';
import { DATABASE_CONFIG } from '../utils/constants.js';
import { 
  TokenData, 
  PricePoint, 
  TradeData, 
  QueryResponse,
  PriceHistoryQuery,
  VolumeAnalysisQuery,
  AggregatedData
} from './schema.js';

export class InfluxClient {
  private client: InfluxDBClient;
  private writeBuffer: Point[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private host: string;
  private database: string;
  private token: string;
  private organization: string;

  constructor(
    config: {
      host: string;
      token: string;
      database: string;
      organization: string;
    },
    batchSize: number = 100,
    flushInterval: number = 5000
  ) {
    this.host = config.host;
    this.database = config.database;
    this.token = config.token;
    this.organization = config.organization;
    
    this.client = new InfluxDBClient({
      host: this.host,
      database: this.database,
      token: this.token,
    });
    
    this.setupFlushTimer();
  }

  async connect(): Promise<void> {
    try {
      // Test connection with a simple query
      await this.client.query('SELECT 1', this.database);
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
    
    this.isConnected = false;
    logger.info('Disconnected from InfluxDB');
  }

  private setupFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      if (this.writeBuffer.length > 0) {
        await this.flush();
      }
    }, DATABASE_CONFIG.FLUSH_INTERVAL);
  }

  private createTokenDataPoint(tokenData: TokenData): Point {
    const point = Point.measurement('token_data');
    point.setTag('mint', tokenData.mint);
    point.setTag('symbol', tokenData.symbol);
    point.setTag('platform', tokenData.platform);
    point.setTag('name', tokenData.name);
    point.setFloatField('price', tokenData.price);
    point.setFloatField('volume24h', tokenData.volume24h);
    point.setFloatField('marketCap', tokenData.marketCap);
    point.setFloatField('liquidity', tokenData.liquidity || 0);
    point.setFloatField('priceChange24h', tokenData.priceChange24h || 0);
    point.setFloatField('volumeChange24h', tokenData.volumeChange24h || 0);
    point.setIntegerField('holders', tokenData.holders || 0);
    point.setFloatField('platformConfidence', tokenData.platformConfidence || 0);
    point.setTimestamp(tokenData.timestamp);
    return point;
  }

  private createPricePoint(priceData: PricePoint): Point {
    const point = Point.measurement('price_data');
    point.setTag('mint', priceData.mint);
    point.setTag('platform', priceData.platform);
    point.setTag('source', priceData.source);
    point.setFloatField('price', priceData.price);
    point.setFloatField('volume', priceData.volume);
    point.setTimestamp(priceData.timestamp);
    return point;
  }

  private createTradeDataPoint(tradeData: TradeData): Point {
    const point = Point.measurement('trade_data');
    point.setTag('mint', tradeData.mint);
    point.setTag('platform', tradeData.platform);
    point.setTag('type', tradeData.type);
    point.setTag('wallet', tradeData.wallet);
    point.setTag('signature', tradeData.signature);
    point.setFloatField('amount', tradeData.amount);
    point.setFloatField('price', tradeData.price);
    point.setFloatField('value', tradeData.value);
    point.setTimestamp(tradeData.timestamp);
    return point;
  }

  async writeTokenData(tokenData: TokenData): Promise<void> {
    const point = this.createTokenDataPoint(tokenData);
    this.writeBuffer.push(point);
    
    if (this.writeBuffer.length >= DATABASE_CONFIG.BATCH_SIZE) {
      await this.flush();
    }
  }

  async writePriceData(priceData: PricePoint): Promise<void> {
    const point = this.createPricePoint(priceData);
    this.writeBuffer.push(point);
    
    if (this.writeBuffer.length >= DATABASE_CONFIG.BATCH_SIZE) {
      await this.flush();
    }
  }

  async writeTradeData(tradeData: TradeData): Promise<void> {
    const point = this.createTradeDataPoint(tradeData);
    this.writeBuffer.push(point);
    
    if (this.writeBuffer.length >= DATABASE_CONFIG.BATCH_SIZE) {
      await this.flush();
    }
  }

  async writeBatch(data: (TokenData | PricePoint | TradeData)[]): Promise<void> {
    for (const item of data) {
      if ('symbol' in item && 'name' in item) {
        // TokenData
        await this.writeTokenData(item as TokenData);
      } else if ('source' in item) {
        // PricePoint
        await this.writePriceData(item as PricePoint);
      } else if ('type' in item && 'wallet' in item) {
        // TradeData
        await this.writeTradeData(item as TradeData);
      }
    }
  }

  private async flush(): Promise<void> {
    if (this.writeBuffer.length === 0 || !this.isConnected) {
      return;
    }

    const pointsToWrite = [...this.writeBuffer];
    this.writeBuffer = [];

    try {
      await this.client.write(pointsToWrite, this.database);
      logger.debug('Flushed data to InfluxDB', {
        pointCount: pointsToWrite.length,
      });
    } catch (error) {
      logger.error('Failed to flush data to InfluxDB', {
        pointCount: pointsToWrite.length,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Re-add points to buffer for retry
      this.writeBuffer.unshift(...pointsToWrite);
      throw error;
    }
  }

  async queryTokenData(
    mint?: string,
    platform?: string,
    timeRange?: { start: Date; end: Date },
    limit = 1000
  ): Promise<QueryResponse<TokenData>> {
    try {
      let query = `
        SELECT * FROM token_data
        WHERE time >= now() - interval '24 hours'
      `;

      if (mint) {
        query += ` AND mint = '${mint}'`;
      }
      
      if (platform) {
        query += ` AND platform = '${platform}'`;
      }
      
      if (timeRange) {
        query += ` AND time >= '${timeRange.start.toISOString()}'`;
        query += ` AND time <= '${timeRange.end.toISOString()}'`;
      }
      
      query += ` ORDER BY time DESC LIMIT ${limit}`;

      const result = await this.client.query(query, this.database);
      const data: TokenData[] = [];
      
      for await (const row of result) {
        data.push({
          mint: row['mint'] as string,
          symbol: row['symbol'] as string,
          name: row['name'] as string,
          platform: row['platform'] as any,
          platformConfidence: row['platformConfidence'] as number,
          price: row['price'] as number,
          volume24h: row['volume24h'] as number,
          marketCap: row['marketCap'] as number,
          liquidity: row['liquidity'] as number,
          priceChange24h: row['priceChange24h'] as number,
          volumeChange24h: row['volumeChange24h'] as number,
          holders: row['holders'] as number,
          timestamp: new Date(row['time'] as string),
        });
      }

      return {
        success: true,
        data,
        count: data.length,
        timestamp: new Date(),
        query: { mint, platform, timeRange, limit } as Record<string, unknown>,
      };
    } catch (error) {
      logger.error('Failed to query token data', {
        mint,
        platform,
        timeRange,
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        success: false,
        data: [],
        count: 0,
        timestamp: new Date(),
        query: { mint, platform, timeRange, limit } as Record<string, unknown>,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getPriceHistory(query: PriceHistoryQuery): Promise<QueryResponse<AggregatedData>> {
    try {
      const interval = query.interval || '1h';
      const aggregation = query.aggregation || 'mean';
      
      const sqlQuery = `
        SELECT 
          time_bucket(INTERVAL '${interval}', time) as timestamp,
          ${aggregation}(price) as value,
          count(*) as count
        FROM price_data
        WHERE mint = '${query.mint}'
        AND time >= '${query.timeRange.start.toISOString()}'
        AND time <= '${query.timeRange.end.toISOString()}'
        GROUP BY timestamp
        ORDER BY timestamp DESC
      `;

      const result = await this.client.query(sqlQuery, this.database);
      const data: AggregatedData[] = [];
      
      for await (const row of result) {
        data.push({
          timestamp: new Date(row['timestamp'] as string),
          value: row['value'] as number,
          count: row['count'] as number,
        });
      }

      return {
        success: true,
        data,
        count: data.length,
        timestamp: new Date(),
        query: query as unknown as Record<string, unknown>,
      };
    } catch (error) {
      logger.error('Failed to get price history', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        success: false,
        data: [],
        count: 0,
        timestamp: new Date(),
        query: query as unknown as Record<string, unknown>,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getVolumeAnalysis(query: VolumeAnalysisQuery): Promise<QueryResponse<AggregatedData>> {
    try {
      let groupByClause = '';
      let selectClause = 'time as timestamp';
      
      switch (query.groupBy) {
        case 'platform':
          selectClause = 'platform as timestamp';
          groupByClause = 'GROUP BY platform';
          break;
        case 'hour':
          selectClause = 'time_bucket(INTERVAL \'1 hour\', time) as timestamp';
          groupByClause = 'GROUP BY timestamp';
          break;
        case 'day':
          selectClause = 'time_bucket(INTERVAL \'1 day\', time) as timestamp';
          groupByClause = 'GROUP BY timestamp';
          break;
      }

      let sqlQuery = `
        SELECT 
          ${selectClause},
          sum(volume24h) as value,
          count(*) as count
        FROM token_data
        WHERE time >= '${query.timeRange.start.toISOString()}'
        AND time <= '${query.timeRange.end.toISOString()}'
      `;

      if (query.platform) {
        sqlQuery += ` AND platform = '${query.platform}'`;
      }

      sqlQuery += ` ${groupByClause} ORDER BY value DESC`;

      if (query.topN) {
        sqlQuery += ` LIMIT ${query.topN}`;
      }

      const result = await this.client.query(sqlQuery, this.database);
      const data: AggregatedData[] = [];
      
      for await (const row of result) {
        data.push({
          timestamp: new Date(row['timestamp'] as string),
          value: row['value'] as number,
          count: row['count'] as number,
        });
      }

      return {
        success: true,
        data,
        count: data.length,
        timestamp: new Date(),
        query: query as unknown as Record<string, unknown>,
      };
    } catch (error) {
      logger.error('Failed to get volume analysis', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        success: false,
        data: [],
        count: 0,
        timestamp: new Date(),
        query: query as unknown as Record<string, unknown>,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  isHealthy(): boolean {
    return this.isConnected;
  }

  getBufferSize(): number {
    return this.writeBuffer.length;
  }

  async close(): Promise<void> {
    // Clear any pending flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    // Flush any remaining data
    if (this.writeBuffer.length > 0) {
      await this.flush();
    }
    
    // Close client connection
    this.client.close();
    this.isConnected = false;
    
    logger.info('InfluxDB client closed');
  }
}