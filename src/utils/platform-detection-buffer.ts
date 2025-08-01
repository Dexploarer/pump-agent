/**
 * Platform Detection Buffer System
 * Handles RPC delays for newly minted tokens with retry mechanism
 */

import { EventEmitter } from 'events';
import { getMintOrigin, Platform } from './platform-detection';
import { logger } from './logger';

interface RetryInfo {
  mint: string;
  attempts: number;
  lastAttempt: number;
  created: number;
  resolve?: (result: Platform) => void;
  reject?: (error: Error) => void;
}

export class PlatformDetectionBuffer extends EventEmitter {
  private retryQueue = new Map<string, RetryInfo>();
  private processingQueue = new Set<string>();
  private processTimer: NodeJS.Timeout | null = null;
  
  // Configuration
  private readonly maxRetries = 3;
  private readonly retryDelays = [10000, 30000, 60000]; // 10s, 30s, 60s
  private readonly maxAge = 300000; // 5 minutes max age
  
  constructor() {
    super();
    this.startProcessing();
  }

  /**
   * Detect platform with buffering for new tokens
   */
  public async detectWithBuffer(mint: string): Promise<Platform> {
    logger.debug('Platform detection requested', { mint });
    
    // Check if already in retry queue
    const existing = this.retryQueue.get(mint);
    if (existing) {
      logger.debug('Token already in retry queue', { mint, attempts: existing.attempts });
      
      // Return promise that resolves when detection completes
      return new Promise<Platform>((resolve, reject) => {
        existing.resolve = resolve;
        existing.reject = reject;
      });
    }
    
    // Try immediate detection first
    try {
      const result = await getMintOrigin(mint);
      
      if (result.platform !== 'unknown' && result.confidence > 0.8) {
        logger.debug('Immediate platform detection successful', { 
          mint, 
          platform: result.platform,
          method: result.method 
        });
        return result.platform;
      }
      
      // If detection failed or low confidence, add to retry queue
      logger.debug('Adding to retry queue due to failed/low confidence detection', { 
        mint, 
        platform: result.platform,
        confidence: result.confidence 
      });
      
      return this.addToRetryQueue(mint);
      
    } catch (error) {
      logger.debug('Initial detection failed, adding to retry queue', { 
        mint, 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      return this.addToRetryQueue(mint);
    }
  }

  /**
   * Add token to retry queue for later detection
   */
  private addToRetryQueue(mint: string): Promise<Platform> {
    return new Promise<Platform>((resolve, reject) => {
      const retryInfo: RetryInfo = {
        mint,
        attempts: 0,
        lastAttempt: 0,
        created: Date.now(),
        resolve,
        reject
      };
      
      this.retryQueue.set(mint, retryInfo);
      logger.debug('Token added to retry queue', { mint, queueSize: this.retryQueue.size });
    });
  }

  /**
   * Start the retry queue processor
   */
  private startProcessing(): void {
    this.processTimer = setInterval(() => {
      void this.processRetryQueue();
    }, 5000); // Check every 5 seconds
  }

  /**
   * Process tokens in the retry queue
   */
  private processRetryQueue(): void {
    if (this.retryQueue.size === 0) return;
    
    const now = Date.now();
    const toProcess: RetryInfo[] = [];
    const toRemove: string[] = [];
    
    // Find tokens ready for retry
    for (const [mint, retryInfo] of this.retryQueue) {
      // Remove expired entries
      if (now - retryInfo.created > this.maxAge) {
        logger.debug('Removing expired token from retry queue', { mint });
        retryInfo.reject?.(new Error('Detection timeout'));
        toRemove.push(mint);
        continue;
      }
      
      // Check if it's time for next retry
      if (retryInfo.attempts < this.maxRetries) {
        const delay = this.retryDelays[retryInfo.attempts] || this.retryDelays[this.retryDelays.length - 1] || 5000;
        
        if (now - retryInfo.lastAttempt >= delay) {
          toProcess.push(retryInfo);
        }
      } else {
        // Max retries reached
        logger.warn('Max retries reached for token', { mint });
        retryInfo.resolve?.('unknown');
        toRemove.push(mint);
      }
    }
    
    // Remove expired/completed entries
    toRemove.forEach(mint => {
      this.retryQueue.delete(mint);
    });
    
    // Process retry attempts
    for (const retryInfo of toProcess) {
      if (this.processingQueue.has(retryInfo.mint)) {
        continue; // Already processing this token
      }
      
      void this.attemptDetection(retryInfo);
    }
  }

  /**
   * Attempt platform detection for a token
   */
  private async attemptDetection(retryInfo: RetryInfo): Promise<void> {
    const { mint } = retryInfo;
    this.processingQueue.add(mint);
    
    try {
      retryInfo.attempts++;
      retryInfo.lastAttempt = Date.now();
      
      logger.debug('Attempting platform detection', { 
        mint, 
        attempt: retryInfo.attempts,
        maxRetries: this.maxRetries 
      });
      
      const result = await getMintOrigin(mint);
      
      if (result.platform !== 'unknown' && result.confidence > 0.8) {
        // Success!
        logger.info('Platform detection successful after retry', { 
          mint, 
          platform: result.platform,
          attempts: retryInfo.attempts,
          method: result.method,
          confidence: result.confidence
        });
        
        retryInfo.resolve?.(result.platform);
        this.retryQueue.delete(mint);
        
        // Emit success event
        this.emit('detectionSuccess', {
          mint,
          platform: result.platform,
          attempts: retryInfo.attempts,
          result
        });
        
      } else {
        // Still failed, will retry later if attempts remain
        logger.debug('Platform detection still failed', { 
          mint, 
          attempt: retryInfo.attempts,
          platform: result.platform,
          confidence: result.confidence
        });
      }
      
    } catch (error) {
      logger.debug('Platform detection attempt failed', { 
        mint, 
        attempt: retryInfo.attempts,
        error: error instanceof Error ? error.message : String(error) 
      });
    } finally {
      this.processingQueue.delete(mint);
    }
  }

  /**
   * Get current queue statistics
   */
  public getQueueStats(): {
    queueSize: number;
    processing: number;
    byAttempts: Record<number, number>;
    oldestEntry: number | null;
  } {
    const byAttempts: Record<number, number> = {};
    let oldestEntry: number | null = null;
    
    for (const retryInfo of this.retryQueue.values()) {
      byAttempts[retryInfo.attempts] = (byAttempts[retryInfo.attempts] || 0) + 1;
      
      if (oldestEntry === null || retryInfo.created < oldestEntry) {
        oldestEntry = retryInfo.created;
      }
    }
    
    return {
      queueSize: this.retryQueue.size,
      processing: this.processingQueue.size,
      byAttempts,
      oldestEntry
    };
  }

  /**
   * Clear the retry queue (for testing/cleanup)
   */
  public clearQueue(): void {
    // Reject all pending promises
    for (const retryInfo of this.retryQueue.values()) {
      retryInfo.reject?.(new Error('Queue cleared'));
    }
    
    this.retryQueue.clear();
    this.processingQueue.clear();
    logger.info('Platform detection retry queue cleared');
  }

  /**
   * Stop the buffer system
   */
  public stop(): void {
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
    
    this.clearQueue();
    logger.info('Platform detection buffer stopped');
  }
}

// Singleton instance
let bufferInstance: PlatformDetectionBuffer | null = null;

/**
 * Get the singleton buffer instance
 */
export function getPlatformDetectionBuffer(): PlatformDetectionBuffer {
  if (!bufferInstance) {
    bufferInstance = new PlatformDetectionBuffer();
  }
  return bufferInstance;
}

/**
 * Convenience function for buffered platform detection
 * Returns only valid platforms for token data (no 'unknown')
 */
export async function detectPlatformWithBuffer(mint: string): Promise<'pump.fun' | 'letsbonk.fun'> {
  const buffer = getPlatformDetectionBuffer();
  const result = await buffer.detectWithBuffer(mint);
  
  // Convert 'unknown' to default platform
  return result === 'unknown' ? 'pump.fun' : result;
}