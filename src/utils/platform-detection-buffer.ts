/**
 * Buffered platform detection for performance optimization
 */

import { detectPlatform, getPlatformConfidence } from './platform-detection.js';

interface PlatformResult {
  platform: 'pump.fun' | 'letsbonk.fun';
  confidence: number;
  method: 'buffered' | 'fallback';
  timestamp: number;
}

// Cache for performance
const platformCache = new Map<string, PlatformResult>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export function getMintOrigin(mintStr: string): PlatformResult {
  // Check cache first
  const cached = platformCache.get(mintStr);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached;
  }

  const platform = detectPlatform(mintStr);
  const confidence = getPlatformConfidence(mintStr);

  const result: PlatformResult = {
    platform,
    confidence,
    method: 'buffered',
    timestamp: Date.now()
  };

  platformCache.set(mintStr, result);
  return result;
}