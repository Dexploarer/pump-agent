import dotenv from 'dotenv';
import path from 'path';
import { TokenData, TradeData, PumpPortalClient } from './data-collector/websocket-client';
import { DataProcessor } from './data-collector/data-processor';
import { PriceTracker } from './data-collector/price-tracker';
import { InfluxClient } from './database/influx-client';
// import { MCPServer } from './mcp-agent/server';
import { QueryHandler } from './mcp-agent/query-handler';
import { logger } from './utils/logger';
import { getEnvironmentConfig } from './utils/validators';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../config/.env') });

class PumpAgent {
  private config: ReturnType<typeof getEnvironmentConfig>;
  private influxClient!: InfluxClient;
  private pumpPortalClient!: PumpPortalClient;
  private dataProcessor!: DataProcessor;
  private priceTracker!: PriceTracker;
  // private mcpServer: any;
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
      this.priceTracker = new PriceTracker(this.config.MAX_TOKENS_TRACKED);
      
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
    this.pumpPortalClient.on('newToken', (tokenData: TokenData) => {
      void (async () => {
        try {
          await this.dataProcessor.processNewToken(tokenData);
        
        // Update price tracker
        this.priceTracker.updatePrice(
          tokenData.mint,
          tokenData.symbol,
          tokenData.priceSOL,
          tokenData.priceSOL * 100, // Mock USD price
          tokenData.marketCap
        );
        
        // Subscribe to token trades
        this.pumpPortalClient.subscribeToTokens([tokenData.mint]);
        
        logger.info('New token processed', {
          mint: tokenData.mint,
          symbol: tokenData.symbol,
          platform: tokenData.platform
        });
        } catch (error) {
          logger.error('Failed to process new token', { error, tokenData });
        }
      })();
    });

    // Handle token trades from both platforms
    this.pumpPortalClient.on('tokenTrade', (tradeData: TradeData) => {
      void (async () => {
        try {
          await this.dataProcessor.processTrade(tradeData);
          
          // Update price tracker
          this.priceTracker.updatePrice(
            tradeData.mint,
            '', // Symbol would be in cache
            tradeData.priceSOL,
            tradeData.priceSOL * 100, // Mock USD price
            tradeData.marketCap,
            tradeData.volumeSOL
          );
        } catch (error) {
          logger.error('Failed to process trade', { error, tradeData });
        }
      })();
    });

    // Handle connection events
    this.pumpPortalClient.on('connected', () => {
      logger.info('PumpPortal connected - tracking both pump.fun and letsbonk.fun');
    });

    this.pumpPortalClient.on('disconnected', () => {
      logger.warn('PumpPortal disconnected');
    });

    this.pumpPortalClient.on('error', (error: Error) => {
      logger.error('PumpPortal error', { error });
    });

    // Handle price alerts
    this.priceTracker.on('priceAlert', (alert) => {
      logger.info('Price alert', alert);
      // Could send notifications or trigger trading logic here
    });

    this.priceTracker.on('volumeAlert', (alert) => {
      logger.info('Volume alert', alert);
      // Could send notifications or trigger trading logic here
    });
  }

  private async initializeMCPServer(): Promise<void> {
    logger.info('Initializing MCP server...');
    
    const queryHandler = new QueryHandler(this.influxClient);
    this.mcpServer = await createMCPServer();
    
    // Start in a separate process/thread if needed
    if (this.config.NODE_ENV !== 'production') {
      // In development, start MCP server directly
      // await this.mcpServer.start();
      logger.info('MCP server started');
    } else {
      // In production, might want to fork or use a separate process
      logger.info('MCP server configured (start separately in production)');
    }
  }

  private startStatsLogger(): void {
    setInterval(() => {
      const processorStats = this.dataProcessor.getProcessingStats();
      const trackerStats = this.priceTracker.getStats();
      const isConnected = this.pumpPortalClient.isConnected();
      const bufferSize = this.influxClient.getBufferSize();
      
      logger.info('System stats', {
        pumpPortal: {
          connected: isConnected,
          subscribedTokens: this.pumpPortalClient.getSubscribedTokens().length,
        },
        processor: processorStats,
        tracker: trackerStats,
        database: {
          writeBufferSize: bufferSize,
        },
      });
    }, 60000); // Log every minute
  }

  public async stop(): Promise<void> {
    logger.info('Stopping Pump Agent...');

    // Stop PumpPortal client
    if (this.pumpPortalClient) {
      this.pumpPortalClient.disconnect();
    }

    // Stop data processor
    if (this.dataProcessor) {
      await this.dataProcessor.cleanup();
    }

    // Stop price tracker
    if (this.priceTracker) {
      this.priceTracker.cleanup();
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