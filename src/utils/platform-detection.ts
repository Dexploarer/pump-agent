/**
 * Platform detection utilities for token analysis
 */

// Simplified platform detection without Solana dependencies
export function detectPlatform(_mint: string, _programId?: string): 'pump.fun' | 'letsbonk.fun' {
  // Default to letsbonk.fun for now
  return 'letsbonk.fun';
}

export function getPlatformConfidence(_mint: string, _programId?: string): number {
  // Default confidence
  return 0.8;
}