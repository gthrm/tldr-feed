// The slot: fetch everything, keep what is new, post one digest — or nothing.
import { loadSources, fetchAll } from './fetch/index.ts';
import { closeBrowser, fetchHtmlWithBrowser } from './fetch/browser.ts';
import { clusterItems, compare } from './dedupe.ts';
import { rankClusters } from './rank.ts';
import { extractArticle } from './extract.ts';
import { summarize, sameStory, classify } from './summarize.ts';
import { formatDigest, type Entry } from './format.ts';
import { sendMessage } from './telegram.ts';
import { recordNew, recordPosted, wasPosted, recentPostedTitles, prune, pendingItems, markConsumed, closeDb } from './db.ts';
import { isDomainRoot } from './normalize.ts';
import { startSchedule } from './schedule.ts';
import type { Item } from './normalize.ts';

// Every new item goes out; a slot is skipped only when nothing new survived.
const MIN_ITEMS = Number(process.env.MIN_ITEMS ?? 1);
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
 * Collection only, on a much shorter cycle than posting. Slots are 80 minutes
 * apart; a fast feed (HN front page, Lobsters, r/LocalLLaMA) rotates items out
 * well inside that window, so anything not collected in between is lost.
 */
export async function poll(): Promise<void> {
  const { sources } = loadSources();
  const all = await fetchAll(sources, RSSHUB);
  const fresh = recordNew(all);               // stage 1: same url, already seen
  log(`poll: ${all.length} items seen, ${fresh.length} new queued`);
}

function rowToItem(r: any): Item {
  return {
    id: r.id, source: r.source, section: r.section, weight: r.weight,
    title: r.title, url: r.url, domain: r.domain,
    publishedAt: r.published_at ? new Date(r.published_at) : null,
    rawSummary: r.raw_summary ?? '', points: r.points ?? undefined,
  };
}

export async function runSlot(): Promise<void> {
  // Whatever the poller has queued since the last slot. No fetching here: the
  // slot publishes what was already collected.
  const fresh = pendingItems().map(rowToItem);
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
      return false;                           // model unavailable: keep them apart
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

  // Each item costs a classify call, a page fetch and a summarize call. Done one
  // at a time, a busy slot would outlast its own 80-minute interval.
  const CONCURRENCY = Number(process.env.PIPELINE_CONCURRENCY ?? 6);
  const slots: (Entry | null)[] = new Array(ranked.length).fill(null);
  let next = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < ranked.length) {
        const idx = next++;
        const head = ranked[idx].items[0];

        if (isDomainRoot(head.url)) continue;     // never link a bare domain

        // Relevance gate: HN carries everything, press feeds carry event promos.
        // Headline-only, before extraction, so rejects cost almost nothing.
        let verdict;
        try {
          verdict = await classify(head.title, head.domain);
        } catch (err) {
          log(`classify failed for ${head.url}:`, err);
          continue;
        }
        if (!verdict.relevant) { log(`skip (off-topic): ${head.title.slice(0, 60)}`); continue; }
        if (verdict.promo)     { log(`skip (promo): ${head.title.slice(0, 60)}`); continue; }

        const article = await extractArticle(head.url, head.rawSummary, fetchHtmlWithBrowser);
        // A thin description still makes a usable two-sentence summary; dropping
        // the item loses it entirely, and every new item is meant to be posted.
        if (!article.ok || article.words < 20) {
          log(`skip (unreadable): ${head.url}`);
          continue;                               // a dead link must not reach the channel
        }

        let summary: string | null;
        try {
          summary = await summarize(head.title, article);
        } catch (err) {
          log(`summarize failed for ${head.url}:`, err);
          continue;
        }
        if (!summary) continue;

        slots[idx] = {
          title: head.title, url: head.url, domain: head.domain,
          summary, minutes: article.minutes, section: verdict.section,
        };
      }
    }),
  );

  // rank order preserved: the slot array is filled by index, not by finish time
  const entries: Entry[] = slots.filter((e): e is Entry => e !== null);

  if (entries.length < MIN_ITEMS) {
    // Nothing made it, but everything was considered: rejects must not be
    // reconsidered at every later slot.
    markConsumed(fresh.map((i) => i.id));
    log(`only ${entries.length} items survived (min ${MIN_ITEMS}) — slot skipped`);
    return;
  }

  const messages = formatDigest(entries);

  if (DRY_RUN) {
    // A preview must not eat the queue: nothing is marked consumed here.
    console.log('\n' + '='.repeat(72) + `\nDRY RUN — not posted\n` + '='.repeat(72));
    messages.forEach((m, i) => console.log(`\n--- message ${i + 1}/${messages.length} (${m.length} chars) ---\n${m}`));
    console.log('\n' + '='.repeat(72) + `\n${entries.length} items in ${messages.length} message(s)\n`);
    return;
  }

  // Send first, then consume. A Telegram failure half way through must leave
  // the rest of the queue for the next slot rather than swallowing it.
  for (const m of messages) await sendMessage(m);
  markConsumed(fresh.map((i) => i.id));
  for (const e of entries) {
    const cluster = ranked.find((c) => c.items[0].url === e.url);
    if (cluster) recordPosted(cluster.key, cluster.items[0].id, e.title);
  }
  log(`posted ${entries.length} items`);
}

async function main(): Promise<void> {
  // `--slot` runs one full cycle by hand: collect, then publish.
  if (process.argv.includes('--slot') || process.argv.includes('--once')) {
    try {
      await poll();
      await runSlot();
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
  log('scheduler started');
}

await main();
