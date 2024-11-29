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

#check if with sudo
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run this script with sudo.${NC}"
    exit 1
fi

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
    echo -e "${YELLOW}Please enter the server domain (eg. https://server.domain.com):${NC}"
    read server_domain
    echo -e "${YELLOW}Please enter a password:${NC}"
    read password
    #write to config.json
    echo -e "${GREEN}Writing to config.json...${NC}"
    echo -e "{\n\t\"server_url\": \"$server_domain\",\n\t\"client_password\": \"$password\"\n}" > Client/config/config.json

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
