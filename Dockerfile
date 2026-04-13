# Dockerfile
FROM node:20-alpine

# Install build tools needed for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first (layer cache optimization)
COPY package.json package-lock.json* ./

RUN npm ci --only=production

# Copy source
COPY src/ ./src/

# Create data directory for SQLite persistence
RUN mkdir -p /data

# Run as non-root
USER node

EXPOSE 3000

CMD ["node", "src/bot.js"]
