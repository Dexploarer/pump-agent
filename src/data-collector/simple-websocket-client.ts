import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { log } from '../utils/winston-logger.js';

export class SimplePumpPortalClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private connected = false;
  private dataReceived = 0;

  async connect(): Promise<void> {
    log.info('🔗 Connecting to PumpPortal for data collection...');
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://pumpportal.fun/api/data', {
        headers: {
          'User-Agent': 'PumpAgent/1.0',
          'Origin': 'https://pumpportal.fun'
        }
      });

      this.ws.on('open', () => {
        log.info('✅ Connected to PumpPortal');
        this.connected = true;
        this.subscribe();
        resolve();
      });

      this.ws.on('message', (data) => {
        const message = data.toString();
        this.dataReceived++;
        
        // Only log every 10th message to reduce noise
        if (this.dataReceived % 10 === 0) {
          log.info(`📊 Data received (${this.dataReceived} messages)`);
        }
        
        // Parse and validate token data
        try {
          const parsed = JSON.parse(message);
          
          // Validate the parsed data structure
          if (parsed && typeof parsed === 'object') {
            // Check if this is a token message
            if (parsed.name && parsed.symbol && parsed.mint && parsed.pool && typeof parsed.marketCapSol === 'number') {
              log.info(`🎯 NEW TOKEN: ${parsed.name} (${parsed.symbol})`);
              log.info(`   Mint: ${parsed.mint}`);
              log.info(`   Platform: ${parsed.pool}`);
              log.info(`   Market Cap: ${parsed.marketCapSol} SOL`);
              
              // Emit validated token data
              this.emit('newToken', parsed);
            }
            // Check if this is a trade message
            else if (parsed.mint && parsed.platform && parsed.type && typeof parsed.amount === 'number' && typeof parsed.price === 'number') {
              log.debug(`📊 Trade data received for ${parsed.mint}`);
              
              // Emit validated trade data
              this.emit('tokenTrade', parsed);
            }
          }
        } catch (e) {
          log.debug('Non-JSON message received, skipping');
        }
      });

      this.ws.on('error', (error) => {
        log.error('❌ WebSocket error:', error.message);
        reject(error);
      });

                  this.ws.on('close', (code, reason) => {
              log.info(`🔌 Connection closed: ${code} - ${reason}`);
              this.connected = false;
              // Reset data counter on connection close
              this.dataReceived = 0;
            });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('Connection timeout'));
        }
      }, 15000);
    });
  }

  subscribe() {
    log.info('📡 Subscribing to token events...');
    
    // Subscribe to new tokens
    this.sendMessage({ method: 'subscribeNewToken' });
    
    // Subscribe to migrations
    this.sendMessage({ method: 'subscribeMigration' });
    
    log.info('✅ Subscriptions sent');
  }

  sendMessage(message: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  subscribeToTokens(tokens: string[]): void {
    // Simple client subscribes to all tokens by default
    log.debug(`Token subscription requested for ${tokens.length} tokens (not implemented in simple client)`);
  }

  unsubscribeFromTokens(tokens: string[]): void {
    // Simple client doesn't support individual token unsubscription
    log.debug(`Token unsubscription requested for ${tokens.length} tokens (not implemented in simple client)`);
  }

  getSubscribedTokens(): string[] {
    // Simple client subscribes to all tokens by default
    log.debug('Getting subscribed tokens (simple client subscribes to all tokens)');
    return [];
  }

  getDataReceived(): number {
    return this.dataReceived;
  }
} 