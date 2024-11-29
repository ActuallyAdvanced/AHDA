#!/bin/bash

# ANSI color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

clear
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Server Setup and Execution         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to load existing configuration and restart ngrok if valid
load_existing_config() {
    config_file="Client/config/config.json"
    if [ -f "$config_file" ]; then
        static_domain=$(jq -r '.server_url' "$config_file")
        if [[ "$static_domain" =~ ^https://.+\.ngrok-free\.app$ ]]; then
            echo -e "${GREEN}Found existing static domain in config: $static_domain${NC}"
            echo "Restarting ngrok with the existing static domain..."
            pkill -f ngrok 2>/dev/null || true
            rm -f ngrok.log
            ./ngrok http --domain="${static_domain#https://}" 3000 --log=ngrok.log > /dev/null 2>&1 &
            for i in {1..10}; do
                sleep 1
                if grep -q "command failed" ngrok.log; then
                    echo -e "${RED}Failed to restart ngrok with static domain.${NC}"
                    return 1
                fi
                echo -e "${GREEN}Ngrok restarted successfully with domain: $static_domain${NC}"
                export NGROK_URL="$static_domain"
                return 0
            done
        fi
    fi
    return 1
}

# Function to setup ngrok
setup_ngrok() {
    # Attempt to load and use existing configuration
    if load_existing_config; then
        return
    fi

    echo "Setting up ngrok..."

    # Kill any existing ngrok processes
    pkill -f ngrok 2>/dev/null || true
    rm -f ngrok.log

    # Check if ngrok executable exists, if not download it
    if [ ! -f "./ngrok" ]; then
        echo "Downloading ngrok..."
        if [[ "$OSTYPE" == "darwin"* ]]; then
            curl -Lo ngrok.zip "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-amd64.zip"
        else
            curl -Lo ngrok.zip "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.zip"
        fi
        unzip -o ngrok.zip
        chmod +x ngrok
        rm ngrok.zip
    fi

    # Check if the authtoken is configured
    if ! ./ngrok config check >/dev/null 2>&1; then
        echo -e "${YELLOW}Please enter your ngrok authtoken:${NC}"
        read -r authtoken
        ./ngrok config add-authtoken "$authtoken"
    fi

    # Prompt for static domain usage
    echo -e "${YELLOW}Would you like to use a static domain? (y/n)${NC}"
    read -r use_static
    if [ "$use_static" = "y" ]; then
        echo -e "${YELLOW}Please enter your static domain (e.g., your-domain.ngrok.io):${NC}"
        read -r static_domain

        # Start ngrok with the static domain
        echo "Starting ngrok with static domain..."
        ./ngrok http --domain="$static_domain" 3000 --log=ngrok.log > /dev/null 2>&1 &
        ngrok_url="https://$static_domain"
    else
        # Start ngrok dynamically
        echo "Starting ngrok dynamically..."
        ./ngrok http 3000 --log=ngrok.log > /dev/null 2>&1 &

        # Fetch dynamic ngrok URL
        for i in {1..10}; do
            sleep 1
            ngrok_url=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"[^"]*' | grep -o 'https://.*' || echo "")
            if [ ! -z "$ngrok_url" ]; then
                break
            fi
        done
    fi

    if [ -z "$ngrok_url" ]; then
        echo -e "${RED}Failed to establish ngrok tunnel.${NC}"
        exit 1
    fi

    echo -e "${GREEN}Ngrok tunnel established at: $ngrok_url${NC}"
    export NGROK_URL="$ngrok_url"

    # Save server URL to config.json
    mkdir -p Client/config
    echo "{\"server_url\": \"$NGROK_URL\"}" > Client/config/config.json
    echo -e "${GREEN}Saved ngrok URL to Client/config/config.json${NC}"
}

# Server setup
cd Server
if [ ! -f .env ]; then
    echo "Creating .env file..."
    echo -e "${YELLOW}Please enter your OpenAI API key:${NC}"
    read -r api_key
    echo "OPENAI_API_KEY=$api_key" > .env
fi
npm install
cd ..

# Setup ngrok
setup_ngrok

# Start server
echo -e "${GREEN}Starting Server...${NC}"
cd Server && sudo npm install -g nodemon &&nodemon index.js &
SERVER_PID=$!

# Trap signals to clean up
trap 'kill $SERVER_PID 2>/dev/null' SIGINT SIGTERM

# Wait for server to exit
wait
