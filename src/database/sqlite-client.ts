import Database from 'better-sqlite3';
import { log } from '../utils/winston-logger.js';
import { TokenData, TradeData, PricePoint } from './schema.js';
import { Platform } from '../utils/constants.js';

export interface SQLiteConfig {
  databasePath: string;
  enableWAL: boolean;
  maxRetries: number;
  retryDelay: number;
}

export class SQLiteClient {
  private db: Database;
  private config: SQLiteConfig;
  public isHealthy: boolean = false;

  constructor(config: SQLiteConfig) {
    this.config = config;
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    try {
      // Initialize database
      this.db = new Database(this.config.databasePath, {
        verbose: process.env['NODE_ENV'] === 'development' ? console.log : null,
      });

      // Enable WAL mode for better performance
      if (this.config.enableWAL) {
        this.db.pragma('journal_mode = WAL');
      }

      // Create tables if they don't exist
      this.createTables();
      
      this.isHealthy = true;
      log.info('SQLite database initialized successfully', {
        databasePath: this.config.databasePath,
        enableWAL: this.config.enableWAL,
      });
    } catch (error) {
      this.isHealthy = false;
      log.error('Failed to initialize SQLite database', {
        error: error instanceof Error ? error.message : String(error),
        databasePath: this.config.databasePath,
      });
      throw error;
    }
  }

  private createTables(): void {
    // Create tokens table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT UNIQUE NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        platform_confidence REAL NOT NULL,
        price REAL NOT NULL,
        volume_24h REAL NOT NULL,
        market_cap REAL NOT NULL,
        liquidity REAL NOT NULL,
        price_change_24h REAL NOT NULL,
        volume_change_24h REAL NOT NULL,
        holders INTEGER NOT NULL,
        uri TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create trades table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL,
        platform TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        price REAL NOT NULL,
        volume_sol REAL NOT NULL,
        trader TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (mint) REFERENCES tokens(mint)
      )
    `);

    // Create price_points table for time-series data
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS price_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL,
        price REAL NOT NULL,
        volume REAL NOT NULL,
        market_cap REAL NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (mint) REFERENCES tokens(mint)
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tokens_mint ON tokens(mint);
      CREATE INDEX IF NOT EXISTS idx_tokens_platform ON tokens(platform);
      CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens(created_at);
      CREATE INDEX IF NOT EXISTS idx_trades_mint ON trades(mint);
      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_price_points_mint ON price_points(mint);
      CREATE INDEX IF NOT EXISTS idx_price_points_timestamp ON price_points(timestamp);
    `);

    log.info('SQLite tables and indexes created successfully');
  }

  public async writeTokenData(tokenData: TokenData): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO tokens (
          mint, symbol, name, platform, platform_confidence, price, 
          volume_24h, market_cap, liquidity, price_change_24h, 
          volume_change_24h, holders, uri, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      stmt.run(
        tokenData.mint,
        tokenData.symbol,
        tokenData.name,
        tokenData.platform,
        tokenData.platformConfidence,
        tokenData.price,
        tokenData.volume24h,
        tokenData.marketCap,
        tokenData.liquidity,
        tokenData.priceChange24h,
        tokenData.volumeChange24h,
        tokenData.holders,
        tokenData.uri
      );

      log.debug('Token data written to SQLite', {
        mint: tokenData.mint,
        symbol: tokenData.symbol,
        platform: tokenData.platform,
      });
    } catch (error) {
      log.error('Failed to write token data to SQLite', {
        error: error instanceof Error ? error.message : String(error),
        mint: tokenData.mint,
      });
      throw error;
    }
  }

  public async writeTradeData(tradeData: TradeData): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO trades (
          mint, platform, type, amount, price, volume_sol, trader, tx_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        tradeData.mint,
        tradeData.platform,
        tradeData.type,
        tradeData.amount,
        tradeData.price,
        tradeData.value,
        tradeData.wallet,
        tradeData.signature
      );

      log.debug('Trade data written to SQLite', {
        mint: tradeData.mint,
        type: tradeData.type,
        platform: tradeData.platform,
      });
    } catch (error) {
      log.error('Failed to write trade data to SQLite', {
        error: error instanceof Error ? error.message : String(error),
        mint: tradeData.mint,
      });
      throw error;
    }
  }

  public async writePriceData(pricePoint: PricePoint): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO price_points (mint, price, volume, market_cap)
        VALUES (?, ?, ?, ?)
      `);

      stmt.run(
        pricePoint.mint,
        pricePoint.price,
        pricePoint.volume,
        pricePoint.volume
      );

      log.debug('Price point written to SQLite', {
        mint: pricePoint.mint,
        price: pricePoint.price,
      });
    } catch (error) {
      log.error('Failed to write price data to SQLite', {
        error: error instanceof Error ? error.message : String(error),
        mint: pricePoint.mint,
      });
      throw error;
    }
  }

  public async getRecentTokens(limit: number = 50): Promise<TokenData[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM tokens 
        ORDER BY updated_at DESC 
        LIMIT ?
      `);

      const rows = stmt.all(limit);
      return rows.map((row: any) => ({
        mint: row.mint,
        symbol: row.symbol,
        name: row.name,
        platform: row.platform as Platform,
        platformConfidence: row.platform_confidence,
        price: row.price,
        volume24h: row.volume_24h,
        marketCap: row.market_cap,
        liquidity: row.liquidity,
        priceChange24h: row.price_change_24h,
        volumeChange24h: row.volume_change_24h,
        holders: row.holders,
        uri: row.uri,
        timestamp: new Date(row.updated_at),
      }));
    } catch (error) {
      log.error('Failed to get recent tokens from SQLite', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  public async getRecentTrades(limit: number = 50): Promise<TradeData[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM trades 
        ORDER BY timestamp DESC 
        LIMIT ?
      `);

      const rows = stmt.all(limit);
      return rows.map((row: any) => ({
        mint: row.mint,
        platform: row.platform as Platform,
        type: row.type as 'buy' | 'sell',
        amount: row.amount,
        price: row.price,
        value: row.volume_sol,
        wallet: row.trader,
        signature: row.tx_hash,
        timestamp: new Date(row.timestamp),
      }));
    } catch (error) {
      log.error('Failed to get recent trades from SQLite', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  public async getPriceHistory(
    mint: string,
    timeRange: { start: Date; end: Date },
    interval: string = '1h'
  ): Promise<PricePoint[]> {
    try {
      // Convert interval to SQLite datetime format
      const intervalMap: Record<string, string> = {
        '5m': '+5 minutes',
        '1h': '+1 hour',
        '4h': '+4 hours',
        '1d': '+1 day',
      };

      const intervalStr = intervalMap[interval] || '+1 hour';

      const stmt = this.db.prepare(`
        SELECT 
          mint,
          AVG(price) as price,
          AVG(volume) as volume,
          AVG(market_cap) as market_cap,
          datetime(timestamp, 'localtime') as timestamp
        FROM price_points 
        WHERE mint = ? 
          AND timestamp BETWEEN ? AND ?
        GROUP BY strftime('%Y-%m-%d %H:%M', timestamp, ?)
        ORDER BY timestamp ASC
      `);

      const rows = stmt.all(
        mint,
        timeRange.start.toISOString(),
        timeRange.end.toISOString(),
        intervalStr
      );

      return rows.map((row: any) => ({
        mint: row.mint,
        price: row.price,
        volume: row.volume,
        timestamp: new Date(row.timestamp),
        platform: row.platform as Platform,
        source: 'sqlite',
      }));
    } catch (error) {
      log.error('Failed to get price history from SQLite', {
        error: error instanceof Error ? error.message : String(error),
        mint,
        timeRange,
        interval,
      });
      return [];
    }
  }

  public async getTokenStats(): Promise<{
    totalTokens: number;
    tokensByPlatform: Record<string, number>;
    recentActivity: { tokens: number; trades: number };
  }> {
    try {
      // Get total tokens
      const totalTokensStmt = this.db.prepare('SELECT COUNT(*) as count FROM tokens');
      const totalTokens = totalTokensStmt.get().count;

      // Get tokens by platform
      const platformStmt = this.db.prepare(`
        SELECT platform, COUNT(*) as count 
        FROM tokens 
        GROUP BY platform
      `);
      const platformRows = platformStmt.all();
      const tokensByPlatform: Record<string, number> = {};
      platformRows.forEach((row: any) => {
        tokensByPlatform[row.platform] = row.count;
      });

      // Get recent activity (last 24 hours)
      const recentTokensStmt = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM tokens 
        WHERE updated_at >= datetime('now', '-1 day')
      `);
      const recentTokens = recentTokensStmt.get().count;

      const recentTradesStmt = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM trades 
        WHERE timestamp >= datetime('now', '-1 day')
      `);
      const recentTrades = recentTradesStmt.get().count;

      return {
        totalTokens,
        tokensByPlatform,
        recentActivity: {
          tokens: recentTokens,
          trades: recentTrades,
        },
      };
    } catch (error) {
      log.error('Failed to get token stats from SQLite', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        totalTokens: 0,
        tokensByPlatform: {},
        recentActivity: { tokens: 0, trades: 0 },
      };
    }
  }



  public async close(): Promise<void> {
    try {
      if (this.db) {
        this.db.close();
        log.info('SQLite database connection closed');
      }
    } catch (error) {
      log.error('Failed to close SQLite database', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public async backup(backupPath: string): Promise<void> {
    try {
      await this.db.backup(backupPath);
      log.info('SQLite database backup created', { backupPath });
    } catch (error) {
      log.error('Failed to create SQLite database backup', {
        error: error instanceof Error ? error.message : String(error),
        backupPath,
      });
      throw error;
    }
  }
} 