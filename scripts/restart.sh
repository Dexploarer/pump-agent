#!/bin/bash

# Pump Agent Restart Script
# This script stops and then starts the Pump Agent

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to log messages
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

# Main execution
main() {
    log "${BLUE}=== Pump Agent Restart Script ===${NC}"
    
    echo ""
    
    # Stop the application
    log "${YELLOW}Stopping Pump Agent...${NC}"
    if [ -f "$SCRIPT_DIR/stop.sh" ]; then
        bash "$SCRIPT_DIR/stop.sh"
    else
        log "${YELLOW}Stop script not found, using fallback method${NC}"
        pkill -f "tsx watch" 2>/dev/null || true
        sleep 2
    fi
    
    echo ""
    
    # Wait a moment
    log "${YELLOW}Waiting 3 seconds...${NC}"
    sleep 3
    
    echo ""
    
    # Start the application
    log "${GREEN}Starting Pump Agent...${NC}"
    if [ -f "$SCRIPT_DIR/start.sh" ]; then
        bash "$SCRIPT_DIR/start.sh"
    else
        log "${YELLOW}Start script not found${NC}"
        exit 1
    fi
    
    echo ""
    log "${GREEN}Restart completed${NC}"
}

# Run main function
main "$@" 