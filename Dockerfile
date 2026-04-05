# Multi-stage build for Job Monitoring System
# Stage 1: Base - shared layer for dependencies
FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies needed for scripts
RUN apk add --no-cache bash curl

# Stage 2: Dependencies - install node packages
FROM base AS deps
WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --production && \
    npm cache clean --force

# Stage 3: Test - run tests before building production image
FROM base AS test
WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json* ./

# Install ALL dependencies (including dev deps for testing)
RUN npm ci

# Copy source code and tests
COPY . .

# Make scripts executable
RUN chmod +x scripts/dummy.sh scripts/dummy.bat

# Run tests
RUN npm run test:coverage

# Stage 4: Production - minimal runtime image
FROM node:22-alpine AS runner
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache bash curl && \
    addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001

# Copy production dependencies from deps stage
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules

# Copy application source
COPY --chown=appuser:appgroup src ./src
COPY --chown=appuser:appgroup scripts ./scripts
COPY --chown=appuser:appgroup package.json ./

# Make scripts executable
RUN chmod +x scripts/dummy.sh

# Switch to non-root user
USER appuser

# Environment
ENV NODE_ENV=production \
    PORT=3000 \
    MAX_CONCURRENT_JOBS=100 \
    LOG_LEVEL=info

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start application
CMD ["node", "src/index.js"]
