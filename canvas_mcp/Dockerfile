# Home Assistant Add-on: Canvas MCP (prebuilt image)
# Builds and runs the existing Canvas MCP server image outside Home Assistant.

FROM node:20-alpine AS builder
WORKDIR /app

# Copy project files into image (expects repository root as build context)
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src

RUN npm ci && npm run build

FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Copy built app and add-on entry
COPY --from=builder /app/dist ./dist
COPY addon-entry.js /app/addon-entry.js

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/healthz', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); })"

CMD ["node", "/app/addon-entry.js"]

