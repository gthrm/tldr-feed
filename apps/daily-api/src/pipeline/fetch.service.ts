/**
 * Four kinds of source behind one call, so the pipeline never branches on them.
 * Unlike the bot this keeps no ETag state: the daily run happens once and wants
 * everything the source has, not the delta since twenty minutes ago.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { canonicalizeUrl, domainOf, hashUrl, resolveRedirects, type Item } from './normalize.js';
import { fetchFeed, UA } from './feed.js';
import { fetchSitemap } from './sitemap.js';
import type { Source } from '../sources/sources.service.js';

type Raw = {
  title: string;
  link: string;
  isoDate?: string;
  contentSnippet?: string;
  content?: string;
  points?: number;
};

type HnHit = {
  title: string;
  url?: string;
  objectID: string;
  created_at?: string;
  story_text?: string;
  points?: number;
};
type YcHit = {
  title: string;
  url?: string;
  slug?: string;
  id?: number;
  created_at?: string;
  launched_at?: string;
  tagline?: string;
  description?: string;
};
type HfPaper = {
  paper?: { id?: string; title?: string; summary?: string; publishedAt?: string };
  title?: string;
  url?: string;
  publishedAt?: string;
};

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function codePoint(n: number, original: string): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return original;
  }
}

/** Feeds ship entities in titles; decoded once, here, so nothing double-escapes. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (m: string, d: string) => codePoint(Number(d), m))
    .replace(/&#x([0-9a-f]+);/gi, (m: string, h: string) => codePoint(parseInt(h, 16), m))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // last, so &amp;lt; does not become <
}

@Injectable()
export class FetchService {
  private readonly log = new Logger(FetchService.name);

  constructor(private readonly config: ConfigService) {}

  private get rsshubBase(): string {
    return process.env.RSSHUB_BASE_URL ?? 'http://localhost:1200';
  }

  private async fetchApi(src: Source): Promise<Raw[]> {
    const res = await fetch(src.url!, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { hits?: unknown[]; data?: unknown[] };

    if (src.id === 'hn') {
      return ((body.hits ?? []) as HnHit[])
        .filter((h) => (h.points ?? 0) >= (src.min_points ?? 0) && (h.url ?? h.objectID))
        .map((h) => ({
          title: h.title,
          link: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
          isoDate: h.created_at,
          contentSnippet: h.story_text ?? '',
          points: h.points,
        }));
    }

    if (src.id === 'yc-launches') {
      return ((body.hits ?? []) as YcHit[]).map((h) => ({
        title: h.title,
        link: h.url ?? `https://www.ycombinator.com/launches/${h.slug ?? h.id}`,
        isoDate: h.created_at ?? h.launched_at,
        contentSnippet: h.tagline ?? h.description ?? '',
      }));
    }

    const arr = (Array.isArray(body) ? body : (body.data ?? [])) as HfPaper[];
    return arr.map((p) => ({
      title: p.paper?.title ?? p.title ?? '',
      link: p.paper?.id ? `https://huggingface.co/papers/${p.paper.id}` : (p.url ?? ''),
      isoDate: p.publishedAt ?? p.paper?.publishedAt,
      contentSnippet: p.paper?.summary ?? '',
    }));
  }

  private async fetchRaw(src: Source): Promise<Raw[]> {
    switch (src.kind) {
      case 'api':
        return this.fetchApi(src);
      case 'sitemap':
        return fetchSitemap({ sitemap: src.sitemap!, include: src.include!, limit: src.limit });
      case 'browser':
        // No Chromium here on purpose: it would triple the image on a Pi that
        // already runs one. The bot keeps that source. Skipping quietly would
        // hide a source that the shared list says to read, so it is named.
        this.log.warn(`${src.id}: skipped, needs a browser and this app has none`);
        return [];
      case 'feed':
      case 'rsshub': {
        const url = src.kind === 'rsshub' ? `${this.rsshubBase}${src.route}` : src.url!;
        const res = await fetchFeed(url);
        return res.items as Raw[];
      }
    }
  }

  /** Everything a source returned, as Items with clean urls. Never throws. */
  async fetchSource(src: Source): Promise<Item[]> {
    let raw: Raw[];
    try {
      raw = await this.fetchRaw(src);
    } catch (err) {
      this.log.warn(`${src.id}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }

    const maxAgeMs = (src.max_age_hours ?? 0) * 3.6e6;

    // A Reddit link post has no body of its own — its content is the URL it
    // points at. Follow that rather than linking a thread we cannot read.
    const redditLinkPost = (body: string): string | null => {
      const stripped = body.replace(/submitted by[\s\S]*$/i, '').trim();
      const links = [...stripped.matchAll(/https?:\/\/[^\s<"']+/g)].map((m) => m[0]);
      const external = links.find((l) => !/reddit\.com|redd\.it/i.test(l));
      return external && stripped.replace(external, '').trim().length < 40 ? external : null;
    };

    const out: Item[] = [];
    for (const r of raw) {
      if (!r?.title || !r?.link) continue;
      const published = r.isoDate ? new Date(r.isoDate) : null;
      const publishedAt = published && !Number.isNaN(published.getTime()) ? published : null;
      if (publishedAt && maxAgeMs && Date.now() - publishedAt.getTime() > maxAgeMs) continue;

      const feedBody = decodeEntities(stripTags(r.contentSnippet || r.content || ''));
      let link = r.link;
      if (/reddit\.com/i.test(link)) {
        const external = redditLinkPost(feedBody);
        if (external) link = external;
      }
      const url = canonicalizeUrl(await resolveRedirects(link));
      out.push({
        id: hashUrl(url),
        source: src.id,
        section: src.section,
        weight: src.weight,
        title: decodeEntities(r.title).trim(),
        url,
        domain: domainOf(url),
        publishedAt,
        rawSummary: feedBody.slice(0, 2000),
        points: r.points,
      });
    }
    return out;
  }

  /** All sources, bounded concurrency so we do not open 47 sockets at once. */
  async fetchAll(sources: Source[], concurrency?: number): Promise<Item[]> {
    const workers = concurrency ?? this.config.get<number>('pipeline.concurrency') ?? 8;
    const out: Item[] = [];
    let i = 0;
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (i < sources.length) {
          const src = sources[i++];
          out.push(...(await this.fetchSource(src)));
        }
      }),
    );
    this.log.log(`${out.length} items from ${sources.length} sources`);
    return out;
  }
}
