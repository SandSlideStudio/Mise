# syntax=docker/dockerfile:1

# ---- build ---------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

# Install from the lockfile first so this layer caches across source changes.
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY Server/package.json Server/
COPY Client/package.json Client/
RUN npm ci

COPY . .

# The client builds to Client/dist. The server bundles to Server/dist with the
# workspace packages inlined, so the runtime never has to link them.
RUN npm run build

# Drop everything that was only needed to build. What remains is what the
# bundle still imports at runtime: fastify, drizzle, postgres, argon2.
RUN npm prune --omit=dev

# ---- runtime -------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

LABEL org.opencontainers.image.title="Mise" \
      org.opencontainers.image.description="Recipes and prep lists for professional kitchens, on your own server." \
      org.opencontainers.image.licenses="AGPL-3.0-only"

# tini reaps zombies and forwards SIGTERM, so docker compose down is clean.
RUN apk add --no-cache tini

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
# Workspace symlinks live in node_modules and would otherwise dangle.
COPY --from=build /app/packages ./packages
COPY --from=build /app/Server/package.json ./Server/package.json
COPY --from=build /app/Server/dist ./Server/dist
COPY --from=build /app/Server/drizzle ./Server/drizzle
COPY --from=build /app/Client/dist ./Client/dist

# Runs as node by default, but any user will do, such as the apps user TrueNAS
# gives its apps. A fresh volume copies these folders, so anyone may write them.
RUN mkdir -p /data/uploads /data/backups && chown -R node:node /data \
  && chmod 1777 /data/uploads /data/backups
USER node

EXPOSE 3000
# wget rather than a second Node process, which costs a second of processor
# time on a Raspberry Pi. Quick while starting, then every five minutes: each
# check is also a write to disk.
HEALTHCHECK --interval=5m --timeout=5s --start-period=90s --start-interval=2s \
  CMD wget -qO /dev/null http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "Server/dist/index.js"]
