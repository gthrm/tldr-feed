// One daily top ten, published as one Telegram message per story.
import { loadSources, fetchAll } from './fetch/index.ts';
import { closeBrowser, fetchHtmlWithBrowser } from './fetch/browser.ts';
import { clusterItems, compare } from './dedupe.ts';
import { rankClusters } from './rank.ts';
import { extractArticle } from './extract.ts';
import { summarize, sameStory, classify, repeatedStories } from './summarize.ts';
import { formatDigest, type Entry } from './format.ts';
import { sendMessage } from './telegram.ts';
import {
  recordPosted,
  recentPosted,
  closeDb,
  claimDailyPublication,
  initDb,
  saveItems,
  collectedSince,
} from './db.ts';
import { isDomainRoot } from './normalize.ts';
import { POLLS, startSchedule } from './schedule.ts';
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

// Feeds also carry old posts; only what appeared since about yesterday's run is
// a candidate. Undated items count as new.
const MAX_AGE_HOURS = 36;

/** One collection: fetch every source and keep what is new. Posts nothing. */
export async function poll(): Promise<void> {
  const all = await fetchAll(loadSources().sources, RSSHUB);
  const added = await saveItems(all);
  log(`poll: ${all.length} items seen, ${added} new`);
}

/** The day's publication: a last collection, then the ten best since yesterday. */
export async function runSlot(collect: () => Promise<void> = poll): Promise<void> {
  const startedAt = new Date();
  if (!DRY_RUN && !(await claimDailyPublication(startedAt))) {
    log('daily publication already attempted — skipped');
    return;
  }

  await collect();
  // First seen since yesterday's publication; published recently, or undated.
  const cutoff = startedAt.getTime() - MAX_AGE_HOURS * 3.6e6;
  const fresh = (await collectedSince(24)).filter(
    (i) => !i.publishedAt || i.publishedAt.getTime() >= cutoff,
  );
  log(`slot: ${fresh.length} candidates collected since yesterday`);

  if (fresh.length === 0) {
    log('nothing new — skipped');
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

  // stage 4: what earlier days posted, by cluster key and by title similarity
  const recent = await recentPosted();
  const postedKeys = new Set(recent.map((p) => p.cluster_key));
  const unseen = clusters.filter((c) => {
    if (c.items.some((i) => postedKeys.has(i.id))) return false;
    return !recent.some((p) => compare(c.items[0].title, p.title).verdict === 'same');
  });
  log(`${clusters.length} clusters, ${unseen.length} not posted before`);

  // stage 5: the same event under different headlines, judged by the model on
  // the top of the ranking against the last few days of posts
  let ranked = rankClusters(unseen);
  const head = ranked.slice(0, MAX_ITEMS * 4);
  try {
    const drop = await repeatedStories(
      head.map((c) => c.items[0].title),
      recent.slice(0, MAX_ITEMS * 4).map((p) => p.title),
    );
    if (drop.size) {
      head.forEach((c, i) => drop.has(i) && log(`skip (repeat): ${c.items[0].title.slice(0, 60)}`));
      ranked = [...head.filter((_, i) => !drop.has(i)), ...ranked.slice(head.length)];
    }
  } catch (err) {
    log('repeat check failed (continuing):', err);
  }

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

  if (entries.length < MIN_ITEMS) {
    const why = modelFailures >= MAX_MODEL_FAILURES ? `model failed ${modelFailures} times` : '';
    log(`only ${entries.length} items survived (min ${MIN_ITEMS}) — skipped ${why}`.trim());
    return;
  }

  const messages = formatDigest(entries, startedAt, TZ);

  if (DRY_RUN) {
    // A preview records nothing.
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
  const day = publicationDay(startedAt);
  for (const [idx, e] of entries.entries()) {
    if (publicationDay() !== day) {
      log('publication crossed midnight — remaining posts dropped');
      return;
    }
    await sendMessage(messages[idx]);
    const cluster = ranked.find((c) => c.items[0].url === e.url);
    try {
      await recordPosted(cluster?.key ?? e.url, day, e, idx);
    } catch (err) {
      // The message is out; a database outage must not stop the rest.
      log(`recording ${e.url} failed:`, err);
    }
  }
  log(`posted ${entries.length} items`);
}

async function main(): Promise<void> {
  await initDb();
  // `--once` runs the day's publication by hand; `--poll` one collection.
  const once = process.argv.includes('--once') || process.argv.includes('--slot');
  if (once || process.argv.includes('--poll')) {
    try {
      await (once ? runSlot() : poll());
    } finally {
      await closeBrowser();
      await closeDb();
    }
    return;
  }
  startSchedule(runSlot, poll);
  log(`scheduler started: collect at ${POLLS.join(', ')}; daily top ${MAX_ITEMS} at 10:00 ${TZ}`);
}

if (import.meta.main) await main();
