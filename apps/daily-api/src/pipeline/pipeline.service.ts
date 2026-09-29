/**
 * One run, one day. The bot does this ten times a day for Telegram; this does it
 * once in the evening, for a page and an email. Same rules, separate code.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { clusterItems, compare } from './dedupe.js';
import { extractArticle } from './extract.js';
import { isDomainRoot, type Item } from './normalize.js';
import { rankClusters } from './rank.js';
import { classify, sameStory, summarize } from './summarize.js';
import { FetchService } from './fetch.service.js';
import { SourcesService } from '../sources/sources.service.js';
import { dayBounds, dayOf, slotOf } from '../shared/day.js';

export type DayEntry = {
  day: string;
  publishedAt: Date;
  slot: string;
  section: string;
  title: string;
  url: string;
  domain: string;
  summary: string;
  minutes: number;
  position: number;
};

@Injectable()
export class PipelineService {
  private readonly log = new Logger(PipelineService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sources: SourcesService,
    private readonly fetcher: FetchService,
  ) {}

  private get tz(): string {
    return this.config.get<string>('tz') ?? 'Europe/Belgrade';
  }

  /** Items that belong to this calendar day. No date means it arrived now. */
  private ofDay(items: Item[], day: string, now: number): Item[] {
    const { startMs, endMs } = dayBounds(day, this.tz);
    return items.filter((i) => {
      const at = i.publishedAt?.getTime() ?? now;
      return at >= startMs && at < endMs;
    });
  }

  async run(day: string, opts: { now?: number; limit?: number } = {}): Promise<DayEntry[]> {
    const now = opts.now ?? Date.now();
    const { sources } = this.sources.load();

    const all = await this.fetcher.fetchAll(sources);
    const items = this.ofDay(all, day, now);
    this.log.log(`${items.length} of ${all.length} items fall on ${day}`);
    if (!items.length) return [];

    // One cluster per story: five outlets on one announcement ship once.
    //
    // Clustering compares every item against every cluster head, so a day's
    // worth of items is tens of thousands of comparisons. Most are settled by
    // the similarity thresholds for nothing; only the grey band asks the model,
    // and those calls are sequential. Unbounded, a busy day would spend hours
    // and real money resolving pairs that barely matter, so the calls have a
    // budget. Past it, unsure means different — the same fallback used when the
    // model is unavailable, which at worst ships two articles on one story.
    const budget = this.config.get<number>('pipeline.resolverCalls') ?? 200;
    let used = 0;
    const clusters = await clusterItems(items, async (a, b) => {
      if (used >= budget) return false;
      // Two stories from the same source are the source's own two stories.
      if (a.source === b.source) return false;
      used++;
      try {
        return await sameStory(a.title, b.title);
      } catch {
        return false; // model unavailable: keep them apart
      }
    });
    if (used) this.log.log(`${used} grey-band comparisons resolved by the model (budget ${budget})`);

    const ranked = rankClusters(clusters, now);

    // The daily is a selection, not a firehose: the best twenty of the day. The
    // gate and unreadable pages reject some, so work down the ranking until
    // twenty survive rather than summarising exactly twenty and shipping less —
    // with a ceiling, so a day where everything fails cannot run forever.
    const target = opts.limit ?? this.config.get<number>('pipeline.dailyLimit') ?? 20;
    const ceiling = Math.min(ranked.length, target * 4);
    const candidates = ranked.slice(0, ceiling);
    this.log.log(`${clusters.length} clusters, looking for the best ${target}`);

    // Each item costs a classify call, a page fetch and a summarize call.
    const concurrency = this.config.get<number>('pipeline.concurrency') ?? 6;
    // Stage one, which the bot gets from a unique index and INSERT OR IGNORE:
    // the same canonical URL must appear once. Two clusters can still hold it
    // when their headlines differ enough — an aggregator and the publisher, say
    // — and without this the day's insert violates the (day, url) index and the
    // whole evening is lost.
    const seenUrls = new Set<string>();
    const slots: (DayEntry | null)[] = Array.from({ length: candidates.length }, () => null);
    let next = 0;

    let found = 0;

    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (next < candidates.length && found < target) {
          const idx = next++;
          const head = candidates[idx].items[0];

          if (isDomainRoot(head.url)) continue; // never link a bare domain
          if (seenUrls.has(head.url)) continue;
          seenUrls.add(head.url);

          let verdict;
          try {
            verdict = await classify(head.title, head.domain);
          } catch (err) {
            this.log.warn(`classify failed for ${head.url}: ${String(err)}`);
            continue;
          }
          if (!verdict.relevant || verdict.promo) continue;

          const article = await extractArticle(head.url, head.rawSummary);
          if (!article.ok || article.words < 20) continue; // a dead link must not ship

          let summary: string | null;
          try {
            summary = await summarize(head.title, article);
          } catch (err) {
            this.log.warn(`summarize failed for ${head.url}: ${String(err)}`);
            continue;
          }
          if (!summary) continue;

          const at = head.publishedAt ?? new Date(now);
          slots[idx] = {
            day: dayOf(at.getTime(), this.tz),
            publishedAt: at,
            slot: slotOf(at.getTime(), this.tz),
            section: verdict.section,
            title: head.title,
            url: head.url,
            domain: head.domain,
            summary,
            minutes: article.minutes,
            position: 0,
          };
          found++;
        }
      }),
    );

    // Rank order is preserved: the array is filled by index, not by finish time.
    const entries = slots.filter((e): e is DayEntry => e !== null).slice(0, target);
    entries.forEach((e, i) => (e.position = i));
    this.log.log(`${entries.length} entries survived for ${day}`);
    return entries;
  }

  /** Headline-only pass: what the day holds, before paying for summaries. */
  async preview(day: string, opts: { now?: number } = {}): Promise<Item[]> {
    const now = opts.now ?? Date.now();
    const { sources } = this.sources.load();
    const items = this.ofDay(await this.fetcher.fetchAll(sources), day, now);
    const clusters = await clusterItems(items, async () => false);
    return rankClusters(clusters, now).map((c) => c.items[0]);
  }
}

export { compare };
