/**
 * Price tracking functionality with trend analysis
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { SQLiteClient } from '../database/sqlite-client.js';
import { 
  TokenData, 
  PricePoint, 
  AggregatedData,
  PriceHistoryQuery,
  EmergencyOverrideConfig 
} from '../database/schema.js';
import { Platform, TOKEN_CLEANUP_CONFIG } from '../utils/constants.js';
import { CleanupEvent, CleanupMetrics } from '../database/schema.js';

export interface PriceAlert {
  id: string;
  mint: string;
  symbol: string;
  type: 'threshold' | 'percentage';
  condition: 'above' | 'below';
  value: number;
  enabled: boolean;
  triggered: boolean;
  createdAt: Date;
  triggeredAt?: Date;
}

interface PriceTrend {
  mint: string;
  symbol: string;
  platform: Platform;
  timeframe: '1h' | '24h' | '7d';
  direction: 'up' | 'down' | 'sideways';
  strength: 'weak' | 'moderate' | 'strong';
  change: number;
  changePercent: number;
  confidence: number;
  startPrice: number;
  endPrice: number;
  volume: number;
  timestamp: Date;
}

interface TokenHealth {
  mint: string;
  lastTradeTime: Date;
  firstSeenTime: Date;
  consecutiveZeroVolumePeriods: number;
  peakPrice: number;
  peakVolume24h: number;
  currentLiquidity: number;
  isWhitelisted: boolean;
  isBeingEvaluated: boolean;
}

interface CleanupTransaction {
  id: string;
  startTime: Date;
  candidatesCount: number;
  confirmedCount: number;
  completedCount: number;
  status: 'evaluating' | 'confirming' | 'executing' | 'completed' | 'failed';
}

export interface TrackingStats {
  totalTokensTracked: number;
  pricePointsProcessed: number;
  alertsTriggered: number;
  trendsDetected: number;
  lastUpdate: Date | null;
  topTokensByVolume?: Array<{ mint: string; symbol: string; volume: number; platform: string }>;
  tokensCleanedUp: number;
  lastCleanupTime: Date | null;
}

interface CleanupReason {
  mint: string;
  symbol: string;
  platform: Platform;
  reason: 'rugged' | 'inactive' | 'low_volume';
  details: string;
}

export class PriceTracker extends EventEmitter {
  private trackedTokens = new Map<string, TokenData>();
  private priceHistory = new Map<string, PricePoint[]>();
  private alerts = new Map<string, PriceAlert>();
  private trends = new Map<string, PriceTrend>();
  private tokenHealth = new Map<string, TokenHealth>();
  private lastActivityMap = new Map<string, Date>();
  private stats: TrackingStats;
  private analysisTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  
  // Race condition prevention
  private cleanupInProgress = false;
  private currentTransaction: CleanupTransaction | null = null;
  private tokensBeingEvaluated = new Set<string>();
  
  // Emergency controls
  private emergencyStop = false;
  private cleanupPaused = false;
  private emergencyOverrides = {
    disableAllCleanup: false,
    forceMinimumTokens: false,
    emergencyWhitelist: new Set<string>(),
  };
  private emergencyConfigOverride: EmergencyOverrideConfig | null = null;
  
  // Performance indices for faster cleanup
  private inactiveTokensIndex = new Set<string>();
  private lowVolumeTokensIndex = new Set<string>();
  private ruggedCandidatesIndex = new Set<string>();
  private recentlyActiveIndex = new Set<string>();
  private newTokensIndex = new Set<string>(); // Tokens in grace period

  constructor(
    private sqliteClient: SQLiteClient,
    private analysisInterval = 60000 // 1 minute
  ) {
    super();
    
    // Validate configuration on startup
    this.validateConfiguration();
    
    this.stats = {
      totalTokensTracked: 0,
      pricePointsProcessed: 0,
      alertsTriggered: 0,
      trendsDetected: 0,
      lastUpdate: null,
      tokensCleanedUp: 0,
      lastCleanupTime: null,
    };

    this.startAnalysis();
    this.startCleanupProcess();
  }

  private validateConfiguration(): void {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate cleanup configuration
    if (TOKEN_CLEANUP_CONFIG.INACTIVITY_THRESHOLD_MS <= 0) {
      errors.push('INACTIVITY_THRESHOLD_MS must be positive');
    }
    if (TOKEN_CLEANUP_CONFIG.INACTIVITY_THRESHOLD_MS < 60000) {
      warnings.push('INACTIVITY_THRESHOLD_MS is very low (< 1 minute), may cause excessive cleanup');
    }

    if (TOKEN_CLEANUP_CONFIG.MIN_VOLUME_24H_SOL < 0) {
      errors.push('MIN_VOLUME_24H_SOL must be non-negative');
    }

    if (TOKEN_CLEANUP_CONFIG.CONSECUTIVE_ZERO_VOLUME_PERIODS <= 0) {
      errors.push('CONSECUTIVE_ZERO_VOLUME_PERIODS must be positive');
    }

    if (TOKEN_CLEANUP_CONFIG.RUG_DETECTION_PRICE_DROP <= 0 || TOKEN_CLEANUP_CONFIG.RUG_DETECTION_PRICE_DROP > 1) {
      errors.push('RUG_DETECTION_PRICE_DROP must be between 0 and 1');
    }

    if (TOKEN_CLEANUP_CONFIG.RUG_DETECTION_LIQUIDITY_THRESHOLD_USD < 0) {
      errors.push('RUG_DETECTION_LIQUIDITY_THRESHOLD_USD must be non-negative');
    }

    if (TOKEN_CLEANUP_CONFIG.RUG_DETECTION_VOLUME_DROP <= 0 || TOKEN_CLEANUP_CONFIG.RUG_DETECTION_VOLUME_DROP > 1) {
      errors.push('RUG_DETECTION_VOLUME_DROP must be between 0 and 1');
    }

    if (TOKEN_CLEANUP_CONFIG.CLEANUP_INTERVAL_MS <= 0) {
      errors.push('CLEANUP_INTERVAL_MS must be positive');
    }
    if (TOKEN_CLEANUP_CONFIG.CLEANUP_INTERVAL_MS < 60000) {
      warnings.push('CLEANUP_INTERVAL_MS is very low (< 1 minute), may cause performance issues');
    }

    if (TOKEN_CLEANUP_CONFIG.MAX_CLEANUP_PERCENTAGE <= 0 || TOKEN_CLEANUP_CONFIG.MAX_CLEANUP_PERCENTAGE > 1) {
      errors.push('MAX_CLEANUP_PERCENTAGE must be between 0 and 1');
    }
    if (TOKEN_CLEANUP_CONFIG.MAX_CLEANUP_PERCENTAGE > 0.5) {
      warnings.push('MAX_CLEANUP_PERCENTAGE is very high (> 50%), may cause aggressive cleanup');
    }

    if (TOKEN_CLEANUP_CONFIG.MIN_TOKENS_TO_KEEP <= 0) {
      errors.push('MIN_TOKENS_TO_KEEP must be positive');
    }

    if (TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS <= 0) {
      errors.push('NEW_TOKEN_GRACE_PERIOD_MS must be positive');
    }
    if (TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS < 300000) {
      warnings.push('NEW_TOKEN_GRACE_PERIOD_MS is very low (< 5 minutes), new tokens may be cleaned too quickly');
    }

    // Validate analysis interval
    if (this.analysisInterval <= 0) {
      errors.push('Analysis interval must be positive');
    }
    if (this.analysisInterval < 10000) {
      warnings.push('Analysis interval is very low (< 10 seconds), may cause performance issues');
    }

    // Validate interdependent settings
    if (TOKEN_CLEANUP_CONFIG.CLEANUP_INTERVAL_MS < this.analysisInterval) {
      warnings.push('CLEANUP_INTERVAL_MS is shorter than analysis interval, cleanup may run more frequently than analysis');
    }

    if (TOKEN_CLEANUP_CONFIG.INACTIVITY_THRESHOLD_MS < TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS) {
      warnings.push('INACTIVITY_THRESHOLD_MS is shorter than NEW_TOKEN_GRACE_PERIOD_MS, tokens may never be considered inactive');
    }

    // Log validation results
    if (errors.length > 0) {
      logger.error('Invalid configuration detected', { errors });
      throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }

    if (warnings.length > 0) {
      logger.warn('Configuration warnings', { warnings });
    }

    if (errors.length === 0 && warnings.length === 0) {
      logger.info('Configuration validation passed', {
        cleanupEnabled: this.getEffectiveCleanupEnabled(),
        analysisInterval: this.analysisInterval,
        cleanupInterval: TOKEN_CLEANUP_CONFIG.CLEANUP_INTERVAL_MS,
        maxCleanupPercentage: this.getEffectiveMaxCleanupPercentage(),
        minTokensToKeep: TOKEN_CLEANUP_CONFIG.MIN_TOKENS_TO_KEEP,
      });
    }
  }

  private startAnalysis(): void {
    this.analysisTimer = setInterval(() => {
      void (async () => {
        try {
          await this.performAnalysis();
        } catch (error) {
          logger.error('Price analysis failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    }, this.analysisInterval);
  }

  async trackToken(tokenData: TokenData): Promise<void> {
    const { mint } = tokenData;
    const now = new Date();
    
    // Update tracked token data
    this.trackedTokens.set(mint, tokenData);
    
    // Update last activity
    this.lastActivityMap.set(mint, now);
    
    // Update or create token health
    let health = this.tokenHealth.get(mint);
    if (!health) {
      health = {
        mint,
        lastTradeTime: now,
        firstSeenTime: now,
        consecutiveZeroVolumePeriods: 0,
        peakPrice: tokenData.price,
        peakVolume24h: tokenData.volume24h || 0,
        currentLiquidity: tokenData.liquidity || 0,
        isWhitelisted: TOKEN_CLEANUP_CONFIG.WHITELIST_TOKENS.includes(mint),
        isBeingEvaluated: false,
      };
      this.tokenHealth.set(mint, health);
    } else {
      // Skip updates if token is being evaluated for cleanup
      if (health.isBeingEvaluated) {
        logger.debug('Skipping token update during cleanup evaluation', { mint });
        return;
      }
      
      // Update health metrics
      health.lastTradeTime = now;
      health.currentLiquidity = tokenData.liquidity || 0;
      
      // Track peak values for rug detection
      if (tokenData.price > health.peakPrice) {
        health.peakPrice = tokenData.price;
      }
      if ((tokenData.volume24h || 0) > health.peakVolume24h) {
        health.peakVolume24h = tokenData.volume24h || 0;
      }
      
      // Reset zero volume counter if there's volume
      if (tokenData.volume24h && tokenData.volume24h > 0) {
        health.consecutiveZeroVolumePeriods = 0;
      }
    }
    
    // Update performance indices based on token health
    this.updateTokenIndices(mint, tokenData, health);
    
    // Create price point
    const pricePoint: PricePoint = {
      mint,
      platform: tokenData.platform,
      price: tokenData.price,
      volume: tokenData.volume24h,
      timestamp: tokenData.timestamp,
      source: 'tracker',
    };
    
    // Add to price history
    await this.addPricePoint(pricePoint);
    
    // Check alerts
    this.checkAlerts(tokenData);
    
    this.stats.pricePointsProcessed++;
    this.stats.lastUpdate = now;
    
    this.emit('tokenTracked', { mint, price: tokenData.price });
  }

  private async addPricePoint(pricePoint: PricePoint): Promise<void> {
    const { mint } = pricePoint;
    
    // Get existing history
    let history = this.priceHistory.get(mint) || [];
    
    // Add new point
    history.push(pricePoint);
    
    // Keep only last 1000 points in memory
    if (history.length > 1000) {
      history = history.slice(-1000);
    }
    
    // Sort by timestamp
    history.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    this.priceHistory.set(mint, history);
    
    // Write to database
    await this.sqliteClient.writePriceData(pricePoint);
  }

  private checkAlerts(tokenData: TokenData): void {
    const { mint, price, symbol } = tokenData;
    
    for (const [alertId, alert] of this.alerts.entries()) {
      if (alert.mint !== mint || !alert.enabled || alert.triggered) {
        continue;
      }
      
      let triggered = false;
      
      switch (alert.type) {
        case 'threshold':
          triggered = (alert.condition === 'above' && price >= alert.value) ||
                     (alert.condition === 'below' && price <= alert.value);
          break;
          
        case 'percentage': {
          const history = this.priceHistory.get(mint);
          if (history && history.length > 0) {
            const firstPrice = history[0];
            if (firstPrice) {
              const oldPrice = firstPrice.price;
              const changePercent = ((price - oldPrice) / oldPrice) * 100;
              triggered = (alert.condition === 'above' && changePercent >= alert.value) ||
                         (alert.condition === 'below' && changePercent <= alert.value);
            }
          }
          break;
        }
      }
      
      if (triggered) {
        alert.triggered = true;
        alert.triggeredAt = new Date();
        
        this.stats.alertsTriggered++;
        
        logger.info('Price alert triggered', {
          alertId,
          mint,
          symbol,
          type: alert.type,
          condition: alert.condition,
          value: alert.value,
          currentPrice: price,
        });
        
        this.emit('alertTriggered', {
          alert,
          tokenData,
        });
      }
    }
  }

  private async performAnalysis(): Promise<void> {
    logger.debug('Performing price analysis', {
      trackedTokens: this.trackedTokens.size,
    });
    
    for (const [mint, tokenData] of this.trackedTokens.entries()) {
      try {
        await this.analyzeTrends(mint, tokenData);
      } catch (error) {
        logger.error('Failed to analyze trends for token', {
          mint,
          symbol: tokenData.symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async analyzeTrends(mint: string, tokenData: TokenData): Promise<void> {
    const timeframes: Array<'1h' | '24h' | '7d'> = ['1h', '24h', '7d'];
    
    for (const timeframe of timeframes) {
      try {
        const trend = await this.calculateTrend(mint, tokenData, timeframe);
        
        if (trend) {
          const trendKey = `${mint}-${timeframe}`;
          const existingTrend = this.trends.get(trendKey);
          
          // Only emit if trend changed significantly
          if (!existingTrend || this.hasTrendChanged(existingTrend, trend)) {
            this.trends.set(trendKey, trend);
            this.stats.trendsDetected++;
            
            this.emit('trendDetected', trend);
            
            logger.debug('New trend detected', {
              mint,
              symbol: tokenData.symbol,
              timeframe,
              direction: trend.direction,
              strength: trend.strength,
              changePercent: trend.changePercent,
            });
          }
        }
      } catch (error) {
        logger.error('Failed to calculate trend', {
          mint,
          timeframe,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async calculateTrend(
    mint: string, 
    tokenData: TokenData, 
    timeframe: '1h' | '24h' | '7d'
  ): Promise<PriceTrend | null> {
    const now = new Date();
    const intervals = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    
    const startTime = new Date(now.getTime() - intervals[timeframe]);
    
    try {
      const pricePoints = await this.sqliteClient.getPriceHistory(mint, { start: startTime, end: now }, timeframe);
      
      if (pricePoints.length < 2) {
        return null;
      }
      
      const points = pricePoints.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];
      if (!firstPoint || !lastPoint) {
        return null;
      }
      const startPrice = firstPoint.price;
      const endPrice = lastPoint.price;
      const change = endPrice - startPrice;
      const changePercent = (change / startPrice) * 100;
      
      // Calculate trend direction and strength
      const direction = this.getTrendDirection(changePercent);
      const strength = this.getTrendStrength(changePercent, points);
      const confidence = this.calculateConfidence(points);
      
      // Calculate volume
      const totalVolume = points.reduce((sum, point) => sum + point.volume, 0);
      
      return {
        mint,
        symbol: tokenData.symbol,
        platform: tokenData.platform,
        timeframe,
        direction,
        strength,
        change,
        changePercent,
        confidence,
        startPrice,
        endPrice,
        volume: totalVolume,
        timestamp: now,
      };
      
    } catch (error) {
      logger.error('Failed to fetch price history for trend analysis', {
        mint,
        timeframe,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private getTrendDirection(changePercent: number): 'up' | 'down' | 'sideways' {
    const threshold = 2; // 2% threshold for sideways movement
    
    if (changePercent > threshold) return 'up';
    if (changePercent < -threshold) return 'down';
    return 'sideways';
  }

  private getTrendStrength(changePercent: number, points: PricePoint[]): 'weak' | 'moderate' | 'strong' {
    const absChange = Math.abs(changePercent);
    
    // Calculate volatility
    if (points.length < 3) return 'weak';
    
    const prices = points.map(p => p.price);
    const volatility = this.calculateVolatility(prices);
    
    // Strong trends have high change with low volatility
    if (absChange > 20 && volatility < 0.1) return 'strong';
    if (absChange > 10 && volatility < 0.2) return 'moderate';
    return 'weak';
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      const currentPrice = prices[i];
      const previousPrice = prices[i - 1];
      if (currentPrice !== undefined && previousPrice !== undefined && previousPrice !== 0) {
        returns.push((currentPrice - previousPrice) / previousPrice);
      }
    }
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  private calculateConfidence(points: PricePoint[]): number {
    // Confidence based on data points and consistency
    const dataPointScore = Math.min(points.length / 20, 1); // Max 1.0 for 20+ points
    const volumeScore = points.every(p => p.volume > 0) ? 1 : 0.5;
    
    return (dataPointScore + volumeScore) / 2;
  }

  private hasTrendChanged(oldTrend: PriceTrend, newTrend: PriceTrend): boolean {
    return oldTrend.direction !== newTrend.direction ||
           oldTrend.strength !== newTrend.strength ||
           Math.abs(oldTrend.changePercent - newTrend.changePercent) > 5;
  }

  private updateTokenIndices(mint: string, tokenData: TokenData, health: TokenHealth): void {
    const now = Date.now();
    
    // Clear token from all indices first
    this.inactiveTokensIndex.delete(mint);
    this.lowVolumeTokensIndex.delete(mint);
    this.ruggedCandidatesIndex.delete(mint);
    this.recentlyActiveIndex.delete(mint);
    this.newTokensIndex.delete(mint);

    // Check if token is in grace period
    const tokenAge = now - health.firstSeenTime.getTime();
    if (tokenAge < TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS) {
      this.newTokensIndex.add(mint);
      return; // Don't evaluate new tokens for cleanup
    }

    // Check for recent activity
    const timeSinceLastTrade = now - health.lastTradeTime.getTime();
    if (timeSinceLastTrade < TOKEN_CLEANUP_CONFIG.INACTIVITY_THRESHOLD_MS / 2) {
      this.recentlyActiveIndex.add(mint);
    }

    // Check for inactivity
    if (timeSinceLastTrade > TOKEN_CLEANUP_CONFIG.INACTIVITY_THRESHOLD_MS) {
      this.inactiveTokensIndex.add(mint);
    }

    // Check for low volume
    const volume24h = tokenData.volume24h || 0;
    if (volume24h < TOKEN_CLEANUP_CONFIG.MIN_VOLUME_24H_SOL && 
        health.consecutiveZeroVolumePeriods >= TOKEN_CLEANUP_CONFIG.CONSECUTIVE_ZERO_VOLUME_PERIODS) {
      this.lowVolumeTokensIndex.add(mint);
    }

    // Check for rug indicators
    const priceDropPercent = (health.peakPrice - tokenData.price) / health.peakPrice;
    const lowLiquidity = health.currentLiquidity < TOKEN_CLEANUP_CONFIG.RUG_DETECTION_LIQUIDITY_THRESHOLD_USD;
    const significantPriceDrop = priceDropPercent >= TOKEN_CLEANUP_CONFIG.RUG_DETECTION_PRICE_DROP;
    
    if (lowLiquidity || significantPriceDrop) {
      this.ruggedCandidatesIndex.add(mint);
    }

    // Volume drop check
    if (health.peakVolume24h > 0) {
      const volumeDropPercent = (health.peakVolume24h - volume24h) / health.peakVolume24h;
      if (volumeDropPercent >= TOKEN_CLEANUP_CONFIG.RUG_DETECTION_VOLUME_DROP) {
        this.ruggedCandidatesIndex.add(mint);
      }
    }
  }

  // Public API methods
  addAlert(alert: Omit<PriceAlert, 'id' | 'triggered' | 'createdAt'>): string {
    const id = `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.alerts.set(id, {
      ...alert,
      id,
      triggered: false,
      createdAt: new Date(),
    });
    
    logger.info('Price alert added', { id, alert });
    return id;
  }

  removeAlert(alertId: string): boolean {
    const deleted = this.alerts.delete(alertId);
    if (deleted) {
      logger.info('Price alert removed', { alertId });
    }
    return deleted;
  }

  getAlert(alertId: string): PriceAlert | undefined {
    return this.alerts.get(alertId);
  }

  getAllAlerts(): PriceAlert[] {
    return Array.from(this.alerts.values());
  }

  getTrend(mint: string, timeframe: '1h' | '24h' | '7d'): PriceTrend | undefined {
    return this.trends.get(`${mint}-${timeframe}`);
  }

  getAllTrends(): PriceTrend[] {
    return Array.from(this.trends.values());
  }

  getTrackedTokens(): TokenData[] {
    return Array.from(this.trackedTokens.values());
  }

  getPriceHistory(mint: string, limit = 100): PricePoint[] {
    const history = this.priceHistory.get(mint) || [];
    return history.slice(-limit);
  }

  getStats(): TrackingStats {
    // Get top tokens by volume
    const topTokensByVolume = Array.from(this.trackedTokens.values())
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
      .slice(0, 10)
      .map(token => ({
        mint: token.mint,
        symbol: token.symbol,
        volume: token.volume24h || 0,
        platform: token.platform
      }));
    
    return {
      ...this.stats,
      totalTokensTracked: this.trackedTokens.size,
      topTokensByVolume
    };
  }
  
  getAllTokens(): TokenData[] {
    return Array.from(this.trackedTokens.values());
  }

  updateTradeActivity(mint: string): void {
    const now = new Date();
    this.lastActivityMap.set(mint, now);
    
    const health = this.tokenHealth.get(mint);
    if (health) {
      health.lastTradeTime = now;
    }
  }

  async retrackToken(tokenData: TokenData, reason?: string): Promise<boolean> {
    const { mint } = tokenData;
    
    // Check if token is already tracked
    if (this.trackedTokens.has(mint)) {
      logger.debug('Token already being tracked', { mint, symbol: tokenData.symbol });
      return false;
    }

    logger.info('Re-tracking token', {
      mint,
      symbol: tokenData.symbol,
      platform: tokenData.platform,
      reason: reason || 'manual_request',
      price: tokenData.price,
      volume24h: tokenData.volume24h,
      marketCap: tokenData.marketCap,
    });

    // TODO: Implement cleanup history query for SQLite
    // Check if this token was previously cleaned up
    try {
      // const cleanupHistory = await this.sqliteClient.queryCleanupEvents(mint, undefined, undefined, {
      //   start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
      //   end: new Date(),
      // }, 5);
      
      // For now, skip cleanup history check until SQLite implementation is complete
      logger.info('Skipping cleanup history check for re-tracking (SQLite implementation pending)', { mint });
    } catch (error) {
      logger.error('Failed to check cleanup history for re-tracking', {
        mint,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Re-track the token normally
    await this.trackToken(tokenData);

    this.emit('tokenRetracked', {
      mint: tokenData.mint,
      symbol: tokenData.symbol,
      platform: tokenData.platform,
      reason: reason || 'manual_request',
      price: tokenData.price,
    });

    return true;
  }

  async evaluateTokenForRetracking(mint: string): Promise<{ shouldRetrack: boolean; reason?: string }> {
    try {
      // TODO: Implement cleanup events query for SQLite
      // Query recent cleanup events for this token
      // const cleanupHistory = await this.sqliteClient.queryCleanupEvents(mint, undefined, undefined, {
      //   start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      //   end: new Date(),
      // }, 1);

      // For now, assume no recent cleanup found until SQLite implementation is complete
      return { shouldRetrack: false, reason: 'Cleanup events not yet implemented in SQLite' };
      
      // if (!cleanupHistory.success || cleanupHistory.data.length === 0) {
      //   return { shouldRetrack: false, reason: 'No recent cleanup found' };
      // }

      // const lastCleanup = cleanupHistory.data[0];
      if (!lastCleanup) {
        return { shouldRetrack: false, reason: 'No cleanup data found' };
      }
      
      const timeSinceCleanup = Date.now() - lastCleanup.timestamp.getTime();

      // Minimum time before considering re-tracking (1 hour)
      if (timeSinceCleanup < 3600000) {
        return { shouldRetrack: false, reason: 'Too soon since cleanup' };
      }

      // Get current token data from external source to evaluate recovery
      // This would typically come from pump.fun API or WebSocket
      // For now, we'll assume the caller provides updated token data
      
      return { shouldRetrack: true, reason: 'Token eligible for re-tracking evaluation' };
    } catch (error) {
      logger.error('Failed to evaluate token for re-tracking', {
        mint,
        error: error instanceof Error ? error.message : String(error),
      });
      return { shouldRetrack: false, reason: 'Evaluation failed' };
    }
  }

  getRetrackingStats(): {
    tokensRetracked: number;
    lastRetrackedToken?: string;
    avgTimeBetweenCleanupAndRetrack?: number;
  } {
    // This would be enhanced with persistent storage of re-tracking events
    return {
      tokensRetracked: 0, // Would track this in real implementation
      lastRetrackedToken: undefined,
      avgTimeBetweenCleanupAndRetrack: undefined,
    };
  }

  // Emergency Controls
  emergencyStopCleanup(reason: string): void {
    this.emergencyStop = true;
    this.cleanupPaused = true;
    
    logger.error('🚨 EMERGENCY STOP - All cleanup operations halted', {
      reason,
      timestamp: new Date(),
      currentlyTracked: this.trackedTokens.size,
      cleanupInProgress: this.cleanupInProgress,
    });

    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.emit('emergencyStop', { reason, timestamp: new Date() });
  }

  pauseCleanup(reason: string): void {
    this.cleanupPaused = true;
    
    logger.warn('⏸️ Cleanup paused', {
      reason,
      timestamp: new Date(),
      currentlyTracked: this.trackedTokens.size,
    });

    this.emit('cleanupPaused', { reason, timestamp: new Date() });
  }

  resumeCleanup(reason: string): void {
    if (this.emergencyStop) {
      logger.warn('Cannot resume cleanup while emergency stop is active');
      return;
    }

    this.cleanupPaused = false;
    
    logger.info('▶️ Cleanup resumed', {
      reason,
      timestamp: new Date(),
      currentlyTracked: this.trackedTokens.size,
    });

    // Restart cleanup timer if it's not running
    if (!this.cleanupTimer && TOKEN_CLEANUP_CONFIG.CLEANUP_ENABLED) {
      this.startCleanupProcess();
    }

    this.emit('cleanupResumed', { reason, timestamp: new Date() });
  }

  setEmergencyOverride(override: 'disableAllCleanup' | 'forceMinimumTokens', enabled: boolean, reason: string): void {
    this.emergencyOverrides[override] = enabled;
    
    logger.warn('🔧 Emergency override set', {
      override,
      enabled,
      reason,
      timestamp: new Date(),
    });

    this.emit('emergencyOverride', { override, enabled, reason, timestamp: new Date() });
  }

  addEmergencyWhitelist(mints: string[], reason: string): void {
    for (const mint of mints) {
      this.emergencyOverrides.emergencyWhitelist.add(mint);
    }
    
    logger.warn('🔒 Emergency whitelist updated', {
      addedTokens: mints.length,
      totalWhitelisted: this.emergencyOverrides.emergencyWhitelist.size,
      reason,
      timestamp: new Date(),
    });

    this.emit('emergencyWhitelistUpdated', { 
      action: 'added', 
      tokens: mints, 
      reason, 
      timestamp: new Date() 
    });
  }

  removeEmergencyWhitelist(mints: string[], reason: string): void {
    for (const mint of mints) {
      this.emergencyOverrides.emergencyWhitelist.delete(mint);
    }
    
    logger.info('🔓 Emergency whitelist updated', {
      removedTokens: mints.length,
      totalWhitelisted: this.emergencyOverrides.emergencyWhitelist.size,
      reason,
      timestamp: new Date(),
    });

    this.emit('emergencyWhitelistUpdated', { 
      action: 'removed', 
      tokens: mints, 
      reason, 
      timestamp: new Date() 
    });
  }

  async forceEmergencyCleanup(percentage: number, reason: string): Promise<void> {
    if (percentage <= 0 || percentage > 0.5) {
      throw new Error('Emergency cleanup percentage must be between 0 and 0.5 (50%)');
    }

    logger.warn('🚨 FORCE EMERGENCY CLEANUP INITIATED', {
      percentage,
      reason,
      currentTokens: this.trackedTokens.size,
      timestamp: new Date(),
    });

    // Set emergency config override (safer than modifying readonly constants)
    this.emergencyConfigOverride = {
      MAX_CLEANUP_PERCENTAGE: percentage,
      CLEANUP_ENABLED: true,
      BYPASS_SAFETY_CHECKS: true,
      FORCE_MINIMUM_TOKENS: false,
    };
    
    try {
      // Force cleanup immediately
      await this.performCleanup();
      
      logger.warn('🚨 FORCE EMERGENCY CLEANUP COMPLETED', {
        percentage,
        reason,
        remainingTokens: this.trackedTokens.size,
        timestamp: new Date(),
      });

    } finally {
      // Clear emergency override
      this.emergencyConfigOverride = null;
    }

    this.emit('emergencyCleanupCompleted', { 
      percentage, 
      reason, 
      remainingTokens: this.trackedTokens.size, 
      timestamp: new Date() 
    });
  }

  getEmergencyStatus(): {
    emergencyStop: boolean;
    cleanupPaused: boolean;
    overrides: {
      disableAllCleanup: boolean;
      forceMinimumTokens: boolean;
      emergencyWhitelist: Set<string>;
    };
    emergencyWhitelistSize: number;
    cleanupInProgress: boolean;
  } {
    return {
      emergencyStop: this.emergencyStop,
      cleanupPaused: this.cleanupPaused,
      overrides: {
        disableAllCleanup: this.emergencyOverrides.disableAllCleanup,
        forceMinimumTokens: this.emergencyOverrides.forceMinimumTokens,
        emergencyWhitelist: new Set(this.emergencyOverrides.emergencyWhitelist),
      },
      emergencyWhitelistSize: this.emergencyOverrides.emergencyWhitelist.size,
      cleanupInProgress: this.cleanupInProgress,
    };
  }

  // Helper methods for emergency config override
  private getEffectiveCleanupEnabled(): boolean {
    return this.emergencyConfigOverride?.CLEANUP_ENABLED ?? TOKEN_CLEANUP_CONFIG.CLEANUP_ENABLED;
  }

  private getEffectiveMaxCleanupPercentage(): number {
    return this.emergencyConfigOverride?.MAX_CLEANUP_PERCENTAGE ?? TOKEN_CLEANUP_CONFIG.MAX_CLEANUP_PERCENTAGE;
  }

  private startCleanupProcess(): void {
    if (!this.getEffectiveCleanupEnabled()) {
      logger.info('Token cleanup is disabled');
      return;
    }

    this.cleanupTimer = setInterval(() => {
      void (async () => {
        try {
          await this.performCleanup();
        } catch (error) {
          logger.error('Token cleanup failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    }, TOKEN_CLEANUP_CONFIG.CLEANUP_INTERVAL_MS);
    
    logger.info('Token cleanup process started', {
      interval: TOKEN_CLEANUP_CONFIG.CLEANUP_INTERVAL_MS,
    });
  }

  private async performCleanup(): Promise<void> {
    // Check emergency controls
    if (this.emergencyStop || this.cleanupPaused || this.emergencyOverrides.disableAllCleanup) {
      logger.debug('Cleanup skipped due to emergency controls', {
        emergencyStop: this.emergencyStop,
        cleanupPaused: this.cleanupPaused,
        disableAllCleanup: this.emergencyOverrides.disableAllCleanup,
      });
      return;
    }

    // Prevent concurrent cleanup
    if (this.cleanupInProgress) {
      logger.debug('Cleanup already in progress, skipping');
      return;
    }

    this.cleanupInProgress = true;
    const startTime = Date.now();

    // Create cleanup transaction
    const transaction: CleanupTransaction = {
      id: `cleanup_${Date.now()}`,
      startTime: new Date(),
      candidatesCount: 0,
      confirmedCount: 0,
      completedCount: 0,
      status: 'evaluating'
    };
    this.currentTransaction = transaction;

    try {
      // Phase 1: Evaluate cleanup candidates (read-only)
      const candidates = this.evaluateCleanupCandidates();
      transaction.candidatesCount = candidates.length;
      transaction.status = 'confirming';

      // Phase 2: Confirm and execute cleanup
      const metrics = await this.confirmAndExecuteCleanup(candidates);
      transaction.confirmedCount = metrics.actuallyRemoved;
      transaction.completedCount = metrics.actuallyRemoved;
      transaction.status = 'completed';

      // Calculate execution time
      metrics.executionTimeMs = Date.now() - startTime;

      // Log results
      await this.logCleanupResults(metrics, transaction);

    } catch (error) {
      transaction.status = 'failed';
      logger.error('Cleanup failed', {
        transactionId: transaction.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      // Clear locks and reset state
      this.clearCleanupLocks();
      this.cleanupInProgress = false;
      this.currentTransaction = null;
    }
  }

  private evaluateCleanupCandidates(): CleanupReason[] {
    const candidates: CleanupReason[] = [];
    
    // Safety check: minimum tokens (with emergency override)
    const effectiveMinTokens = this.emergencyOverrides.forceMinimumTokens 
      ? TOKEN_CLEANUP_CONFIG.MIN_TOKENS_TO_KEEP * 2 
      : TOKEN_CLEANUP_CONFIG.MIN_TOKENS_TO_KEEP;
      
    if (this.trackedTokens.size <= effectiveMinTokens) {
      logger.debug('Skipping cleanup - minimum token threshold', {
        currentTokens: this.trackedTokens.size,
        minTokens: effectiveMinTokens,
        emergencyForceMinimum: this.emergencyOverrides.forceMinimumTokens,
      });
      return [];
    }

    // Use indices for faster evaluation - combine all potential candidates
    const potentialCandidates = new Set([
      ...this.ruggedCandidatesIndex,
      ...this.inactiveTokensIndex,
      ...this.lowVolumeTokensIndex
    ]);

    logger.debug('Evaluating cleanup candidates using indices', {
      ruggedCandidates: this.ruggedCandidatesIndex.size,
      inactiveCandidates: this.inactiveTokensIndex.size,
      lowVolumeCandidates: this.lowVolumeTokensIndex.size,
      totalUnique: potentialCandidates.size,
      whitelistedTokens: Array.from(this.tokenHealth.values()).filter(h => h.isWhitelisted).length,
      newTokens: this.newTokensIndex.size,
    });

    // Phase 1: Read-only evaluation using indices
    for (const mint of potentialCandidates) {
      const tokenData = this.trackedTokens.get(mint);
      const health = this.tokenHealth.get(mint);
      
      if (!tokenData || !health) continue;

      // Mark as being evaluated to prevent concurrent updates
      health.isBeingEvaluated = true;
      this.tokensBeingEvaluated.add(mint);

      // Skip whitelisted tokens (regular and emergency whitelist)
      if (health.isWhitelisted || this.emergencyOverrides.emergencyWhitelist.has(mint)) continue;

      // Skip new tokens (should not be in indices, but double-check)
      const tokenAge = Date.now() - health.firstSeenTime.getTime();
      if (tokenAge < TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS) continue;

      // Check if token is in rugged candidates index
      if (this.ruggedCandidatesIndex.has(mint)) {
        const rugReason = this.detectRuggedToken(tokenData, health);
        if (rugReason) {
          candidates.push(rugReason);
          continue;
        }
      }

      // Check if token is in inactive or low volume indices
      if (this.inactiveTokensIndex.has(mint) || this.lowVolumeTokensIndex.has(mint)) {
        const inactiveReason = this.detectInactiveToken(tokenData, health);
        if (inactiveReason) {
          candidates.push(inactiveReason);
        }
      }
    }

    return candidates;
  }

  private async confirmAndExecuteCleanup(candidates: CleanupReason[]): Promise<CleanupMetrics> {
    const metrics: CleanupMetrics = {
      totalEvaluated: this.tokensBeingEvaluated.size,
      ruggedDetected: candidates.filter(c => c.reason === 'rugged').length,
      inactiveDetected: candidates.filter(c => c.reason === 'inactive').length,
      lowVolumeDetected: candidates.filter(c => c.reason === 'low_volume').length,
      actuallyRemoved: 0,
      savedByWhitelist: 0,
      savedByGracePeriod: 0,
      savedByLimit: 0,
      executionTimeMs: 0,
    };

    // Calculate saved counts
    metrics.savedByWhitelist = Array.from(this.tokensBeingEvaluated).filter(mint => {
      const health = this.tokenHealth.get(mint);
      return health?.isWhitelisted;
    }).length;

    metrics.savedByGracePeriod = Array.from(this.tokensBeingEvaluated).filter(mint => {
      const health = this.tokenHealth.get(mint);
      if (!health) return false;
      const tokenAge = Date.now() - health.firstSeenTime.getTime();
      return tokenAge < TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS;
    }).length;

    // Apply cleanup limit
    const maxCleanup = Math.floor(this.trackedTokens.size * this.getEffectiveMaxCleanupPercentage());
    const tokensToCleanup = candidates.slice(0, maxCleanup);
    metrics.savedByLimit = candidates.length - tokensToCleanup.length;

    if (this.currentTransaction) {
      this.currentTransaction.status = 'executing';
    }

    // Phase 2: Re-verify and execute
    for (const reason of tokensToCleanup) {
      // Re-verify the token still meets cleanup criteria
      const tokenData = this.trackedTokens.get(reason.mint);
      const health = this.tokenHealth.get(reason.mint);
      
      if (!tokenData || !health) {
        logger.debug('Token disappeared during cleanup', { mint: reason.mint });
        continue;
      }

      // Re-check the cleanup condition
      let stillNeedsCleanup = false;
      if (reason.reason === 'rugged') {
        stillNeedsCleanup = !!this.detectRuggedToken(tokenData, health);
      } else {
        stillNeedsCleanup = !!this.detectInactiveToken(tokenData, health);
      }

      if (stillNeedsCleanup) {
        await this.untrackToken(reason);
        metrics.actuallyRemoved++;
      } else {
        logger.debug('Token no longer meets cleanup criteria', { 
          mint: reason.mint, 
          reason: reason.reason 
        });
      }
    }

    return metrics;
  }

  private clearCleanupLocks(): void {
    // Clear evaluation flags
    for (const mint of this.tokensBeingEvaluated) {
      const health = this.tokenHealth.get(mint);
      if (health) {
        health.isBeingEvaluated = false;
      }
    }
    this.tokensBeingEvaluated.clear();
  }

  private async logCleanupResults(metrics: CleanupMetrics, transaction: CleanupTransaction): Promise<void> {
    // Log metrics to database
    if (metrics.totalEvaluated > 0) {
      try {
        // TODO: Implement cleanup metrics writing for SQLite
      // await this.sqliteClient.writeCleanupMetrics(metrics);
      } catch (error) {
        logger.error('Failed to write cleanup metrics', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (metrics.actuallyRemoved > 0) {
      this.stats.tokensCleanedUp += metrics.actuallyRemoved;
      this.stats.lastCleanupTime = new Date();
      
      logger.info('🧹 Token cleanup completed', {
        transactionId: transaction.id,
        tokensRemoved: metrics.actuallyRemoved,
        totalCleaned: this.stats.tokensCleanedUp,
        duration: metrics.executionTimeMs,
        remainingTokens: this.trackedTokens.size,
        metrics: {
          evaluated: metrics.totalEvaluated,
          rugged: metrics.ruggedDetected,
          inactive: metrics.inactiveDetected,
          lowVolume: metrics.lowVolumeDetected,
          savedByWhitelist: metrics.savedByWhitelist,
          savedByGracePeriod: metrics.savedByGracePeriod,
          savedByLimit: metrics.savedByLimit,
        }
      });
    }
    
    // Emit metrics event
    this.emit('cleanupMetrics', metrics);
  }

  private detectRuggedToken(tokenData: TokenData, health: TokenHealth): CleanupReason | null {
    // Check price drop from peak
    const priceDropPercent = (health.peakPrice - tokenData.price) / health.peakPrice;
    if (priceDropPercent >= TOKEN_CLEANUP_CONFIG.RUG_DETECTION_PRICE_DROP) {
      return {
        mint: tokenData.mint,
        symbol: tokenData.symbol,
        platform: tokenData.platform,
        reason: 'rugged',
        details: `Price dropped ${(priceDropPercent * 100).toFixed(2)}% from peak`,
      };
    }

    // Check liquidity threshold
    if (health.currentLiquidity < TOKEN_CLEANUP_CONFIG.RUG_DETECTION_LIQUIDITY_THRESHOLD_USD) {
      return {
        mint: tokenData.mint,
        symbol: tokenData.symbol,
        platform: tokenData.platform,
        reason: 'rugged',
        details: `Liquidity below $${TOKEN_CLEANUP_CONFIG.RUG_DETECTION_LIQUIDITY_THRESHOLD_USD}`,
      };
    }

    // Check volume drop from peak
    const currentVolume = tokenData.volume24h || 0;
    if (health.peakVolume24h > 0) {
      const volumeDropPercent = (health.peakVolume24h - currentVolume) / health.peakVolume24h;
      if (volumeDropPercent >= TOKEN_CLEANUP_CONFIG.RUG_DETECTION_VOLUME_DROP) {
        return {
          mint: tokenData.mint,
          symbol: tokenData.symbol,
          platform: tokenData.platform,
          reason: 'rugged',
          details: `Volume dropped ${(volumeDropPercent * 100).toFixed(2)}% from peak`,
        };
      }
    }

    return null;
  }

  private detectInactiveToken(tokenData: TokenData, health: TokenHealth): CleanupReason | null {
    const now = Date.now();
    
    // Check last trade time
    const timeSinceLastTrade = now - health.lastTradeTime.getTime();
    if (timeSinceLastTrade > TOKEN_CLEANUP_CONFIG.INACTIVITY_THRESHOLD_MS) {
      return {
        mint: tokenData.mint,
        symbol: tokenData.symbol,
        platform: tokenData.platform,
        reason: 'inactive',
        details: `No trades for ${Math.floor(timeSinceLastTrade / 60000)} minutes`,
      };
    }

    // Check low volume
    const volume24h = tokenData.volume24h || 0;
    if (volume24h < TOKEN_CLEANUP_CONFIG.MIN_VOLUME_24H_SOL) {
      health.consecutiveZeroVolumePeriods++;
      if (health.consecutiveZeroVolumePeriods >= TOKEN_CLEANUP_CONFIG.CONSECUTIVE_ZERO_VOLUME_PERIODS) {
        return {
          mint: tokenData.mint,
          symbol: tokenData.symbol,
          platform: tokenData.platform,
          reason: 'low_volume',
          details: `Volume below ${TOKEN_CLEANUP_CONFIG.MIN_VOLUME_24H_SOL} SOL for ${health.consecutiveZeroVolumePeriods} periods`,
        };
      }
    }

    return null;
  }

  private async untrackToken(reason: CleanupReason): Promise<void> {
    const { mint } = reason;
    
    // Get final state before removal
    const tokenData = this.trackedTokens.get(mint);
    const health = this.tokenHealth.get(mint);
    const priceHistory = this.priceHistory.get(mint) || [];
    
    // Calculate stats for audit
    const totalTrades = priceHistory.length;
    const trackedDuration = health ? 
      Date.now() - health.firstSeenTime.getTime() : 0;
    
    // Create cleanup event for audit trail
    if (tokenData && health) {
      const cleanupEvent: CleanupEvent = {
        mint: reason.mint,
        symbol: reason.symbol,
        platform: reason.platform,
        reason: reason.reason,
        details: reason.details,
        timestamp: new Date(),
        finalPrice: tokenData.price,
        finalVolume: tokenData.volume24h,
        finalLiquidity: tokenData.liquidity,
        finalMarketCap: tokenData.marketCap,
        peakPrice: health.peakPrice,
        peakVolume: health.peakVolume24h,
        trackedDuration,
        totalTrades,
      };
      
      // Log to database for audit trail
      try {
        // TODO: Implement cleanup event writing for SQLite
      // await this.sqliteClient.writeCleanupEvent(cleanupEvent);
        logger.debug('Cleanup event logged to database', { mint });
      } catch (error) {
        logger.error('Failed to log cleanup event', {
          mint,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    // Remove from all tracking maps
    this.trackedTokens.delete(mint);
    this.priceHistory.delete(mint);
    this.tokenHealth.delete(mint);
    this.lastActivityMap.delete(mint);
    
    // Remove from performance indices
    this.inactiveTokensIndex.delete(mint);
    this.lowVolumeTokensIndex.delete(mint);
    this.ruggedCandidatesIndex.delete(mint);
    this.recentlyActiveIndex.delete(mint);
    this.newTokensIndex.delete(mint);
    
    // Remove any associated alerts
    for (const [alertId, alert] of this.alerts.entries()) {
      if (alert.mint === mint) {
        this.alerts.delete(alertId);
      }
    }
    
    // Remove trends
    for (const [trendKey] of this.trends.entries()) {
      if (trendKey.startsWith(mint)) {
        this.trends.delete(trendKey);
      }
    }
    
    // Emit cleanup event with proper typing
    this.emit('tokenCleanedUp', {
      mint: reason.mint,
      symbol: reason.symbol,
      platform: reason.platform,
      reason: reason.reason,
      details: reason.details
    });
    
    logger.info('\ud83d\udeae Token untracked', {
      mint: reason.mint,
      symbol: reason.symbol,
      platform: reason.platform,
      reason: reason.reason,
      details: reason.details,
      finalStats: {
        price: tokenData?.price,
        volume: tokenData?.volume24h,
        trackedDuration: Math.floor(trackedDuration / 1000), // seconds
        totalTrades,
      }
    });
  }

  stop(): void {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    logger.info('Price tracker stopped', { stats: this.getStats() });
  }
}