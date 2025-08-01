#!/usr/bin/env ts-node

/**
 * Script to verify token tracking and platform separation
 */

import { PumpAgent } from '../src/main';
import { logger } from '../src/utils/logger';

async function verifyTokenTracking() {
  logger.info('🔍 Starting token tracking verification...');
  
  const agent = new PumpAgent();
  
  try {
    // Start the agent
    await agent.start();
    logger.info('✅ Agent started successfully');
    
    // Wait for initial connections
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Monitor for 30 seconds
    logger.info('📊 Monitoring token activity for 30 seconds...');
    
    // Set up monitoring interval
    const monitorInterval = setInterval(() => {
      const status = agent.getTrackingStatus();
      
      logger.info('🔄 Token tracking status:', {
        connected: status.isConnected,
        subscribedTokensCount: status.subscribedTokens.length,
        sampleTokens: status.subscribedTokens.slice(0, 3),
        totalTracked: status.trackerStats?.totalTokensTracked || 0,
        platformDistribution: status.platformDistribution,
        topTokens: status.trackerStats?.topTokensByVolume?.slice(0, 3)
      });
    }, 5000);
    
    // Wait for monitoring period
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Clean up
    clearInterval(monitorInterval);
    
    // Get final status
    const finalStatus = agent.getTrackingStatus();
    
    logger.info('🏁 Verification complete');
    logger.info('📈 Final statistics:', {
      totalTokensTracked: finalStatus.trackerStats?.totalTokensTracked || 0,
      platformDistribution: finalStatus.platformDistribution,
      subscribedTokens: finalStatus.subscribedTokens.length,
      topTokensByVolume: finalStatus.trackerStats?.topTokensByVolume?.slice(0, 5)
    });
    
    // Stop the agent
    await agent.stop();
    
  } catch (error) {
    logger.error('❌ Verification failed', { error });
    process.exit(1);
  }
  
  process.exit(0);
}

// Run verification
verifyTokenTracking().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});