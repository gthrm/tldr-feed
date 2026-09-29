# tldr

Two products over one list of sources.

| | what it is | where it runs |
| --- | --- | --- |
| [`apps/bot`](apps/bot) | the Telegram channel: ten slots a day, 09:00–21:00 CET, only when there is something new | its own container, its own SQLite |
| [`apps/daily-api`](apps/daily-api) | the daily digest: one evening run that builds a page and sends one email | its own container, Neon Postgres |
| [`apps/daily-web`](apps/daily-web) | the site at `tldr.cdroma.me`: a static page per day | files, served by Caddy |
| [`packages/sources`](packages/sources) | `sources.yaml` — the one thing both read | a file |

The bot posts often and posts everything. The daily is a different product with a
different rhythm: one run in the evening, the twenty best stories of the day, one
page, one email. **They share the source list and
nothing else** — no shared code, no shared database, no calls between them. Add
or drop a source in `packages/sources/sources.yaml` and both pick it up.

## The evening run

At 21:10 Europe/Belgrade, after the day's last news has landed:

```
fetch (same sources) → dedupe → rank → classify → extract → summarize
   │
   ├─ 1. the day is written to Neon          ─┐
   ├─ 2. the static site is rebuilt           │  one window: the database wakes,
   ├─ 3. the email goes out via Resend        │  four statements run, it sleeps
   └─ 4. the page is served by Caddy         ─┘  until tomorrow evening
```

Nothing reads the database to serve a page. Neon's free plan suspends a compute
after five minutes of inactivity and bills by the hour it is awake, so what costs
money is the number of wake-ups, not the number of rows. One a day fits inside
100 CU-hours with room to spare — and `apps/daily-api/src/jobs/daily.job.spec.ts`
asserts the count, because a budget nobody measures is a budget nobody keeps.

## Running it

```bash
npm install                  # one install for the whole monorepo

npm run seed                 # two days of invented entries, so there is something to see
npm run site                 # the site at http://localhost:5173

npm run job -- --preview                      # what today holds, headlines only, free
npm run job -- --dry-run --skip-build         # the full run: writes nothing, sends nothing
npm run job -- --day 2026-09-28               # the real thing

npm run check                # bot and daily: typecheck, lint, tests
```

`MAIL_DRY_RUN=1` prints the email instead of sending it. Keep it on until the
first live test.

## Deployment

One compose stack on the Raspberry Pi: `rsshub`, `bot`, `daily-api`, `caddy`.

When upgrading from the single-app layout, stop the bot and move its existing
`data/` directory to `apps/bot/data/` before recreating the container. This keeps
the SQLite history and queue; an empty directory would lose deduplication state.

```bash
docker compose up -d --build
```

Caddy listens on `127.0.0.1:3091` and serves last night's build; `/api/*` is the
only path that reaches the application. The way in from outside is the Cloudflare
tunnel already running on the Pi:

```yaml
# ~/.cloudflared/config.yml, before the http_status:404 rule
  - hostname: tldr.cdroma.me
    service: http://localhost:3091
```

then `cloudflared tunnel route dns <tunnel> tldr.cdroma.me` and restart the
service. TLS terminates at Cloudflare.

Secrets live in `.env` beside the compose file — see `.env.example`. Database
migrations: `npm run -w @tldr/daily-api db:migrate`.

## What is where

- `apps/bot/README.md` — the bot in detail: sources, four-stage dedup, the
  relevance gate, its configuration.
- `packages/sources/README.md` — the shared list and how each app finds it.
