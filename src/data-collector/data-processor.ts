/**
 * Data processing pipeline for incoming WebSocket data
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { 
  validateMintAddress, 
  validateTokenSymbol, 
  validatePrice, 
  validateVolume 
} from '../utils/validators.js';
import { InfluxClient } from '../database/influx-client.js';
import { 
  TokenData, 
  PricePoint, 
  TradeData, 
  TokenUpdateMessage, 
  TradeMessage, 
  WebSocketMessage 
} from '../database/schema.js';

interface ProcessingStats {
  totalProcessed: number;
  tokenUpdatesProcessed: number;
  tradesProcessed: number;
  errorsEncountered: number;
  lastProcessedAt: Date | null;
  validationErrors: number;
  databaseWrites: number;
  databaseErrors: number;
}

interface ProcessingConfig {
  enableValidation: boolean;
  enableDatabaseWrites: boolean;
  batchSize: number;
  flushInterval: number;
  dedupWindowMs: number;
}

export class DataProcessor extends EventEmitter {
  private stats: ProcessingStats;
  private config: ProcessingConfig;
  private recentMints = new Map<string, number>(); // mint -> timestamp
  private processingQueue: WebSocketMessage[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private influxClient: InfluxClient,
    config: Partial<ProcessingConfig> = {}
  ) {
    super();
    
    this.config = {
      enableValidation: true,
      enableDatabaseWrites: true,
      batchSize: 100,
      flushInterval: 5000,
      dedupWindowMs: 1000,
      ...config,
    };

    this.stats = {
      totalProcessed: 0,
      tokenUpdatesProcessed: 0,
      tradesProcessed: 0,
      errorsEncountered: 0,
      lastProcessedAt: null,
      validationErrors: 0,
      databaseWrites: 0,
      databaseErrors: 0,
    };

    this.setupFlushTimer();
  }

  private setupFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      if (this.processingQueue.length > 0) {
        await this.processQueue();
      }
      
      // Cleanup old dedup entries
      this.cleanupDedupCache();
    }, this.config.flushInterval);
  }

  async processMessage(message: WebSocketMessage): Promise<void> {
    try {
      this.stats.totalProcessed++;
      this.stats.lastProcessedAt = new Date();

      // Add to processing queue
      this.processingQueue.push(message);

      // Process immediately if queue is full
      if (this.processingQueue.length >= this.config.batchSize) {
        await this.processQueue();
      }

      this.emit('messageProcessed', {
        type: message.type,
        queueSize: this.processingQueue.length,
      });

    } catch (error) {
      this.stats.errorsEncountered++;
      logger.error('Failed to process message', {
        messageType: message.type,
        error: error instanceof Error ? error.message : String(error),
      });
      
      this.emit('processingError', error);
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const messagesToProcess = [...this.processingQueue];
    this.processingQueue = [];

    try {
      const tokenUpdates: TokenData[] = [];
      const trades: TradeData[] = [];
      const pricePoints: PricePoint[] = [];

      for (const message of messagesToProcess) {
        try {
          switch (message.type) {
            case 'tokenUpdate':
              const tokenData = await this.processTokenUpdate(message as TokenUpdateMessage);
              if (tokenData) {
                tokenUpdates.push(tokenData);
                
                // Also create price point
                const pricePoint = this.createPricePoint(tokenData);
                if (pricePoint) {
                  pricePoints.push(pricePoint);
                }
              }
              break;

            case 'trade':
              const tradeData = await this.processTradeMessage(message as TradeMessage);
              if (tradeData) {
                trades.push(tradeData);
              }
              break;

            default:
              logger.debug('Skipping unknown message type', { type: message.type });
          }
        } catch (error) {
          this.stats.errorsEncountered++;
          logger.error('Failed to process individual message', {
            messageType: message.type,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Write to database if enabled
      if (this.config.enableDatabaseWrites) {
        await this.writeBatchToDatabase(tokenUpdates, trades, pricePoints);
      }

      logger.debug('Processed message batch', {
        totalMessages: messagesToProcess.length,
        tokenUpdates: tokenUpdates.length,
        trades: trades.length,
        pricePoints: pricePoints.length,
      });

    } catch (error) {
      this.stats.errorsEncountered++;
      logger.error('Failed to process message queue', {
        queueSize: messagesToProcess.length,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isProcessing = false;
    }
  }

  private async processTokenUpdate(message: TokenUpdateMessage): Promise<TokenData | null> {
    const data = message.data;

    // Deduplication check
    if (this.isDuplicate(data.mint)) {
      logger.debug('Skipping duplicate token update', { mint: data.mint });
      return null;
    }

    // Validation
    if (this.config.enableValidation && !this.validateTokenData(data)) {
      this.stats.validationErrors++;
      return null;
    }

    const tokenData: TokenData = {
      ...data,
      timestamp: message.timestamp,
    };

    this.stats.tokenUpdatesProcessed++;
    this.emit('tokenUpdate', tokenData);
    
    return tokenData;
  }

  private async processTradeMessage(message: TradeMessage): Promise<TradeData | null> {
    const data = message.data;

    // Validation
    if (this.config.enableValidation && !this.validateTradeData(data)) {
      this.stats.validationErrors++;
      return null;
    }

    const tradeData: TradeData = {
      ...data,
      timestamp: message.timestamp,
    };

    this.stats.tradesProcessed++;
    this.emit('trade', tradeData);
    
    return tradeData;
  }

  private createPricePoint(tokenData: TokenData): PricePoint | null {
    if (!tokenData.price || tokenData.price <= 0) {
      return null;
    }

    return {
      mint: tokenData.mint,
      platform: tokenData.platform,
      price: tokenData.price,
      volume: tokenData.volume24h || 0,
      timestamp: tokenData.timestamp,
      source: 'pumpportal',
    };
  }

  private validateTokenData(data: Partial<TokenData>): boolean {
    if (!data.mint || !validateMintAddress(data.mint)) {
      logger.debug('Invalid mint address', { mint: data.mint });
      return false;
    }

    if (!data.symbol || !validateTokenSymbol(data.symbol)) {
      logger.debug('Invalid token symbol', { symbol: data.symbol });
      return false;
    }

    if (data.price !== undefined && !validatePrice(data.price)) {
      logger.debug('Invalid price', { price: data.price });
      return false;
    }

    if (data.volume24h !== undefined && !validateVolume(data.volume24h)) {
      logger.debug('Invalid volume', { volume: data.volume24h });
      return false;
    }

    return true;
  }

  private validateTradeData(data: Partial<TradeData>): boolean {
    if (!data.mint || !validateMintAddress(data.mint)) {
      logger.debug('Invalid trade mint address', { mint: data.mint });
      return false;
    }

    if (!data.type || !['buy', 'sell'].includes(data.type)) {
      logger.debug('Invalid trade type', { type: data.type });
      return false;
    }

    if (data.amount !== undefined && !validateVolume(data.amount)) {
      logger.debug('Invalid trade amount', { amount: data.amount });
      return false;
    }

    if (data.price !== undefined && !validatePrice(data.price)) {
      logger.debug('Invalid trade price', { price: data.price });
      return false;
    }

    if (!data.signature || data.signature.length < 10) {
      logger.debug('Invalid transaction signature', { signature: data.signature });
      return false;
    }

    return true;
  }

  private isDuplicate(mint: string): boolean {
    const now = Date.now();
    const lastSeen = this.recentMints.get(mint);
    
    if (lastSeen && (now - lastSeen) < this.config.dedupWindowMs) {
      return true;
    }

    this.recentMints.set(mint, now);
    return false;
  }

  private cleanupDedupCache(): void {
    const now = Date.now();
    const cutoff = now - (this.config.dedupWindowMs * 2);
    
    for (const [mint, timestamp] of this.recentMints.entries()) {
      if (timestamp < cutoff) {
        this.recentMints.delete(mint);
      }
    }
  }

  private async writeBatchToDatabase(
    tokenUpdates: TokenData[],
    trades: TradeData[],
    pricePoints: PricePoint[]
  ): Promise<void> {
    try {
      const writePromises: Promise<void>[] = [];

      // Write token updates
      for (const tokenData of tokenUpdates) {
        writePromises.push(this.influxClient.writeTokenData(tokenData));
      }

      // Write trades
      for (const tradeData of trades) {
        writePromises.push(this.influxClient.writeTradeData(tradeData));
      }

      // Write price points
      for (const pricePoint of pricePoints) {
        writePromises.push(this.influxClient.writePriceData(pricePoint));
      }

      await Promise.all(writePromises);
      
      this.stats.databaseWrites += writePromises.length;
      
      logger.debug('Batch written to database', {
        tokenUpdates: tokenUpdates.length,
        trades: trades.length,
        pricePoints: pricePoints.length,
      });

    } catch (error) {
      this.stats.databaseErrors++;
      logger.error('Failed to write batch to database', {
        tokenUpdates: tokenUpdates.length,
        trades: trades.length,
        pricePoints: pricePoints.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async flush(): Promise<void> {
    await this.processQueue();
  }

  async stop(): Promise<void> {
    logger.info('Stopping data processor');
    
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    // Process remaining messages
    await this.flush();
    
    logger.info('Data processor stopped', { stats: this.stats });
  }

  getStats(): ProcessingStats {
    return { ...this.stats };
  }

  getConfig(): ProcessingConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<ProcessingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Data processor config updated', { config: this.config });
  }

  getQueueSize(): number {
    return this.processingQueue.length;
  }

  getDedupCacheSize(): number {
    return this.recentMints.size;
  }
}