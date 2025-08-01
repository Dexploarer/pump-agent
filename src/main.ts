import dotenv from 'dotenv';
import path from 'path';
import { TokenData as WSTokenData, TradeData as WSTradeData, PumpPortalClient } from './data-collector/websocket-client';
import { TokenData, TradeData } from './database/schema';
import { DataProcessor } from './data-collector/data-processor';
import { PriceTracker } from './data-collector/price-tracker';
import { InfluxClient } from './database/influx-client';
import { MCPServer, createMCPServer } from './mcp-agent/server';
import { PriceAlert } from './data-collector/price-tracker';
import { logger } from './utils/logger';
import { getEnvironmentConfig } from './utils/validators';
import { TOKEN_CLEANUP_CONFIG } from './utils/constants';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../config/.env') });

class PumpAgent {
  private config: ReturnType<typeof getEnvironmentConfig>;
  private influxClient!: InfluxClient;
  private pumpPortalClient!: PumpPortalClient;
  private dataProcessor!: DataProcessor;
  private priceTracker!: PriceTracker;
  private mcpServer!: MCPServer;
  private isShuttingDown = false;

  constructor() {
    // Validate environment configuration
    this.config = getEnvironmentConfig();
    
    // Setup graceful shutdown
    this.setupShutdownHandlers();
  }

  private setupShutdownHandlers(): void {
    const shutdownHandler = async (signal: string) => {
      if (this.isShuttingDown) return;
      
      this.isShuttingDown = true;
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', { error });
        process.exit(1);
      }
    };

    process.on('SIGINT', () => void shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => void shutdownHandler('SIGTERM'));
  }

  public async start(): Promise<void> {
    try {
      logger.info('Starting Pump Agent...', {
        environment: this.config.NODE_ENV,
        maxTokens: this.config.MAX_TOKENS_TRACKED,
      });

      // Initialize InfluxDB client
      await this.initializeDatabase();

      // Initialize price tracker
      this.priceTracker = new PriceTracker(this.influxClient);
      
      // Initialize data processor
      this.dataProcessor = new DataProcessor(this.influxClient);
      
      // Initialize PumpPortal client (handles both pump.fun and letsbonk.fun)
      await this.initializePumpPortalClient();

      // Initialize MCP server
      await this.initializeMCPServer();

      logger.info('Pump Agent started successfully');
      
      // Log stats periodically
      this.startStatsLogger();
    } catch (error) {
      logger.error('Failed to start Pump Agent', { error });
      throw error;
    }
  }

  private async initializeDatabase(): Promise<void> {
    logger.info('Initializing InfluxDB connection...');
    
    this.influxClient = new InfluxClient(
      {
        host: this.config.INFLUXDB_HOST,
        token: this.config.INFLUXDB_TOKEN,
        database: this.config.INFLUXDB_DATABASE,
        organization: this.config.INFLUXDB_ORGANIZATION,
      },
      this.config.BATCH_SIZE,
      this.config.WRITE_INTERVAL_MS
    );

    // Test connection
    try {
      await this.influxClient.connect();
    } catch (error) {
      logger.warn('InfluxDB connection failed, continuing without database', { error });
    }

    logger.info('InfluxDB connection established');
  }

  private async initializePumpPortalClient(): Promise<void> {
    logger.info('Initializing PumpPortal client (handles both pump.fun and letsbonk.fun)...');
    
    this.pumpPortalClient = new PumpPortalClient({
      url: this.config.PUMPPORTAL_WSS_URL,
      reconnectDelay: this.config.PUMPPORTAL_RECONNECT_DELAY,
      maxReconnectAttempts: this.config.MAX_RECONNECT_ATTEMPTS,
      heartbeatInterval: 30000, // 30 seconds
    });

    // Setup event handlers
    this.setupPumpPortalHandlers();

    // Start PumpPortal connection
    await this.pumpPortalClient.connect();
    
    logger.info('PumpPortal client started successfully');
  }

  private setupPumpPortalHandlers(): void {
    // Handle new tokens from both platforms
    this.pumpPortalClient.on('newToken', (wsTokenData: WSTokenData) => {
      void (async () => {
        try {
          // Map WebSocket token data to database schema
          const tokenData: Omit<TokenData, 'timestamp'> = {
            mint: wsTokenData.mint,
            symbol: wsTokenData.symbol,
            name: wsTokenData.name,
            platform: wsTokenData.platform,
            platformConfidence: 1.0, // Default confidence
            price: wsTokenData.price,
            volume24h: 0, // Will be updated from trades
            marketCap: wsTokenData.marketCap,
            liquidity: 0, // Will be calculated
            priceChange24h: 0, // Will be calculated
            volumeChange24h: 0, // Will be calculated
            holders: 0, // Will be updated
            uri: wsTokenData.uri,
          };
          
          // Process as a token update message
          await this.dataProcessor.processMessage({
            type: 'tokenUpdate',
            data: tokenData,
            timestamp: new Date()
          });
        
        // Update price tracker
        await this.priceTracker.trackToken({
          ...tokenData,
          timestamp: new Date()
        });
        
        // Subscribe to token trades
        this.pumpPortalClient.subscribeToTokens([wsTokenData.mint]);
        
        logger.info('✅ New token processed and tracked', {
          mint: wsTokenData.mint,
          symbol: wsTokenData.symbol,
          platform: wsTokenData.platform,
          price: wsTokenData.price,
          marketCap: wsTokenData.marketCap,
          subscribed: true
        });
        } catch (error) {
          logger.error('Failed to process new token', { error, wsTokenData });
        }
      })();
    });

    // Handle token trades from both platforms
    this.pumpPortalClient.on('tokenTrade', (wsTradeData: WSTradeData) => {
      void (async () => {
        try {
          // Map WebSocket trade data to database schema
          const tradeData: Omit<TradeData, 'timestamp'> = {
            mint: wsTradeData.mint,
            platform: wsTradeData.platform,
            type: wsTradeData.type,
            amount: wsTradeData.amount,
            price: wsTradeData.price,
            value: wsTradeData.volumeSOL, // volumeSOL represents the value of the trade
            wallet: wsTradeData.trader,
            signature: wsTradeData.txHash,
          };
          
          // Process as a trade message
          await this.dataProcessor.processMessage({
            type: 'trade',
            data: tradeData,
            timestamp: new Date()
          });
          
          logger.debug('📊 Trade processed', {
            mint: wsTradeData.mint,
            platform: wsTradeData.platform,
            type: wsTradeData.type,
            price: wsTradeData.price,
            volume: wsTradeData.volumeSOL
          });
          
          // Update last activity in price tracker
          this.priceTracker.updateTradeActivity(wsTradeData.mint);
          
          // Update price tracker with trade data
          const tokenData: TokenData = {
            mint: wsTradeData.mint,
            symbol: '', // Symbol not available in trade data
            name: '',
            platform: wsTradeData.platform,
            platformConfidence: 1.0,
            price: wsTradeData.price,
            volume24h: wsTradeData.volumeSOL || 0,
            marketCap: wsTradeData.marketCap,
            liquidity: 0,
            priceChange24h: 0,
            volumeChange24h: 0,
            holders: 0,
            timestamp: new Date()
          };
          await this.priceTracker.trackToken(tokenData);
        } catch (error) {
          logger.error('Failed to process trade', { error, wsTradeData });
        }
      })();
    });

    // Handle connection events
    this.pumpPortalClient.on('connected', () => {
      logger.info('🚀 PumpPortal connected - tracking both pump.fun and letsbonk.fun');
      logger.info('📡 WebSocket Status:', {
        url: this.config.PUMPPORTAL_WSS_URL,
        platforms: ['pump.fun', 'letsbonk.fun'],
        maxTokensTracked: this.config.MAX_TOKENS_TRACKED
      });
    });

    this.pumpPortalClient.on('disconnected', () => {
      logger.warn('PumpPortal disconnected');
    });

    this.pumpPortalClient.on('error', (error: Error) => {
      logger.error('PumpPortal error', { error });
    });

    // Handle price alerts
    this.priceTracker.on('alertTriggered', (data: { alert: PriceAlert; tokenData: any }) => {
      logger.info('Price alert triggered', { alert: data.alert, tokenData: data.tokenData });
      // Could send notifications or trigger trading logic here
    });

    // Handle trend detection
    this.priceTracker.on('trendDetected', (trend: any) => {
      logger.info('Trend detected', trend);
      // Could send notifications or trigger trading logic here
    });

    // Handle token cleanup
    this.priceTracker.on('tokenCleanedUp', (reason: any) => {
      logger.info('🧹 Token cleaned up', reason);
      
      // Unsubscribe from WebSocket updates
      if (reason.mint) {
        this.pumpPortalClient.unsubscribeFromTokens([reason.mint]);
      }
    });
  }

  private async initializeMCPServer(): Promise<void> {
    logger.info('Initializing MCP server...');
    
    // Create MCP server with influx client and price tracker
    this.mcpServer = createMCPServer(this.influxClient, this.priceTracker);
    
    // Start in a separate process/thread if needed
    if (this.config.NODE_ENV !== 'production') {
      // In development, start MCP server directly
      await this.mcpServer.start();
      logger.info('MCP server started');
    } else {
      // In production, might want to fork or use a separate process
      logger.info('MCP server configured (start separately in production)');
    }
  }

  private startStatsLogger(): void {
    setInterval(() => {
      const processorStats = this.dataProcessor.getStats();
      const trackerStats = this.priceTracker.getStats();
      const isConnected = this.pumpPortalClient.isConnected();
      const bufferSize = this.influxClient.getBufferSize();
      const subscribedTokens = this.pumpPortalClient.getSubscribedTokens();
      
      logger.info('📈 System stats', {
        pumpPortal: {
          connected: isConnected,
          subscribedTokensCount: subscribedTokens.length,
          subscribedTokens: subscribedTokens.slice(0, 5), // Show first 5 tokens
        },
        processor: processorStats,
        tracker: {
          ...trackerStats,
          topTokensByVolume: trackerStats.topTokensByVolume?.slice(0, 3), // Top 3 tokens
          cleanup: {
            tokensCleanedUp: trackerStats.tokensCleanedUp,
            lastCleanupTime: trackerStats.lastCleanupTime,
            cleanupEnabled: TOKEN_CLEANUP_CONFIG.CLEANUP_ENABLED
          }
        },
        database: {
          writeBufferSize: bufferSize,
        },
      });
      
      // Additional platform-specific stats
      const platformStats: Record<string, number> = {};
      for (const token of this.priceTracker.getAllTokens()) {
        const platform = token.platform || 'unknown';
        platformStats[platform] = (platformStats[platform] || 0) + 1;
      }
      
      logger.info('🎯 Platform distribution', platformStats);
    }, 60000); // Log every minute
  }

  public getTrackingStatus(): { 
    isConnected: boolean; 
    subscribedTokens: string[]; 
    trackerStats: any;
    platformDistribution: Record<string, number>;
  } {
    const subscribedTokens = this.pumpPortalClient?.getSubscribedTokens() || [];
    const trackerStats = this.priceTracker?.getStats() || null;
    
    // Calculate platform distribution
    const platformDistribution: Record<string, number> = {};
    if (this.priceTracker) {
      for (const token of this.priceTracker.getAllTokens()) {
        const platform = token.platform || 'unknown';
        platformDistribution[platform] = (platformDistribution[platform] || 0) + 1;
      }
    }
    
    return {
      isConnected: this.pumpPortalClient?.isConnected() || false,
      subscribedTokens,
      trackerStats,
      platformDistribution
    };
  }

  public async stop(): Promise<void> {
    logger.info('Stopping Pump Agent...');

    // Stop PumpPortal client
    if (this.pumpPortalClient) {
      this.pumpPortalClient.disconnect();
    }

    // Stop data processor
    if (this.dataProcessor) {
      await this.dataProcessor.stop();
    }

    // Stop price tracker
    if (this.priceTracker) {
      this.priceTracker.stop();
    }

    // Stop MCP server
    if (this.mcpServer) {
      await this.mcpServer.stop();
    }

    // Close database connection
    if (this.influxClient) {
      await this.influxClient.close();
    }

    logger.info('Pump Agent stopped');
  }
}

// Main entry point
async function main() {
  const agent = new PumpAgent();
  
  try {
    await agent.start();
  } catch (error) {
    logger.error('Failed to start application', { error });
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { PumpAgent };