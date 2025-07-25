/**
 * Price tracking functionality with trend analysis
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { InfluxClient } from '../database/influx-client.js';
import { 
  TokenData, 
  PricePoint, 
  AggregatedData,
  PriceHistoryQuery 
} from '../database/schema.js';
import { Platform } from '../utils/constants.js';

interface PriceAlert {
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

interface TrackingStats {
  totalTokensTracked: number;
  pricePointsProcessed: number;
  alertsTriggered: number;
  trendsDetected: number;
  lastUpdate: Date | null;
}

export class PriceTracker extends EventEmitter {
  private trackedTokens = new Map<string, TokenData>();
  private priceHistory = new Map<string, PricePoint[]>();
  private alerts = new Map<string, PriceAlert>();
  private trends = new Map<string, PriceTrend>();
  private stats: TrackingStats;
  private analysisTimer: NodeJS.Timeout | null = null;

  constructor(
    private influxClient: InfluxClient,
    private analysisInterval = 60000 // 1 minute
  ) {
    super();
    
    this.stats = {
      totalTokensTracked: 0,
      pricePointsProcessed: 0,
      alertsTriggered: 0,
      trendsDetected: 0,
      lastUpdate: null,
    };

    this.startAnalysis();
  }

  private startAnalysis(): void {
    this.analysisTimer = setInterval(async () => {
      try {
        await this.performAnalysis();
      } catch (error) {
        logger.error('Price analysis failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.analysisInterval);
  }

  async trackToken(tokenData: TokenData): Promise<void> {
    const { mint } = tokenData;
    
    // Update tracked token data
    this.trackedTokens.set(mint, tokenData);
    
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
    await this.checkAlerts(tokenData);
    
    this.stats.pricePointsProcessed++;
    this.stats.lastUpdate = new Date();
    
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
    await this.influxClient.writePriceData(pricePoint);
  }

  private async checkAlerts(tokenData: TokenData): Promise<void> {
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
          
        case 'percentage':
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
      const query: PriceHistoryQuery = {
        mint,
        timeRange: { start: startTime, end: now },
        interval: timeframe === '1h' ? '5m' : timeframe === '24h' ? '1h' : '4h',
        aggregation: 'mean',
      };
      
      const result = await this.influxClient.getPriceHistory(query);
      
      if (!result.success || result.data.length < 2) {
        return null;
      }
      
      const points = result.data.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];
      if (!firstPoint || !lastPoint) {
        return null;
      }
      const startPrice = firstPoint.value;
      const endPrice = lastPoint.value;
      const change = endPrice - startPrice;
      const changePercent = (change / startPrice) * 100;
      
      // Calculate trend direction and strength
      const direction = this.getTrendDirection(changePercent);
      const strength = this.getTrendStrength(changePercent, points);
      const confidence = this.calculateConfidence(points);
      
      // Calculate volume
      const totalVolume = points.reduce((sum, point) => sum + (point.count || 0), 0);
      
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

  private getTrendStrength(changePercent: number, points: AggregatedData[]): 'weak' | 'moderate' | 'strong' {
    const absChange = Math.abs(changePercent);
    
    // Calculate volatility
    if (points.length < 3) return 'weak';
    
    const prices = points.map(p => p.value);
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

  private calculateConfidence(points: AggregatedData[]): number {
    // Confidence based on data points and consistency
    const dataPointScore = Math.min(points.length / 20, 1); // Max 1.0 for 20+ points
    const volumeScore = points.every(p => p.count > 0) ? 1 : 0.5;
    
    return (dataPointScore + volumeScore) / 2;
  }

  private hasTrendChanged(oldTrend: PriceTrend, newTrend: PriceTrend): boolean {
    return oldTrend.direction !== newTrend.direction ||
           oldTrend.strength !== newTrend.strength ||
           Math.abs(oldTrend.changePercent - newTrend.changePercent) > 5;
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
    return {
      ...this.stats,
      totalTokensTracked: this.trackedTokens.size,
    };
  }

  async stop(): Promise<void> {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }
    
    logger.info('Price tracker stopped', { stats: this.getStats() });
  }
}