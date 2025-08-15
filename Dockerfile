FROM node:20-alpine

# Install docker CLI to run the MCP server container from inside
RUN apk add --no-cache docker-cli

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY server.js ./

# The app reads PORT from env
EXPOSE 8080

CMD ["node", "server.js"]
