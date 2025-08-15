FROM node:20-alpine

# Run as root so we can access the Docker socket
USER root

# Docker CLI to launch the MCP server container from inside
RUN apk add --no-cache docker-cli

WORKDIR /app

# Install deps (no lockfile required)
COPY package*.json ./
RUN npm install --omit=dev

# App code
COPY server.js ./

# Default port (overridden by .env)
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
