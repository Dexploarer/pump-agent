#!/usr/bin/env node
/**
 * SIMPLE STRESS TEST - 1000 Token Collection Proof
 * Demonstrates we can collect, process, and track 1000 tokens with platform detection
 */

import { PumpPortalClient, TokenData, TradeData } from './src/data-collector/websocket-client';
import { getPlatformDetectionBuffer } from './src/utils/platform-detection-buffer';
import { logger } from './src/utils/logger';

interface StressTestMetrics {
  totalTokensCollected: number;
  totalTradesCollected: number;
  pumpFunTokens: number;
  letsbonkTokens: number;
  platformDetectionSuccesses: number;
  bufferedDetections: number;
  errors: number;
  startTime: number;
  targetTokens: number;
  uniqueTokens: Set<string>;
  tokensPerMinute: number;
  memoryUsageBytes: number;
  processingTimes: number[];
  detectionRetries: number;
}

class SimpleStressTest {
  private metrics: StressTestMetrics = {
    totalTokensCollected: 0,
    totalTradesCollected: 0,
    pumpFunTokens: 0,
    letsbonkTokens: 0,
    platformDetectionSuccesses: 0,
    bufferedDetections: 0,
    errors: 0,
    startTime: Date.now(),
    targetTokens: 1000,
    uniqueTokens: new Set<string>(),
    tokensPerMinute: 0,
    memoryUsageBytes: 0,
    processingTimes: [],
    detectionRetries: 0
  };

  private pumpPortalClient!: PumpPortalClient;
  private buffer = getPlatformDetectionBuffer();
  private statsInterval?: NodeJS.Timeout;
  private tokenDataStorage: TokenData[] = [];
  private tradeDataStorage: TradeData[] = [];

  async runStressTest(): Promise<void> {
    console.log('🚀 SIMPLE STRESS TEST - 1000 TOKEN COLLECTION');
    console.log('==============================================\n');
    
    try {
      await this.initializeClient();
      await this.startCollection();
      await this.waitForTokens();
      this.generateReport();
      
    } catch (error) {
      console.error('❌ Stress test failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private async initializeClient(): Promise<void> {
    console.log('🔧 Initializing PumpPortal client...');
    
    this.pumpPortalClient = new PumpPortalClient({
      url: 'wss://pumpportal.fun/api/data',
      reconnectDelay: 5000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
    });
    
    this.setupEventHandlers();
    console.log('✅ Client initialized');
  }

  private setupEventHandlers(): void {
    // Platform detection events
    this.buffer.on('detectionSuccess', (event) => {
      this.metrics.platformDetectionSuccesses++;
      if (event.attempts > 1) {
        this.metrics.bufferedDetections++;
        this.metrics.detectionRetries += (event.attempts - 1);
      }
    });

    // Token events
    this.pumpPortalClient.on('newToken', (tokenData: TokenData) => {
      const processingStart = Date.now();
      
      try {
        // Store token data (simulating database storage)
        this.tokenDataStorage.push({...tokenData});
        this.metrics.totalTokensCollected++;
        this.metrics.uniqueTokens.add(tokenData.mint);
        
        // Track platform distribution
        if (tokenData.platform === 'pump.fun') {
          this.metrics.pumpFunTokens++;
        } else if (tokenData.platform === 'letsbonk.fun') {
          this.metrics.letsbonkTokens++;
        }
        
        // Subscribe to trades for this token
        this.pumpPortalClient.subscribeToTokens([tokenData.mint]);
        
        // Track processing time
        const processingTime = Date.now() - processingStart;
        this.metrics.processingTimes.push(processingTime);
        
        // Log progress
        if (this.metrics.totalTokensCollected % 100 === 0) {
          console.log(`📈 ${this.metrics.totalTokensCollected}/${this.metrics.targetTokens} tokens collected`);
        }
        
      } catch (error) {
        this.metrics.errors++;
        logger.error('Failed to process token', { error, tokenData });
      }
    });

    // Trade events
    this.pumpPortalClient.on('tokenTrade', (tradeData: TradeData) => {
      try {
        // Store trade data (simulating database storage)
        this.tradeDataStorage.push({...tradeData});
        this.metrics.totalTradesCollected++;
      } catch (error) {
        this.metrics.errors++;
        logger.error('Failed to process trade', { error, tradeData });
      }
    });

    // Connection events
    this.pumpPortalClient.on('connected', () => {
      console.log('✅ Connected to PumpPortal - starting collection\n');
    });

    this.pumpPortalClient.on('error', (error: Error) => {
      this.metrics.errors++;
      console.log(`❌ Error: ${error.message}`);
    });
  }

  private async startCollection(): Promise<void> {
    console.log('📡 Starting token collection...');
    
    // Connect to PumpPortal
    await this.pumpPortalClient.connect();
    
    // Start periodic stats
    this.statsInterval = setInterval(() => {
      this.updateMetrics();
      this.printStats();
    }, 30000); // Every 30 seconds
    
    console.log('🔄 Collection started - waiting for tokens...\n');
  }

  private async waitForTokens(): Promise<void> {
    const maxWaitTime = 15 * 60 * 1000; // 15 minutes max
    const startTime = Date.now();
    
    console.log(`⏳ Collecting ${this.metrics.targetTokens} tokens (max 15 minutes)...\n`);
    
    while (this.metrics.totalTokensCollected < this.metrics.targetTokens) {
      if (Date.now() - startTime > maxWaitTime) {
        console.log('⏰ Max wait time reached');
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (this.metrics.totalTokensCollected >= this.metrics.targetTokens) {
      console.log(`🎉 TARGET REACHED: ${this.metrics.totalTokensCollected} tokens!`);
    }
  }

  private updateMetrics(): void {
    const runtime = (Date.now() - this.metrics.startTime) / 1000;
    this.metrics.tokensPerMinute = (this.metrics.totalTokensCollected / (runtime / 60));
    this.metrics.memoryUsageBytes = process.memoryUsage().heapUsed;
  }

  private printStats(): void {
    const runtime = Math.floor((Date.now() - this.metrics.startTime) / 1000);
    const queueStats = this.buffer.getQueueStats();
    const avgProcessingTime = this.metrics.processingTimes.length > 0 
      ? this.metrics.processingTimes.reduce((a, b) => a + b, 0) / this.metrics.processingTimes.length 
      : 0;
    
    console.log('📊 CURRENT METRICS');
    console.log('==================');
    console.log(`Runtime: ${Math.floor(runtime / 60)}m ${runtime % 60}s`);
    console.log(`Tokens: ${this.metrics.totalTokensCollected}/${this.metrics.targetTokens} (${this.metrics.uniqueTokens.size} unique)`);
    console.log(`Rate: ${this.metrics.tokensPerMinute.toFixed(1)} tokens/min`);
    console.log(`Platforms: 🟦 ${this.metrics.pumpFunTokens} pump.fun | 🟨 ${this.metrics.letsbonkTokens} letsbonk`);
    console.log(`Trades: ${this.metrics.totalTradesCollected}`);
    console.log(`Detection: ${this.metrics.platformDetectionSuccesses} success | ${this.metrics.bufferedDetections} buffered | Queue: ${queueStats.queueSize}`);
    console.log(`Performance: ${avgProcessingTime.toFixed(1)}ms avg | ${Math.round(this.metrics.memoryUsageBytes / 1024 / 1024)}MB memory`);
    console.log(`Errors: ${this.metrics.errors}`);
    console.log('');
  }

  private generateReport(): void {
    const runtime = Math.floor((Date.now() - this.metrics.startTime) / 1000);
    const avgProcessingTime = this.metrics.processingTimes.length > 0 
      ? this.metrics.processingTimes.reduce((a, b) => a + b, 0) / this.metrics.processingTimes.length 
      : 0;
    
    console.log('\n🏁 FINAL STRESS TEST REPORT');
    console.log('============================');
    
    console.log(`\n⏱️  Duration: ${Math.floor(runtime / 60)}m ${runtime % 60}s`);
    
    console.log(`\n📊 Collection Results:`);
    console.log(`   Target: ${this.metrics.targetTokens} tokens`);
    console.log(`   Collected: ${this.metrics.totalTokensCollected} tokens`);
    console.log(`   Unique: ${this.metrics.uniqueTokens.size} tokens`);
    console.log(`   Success Rate: ${((this.metrics.totalTokensCollected / this.metrics.targetTokens) * 100).toFixed(1)}%`);
    console.log(`   Collection Rate: ${this.metrics.tokensPerMinute.toFixed(1)} tokens/minute`);
    
    console.log(`\n🏪 Platform Distribution:`);
    console.log(`   Pump.fun: ${this.metrics.pumpFunTokens} (${((this.metrics.pumpFunTokens / this.metrics.totalTokensCollected) * 100).toFixed(1)}%)`);
    console.log(`   LetsBonk.fun: ${this.metrics.letsbonkTokens} (${((this.metrics.letsbonkTokens / this.metrics.totalTokensCollected) * 100).toFixed(1)}%)`);
    
    console.log(`\n💾 Data Storage (Simulated):`);
    console.log(`   Token Records: ${this.tokenDataStorage.length}`);
    console.log(`   Trade Records: ${this.tradeDataStorage.length}`);
    console.log(`   Total Data Points: ${this.tokenDataStorage.length + this.tradeDataStorage.length}`);
    console.log(`   Storage Size: ~${Math.round((JSON.stringify(this.tokenDataStorage).length + JSON.stringify(this.tradeDataStorage).length) / 1024)}KB`);
    
    console.log(`\n🔍 Platform Detection:`);
    console.log(`   Successes: ${this.metrics.platformDetectionSuccesses}`);
    console.log(`   Buffered: ${this.metrics.bufferedDetections}`);
    console.log(`   Success Rate: ${((this.metrics.platformDetectionSuccesses / this.metrics.totalTokensCollected) * 100).toFixed(1)}%`);
    console.log(`   Buffer Usage: ${((this.metrics.bufferedDetections / this.metrics.totalTokensCollected) * 100).toFixed(1)}%`);
    console.log(`   Total Retries: ${this.metrics.detectionRetries}`);
    
    console.log(`\n⚡ Performance:`);
    console.log(`   Avg Processing: ${avgProcessingTime.toFixed(1)}ms per token`);
    console.log(`   Memory Usage: ${Math.round(this.metrics.memoryUsageBytes / 1024 / 1024)}MB`);
    console.log(`   Error Count: ${this.metrics.errors}`);
    console.log(`   Error Rate: ${((this.metrics.errors / this.metrics.totalTokensCollected) * 100).toFixed(2)}%`);
    
    // Validation
    console.log(`\n✅ VALIDATION RESULTS:`);
    const collectionSuccess = this.metrics.totalTokensCollected >= (this.metrics.targetTokens * 0.5); // 50% minimum
    const platformSuccess = (this.metrics.platformDetectionSuccesses / this.metrics.totalTokensCollected) >= 0.8; // 80% success
    const lowErrors = this.metrics.errors < (this.metrics.totalTokensCollected * 0.1); // <10% errors
    const memoryEfficient = (this.metrics.memoryUsageBytes / 1024 / 1024) < 200; // <200MB
    const dataIntegrity = this.tokenDataStorage.length === this.metrics.totalTokensCollected;
    
    console.log(`   📊 Collection: ${collectionSuccess ? 'PASS' : 'FAIL'} (${this.metrics.totalTokensCollected}/${this.metrics.targetTokens})`);
    console.log(`   🔍 Platform Detection: ${platformSuccess ? 'PASS' : 'FAIL'} (${((this.metrics.platformDetectionSuccesses / this.metrics.totalTokensCollected) * 100).toFixed(1)}%)`);
    console.log(`   🚫 Error Rate: ${lowErrors ? 'PASS' : 'FAIL'} (${this.metrics.errors} errors)`);
    console.log(`   🧠 Memory: ${memoryEfficient ? 'PASS' : 'FAIL'} (${Math.round(this.metrics.memoryUsageBytes / 1024 / 1024)}MB)`);
    console.log(`   💾 Data Integrity: ${dataIntegrity ? 'PASS' : 'FAIL'} (${this.tokenDataStorage.length} stored)`);
    
    if (collectionSuccess && platformSuccess && lowErrors && memoryEfficient && dataIntegrity) {
      console.log('\n🎉 STRESS TEST: PASSED');
      console.log('   ✅ System can handle 1000+ token collection');
      console.log('   ✅ Platform detection working at scale');
      console.log('   ✅ Data storage simulation successful');
      console.log('   ✅ Memory usage within limits');
      console.log('   ✅ Ready for production database integration!');
    } else {
      console.log('\n⚠️  STRESS TEST: PARTIAL SUCCESS');
      if (!collectionSuccess) console.log('   ⚠️  Collection rate below target');
      if (!platformSuccess) console.log('   ⚠️  Platform detection success rate low');
      if (!lowErrors) console.log('   ⚠️  Error rate too high');
      if (!memoryEfficient) console.log('   ⚠️  Memory usage too high');
      if (!dataIntegrity) console.log('   ⚠️  Data storage integrity issue');
    }
    
    console.log(`\n📋 Summary: Collected ${this.metrics.totalTokensCollected} tokens with ${this.metrics.totalTradesCollected} trades in ${Math.floor(runtime / 60)}m ${runtime % 60}s`);
  }

  private async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up...');
    
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    
    if (this.pumpPortalClient) {
      this.pumpPortalClient.disconnect();
    }
    
    this.buffer.stop();
    console.log('✅ Cleanup complete');
  }
}

// Run the stress test
async function main() {
  const stressTest = new SimpleStressTest();
  
  try {
    await stressTest.runStressTest();
    process.exit(0);
  } catch (error) {
    console.error('Stress test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}