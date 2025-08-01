/**
 * AUTHORITATIVE Platform Detection for Solana Tokens
 * Correctly identifies pump.fun vs letsbonk.fun using Program IDs and mint patterns
 * Based on the definitive research provided
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from './logger';

export type Platform = 'pump.fun' | 'letsbonk.fun' | 'unknown';

export interface PlatformResult {
  platform: Platform;
  confidence: number;
  method: 'program_id' | 'mint_pattern' | 'rpc_analysis' | 'fallback';
  programId?: string;
  mintPattern?: string;
  timestamp: number;
}

// AUTHORITATIVE Program IDs for each platform
const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const LETSBONK_PROGRAM_ID = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';

// RPC endpoint
const RPC_ENDPOINT = process.env['SOLANA_RPC_URL'] || "https://api.mainnet-beta.solana.com";

// Cache for performance
const platformCache = new Map<string, PlatformResult>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Method 1: Check Program ID (Most Reliable)
 * This is the authoritative method using smart contract addresses
 */
function identifyTokenPlatform(programId: string): Platform {
  if (programId === PUMP_PROGRAM_ID) return 'pump.fun';
  if (programId === LETSBONK_PROGRAM_ID) return 'letsbonk.fun';
  return 'unknown';
}

/**
 * Method 2: Check Mint Address Suffix (Quick Filter)
 * pump.fun tokens end with "pump", letsbonk.fun tokens end with "bonk"
 */
function identifyTokenByMint(mintAddress: string): Platform {
  if (mintAddress.endsWith('pump')) return 'pump.fun';
  if (mintAddress.endsWith('bonk')) return 'letsbonk.fun';
  return 'unknown';
}

/**
 * Method 3: Combined Approach (Recommended)
 * Uses both Program ID and mint pattern for maximum accuracy
 */
export async function getMintOrigin(mintStr: string): Promise<PlatformResult> {
  // Check cache first
  const cached = platformCache.get(mintStr);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    logger.debug('Platform detection cache hit', { mint: mintStr, platform: cached.platform });
    return cached;
  }

  try {
    // Quick check: Mint address pattern (fastest method)
    const mintPatternResult = identifyTokenByMint(mintStr);
    if (mintPatternResult !== 'unknown') {
      logger.debug('Platform detected via mint pattern', { 
        mint: mintStr, 
        platform: mintPatternResult,
        pattern: mintStr.slice(-4)
      });
      
      const result: PlatformResult = {
        platform: mintPatternResult,
        confidence: 0.99, // Very high confidence for vanity addresses
        method: 'mint_pattern',
        mintPattern: mintStr.slice(-4),
        timestamp: Date.now()
      };
      platformCache.set(mintStr, result);
      return result;
    }

    // If mint pattern doesn't match, try RPC Program ID lookup
    const conn = new Connection(RPC_ENDPOINT, "confirmed");
    const mintPub = new PublicKey(mintStr);

    // Get the first transaction to find the program ID
    const signatures = await conn.getSignaturesForAddress(mintPub, { limit: 1000 });
    
    if (signatures.length === 0) {
      logger.warn('No transaction history found', { mint: mintStr });
      const result: PlatformResult = {
        platform: 'unknown',
        confidence: 0,
        method: 'fallback',
        timestamp: Date.now()
      };
      platformCache.set(mintStr, result);
      return result;
    }

    // Get the oldest (creation) transaction
    const oldestSignature = signatures[signatures.length - 1];
    if (!oldestSignature) {
      logger.warn('No oldest signature found', { mint: mintStr });
      const result: PlatformResult = {
        platform: 'unknown',
        confidence: 0,
        method: 'fallback',
        timestamp: Date.now()
      };
      platformCache.set(mintStr, result);
      return result;
    }
    
    const transaction = await conn.getParsedTransaction(oldestSignature.signature, {
      commitment: "confirmed"
    });

    if (!transaction || !transaction.transaction.message.instructions[0]) {
      logger.warn('Could not parse creation transaction', { mint: mintStr });
      const result: PlatformResult = {
        platform: 'unknown',
        confidence: 0,
        method: 'fallback',
        timestamp: Date.now()
      };
      platformCache.set(mintStr, result);
      return result;
    }

    // Extract program ID from first instruction
    const firstInstruction = transaction.transaction.message.instructions[0] as any;
    const programId = firstInstruction.programId.toString();
    
    // Identify platform by program ID
    const platform = identifyTokenPlatform(programId);
    
    if (platform !== 'unknown') {
      logger.debug('Platform detected via program ID', { 
        mint: mintStr, 
        platform,
        programId 
      });
      
      const result: PlatformResult = {
        platform,
        confidence: 0.95, // High confidence for program ID match
        method: 'program_id',
        programId,
        timestamp: Date.now()
      };
      platformCache.set(mintStr, result);
      return result;
    }

    // If we get here, it's an unknown platform
    logger.info('Unknown platform detected', { mint: mintStr, programId });
    const result: PlatformResult = {
      platform: 'unknown',
      confidence: 0,
      method: 'rpc_analysis',
      programId,
      timestamp: Date.now()
    };
    platformCache.set(mintStr, result);
    return result;

  } catch (error) {
    logger.error('Platform detection failed', { 
      mint: mintStr, 
      error: error instanceof Error ? error.message : String(error) 
    });
    
    const result: PlatformResult = {
      platform: 'unknown',
      confidence: 0,
      method: 'fallback',
      timestamp: Date.now()
    };
    platformCache.set(mintStr, result);
    return result;
  }
}

/**
 * Simple platform detection that returns just the platform
 */
export async function detectPlatformFromMint(mintStr: string): Promise<Platform> {
  const result = await getMintOrigin(mintStr);
  return result.platform;
}

/**
 * Parse token platform with both mint and program ID data
 * Use this when you have both pieces of information
 */
export function parseTokenPlatform(tokenData: {mint: string, programId?: string}): {
  mint: string;
  programId?: string;
  platform: Platform;
  confidence: number;
  method: string;
} {
  // Primary check: Program ID (if available)
  if (tokenData.programId) {
    const platformFromProgram = identifyTokenPlatform(tokenData.programId);
    if (platformFromProgram !== 'unknown') {
      return {
        mint: tokenData.mint,
        programId: tokenData.programId,
        platform: platformFromProgram,
        confidence: 0.99,
        method: 'program_id'
      };
    }
  }
  
  // Fallback: Mint address pattern
  const platformFromMint = identifyTokenByMint(tokenData.mint);
  return {
    mint: tokenData.mint,
    programId: tokenData.programId,
    platform: platformFromMint,
    confidence: platformFromMint !== 'unknown' ? 0.99 : 0,
    method: platformFromMint !== 'unknown' ? 'mint_pattern' : 'fallback'
  };
}

/**
 * Batch platform detection for multiple mints
 */
export async function detectPlatformsBatch(mints: string[]): Promise<Map<string, PlatformResult>> {
  const results = new Map<string, PlatformResult>();
  
  // Process in batches to avoid overwhelming RPC
  const batchSize = 10;
  const batches = [];
  
  for (let i = 0; i < mints.length; i += batchSize) {
    batches.push(mints.slice(i, i + batchSize));
  }
  
  for (const batch of batches) {
    const promises = batch.map(async (mint) => {
      const result = await getMintOrigin(mint);
      return { mint, result };
    });
    
    const batchResults = await Promise.allSettled(promises);
    
    batchResults.forEach((promiseResult, index) => {
      if (promiseResult.status === 'fulfilled') {
        results.set(promiseResult.value.mint, promiseResult.value.result);
      } else {
        logger.error('Batch detection failed', { 
          mint: batch[index] || 'unknown', 
          error: promiseResult.reason 
        });
        const mintAddress = batch[index];
        if (mintAddress) {
          results.set(mintAddress, {
            platform: 'unknown',
            confidence: 0,
            method: 'fallback',
            timestamp: Date.now()
          });
        }
      }
    });
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return results;
}

/**
 * Get platform statistics
 */
export function getPlatformStats(results: Map<string, PlatformResult>): {
  total: number;
  pumpFun: number;
  letsbonkFun: number;
  unknown: number;
  highConfidence: number;
  lowConfidence: number;
  methods: Record<string, number>;
} {
  let pumpFun = 0;
  let letsbonkFun = 0;
  let unknown = 0;
  let highConfidence = 0;
  let lowConfidence = 0;
  const methods: Record<string, number> = {};
  
  for (const [, result] of results) {
    switch (result.platform) {
      case 'pump.fun':
        pumpFun++;
        break;
      case 'letsbonk.fun':
        letsbonkFun++;
        break;
      case 'unknown':
        unknown++;
        break;
    }
    
    if (result.confidence >= 0.8) {
      highConfidence++;
    } else if (result.confidence > 0) {
      lowConfidence++;
    }
    
    methods[result.method] = (methods[result.method] || 0) + 1;
  }
  
  return {
    total: results.size,
    pumpFun,
    letsbonkFun,
    unknown,
    highConfidence,
    lowConfidence,
    methods
  };
}

/**
 * Clear the platform detection cache
 */
export function clearPlatformCache(): void {
  platformCache.clear();
  logger.info('Platform detection cache cleared');
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  size: number;
  oldestEntry: number | null;
  newestEntry: number | null;
} {
  let oldest: number | null = null;
  let newest: number | null = null;
  
  for (const [, result] of platformCache) {
    if (oldest === null || result.timestamp < oldest) {
      oldest = result.timestamp;
    }
    if (newest === null || result.timestamp > newest) {
      newest = result.timestamp;
    }
  }
  
  return {
    size: platformCache.size,
    oldestEntry: oldest,
    newestEntry: newest
  };
}

// Export constants for use elsewhere
export const PLATFORM_CONSTANTS = {
  PUMP_PROGRAM_ID,
  LETSBONK_PROGRAM_ID,
  PUMP_MINT_SUFFIX: 'pump',
  LETSBONK_MINT_SUFFIX: 'bonk'
};

// Backward compatibility
export const detectPlatform = getMintOrigin;