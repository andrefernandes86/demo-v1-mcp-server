#!/usr/bin/env bash
set -euo pipefail

green(){ printf "\033[32m%s\033[0m\n" "$1"; }
red(){ printf "\033[31m%s\033[0m\n" "$1"; }

ENV_FILE=".env"

echo
green "== Trend Vision One MCP Chatbot setup =="

# Vision One API key
read -r -p "Vision One API key [hidden input]: " -s V1_KEY_INPUT
echo
if [ -z "${V1_KEY_INPUT:-}" ]; then
  red "Vision One API key is required."
  exit 1
fi

# Region selection
REGIONS=("us" "eu" "jp" "sg" "in" "au" "mea" "custom")
echo "Select Vision One region:"
select r in "${REGIONS[@]}"; do
  case "$r" in
    us|eu|jp|sg|in|au|mea)
      V1_REGION="$r"
      break
      ;;
    custom)
      read -r -p "Enter custom region code: " V1_REGION
      [ -z "$V1_REGION" ] && { red "Region cannot be empty."; exit 1; }
      break
      ;;
    *)
      echo "Invalid option."
      ;;
  esac
done

# Ollama settings
read -r -p "Ollama base URL [http://192.168.1.100:11434]: " OLLAMA_BASE_URL
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://192.168.1.100:11434}"

read -r -p "Ollama model [llama3.1:8b]: " OLLAMA_MODEL
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.1:8b}"

# Port for the chatbot UI
read -r -p "Chat UI port [8080]: " PORT
PORT="${PORT:-8080}"

# Save to .env
cat > "$ENV_FILE" <<EOF
TREND_VISION_ONE_API_KEY=$V1_KEY_INPUT
TREND_VISION_ONE_REGION=$V1_REGION
OLLAMA_BASE_URL=$OLLAMA_BASE_URL
OLLAMA_MODEL=$OLLAMA_MODEL
PORT=$PORT
EOF

green "Configuration saved to $ENV_FILE"

# Deploy using docker compose
green "Starting services..."
docker compose up -d
