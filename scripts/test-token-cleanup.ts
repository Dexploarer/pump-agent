#!/usr/bin/env ts-node

/**
 * Script to test token cleanup functionality
 */

import { PriceTracker } from '../src/data-collector/price-tracker';
import { InfluxClient } from '../src/database/influx-client';
import { TokenData } from '../src/database/schema';
import { logger } from '../src/utils/logger';
import { TOKEN_CLEANUP_CONFIG } from '../src/utils/constants';

// Mock InfluxClient
class MockInfluxClient extends InfluxClient {
  async connect(): Promise<void> {
    logger.info('Mock InfluxDB connected');
  }
  
  async writeTokenData(data: TokenData): Promise<void> {
    // Mock write
  }
}

async function testTokenCleanup() {
  logger.info('🧪 Starting token cleanup test...');
  
  // Create mock influx client
  const influxClient = new MockInfluxClient(
    {
      host: 'mock',
      token: 'mock',
      database: 'mock',
      organization: 'mock',
    },
    100,
    1000
  );
  
  // Create price tracker with faster cleanup interval for testing
  const priceTracker = new PriceTracker(influxClient, 5000); // 5 second analysis
  
  // Listen for cleanup events
  priceTracker.on('tokenCleanedUp', (reason) => {
    logger.info('✅ Token cleaned up in test', reason);
  });
  
  // Create test tokens
  const testTokens: TokenData[] = [
    // Active token
    {
      mint: 'active123',
      symbol: 'ACTIVE',
      name: 'Active Token',
      platform: 'pump.fun',
      platformConfidence: 1.0,
      price: 0.001,
      volume24h: 1000,
      marketCap: 100000,
      liquidity: 5000,
      priceChange24h: 5,
      volumeChange24h: 10,
      holders: 100,
      uri: 'test',
      timestamp: new Date(),
    },
    // Rugged token (95% price drop)
    {
      mint: 'rugged123',
      symbol: 'RUG',
      name: 'Rugged Token',
      platform: 'pump.fun',
      platformConfidence: 1.0,
      price: 0.00001, // Will simulate drop from 0.001
      volume24h: 0,
      marketCap: 100,
      liquidity: 50, // Below threshold
      priceChange24h: -95,
      volumeChange24h: -99,
      holders: 5,
      uri: 'test',
      timestamp: new Date(),
    },
    // Inactive token
    {
      mint: 'inactive123',
      symbol: 'DEAD',
      name: 'Dead Token',
      platform: 'letsbonk.fun',
      platformConfidence: 1.0,
      price: 0.0001,
      volume24h: 0, // No volume
      marketCap: 1000,
      liquidity: 100,
      priceChange24h: 0,
      volumeChange24h: -100,
      holders: 10,
      uri: 'test',
      timestamp: new Date(),
    },
  ];
  
  logger.info('📊 Tracking test tokens...');
  
  // Track tokens
  for (const token of testTokens) {
    await priceTracker.trackToken(token);
    logger.info(`Tracked: ${token.symbol} (${token.mint})`);
  }
  
  // Simulate price peak for rugged token
  const ruggedToken = testTokens[1];
  if (ruggedToken) {
    ruggedToken.price = 0.001; // Peak price
    await priceTracker.trackToken(ruggedToken);
    
    // Then simulate rug pull
    ruggedToken.price = 0.00001; // 99% drop
    await priceTracker.trackToken(ruggedToken);
  }
  
  // Wait for grace period to pass (simulated by modifying token health)
  logger.info('⏳ Simulating time passage for grace period...');
  
  // Manually trigger cleanup after a delay
  setTimeout(async () => {
    logger.info('🔍 Triggering manual cleanup check...');
    
    // Get stats before cleanup
    const statsBefore = priceTracker.getStats();
    logger.info('Stats before cleanup:', {
      totalTracked: statsBefore.totalTokensTracked,
      tokensCleanedUp: statsBefore.tokensCleanedUp,
    });
    
    // Force cleanup by calling private method (for testing only)
    await (priceTracker as any).performCleanup();
    
    // Get stats after cleanup
    const statsAfter = priceTracker.getStats();
    logger.info('Stats after cleanup:', {
      totalTracked: statsAfter.totalTokensTracked,
      tokensCleanedUp: statsAfter.tokensCleanedUp,
    });
    
    // Check remaining tokens
    const remainingTokens = priceTracker.getAllTokens();
    logger.info('Remaining tokens:', remainingTokens.map(t => ({
      symbol: t.symbol,
      mint: t.mint,
      platform: t.platform,
    })));
    
    // Stop price tracker
    await priceTracker.stop();
    
    logger.info('✅ Test completed');
    process.exit(0);
  }, 3000);
}

// Run test
testTokenCleanup().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});