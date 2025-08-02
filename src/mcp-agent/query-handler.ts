/**
 * Query handling logic for natural language database queries
 */

import { logger } from '../utils/logger.js';
import { InfluxClient } from '../database/influx-client.js';
import { PriceTracker } from '../data-collector/price-tracker.js';
import { 
  TokenData, 
  QueryResponse, 
  PriceHistoryQuery,
  VolumeAnalysisQuery
} from '../database/schema.js';
import { Platform, PLATFORMS } from '../utils/constants.js';

interface QueryContext {
  intent: string;
  entities: {
    tokens?: string[];
    platforms?: Platform[];
    timeRanges?: { start: Date; end: Date }[];
    metrics?: string[];
    thresholds?: number[];
    directions?: string[];
  };
  filters: Record<string, unknown>;
  limit?: number;
  orderBy?: string;
}

interface QueryResult {
  success: boolean;
  data: unknown;
  message: string;
  queryType: string;
  processingTime: number;
  timestamp: Date;
  context?: QueryContext;
}

export class QueryHandler {
  constructor(
    private influxClient: InfluxClient,
    private priceTracker: PriceTracker
  ) {}

  async handleQuery(naturalLanguageQuery: string): Promise<QueryResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Processing natural language query', { query: naturalLanguageQuery });
      
      // Parse the natural language query
      const context = this.parseQuery(naturalLanguageQuery);
      
      // Route to appropriate handler
      const result = await this.routeQuery(context);
      
      const processingTime = Date.now() - startTime;
      
      logger.info('Query processed successfully', {
        intent: context.intent,
        processingTime,
        resultCount: Array.isArray(result.data) ? result.data.length : 1,
      });
      
      return {
        ...result,
        processingTime,
        timestamp: new Date(),
        context,
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      logger.error('Failed to process query', {
        query: naturalLanguageQuery,
        processingTime,
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        success: false,
        data: null,
        message: `Failed to process query: ${error instanceof Error ? error.message : String(error)}`,
        queryType: 'error',
        processingTime,
        timestamp: new Date(),
      };
    }
  }

  private parseQuery(query: string): QueryContext {
    const lowerQuery = query.toLowerCase();
    
    // Determine intent
    const intent = this.determineIntent(lowerQuery);
    
    // Extract entities
    const entities = this.extractEntities(lowerQuery);
    
    // Build filters
    const filters = this.buildFilters(lowerQuery, entities);
    
    return {
      intent,
      entities,
      filters,
      limit: this.extractLimit(lowerQuery),
      orderBy: this.extractOrderBy(lowerQuery),
    };
  }

  private determineIntent(query: string): string {
    // Price-related queries
    if (query.includes('price') || query.includes('cost') || query.includes('value')) {
      if (query.includes('history') || query.includes('over time') || query.includes('chart')) {
        return 'price_history';
      }
      if (query.includes('change') || query.includes('increase') || query.includes('decrease')) {
        return 'price_change';
      }
      return 'current_price';
    }
    
    // Volume-related queries
    if (query.includes('volume') || query.includes('trading') || query.includes('activity')) {
      if (query.includes('trend') || query.includes('pattern')) {
        return 'volume_trend';
      }
      return 'volume_analysis';
    }
    
    // Token-related queries
    if (query.includes('token') || query.includes('coin') || query.includes('symbol')) {
      if (query.includes('top') || query.includes('best') || query.includes('highest')) {
        return 'top_tokens';
      }
      if (query.includes('new') || query.includes('recent') || query.includes('latest')) {
        return 'new_tokens';
      }
      return 'token_info';
    }
    
    // Platform-related queries
    if (query.includes('pump.fun') || query.includes('pumpfun') || query.includes('pump')) {
      return 'platform_analysis';
    }
    if (query.includes('letsbonk') || query.includes('bonk')) {
      return 'platform_analysis';
    }
    
    // Trend analysis
    if (query.includes('trend') || query.includes('trending') || query.includes('pattern')) {
      return 'trend_analysis';
    }
    
    // Market analysis
    if (query.includes('market') || query.includes('cap') || query.includes('liquidity')) {
      return 'market_analysis';
    }
    
    // Default to general token search
    return 'token_search';
  }

  private extractEntities(query: string): QueryContext['entities'] {
    const entities: QueryContext['entities'] = {};
    
    // Extract token symbols (uppercase words)
    const tokenMatches = query.match(/\b[A-Z]{2,10}\b/g);
    if (tokenMatches) {
      entities.tokens = tokenMatches;
    }
    
    // Extract platforms
    const platforms: Platform[] = [];
    if (query.includes('pump.fun') || query.includes('pumpfun') || query.includes('pump')) {
      platforms.push(PLATFORMS.PUMP_FUN);
    }
    if (query.includes('letsbonk') || query.includes('bonk')) {
      platforms.push(PLATFORMS.LETSBONK_FUN);
    }
    if (platforms.length > 0) {
      entities.platforms = platforms;
    }
    
    // Extract time ranges
    const timeRanges = this.extractTimeRanges(query);
    if (timeRanges.length > 0) {
      entities.timeRanges = timeRanges;
    }
    
    // Extract metrics
    const metrics: string[] = [];
    if (query.includes('price')) metrics.push('price');
    if (query.includes('volume')) metrics.push('volume');
    if (query.includes('market cap') || query.includes('marketcap')) metrics.push('marketCap');
    if (query.includes('liquidity')) metrics.push('liquidity');
    if (metrics.length > 0) {
      entities.metrics = metrics;
    }
    
    // Extract thresholds
    const numberMatches = query.match(/\$?(\d+(?:\.\d+)?)/g);
    if (numberMatches) {
      entities.thresholds = numberMatches.map(match => parseFloat(match.replace('$', '')));
    }
    
    // Extract directions
    const directions: string[] = [];
    if (query.includes('up') || query.includes('increase') || query.includes('rise')) {
      directions.push('up');
    }
    if (query.includes('down') || query.includes('decrease') || query.includes('fall')) {
      directions.push('down');
    }
    if (directions.length > 0) {
      entities.directions = directions;
    }
    
    return entities;
  }

  private extractTimeRanges(query: string): { start: Date; end: Date }[] {
    const now = new Date();
    const ranges: { start: Date; end: Date }[] = [];
    
    // Handle common time expressions
    if (query.includes('today')) {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      ranges.push({ start, end: now });
    }
    
    if (query.includes('yesterday')) {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      ranges.push({ start, end });
    }
    
    if (query.includes('last hour') || query.includes('past hour')) {
      const start = new Date(now.getTime() - 60 * 60 * 1000);
      ranges.push({ start, end: now });
    }
    
    if (query.includes('last 24 hours') || query.includes('past 24 hours') || query.includes('24h')) {
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      ranges.push({ start, end: now });
    }
    
    if (query.includes('last week') || query.includes('past week') || query.includes('7 days')) {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      ranges.push({ start, end: now });
    }
    
    // Default to last 24 hours if no time range specified
    if (ranges.length === 0) {
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      ranges.push({ start, end: now });
    }
    
    return ranges;
  }

  private buildFilters(query: string, entities: QueryContext['entities']): Record<string, unknown> {
    const filters: Record<string, unknown> = {};
    
    if (entities.platforms && entities.platforms.length > 0) {
      filters['platform'] = entities.platforms;
    }
    
    if (entities.tokens && entities.tokens.length > 0) {
      filters['symbols'] = entities.tokens;
    }
    
    if (entities.timeRanges && entities.timeRanges.length > 0) {
      filters['timeRange'] = entities.timeRanges[0];
    }
    
    if (entities.thresholds && entities.thresholds.length > 0) {
      if (query.includes('above') || query.includes('greater than') || query.includes('>')) {
        filters['minPrice'] = entities.thresholds[0];
      }
      if (query.includes('below') || query.includes('less than') || query.includes('<')) {
        filters['maxPrice'] = entities.thresholds[0];
      }
    }
    
    return filters;
  }

  private extractLimit(query: string): number | undefined {
    const limitMatch = query.match(/(?:top|first|limit)\s+(\d+)/i);
    if (limitMatch && limitMatch[1]) {
      return parseInt(limitMatch[1], 10);
    }
    
    // Default limits based on intent
    if (query.includes('top') || query.includes('best')) {
      return 10;
    }
    
    return undefined;
  }

  private extractOrderBy(query: string): string | undefined {
    if (query.includes('price')) return 'price';
    if (query.includes('volume')) return 'volume';
    if (query.includes('market cap')) return 'marketCap';
    if (query.includes('time') || query.includes('recent')) return 'timestamp';
    
    return undefined;
  }

  private async routeQuery(context: QueryContext): Promise<QueryResult> {
    switch (context.intent) {
      case 'current_price':
        return await this.handleCurrentPrice(context);
      
      case 'price_history':
        return this.handlePriceHistory(context);
      
      case 'price_change':
        return this.handlePriceChange(context);
      
      case 'volume_analysis':
        return this.handleVolumeAnalysis(context);
      
      case 'volume_trend':
        return this.handleVolumeTrend(context);
      
      case 'top_tokens':
        return this.handleTopTokens(context);
      
      case 'new_tokens':
        return this.handleNewTokens(context);
      
      case 'token_info':
        return this.handleTokenInfo(context);
      
      case 'platform_analysis':
        return this.handlePlatformAnalysis(context);
      
      case 'trend_analysis':
        return this.handleTrendAnalysis(context);
      
      case 'market_analysis':
        return this.handleMarketAnalysis(context);
      
      case 'token_search':
      default:
        return this.handleTokenSearch(context);
    }
  }

  private async handleCurrentPrice(context: QueryContext): Promise<QueryResult> {
    const filters = context.filters;
    const tokens = await this.queryTokens(filters);
    
    if (!tokens.success) {
      return {
        success: false,
        data: null,
        message: `Failed to fetch current prices: ${tokens.error}`,
        queryType: 'current_price',
        processingTime: 0,
        timestamp: new Date(),
      };
    }
    
    const message = tokens.data.length > 0 
      ? `Found current prices for ${tokens.data.length} tokens`
      : 'No tokens found matching your criteria';
    
    return {
      success: true,
      data: tokens.data,
      message,
      queryType: 'current_price',
      processingTime: 0,
      timestamp: new Date(),
    };
  }

  private async handlePriceHistory(context: QueryContext): Promise<QueryResult> {
    const { tokens, timeRanges } = context.entities;
    
    if (!tokens || tokens.length === 0) {
      return {
        success: false,
        data: null,
        message: 'Please specify a token symbol for price history',
        queryType: 'price_history',
        processingTime: 0,
        timestamp: new Date(),
      };
    }
    
    const firstToken = tokens[0];
    if (!firstToken) {
      return {
        success: false,
        data: null,
        message: 'No token specified',
        queryType: 'price_history',
        processingTime: 0,
        timestamp: new Date(),
      };
    }
    
    const mint = await this.findMintBySymbol(firstToken);
    if (!mint) {
      return {
        success: false,
        data: null,
        message: `Token ${tokens[0]} not found`,
        queryType: 'price_history',
        processingTime: 0,
        timestamp: new Date(),
      };
    }
    
    const timeRange = timeRanges?.[0] || {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: new Date(),
    };
    
    const query: PriceHistoryQuery = {
      mint,
      timeRange,
      interval: '1h',
      aggregation: 'mean',
    };
    
    const result = await this.influxClient.getPriceHistory(query);
    
    return {
      success: result.success,
      data: result.data,
      message: result.success 
        ? `Retrieved price history for ${tokens[0]} (${result.data.length} data points)`
        : `Failed to get price history: ${result.error}`,
      queryType: 'price_history',
      processingTime: 0,
      timestamp: new Date(),
    };
  }

  private async handleVolumeAnalysis(context: QueryContext): Promise<QueryResult> {
    const { platforms, timeRanges } = context.entities;
    
    const query: VolumeAnalysisQuery = {
      platform: platforms?.[0],
      timeRange: timeRanges?.[0] || {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000),
        end: new Date(),
      },
      groupBy: 'hour',
      topN: context.limit,
    };
    
    const result = await this.influxClient.getVolumeAnalysis(query);
    
    return {
      success: result.success,
      data: result.data,
      message: result.success 
        ? `Retrieved volume analysis (${result.data.length} data points)`
        : `Failed to get volume analysis: ${result.error}`,
      queryType: 'volume_analysis',
      processingTime: 0,
      timestamp: new Date(),
    };
  }

  private async handleTopTokens(context: QueryContext): Promise<QueryResult> {
    const filters = {
      ...context.filters,
      limit: context.limit || 10,
      orderBy: context.orderBy || 'volume',
      orderDirection: 'desc' as const,
    };
    
    const result = await this.queryTokens(filters);
    
    return {
      success: result.success,
      data: result.data,
      message: result.success 
        ? `Found top ${result.data.length} tokens`
        : `Failed to get top tokens: ${result.error}`,
      queryType: 'top_tokens',
      processingTime: 0,
      timestamp: new Date(),
    };
  }

  private handleTrendAnalysis(context: QueryContext): QueryResult {
    // Get trends from price tracker
    const trends = this.priceTracker.getAllTrends();
    
    // Filter trends based on context
    let filteredTrends = trends;
    
    if (context.entities.platforms) {
      filteredTrends = filteredTrends.filter(trend => 
        context.entities.platforms!.includes(trend.platform)
      );
    }
    
    if (context.entities.directions) {
      filteredTrends = filteredTrends.filter(trend => 
        context.entities.directions!.includes(trend.direction)
      );
    }
    
    // Sort by change percentage (descending)
    filteredTrends.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
    
    // Apply limit
    if (context.limit) {
      filteredTrends = filteredTrends.slice(0, context.limit);
    }
    
    return {
      success: true,
      data: filteredTrends,
      message: `Found ${filteredTrends.length} trending tokens`,
      queryType: 'trend_analysis',
      processingTime: 0,
      timestamp: new Date(),
    };
  }

  // Helper methods
  private async queryTokens(filters: Record<string, unknown>): Promise<QueryResponse<TokenData>> {
    return await this.influxClient.queryTokenData(
      undefined, // mint
      filters['platform'] as string,
      filters['timeRange'] as { start: Date; end: Date },
      filters['limit'] as number || 1000
    );
  }

  private async findMintBySymbol(symbol: string): Promise<string | null> {
    const result = await this.influxClient.queryTokenData();
    
    if (!result.success) {
      return null;
    }
    
    const token = result.data.find(t => 
      t.symbol.toLowerCase() === symbol.toLowerCase()
    );
    
    return token?.mint || null;
  }

  // Placeholder implementations for remaining handlers
  private handlePriceChange(_context: QueryContext): QueryResult {
    return { success: true, data: [], message: 'Price change analysis not yet implemented', queryType: 'price_change', processingTime: 0, timestamp: new Date() };
  }

  private handleVolumeTrend(_context: QueryContext): QueryResult {
    return { success: true, data: [], message: 'Volume trend analysis not yet implemented', queryType: 'volume_trend', processingTime: 0, timestamp: new Date() };
  }

  private handleNewTokens(_context: QueryContext): QueryResult {
    return { success: true, data: [], message: 'New tokens query not yet implemented', queryType: 'new_tokens', processingTime: 0, timestamp: new Date() };
  }

  private handleTokenInfo(_context: QueryContext): QueryResult {
    return { success: true, data: [], message: 'Token info query not yet implemented', queryType: 'token_info', processingTime: 0, timestamp: new Date() };
  }

  private handlePlatformAnalysis(_context: QueryContext): QueryResult {
    return { success: true, data: [], message: 'Platform analysis not yet implemented', queryType: 'platform_analysis', processingTime: 0, timestamp: new Date() };
  }

  private handleMarketAnalysis(_context: QueryContext): QueryResult {
    return { success: true, data: [], message: 'Market analysis not yet implemented', queryType: 'market_analysis', processingTime: 0, timestamp: new Date() };
  }

  private handleTokenSearch(_context: QueryContext): QueryResult {
    return { success: true, data: [], message: 'Token search not yet implemented', queryType: 'token_search', processingTime: 0, timestamp: new Date() };
  }
}