# Pump Agent Process Management

This document describes the process management system for the Pump Agent, including start, stop, restart, and monitoring capabilities with automatic crash recovery.

## 🚀 Quick Start

### Basic Commands
```bash
# Start the application (with auto-restart)
npm run start:dev

# Stop the application
npm run stop

# Check status
npm run status

# Restart the application
npm run restart

# View logs
npm run logs
```

### Direct Script Usage
```bash
# Start with auto-restart
./scripts/start.sh

# Stop gracefully
./scripts/stop.sh

# Check status
./scripts/status.sh

# Restart
./scripts/restart.sh
```

## 📋 Script Details

### `start.sh` - Auto-Restart Start Script
**Features:**
- ✅ Automatic dependency installation
- ✅ Application building
- ✅ Process monitoring
- ✅ Auto-restart on crashes (up to 10 attempts)
- ✅ Graceful shutdown handling
- ✅ Comprehensive logging
- ✅ PID file management

**Configuration:**
- `MAX_RESTARTS=10` - Maximum restart attempts
- `RESTART_DELAY=5` - Seconds between restart attempts
- `LOG_FILE=logs/pump-agent.log` - Application logs
- `PID_FILE=pump-agent.pid` - Process ID tracking

**Behavior:**
1. Checks if already running
2. Installs dependencies if needed
3. Builds the application
4. Starts in development mode
5. Monitors process health
6. Automatically restarts on crashes
7. Logs all activities

### `stop.sh` - Graceful Stop Script
**Features:**
- ✅ Graceful shutdown (SIGTERM)
- ✅ Force kill if needed (SIGKILL)
- ✅ Cleanup of orphaned processes
- ✅ PID file cleanup
- ✅ Comprehensive process termination

**Behavior:**
1. Sends SIGTERM to main process
2. Waits up to 30 seconds for graceful shutdown
3. Force kills if still running
4. Cleans up any remaining tsx processes
5. Removes PID file

### `status.sh` - Status Monitoring Script
**Features:**
- ✅ Process status checking
- ✅ Resource usage monitoring (CPU, Memory, Uptime)
- ✅ Recent log display
- ✅ Orphaned process detection
- ✅ Quick command reference

**Information Displayed:**
- Running status (✓/✗)
- Process ID
- CPU and Memory usage
- Uptime
- TypeScript process count
- Log file size
- Recent log entries
- Quick command reference

### `restart.sh` - Restart Script
**Features:**
- ✅ Stops application gracefully
- ✅ Waits for cleanup
- ✅ Starts application fresh
- ✅ Error handling

## 🔧 Configuration

### Environment Variables
The scripts use the same environment configuration as the application:
- `config/env.example` - Default configuration
- Environment variables override defaults

### Logging
- **Log File**: `logs/pump-agent.log`
- **Log Rotation**: Manual (consider using `logrotate` for production)
- **Log Level**: Controlled by `LOG_LEVEL` environment variable

### Process Management
- **PID File**: `pump-agent.pid`
- **Auto-restart**: Up to 10 attempts
- **Restart Delay**: 5 seconds between attempts
- **Graceful Shutdown**: 30-second timeout

## 🛠️ Advanced Usage

### Production Deployment
```bash
# Start in background with nohup
nohup ./scripts/start.sh > /dev/null 2>&1 &

# Check status
./scripts/status.sh

# Stop when needed
./scripts/stop.sh
```

### Monitoring with Cron
```bash
# Add to crontab to check every 5 minutes
*/5 * * * * /path/to/pump-agent/scripts/status.sh >> /var/log/pump-agent-monitor.log 2>&1
```

### Log Monitoring
```bash
# Real-time log monitoring
tail -f logs/pump-agent.log

# Search for errors
grep -i error logs/pump-agent.log

# Search for specific tokens
grep "decoin" logs/pump-agent.log
```

## 🔍 Troubleshooting

### Common Issues

**1. Process Won't Start**
```bash
# Check if port is in use
lsof -i :3000

# Check for existing processes
ps aux | grep "tsx watch"

# Check logs
tail -f logs/pump-agent.log
```

**2. Process Won't Stop**
```bash
# Force kill all related processes
pkill -f "tsx watch"
pkill -f "pump-agent"

# Check for zombie processes
ps aux | grep defunct
```

**3. Auto-restart Not Working**
```bash
# Check PID file
cat pump-agent.pid

# Check script permissions
ls -la scripts/*.sh

# Check log file
tail -n 50 logs/pump-agent.log
```

**4. High Resource Usage**
```bash
# Check process resources
./scripts/status.sh

# Monitor in real-time
top -p $(cat pump-agent.pid)
```

### Debug Mode
```bash
# Run with verbose logging
LOG_LEVEL=debug npm run dev:mock

# Check all processes
ps aux | grep -E "(tsx|node|pump-agent)"
```

## 📊 Monitoring

### Health Checks
The scripts provide comprehensive health monitoring:
- Process status
- Resource usage
- Log analysis
- Orphaned process detection

### Performance Metrics
- CPU usage percentage
- Memory usage percentage
- Process uptime
- Restart count
- Log file size

### Alerting
Consider setting up alerts for:
- Process crashes (restart count > 5)
- High resource usage (>80% CPU/Memory)
- Log file size (>100MB)
- Orphaned processes

## 🔒 Security Considerations

### File Permissions
```bash
# Ensure scripts are executable
chmod +x scripts/*.sh

# Restrict access to PID file
chmod 600 pump-agent.pid
```

### Process Isolation
- Scripts run in project directory
- PID files are project-specific
- Logs are contained within project

### Cleanup
- PID files are automatically cleaned up
- Orphaned processes are detected and killed
- Log rotation should be configured for production

## 🚀 Production Deployment

### Systemd Service (Linux)
Create `/etc/systemd/system/pump-agent.service`:
```ini
[Unit]
Description=Pump Agent
After=network.target

[Service]
Type=forking
User=pump-agent
WorkingDirectory=/opt/pump-agent
ExecStart=/opt/pump-agent/scripts/start.sh
ExecStop=/opt/pump-agent/scripts/stop.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### PM2 (Node.js Process Manager)
```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start dist/main.js --name "pump-agent"

# Monitor
pm2 status
pm2 logs pump-agent
```

## 📝 Log Format

The scripts use structured logging with timestamps:
```
[2025-01-02 10:30:45] Starting Pump Agent (attempt 1/10)
[2025-01-02 10:30:48] Pump Agent started with PID 12345
[2025-01-02 10:35:12] Application stopped (PID 12345)
[2025-01-02 10:35:17] Restarting in 5 seconds... (attempt 2/10)
```

This process management system ensures your Pump Agent runs reliably with automatic crash recovery and comprehensive monitoring capabilities. 