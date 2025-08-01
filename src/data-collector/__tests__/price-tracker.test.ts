import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { PriceTracker } from '../price-tracker';
import { InfluxClient } from '../../database/influx-client';
import { TokenData } from '../../database/schema';
import { TOKEN_CLEANUP_CONFIG } from '../../utils/constants';

// Mock InfluxClient
jest.mock('../../database/influx-client');

describe('PriceTracker Cleanup', () => {
  let priceTracker: PriceTracker;
  let mockInfluxClient: jest.Mocked<InfluxClient>;
  
  beforeEach(() => {
    // Create mock InfluxClient
    mockInfluxClient = new InfluxClient({
      host: 'mock',
      token: 'mock',
      database: 'mock',
      organization: 'mock',
    }, 100, 1000) as jest.Mocked<InfluxClient>;
    
    // Mock methods
    mockInfluxClient.writeCleanupEvent = jest.fn().mockResolvedValue(undefined);
    mockInfluxClient.writeCleanupMetrics = jest.fn().mockResolvedValue(undefined);
    
    // Create price tracker with shorter intervals for testing
    priceTracker = new PriceTracker(mockInfluxClient, 100);
  });
  
  afterEach(async () => {
    await priceTracker.stop();
  });
  
  describe('detectRuggedToken', () => {
    it('should detect 95% price drop', async () => {
      const tokenData: TokenData = {
        mint: 'rug123',
        symbol: 'RUG',
        name: 'Rugged Token',
        platform: 'pump.fun',
        platformConfidence: 1.0,
        price: 0.001, // Current price
        volume24h: 100,
        marketCap: 1000,
        liquidity: 200,
        priceChange24h: -95,
        volumeChange24h: -50,
        holders: 10,
        uri: 'test',
        timestamp: new Date(),
      };
      
      // Track token with initial high price
      await priceTracker.trackToken({ ...tokenData, price: 0.1 });
      
      // Track again with low price
      await priceTracker.trackToken(tokenData);
      
      // Manually trigger cleanup
      await (priceTracker as any).performCleanup();
      
      // Check that cleanup event was logged
      expect(mockInfluxClient.writeCleanupEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          mint: 'rug123',
          reason: 'rugged',
        })
      );
    });
    
    it('should detect low liquidity', async () => {
      const tokenData: TokenData = {
        mint: 'lowliq123',
        symbol: 'LOWLIQ',
        name: 'Low Liquidity Token',
        platform: 'pump.fun',
        platformConfidence: 1.0,
        price: 0.01,
        volume24h: 100,
        marketCap: 1000,
        liquidity: 50, // Below threshold
        priceChange24h: 0,
        volumeChange24h: 0,
        holders: 10,
        uri: 'test',
        timestamp: new Date(),
      };
      
      // Set first seen time to past grace period
      await priceTracker.trackToken(tokenData);
      const health = (priceTracker as any).tokenHealth.get('lowliq123');
      if (health) {
        health.firstSeenTime = new Date(Date.now() - TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS - 1000);
      }
      
      // Trigger cleanup
      await (priceTracker as any).performCleanup();
      
      expect(mockInfluxClient.writeCleanupEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          mint: 'lowliq123',
          reason: 'rugged',
          details: expect.stringContaining('Liquidity below'),
        })
      );
    });
  });
  
  describe('detectInactiveToken', () => {
    it('should detect tokens with no recent trades', async () => {
      const tokenData: TokenData = {
        mint: 'inactive123',
        symbol: 'DEAD',
        name: 'Inactive Token',
        platform: 'letsbonk.fun',
        platformConfidence: 1.0,
        price: 0.01,
        volume24h: 100,
        marketCap: 1000,
        liquidity: 500,
        priceChange24h: 0,
        volumeChange24h: 0,
        holders: 10,
        uri: 'test',
        timestamp: new Date(),
      };
      
      await priceTracker.trackToken(tokenData);
      
      // Simulate old last trade time
      const health = (priceTracker as any).tokenHealth.get('inactive123');
      if (health) {
        health.lastTradeTime = new Date(Date.now() - TOKEN_CLEANUP_CONFIG.INACTIVITY_THRESHOLD_MS - 1000);
        health.firstSeenTime = new Date(Date.now() - TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS - 1000);
      }
      
      await (priceTracker as any).performCleanup();
      
      expect(mockInfluxClient.writeCleanupEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          mint: 'inactive123',
          reason: 'inactive',
        })
      );
    });
    
    it('should detect low volume tokens', async () => {
      const tokenData: TokenData = {
        mint: 'lowvol123',
        symbol: 'LOWVOL',
        name: 'Low Volume Token',
        platform: 'pump.fun',
        platformConfidence: 1.0,
        price: 0.01,
        volume24h: 5, // Below minimum
        marketCap: 1000,
        liquidity: 500,
        priceChange24h: 0,
        volumeChange24h: -90,
        holders: 10,
        uri: 'test',
        timestamp: new Date(),
      };
      
      await priceTracker.trackToken(tokenData);
      
      const health = (priceTracker as any).tokenHealth.get('lowvol123');
      if (health) {
        health.consecutiveZeroVolumePeriods = TOKEN_CLEANUP_CONFIG.CONSECUTIVE_ZERO_VOLUME_PERIODS;
        health.firstSeenTime = new Date(Date.now() - TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS - 1000);
      }
      
      await (priceTracker as any).performCleanup();
      
      expect(mockInfluxClient.writeCleanupEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          mint: 'lowvol123',
          reason: 'low_volume',
        })
      );
    });
  });
  
  describe('cleanup safety mechanisms', () => {
    it('should respect whitelist', async () => {
      // Add token to whitelist
      TOKEN_CLEANUP_CONFIG.WHITELIST_TOKENS.push('whitelist123');
      
      const tokenData: TokenData = {
        mint: 'whitelist123',
        symbol: 'SAFE',
        name: 'Whitelisted Token',
        platform: 'pump.fun',
        platformConfidence: 1.0,
        price: 0.00001, // Very low price
        volume24h: 0, // No volume
        marketCap: 10,
        liquidity: 1, // Almost no liquidity
        priceChange24h: -99,
        volumeChange24h: -100,
        holders: 1,
        uri: 'test',
        timestamp: new Date(),
      };
      
      await priceTracker.trackToken(tokenData);
      
      const health = (priceTracker as any).tokenHealth.get('whitelist123');
      if (health) {
        health.firstSeenTime = new Date(Date.now() - TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS - 1000);
      }
      
      await (priceTracker as any).performCleanup();
      
      // Should not be cleaned up
      expect(mockInfluxClient.writeCleanupEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({
          mint: 'whitelist123',
        })
      );
      
      // Clean up whitelist
      TOKEN_CLEANUP_CONFIG.WHITELIST_TOKENS.pop();
    });
    
    it('should respect grace period for new tokens', async () => {
      const tokenData: TokenData = {
        mint: 'new123',
        symbol: 'NEW',
        name: 'New Token',
        platform: 'pump.fun',
        platformConfidence: 1.0,
        price: 0.00001,
        volume24h: 0,
        marketCap: 10,
        liquidity: 1,
        priceChange24h: -99,
        volumeChange24h: -100,
        holders: 1,
        uri: 'test',
        timestamp: new Date(),
      };
      
      // Track new token
      await priceTracker.trackToken(tokenData);
      
      // Trigger cleanup immediately
      await (priceTracker as any).performCleanup();
      
      // Should not be cleaned up due to grace period
      expect(mockInfluxClient.writeCleanupEvent).not.toHaveBeenCalled();
    });
    
    it('should respect maximum cleanup percentage', async () => {
      // Track many tokens that should be cleaned up
      for (let i = 0; i < 20; i++) {
        const tokenData: TokenData = {
          mint: `token${i}`,
          symbol: `TOK${i}`,
          name: `Token ${i}`,
          platform: 'pump.fun',
          platformConfidence: 1.0,
          price: 0.00001,
          volume24h: 0,
          marketCap: 10,
          liquidity: 1,
          priceChange24h: -99,
          volumeChange24h: -100,
          holders: 1,
          uri: 'test',
          timestamp: new Date(),
        };
        
        await priceTracker.trackToken(tokenData);
        
        // Make all tokens old enough for cleanup
        const health = (priceTracker as any).tokenHealth.get(`token${i}`);
        if (health) {
          health.firstSeenTime = new Date(Date.now() - TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS - 1000);
        }
      }
      
      // Clear previous calls
      mockInfluxClient.writeCleanupEvent.mockClear();
      
      // Trigger cleanup
      await (priceTracker as any).performCleanup();
      
      // Should only clean up 10% (2 tokens)
      expect(mockInfluxClient.writeCleanupEvent).toHaveBeenCalledTimes(2);
    });
  });
  
  describe('metrics collection', () => {
    it('should collect and report cleanup metrics', async () => {
      // Track some tokens
      const tokens = [
        { mint: 'rugged1', price: 0.00001, liquidity: 50 }, // Will be rugged
        { mint: 'inactive1', price: 0.01, liquidity: 500 }, // Will be inactive
        { mint: 'active1', price: 0.1, liquidity: 1000 }, // Will stay active
      ];
      
      for (const token of tokens) {
        const tokenData: TokenData = {
          mint: token.mint,
          symbol: 'TEST',
          name: 'Test Token',
          platform: 'pump.fun',
          platformConfidence: 1.0,
          price: token.price,
          volume24h: 100,
          marketCap: 1000,
          liquidity: token.liquidity,
          priceChange24h: 0,
          volumeChange24h: 0,
          holders: 10,
          uri: 'test',
          timestamp: new Date(),
        };
        
        await priceTracker.trackToken(tokenData);
        
        const health = (priceTracker as any).tokenHealth.get(token.mint);
        if (health) {
          health.firstSeenTime = new Date(Date.now() - TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS - 1000);
          
          if (token.mint === 'inactive1') {
            health.lastTradeTime = new Date(Date.now() - TOKEN_CLEANUP_CONFIG.INACTIVITY_THRESHOLD_MS - 1000);
          }
        }
      }
      
      // Listen for metrics event
      let emittedMetrics: any;
      priceTracker.on('cleanupMetrics', (metrics) => {
        emittedMetrics = metrics;
      });
      
      await (priceTracker as any).performCleanup();
      
      expect(mockInfluxClient.writeCleanupMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          totalEvaluated: 3,
          ruggedDetected: 1,
          inactiveDetected: 1,
          actuallyRemoved: 2,
        })
      );
      
      expect(emittedMetrics).toBeDefined();
      expect(emittedMetrics.totalEvaluated).toBe(3);
    });
  });
});