// One dispatcher over the four source kinds, so the pipeline never branches on them.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { fetchFeed, UA } from './parse-feed.ts';
import { fetchSitemap } from './sitemap.ts';
import { fetchWithBrowser } from './browser.ts';
import { canonicalizeUrl, resolveRedirects, hashUrl, domainOf, type Item } from '../normalize.ts';
import { getSourceState, setSourceState } from '../db.ts';

export type Source = {
  id: string;
  kind: 'feed' | 'api' | 'rsshub' | 'sitemap' | 'browser';
  url?: string;
  route?: string;
  sitemap?: string;
  include?: string;
  limit?: number;
  itemSelector?: string;
  titleSelector?: string;
  dateSelector?: string;
  weight: number;
  section: string;
  min_points?: number;
  max_age_hours?: number;
};

type SourcesFile = { defaults?: Partial<Source>; sources: Source[] };

// The source list is shared with the daily digest: one file, two consumers, so a
// source added or dropped here changes both. Only the list is shared - no code is.
const sourcesFile = process.env.SOURCES_PATH
  ? pathToFileURL(process.env.SOURCES_PATH)
  : new URL('../../../../packages/sources/sources.yaml', import.meta.url);

export function loadSources(): { defaults: Partial<Source>; sources: Source[] } {
  const cfg = parse(readFileSync(sourcesFile, 'utf8')) as SourcesFile;
  const d = cfg.defaults ?? {};
  return { defaults: d, sources: cfg.sources.map((src) => ({ ...d, ...src })) };
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Feeds ship entities in titles (The Verge sends `&#8217;`). Decoded here, once,
 * so format.ts escapes real characters instead of escaping an escape.
 */
function codePoint(n: number, original: string): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return original;
  }
}

export function decodeEntities(s: string): string {
  return (
    s
      // An out-of-range code point throws RangeError; unguarded here it rejected
      // fetchAll and discarded every source's items for that poll.
      .replace(/&#(\d+);/g, (m: string, d: string) => codePoint(Number(d), m))
      .replace(/&#x([0-9a-f]+);/gi, (m: string, h: string) => codePoint(parseInt(h, 16), m))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  ); // last, so &amp;lt; does not become <
}

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

async function fetchApi(src: Source): Promise<Raw[]> {
  const res = await fetch(src.url!, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { hits?: unknown[]; data?: unknown[] };

  // Hacker News via Algolia
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

  // Y Combinator launches
  if (src.id === 'yc-launches') {
    return ((body.hits ?? []) as YcHit[]).map((h) => ({
      title: h.title,
      link: h.url ?? `https://www.ycombinator.com/launches/${h.slug ?? h.id}`,
      isoDate: h.created_at ?? h.launched_at,
      contentSnippet: h.tagline ?? h.description ?? '',
    }));
  }

  // Hugging Face daily papers
  const arr = (Array.isArray(body) ? body : (body.data ?? [])) as HfPaper[];
  return arr.map((p) => ({
    title: p.paper?.title ?? p.title ?? '',
    link: p.paper?.id ? `https://huggingface.co/papers/${p.paper.id}` : (p.url ?? ''),
    isoDate: p.publishedAt ?? p.paper?.publishedAt,
    contentSnippet: p.paper?.summary ?? '',
  }));
}

async function fetchRaw(src: Source, rsshubBase: string): Promise<Raw[]> {
  switch (src.kind) {
    case 'api':
      return fetchApi(src);
    case 'sitemap':
      return fetchSitemap({ sitemap: src.sitemap!, include: src.include!, limit: src.limit });
    case 'browser':
      return fetchWithBrowser({
        url: src.url!,
        itemSelector: src.itemSelector!,
        titleSelector: src.titleSelector!,
        dateSelector: src.dateSelector,
        limit: src.limit,
      });
    case 'feed':
    case 'rsshub': {
      const url = src.kind === 'rsshub' ? `${rsshubBase}${src.route}` : src.url!;
      const state = src.kind === 'feed' ? getSourceState(src.id) : undefined;
      const res = await fetchFeed(url, state?.etag ?? undefined, state?.last_modified ?? undefined);
      if (src.kind === 'feed')
        setSourceState(src.id, { etag: res.etag, lastModified: res.lastModified });
      return res.notModified ? [] : (res.items as Raw[]);
    }
  }
}

/** Everything a source returned, as Items with clean urls. Never throws. */
export async function fetchSource(src: Source, rsshubBase: string): Promise<Item[]> {
  let raw: Raw[];
  try {
    raw = await fetchRaw(src, rsshubBase);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSourceState(src.id, { error: message.slice(0, 200) });
    return [];
  }

  const maxAgeMs = (src.max_age_hours ?? 0) * 3.6e6;

  // A Reddit link post has no body of its own — its content is just the URL it
  // points at. Follow that instead of linking a thread we cannot even read.
  const redditLinkPost = (body: string): string | null => {
    const stripped = body.replace(/submitted by[\s\S]*$/i, '').trim();
    const links = [...stripped.matchAll(/https?:\/\/[^\s<"']+/g)].map((m) => m[0]);
    const external = links.find((l) => !/reddit\.com|redd\.it/i.test(l));
    // Only when the body is essentially nothing but that link.
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

/** All sources, bounded concurrency so we do not open 48 sockets at once. */
export async function fetchAll(
  sources: Source[],
  rsshubBase: string,
  concurrency = 8,
): Promise<Item[]> {
  const out: Item[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < sources.length) {
        const src = sources[i++];
        out.push(...(await fetchSource(src, rsshubBase)));
      }
    }),
  );
  return out;
}
