# Tempo, as a container image. One Node.js process: web server, MCP endpoint, scheduler and Conductor.
#
# Two stages: "build" installs everything and compiles the server and the control room; "runtime"
# keeps only the compiled output and the production dependencies, so the final image stays small.
#
# Used by Railway (Dockerfile builder, see .railway/railway.ts) and Fly.io (fly.toml). Locally:
#   docker build -t tempo .
#   docker run -p 3000:3000 -e BASE_URL=http://localhost:3000 -v tempo-data:/data tempo
# Create the first admin inside the running container:
#   docker exec -it <container> node dist/server/cli/setup.js

# ----------------------------------------------------------------------------------------------
# Stage 1: build
# ----------------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Build tools for the native modules, in this build stage only (they never reach the final image).
# better-sqlite3 13 ships a prebuilt binary inside its npm package and @node-rs/argon2 comes as a
# prebuilt platform package, so on linux x64 and arm64 nothing heavy is compiled. But npm still
# runs node-gyp for better-sqlite3 when it installs it (there is a binding.gyp), and that fails
# without python3 and make; g++ is needed if a platform ever has to compile from source.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first, so this layer is reused until package.json or the lockfile changes.
#
# The optional build secret "cabundle" is only for sandboxes whose outbound HTTPS goes through a
# proxy with its own certificate authority. Normal builds (Railway, Fly, your laptop) pass nothing
# and the secret mount is simply absent. A secret is not stored in any image layer or in the image
# history, so the certificate can never end up in the final image.
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=cabundle,required=false \
    if [ -s /run/secrets/cabundle ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/cabundle; fi; \
    npm ci --no-audit --no-fund

# Compile: tsc writes the server to dist/server, vite writes the control room to dist/web.
COPY tsconfig*.json vite.config.ts ./
COPY src ./src
RUN --mount=type=secret,id=cabundle,required=false \
    if [ -s /run/secrets/cabundle ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/cabundle; fi; \
    npm run build \
    && npm prune --omit=dev --no-audit --no-fund

# ----------------------------------------------------------------------------------------------
# Stage 2: runtime
# ----------------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

# Defaults that suit a hosted deployment. Railway sets PORT itself; the app reads it and listens on
# all interfaces. BASE_URL (your public https address) and ANTHROPIC_API_KEY are not set here:
# provide them as environment variables where the container runs.
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    TRUST_PROXY=1

# Only what is needed to run: package.json (it says "type": "module"), the production
# node_modules (native modules already built for this Node version and platform) and the compiled
# output.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# The database and backups live in DATA_DIR. In production a persistent volume is mounted there.
# (There is deliberately no VOLUME instruction: Railway does not allow it, and Fly mounts its own.)
RUN mkdir -p /data

# This image runs as root on purpose. Railway mounts its volume at runtime, owned by root, so a
# non-root user could not write the database to it. If you ever add a "USER", also set
# RAILWAY_RUN_UID=0 on Railway so the volume stays writable.

EXPOSE 3000

# Docker's own health check (Railway and Fly run their own checks against /healthz as well). There is
# no curl in this image, so Node does the request.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form: node is process 1 and receives SIGTERM directly, so Tempo can close the web server,
# flush the database and exit cleanly when the host stops it.
CMD ["node", "dist/server/main.js"]
