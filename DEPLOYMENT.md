# Pump Agent Deployment Guide

## 🚀 Production Deployment Checklist

### ✅ Pre-Deployment Verification

All checks have passed! Your Pump Agent is ready for 24/7 deployment.

**Verified Components:**

- ✅ Package.json scripts configured
- ✅ TypeScript configuration valid
- ✅ Docker configuration complete
- ✅ Environment configuration template ready
- ✅ Source code structure complete
- ✅ Build process working
- ✅ Linting passes
- ✅ Type checking passes

## 📋 Deployment Steps

### 1. Environment Setup

Create your production environment file:

```bash
cp config/env.example config/.env
```

Edit `config/.env` with your production values:

```bash
# PumpPortal Configuration
PUMPPORTAL_WSS_URL=wss://pumpportal.fun/api/data
PUMPPORTAL_RECONNECT_DELAY=5000
MAX_RECONNECT_ATTEMPTS=10

# InfluxDB Configuration (Production)
INFLUXDB_URL=https://your-influxdb-instance.com
INFLUXDB_TOKEN=your-production-token
INFLUXDB_ORG=your-org
INFLUXDB_BUCKET=pump_data

# Performance Settings
MAX_TOKENS_TRACKED=1000
BATCH_SIZE=100
WRITE_INTERVAL_MS=5000

# Logging
LOG_LEVEL=info
NODE_ENV=production
```

### 2. InfluxDB Setup

**Option A: Local InfluxDB (Docker)**

```bash
# Start InfluxDB with Docker Compose
docker-compose up -d influxdb

# Wait for InfluxDB to be ready
sleep 30

# Create database and user (if needed)
docker exec pump-influxdb influx setup \
  --username admin \
  --password adminpass123 \
  --org pump_org \
  --bucket pump_data \
  --token pump-agent-token-super-secret-123 \
  --force
```

**Option B: InfluxDB Cloud**

1. Create account at <https://cloud2.influxdata.com>
2. Create organization and bucket
3. Generate API token
4. Update environment variables

### 3. Application Deployment

**Option A: Docker Compose (Recommended)**

```bash
# Build and start all services
docker-compose up --build -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f pump-agent
```

**Option B: Direct Node.js**

```bash
# Install dependencies
npm ci --only=production

# Build application
npm run build

# Start application
npm start
```

**Option C: PM2 (Production Process Manager)**

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start dist/main.js --name "pump-agent"

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### 4. Monitoring & Health Checks

**Check Application Status:**

```bash
# Docker logs
docker-compose logs pump-agent

# Application health
curl http://localhost:3000/health

# Database connection
docker exec pump-agent npm run test:db
```

**Monitor Key Metrics:**

- WebSocket connection status
- Tokens being tracked
- Database write performance
- Memory usage
- Error rates

### 5. Production Considerations

#### Security

- ✅ Use strong InfluxDB tokens
- ✅ Run containers as non-root user
- ✅ Enable firewall rules
- ✅ Use HTTPS for external connections

#### Performance

- ✅ Monitor memory usage (target: <2GB)
- ✅ Track database write latency
- ✅ Monitor WebSocket connection stability
- ✅ Set up alerts for high error rates

#### Reliability

- ✅ Configure automatic restarts
- ✅ Set up log rotation
- ✅ Implement health checks
- ✅ Create backup strategy

#### Scaling

- ✅ Monitor token tracking capacity
- ✅ Adjust batch sizes based on load
- ✅ Consider horizontal scaling for high load

## 🔧 Configuration Tuning

### Performance Settings

```bash
# For high-traffic environments
MAX_TOKENS_TRACKED=2000
BATCH_SIZE=200
WRITE_INTERVAL_MS=2000

# For low-resource environments
MAX_TOKENS_TRACKED=500
BATCH_SIZE=50
WRITE_INTERVAL_MS=10000
```

### Logging Levels

```bash
# Development
LOG_LEVEL=debug

# Production
LOG_LEVEL=info

# Troubleshooting
LOG_LEVEL=warn
```

## 🚨 Troubleshooting

### Common Issues

**1. WebSocket Connection Fails**

```bash
# Check network connectivity
curl -I wss://pumpportal.fun/api/data

# Verify firewall settings
sudo ufw status
```

**2. InfluxDB Connection Errors**

```bash
# Test InfluxDB connection
docker exec pump-agent node -e "
const { InfluxClient } = require('./dist/database/influx-client.js');
const client = new InfluxClient({
  host: process.env.INFLUXDB_HOST,
  token: process.env.INFLUXDB_TOKEN,
  database: process.env.INFLUXDB_DATABASE,
  organization: process.env.INFLUXDB_ORGANIZATION
});
client.connect().then(() => console.log('Connected!'));
"
```

**3. High Memory Usage**

```bash
# Monitor memory
docker stats pump-agent

# Reduce token tracking
MAX_TOKENS_TRACKED=500
```

**4. Database Write Errors**

```bash
# Check InfluxDB logs
docker-compose logs influxdb

# Verify token permissions
docker exec pump-influxdb influx auth list
```

## 📊 Monitoring Dashboard

Create a monitoring dashboard with these key metrics:

1. **Application Health**
   - WebSocket connection status
   - Tokens tracked count
   - Database write success rate

2. **Performance Metrics**
   - Memory usage
   - CPU usage
   - Network I/O

3. **Business Metrics**
   - New tokens detected
   - Price alerts triggered
   - Data points written per minute

## 🔄 Maintenance

### Regular Tasks

**Daily:**

- Check application logs for errors
- Monitor database storage usage
- Verify WebSocket connection stability

**Weekly:**

- Review performance metrics
- Check for memory leaks
- Update dependencies (if needed)

**Monthly:**

- Review and rotate API tokens
- Backup InfluxDB data
- Update security patches

## 📞 Support

For deployment issues:

1. Check application logs
2. Verify environment configuration
3. Test database connectivity
4. Review network connectivity

---

**Deployment Status: ✅ READY**

Your Pump Agent is configured and ready for 24/7 production deployment!
