import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { log } from '../utils/winston-logger.js';
import { z } from 'zod';
import { getMintOrigin } from '../utils/platform-detection-buffer.js';

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
    
    // Set max listeners to prevent memory leak warnings
    this.setMaxListeners(20);
  }

  public async connect(): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      log.warn('WebSocket is already connected or connecting');
      return;
    }

    this.isConnecting = true;
    this.isClosing = false;

    try {
      log.info('Connecting to PumpPortal WebSocket...', { url: this.options.url });
      
      this.ws = new WebSocket(this.options.url, {
        headers: {
          'User-Agent': 'PumpAgent/1.0',
          'Origin': 'https://pumpportal.fun'
        }
      });
      
      this.ws.on('open', this.handleOpen.bind(this));
      this.ws.on('message', this.handleMessage.bind(this));
      this.ws.on('error', this.handleError.bind(this));
      this.ws.on('close', this.handleClose.bind(this));
      this.ws.on('ping', this.handlePing.bind(this));

      // Simple connection wait - just wait for the 'open' event
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 15000);

        this.ws!.once('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.ws!.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      log.info('WebSocket connection established successfully');

    } catch (error) {
      this.isConnecting = false;
      throw error;
    }
  }

  private handleOpen(): void {
    log.info('WebSocket connection established');
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

    log.info('PumpPortal connection successful - ready to collect data');
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const dataStr = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
      const message: unknown = JSON.parse(dataStr);
      
      // Log server responses for debugging
      if (typeof message === 'object' && message !== null) {
        const msg = message as Record<string, unknown>;
        if (msg['message'] || msg['errors']) {
          log.info('PumpPortal server response:', { message: msg['message'], errors: msg['errors'] });
        }
      }
      
      // Add to queue for processing
      this.messageQueue.push(message);
      
      // Process queue if not already processing
      if (!this.isProcessingQueue) {
        void this.processMessageQueue();
      }
    } catch (error) {
      log.error('Failed to parse WebSocket message', { error });
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
          log.info('Subscription message', { message: subMessage.message });
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
            log.debug('Unknown txType', { txType, message });
          }
        } else {
          log.debug('Unknown message format', { message });
        }
      } catch (error) {
        log.error('Failed to process message', { error });
      }
    }

    this.isProcessingQueue = false;
  }

  private handleNewTokenMessage(message: z.infer<typeof NewTokenMessageSchema>): void {
    // Process platform detection asynchronously to avoid blocking
    void this.processNewTokenWithPlatformDetection(message);
  }

  private processNewTokenWithPlatformDetection(message: z.infer<typeof NewTokenMessageSchema>): void {
    try {
      // Detect platform using buffered RPC-based detection
      const platformResult = getMintOrigin(message.mint);
      
      // Convert to our TokenData format
      const tokenData: TokenData = {
        mint: message.mint,
        symbol: message.symbol,
        name: message.name,
        price: message.marketCapSol / 1000, // Approximate price
        priceSOL: message.marketCapSol / 1000,
        marketCap: message.marketCapSol * 100, // Approximate USD market cap (SOL at $100)
        supply: 1000000000, // Default supply
        timestamp: Date.now(),
        platform: platformResult.platform,
        creator: message.traderPublicKey,
        uri: message.uri,
      };

      this.emit('tokenData', tokenData);
    } catch (error) {
      log.error('Failed to process token data', { error, message });
    }
  }

  private handleTradeMessage(message: z.infer<typeof TradeMessageSchema>): void {
    // Process platform detection synchronously to avoid blocking
    const tradeData = this.processTradeWithPlatformDetection(message);
    this.emit('tradeData', tradeData);
  }

  private processTradeWithPlatformDetection(message: z.infer<typeof TradeMessageSchema>): TradeData {
    try {
      // Detect platform using buffered RPC-based detection
      const platformResult = getMintOrigin(message.mint);
      
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
        platform: platformResult.platform,
      };

      return tradeData;
    } catch (error) {
      log.error('Failed to process trade data', { error, message });
      throw error; // Re-throw to be caught by handleTradeMessage
    }
  }

  private handleError(error: Error): void {
    log.error('WebSocket error', { error: error.message });
    this.emit('error', error);
  }

  private handleClose(code: number, reason: Buffer): void {
    log.info('WebSocket connection closed', { code, reason: reason.toString() });
    
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
      log.error('Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      60000 // Max 1 minute delay
    );

    log.info(`Scheduling reconnection attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts}`, { delay });

    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((error: unknown) => {
        log.error('Reconnection failed', { error });
      });
    }, delay);
  }

  private subscribeToEvents(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Cannot subscribe - WebSocket not connected');
      return;
    }

    log.info('Subscribing to PumpPortal events...');
    
    // Send subscription messages with delays to avoid overwhelming the server
    setTimeout(() => {
      this.sendMessage({
        method: 'subscribeNewToken',
      });
      log.info('Sent subscribeNewToken message');
    }, 500);

    setTimeout(() => {
      this.sendMessage({
        method: 'subscribeTokenTrade',
      });
      log.info('Sent subscribeTokenTrade message');
    }, 1000);

    setTimeout(() => {
      this.sendMessage({
        method: 'subscribeMigration',
      });
      log.info('Sent subscribeMigration message');
    }, 1500);

    log.info('Subscription messages scheduled to be sent to PumpPortal');
  }

  public subscribeToTokens(tokens: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Cannot subscribe to tokens - WebSocket not connected');
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
      log.warn('Cannot unsubscribe from tokens - WebSocket not connected');
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
      log.error('Cannot send message - WebSocket not connected');
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      log.error('Failed to send message', { error, message });
    }
  }

  public disconnect(): void {
    log.info('Disconnecting WebSocket client...');
    
    this.isClosing = true;
    
    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Stop heartbeat
    this.stopHeartbeat();

    // Remove all event listeners to prevent memory leaks
    this.removeAllListeners();

    // Close WebSocket connection
    if (this.ws) {
      this.ws.removeAllListeners();
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