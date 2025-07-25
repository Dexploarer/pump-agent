import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { z } from 'zod';
import { detectPlatformWithBuffer } from '../utils/platform-detection-buffer';

// Platform enum for token sources
export const PlatformSchema = z.enum(['pump.fun', 'letsbonk.fun']);
export type Platform = z.infer<typeof PlatformSchema>;

// Data schemas with platform identification
const TokenDataSchema = z.object({
  mint: z.string(),
  name: z.string(),
  symbol: z.string(),
  price: z.number(),
  priceSOL: z.number(),
  marketCap: z.number(),
  supply: z.number(),
  timestamp: z.number(),
  platform: PlatformSchema,
  creator: z.string().optional(),
  decimals: z.number().optional(),
  uri: z.string().optional(),
});

const TradeDataSchema = z.object({
  mint: z.string(),
  price: z.number(),
  priceSOL: z.number(),
  volumeSOL: z.number(),
  marketCap: z.number(),
  timestamp: z.number(),
  type: z.enum(['buy', 'sell']),
  trader: z.string(),
  amount: z.number(),
  txHash: z.string(),
  platform: PlatformSchema,
});

// PumpPortal message schemas based on actual WebSocket data
const NewTokenMessageSchema = z.object({
  signature: z.string(),
  traderPublicKey: z.string(),
  txType: z.literal('create'),
  mint: z.string(),
  solInPool: z.number(),
  tokensInPool: z.number(),
  initialBuy: z.number(),
  solAmount: z.number(),
  newTokenBalance: z.number(),
  marketCapSol: z.number(),
  name: z.string(),
  symbol: z.string(),
  uri: z.string(),
  pool: z.string(),
});

const TradeMessageSchema = z.object({
  signature: z.string(),
  traderPublicKey: z.string(),
  txType: z.enum(['buy', 'sell']),
  mint: z.string(),
  solAmount: z.number(),
  tokenAmount: z.number(),
  marketCapSol: z.number(),
  pricePerToken: z.number().optional(),
  pool: z.string().optional(),
});

const SubscriptionMessageSchema = z.object({
  message: z.string(),
});

export type TokenData = z.infer<typeof TokenDataSchema>;
export type TradeData = z.infer<typeof TradeDataSchema>;

interface PumpPortalClientOptions {
  url: string;
  reconnectDelay: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
}

export class PumpPortalClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private options: PumpPortalClientOptions;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private isClosing = false;
  private subscribedTokens = new Set<string>();
  private messageQueue: unknown[] = [];
  private isProcessingQueue = false;

  constructor(options: PumpPortalClientOptions) {
    super();
    this.options = options;
  }

  public async connect(): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      logger.warn('WebSocket is already connected or connecting');
      return;
    }

    this.isConnecting = true;
    this.isClosing = false;

    try {
      logger.info('Connecting to PumpPortal WebSocket...', { url: this.options.url });
      
      this.ws = new WebSocket(this.options.url);
      
      this.ws.on('open', this.handleOpen.bind(this));
      this.ws.on('message', this.handleMessage.bind(this));
      this.ws.on('error', this.handleError.bind(this));
      this.ws.on('close', this.handleClose.bind(this));
      this.ws.on('ping', this.handlePing.bind(this));

      // Wait for connection to be established
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 30000);

        this.once('connected', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.once('error', (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

    } catch (error) {
      this.isConnecting = false;
      throw error;
    }
  }

  private handleOpen(): void {
    logger.info('WebSocket connection established');
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    
    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Start heartbeat
    this.startHeartbeat();

    // Subscribe to events
    this.subscribeToEvents();

    // Re-subscribe to previously tracked tokens
    if (this.subscribedTokens.size > 0) {
      const tokens = Array.from(this.subscribedTokens);
      this.subscribeToTokens(tokens);
    }

    this.emit('connected');
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const dataStr = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
      const message: unknown = JSON.parse(dataStr);
      
      // Add to queue for processing
      this.messageQueue.push(message);
      
      // Process queue if not already processing
      if (!this.isProcessingQueue) {
        void this.processMessageQueue();
      }
    } catch (error) {
      logger.error('Failed to parse WebSocket message', { error });
    }
  }

  private processMessageQueue(): void {
    if (this.isProcessingQueue || this.messageQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      
      try {
        // Check if it's a subscription confirmation
        if (typeof message === 'object' && message !== null && 'message' in message) {
          const subMessage = SubscriptionMessageSchema.parse(message);
          logger.info('Subscription message', { message: subMessage.message });
          continue;
        }

        // Check if it has txType field
        if (typeof message === 'object' && message !== null && Object.prototype.hasOwnProperty.call(message, 'txType')) {
          const txType = (message as { txType?: string }).txType;
          
          if (txType === 'create') {
            // New token creation
            const tokenMessage = NewTokenMessageSchema.parse(message);
            this.handleNewTokenMessage(tokenMessage);
          } else if (txType === 'buy' || txType === 'sell') {
            // Trade event
            const tradeMessage = TradeMessageSchema.parse(message);
            this.handleTradeMessage(tradeMessage);
          } else {
            logger.debug('Unknown txType', { txType, message });
          }
        } else {
          logger.debug('Unknown message format', { message });
        }
      } catch (error) {
        logger.error('Failed to process message', { error });
      }
    }

    this.isProcessingQueue = false;
  }

  private handleNewTokenMessage(message: z.infer<typeof NewTokenMessageSchema>): void {
    // Process platform detection asynchronously to avoid blocking
    void this.processNewTokenWithPlatformDetection(message);
  }

  private async processNewTokenWithPlatformDetection(message: z.infer<typeof NewTokenMessageSchema>): Promise<void> {
    try {
      // Detect platform using buffered RPC-based detection
      const platform = await detectPlatformWithBuffer(message.mint);
      
      // Convert to our TokenData format
      const tokenData: TokenData = {
        mint: message.mint,
        name: message.name,
        symbol: message.symbol,
        price: message.marketCapSol / 1000, // Approximate price
        priceSOL: message.marketCapSol / 1000,
        marketCap: message.marketCapSol * 100, // Approximate USD market cap (SOL at $100)
        supply: 1000000000, // Default supply
        timestamp: Date.now(),
        platform, // Properly typed platform
        creator: message.traderPublicKey,
        uri: message.uri,
      };
      
      this.emit('newToken', tokenData);
      logger.info('New token detected', { 
        mint: message.mint, 
        symbol: message.symbol,
        name: message.name,
        platform: platform
      });
    } catch (error) {
      logger.error('Failed to process new token with platform detection', {
        mint: message.mint,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Fallback with unknown platform
      const tokenData: TokenData = {
        mint: message.mint,
        name: message.name,
        symbol: message.symbol,
        price: message.marketCapSol / 1000,
        priceSOL: message.marketCapSol / 1000,
        marketCap: message.marketCapSol * 100,
        supply: 1000000000,
        timestamp: Date.now(),
        platform: 'pump.fun' satisfies Platform, // Default fallback
        creator: message.traderPublicKey,
        uri: message.uri,
      };
      
      this.emit('newToken', tokenData);
    }
  }

  private handleTradeMessage(message: z.infer<typeof TradeMessageSchema>): void {
    // Process platform detection asynchronously to avoid blocking
    void this.processTradeWithPlatformDetection(message);
  }

  private async processTradeWithPlatformDetection(message: z.infer<typeof TradeMessageSchema>): Promise<void> {
    try {
      // Detect platform using buffered RPC-based detection
      const platform = await detectPlatformWithBuffer(message.mint);
      
      // Convert to our TradeData format
      const tradeData: TradeData = {
        mint: message.mint,
        price: message.pricePerToken || (message.solAmount / message.tokenAmount),
        priceSOL: message.pricePerToken || (message.solAmount / message.tokenAmount),
        volumeSOL: message.solAmount,
        marketCap: message.marketCapSol * 100, // Approximate USD market cap
        timestamp: Date.now(),
        type: message.txType,
        trader: message.traderPublicKey,
        amount: message.tokenAmount,
        txHash: message.signature,
        platform, // Properly typed platform
      };
      
      this.emit('tokenTrade', tradeData);
    } catch (error) {
      logger.error('Failed to process trade with platform detection', {
        mint: message.mint,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Fallback with default platform
      const tradeData: TradeData = {
        mint: message.mint,
        price: message.pricePerToken || (message.solAmount / message.tokenAmount),
        priceSOL: message.pricePerToken || (message.solAmount / message.tokenAmount),
        volumeSOL: message.solAmount,
        marketCap: message.marketCapSol * 100,
        timestamp: Date.now(),
        type: message.txType,
        trader: message.traderPublicKey,
        amount: message.tokenAmount,
        txHash: message.signature,
        platform: 'pump.fun' satisfies Platform, // Default fallback
      };
      
      this.emit('tokenTrade', tradeData);
    }
  }

  private handleError(error: Error): void {
    logger.error('WebSocket error', { error: error.message });
    this.emit('error', error);
  }

  private handleClose(code: number, reason: Buffer): void {
    logger.info('WebSocket connection closed', { code, reason: reason.toString() });
    
    this.stopHeartbeat();
    this.ws = null;
    this.isConnecting = false;

    if (!this.isClosing) {
      this.scheduleReconnect();
    }

    this.emit('disconnected', { code, reason: reason.toString() });
  }

  private handlePing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.pong();
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.options.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      60000 // Max 1 minute delay
    );

    logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts}`, { delay });

    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((error: unknown) => {
        logger.error('Reconnection failed', { error });
      });
    }, delay);
  }

  private subscribeToEvents(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot subscribe - WebSocket not connected');
      return;
    }

    // Subscribe to new token events
    this.sendMessage({
      method: 'subscribeNewToken',
    });

    // Subscribe to migration events
    this.sendMessage({
      method: 'subscribeMigration',
    });
  }

  public subscribeToTokens(tokens: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot subscribe to tokens - WebSocket not connected');
      return;
    }

    // Store tokens for re-subscription on reconnect
    tokens.forEach(token => this.subscribedTokens.add(token));

    // Subscribe to token trades
    this.sendMessage({
      method: 'subscribeTokenTrade',
      keys: tokens,
    });
  }

  public unsubscribeFromTokens(tokens: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot unsubscribe from tokens - WebSocket not connected');
      return;
    }

    // Remove from stored tokens
    tokens.forEach(token => this.subscribedTokens.delete(token));

    // Unsubscribe from token trades
    this.sendMessage({
      method: 'unsubscribeTokenTrade',
      keys: tokens,
    });
  }

  private sendMessage(message: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.error('Cannot send message - WebSocket not connected');
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error('Failed to send message', { error, message });
    }
  }

  public disconnect(): void {
    logger.info('Disconnecting WebSocket client...');
    
    this.isClosing = true;
    
    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Stop heartbeat
    this.stopHeartbeat();

    // Close WebSocket connection
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Client disconnecting');
      }
      this.ws = null;
    }

    // Clear subscribed tokens
    this.subscribedTokens.clear();
    
    // Clear message queue
    this.messageQueue = [];
  }

  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  public getSubscribedTokens(): string[] {
    return Array.from(this.subscribedTokens);
  }
}