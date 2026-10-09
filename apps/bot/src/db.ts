// Postgres on Neon is the only storage. The bot collects three times a day and
// publishes once, so the database wakes three times a day.
//
// bot_items   — what the collections found since the last publication
// bot_posted  — every story sent to the channel; stops a repost on a later day
// bot_runs    — one row per local day: the once-a-day claim and the call budget
// digest      — owned by daily-api; the bot adds each posted story so the page
//               at tldr.cdroma.me carries exactly the channel's ten
import postgres from 'postgres';
import type { Entry } from './format.ts';
import type { Item } from './normalize.ts';
import { publicationDay, TZ } from './publication.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set — the bot keeps its state in Postgres');

export const sql = postgres(url, { max: 4, onnotice: () => {} });

export type PostedRow = { cluster_key: string; title: string };

export async function initDb(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS bot_items (
      id           TEXT PRIMARY KEY,
      source       TEXT NOT NULL,
      section      TEXT NOT NULL,
      title        TEXT NOT NULL,
      url          TEXT NOT NULL,
      domain       TEXT NOT NULL,
      published_at TIMESTAMPTZ,
      raw_summary  TEXT NOT NULL DEFAULT '',
      points       INTEGER,
      weight       REAL NOT NULL DEFAULT 1,
      first_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS bot_items_first_seen ON bot_items (first_seen)`;
  await sql`
    CREATE TABLE IF NOT EXISTS bot_posted (
      cluster_key TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      url         TEXT NOT NULL,
      posted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS bot_posted_at ON bot_posted (posted_at)`;
  await sql`
    CREATE TABLE IF NOT EXISTS bot_runs (
      day         DATE PRIMARY KEY,
      started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      model_calls INTEGER NOT NULL DEFAULT 0
    )`;
}

/** Saves a collection; an item already known keeps its first sighting. Drops week-old rows. */
export async function saveItems(items: Item[]): Promise<number> {
  await sql`DELETE FROM bot_items WHERE first_seen < now() - interval '7 days'`;
  if (!items.length) return 0;
  const rows = items.map((i) => ({
    id: i.id,
    source: i.source,
    section: i.section,
    title: i.title,
    url: i.url,
    domain: i.domain,
    published_at: i.publishedAt,
    raw_summary: i.rawSummary ?? '',
    points: i.points ?? null,
    weight: i.weight,
  }));
  let added = 0;
  // Chunks keep each statement well under the 65k parameter limit.
  for (let n = 0; n < rows.length; n += 500) {
    const res = await sql`
      INSERT INTO bot_items ${sql(rows.slice(n, n + 500))}
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    added += res.length;
  }
  return added;
}

type ItemRow = {
  id: string;
  source: string;
  section: string;
  title: string;
  url: string;
  domain: string;
  published_at: Date | null;
  raw_summary: string;
  points: number | null;
  weight: number;
};

/** Everything first seen in the last `hours`: the day's candidates. */
export async function collectedSince(hours: number): Promise<Item[]> {
  const rows = await sql<ItemRow[]>`
    SELECT id, source, section, title, url, domain, published_at, raw_summary, points, weight
    FROM bot_items WHERE first_seen > now() - make_interval(hours => ${hours})`;
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    section: r.section,
    title: r.title,
    url: r.url,
    domain: r.domain,
    publishedAt: r.published_at,
    rawSummary: r.raw_summary,
    points: r.points ?? undefined,
    weight: r.weight,
  }));
}

/** One publication per local day, across restarts and concurrent processes. */
export async function claimDailyPublication(date = new Date()): Promise<boolean> {
  const rows = await sql`
    INSERT INTO bot_runs (day, started_at) VALUES (${publicationDay(date)}, ${date})
    ON CONFLICT (day) DO NOTHING RETURNING day`;
  return rows.length === 1;
}

/**
 * The hard ceiling on spend: one tick per request sent to the model. Whatever
 * goes wrong upstream, the bot cannot make more calls than this in a day.
 * Dedup can reserve budget for classification and summaries without spending it.
 */
export async function spendModelCall(limit: number, reserve = 0): Promise<boolean> {
  const day = publicationDay();
  await sql`INSERT INTO bot_runs (day) VALUES (${day}) ON CONFLICT (day) DO NOTHING`;
  const rows = await sql`
    UPDATE bot_runs SET model_calls = model_calls + 1
    WHERE day = ${day} AND model_calls < ${limit - reserve} RETURNING model_calls`;
  return rows.length === 1;
}

/** What went out in the last week: by cluster key, and by title for the similarity check. */
export async function recentPosted(days = 7): Promise<PostedRow[]> {
  return sql<PostedRow[]>`
    SELECT cluster_key, title FROM bot_posted
    WHERE posted_at > now() - make_interval(days => ${days})
    ORDER BY posted_at DESC`;
}

const slotFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** A story has gone out: remember it, and put it on the day's page. */
export async function recordPosted(
  clusterKey: string,
  day: string,
  e: Entry,
  position: number,
  at = new Date(),
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO bot_posted (cluster_key, title, url, posted_at)
      VALUES (${clusterKey}, ${e.title}, ${e.url}, ${at})
      ON CONFLICT (cluster_key) DO UPDATE SET title = EXCLUDED.title, posted_at = EXCLUDED.posted_at`;
    await tx`
      INSERT INTO digest (day, published_at, slot, section, title, url, domain, summary, minutes, position)
      VALUES (${day}, ${at}, ${slotFormat.format(at)}, ${e.section}, ${e.title}, ${e.url},
              ${e.domain}, ${e.summary}, ${e.minutes}, ${position})
      ON CONFLICT (day, url) DO NOTHING`;
  });
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
