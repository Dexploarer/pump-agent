export interface WSTokenData {
  name: string;
  symbol: string;
  mint: string;
  pool: string; // platform (bonk, pump) - this is the raw field name from WebSocket
  marketCapSol: number; // raw field name from WebSocket
  price?: number;
  uri?: string;
}

export interface WSTradeData {
  mint: string;
  platform: string;
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  volumeSOL: number;
  trader: string;
  txHash: string;
  marketCap?: number;
}

// Validation functions
export function validateWSTokenData(data: unknown): data is WSTokenData {
  if (!data || typeof data !== 'object') return false;
  const token = data as WSTokenData;
  
  // Check required properties
  if (
    typeof token.name !== 'string' ||
    typeof token.symbol !== 'string' ||
    typeof token.mint !== 'string' ||
    typeof token.pool !== 'string' ||
    typeof token.marketCapSol !== 'number'
  ) {
    return false;
  }
  
  // Check optional properties if they exist
  if (token.price !== undefined && typeof token.price !== 'number') {
    return false;
  }
  
  if (token.uri !== undefined && typeof token.uri !== 'string') {
    return false;
  }
  
  return true;
}

export function validateWSTradeData(data: unknown): data is WSTradeData {
  if (!data || typeof data !== 'object') return false;
  const trade = data as WSTradeData;
  
  // Check required properties
  if (
    typeof trade.mint !== 'string' ||
    typeof trade.platform !== 'string' ||
    typeof trade.amount !== 'number' ||
    typeof trade.price !== 'number' ||
    typeof trade.volumeSOL !== 'number' ||
    typeof trade.trader !== 'string' ||
    typeof trade.txHash !== 'string'
  ) {
    return false;
  }
  
  // Check type field
  if (trade.type !== 'buy' && trade.type !== 'sell') {
    return false;
  }
  
  // Check optional properties if they exist
  if (trade.marketCap !== undefined && typeof trade.marketCap !== 'number') {
    return false;
  }
  
  return true;
}

export interface WSMessage {
  method?: string;
  data?: WSTokenData | WSTradeData;
  [key: string]: unknown;
} 