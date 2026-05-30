# syntax=docker/dockerfile:1

# Build context is the `backend-services/` workspace root.

# ---- Build stage: install all workspaces and compile TypeScript -----------
FROM node:22-alpine AS build
WORKDIR /app

# Copy manifests first for better layer caching.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY api/package.json api/
COPY db-mcp-server/package.json db-mcp-server/

RUN npm ci

# Copy sources and build (shared -> database -> api -> db-mcp-server).
COPY packages ./packages
COPY api ./api
COPY db-mcp-server ./db-mcp-server
RUN npm run build

# Drop dev dependencies for a lean runtime image.
RUN npm prune --omit=dev

# ---- Runtime stage --------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy the pruned, built workspace tree.
COPY --from=build /app ./

USER node

EXPOSE 3000
CMD ["node", "api/dist/main.js"]
