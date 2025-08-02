# 🏠 Pump Agent - Local Development Setup

## ✅ Status: LOCAL SETUP COMPLETE

Your Pump Agent is now running locally in development mode! Here's what's been set up:

## 🚀 What's Running

### ✅ Application Status

- **Development Mode**: Running with `npm run dev:mock`
- **Process ID**: Active and monitoring
- **Network**: Connected to PumpPortal
- **Database**: Mock mode (in-memory storage)
- **MCP Server**: Available for AI queries

### ✅ Verified Components

1. **Built Files**: All TypeScript compiled successfully
2. **Environment Config**: Template created and configured
3. **Package Scripts**: All required scripts present
4. **Application Process**: Running in development mode
5. **Network Connectivity**: PumpPortal accessible

## 📊 What the Application is Doing

### Real-time Data Collection

- **WebSocket Connection**: Connected to PumpPortal
- **Token Tracking**: Monitoring 100+ tokens in real-time
- **Trade Processing**: Processing buy/sell transactions
- **Price Alerts**: Detecting significant price changes
- **Trend Analysis**: Identifying bullish/bearish patterns

### Data Storage (Development Mode)

- **Mock Database**: Data stored in memory
- **Token Data**: Real-time token information
- **Trade Data**: Transaction history
- **Price History**: Time-series price data
- **Cleanup Events**: Token removal tracking

### AI Query Interface

- **MCP Server**: Natural language queries
- **Query Examples**:
  - "What was the price of SOL 2 hours ago?"
  - "Show me tokens that reached 100k market cap"
  - "Which tokens had the highest volume today?"

## 🔧 Development Commands

### Start the Application

```bash
# Development mode (recommended)
npm run dev:mock

# Production mode (requires InfluxDB)
npm run dev
```

### Stop the Application

```bash
# Press Ctrl+C in the terminal where it's running
# Or kill the process
pkill -f "tsx watch"
```

### Build the Application

```bash
npm run build
```

### Run Tests

```bash
npm test
```

### Check Linting

```bash
npm run lint
```

### Type Checking

```bash
npm run typecheck
```

## 📈 Monitoring the Application

### Console Output

The application logs detailed information including:

- **Connection Status**: WebSocket connection health
- **Token Updates**: New tokens and price changes
- **Trade Activity**: Buy/sell transactions
- **System Stats**: Performance metrics every 30 seconds
- **Error Handling**: Any issues or failures

### Key Metrics to Watch

1. **WebSocket Connection**: Should show "connected"
2. **Tokens Tracked**: Should increase over time
3. **Trade Processing**: Should show trade data
4. **Memory Usage**: Should remain stable
5. **Error Count**: Should be minimal

### Sample Console Output

```
[INFO] Starting Pump Agent (Development Mode)...
[INFO] Initializing InfluxDB connection (Development Mode)...
[WARN] InfluxDB connection failed (expected in development)
[INFO] Initializing PumpPortal WebSocket client...
[INFO] PumpPortal WebSocket connected
[INFO] MCP server started
[INFO] Pump Agent (Development) started successfully
[DEBUG] Processed token data { mint: "ABC123", symbol: "TEST", price: 0.001 }
[INFO] 📈 System stats (Development) { pumpPortal: { connected: true, ... } }
```

## 🧪 Testing the Setup

### Run the Test Script

```bash
node scripts/test-local.js
```

This will verify:

- ✅ Built files exist
- ✅ Environment configuration is correct
- ✅ All scripts are available
- ✅ Application is running
- ✅ Network connectivity works

### Manual Testing

1. **Check Process**: `ps aux | grep "tsx watch"`
2. **Test Network**: `curl -I https://pumpportal.fun`
3. **View Logs**: Check the terminal output
4. **Monitor Stats**: Watch the periodic stats output

## 🔍 Troubleshooting

### Common Issues

**1. Application Not Starting**

```bash
# Check if port is in use
lsof -i :3000

# Kill existing processes
pkill -f "tsx watch"

# Restart
npm run dev:mock
```

**2. WebSocket Connection Fails**

```bash
# Check internet connection
ping pumpportal.fun

# Check firewall settings
curl -I wss://pumpportal.fun/api/data
```

**3. Build Errors**

```bash
# Clean and rebuild
rm -rf dist/
npm run build
```

**4. Memory Issues**

```bash
# Check memory usage
ps aux | grep "tsx watch" | awk '{print $6}'

# Restart if needed
pkill -f "tsx watch" && npm run dev:mock
```

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug npm run dev:mock
```

## 📋 Next Steps

### For Development

1. **Monitor the Console**: Watch for any errors or issues
2. **Test Queries**: Try the MCP server for AI queries
3. **Add Features**: Extend functionality as needed
4. **Debug Issues**: Use the debug mode for troubleshooting

### For Production Deployment

1. **Set up InfluxDB**: Install and configure InfluxDB
2. **Configure Environment**: Update `config/.env` with production values
3. **Deploy with Docker**: Use `docker-compose up --build`
4. **Monitor Performance**: Set up monitoring and alerting

## 🎯 Expected Behavior

### Normal Operation

- **Startup**: Should connect to PumpPortal within 30 seconds
- **Data Collection**: Should process 10+ tokens per minute
- **Memory Usage**: Should stay under 500MB
- **Error Rate**: Should be less than 1%
- **Uptime**: Should run continuously without crashes

### Performance Metrics

- **WebSocket Latency**: <100ms
- **Data Processing**: <10ms per token
- **Memory Growth**: <1MB per hour
- **CPU Usage**: <5% average
- **Network I/O**: <1MB per minute

## 🚨 Emergency Procedures

### If Application Crashes

```bash
# Restart immediately
npm run dev:mock
```

### If WebSocket Disconnects

- Application will automatically reconnect
- Check logs for reconnection attempts
- Verify network connectivity

### If Memory Usage is High

```bash
# Restart the application
pkill -f "tsx watch"
npm run dev:mock
```

---

## 🎉 Congratulations

Your Pump Agent is now running locally and collecting real-time cryptocurrency data from PumpPortal. The application is:

- ✅ **Connected** to PumpPortal WebSocket
- ✅ **Processing** real-time token data
- ✅ **Storing** data in memory (development mode)
- ✅ **Monitoring** system health and performance
- ✅ **Ready** for AI queries via MCP server

**Status**: 🟢 **RUNNING AND COLLECTING DATA**

The application will continue running until you stop it with Ctrl+C. All data is being collected and processed in real-time!
