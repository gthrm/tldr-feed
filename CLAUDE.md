# newsbot

TLDR-style tech/dev/AI news digest → Telegram channel, 10 slots a day between
09:00 and 21:00 CET, only when there is something new.

Full plan: `~/.claude/plans/graceful-conjuring-ember.md`

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

Never invent limits either — no cap on items per digest, no cap per source.
Every new item is posted. If a boundary is not in this file, do not add one.

### Never hunt for credentials
Do not grep the filesystem, shell configs or other projects for API keys.
Write `.env.example`, tell the user which variable to fill, and stop.
The canonical name is `OPENAI_API_KEY` — not `OPEN_AI_API_KEY`.

### Verify before asserting — never answer from memory
- **Model ids and pricing:** always check the official OpenAI docs before naming a
  model. The knowledge cutoff makes ids stale; `gpt-5.4-mini` was recommended here
  and was already two generations old. Current family is GPT-5.6
  (`sol`/`terra`/`luna`); GPT-6 is flagship-only (`gpt-6-astra`), no cheap tier.
- **Feeds and APIs:** check with a live request. Do not claim a site "has RSS".
  Anthropic, Mistral, VentureBeat, x.ai and Meta AI have no usable feed.
- **Model quality:** never claim a model "will handle it" without running it on
  real inputs. `OPENAI_MODEL=gpt-5.6-terra` was chosen by an actual bake-off,
  not by price.

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
