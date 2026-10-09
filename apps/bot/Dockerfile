# Build context is the monorepo root: the bot needs packages/sources, which is
# shared with the daily digest.
# One native piece here: Playwright needs Chromium. State lives in Postgres (Neon).
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/bot/package.json ./apps/bot/
RUN npm ci --omit=dev --no-audit --no-fund --foreground-scripts \
      --workspace tldr-feed --include-workspace-root=false

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/bot/package.json ./apps/bot/
# Chromium plus the system libraries it needs. Only VentureBeat uses it.
RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm
COPY apps/bot/src ./apps/bot/src
COPY apps/bot/scripts ./apps/bot/scripts
# The shared source list. Same relative layout as the repo, so the path the code
# resolves works identically here and on a laptop.
COPY packages/sources ./packages/sources
# Node 24 runs .ts directly via type stripping — no build step.
CMD ["node", "apps/bot/src/index.ts"]
