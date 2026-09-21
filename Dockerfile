# Two native pieces here: better-sqlite3 needs a toolchain, Playwright needs Chromium.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund --foreground-scripts

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# Chromium plus the system libraries it needs. Only VentureBeat uses it.
RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/data
# Node 24 runs .ts directly via type stripping — no build step.
CMD ["node", "src/index.ts"]
