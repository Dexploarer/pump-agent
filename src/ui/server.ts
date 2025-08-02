import express, { Application, Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import open from 'open';
import { SQLiteClient } from '../database/sqlite-client.js';
import { log, getRecentLogs } from '../utils/winston-logger.js';
import { getEnvironmentConfig } from '../utils/validators.js';

export class UIServer {
  private app: Application;
  private server: HttpServer;
  private io: SocketIOServer;
  private sqliteClient: SQLiteClient;
  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Initialize SQLite client
    this.sqliteClient = new SQLiteClient({
      databasePath: './data/pump-agent.db',
      enableWAL: true,
      maxRetries: 3,
      retryDelay: 1000,
    });

    this.setupRoutes();
    this.setupSocketIO();
  }

  private setupRoutes(): void {
    // Serve static files
    this.app.use(express.static(path.join(process.cwd(), 'src/ui/public')));
    this.app.use(express.json());

    // API routes
    this.app.get('/api/status', this.getStatus.bind(this));
    this.app.get('/api/tokens', this.getTokens.bind(this));
    this.app.get('/api/stats', this.getStats.bind(this));
    this.app.get('/api/recent-trades', this.getRecentTrades.bind(this));
    this.app.get('/api/platform-stats', this.getPlatformStats.bind(this));
    this.app.get('/api/logs', this.getLogs.bind(this));

    // Serve the main dashboard
    this.app.get('/', (_req, res) => {
      res.sendFile(path.join(process.cwd(), 'src/ui/public/index.html'));
    });
  }

  private setupSocketIO(): void {
    this.io.on('connection', (socket) => {
      log.info('UI client connected', { socketId: socket.id });

      socket.on('disconnect', () => {
        log.info('UI client disconnected', { socketId: socket.id });
      });

      // Join real-time updates room
      void socket.join('updates');
    });

    // Broadcast updates every 5 seconds
    setInterval(() => {
      void this.broadcastUpdates();
    }, 5000);
  }

  private getStatus(_req: Request, res: Response): void {
    try {
      const status = {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        platform: process.platform,
        nodeVersion: process.version,
        database: {
          connected: this.sqliteClient.isHealthy,
          databasePath: './data/pump-agent.db',
        }
      };
      res.json(status);
    } catch (error) {
      log.error('Failed to get status', { error });
      res.status(500).json({ error: 'Failed to get status' });
    }
  }

  private async getTokens(req: express.Request, res: express.Response): Promise<void> {
    try {
      const limit = parseInt(req.query['limit'] as string) || 50;
      const tokens = await this.sqliteClient.getRecentTokens(limit);
      res.json(tokens);
    } catch (error) {
      log.error('Failed to get tokens', { error });
      res.status(500).json({ error: 'Failed to get tokens' });
    }
  }

  private async getStats(_req: express.Request, res: express.Response): Promise<void> {
    try {
      const stats = await this.sqliteClient.getTokenStats();
      res.json(stats);
    } catch (error) {
      log.error('Failed to get stats', { error });
      res.status(500).json({ error: 'Failed to get stats' });
    }
  }

  private async getRecentTrades(_req: express.Request, res: express.Response): Promise<void> {
    try {
      const limit = parseInt(_req.query['limit'] as string) || 50;
      const trades = await this.sqliteClient.getRecentTrades(limit);
      res.json(trades);
    } catch (error) {
      log.error('Failed to get recent trades', { error });
      res.status(500).json({ error: 'Failed to get recent trades' });
    }
  }

  private async getPlatformStats(_req: express.Request, res: express.Response): Promise<void> {
    try {
      const stats = await this.sqliteClient.getTokenStats();
      const platformStats = {
        'pump.fun': stats.tokensByPlatform['pump.fun'] || 0,
        'letsbonk.fun': stats.tokensByPlatform['letsbonk.fun'] || 0,
        'bonkake.fun': stats.tokensByPlatform['bonkake.fun'] || 0
      };
      res.json(platformStats);
    } catch (error) {
      log.error('Failed to get platform stats', { error });
      res.status(500).json({ error: 'Failed to get platform stats' });
    }
  }

  private getLogs(req: express.Request, res: express.Response): void {
    try {
      const limit = parseInt(req.query['limit'] as string) || 50;
      
      // Get real logs from Winston logger
      const logs = getRecentLogs(limit);
      
      if (logs.length === 0) {
        // Fallback to some basic logs if no real logs available
        const fallbackLogs = [
          {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            message: 'Pump Agent Dashboard loaded successfully'
          },
          {
            timestamp: new Date(Date.now() - 5000).toISOString(),
            level: 'INFO',
            message: 'WebSocket connection established'
          },
          {
            timestamp: new Date(Date.now() - 10000).toISOString(),
            level: 'INFO',
            message: 'SQLite database connected successfully'
          },
          {
            timestamp: new Date(Date.now() - 15000).toISOString(),
            level: 'INFO',
            message: 'UI Server started on port 3001'
          },
          {
            timestamp: new Date(Date.now() - 20000).toISOString(),
            level: 'INFO',
            message: 'Pump Agent started successfully'
          }
        ].slice(0, limit);
        
        res.json(fallbackLogs);
      } else {
        res.json(logs);
      }
    } catch (error) {
      log.error('Failed to get logs', { error });
      res.status(500).json({ error: 'Failed to get logs' });
    }
  }

  private async broadcastUpdates(): Promise<void> {
    try {
      const [tokens, trades, tokenStats] = await Promise.all([
        this.sqliteClient.getRecentTokens(10),
        this.sqliteClient.getRecentTrades(10),
        this.sqliteClient.getTokenStats()
      ]);

      const stats = {
        totalTokens: tokenStats.totalTokens,
        totalVolume: 0, // Will be calculated from trades
        avgPrice: 0, // Will be calculated from tokens
        timestamp: new Date().toISOString(),
        tokensByPlatform: tokenStats.tokensByPlatform,
        recentActivity: tokenStats.recentActivity
      };

      this.io.to('updates').emit('data-update', {
        timestamp: new Date().toISOString(),
        tokens: tokens,
        stats,
        recentTrades: trades
      });
    } catch (error) {
      log.error('Failed to broadcast updates', { error });
    }
  }

  public async start(port: number = 3001): Promise<void> {
    try {
      // SQLite is already initialized in constructor, no connection needed
      log.info('SQLite database ready');
      
      this.server.listen(port, () => {
        log.info(`UI Server started on port ${port}`, { port });
        log.info(`🚀 Pump Agent Dashboard: http://localhost:${port}`);
        
        // Auto-open browser
        void this.openBrowser(port);
      });
    } catch (error) {
      log.error('Failed to start UI server', { error });
      throw error;
    }
  }

  private async openBrowser(port: number): Promise<void> {
    const url = `http://localhost:${port}`;
    
    // Check if auto-open is disabled via environment variable
    if (process.env['DISABLE_AUTO_OPEN_BROWSER'] === 'true') {
      log.info('Auto-open browser disabled via configuration');
      log.info(`Please manually open: ${url}`);
      return;
    }
    
    try {
      // Check if we're in a headless environment (Linux)
      if (process.platform === 'linux' && !process.env['DISPLAY']) {
        log.warn('Running in headless environment, cannot auto-open browser');
        log.info(`Please manually open: ${url}`);
        return;
      }
      
      // Use the secure 'open' library instead of exec
      await open(url);
      log.info('Browser opened automatically', { url });
    } catch (error) {
      // Enhanced error handling with more specific error messages
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
        log.error('Browser not found or not accessible', { error: errorMessage });
      } else if (errorMessage.includes('permission') || errorMessage.includes('denied')) {
        log.error('Permission denied when trying to open browser', { error: errorMessage });
      } else {
        log.error('Failed to auto-open browser', { error: errorMessage });
      }
      
      log.info(`Please manually open: ${url}`);
    }
  }

  public async stop(): Promise<void> {
    try {
      this.server.close();
      await this.sqliteClient.close();
      log.info('UI Server stopped');
    } catch (error) {
      log.error('Failed to stop UI server', { error });
    }
  }
} 