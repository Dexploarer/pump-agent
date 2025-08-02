/**
 * MCP server for AI queries and interactions
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { logger } from '../utils/logger.js';
import { SQLiteClient } from '../database/sqlite-client.js';
import { PriceTracker } from '../data-collector/price-tracker.js';
import { QueryHandler } from './query-handler.js';
import { MCP_CONFIG } from '../utils/constants.js';

interface MCPServerConfig {
  name: string;
  version: string;
  sqliteClient: SQLiteClient;
  priceTracker: PriceTracker;
}

export class MCPServer {
  private server: Server;
  private queryHandler: QueryHandler;

  constructor(private config: MCPServerConfig) {
    this.server = new Server(
      {
        name: config.name,
        version: config.version,
      }
    );

    this.queryHandler = new QueryHandler(config.sqliteClient, config.priceTracker);
    this.setupTools();
    this.setupErrorHandling();
  }

  private setupTools(): void {
    // Define available tools
    const tools: Tool[] = [
      {
        name: 'query_token_data',
        description: 'Query token data using natural language. Ask about prices, volumes, trends, or any token-related information.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language query about token data (e.g., "What is the price of BONK?", "Show me top tokens by volume")',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_token_price',
        description: 'Get current price for specific tokens by symbol or mint address',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Token symbol (e.g., BONK, PEPE)',
            },
            mint: {
              type: 'string',
              description: 'Token mint address',
            },
          },
        },
      },
      {
        name: 'get_price_history',
        description: 'Get price history for a token over a specific time period',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Token symbol',
            },
            mint: {
              type: 'string',
              description: 'Token mint address',
            },
            timeframe: {
              type: 'string',
              enum: ['1h', '24h', '7d', '30d'],
              description: 'Time period for price history',
              default: '24h',
            },
            interval: {
              type: 'string',
              enum: ['1m', '5m', '15m', '1h', '4h', '1d'],
              description: 'Data interval',
              default: '1h',
            },
          },
        },
      },
      {
        name: 'get_volume_analysis',
        description: 'Analyze trading volume for platforms or specific tokens',
        inputSchema: {
          type: 'object',
          properties: {
            platform: {
              type: 'string',
              enum: ['pump.fun', 'letsbonk.fun'],
              description: 'Platform to analyze',
            },
            timeframe: {
              type: 'string',
              enum: ['1h', '24h', '7d'],
              description: 'Time period for analysis',
              default: '24h',
            },
            groupBy: {
              type: 'string',
              enum: ['platform', 'hour', 'day'],
              description: 'How to group the data',
              default: 'hour',
            },
          },
        },
      },
      {
        name: 'get_trending_tokens',
        description: 'Get tokens with the strongest price trends',
        inputSchema: {
          type: 'object',
          properties: {
            platform: {
              type: 'string',
              enum: ['pump.fun', 'letsbonk.fun'],
              description: 'Platform to filter by',
            },
            timeframe: {
              type: 'string',
              enum: ['1h', '24h', '7d'],
              description: 'Timeframe for trend analysis',
              default: '24h',
            },
            direction: {
              type: 'string',
              enum: ['up', 'down', 'both'],
              description: 'Trend direction',
              default: 'both',
            },
            limit: {
              type: 'number',
              description: 'Number of tokens to return',
              default: 10,
            },
          },
        },
      },
      {
        name: 'add_price_alert',
        description: 'Add a price alert for a token',
        inputSchema: {
          type: 'object',
          properties: {
            mint: {
              type: 'string',
              description: 'Token mint address',
            },
            symbol: {
              type: 'string',
              description: 'Token symbol',
            },
            alertType: {
              type: 'string',
              enum: ['threshold', 'percentage'],
              description: 'Type of alert',
            },
            condition: {
              type: 'string',
              enum: ['above', 'below'],
              description: 'Alert condition',
            },
            value: {
              type: 'number',
              description: 'Alert value (price for threshold, percentage for percentage)',
            },
          },
          required: ['mint', 'symbol', 'alertType', 'condition', 'value'],
        },
      },
      {
        name: 'get_server_stats',
        description: 'Get server statistics and health information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];

    // Register list_tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools,
    }));

    // Register call_tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        logger.info('Tool called', { toolName: name, args });

        const toolArgs = args || {};
        
        switch (name) {
          case 'query_token_data':
            return this.handleQueryTokenData(toolArgs);

          case 'get_token_price':
            return this.handleGetTokenPrice(toolArgs);

          case 'get_price_history':
            return this.handleGetPriceHistory(toolArgs);

          case 'get_volume_analysis':
            return this.handleGetVolumeAnalysis(toolArgs);

          case 'get_trending_tokens':
            return this.handleGetTrendingTokens(toolArgs);

          case 'add_price_alert':
            return this.handleAddPriceAlert(toolArgs);

          case 'get_server_stats':
            return this.handleGetServerStats(toolArgs);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        logger.error('Tool execution failed', {
          toolName: name,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    });
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      logger.error('MCP Server error', {
        error: error instanceof Error ? error.message : String(error),
      });
    };

    process.on('SIGINT', () => {
      void (async () => {
        logger.info('Received SIGINT, shutting down MCP server');
        await this.stop();
        process.exit(0);
      })();
    });

    process.on('SIGTERM', () => {
      void (async () => {
        logger.info('Received SIGTERM, shutting down MCP server');
        await this.stop();
        process.exit(0);
      })();
    });
  }

  // Helper function for safe string conversion in template literals
  private toSafeString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value.toString();
    if (value === null || value === undefined) return '';
    return JSON.stringify(value);
  }

  // Tool handlers
  private async handleQueryTokenData(args: Record<string, unknown>) {
    const query = args['query'] as string;
    
    if (!query) {
      throw new Error('Query parameter is required');
    }

    const result = await this.queryHandler.handleQuery(query);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleGetTokenPrice(args: Record<string, unknown>) {
    const { symbol, mint } = args;

    if (!symbol && !mint) {
      throw new Error('Either symbol or mint parameter is required');
    }

    // Build natural language query
    const query = symbol 
      ? `What is the current price of ${this.toSafeString(symbol)}?`
      : `What is the current price of token with mint ${this.toSafeString(mint)}?`;

    const result = await this.queryHandler.handleQuery(query);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleGetPriceHistory(args: Record<string, unknown>) {
    const { symbol, mint, timeframe = '24h', interval = '1h' } = args;

    if (!symbol && !mint) {
      throw new Error('Either symbol or mint parameter is required');
    }

    const query = symbol
      ? `Show me ${this.toSafeString(timeframe)} price history for ${this.toSafeString(symbol)} with ${this.toSafeString(interval)} intervals`
      : `Show me ${this.toSafeString(timeframe)} price history for token ${this.toSafeString(mint)} with ${this.toSafeString(interval)} intervals`;

    const result = await this.queryHandler.handleQuery(query);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleGetVolumeAnalysis(args: Record<string, unknown>) {
    const { platform, timeframe = '24h', groupBy = 'hour' } = args;

    let query = `Analyze trading volume over ${this.toSafeString(timeframe)} grouped by ${this.toSafeString(groupBy)}`;
    if (platform) {
      query += ` for ${this.toSafeString(platform)}`;
    }

    const result = await this.queryHandler.handleQuery(query);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleGetTrendingTokens(args: Record<string, unknown>) {
    const { platform, timeframe = '24h', direction = 'both', limit = 10 } = args;

    let query = `Show me top ${this.toSafeString(limit)} trending tokens with ${this.toSafeString(direction)} trends over ${this.toSafeString(timeframe)}`;
    if (platform) {
      query += ` on ${this.toSafeString(platform)}`;
    }

    const result = await this.queryHandler.handleQuery(query);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private handleAddPriceAlert(args: Record<string, unknown>) {
    const { mint, symbol, alertType, condition, value } = args;

    if (!mint || !symbol || !alertType || !condition || value === undefined) {
      throw new Error('All parameters are required for price alerts');
    }

    const alertId = this.config.priceTracker.addAlert({
      mint: mint as string,
      symbol: symbol as string,
      type: alertType as 'threshold' | 'percentage',
      condition: condition as 'above' | 'below',
      value: value as number,
      enabled: true,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            alertId,
            message: `Price alert created for ${this.toSafeString(symbol)}`,
          }, null, 2),
        },
      ],
    };
  }

  private handleGetServerStats(_args: Record<string, unknown>) {
    const trackerStats = this.config.priceTracker.getStats();
    const sqliteHealthy = this.config.sqliteClient.isHealthy;
    const bufferSize = 0; // SQLite doesn't use a buffer like InfluxDB

    const stats = {
      server: {
        name: this.config.name,
        version: this.config.version,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
      database: {
        healthy: sqliteHealthy,
        bufferSize,
      },
      priceTracker: trackerStats,
      timestamp: new Date().toISOString(),
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    logger.info('MCP Server started', {
      name: this.config.name,
      version: this.config.version,
    });
  }

  async stop(): Promise<void> {
    logger.info('Stopping MCP Server');
    await this.server.close();
  }
}

// Factory function to create and configure MCP server
export function createMCPServer(
  sqliteClient: SQLiteClient,
  priceTracker: PriceTracker
): MCPServer {
  const config: MCPServerConfig = {
    name: MCP_CONFIG.SERVER_NAME,
    version: MCP_CONFIG.SERVER_VERSION,
    sqliteClient,
    priceTracker,
  };

  return new MCPServer(config);
}