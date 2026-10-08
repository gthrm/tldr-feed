// SQLite is the memory between slots: what we have seen, what we already posted.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import type { Item } from './normalize.ts';
import { dirname } from 'node:path';
import { publicationDay } from './publication.ts';

const path = process.env.DB_PATH ?? 'data/tldr-feed.db';
mkdirSync(dirname(path), { recursive: true });

export const db = new Database(path);

/** Rows as SQLite stores them: snake_case, dates as epoch milliseconds. */
export type ItemRow = {
  id: string;
  source: string;
  section: string;
  title: string;
  url: string;
  domain: string;
  published_at: number | null;
  raw_summary: string | null;
  points: number | null;
  weight: number;
};

export type PostedRow = { cluster_key: string; title: string };
export type SummaryRow = { summary: string; minutes: number };
export type SourceStateRow = {
  source: string;
  etag: string | null;
  last_modified: string | null;
  last_ok: number | null;
  last_error: string | null;
};

type CountRow = { n: number };
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id           TEXT PRIMARY KEY,      -- sha1 of the canonical url: stage 1 dedup
    source       TEXT NOT NULL,
    section      TEXT NOT NULL,
    title        TEXT NOT NULL,
    url          TEXT NOT NULL UNIQUE,
    domain       TEXT NOT NULL,
    published_at INTEGER,
    raw_summary  TEXT,
    points       INTEGER,
    weight       REAL NOT NULL DEFAULT 1,
    first_seen   INTEGER NOT NULL,
    consumed_at  INTEGER            -- NULL until a slot has considered it
  );
  CREATE INDEX IF NOT EXISTS items_first_seen ON items(first_seen);

  CREATE TABLE IF NOT EXISTS posted (
    cluster_key TEXT PRIMARY KEY,       -- stage 4: cross-slot memory
    item_id     TEXT NOT NULL,
    title       TEXT NOT NULL,
    posted_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS posted_at ON posted(posted_at);

  CREATE TABLE IF NOT EXISTS daily_publications (
    day        TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS summaries (
    content_hash TEXT PRIMARY KEY,      -- never pay twice for the same article
    model        TEXT NOT NULL,
    summary      TEXT NOT NULL,
    minutes      INTEGER,
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS source_state (
    source        TEXT PRIMARY KEY,     -- conditional GET, so we are polite
    etag          TEXT,
    last_modified TEXT,
    last_ok       INTEGER,
    last_error    TEXT
  );
`);

const now = () => Date.now();

// Existing databases predate consumed_at; add it and treat everything already
// there as consumed, so a migration does not repost yesterday's news.
const columns = db.prepare('PRAGMA table_info(items)').all() as { name: string }[];
if (!columns.some((c) => c.name === 'consumed_at')) {
  db.exec('ALTER TABLE items ADD COLUMN consumed_at INTEGER');
  db.exec('UPDATE items SET consumed_at = first_seen');
}
// After the column is guaranteed to exist, never before it.
db.exec(
  'CREATE INDEX IF NOT EXISTS items_unconsumed ON items(consumed_at) WHERE consumed_at IS NULL',
);

export const isKnown = db.prepare('SELECT 1 FROM items WHERE id = ?');

/** True before the first run has recorded anything: everything would look new. */
export function isColdStart(): boolean {
  return (db.prepare('SELECT COUNT(*) AS n FROM items').get() as CountRow).n === 0;
}
const insertItem = db.prepare(`
  INSERT OR IGNORE INTO items
    (id, source, section, title, url, domain, published_at, raw_summary, points, weight, first_seen)
  VALUES (@id, @source, @section, @title, @url, @domain, @published_at, @raw_summary, @points, @weight, @first_seen)
`);

/** Returns only the items we had not seen before. */
export function recordNew<T extends Item>(items: T[]): T[] {
  const fresh: T[] = [];
  const tx = db.transaction((batch: T[]) => {
    for (const it of batch) {
      const res = insertItem.run({
        id: it.id,
        source: it.source,
        section: it.section,
        title: it.title,
        url: it.url,
        domain: it.domain,
        published_at: it.publishedAt ? it.publishedAt.getTime() : null,
        raw_summary: it.rawSummary ?? '',
        points: it.points ?? null,
        weight: it.weight,
        first_seen: now(),
      });
      if (res.changes > 0) fresh.push(it);
    }
  });
  tx(items);
  return fresh;
}

// Every statement is prepared once, at module level. Preparing inside a function
// creates a Statement object per call, and their destructors are what abort the
// process at teardown (RemoveEnvironmentCleanupHook, env == nullptr).
const markPosted = db.prepare(
  'INSERT OR REPLACE INTO posted (cluster_key, item_id, title, posted_at) VALUES (?, ?, ?, ?)',
);
const selPending = db.prepare(`
  SELECT id, source, section, title, url, domain, published_at, raw_summary, points, weight
  FROM items
  WHERE consumed_at IS NULL AND first_seen > ?
  ORDER BY COALESCE(published_at, first_seen) DESC
`);
const selCollected = db.prepare(`
  SELECT id, source, section, title, url, domain, published_at, raw_summary, points, weight, first_seen
  FROM items WHERE first_seen >= ?
`);
const updConsumed = db.prepare('UPDATE items SET consumed_at = ? WHERE id = ?');
const selWasPosted = db.prepare('SELECT 1 FROM posted WHERE cluster_key = ? AND posted_at > ?');
const selRecentTitles = db.prepare(
  'SELECT cluster_key, title FROM posted ORDER BY posted_at DESC LIMIT ?',
);
const insSummary = db.prepare(
  'INSERT OR REPLACE INTO summaries (content_hash, model, summary, minutes, created_at) VALUES (?,?,?,?,?)',
);
const selSummary = db.prepare(
  'SELECT summary, minutes FROM summaries WHERE content_hash = ? AND model = ?',
);
const selSourceState = db.prepare('SELECT * FROM source_state WHERE source = ?');
const updSourceState = db.prepare(`
  INSERT INTO source_state (source, etag, last_modified, last_ok, last_error)
  VALUES (@source, @etag, @lm, @ok, @err)
  ON CONFLICT(source) DO UPDATE SET
    etag = COALESCE(@etag, etag),
    last_modified = COALESCE(@lm, last_modified),
    last_ok = COALESCE(@ok, last_ok),
    last_error = @err
`);
const delItems = db.prepare('DELETE FROM items WHERE first_seen < ?');
const delPosted = db.prepare('DELETE FROM posted WHERE posted_at < ?');
const delSummaries = db.prepare('DELETE FROM summaries WHERE created_at < ?');
const insPublication = db.prepare(
  'INSERT OR IGNORE INTO daily_publications (day, started_at) VALUES (?, ?)',
);
const selPostedTimes = db.prepare('SELECT posted_at FROM posted WHERE posted_at >= ?');
const delPublications = db.prepare('DELETE FROM daily_publications WHERE started_at < ?');

const claimPublication = db.transaction((date: Date, allowLegacyPosts: boolean): boolean => {
  const day = publicationDay(date);
  // Respect messages sent by the old scheduler on the day of the upgrade too.
  const recent = selPostedTimes.all(date.getTime() - 48 * 3.6e6) as { posted_at: number }[];
  if (!allowLegacyPosts && recent.some((row) => publicationDay(new Date(row.posted_at)) === day))
    return false;
  return insPublication.run(day, date.getTime()).changes === 1;
});

/** Claim one batch per local day, even across restarts or concurrent processes. */
export function claimDailyPublication(date = new Date(), allowLegacyPosts = false): boolean {
  return claimPublication.immediate(date, allowLegacyPosts);
}
/**
 * Recently collected items that no publication has considered yet.
 * The poller runs every 20 minutes, preserving stories from fast-moving feeds.
 */
export function pendingItems(maxAgeHours = 36): ItemRow[] {
  return selPending.all(now() - maxAgeHours * 3.6e6) as ItemRow[];
}

/** Manual rebuild: reconsider today's collected stories, including old-slot rejects. */
export function collectedToday(date = new Date()): ItemRow[] {
  const day = publicationDay(date);
  const rows = selCollected.all(date.getTime() - 48 * 3.6e6) as (ItemRow & {
    first_seen: number;
  })[];
  return rows.filter((row) => publicationDay(new Date(row.first_seen)) === day);
}

/** A slot has considered these, whether or not they made the digest. */
export function markConsumed(ids: string[]): void {
  const tx = db.transaction((batch: string[]) => {
    for (const id of batch) updConsumed.run(now(), id);
  });
  tx(ids);
}

export function recordPosted(clusterKey: string, itemId: string, title: string): void {
  markPosted.run(clusterKey, itemId, title, now());
}

export function wasPosted(clusterKey: string, windowDays = 7): boolean {
  return Boolean(selWasPosted.get(clusterKey, now() - windowDays * 864e5));
}

/** Titles posted recently, for the stage-4 similarity safety net. */
export function recentPostedTitles(limit = 200): PostedRow[] {
  return selRecentTitles.all(limit) as PostedRow[];
}

// Keyed by url AND content: two aggregator pages can yield identical extracted
// text, and a content-only key then serves one story's summary for another.
// The hard ceiling on spend: one row per local day, one tick per request sent
// to the model. Whatever goes wrong upstream — a flooded queue, a retry loop —
// the bot cannot make more than this many calls in a day.
db.exec('CREATE TABLE IF NOT EXISTS model_calls (day TEXT PRIMARY KEY, n INTEGER NOT NULL)');
const selModelCalls = db.prepare('SELECT n FROM model_calls WHERE day = ?');
const incModelCalls = db.prepare(`
  INSERT INTO model_calls (day, n) VALUES (?, 1)
  ON CONFLICT(day) DO UPDATE SET n = n + 1
`);

const spendCall = db.transaction((limit: number, reserve: number): boolean => {
  const day = publicationDay();
  const used = (selModelCalls.get(day) as { n: number } | undefined)?.n ?? 0;
  if (used >= limit - reserve) return false;
  incModelCalls.run(day);
  return true;
});

/** Dedup can reserve budget for classification and summaries without spending it. */
export function spendModelCall(limit: number, reserve = 0): boolean {
  return spendCall.immediate(limit, reserve);
}

export function cacheSummary(hash: string, model: string, summary: string, minutes: number): void {
  insSummary.run(hash, model, summary, minutes, now());
}

export function cachedSummary(hash: string, model: string): SummaryRow | undefined {
  return selSummary.get(hash, model) as SummaryRow | undefined;
}

export function getSourceState(source: string): SourceStateRow | undefined {
  return selSourceState.get(source) as SourceStateRow | undefined;
}

export function setSourceState(
  source: string,
  s: { etag?: string; lastModified?: string; error?: string },
): void {
  updSourceState.run({
    source,
    etag: s.etag ?? null,
    lm: s.lastModified ?? null,
    ok: s.error ? null : now(),
    err: s.error ?? null,
  });
}

/**
 * better-sqlite3 crashes in its Statement destructor if the process exits with
 * the database still open: the native addon is torn down after Node has already
 * removed the environment. Closing explicitly keeps exits clean.
 */
let closed = false;
export function closeDb(): void {
  if (closed) return;
  closed = true;
  // Separate blocks: a failing checkpoint must not skip the close, which is the
  // part that actually prevents the native teardown crash.
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* not fatal */
  }
  try {
    db.close();
  } catch {
    /* already closed */
  }
}

for (const signal of ['exit', 'SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    closeDb();
    if (signal !== 'exit') process.exit(0);
  });
}

/** Keep the database from growing without bound on a Raspberry Pi. */
export function prune(days = 30): void {
  delItems.run(now() - days * 864e5);
  delPosted.run(now() - days * 864e5);
  delSummaries.run(now() - days * 864e5);
  delPublications.run(now() - days * 864e5);
}
