# Pump.fun AI Agent Platform

A real-time cryptocurrency data collection and AI query platform for pump.fun tokens. Track 1000+ tokens with natural language temporal queries like "how much was Sol price 5 hours ago?" and "how many coins reached 100k mcap in the last hour?"

## 🚀 Features

- **Real-time Data Collection**: WebSocket connection to PumpPortal for live token and trade data
- **Time-Series Storage**: InfluxDB 3.0 for efficient temporal data storage
- **AI Query Interface**: MCP (Model Context Protocol) server for natural language queries
- **High Performance**: Track 1000+ tokens simultaneously with <1s latency
- **Smart Alerts**: Price change and volume spike detection
- **Comprehensive Metrics**: Market cap tracking, volume analysis, and price history

## 📋 Prerequisites

- Node.js 18+
- Docker and Docker Compose
- InfluxDB instance (local or cloud)

## 🛠️ Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd pump-agent
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment**
```bash
cp config/.env.example config/.env
# Edit config/.env with your settings
```

4. **Start InfluxDB**
```bash
docker-compose up -d influxdb
```

5. **Run the application**
```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## 🏗️ Architecture

```
[PumpPortal WebSocket] → [Data Processor] → [InfluxDB] → [MCP AI Agent] → [User Interface]
```

### Components

- **WebSocket Client**: Connects to PumpPortal for real-time data
- **Data Processor**: Validates and transforms incoming data
- **Price Tracker**: Monitors price changes and generates alerts
- **InfluxDB Client**: Manages time-series data storage
- **MCP Server**: Provides natural language query interface
- **Query Handler**: Executes temporal queries against the database

## 🔧 Configuration

### Environment Variables

```bash
# PumpPortal Configuration
PUMPPORTAL_WSS_URL=wss://pumpportal.fun/api/data
PUMPPORTAL_RECONNECT_DELAY=5000
MAX_RECONNECT_ATTEMPTS=10

# InfluxDB Configuration
INFLUXDB_HOST=http://localhost:8086
INFLUXDB_TOKEN=your-token-here
INFLUXDB_DATABASE=pump_data
INFLUXDB_ORGANIZATION=pump_org

# MCP Server Configuration
MCP_SERVER_NAME=pump-agent
MCP_SERVER_VERSION=1.0.0
MCP_SERVER_PORT=3000

# Performance Settings
MAX_TOKENS_TRACKED=1000
BATCH_SIZE=100
WRITE_INTERVAL_MS=1000
CACHE_TTL_SECONDS=300
```

## 📊 Database Schema

### Measurements

- **token_prices**: Real-time token prices in SOL and USD
- **market_caps**: Market capitalization tracking
- **sol_price**: SOL/USD price history
- **trades**: Individual trade events
- **token_info**: Token metadata
- **volume_stats**: Aggregated volume statistics

## 🤖 MCP Tools

### Available Tools

1. **sol_price_at_time**: Get SOL price at a specific time
2. **token_price_at_time**: Get token price at a specific time
3. **tokens_by_mcap**: Find tokens that reached a market cap threshold
4. **volume_analysis**: Analyze trading volume for a token
5. **new_tokens_count**: Count new tokens created in a time period
6. **price_change**: Calculate price change percentage
7. **top_movers**: Get top gainers or losers
8. **whale_trades**: Find large trades
9. **token_metrics**: Get current token metrics

### Example Queries

```javascript
// Get SOL price 5 hours ago
{
  "tool": "sol_price_at_time",
  "time_reference": "5 hours ago"
}

// Find tokens that reached 100k market cap in the last hour
{
  "tool": "tokens_by_mcap",
  "min_market_cap": 100000,
  "time_reference": "last hour"
}

// Analyze volume for a specific token
{
  "tool": "volume_analysis",
  "mint": "TokenMintAddress",
  "time_reference": "last 24 hours"
}
```

## 📈 Performance

- **Data Collection**: Process 100+ updates per second
- **Query Response**: <100ms for historical queries
- **Storage**: 30 days granular data, 1 year aggregated
- **Concurrent Users**: Support 10+ simultaneous queries

## 🚀 Deployment

### Using Docker

```bash
# Build and run all services
docker-compose up --build

# Run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f pump-agent
```

### Production Considerations

1. Use managed InfluxDB (InfluxDB Cloud)
2. Implement proper monitoring and alerting
3. Set up automatic restarts with systemd or PM2
4. Use a reverse proxy for MCP server
5. Configure log rotation
6. Set up backups for InfluxDB data

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Run linting
npm run lint

# Type checking
npm run typecheck
```

## 📝 API Documentation

### WebSocket Events

- `newToken`: Emitted when a new token is created
- `tokenTrade`: Emitted for each trade
- `priceAlert`: Emitted on significant price changes
- `volumeAlert`: Emitted on volume spikes

### Database Queries

See `src/database/queries.ts` for available query builders.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Troubleshooting

### Common Issues

1. **WebSocket connection fails**
   - Check PumpPortal service status
   - Verify network connectivity
   - Review firewall settings

2. **InfluxDB connection errors**
   - Ensure InfluxDB is running
   - Verify authentication token
   - Check database exists

3. **High memory usage**
   - Reduce MAX_TOKENS_TRACKED
   - Increase cleanup frequency
   - Check for memory leaks

### Debug Mode

Enable debug logging:
```bash
LOG_LEVEL=debug npm run dev
```

## 📞 Support

For issues and questions:
- Create an issue on GitHub
- Check existing issues for solutions
- Review logs for error details

---

Built with ❤️ for the pump.fun community