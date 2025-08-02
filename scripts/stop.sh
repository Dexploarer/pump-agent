#!/bin/bash

# Pump Agent Stop Script
# This script gracefully stops the Pump Agent

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="pump-agent"
PID_FILE="$PROJECT_DIR/pump-agent.pid"

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

# Function to stop the application
stop_app() {
    log "${YELLOW}Stopping $APP_NAME...${NC}"
    
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            log "Sending SIGTERM to process $pid"
            kill -TERM "$pid"
            
            # Wait for graceful shutdown
            local count=0
            while ps -p "$pid" > /dev/null 2>&1 && [ $count -lt 30 ]; do
                sleep 1
                count=$((count + 1))
                echo -n "."
            done
            echo ""
            
            # Force kill if still running
            if ps -p "$pid" > /dev/null 2>&1; then
                log "${RED}Force killing process $pid${NC}"
                kill -KILL "$pid"
                sleep 2
            fi
        else
            log "${YELLOW}Process $pid not found${NC}"
        fi
        rm -f "$PID_FILE"
    else
        log "${YELLOW}PID file not found${NC}"
    fi
    
    # Also kill any remaining tsx processes
    local tsx_pids=$(pgrep -f "tsx watch" 2>/dev/null || true)
    if [ -n "$tsx_pids" ]; then
        log "${YELLOW}Killing remaining tsx processes: $tsx_pids${NC}"
        echo "$tsx_pids" | xargs kill -TERM 2>/dev/null || true
        sleep 2
        echo "$tsx_pids" | xargs kill -KILL 2>/dev/null || true
    fi
    
    log "${GREEN}$APP_NAME stopped${NC}"
}

# Main execution
main() {
    log "${BLUE}=== Pump Agent Stop Script ===${NC}"
    
    # Check if running
    if ! is_running; then
        log "${YELLOW}$APP_NAME is not running${NC}"
        exit 0
    fi
    
    # Stop the application
    stop_app
    
    log "${GREEN}Stop script completed${NC}"
}

# Run main function
main "$@" 