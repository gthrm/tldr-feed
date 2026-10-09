# Build context is the monorepo root: the daily needs the site sources, which it
# rebuilds every day from the stories the bot posted.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
COPY apps/daily-api/package.json ./apps/daily-api/
COPY apps/daily-web/package.json ./apps/daily-web/
# Dev dependencies stay: the evening run invokes the site build, which needs
# vite and svelte at runtime.
#
# Installed without the lockfile on purpose. The lock is written on a Mac, so it
# has no linux-arm64 entry for rolldown's native binding, and npm skips optional
# dependencies missing from a lock it is given (npm/cli#4828) — `npm ci` and
# `npm install` both then build an image whose site build dies on a missing
# binding. Resolving from package.json on the Pi picks the right binary for the
# platform this will actually run on. The bot's image still installs from the
# lock: it has no native optional dependencies.
RUN npm install --include=dev --no-audit --no-fund \
      --workspace @tldr/daily-api --workspace @tldr/daily-web \
      --include-workspace-root=false

FROM deps AS build
COPY apps/daily-api ./apps/daily-api
COPY apps/daily-web ./apps/daily-web
RUN npm run --workspace @tldr/daily-api build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    API_PORT=3090 \
    SITE_OUT=/public \
    DATA_DIR=/app/data \
    SITE_DIR=/app/apps/daily-web
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/daily-api ./apps/daily-api
COPY --from=build /app/apps/daily-web ./apps/daily-web
RUN mkdir -p /app/data /public
WORKDIR /app/apps/daily-api
EXPOSE 3090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3090/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
