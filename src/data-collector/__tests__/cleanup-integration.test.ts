import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { PumpAgent } from '../../main';
import { TokenData } from '../../database/schema';
import { TOKEN_CLEANUP_CONFIG } from '../../utils/constants';

// Mock modules
jest.mock('../../data-collector/websocket-client');
jest.mock('../../database/influx-client');
jest.mock('../../mcp-agent/server');

describe('Token Cleanup Integration', () => {
  let agent: PumpAgent;
  
  beforeEach(() => {
    // Save original config
    const originalConfig = { ...TOKEN_CLEANUP_CONFIG };
    
    // Configure for testing
    TOKEN_CLEANUP_CONFIG.CLEANUP_INTERVAL_MS = 1000; // 1 second for testing
    TOKEN_CLEANUP_CONFIG.NEW_TOKEN_GRACE_PERIOD_MS = 100; // 100ms for testing
    TOKEN_CLEANUP_CONFIG.INACTIVITY_THRESHOLD_MS = 500; // 500ms for testing
  });
  
  afterEach(async () => {
    if (agent) {
      await agent.stop();
    }
  });
  
  describe('full cleanup cycle', () => {
    it('should clean up rugged tokens and unsubscribe from WebSocket', async () => {
      agent = new PumpAgent();
      await agent.start();
      
      const status = agent.getTrackingStatus();
      const priceTracker = (agent as any).priceTracker;
      const pumpPortalClient = (agent as any).pumpPortalClient;
      
      // Mock unsubscribeFromTokens
      const unsubscribeSpy = jest.spyOn(pumpPortalClient, 'unsubscribeFromTokens');
      
      // Create a rugged token
      const ruggedToken: TokenData = {
        mint: 'rug_integration_123',
        symbol: 'RUGINT',
        name: 'Rugged Integration Token',
        platform: 'pump.fun',
        platformConfidence: 1.0,
        price: 0.001,
        volume24h: 10,
        marketCap: 100,
        liquidity: 10, // Very low liquidity
        priceChange24h: -98,
        volumeChange24h: -99,
        holders: 2,
        uri: 'test',
        timestamp: new Date(),
      };
      
      // Track the token
      await priceTracker.trackToken(ruggedToken);
      
      // Make it old enough to be cleaned
      const health = (priceTracker as any).tokenHealth.get('rug_integration_123');
      if (health) {
        health.firstSeenTime = new Date(Date.now() - 1000);
      }
      
      // Wait for cleanup to run
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Verify token was cleaned up
      const remainingTokens = priceTracker.getAllTokens();
      expect(remainingTokens.find(t => t.mint === 'rug_integration_123')).toBeUndefined();
      
      // Verify WebSocket unsubscription
      expect(unsubscribeSpy).toHaveBeenCalledWith(['rug_integration_123']);
    });
    
    it('should emit cleanup events that can be monitored', async () => {
      agent = new PumpAgent();
      await agent.start();
      
      const priceTracker = (agent as any).priceTracker;
      const cleanupEvents: any[] = [];
      
      // Listen for cleanup events
      priceTracker.on('tokenCleanedUp', (event: any) => {
        cleanupEvents.push(event);
      });
      
      // Create inactive token
      const inactiveToken: TokenData = {
        mint: 'inactive_integration_123',
        symbol: 'INACT',
        name: 'Inactive Integration Token',
        platform: 'letsbonk.fun',
        platformConfidence: 1.0,
        price: 0.01,
        volume24h: 5, // Low volume
        marketCap: 1000,
        liquidity: 500,
        priceChange24h: 0,
        volumeChange24h: -50,
        holders: 10,
        uri: 'test',
        timestamp: new Date(),
      };
      
      await priceTracker.trackToken(inactiveToken);
      
      // Simulate inactivity
      const health = (priceTracker as any).tokenHealth.get('inactive_integration_123');
      if (health) {
        health.firstSeenTime = new Date(Date.now() - 1000);
        health.lastTradeTime = new Date(Date.now() - 600);
        health.consecutiveZeroVolumePeriods = 3;
      }
      
      // Trigger cleanup manually
      await (priceTracker as any).performCleanup();
      
      // Verify event was emitted
      expect(cleanupEvents.length).toBeGreaterThan(0);
      expect(cleanupEvents[0]).toMatchObject({
        mint: 'inactive_integration_123',
        platform: 'letsbonk.fun',
      });
    });
  });
  
  describe('edge cases', () => {
    it('should handle cleanup when all tokens meet criteria', async () => {
      agent = new PumpAgent();
      await agent.start();
      
      const priceTracker = (agent as any).priceTracker;
      
      // Track minimum number of tokens, all rugged
      for (let i = 0; i < TOKEN_CLEANUP_CONFIG.MIN_TOKENS_TO_KEEP + 5; i++) {
        const token: TokenData = {
          mint: `rugged_${i}`,
          symbol: `RUG${i}`,
          name: `Rugged Token ${i}`,
          platform: 'pump.fun',
          platformConfidence: 1.0,
          price: 0.00001,
          volume24h: 0,
          marketCap: 1,
          liquidity: 0.1,
          priceChange24h: -99.9,
          volumeChange24h: -100,
          holders: 1,
          uri: 'test',
          timestamp: new Date(),
        };
        
        await priceTracker.trackToken(token);
        
        // Make all old enough
        const health = (priceTracker as any).tokenHealth.get(`rugged_${i}`);
        if (health) {
          health.firstSeenTime = new Date(Date.now() - 1000);
        }
      }
      
      const tokensBefore = priceTracker.getAllTokens().length;
      
      // Trigger cleanup
      await (priceTracker as any).performCleanup();
      
      const tokensAfter = priceTracker.getAllTokens().length;
      
      // Should maintain minimum tokens
      expect(tokensAfter).toBeGreaterThanOrEqual(TOKEN_CLEANUP_CONFIG.MIN_TOKENS_TO_KEEP);
      
      // Should remove only the allowed percentage
      const maxRemoval = Math.floor(tokensBefore * TOKEN_CLEANUP_CONFIG.MAX_CLEANUP_PERCENTAGE);
      expect(tokensBefore - tokensAfter).toBeLessThanOrEqual(maxRemoval);
    });
    
    it('should handle concurrent updates during cleanup', async () => {
      agent = new PumpAgent();
      await agent.start();
      
      const priceTracker = (agent as any).priceTracker;
      
      // Track a token
      const token: TokenData = {
        mint: 'concurrent_123',
        symbol: 'CONC',
        name: 'Concurrent Token',
        platform: 'pump.fun',
        platformConfidence: 1.0,
        price: 0.001,
        volume24h: 0,
        marketCap: 100,
        liquidity: 10,
        priceChange24h: -95,
        volumeChange24h: -100,
        holders: 5,
        uri: 'test',
        timestamp: new Date(),
      };
      
      await priceTracker.trackToken(token);
      
      const health = (priceTracker as any).tokenHealth.get('concurrent_123');
      if (health) {
        health.firstSeenTime = new Date(Date.now() - 1000);
      }
      
      // Start cleanup
      const cleanupPromise = (priceTracker as any).performCleanup();
      
      // Update token during cleanup
      await priceTracker.trackToken({
        ...token,
        price: 0.1, // Price recovered
        volume24h: 1000, // Volume recovered
        liquidity: 1000, // Liquidity recovered
      });
      
      await cleanupPromise;
      
      // Token should still exist if update was processed
      const remainingTokens = priceTracker.getAllTokens();
      const concurrentToken = remainingTokens.find(t => t.mint === 'concurrent_123');
      
      // This test verifies that the system handles race conditions gracefully
      expect(concurrentToken).toBeDefined();
    });
  });
});