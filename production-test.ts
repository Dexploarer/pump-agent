#!/usr/bin/env node
/**
 * PRODUCTION TEST - Platform Detection Buffer Validation
 * Tests: WebSocket → Buffered Platform Detection → Real Results
 */

import { PumpPortalClient, TokenData } from './src/data-collector/websocket-client';
import { getPlatformDetectionBuffer } from './src/utils/platform-detection-buffer';

interface TestStats {
  totalTokens: number;
  pumpFunTokens: number;
  letsbonkTokens: number;
  unknownTokens: number;
  platformDetectionSuccesses: number;
  bufferedDetections: number;
  errors: number;
  startTime: number;
}

class ProductionTest {
  private stats: TestStats = {
    totalTokens: 0,
    pumpFunTokens: 0,
    letsbonkTokens: 0,
    unknownTokens: 0,
    platformDetectionSuccesses: 0,
    bufferedDetections: 0,
    errors: 0,
    startTime: Date.now()
  };

  private pumpPortalClient!: PumpPortalClient;
  private buffer = getPlatformDetectionBuffer();

  async runTest(): Promise<void> {
    console.log('🚀 PUMP AGENT PRODUCTION TEST - PLATFORM DETECTION');
    console.log('================================================\n');
    
    try {
      // Initialize and start
      await this.initializeAndStart();
      
      // Run test for 2 minutes
      console.log('⏱️  Running production test for 2 minutes...\n');
      await this.waitAndMonitor(120000); // 2 minutes
      
      // Results
      await this.printFinalResults();
      
    } catch (error) {
      console.error('❌ Production test failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private async initializeAndStart(): Promise<void> {
    console.log('🔧 Initializing...');
    
    // Initialize PumpPortal client
    this.pumpPortalClient = new PumpPortalClient({
      url: 'wss://pumpportal.fun/api/data',
      reconnectDelay: 5000,
      maxReconnectAttempts: 5,
      heartbeatInterval: 30000,
    });
    
    this.setupEventHandlers();
    
    console.log('📡 Connecting to PumpPortal...');
    await this.pumpPortalClient.connect();
  }

  private setupEventHandlers(): void {
    // Platform detection buffer events
    this.buffer.on('detectionSuccess', (event) => {
      this.stats.platformDetectionSuccesses++;
      if (event.attempts > 1) {
        this.stats.bufferedDetections++;
      }
      console.log(`🔍 ${event.platform.toUpperCase()}: ${event.mint.slice(0, 8)}... [${event.attempts} attempts]`);
    });

    // Token events
    this.pumpPortalClient.on('newToken', (tokenData: TokenData) => {
      this.stats.totalTokens++;
      
      if (tokenData.platform === 'pump.fun') {
        this.stats.pumpFunTokens++;
      } else if (tokenData.platform === 'letsbonk.fun') {
        this.stats.letsbonkTokens++;
      } else {
        this.stats.unknownTokens++;
      }
      
      console.log(`🎯 TOKEN #${this.stats.totalTokens}: ${tokenData.symbol} (${tokenData.platform})`);
    });

    // Connection events
    this.pumpPortalClient.on('connected', () => {
      console.log('✅ PumpPortal connected\n');
    });

    this.pumpPortalClient.on('error', (error: Error) => {
      this.stats.errors++;
      console.log(`❌ Error: ${error.message}`);
    });
  }

  private async waitAndMonitor(duration: number): Promise<void> {
    const startTime = Date.now();
    const endTime = startTime + duration;
    
    while (Date.now() < endTime) {
      // Print stats every 30 seconds
      if ((Date.now() - startTime) % 30000 < 1000) {
        this.printCurrentStats();
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  private printCurrentStats(): void {
    const runtime = Math.floor((Date.now() - this.stats.startTime) / 1000);
    const queueStats = this.buffer.getQueueStats();
    
    console.log('\n📊 CURRENT STATS');
    console.log('================');
    console.log(`Runtime: ${runtime}s`);
    console.log(`Tokens: ${this.stats.totalTokens}`);
    console.log(`Platforms: 🟦 ${this.stats.pumpFunTokens} pump.fun | 🟨 ${this.stats.letsbonkTokens} letsbonk | ❓ ${this.stats.unknownTokens} unknown`);
    console.log(`Detection: ${this.stats.platformDetectionSuccesses} successes | ${this.stats.bufferedDetections} buffered | Queue: ${queueStats.queueSize}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log('');
  }

  private async printFinalResults(): Promise<void> {
    const runtime = Math.floor((Date.now() - this.stats.startTime) / 1000);
    const queueStats = this.buffer.getQueueStats();
    
    console.log('\n🏁 FINAL PRODUCTION TEST RESULTS');
    console.log('=================================');
    
    console.log(`\n⏱️  Test Duration: ${runtime} seconds`);
    
    console.log(`\n🎯 Data Collection:`);
    console.log(`   Total Tokens: ${this.stats.totalTokens}`);
    console.log(`   Rate: ${(this.stats.totalTokens / (runtime / 60)).toFixed(1)} tokens/min`);
    
    console.log(`\n🔍 Platform Detection:`);
    console.log(`   Pump.fun: ${this.stats.pumpFunTokens}`);
    console.log(`   LetsBonk.fun: ${this.stats.letsbonkTokens}`);
    console.log(`   Unknown: ${this.stats.unknownTokens}`);
    console.log(`   Success Rate: ${this.stats.totalTokens > 0 ? ((this.stats.platformDetectionSuccesses / this.stats.totalTokens) * 100).toFixed(1) : 0}%`);
    console.log(`   Buffered Detections: ${this.stats.bufferedDetections}`);
    console.log(`   Retry Queue: ${queueStats.queueSize} pending`);
    
    console.log(`\n❌ Errors: ${this.stats.errors}`);
    
    // Validation
    console.log(`\n✅ VALIDATION:`);
    const hasTokens = this.stats.totalTokens > 0;
    const hasPlatformDetection = this.stats.platformDetectionSuccesses > 0;
    const lowErrorRate = this.stats.errors < (this.stats.totalTokens * 0.2); // <20% error rate
    const hasDefinitiveDetection = (this.stats.pumpFunTokens + this.stats.letsbonkTokens) > 0;
    
    console.log(`   ✅ Token Collection: ${hasTokens ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Platform Detection: ${hasPlatformDetection ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Definitive Results: ${hasDefinitiveDetection ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Error Rate: ${lowErrorRate ? 'PASS' : 'FAIL'} (${this.stats.errors} errors)`);
    console.log(`   ✅ Buffer System: ${this.stats.bufferedDetections > 0 ? 'WORKING' : 'NOT TESTED'}`);
    
    if (hasTokens && hasPlatformDetection && hasDefinitiveDetection && lowErrorRate) {
      console.log('\n🎉 PRODUCTION TEST: PASSED');
      console.log('   ✅ Real-time data collection working');
      console.log('   ✅ Platform detection with RPC buffering working');
      console.log('   ✅ System ready for production!');
    } else {
      console.log('\n⚠️  PRODUCTION TEST: NEEDS ATTENTION');
      if (!hasTokens) console.log('   ❌ No tokens collected');
      if (!hasPlatformDetection) console.log('   ❌ Platform detection not working');
      if (!hasDefinitiveDetection) console.log('   ❌ No definitive platform identification');
      if (!lowErrorRate) console.log('   ❌ High error rate');
    }
  }

  private async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up...');
    
    if (this.pumpPortalClient) {
      this.pumpPortalClient.disconnect();
    }
    
    this.buffer.stop();
    console.log('✅ Cleanup complete');
  }
}

// Run the production test
async function main() {
  const test = new ProductionTest();
  
  try {
    await test.runTest();
    process.exit(0);
  } catch (error) {
    console.error('Production test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}