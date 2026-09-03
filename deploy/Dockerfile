# ==========================================
# Dispar Flux - Multi-Arch Production Dockerfile
# Supported Architectures: linux/amd64, linux/arm64
# AGPL-3.0-only
# ==========================================

# 1. Build Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies if needed
RUN apk add --no-cache python3 make g++ git

# Copy root manifest and workspace manifests
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/security/package.json packages/security/
COPY packages/auth/package.json packages/auth/
COPY packages/campaigns/package.json packages/campaigns/
COPY packages/migration/package.json packages/migration/
COPY packages/storage-local/package.json packages/storage-local/
COPY packages/connector-baileys/package.json packages/connector-baileys/
COPY packages/crm/package.json packages/crm/
COPY packages/inbox/package.json packages/inbox/
COPY apps/server/package.json apps/server/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy full source trees
COPY packages/ packages/
COPY apps/ apps/

# Build TypeScript packages and application
RUN npm run build

# Remove development dependencies to minimize image size
RUN npm prune --omit=dev

# 2. Production Runtime Stage
FROM --platform=$TARGETPLATFORM node:22-alpine AS runner

LABEL org.opencontainers.image.title="Dispar Flux" \
      org.opencontainers.image.description="Plataforma Web de Atendimento Multiatendente e Mensageria WhatsApp (Edição Comunitária)" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/RafaelMKn/dispar-flux"

WORKDIR /app

# Ensure tzdata and ca-certificates are present
RUN apk add --no-cache tzdata ca-certificates

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

# Create data directory with permissions for node user (UID 1000)
RUN mkdir -p /data && chown -R node:node /data /app

# Copy production artifacts from builder
COPY --chown=node:node --from=builder /app/package.json /app/package.json
COPY --chown=node:node --from=builder /app/node_modules /app/node_modules
COPY --chown=node:node --from=builder /app/packages /app/packages
COPY --chown=node:node --from=builder /app/apps /app/apps

USER node

VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:3000/health").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'

CMD ["node", "apps/server/dist/index.js"]
