# The built PWA comes from the frontend's published image, pinned by tag (ADR 0004).
ARG FE_IMAGE=ghcr.io/soukupj00/your-notes-fe:latest
FROM ${FE_IMAGE} AS pwa

# Build: compile TypeScript and the native SQLite binding.
FROM node:24-alpine AS build
RUN apk add --no-cache python3 make g++ && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod --ignore-scripts

# Runtime: no toolchain, no package manager, non-root, only /data writable.
FROM node:24-alpine
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/public
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY --from=pwa /usr/share/nginx/html ./public
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/main.js"]
