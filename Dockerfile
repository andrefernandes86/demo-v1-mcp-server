FROM node:20-alpine
USER root

# Docker CLI so we can launch the MCP server container via stdio
RUN apk add --no-cache docker-cli

WORKDIR /app

# Install dependencies (no lockfile required)
COPY package*.json ./
RUN npm install --omit=dev

# App code
COPY server.js ./

# Default port (overridden by .env)
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
