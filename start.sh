#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"

echo "== Trend Vision One MCP Chatbot setup =="

read -r -p "Vision One API key [hidden input]: " -s V1_KEY_INPUT
echo
[ -z "${V1_KEY_INPUT:-}" ] && { echo "API key required."; exit 1; }

REGIONS=("us" "eu" "jp" "sg" "in" "au" "mea" "custom")
echo "Select Vision One region:"
select r in "${REGIONS[@]}"; do
  case "$r" in
    us|eu|jp|sg|in|au|mea) V1_REGION="$r"; break ;;
    custom) read -r -p "Enter custom region code: " V1_REGION; [ -z "$V1_REGION" ] && { echo "Region required."; exit 1; }; break ;;
    *) echo "Invalid option." ;;
  esac
done

read -r -p "Ollama base URL [http://192.168.1.100:11434]: " OLLAMA_BASE_URL
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://192.168.1.100:11434}"

read -r -p "Ollama model [llama3.1:8b]: " OLLAMA_MODEL
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.1:8b}"

read -r -p "Chat UI port [8080]: " PORT
PORT="${PORT:-8080}"

cat > "$ENV_FILE" <<EOF
TREND_VISION_ONE_API_KEY=$V1_KEY_INPUT
TREND_VISION_ONE_REGION=$V1_REGION
OLLAMA_BASE_URL=$OLLAMA_BASE_URL
OLLAMA_MODEL=$OLLAMA_MODEL
PORT=$PORT
EOF

echo "Configuration saved to $ENV_FILE"
echo "Starting services..."
docker compose up -d
