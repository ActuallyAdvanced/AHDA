#!/bin/bash

# ANSI color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

clear
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║            Client Setup and Execution      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to install Python dependencies
install_python_deps() {
    echo "Creating Python virtual environment..."
    python -m venv Client/venv
    source Client/venv/bin/activate
    pip install -r Client/requirements.txt
}

# Verify server configuration
if [ ! -f Client/config/config.json ]; then
    echo -e "${RED}Server configuration not found!${NC}"
    echo "Please run the server setup script first."
    exit 1
fi

# Install Python dependencies
install_python_deps

# Start client
echo -e "${GREEN}Starting Client...${NC}"
cd Client && source venv/bin/activate && python main.py &
CLIENT_PID=$!

# Trap signals to clean up
trap 'kill $CLIENT_PID 2>/dev/null' SIGINT SIGTERM

# Wait for client to exit
wait
