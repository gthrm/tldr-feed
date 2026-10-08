// One daily top ten, published as one Telegram message per story.
import { loadSources, fetchAll } from './fetch/index.ts';
import { closeBrowser, fetchHtmlWithBrowser } from './fetch/browser.ts';
import { clusterItems, compare } from './dedupe.ts';
import { rankClusters } from './rank.ts';
import { extractArticle } from './extract.ts';
import { summarize, sameStory, classify } from './summarize.ts';
import { formatDigest, type Entry } from './format.ts';
import { sendMessage } from './telegram.ts';
import {
  recordNew,
  recordPosted,
  wasPosted,
  recentPostedTitles,
  prune,
  pendingItems,
  markConsumed,
  closeDb,
  claimDailyPublication,
  collectedToday,
} from './db.ts';
import { isDomainRoot } from './normalize.ts';
import { startSchedule } from './schedule.ts';
import type { Item } from './normalize.ts';
import type { ItemRow } from './db.ts';
import { MAX_DAILY_POSTS, publicationDay, TZ } from './publication.ts';

// A slot is skipped only when nothing new survived.
const MIN_ITEMS = Number(process.env.MIN_ITEMS ?? 1);
// Fixed ceiling: obsolete MAX_ITEMS_PER_SLOT settings cannot change the top ten.
const MAX_ITEMS = MAX_DAILY_POSTS;
// A dead model (no credits, bad key, outage) fails every call the same way.
// Stop after a few instead of walking the whole queue into the same error.
const MAX_MODEL_FAILURES = 3;
const DRY_RUN = process.env.DRY_RUN === '1';
const RSSHUB = process.env.RSSHUB_BASE_URL ?? 'http://localhost:1200';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

// A long-running daemon must not die because one stray promise rejected. A
// Playwright route abort losing its race killed the scheduler before every
// slot; log it and keep the schedule alive.
process.on('unhandledRejection', (reason) => {
  log('unhandled rejection (continuing):', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  log('uncaught exception (continuing):', err?.message ?? err);
});

/**
 * Collection only, every 20 minutes. Fast feeds rotate stories out long before
 * the next morning's publication, so save them without posting anything.
 */
export async function poll(): Promise<void> {
  const { sources } = loadSources();
  const all = await fetchAll(sources, RSSHUB);
  const fresh = recordNew(all); // stage 1: same url, already seen
  log(`poll: ${all.length} items seen, ${fresh.length} new queued`);
}

function rowToItem(r: ItemRow): Item {
  return {
    id: r.id,
    source: r.source,
    section: r.section,
    weight: r.weight,
    title: r.title,
    url: r.url,
    domain: r.domain,
    publishedAt: r.published_at ? new Date(r.published_at) : null,
    rawSummary: r.raw_summary ?? '',
    points: r.points ?? undefined,
  };
}

export async function runSlot(options: { rebuildToday?: boolean } = {}): Promise<void> {
  const startedAt = new Date();
  const rebuildToday = options.rebuildToday ?? false;
  if (!DRY_RUN && !claimDailyPublication(startedAt, rebuildToday)) {
    log('daily publication already attempted — skipped');
    return;
  }
  // Whatever the poller has queued since the last slot. No fetching here: the
  // slot publishes what was already collected.
  const fresh = (rebuildToday ? collectedToday(startedAt) : pendingItems()).map(rowToItem);
  log(`slot: ${fresh.length} items queued since the last slot`);

  if (fresh.length === 0) {
    log('nothing new — slot skipped');
    return;
  }

  // stage 2 + 3: one cluster per story, the heaviest source represents it
  const clusters = await clusterItems(fresh, async (a, b) => {
    try {
      return await sameStory(a.title, b.title);
    } catch {
      return false; // model unavailable: keep them apart
    }
  });

  // stage 4: cross-slot memory, by cluster key and by title similarity
  const recent = recentPostedTitles();
  const unseen = clusters.filter((c) => {
    if (wasPosted(c.key)) return false;
    return !recent.some((p) => compare(c.items[0].title, p.title).verdict === 'same');
  });
  log(`${clusters.length} clusters, ${unseen.length} not posted before`);

  const ranked = rankClusters(unseen);

  // Process candidates concurrently, preserving rank and the daily ceiling.
  const CONCURRENCY = Number(process.env.PIPELINE_CONCURRENCY ?? 6);
  const slots: (Entry | null)[] = Array.from({ length: ranked.length }, () => null);
  let next = 0;
  let filled = 0;
  let inFlight = 0;
  let modelFailures = 0;

  // Walks the ranking from the top and stops once MAX_ITEMS have survived.
  // An item in flight counts towards the cap, so no call is made for a story
  // that could not be posted anyway.
  const work = async (idx: number): Promise<void> => {
    const head = ranked[idx].items[0];

    if (isDomainRoot(head.url)) return; // never link a bare domain

    // Relevance gate: HN carries everything, press feeds carry event promos.
    // Headline-only, before extraction, so rejects cost almost nothing.
    let verdict;
    try {
      verdict = await classify(head.title, head.domain);
    } catch (err) {
      modelFailures++;
      log(`classify failed for ${head.url}:`, err);
      return;
    }
    if (!verdict.relevant) {
      log(`skip (off-topic): ${head.title.slice(0, 60)}`);
      return;
    }
    if (verdict.promo) {
      log(`skip (promo): ${head.title.slice(0, 60)}`);
      return;
    }

    const article = await extractArticle(head.url, head.rawSummary, fetchHtmlWithBrowser);
    // A thin description still makes a usable two-sentence summary.
    if (!article.ok || article.words < 20) {
      log(`skip (unreadable): ${head.url}`);
      return; // a dead link must not reach the channel
    }

    let summary: string | null;
    try {
      summary = await summarize(head.title, article);
    } catch (err) {
      modelFailures++;
      log(`summarize failed for ${head.url}:`, err);
      return;
    }
    if (!summary) return;

    slots[idx] = {
      title: head.title,
      url: head.url,
      domain: head.domain,
      summary,
      minutes: article.minutes,
      section: verdict.section,
    };
    filled++;
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, MAX_ITEMS) }, async () => {
      while (
        next < ranked.length &&
        filled + inFlight < MAX_ITEMS &&
        modelFailures < MAX_MODEL_FAILURES
      ) {
        inFlight++;
        try {
          await work(next++);
        } finally {
          inFlight--;
        }
      }
    }),
  );

  // rank order preserved: the slot array is filled by index, not by finish time
  const entries: Entry[] = slots.filter((e): e is Entry => e !== null);

  if (entries.length < MIN_ITEMS && modelFailures >= MAX_MODEL_FAILURES) {
    // Keep the queue for tomorrow; there is no second publication today.
    log(`model failed ${modelFailures} times — slot aborted, queue kept`);
    return;
  }

  if (entries.length < MIN_ITEMS) {
    // Nothing made it, but everything was considered: rejects must not be
    // reconsidered at every later slot.
    if (!DRY_RUN) markConsumed(fresh.map((i) => i.id));
    log(`only ${entries.length} items survived (min ${MIN_ITEMS}) — slot skipped`);
    return;
  }

  const messages = formatDigest(entries, startedAt, TZ);

  if (DRY_RUN) {
    // A preview must not eat the queue: nothing is marked consumed here.
    console.log('\n' + '='.repeat(72) + `\nDRY RUN — not posted\n` + '='.repeat(72));
    messages.forEach((m, i) =>
      console.log(`\n--- message ${i + 1}/${messages.length} (${m.length} chars) ---\n${m}`),
    );
    console.log(
      '\n' + '='.repeat(72) + `\n${entries.length} items in ${messages.length} message(s)\n`,
    );
    return;
  }

  // Record each successful message immediately so a partial failure cannot
  // repost it tomorrow. The persistent daily claim prevents retries today.
  for (const [idx, e] of entries.entries()) {
    if (publicationDay() !== publicationDay(startedAt)) {
      log('publication crossed midnight — remaining posts kept for tomorrow');
      return;
    }
    await sendMessage(messages[idx]);
    const cluster = ranked.find((c) => c.items[0].url === e.url);
    if (cluster) {
      recordPosted(cluster.key, cluster.items[0].id, e.title);
      markConsumed(cluster.items.map((item) => item.id));
    }
  }
  markConsumed(fresh.map((i) => i.id));
  log(`posted ${entries.length} items`);
}

async function main(): Promise<void> {
  // `--slot` runs one full cycle by hand: collect, then publish.
  if (
    process.argv.includes('--slot') ||
    process.argv.includes('--once') ||
    process.argv.includes('--today')
  ) {
    try {
      await poll();
      await runSlot({ rebuildToday: process.argv.includes('--today') });
    } finally {
      await closeBrowser();
      closeDb();
    }
    return;
  }
  if (process.argv.includes('--poll')) {
    try {
      await poll();
    } finally {
      await closeBrowser();
      closeDb();
    }
    return;
  }
  prune();
  startSchedule(runSlot, poll);
  log(`scheduler started: daily top ${MAX_ITEMS} at 10:00 ${TZ}, one story per message`);
}

if (import.meta.main) await main();
