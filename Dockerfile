# Runs the API and built client on one port. See DOCKER.md for setup and data backups.

# --- build the client -------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
# Must bind all interfaces to be reachable through Docker's published port; see server/index.ts.
ENV API_HOST=0.0.0.0
ENV API_PORT=3001
WORKDIR /app

RUN chown node:node /app
USER node

# Production deps only — no vite/tsx/typescript. Node 24 runs the server's .ts files directly via
# built-in type stripping, so there's no server build step and nothing to transpile at runtime.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Server source, committed seed assets, and the client build from the stage above.
COPY --chown=node:node server ./server
# The server imports shared rules and account types from src at runtime.
COPY --chown=node:node src ./src
COPY --chown=node:node seed ./seed
COPY --from=build --chown=node:node /app/dist ./dist

# All characters/chats/worlds/images live under data/ — mount a volume here to keep them.
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/api/auth/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Docker creates a missing bind-mount directory as root. Change only the mount point's owner,
# then drop privileges before the server opens any user data.
USER root
CMD ["sh", "-ec", "chown node:node /app/data; exec setpriv --reuid=node --regid=node --init-groups -- node --experimental-sqlite server/index.ts"]
