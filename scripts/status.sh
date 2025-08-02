#!/bin/bash

# Pump Agent Status Script
# This script checks the current status of the Pump Agent

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="pump-agent"
PID_FILE="$PROJECT_DIR/pump-agent.pid"
LOG_FILE="$PROJECT_DIR/logs/pump-agent.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to log messages
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

# Function to check if process is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Function to get process info
get_process_info() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            local cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null || echo "N/A")
            local mem=$(ps -p "$pid" -o %mem= 2>/dev/null || echo "N/A")
            local time=$(ps -p "$pid" -o etime= 2>/dev/null || echo "N/A")
            echo "$pid|$cpu|$mem|$time"
        fi
    fi
}

# Function to get recent logs
get_recent_logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -n 10 "$LOG_FILE" 2>/dev/null || echo "No recent logs"
    else
        echo "Log file not found"
    fi
}

# Main execution
main() {
    log "${BLUE}=== Pump Agent Status ===${NC}"
    
    echo ""
    
    # Check if running
    if is_running; then
        local process_info=$(get_process_info)
        local pid=$(echo "$process_info" | cut -d'|' -f1)
        local cpu=$(echo "$process_info" | cut -d'|' -f2)
        local mem=$(echo "$process_info" | cut -d'|' -f3)
        local time=$(echo "$process_info" | cut -d'|' -f4)
        
        echo -e "${GREEN}✓ $APP_NAME is RUNNING${NC}"
        echo "  PID: $pid"
        echo "  CPU: $cpu%"
        echo "  Memory: $mem%"
        echo "  Uptime: $time"
        echo ""
        
        # Check for tsx processes
        local tsx_count=$(pgrep -c -f "tsx watch" 2>/dev/null || echo "0")
        echo "  TypeScript processes: $tsx_count"
        
        # Check log file
        if [ -f "$LOG_FILE" ]; then
            local log_size=$(du -h "$LOG_FILE" | cut -f1)
            echo "  Log file: $LOG_FILE ($log_size)"
        fi
        
        echo ""
        echo -e "${BLUE}Recent logs:${NC}"
        echo "----------------------------------------"
        get_recent_logs
        echo "----------------------------------------"
        
    else
        echo -e "${RED}✗ $APP_NAME is NOT RUNNING${NC}"
        echo ""
        
        # Check if PID file exists but process is dead
        if [ -f "$PID_FILE" ]; then
            echo -e "${YELLOW}Warning: PID file exists but process is not running${NC}"
            echo "  PID file: $PID_FILE"
            echo "  This might indicate a crash or improper shutdown"
        fi
        
        # Check for any remaining tsx processes
        local tsx_pids=$(pgrep -f "tsx watch" 2>/dev/null || true)
        if [ -n "$tsx_pids" ]; then
            echo -e "${YELLOW}Warning: Found orphaned tsx processes: $tsx_pids${NC}"
        fi
    fi
    
    echo ""
    echo -e "${BLUE}Quick Commands:${NC}"
    echo "  Start:  ./scripts/start.sh"
    echo "  Stop:    ./scripts/stop.sh"
    echo "  Status:  ./scripts/status.sh"
    echo "  Logs:    tail -f $LOG_FILE"
}

# Run main function
main "$@" 