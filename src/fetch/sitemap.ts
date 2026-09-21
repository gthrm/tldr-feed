// Sources with no feed but a sitemap and honest Open Graph tags.
// Mistral is the case this was written for: 263 news URLs with lastmod dates,
// article pages carry og:title / og:description in the raw HTML, no JS needed.
import { UA } from './parse-feed.ts';

export type SitemapItem = { title: string; link: string; isoDate?: string; contentSnippet: string };

function meta(html: string, tag: string): string | undefined {
  const a = html.match(
    new RegExp(`<meta[^>]*(?:property|name)="${tag}"[^>]*content="([^"]*)"`, 'i'),
  );
  if (a) return decodeEntities(a[1]);
  const b = html.match(
    new RegExp(`<meta[^>]*content="([^"]*)"[^>]*(?:property|name)="${tag}"`, 'i'),
  );
  return b ? decodeEntities(b[1]) : undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

async function get(url: string, timeoutMs = 25000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export type SitemapConfig = {
  sitemap: string; // sitemap url
  include: string; // path fragment an article url must contain
  exclude?: string[]; // fragments that disqualify (localised copies, index pages)
  limit?: number; // how many of the newest to hydrate
};

/** Newest-first article list, hydrated from each page's Open Graph tags. */
export async function fetchSitemap(cfg: SitemapConfig): Promise<SitemapItem[]> {
  const xml = await get(cfg.sitemap);

  const entries: { loc: string; lastmod: string }[] = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = m[1].match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();
    const lastmod = m[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim() ?? '';
    if (!loc || !loc.includes(cfg.include)) continue;
    // drop the section index itself and localised duplicates (/it/news/, /fr/news/, …)
    if (loc.replace(/\/$/, '').endsWith(cfg.include.replace(/\/$/, ''))) continue;
    if (/^https?:\/\/[^/]+\/[a-z]{2}(-[a-z]{2})?\//i.test(loc)) continue;
    if (cfg.exclude?.some((frag) => loc.includes(frag))) continue;
    entries.push({ loc, lastmod });
  }

  entries.sort((a, b) => b.lastmod.localeCompare(a.lastmod));

  const items: SitemapItem[] = [];
  for (const { loc, lastmod } of entries.slice(0, cfg.limit ?? 15)) {
    try {
      const html = await get(loc);
      const title = meta(html, 'og:title') ?? html.match(/<title>([^<]*)/)?.[1]?.trim();
      if (!title) continue;
      items.push({
        title,
        link: loc,
        isoDate: meta(html, 'article:published_time') ?? (lastmod || undefined),
        contentSnippet: meta(html, 'og:description') ?? '',
      });
    } catch {
      // one bad page must not sink the source
    }
  }
  return items;
}
