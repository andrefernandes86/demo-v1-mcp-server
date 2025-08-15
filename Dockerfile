FROM node:20-alpine

# Install docker CLI to run the MCP server container from inside
RUN apk add --no-cache docker-cli

WORKDIR /app

# Copy package.json (no lockfile needed)
COPY package*.json ./

# Install dependencies (omit dev dependencies for smaller image)
RUN npm install --omit=dev

# Copy the application code
COPY server.js ./

# Expose the port from .env
EXPOSE 8080

CMD ["node", "server.js"]
