# tldr-feed

TLDR-style tech/dev/AI news digest → Telegram channel, once a day at
10:00 Europe/Belgrade, at most ten stories, each in a separate message.
The same ten go to the page at tldr.cdroma.me and the email. Nothing else.

Full plan: `~/.claude/plans/graceful-conjuring-ember.md`

## Layout

A monorepo. Two applications that share one resource and no code:

| path               | what                                                                           |
| ------------------ | ------------------------------------------------------------------------------ |
| `apps/bot`         | collects at 02:00, 10:00, 18:00; at 10:00 picks and posts the ten              |
| `apps/daily-api`   | NestJS: at 10:30 builds the page and the email from the bot's ten; no model     |
| `apps/daily-web`   | SvelteKit: the static day pages at tldr.cdroma.me                              |
| `packages/sources` | `sources.yaml` — the source list, read by the bot                              |

**One storage: Postgres on Neon (`DATABASE_URL`).** No SQLite, no files as state.
The bot owns `bot_items`, `bot_posted`, `bot_runs` and writes each posted story
into `digest`; daily-api reads `digest` and owns `subscribers`, `mail_log`.
Only the bot calls the model. Neon wakes three times a day; keep it that way.

## Working rules

These come from mistakes made while planning this project. They are not optional.

### IF YOU DO NOT KNOW SOMETHING, ASK

IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.
IF YOU DO NOT KNOW SOMETHING, ASK.

Never guess. Never silently work around a blocker. Never substitute another machine,
another source or another approach and carry on as if nothing happened.

Docker daemon off, API key missing, approval needed, a source that may not be the
right one, a model whose quality is unverified: ASK. The user is at the keyboard and
clears these in seconds. One short sentence naming the blocker and what clears it.

### NEVER NARROW THE SCOPE

The audience is people who work in tech and are curious far beyond it: games,
culture, history, science, language, oddities — the Hacker News front page.
Not "developers", not "tech news only".

Include by default. A 1996 game design document, an essay that announces
nothing, a rant about hype, a buying guide about hardware: all belong in.
Only these are out: party politics, legislative process with no tech angle,
celebrity gossip, sport, purely local news, health advice, coupon round-ups
and advertising.

Only the hottest stories go out, because every item costs model calls: ten a
day, posted at 10:00 Europe/Belgrade, each in a separate message, and the same
ten on the page and in the email. The cut is made on the ranking, before any
model call. Posting everything ran ~1000 items a day through the model and
emptied the OpenAI balance twice (2026-09-29, 2026-10-01). A second, separate
top-20 selection for the page also existed until 2026-10-09; the user never
wanted it. Do not add one back.

Never invent other limits — no cap per source, no narrower topic filter. If a
boundary is not in this file, do not add one.

### Never hunt for credentials

Do not grep the filesystem, shell configs or other projects for API keys.
Write `.env.example`, tell the user which variable to fill, and stop.
The canonical name is `OPENAI_API_KEY` — not `OPEN_AI_API_KEY`.

### Verify before asserting — never answer from memory

- **Model ids and pricing:** always check the official OpenAI docs before naming a
  model. The knowledge cutoff makes ids stale. As of 2026-10-09 the newest family
  is GPT-6 (`gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-luna`); `gpt-6-luna` is the
  cheapest ($0.10/$0.50 per 1M). An earlier note here claimed GPT-6 had no cheap
  tier — it was wrong.
- **Feeds and APIs:** check with a live request. Do not claim a site "has RSS".
  Anthropic, Mistral, VentureBeat, x.ai and Meta AI have no usable feed.
- **Model quality:** never claim a model "will handle it" without running it on
  real inputs. `OPENAI_MODEL=gpt-6-luna` since 2026-10-09, the user's call for
  cost. Its token caps include reasoning; caps of 50–300 left it with no answer.

### Say what is untested, up front

If something has not been verified, label it as an assumption in the same
sentence that introduces it — not after being challenged.

### Uniform output format

Every source renders identically. No per-source special cases, no extra fields
for Hacker News or anyone else. A source is one line of plain text.

### Links point at the article

Every link goes to the specific piece being summarised, never to a domain root
and never to a discussion thread. `npm run check-links` enforces this.

## Deployment

Raspberry Pi 5, ssh alias `home` (`192.168.0.26`), Ubuntu 24.04 aarch64,
8 GB RAM, 69 GB disk, Docker 29.8.1. Docker Compose, not k3s.
It already runs grafana/loki/promtail/prometheus/pihole/qbittorrent/shlink —
do not take their ports, and keep RSSHub's Chromium at concurrency 1.
