# tldr-feed

A TLDR-style tech news digest for Telegram. Polls ~47 tech / developer / AI
sources, drops duplicates and off-topic items, summarises what is left with
OpenAI, and posts up to ten top-ranked stories once a day at 10:00 Europe/Belgrade,
each story in a separate Telegram message.

## How it works

```
sources.yaml ──> fetch ──> normalize ──> dedupe ──> rank
                                                      │
                            classify (relevant? section? promo?)
                                                      │
                              extract ──> summarize ──> format ──> Telegram
```

Four kinds of source, because not every site has a feed:

| kind      | used for                            | how                                               |
| --------- | ----------------------------------- | ------------------------------------------------- |
| `feed`    | most sources                        | RSS/Atom, conditional GET via ETag                |
| `api`     | Hacker News, HF papers, YC launches | JSON endpoints                                    |
| `rsshub`  | Anthropic, Qwen                     | self-hosted RSSHub turns them into feeds          |
| `sitemap` | Mistral                             | sitemap + Open Graph tags, no browser needed      |
| `browser` | VentureBeat                         | answers 429 to every HTTP client, 200 to Chromium |

### Duplicate protection

One announcement reaches us from five outlets within minutes. Four stages:

1. **Same URL** — canonicalised (tracking params stripped, redirects resolved,
   `amp/` and `www.` normalised), then a unique index in SQLite.
2. **Same story, different URLs** — trigram similarity of the normalised title
   combined with overlap of entity tokens (`Samsung`, `HBM4`, `Qwen Image 2.1`).
   Above 0.55 the items join a cluster, below 0.40 they stay apart.
3. **Grey band 0.40–0.55** — one cheap model call: "same event, yes or no".
4. **Across days** — cluster keys are remembered for 7 days, plus a
   title-similarity check against the last 200 posted items.

### Relevance gate

Hacker News carries whales, libraries and machinist tools; press feeds carry
conference ticket ads. Every candidate gets one headline-only classification
call before extraction: relevant or not, which section, promo or news. The
section comes from the article, never from the source.

## Running it

```bash
cp .env.example .env     # then fill in the three secrets
npm install
npx playwright install chromium

npm run check-sources    # every source, live, with item counts and latency
npm test                 # dedup, URL canonicalisation, daily schedule and publication limits
DRY_RUN=1 npm start -- --slot   # full pipeline, prints instead of posting
```

`DRY_RUN=1` prints the digest to the console. Remove it to post for real.

### Deployment

```bash
docker compose up -d --build
```

Two services: `rsshub` (stock upstream image) and `bot`. RSSHub is bound to
loopback and reached by service name; nothing is published to the network.
SQLite lives in `./data`, so it survives rebuilds.

## Configuration

| variable                  | default                 | meaning                                                  |
| ------------------------- | ----------------------- | -------------------------------------------------------- |
| `OPENAI_API_KEY`          | —                       | required                                                 |
| `OPENAI_MODEL`            | `gpt-5.6-terra`         | chosen by a bake-off against `gpt-5.6-luna`              |
| `TELEGRAM_BOT_TOKEN`      | —                       | required; the bot must be a channel admin                |
| `TELEGRAM_CHANNEL_ID`     | —                       | `@channelname` or a numeric id                           |
| `RSSHUB_BASE_URL`         | `http://localhost:1200` | `http://rsshub:1200` under compose                       |
| `DRY_RUN`                 | `0`                     | `1` prints instead of posting                            |
| `MIN_ITEMS`               | `1`                     | fewer surviving items than this and the run stays silent |
| `MAX_MODEL_CALLS_PER_DAY` | `100`                   | hard ceiling on OpenAI requests per day                  |
| `PIPELINE_CONCURRENCY`    | `6`                     | items processed in parallel                              |
| `TZ_NAME`                 | `Europe/Belgrade`       | timezone for the 10:00 publication and daily guard       |
| `POLL_MINUTES`            | `20`                    | quiet collection interval; never publishes               |

The bot ranks the queued stories and publishes up to
10 that survive the relevance and readability checks, in rank order. The ceiling
is fixed; the old `MAX_ITEMS_PER_SLOT` setting is ignored. Each story gets its own
complete message, capped at 4096 characters by trimming text while preserving HTML.

There is only one publication attempt per local calendar day, remembered in SQLite
across restarts and manual `--slot` / `--once` runs. A failed or interrupted run
does not send another batch that day. Successfully sent stories are recorded
immediately; unsent stories remain queued for tomorrow if still within the existing
36-hour queue window.
Dry runs neither claim a publication day nor consume the queue. On upgrade, any
posts already recorded today prevent another batch until tomorrow.

`npm start -- --today` explicitly rebuilds today's top ten from all stories
collected today, including stories consumed by the old slots. It allows a new
batch despite legacy posts on upgrade day; previously posted stories are still
excluded, and the new daily batch cannot repeat. Use this only for an intentional
manual rebuild.

Collection runs quietly every 20 minutes and once before the 10:00 publication.
The timezone handles summer time automatically. Three model failures stop candidate
processing and keep the queue when too few stories have survived.
Dedup comparisons leave 40 model calls available for classification and summaries
so a full day's queue cannot consume the entire budget before publication.

## Adding a source

Add an entry to `src/sources.yaml`, then run `npm run check-sources`. If a site
has no feed, try its sitemap first (`kind: sitemap`), then RSSHub
(`kind: rsshub`), and only reach for `kind: browser` when the site refuses
plain HTTP clients outright.

Sources deliberately excluded, with reasons, are listed at the bottom of
`sources.yaml`.
