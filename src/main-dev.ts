import dotenv from 'dotenv';
import path from 'path';
import { TokenData as WSTokenData, TradeData as WSTradeData, PumpPortalClient } from './data-collector/websocket-client.js';
import { AlertEventData, TrendEventData, CleanupEventData } from './database/schema.js';
import { DataProcessor } from './data-collector/data-processor.js';
import { PriceTracker } from './data-collector/price-tracker.js';
import { InfluxClient } from './database/influx-client.js';
import { MCPServer, createMCPServer } from './mcp-agent/server.js';
import { UIServer } from './ui/server.js';
import { logger } from './utils/logger.js';
import { getEnvironmentConfig } from './utils/validators.js';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), 'config/env.example') });

class PumpAgentDev {
  private pumpPortalClient!: PumpPortalClient;
  private dataProcessor!: DataProcessor;
  private priceTracker!: PriceTracker;
  private influxClient!: InfluxClient;
  private mcpServer!: MCPServer;
  private uiServer!: UIServer;
  private config: ReturnType<typeof getEnvironmentConfig>;

  constructor() {
    this.config = getEnvironmentConfig();
    logger.info('Starting Pump Agent (Development Mode)...', {
      environment: this.config.NODE_ENV,
      maxTokens: this.config.MAX_TOKENS_TRACKED,
    });
  }

  private async initializeDatabase(): Promise<void> {
    logger.info('Initializing InfluxDB connection (Development Mode)...');
    
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

    // Test connection (will fail gracefully in development)
    try {
      await this.influxClient.connect();
      logger.info('InfluxDB connection established');
    } catch (error) {
      logger.warn('InfluxDB connection failed (expected in development)', { error });
      // Continue without database in development mode
    }
  }

  private initializeComponents(): void {
    // Initialize data processor
    this.dataProcessor = new DataProcessor(this.influxClient);

    // Initialize price tracker
    this.priceTracker = new PriceTracker(this.influxClient);

    // Initialize PumpPortal client
    this.pumpPortalClient = new PumpPortalClient({
      url: this.config.PUMPPORTAL_WSS_URL,
      reconnectDelay: this.config.PUMPPORTAL_RECONNECT_DELAY,
      maxReconnectAttempts: this.config.MAX_RECONNECT_ATTEMPTS,
      heartbeatInterval: 30000, // Default heartbeat interval
    });

    // Initialize MCP server
    this.mcpServer = createMCPServer(this.influxClient, this.priceTracker);

    // Initialize UI server
    this.uiServer = new UIServer();
  }

  private setupEventHandlers(): void {
    // Handle token data
    this.pumpPortalClient.on('tokenData', (tokenData: WSTokenData) => {
      try {
        // Convert WSTokenData to TokenData format
        const convertedTokenData = {
          mint: tokenData.mint,
          symbol: tokenData.symbol,
          name: tokenData.name,
          platform: tokenData.platform,
          platformConfidence: 1.0,
          price: tokenData.price,
          volume24h: 0, // Will be updated with trade data
          marketCap: tokenData.marketCap,
          liquidity: 0, // Will be updated
          priceChange24h: 0,
          volumeChange24h: 0,
          holders: 0,
          timestamp: new Date(tokenData.timestamp),
          uri: tokenData.uri,
        };
        
        // Process token data through data processor
        void this.dataProcessor.processMessage({
          type: 'tokenUpdate',
          data: convertedTokenData,
          timestamp: new Date(),
        });
        
        // Track token in price tracker
        void this.priceTracker.trackToken(convertedTokenData);
        
        logger.info('New token detected', {
          mint: tokenData.mint,
          symbol: tokenData.symbol,
          name: tokenData.name,
          platform: tokenData.platform,
        });
      } catch (error) {
        logger.error('Failed to process token data', { error, tokenData });
      }
    });

    // Handle trade data
    this.pumpPortalClient.on('tradeData', (tradeData: WSTradeData) => {
      try {
        // Convert WSTradeData to TradeData format
        const convertedTradeData = {
          mint: tradeData.mint,
          platform: tradeData.platform,
          type: tradeData.type,
          amount: tradeData.amount,
          price: tradeData.price,
          value: tradeData.amount * tradeData.price,
          wallet: tradeData.trader,
          signature: tradeData.txHash,
          timestamp: new Date(tradeData.timestamp),
        };
        
        // Process trade data through data processor
        void this.dataProcessor.processMessage({
          type: 'trade',
          data: convertedTradeData,
          timestamp: new Date(),
        });
        
        // Update price tracker with trade activity
        this.priceTracker.updateTradeActivity(tradeData.mint);
      } catch (error) {
        logger.error('Failed to process trade data', { error, tradeData });
      }
    });

    // Handle trend detection
    this.priceTracker.on('trendDetected', (trend: TrendEventData) => {
      logger.info('Trend detected', trend as unknown as Record<string, unknown>);
      // Could send notifications or trigger trading logic here
    });

    // Handle token cleanup
    this.priceTracker.on('tokenCleanedUp', (reason: CleanupEventData) => {
      logger.info('🧹 Token cleaned up', reason as unknown as Record<string, unknown>);
    });

    // Handle alert events
    this.priceTracker.on('alertTriggered', (alert: AlertEventData) => {
      logger.info('🚨 Alert triggered', alert as unknown as Record<string, unknown>);
    });
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      
      try {
        // Stop all components
        await this.stop();
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', { error });
        process.exit(1);
      }
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  }

  public async start(): Promise<void> {
    try {
      // Initialize database
      await this.initializeDatabase();

      // Initialize components
      this.initializeComponents();

      // Setup event handlers
      this.setupEventHandlers();

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      // Start MCP server (optional in development)
      logger.info('Initializing MCP server...');
      // MCP server can be started separately in production
      logger.info('MCP server configured (start separately in production)');

      // Start UI server
      logger.info('Starting UI server...');
      await this.uiServer.start(3001);

      // Start PumpPortal client
      logger.info('Initializing PumpPortal WebSocket client...');
      await this.pumpPortalClient.connect();

      logger.info('Pump Agent (Development) started successfully');
    } catch (error) {
      logger.error('Failed to start Pump Agent', { error });
      throw error;
    }
  }

  public async stop(): Promise<void> {
    logger.info('Stopping Pump Agent...');
    
    try {
      // Stop UI server
      await this.uiServer.stop();
      
      // Stop MCP server
      logger.info('Stopping MCP Server');
      await this.mcpServer.stop();
      
      // Stop price tracker (synchronous)
      logger.info('Stopping price tracker...');
      this.priceTracker.stop();
      
      // Disconnect WebSocket
      logger.info('Disconnecting WebSocket client...');
      this.pumpPortalClient.disconnect();
      
      // Disconnect database
      await this.influxClient.disconnect();
      
      logger.info('Pump Agent stopped successfully');
    } catch (error) {
      logger.error('Error stopping Pump Agent', { error });
    }
  }
}

// Start the application
const agent = new PumpAgentDev();
void agent.start().catch((error) => {
  logger.error('Failed to start Pump Agent', { error });
  process.exit(1);
}); 