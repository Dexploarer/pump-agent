#!/bin/bash

# Pump Agent Start Script with Auto-Restart
# This script starts the Pump Agent and automatically restarts it if it crashes

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="pump-agent"
LOG_FILE="$PROJECT_DIR/logs/pump-agent.log"
PID_FILE="$PROJECT_DIR/pump-agent.pid"
MAX_RESTARTS=10
RESTART_DELAY=5

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to log messages
log() {
    # Create logs directory if it doesn't exist
    mkdir -p "$(dirname "$LOG_FILE")"
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
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
            done
            
            # Force kill if still running
            if ps -p "$pid" > /dev/null 2>&1; then
                log "${RED}Force killing process $pid${NC}"
                kill -KILL "$pid"
            fi
        fi
        rm -f "$PID_FILE"
    fi
    
    log "${GREEN}$APP_NAME stopped${NC}"
}

# Function to start the application
start_app() {
    local restart_count=$1
    
    log "${GREEN}Starting $APP_NAME (attempt $((restart_count + 1))/${MAX_RESTARTS})${NC}"
    
    # Create logs directory if it doesn't exist
    mkdir -p "$(dirname "$LOG_FILE")"
    
    # Change to project directory
    cd "$PROJECT_DIR"
    
    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        log "${YELLOW}Installing dependencies...${NC}"
        npm install
    fi
    
    # Build the application
    log "${YELLOW}Building application...${NC}"
    npm run build
    
    # Start the application in background
    log "${GREEN}Starting Pump Agent in development mode...${NC}"
    nohup npm run dev:mock > "$LOG_FILE" 2>&1 &
    local pid=$!
    
    # Save PID
    echo "$pid" > "$PID_FILE"
    
    log "${GREEN}$APP_NAME started with PID $pid${NC}"
    
    # Wait a moment for the app to initialize
    sleep 3
    
    # Check if the process is still running
    if ! ps -p "$pid" > /dev/null 2>&1; then
        log "${RED}Application failed to start${NC}"
        return 1
    fi
    
    # Monitor the process
    while ps -p "$pid" > /dev/null 2>&1; do
        sleep 5
    done
    
    log "${YELLOW}Application stopped (PID $pid)${NC}"
    rm -f "$PID_FILE"
    
    return 0
}

# Function to handle restart logic
restart_app() {
    local restart_count=0
    
    while [ $restart_count -lt $MAX_RESTARTS ]; do
        if start_app $restart_count; then
            log "${GREEN}Application exited normally${NC}"
            break
        else
            restart_count=$((restart_count + 1))
            if [ $restart_count -lt $MAX_RESTARTS ]; then
                log "${YELLOW}Restarting in $RESTART_DELAY seconds... (attempt $restart_count/$MAX_RESTARTS)${NC}"
                sleep $RESTART_DELAY
            else
                log "${RED}Maximum restart attempts reached. Stopping.${NC}"
                exit 1
            fi
        fi
    done
}

# Main execution
main() {
    log "${BLUE}=== Pump Agent Start Script ===${NC}"
    
    # Check if already running
    if is_running; then
        log "${YELLOW}$APP_NAME is already running${NC}"
        echo "PID: $(cat "$PID_FILE")"
        exit 0
    fi
    
    # Handle signals
    trap 'log "${YELLOW}Received interrupt signal${NC}"; stop_app; exit 0' INT TERM
    
    # Start the application with restart logic
    restart_app
    
    log "${GREEN}Start script completed${NC}"
}

# Run main function
main "$@" 