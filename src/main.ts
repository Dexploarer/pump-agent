import dotenv from 'dotenv';
import { SimplePumpPortalClient } from './data-collector/simple-websocket-client.js';
import { TokenData, TradeData, AlertEventData, TrendEventData, CleanupEventData } from './database/schema.js';
import { DataProcessor } from './data-collector/data-processor.js';
import { PriceTracker, TrackingStats } from './data-collector/price-tracker.js';
import { InfluxClient } from './database/influx-client.js';
import { MCPServer, createMCPServer } from './mcp-agent/server.js';

import { log } from './utils/winston-logger.js';
import { getEnvironmentConfig } from './utils/validators.js';
import { TOKEN_CLEANUP_CONFIG, Platform } from './utils/constants.js';
import { WSTokenData, WSTradeData, validateWSTokenData, validateWSTradeData } from './types/websocket.js';

// Load environment variables
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../config/.env') });

class PumpAgent {
  private config: ReturnType<typeof getEnvironmentConfig>;
  private influxClient!: InfluxClient;
  private pumpPortalClient!: SimplePumpPortalClient;
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
      log.info(`Received ${signal}, starting graceful shutdown...`);
      
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        log.error('Error during shutdown', { error });
        process.exit(1);
      }
    };

    process.on('SIGINT', () => void shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => void shutdownHandler('SIGTERM'));
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      log.error('Unhandled promise rejection', { reason, promise });
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      log.error('Uncaught exception', { error });
      process.exit(1);
    });
  }

    public async start(): Promise<void> {
    try {
      log.info('Starting Pump Agent...', {
        environment: this.config.NODE_ENV,
        maxTokens: this.config.MAX_TOKENS_TRACKED,
      });
      
      // Initialize core components with consistent error handling
      await this.initializeCoreComponents();

      // Initialize MCP server
      await this.initializeMCPServer();

      // Initialize and start UI server (disabled for now to focus on data collection)
      // await this.initializeUIServer();

      log.info('Pump Agent started successfully');
      
      // Log stats periodically
      this.startStatsLogger();
    } catch (error) {
      log.error('Failed to start Pump Agent', { error });
      throw error;
    }
  }

  private async initializeCoreComponents(): Promise<void> {
    // Initialize InfluxDB client (don't fail if unavailable)
    try {
      await this.initializeDatabase();
    } catch (error) {
      log.warn('Database initialization failed, continuing without database', { error });
    }
    
    // Initialize price tracker
    this.priceTracker = new PriceTracker(this.influxClient);
    
    // Initialize data processor with database write configuration
    const enableDatabaseWrites = this.influxClient.isHealthy();
    this.dataProcessor = new DataProcessor(this.influxClient, {
      enableDatabaseWrites,
      enableValidation: true,
      batchSize: 100,
      flushInterval: 5000,
      dedupWindowMs: 1000,
    });
    
    if (!enableDatabaseWrites) {
      log.warn('Database writes disabled due to InfluxDB connection failure');
    }
    
    // Initialize PumpPortal client (don't fail if unavailable)
    try {
      await this.initializePumpPortalClient();
    } catch (error) {
      log.warn('PumpPortal initialization failed, continuing without data feed', { error });
    }
  }

  private async initializeDatabase(): Promise<void> {
    log.info('Initializing InfluxDB connection...');
    
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
      log.warn('InfluxDB connection failed, continuing without database', { error });
    }

    log.info('InfluxDB connection established');
  }

  private async initializePumpPortalClient(): Promise<void> {
    log.info('Initializing PumpPortal client (handles both pump.fun and letsbonk.fun)...');
    log.info('PumpPortal URL:', { url: this.config.PUMPPORTAL_WSS_URL });
    
    this.pumpPortalClient = new SimplePumpPortalClient();

    // Setup event handlers
    this.setupPumpPortalHandlers();

    // Start PumpPortal connection with timeout
    try {
      log.info('Attempting to connect to PumpPortal...');
      
      const connectionPromise = this.pumpPortalClient.connect();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 30000)
      );
      
      await Promise.race([connectionPromise, timeoutPromise]);
      log.info('PumpPortal client started successfully');
    } catch (error) {
      log.warn('PumpPortal connection failed, will retry in background', { error });
      // Don't throw, let the client handle reconnection
    }
  }

  private setupPumpPortalHandlers(): void {
    // Handle new tokens from both platforms
    this.pumpPortalClient.on('newToken', (wsTokenData: WSTokenData) => {
      void (async () => {
        try {
          // Validate token data
          if (!validateWSTokenData(wsTokenData)) {
            log.error('Invalid token data received', { wsTokenData });
            return;
          }
          // Validate platform type before casting
          const platform = this.validatePlatform(wsTokenData.pool);
          if (!platform) {
            log.error('Invalid platform type received', { platform: wsTokenData.pool });
            return;
          }

          // Map WebSocket token data to database schema
          const tokenData: Omit<TokenData, 'timestamp'> = {
            mint: wsTokenData.mint,
            symbol: wsTokenData.symbol,
            name: wsTokenData.name,
            platform: platform,
            platformConfidence: 1.0, // Default confidence
            price: wsTokenData.price || 0, // Default to 0 if undefined
            volume24h: 0, // Will be updated from trades
            marketCap: wsTokenData.marketCapSol, // Use marketCapSol field
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
        
        log.info('✅ New token processed and tracked', {
          mint: wsTokenData.mint,
          symbol: wsTokenData.symbol,
          platform: wsTokenData.pool,
          price: wsTokenData.price || 0,
          marketCap: wsTokenData.marketCapSol,
          subscribed: true
        });
        } catch (error) {
          log.error('Failed to process new token', { error, wsTokenData });
        }
      })();
    });

    // Handle token trades from both platforms
    this.pumpPortalClient.on('tokenTrade', (wsTradeData: WSTradeData) => {
      void (async () => {
        try {
          // Validate trade data
          if (!validateWSTradeData(wsTradeData)) {
            log.error('Invalid trade data received', { wsTradeData });
            return;
          }
          // Validate platform type before casting
          const platform = this.validatePlatform(wsTradeData.platform);
          if (!platform) {
            log.error('Invalid platform type received in trade data', { platform: wsTradeData.platform });
            return;
          }

          // Map WebSocket trade data to database schema
          const tradeData: Omit<TradeData, 'timestamp'> = {
            mint: wsTradeData.mint,
            platform: platform,
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
          
          log.debug('📊 Trade processed', {
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
            platform: platform, // Use validated platform
            platformConfidence: 1.0,
            price: wsTradeData.price,
            volume24h: wsTradeData.volumeSOL || 0,
            marketCap: wsTradeData.marketCap || 0, // Default to 0 if undefined
            liquidity: 0,
            priceChange24h: 0,
            volumeChange24h: 0,
            holders: 0,
            timestamp: new Date()
          };
          await this.priceTracker.trackToken(tokenData);
        } catch (error) {
          log.error('Failed to process trade', { error, wsTradeData });
        }
      })();
    });

    // Handle connection events
    this.pumpPortalClient.on('connected', () => {
      log.info('🚀 PumpPortal connected - tracking both pump.fun and letsbonk.fun');
      log.info('📡 WebSocket Status:', {
        url: this.config.PUMPPORTAL_WSS_URL,
        platforms: ['pump.fun', 'letsbonk.fun'],
        maxTokensTracked: this.config.MAX_TOKENS_TRACKED
      });
    });

    this.pumpPortalClient.on('disconnected', () => {
      log.warn('PumpPortal disconnected');
    });

    this.pumpPortalClient.on('error', (error: Error) => {
      log.error('PumpPortal error', { error });
    });

    // Handle price alerts
    this.priceTracker.on('alertTriggered', (data: AlertEventData) => {
      log.info('Price alert triggered', { alert: data.alert, tokenData: data.tokenData });
      // Could send notifications or trigger trading logic here
    });

    // Handle trend detection
    this.priceTracker.on('trendDetected', (trend: TrendEventData) => {
      log.info('Trend detected', trend as unknown as Record<string, unknown>);
      // Could send notifications or trigger trading logic here
    });

    // Handle token cleanup
    this.priceTracker.on('tokenCleanedUp', (reason: CleanupEventData) => {
      log.info('🧹 Token cleaned up', reason as unknown as Record<string, unknown>);
      
      // Unsubscribe from WebSocket updates
      if (reason.mint) {
        this.pumpPortalClient.unsubscribeFromTokens([reason.mint]);
      }
    });
  }

  private async initializeMCPServer(): Promise<void> {
    log.info('Initializing MCP server...');
    
    // Create MCP server with influx client and price tracker
    this.mcpServer = createMCPServer(this.influxClient, this.priceTracker);
    
    // Start in a separate process/thread if needed
    if (this.config.NODE_ENV !== 'production') {
      // In development, start MCP server directly
      await this.mcpServer.start();
      log.info('MCP server started');
    } else {
      // In production, might want to fork or use a separate process
      log.info('MCP server configured (start separately in production)');
    }
  }



  private validatePlatform(platformString: string): Platform | null {
    // Map WebSocket platform strings to Platform enum
    const platformMap: Record<string, Platform> = {
      'pump': 'pump.fun',
      'bonk': 'letsbonk.fun',
      'bonkake': 'bonkake.fun'
    };
    
    return platformMap[platformString] || null;
  }

  private startStatsLogger(): void {
    setInterval(() => {
      const processorStats = this.dataProcessor.getStats();
      const trackerStats = this.priceTracker.getStats();
      const isConnected = this.pumpPortalClient.isConnected();
      const bufferSize = this.influxClient.getBufferSize();
      const subscribedTokens = this.pumpPortalClient.getSubscribedTokens();
      
      log.info('📈 System stats', {
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
      
      log.info('🎯 Platform distribution', platformStats);
    }, 60000); // Log every minute
  }

  public getTrackingStatus(): { 
    isConnected: boolean; 
    subscribedTokens: string[]; 
    trackerStats: TrackingStats | null;
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
    log.info('Stopping Pump Agent...');

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

    log.info('Pump Agent stopped');
  }
}

// Main entry point
async function main() {
  console.log('Starting Pump Agent...');
  
  try {
    const agent = new PumpAgent();
    console.log('PumpAgent created successfully');
    
    await agent.start();
    console.log('PumpAgent started successfully');
  } catch (error) {
    console.error('Failed to start application:', error);
    log.error('Failed to start application', { error });
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

export { PumpAgent };